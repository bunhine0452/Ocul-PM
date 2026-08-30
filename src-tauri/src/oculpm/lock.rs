//! Single-process advisory lock for `.oculpm/`.
//!
//! `.oculpm/.lock` is a JSON file describing the live process that owns the
//! project's `.oculpm/` tree. While owned, the lock task pulses the
//! `heartbeat_at` field every 30 seconds. If a second instance finds a lock
//! whose heartbeat is older than `STALE_THRESHOLD_SECS` (5 minutes), it
//! assumes the previous owner crashed and recovers the lock.
//!
//! See `docs/major_update/oculpm/00-spec.md` §6 for the protocol.

#![allow(dead_code)] // Whole module is consumed by OculpmManager (W1-PR7).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::OculpmError;

const SCHEMA_VERSION: u32 = 1;
const HEARTBEAT_INTERVAL_SECS: u64 = 30;
const STALE_THRESHOLD_SECS: i64 = 5 * 60;

/// 소유권 확인 주기. 하트비트(쓰기)보다 자주 **읽기만** 한다 — 인계당한 쪽이
/// 자기가 더 이상 주인이 아님을 빨리 알아야 두 인스턴스가 같은 프로젝트를
/// 동시에 감시하는 창이 짧아진다.
const OWNERSHIP_CHECK_SECS: u64 = 5;

/// 락을 어떻게 잡을 것인가 (2026-08-23).
///
/// 예전에는 한 가지뿐이었다 — 살아 있는 소유자가 있으면 무조건 양보. 그래서
/// **먼저 뜬 인스턴스가 영원히 이긴다**: 설치본을 띄워 둔 채 개발 빌드를
/// 돌리면 개발 빌드는 어떤 프로젝트도 감시하지 못했고, 사용자가 저쪽 앱을
/// 손으로 끄는 것 말고는 방법이 없었다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquirePolicy {
    /// 살아 있는 소유자에게 양보한다. 재시도 경로의 기본값 — 아니면 두
    /// 인스턴스가 락을 주고받으며 서로를 계속 쫓아낸다.
    Polite,
    /// 살아 있는 소유자에게서 **가져온다**. 앱이 새로 뜰 때만 쓴다: "가장
    /// 최근에 연 인스턴스가 주인" 이라는 규칙이라야 사용자가 결과를 예측할 수
    /// 있다. 쫓겨난 쪽은 하트비트가 그 사실을 발견해 감시를 접는다.
    TakeOver,
}

#[derive(Debug, Serialize, Deserialize)]
struct LockFile {
    schema_version: u32,
    pid: u32,
    hostname: String,
    started_at: String,
    heartbeat_at: String,
}

/// Diagnostics about a stale lock that we just took over — surfaced through
/// `LockAcquisition::Recovered` so callers can emit an integrity_warning.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ZombieInfo {
    pub previous_pid: u32,
    pub heartbeat_age_seconds: i64,
}

/// Outcome of `LockGuard::acquire`. Maps to `LockStateView` for the UI.
#[allow(dead_code)]
#[derive(Debug)]
pub enum LockAcquisition {
    /// No prior lock; we created a fresh one.
    Acquired(LockGuard),
    /// Lock is owned by another live process — caller should fall back to
    /// read-only mode. `holder_exe` 는 그 프로세스의 실행 경로(알아낼 수 있으면)
    /// — 사용자에게 "누가 쥐고 있는지" 를 이름으로 말해 주기 위한 것이다.
    Held {
        by_pid: u32,
        heartbeat_at: String,
        holder_exe: Option<String>,
    },
    /// Prior lock was stale (heartbeat older than threshold); we took over.
    Recovered { guard: LockGuard, info: ZombieInfo },
    /// 살아 있는 소유자에게서 가져왔다 (`AcquirePolicy::TakeOver`).
    TakenOver {
        guard: LockGuard,
        previous_pid: u32,
        previous_exe: Option<String>,
    },
}

/// RAII handle for an owned lock. Drop or `release()` cleans up the lock file
/// and the heartbeat task.
#[allow(dead_code)]
#[derive(Debug)]
pub struct LockGuard {
    path: PathBuf,
    /// `Some` only between successful `acquire` and `release`/`drop`.
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
    /// Set so the heartbeat task can exit cleanly when `release` is called.
    shutdown: Arc<Notify>,
    /// 다른 인스턴스가 이 락을 가져갔다 — 하트비트가 소유권 확인에서 발견해
    /// 세운다. 세워진 뒤로 이 가드는 **아무 권한도 없다**: 감시를 접어야 하고,
    /// 락 파일을 지워서도 안 된다 (지금 그 파일은 남의 것이다).
    evicted: Arc<AtomicBool>,
}

impl LockGuard {
    /// 살아 있는 소유자에게 양보하며 락을 시도한다 (`AcquirePolicy::Polite`).
    pub async fn acquire(path: &Path) -> Result<LockAcquisition, OculpmError> {
        Self::acquire_with(path, AcquirePolicy::Polite, Arc::new(Notify::new())).await
    }

    /// 정책과 "인계당함" 알림 채널을 지정해 락을 시도한다.
    ///
    /// `evicted_notify` 는 이 가드가 인계당한 순간 깨어난다 — 감독관이 그때
    /// 곧바로 감시를 접게 하려는 것이다 (다음 60초 틱까지 기다리면 두
    /// 인스턴스가 같은 프로젝트를 동시에 감시한다).
    pub async fn acquire_with(
        path: &Path,
        policy: AcquirePolicy,
        evicted_notify: Arc<Notify>,
    ) -> Result<LockAcquisition, OculpmError> {
        match std::fs::read_to_string(path) {
            Ok(text) => {
                let existing: LockFile =
                    serde_json::from_str(&text).map_err(|source| OculpmError::JsonParse {
                        path: path.to_path_buf(),
                        source,
                    })?;
                let age = heartbeat_age_seconds(&existing.heartbeat_at)?;
                // PR-CI 실기기 확인(2026-07-20)에서 드러난 dev 마찰: Ctrl+C 등
                // 비정상 종료는 graceful 락 해제를 못 타고, 재시작이 5분
                // 하트비트 창 내내 read-only 로 밀렸다. 보유 PID 가 이 호스트에
                // 확실히 없으면 하트비트 나이와 무관하게 즉시 회수한다.
                // 판정 불가(비 unix·ps 실패)나 PID 재사용으로 "살아있음" 이면
                // 종전대로 하트비트 기준 폴백 — 회수를 미루는 쪽이 안전.
                let holder_dead = pid_alive(existing.pid) == Some(false);
                if !holder_dead && age <= STALE_THRESHOLD_SECS {
                    match policy {
                        AcquirePolicy::Polite => {
                            return Ok(LockAcquisition::Held {
                                by_pid: existing.pid,
                                heartbeat_at: existing.heartbeat_at,
                                holder_exe: exe_of(existing.pid),
                            });
                        }
                        AcquirePolicy::TakeOver => {
                            let previous_exe = exe_of(existing.pid);
                            let guard = Self::write_fresh(path, evicted_notify)?;
                            return Ok(LockAcquisition::TakenOver {
                                guard,
                                previous_pid: existing.pid,
                                previous_exe,
                            });
                        }
                    }
                }
                let guard = Self::write_fresh(path, evicted_notify)?;
                Ok(LockAcquisition::Recovered {
                    guard,
                    info: ZombieInfo {
                        previous_pid: existing.pid,
                        heartbeat_age_seconds: age,
                    },
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let guard = Self::write_fresh(path, evicted_notify)?;
                Ok(LockAcquisition::Acquired(guard))
            }
            Err(source) => Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

    fn write_fresh(path: &Path, evicted_notify: Arc<Notify>) -> Result<LockGuard, OculpmError> {
        let pid = std::process::id();
        let now = chrono::Utc::now().to_rfc3339();
        let lock = LockFile {
            schema_version: SCHEMA_VERSION,
            pid,
            hostname: detect_hostname(),
            started_at: now.clone(),
            heartbeat_at: now,
        };
        let text = serde_json::to_string_pretty(&lock).map_err(OculpmError::JsonSerialize)?;
        write_atomic(path, text.as_bytes())?;

        let shutdown = Arc::new(Notify::new());
        let evicted = Arc::new(AtomicBool::new(false));
        let path_clone = path.to_path_buf();
        let shutdown_clone = shutdown.clone();
        let evicted_clone = evicted.clone();
        let heartbeat_handle = tokio::spawn(async move {
            // 짧은 주기로 **읽어** 소유권을 확인하고, 여러 틱마다 한 번
            // **써서** 하트비트를 갱신한다. 쓰기를 자주 하면 fs 이벤트 소음이
            // 늘고, 읽기를 드물게 하면 인계당한 사실을 늦게 알아 두 인스턴스가
            // 같은 프로젝트를 동시에 감시한다.
            let pulses_per_write = HEARTBEAT_INTERVAL_SECS
                .div_ceil(OWNERSHIP_CHECK_SECS)
                .max(1);
            let mut interval =
                tokio::time::interval(tokio::time::Duration::from_secs(OWNERSHIP_CHECK_SECS));
            // Skip the immediate first tick — the lock was just written.
            interval.tick().await;
            let mut ticks: u64 = 0;
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        ticks += 1;
                        let p = path_clone.clone();
                        // File I/O is cheap; doing it inline keeps the task
                        // tiny. If it ever becomes a hot path, wrap in
                        // spawn_blocking.
                        let write_now = ticks.is_multiple_of(pulses_per_write);
                        if matches!(heartbeat_pulse(&p, pid, write_now), Ok(Ownership::Lost)) {
                            evicted_clone.store(true, Ordering::SeqCst);
                            evicted_notify.notify_waiters();
                            tracing::warn!(
                                target: "oculpm::lock",
                                path = %p.display(),
                                "[FLOW] 락을 다른 인스턴스가 가져갔다 — 이 프로세스는 이 프로젝트를 놓는다"
                            );
                            break;
                        }
                    }
                    _ = shutdown_clone.notified() => break,
                }
            }
        });

        Ok(LockGuard {
            path: path.to_path_buf(),
            heartbeat_handle: Some(heartbeat_handle),
            shutdown,
            evicted,
        })
    }

    /// 다른 인스턴스가 이 락을 가져갔는가. `true` 면 이 가드로는 아무것도
    /// 하면 안 된다 — 감시를 접고 읽기 전용으로 내려가야 한다.
    pub fn is_evicted(&self) -> bool {
        self.evicted.load(Ordering::SeqCst)
    }

    /// Stop the heartbeat task and remove the lock file.
    #[allow(dead_code)] // Used by OculpmManager teardown (W1-PR7).
    pub async fn release(mut self) -> Result<(), OculpmError> {
        self.shutdown.notify_waiters();
        if let Some(handle) = self.heartbeat_handle.take() {
            // best-effort: short timeout so a wedged task can't block release.
            let _ = tokio::time::timeout(tokio::time::Duration::from_secs(1), async {
                let _ = handle.await;
            })
            .await;
        }
        // **우리 것일 때만** 지운다. 인계당했거나(evicted) 좀비 락을 회수당한
        // 뒤라면 이 경로의 파일은 이미 남의 것이다 — 지우면 살아 있는 소유자의
        // 락을 지워 두 인스턴스가 동시에 주인이 된다.
        if !self.owns_file_on_disk() {
            return Ok(());
        }
        match std::fs::remove_file(&self.path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(source) => Err(OculpmError::Io {
                path: self.path.clone(),
                source,
            }),
        }
    }

    /// 디스크의 락 파일이 아직 **이 프로세스** 것인가.
    fn owns_file_on_disk(&self) -> bool {
        if self.is_evicted() {
            return false;
        }
        read_lock_pid(&self.path) == Some(std::process::id())
    }
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        // Sync cleanup only — Drop can't await. If `release` was called this
        // becomes a no-op because `heartbeat_handle` is already None.
        self.shutdown.notify_waiters();
        if let Some(handle) = self.heartbeat_handle.take() {
            handle.abort();
        }
        // `release` 와 같은 규칙 — 우리 것이 아니면 손대지 않는다.
        if self.owns_file_on_disk() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// 같은 호스트에서 보유 PID 생존 여부를 최선-노력으로 판정한다. `ps -p` 는
/// 소유자와 무관하게 프로세스 존재 시 exit 0 (macOS/Linux 공통) — `kill -0`
/// 의 EPERM 오판(타 사용자 프로세스를 사망으로 봄)이 없다. 판정 불가면
/// `None` → 호출부가 하트비트 기준으로 폴백.
#[cfg(unix)]
fn pid_alive(pid: u32) -> Option<bool> {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .ok()
        .map(|s| s.success())
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> Option<bool> {
    None
}

fn heartbeat_age_seconds(heartbeat_at: &str) -> Result<i64, OculpmError> {
    let parsed = chrono::DateTime::parse_from_rfc3339(heartbeat_at)
        .map_err(|_| OculpmError::InvalidConfig(format!("invalid heartbeat_at: {heartbeat_at}")))?;
    let now = chrono::Utc::now();
    Ok((now - parsed.with_timezone(&chrono::Utc)).num_seconds())
}

/// 하트비트 한 틱의 결과 — 아직 우리가 주인인가.
#[derive(Debug, PartialEq, Eq)]
enum Ownership {
    Held,
    /// 디스크의 락이 다른 pid 것이다 = 인계당했다.
    Lost,
}

/// 소유권을 확인하고, `write` 면 `heartbeat_at` 을 갱신해 다시 쓴다.
///
/// 파일이 없거나 파싱이 안 되는 건 `Held` 로 본다 — 아직 우리 차례일 수도
/// 있고(막 지워졌다가 다시 생기는 중), 그걸 인계로 읽으면 멀쩡한 소유자가
/// 스스로 물러난다. **다른 pid 가 적혀 있을 때만** 인계로 판정한다.
fn heartbeat_pulse(path: &Path, expected_pid: u32, write: bool) -> Result<Ownership, OculpmError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Ok(Ownership::Held),
    };
    let mut lock: LockFile = match serde_json::from_str(&text) {
        Ok(l) => l,
        Err(_) => return Ok(Ownership::Held),
    };
    if lock.pid != expected_pid {
        return Ok(Ownership::Lost);
    }
    if !write {
        return Ok(Ownership::Held);
    }
    lock.heartbeat_at = chrono::Utc::now().to_rfc3339();
    let new_text = serde_json::to_string_pretty(&lock).map_err(OculpmError::JsonSerialize)?;
    write_atomic(path, new_text.as_bytes())?;
    Ok(Ownership::Held)
}

/// 락 파일에 적힌 소유 pid (읽을 수 없으면 `None`).
fn read_lock_pid(path: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<LockFile>(&text).ok().map(|l| l.pid)
}

/// pid → 실행 경로. 사용자에게 "누가 쥐고 있는지" 를 이름으로 말해 주기 위한
/// 표시용 값이라, 실패는 전부 `None` 으로 삼킨다.
#[cfg(unix)]
fn exe_of(pid: u32) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!line.is_empty()).then_some(line)
}

#[cfg(not(unix))]
fn exe_of(_pid: u32) -> Option<String> {
    None
}

fn detect_hostname() -> String {
    // Cross-platform best-effort. We use the env var as a cheap signal and
    // fall back to a sentinel — the hostname is informational only.
    std::env::var("HOSTNAME")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("COMPUTERNAME").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "unknown".into())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Helper: build a `LockFile` JSON with a specific pid and heartbeat,
    /// then drop it on disk. Lets us simulate "another process is alive"
    /// and "stale lock" scenarios without spawning real processes.
    fn write_synthetic_lock(path: &Path, pid: u32, heartbeat_at: &str) {
        let lock = LockFile {
            schema_version: SCHEMA_VERSION,
            pid,
            hostname: "test".into(),
            started_at: heartbeat_at.into(),
            heartbeat_at: heartbeat_at.into(),
        };
        let text = serde_json::to_string_pretty(&lock).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Case 1 — fresh path: acquire creates the file and reports `Acquired`.
    #[tokio::test]
    async fn acquire_fresh() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Acquired(guard) => {
                assert!(path.exists(), "lock file must exist");
                guard.release().await.unwrap();
                assert!(!path.exists(), "release must remove lock file");
            }
            other => panic!("expected Acquired, got {:?}", other),
        }
    }

    /// Case 2 — fresh held lock by another pid: returns `Held` without
    /// touching the file.
    #[tokio::test]
    async fn acquire_held_when_fresh_other_pid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let now = chrono::Utc::now().to_rfc3339();
        // 살아있는 타 프로세스여야 한다 — pid 1(launchd/init)은 unix 에서 항상
        // 생존. (죽은 pid 는 이제 하트비트가 신선해도 즉시 회수된다 — 아래
        // dead-holder 케이스.)
        let other_pid = 1u32;
        write_synthetic_lock(&path, other_pid, &now);

        let before = std::fs::read(&path).unwrap();
        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Held { by_pid, .. } => {
                assert_eq!(by_pid, other_pid);
                let after = std::fs::read(&path).unwrap();
                assert_eq!(before, after, "Held must not modify the lock file");
            }
            other => panic!("expected Held, got {:?}", other),
        }
    }

    /// Case 2.5 (PR-CI 실기기 확인 fix) — 보유 PID 가 죽어 있으면 하트비트가
    /// 신선해도 즉시 회수한다. dev Ctrl+C 처럼 graceful 해제를 못 탄 락이
    /// 5분간 read-only 를 강제하던 마찰의 재발 방지.
    #[tokio::test]
    async fn acquire_recovers_immediately_when_holder_pid_is_dead() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let fresh = chrono::Utc::now().to_rfc3339();
        // macOS pid_max(≈99998)·linux 기본(4194304)보다 큰 값 — 존재 불가.
        let dead_pid = 4_999_999u32;
        write_synthetic_lock(&path, dead_pid, &fresh);

        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Recovered { info, guard } => {
                assert_eq!(info.previous_pid, dead_pid);
                guard.release().await.unwrap();
            }
            other => panic!("expected Recovered (dead holder), got {:?}", other),
        }
    }

    /// 앱이 새로 뜰 때(`TakeOver`)는 **살아 있는** 소유자에게서도 가져온다.
    /// 예전에는 먼저 뜬 인스턴스가 영원히 이겨서, 설치본을 띄워 둔 채 개발
    /// 빌드를 돌리면 개발 빌드가 아무 프로젝트도 감시하지 못했다.
    #[tokio::test]
    async fn take_over_policy_claims_a_live_holders_lock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let fresh = chrono::Utc::now().to_rfc3339();
        // 살아 있는 pid(이 테스트 프로세스) + 신선한 하트비트 = 정상 소유자.
        let holder = std::process::id();
        write_synthetic_lock(&path, holder, &fresh);

        // 양보 정책은 종전대로 물러난다.
        match LockGuard::acquire(&path).await.unwrap() {
            LockAcquisition::Held { by_pid, .. } => assert_eq!(by_pid, holder),
            other => panic!("expected Held under Polite, got {other:?}"),
        }

        // 가져오기 정책은 파일을 우리 것으로 다시 쓴다.
        let acq = LockGuard::acquire_with(&path, AcquirePolicy::TakeOver, Arc::new(Notify::new()))
            .await
            .unwrap();
        match acq {
            LockAcquisition::TakenOver {
                guard,
                previous_pid,
                ..
            } => {
                assert_eq!(previous_pid, holder);
                assert_eq!(read_lock_pid(&path), Some(std::process::id()));
                guard.release().await.unwrap();
            }
            other => panic!("expected TakenOver, got {other:?}"),
        }
    }

    /// 인계당한 쪽은 하트비트의 소유권 확인에서 그 사실을 알아야 한다 —
    /// 모르면 두 인스턴스가 같은 프로젝트를 계속 함께 감시한다.
    #[test]
    fn heartbeat_reports_lost_ownership_when_another_pid_holds_the_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        write_synthetic_lock(&path, 1, &chrono::Utc::now().to_rfc3339());

        // pid 1 의 락인데 우리 pid 로 물어본다 = 인계당한 상황.
        assert_eq!(
            heartbeat_pulse(&path, std::process::id(), false).unwrap(),
            Ownership::Lost
        );
        // 우리 pid 로 적혀 있으면 계속 우리 것.
        write_synthetic_lock(&path, std::process::id(), &chrono::Utc::now().to_rfc3339());
        assert_eq!(
            heartbeat_pulse(&path, std::process::id(), false).unwrap(),
            Ownership::Held
        );
    }

    /// 파일이 없거나 깨져 있으면 **인계로 보지 않는다** — 그렇게 읽으면
    /// 멀쩡한 소유자가 일시적인 읽기 실패에 스스로 물러난다.
    #[test]
    fn heartbeat_does_not_cry_eviction_on_a_missing_or_broken_file() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope.lock");
        assert_eq!(
            heartbeat_pulse(&missing, std::process::id(), false).unwrap(),
            Ownership::Held
        );

        let broken = dir.path().join("broken.lock");
        std::fs::write(&broken, b"{ not json").unwrap();
        assert_eq!(
            heartbeat_pulse(&broken, std::process::id(), false).unwrap(),
            Ownership::Held
        );
    }

    /// 인계당한 가드는 **락 파일을 지우지 않는다**. 지우면 지금 살아 있는
    /// 소유자의 락이 사라져 두 인스턴스가 동시에 주인이 된다.
    #[tokio::test]
    async fn a_guard_that_lost_the_lock_never_deletes_the_new_owners_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");

        let guard = match LockGuard::acquire(&path).await.unwrap() {
            LockAcquisition::Acquired(g) => g,
            other => panic!("expected Acquired, got {other:?}"),
        };

        // 다른 인스턴스가 가져갔다 (파일이 남의 pid 로 바뀐다).
        write_synthetic_lock(&path, 4_999_999, &chrono::Utc::now().to_rfc3339());

        // 우리 가드를 놓아도 남의 락은 그대로 남아야 한다.
        guard.release().await.unwrap();
        assert_eq!(
            read_lock_pid(&path),
            Some(4_999_999),
            "인계당한 가드가 남의 락 파일을 지웠다"
        );
    }

    /// Case 3 — stale lock (heartbeat older than threshold): recover.
    #[tokio::test]
    async fn acquire_recovered_when_stale() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let stale = (chrono::Utc::now() - chrono::Duration::seconds(STALE_THRESHOLD_SECS + 60))
            .to_rfc3339();
        write_synthetic_lock(&path, 1, &stale);

        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Recovered { info, guard } => {
                assert_eq!(info.previous_pid, 1);
                assert!(info.heartbeat_age_seconds > STALE_THRESHOLD_SECS);
                guard.release().await.unwrap();
            }
            other => panic!("expected Recovered, got {:?}", other),
        }
    }

    /// Case 4 — heartbeat_pulse updates the `heartbeat_at` field while keeping
    /// pid + started_at intact.
    #[tokio::test]
    async fn heartbeat_pulse_updates_timestamp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");

        // Acquire and immediately read the on-disk state.
        let acq = LockGuard::acquire(&path).await.unwrap();
        let guard = match acq {
            LockAcquisition::Acquired(g) => g,
            other => panic!("expected Acquired, got {:?}", other),
        };
        let first: LockFile =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        // Force a pulse rather than wait the full 30s interval.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        heartbeat_pulse(&path, std::process::id(), true).unwrap();

        let second: LockFile =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(first.pid, second.pid);
        assert_eq!(first.started_at, second.started_at);
        assert_ne!(
            first.heartbeat_at, second.heartbeat_at,
            "heartbeat_at must advance"
        );

        guard.release().await.unwrap();
    }
}

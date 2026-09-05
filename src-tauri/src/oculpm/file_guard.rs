//! 짧은 **크로스프로세스** 문지기 — 원자적 파일 생성이 곧 락이다.
//!
//! `.oculpm/` 를 고치는 주체는 한 프로세스가 아니다. 앱, `oculpm` CLI 어댑터,
//! 그리고 에이전트가 띄운 MCP 서버가 **각각 다른 프로세스**로 같은 트리를
//! 만진다. 그래서 `OculpmManager::plan_write_lock` 같은 인프로세스 뮤텍스는
//! 앱 안에서만 유효하고, 병렬 세션 사고(같은 플랜을 동시에 고쳐 한쪽 변경이
//! 사라진 그 사고)의 실제 현장인 MCP↔MCP·MCP↔CLI 조합에는 아무 힘이 없다.
//!
//! 관용구는 새로 만들지 않았다. [`a2a::leases`](crate::oculpm::a2a::leases) 가
//! 확인-후-쓰기 구간을 지키려고 이미 쓰던 것 — `OpenOptions::create_new` 는
//! 파일이 이미 있으면 실패하고, 그 판정은 OS 가 원자적으로 한다 — 을 여기로
//! **끌어올려** 두 자리(임대 문지기·플랜 CAS)가 같은 구현을 쓰게 했다.
//!
//! ## 죽은 프로세스가 남긴 락
//!
//! 이 문지기가 지키는 구간은 파일 몇 개를 읽고 하나를 쓰는 것뿐이라 초 단위다.
//! 그보다 오래된 락 파일은 주인이 죽으면서 놓고 간 것으로 본다 — 지우고 다시
//! `create_new` 로 붙는다. **지우기가 아니라 그 뒤의 `create_new` 가 원자적
//! 탈취**다: 둘이 동시에 걷어내도 새로 만들기에 성공하는 쪽은 하나뿐이다.
//!
//! PID 로 생사를 묻지 않는 이유는 [`lock`](crate::oculpm::lock) 과 정반대다.
//! 저쪽은 몇 시간 살아 있는 소유권이라 판정이 값어치를 하지만, 이쪽은 수명이
//! 초 단위라 "오래됐다" 만으로 충분하고 PID 재사용이라는 오판 경로가 없다.
//!
//! ## 못 잡으면 오류다
//!
//! 문지기를 못 잡았는데 그냥 진행하면 락이 없는 것보다 나쁘다 — 보호받는다고
//! 믿으면서 보호받지 못한다. [`FileGuard::acquire`] 는 조용한 성공을 만들지
//! 않는다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};

/// 문지기를 잡지 못했다.
#[derive(Debug)]
pub enum GuardError {
    /// 남이 쥐고 있다 — 아직 살아 있는 것으로 본다 (기다려도 안 놓았다).
    Busy { path: PathBuf, waited_ms: u64 },
    /// 락 파일을 만들 수도 지울 수도 없었다 (권한·디스크).
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl std::fmt::Display for GuardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { path, waited_ms } => write!(
                f,
                "다른 프로세스가 {} 를 쥐고 있습니다 ({waited_ms}ms 기다림) — 잠시 뒤 다시 시도하세요",
                path.display()
            ),
            Self::Io { path, source } => {
                write!(f, "락 파일 {} 을 다룰 수 없습니다: {source}", path.display())
            }
        }
    }
}

/// 어떻게 기다릴 것인가.
#[derive(Debug, Clone, Copy)]
pub struct GuardPolicy {
    /// 이보다 오래된 락 파일은 죽은 프로세스가 남긴 것으로 보고 걷어낸다.
    pub stale_after_seconds: i64,
    /// 남이 쥐고 있을 때 최대 이만큼 기다린다 (0 = 즉시 포기).
    pub wait_ms: u64,
    /// 기다리는 동안 다시 보는 주기.
    pub poll_ms: u64,
}

impl GuardPolicy {
    /// 기다리지 않는다 — 부딪히면 곧바로 호출자에게 되돌린다.
    ///
    /// 에이전트가 직접 재시도를 판단해야 하는 자리(임대 신청)에서 쓴다.
    pub const IMMEDIATE: Self = Self {
        stale_after_seconds: 10,
        wait_ms: 0,
        poll_ms: 0,
    };

    /// 잠깐 기다렸다 포기한다.
    ///
    /// 임계구간이 수 밀리초인데 부딪혔다는 이유만으로 실패를 돌려주면, 정상
    /// 동시성이 충돌 오류로 둔갑해 호출자가 의미 없는 재시도를 배운다.
    pub const fn waiting(wait_ms: u64) -> Self {
        Self {
            stale_after_seconds: 10,
            wait_ms,
            poll_ms: 20,
        }
    }
}

/// 쥐고 있는 동안 살아 있는 핸들. 드롭하면 풀린다.
#[derive(Debug)]
pub struct FileGuard {
    path: PathBuf,
}

impl FileGuard {
    /// `path` 를 원자적으로 만들어 문지기를 잡는다.
    ///
    /// `now` 를 인자로 받는 이유는 오래된 락 판정을 테스트가 시간을 앞당겨
    /// 검증할 수 있게 하기 위해서다 (`leases` 가 쓰던 방식 그대로). 기다리는
    /// 동안 이 값은 고정이므로, 대기 중에 **막 오래되기 시작한** 락은 다음
    /// 호출에서 걷힌다 — 대기창(밀리초)이 노후 문턱(초)보다 훨씬 짧아 실무상
    /// 차이가 없다.
    pub fn acquire(
        path: &Path,
        now: DateTime<Utc>,
        policy: GuardPolicy,
    ) -> Result<Self, GuardError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| GuardError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let mut waited_ms: u64 = 0;
        // 오래된 락 걷어내기는 **한 번만** 한다. 매 순회마다 하면 정상적으로
        // 오래 쥔 주인을 계속 밀어내는 경로가 열린다.
        let mut reclaimed = false;
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
            {
                Ok(mut file) => {
                    // 진단용 흔적 — 누가 언제 잡았는지. 쓰기에 실패해도 락
                    // 자체(파일의 존재)는 이미 유효하므로 무시한다.
                    use std::io::Write;
                    let _ = writeln!(
                        file,
                        r#"{{"pid":{},"at":"{}"}}"#,
                        std::process::id(),
                        now.to_rfc3339()
                    );
                    return Ok(Self {
                        path: path.to_path_buf(),
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if !reclaimed && is_stale(path, now, policy.stale_after_seconds) {
                        reclaimed = true;
                        let _ = std::fs::remove_file(path);
                        continue;
                    }
                    if waited_ms >= policy.wait_ms {
                        return Err(GuardError::Busy {
                            path: path.to_path_buf(),
                            waited_ms,
                        });
                    }
                    let step = policy.poll_ms.max(1).min(policy.wait_ms - waited_ms);
                    std::thread::sleep(std::time::Duration::from_millis(step));
                    waited_ms += step;
                }
                Err(source) => {
                    return Err(GuardError::Io {
                        path: path.to_path_buf(),
                        source,
                    })
                }
            }
        }
    }
}

impl Drop for FileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// 이 락 파일이 걷어낼 만큼 오래됐는가.
///
/// 읽을 수 없거나 시각이 미래면 **오래되지 않았다**고 답한다 — 판정할 수 없는
/// 주인의 자리는 뺏지 않는다 (`a2a` 의 생사 판정과 같은 원칙).
fn is_stale(path: &Path, now: DateTime<Utc>, stale_after_seconds: i64) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| now - DateTime::<Utc>::from(t) > Duration::seconds(stale_after_seconds))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_holder_is_refused_and_the_first_release_frees_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/dir/.thing.lock");
        let now = Utc::now();

        let first = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();
        assert!(path.exists(), "락 파일이 만들어져야 한다");
        let err = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap_err();
        assert!(matches!(err, GuardError::Busy { .. }), "{err:?}");

        drop(first);
        assert!(!path.exists(), "드롭하면 풀려야 한다");
        FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();
    }

    /// 죽은 프로세스가 남긴 락이 영원히 길을 막지 않는다.
    #[test]
    fn a_stale_lock_is_reclaimed_after_its_age() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let now = Utc::now();
        std::fs::write(&path, b"").unwrap();

        assert!(FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).is_err());
        let later = now + Duration::seconds(GuardPolicy::IMMEDIATE.stale_after_seconds + 1);
        FileGuard::acquire(&path, later, GuardPolicy::IMMEDIATE).unwrap();
    }

    /// 기다림은 **유한**하다 — 못 잡으면 조용한 성공이 아니라 오류다.
    #[test]
    fn waiting_gives_up_instead_of_pretending_it_won() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let now = Utc::now();
        let _held = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();

        let started = std::time::Instant::now();
        let err = FileGuard::acquire(&path, now, GuardPolicy::waiting(60)).unwrap_err();
        assert!(matches!(err, GuardError::Busy { .. }), "{err:?}");
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(50),
            "기다리긴 해야 한다"
        );
    }

    /// 스레드 여럿이 동시에 달려들어도 한 번에 하나만 안에 들어간다.
    #[test]
    fn only_one_thread_is_inside_at_a_time() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let dir = tempfile::tempdir().unwrap();
        let path = Arc::new(dir.path().join(".thing.lock"));
        let inside = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let now = Utc::now();

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let path = path.clone();
                let inside = inside.clone();
                let peak = peak.clone();
                std::thread::spawn(move || {
                    let _g = FileGuard::acquire(&path, now, GuardPolicy::waiting(3_000)).unwrap();
                    let n = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(n, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    inside.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 1, "임계구역에 둘이 들어갔다");
    }
}

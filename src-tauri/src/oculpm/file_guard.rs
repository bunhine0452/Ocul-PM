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
//! 그보다 오래된 락 파일은 주인이 죽으면서 놓고 간 것으로 본다 — 걷어내고 다시
//! `create_new` 로 붙는다. **걷어내기가 아니라 그 뒤의 `create_new` 가 원자적
//! 탈취**다: 둘이 동시에 걷어내도 새로 만들기에 성공하는 쪽은 하나뿐이다.
//!
//! 걷어내기는 `remove_file` 이 아니라 **옮긴 뒤 확인**이다 ([`reclaim`]). "오래됐다"
//! 판정과 삭제 사이에 남이 먼저 걷어내고 새 락을 만들었을 수 있는데, 경로로
//! 지우면 그 **새 락**이 지워진다. 나만 아는 이름으로 먼저 옮기면 그 파일은
//! 아무도 손대지 않는 내 것이 되고, 거기서 다시 잰 나이가 진짜다 — 옮기고 보니
//! 살아 있는 락이면 제자리로 돌려놓는다.
//!
//! PID 로 생사를 묻지 않는 이유는 [`lock`](crate::oculpm::lock) 과 정반대다.
//! 저쪽은 몇 시간 살아 있는 소유권이라 판정이 값어치를 하지만, 이쪽은 수명이
//! 초 단위라 "오래됐다" 만으로 충분하고 PID 재사용이라는 오판 경로가 없다.
//!
//! ## 락은 경로가 아니라 nonce 가 소유한다
//!
//! 걷어내기는 주인이 죽었다는 **추정**이다. 실제로는 살아 있는데 느렸을 뿐인
//! 주인(절전·디버거·느린 디스크)이 나중에 돌아와 놓으면, 경로로 지우는 `Drop` 은
//! 그 사이 자리를 차지한 새 주인의 락을 지운다 — 그러면 셋째가 들어와 둘이
//! 임계구역에 겹친다. 그래서 잡을 때 만든 nonce 를 락 파일에 적고, 놓을 때는
//! **파일 안의 nonce 가 내 것일 때만** 지운다. 남의 것이면 두고 가고 경고만
//! 남긴다 — 그 락은 새 주인이 놓거나, 그마저 죽으면 다음 걷어내기가 치운다.
//!
//! ## 못 잡으면 오류다
//!
//! 문지기를 못 잡았는데 그냥 진행하면 락이 없는 것보다 나쁘다 — 보호받는다고
//! 믿으면서 보호받지 못한다. [`FileGuard::acquire`] 는 조용한 성공을 만들지
//! 않는다.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

const LOG_TARGET: &str = "oculpm::file_guard";

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

/// 락 파일의 한 줄 — 누가 언제 잡았고, 어느 핸들의 것인지.
///
/// `pid`·`at` 은 진단용 흔적이고 `nonce` 만 동작에 쓰인다 (모듈 문서의
/// "nonce 가 소유한다"). 이 JSON 을 읽는 곳은 이 모듈뿐이다.
#[derive(Debug, Serialize, Deserialize)]
struct Stamp {
    pid: u32,
    at: String,
    nonce: String,
}

/// 쥐고 있는 동안 살아 있는 핸들. 드롭하면 풀린다.
#[derive(Debug)]
pub struct FileGuard {
    path: PathBuf,
    /// 잡을 때 락 파일에 적은 값. 놓을 때 파일 안의 값과 맞을 때만 지운다.
    nonce: String,
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
                    let nonce = uuid::Uuid::new_v4().simple().to_string();
                    let stamp = Stamp {
                        pid: std::process::id(),
                        at: now.to_rfc3339(),
                        nonce: nonce.clone(),
                    };
                    // nonce 는 흔적이 아니라 소유 증명이다 — 못 적으면 `Drop` 이
                    // 자기 락을 못 알아보고 두고 가서, 노후 문턱만큼 모두를 막는다.
                    // 방금 만든 파일이라 남이 걷어냈을 리 없으므로(걷어내기는 문턱을
                    // 넘긴 파일만) 지우고 오류로 돌린다.
                    if let Err(source) = write_stamp(&mut file, &stamp) {
                        drop(file);
                        let _ = std::fs::remove_file(path);
                        return Err(GuardError::Io {
                            path: path.to_path_buf(),
                            source,
                        });
                    }
                    return Ok(Self {
                        path: path.to_path_buf(),
                        nonce,
                    });
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    if !reclaimed && is_stale(path, now, policy.stale_after_seconds) {
                        reclaimed = true;
                        if reclaim(path, now, policy.stale_after_seconds) {
                            continue;
                        }
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
    /// 놓는다 — **내 nonce 가 든 파일일 때만** 지운다.
    ///
    /// 읽기와 지우기 사이에 남이 걷어내고 새로 만들 창은 남아 있다. 그러려면
    /// 이 구간이 노후 문턱을 이미 넘겼고 그 위에 걷어내기의 네 호출이 내 두
    /// 호출 사이에 끼어야 한다 — POSIX 에 "같은 inode 일 때만 unlink" 가 없어
    /// 닫을 수 없는 창이고, 이전의 무조건 삭제가 열어 두던 것보다 훨씬 좁다.
    fn drop(&mut self) {
        match read_nonce(&self.path) {
            Ok(Some(nonce)) if nonce == self.nonce => {
                let _ = std::fs::remove_file(&self.path);
            }
            Ok(_) => tracing::warn!(
                target: LOG_TARGET,
                path = %self.path.display(),
                "락이 걷혔다 — 이 구간이 노후 문턱보다 오래 걸렸다. 새 주인의 락은 두고 간다"
            ),
            Err(e) if e.kind() == ErrorKind::NotFound => tracing::debug!(
                target: LOG_TARGET,
                path = %self.path.display(),
                "락 파일이 이미 없다 — 걷힌 뒤 새 주인도 놓았다"
            ),
            Err(e) => tracing::warn!(
                target: LOG_TARGET,
                path = %self.path.display(),
                error = %e,
                "락 파일을 읽을 수 없어 두고 간다"
            ),
        }
    }
}

fn write_stamp(file: &mut std::fs::File, stamp: &Stamp) -> std::io::Result<()> {
    use std::io::Write;
    serde_json::to_writer(&mut *file, stamp)?;
    file.write_all(b"\n")
}

/// 락 파일에 적힌 nonce. 파일은 있는데 이 모듈이 쓴 꼴이 아니면 `None` —
/// 남의 것이라는 뜻이지 오류가 아니다.
fn read_nonce(path: &Path) -> std::io::Result<Option<String>> {
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str::<Stamp>(raw.trim())
        .ok()
        .map(|s| s.nonce))
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

/// 오래돼 보이는 락을 걷어낸다. `true` 면 자리가 비었으니 `create_new` 를 다시
/// 시도할 만하고, `false` 면 살아 있는 락이었다 — 기다리는 쪽으로 돌아간다.
///
/// `remove_file(path)` 로 지우지 않는 이유: [`is_stale`] 판정과 삭제 사이에 남이
/// 먼저 걷어내고 새 락을 만들었을 수 있고, 경로로 지우면 그 새 락이 지워진다.
/// 대신 나만 아는 이름으로 **먼저 옮긴다**. 옮기기는 원자적이고, 옮긴 파일은
/// 아무도 찾지 못하므로 거기서 다시 잰 나이가 진짜다 (`rename` 은 mtime 을
/// 보존한다).
fn reclaim(path: &Path, now: DateTime<Utc>, stale_after_seconds: i64) -> bool {
    let staged = staged_path(path);
    match std::fs::rename(path, &staged) {
        Ok(()) => {}
        // 남이 먼저 걷었거나 주인이 방금 놓았다 — 어느 쪽이든 자리는 비었다.
        Err(e) if e.kind() == ErrorKind::NotFound => return true,
        Err(e) => {
            tracing::debug!(
                target: LOG_TARGET,
                path = %path.display(),
                error = %e,
                "오래된 락을 옮기지 못했다 — 걷지 않고 기다린다"
            );
            return false;
        }
    }
    if is_stale(&staged, now, stale_after_seconds) {
        let _ = std::fs::remove_file(&staged);
        return true;
    }
    // 판정과 옮기기 사이에 남이 먼저 걷어내고 새로 만든 **살아 있는 락**을
    // 옮겨 왔다. 제자리로 돌려놓고 그 주인을 기다린다.
    put_back(&staged, path);
    false
}

/// 옮겨 온 살아 있는 락을 제자리로 돌려놓는다.
///
/// `rename` 으로 돌려놓지 않는다 — 유닉스의 rename 은 목적지가 있으면 **덮어쓴다**.
/// 옮긴 뒤 돌려놓기 전까지 `path` 는 비어 있고, 그 찰나에 누군가 `create_new` 로
/// 새 락을 만들었을 수 있다. 그 위에 덮어쓰면 새 주인의 락이 사라진다. 하드링크는
/// 목적지가 있으면 `AlreadyExists` 로 실패하므로 "없을 때만 놓기" 가 된다.
///
/// 이미 새 락이 있으면 옮겨 온 사본을 지운다. 그 사본의 주인은 놓을 때 `path` 에서
/// 남의 nonce 를 보고 두고 가므로 새 주인의 락은 무사하다. 두 주인이 그 찰나에
/// 겹친 사실은 되돌릴 수 없다 — 창은 rename 과 hard_link 사이 마이크로초이고,
/// 종전의 `remove_file` 경로가 열어 두던 창보다 좁다.
fn put_back(staged: &Path, path: &Path) {
    match std::fs::hard_link(staged, path) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::AlreadyExists => tracing::warn!(
            target: LOG_TARGET,
            path = %path.display(),
            "옮겨 온 락을 돌려놓는 사이 새 락이 생겼다 — 사본을 지운다"
        ),
        // 하드링크를 못 만드는 파일시스템(exFAT 등) — rename 으로 돌려놓는다.
        // 덮어쓸 수 있는 창이 있지만 결과는 위 문단의 겹침과 같다.
        Err(_) => {
            if std::fs::rename(staged, path).is_ok() {
                return;
            }
        }
    }
    let _ = std::fs::remove_file(staged);
}

/// 걷어내기 중인 락의 임시 이름 — 점으로 시작하는 원래 이름 뒤에 붙으므로 문서
/// 스캔에도, 옆의 `*.json` 만 읽는 임대 목록에도 걸리지 않는다.
fn staged_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_default();
    name.push(format!(".stale.{}", uuid::Uuid::new_v4().simple()));
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 걷어내기가 남긴 임시 파일 — 정상 경로에서는 하나도 남으면 안 된다.
    fn stale_leftovers(dir: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().contains(".stale."))
            .collect()
    }

    fn foreign_stamp(nonce: &str) -> String {
        format!(r#"{{"pid":1,"at":"2000-01-01T00:00:00+00:00","nonce":"{nonce}"}}"#)
    }

    #[test]
    fn a_second_holder_is_refused_and_the_first_release_frees_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/dir/.thing.lock");
        let now = Utc::now();

        let first = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();
        assert!(path.exists(), "락 파일이 만들어져야 한다");
        assert_eq!(
            read_nonce(&path).unwrap().as_deref(),
            Some(first.nonce.as_str()),
            "락 파일에 내 nonce 가 적혀야 한다"
        );
        let err = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap_err();
        assert!(matches!(err, GuardError::Busy { .. }), "{err:?}");

        drop(first);
        assert!(!path.exists(), "드롭하면 풀려야 한다");
        FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();
    }

    /// 죽은 프로세스가 남긴 락이 영원히 길을 막지 않는다 — 그리고 걷어내기가
    /// 임시 파일을 흘리지 않는다.
    #[test]
    fn a_stale_lock_is_reclaimed_after_its_age() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let now = Utc::now();
        std::fs::write(&path, b"").unwrap();

        assert!(FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).is_err());
        let later = now + Duration::seconds(GuardPolicy::IMMEDIATE.stale_after_seconds + 1);
        let guard = FileGuard::acquire(&path, later, GuardPolicy::IMMEDIATE).unwrap();
        assert!(
            stale_leftovers(dir.path()).is_empty(),
            "걷어낸 사본이 남았다"
        );
        drop(guard);
        assert!(!path.exists(), "걷어내고 잡은 락도 놓으면 비워야 한다");
    }

    /// 걷힌 원주인이 돌아와 놓아도 **새 주인의 락은 지우지 않는다** — 경로가
    /// 아니라 nonce 가 소유한다.
    #[test]
    fn drop_does_not_remove_a_lock_it_no_longer_owns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let first = FileGuard::acquire(&path, Utc::now(), GuardPolicy::IMMEDIATE).unwrap();

        // 걷어내기를 흉내낸다: 같은 경로에 다른 nonce 의 락이 들어섰다.
        std::fs::write(&path, foreign_stamp("someone-else")).unwrap();
        drop(first);

        assert!(path.exists(), "남의 락을 지웠다");
        assert_eq!(
            read_nonce(&path).unwrap().as_deref(),
            Some("someone-else"),
            "남의 락 내용이 바뀌었다"
        );
    }

    /// 같은 사고를 진짜 두 핸들로: A 가 문턱을 넘겨 느렸고 B 가 걷어내 잡았다.
    /// A 가 놓아도 B 의 자리는 그대로라 C 는 못 들어온다.
    #[test]
    fn a_slow_holder_released_after_reclaim_does_not_open_the_door_for_a_third() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let now = Utc::now();
        // B 의 시계를 문턱 너머로 앞당기면 A 의 락(mtime = 실제 지금)이 오래돼
        // 보인다 — A 가 문턱보다 오래 쥐고 있는 상황과 같다.
        let later = now + Duration::seconds(GuardPolicy::IMMEDIATE.stale_after_seconds + 1);

        let a = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE).unwrap();
        let b = FileGuard::acquire(&path, later, GuardPolicy::IMMEDIATE).unwrap();
        assert!(stale_leftovers(dir.path()).is_empty());

        drop(a);
        assert!(path.exists(), "느렸던 A 가 B 의 락을 지웠다");
        // C 는 실제 시계로 본다 — B 의 락(mtime = 지금)은 살아 있으므로 거절.
        let c = FileGuard::acquire(&path, now, GuardPolicy::IMMEDIATE);
        assert!(matches!(c, Err(GuardError::Busy { .. })), "{c:?}");

        drop(b);
        assert!(!path.exists(), "B 가 놓으면 비워야 한다");
    }

    /// 옮기고 보니 살아 있는 락이면 지우지 않고 제자리로 돌려놓는다 — 판정과
    /// 옮기기 사이에 남이 먼저 걷어내고 새로 만든 경우.
    #[test]
    fn reclaim_puts_back_a_lock_that_turned_out_live_after_the_rename() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let now = Utc::now();
        std::fs::write(&path, foreign_stamp("live-owner")).unwrap();

        // 사전 판정은 이미 "오래됐다" 였다고 치고 걷어내기만 부른다.
        assert!(
            !reclaim(&path, now, GuardPolicy::IMMEDIATE.stale_after_seconds),
            "살아 있는 락을 걷어냈다고 답했다"
        );
        assert_eq!(
            read_nonce(&path).unwrap().as_deref(),
            Some("live-owner"),
            "살아 있는 락이 제자리에 없다"
        );
        assert!(stale_leftovers(dir.path()).is_empty(), "옮긴 사본이 남았다");
    }

    /// 돌려놓는 찰나에 새 락이 생겼으면 **그 락을 덮지 않고** 사본을 지운다.
    #[test]
    fn put_back_yields_to_a_lock_created_in_the_gap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        let staged = staged_path(&path);
        std::fs::write(&staged, foreign_stamp("moved-aside")).unwrap();
        std::fs::write(&path, foreign_stamp("newcomer")).unwrap();

        put_back(&staged, &path);

        assert_eq!(
            read_nonce(&path).unwrap().as_deref(),
            Some("newcomer"),
            "새 주인의 락을 덮어썼다"
        );
        assert!(!staged.exists(), "사본이 남았다");
    }

    /// 남이 먼저 걷어냈으면(경로가 비었으면) 자리가 비었다고 답하고 아무것도
    /// 만들지 않는다.
    #[test]
    fn reclaim_of_an_already_vacated_path_just_proceeds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".thing.lock");
        assert!(reclaim(&path, Utc::now(), 10));
        assert!(stale_leftovers(dir.path()).is_empty());
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

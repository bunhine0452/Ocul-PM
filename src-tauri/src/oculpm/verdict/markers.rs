//! 세그먼트 마커 **쓰기** — 셸 훅과 앱이 **같은 자리에 같은 이름**으로 남긴다.
//!
//! [`collect`](super::collect) 가 읽는 그 파일들을 여기서 쓴다. 읽는 쪽과 쓰는
//! 쪽을 한 모듈 쌍으로 묶어 둔 이유는 [`ledger`](super::ledger) 와 같다: 이름이
//! 갈라지면 계약이 문자열 단언으로만 남고, 이 저장소는 그 방식으로 이미 데었다.
//!
//! # 왜 앱도 이 파일을 써야 하는가
//!
//! 앱 안에서 도는 ACP 대화(Claude Code·Codex 패널)에는 셸 훅이 없다. 훅이
//! 없으면 마커도 없고, 마커가 없으면 두 가지가 동시에 무너진다.
//!
//! 1. **자기 판정이 안 선다.** `segment_started_at = None` 이면 판정은 언제부터가
//!    이 대화의 변경인지 모르므로 영원히 [`Undecided`](super::Undecided) 다.
//! 2. **옆 대화가 우리를 못 본다.** 이쪽이 더 나쁘다. 같은 워킹트리에서 도는
//!    Claude Code 대화의 배달 게이트는 "살아 있는 다른 대화"를 이 두 파일로만
//!    센다. ACP 대화가 흔적을 안 남기면 그 대화의 편집이 **CC 대화의 것으로
//!    보이고**, 아무 것도 안 쓴 CC 세션이 붙잡힌다 — 2026-09-05 에 실제로 그런
//!    오탐이 났고, 판정을 고친 지금도 흔적이 없는 편집자가 있으면 그대로 재발한다.
//!
//! 그래서 파일 두 개가 곧 **크로스에이전트 상호 인식**이다. 어느 표면이 썼는지는
//! 아무도 묻지 않는다 — 이름 규칙 하나가 계약이다.
//!
//! # 계약 (셸 훅과 동일)
//!
//! - `.session-start-<대화>` — **create-only.** 재개·compact 로 세션이 다시
//!   시작해도 다시 찍지 않는다. 재터치하면 세션 초반에 쓴 일지가 "마커보다
//!   오래됨"이 되어 기록한 대화에 이의가 나간다.
//! - `.session-live-<대화>` — **매 턴** 다시 찍는다. 마커의 존재만으로는 생사를
//!   못 센다(크래시 잔여가 7일 버틴다).
//! - 종료 시 둘 다 지우고, 7일 지난 잔여를 걷는다.
//! - 모든 실패는 무해하다. 추적되지 않는 프로젝트에서는 아무 것도 하지 않는다.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::collect::{LIVE_MARKER_PREFIX, SEGMENT_MARKER_PREFIX};

/// 대화당 1회 발화 플래그 접두 — `delivery-gate.sh` 가 쓰는 그 이름.
///
/// 앱 안 ACP 대화도 같은 파일을 쓴다. 대화 id 가 서로 다르니 충돌하지 않고,
/// 잔여 청소(7일)와 "이 대화에는 이미 말했다"는 규율이 한 벌로 남는다.
pub const GATE_FLAG_PREFIX: &str = ".delivery-gate-";

/// 잔여 마커·플래그를 걷는 나이 (셸의 `find -mtime +7`).
const STALE_AFTER: Duration = Duration::from_secs(7 * 24 * 3600);

/// 마커가 같은 초에 쓰인 일지에 밀리지 않게 과거로 미는 폭.
///
/// 판정은 `modified_at > started` (엄격 초과)이고 파일시스템에 따라 mtime 이
/// 초 단위다. 백데이팅이 없으면 마커 직후 1초 안에 쓴 일지가 "마커보다 오래됨"
/// 으로 보여 기록한 대화에 이의가 나간다 — 셸 훅이 `touch -t` 로 하는 일과
/// 같다.
const BACKDATE: Duration = Duration::from_secs(2);

pub fn hooks_dir(root: &Path) -> PathBuf {
    root.join(".oculpm").join("hooks")
}

/// 추적 중인 프로젝트인가. 아니면 아무 것도 안 한다 (훅의 첫 줄과 같은 가드).
fn tracked(root: &Path) -> bool {
    root.join(".oculpm").is_dir()
}

fn ensure_dir(root: &Path) -> Option<PathBuf> {
    if !tracked(root) {
        return None;
    }
    let dir = hooks_dir(root);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// 이 대화의 세그먼트를 연다 — 마커(create-only) + 생존 흔적.
///
/// 생존 흔적을 **여기서도** 찍는 이유는 `session-marker.sh` 와 같다: 첫 턴이
/// 끝나기 전에도 옆 대화가 우리를 용의자로 볼 수 있어야, 그쪽이 우리 편집을
/// 자기 것으로 오인하지 않는다.
pub fn open_segment(root: &Path, conversation: &str) {
    let Some(dir) = ensure_dir(root) else { return };
    if conversation.trim().is_empty() {
        return;
    }
    touch(&dir.join(format!("{LIVE_MARKER_PREFIX}{conversation}")));
    let marker = dir.join(format!("{SEGMENT_MARKER_PREFIX}{conversation}"));
    if marker.exists() {
        return;
    }
    touch(&marker);
    backdate(&marker);
}

/// 이 대화가 **지금** 살아 있다. 매 턴 부른다.
pub fn touch_live(root: &Path, conversation: &str) {
    let Some(dir) = ensure_dir(root) else { return };
    if conversation.trim().is_empty() {
        return;
    }
    touch(&dir.join(format!("{LIVE_MARKER_PREFIX}{conversation}")));
}

/// 세그먼트를 닫는다 — 마커·생존 흔적을 지우고 잔여를 걷는다.
///
/// 잔여 청소를 **여기서** 하는 것도 `session-end.sh` 와 같은 이유다: 시작이
/// 아니라 종료에 걸어야 살아 있는 장기 대화의 마커를 다른 대화의 시작이 쓸어가는
/// 경합이 줄어든다.
pub fn close_segment(root: &Path, conversation: &str) {
    let dir = hooks_dir(root);
    if !dir.is_dir() {
        return;
    }
    if !conversation.trim().is_empty() {
        let _ = std::fs::remove_file(dir.join(format!("{SEGMENT_MARKER_PREFIX}{conversation}")));
        let _ = std::fs::remove_file(dir.join(format!("{LIVE_MARKER_PREFIX}{conversation}")));
    }
    prune_stale(&dir, SystemTime::now());
}

/// 이 대화에 아직 이의를 말하지 않았으면 **자리를 잡고** `true`.
///
/// 두 번째부터는 `false` — 게이트는 대화당 한 번만 말한다. 반복하면 잔소리가
/// 되고, 잔소리는 무시된다(ponytail 의 delivery-gate 가 남긴 교훈).
pub fn claim_gate_once(root: &Path, conversation: &str) -> bool {
    let Some(dir) = ensure_dir(root) else {
        return false;
    };
    if conversation.trim().is_empty() {
        return false;
    }
    let flag = dir.join(format!("{GATE_FLAG_PREFIX}{conversation}"));
    if flag.exists() {
        return false;
    }
    // `create_new` — 같은 대화에 두 경로가 동시에 들어와도 하나만 이긴다.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&flag)
        .is_ok()
}

/// 7일 지난 마커·생존 흔적·발화 플래그를 걷는다.
pub fn prune_stale(dir: &Path, now: SystemTime) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if ![SEGMENT_MARKER_PREFIX, LIVE_MARKER_PREFIX, GATE_FLAG_PREFIX]
            .iter()
            .any(|p| name.starts_with(p))
        {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn touch(path: &Path) {
    // 내용은 없다 — 이 파일들은 mtime 이 전부다. 이미 있으면 mtime 만 갱신한다.
    let _ = std::fs::write(path, b"");
}

fn backdate(path: &Path) {
    let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) else {
        return;
    };
    let Some(when) = SystemTime::now().checked_sub(BACKDATE) else {
        return;
    };
    // 실패해도 무해 — 같은 초 경계의 드문 오탐을 감수할 뿐이고, 마커 자체는
    // 유효하다 (셸의 `touch -t` 폴백과 같은 태도).
    let _ = file.set_times(std::fs::FileTimes::new().set_modified(when));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn tracked_root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        dir
    }

    fn mtime(path: &Path) -> SystemTime {
        std::fs::metadata(path).unwrap().modified().unwrap()
    }

    /// 셸 훅이 읽는 **그 이름**이어야 한다. 이름이 갈라지면 두 표면이 서로를
    /// 못 본다 — 이 모듈이 존재하는 이유 전부가 그 한 줄이다.
    #[test]
    fn an_opened_segment_writes_the_two_files_the_hooks_write() {
        let dir = tracked_root();
        open_segment(dir.path(), "acp-20260905-abcd1234");

        let hooks = hooks_dir(dir.path());
        assert!(hooks.join(".session-start-acp-20260905-abcd1234").is_file());
        assert!(hooks.join(".session-live-acp-20260905-abcd1234").is_file());
    }

    /// 마커는 **create-only** — 재개가 마커를 앞으로 당기면 세션 초반에 쓴
    /// 일지가 "마커보다 오래됨"이 되어 기록한 대화에 이의가 나간다.
    #[test]
    fn reopening_a_segment_does_not_move_the_marker_forward() {
        let dir = tracked_root();
        open_segment(dir.path(), "c1");
        let marker = hooks_dir(dir.path()).join(".session-start-c1");
        let first = mtime(&marker);

        std::thread::sleep(Duration::from_millis(1100));
        open_segment(dir.path(), "c1");
        assert_eq!(mtime(&marker), first, "마커가 앞으로 당겨졌다");
    }

    /// 반면 생존 흔적은 **매번** 갱신된다 — 그래야 옆 대화가 생사를 센다.
    #[test]
    fn the_live_trace_is_refreshed_every_time() {
        let dir = tracked_root();
        open_segment(dir.path(), "c1");
        let live = hooks_dir(dir.path()).join(".session-live-c1");
        let first = mtime(&live);

        std::thread::sleep(Duration::from_millis(1100));
        touch_live(dir.path(), "c1");
        assert!(mtime(&live) > first, "생존 흔적이 안 갱신됐다");
    }

    /// 마커는 과거로 밀려 있다 — 같은 초에 쓴 일지가 밀리지 않게.
    #[test]
    fn the_marker_is_backdated_so_a_same_second_journal_still_counts() {
        let dir = tracked_root();
        open_segment(dir.path(), "c1");
        let marker = hooks_dir(dir.path()).join(".session-start-c1");
        let age = SystemTime::now().duration_since(mtime(&marker)).unwrap();
        assert!(age >= Duration::from_secs(1), "백데이팅이 안 됐다: {age:?}");
    }

    #[test]
    fn closing_removes_both_files() {
        let dir = tracked_root();
        open_segment(dir.path(), "c1");
        close_segment(dir.path(), "c1");

        let hooks = hooks_dir(dir.path());
        assert!(!hooks.join(".session-start-c1").exists());
        assert!(!hooks.join(".session-live-c1").exists());
    }

    /// 추적되지 않는 프로젝트에서는 아무 것도 만들지 않는다 — 우리 폴더가 아닌
    /// 곳에 파일을 흘리지 않는다는 훅의 첫 줄과 같은 계약.
    #[test]
    fn an_untracked_project_gets_nothing() {
        let dir = tempfile::tempdir().unwrap();
        open_segment(dir.path(), "c1");
        touch_live(dir.path(), "c1");
        assert!(!hooks_dir(dir.path()).exists());
        assert!(!claim_gate_once(dir.path(), "c1"));
    }

    /// 대화당 1회 — 두 번째 요청은 자리를 못 잡는다.
    #[test]
    fn the_gate_flag_is_claimed_exactly_once_per_conversation() {
        let dir = tracked_root();
        assert!(claim_gate_once(dir.path(), "c1"));
        assert!(!claim_gate_once(dir.path(), "c1"));
        assert!(claim_gate_once(dir.path(), "c2"), "옆 대화는 막지 않는다");
    }

    fn age_by(path: &Path, days: u64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        let when = SystemTime::now() - Duration::from_secs(days * 24 * 3600);
        file.set_times(std::fs::FileTimes::new().set_modified(when))
            .unwrap();
    }

    /// 잔여는 나이로 걷는다. **살아 있는 것은 남는다** — 여기서 실수하면
    /// 게이트가 도는 대화의 마커를 지워 스스로 눈을 감는다.
    #[test]
    fn stale_leftovers_are_swept_but_live_ones_survive() {
        let dir = tracked_root();
        open_segment(dir.path(), "fresh");
        let hooks = hooks_dir(dir.path());
        for name in [
            ".session-start-old",
            ".session-live-old",
            ".delivery-gate-old",
            "journal-missing.jsonl",
        ] {
            std::fs::write(hooks.join(name), b"x\n").unwrap();
            age_by(&hooks.join(name), 8);
        }

        prune_stale(&hooks, SystemTime::now());
        for name in [
            ".session-start-old",
            ".session-live-old",
            ".delivery-gate-old",
        ] {
            assert!(!hooks.join(name).exists(), "{name} 이 안 걷혔다");
        }
        assert!(
            hooks.join(".session-start-fresh").is_file(),
            "살아 있는 대화의 마커를 지웠다 — 게이트가 스스로 눈을 감는다"
        );
        assert!(
            hooks.join("journal-missing.jsonl").is_file(),
            "우리 접두가 아닌 파일은 건드리지 않는다"
        );
    }
}

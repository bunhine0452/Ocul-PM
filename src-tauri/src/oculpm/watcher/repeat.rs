//! 윈도우의 "같은 쓰기를 두 번 알림" 걷기 (크로스플랫폼 L-FS · #fs-watch).
//!
//! `ReadDirectoryChangesW` 는 새 파일 하나 쓰기를 `FILE_ACTION_ADDED` +
//! `FILE_ACTION_MODIFIED` 로, 한 파일의 연속 쓰기를 `MODIFIED` 여러 번으로 알린다.
//! notify 는 `MODIFIED` 를 `Modify(Any)` 로 옮기는데 — 내용 쓰기인지 속성 변경인지
//! 모르므로 — 디바운서의 "생성 직후의 `Data`·`Metadata` 수정은 버린다" 규칙에 걸리지
//! 않는다. 그래서 macOS·Linux 에서 ndjson 한 줄인 "새 파일 하나" 가 윈도우에서는
//! Create + Update 두 줄이 되고, 연속 쓰기가 디바운스 창을 걸치면 더 는다.
//!
//! 여기서는 **내용이 같은 재보고**만 걷는다: 방금 기록한 해시와 같은 해시의 Update 가
//! 창 안에 다시 오면 새 변경이 아니다. 내용이 달라졌으면(해시가 다르면) 그대로
//! 기록한다 — 연속 쓰기의 마지막 모양은 잃지 않는다. 해시가 없으면(큰 파일·지움)
//! 판정 근거가 없으니 걷지 않는다.
//!
//! 판정 자체는 OS 와 무관한 순수 논리라 어느 러너에서나 테스트한다. **켜는 것은
//! 윈도우뿐이다** ([`ENABLED`]) — macOS·Linux 는 디바운서가 이미 한 줄로 접으므로
//! 동작을 바꾸지 않는다 (설계 D3).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::oculpm::spec::FileOp;

/// 워처가 이 필터를 쓰는가 — 윈도우만.
pub(super) const ENABLED: bool = cfg!(windows);

/// 이만큼 지난 기록은 잊는다. 디바운스 창(최대 `balanced` 1초)을 걸친 재보고를
/// 덮을 만큼만 — 그 뒤에 같은 내용으로 다시 쓰는 것은 사람이 한 일일 수 있다.
pub(super) const WINDOW: Duration = Duration::from_secs(3);

/// 기억이 이만큼 넘으면 창 밖 기록을 치운다 (브랜치 전환 같은 폭풍 대비).
const PRUNE_AT: usize = 1024;

#[derive(Default)]
pub(super) struct RepeatFilter {
    /// 저장 모양 상대 경로 → (마지막으로 기록한 해시, 그 시각).
    recent: Mutex<HashMap<String, (String, Instant)>>,
}

impl RepeatFilter {
    /// 이 변경이 **방금 기록한 내용의 재보고**인가. 아니면 기록해 두고 `false`.
    pub(super) fn is_repeat(
        &self,
        path: &str,
        op: FileOp,
        hash: Option<&str>,
        now: Instant,
    ) -> bool {
        let Ok(mut recent) = self.recent.lock() else {
            return false;
        };
        if recent.len() >= PRUNE_AT {
            recent.retain(|_, (_, at)| now.saturating_duration_since(*at) < WINDOW);
        }
        let Some(hash) = hash else {
            // 지움이거나 해시를 건너뛴 큰 파일 — 다음 판정의 근거도 지운다.
            recent.remove(path);
            return false;
        };
        if op == FileOp::Update {
            if let Some((last, at)) = recent.get_mut(path) {
                if last == hash && now.saturating_duration_since(*at) < WINDOW {
                    *at = now;
                    return true;
                }
            }
        }
        recent.insert(path.to_string(), (hash.to_string(), now));
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 윈도우 모양 그대로: 새 파일 하나 = Create 뒤 같은 내용의 Update(들).
    #[test]
    fn an_update_repeating_the_just_recorded_content_is_a_repeat() {
        let f = RepeatFilter::default();
        let t = Instant::now();
        assert!(!f.is_repeat("hot.rs", FileOp::Create, Some("h1"), t));
        assert!(f.is_repeat(
            "hot.rs",
            FileOp::Update,
            Some("h1"),
            t + Duration::from_millis(50)
        ));
        assert!(f.is_repeat(
            "hot.rs",
            FileOp::Update,
            Some("h1"),
            t + Duration::from_millis(500)
        ));
    }

    /// 내용이 달라졌으면 새 변경이다 — 연속 쓰기의 마지막 모양을 잃지 않는다.
    #[test]
    fn a_different_hash_is_a_new_change() {
        let f = RepeatFilter::default();
        let t = Instant::now();
        assert!(!f.is_repeat("a.rs", FileOp::Create, Some("h1"), t));
        assert!(!f.is_repeat("a.rs", FileOp::Update, Some("h2"), t));
        // 그리고 이제 h2 가 기준이다.
        assert!(f.is_repeat("a.rs", FileOp::Update, Some("h2"), t));
        assert!(!f.is_repeat("a.rs", FileOp::Update, Some("h1"), t));
    }

    #[test]
    fn creates_deletes_and_hashless_changes_are_never_repeats() {
        let f = RepeatFilter::default();
        let t = Instant::now();
        assert!(!f.is_repeat("a.rs", FileOp::Create, Some("h1"), t));
        // 같은 내용으로 다시 만든 것은 Create 라 기록한다.
        assert!(!f.is_repeat("a.rs", FileOp::Create, Some("h1"), t));
        // 지움은 기준도 지운다 — 되살린 뒤의 첫 Update 는 새 변경이다.
        assert!(!f.is_repeat("a.rs", FileOp::Delete, None, t));
        assert!(!f.is_repeat("a.rs", FileOp::Update, Some("h1"), t));
        // 해시가 없는 큰 파일은 판정하지 않는다.
        assert!(!f.is_repeat("big.bin", FileOp::Update, None, t));
        assert!(!f.is_repeat("big.bin", FileOp::Update, None, t));
    }

    /// 창을 넘긴 같은 내용은 사람이 다시 쓴 것일 수 있다 — 기록한다.
    #[test]
    fn the_memory_expires_after_the_window() {
        let f = RepeatFilter::default();
        let t = Instant::now();
        assert!(!f.is_repeat("a.rs", FileOp::Create, Some("h1"), t));
        assert!(!f.is_repeat("a.rs", FileOp::Update, Some("h1"), t + WINDOW));
    }

    #[test]
    fn paths_do_not_share_memory() {
        let f = RepeatFilter::default();
        let t = Instant::now();
        assert!(!f.is_repeat("a.rs", FileOp::Create, Some("h1"), t));
        assert!(!f.is_repeat("b.rs", FileOp::Update, Some("h1"), t));
    }

    /// 켜는 것은 윈도우뿐이다 — macOS·Linux 동작 불변(D3)의 못.
    #[test]
    fn enabled_only_on_windows() {
        assert_eq!(ENABLED, cfg!(windows));
    }
}

//! 반응성 티어 — `[watcher] responsiveness` 의 이름 있는 디바운스 정책 (Phase 2 §2.1).
//!
//! | 티어 | 지연 |
//! |---|---|
//! | `fast` | 200ms |
//! | `balanced` | 1s (**기본**) |
//! | `patient` | 3s |
//! | `relaxed` | 60s |
//! | `deferred` | 5m |
//! | `extended` | 10m |
//!
//! 자동화(정착 타이머)가 4.0 에서 빠진 뒤로 이 표가 하는 일은 하나다 — OS notify
//! 디바운서 창을 정한다. 긴 티어는 OS 워처가 이벤트를 **들고 있게** 만들어 메모리·
//! 유실 위험이 되므로 언제나 [`MAX_OS_DEBOUNCE_MS`] 로 자른다. 예전 자리는
//! `automation::tiers` 였다 — 사용자의 `config.toml` 에 적힌 값을 그대로 읽으려고
//! 이름과 지연은 바꾸지 않았다.
//!
//! `watcher.debounce_ms` 는 하위호환으로 남는다 — `responsiveness` 가 **없을 때만**
//! 숫자를 쓴다.

use crate::oculpm::spec::WatcherConfig;

/// OS 디바운서 창의 상한 (= `balanced`).
pub const MAX_OS_DEBOUNCE_MS: u32 = 1_000;

/// 디바운스 정책. 직렬화 모양은 `config.toml` 의 `responsiveness` 값과 같다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Responsiveness {
    Fast,
    Balanced,
    Patient,
    Relaxed,
    Deferred,
    Extended,
}

impl Responsiveness {
    fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "fast" => Some(Responsiveness::Fast),
            "balanced" => Some(Responsiveness::Balanced),
            "patient" => Some(Responsiveness::Patient),
            "relaxed" => Some(Responsiveness::Relaxed),
            "deferred" => Some(Responsiveness::Deferred),
            "extended" => Some(Responsiveness::Extended),
            _ => None,
        }
    }

    fn delay_ms(self) -> u64 {
        match self {
            Responsiveness::Fast => 200,
            Responsiveness::Balanced => 1_000,
            Responsiveness::Patient => 3_000,
            Responsiveness::Relaxed => 60_000,
            Responsiveness::Deferred => 5 * 60_000,
            Responsiveness::Extended => 10 * 60_000,
        }
    }
}

/// OS notify 디바운서에 실제로 거는 창(ms).
///
/// `responsiveness` 가 있으면 그 티어를, 없으면 기존 `debounce_ms` 숫자를 쓰되
/// **언제나 [`MAX_OS_DEBOUNCE_MS`] 로 자른다**.
pub fn os_debounce_ms(config: &WatcherConfig) -> u32 {
    let raw = match config
        .responsiveness
        .as_deref()
        .and_then(Responsiveness::parse)
    {
        Some(tier) => u32::try_from(tier.delay_ms()).unwrap_or(MAX_OS_DEBOUNCE_MS),
        None => config.debounce_ms,
    };
    raw.clamp(1, MAX_OS_DEBOUNCE_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watcher_config(debounce_ms: u32, responsiveness: Option<&str>) -> WatcherConfig {
        WatcherConfig {
            ignore: Vec::new(),
            respect_gitignore: true,
            debounce_ms,
            responsiveness: responsiveness.map(str::to_string),
        }
    }

    #[test]
    fn design_table_delays_are_pinned() {
        // 설계 §2.1 의 표 그대로 — 사용자의 config.toml 이 이 이름을 쓴다.
        let table = [
            ("fast", 200),
            ("balanced", 1_000),
            ("patient", 3_000),
            ("relaxed", 60_000),
            ("deferred", 300_000),
            ("extended", 600_000),
        ];
        for (name, ms) in table {
            assert_eq!(Responsiveness::parse(name).map(|t| t.delay_ms()), Some(ms));
        }
        assert_eq!(
            Responsiveness::parse("RELAXED"),
            Some(Responsiveness::Relaxed)
        );
        assert_eq!(Responsiveness::parse("nope"), None);
    }

    /// 긴 티어를 OS 워처에 걸지 않는다 — 10분짜리 디바운스는 이벤트 적체·유실이다.
    #[test]
    fn long_tiers_never_reach_the_os_debouncer() {
        assert_eq!(
            os_debounce_ms(&watcher_config(500, Some("extended"))),
            MAX_OS_DEBOUNCE_MS
        );
        assert_eq!(
            os_debounce_ms(&watcher_config(500, Some("relaxed"))),
            MAX_OS_DEBOUNCE_MS
        );
        assert_eq!(os_debounce_ms(&watcher_config(500, Some("fast"))), 200);
    }

    /// 숫자 필드는 하위호환 — 티어가 없으면 기존 값을 그대로 쓴다.
    #[test]
    fn numeric_debounce_survives_as_custom_back_compat() {
        assert_eq!(os_debounce_ms(&watcher_config(500, None)), 500);
        assert_eq!(os_debounce_ms(&watcher_config(50, None)), 50);
        // 모르는 티어 이름은 숫자로 되돌아간다 (조용히 1s 로 바꾸지 않는다).
        assert_eq!(os_debounce_ms(&watcher_config(250, Some("nope"))), 250);
        // 상한은 언제나 적용된다.
        assert_eq!(
            os_debounce_ms(&watcher_config(9_000, None)),
            MAX_OS_DEBOUNCE_MS
        );
    }
}

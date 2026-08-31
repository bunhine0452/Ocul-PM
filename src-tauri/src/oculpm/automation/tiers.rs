//! 반응성 티어 — 디바운스 숫자를 **이름 있는 정책**으로 승격한다 (Phase 2 §2.1).
//!
//! | 티어 | 지연 | 쓰임 |
//! |---|---|---|
//! | `fast` | 200ms | 단일 파일 저장, 즉시 반응 |
//! | `balanced` | 1s | **기본** — 일반 감시 |
//! | `patient` | 3s | 배치·대용량 |
//! | `relaxed` | 60s | 편집 중인 세션이 멎기를 기다림 |
//! | `deferred` | 5m | 장시간 작성 |
//! | `extended` | 10m | 세션 끝 체크포인트 |
//!
//! # 핵심은 settle-then-act 다
//!
//! 트리거는 "변경이 있었다" 가 아니라 **"변경이 멎었다"** 이다. 이것이 자동
//! 일지의 락 문제를 우회하는 열쇠다 — 에이전트가 활발히 쓰는 동안에는 아무것도
//! 하지 않고, 손이 멎은 뒤에만 락을 잡는다.
//!
//! # 긴 지연을 OS 워처에 걸지 않는다
//!
//! `relaxed`(60s) 이상을 notify 디바운서 창으로 주면 OS 워처가 이벤트를 **들고
//! 있어** 메모리·유실 위험이 된다. 그래서 구조가 둘로 나뉜다:
//!
//! ```text
//! notify(≤ balanced 창) → 이벤트 수집 → "마지막 이벤트 + 티어 지연" 타이머 리셋
//!                      → 만료 = 정착 → 러너에 enqueue
//! ```
//!
//! OS 워처가 보는 창은 [`MAX_OS_DEBOUNCE_MS`] 로 잘리고, 긴 기다림은 전부
//! 러너 쪽 정착 타이머([`super::settle`])가 맡는다.
//!
//! # `debounce_ms` 는 하위호환으로 남는다
//!
//! `watcher.debounce_ms` 를 커스텀 값으로 쓰던 `config.toml` 을 깨지 않는다 —
//! `watcher.responsiveness` 가 **없을 때만** 숫자를 쓴다.

use std::time::Duration;

use crate::oculpm::spec::WatcherConfig;

/// OS 디바운서 창의 상한 (= `balanced`). 이보다 긴 티어는 여기서 잘리고
/// 나머지 기다림은 정착 타이머가 맡는다.
pub const MAX_OS_DEBOUNCE_MS: u32 = 1_000;

/// 정착 지연 정책. 직렬화 모양은 정의 파일의 `responsiveness:` 값과 같다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum Responsiveness {
    Fast,
    /// 기본 — 일반 감시.
    #[default]
    Balanced,
    Patient,
    Relaxed,
    Deferred,
    Extended,
}

impl Responsiveness {
    pub const ALL: [Responsiveness; 6] = [
        Responsiveness::Fast,
        Responsiveness::Balanced,
        Responsiveness::Patient,
        Responsiveness::Relaxed,
        Responsiveness::Deferred,
        Responsiveness::Extended,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Responsiveness::Fast => "fast",
            Responsiveness::Balanced => "balanced",
            Responsiveness::Patient => "patient",
            Responsiveness::Relaxed => "relaxed",
            Responsiveness::Deferred => "deferred",
            Responsiveness::Extended => "extended",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
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

    /// 마지막 이벤트 뒤 이만큼 조용하면 "정착" 이다.
    pub fn delay(self) -> Duration {
        Duration::from_millis(self.delay_ms())
    }

    pub fn delay_ms(self) -> u64 {
        match self {
            Responsiveness::Fast => 200,
            Responsiveness::Balanced => 1_000,
            Responsiveness::Patient => 3_000,
            Responsiveness::Relaxed => 60_000,
            Responsiveness::Deferred => 5 * 60_000,
            Responsiveness::Extended => 10 * 60_000,
        }
    }

    /// 같은 자동화가 재발동하지 못하는 최소 간격 = 티어 지연의 **2배** (§2.4).
    /// 정착이 끝나자마자 우리 쓰기가 다음 창을 여는 것을 막는 마지막 그물이다.
    pub fn min_interval(self) -> Duration {
        self.delay() * 2
    }
}

/// 정의의 `responsiveness:` 문자열 → 티어. 비었거나 모르는 값이면 기본
/// (`balanced`) — 모르는 값 때문에 자동화가 조용히 멈추지는 않는다. 어긋난
/// 값 자체는 [`responsiveness_error`] 가 UI 에 알린다.
pub fn tier_of(raw: Option<&str>) -> Responsiveness {
    raw.and_then(Responsiveness::parse).unwrap_or_default()
}

/// 정의가 못 알아들을 티어를 적었으면 오류 코드. 프런트가 i18n 키로 바꾼다.
pub fn responsiveness_error(raw: Option<&str>) -> Option<&'static str> {
    match raw.map(str::trim) {
        None | Some("") => None,
        Some(s) if Responsiveness::parse(s).is_some() => None,
        Some(_) => Some("automation_bad_responsiveness"),
    }
}

/// OS notify 디바운서에 실제로 거는 창(ms).
///
/// `responsiveness` 가 있으면 그 티어를, 없으면 기존 `debounce_ms` 숫자를 쓰되
/// **언제나 [`MAX_OS_DEBOUNCE_MS`] 로 자른다** — 긴 창은 OS 워처가 이벤트를
/// 들고 있게 만들기 때문이다(§2.1). 나머지 기다림은 정착 타이머의 몫.
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
    fn tiers_round_trip_and_are_ordered_by_delay() {
        let mut prev = 0;
        for tier in Responsiveness::ALL {
            assert_eq!(Responsiveness::parse(tier.as_str()), Some(tier));
            assert!(
                tier.delay_ms() > prev,
                "{} 이 앞 티어보다 짧다",
                tier.as_str()
            );
            prev = tier.delay_ms();
        }
        assert_eq!(Responsiveness::default(), Responsiveness::Balanced);
        assert_eq!(
            Responsiveness::parse("RELAXED"),
            Some(Responsiveness::Relaxed)
        );
        assert_eq!(Responsiveness::parse("nope"), None);
    }

    #[test]
    fn design_table_delays_are_pinned() {
        // 설계 §2.1 의 표 그대로 — 값이 바뀌면 문서도 바뀌어야 한다.
        assert_eq!(Responsiveness::Fast.delay_ms(), 200);
        assert_eq!(Responsiveness::Balanced.delay_ms(), 1_000);
        assert_eq!(Responsiveness::Patient.delay_ms(), 3_000);
        assert_eq!(Responsiveness::Relaxed.delay_ms(), 60_000);
        assert_eq!(Responsiveness::Deferred.delay_ms(), 300_000);
        assert_eq!(Responsiveness::Extended.delay_ms(), 600_000);
    }

    #[test]
    fn min_interval_is_twice_the_delay() {
        assert_eq!(
            Responsiveness::Relaxed.min_interval(),
            Duration::from_secs(120)
        );
    }

    #[test]
    fn unknown_tier_falls_back_to_balanced_but_is_reported() {
        assert_eq!(tier_of(None), Responsiveness::Balanced);
        assert_eq!(tier_of(Some("  ")), Responsiveness::Balanced);
        assert_eq!(tier_of(Some("nope")), Responsiveness::Balanced);
        assert_eq!(tier_of(Some("deferred")), Responsiveness::Deferred);

        assert_eq!(responsiveness_error(None), None);
        assert_eq!(responsiveness_error(Some("")), None);
        assert_eq!(responsiveness_error(Some("relaxed")), None);
        assert_eq!(
            responsiveness_error(Some("nope")),
            Some("automation_bad_responsiveness")
        );
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

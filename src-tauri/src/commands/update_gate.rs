//! 업데이트 확인 관문 — 창이 여럿이어도 GitHub 에는 **앱 하나가 한 번** 묻는다 (2026-11-05).
//!
//! 업데이트 배너(`UpdateBanner.tsx`)는 창마다 하나다. 예전엔 창마다 열릴 때 · 깨어날 때 ·
//! 실패한 동안 10분마다 따로 물었다. 설치본 실측(11-05): 하루 확인 26번, 그중 창을 여럿 연
//! 14:19~14:20 에 12번이 몰려 실패했다. 이제 배너의 **자동** 확인은 먼저 이 관문에 묻고,
//! 끝나면 결과를 알린다. 설정의 「업데이트 확인」(사람이 누른 것)은 관문을 거치지 않는다.
//!
//! 판정(`decide`)은 순수 함수다:
//! - 다른 창이 묻는 중(알린 결과 없이 `INFLIGHT` 안)이면 기다린다 — 동시에 뜬 창 N개가 한 번으로.
//! - 마지막 결과가 「새 판 있음」이면 묻게 둔다 — 창마다 자기 배너용 업데이트를 받아야 한다
//!   (배너가 이미 떠 있는 창은 묻지 않는다).
//! - 「없음」이면 `FRESH` 동안 묻지 않는다.
//! - 「실패」면 `RETRY` 뒤에, 네트워크가 돌아온 순간(`urgent`)이면 바로.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::State;

/// 다른 창이 묻는 중으로 보는 시간 — 알림 없이 이보다 오래면 그 창이 죽었다고 본다.
const INFLIGHT: Duration = Duration::from_secs(30);
/// 「새 판 없음」을 믿는 시간 — 배너의 깨어남 간격(6시간)과 같다.
const FRESH: Duration = Duration::from_secs(6 * 60 * 60);
/// 실패한 뒤 다시 묻는 최소 간격 — 창마다의 10분 재시도가 겹쳐도 앱 전체에서 이 간격.
const RETRY: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    None,
    Found,
    Failed,
}

#[derive(Debug, Default)]
struct GateState {
    /// 마지막으로 묻기를 허락한 때.
    claimed: Option<Instant>,
    /// 마지막으로 알려 온 결과와 그때.
    last: Option<(Instant, Outcome)>,
}

#[derive(Default)]
pub struct UpdateGate(Mutex<GateState>);

/// 지금 이 창이 물어도 되는가.
fn decide(s: &GateState, now: Instant, urgent: bool) -> bool {
    let reported_after_claim = match (s.claimed, s.last) {
        (Some(c), Some((at, _))) => at >= c,
        (Some(_), None) => false,
        (None, _) => true,
    };
    if !reported_after_claim && s.claimed.is_some_and(|c| now.duration_since(c) < INFLIGHT) {
        return false;
    }
    match s.last {
        None => true,
        Some((_, Outcome::Found)) => true,
        Some((at, Outcome::None)) => now.duration_since(at) >= FRESH,
        Some((at, Outcome::Failed)) => urgent || now.duration_since(at) >= RETRY,
    }
}

/// 자동 확인 전에 묻는다 — `true` 면 이 창이 묻고 [`update_check_report`] 로 알린다.
/// `urgent` 는 네트워크가 막 돌아왔을 때(실패 뒤 `online`).
#[tauri::command]
#[specta::specta]
pub fn update_check_claim(gate: State<'_, UpdateGate>, urgent: bool) -> bool {
    let mut s = gate.0.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let ok = decide(&s, now, urgent);
    if ok {
        s.claimed = Some(now);
    }
    ok
}

/// 확인 결과 — `none` · `found` · `failed` (설정에서 사람이 누른 확인도 알린다).
#[tauri::command]
#[specta::specta]
pub fn update_check_report(gate: State<'_, UpdateGate>, outcome: String) {
    let outcome = match outcome.as_str() {
        "found" => Outcome::Found,
        "none" => Outcome::None,
        _ => Outcome::Failed,
    };
    let mut s = gate.0.lock().unwrap_or_else(|e| e.into_inner());
    s.last = Some((Instant::now(), outcome));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn after(t: Instant, secs: u64) -> Instant {
        t + Duration::from_secs(secs)
    }

    #[test]
    fn the_first_window_asks_and_the_others_wait_while_it_is_in_flight() {
        let t0 = Instant::now();
        let mut s = GateState::default();
        assert!(decide(&s, t0, false));
        s.claimed = Some(t0);
        assert!(!decide(&s, after(t0, 1), false));
        assert!(!decide(&s, after(t0, 1), true));
        // 묻던 창이 알리지 않고 죽었다 — 30초 뒤엔 다른 창이 묻는다.
        assert!(decide(&s, after(t0, 31), false));
    }

    #[test]
    fn none_is_trusted_for_six_hours() {
        let t0 = Instant::now();
        let s = GateState {
            claimed: Some(t0),
            last: Some((after(t0, 1), Outcome::None)),
        };
        assert!(!decide(&s, after(t0, 60), false));
        assert!(!decide(&s, after(t0, 60), true));
        assert!(decide(&s, after(t0, 6 * 3600 + 2), false));
    }

    #[test]
    fn found_lets_every_window_fetch_its_own_update() {
        let t0 = Instant::now();
        let s = GateState {
            claimed: Some(t0),
            last: Some((after(t0, 1), Outcome::Found)),
        };
        assert!(decide(&s, after(t0, 2), false));
    }

    #[test]
    fn failed_retries_after_five_minutes_or_when_the_network_returns() {
        let t0 = Instant::now();
        let s = GateState {
            claimed: Some(t0),
            last: Some((after(t0, 1), Outcome::Failed)),
        };
        assert!(!decide(&s, after(t0, 120), false));
        assert!(decide(&s, after(t0, 120), true));
        assert!(decide(&s, after(t0, 302), false));
    }
}

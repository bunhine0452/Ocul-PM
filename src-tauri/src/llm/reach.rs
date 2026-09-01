//! 프로바이더 도달성 원장 — "지금 이 프로바이더에 닿는가" (Phase 7).
//!
//! # 왜 프로브를 쏘지 않는가
//!
//! 목록을 그릴 때마다 5개 프로바이더에 요청을 날리면, 아무것도 안 하고 설정
//! 화면만 열어도 네트워크가 나가고 (경우에 따라) 과금된다. 대신 **이미 한 호출의
//! 결과를 기억한다** — 마지막 시도가 서버에 닿지도 못했으면 그 프로바이더는
//! 지금 못 닿는 것으로 본다. 다음 성공이 즉시 지운다.
//!
//! # 왜 디스크에 안 적는가
//!
//! 앱 메모리에만 산다. 적어 두면 "지난주에 비행기에서 안 됐다" 가 오늘의 사실인
//! 것처럼 보인다. 앱을 다시 켜면 아무 판단도 없는 상태(= 전부 정상)에서 시작한다.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// 한 프로바이더의 마지막 관측.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ProviderReach {
    pub provider: String,
    /// `false` = 마지막 시도가 **서버에 닿지도 못했다** (연결·타임아웃).
    pub reachable: bool,
    /// 영어 원문 사유. UI 는 이걸 툴팁에 그대로 싣는다 (코드가 아니라 원문이
    /// 필요한 자리 — 사용자가 그대로 검색할 수 있어야 한다).
    pub detail: Option<String>,
    /// 관측 시각 (RFC3339).
    pub observed_at: String,
}

fn ledger() -> &'static Mutex<HashMap<String, ProviderReach>> {
    static LEDGER: OnceLock<Mutex<HashMap<String, ProviderReach>>> = OnceLock::new();
    LEDGER.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 시도 하나의 결과를 적는다. `transport_error` 가 `Some` 이면 못 닿은 것이다.
pub fn observe(provider: &str, transport_error: Option<&str>) {
    let mark = ProviderReach {
        provider: provider.to_string(),
        reachable: transport_error.is_none(),
        detail: transport_error.map(str::to_string),
        observed_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Ok(mut m) = ledger().lock() {
        m.insert(provider.to_string(), mark);
    }
}

/// 지금까지 관측된 것 전부. 한 번도 안 불러 본 프로바이더는 **여기 없다** —
/// "모른다" 와 "안 된다" 는 다르다.
pub fn snapshot() -> Vec<ProviderReach> {
    let mut out: Vec<ProviderReach> = ledger()
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default();
    out.sort_by(|a, b| a.provider.cmp(&b.provider));
    out
}

/// 테스트 전용 — 원장을 비운다.
#[cfg(test)]
pub fn reset() {
    if let Ok(mut m) = ledger().lock() {
        m.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_success_erases_an_earlier_transport_failure() {
        reset();
        observe("anthropic", Some("dns error"));
        assert!(!snapshot()[0].reachable);
        observe("anthropic", None);
        assert!(snapshot()[0].reachable);
        assert!(snapshot()[0].detail.is_none());
    }

    /// 안 불러 본 프로바이더는 목록에 없다 — 화면이 "모른다" 를 "된다" 로
    /// 그리게 두고, "안 된다" 는 관측이 있을 때만 말한다.
    #[test]
    fn an_untried_provider_is_absent_not_false() {
        reset();
        observe("openai", None);
        let s = snapshot();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].provider, "openai");
    }
}

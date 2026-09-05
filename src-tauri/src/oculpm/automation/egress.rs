//! 배경 모델 호출이 **기기 밖으로 나가는가**, 그리고 어디로
//! ({#automation-egress-badge}).
//!
//! # 왜 이 판정이 코드에 있어야 하는가
//!
//! 이 제품의 1번 약속은 "로컬 우선 — 사용자가 만든 LLM API 호출과 업데이트
//! 확인 말고는 기기 밖으로 아무것도 안 나간다" 다. 자동화는 그 예외를 **자동
//! 으로** 만든다: 사람이 없는 사이 프로젝트 내용(일지 본문·플랜·git 요약)이
//! 프로바이더로 나간다. 화면이 그 사실을 말하지 않으면 약속은 문서 안에만
//! 있다.
//!
//! 그래서 자동화 카드와 에디터에 배지를 붙인다 — 그리고 **로컬 모델이면 붙지
//! 않는다.** 그 구분이 약속의 핵심이고, 지금까지 화면에 없던 것이 그것이다.
//!
//! # 판정은 목적지 호스트로 한다
//!
//! 프로바이더 이름의 목록을 손으로 들고 있으면 언젠가 어긋난다. 여기 있는
//! 표는 `llm/*.rs` 의 실제 엔드포인트 상수에서 온 **호스트**이고,
//! `tests/egress_inventory.rs` 가 그 상수와 이 표를 대조한다 — 새 프로바이더를
//! 붙이고 여기를 빼먹으면 빌드가 실패한다.
//!
//! 로컬 판정은 그 호스트가 루프백인가 하나로 끝난다 ([`is_loopback_host`]).
//! 오늘 5종은 전부 원격이라 배지는 늘 뜨지만, 온디바이스 서버(Ollama·LM
//! Studio·Osaurus 류)를 붙이는 날 배지는 **저절로** 사라진다. 그게 표를 손으로
//! 들지 않는 이유다.

use serde::{Deserialize, Serialize};
use specta::Type;

/// 프로바이더 → 엔드포인트 호스트. `llm::create` 가 아는 이름과 같은 목록이며,
/// 호스트는 각 어댑터의 `BASE_URL` 에서 온다.
const PROVIDER_HOSTS: &[(&str, &str)] = &[
    ("anthropic", "api.anthropic.com"),
    ("openai", "api.openai.com"),
    ("gemini", "generativelanguage.googleapis.com"),
    ("nim", "integrate.api.nvidia.com"),
    ("openrouter", "openrouter.ai"),
];

/// 배경 모델 호출의 도착지. 프런트가 배지 문구를 이걸로 고른다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ModelEgress {
    /// 설정에 든 프로바이더 id (`anthropic` · `openai` · …). 배지에 그대로
    /// 찍힌다 — "외부로 나감" 같은 뭉뚱그린 문구를 쓰지 않는다.
    pub provider: String,
    /// 배경 작업에 쓰이는 모델 id.
    pub model: String,
    /// 요청이 닿는 호스트. 로컬이면 루프백 주소다.
    pub host: String,
    /// `true` = 기기를 벗어나지 않는다 → 배지를 붙이지 않는다.
    pub local: bool,
}

/// 이 호스트는 기기를 벗어나지 않는가.
///
/// 포트와 IPv6 대괄호를 벗긴 뒤 루프백만 참이다. `127.0.0.1.evil.test` 같은
/// 접두 흉내는 통과하지 못한다 — 판정이 문자열 시작 비교였다면 통과했을 것이다.
pub fn is_loopback_host(host: &str) -> bool {
    let raw = host.trim().to_ascii_lowercase();
    let bare = if let Some(rest) = raw.strip_prefix('[') {
        // `[::1]` · `[::1]:1234` — 대괄호 안이 호스트다.
        rest.split(']').next().unwrap_or_default().to_string()
    } else if raw.matches(':').count() == 1 {
        // 콜론이 하나면 포트다 (대괄호 없는 IPv6 는 둘 이상이다).
        raw.split(':').next().unwrap_or_default().to_string()
    } else {
        raw
    };
    bare == "localhost"
        || bare.ends_with(".localhost")
        || bare
            .parse::<std::net::Ipv4Addr>()
            .is_ok_and(|ip| ip.is_loopback())
        || bare
            .parse::<std::net::Ipv6Addr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// 알려진 프로바이더의 목적지 호스트. 모르는 이름이면 `None` —
/// 호출부는 그때 배지를 만들지 않는다 (모르면 아는 척하지 않는다).
pub fn host_for(provider: &str) -> Option<&'static str> {
    let want = provider.trim().to_ascii_lowercase();
    PROVIDER_HOSTS
        .iter()
        .find(|(name, _)| *name == want)
        .map(|(_, host)| *host)
}

/// 프로바이더/모델 한 쌍의 유출 판정. 모르는 프로바이더는 `None`.
pub fn classify(provider: &str, model: &str) -> Option<ModelEgress> {
    let host = host_for(provider)?;
    Some(ModelEgress {
        provider: provider.trim().to_ascii_lowercase(),
        model: model.trim().to_string(),
        host: host.to_string(),
        local: is_loopback_host(host),
    })
}

/// 표에 든 프로바이더 이름 — `tests/egress_inventory.rs` 의 대조용.
pub fn known_providers() -> impl Iterator<Item = &'static str> {
    PROVIDER_HOSTS.iter().map(|(name, _)| *name)
}

/// 표에 든 호스트 — `tests/egress_inventory.rs` 의 대조용.
pub fn known_hosts() -> impl Iterator<Item = &'static str> {
    PROVIDER_HOSTS.iter().map(|(_, host)| *host)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 오늘 아는 프로바이더는 전부 원격이다 — 배지는 늘 뜬다. 이 단언이
    /// 깨지는 날은 로컬 프로바이더가 붙는 날이고, 그때 배지는 저절로 사라진다.
    #[test]
    fn every_provider_we_know_today_leaves_the_machine() {
        for provider in known_providers() {
            let e = classify(provider, "m").expect("아는 프로바이더");
            assert!(!e.local, "{provider} 가 로컬로 분류됐다");
            assert!(!e.host.is_empty());
            assert_eq!(e.provider, provider, "배지에 이름이 그대로 찍혀야 한다");
        }
    }

    #[test]
    fn an_unknown_provider_gets_no_badge_instead_of_a_guess() {
        assert_eq!(classify("totally-made-up", "m"), None);
        assert_eq!(host_for(""), None);
        // 대소문자·공백은 같은 판정을 받는다 (설정에 손으로 쓴 값이 들어올 수 있다).
        assert_eq!(classify(" Anthropic ", "m").unwrap().provider, "anthropic");
    }

    #[test]
    fn loopback_hosts_are_local_and_public_ones_are_not() {
        for host in [
            "localhost",
            "127.0.0.1",
            "127.0.0.1:11434",
            "::1",
            "[::1]:1234",
            "app.localhost",
        ] {
            assert!(is_loopback_host(host), "{host} 는 로컬이어야 한다");
        }
        for host in [
            "api.anthropic.com",
            "openrouter.ai",
            "127.0.0.1.evil.test",
            "notlocalhost",
        ] {
            assert!(!is_loopback_host(host), "{host} 를 로컬로 읽으면 안 된다");
        }
    }
}

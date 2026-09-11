//! `_auth/status_update` — 어댑터가 **자기 신원**을 밀어 준다 (acp-adapter-0751
//! `{#carry-auth}`, 어댑터 0.75+ `auth-status.js`).
//!
//! 프로토콜 밖의 확장 알림이다. 크레이트의 `AgentNotification` 폴백으로 받으면
//! `matches_method` 가 전부 `true` 라 `$/cancel_request` 같은 알림까지 파싱
//! 오류로 삼켜 기본 핸들러에 못 가게 되므로, **이 메서드만** 받는 알림 타입을
//! 따로 둔다 — 다른 메서드는 `matches_method` 에서 거절해 다음 핸들러로 흘린다.
//!
//! 연결 단위·push 전용 — 우리가 묻는 길은 없고, 어댑터는 값이 **바뀔 때만**
//! 보낸다. 두 가지를 가르는 것이 핵심이다: **침묵**은 "어댑터가 자기 신원을 못
//! 읽었다"이고(화면은 아무 말도 안 한다), `kind: "none"` 은 **로그아웃**이라는
//! 사실 그 자체다. 빈 읽기를 `none` 으로 접으면 CLI 가 이미 알아낸 것을 지운다.

use agent_client_protocol::{JsonRpcMessage, JsonRpcNotification, UntypedMessage};
use serde::{Deserialize, Serialize};

pub const AUTH_STATUS_UPDATE_METHOD: &str = "_auth/status_update";

/// 어댑터가 도는 신원 한 벌 — 프런트가 받는 모양.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpAuthStatus {
    /// `account`(구독 로그인) · `api_key` · `gateway` · `external`(Bedrock 등) ·
    /// `none`(로그아웃). 모르는 값은 원문 그대로 흘린다.
    pub kind: String,
    /// 그대로 보여도 되는 한 줄 — "Claude Max" · "Anthropic API key" · "AWS Bedrock".
    pub label: String,
    /// 둘째 줄(키 출처·게이트웨이 호스트 …). 없으면 프런트가 이메일로 대신한다.
    pub detail: Option<String>,
    pub email: Option<String>,
    pub organization: Option<String>,
    /// 요금제 문자열, 정규화하지 않은 원문.
    pub plan: Option<String>,
}

/// 전선의 `{authStatus: {...}}` (어댑터 `AuthStatusUpdateNotification`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusUpdate {
    auth_status: WireAuthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireAuthStatus {
    kind: String,
    label: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    account: Option<WireAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireAccount {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organization: Option<String>,
    #[serde(default)]
    plan: Option<String>,
}

impl AuthStatusUpdate {
    pub fn into_status(self) -> AcpAuthStatus {
        let WireAuthStatus {
            kind,
            label,
            detail,
            account,
        } = self.auth_status;
        let account = account.unwrap_or(WireAccount {
            email: None,
            organization: None,
            plan: None,
        });
        AcpAuthStatus {
            kind,
            label,
            detail,
            email: account.email,
            organization: account.organization,
            plan: account.plan,
        }
    }
}

impl JsonRpcMessage for AuthStatusUpdate {
    fn matches_method(method: &str) -> bool {
        method == AUTH_STATUS_UPDATE_METHOD
    }

    fn method(&self) -> &str {
        AUTH_STATUS_UPDATE_METHOD
    }

    fn to_untyped_message(&self) -> Result<UntypedMessage, agent_client_protocol::Error> {
        UntypedMessage::new(AUTH_STATUS_UPDATE_METHOD, self)
    }

    fn parse_message(
        method: &str,
        params: &impl Serialize,
    ) -> Result<Self, agent_client_protocol::Error> {
        if method != AUTH_STATUS_UPDATE_METHOD {
            return Err(agent_client_protocol::Error::method_not_found());
        }
        let value = serde_json::to_value(params)?;
        Ok(serde_json::from_value(value)?)
    }
}

impl JsonRpcNotification for AuthStatusUpdate {}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(method: &str, params: serde_json::Value) -> Option<AcpAuthStatus> {
        AuthStatusUpdate::parse_message(method, &params)
            .ok()
            .map(AuthStatusUpdate::into_status)
    }

    /// 어댑터 `auth-status.js` 의 `AuthStatus` 모양 — 계정 로그인. `vendor` 처럼
    /// 모르는 키는 무시한다.
    #[test]
    fn reads_an_account_login() {
        let got = parse(
            AUTH_STATUS_UPDATE_METHOD,
            serde_json::json!({ "authStatus": {
                "kind": "account", "label": "Claude Max",
                "account": { "email": "me@example.com", "organization": "Acme", "plan": "max" },
                "vendor": { "claudeCode": { "subscriptionType": "max" } }
            }}),
        )
        .expect("신원");
        assert_eq!(got.kind, "account");
        assert_eq!(got.label, "Claude Max");
        assert_eq!(got.email.as_deref(), Some("me@example.com"));
        assert_eq!(got.organization.as_deref(), Some("Acme"));
        assert_eq!(got.plan.as_deref(), Some("max"));
        assert_eq!(got.detail, None);
    }

    /// 로그아웃은 침묵이 아니라 **값**이다 — `kind: none` 이 그대로 살아야 한다.
    #[test]
    fn logged_out_is_a_payload_not_silence() {
        let got = parse(
            AUTH_STATUS_UPDATE_METHOD,
            serde_json::json!({ "authStatus": { "kind": "none", "label": "Not logged in" } }),
        )
        .expect("로그아웃도 신원이다");
        assert_eq!(got.kind, "none");
        assert_eq!(got.email, None);
    }

    /// 이 메서드만 받는다 — 다른 확장·`$/` 알림은 `matches_method` 에서 거절돼
    /// 다음 핸들러(기본 핸들러)로 흘러야 한다. 모양이 다르면 파싱 오류.
    #[test]
    fn matches_only_its_own_method_and_rejects_malformed_payloads() {
        assert!(!AuthStatusUpdate::matches_method("$/cancel_request"));
        assert!(!AuthStatusUpdate::matches_method("_something/else"));
        assert!(!AuthStatusUpdate::matches_method("session/update"));
        assert!(AuthStatusUpdate::matches_method(AUTH_STATUS_UPDATE_METHOD));
        assert!(
            parse(
                AUTH_STATUS_UPDATE_METHOD,
                serde_json::json!({ "authStatus": { "kind": "api_key" } })
            )
            .is_none(),
            "label 이 없으면 모양이 다르다"
        );
    }
}

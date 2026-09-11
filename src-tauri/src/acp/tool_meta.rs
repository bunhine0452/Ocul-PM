//! 도구 호출의 `_meta` 확장 — 프로토콜 본문에 없는 것을 어댑터가 여기로 준다.
//!
//! - `claudeCode` — 도구 이름(`toolName`)과 한 줄 제목(`title`).
//! - `contextCompaction` — 컨텍스트 압축의 사실 (acp-adapter-0751
//!   `{#carry-compaction}`). 어댑터(0.75+, `context-compaction.js`)는 압축의
//!   생애를 도구 호출 하나로 접는다: 시작은 `tool_call`(kind `think`, 제목
//!   "Compact conversation"), 끝은 `tool_call_update` 에 이 메타를 실어서. 표준
//!   필드(`toolCallId`·`status`)가 생애·단계를 맡고, 메타는 압축 고유의 사실만
//!   든다.
//!
//! `session.rs` 가 크기 래칫에 붙어 있어 `usage.rs` 처럼 갈라 나왔다 — 호출부는
//! `session::` 을 통해 그대로 본다.

use serde::{Deserialize, Serialize};

use super::usage::saturate;

/// `_meta.claudeCode` 의 문자열 항목 하나.
pub(super) fn claude_meta<T: Serialize>(meta: Option<&T>, key: &str) -> Option<String> {
    serde_json::to_value(meta?)
        .ok()?
        .get("claudeCode")?
        .get(key)?
        .as_str()
        .map(str::to_string)
}

/// 컨텍스트 압축 한 번의 사실 (`context-compaction-meta.js`, version 1).
///
/// 모든 필드가 선택인 이유: 시작 시점엔 아무것도 없고, SDK 가 `post_tokens`·
/// `duration_ms` 를 빼먹을 수 있다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpCompaction {
    /// `manual` · `automatic`.
    pub trigger: Option<String>,
    /// 압축 전 컨텍스트 토큰. `u32` 인 이유는 `AcpEvent::Usage` 와 같다.
    pub pre_tokens: Option<u32>,
    /// 압축 뒤 토큰.
    pub post_tokens: Option<u32>,
    pub duration_ms: Option<u32>,
    /// 실패 사유 (있으면 `status` 도 `failed` 다).
    pub error: Option<String>,
}

/// `_meta.contextCompaction` 이 있으면 읽는다. 없으면 `None` — 이 메타가 없는
/// `think` 호출은 진짜 생각이다.
pub(super) fn compaction_meta<T: Serialize>(meta: Option<&T>) -> Option<AcpCompaction> {
    let value = serde_json::to_value(meta?).ok()?;
    let record = value.get("contextCompaction")?;
    let int = |key: &str| record.get(key).and_then(|v| v.as_u64()).map(saturate);
    Some(AcpCompaction {
        trigger: record
            .get("trigger")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pre_tokens: int("preTokens"),
        post_tokens: int("postTokens"),
        duration_ms: int("durationMs"),
        error: record
            .get("error")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::super::session::{map_update, AcpEvent};
    use super::AcpCompaction;
    use agent_client_protocol::schema::v1::SessionUpdate;

    /// 압축은 `_meta.contextCompaction` 으로만 구별된다 — 같은 `think` 호출이라도
    /// 그 메타가 없으면 진짜 생각이다. 끝의 갱신이 숫자를 싣는다.
    #[test]
    fn compaction_meta_is_read_from_tool_call_and_update() {
        use agent_client_protocol::schema::v1::{
            ToolCall, ToolCallId, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
        };

        // 시작: 어댑터 `ContextCompactionLifecycle::start` 가 보내는 모양.
        let mut call = ToolCall::new(
            ToolCallId::new("compact-1"),
            "Compact conversation".to_string(),
        );
        call.kind = ToolKind::Think;
        call.status = ToolCallStatus::InProgress;
        call.meta = serde_json::from_value(serde_json::json!({
            "contextCompaction": { "version": 1 },
            "claudeCode": { "toolName": "compact" }
        }))
        .expect("meta");
        let AcpEvent::ToolCall {
            compaction, name, ..
        } = map_update(&SessionUpdate::ToolCall(call))
        else {
            panic!("ToolCall 이벤트여야 한다");
        };
        assert_eq!(name.as_deref(), Some("compact"));
        let started = compaction.expect("시작에도 메타는 있다 (숫자 없이)");
        assert_eq!(started.pre_tokens, None);

        // 끝: `finish` 가 사실을 싣는다.
        let mut update =
            ToolCallUpdate::new(ToolCallId::new("compact-1"), ToolCallUpdateFields::new());
        update.fields.status = Some(ToolCallStatus::Completed);
        update.meta = serde_json::from_value(serde_json::json!({
            "contextCompaction": {
                "version": 1, "trigger": "automatic",
                "preTokens": 128_000, "postTokens": 41_500, "durationMs": 2_310
            }
        }))
        .expect("meta");
        let AcpEvent::ToolUpdate { compaction, .. } =
            map_update(&SessionUpdate::ToolCallUpdate(update))
        else {
            panic!("ToolUpdate 이벤트여야 한다");
        };
        assert_eq!(
            compaction,
            Some(AcpCompaction {
                trigger: Some("automatic".into()),
                pre_tokens: Some(128_000),
                post_tokens: Some(41_500),
                duration_ms: Some(2_310),
                error: None,
            })
        );

        // 메타 없는 think 는 압축이 아니다.
        let mut plain = ToolCall::new(ToolCallId::new("think-1"), "생각".to_string());
        plain.kind = ToolKind::Think;
        let AcpEvent::ToolCall { compaction, .. } = map_update(&SessionUpdate::ToolCall(plain))
        else {
            panic!("ToolCall 이벤트여야 한다");
        };
        assert_eq!(compaction, None);
    }
}

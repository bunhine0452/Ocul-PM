//! DAP 봉투 — **JSON-RPC 가 아니다** (docs/dap/00-master-plan.md #envelope).
//!
//! 프레이밍은 LSP 와 같지만(`crate::framing`) 안쪽 모양이 다르다:
//!
//! ```jsonc
//! { "seq": 1, "type": "request",  "command": "setBreakpoints", "arguments": {…} }
//! { "seq": 7, "type": "response", "request_seq": 1, "command": "setBreakpoints",
//!   "success": true, "body": {…} }
//! { "seq": 8, "type": "event",    "event": "stopped", "body": {…} }
//! ```
//!
//! 상관 키가 `id` 가 아니라 `request_seq` 이고, 실패가 JSON-RPC 의 `error` 객체가
//! 아니라 `success: false` + `message` 다. 그래서 `lsp/client.rs` 의 상관 코드를
//! 재사용할 수 없고 이 모듈을 따로 둔다.

use serde_json::{json, Value};

/// 어댑터에서 온 메시지 한 건.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Response {
        request_seq: i64,
        command: String,
        /// `false` 는 **정상 응답**이다 (전송 오류가 아니라 "그 요청을 못 했다").
        success: bool,
        /// 실패 이유. 성공이면 없다.
        message: Option<String>,
        body: Value,
    },
    Event {
        event: String,
        body: Value,
    },
    /// 어댑터가 우리에게 거는 요청 (`runInTerminal` 등). v1 은 거절로 답한다 —
    /// 조용히 무시하면 어댑터가 응답을 기다리며 영영 멈춘다.
    ReverseRequest {
        seq: i64,
        command: String,
        arguments: Value,
    },
}

/// 한 줄의 JSON → 봉투. 읽을 수 없으면 `None` (호출자가 로그만 남기고 넘어간다 —
/// 메시지 하나가 이상하다고 세션 전체를 끊는 것이 더 나쁘다).
pub fn parse_incoming(raw: &[u8]) -> Option<Incoming> {
    let value: Value = serde_json::from_slice(raw).ok()?;
    match value.get("type").and_then(Value::as_str)? {
        "response" => Some(Incoming::Response {
            request_seq: value.get("request_seq").and_then(Value::as_i64)?,
            command: value
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            // 명세상 필수지만 빠뜨리는 어댑터가 있다 — 없으면 성공으로 본다
            // (실패는 반드시 명시된다).
            success: value.get("success").and_then(Value::as_bool).unwrap_or(true),
            message: value
                .get("message")
                .and_then(Value::as_str)
                .filter(|m| !m.is_empty())
                .map(str::to_string),
            body: value.get("body").cloned().unwrap_or(Value::Null),
        }),
        "event" => Some(Incoming::Event {
            event: value.get("event").and_then(Value::as_str)?.to_string(),
            body: value.get("body").cloned().unwrap_or(Value::Null),
        }),
        "request" => Some(Incoming::ReverseRequest {
            seq: value.get("seq").and_then(Value::as_i64)?,
            command: value.get("command").and_then(Value::as_str)?.to_string(),
            arguments: value.get("arguments").cloned().unwrap_or(Value::Null),
        }),
        _ => None,
    }
}

/// 요청 봉투를 만든다.
pub fn request(seq: i64, command: &str, arguments: Option<Value>) -> String {
    let mut msg = json!({ "seq": seq, "type": "request", "command": command });
    if let Some(args) = arguments {
        msg["arguments"] = args;
    }
    msg.to_string()
}

/// 역방향 요청에 대한 응답 봉투.
pub fn response(seq: i64, request_seq: i64, command: &str, success: bool, message: &str) -> String {
    let mut msg = json!({
        "seq": seq,
        "type": "response",
        "request_seq": request_seq,
        "command": command,
        "success": success,
    });
    if !message.is_empty() {
        msg["message"] = json!(message);
    }
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_response() {
        let raw = br#"{"seq":7,"type":"response","request_seq":3,"command":"stackTrace",
                       "success":true,"body":{"stackFrames":[]}}"#;
        match parse_incoming(raw).unwrap() {
            Incoming::Response { request_seq, command, success, message, body } => {
                // 상관 키는 `id` 가 아니라 `request_seq` 다.
                assert_eq!(request_seq, 3);
                assert_eq!(command, "stackTrace");
                assert!(success);
                assert!(message.is_none());
                assert!(body.get("stackFrames").is_some());
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn a_failed_response_is_not_a_transport_error() {
        let raw = br#"{"seq":8,"type":"response","request_seq":4,"command":"launch",
                       "success":false,"message":"program not found"}"#;
        match parse_incoming(raw).unwrap() {
            Incoming::Response { success, message, .. } => {
                assert!(!success);
                assert_eq!(message.as_deref(), Some("program not found"));
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn missing_success_counts_as_success() {
        // 명세상 필수지만 빠뜨리는 어댑터가 있다. 실패는 반드시 명시되므로
        // 없으면 성공으로 본다 — 반대로 두면 정상 응답이 전부 오류가 된다.
        let raw = br#"{"seq":1,"type":"response","request_seq":1,"command":"threads"}"#;
        match parse_incoming(raw).unwrap() {
            Incoming::Response { success, .. } => assert!(success),
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn reads_an_event_and_a_reverse_request() {
        let raw = br#"{"seq":9,"type":"event","event":"stopped","body":{"reason":"breakpoint"}}"#;
        assert_eq!(
            parse_incoming(raw).unwrap(),
            Incoming::Event {
                event: "stopped".to_string(),
                body: serde_json::json!({ "reason": "breakpoint" }),
            }
        );

        let raw = br#"{"seq":10,"type":"request","command":"runInTerminal","arguments":{"args":["x"]}}"#;
        match parse_incoming(raw).unwrap() {
            Incoming::ReverseRequest { seq, command, .. } => {
                assert_eq!((seq, command.as_str()), (10, "runInTerminal"));
            }
            other => panic!("expected ReverseRequest, got {other:?}"),
        }
    }

    #[test]
    fn unreadable_messages_are_dropped_not_fatal() {
        assert!(parse_incoming(b"not json").is_none());
        assert!(parse_incoming(br#"{"type":"nonsense"}"#).is_none());
        // response 인데 request_seq 가 없으면 상관시킬 수 없다.
        assert!(parse_incoming(br#"{"type":"response","command":"x"}"#).is_none());
    }

    #[test]
    fn encodes_requests_and_reverse_responses() {
        let out = request(2, "continue", Some(serde_json::json!({ "threadId": 1 })));
        let back: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(back["type"], "request");
        assert_eq!(back["seq"], 2);
        assert_eq!(back["arguments"]["threadId"], 1);
        // 인자가 없으면 키 자체가 없다 (빈 객체를 싫어하는 어댑터가 있다).
        let bare: Value = serde_json::from_str(&request(3, "configurationDone", None)).unwrap();
        assert!(bare.get("arguments").is_none());

        let resp: Value =
            serde_json::from_str(&response(4, 10, "runInTerminal", false, "지원하지 않습니다")).unwrap();
        assert_eq!(resp["request_seq"], 10);
        assert_eq!(resp["success"], false);
        assert_eq!(resp["message"], "지원하지 않습니다");
    }
}

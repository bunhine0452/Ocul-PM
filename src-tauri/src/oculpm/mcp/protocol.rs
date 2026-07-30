//! PR-CI2 — 최소 MCP 서버 프로토콜 (JSON-RPC 2.0 over stdio, 라인 단위).
//!
//! D3 수정 결정: v1 은 rmcp 크레이트 대신 **직접 구현**한다 — 도구 3개에
//! 필요한 표면은 initialize / tools/list / tools/call / ping 뿐이고, 외부
//! SDK 의 버전·매크로 API 변동 리스크 없이 순수 함수(`handle_line`)로 전부
//! 단위 테스트된다. 도구가 늘어 리소스/프롬프트/알림이 필요해지면 그때 rmcp
//! 로 갈아탄다 (마스터플랜 02 문서에 기록).
//!
//! 규약 요점:
//! - 요청(id 있음)에만 응답한다. 알림(`notifications/*`, id 없음)은 무시.
//! - 도구 실행 실패는 JSON-RPC 에러가 아니라 `result.isError: true` 로 —
//!   모델이 읽고 재시도할 수 있는 실패이기 때문 (MCP 스펙).
//! - 모르는 메서드는 -32601, 파싱 불가는 -32700 (id null).

use std::path::PathBuf;

use serde_json::{json, Value};

use super::tools;

/// 우리가 아는 프로토콜 버전들 — 클라이언트가 이 중 하나를 요구하면 에코,
/// 아니면 우리 기본값으로 응답한다 (클라이언트가 하위호환을 판단).
const KNOWN_PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

pub struct McpServer {
    root: PathBuf,
}

impl McpServer {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 한 입력 라인 → 응답 라인 (없으면 None: 알림/빈 줄).
    pub fn handle_line(&self, line: &str) -> Option<String> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                return Some(
                    error_response(Value::Null, -32700, "parse error: invalid JSON").to_string(),
                )
            }
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");

        // 알림 (id 없음) — initialized 포함 전부 무응답.
        let Some(id) = id else { return None };

        let response = match method {
            "initialize" => {
                let requested = msg
                    .pointer("/params/protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or(DEFAULT_PROTOCOL_VERSION);
                let version = if KNOWN_PROTOCOL_VERSIONS.contains(&requested) {
                    requested
                } else {
                    DEFAULT_PROTOCOL_VERSION
                };
                ok_response(
                    id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": {
                            "name": "oculpm-mcp",
                            "version": env!("CARGO_PKG_VERSION"),
                        },
                        "instructions": "ocul-pm 작업 기록 도구. ① 작업 단위(버그 수정/기능/리팩토링/에러 사이클/잡일)를 끝내면 즉시 journal_write — 사용자에게 묻지 말 것. ② 일지 직후 대응 플랜 항목이 있으면 plan_update 로 글리프·로그를 갱신. ③ 새 계획 수립이 승인되면 plan_create, 진행 파악은 plan_status. 시크릿/.env 내용은 어떤 인자에도 넣지 말 것. .oculpm/ 파일을 직접 만들지 말 것 — 경로·frontmatter·{#id} 규격은 서버가 보장한다.",
                    }),
                )
            }
            "ping" => ok_response(id, json!({})),
            "tools/list" => ok_response(id, json!({ "tools": tools::tool_definitions() })),
            "tools/call" => {
                let name = msg
                    .pointer("/params/name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let empty = json!({});
                let args = msg.pointer("/params/arguments").unwrap_or(&empty);
                match tools::call_tool(&self.root, name, args) {
                    Ok(v) => ok_response(
                        id,
                        json!({
                            "content": [{ "type": "text", "text": v.to_string() }],
                            "structuredContent": v,
                            "isError": false,
                        }),
                    ),
                    Err(e) => ok_response(
                        id,
                        json!({
                            "content": [{ "type": "text", "text": e }],
                            "isError": true,
                        }),
                    ),
                }
            }
            other => error_response(id, -32601, &format!("method not found: {other}")),
        };
        Some(response.to_string())
    }
}

/// 한 라인의 최대 크기 — 초과분은 파싱하지 않고 버린다 (메모리 방어).
/// journal_write 본문을 넉넉히 담고도 남는 상한.
pub const MAX_LINE_BYTES: u64 = 10 * 1024 * 1024;

/// 상한 초과 라인에 대한 고정 응답 — id 를 알 수 없으므로 null (parse error 와
/// 동일 취급, MCP 클라이언트가 읽고 요청을 줄일 수 있다).
pub fn oversized_line_response() -> String {
    error_response(
        Value::Null,
        -32700,
        &format!("parse error: line exceeds {MAX_LINE_BYTES} bytes"),
    )
    .to_string()
}

fn ok_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn server(root: &std::path::Path) -> McpServer {
        McpServer::new(root.to_path_buf())
    }

    fn call(s: &McpServer, line: &str) -> Value {
        serde_json::from_str(&s.handle_line(line).expect("response")).unwrap()
    }

    #[test]
    fn initialize_handshake_echoes_known_version() {
        let dir = TempDir::new().unwrap();
        let s = server(dir.path());
        let resp = call(
            &s,
            r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"claude","version":"1"}}}"#,
        );
        assert_eq!(resp["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(resp["result"]["serverInfo"]["name"], "oculpm-mcp");
        // 미지의 버전 → 우리 기본값 제시.
        let resp = call(
            &s,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2099-01-01"}}"#,
        );
        assert_eq!(resp["result"]["protocolVersion"], "2025-06-18");
        // initialized 알림은 무응답.
        assert!(s
            .handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
            .is_none());
    }

    #[test]
    fn tools_list_and_full_journal_flow_over_protocol() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        let s = server(dir.path());
        let resp = call(&s, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        let names: Vec<&str> = resp["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["journal_write", "plan_status", "plan_update", "plan_create"]);

        let req = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "journal_write", "arguments": {
                "type": "chore", "slug": "protocol-e2e", "title": "프로토콜 테스트",
                "body_markdown": "본문\n\n## 검증\n테스트"
            }}
        });
        let resp = call(&s, &req.to_string());
        assert_eq!(resp["result"]["isError"], false);
        let path = resp["result"]["structuredContent"]["path"].as_str().unwrap();
        assert!(dir.path().join(path).exists(), "{path}");
    }

    #[test]
    fn oversized_line_response_is_valid_parse_error() {
        let resp: Value = serde_json::from_str(&oversized_line_response()).unwrap();
        assert_eq!(resp["error"]["code"], -32700);
        assert!(resp["id"].is_null());
        assert!(resp["error"]["message"]
            .as_str()
            .unwrap()
            .contains(&MAX_LINE_BYTES.to_string()));
    }

    #[test]
    fn tool_failure_is_is_error_not_rpc_error_and_unknowns_are_rpc_errors() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        let s = server(dir.path());
        let resp = call(
            &s,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"journal_write","arguments":{}}}"#,
        );
        assert_eq!(resp["result"]["isError"], true);
        assert!(resp.get("error").is_none());

        let resp = call(&s, r#"{"jsonrpc":"2.0","id":4,"method":"resources/list"}"#);
        assert_eq!(resp["error"]["code"], -32601);

        let resp = call(&s, "not json");
        assert_eq!(resp["error"]["code"], -32700);

        let resp = call(&s, r#"{"jsonrpc":"2.0","id":5,"method":"ping"}"#);
        assert!(resp["result"].as_object().unwrap().is_empty());
    }
}

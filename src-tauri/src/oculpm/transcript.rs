//! PR-CI1 — Claude Code transcript(JSONL) 방어적 파서 (D4).
//!
//! `~/.claude/projects/<슬러그>/<session>.jsonl` 은 **비공식 포맷**이다 — 버전
//! 간 변경될 수 있으므로 이 파서는 실측(01-hook-payload-actual.md §3)된 최소
//! 구조만 관용적으로 취한다: `type ∈ {user, assistant}` 라인의 `message.content`
//! 텍스트와 `timestamp`, assistant 의 `message.model`. 그 외 라인
//! (queue-operation / attachment / file-history-snapshot / …)과 모르는 필드는
//! 통째로 무시하고, 한 줄이 깨져도 나머지는 계속 읽는다. 여기서 아무것도 못
//! 건지면 호출자(journal_draft)가 메타-강등 경로로 내려간다.

use serde_json::Value;

/// 프롬프트에 넣을 사용자/어시스턴트 메시지 수 상한 — 앞(원래 요청)과
/// 뒤(결말)를 남기고 가운데를 접는다.
const KEEP_HEAD: usize = 4;
const KEEP_TAIL: usize = 16;
/// 메시지당 문자 상한 (char 단위 — UTF-8 경계 안전).
const USER_CHAR_CAP: usize = 800;
const ASSISTANT_CHAR_CAP: usize = 1200;

#[derive(Debug, Default)]
pub struct TranscriptDigest {
    pub user_prompts: Vec<String>,
    pub assistant_texts: Vec<String>,
    /// 첫 assistant 라인의 `message.model` — 실측 모델명 (`agent.version` 감).
    pub model: Option<String>,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
    pub total_lines: usize,
    /// 파싱에 성공해 텍스트를 건진 메시지 수. 0 = 강등 신호.
    pub parsed_messages: usize,
    /// head/tail 접기로 가운데가 잘렸는가 (프롬프트에 표기).
    pub truncated: bool,
}

/// content 필드에서 사람이 읽는 텍스트만 추출. 문자열이면 그대로, 블록
/// 배열이면 `type == "text"` 블록의 `text` 만 이어붙인다 (tool_use /
/// tool_result / thinking 블록 제외).
fn extract_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.trim().to_string(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn cap_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        s.to_string()
    } else {
        s.chars().take(cap).collect::<String>() + "…"
    }
}

/// 앞 `KEEP_HEAD` + 뒤 `KEEP_TAIL` 만 남긴다. (잘렸는지, 남긴 목록) 반환.
fn fold_window(mut msgs: Vec<String>) -> (bool, Vec<String>) {
    if msgs.len() <= KEEP_HEAD + KEEP_TAIL {
        return (false, msgs);
    }
    let tail = msgs.split_off(msgs.len() - KEEP_TAIL);
    msgs.truncate(KEEP_HEAD);
    msgs.extend(tail);
    (true, msgs)
}

pub fn parse_transcript(raw: &str) -> TranscriptDigest {
    let mut digest = TranscriptDigest::default();
    let mut users: Vec<String> = Vec::new();
    let mut assistants: Vec<String> = Vec::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        digest.total_lines += 1;
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue; // 깨진 라인 — 나머지는 계속
        };
        // 서브에이전트(sidechain) 대화는 메인 서사가 아니다.
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let line_type = v.get("type").and_then(Value::as_str).unwrap_or("");
        if line_type != "user" && line_type != "assistant" {
            continue;
        }
        let Some(message) = v.get("message") else {
            continue;
        };
        let text = message.get("content").map(extract_text).unwrap_or_default();

        if let Some(ts) = v.get("timestamp").and_then(Value::as_str) {
            if digest.first_ts.is_none() {
                digest.first_ts = Some(ts.to_string());
            }
            digest.last_ts = Some(ts.to_string());
        }
        if line_type == "assistant" && digest.model.is_none() {
            if let Some(m) = message.get("model").and_then(Value::as_str) {
                digest.model = Some(m.to_string());
            }
        }
        if text.is_empty() {
            continue; // tool_result 만 든 user 라인, tool_use 만 든 assistant 라인 등
        }
        digest.parsed_messages += 1;
        if line_type == "user" {
            users.push(cap_chars(&text, USER_CHAR_CAP));
        } else {
            assistants.push(cap_chars(&text, ASSISTANT_CHAR_CAP));
        }
    }

    let (t1, users) = fold_window(users);
    let (t2, assistants) = fold_window(assistants);
    digest.truncated = t1 || t2;
    digest.user_prompts = users;
    digest.assistant_texts = assistants;
    digest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_line(text: &str) -> String {
        format!(
            r#"{{"type":"user","isSidechain":false,"timestamp":"2026-07-20T05:00:00.000Z","message":{{"role":"user","content":"{text}"}}}}"#
        )
    }

    fn assistant_line(text: &str) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":false,"timestamp":"2026-07-20T05:00:01.000Z","message":{{"role":"assistant","model":"claude-haiku-4-5-20251001","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        )
    }

    #[test]
    fn parses_real_shaped_lines_and_skips_noise() {
        let raw = [
            r#"{"type":"queue-operation","operation":"enqueue","sessionId":"s","timestamp":"t"}"#.to_string(),
            user_line("버그를 고쳐줘"),
            r#"{"type":"attachment","attachment":{},"uuid":"u"}"#.to_string(),
            // tool_use 만 있는 assistant 라인 — 텍스트 없음 → 메시지로 안 침.
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{}}]}}"#.to_string(),
            assistant_line("고쳤습니다"),
            r#"{"type":"file-history-snapshot","snapshot":{}}"#.to_string(),
            "not-json-at-all".to_string(),
        ]
        .join("\n");

        let d = parse_transcript(&raw);
        assert_eq!(d.user_prompts, vec!["버그를 고쳐줘"]);
        assert_eq!(d.assistant_texts, vec!["고쳤습니다"]);
        assert_eq!(d.parsed_messages, 2);
        assert_eq!(d.model.as_deref(), Some("claude-haiku-4-5-20251001"));
        assert_eq!(d.first_ts.as_deref(), Some("2026-07-20T05:00:00.000Z"));
        assert!(!d.truncated);
    }

    #[test]
    fn sidechain_and_tool_result_user_lines_are_skipped() {
        let raw = [
            r#"{"type":"user","isSidechain":true,"message":{"role":"user","content":"서브에이전트 내부"}}"#.to_string(),
            // tool_result 블록만 있는 user 라인 — 사람 프롬프트가 아니다.
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"stdout"}]}}"#.to_string(),
            user_line("진짜 질문"),
        ]
        .join("\n");
        let d = parse_transcript(&raw);
        assert_eq!(d.user_prompts, vec!["진짜 질문"]);
        assert_eq!(d.parsed_messages, 1);
    }

    #[test]
    fn long_sessions_fold_middle_and_cap_each_message() {
        let mut lines: Vec<String> = Vec::new();
        for i in 0..40 {
            lines.push(user_line(&format!("메시지-{i}")));
        }
        lines.push(user_line(&"a".repeat(2000)));
        let d = parse_transcript(&lines.join("\n"));
        assert!(d.truncated);
        assert_eq!(d.user_prompts.len(), KEEP_HEAD + KEEP_TAIL);
        // 앞 4개는 원래 순서, 마지막은 캡 적용된 장문.
        assert_eq!(d.user_prompts[0], "메시지-0");
        let last = d.user_prompts.last().unwrap();
        assert!(last.ends_with('…'));
        assert_eq!(last.chars().count(), USER_CHAR_CAP + 1);
    }

    #[test]
    fn empty_or_garbage_input_yields_zero_messages() {
        assert_eq!(parse_transcript("").parsed_messages, 0);
        assert_eq!(parse_transcript("garbage\n{broken").parsed_messages, 0);
    }
}

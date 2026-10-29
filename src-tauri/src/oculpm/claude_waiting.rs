//! 바깥(또는 앱 안) 터미널의 Claude 가 사람을 기다린다 — 플러그인 Notification 훅이 인박스
//! (`.oculpm/hooks/claude-events.jsonl`)에 남긴 것을 워처가 세션별로 든다 (ocul-next #notify-hook).
//! 오늘 화면이 `claude_waiting` 으로 읽고, 창이 뒤에 있으면 OS 알림이 간다. 앱 프로세스 안에만 산다.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::oculpm::claude_hooks::HookEvent;

/// 바깥(또는 앱 안) 터미널의 Claude 가 사람을 기다린다 — 플러그인 Notification 훅 (ocul-next
/// #notify-hook). 같은 세션의 다음 이벤트(입력 · 턴 끝 · 세션 끝)가 오면 지운다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ClaudeWaiting {
    pub session_id: String,
    /// `permission` · `idle`
    pub kind: String,
    pub message: Option<String>,
    /// 기다리기 시작한 시각 (RFC 3339).
    pub since: String,
}

/// 프로젝트마다 Claude 가 기다리는 세션들 — 워처가 훅 인박스에서 채우고(`apply_waiting`),
/// 오늘 화면이 `claude_waiting` 으로 읽는다. 앱 프로세스 안에만 산다(앱을 다시 켜면 다음 훅부터).
#[derive(Default, Clone)]
pub struct ClaudeWaitingState(
    pub  std::sync::Arc<
        std::sync::Mutex<std::collections::HashMap<u32, BTreeMap<String, ClaudeWaiting>>>,
    >,
);

/// 그 프로젝트의 기다림이 바뀌었다 — 오늘 화면이 다시 읽고, 창이 뒤에 있으면 알린다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ClaudeWaitingChanged {
    pub project_id: u32,
}

/// 오래 남은 기다림은 지운다 — 훅이 끝을 못 알린 세션(터미널을 그냥 닫음)이 오늘에 남지 않게.
pub const WAITING_STALE_MINUTES: i64 = 30;

/// 기다림 표에 이벤트 하나를 반영한다. 바뀌었으면 `true`.
pub fn apply_waiting(
    waiting: &mut BTreeMap<String, ClaudeWaiting>,
    ev: &HookEvent,
    now: &str,
) -> bool {
    if ev.session_id.is_empty() {
        return false;
    }
    match ev.hook_event_name.as_str() {
        "Notification" => {
            let kind = match ev.notification_type.as_deref() {
                Some("permission_prompt") => "permission",
                Some("idle_prompt") => "idle",
                _ => return false,
            };
            let next = ClaudeWaiting {
                session_id: ev.session_id.clone(),
                kind: kind.to_string(),
                message: ev.message.clone().filter(|m| !m.trim().is_empty()),
                since: ev.oculpm_ts.clone().unwrap_or_else(|| now.to_string()),
            };
            waiting.insert(ev.session_id.clone(), next.clone()) != Some(next)
        }
        // 사람이 답했거나(입력) 턴 · 세션이 끝났다 — 더는 기다리지 않는다.
        "UserPromptSubmit" | "Stop" | "StopFailure" | "SessionEnd" | "SessionStart" => {
            waiting.remove(&ev.session_id).is_some()
        }
        _ => false,
    }
}

// ─── Claude 가 묻고 사람이 답한다 (MCP `ask_user`, #ask-user) ─────────────────────────

/// 앱에 떠 있는 질문 하나 — `oculpm-mcp` 의 `ask_user` 가 `.oculpm/hooks/questions/<id>.json` 에 썼다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ClaudeQuestion {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<String>,
    pub asked_at: String,
}

/// 그 프로젝트의 질문이 바뀌었다(새로 물음 · 답함 · 거둠) — 오늘이 다시 읽고, 창이 뒤면 알린다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ClaudeQuestionsChanged {
    pub project_id: u32,
}

/// 인박스 이벤트 가운데 질문을 바꾸는 것 (`ask_user` 가 남긴 한 줄).
pub fn is_question_event(name: &str) -> bool {
    name.starts_with("OculpmQuestion")
}

/// 답을 기다리는 질문들 — 답 파일이 이미 있는 것은 뺀다(도구가 곧 거둔다). 오래된 것부터.
pub fn pending_questions(root: &Path) -> Vec<ClaudeQuestion> {
    let dir = root.join(crate::oculpm::mcp::tools::ask::QUESTIONS_REL);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<ClaudeQuestion> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".json")?;
            if id.ends_with(".answer") || dir.join(format!("{id}.answer.json")).exists() {
                return None;
            }
            serde_json::from_slice::<ClaudeQuestion>(&std::fs::read(e.path()).ok()?).ok()
        })
        .collect();
    out.sort_by(|a, b| a.asked_at.cmp(&b.asked_at));
    out
}

/// 사람의 답을 쓴다 — 기다리던 `ask_user` 가 읽어 Claude 에게 돌려준다. id 는 질문 파일이 있는 것만.
pub fn write_answer(root: &Path, id: &str, answer: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad question id".into());
    }
    let answer = answer.trim();
    if answer.is_empty() {
        return Err("empty answer".into());
    }
    let q = crate::oculpm::mcp::tools::ask::question_path(root, id);
    if !q.exists() {
        return Err("이미 거둔 질문이에요".into());
    }
    let path = crate::oculpm::mcp::tools::ask::answer_path(root, id);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::json!({ "answer": answer }).to_string())
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::claude_hooks::parse_inbox_slice;

    #[test]
    fn pending_questions_skip_answered_ones_and_answers_need_a_live_question() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let dir = root.join(crate::oculpm::mcp::tools::ask::QUESTIONS_REL);
        std::fs::create_dir_all(&dir).unwrap();
        let q = |id: &str, at: &str| {
            serde_json::json!({ "id": id, "question": format!("{id}?"), "options": ["예"], "asked_at": at }).to_string()
        };
        std::fs::write(dir.join("q2.json"), q("q2", "2026-10-29T15:00:00Z")).unwrap();
        std::fs::write(dir.join("q1.json"), q("q1", "2026-10-29T14:00:00Z")).unwrap();
        std::fs::write(dir.join("broken.json"), "{").unwrap();
        let ids: Vec<_> = pending_questions(root).into_iter().map(|q| q.id).collect();
        assert_eq!(ids, ["q1", "q2"], "오래된 것부터, 깨진 파일은 건너뛴다");
        write_answer(root, "q1", " 예 ").unwrap();
        assert_eq!(pending_questions(root).len(), 1, "답한 질문은 빠진다");
        assert!(
            write_answer(root, "gone", "예").is_err(),
            "거둔 질문에는 못 답한다"
        );
        assert!(write_answer(root, "../x", "예").is_err());
        assert!(write_answer(root, "q2", "  ").is_err());
    }

    /// 바깥 터미널의 기다림 (#notify-hook) — 권한 · 입력 대기만 표에 들고, 같은 세션의 다음 이벤트가 지운다.
    #[test]
    fn notification_waits_until_the_same_session_moves_on() {
        let line = |s: &str| parse_inbox_slice(format!("{s}\n").as_bytes()).0.remove(0);
        let mut waiting = BTreeMap::new();
        let ask = line(
            r#"{"hook_event_name":"Notification","session_id":"s1","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash","oculpm_ts":"2026-10-29T14:00:00Z"}"#,
        );
        assert!(apply_waiting(&mut waiting, &ask, "now"));
        assert!(
            !apply_waiting(&mut waiting, &ask, "now"),
            "같은 기다림이 다시 와도 바뀐 것은 없다"
        );
        let w = &waiting["s1"];
        assert_eq!(w.kind, "permission");
        assert_eq!(w.since, "2026-10-29T14:00:00Z");
        assert_eq!(
            w.message.as_deref(),
            Some("Claude needs your permission to use Bash")
        );
        // 다른 종류의 알림(로그인 성공 등)은 기다림이 아니다.
        let other = line(
            r#"{"hook_event_name":"Notification","session_id":"s2","notification_type":"auth_success"}"#,
        );
        assert!(!apply_waiting(&mut waiting, &other, "now"));
        // 다른 세션의 이벤트는 s1 을 지우지 않는다.
        assert!(!apply_waiting(
            &mut waiting,
            &line(r#"{"hook_event_name":"Stop","session_id":"s9"}"#),
            "now"
        ));
        assert!(apply_waiting(
            &mut waiting,
            &line(r#"{"hook_event_name":"UserPromptSubmit","session_id":"s1"}"#),
            "now"
        ));
        assert!(waiting.is_empty());
        let idle = line(
            r#"{"hook_event_name":"Notification","session_id":"s3","notification_type":"idle_prompt"}"#,
        );
        assert!(apply_waiting(&mut waiting, &idle, "2026-10-29T15:00:00Z"));
        assert_eq!(
            waiting["s3"].since, "2026-10-29T15:00:00Z",
            "훅 시각이 없으면 받은 시각"
        );
        assert!(apply_waiting(
            &mut waiting,
            &line(r#"{"hook_event_name":"SessionEnd","session_id":"s3"}"#),
            "now"
        ));
    }
}

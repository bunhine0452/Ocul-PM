//! 바깥(또는 앱 안) 터미널의 Claude 가 사람을 기다린다 — 플러그인 Notification 훅이 인박스
//! (`.oculpm/hooks/claude-events.jsonl`)에 남긴 것을 워처가 세션별로 든다 (ocul-next #notify-hook).
//! 오늘 화면이 `claude_waiting` 으로 읽고, 창이 뒤에 있으면 OS 알림이 간다. 앱 프로세스 안에만 산다.

use std::collections::BTreeMap;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::claude_hooks::parse_inbox_slice;

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

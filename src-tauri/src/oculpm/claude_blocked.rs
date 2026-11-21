//! 자동 모드가 막은 행동 — 플러그인의 `PermissionDenied` 훅이 인박스에 남긴 것을 워처가 프로젝트별로
//! 든다 (2026-11-22, 플랜 `agent-era-20261122` {#auto-blocked}).
//!
//! # 왜
//!
//! Claude Code 의 자동 모드에서는 명령마다 사람에게 묻지 않는다 — 분류기가 대신 보고, 위험해 보이면
//! 막는다. 그때 Claude 는 멈추지 않고 다른 길을 찾거나 그 일을 건너뛴다. 사람이 「허락할까요?」 를
//! 받던 시절에는 그 순간이 곧 기다림이었지만(`claude_waiting`), 이제 막힌 일은 아무 줄에도 서지
//! 않는다. 오늘 화면의 규칙은 「예외만 보여 준다」 이고, **분류기가 막은 행동은 사람이 봐야 할 예외**다:
//! 막은 것이 옳았는지, 그 때문에 무엇이 안 됐는지, 믿는 자리(저장소 · 버킷)를 자동 모드에 알려 줄지.
//!
//! # 무엇을 드는가
//!
//! 도구 이름과 **한 줄**(Bash 의 명령 첫 줄 · 파일 도구의 경로 · 웹 도구의 주소)과 분류기의 이유.
//! 도구 인자 전체는 들지 않는다 — Write 의 인자는 파일 내용 전체다. 한 줄은 비밀 가리기(`redact`)를
//! 지나고 제어 · 보이지 않는 글자를 걷는다(이 글은 화면에 서고, 사람이 터미널로 옮길 수 있다).
//!
//! 앱 프로세스 안에만 산다 — 앱을 다시 켜면 다음 훅부터다(`claude_waiting` 과 같다). 사람이
//! 「알았어요」 를 누르거나 [`BLOCKED_STALE_HOURS`] 가 지나면 사라진다.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::oculpm::claude_hooks::HookEvent;

/// 자동 모드가 막은 행동 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ClaudeBlocked {
    pub session_id: String,
    /// 도구 이름 (`Bash` · `Write` · `mcp__…`).
    pub tool: String,
    /// 무엇을 하려 했는가 — 한 줄. 알 수 없으면 빈 문자열.
    pub what: String,
    /// 분류기가 말한 이유 (없을 수 있다).
    pub reason: Option<String>,
    /// 막힌 시각 (RFC 3339).
    pub at: String,
}

/// 프로젝트마다 자동 모드가 막은 행동들 — 오래된 것부터. 워처가 채우고 오늘 화면이 `claude_blocked` 로 읽는다.
#[derive(Default, Clone)]
pub struct ClaudeBlockedState(
    pub std::sync::Arc<std::sync::Mutex<std::collections::HashMap<u32, Vec<ClaudeBlocked>>>>,
);

/// 그 프로젝트의 막힌 행동이 바뀌었다 — 오늘 화면이 다시 읽는다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ClaudeBlockedChanged {
    pub project_id: u32,
}

/// 프로젝트 하나가 드는 최대 건수 — 넘치면 오래된 것부터 버린다. 한 행에 「N건」 으로 서는 수의 상한이다.
pub const BLOCKED_KEEP: usize = 30;
/// 이보다 오래된 것은 읽을 때 지운다 — 어제 막힌 행동이 오늘 화면에 남지 않게.
pub const BLOCKED_STALE_HOURS: i64 = 12;
/// 한 줄의 최대 글자 수.
const WHAT_MAX: usize = 160;
const REASON_MAX: usize = 200;

/// 이벤트 하나를 반영한다. 더했으면 `true`. `PermissionDenied` 가 아니면 아무것도 하지 않는다.
///
/// `redact` 는 한 줄에서 비밀을 가리는 함수다 — 워처가 프로젝트의 패턴으로 만들어 준다.
pub fn apply_blocked(
    list: &mut Vec<ClaudeBlocked>,
    ev: &HookEvent,
    root: &Path,
    now: &str,
    redact: &dyn Fn(&str) -> String,
) -> bool {
    if ev.hook_event_name != "PermissionDenied" || ev.session_id.is_empty() {
        return false;
    }
    let Some(tool) = ev
        .tool_name
        .as_deref()
        .map(one_line)
        .filter(|t| !t.is_empty())
    else {
        return false;
    };
    let what = clip(&redact(&summarize(ev.tool_input.as_ref(), root)), WHAT_MAX);
    let next = ClaudeBlocked {
        session_id: ev.session_id.clone(),
        tool,
        what,
        reason: ev
            .reason
            .as_deref()
            .map(|r| clip(&one_line(r), REASON_MAX))
            .filter(|r| !r.is_empty()),
        at: ev.oculpm_ts.clone().unwrap_or_else(|| now.to_string()),
    };
    // 같은 세션이 같은 행동을 다시 막혔으면(되풀이 시도) 한 건이다 — 시각만 새로.
    if let Some(same) = list
        .iter_mut()
        .find(|b| b.session_id == next.session_id && b.tool == next.tool && b.what == next.what)
    {
        if same.at == next.at && same.reason == next.reason {
            return false;
        }
        same.at = next.at;
        same.reason = next.reason;
        return true;
    }
    list.push(next);
    if list.len() > BLOCKED_KEEP {
        let over = list.len() - BLOCKED_KEEP;
        list.drain(..over);
    }
    true
}

/// 도구 인자에서 「무엇을」 한 줄 — 도구마다 사람이 읽는 인자 하나.
pub fn summarize(input: Option<&Value>, root: &Path) -> String {
    let Some(input) = input else {
        return String::new();
    };
    let text = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default();
    // 셸 — 명령의 첫 줄.
    let command = text("command");
    if !command.is_empty() {
        return one_line(command.lines().next().unwrap_or_default());
    }
    // 파일 도구 — 경로. 프로젝트 안이면 그 기준으로.
    for key in ["file_path", "notebook_path", "path"] {
        let raw = text(key);
        if !raw.is_empty() {
            let rel = Path::new(raw)
                .strip_prefix(root)
                .ok()
                .and_then(Path::to_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.replace('\\', "/"));
            return one_line(&rel.unwrap_or_else(|| raw.to_string()));
        }
    }
    // 웹 도구 — 주소나 물음.
    for key in ["url", "query"] {
        let raw = text(key);
        if !raw.is_empty() {
            return one_line(raw);
        }
    }
    String::new()
}

/// 한 줄로 — 제어 글자(탭 · 줄바꿈은 빈칸으로) · 방향 뒤집기 · 폭 없는 글자를 걷고 빈칸을 접는다.
fn one_line(raw: &str) -> String {
    let kept: String = raw
        .chars()
        .filter_map(|c| match c {
            '\t' | '\n' | '\r' => Some(' '),
            c if c.is_control() => None,
            '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}' => None,
            c => Some(c),
        })
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 글자 수로 자른다 — 잘렸으면 끝에 `…`.
fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// [`BLOCKED_STALE_HOURS`] 보다 오래된 것을 지운다. 지운 것이 있으면 `true`. 시각을 못 읽는 것은 둔다.
pub fn drop_stale(list: &mut Vec<ClaudeBlocked>, now: jiff::Timestamp) -> bool {
    let cutoff = now - crate::clock::SignedDuration::from_hours(BLOCKED_STALE_HOURS);
    let before = list.len();
    list.retain(|b| {
        crate::clock::parse_rfc3339(&b.at)
            .map(|t| t >= cutoff)
            .unwrap_or(true)
    });
    list.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::claude_hooks::parse_inbox_slice;

    fn ev(json: &str) -> HookEvent {
        parse_inbox_slice(format!("{json}\n").as_bytes())
            .0
            .remove(0)
    }

    fn plain(s: &str) -> String {
        s.to_string()
    }

    fn denied(session: &str, tool: &str, input: &str, ts: &str) -> HookEvent {
        ev(&format!(
            r#"{{"hook_event_name":"PermissionDenied","session_id":"{session}","tool_name":"{tool}","tool_input":{input},"reason":"Blocked by classifier","oculpm_ts":"{ts}"}}"#
        ))
    }

    /// 실제 payload 모양 — 도구 · 인자 · 이유가 한 건으로 선다.
    #[test]
    fn a_denied_shell_command_becomes_one_line() {
        let mut list = Vec::new();
        let e = denied(
            "s1",
            "Bash",
            r#"{"command":"git push --force origin main\necho done","description":"밀기"}"#,
            "2026-11-22T10:00:00Z",
        );
        assert!(apply_blocked(
            &mut list,
            &e,
            Path::new("/repo"),
            "now",
            &plain
        ));
        assert_eq!(
            list,
            [ClaudeBlocked {
                session_id: "s1".into(),
                tool: "Bash".into(),
                what: "git push --force origin main".into(),
                reason: Some("Blocked by classifier".into()),
                at: "2026-11-22T10:00:00Z".into(),
            }]
        );
    }

    /// 파일 도구는 경로만 — 내용은 들지 않는다. 프로젝트 안이면 그 기준 상대경로.
    #[test]
    fn file_tools_keep_the_path_and_never_the_content() {
        let mut list = Vec::new();
        let root = Path::new("/repo");
        let write = denied(
            "s1",
            "Write",
            r#"{"file_path":"/repo/deploy/prod.env","content":"TOKEN=abc123"}"#,
            "t1",
        );
        assert!(apply_blocked(&mut list, &write, root, "now", &plain));
        assert_eq!(list[0].what, "deploy/prod.env");
        assert!(!format!("{list:?}").contains("abc123"));
        let outside = denied("s1", "Edit", r#"{"file_path":"/etc/hosts"}"#, "t2");
        assert!(apply_blocked(&mut list, &outside, root, "now", &plain));
        assert_eq!(list[1].what, "/etc/hosts");
        let web = denied(
            "s1",
            "WebFetch",
            r#"{"url":"intranet/reports/x","prompt":"p"}"#,
            "t3",
        );
        assert!(apply_blocked(&mut list, &web, root, "now", &plain));
        assert_eq!(list[2].what, "intranet/reports/x");
        // 모르는 도구(MCP)는 이름만.
        let mcp = denied("s1", "mcp__db__drop_table", r#"{"table":"users"}"#, "t4");
        assert!(apply_blocked(&mut list, &mcp, root, "now", &plain));
        assert_eq!(
            (list[3].tool.as_str(), list[3].what.as_str()),
            ("mcp__db__drop_table", "")
        );
    }

    /// 한 줄은 비밀 가리기를 지나고, 제어 · 방향 뒤집기 글자가 걷히고, 길면 잘린다.
    #[test]
    fn the_line_is_redacted_cleaned_and_clipped() {
        let mut list = Vec::new();
        let e = denied(
            "s1",
            "Bash",
            r#"{"command":"curl -H \"Authorization: SECRET\" \u001b[31mhttps://x\u202e/y\tz"}"#,
            "t",
        );
        let redact = |s: &str| s.replace("SECRET", "[REDACTED]");
        assert!(apply_blocked(
            &mut list,
            &e,
            Path::new("/repo"),
            "now",
            &redact
        ));
        assert_eq!(
            list[0].what,
            "curl -H \"Authorization: [REDACTED]\" [31mhttps://x/y z"
        );
        let long = denied(
            "s2",
            "Bash",
            &format!(r#"{{"command":"{}"}}"#, "가".repeat(400)),
            "t",
        );
        assert!(apply_blocked(
            &mut list,
            &long,
            Path::new("/repo"),
            "now",
            &plain
        ));
        assert_eq!(list[1].what.chars().count(), WHAT_MAX);
        assert!(list[1].what.ends_with('…'));
    }

    /// 같은 세션의 같은 행동이 다시 막히면 한 건 — 시각만 새로. 다른 세션은 따로.
    #[test]
    fn a_repeated_attempt_is_one_entry() {
        let mut list = Vec::new();
        let root = Path::new("/repo");
        let cmd = r#"{"command":"rm -rf build"}"#;
        assert!(apply_blocked(
            &mut list,
            &denied("s1", "Bash", cmd, "t1"),
            root,
            "now",
            &plain
        ));
        assert!(!apply_blocked(
            &mut list,
            &denied("s1", "Bash", cmd, "t1"),
            root,
            "now",
            &plain
        ));
        assert!(apply_blocked(
            &mut list,
            &denied("s1", "Bash", cmd, "t2"),
            root,
            "now",
            &plain
        ));
        assert_eq!((list.len(), list[0].at.as_str()), (1, "t2"));
        assert!(apply_blocked(
            &mut list,
            &denied("s2", "Bash", cmd, "t3"),
            root,
            "now",
            &plain
        ));
        assert_eq!(list.len(), 2);
    }

    /// 다른 이벤트 · 세션 없는 줄 · 도구 이름 없는 줄은 아무것도 하지 않는다.
    #[test]
    fn only_permission_denied_with_a_tool_counts() {
        let mut list = Vec::new();
        let root = Path::new("/repo");
        for json in [
            r#"{"hook_event_name":"Notification","session_id":"s1","notification_type":"permission_prompt"}"#,
            r#"{"hook_event_name":"PermissionDenied","session_id":"","tool_name":"Bash"}"#,
            r#"{"hook_event_name":"PermissionDenied","session_id":"s1"}"#,
            r#"{"hook_event_name":"PermissionRequest","session_id":"s1","tool_name":"Bash"}"#,
        ] {
            assert!(
                !apply_blocked(&mut list, &ev(json), root, "now", &plain),
                "{json}"
            );
        }
        assert!(list.is_empty());
        // 훅 시각이 없으면 받은 시각.
        let e = ev(
            r#"{"hook_event_name":"PermissionDenied","session_id":"s1","tool_name":"Bash","tool_input":{"command":"x"}}"#,
        );
        assert!(apply_blocked(
            &mut list,
            &e,
            root,
            "2026-11-22T00:00:00Z",
            &plain
        ));
        assert_eq!(
            (list[0].at.as_str(), list[0].reason.as_deref()),
            ("2026-11-22T00:00:00Z", None)
        );
    }

    /// 넘치면 오래된 것부터 버리고, 오래된 것은 읽을 때 지운다.
    #[test]
    fn the_list_is_capped_and_ages_out() {
        let mut list = Vec::new();
        let root = Path::new("/repo");
        for i in 0..(BLOCKED_KEEP + 5) {
            let cmd = format!(r#"{{"command":"cmd {i}"}}"#);
            apply_blocked(
                &mut list,
                &denied("s1", "Bash", &cmd, "2026-11-22T10:00:00Z"),
                root,
                "now",
                &plain,
            );
        }
        assert_eq!(list.len(), BLOCKED_KEEP);
        assert_eq!(list[0].what, "cmd 5");

        let now = crate::clock::parse_rfc3339("2026-11-22T12:00:00Z").unwrap();
        list.truncate(2);
        list[0].at = "2026-11-21T20:00:00Z".into(); // 16시간 전
        list[1].at = "2026-11-22T11:00:00Z".into();
        assert!(drop_stale(&mut list, now));
        assert_eq!(list.len(), 1);
        assert!(!drop_stale(&mut list, now));
        list[0].at = "알 수 없음".into();
        assert!(!drop_stale(&mut list, now), "시각을 못 읽는 것은 둔다");
    }
}

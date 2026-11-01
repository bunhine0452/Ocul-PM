//! PR-CI0 — Claude Code 훅 브리지 (docs/claude-integration/00-master-plan.md D1·D2).
//!
//! **인박스 파서** — 플러그인 훅이 append 한 `.oculpm/hooks/claude-events.jsonl` 을
//! 바이트 오프셋부터 관용적으로 파싱한다 (완전한 `\n` 종료 라인만 소비,
//! 모르는 필드/이벤트는 무시 — payload 는 버전 종속, 실측은
//! `docs/claude-integration/01-hook-payload-actual.md`). 소비 오프셋의
//! 영속화(SQLite)와 SessionActor 디스패치는 watcher 쪽 소유다.
//!
//! 예전에는 `.claude/settings.local.json` 에 훅을 까는 **설치기**(설정 → 에이전트
//! 탭 토글)도 여기 있었다. 훅은 이제 oculpm 플러그인의 `hooks.json` 이 싣고, 토글은
//! 화면과 함께 사라져 설치기도 걷었다 (2026-11-01).
//!
//! 대화 내용(`prompt`, `last_assistant_message`)이 인박스에 남으므로 이 폴더는
//! `.gitignore` 관리 블록에 포함되며(마스터플랜 §5), 로컬 밖으로 내보내지
//! 않는다.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Deserialize;

/// 훅 이벤트 인박스 (프로젝트 루트 기준). D1.
pub const INBOX_REL: &str = ".oculpm/hooks/claude-events.jsonl";
/// 전부 소비한 인박스가 이 크기를 넘으면 비운다 (D4). 워처가 매 틱 파일을
/// 통째로 읽으므로 상한이 곧 틱당 읽기 비용의 상한이다.
pub const INBOX_COMPACT_BYTES: u64 = 1024 * 1024;
// ─────────────────────────────────────────────────────────────────────────────
// 인박스 파싱 (순수 — watcher 가 소유하는 오프셋/디스패치와 분리)
// ─────────────────────────────────────────────────────────────────────────────

/// 훅 stdin payload 의 관용 파싱형. 실측(01-hook-payload-actual.md) 기준
/// 공통 4필드만 필수 취급하고 나머지는 전부 선택 — 버전 간 필드 변동 흡수.
#[derive(Debug, Clone, Deserialize)]
pub struct HookEvent {
    #[serde(default)]
    pub hook_event_name: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// SessionStart 전용 ("startup" 등).
    #[serde(default)]
    pub source: Option<String>,
    /// SessionEnd 전용.
    #[serde(default)]
    pub reason: Option<String>,
    /// Notification 전용 — `permission_prompt`(약 6초 뒤) · `idle_prompt`(60초 뒤) 등.
    #[serde(default)]
    pub notification_type: Option<String>,
    /// Notification 전용 — Claude 가 사람에게 하는 한 줄.
    #[serde(default)]
    pub message: Option<String>,
    /// 훅 한 줄이 끼운 UTC ISO-8601 시각 (플러그인 hooks.json).
    #[serde(default)]
    pub oculpm_ts: Option<String>,
}

/// 다 읽은 인박스가 [`INBOX_COMPACT_BYTES`] 를 넘으면 비운다 (감사 라운드
/// 2026-09-11 D4). 돌려주는 값은 **다음 소비 오프셋** — 비웠으면 0, 아니면
/// `consumed_to` 그대로.
///
/// 파일은 append 만 되고 지워지는 일이 없어 4.4MB/3주로 자랐고, 워처가 매 틱
/// **통째로** 읽었다. 조건은 "부분 라인이 없다"(`consumed_to == len`) — 훅이
/// 방금 append 한 줄을 자르지 않기 위해서다. 읽기와 truncate 사이의 append 는
/// 잃을 수 있으나 그 창은 마이크로초고 이 경로는 MB 단위로 한 번 온다.
pub async fn compact_inbox(path: &Path, bytes: &[u8], consumed_to: u64) -> u64 {
    let len = bytes.len();
    if consumed_to as usize != len || (len as u64) < INBOX_COMPACT_BYTES {
        return consumed_to;
    }
    if tokio::fs::write(path, b"").await.is_err() {
        return consumed_to;
    }
    tracing::info!(
        target: "oculpm::watcher",
        path = %path.display(),
        bytes = len,
        "hooks inbox compacted — every line was consumed"
    );
    0
}

/// `bytes`(파일의 `offset` 이후 슬라이스)에서 **완전한 라인만** 파싱한다.
/// 반환: (이벤트들, 소비한 바이트 수). 마지막 미종결 라인은 소비하지 않고
/// 다음 라운드로 남긴다 (훅 프로세스가 append 중일 수 있음). 깨진 JSON 라인은
/// 소비하되 건너뛴다 (한 줄 오염이 인박스 전체를 막으면 안 됨).
pub fn parse_inbox_slice(bytes: &[u8]) -> (Vec<HookEvent>, u64) {
    let mut events = Vec::new();
    let mut consumed = 0usize;
    let mut start = 0usize;
    while let Some(nl) = bytes[start..].iter().position(|&b| b == b'\n') {
        let line = &bytes[start..start + nl];
        consumed = start + nl + 1;
        start = consumed;
        let trimmed = line.strip_suffix(b"\r").unwrap_or(line);
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_slice::<HookEvent>(trimmed) {
            Ok(ev) if !ev.hook_event_name.is_empty() => events.push(ev),
            Ok(_) => {
                tracing::warn!(target: "oculpm::claude_hooks", "hook_event_name 없는 인박스 라인 — 건너뜀");
            }
            Err(e) => {
                tracing::warn!(target: "oculpm::claude_hooks", error = %e, "인박스 라인 파싱 실패 — 건너뜀");
            }
        }
    }
    (events, consumed as u64)
}

/// 열린 Claude 세션 id 집합에 이벤트를 반영하고, SessionActor 에 보낼 신호를
/// 결정한다. 여러 터미널의 동시 Claude 세션이 겹칠 때 마지막 SessionEnd 에서만
/// 종료 신호를 내기 위한 집합 연산 (앱 재시작으로 집합이 유실됐으면 미지의
/// SessionEnd 도 보수적으로 종료 신호로 취급 — Idle 이면 actor 가 무시한다).
#[derive(Debug, PartialEq, Eq)]
pub enum HookSignal {
    /// 세션 보장 + 라벨 + 활동 갱신.
    AgentActive,
    /// 즉시 종료.
    AgentEnded,
    /// 무시 (모르는 이벤트 등).
    None,
}

pub fn apply_event(open: &mut BTreeSet<String>, ev: &HookEvent) -> HookSignal {
    match ev.hook_event_name.as_str() {
        // StopFailure — 턴이 API 오류로 끝났다 (플러그인 훅, 2026-10-24). 세션은 살아
        // 있으므로 Stop 과 같은 활동 신호다.
        // Notification · UserPromptSubmit (플러그인 훅, 10-29 #notify-hook) — 세션이 살아 있다는 활동 신호.
        "SessionStart" | "Stop" | "StopFailure" | "Notification" | "UserPromptSubmit" => {
            if !ev.session_id.is_empty() {
                open.insert(ev.session_id.clone());
            }
            HookSignal::AgentActive
        }
        "SessionEnd" => {
            if !ev.session_id.is_empty() {
                open.remove(&ev.session_id);
            }
            if open.is_empty() {
                HookSignal::AgentEnded
            } else {
                HookSignal::AgentActive
            }
        }
        _ => HookSignal::None,
    }
}

/// 훅으로 감지된 에이전트 라벨. v1 은 Claude Code 전용 브리지다.
pub const HOOK_AGENT_LABEL: &str = "claude-code";

// ─────────────────────────────────────────────────────────────────────────────
// H3b — 미기록 세션 신호
// ─────────────────────────────────────────────────────────────────────────────

// 신호 원장(`journal-missing.jsonl`)은 판정의 **산출물**이지 훅 설치기의
// 관심사가 아니다. 쓰는 쪽(`verdict::cli` 의 `--ledger`)과 읽는 쪽이 한
// 파일에 있어야 포맷이 어긋나지 않으므로 `oculpm::verdict::ledger` 로 옮겼고,
// 여기서는 기존 호출자(commands/claude_hooks.rs)를 위해 이름만 잇는다.
pub use crate::oculpm::verdict::ledger::{
    journal_missing_signals, parse_journal_missing, JournalMissingSignal, JOURNAL_MISSING_REL,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn line(s: &str) -> String {
        format!("{s}\n")
    }

    // ─── 인박스 파싱 ────────────────────────────────────────────────────────

    /// D4 — 부분 라인이 남았거나 작으면 그대로, 다 읽었고 크면 비우고 0.
    #[tokio::test]
    async fn compact_only_when_fully_consumed_and_large() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("inbox.jsonl");
        let big = INBOX_COMPACT_BYTES as usize + 10;
        let bytes = vec![b'x'; big];
        std::fs::write(&p, &bytes).unwrap();
        // 부분 라인이 남았다 → 손대지 않는다.
        assert_eq!(
            compact_inbox(&p, &bytes, big as u64 - 5).await,
            big as u64 - 5
        );
        assert_eq!(std::fs::metadata(&p).unwrap().len() as usize, big);
        // 작다 → 손대지 않는다.
        assert_eq!(compact_inbox(&p, &bytes[..10], 10).await, 10);
        // 다 읽었고 크다 → 비우고 0.
        assert_eq!(compact_inbox(&p, &bytes, big as u64).await, 0);
        assert_eq!(std::fs::metadata(&p).unwrap().len(), 0);
    }

    #[test]
    fn parse_complete_lines_and_leave_partial_tail() {
        let mut buf = String::new();
        buf.push_str(&line(
            r#"{"session_id":"a","hook_event_name":"SessionStart","transcript_path":"/t.jsonl","cwd":"/p"}"#,
        ));
        buf.push_str(&line(r#"{"session_id":"a","hook_event_name":"Stop"}"#));
        buf.push_str(r#"{"session_id":"a","hook_event_na"#); // 미종결 — append 중
        let (events, consumed) = parse_inbox_slice(buf.as_bytes());
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].hook_event_name, "SessionStart");
        assert_eq!(events[0].transcript_path.as_deref(), Some("/t.jsonl"));
        assert_eq!(events[1].hook_event_name, "Stop");
        // 미종결 라인은 소비하지 않는다.
        let tail = &buf.as_bytes()[consumed as usize..];
        assert!(tail.starts_with(br#"{"session_id":"a","hook_event_na"#));
    }

    #[test]
    fn malformed_line_is_skipped_but_consumed() {
        let mut buf = String::new();
        buf.push_str(&line("not-json"));
        buf.push_str(&line(
            r#"{"session_id":"b","hook_event_name":"SessionEnd","reason":"other"}"#,
        ));
        let (events, consumed) = parse_inbox_slice(buf.as_bytes());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].hook_event_name, "SessionEnd");
        assert_eq!(events[0].reason.as_deref(), Some("other"));
        assert_eq!(consumed as usize, buf.len());
    }

    #[test]
    fn unknown_fields_and_events_are_tolerated() {
        let buf = line(
            r#"{"session_id":"c","hook_event_name":"PostToolUse","tool":"Bash","tool_input":{"command":"ls"},"future_field":123}"#,
        );
        let (events, _) = parse_inbox_slice(buf.as_bytes());
        assert_eq!(events.len(), 1);
        let mut open = BTreeSet::new();
        assert_eq!(apply_event(&mut open, &events[0]), HookSignal::None);
    }

    // ─── 열린 세션 집합 ─────────────────────────────────────────────────────

    #[test]
    fn overlapping_sessions_end_only_on_last() {
        let mut open = BTreeSet::new();
        let ev = |name: &str, sid: &str| HookEvent {
            hook_event_name: name.into(),
            session_id: sid.into(),
            transcript_path: None,
            cwd: None,
            source: None,
            reason: None,
            notification_type: None,
            message: None,
            oculpm_ts: None,
        };
        assert_eq!(
            apply_event(&mut open, &ev("SessionStart", "s1")),
            HookSignal::AgentActive
        );
        assert_eq!(
            apply_event(&mut open, &ev("SessionStart", "s2")),
            HookSignal::AgentActive
        );
        // s1 종료 — s2 가 아직 열려 있으므로 Active 유지.
        assert_eq!(
            apply_event(&mut open, &ev("SessionEnd", "s1")),
            HookSignal::AgentActive
        );
        // 마지막 s2 종료 — 이제 종료 신호.
        assert_eq!(
            apply_event(&mut open, &ev("SessionEnd", "s2")),
            HookSignal::AgentEnded
        );
        // 앱 재시작으로 집합 유실 후의 미지 SessionEnd → 보수적 종료.
        assert_eq!(
            apply_event(&mut open, &ev("SessionEnd", "ghost")),
            HookSignal::AgentEnded
        );
        // API 오류로 끝난 턴(StopFailure)도 세션을 연다 — Stop 과 같은 활동 신호.
        assert_eq!(
            apply_event(&mut open, &ev("StopFailure", "s3")),
            HookSignal::AgentActive
        );
        assert!(open.contains("s3"));
    }
}

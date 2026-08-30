//! PR-CI0 — Claude Code 훅 브리지 (docs/claude-integration/00-master-plan.md D1·D2).
//!
//! 두 책임을 가진다:
//!
//! 1. **설치기** — 프로젝트의 `.claude/settings.local.json` 에 SessionStart /
//!    Stop / SessionEnd 훅(우리 서명이 든 `cat` append 한 줄)을 옵인으로
//!    추가·제거한다. JSON 은 마크다운과 달리 주석 마커를 못 쓰므로, 우리
//!    엔트리는 **command 문자열에 든 인박스 경로 조각**([`COMMAND_SIGNATURE`])
//!    으로 식별한다. 사용자가 직접 만든 훅은 절대 건드리지 않고, 파싱이
//!    실패하는 파일은 **절대 덮어쓰지 않는다** (손상 방지가 설치보다 우선).
//! 2. **인박스 파서** — 훅이 append 한 `.oculpm/hooks/claude-events.jsonl` 을
//!    바이트 오프셋부터 관용적으로 파싱한다 (완전한 `\n` 종료 라인만 소비,
//!    모르는 필드/이벤트는 무시 — payload 는 버전 종속, 실측은
//!    `docs/claude-integration/01-hook-payload-actual.md`). 소비 오프셋의
//!    영속화(SQLite)와 SessionActor 디스패치는 watcher 쪽 소유다.
//!
//! 대화 내용(`prompt`, `last_assistant_message`)이 인박스에 남으므로 이 폴더는
//! `.gitignore` 관리 블록에 포함되며(마스터플랜 §5), 로컬 밖으로 내보내지
//! 않는다.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};

/// 훅 이벤트 인박스 (프로젝트 루트 기준). D1.
pub const INBOX_REL: &str = ".oculpm/hooks/claude-events.jsonl";
/// 인박스 폴더 (gitignore 대상).
pub const HOOKS_DIR_REL: &str = ".oculpm/hooks";
/// 훅 설정 파일 (프로젝트 루트 기준). D2 — 비공유 local 스코프.
pub const SETTINGS_REL: &str = ".claude/settings.local.json";
/// 우리 훅 엔트리의 식별 서명 — command 문자열에 이 조각이 있으면 ocul-pm 소유.
const COMMAND_SIGNATURE: &str = ".oculpm/hooks/claude-events.jsonl";
/// v1 구독 이벤트 3종. PostToolUse 는 이벤트 폭주 대비 효용이 낮아 제외
/// (파일 변경은 이미 watcher 가 본다 — 마스터플랜 D1).
pub const HOOK_EVENTS: [&str; 3] = ["SessionStart", "Stop", "SessionEnd"];

/// 훅이 실행할 커맨드 한 줄. 순수 append — 네트워크·외부 실행 없음.
/// `CLAUDE_PROJECT_DIR` 부재 시 훅 cwd(=프로젝트 루트)로 폴백 (실측 확인).
fn hook_command() -> String {
    format!(
        "mkdir -p \"${{CLAUDE_PROJECT_DIR:-.}}/{HOOKS_DIR_REL}\" && cat >> \"${{CLAUDE_PROJECT_DIR:-.}}/{INBOX_REL}\""
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// 설치 상태
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ClaudeHooksStatus {
    /// 3개 이벤트 전부에 우리 엔트리가 있다.
    pub installed: bool,
    /// 일부 이벤트에만 있다 (외부 편집으로 인한 드리프트 — 재설치 권장).
    pub partial: bool,
    /// 우리 것 아닌 훅 엔트리도 존재한다 (정보 표시용 — 건드리지 않음).
    pub foreign_hooks: bool,
    /// `.claude/settings.local.json` 절대경로 (UI "파일 열기"용).
    pub settings_path: String,
    /// 인박스 파일 현재 크기 (0 = 없음). 성장 관찰용. u32 saturating —
    /// specta 가 u64(BigInt) 내보내기를 금지하고, 4GiB 넘는 인박스는 표시
    /// 정밀도가 무의미하다.
    pub inbox_bytes: u32,
}

fn settings_path(root: &Path) -> PathBuf {
    root.join(SETTINGS_REL)
}

/// 파일 읽기 → JSON Value. 없으면 빈 오브젝트. **파싱 실패는 에러** — 사용자
/// 파일을 덮어쓰지 않기 위해 설치/제거를 중단시킨다.
fn read_settings(root: &Path) -> OculpmResult<Value> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| OculpmError::Io {
        path: path.clone(),
        source: e,
    })?;
    if raw.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&raw).map_err(|e| OculpmError::JsonParse { path, source: e })
}

/// 한 이벤트 배열에서 우리 엔트리(내부 hooks 의 command 에 서명 포함) 존재 여부.
fn event_has_ours(event_arr: &[Value]) -> bool {
    event_arr.iter().any(entry_is_ours)
}

fn entry_is_ours(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| c.contains(COMMAND_SIGNATURE))
            })
        })
        .unwrap_or(false)
}

fn compute_status(root: &Path, settings: &Value) -> ClaudeHooksStatus {
    let hooks = settings.get("hooks").and_then(Value::as_object);
    let mut ours = 0usize;
    let mut foreign = false;
    if let Some(hooks) = hooks {
        for (event, arr) in hooks {
            let arr = arr.as_array().cloned().unwrap_or_default();
            let has_ours = event_has_ours(&arr);
            if HOOK_EVENTS.contains(&event.as_str()) && has_ours {
                ours += 1;
            }
            if arr.iter().any(|e| !entry_is_ours(e)) {
                foreign = true;
            }
        }
    }
    let inbox_bytes = std::fs::metadata(root.join(INBOX_REL))
        .map(|m| u32::try_from(m.len()).unwrap_or(u32::MAX))
        .unwrap_or(0);
    ClaudeHooksStatus {
        installed: ours == HOOK_EVENTS.len(),
        partial: ours > 0 && ours < HOOK_EVENTS.len(),
        foreign_hooks: foreign,
        settings_path: settings_path(root).to_string_lossy().to_string(),
        inbox_bytes,
    }
}

/// 현재 설치 상태 조회 (쓰기 없음). 파싱 실패도 상태로 강등하지 않고 에러로
/// 올린다 — UI 가 "설정 파일이 깨져 있음"을 구분해 보여줄 수 있게.
pub fn status(root: &Path) -> OculpmResult<ClaudeHooksStatus> {
    let settings = read_settings(root)?;
    Ok(compute_status(root, &settings))
}

/// 훅 설치 (멱등). 기존 사용자 훅·미지의 키는 그대로 보존한다.
pub fn install(root: &Path) -> OculpmResult<ClaudeHooksStatus> {
    let mut settings = read_settings(root)?;
    if !settings.is_object() {
        return Err(OculpmError::InvalidConfig(
            "The top level of settings.local.json is not a JSON object".into(),
        ));
    }
    let obj = settings.as_object_mut().expect("checked is_object above");
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        return Err(OculpmError::InvalidConfig(
            "\"hooks\" in settings.local.json is not an object".into(),
        ));
    }
    let hooks = hooks.as_object_mut().expect("checked is_object above");
    for event in HOOK_EVENTS {
        let arr = hooks
            .entry(event.to_string())
            .or_insert_with(|| Value::Array(vec![]));
        let Some(arr) = arr.as_array_mut() else {
            return Err(OculpmError::InvalidConfig(format!(
                "hooks.{event} in settings.local.json is not an array"
            )));
        };
        if !event_has_ours(arr) {
            arr.push(json!({
                "hooks": [{ "type": "command", "command": hook_command() }]
            }));
        }
    }
    write_settings(root, &settings)?;
    // 인박스 폴더를 미리 만들어 둔다 (훅 커맨드도 mkdir -p 하지만, watcher 가
    // 폴더 존재를 전제로 경로 라우팅을 하므로 설치 시점에 보장).
    std::fs::create_dir_all(root.join(HOOKS_DIR_REL)).map_err(|e| OculpmError::Io {
        path: root.join(HOOKS_DIR_REL),
        source: e,
    })?;
    Ok(compute_status(root, &settings))
}

/// 훅 제거 (멱등). 우리 서명 엔트리만 걷어내고, 비게 된 배열/오브젝트 키는
/// 정리한다. 인박스 파일·폴더는 남긴다 (미소비 이벤트 보존 — 사용자가 지움).
pub fn uninstall(root: &Path) -> OculpmResult<ClaudeHooksStatus> {
    let mut settings = read_settings(root)?;
    let Some(obj) = settings.as_object_mut() else {
        return Ok(compute_status(root, &settings));
    };
    if let Some(hooks) = obj.get_mut("hooks").and_then(Value::as_object_mut) {
        let events: Vec<String> = hooks.keys().cloned().collect();
        for event in events {
            if let Some(arr) = hooks.get_mut(&event).and_then(Value::as_array_mut) {
                arr.retain(|entry| !entry_is_ours(entry));
                if arr.is_empty() {
                    hooks.remove(&event);
                }
            }
        }
        if hooks.is_empty() {
            obj.remove("hooks");
        }
    }
    write_settings(root, &settings)?;
    Ok(compute_status(root, &settings))
}

fn write_settings(root: &Path, settings: &Value) -> OculpmResult<()> {
    let path = settings_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| OculpmError::Io {
            path: parent.to_path_buf(),
            source: e,
        })?;
    }
    let mut pretty = serde_json::to_string_pretty(settings).map_err(OculpmError::JsonSerialize)?;
    pretty.push('\n');
    atomic_io::write_atomic(&path, pretty.as_bytes())
}

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
        "SessionStart" | "Stop" => {
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
// H3b — 미기록 세션 신호 (plugin SessionEnd → journal-missing.jsonl)
// ─────────────────────────────────────────────────────────────────────────────

/// 플러그인 SessionEnd 훅이 "일지 없이 끝난 세션"을 append 하는 신호 파일
/// (프로젝트 루트 기준). 근거: benchmarks/agentic 실측 — 규칙·도구가 주입돼도
/// 헤드리스 단발 세션의 기록 준수 0/12. 훅이 200줄 초과 시 최근 100줄로 자체
/// 트림하므로 **오프셋 소비가 불가** — 항상 전체를 읽고 시간으로 필터한다.
pub const JOURNAL_MISSING_REL: &str = ".oculpm/hooks/journal-missing.jsonl";

/// 일지 없이 끝난 세션 1건. `ts` 는 훅이 기록한 UTC ISO 문자열 그대로 —
/// 로컬 시각 변환은 UI 몫이다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct JournalMissingSignal {
    pub ts: String,
    pub session_id: String,
}

/// 신호 라인의 관용 파싱형 — 필드 누락은 기본값으로 흡수하고 검증은
/// [`parse_journal_missing`] 이 한다.
#[derive(Debug, Deserialize)]
struct RawJournalMissingLine {
    #[serde(default)]
    ts: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    kind: String,
}

/// 신호 파일 내용에서 `cutoff` 이후의 유효 라인만 추린다 (최신 우선 정렬).
/// 깨진 JSON / ts 파싱 불가 / 빈 session_id / 다른 kind 라인은 조용히
/// 건너뛴다 — 한 줄 오염이 카드 전체를 막으면 안 된다 (인박스 파서와 동일
/// 철학).
pub fn parse_journal_missing(
    content: &str,
    cutoff: chrono::DateTime<chrono::Utc>,
) -> Vec<JournalMissingSignal> {
    let mut rows: Vec<(chrono::DateTime<chrono::Utc>, JournalMissingSignal)> = content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let raw: RawJournalMissingLine = serde_json::from_str(trimmed).ok()?;
            // kind 누락은 허용(구버전 훅), 다른 kind 는 미래 신호용으로 제외.
            if !raw.kind.is_empty() && raw.kind != "journal_missing" {
                return None;
            }
            if raw.session_id.is_empty() {
                return None;
            }
            let dt = chrono::DateTime::parse_from_rfc3339(&raw.ts)
                .ok()?
                .with_timezone(&chrono::Utc);
            (dt >= cutoff).then_some({
                (
                    dt,
                    JournalMissingSignal {
                        ts: raw.ts,
                        session_id: raw.session_id,
                    },
                )
            })
        })
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.0));
    rows.into_iter().map(|(_, s)| s).collect()
}

/// 프로젝트 root 의 신호 파일을 읽어 최근 `days`일 내 항목을 반환한다.
/// 파일 없음/읽기 실패는 빈 배열 (신호는 옵인 플러그인 훅 전용 — 없는 게
/// 정상 상태다).
pub fn journal_missing_signals(root: &Path, days: u32) -> Vec<JournalMissingSignal> {
    let path = root.join(JOURNAL_MISSING_REL);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let days = i64::from(days.clamp(1, 365));
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
    let signals = parse_journal_missing(&content, cutoff);

    // 해소 필터 — 신호 이후 **어떤 일지든** 생겼으면(수동 사후 기록·앱의
    // auto_journal_draft 초안 포함) 그 신호는 낡은 경고다. append-only 신호가
    // 7일간 거짓 경고로 남는 것(리뷰 MED)을 읽기 시점에 걷어낸다. 세션 단위
    // 귀속이 아니라 보수적 근사다: 이후 세션이 기록을 재개했다면 과거 미기록
    // 경고는 행동 유도력이 없는 소음이라 함께 접는다.
    let newest = newest_journal_mtime(root);
    match newest {
        Some(m) => signals
            .into_iter()
            .filter(|s| {
                chrono::DateTime::parse_from_rfc3339(&s.ts)
                    .map(|t| t.timestamp() > m)
                    .unwrap_or(false)
            })
            .collect(),
        None => signals,
    }
}

/// `.oculpm/journal/**/*.md` 의 최대 mtime (unix 초). 일지가 없으면 `None`.
fn newest_journal_mtime(root: &Path) -> Option<i64> {
    fn walk(dir: &Path, best: &mut Option<i64>) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, best);
            } else if p.extension().is_some_and(|e| e == "md") {
                if let Some(t) = std::fs::metadata(&p)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                {
                    let secs = t.as_secs() as i64;
                    if best.map(|b| secs > b).unwrap_or(true) {
                        *best = Some(secs);
                    }
                }
            }
        }
    }
    let mut best = None;
    walk(&root.join(".oculpm").join("journal"), &mut best);
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn line(s: &str) -> String {
        format!("{s}\n")
    }

    // ─── 인박스 파싱 ────────────────────────────────────────────────────────

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
    }

    // ─── H3b — 미기록 세션 신호 파싱 ────────────────────────────────────────

    fn cutoff(s: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn journal_missing_parses_valid_lines_newest_first() {
        let mut buf = String::new();
        buf.push_str(&line(
            r#"{"ts":"2026-07-29T01:00:00Z","session_id":"aaa11111","kind":"journal_missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T02:30:00Z","session_id":"bbb22222","kind":"journal_missing"}"#,
        ));
        let rows = parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z"));
        assert_eq!(rows.len(), 2);
        // 최신 우선.
        assert_eq!(rows[0].session_id, "bbb22222");
        assert_eq!(rows[0].ts, "2026-07-30T02:30:00Z");
        assert_eq!(rows[1].session_id, "aaa11111");
    }

    #[test]
    fn journal_missing_skips_broken_and_foreign_lines() {
        let mut buf = String::new();
        buf.push_str(&line("not-json"));
        buf.push_str(&line(
            r#"{"ts":"garbage","session_id":"x","kind":"journal_missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"","kind":"journal_missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"y","kind":"future_kind"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"ok-sid"}"#,
        )); // kind 누락 허용
        buf.push('\n'); // 빈 줄 허용
        let rows = parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "ok-sid");
    }

    #[test]
    fn journal_missing_filters_by_cutoff() {
        let mut buf = String::new();
        buf.push_str(&line(
            r#"{"ts":"2026-07-10T00:00:00Z","session_id":"old","kind":"journal_missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-29T00:00:00Z","session_id":"recent","kind":"journal_missing"}"#,
        ));
        let rows = parse_journal_missing(&buf, cutoff("2026-07-23T00:00:00Z"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "recent");
    }

    #[test]
    fn journal_missing_signals_missing_file_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(journal_missing_signals(tmp.path(), 7).is_empty());
    }

    #[test]
    fn journal_missing_signals_reads_recent_from_disk() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join(".oculpm/hooks");
        std::fs::create_dir_all(&dir).unwrap();
        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::hours(1)).to_rfc3339();
        let stale = (now - chrono::Duration::days(30)).to_rfc3339();
        std::fs::write(
            tmp.path().join(JOURNAL_MISSING_REL),
            format!(
                "{}\n{}\n",
                format_args!(r#"{{"ts":"{stale}","session_id":"stale","kind":"journal_missing"}}"#),
                format_args!(
                    r#"{{"ts":"{recent}","session_id":"fresh","kind":"journal_missing"}}"#
                ),
            ),
        )
        .unwrap();
        let rows = journal_missing_signals(tmp.path(), 7);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "fresh");
    }

    // ─── 설치/제거/드리프트 ─────────────────────────────────────────────────

    #[test]
    fn install_then_status_then_uninstall_roundtrip() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        let st = install(root).unwrap();
        assert!(st.installed && !st.partial);

        // 멱등 — 두 번 설치해도 엔트리가 늘지 않는다.
        install(root).unwrap();
        let raw = std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        for event in HOOK_EVENTS {
            assert_eq!(v["hooks"][event].as_array().unwrap().len(), 1, "{event}");
        }

        let st = uninstall(root).unwrap();
        assert!(!st.installed && !st.partial);
        let raw = std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("hooks").is_none(), "빈 hooks 오브젝트는 정리돼야 함");
    }

    #[test]
    fn install_preserves_foreign_content_and_uninstall_keeps_it() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".claude")).unwrap();
        std::fs::write(
            root.join(SETTINGS_REL),
            r#"{
  "permissions": { "allow": ["Bash(ls:*)"] },
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "echo user-own" } ] } ],
    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo guard" } ] } ]
  }
}"#,
        )
        .unwrap();

        let st = install(root).unwrap();
        assert!(st.installed);
        assert!(st.foreign_hooks);

        let v: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap())
                .unwrap();
        // 사용자 키·훅 보존 + Stop 에는 사용자 것과 우리 것 공존.
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls:*)");
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);

        let st = uninstall(root).unwrap();
        assert!(!st.installed);
        assert!(st.foreign_hooks, "제거 후에도 사용자 훅은 남는다");
        let v: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap())
                .unwrap();
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(
            v["hooks"]["Stop"][0]["hooks"][0]["command"], "echo user-own",
            "남은 것은 사용자 훅이어야 함"
        );
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls:*)");
    }

    #[test]
    fn broken_settings_json_is_never_overwritten() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".claude")).unwrap();
        std::fs::write(root.join(SETTINGS_REL), "{ not json !!").unwrap();

        assert!(status(root).is_err());
        assert!(install(root).is_err());
        assert!(uninstall(root).is_err());
        // 원본이 그대로 남아야 한다.
        assert_eq!(
            std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap(),
            "{ not json !!"
        );
    }

    #[test]
    fn partial_install_reports_drift() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        install(root).unwrap();
        // 외부 편집 시뮬레이션 — Stop 이벤트에서 우리 엔트리를 지운다.
        let mut v: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(SETTINGS_REL)).unwrap())
                .unwrap();
        v["hooks"].as_object_mut().unwrap().remove("Stop");
        std::fs::write(root.join(SETTINGS_REL), v.to_string()).unwrap();

        let st = status(root).unwrap();
        assert!(!st.installed);
        assert!(st.partial, "3개 중 2개만 남음 → 드리프트");
        // 재설치가 고친다.
        let st = install(root).unwrap();
        assert!(st.installed && !st.partial);
    }

    /// 크로스-언어 계약 — session-end.sh 의 printf 템플릿과 정확히 같은
    /// 라인이 파싱돼야 한다 (plugin_manifest 가 스크립트 쪽 문자열을 고정).
    #[test]
    fn parses_exact_hook_template_line() {
        let line = "{\"ts\":\"2026-07-31T12:00:00Z\",\"session_id\":\"abc-123\",\"kind\":\"journal_missing\"}\n";
        let cutoff = chrono::Utc::now() - chrono::Duration::days(365);
        let got = parse_journal_missing(line, cutoff);
        assert_eq!(got.len(), 1, "훅 템플릿 라인이 파싱돼야 한다");
        assert_eq!(got[0].session_id, "abc-123");
    }

    /// 해소 필터 — 신호 이후 일지가 생기면(사후 기록·자동 초안) 낡은 경고를
    /// 걷어낸다. 신호가 일지보다 나중이면 유지 (리뷰 MED 회귀).
    #[test]
    fn journal_missing_resolved_by_later_journal() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
        let jdir = root.join(".oculpm/journal/20260731/Chores");
        std::fs::create_dir_all(&jdir).unwrap();

        let old_ts = (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        std::fs::write(
            root.join(JOURNAL_MISSING_REL),
            format!("{{\"ts\":\"{old_ts}\",\"session_id\":\"s1\",\"kind\":\"journal_missing\"}}\n"),
        )
        .unwrap();
        std::fs::write(jdir.join("0001_chore_x.md"), "x").unwrap();
        assert!(
            journal_missing_signals(root, 7).is_empty(),
            "사후 일지가 신호를 해소"
        );

        let new_ts = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        std::fs::write(
            root.join(JOURNAL_MISSING_REL),
            format!("{{\"ts\":\"{new_ts}\",\"session_id\":\"s2\",\"kind\":\"journal_missing\"}}\n"),
        )
        .unwrap();
        let got = journal_missing_signals(root, 7);
        assert_eq!(got.len(), 1, "일지 이후의 신호는 유지");
        assert_eq!(got[0].session_id, "s2");
    }
}

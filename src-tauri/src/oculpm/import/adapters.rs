//! 대화 export 파서 — 파일 바이트를 후보 목록으로 (Phase 7 #import-adapters).
//!
//! # 어댑터 하나, 방언 여럿
//!
//! Claude 의 export 는 최상위 배열이고 메시지가 `chat_messages`, 발화자가
//! `sender` 다. 다른 도구는 `{conversations: [...]}` 에 `messages` · `role` 을
//! 쓴다. 두 벌의 `serde` 구조체를 두면 필드 하나가 바뀔 때마다 임포트가 통째로
//! 죽는다 — 그래서 `serde_json::Value` 위에서 **관용적으로 읽는다**. 못 읽은
//! 대화는 조용히 사라지지 않고 [`ImportSkip`] 으로 나온다.
//!
//! # 순수하다
//!
//! 여기에는 IO 도 시계도 없다. 입력이 같으면 후보의 `slug` 까지 언제나 같다 —
//! 중복 스킵이 그 성질 위에 서 있기 때문이다.

use serde::Serialize;
use serde_json::Value;

use crate::oculpm::spec::EntryType;

/// 대화 하나가 실어 나를 수 있는 본문 상한 (문자). 넘으면 앞뒤를 남기고
/// 가운데를 잘라낸다 — 모델에 통째로 밀어 넣어 봐야 예산만 태운다.
pub const MAX_TRANSCRIPT_CHARS: usize = 24_000;
/// 후보 수 상한. 정상 export 는 수백 건이다.
pub const MAX_CONVERSATIONS: usize = 5_000;
/// 잘라 낼 때 앞/뒤로 남기는 분량.
const HEAD_CHARS: usize = 16_000;
const TAIL_CHARS: usize = MAX_TRANSCRIPT_CHARS - HEAD_CHARS;

/// 목록에 뜨는 후보 한 건. 본문(`transcript`)은 여기 없다 — 목록 화면이
/// 수천 건의 전문을 들고 있을 이유가 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ImportCandidate {
    /// 아카이브가 준 안정 id (`uuid`/`id`). 없으면 내용에서 파생한다.
    pub source_id: String,
    /// 결정적 슬러그 — 중복 판정의 열쇠다. 같은 대화는 언제나 같은 값.
    pub slug: String,
    pub title: String,
    /// 원본 작성 시각 (RFC3339). 워크데이·파일명이 전부 여기서 나온다.
    pub created_at: String,
    /// `created_at` 의 날짜 부분 (`YYYYMMDD`) — 목록 정렬·표시용.
    pub workday: String,
    pub message_count: u32,
    pub char_count: u32,
    /// 제목·본문의 신호로 추정한 갈래. 사용자가 임포트 전에 바꿀 수 있다.
    pub guessed_type: EntryType,
}

/// 받아들이지 못한 대화 — 조용히 버리지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ImportSkip {
    /// 사람이 알아볼 만한 표식 (제목 또는 인덱스).
    pub label: String,
    /// 사유 코드 (UI 언어 아님 — 화면이 i18n 키로 옮긴다).
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedConversation {
    pub candidate: ImportCandidate,
    /// 모델에게 갈 대화 전문 (`## 사용자` / `## 어시스턴트` 로 구분).
    pub transcript: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParseOutcome {
    pub conversations: Vec<ParsedConversation>,
    pub skipped: Vec<ImportSkip>,
}

/// JSON 바이트 → 대화 목록. 최상위가 배열이든 `{conversations: […]}` 든 읽는다.
pub fn parse_json(bytes: &[u8]) -> Result<ParseOutcome, String> {
    let root: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let list = conversation_list(&root).ok_or("no conversation array in this file")?;

    let mut out = ParseOutcome::default();
    for (i, raw) in list.iter().take(MAX_CONVERSATIONS).enumerate() {
        match parse_one(raw) {
            Ok(c) => out.conversations.push(c),
            Err(reason) => out.skipped.push(ImportSkip {
                label: str_field(raw, &["name", "title", "subject"])
                    .unwrap_or_else(|| format!("#{}", i + 1)),
                reason,
            }),
        }
    }
    if list.len() > MAX_CONVERSATIONS {
        out.skipped.push(ImportSkip {
            label: format!("+{}", list.len() - MAX_CONVERSATIONS),
            reason: "too_many_conversations".to_string(),
        });
    }
    Ok(out)
}

/// 최상위에서 대화 배열을 찾는다. 배열 그 자체이거나, 잘 알려진 키 아래에 있다.
fn conversation_list(root: &Value) -> Option<&Vec<Value>> {
    if let Some(a) = root.as_array() {
        return Some(a);
    }
    for key in ["conversations", "chats", "threads", "data", "items"] {
        if let Some(a) = root.get(key).and_then(Value::as_array) {
            return Some(a);
        }
    }
    None
}

fn parse_one(raw: &Value) -> Result<ParsedConversation, String> {
    let messages = message_list(raw).ok_or("no messages")?;
    let turns: Vec<(bool, String)> = messages.iter().filter_map(parse_message).collect();
    if turns.is_empty() {
        return Err("no readable messages".to_string());
    }

    let title = str_field(raw, &["name", "title", "subject"])
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| first_line(&turns[0].1));
    let title = clamp_title(&title);

    let created_at = timestamp_field(raw, &["created_at", "create_time", "createdAt", "created"])
        .or_else(|| {
            messages
                .first()
                .and_then(|m| timestamp_field(m, &["created_at", "create_time", "createdAt"]))
        })
        .ok_or("no timestamp")?;
    let workday = created_at
        .get(..10)
        .map(|d| d.replace('-', ""))
        .unwrap_or_default();

    let source_id = str_field(raw, &["uuid", "id", "conversation_id"])
        .filter(|s| !s.trim().is_empty())
        // id 없는 방언 — 제목+시각+첫 발화로 안정 id 를 만든다. 같은 파일을
        // 두 번 읽어도 같은 값이므로 중복 스킵이 계속 성립한다.
        .unwrap_or_else(|| short_hash(&format!("{title}\u{1}{created_at}\u{1}{}", turns[0].1)));

    let transcript = render_transcript(&turns);
    let char_count = transcript.chars().count() as u32;
    let guessed_type = guess_type(&title, &transcript);

    Ok(ParsedConversation {
        candidate: ImportCandidate {
            slug: slug_for(&source_id, &title),
            source_id,
            title,
            created_at,
            workday,
            message_count: turns.len() as u32,
            char_count,
            guessed_type,
        },
        transcript,
    })
}

fn message_list(raw: &Value) -> Option<&Vec<Value>> {
    for key in ["chat_messages", "messages", "turns"] {
        if let Some(a) = raw.get(key).and_then(Value::as_array) {
            return Some(a);
        }
    }
    None
}

/// `(사용자인가, 본문)`. 본문이 비면 버린다 (첨부만 있는 턴 등).
fn parse_message(m: &Value) -> Option<(bool, String)> {
    let role = str_field(m, &["sender", "role", "author"]).unwrap_or_default();
    let is_user = matches!(role.as_str(), "human" | "user");
    let text = message_text(m);
    let text = text.trim();
    (!text.is_empty()).then(|| (is_user, text.to_string()))
}

/// 본문은 문자열이거나 `[{type:"text", text:"…"}]` 조각 배열이다.
fn message_text(m: &Value) -> String {
    if let Some(t) = m.get("text").and_then(Value::as_str) {
        if !t.trim().is_empty() {
            return t.to_string();
        }
    }
    match m.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| {
                p.as_str()
                    .map(str::to_string)
                    .or_else(|| p.get("text").and_then(Value::as_str).map(str::to_string))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn str_field(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_str))
        .map(str::to_string)
}

/// 시각은 RFC3339 문자열이거나 epoch 초(부동소수)다. 어느 쪽이든 RFC3339 로.
fn timestamp_field(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        match v.get(*k) {
            Some(Value::String(s)) => {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                    return Some(dt.to_rfc3339());
                }
            }
            Some(Value::Number(n)) => {
                let secs = n.as_f64()?;
                let dt = chrono::DateTime::from_timestamp(secs as i64, 0)?;
                return Some(dt.fixed_offset().to_rfc3339());
            }
            _ => {}
        }
    }
    None
}

fn first_line(s: &str) -> String {
    s.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// 제목 상한 — export 의 제목은 첫 발화 통째인 경우가 있다.
fn clamp_title(s: &str) -> String {
    let s = s.trim();
    let mut out: String = s.chars().take(120).collect();
    if s.chars().count() > 120 {
        out.push('…');
    }
    if out.is_empty() {
        // i18n-ignore-next-line -- 디스크에 적히는 기본 제목 (UI 문자열 아님).
        out.push_str("(제목 없음)");
    }
    out
}

fn render_transcript(turns: &[(bool, String)]) -> String {
    let mut out = String::new();
    for (is_user, text) in turns {
        // i18n-ignore-next-line -- LLM 프롬프트 본문 (UI 문자열이 아니다).
        out.push_str(if *is_user {
            "## 사용자\n"
        } else {
            "## 어시스턴트\n"
        });
        out.push_str(text);
        out.push_str("\n\n");
    }
    clamp_transcript(out.trim_end())
}

/// 가운데를 잘라내고 잘렸다는 사실을 남긴다 — 앞(문제 제기)과 뒤(결론)가
/// 일지에 가장 필요한 부분이다.
fn clamp_transcript(s: &str) -> String {
    if s.chars().count() <= MAX_TRANSCRIPT_CHARS {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let head: String = chars[..HEAD_CHARS].iter().collect();
    let tail: String = chars[chars.len() - TAIL_CHARS..].iter().collect();
    // i18n-ignore-next-line -- LLM 프롬프트 본문 (UI 문자열이 아니다).
    format!(
        "{head}\n\n… (중략: {} 자) …\n\n{tail}",
        chars.len() - MAX_TRANSCRIPT_CHARS
    )
}

/// 갈래 추정. 결정적 키워드 표 — 맞히지 못하면 `Chore` 다 (가장 무해한 기본값).
/// 순서가 곧 우선순위다: 에러 > 버그 > 리팩토링 > 기능.
fn guess_type(title: &str, body: &str) -> EntryType {
    const TABLE: &[(EntryType, &[&str])] = &[
        (
            EntryType::Error,
            &[
                "stack trace",
                "traceback",
                "exception",
                "panic",
                "에러",
                "예외",
                "스택",
            ],
        ),
        (
            EntryType::Bug,
            &[
                "bug",
                "fix",
                "broken",
                "crash",
                "regression",
                "버그",
                "고치",
                "깨지",
                "안 돼",
                "오류",
            ],
        ),
        (
            EntryType::Refactor,
            &[
                "refactor",
                "cleanup",
                "rename",
                "restructure",
                "리팩토링",
                "정리",
                "구조",
            ],
        ),
        (
            EntryType::Feature,
            &[
                "feature",
                "implement",
                "add ",
                "build ",
                "design",
                "기능",
                "구현",
                "추가",
                "설계",
            ],
        ),
    ];
    // 제목이 본문보다 강한 신호다 — 먼저 보고, 없으면 본문 앞부분만 본다.
    let head: String = body.chars().take(2_000).collect();
    for haystack in [title.to_lowercase(), head.to_lowercase()] {
        for (t, needles) in TABLE {
            if needles.iter().any(|n| haystack.contains(n)) {
                return *t;
            }
        }
    }
    EntryType::Chore
}

/// `[a-z0-9-]` 60자 이내 (`validate_slug`). 해시가 뒤에 붙으므로 제목이 전부
/// 비ASCII 여도 언제나 유효하고, 같은 대화면 언제나 같다.
pub fn slug_for(source_id: &str, title: &str) -> String {
    let hash = short_hash(source_id);
    let mut words = String::new();
    let mut prev_dash = true;
    for c in title.chars() {
        if words.len() >= 30 {
            break;
        }
        if c.is_ascii_alphanumeric() {
            words.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            words.push('-');
            prev_dash = true;
        }
    }
    let words = words.trim_matches('-');
    if words.is_empty() {
        format!("imported-{hash}")
    } else {
        format!("imported-{words}-{hash}")
    }
}

fn short_hash(s: &str) -> String {
    blake3::hash(s.as_bytes()).to_hex()[..10].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Claude export 의 실제 모양 (최상위 배열 · `chat_messages` · `sender`).
    const CLAUDE: &str = r#"[
      {
        "uuid": "3f0c-aaaa",
        "name": "파서가 깨지는 버그",
        "created_at": "2025-07-14T11:30:00+00:00",
        "chat_messages": [
          {"sender": "human", "text": "프런트매터 파서가 죽어요"},
          {"sender": "assistant", "text": "tz 오프셋이 없어서입니다"}
        ]
      }
    ]"#;

    /// 일반형 (`conversations[].messages[]` · `role` · `content` 조각 배열).
    const GENERIC: &str = r#"{
      "conversations": [
        {
          "id": "gen-1",
          "title": "Add a settings tab",
          "create_time": 1752492600,
          "messages": [
            {"role": "user", "content": [{"type": "text", "text": "let's add a tab"}]},
            {"role": "assistant", "content": "sure"}
          ]
        }
      ]
    }"#;

    #[test]
    fn reads_the_claude_export_shape() {
        let out = parse_json(CLAUDE.as_bytes()).unwrap();
        assert!(out.skipped.is_empty());
        let c = &out.conversations[0];
        assert_eq!(c.candidate.source_id, "3f0c-aaaa");
        assert_eq!(c.candidate.title, "파서가 깨지는 버그");
        assert_eq!(c.candidate.workday, "2025-07-14".replace('-', ""));
        assert_eq!(c.candidate.message_count, 2);
        assert_eq!(c.candidate.guessed_type, EntryType::Bug);
        assert!(c.transcript.contains("## 사용자"));
        assert!(c.transcript.contains("tz 오프셋"));
    }

    #[test]
    fn reads_the_generic_shape_with_epoch_time_and_content_parts() {
        let out = parse_json(GENERIC.as_bytes()).unwrap();
        let c = &out.conversations[0];
        assert_eq!(c.candidate.source_id, "gen-1");
        assert_eq!(c.candidate.guessed_type, EntryType::Feature);
        assert!(c.transcript.contains("let's add a tab"));
        assert!(c.candidate.created_at.starts_with("2025-07-14"));
    }

    /// 중복 스킵이 서 있는 성질 — 같은 입력이면 슬러그가 같다.
    #[test]
    fn the_slug_is_stable_across_parses() {
        let a = parse_json(CLAUDE.as_bytes()).unwrap().conversations[0]
            .candidate
            .slug
            .clone();
        let b = parse_json(CLAUDE.as_bytes()).unwrap().conversations[0]
            .candidate
            .slug
            .clone();
        assert_eq!(a, b);
        assert!(a.starts_with("imported-"));
        assert!(a.len() <= 60);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    }

    /// 제목이 전부 비ASCII 여도 유효한 슬러그가 나온다.
    #[test]
    fn a_korean_title_still_yields_an_ascii_slug() {
        let s = slug_for("uuid-1", "파서가 깨지는 버그");
        assert_eq!(s, format!("imported-{}", short_hash("uuid-1")));
        assert!(s
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    }

    #[test]
    fn an_english_title_keeps_readable_words() {
        let s = slug_for("uuid-2", "Add a settings tab!");
        assert!(s.starts_with("imported-add-a-settings-tab-"), "{s}");
        assert!(s.len() <= 60);
    }

    /// 못 읽은 대화는 사라지지 않는다 — 부분 실패를 허용하되 보고한다.
    #[test]
    fn unreadable_conversations_are_reported_not_dropped() {
        let raw = r#"[
          {"uuid": "ok", "name": "fine", "created_at": "2025-07-14T11:30:00Z",
           "chat_messages": [{"sender": "human", "text": "hi"}]},
          {"uuid": "bad", "name": "no messages", "created_at": "2025-07-14T11:30:00Z"},
          {"uuid": "bad2", "name": "no time",
           "chat_messages": [{"sender": "human", "text": "hi"}]}
        ]"#;
        let out = parse_json(raw.as_bytes()).unwrap();
        assert_eq!(out.conversations.len(), 1);
        assert_eq!(out.skipped.len(), 2);
        assert_eq!(out.skipped[0].reason, "no messages");
        assert_eq!(out.skipped[1].reason, "no timestamp");
    }

    #[test]
    fn a_long_conversation_is_clamped_head_and_tail() {
        let long = "가".repeat(MAX_TRANSCRIPT_CHARS * 2);
        let clamped = clamp_transcript(&long);
        assert!(clamped.chars().count() < MAX_TRANSCRIPT_CHARS + 100);
        assert!(clamped.contains("중략"));
    }

    #[test]
    fn a_file_without_conversations_is_an_error_not_an_empty_list() {
        assert!(parse_json(b"{\"hello\": 1}").is_err());
        assert!(parse_json(b"not json").is_err());
    }
}

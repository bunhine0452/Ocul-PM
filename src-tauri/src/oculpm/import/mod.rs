//! 대화 임포트 — 지난 대화를 이 저장소의 기록으로 들여온다 (Phase 7).
//!
//! ```text
//! 파일 고르기 (.json | .zip)
//!   → 후보 목록  (날짜·제목·길이·추정 갈래)   ← 여기까지 LLM 0, 과금 0
//!   → 사용자 선택
//!   → Core Model 로 규격 일지화 (verified_by_user: false)
//! ```
//!
//! # 왜 목록을 먼저 보여 주는가
//!
//! export 한 파일에는 수백 개의 대화가 들어 있고 그 대부분은 이 프로젝트와
//! 무관하다. 통째로 돌리면 무관한 대화 수백 건에 과금하고 일지를 오염시킨다.
//! 그래서 스캔은 **완전히 오프라인**이고, 모델은 사용자가 고른 것에만 붙는다.
//!
//! # 들여온 기록은 검증되지 않은 기록이다
//!
//! 산출물은 전부 `verified_by_user: false` 다. 원본은 이 저장소에서 일어난 일이
//! 아니라 **다른 곳에서 한 대화**이고, 모델이 그것을 요약한 것이다. 사용자가
//! 읽고 토글하기 전까지는 초안이다 — `journal_draft` 와 같은 규약.

pub mod adapters;
pub mod journalize;

use std::path::Path;

pub use adapters::{ImportCandidate, ImportSkip, ParseOutcome, ParsedConversation};

use crate::plugins::archive::{self, Limits};

/// 아카이브 안에서 대화 JSON 으로 볼 만한 이름 — 이 순서로 먼저 시도한다.
const PREFERRED_NAMES: &[&str] = &["conversations.json", "chats.json", "conversation.json"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportError {
    /// 파일을 읽지 못했다.
    Unreadable(String),
    /// 아카이브가 상한을 넘겨 전체를 거절했다.
    TooLarge(String),
    /// 읽었지만 대화가 하나도 없다.
    NoConversations(String),
}

impl ImportError {
    pub fn code(&self) -> &'static str {
        match self {
            ImportError::Unreadable(_) => "import_unreadable",
            ImportError::TooLarge(_) => "import_too_large",
            ImportError::NoConversations(_) => "import_no_conversations",
        }
    }
    pub fn detail(&self) -> String {
        match self {
            ImportError::Unreadable(m) => format!("cannot read this export: {m}"),
            ImportError::TooLarge(m) => format!("the export exceeds an import limit: {m}"),
            ImportError::NoConversations(m) => format!("no conversation found in this export: {m}"),
        }
    }
}

/// 파일 하나를 읽어 대화 목록으로. `.zip` 이면 안에서 대화 JSON 을 찾는다.
///
/// **읽기 전용이고 오프라인이다** — 여기서 네트워크도 디스크 쓰기도 없다.
pub fn read_source(path: &Path) -> Result<ParseOutcome, ImportError> {
    let bytes = std::fs::read(path).map_err(|e| ImportError::Unreadable(e.to_string()))?;
    let is_zip = bytes.starts_with(b"PK\x03\x04");
    if is_zip {
        read_archive(bytes)
    } else {
        adapters::parse_json(&bytes).map_err(ImportError::NoConversations)
    }
}

/// ZIP 안에서 대화 JSON 을 고른다. 이름이 맞는 것을 먼저 보고, 없으면 **파싱에
/// 성공하는 첫 `.json`** 을 쓴다 — 도구마다 파일 이름이 다르기 때문이다.
fn read_archive(bytes: Vec<u8>) -> Result<ParseOutcome, ImportError> {
    let outcome =
        archive::read_zip_with(bytes, Limits::conversation_export()).map_err(|e| match e {
            archive::ArchiveError::TooLarge(m) => ImportError::TooLarge(m),
            archive::ArchiveError::Open(m) => ImportError::Unreadable(m),
        })?;

    let json_files: Vec<_> = outcome
        .files
        .into_iter()
        .filter(|f| f.path.to_lowercase().ends_with(".json"))
        .collect();
    if json_files.is_empty() {
        return Err(ImportError::NoConversations("no .json entry".to_string()));
    }

    let mut ordered: Vec<_> = json_files.iter().collect();
    ordered.sort_by_key(|f| {
        let name = f.path.rsplit('/').next().unwrap_or("").to_lowercase();
        PREFERRED_NAMES
            .iter()
            .position(|p| *p == name)
            .unwrap_or(PREFERRED_NAMES.len())
    });

    let mut last_err = "no .json entry parsed as a conversation list".to_string();
    for f in ordered {
        match adapters::parse_json(&f.bytes) {
            Ok(mut parsed) if !parsed.conversations.is_empty() => {
                // 아카이브가 거절한 엔트리도 그대로 보고한다.
                parsed
                    .skipped
                    .extend(outcome.skipped.iter().map(|(path, reason)| ImportSkip {
                        label: path.clone(),
                        reason: reason.clone(),
                    }));
                return Ok(parsed);
            }
            Ok(_) => last_err = format!("{}: no conversation", f.path),
            Err(e) => last_err = format!("{}: {e}", f.path),
        }
    }
    Err(ImportError::NoConversations(last_err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_with(files: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            for (name, body) in files {
                w.start_file(*name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    const ONE: &str = r#"[{"uuid":"a","name":"hi","created_at":"2025-07-14T11:30:00Z",
      "chat_messages":[{"sender":"human","text":"hello"}]}]"#;

    #[test]
    fn a_bare_json_export_is_read_directly() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("conversations.json");
        std::fs::write(&p, ONE).unwrap();
        let out = read_source(&p).unwrap();
        assert_eq!(out.conversations.len(), 1);
    }

    #[test]
    fn a_zip_export_finds_the_conversation_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("export.zip");
        std::fs::write(
            &p,
            zip_with(&[
                ("users.json", r#"[{"name":"me"}]"#),
                ("conversations.json", ONE),
            ]),
        )
        .unwrap();
        let out = read_source(&p).unwrap();
        assert_eq!(out.conversations.len(), 1);
        assert_eq!(out.conversations[0].candidate.source_id, "a");
    }

    /// 이름이 낯설어도 파싱되는 `.json` 이 있으면 찾아낸다.
    #[test]
    fn an_unfamiliar_filename_still_parses() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("export.zip");
        std::fs::write(&p, zip_with(&[("dump-2025.json", ONE)])).unwrap();
        assert_eq!(read_source(&p).unwrap().conversations.len(), 1);
    }

    #[test]
    fn an_archive_without_conversations_is_an_honest_error() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("export.zip");
        std::fs::write(&p, zip_with(&[("readme.txt", "nothing here")])).unwrap();
        let err = read_source(&p).unwrap_err();
        assert_eq!(err.code(), "import_no_conversations");
    }
}

#[cfg(test)]
mod real_shape_tests {
    use super::*;
    use std::io::Write;

    /// 실제 Claude export 가 가진 성가신 것들을 한 자리에 모은 픽스처 —
    /// `account` 블록 · **`text` 가 빈 문자열이고 본문이 `content[]` 조각에만
    /// 있는 턴** · 빈 `attachments`/`files` · 마이크로초까지 있는 `Z`
    /// 타임스탬프 · **제목이 빈 대화** · GitHub 식 래퍼 폴더 · 곁다리 `.json`.
    fn export_zip() -> Vec<u8> {
        let mut convs = String::from("[");
        for i in 0..3 {
            if i > 0 {
                convs.push(',');
            }
            let name = ["파서가 자꾸 죽어요", "Add a settings tab", ""][i];
            convs.push_str(&format!(
                r#"{{"uuid":"aaaa-{i}","name":"{name}",
                   "created_at":"2025-07-1{}T11:30:00.123456Z",
                   "updated_at":"2025-07-1{}T12:00:00.000000Z",
                   "account":{{"uuid":"acct-1"}},
                   "chat_messages":[
                     {{"uuid":"m1","text":"","sender":"human",
                       "created_at":"2025-07-14T11:30:00Z",
                       "content":[{{"type":"text","text":"질문 {i} 입니다"}}],
                       "attachments":[],"files":[]}},
                     {{"uuid":"m2","text":"답변 {i}","sender":"assistant",
                       "created_at":"2025-07-14T11:31:00Z",
                       "content":[{{"type":"text","text":"답변 {i}"}}],
                       "attachments":[],"files":[]}}]}}"#,
                i + 1,
                i + 1
            ));
        }
        convs.push(']');

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opt = zip::write::SimpleFileOptions::default();
            // 곁다리 파일이 먼저 와도 대화 파일을 찾아낸다.
            w.start_file("data-2025-07-14/users.json", opt).unwrap();
            w.write_all(br#"[{"uuid":"acct-1"}]"#).unwrap();
            w.start_file("data-2025-07-14/conversations.json", opt)
                .unwrap();
            w.write_all(convs.as_bytes()).unwrap();
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn the_real_claude_export_shape_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.zip");
        std::fs::write(&path, export_zip()).unwrap();

        let out = read_source(&path).unwrap();
        assert_eq!(out.conversations.len(), 3);

        // `text` 가 비어 있고 본문이 `content[]` 조각에만 있어도 읽힌다.
        assert!(out.conversations[0].transcript.contains("질문 0 입니다"));
        assert!(out.conversations[0].transcript.contains("답변 0"));

        // 워크데이는 **원본 날짜**다 — 들여온 날이 아니라.
        assert_eq!(out.conversations[0].candidate.workday, "20250711");
        assert_eq!(out.conversations[2].candidate.workday, "20250713");

        // 제목이 빈 대화는 첫 발화에서 제목을 얻는다 (「(제목 없음)」이 아니라).
        assert_eq!(out.conversations[2].candidate.title, "질문 2 입니다");

        // 슬러그는 전부 유효하고 서로 다르다 — 중복 스킵이 이 성질 위에 선다.
        let mut slugs: Vec<&str> = out
            .conversations
            .iter()
            .map(|c| c.candidate.slug.as_str())
            .collect();
        slugs.sort_unstable();
        slugs.dedup();
        assert_eq!(slugs.len(), 3);
        for s in slugs {
            assert!(!s.is_empty() && s.len() <= 60, "{s}");
            assert!(s
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        }
    }
}

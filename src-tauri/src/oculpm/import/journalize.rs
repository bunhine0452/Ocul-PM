//! 고른 대화 → 규격 일지 (Phase 7 #conversation-import).
//!
//! # 규약은 자동화 러너와 같다
//!
//! - **Core Model 로만** 돈다 (D2). 미설정이면 성립 불가 — 조용히 스킵이 아니라
//!   호출부가 "배경 모델을 먼저 고르세요" 로 잠근다.
//! - frontmatter 는 **결정적으로 조립**한다. 모델은 본문만 채운다.
//! - `redact` 이중 방어 — 모델 응답에 시크릿이 섞여 돌아올 수 있다.
//! - 산출물은 `verified_by_user: false`.
//!
//! # 중복은 슬러그가 가른다
//!
//! 후보의 `slug` 는 원본 id 에서 결정적으로 나온다([`adapters::slug_for`]).
//! 같은 export 를 두 번 돌려도 **원본 날짜의 워크데이**에 그 슬러그가 이미
//! 있으면 모델을 부르지 않고 건너뛴다 — 중복 스킵이 과금 앞에 있다.

use serde::Serialize;

use crate::db::Db;
use crate::llm::{ChatOptions, Message, Role};
use crate::oculpm::automation::core_model::CoreTarget;
use crate::oculpm::automation::runner::ChatBackend;
use crate::oculpm::import::adapters::ParsedConversation;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::redact::redact_text;
use crate::oculpm::session_id::SessionId;
use crate::oculpm::spec::{AgentRef, EntryStatus, EntryType, ManualEntryDraft};

/// 일지 본문 상한. 임포트는 요약이지 전사(轉寫)가 아니다.
const MAX_TOKENS: u32 = 1_200;

// i18n-ignore-next-line -- LLM 프롬프트 본문 (UI 문자열이 아니다).
const SYSTEM_PROMPT: &str = "\
당신은 개발 작업 기록기입니다. 다른 도구에서 나눈 대화 하나를 받아 작업 일지 \
본문으로 옮겨 적습니다. 규칙: (1) 대화를 그대로 옮기지 말고 **무엇을 하려 했고 \
무엇을 알아냈고 무엇이 남았는지**로 다시 씁니다. (2) 제목·frontmatter 를 쓰지 \
말고 마크다운 본문만 돌려줍니다. (3) 대화에 없는 사실을 지어내지 않습니다 — \
모르면 모른다고 씁니다. (4) 코드 블록은 핵심만 남깁니다.";

/// 임포트 한 건의 결과.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ImportedEntry {
    pub source_id: String,
    pub title: String,
    /// `.oculpm/journal/` 기준 상대 경로. 건너뛴 건은 `None`.
    pub relative_path: Option<String>,
    /// `imported` · `duplicate` · `failed`.
    pub outcome: String,
    /// 실패·스킵 사유 (UI 언어 아님).
    pub detail: Option<String>,
}

/// 대화 하나를 일지로. 중복 판정은 호출부(`run_import`)가 이미 마쳤다.
#[allow(clippy::too_many_arguments)]
pub async fn journalize_one(
    db: &Db,
    manager: &OculpmManager,
    backend: &dyn ChatBackend,
    target: &CoreTarget,
    project_id: u32,
    conv: &ParsedConversation,
    entry_type: EntryType,
    redact: &[regex::Regex],
) -> ImportedEntry {
    let c = &conv.candidate;
    let response = backend
        .chat(
            target,
            vec![
                Message {
                    role: Role::System,
                    content: crate::oculpm::content_lang::current(db)
                        .await
                        .apply(SYSTEM_PROMPT),
                },
                Message {
                    role: Role::User,
                    content: build_prompt(conv),
                },
            ],
            ChatOptions {
                model: target.model.clone(),
                temperature: Some(0.2),
                max_tokens: Some(MAX_TOKENS),
            },
        )
        .await;

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            return ImportedEntry {
                source_id: c.source_id.clone(),
                title: c.title.clone(),
                relative_path: None,
                outcome: "failed".to_string(),
                detail: Some(e.message),
            }
        }
    };

    // 이중 방어 — 원본 대화에도, 모델 응답에도 키가 섞일 수 있다.
    let (body, _) = redact_text(&response.content, redact);
    let (title, _) = redact_text(&c.title, redact);

    let local = chrono::DateTime::parse_from_rfc3339(&c.created_at).ok();
    let session_id = match local {
        Some(dt) => SessionId::imported(&c.workday, dt.time()),
        None => SessionId::imported(&c.workday, chrono::NaiveTime::MIN),
    };

    let draft = ManualEntryDraft {
        entry_type,
        slug: c.slug.clone(),
        title,
        difficulty: None,
        body_markdown: compose_body(conv, &body),
        session_id: Some(session_id.into_string()),
        files_touched: Vec::new(),
        status: Some(EntryStatus::Done),
        tags: vec!["imported".to_string()],
        // 본문을 쓴 것은 배경 모델이다 — 자동 초안과 같은 귀속.
        // "들여온 것" 이라는 사실은 session_id 접두가 나른다.
        agent: Some(AgentRef {
            id: format!("auto:{}", response.provider),
            version: Some(response.model.clone()),
        }),
        // 다른 곳에서 한 대화를 모델이 요약한 것이다 — 사용자가 읽기 전까지 초안이다.
        verified_by_user: Some(false),
        // 원본 날짜 보존 — 워크데이 폴더·파일명 HHMM 이 전부 여기서 나온다.
        created_at: Some(c.created_at.clone()),
    };

    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    match manager
        .create_manual_journal_entry(db, project_id, draft)
        .await
    {
        Ok(entry) => ImportedEntry {
            source_id: c.source_id.clone(),
            title: c.title.clone(),
            relative_path: Some(entry.relative_path),
            outcome: "imported".to_string(),
            detail: None,
        },
        Err(e) => ImportedEntry {
            source_id: c.source_id.clone(),
            title: c.title.clone(),
            relative_path: None,
            outcome: "failed".to_string(),
            detail: Some(e.to_string()),
        },
    }
}

/// 모델에게 가는 사용자 메시지. 대화 전문 + 최소한의 사실만.
fn build_prompt(conv: &ParsedConversation) -> String {
    let c = &conv.candidate;
    // i18n-ignore-next-line -- LLM 프롬프트 본문 (UI 문자열이 아니다).
    format!(
        "다음은 {} 에 다른 도구에서 나눈 대화입니다. 제목은 「{}」 이고 {} 개의 \
발화가 있습니다. 이 대화를 작업 일지 본문으로 옮겨 적어 주세요.\n\n---\n\n{}",
        c.created_at, c.title, c.message_count, conv.transcript
    )
}

/// 본문 = 모델의 요약 + **출처 각주**. 각주는 결정적으로 우리가 붙인다 —
/// "이건 여기서 일어난 일이 아니다" 가 기록 자체에 남아야 한다.
fn compose_body(conv: &ParsedConversation, body: &str) -> String {
    let c = &conv.candidate;
    // i18n-ignore-next-line -- 디스크에 적히는 일지 본문 (UI 문자열 아님).
    format!(
        "{}\n\n---\n\n> 들여온 대화입니다 — 이 저장소에서 일어난 일이 아니라 외부 \
도구의 대화 기록을 배경 모델이 옮겨 적은 것입니다. 원본: {} · {} 발화 · {} 자.\n",
        body.trim(),
        c.created_at,
        c.message_count,
        c.char_count
    )
}

/// 이 워크데이에 이 슬러그가 이미 있는가 — 중복 스킵의 판정.
pub async fn already_imported(
    db: &Db,
    project_id: u32,
    workday: &str,
    slug: &str,
) -> Result<bool, String> {
    let cache = crate::oculpm::cache::JournalCache::new(db);
    let entries = cache
        .list_entries(project_id, Some(workday), &Default::default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(entries.iter().any(|e| e.slug == slug))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::import::adapters::{parse_json, ImportCandidate};

    fn sample() -> ParsedConversation {
        parse_json(
            r#"[{"uuid":"a","name":"파서 버그","created_at":"2025-07-14T11:30:00+09:00",
              "chat_messages":[{"sender":"human","text":"안 돼요"}]}]"#
                .as_bytes(),
        )
        .unwrap()
        .conversations
        .remove(0)
    }

    #[test]
    fn the_prompt_carries_the_transcript_and_the_original_date() {
        let p = build_prompt(&sample());
        assert!(p.contains("2025-07-14"));
        assert!(p.contains("파서 버그"));
        assert!(p.contains("안 돼요"));
    }

    /// 각주는 모델이 아니라 우리가 붙인다 — 모델이 빼먹을 수 없어야 한다.
    #[test]
    fn the_body_always_carries_the_provenance_footnote() {
        let body = compose_body(&sample(), "요약 본문");
        assert!(body.starts_with("요약 본문"));
        assert!(body.contains("들여온 대화입니다"));
        assert!(body.contains("2025-07-14"));
    }

    /// 세션 id 는 **원본 날짜**를 싣는다 — 오늘이 아니라.
    #[test]
    fn the_session_id_carries_the_original_workday() {
        let c: ImportCandidate = sample().candidate;
        let dt = chrono::DateTime::parse_from_rfc3339(&c.created_at).unwrap();
        let sid = SessionId::imported(&c.workday, dt.time());
        assert_eq!(sid.as_str(), "import-20250714-113000");
        assert_eq!(sid.workday(), Some("20250714"));
    }
}

//! PR-CI1 — 훅 세션 종료 → 작업 일지 자동 초안 (D4).
//!
//! `agents.auto_journal_draft`(옵인, 과금)가 켜진 프로젝트에서, 훅 브리지가
//! Claude Code 세션 종료(AgentExit)를 감지하면 그 세션의 transcript 를 설정된
//! LLM 으로 요약해 **규격 일지 한 건**을 자동 작성한다. 원칙:
//!
//! - **에이전트 우선.** 세션 창 안에 에이전트가 직접 쓴 일지가 하나라도 있으면
//!   아무것도 만들지 않는다 (AGENTS.md 준수 에이전트와 공존 — 중복 방지).
//! - **강등, 그러나 소실 없음.** transcript 파싱/LLM 이 실패해도 세션이 있었다는
//!   사실은 메타-전용 chore 엔트리로 남긴다 (요약만 강등, 기록은 보존).
//!   자격증명이 아예 없으면 조용히 스킵한다 (기능이 성립 불가).
//! - **규격은 코드가 보장.** LLM 은 내용만 채우고, 타입별 강제 헤더·frontmatter
//!   조립은 `manager::create_manual_journal_entry` + 여기의 결정적 composer 가
//!   맡는다 → frontmatter 파서 경고 0 을 구조적으로 담보.
//! - **redact 이중 방어.** LLM 이 돌려준 본문에 transcript 의 시크릿이 섞일 수
//!   있으므로 쓰기 전에 프로젝트 redact 패턴을 한 번 더 통과시킨다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use regex::Regex;
use serde::Deserialize;
use tauri::Manager;

use crate::db::Db;
use crate::llm;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::redact::redact_text;
use crate::oculpm::spec::{
    AgentRef, Difficulty, EntryStatus, EntryType, FileTouched, ManualEntryDraft, Session,
};
use crate::oculpm::transcript::{parse_transcript, TranscriptDigest};

/// files_touched 에 넣는 파일 수 상한 (frontmatter 가독성).
const MAX_FILES: usize = 20;
/// 자필 일지 존재 판정의 mtime 여유 (시계 오차 흡수).
const SELF_ENTRY_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, PartialEq, Eq)]
pub enum DraftOutcome {
    Skipped(&'static str),
    Wrote { entry_rel: String, degraded: bool },
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 파트 — 스킵 판정 / LLM 응답 파싱 / 본문 조립 (전부 단위 테스트)
// ─────────────────────────────────────────────────────────────────────────────

/// 세션 창(started_at 이후) 안에 이미 일지 `.md` 가 생겼는가. mtime 기준 —
/// AGENTS.md 준수 에이전트는 세션 중에 파일을 쓰므로 창 안에 잡힌다.
/// (우리 초안은 세션 종료 *후*에 쓰이므로 다음 세션 판정을 오염시키지 않는다.)
pub fn self_entry_exists(journal_day_dir: &Path, since: SystemTime) -> bool {
    let threshold = since.checked_sub(SELF_ENTRY_GRACE).unwrap_or(since);
    let Ok(categories) = std::fs::read_dir(journal_day_dir) else {
        return false;
    };
    for cat in categories.flatten() {
        if !cat.path().is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(cat.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Ok(meta) = f.metadata() {
                if let Ok(mtime) = meta.modified() {
                    if mtime >= threshold {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// LLM 이 채워야 하는 내용 (구조·헤더는 우리가 조립).
#[derive(Debug, Default, Deserialize)]
pub struct DraftPlan {
    #[serde(default, rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub difficulty: String,
    /// 타입별 첫 강제 섹션 내용 (bug/error=발생 원인, feature=추가 기능, …).
    #[serde(default)]
    pub primary: String,
    /// 타입별 둘째 강제 섹션 내용.
    #[serde(default)]
    pub secondary: String,
    #[serde(default)]
    pub verification: String,
}

/// 응답 텍스트에서 첫 JSON 오브젝트를 관용적으로 뽑는다 (코드펜스/서문 허용).
/// `title`/`primary` 가 비면 실패로 취급한다 — 빈 초안은 강등 경로가 낫다.
pub fn parse_draft_response(text: &str) -> Option<DraftPlan> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    let plan: DraftPlan = serde_json::from_str(&text[start..=end]).ok()?;
    if plan.title.trim().is_empty() || plan.primary.trim().is_empty() {
        return None;
    }
    Some(plan)
}

pub fn normalize_type(s: &str) -> EntryType {
    match s.trim() {
        "bug" => EntryType::Bug,
        "feature" => EntryType::Feature,
        "error" => EntryType::Error,
        "refactor" => EntryType::Refactor,
        _ => EntryType::Chore,
    }
}

pub fn normalize_difficulty(s: &str) -> Option<Difficulty> {
    match s.trim() {
        "verylow" => Some(Difficulty::Verylow),
        "low" => Some(Difficulty::Low),
        "medium" => Some(Difficulty::Medium),
        "high" => Some(Difficulty::High),
        "superhigh" => Some(Difficulty::Superhigh),
        _ => None,
    }
}

/// ASCII kebab-case 로 강제 + 40자 캡. 결과가 비면 세션 기반 폴백.
pub fn sanitize_slug(raw: &str, fallback: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = true; // 선행 대시 방지
    for ch in raw.trim().to_lowercase().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else if ch == '-' || ch == '_' || ch.is_whitespace() {
            Some('-')
        } else {
            None // 비 ASCII (한글 등) 는 버린다 — frontmatter slug 규약
        };
        match mapped {
            Some('-') if prev_dash => {}
            Some('-') => {
                out.push('-');
                prev_dash = true;
            }
            Some(c) => {
                out.push(c);
                prev_dash = false;
            }
            None => {}
        }
        if out.len() >= 40 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

/// 타입별 강제 헤더 (AGENTS.md §4) 를 코드가 조립한다.
pub fn compose_body(entry_type: EntryType, plan: &DraftPlan, meta_note: &str) -> String {
    let (h1, h2) = match entry_type {
        EntryType::Bug | EntryType::Error => (Some("발생 원인"), Some("해결 방법")),
        EntryType::Feature => (Some("추가 기능"), Some("동작 흐름")),
        EntryType::Refactor => (Some("동기"), Some("변경 요약")),
        EntryType::Chore => (None, None),
    };
    let mut body = String::new();
    match (h1, h2) {
        (Some(h1), Some(h2)) => {
            body.push_str(&format!("## {h1}\n\n{}\n\n", plan.primary.trim()));
            let secondary = if plan.secondary.trim().is_empty() {
                "(자동 초안 — 내용 미상)"
            } else {
                plan.secondary.trim()
            };
            body.push_str(&format!("## {h2}\n\n{secondary}\n\n"));
        }
        _ => {
            body.push_str(&format!("{}\n\n", plan.primary.trim()));
            if !plan.secondary.trim().is_empty() {
                body.push_str(&format!("{}\n\n", plan.secondary.trim()));
            }
        }
    }
    let verification = if plan.verification.trim().is_empty() {
        "자동 초안 — transcript 에서 검증 근거를 찾지 못함. 사용자 확인 필요."
    } else {
        plan.verification.trim()
    };
    body.push_str(&format!("## 검증\n\n{verification}\n\n"));
    body.push_str(&format!("## 메모\n\n{meta_note}\n"));
    body
}

/// 강등(메타-전용) 본문 — LLM 없이 결정적으로 만든다.
pub fn compose_degraded_body(
    session: &Session,
    files: &[FileTouched],
    reason: &str,
    meta_note: &str,
) -> String {
    let file_lines = if files.is_empty() {
        "- (세션 파일 이벤트 없음)".to_string()
    } else {
        files
            .iter()
            .map(|f| format!("- {}", f.path))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "Claude Code 세션이 종료되어 자동 기록을 남긴다. transcript 요약은 실패해 세션\n\
         메타만 기록한다 (사유: {reason}).\n\n\
         - 세션: `{}` (시작 {})\n\
         - 변경 파일:\n{}\n\n\
         ## 검증\n\n자동 강등 기록 — 검증 없음. 필요하면 사용자가 내용을 보강할 것.\n\n\
         ## 메모\n\n{meta_note}\n",
        session.id, session.started_at, file_lines
    )
}

pub const SYSTEM_PROMPT: &str = r#"너는 ocul-pm 의 작업 일지 초안 작성기다. 코딩 에이전트 세션의 대화 기록을 읽고, 그 세션이 수행한 **하나의 논리적 작업 단위**를 한국어 작업 일지로 요약한다.

반드시 JSON 오브젝트 **하나만** 출력한다 (설명·코드펜스 금지):
{"type": "bug|feature|error|refactor|chore",
 "slug": "ascii-kebab-case-40자-이내",
 "title": "한 줄 제목 (한국어)",
 "difficulty": "verylow|low|medium|high|superhigh",
 "primary": "타입별 첫 섹션 내용 — bug/error는 발생 원인, feature는 추가 기능, refactor는 동기, chore는 작업 요약",
 "secondary": "타입별 둘째 섹션 내용 — bug/error는 해결 방법, feature는 동작 흐름, refactor는 변경 요약, chore는 비워도 됨",
 "verification": "세션에서 실제로 수행된 검증(테스트/빌드/수동 확인). 없었으면 빈 문자열"}

규칙:
- 세션에서 실제 일어난 일만 쓴다. 추측·과장 금지. 검증이 안 보이면 verification 은 빈 문자열.
- 여러 작업이 섞였으면 가장 큰 한 덩어리를 기록하고 나머지는 primary 끝에 한 줄로 언급.
- API 키·토큰·비밀번호 같은 시크릿은 어떤 필드에도 절대 옮겨 적지 않는다."#;

pub fn build_user_prompt(digest: &TranscriptDigest, files: &[FileTouched]) -> String {
    let mut out = String::new();
    out.push_str("## 세션 대화 기록");
    if digest.truncated {
        out.push_str(" (긴 세션 — 앞/뒤만 발췌)");
    }
    out.push('\n');
    let n = digest.user_prompts.len().max(digest.assistant_texts.len());
    for i in 0..n {
        if let Some(u) = digest.user_prompts.get(i) {
            out.push_str(&format!("\n[사용자]\n{u}\n"));
        }
        if let Some(a) = digest.assistant_texts.get(i) {
            out.push_str(&format!("\n[어시스턴트]\n{a}\n"));
        }
    }
    out.push_str("\n## 세션에서 변경된 파일\n");
    if files.is_empty() {
        out.push_str("(파일 이벤트 없음)\n");
    } else {
        for f in files {
            out.push_str(&format!("- {}\n", f.path));
        }
    }
    out.push_str("\n위 세션을 규칙대로 JSON 하나로 요약하라.");
    out
}

/// ndjson 세션 이벤트 → files_touched (경로당 마지막 op, 마스킹된 경로 제외).
pub fn files_from_events(
    events: &[crate::oculpm::spec::FileChangeEvent],
    session_id: &str,
) -> Vec<FileTouched> {
    let mut last: BTreeMap<String, crate::oculpm::spec::FileOp> = BTreeMap::new();
    for ev in events {
        if ev.session_id != session_id {
            continue;
        }
        if ev.path.starts_with("**redacted") {
            continue; // forbidden-path 마스킹 산출물 — frontmatter 에 넣지 않는다
        }
        last.insert(ev.path.clone(), ev.op);
    }
    last.into_iter()
        .take(MAX_FILES)
        .map(|(path, op)| FileTouched {
            path,
            op,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// 오케스트레이션 (watcher 의 fire-and-forget 태스크에서 호출)
// ─────────────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn draft_for_session(
    app: tauri::AppHandle,
    project_id: u32,
    root: PathBuf,
    index_writer: Arc<IndexWriter>,
    redact_patterns: Vec<Regex>,
    session: Session,
    transcript_path: Option<String>,
    claude_session_id: String,
) -> Result<DraftOutcome, String> {
    // 0. 세션 id 에서 workday (형식 YYYYMMDD-NNN — IndexWriter 규약).
    if session.id.len() < 8 {
        return Ok(DraftOutcome::Skipped("malformed session id"));
    }
    let workday = session.id[..8].to_string();
    // 산출물 언어 (설정 `content_language`). 조회 실패는 Unset — 기존 동작 유지.
    let content_lang = {
        use tauri::Manager;
        crate::oculpm::content_lang::current(&app.state::<crate::db::Db>()).await
    };

    // 1. 자필 일지 우선 — 세션 창 안에 이미 일지가 있으면 우리는 비킨다.
    let since = chrono::DateTime::parse_from_rfc3339(&session.started_at)
        .map(SystemTime::from)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let day_dir = root.join(".oculpm").join("journal").join(&workday);
    if self_entry_exists(&day_dir, since) {
        return Ok(DraftOutcome::Skipped("agent wrote its own entry"));
    }

    // 2. LLM 자격증명 — 없으면 기능 성립 불가 → 조용히 스킵 (reconcile 동형).
    let db = app.state::<Db>();
    let provider = match db
        .settings_get("default_provider".to_string())
        .await
        .map_err(|e| e.to_string())?
    {
        Some(p) if !p.trim().is_empty() => p,
        _ => return Ok(DraftOutcome::Skipped("no default provider configured")),
    };
    let model = match db
        .settings_get(format!("model_{provider}"))
        .await
        .map_err(|e| e.to_string())?
    {
        Some(m) if !m.trim().is_empty() => m,
        _ => match db
            .settings_get("default_model".to_string())
            .await
            .map_err(|e| e.to_string())?
        {
            Some(m) if !m.trim().is_empty() => m,
            _ => return Ok(DraftOutcome::Skipped("no model configured")),
        },
    };
    let api_key = match crate::secrets::get(&format!("{provider}_api_key")).map_err(|e| e.to_string())? {
        Some(k) => k,
        None => return Ok(DraftOutcome::Skipped("no api key for provider")),
    };

    // 3. 세션 파일 이벤트 → files_touched.
    let events = index_writer
        .read_file_changes(&workday, None)
        .await
        .unwrap_or_default();
    let files = files_from_events(&events, &session.id);

    // 4. transcript 읽기 + 파싱 (실패 = 강등, 소실 아님).
    let mut degraded_reason: Option<&'static str> = None;
    let digest = match &transcript_path {
        Some(p) => match tokio::fs::read_to_string(p).await {
            Ok(raw) => {
                let d = parse_transcript(&raw);
                if d.parsed_messages == 0 {
                    degraded_reason = Some("transcript 에서 메시지를 파싱하지 못함");
                }
                d
            }
            Err(_) => {
                degraded_reason = Some("transcript 파일을 읽지 못함");
                TranscriptDigest::default()
            }
        },
        None => {
            degraded_reason = Some("훅 payload 에 transcript_path 없음");
            TranscriptDigest::default()
        }
    };

    // 5. LLM 초안 (강등 아니면 시도; 호출/파싱 실패 시 강등으로 하향).
    let mut plan: Option<DraftPlan> = None;
    if degraded_reason.is_none() {
        let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
        let response = client
            .chat(
                vec![
                    llm::Message {
                        role: llm::Role::System,
                        // 산출물 언어 지시를 덧붙인다 — 일지는 디스크에 남는
                        // 문서라 UI 언어가 아니라 `content_language` 를 따른다
                        // (oculpm::content_lang).
                        content: content_lang.apply(SYSTEM_PROMPT),
                    },
                    llm::Message {
                        role: llm::Role::User,
                        content: build_user_prompt(&digest, &files),
                    },
                ],
                llm::ChatOptions {
                    model,
                    temperature: Some(0.2),
                    max_tokens: Some(1200),
                },
            )
            .await;
        match response {
            Ok(resp) => match parse_draft_response(&resp.content) {
                Some(p) => plan = Some(p),
                None => degraded_reason = Some("LLM 응답에서 초안 JSON 을 파싱하지 못함"),
            },
            Err(e) => {
                tracing::warn!(target: "oculpm::journal_draft", error = %e, "draft LLM call failed");
                degraded_reason = Some("LLM 호출 실패");
            }
        }
    }

    // 6. 초안 → ManualEntryDraft (규격 조립은 결정적).
    let short_claude = claude_session_id.chars().take(8).collect::<String>();
    let session_nnn = session.id.rsplit('-').next().unwrap_or("000");
    let meta_note = format!(
        "Claude Code 세션 transcript 자동 초안 (PR-CI1 훅 브리지). oculpm 세션 `{}`, \
         claude 세션 `{short_claude}…`. 내용 검토 후 부정확하면 새 일지로 정정할 것.",
        session.id
    );
    let degraded = degraded_reason.is_some();
    let (entry_type, slug, title, difficulty, body) = match (&plan, degraded_reason) {
        (Some(p), None) => {
            let entry_type = normalize_type(&p.type_);
            let slug = sanitize_slug(&p.slug, &format!("claude-session-{session_nnn}-auto"));
            let title = if p.title.trim().is_empty() {
                "Claude Code 세션 자동 초안".to_string()
            } else {
                p.title.trim().to_string()
            };
            let body = compose_body(entry_type, p, &meta_note);
            (entry_type, slug, title, normalize_difficulty(&p.difficulty), body)
        }
        _ => {
            let reason = degraded_reason.unwrap_or("알 수 없음");
            let body = compose_degraded_body(&session, &files, reason, &meta_note);
            (
                EntryType::Chore,
                format!("claude-session-{session_nnn}-auto"),
                "Claude Code 세션 자동 기록 (요약 강등)".to_string(),
                None,
                body,
            )
        }
    };

    // 7. redact 이중 방어 — LLM 본문에 transcript 시크릿이 섞였을 수 있다.
    let (body, hits) = redact_text(&body, &redact_patterns);
    if !hits.is_empty() {
        tracing::warn!(
            target: "oculpm::journal_draft",
            hits = hits.len(),
            "draft body contained redactable content — masked"
        );
    }
    let (title, _) = redact_text(&title, &redact_patterns);

    let draft = ManualEntryDraft {
        entry_type,
        slug,
        title,
        difficulty,
        body_markdown: body,
        session_id: Some(session.id.clone()),
        files_touched: files,
        status: Some(EntryStatus::Done),
        tags: vec!["auto-draft".to_string()],
        agent: Some(AgentRef {
            id: "claude-code".to_string(),
            version: digest.model.clone(),
        }),
        verified_by_user: Some(false),
    };

    // 8. 규격 쓰기 — forbidden 경로가 섞였으면 파일 목록 없이 1회 재시도
    //    (기록 보존이 파일 목록보다 우선).
    let manager = app.state::<OculpmManager>();
    let written = match manager
        .create_manual_journal_entry(&db, project_id, draft.clone())
        .await
    {
        Ok(e) => e,
        Err(crate::oculpm::error::OculpmError::ForbiddenJournalPath { .. }) => {
            let mut retry = draft;
            retry.files_touched = Vec::new();
            manager
                .create_manual_journal_entry(&db, project_id, retry)
                .await
                .map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    };

    Ok(DraftOutcome::Wrote {
        entry_rel: written.relative_path,
        degraded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::{FileChangeEvent, FileOp};
    use tempfile::TempDir;

    fn plan(type_: &str) -> DraftPlan {
        DraftPlan {
            type_: type_.into(),
            slug: "Fix Journal Cache!!".into(),
            title: "일지 캐시 무효화 버그 수정".into(),
            difficulty: "medium".into(),
            primary: "캐시 키가 상대경로/절대경로로 갈라져 무효화가 누락됐다.".into(),
            secondary: "키를 캐시-키 형태로 정규화했다.".into(),
            verification: "cargo test 12개 그린".into(),
        }
    }

    #[test]
    fn parse_draft_response_tolerates_fences_and_rejects_empty() {
        let text = "설명입니다\n```json\n{\"type\":\"bug\",\"title\":\"t\",\"primary\":\"p\"}\n```";
        let p = parse_draft_response(text).unwrap();
        assert_eq!(p.type_, "bug");
        // title/primary 없는 응답은 실패 → 강등 경로.
        assert!(parse_draft_response("{\"type\":\"bug\"}").is_none());
        assert!(parse_draft_response("no json at all").is_none());
    }

    #[test]
    fn sanitize_slug_forces_ascii_kebab_with_fallback() {
        assert_eq!(sanitize_slug("Fix Journal Cache!!", "fb"), "fix-journal-cache");
        assert_eq!(sanitize_slug("한글만있음", "claude-session-003-auto"), "claude-session-003-auto");
        assert_eq!(sanitize_slug("  --weird__name--  ", "fb"), "weird-name");
        let long = sanitize_slug(&"a".repeat(100), "fb");
        assert!(long.len() <= 40);
    }

    #[test]
    fn compose_body_enforces_type_headers() {
        let body = compose_body(EntryType::Bug, &plan("bug"), "메모줄");
        let h_cause = body.find("## 발생 원인").unwrap();
        let h_fix = body.find("## 해결 방법").unwrap();
        let h_verify = body.find("## 검증").unwrap();
        assert!(h_cause < h_fix && h_fix < h_verify, "헤더 순서 강제");
        assert!(body.contains("cargo test 12개 그린"));
        assert!(body.contains("메모줄"));

        let feature = compose_body(EntryType::Feature, &plan("feature"), "m");
        assert!(feature.contains("## 추가 기능") && feature.contains("## 동작 흐름"));

        // 검증이 비면 정직한 플레이스홀더.
        let mut p = plan("bug");
        p.verification = String::new();
        let body = compose_body(EntryType::Bug, &p, "m");
        assert!(body.contains("검증 근거를 찾지 못함"));
    }

    #[test]
    fn files_from_events_dedupes_by_last_op_and_drops_masked() {
        let ev = |sid: &str, path: &str, op: FileOp| FileChangeEvent {
            ts: "t".into(),
            session_id: sid.into(),
            op,
            path: path.into(),
            hash_before: None,
            hash_after: None,
            bytes: 1,
        };
        let events = vec![
            ev("20260720-001", "src/a.rs", FileOp::Create),
            ev("20260720-001", "src/a.rs", FileOp::Update),
            ev("20260720-002", "src/other-session.rs", FileOp::Update),
            ev("20260720-001", "**redacted/sensitive**:abcd", FileOp::Update),
        ];
        let files = files_from_events(&events, "20260720-001");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/a.rs");
        assert!(matches!(files[0].op, FileOp::Update), "마지막 op 이 이긴다");
    }

    #[test]
    fn self_entry_detection_only_sees_window() {
        let dir = TempDir::new().unwrap();
        let day = dir.path().join("20260720");
        std::fs::create_dir_all(day.join("Bugs")).unwrap();

        // 창 시작 전에 존재하던 파일만 있음 → false.
        std::fs::write(day.join("Bugs/0900_bug_old.md"), "x").unwrap();
        let future = SystemTime::now() + Duration::from_secs(3600);
        assert!(!self_entry_exists(&day, future));

        // 창 안(지금) 파일 → true.
        let past = SystemTime::now() - Duration::from_secs(60);
        assert!(self_entry_exists(&day, past));

        // 디렉토리 자체가 없으면 false (첫 세션).
        assert!(!self_entry_exists(&dir.path().join("29990101"), past));
    }

    #[test]
    fn degraded_body_keeps_session_meta() {
        let session = Session {
            id: "20260720-003".into(),
            started_at: "2026-07-20T14:00:00+09:00".into(),
            ended_at: None,
            ended_reason: None,
            active_window_ms: 0,
            file_event_count: 0,
            files_unique: 0,
            git_head_at_start: None,
            git_head_at_end: None,
            agent_label_guess: None,
            linked_journal_entries: vec![],
        };
        let body = compose_degraded_body(&session, &[], "LLM 호출 실패", "메모");
        assert!(body.contains("20260720-003"));
        assert!(body.contains("LLM 호출 실패"));
        assert!(body.contains("## 검증"));
    }
}

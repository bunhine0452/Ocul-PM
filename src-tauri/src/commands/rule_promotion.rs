//! PR-CI4 — 실패→규칙 승격 커맨드 (thin). 로직은 `oculpm::rule_promotion` 소유.
//!
//! 두 커맨드뿐이다: 결정적 후보 나열(`rule_candidates`, LLM 없음)과 옵인 초안
//! 생성(`rule_draft_generate`, 과금 — 회고 화면의 "초안 생성" 버튼이 부른다).
//! **승인/저장 커맨드는 없다** — 프런트가 초안의 `content` 를 들고 기존
//! `rules_save`(CI3) 를 명시적으로 호출해야만 파일이 생긴다 (자동 적용 경로
//! 부재의 구조적 보장, 마스터플랜 D5).

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::llm;
use crate::oculpm::cache::{JournalCache, RangeEntry};
use crate::oculpm::rule_promotion::{self, RuleCandidate, RuleDraft};

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

async fn range_entries(
    db: &Db,
    project_id: u32,
    since: &str,
    until: &str,
) -> Result<Vec<RangeEntry>, String> {
    JournalCache::new(db)
        .range_entries(project_id, since, until)
        .await
        .map_err(|e| e.to_string())
}

/// 기간 내 반복 실패 클러스터(규칙 후보)를 결정적으로 뽑는다 — LLM 없음.
/// 이미 규칙이 덮는 영역·승격된 후보(promoted-from 마커)는 제외된다.
#[tauri::command]
#[specta::specta]
pub async fn rule_candidates(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
) -> Result<Vec<RuleCandidate>, String> {
    let root = project_root(&db, project_id).await?;
    let entries = range_entries(&db, project_id, &since, &until).await?;
    Ok(rule_promotion::candidates_for(&root, &entries))
}

/// 후보 하나의 증거(일지 본문 redact 발췌 + entry_diffs 변경 파일)로 LLM 규칙
/// 초안을 만든다. 과금 호출 — 사용자가 버튼으로만 트리거한다. 파일은 쓰지
/// 않는다 (저장은 프런트의 `rules_save` 승인 경로 전담).
#[tauri::command]
#[specta::specta]
pub async fn rule_draft_generate(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
    candidate_key: String,
    provider: String,
    model: String,
) -> Result<RuleDraft, String> {
    let root = project_root(&db, project_id).await?;
    let entries = range_entries(&db, project_id, &since, &until).await?;
    let candidate = rule_promotion::candidates_for(&root, &entries)
        .into_iter()
        .find(|c| c.key == candidate_key)
        .ok_or_else(|| {
            "Candidate not found - journals or rules may have changed since; refresh and retry"
                .to_string()
        })?;
    let evidence = rule_promotion::gather_evidence(&root, &candidate, &entries);

    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("No API key configured for {provider}"))?
    };
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: crate::oculpm::content_lang::current(&db).await
                        .apply(rule_promotion::DRAFT_SYSTEM_PROMPT),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: rule_promotion::build_draft_prompt(&candidate, &evidence),
                },
            ],
            llm::ChatOptions {
                model,
                temperature: Some(0.3),
                max_tokens: Some(1400),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    rule_promotion::parse_draft_response(&candidate, &response.content)
}

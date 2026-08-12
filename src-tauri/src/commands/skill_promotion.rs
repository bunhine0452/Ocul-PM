//! 반복 절차→스킬 승격 커맨드 (thin). 로직은 `oculpm::skill_promotion` 소유 —
//! rule_promotion 커맨드의 미러.
//!
//! 두 커맨드뿐이다: 결정적 후보 나열(`skill_candidates`, LLM 없음)과 옵인 초안
//! 생성(`skill_draft_generate`, 과금 — 회고 화면의 "초안 생성" 버튼이 부른다).
//! **승인/저장 커맨드는 없다** — 프런트가 초안의 `content` 를 들고 기존
//! `skills_save`(scope=project, create=true) 를 명시적으로 호출해야만 파일이
//! 생긴다 (자동 적용 경로 부재의 구조적 보장).

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::llm;
use crate::oculpm::cache::{JournalCache, RangeEntry};
use crate::oculpm::skill_promotion::{self, SkillCandidate, SkillDraft};

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

/// 기간 내 반복 tag 클러스터(스킬 후보)를 결정적으로 뽑는다 — LLM 없음.
/// 이미 스킬 폴더가 있는 슬러그·승격된 tag(promoted-from 마커)는 제외된다.
#[tauri::command]
#[specta::specta]
pub async fn skill_candidates(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
) -> Result<Vec<SkillCandidate>, String> {
    let root = project_root(&db, project_id).await?;
    let entries = range_entries(&db, project_id, &since, &until).await?;
    Ok(skill_promotion::candidates_for(&root, &entries))
}

/// 후보 하나의 증거(일지 본문 redact 발췌)로 LLM 스킬 초안(SKILL.md)을 만든다.
/// 과금 호출 — 사용자가 버튼으로만 트리거한다. 파일은 쓰지 않는다 (저장은
/// 프런트의 `skills_save` 승인 경로 전담).
#[tauri::command]
#[specta::specta]
pub async fn skill_draft_generate(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
    tag: String,
    provider: String,
    model: String,
) -> Result<SkillDraft, String> {
    let root = project_root(&db, project_id).await?;
    let entries = range_entries(&db, project_id, &since, &until).await?;
    let candidate = skill_promotion::candidates_for(&root, &entries)
        .into_iter()
        .find(|c| c.tag == tag)
        .ok_or_else(|| {
            "Candidate not found - journals or skills may have changed since; refresh and retry"
                .to_string()
        })?;
    let evidence = skill_promotion::gather_evidence(&root, &candidate, &entries);

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
                        .apply(skill_promotion::DRAFT_SYSTEM_PROMPT),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: skill_promotion::build_draft_prompt(&candidate, &evidence),
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

    skill_promotion::parse_draft_response(&candidate, &response.content)
}

//! PR-CI3 — 규칙 허브 커맨드 (docs/claude-integration/03-rules-hub-ui-spec.md §4).
//!
//! 스킬·규칙 허브의 "규칙" 탭이 부른다. 실제 로직은 `oculpm::rules` 소유 —
//! 여기는 project_id → 루트/홈 해석, config 의 번역 옵인 조회, 미러 조합만
//! 한다 (commands 는 얇게, CLAUDE.md 규약).
//!
//! 번역 옵인 토글 자체는 신규 커맨드가 아니라 기존 `oculpm_set_config` 로
//! `agents.rules_translate` 를 쓰고, 직후 `rules_sync_translations` 를 부른다.

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::rules::{
    self, MirrorWriteResult, RuleDetail, RuleKind, RuleSaveOutcome, RuleScope, RulesOverview,
};

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn scope_root(scope: RuleScope, project_root: &PathBuf) -> Result<PathBuf, String> {
    match scope {
        RuleScope::Project => Ok(project_root.clone()),
        RuleScope::Global => rules::home_dir().map_err(|e| e.to_string()),
    }
}

/// `.oculpm` 미초기화 프로젝트는 번역 off 로 강등한다 (규칙 조회 자체는
/// `.oculpm` 없이도 동작해야 하므로 에러로 만들지 않는다).
async fn cursor_translate_on(manager: &OculpmManager, project_id: u32) -> bool {
    manager
        .get_config(project_id)
        .await
        .map(|c| c.agents.rules_translate.iter().any(|t| t == "cursor"))
        .unwrap_or(false)
}

/// CLAUDE.md 슬롯 + 프로젝트/전역 규칙을 한 번에 나열한다.
#[tauri::command]
#[specta::specta]
pub async fn rules_list(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<RulesOverview, String> {
    let root = project_root(&db, project_id).await?;
    let home = rules::home_dir().map_err(|e| e.to_string())?;
    let translate = cursor_translate_on(&manager, project_id).await;
    Ok(rules::overview(&root, &home, translate))
}

/// 단일 규칙/CLAUDE.md 파일 원문을 읽는다.
#[tauri::command]
#[specta::specta]
pub async fn rules_read(
    db: State<'_, Db>,
    project_id: u32,
    scope: RuleScope,
    rel_path: String,
) -> Result<RuleDetail, String> {
    let root = project_root(&db, project_id).await?;
    let sroot = scope_root(scope, &root)?;
    rules::read(scope, &sroot, &root, &rel_path)
}

/// 저장 (`create=true` 는 신규 — 기존 파일 거부). 프로젝트 규칙이고 번역이
/// 켜져 있으면 Cursor 미러를 병행 갱신해 결과를 함께 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn rules_save(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    scope: RuleScope,
    rel_path: String,
    content: String,
    create: bool,
) -> Result<RuleSaveOutcome, String> {
    let root = project_root(&db, project_id).await?;
    let sroot = scope_root(scope, &root)?;
    let entry = rules::save(scope, &sroot, &root, &rel_path, &content, create)?;
    let mirror = if scope == RuleScope::Project
        && entry.kind == RuleKind::Rule
        && cursor_translate_on(&manager, project_id).await
    {
        Some(rules::write_mirror(&root, &rel_path, &content))
    } else {
        None
    };
    Ok(RuleSaveOutcome { entry, mirror })
}

/// 규칙 삭제 (`.claude/rules/**` 만 — CLAUDE.md 계열은 구조적으로 거부).
/// 프로젝트 규칙이면 마커 미러도 함께 걷어낸다 (옵인 여부 무관 — 잔재 제거).
#[tauri::command]
#[specta::specta]
pub async fn rules_delete(
    db: State<'_, Db>,
    project_id: u32,
    scope: RuleScope,
    rel_path: String,
) -> Result<Option<MirrorWriteResult>, String> {
    let root = project_root(&db, project_id).await?;
    let sroot = scope_root(scope, &root)?;
    rules::delete(scope, &sroot, &rel_path)?;
    Ok((scope == RuleScope::Project).then(|| rules::remove_mirror(&root, &rel_path)))
}

/// config 기준으로 미러 전체를 화해시킨다 (토글 직후 + 수동 재동기화).
#[tauri::command]
#[specta::specta]
pub async fn rules_sync_translations(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Vec<MirrorWriteResult>, String> {
    let root = project_root(&db, project_id).await?;
    let enabled = cursor_translate_on(&manager, project_id).await;
    Ok(rules::sync_mirrors(&root, enabled))
}

//! Tauri commands for local git operations.
//! (GitHub PAT verify 는 감사(2026-07-16)에서 은퇴 — 소비처가 설정 탭 verify
//! 버튼뿐인 vestigial 이었다. 로컬 git 은 토큰 없이 git CLI 로 동작한다.)

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::git;

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

#[tauri::command]
#[specta::specta]
pub async fn git_log(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<git::GitCommit>, String> {
    let root = project_root(&db, project_id).await?;
    git::log(&root, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn git_graph(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<git::GitGraphCommit>, String> {
    let root = project_root(&db, project_id).await?;
    git::graph(&root, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn git_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<git::GitRepoStatus, String> {
    let root = project_root(&db, project_id).await?;
    Ok(git::status(&root))
}

/// Lite-W6 PR5 — slim head + dirty-count wrapper for the Today mini git chip.
#[tauri::command]
#[specta::specta]
pub async fn git_head_status_brief(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<git::GitHeadStatusBrief, String> {
    let root = project_root(&db, project_id).await?;
    Ok(git::head_status_brief(&root))
}


//! Tauri commands for git/GitHub operations.

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::{git, github, secrets};

pub const GITHUB_SECRET_NAME: &str = "github_api_key";

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
pub async fn git_remotes(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<git::GitRemote>, String> {
    let root = project_root(&db, project_id).await?;
    git::remotes(&root)
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

/// Lite-W6 PR5 — slim head + dirty-count wrapper for the TitleBar mini git
/// chip. The richer `git_status` is preserved for the legacy GitPanel.
#[tauri::command]
#[specta::specta]
pub async fn git_head_status_brief(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<git::GitHeadStatusBrief, String> {
    let root = project_root(&db, project_id).await?;
    Ok(git::head_status_brief(&root))
}

#[tauri::command]
#[specta::specta]
pub async fn github_verify() -> Result<github::GithubVerifyResult, String> {
    let token = secrets::get(GITHUB_SECRET_NAME)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No GitHub token saved.".to_string())?;
    github::verify_token(&token).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_tags(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<git::GitTag>, String> {
    let root = project_root(&db, project_id).await?;
    git::tags(&root, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn git_log_range(
    db: State<'_, Db>,
    project_id: u32,
    from: String,
    to: String,
    limit: u32,
) -> Result<Vec<git::GitCommit>, String> {
    let root = project_root(&db, project_id).await?;
    git::log_range(&root, &from, &to, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn read_changelog(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<git::ChangelogFile>, String> {
    let root = project_root(&db, project_id).await?;
    git::read_changelog(&root)
}

#[tauri::command]
#[specta::specta]
pub async fn github_releases(
    owner: String,
    repo: String,
    per_page: u32,
) -> Result<Vec<github::GithubRelease>, String> {
    // Token is optional — public repos work without it.
    let token = secrets::get(GITHUB_SECRET_NAME)
        .map_err(|e| e.to_string())?;
    github::list_releases(&owner, &repo, per_page, token.as_deref()).await
}

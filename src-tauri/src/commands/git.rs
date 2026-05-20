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

#[tauri::command]
#[specta::specta]
pub async fn github_verify() -> Result<github::GithubVerifyResult, String> {
    let token = secrets::get(GITHUB_SECRET_NAME)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No GitHub token saved.".to_string())?;
    github::verify_token(&token).await
}

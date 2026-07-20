//! PR-CI2 — MCP 서버 등록 커맨드 (docs/claude-integration/00-master-plan.md D3).
//!
//! 설정 → Agents 의 "MCP 서버" 블록이 부른다. 로직은 `oculpm::mcp::register`
//! 소유 — 여기는 루트 해석·바이너리 탐색·에러 문자열 변환만 (commands 는 얇게).

use tauri::State;

use crate::db::Db;
use crate::oculpm::mcp::register::{
    self, resolve_binary_path, DesktopRegistrationStatus, McpRegistrationStatus,
};

fn desktop_config_path() -> Result<std::path::PathBuf, String> {
    register::desktop_config_path().ok_or_else(|| "홈 디렉터리를 찾지 못했습니다".to_string())
}

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(project.root_path))
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    register::status_with_binary(&root, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_register(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path().ok_or_else(|| {
        "oculpm-mcp 바이너리를 찾지 못했습니다 — dev 에서는 `cargo build --bin oculpm-mcp` 후 다시 시도하세요".to_string()
    })?;
    register::register_with_binary(&root, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_unregister(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    register::unregister_with_binary(&root, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_desktop_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<DesktopRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    register::desktop_status_at(&desktop_config_path()?, &root).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_desktop_register(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<DesktopRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path().ok_or_else(|| {
        "oculpm-mcp 바이너리를 찾지 못했습니다 — dev 에서는 `cargo build --bin oculpm-mcp` 후 다시 시도하세요".to_string()
    })?;
    register::desktop_register_at(&desktop_config_path()?, &root, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_desktop_unregister(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<DesktopRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    register::desktop_unregister_at(&desktop_config_path()?, &root).map_err(|e| e.to_string())
}

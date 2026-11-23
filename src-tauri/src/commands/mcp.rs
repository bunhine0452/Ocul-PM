//! PR-CI2 — MCP 서버 등록 커맨드 (docs/claude-integration/00-master-plan.md D3).
//!
//! 설정 → Agents 의 "MCP 서버" 블록이 부른다. 로직은 `oculpm::mcp::register`
//! 소유 — 여기는 루트 해석·바이너리 탐색·에러 문자열 변환만 (commands 는 얇게).
//! 다른 도구의 설정 위치(OS 별)는 `oculpm::paths` 한 곳이 안다.

use tauri::State;

use crate::db::Db;
use crate::oculpm::mcp::{
    agent_json::{self, AgentMcpStatus, AgentMcpTarget},
    codex::{self, CodexPluginStatus, CodexRegistrationStatus},
    register::{self, locate_binary, resolve_binary_path, McpRegistrationStatus},
};

fn codex_config_path() -> Result<std::path::PathBuf, String> {
    codex::config_path().ok_or_else(|| "Could not find the home directory".to_string())
}

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
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
    let binary = locate_binary()?;
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

/// Codex 는 Claude 의 프로젝트 `.mcp.json` 을 읽지 않는다. 이 명령들은
/// `~/.codex/config.toml` 의 oculpm stdio 항목 **하나**를 관리한다.
///
/// **머신 스코프다.** 그 파일은 모든 Codex 세션에 실리므로 프로젝트별 항목을
/// 만들면 안 된다 — 루트를 박은 항목이 다른 프로젝트의 기록까지 그리로 보낸다.
/// 대신 인자 없는 서버 하나를 두고, 루트는 세션의 작업 폴더(cwd)가 정한다.
#[tauri::command]
#[specta::specta]
pub fn codex_mcp_status() -> Result<CodexRegistrationStatus, String> {
    let binary = resolve_binary_path();
    codex::status_at(&codex_config_path()?, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn codex_mcp_register() -> Result<CodexRegistrationStatus, String> {
    let binary = locate_binary()?;
    codex::register_at(&codex_config_path()?, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn codex_mcp_unregister() -> Result<CodexRegistrationStatus, String> {
    let binary = resolve_binary_path();
    codex::unregister_at(&codex_config_path()?, binary.as_deref()).map_err(|e| e.to_string())
}

/// Cursor · Gemini CLI — 프로젝트의 `.cursor/mcp.json` · `.gemini/settings.json` 에 우리
/// 서버 하나를 제자리 병합한다 (사용자 결정 11-23: 설정에서 누를 때만). 실행 경로는 위의
/// Claude · Codex 등록과 같은 출처, 홈은 감지에만 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn agent_mcp_status(
    db: State<'_, Db>,
    project_id: u32,
    target: AgentMcpTarget,
) -> Result<AgentMcpStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    let home = crate::oculpm::paths::home_dir();
    agent_json::status(target, &root, home.as_deref(), binary.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn agent_mcp_register(
    db: State<'_, Db>,
    project_id: u32,
    target: AgentMcpTarget,
) -> Result<AgentMcpStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = locate_binary()?;
    let home = crate::oculpm::paths::home_dir();
    agent_json::register(target, &root, home.as_deref(), &binary)
}

#[tauri::command]
#[specta::specta]
pub async fn agent_mcp_unregister(
    db: State<'_, Db>,
    project_id: u32,
    target: AgentMcpTarget,
) -> Result<AgentMcpStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    let home = crate::oculpm::paths::home_dir();
    agent_json::unregister(target, &root, home.as_deref(), binary.as_deref())
}

/// Codex 플러그인 설치 상태 (머신 스코프, **읽기 전용**). 설치·해제는
/// `codex plugin` CLI 가 해야 마켓플레이스가 캐시까지 펼쳐진다 — 설정만
/// 흉내 내면 캐시 없는 반쪽 상태가 되므로 화면은 명령만 안내한다.
#[tauri::command]
#[specta::specta]
pub fn codex_plugin_status() -> Result<CodexPluginStatus, String> {
    let config = codex_config_path()?;
    let home = config
        .parent()
        .ok_or_else(|| "Could not find the Codex home directory".to_string())?;
    Ok(codex::plugin_status_at(&config, home))
}

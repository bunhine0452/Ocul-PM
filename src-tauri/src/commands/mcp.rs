//! PR-CI2 — MCP 서버 등록 커맨드 (docs/claude-integration/00-master-plan.md D3).
//!
//! 설정 → Agents 의 "MCP 서버" 블록이 부른다. 로직은 `oculpm::mcp::register`
//! 소유 — 여기는 루트 해석·바이너리 탐색·에러 문자열 변환만 (commands 는 얇게).

use tauri::State;

use crate::db::Db;
use crate::oculpm::mcp::{
    codex::{self, CodexPluginStatus, CodexRegistrationStatus},
    register::{self, resolve_binary_path, DesktopRegistrationStatus, McpRegistrationStatus},
};

fn desktop_config_path() -> Result<std::path::PathBuf, String> {
    register::desktop_config_path().ok_or_else(|| "Could not find the home directory".to_string())
}

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
    let binary = resolve_binary_path().ok_or_else(|| {
        "Could not find the oculpm-mcp binary - in dev, run `cargo build --bin oculpm-mcp` and retry".to_string()
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

/// Codex는 Claude의 프로젝트 `.mcp.json`을 읽지 않는다. 이 명령들은
/// `~/.codex/config.toml`의 프로젝트별 oculpm stdio 항목만 관리한다.
#[tauri::command]
#[specta::specta]
pub async fn codex_mcp_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<CodexRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    codex::status_at(&codex_config_path()?, &root, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn codex_mcp_register(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<CodexRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path().ok_or_else(|| {
        "Could not find the oculpm-mcp binary - in dev, run `cargo build --bin oculpm-mcp` and retry".to_string()
    })?;
    codex::register_at(&codex_config_path()?, &root, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn codex_mcp_unregister(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<CodexRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    codex::unregister_at(&codex_config_path()?, &root, binary.as_deref()).map_err(|e| e.to_string())
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
        "Could not find the oculpm-mcp binary - in dev, run `cargo build --bin oculpm-mcp` and retry".to_string()
    })?;
    register::desktop_register_at(&desktop_config_path()?, &root, &binary)
        .map_err(|e| e.to_string())
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

// ─── A3 — Claude Code 플러그인 설치 감지 ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ClaudePluginStatus {
    pub installed: bool,
    /// 발견된 플러그인 디렉터리 (installed=true 일 때).
    pub path: Option<String>,
}

/// `~/.claude/plugins/**` 를 얕게 훑어 oculpm 플러그인 설치 여부를 본다.
/// 설치 레이아웃(마켓플레이스 캐시 구조)이 CLI 버전에 따라 다를 수 있어
/// "이름이 oculpm 인 `.claude-plugin/plugin.json`" 을 깊이 6·항목 2,000개
/// 상한으로 탐색한다 — 설정 화면의 택일 안내(훅·MCP 이중 등록 방지)용이라
/// 놓쳐도 무해(안내가 안 뜰 뿐), 오탐만 없으면 된다.
#[tauri::command]
#[specta::specta]
pub fn claude_plugin_status() -> ClaudePluginStatus {
    let none = ClaudePluginStatus {
        installed: false,
        path: None,
    };
    let Some(base) =
        directories::BaseDirs::new().map(|b| b.home_dir().join(".claude").join("plugins"))
    else {
        return none;
    };
    if !base.is_dir() {
        return none;
    }
    let mut budget = 2_000usize;
    match find_oculpm_plugin(&base, 6, &mut budget) {
        Some(dir) => ClaudePluginStatus {
            installed: true,
            path: Some(dir.display().to_string()),
        },
        None => none,
    }
}

fn find_oculpm_plugin(
    dir: &std::path::Path,
    depth: u8,
    budget: &mut usize,
) -> Option<std::path::PathBuf> {
    if depth == 0 || *budget == 0 {
        return None;
    }
    let manifest = dir.join(".claude-plugin").join("plugin.json");
    if manifest.is_file() {
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v.get("name").and_then(|n| n.as_str()) == Some("oculpm") {
                    return Some(dir.to_path_buf());
                }
            }
        }
        // 다른 플러그인의 루트 — 그 아래로 더 내려갈 이유가 없다.
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir() && !t.is_symlink())
            .unwrap_or(false);
        if is_dir {
            if let Some(hit) = find_oculpm_plugin(&path, depth - 1, budget) {
                return Some(hit);
            }
        }
    }
    None
}

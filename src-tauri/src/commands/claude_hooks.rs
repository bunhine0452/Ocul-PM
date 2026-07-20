//! PR-CI0 — Claude Code 훅 연동 커맨드 (docs/claude-integration/00-master-plan.md D2).
//!
//! 설정 → 에이전트 탭의 옵인 토글이 이 3개 커맨드를 부른다. 실제 로직은
//! `oculpm::claude_hooks` 소유 — 여기는 project_id → 루트 해석과 에러 문자열
//! 변환만 한다 (commands 는 얇게, CLAUDE.md 규약).

use tauri::State;

use crate::db::Db;
use crate::oculpm::claude_hooks::{self, ClaudeHooksStatus};

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(project.root_path))
}

/// 현재 설치 상태 조회 (쓰기 없음).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::status(&root).map_err(|e| e.to_string())
}

/// 훅 설치 (멱등 — 드리프트 복구도 이걸 다시 부르면 된다).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_install(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::install(&root).map_err(|e| e.to_string())
}

/// 훅 제거 (우리 서명 엔트리만 — 사용자 훅·인박스 파일은 보존).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_uninstall(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::uninstall(&root).map_err(|e| e.to_string())
}

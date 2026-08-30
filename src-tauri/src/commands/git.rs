//! Tauri commands for local git operations.
//! (GitHub PAT verify 는 감사(2026-07-16)에서 은퇴 — 소비처가 설정 탭 verify
//! 버튼뿐인 vestigial 이었다. 로컬 git 은 토큰 없이 git CLI 로 동작한다.)

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::git;

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
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
    // git 은 서브프로세스 — 런타임 워커를 붙잡지 않게 blocking 풀로 (아래 셋도).
    blocking(move || git::log(&root, limit)).await
}

/// 동기 git 호출을 blocking 풀에서 돌린다. 예전엔 `async fn` 안에서
/// `Command::output()` 을 그대로 불러 워커 스레드가 5~80ms 씩 멈췄다.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn git_graph(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<git::GitGraphCommit>, String> {
    let root = project_root(&db, project_id).await?;
    blocking(move || git::graph(&root, limit)).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_status(db: State<'_, Db>, project_id: u32) -> Result<git::GitRepoStatus, String> {
    let root = project_root(&db, project_id).await?;
    blocking(move || Ok(git::status(&root))).await
}

/// 에디터 거터 (#git-gutter) — HEAD 대비 **지금 버퍼**의 줄 변경.
///
/// `git diff` 가 아니라 버퍼를 받는 이유: 거터는 **저장하기 전에** 무엇을
/// 고쳤는지 보여야 쓸모가 있다. 저장소 밖 파일은 빈 목록이다 (오류가 아니다 —
/// 추적되지 않는 폴더를 열어도 편집기는 동작해야 한다).
#[tauri::command]
#[specta::specta]
pub async fn git_line_changes(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    text: String,
) -> Result<Vec<git::GitLineChange>, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || git::line_changes(&root, &rel_path, &text))
        .await
        .map_err(|e| format!("Failed to diff the file: {e}"))
}

/// Lite-W6 PR5 — slim head + dirty-count wrapper for the Today mini git chip.
#[tauri::command]
#[specta::specta]
pub async fn git_head_status_brief(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<git::GitHeadStatusBrief, String> {
    let root = project_root(&db, project_id).await?;
    blocking(move || Ok(git::head_status_brief(&root))).await
}

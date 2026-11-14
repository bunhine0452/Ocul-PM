//! Today 의 계획 쪽 집계 한 번 (`oculpm::planner::digest`) — 4.0 `{#ui-today}`.

use tauri::State;

use crate::db::Db;
use crate::oculpm::planner::digest::{self, TodayDigest};
use crate::oculpm::planner::project::PlanCache;

use super::plan::planner_root_of;

/// 활성 플랜의 판정·다음 리프·사람 몫·막힘과 일지 → 계획 연결. LLM 0 · 네트워크 0.
/// 「통과 뒤 바뀜」 · 「여기선 아직」 은 계획 화면과 같은 `digest::mark_stale` 이 채운다.
#[tauri::command]
#[specta::specta]
pub async fn today_digest(db: State<'_, Db>, project_id: u32) -> Result<TodayDigest, String> {
    let root = planner_root_of(&db, project_id).await?;
    let details = digest::load_details(&PlanCache::new(&db), project_id, &root).await?;
    let mut out = digest::build(details);
    digest::mark_stale(&db, project_id, &mut out.plans, &out.journal_plan).await;
    Ok(out)
}

/// 이 기기에만 있는 것 — 커밋 안 한 변경(그중 기록) · 어느 리모트에도 없는 커밋 (`git::local_only`).
/// git 저장소가 아니거나 리모트가 없으면 `None`. git 은 읽기만 · 네트워크 0.
#[tauri::command]
#[specta::specta]
pub async fn today_local_only(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<crate::git::local_only::LocalOnly>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(project.root_path);
    tokio::task::spawn_blocking(move || crate::git::local_only::local_only(&root))
        .await
        .map_err(|e| e.to_string())
}

/// 받아 온 것 — `since`(epoch 초) 뒤에 받아 온 커밋이 더한 일지와, 리모트와 마지막으로 주고받은 때
/// (`git::arrived`). 받아 오지 않는다 — git 이 남긴 기록을 읽는다. 가지 위가 아니면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn today_arrived(
    db: State<'_, Db>,
    project_id: u32,
    since: u32,
) -> Result<Option<crate::git::arrived::Arrived>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(project.root_path);
    tokio::task::spawn_blocking(move || crate::git::arrived::arrived(&root, since))
        .await
        .map_err(|e| e.to_string())
}

/// 그날 일지 중 동료가 git 으로 더한 것과 그 사람 (`git::authors`). 기록을 안 올리는 저장소면 빈 목록.
#[tauri::command]
#[specta::specta]
pub async fn today_teammates(
    db: State<'_, Db>,
    project_id: u32,
    workday: String,
) -> Result<Vec<crate::git::authors::TeamJournal>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(project.root_path);
    tokio::task::spawn_blocking(move || crate::git::authors::teammates(&root, &workday))
        .await
        .map_err(|e| e.to_string())
}

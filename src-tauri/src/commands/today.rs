//! Today 의 계획 쪽 집계 한 번 (`oculpm::planner::digest`) — 4.0 `{#ui-today}`.

use tauri::State;

use crate::db::Db;
use crate::oculpm::planner::digest::{self, TodayDigest};
use crate::oculpm::planner::project::PlanCache;

use super::plan::planner_root_of;

/// 활성 플랜의 판정·다음 리프·사람 몫·막힘과 일지 → 계획 연결. LLM 0 · 네트워크 0.
#[tauri::command]
#[specta::specta]
pub async fn today_digest(db: State<'_, Db>, project_id: u32) -> Result<TodayDigest, String> {
    let root = planner_root_of(&db, project_id).await?;
    let details = digest::load_details(&PlanCache::new(&db), project_id, &root).await?;
    Ok(digest::build(details))
}

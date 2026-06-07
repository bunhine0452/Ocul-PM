//! Planner (file-based Plan) commands — PR-PLN 0 read side.
//!
//! Each command reprojects the `.oculpm/planner/*.md` SSOT into the
//! `oculpm_plan*` cache and returns DTOs, so results are always fresh even
//! before the watcher live-push lands. Writes (`plan_apply_edit` /
//! `plan_create`) land in PR-PLN 1.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::Db;
use crate::oculpm::planner::project::{
    planner_dir, PlanCache, PlanDetail, PlanItemUpdateDto, PlanSummary,
};

async fn planner_root_of(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(planner_dir(Path::new(&project.root_path)))
}

/// List the project's plans (summary + progress + done counts).
#[tauri::command]
#[specta::specta]
pub async fn plan_list(db: State<'_, Db>, project_id: u32) -> Result<Vec<PlanSummary>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db).list(project_id, &root).await
}

/// One plan's detail: items (with per-item last attribution), decisions, and
/// non-fatal parse warnings. `None` when the plan_id isn't found.
#[tauri::command]
#[specta::specta]
pub async fn plan_get(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
) -> Result<Option<PlanDetail>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// Append-only attribution history for one item (who changed it, when,
/// from→to, linked journal).
#[tauri::command]
#[specta::specta]
pub async fn plan_item_history(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
    item_id: String,
) -> Result<Vec<PlanItemUpdateDto>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db)
        .item_history(project_id, &root, &plan_id, &item_id)
        .await
}

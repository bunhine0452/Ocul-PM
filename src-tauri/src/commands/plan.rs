//! Planner (file-based Plan) commands — PR-PLN 0 read side.
//!
//! Each command reprojects the `.oculpm/planner/*.md` SSOT into the
//! `oculpm_plan*` cache and returns DTOs, so results are always fresh even
//! before the watcher live-push lands. Writes (`plan_apply_edit` /
//! `plan_create`) land in PR-PLN 1.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::Db;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::planner::parse::ItemStatus;
use crate::oculpm::planner::plan_edit::{
    add_item, append_log_row, create_plan_skeleton, set_item_status, LogRow,
};
use crate::oculpm::planner::project::{
    find_plan_path, planner_dir, slug_for, PlanCache, PlanDetail, PlanItemUpdateDto, PlanSummary,
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

// ─── write side (PR-PLN 1) ───────────────────────────────────────────────────

/// An edit applied by the app / in-app AI to a plan. External agents edit the
/// `.md` directly per AGENTS.md (PR-PLN 2); this is the in-app equivalent.
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanEditOp {
    /// Flip an existing item's status.
    SetStatus { item_id: String, status: String },
    /// Add a new item under a phase (created if absent).
    AddItem {
        phase: String,
        title: String,
        item_id: Option<String>,
        status: Option<String>,
    },
}

fn free_plan_path(root: &Path, base: &str) -> (String, PathBuf) {
    let mut id = base.to_string();
    let mut n = 2;
    loop {
        let path = root.join(format!("{id}.md"));
        if !path.exists() {
            return (id, path);
        }
        id = format!("{base}-{n}");
        n += 1;
    }
}

/// Create a new empty plan (`.oculpm/planner/<slug>.md`) and return its summary.
#[tauri::command]
#[specta::specta]
pub async fn plan_create(
    db: State<'_, Db>,
    project_id: u32,
    title: String,
) -> Result<PlanSummary, String> {
    let root = planner_root_of(&db, project_id).await?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let (id, path) = free_plan_path(&root, &slug_for(&title));
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let md = create_plan_skeleton(&id, title.trim(), "user", &date);
    write_atomic(&path, md.as_bytes()).map_err(|e| e.to_string())?;

    let summaries = PlanCache::new(&db).list(project_id, &root).await?;
    summaries
        .into_iter()
        .find(|s| s.plan_id == id)
        .ok_or_else(|| "plan created but missing from projection".to_string())
}

/// Apply an edit to a plan's `.md` SSOT: mutate the body (glyph / new item) and
/// append an attribution row to the plan-log, stamped with `agent_id`
/// (defaults to `user`). Returns the refreshed plan detail.
#[tauri::command]
#[specta::specta]
pub async fn plan_apply_edit(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
    op: PlanEditOp,
    agent_id: Option<String>,
) -> Result<Option<PlanDetail>, String> {
    let root = planner_root_of(&db, project_id).await?;
    let agent = agent_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "user".to_string());
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().to_rfc3339();

    let new_md = match op {
        PlanEditOp::SetStatus { item_id, status } => {
            let new_status = ItemStatus::parse_status(&status)
                .ok_or_else(|| format!("unknown status '{status}'"))?;
            let res = set_item_status(&md, &item_id, new_status)?;
            let row = LogRow {
                ts,
                item_id,
                agent_id: agent,
                from: Some(res.old_status),
                to: Some(new_status),
                journal_ref: None,
                note: None,
            };
            append_log_row(&res.md, &row)
        }
        PlanEditOp::AddItem {
            phase,
            title,
            item_id,
            status,
        } => {
            let st = match status {
                Some(s) => ItemStatus::parse_status(&s)
                    .ok_or_else(|| format!("unknown status '{s}'"))?,
                None => ItemStatus::Todo,
            };
            let iid = item_id
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| slug_for(&title));
            let added = add_item(&md, &phase, &title, &iid, st)?;
            let row = LogRow {
                ts,
                item_id: iid,
                agent_id: agent,
                from: None,
                to: Some(st),
                journal_ref: None,
                note: Some("created".to_string()),
            };
            append_log_row(&added, &row)
        }
    };

    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

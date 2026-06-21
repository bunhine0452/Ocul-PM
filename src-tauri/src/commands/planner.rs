//! Planner commands — Goal & Subtask CRUD for M4 PM features.

use tauri::State;

use crate::db::{Db, Goal, Subtask};

// ---------- Goals ----------

#[tauri::command]
#[specta::specta]
pub async fn goal_create(
    db: State<'_, Db>,
    project_id: Option<u32>,
    title: String,
    description: Option<String>,
    priority: i32,
    due_date: Option<i32>,
) -> Result<Goal, String> {
    db.create_goal(project_id, title, description, priority, due_date)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn goal_list(
    db: State<'_, Db>,
    project_id: Option<u32>,
    status_filter: Option<String>,
) -> Result<Vec<Goal>, String> {
    db.list_goals(project_id, status_filter)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn goal_update(
    db: State<'_, Db>,
    goal_id: u32,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    priority: Option<i32>,
    due_date: Option<Option<i32>>,
    progress: Option<f64>,
) -> Result<Goal, String> {
    db.update_goal(goal_id, title, description, status, priority, due_date, progress)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn goal_delete(db: State<'_, Db>, goal_id: u32) -> Result<(), String> {
    db.delete_goal(goal_id).await.map_err(|e| e.to_string())
}

// ---------- Subtasks ----------

#[tauri::command]
#[specta::specta]
pub async fn subtask_create(
    db: State<'_, Db>,
    goal_id: u32,
    title: String,
) -> Result<Subtask, String> {
    db.create_subtask(goal_id, title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn subtask_list(
    db: State<'_, Db>,
    goal_id: u32,
) -> Result<Vec<Subtask>, String> {
    db.list_subtasks(goal_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn subtask_toggle(
    db: State<'_, Db>,
    subtask_id: u32,
) -> Result<Subtask, String> {
    db.toggle_subtask(subtask_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn subtask_delete(
    db: State<'_, Db>,
    subtask_id: u32,
) -> Result<(), String> {
    db.delete_subtask(subtask_id)
        .await
        .map_err(|e| e.to_string())
}

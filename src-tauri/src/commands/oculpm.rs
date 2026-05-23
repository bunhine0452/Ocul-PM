//! Tauri commands for the `.oculpm/` subsystem (W1-PR6).
//!
//! The thin layer here only:
//! - resolves project root via the existing `Db::get_project`,
//! - delegates to `OculpmManager`, and
//! - flattens any `OculpmError` into a `String` for the wire boundary.
//!
//! Later phases (W2 onwards) add watcher / session / journal / migration
//! commands alongside these four.

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::{OculpmConfig, OculpmInitReport, OculpmStatus};

#[tauri::command]
#[specta::specta]
pub async fn oculpm_init(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmInitReport, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);
    manager
        .init_project(project_id, &root)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_status(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmStatus, String> {
    Ok(manager.get_status(project_id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmConfig, String> {
    manager
        .get_config(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    new_config: OculpmConfig,
) -> Result<(), String> {
    manager
        .set_config(project_id, new_config)
        .await
        .map_err(|e| e.to_string())
}

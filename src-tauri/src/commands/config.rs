//! Commands for app configuration.
//!
//! Two backing stores:
//! - **secrets**: OS keychain (API keys; values never leave the backend).
//! - **settings**: SQLite (non-secret user prefs like default model).

use tauri::State;

use crate::db::Db;
use crate::secrets;

// ---------- Settings (SQLite) ----------

#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    db: State<'_, Db>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.settings_set(key, value).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(
    db: State<'_, Db>,
    key: String,
) -> Result<Option<String>, String> {
    db.settings_get(key).await.map_err(|e| e.to_string())
}

// ---------- Secrets (OS keychain) ----------

#[tauri::command]
#[specta::specta]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    secrets::set(&name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn secret_has(name: String) -> Result<bool, String> {
    secrets::has(&name).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn secret_delete(name: String) -> Result<(), String> {
    secrets::delete(&name).map_err(|e| e.to_string())
}

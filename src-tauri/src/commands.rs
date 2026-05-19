use tauri::State;

use crate::db::{Db, DbHealth};
use crate::secrets;

#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ---------- DB ----------

#[tauri::command]
#[specta::specta]
pub async fn db_health(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.health().await.map_err(|e| e.to_string())
}

// ---------- Settings (non-secret, stored in SQLite) ----------

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
// Note: secret values are never returned to the frontend. The UI can only
// set, check existence, and delete. The backend reads them when needed.

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

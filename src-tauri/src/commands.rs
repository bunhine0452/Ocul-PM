use tauri::State;

use crate::db::{Db, DbHealth};

#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
#[specta::specta]
pub async fn db_health(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.health().await.map_err(|e| e.to_string())
}

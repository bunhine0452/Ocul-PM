//! Commands for app configuration — settings live in SQLite.
//!
//! (OS 키체인의 API 키 저장소는 4.0 에서 앱 안 LLM 호출과 함께 걷었다 — 앱이 더는
//! 비밀을 다루지 않는다.)

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::db::Db;

// ---------- Settings (SQLite) ----------

/// 설정이 바뀌었다 — **모든 창**이 다시 읽는다.
///
/// 창이 여럿이고(크롬식 탭) 트레이 팝오버는 앱 시작 때 한 번 만들어져
/// 세션 내내 살아 있다. 각 창의 `SettingsProvider` 는 마운트 때 한 번만
/// 읽으므로, 이 이벤트가 없으면 한 창에서 테마·언어를 바꿔도 나머지 창과
/// 상단바(트레이 팝오버)는 예전 값을 그대로 그린다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SettingsChanged {
    pub keys: Vec<String>,
}

fn announce(app: &AppHandle, keys: Vec<String>) {
    let _ = SettingsChanged { keys }.emit(app);
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: AppHandle,
    db: State<'_, Db>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.settings_set(key.clone(), value)
        .await
        .map_err(|e| e.to_string())?;
    announce(&app, vec![key]);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    db.settings_get(key).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get_all(db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    db.settings_get_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set_many(
    app: AppHandle,
    db: State<'_, Db>,
    entries: Vec<(String, String)>,
) -> Result<(), String> {
    let mut keys = Vec::with_capacity(entries.len());
    for (k, v) in entries {
        db.settings_set(k.clone(), v)
            .await
            .map_err(|e| e.to_string())?;
        keys.push(k);
    }
    announce(&app, keys);
    Ok(())
}

// ---------- App info / maintenance ----------

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AppInfo {
    pub db_path: String,
    pub app_data_dir: String,
    pub version: String,
}

#[tauri::command]
#[specta::specta]
pub async fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("ocul-pm.db");

    Ok(AppInfo {
        db_path: db_path.to_string_lossy().to_string(),
        app_data_dir: app_data.to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn clear_all_data(db: State<'_, Db>) -> Result<(), String> {
    // Cascade-delete every project's cache rows.
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    for p in projects {
        db.delete_project(p.id).await.map_err(|e| e.to_string())?;
    }
    db.settings_clear().await.map_err(|e| e.to_string())?;
    Ok(())
}

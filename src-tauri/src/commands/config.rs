//! Commands for app configuration.
//!
//! Two backing stores:
//! - **secrets**: OS keychain (API keys; values never leave the backend).
//! - **settings**: SQLite (non-secret user prefs like default model).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::db::Db;
use crate::secrets;

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

/// 커맨드 밖(배경 작업)에서 설정을 고쳤을 때 같은 이벤트를 쏜다 — 그래야
/// 이미 떠 있는 창들이 새 값을 다시 읽는다. Osaurus 라운드 D2 의 1회 시드가
/// 첫 소비처다.
pub fn emit_settings_changed(app: &AppHandle, keys: Vec<String>) {
    announce(app, keys);
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

// ---------- Secrets (OS keychain) ----------
//
// The OS keychain prompts the user every time we read a password (and `has`
// would have to read it to check). To keep the UI snappy we mirror a
// "presence" flag in the SQLite `settings` table — `secret_has` consults the
// cache and never unlocks the keychain. The keychain is only touched when the
// user explicitly sets/clears a key, or when the backend actually needs the
// value (e.g. for a chat call).

const SECRET_PRESENT_PREFIX: &str = "_secret_present_";

fn presence_key(name: &str) -> String {
    format!("{SECRET_PRESENT_PREFIX}{name}")
}

#[tauri::command]
#[specta::specta]
pub async fn secret_set(db: State<'_, Db>, name: String, value: String) -> Result<(), String> {
    secrets::set(&name, &value).map_err(|e| e.to_string())?;
    db.settings_set(presence_key(&name), "true".to_string())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn secret_has(db: State<'_, Db>, name: String) -> Result<bool, String> {
    // Cached check — never reads the keychain.
    let cached = db
        .settings_get(presence_key(&name))
        .await
        .map_err(|e| e.to_string())?;
    Ok(cached.as_deref() == Some("true"))
}

#[tauri::command]
#[specta::specta]
pub async fn secret_delete(db: State<'_, Db>, name: String) -> Result<(), String> {
    secrets::delete(&name).map_err(|e| e.to_string())?;
    db.settings_set(presence_key(&name), "false".to_string())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Verify the cached presence flag against the real keychain. Used when the
/// user explicitly asks ("the key isn't working" / "did I really save it?").
/// This DOES unlock the keychain.
#[tauri::command]
#[specta::specta]
pub async fn secret_verify(db: State<'_, Db>, name: String) -> Result<bool, String> {
    let actual = secrets::has(&name).map_err(|e| e.to_string())?;
    db.settings_set(
        presence_key(&name),
        if actual { "true" } else { "false" }.to_string(),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(actual)
}

// ---------- App info / maintenance ----------

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AppInfo {
    pub db_path: String,
    pub app_data_dir: String,
    pub secrets_store: String,
    pub version: String,
}

#[tauri::command]
#[specta::specta]
pub async fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("ocul-pm.db");

    let store = if cfg!(target_os = "macos") {
        "macOS Keychain"
    } else if cfg!(target_os = "windows") {
        "Windows Credential Manager"
    } else {
        "Secret Service (libsecret)"
    };

    Ok(AppInfo {
        db_path: db_path.to_string_lossy().to_string(),
        app_data_dir: app_data.to_string_lossy().to_string(),
        secrets_store: store.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn clear_all_data(db: State<'_, Db>) -> Result<(), String> {
    // Cascade-delete every project (chunks/files/symbols/deps follow)
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    for p in projects {
        db.delete_project(p.id).await.map_err(|e| e.to_string())?;
    }
    // Clear settings and known per-provider secrets
    db.settings_clear().await.map_err(|e| e.to_string())?;
    for provider in &["openai", "anthropic", "gemini", "nim"] {
        let _ = secrets::delete(&format!("{}_api_key", provider));
    }
    Ok(())
}

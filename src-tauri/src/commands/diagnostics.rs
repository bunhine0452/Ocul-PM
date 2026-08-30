use tauri::State;

use crate::db::{Db, DbHealth};

#[tauri::command]
#[specta::specta]
pub async fn db_health(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.health().await.map_err(|e| e.to_string())
}

/// 빈 페이지 회수 + WAL 절단(VACUUM). 몇 초 걸리고 그동안 다른 DB 호출은
/// 줄을 서므로 사용자가 진단 탭에서 직접 누른다. 끝난 뒤의 크기를 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn db_compact(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.compact().await.map_err(|e| e.to_string())?;
    db.health().await.map_err(|e| e.to_string())
}

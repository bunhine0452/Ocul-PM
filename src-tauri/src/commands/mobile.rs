//! 모바일 브리지 커맨드 — 수명·페어링 제어만. 로직은 `crate::mobile_bridge` 에 있다.

use tauri::State;

use crate::db::{Db, MobileDevice};
use crate::mobile_bridge::server::{MobileBridgeState, MobileBridgeStatus, PairingInfo};

/// 서버 기동 (멱등). 실패 사유(Tailscale 미탐지 등)는 설정 화면에 그대로 노출된다.
#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_start(
    app: tauri::AppHandle,
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    state.start(app.clone()).await
}

/// graceful 중지 (멱등).
#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_stop(
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    Ok(state.stop())
}

#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_status(
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    Ok(state.status())
}

/// 페어링 세션 시작 — 6자리 코드·TTL 5분·1회용. 기존 세션은 대체된다.
#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_pairing_begin(
    state: State<'_, MobileBridgeState>,
) -> Result<PairingInfo, String> {
    state.pairing_begin()
}

/// 페어링된 기기 목록 (설정 '모바일' 탭).
#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_devices(db: State<'_, Db>) -> Result<Vec<MobileDevice>, String> {
    db.mobile_device_list().await.map_err(|e| e.to_string())
}

/// 기기 해제 — DB 와 인증 미들웨어의 메모리 집합 양쪽에서 제거 (즉시 실효).
#[tauri::command]
#[specta::specta]
pub async fn mobile_bridge_revoke_device(
    db: State<'_, Db>,
    state: State<'_, MobileBridgeState>,
    id: u32,
) -> Result<Vec<MobileDevice>, String> {
    if let Some(hash) = db.mobile_device_delete(id).await.map_err(|e| e.to_string())? {
        state.remove_token_hash(&hash);
    }
    db.mobile_device_list().await.map_err(|e| e.to_string())
}

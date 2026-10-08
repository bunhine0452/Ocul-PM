//! review-2026-10-09 `{#seeded-event}` — 「현재 세션」 을 이벤트가 아니라 물음으로 세우는 명령.

use tauri::State;

use crate::app_error::AppError;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::Session;

/// 지금 열려 있는 세션 (없으면 `None`).
///
/// 창이 열릴 때 「현재 세션」 을 이 물음으로 세운다 — 이미 돌던 세션의
/// `OculpmSessionStarted` 는 그 창이 생기기 전에 지나갔다 (2026-10-09 리포트:
/// 명령 팔레트의 「세션 끝내기」 가 「활성 세션 없음」 이라고 답하던 것).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_current_session(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Option<Session>, AppError> {
    Ok(manager.get_current_session(project_id).await?)
}

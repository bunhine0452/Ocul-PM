//! 배경 자동화의 기기 동의 커맨드 (`oculpm::automation::consent`).
//!
//! 저장소 config 가 켜 둔 배경 스위치는 이 기기가 허락해야 돈다. 허락이 생기는
//! 길은 둘이다: 설정 화면에서 스위치를 직접 켜는 것(`oculpm_set_config`)과,
//! 오늘 화면의 확인 카드(`automation_consent_grant`).

use tauri::{AppHandle, State};

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::automation::consent::{self, AutomationConsent};
use crate::oculpm::automation::core_model;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::OculpmConfig;

/// Validate + persist a new `OculpmConfig` (atomic write) and refresh the
/// in-memory `WorkdayResolver`. Rejects invalid tz / HH:MM without touching
/// disk.
///
/// 꺼져 있던 배경 스위치를 여기서 **새로 켜면** 그 순간을 이 기기의 동의로
/// 기록한다 — 사람이 설정 화면에서 직접 눌렀다. (`commands/oculpm.rs` 에서
/// 옮겨 왔다 — 동의 기록이 붙으며 그 파일의 크기 래칫을 넘었다.)
#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
    new_config: OculpmConfig,
) -> Result<(), AppError> {
    let turned_on = match manager.get_config(project_id).await {
        Ok(old) => consent::turns_any_on(&old, &new_config),
        Err(_) => false,
    };
    manager.set_config(project_id, new_config).await?;
    if turned_on {
        consent::grant(&db, project_id)
            .await
            .map_err(AppError::unknown)?;
    }
    Ok(())
}

/// 이 프로젝트의 배경 스위치가 확인을 기다리는가.
#[tauri::command]
#[specta::specta]
pub async fn automation_consent_status(
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AutomationConsent, AppError> {
    let config = manager.get_config(project_id).await?;
    Ok(consent::status(&db, project_id, &config).await)
}

/// 확인 카드의 「이 기기에서 켜기」. 예전에는 프로젝트를 열 때 하던 배경 모델
/// 1회 시드(D2)도 이 순간으로 옮겨 온다 — 동의 전에는 시드하지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn automation_consent_grant(
    app: AppHandle,
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AutomationConsent, AppError> {
    let config = manager.get_config(project_id).await?;
    consent::grant(&db, project_id)
        .await
        .map_err(AppError::unknown)?;
    if consent::seed_wanted(&db, project_id, &config).await {
        match core_model::seed_if_automation_enabled(&db, true).await {
            Ok(true) => crate::commands::config::emit_settings_changed(
                &app,
                vec![
                    core_model::CORE_PROVIDER_KEY.to_string(),
                    core_model::CORE_MODEL_KEY.to_string(),
                    core_model::CORE_MODEL_SEEDED_KEY.to_string(),
                ],
            ),
            Ok(false) => {}
            Err(e) => tracing::warn!(
                target: "oculpm::automation",
                project_id,
                error = %e,
                "core model seed after consent errored (non-fatal)"
            ),
        }
    }
    Ok(consent::status(&db, project_id, &config).await)
}

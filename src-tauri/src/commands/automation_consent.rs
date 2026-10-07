//! 배경 자동화의 기기 동의 커맨드 (`oculpm::automation::consent`).
//!
//! 저장소 config 가 켜 둔 배경 스위치와 정의는 이 기기가 허락해야 돈다. 허락이
//! 생기는 길은 셋이다: 설정 화면에서 스위치를 직접 켜는 것(`oculpm_set_config`),
//! 자동화 탭에서 정의를 저장·재개하는 것(`commands::automation`), 오늘 화면의 확인
//! 카드(`automation_consent_grant`). 거두는 길은 `automation_consent_revoke` 하나다.

use std::path::{Path, PathBuf};

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
/// 여기서 **새로 켠** 배경 스위치(와 그 아래에서 새로 돌게 된 정의)는 이 기기의
/// 동의로 기록한다 — 사람이 설정 화면에서 직접 눌렀다. 이미 확인 대기이던 것은
/// 그대로 둔다 (`consent::approve_changes`). (`commands/oculpm.rs` 에서 옮겨 왔다 —
/// 동의 기록이 붙으며 그 파일의 크기 래칫을 넘었다.)
#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
    new_config: OculpmConfig,
) -> Result<(), AppError> {
    let root = root_of(&db, project_id).await?;
    let surfaces = match manager.get_config(project_id).await {
        Ok(old) => consent::surface(&old, &root).zip(consent::surface(&new_config, &root)),
        Err(_) => None,
    };
    manager.set_config(project_id, new_config).await?;
    if let Some((before, after)) = surfaces {
        consent::approve_changes(&db, project_id, &before, &after)
            .await
            .map_err(AppError::unknown)?;
    }
    Ok(())
}

async fn root_of(db: &Db, project_id: u32) -> Result<PathBuf, AppError> {
    let project = db.get_project(project_id).await.map_err(AppError::from)?;
    Ok(PathBuf::from(project.root_path))
}

async fn status_of(
    manager: &OculpmManager,
    db: &Db,
    project_id: u32,
    root: &Path,
) -> Result<AutomationConsent, AppError> {
    let config = manager.get_config(project_id).await?;
    Ok(consent::status(db, project_id, &config, root).await)
}

/// 이 프로젝트의 배경 스위치가 확인을 기다리는가.
#[tauri::command]
#[specta::specta]
pub async fn automation_consent_status(
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AutomationConsent, AppError> {
    let root = root_of(&db, project_id).await?;
    status_of(&manager, &db, project_id, &root).await
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
    let root = root_of(&db, project_id).await?;
    let config = manager.get_config(project_id).await?;
    consent::grant(&db, project_id, &config, &root)
        .await
        .map_err(AppError::unknown)?;
    // 확인 대기 동안 워처 틱은 규칙을 비워 두며 그 시각을 갱신한다 — 30초 캐시를
    // 기다리지 않고 다음 틱에 규칙을 다시 읽게 한다.
    crate::oculpm::automation::watchers::invalidate_rules(&app, project_id);
    if consent::seed_wanted(&db, project_id, &config, &root).await {
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
    Ok(consent::status(&db, project_id, &config, &root).await)
}

/// 「이 기기의 허락 거두기」 — 기록을 지우고 워처 규칙 캐시를 비운다. 다음 틱부터
/// 디스크의 스위치는 다시 확인 대기다.
#[tauri::command]
#[specta::specta]
pub async fn automation_consent_revoke(
    app: AppHandle,
    manager: State<'_, OculpmManager>,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AutomationConsent, AppError> {
    let root = root_of(&db, project_id).await?;
    consent::revoke(&db, project_id)
        .await
        .map_err(AppError::unknown)?;
    crate::oculpm::automation::watchers::invalidate_rules(&app, project_id);
    status_of(&manager, &db, project_id, &root).await
}

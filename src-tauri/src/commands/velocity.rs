//! journal-scale-round `{#velocity}` — Today 「작업 속도」 카드의 데이터원.
//! 주 버킷·ETA 계산은 `db::velocity::Db::velocity` 의 doc comment 를 SSOT
//! 로 삼는다 — 여기는 `weeks` clamp 만 얹는 얇은 오케스트레이션이다.

use tauri::State;

use crate::db::{
    velocity::{Velocity, DEFAULT_WEEKS, MAX_WEEKS, MIN_WEEKS},
    Db,
};

/// 주당 일지 건수·유형 비율 + 플랜 완료 속도. `weeks` 가 없으면
/// `DEFAULT_WEEKS`(8), 범위는 `[MIN_WEEKS, MAX_WEEKS]`(1~26)로 clamp.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_velocity(
    db: State<'_, Db>,
    project_id: u32,
    weeks: Option<u32>,
) -> Result<Velocity, String> {
    let weeks = weeks.unwrap_or(DEFAULT_WEEKS).clamp(MIN_WEEKS, MAX_WEEKS);
    db.velocity(project_id, weeks)
        .await
        .map_err(|e| e.to_string())
}

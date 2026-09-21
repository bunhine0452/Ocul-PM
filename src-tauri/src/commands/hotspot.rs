//! journal-scale-round `{#hotspot-query}` — Today 「반복 수정 파일」 카드의
//! 데이터원. 집계·잡음 제거 규칙은 `db::hotspot::Db::file_hotspots` 의 doc
//! comment 를 SSOT 로 삼는다 — 여기는 `days` → workday 컷오프 변환과 기본
//! limit 만 얹는 얇은 오케스트레이션이다.

use chrono::{Duration, Local};
use tauri::State;

use crate::db::{hotspot::FileHotspot, Db};

/// 카드가 보여주는 상위 개수 (호출부가 `limit` 을 안 주면 이 값).
const DEFAULT_LIMIT: u32 = 5;

/// 파일별 bug/error 재발 신호. `days` 가 있으면 그 일수만큼의 workday 창으로
/// 좁힌다 (오늘 포함 `days`일 — `firing_stats` 와 같은 계산).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_file_hotspots(
    db: State<'_, Db>,
    project_id: u32,
    days: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<FileHotspot>, String> {
    let since_workday = days.map(|d| {
        (Local::now().date_naive() - Duration::days(d.max(1) as i64 - 1))
            .format("%Y%m%d")
            .to_string()
    });
    db.file_hotspots(project_id, since_workday, limit.unwrap_or(DEFAULT_LIMIT))
        .await
        .map_err(|e| e.to_string())
}

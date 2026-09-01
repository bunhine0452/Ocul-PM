//! 컨텍스트 경제학 커맨드 (Osaurus 라운드 Phase 5).
//!
//! 둘을 담당한다:
//!  - **회상 통계** (`recall_stats`) — 관련도 순위·잊기·초기화. 파생 캐시라
//!    지워도 무해하고, 그 사실이 UI 의 「위험 구역」 문구와 같은 말이어야 한다.
//!  - **프로젝트 지시문** — 이 프로젝트에서만 "항상 가는 것". 전역 선호
//!    (`system_prompt` 설정)와 병합되고 **프로젝트가 우선**이다.
//!
//! 프로젝트 지시문은 새 표를 만들지 않고 `settings` 에 프로젝트별 키로 둔다
//! (`project_instructions.<id>`). 스키마 하나를 아끼려는 게 아니라, 이 값이
//! **사용자 선호**라 설정과 같은 수명·같은 백업 경로를 갖는 것이 맞기 때문이다.
//! `AGENTS.md`(외부 에이전트가 읽는 기록 규칙)와는 다른 층이다.

use tauri::State;

use crate::app_error::AppError;
use crate::db::recall::RecallStat;
use crate::db::Db;

/// 프로젝트 지시문의 설정 키.
fn instructions_key(project_id: u32) -> String {
    format!("project_instructions.{project_id}")
}

/// 관련도 상위 N (감쇠 반영). 화면의 「회상 후보」 목록.
#[tauri::command]
#[specta::specta]
pub async fn recall_top(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<RecallStat>, AppError> {
    Ok(db.recall_top(project_id, limit.min(200)).await?)
}

/// 주입됐다고 기록한다 — 다음 순위에 반영된다.
#[tauri::command]
#[specta::specta]
pub async fn recall_touch(
    db: State<'_, Db>,
    project_id: u32,
    kind: String,
    reference: String,
) -> Result<(), AppError> {
    db.recall_touch(project_id, kind, reference).await?;
    Ok(())
}

/// 이 항목을 잊는다. 없던 행이면 `false` — 잊기는 멱등하다.
#[tauri::command]
#[specta::specta]
pub async fn recall_forget(
    db: State<'_, Db>,
    project_id: u32,
    kind: String,
    reference: String,
) -> Result<bool, AppError> {
    Ok(db.recall_forget(project_id, kind, reference).await?)
}

/// 이 프로젝트의 회상 통계를 전부 지운다. 지운 행 수를 돌려준다.
///
/// **지워도 기능은 그대로다** — 점수가 없으면 균등 순위로 돌아갈 뿐이다.
#[tauri::command]
#[specta::specta]
pub async fn recall_reset(db: State<'_, Db>, project_id: u32) -> Result<u32, AppError> {
    Ok(db.recall_reset(project_id).await?)
}

/// 이 프로젝트의 지시문 (줄 단위 목록을 개행으로 이어 붙인 원문).
#[tauri::command]
#[specta::specta]
pub async fn project_instructions_get(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<String, AppError> {
    Ok(db
        .settings_get(instructions_key(project_id))
        .await?
        .unwrap_or_default())
}

/// 저장한다. 빈 문자열이면 "없음" 이다 (행은 남지만 병합에서 빠진다).
#[tauri::command]
#[specta::specta]
pub async fn project_instructions_set(
    db: State<'_, Db>,
    project_id: u32,
    text: String,
) -> Result<(), AppError> {
    db.settings_set(instructions_key(project_id), text).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instructions_key_is_namespaced_per_project() {
        assert_eq!(instructions_key(7), "project_instructions.7");
        assert_ne!(instructions_key(7), instructions_key(8));
    }
}

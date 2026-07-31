//! 메인 화면(프로젝트 선택) 집계 커맨드. 로직은 전부 `crate::home` 에 있다.

use tauri::State;

use crate::db::Db;
use crate::home::{self, HomeBrief};

/// 홈 화면이 마운트 때 1회 호출하는 단일 집계.
///
/// `days` 는 활동 스파크라인의 창 (프런트는 14). 1~62 로 클램프된다.
/// 프로젝트 수와 무관하게 SQL 6문 — 자세한 근거는 `crate::home` 모듈 주석 참고.
#[tauri::command]
#[specta::specta]
pub async fn home_brief(db: State<'_, Db>, days: u32) -> Result<HomeBrief, String> {
    home::collect(&db, days).await.map_err(|e| e.to_string())
}

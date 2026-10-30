//! 같은 일을 worktree 여럿에서 — 얇은 손잡이. 일은 `crate::git::race` 가 한다.

use std::path::{Path, PathBuf};

use tauri::{Manager, State};

use crate::app_error::AppError;
use crate::db::Db;
use crate::git::race::{self, RaceLane};

/// git 쪽 말 → 사전 코드. 모르는 말은 원문을 붙여 `race_failed`.
fn race_err(e: String) -> AppError {
    match e.as_str() {
        "no_commit" | "not_a_lane" | "empty_lane" => AppError::code(format!("race_{e}")),
        _ => AppError::new("race_failed", e),
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, AppError> {
    super::blocking(f).await.map_err(race_err)
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::new("race_failed", e.to_string()))
}

/// 레인을 `count` 개(2~4) 만든다 — 지금 `HEAD` 에서, 앱 데이터 폴더에.
#[tauri::command]
#[specta::specta]
pub async fn race_start(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    count: u8,
) -> Result<Vec<RaceLane>, AppError> {
    let root = db.project_root(project_id).await?;
    let base = race::base_dir(&data_dir(&app)?, project_id);
    let stamp = chrono::Local::now().format("%m%d-%H%M%S").to_string();
    blocking(move || race::start(&root, &base, count, &stamp)).await
}

/// 지금 있는 레인과 각 변경의 크기.
#[tauri::command]
#[specta::specta]
pub async fn race_lanes(db: State<'_, Db>, project_id: u32) -> Result<Vec<RaceLane>, AppError> {
    let root = db.project_root(project_id).await?;
    blocking(move || race::lanes(&root)).await
}

/// 레인 하나의 변경(보기용 diff).
#[tauri::command]
#[specta::specta]
pub async fn race_patch(
    db: State<'_, Db>,
    project_id: u32,
    path: String,
) -> Result<String, AppError> {
    let root = db.project_root(project_id).await?;
    blocking(move || {
        let lane = race::find(&root, Path::new(&path))?;
        race::patch(&root, &lane)
    })
    .await
}

/// 고른 레인의 변경을 원래 작업 폴더에 커밋 전 변경으로 옮긴다.
#[tauri::command]
#[specta::specta]
pub async fn race_take(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    path: String,
) -> Result<(), AppError> {
    let root = db.project_root(project_id).await?;
    let scratch = data_dir(&app)?.join("races").join("tmp");
    blocking(move || {
        let lane = race::find(&root, Path::new(&path))?;
        race::take(&root, &lane, &scratch)
    })
    .await
}

/// 레인을 모두 지운다(worktree · 가지). 지운 수.
#[tauri::command]
#[specta::specta]
pub async fn race_clear(db: State<'_, Db>, project_id: u32) -> Result<u32, AppError> {
    let root = db.project_root(project_id).await?;
    blocking(move || race::clear(&root)).await
}

/// 터미널 세션의 작업 폴더 — 레인이면 그 worktree, 아니면 거절. `term_open` 이 부른다.
pub(crate) async fn lane_cwd(root: PathBuf, path: String) -> Result<PathBuf, AppError> {
    blocking(move || race::find(&root, Path::new(&path)).map(|lane| PathBuf::from(lane.path))).await
}

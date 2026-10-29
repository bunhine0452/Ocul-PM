//! 앱 안 터미널 명령 (4.0) — 얇은 손잡이. 세션 표와 PTY 는 `crate::terminal` 이 소유한다.

use tauri::ipc::Channel;
use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::terminal::{OpenSpec, TermEvent, TermInfo, TermSessions};

fn term_err(e: String) -> AppError {
    AppError::new("terminal", e)
}

/// 이 창에 세션을 연다 — 프로젝트 루트에서 사용자의 로그인 셸. `prompt` 가 있으면 그
/// 프롬프트로 `claude` 를 바로 실행한다(오늘·계획의 「다음」). 출력·끝은 `on_event` 로.
#[tauri::command]
#[specta::specta]
pub async fn term_open(
    window: tauri::WebviewWindow,
    db: State<'_, Db>,
    sessions: State<'_, TermSessions>,
    project_id: u32,
    cols: u16,
    rows: u16,
    prompt: Option<String>,
    on_event: Channel<TermEvent>,
) -> Result<TermInfo, AppError> {
    let cwd = db.project_root(project_id).await?;
    let spec = OpenSpec {
        window: window.label().to_string(),
        project_id,
        cwd,
        cols,
        rows,
        prompt,
    };
    sessions
        .open(spec, move |ev| {
            let _ = on_event.send(ev);
        })
        .map_err(term_err)
}

#[tauri::command]
#[specta::specta]
pub fn term_write(
    sessions: State<'_, TermSessions>,
    id: u32,
    data: String,
) -> Result<(), AppError> {
    sessions.write(id, &data).map_err(term_err)
}

#[tauri::command]
#[specta::specta]
pub fn term_resize(
    sessions: State<'_, TermSessions>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    sessions.resize(id, cols, rows).map_err(term_err)
}

#[tauri::command]
#[specta::specta]
pub fn term_close(sessions: State<'_, TermSessions>, id: u32) {
    sessions.close(id);
}

/// 이 창의 세션 목록 — 웹뷰가 다시 그려져도(새로고침) 남은 세션을 안다.
#[tauri::command]
#[specta::specta]
pub fn term_list(window: tauri::WebviewWindow, sessions: State<'_, TermSessions>) -> Vec<TermInfo> {
    sessions.list(window.label())
}

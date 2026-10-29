//! 앱 안 터미널 명령 (4.0) — 얇은 손잡이. 세션 표와 PTY 는 `crate::terminal` 이 소유한다.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_specta::Event;

use crate::app_error::AppError;
use crate::db::Db;
use crate::terminal::{OpenSpec, TermEvent, TermInfo, TermSessions};

fn term_err(e: String) -> AppError {
    AppError::new("terminal", e)
}

/// 어느 창에서든 세션이 열리거나 · 끝나거나 · 안의 프로그램 상태가 바뀌었다 — 프로젝트 목록과
/// 시작 창이 「어디서 무엇이 도는지」를 다시 센다 (`term_overview`).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TermSessionsChanged {
    pub project_id: u32,
}

/// 도는 세션이 있는 창을 닫으려 했다(`quit` 이면 앱을 끄려 했다) — 멈추고 그 창에만 묻는다.
/// 확인하면 창이 `term_end_window` 로 세션을 끝내고 다시 닫는다(앱이면 프로세스 플러그인으로 끈다).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TermCloseAsked {
    pub alive: u32,
    pub quit: bool,
}

/// 이 창에 세션을 연다 — 프로젝트 루트에서 사용자의 로그인 셸. `prompt` 가 있으면 그
/// 프롬프트로 `claude` 를 바로 실행한다(오늘·계획의 「다음」). 빈 문자열이면 그냥 `claude`
/// (계획의 「끝까지」가 입력 대기 신호 뒤에 `/goal …` 을 넣는다). 출력·끝은 `on_event` 로.
#[tauri::command]
#[specta::specta]
pub async fn term_open(
    app: tauri::AppHandle,
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
    let notify = app.clone();
    let label = window.label().to_string();
    let table = sessions.inner().clone();
    let info = sessions
        .open(spec, move |ev| {
            if let TermEvent::Status { status: Some(st) } = &ev {
                // 그 창이 뒤에 있는 동안 기다림 · 끝냄 · 오류가 되면 읽지 않음 (Orca 의 알림 규칙).
                let settled = matches!(st.state.as_str(), "blocked" | "done" | "error");
                let front = notify
                    .get_webview_window(&label)
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);
                if settled && !front {
                    table.mark_unseen(&label);
                }
            }
            if matches!(ev, TermEvent::Status { .. } | TermEvent::Exit { .. }) {
                let _ = TermSessionsChanged { project_id }.emit(&notify);
            }
            let _ = on_event.send(ev);
        })
        .map_err(term_err)?;
    let _ = TermSessionsChanged { project_id }.emit(&app);
    Ok(info)
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
pub fn term_close(app: tauri::AppHandle, sessions: State<'_, TermSessions>, id: u32) {
    let project = sessions
        .overview()
        .into_iter()
        .find(|i| i.id == id)
        .map(|i| i.project_id);
    sessions.close(id);
    if let Some(project_id) = project {
        let _ = TermSessionsChanged { project_id }.emit(&app);
    }
}

/// 모든 창의 세션 — 프로젝트 목록 · 시작 창이 프로젝트별로 센다.
#[tauri::command]
#[specta::specta]
pub fn term_overview(sessions: State<'_, TermSessions>) -> Vec<TermInfo> {
    sessions.overview()
}

/// 이 창의 세션을 모두 끝낸다 — 닫기 확인(`TermCloseAsked`)에서 「닫기」를 고른 뒤 부른다.
#[tauri::command]
#[specta::specta]
pub fn term_end_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    sessions: State<'_, TermSessions>,
) {
    let projects: Vec<u32> = sessions
        .list(window.label())
        .into_iter()
        .map(|i| i.project_id)
        .collect();
    sessions.close_window(window.label());
    for project_id in projects {
        let _ = TermSessionsChanged { project_id }.emit(&app);
    }
}

/// 이 창의 세션 목록 — 웹뷰가 다시 그려져도(새로고침) 남은 세션을 안다.
#[tauri::command]
#[specta::specta]
pub fn term_list(window: tauri::WebviewWindow, sessions: State<'_, TermSessions>) -> Vec<TermInfo> {
    sessions.list(window.label())
}

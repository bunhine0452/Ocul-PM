//! 앱 안 터미널 명령 (4.0) — 얇은 손잡이. 세션 표와 PTY 는 `crate::terminal` 이 소유한다.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_specta::Event;

use crate::app_error::AppError;
use crate::db::Db;
use crate::terminal::{
    OpenSpec, TermBusy, TermCheck, TermEvent, TermInfo, TermResume, TermSessions,
};

fn term_err(e: String) -> AppError {
    if e == crate::terminal::CHECK_PS51_CHAIN {
        return AppError::new("check_ps51_chain", e);
    }
    AppError::new("terminal", e)
}

/// 쓰기 대기가 넘쳤으면 `terminal_busy` — 프런트가 「바빠요」 토스트를 띄운다(`terminal.writeBusy`).
fn write_err(e: String) -> AppError {
    if e == crate::terminal::WRITE_BUSY {
        return AppError::new("terminal_busy", e);
    }
    term_err(e)
}

/// 그 창이 지금 앞에 있는가 — 메인 스레드를 한 번 오간다. 창을 못 찾으면 뒤.
fn is_front(app: &tauri::AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
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
/// `cwd` 는 이 프로젝트의 레인(worktree 여럿에서)일 때만 받는다 — 아니면 거절.
/// `resume` 이면 업데이트 전 대화를 잇는다(`claude --continue`, `term_take_resume`).
/// `check` 이면 계획의 확인 명령 한 줄을 셸이 명령 인자로 받아 돌리고 셸로 남는다 — 사람이 확인 창에서 전문을
/// 보고 누른 뒤에만 온다(11-15). 한 줄이 아니면 열지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn term_open(
    window: tauri::WebviewWindow,
    db: State<'_, Db>,
    project_id: u32,
    cols: u16,
    rows: u16,
    prompt: Option<String>,
    cwd: Option<String>,
    resume: bool,
    check: Option<TermCheck>,
    on_event: Channel<TermEvent>,
) -> Result<TermInfo, AppError> {
    // 앱 핸들 · 세션 표는 창에서 — specta 는 명령 인자를 10개까지만 받는다.
    let app = window.app_handle().clone();
    let root = db.project_root(project_id).await?;
    let lane = cwd.clone();
    let cwd = match cwd {
        Some(lane) => super::race::lane_cwd(root, lane).await?,
        None => root,
    };
    let label = window.label().to_string();
    let focus = (app.clone(), label.clone());
    let spec = OpenSpec {
        window: label.clone(),
        project_id,
        cwd,
        cols,
        rows,
        prompt,
        lane,
        resume,
        check,
        front: Some(Box::new(move || is_front(&focus.0, &focus.1))),
    };
    let notify = app.clone();
    let sessions = app.state::<TermSessions>();
    let table = sessions.inner().clone();
    let info = sessions
        .open(spec, move |ev| {
            // 그 창이 뒤에 있는 동안 기다림 · 끝냄 · 오류가 되거나 종 · 알림이 오면 읽지 않음 (Orca 의 알림 규칙).
            let settled = match &ev {
                TermEvent::Status { status: Some(st) } => {
                    matches!(st.state.as_str(), "blocked" | "done" | "error")
                }
                TermEvent::Bell | TermEvent::Notice { .. } => true,
                _ => false,
            };
            let unseen = settled && !is_front(&notify, &label);
            if unseen {
                table.mark_unseen(&label);
            }
            // 다른 창의 목록 · 창 제목 · Dock 배지가 다시 센다 — 제목은 탭 이름이 바뀐다.
            let changed = matches!(
                ev,
                TermEvent::Status { .. } | TermEvent::Exit { .. } | TermEvent::Title { .. }
            );
            if changed || unseen {
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
    sessions.write(id, &data).map_err(write_err)
}

/// 클립보드에 복사해 둔 파일의 경로들 — Finder · 탐색기에서 복사한 파일을 터미널에 ⌘V 할 때(`terminal_clipboard.rs`).
/// 파일이 아니면 빈 목록. 읽기만 한다.
#[tauri::command]
#[specta::specta]
pub async fn term_clipboard_files() -> Result<Vec<String>, AppError> {
    crate::terminal::clipboard::file_paths().map_err(term_err)
}

/// 터미널 안의 프로그램이 OSC 52 로 청한 복사 — 웹뷰가 상한 · 알림을 거친 글만 넘긴다(`oscClipboard.ts`).
/// 이 OS 에서 앱이 쓰지 않으면(Linux) `false` — 웹뷰가 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn term_clipboard_write(text: String) -> Result<bool, AppError> {
    if text.len() > OSC52_MAX_BYTES {
        return Err(term_err("clipboard: text too large".to_string()));
    }
    crate::terminal::clipboard::write_text(&text).map_err(term_err)
}

/// OSC 52 로 받는 글의 상한 — 웹뷰의 상한(64KB 디코드)보다 넉넉히. 그보다 큰 글은 웹뷰가 이미 버린다.
const OSC52_MAX_BYTES: usize = 256 * 1024;

/// 웹뷰가 그 세션의 출력을 `bytes` 만큼 그렸다 — 출력 흐름 제어(`terminal_io::Flow`)가 그만큼 더 보낸다.
/// 동기 명령 — 세션의 셈만 줄이고 곧장 돌아온다.
#[tauri::command]
#[specta::specta]
pub fn term_ack(sessions: State<'_, TermSessions>, id: u32, bytes: u32) {
    sessions.ack(id, bytes);
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
    let project = sessions.project_of(id);
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

/// 앱 전체에서 도는 세션 수 — 업데이트가 재시작 전에 묻는다(창을 닫을 때의 확인과 같은 기준).
#[tauri::command]
#[specta::specta]
pub fn term_busy_all(sessions: State<'_, TermSessions>) -> TermBusy {
    sessions.busy_all()
}

/// 업데이트 재시작 뒤 이 창이 이을 claude 세션 — 창 복원이 맡겨 둔 것을 한 번 가져간다.
#[tauri::command]
#[specta::specta]
pub fn term_take_resume(
    window: tauri::WebviewWindow,
    sessions: State<'_, TermSessions>,
) -> Vec<TermResume> {
    sessions.take_pending_resume(window.label())
}

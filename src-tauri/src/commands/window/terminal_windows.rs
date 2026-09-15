//! 분리 터미널 창 (2026-08-15 터미널 도크) — 탭을 물지 않는 프로젝트당 하나의
//! 경량 창. 열기·닫기·목록과, 닫힐 때 "탭도 없으면" 셸을 정리하는 훅.
//!
//! 탭 레지스트리 밖에 살지만 PTY 소유권은 탭과 **함께** 이룬다 (`project_in_use`).

use super::*;

/// 이 프로젝트의 터미널을 **자기 창**으로 떼어낸다 (도크의 ⇱).
///
/// 탭이 아니라 별개의 경량 창이다 (`index.html?term=<id>`) — 사이드바도
/// 탭 스트립도 없이 터미널만 그린다. 세션은 옮겨가지 않고 **그대로 이어진다**:
/// PTY 는 Rust 에 살아 있고 sid 가 프로젝트 기준(`pty_prefix_for`)이라, 새 창의
/// xterm 이 같은 sid 로 attach 하면 스크롤백까지 복원된다.
///
/// 이미 떠 있으면 새로 만들지 않고 그 창을 앞으로 가져온다 (프로젝트당 하나).
#[tauri::command]
#[specta::specta]
pub async fn open_terminal_window(app: AppHandle, project_id: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let label = terminal_window_label(project_id);
    if app.get_webview_window(&label).is_some() {
        // 레지스트리에서 빠져 있는데 웹뷰만 남아 있을 수 있다 (닫기 훅이 못 돈
        // 경우) — 다시 등록해 두어야 프런트의 자리표시자와 어긋나지 않는다.
        {
            let state = app.state::<WindowTabs>();
            state.lock().terminal_windows.insert(project_id);
        }
        focus_window(&app, &label);
        emit_terminal_windows(&app);
        return Ok(());
    }

    let title = {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map(|p| p.name)
            .unwrap_or_else(|_| "Ocul-PM".to_string())
    };

    let url = format!("index.html?term={project_id}");
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .hidden_title(true)
        .inner_size(TERM_WINDOW_W, TERM_WINDOW_H)
        .min_inner_size(TERM_WINDOW_MIN_W, TERM_WINDOW_MIN_H)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    {
        let state = app.state::<WindowTabs>();
        state.lock().terminal_windows.insert(project_id);
    }
    attach_terminal_window_hooks(&app, &window, project_id);
    emit_terminal_windows(&app);
    Ok(())
}

/// 분리한 터미널을 앱으로 되돌린다 — 창만 닫으면 된다. 셸을 죽이지 않는 것은
/// 닫기 훅이 "탭이 아직 이 프로젝트를 쓰는가"를 보고 판단하기 때문이다.
#[tauri::command]
#[specta::specta]
pub async fn close_terminal_window(app: AppHandle, project_id: u32) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&terminal_window_label(project_id)) {
        win.close().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // 창이 이미 사라졌는데 레지스트리에만 남은 경우 — 프런트가 자리표시자에
    // 갇히지 않도록 여기서 정리하고 알린다.
    let stale = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.terminal_windows.remove(&project_id)
    };
    if stale {
        emit_terminal_windows(&app);
    }
    Ok(())
}

/// 마운트 직후 1회 조회 (이후는 `TerminalWindowsChanged` 로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn list_terminal_windows(app: AppHandle) -> Result<Vec<u32>, String> {
    let state = app.state::<WindowTabs>();
    let ids = state.lock().terminal_window_projects();
    Ok(ids)
}

/// 터미널 창의 닫기 훅 — 레지스트리에서 빼고, **탭도 없으면** 셸을 정리한다.
///
/// 프런트의 언마운트에 맡기지 않는 이유는 탭 창과 같다: 강제 종료·크래시에서는
/// 돌지 않는다.
fn attach_terminal_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, project_id: u32) {
    let handle = app.clone();
    window.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { .. } = ev {
            let still_used = {
                let state = handle.state::<WindowTabs>();
                let mut reg = state.lock();
                reg.terminal_windows.remove(&project_id);
                reg.project_in_use(project_id)
            };
            if !still_used {
                // 죽인 개수 로그는 terminal.rs 안에서 남는다. 창 이벤트 훅이라
                // 동기판을 쓴다 (terminal.rs 의 "두 갈래인 이유" 참고).
                crate::commands::terminal::kill_ptys_with_prefix_blocking(
                    &handle,
                    &pty_prefix_for(project_id),
                );
            }
            emit_terminal_windows(&handle);
        }
    });
}

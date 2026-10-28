//! 창 커맨드 — 프로젝트 창 열기(I1 강제) · 시작 창이 프로젝트 되기 · 창 닫기 · 조회.

use super::*;

/// 프로젝트의 창을 연다 — I1 이 여기서 강제된다.
///
/// - 이미 어느 창에 열려 있으면 그 창을 앞으로 가져온다.
/// - 아니면 새 창을 연다 (숨겨 둔 휴면 창이 있으면 그것을 재사용).
#[tauri::command]
#[specta::specta]
pub async fn open_project_window(app: AppHandle, project_id: u32) -> Result<(), String> {
    open_project_window_with_nav(&app, project_id, None).await
}

pub async fn open_project_window_with_nav(
    app: &AppHandle,
    project_id: u32,
    nav: Option<&crate::tray::TrayNavigate>,
) -> Result<(), String> {
    // 지운 프로젝트는 열지 않는다 — 프런트의 목록은 창마다 따로 살아 방금 지운 것이
    // 남아 있을 수 있다. 막지 않으면 존재하지 않는 프로젝트의 창이 레지스트리에
    // 생기고, 그 창의 `oculpm_init` 이 "project not found" 로 떨어진다.
    {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map_err(|_| format!("project {project_id} not found"))?;
    }

    // 상주 모드에서 Dock 아이콘을 내려놨을 수 있다 — 창을 띄우기 전에 되돌린다.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let existing = app
        .state::<WindowProjects>()
        .lock()
        .locate_project(project_id)
        .filter(|l| app.get_webview_window(l).is_some());
    let label = match existing {
        Some(label) => {
            focus_window(app, &label);
            label
        }
        None => create_window(app, Some(project_id), nav).await?,
    };
    if let Some(nav) = nav {
        nav.emit_to(app, label.as_str())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 시작 창이 프로젝트를 골랐다 — **그 창이** 그 프로젝트가 된다.
///
/// 그 프로젝트가 이미 다른 창에 열려 있으면 이 창은 그대로 두고 그 창을 앞으로
/// 가져온다(I1) — 반환값이 `false` 다. `asking` 은 Tauri 가 주입하는 호출한 창이다.
#[tauri::command]
#[specta::specta]
pub async fn set_window_project(
    app: AppHandle,
    asking: tauri::WebviewWindow,
    project_id: u32,
) -> Result<bool, String> {
    {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map_err(|_| format!("project {project_id} not found"))?;
    }
    let label = asking.label().to_string();
    let outcome = app
        .state::<WindowProjects>()
        .lock()
        .adopt(&label, project_id);
    match outcome {
        Ok(Adopt::Adopted) => {
            let title = window_title(&app, Some(project_id)).await;
            let _ = asking.set_title(&title);
            announce(&app, &label);
            Ok(true)
        }
        Ok(Adopt::Already) => Ok(true),
        Ok(Adopt::ElsewhereIn(owner)) => {
            focus_window(&app, &owner);
            Ok(false)
        }
        Err(()) => {
            let summary = app.state::<WindowProjects>().lock().summary();
            tracing::warn!(window = %label, registry = %summary, "[FLOW] set_window_project: 시작 창이 아니다");
            Err(format!("window '{label}' cannot take project {project_id}"))
        }
    }
}

/// 창이 마운트 직후 자기 프로젝트를 읽는다 (이후는 `WindowProjectChanged`).
#[tauri::command]
#[specta::specta]
pub async fn get_window_project(app: AppHandle, window: String) -> Result<Option<u32>, String> {
    Ok(app
        .state::<WindowProjects>()
        .lock()
        .project_of(&window)
        .flatten())
}

/// 어디든 창이 떠 있는 프로젝트 — 시작 창·프로젝트 목록의 「열림」 표시 1회 조회.
#[tauri::command]
#[specta::specta]
pub async fn list_open_project_ids(app: AppHandle) -> Result<Vec<u32>, String> {
    Ok(app.state::<WindowProjects>().lock().all_open_projects())
}

/// 이 창을 닫는다 — Windows·Linux 의 `Ctrl+W` (macOS 는 앱 메뉴의 ⌘W 가 Rust 에서
/// 직접 닫는다). 닫힘 훅(`CloseRequested`)이 레지스트리 정리와 마지막 창 판정을 한다.
#[tauri::command]
#[specta::specta]
pub async fn close_window(asking: tauri::WebviewWindow) -> Result<(), String> {
    asking.close().map_err(|e| e.to_string())
}

/// 앱 메뉴의 「새 창」·Windows·Linux 의 `Ctrl+Shift+N` — 언제나 새 시작 창.
pub async fn new_window_inner(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    create_window(app, None, None).await.map(|_| ())
}

/// 워크스페이스에서 **지운** 프로젝트의 창을 시작 창으로 되돌린다 — `delete_project`
/// 가 DB 행을 지우기 전에 부른다. 창을 닫지 않는 이유: 마지막 창이면 앱이 꺼지고,
/// 지운 사람이 보고 있던 자리에서 바로 다른 프로젝트를 고를 수 있어야 한다.
pub async fn close_project_surfaces(app: &AppHandle, project_id: u32) {
    let released = app
        .state::<WindowProjects>()
        .lock()
        .release_project(project_id);
    let Some(label) = released else {
        return;
    };
    tracing::info!(project_id, window = %label, "[FLOW] 지운 프로젝트의 창을 시작 창으로 되돌린다");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_title("Ocul-PM");
    }
    announce(app, &label);
}

//! 탭 커맨드 — 열기(I1 강제)·시작 탭·제자리 승격·닫기·활성·정렬·조회.
//!
//! 창 하나 **안**에서 탭이 겪는 일만 여기 있다. 창을 넘나드는 드래그는 `drag`,
//! 창 자체의 생성·정리는 `lifecycle` 이 맡는다.

use super::*;

/// 프로젝트를 탭으로 연다 — I1 이 여기서 강제된다.
///
/// - 이미 어딘가 열려 있으면 그 창을 포커스하고 그 탭을 활성화한다.
/// - `window` 가 지정되면 그 창의 마지막 탭으로 붙인다.
/// - 없으면 마지막으로 포커스된 창에 붙이고, 창이 아예 없으면 새 창.
#[tauri::command]
#[specta::specta]
pub async fn open_project_tab(
    app: AppHandle,
    project_id: u32,
    window: Option<String>,
) -> Result<(), String> {
    open_project_tab_with_nav(&app, project_id, window, None).await
}

pub async fn open_project_tab_with_nav(
    app: &AppHandle,
    project_id: u32,
    window: Option<String>,
    nav: Option<&crate::tray::TrayNavigate>,
) -> Result<(), String> {
    // 지운 프로젝트는 열지 않는다 — 프런트의 목록은 창마다 따로 살아 방금
    // 지운 것이 남아 있을 수 있다. 여기서 막지 않으면 존재하지 않는 프로젝트의
    // 탭이 레지스트리에 생기고, 그 탭의 `oculpm_init` 이 "project not found"
    // 로 떨어진 뒤 사용자가 껍데기를 손으로 닫아야 한다 (2026-09-17 06:11).
    {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map_err(|_| format!("project {project_id} not found"))?;
    }

    // 상주 모드에서 Dock 아이콘을 내려놨을 수 있다 — 창을 띄우기 전에 되돌린다.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    // ① 이미 열려 있으면 그 창을 포커스하고 탭만 활성화한다 (I1).
    let existing = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.locate_project(project_id)
            .map(|(_, tab_id)| tab_id)
            .and_then(|id| reg.activate(id))
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str())
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ② 붙일 창을 고른다. 레지스트리에는 있는데 창이 이미 죽었으면 새로 만든다.
    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };

    if let Some(label) = target {
        {
            let state = app.state::<WindowTabs>();
            state.lock().append(&label, Some(project_id));
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str())
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ③ 새 창.
    create_window(app, Some(project_id), nav, None, false)
        .await
        .map(|_| ())
}

/// `+` — 시작 탭(프로젝트 메인 화면)을 연다. Chrome 의 새 탭 페이지.
#[tauri::command]
#[specta::specta]
pub async fn new_start_tab(app: AppHandle, window: Option<String>) -> Result<(), String> {
    new_start_tab_inner(&app, window).await
}

pub async fn new_start_tab_inner(app: &AppHandle, window: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };
    let Some(label) = target else {
        return create_window(app, None, None, None, false)
            .await
            .map(|_| ());
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().append(&label, None);
    }
    focus_window(app, &label);
    broadcast(app, &label).await;
    Ok(())
}

/// 앱 메뉴의 "새 창" — 언제나 새 창을 만든다 (탭을 붙이지 않는다).
pub async fn new_window_inner(app: &AppHandle) -> Result<(), String> {
    create_window(app, None, None, None, false)
        .await
        .map(|_| ())
}

/// 시작 탭에서 프로젝트를 골랐다 — **그 자리에서** 프로젝트 탭이 된다.
/// 단, 그 프로젝트가 이미 다른 탭에 열려 있으면 (I1) 그쪽을 활성화하고
/// 시작 탭은 그대로 둔다.
#[tauri::command]
#[specta::specta]
pub async fn set_tab_project(app: AppHandle, tab_id: u32, project_id: u32) -> Result<(), String> {
    // `open_project_tab_with_nav` 과 같은 가드 — 시작 탭의 목록은 그 창이 따로
    // 조회한 것이라 방금 다른 창에서 지운 프로젝트가 남아 있을 수 있다.
    {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map_err(|_| format!("project {project_id} not found"))?;
    }
    let already = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.locate_project(project_id)
    };
    if let Some((label, existing_tab)) = already {
        if existing_tab != tab_id {
            let state = app.state::<WindowTabs>();
            state.lock().activate(existing_tab);
            focus_window(&app, &label);
            broadcast(&app, &label).await;
            return Ok(());
        }
    }
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.assign_project(tab_id, project_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

/// **유령 창**인가 — 웹뷰는 살아 있는데 레지스트리가 모르는 앱 창.
///
/// 이 상태의 창은 어떤 조작으로도 닫히지 않는다. 탭 × 는 "모르는 탭" 으로
/// 떨어지고, ⌘W 는 `active_tab_of` 가 `None` 이라 프런트가 걸러 내며, 남는
/// 길은 OS 빨간 버튼뿐이다. 판정을 순수 함수로 빼 두면 런타임 없이 못 박을 수
/// 있다 — 이 조건이 느슨해지면 **멀쩡한 창을 닫는** 반대편 사고가 된다.
pub(super) fn ghost_window(reg: &Registry, asking: Option<&str>) -> Option<String> {
    let label = asking?;
    // 터미널 창·트레이는 애초에 탭 레지스트리 밖에 산다 — 유령이 아니다.
    if !is_app_window(label) || reg.get(label).is_some() {
        return None;
    }
    Some(label.to_string())
}

/// 탭을 닫는다. 창의 마지막 탭이면 창도 닫는다 (Chrome 과 같다).
///
/// `asking` 은 Tauri 가 주입하는 **호출한 창**이다 (프런트는 안 넘긴다). 요청한
/// 탭이 레지스트리에 없을 때 그 창이 유령인지 판단하는 데 쓴다 — 아래 참조.
#[tauri::command]
#[specta::specta]
pub async fn close_tab(
    app: AppHandle,
    asking: tauri::WebviewWindow,
    tab_id: u32,
) -> Result<(), String> {
    close_tab_from(&app, Some(asking.label()), tab_id).await
}

async fn close_tab_from(app: &AppHandle, asking: Option<&str>, tab_id: u32) -> Result<(), String> {
    let removed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.remove_tab(tab_id)
    };
    let Some((label, project_id, emptied)) = removed else {
        // 여기가 "닫기 버튼이 안 먹는다" 의 유일하게 남은 조용한 갈래다 (2026-08-29).
        // 프런트가 든 탭 id 를 레지스트리가 모르면 탭도 창도 건드리지 않고 Ok 를
        // 냈다 — 화면에는 아무 변화도 아무 메시지도 없다. Err 로 올리지는 않는다:
        // × 를 두 번 눌렀을 때처럼 **이미 닫힌 탭**을 다시 닫는 정상 경로도 여기로
        // 오기 때문이다. 대신 양쪽 값을 로그에 남겨 다음 재현에서 갈리게 한다.
        let (known, ghost) = {
            let state = app.state::<WindowTabs>();
            let reg = state.lock();
            // **유령 창** — 웹뷰는 살아 있는데 레지스트리에서 빠진 창.
            // 이 상태의 창은 어떤 조작으로도 닫히지 않는다: 탭 × 는 여기(모르는
            // 탭)로 떨어지고, ⌘W 는 `active_tab_of` 가 None 이라 프런트가 걸러
            // 내며, 남는 길은 OS 빨간 버튼뿐이다. 사용자가 요청한 일은 "이 창을
            // 닫는 것" 이고 레지스트리에 지킬 것도 없으니, 그대로 닫아 준다.
            (reg.summary(), ghost_window(&reg, asking))
        };
        tracing::warn!(
            tab_id,
            asking = asking.unwrap_or("-"),
            ghost = ghost.is_some(),
            registry = %known,
            "[FLOW] close_tab: 레지스트리에 없는 탭"
        );
        if let Some(label) = ghost {
            let Some(win) = app.get_webview_window(&label) else {
                return Ok(());
            };
            win.close()
                .map_err(|e| format!("유령 창 '{label}' 닫기 실패: {e}"))?;
            tracing::info!(window = %label, "[FLOW] 레지스트리에서 빠진 창을 닫았다");
        }
        return Ok(());
    };
    if let Some(pid) = project_id {
        release_project(app, pid).await;
    }
    if emptied {
        // 마지막 탭을 닫으면 창도 닫힌다 (Chrome 과 같다) — `⌘W` 한 키로
        // "탭 닫기" 와 "창 닫기" 가 자연스럽게 이어지는 지점이다.
        // 창 닫기가 CloseRequested 훅을 돌리지만, 레지스트리에서 이미 빠졌으므로
        // 남은 탭 정리는 no-op 이고 "마지막 창" 판정만 정상적으로 걸린다.
        //
        // 실패를 삼키지 않는다 (2026-08-29). 예전엔 `let _ = win.close()` 였고
        // 창을 못 찾은 경우는 아예 조용했다. 그런데 이 지점이 틀어지면 증상은
        // **탭은 사라졌는데 창이 남는다** — 사용자에게는 "닫기가 안 먹는다" 로
        // 보이고, 레지스트리에서는 이미 탭이 빠져 나가 되돌릴 수도 없다.
        // 어느 쪽으로 실패했는지 로그와 반환값 양쪽에 남긴다.
        let Some(win) = app.get_webview_window(&label) else {
            tracing::error!(
                window = %label,
                "[FLOW] 마지막 탭을 닫았는데 그 창의 웹뷰를 찾지 못했다 — 창이 그대로 남는다"
            );
            return Err(format!("창 '{label}' 을 찾을 수 없어 닫지 못했습니다"));
        };
        if let Err(e) = win.close() {
            tracing::error!(window = %label, error = %e, "[FLOW] 마지막 탭을 닫았으나 창 닫기 실패");
            return Err(format!("창 '{label}' 닫기 실패: {e}"));
        }
        tracing::info!(window = %label, "[FLOW] 마지막 탭이 닫혀 창도 닫는다");
    } else {
        broadcast(app, &label).await;
    }
    Ok(())
}

/// 지운 프로젝트가 창에 남긴 것 — (그 프로젝트의 탭, 분리 터미널 창이 있는가).
///
/// 판정만 순수 함수로 뺀다 (`ghost_window` 와 같은 규율). 아래 `close_project_
/// surfaces` 는 웹뷰를 만지므로 단위 테스트가 닿지 않는데, **어느 창에 있든
/// 찾아내는가**는 여기서 전부 결정된다 — 지운 프로젝트의 탭이 다른 창에 있을 때
/// 그냥 지나치면 그 창에 껍데기 탭이 남는다.
pub(super) fn project_surfaces(reg: &Registry, project_id: u32) -> (Option<u32>, bool) {
    (
        reg.locate_project(project_id).map(|(_, tab_id)| tab_id),
        reg.terminal_windows.contains(&project_id),
    )
}

/// 워크스페이스에서 **지운** 프로젝트의 창 흔적을 걷는다 — `delete_project` 가
/// DB 행을 지우기 전에 부른다.
///
/// 분리 터미널 창(`term-{pid}`)을 닫고, 그 프로젝트의 탭(I1 이라 많아야 하나)을
/// `close_tab` 과 **같은 길**로 닫는다 — PTY 정리·브로드캐스트·마지막 탭이면
/// 창 닫기까지 같다. 둘 중 나중에 정리되는 쪽이 셸을 죽인다 (`releasable`).
///
/// 이걸 안 하던 동안 (2026-09-17 06:11 로그): 지운 프로젝트의 탭이 스트립에
/// `#22` 로 남았고, 아직 마운트되지 않았던 그 탭을 뒤늦게 누르면 `oculpm_init`
/// 이 "project not found" 로 떨어졌으며, 사용자는 껍데기 탭을 손으로 닫아야
/// 했다. 프런트에서 닫게 하지 않는 이유는 삭제 흐름이 둘(시작 탭·관리 시트)이고
/// 탭은 다른 창에 있을 수도 있어서다 — 레지스트리를 쥔 쪽이 닫는 것이 맞다.
pub async fn close_project_surfaces(app: &AppHandle, project_id: u32) {
    let (tab, had_terminal) = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        project_surfaces(&reg, project_id)
    };
    if had_terminal {
        if let Err(e) = close_terminal_window(app.clone(), project_id).await {
            tracing::warn!(project_id, error = %e, "[FLOW] 지운 프로젝트의 터미널 창을 닫지 못했다");
        }
    }
    let Some(tab_id) = tab else {
        return;
    };
    tracing::info!(project_id, tab_id, "[FLOW] 지운 프로젝트의 탭을 닫는다");
    if let Err(e) = close_tab_from(app, None, tab_id).await {
        tracing::warn!(project_id, tab_id, error = %e, "[FLOW] 지운 프로젝트의 탭을 닫지 못했다");
    }
}

#[tauri::command]
#[specta::specta]
pub async fn activate_tab(app: AppHandle, tab_id: u32) -> Result<(), String> {
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.activate(tab_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reorder_tabs(app: AppHandle, window: String, order: Vec<u32>) -> Result<(), String> {
    let changed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reorder(&window, &order)
    };
    if changed {
        broadcast(&app, &window).await;
    }
    Ok(())
}

/// 창이 마운트 직후 자기 탭 구성을 읽는다 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn get_window_tabs(app: AppHandle, window: String) -> Result<WindowTabsSnapshot, String> {
    Ok(snapshot(&app, &window).await)
}

/// 시작 탭이 "열림" 배지를 그리기 위한 1회 조회 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn list_open_project_ids(app: AppHandle) -> Result<Vec<u32>, String> {
    let state = app.state::<WindowTabs>();
    let ids = state.lock().all_open_projects();
    Ok(ids)
}

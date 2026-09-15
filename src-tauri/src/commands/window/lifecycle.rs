//! 창 생성·정리 — URL 조립, 휴면 창 재사용, 웹뷰 띄우기, 첫 창 편입, 창 이벤트
//! 훅(포커스 추적·닫힘 시 탭 정리·마지막 창 판정), 프로젝트 단위 PTY 정리.
//!
//! 새 창(`create_window`)과 세션 복원이 같은 `spawn_window` 를 쓰도록 여기 모았다.

use super::*;

#[tauri::command]
#[specta::specta]
pub async fn open_devtools(webview: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err("DevTools is only available in development builds.".to_string())
    }
}

/// 쿼리 파라미터 값 최소 이스케이프. 신규 의존성 없이, 파라미터를 깨뜨리는
/// 문자(`&` `#` `%` 공백 …)만 퍼센트 인코딩한다. UTF-8 은 바이트 단위로
/// 인코딩되어 프런트의 `decodeURIComponent` 가 그대로 복원한다.
pub(super) fn encode_query_value(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 새 창의 URL. 탭 집합은 프런트가 마운트 직후 `get_window_tabs` 로 읽지만,
/// 라벨과 딥링크 목적지는 URL 로 실어야 한다 — 갓 만든 창의 프런트는 아직
/// 리스너를 달기 전이라 `emit` 이 유실된다.
pub(super) fn window_url(
    label: &str,
    nav: Option<&crate::tray::TrayNavigate>,
    tearoff: bool,
) -> String {
    let mut url = format!("index.html?win={}", encode_query_value(label));
    // 떼어내는 **중**인 창은 탭 줄만 그리고 화면 마운트를 붙잡는다. 끌려다니는
    // 몇백 ms 동안 프로젝트 init·워처·자동색인을 돌릴 이유가 없고, 도로 남의
    // 창에 합치면 그 전부가 낭비가 된다.
    if tearoff {
        url.push_str("&tearoff=1");
    }
    if let Some(nav) = nav {
        url.push_str(&format!("&view={}", encode_query_value(&nav.view)));
        if let Some(entry) = nav.entry_path.as_deref() {
            url.push_str(&format!("&entry={}", encode_query_value(entry)));
        }
    }
    url
}

pub(super) async fn create_window(
    app: &AppHandle,
    project_id: Option<u32>,
    nav: Option<&crate::tray::TrayNavigate>,
    position: Option<(f64, f64)>,
    tearoff: bool,
) -> Result<String, String> {
    // **휴면 창**을 먼저 재사용한다 — 웹뷰는 살아 있는데 레지스트리에는 없는
    // 창. 두 경우에 생긴다: ① 앱 시작 직후의 `main`(아직 편입 전), ② 상주
    // 모드에서 마지막 창을 닫아 숨겨 둔 창. 재사용하지 않으면 숨은 웹뷰가
    // 영원히 남고 매번 새 라벨이 발급된다.
    // 떼어내는 중인 창은 **반드시 새로** 만든다 — 휴면 창은 이미 평범한 앱 URL 로
    // 떠 있어서 `?tearoff=1` 이 안 먹고, 그러면 끌려다니는 동안 프로젝트가
    // 통째로 마운트된다.
    let dormant = if tearoff {
        None
    } else {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let mut labels: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|l| is_app_window(l) && reg.get(l).is_none())
            .cloned()
            .collect();
        // 결정적으로 고른다 — `main` 을 우선하고 그다음 라벨 순.
        labels.sort();
        labels
            .iter()
            .find(|l| l.as_str() == FIRST_WINDOW)
            .or_else(|| labels.first())
            .cloned()
    };
    if let Some(label) = dormant {
        {
            let state = app.state::<WindowTabs>();
            state.lock().register(&label, project_id);
        }
        // 떼어내기로 온 것이면 휴면 창도 손 밑으로 옮긴다 — 안 옮기면 끌어낸
        // 결과가 엉뚱한 자리(직전에 숨은 자리)에서 튀어나온다.
        if let (Some((x, y)), Some(win)) = (position, app.get_webview_window(&label)) {
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        return Ok(label);
    }

    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reserve(project_id)
    };

    let title = window_title(app, project_id).await;
    spawn_window(app, &label, nav, position, tearoff, title).await?;
    Ok(label)
}

/// 창 제목 — 프로젝트 탭이면 그 이름, 시작 탭이면 앱 이름.
pub(super) async fn window_title(app: &AppHandle, project_id: Option<u32>) -> String {
    match project_id {
        Some(pid) => {
            let db = app.state::<crate::db::Db>();
            db.get_project(pid)
                .await
                .map(|p| p.name)
                .unwrap_or_else(|_| "Ocul-PM".to_string())
        }
        None => "Ocul-PM".to_string(),
    }
}

/// 레지스트리에 **이미 자리를 잡은** 라벨로 웹뷰를 띄운다.
///
/// 새 창(`create_window`)과 세션 복원(`restore_session`)이 함께 쓴다 — 둘의
/// 차이는 라벨을 발급하느냐 저장된 것을 그대로 쓰느냐뿐이고, 띄우는 방법은
/// 같아야 한다 (크기·타이틀바·훅이 갈라지면 복원된 창만 미묘하게 달라진다).
pub(super) async fn spawn_window(
    app: &AppHandle,
    label: &str,
    nav: Option<&crate::tray::TrayNavigate>,
    position: Option<(f64, f64)>,
    tearoff: bool,
    title: String,
) -> Result<(), String> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(window_url(label, nav, tearoff).into()),
    )
    .title(title)
    .hidden_title(true)
    .inner_size(WINDOW_W, WINDOW_H)
    .min_inner_size(WINDOW_MIN_W, WINDOW_MIN_H)
    .resizable(true)
    // 손에 들려 있는 창은 포커스를 뺏지 않는다. 뺏으면 마우스 이벤트를 끌던
    // 창에서 가로채 갈 위험이 있고(드래그가 그 자리에서 죽는다), 화면상으로도
    // "아직 놓지 않았다" 가 안 읽힌다.
    .focused(!tearoff);
    if let Some((x, y)) = position {
        // 이미 "창 좌상단" 으로 계산돼 온다 (`detached_origin`) — 여기서 다시
        // 보정하지 않는다.
        builder = builder.position(x, y);
    }

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            // 예약만 해두고 창이 안 뜨면 유령 엔트리가 남는다 — 되돌린다.
            let state = app.state::<WindowTabs>();
            state.lock().windows.remove(label);
            return Err(e.to_string());
        }
    };

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    attach_window_hooks(app, &window, label.to_string());
    emit_open_projects(app);
    Ok(())
}

/// `tauri.conf.json` 이 만든 첫 창을 레지스트리에 등록하고 훅을 붙인다.
/// 앱 시작 시 setup 에서 한 번 호출한다.
pub fn adopt_first_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FIRST_WINDOW) else {
        return;
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().register(FIRST_WINDOW, None);
    }
    attach_window_hooks(app, &window, FIRST_WINDOW.to_string());
}

/// 창 이벤트 훅 — 포커스 추적 + 닫을 때 그 창의 **모든 탭** 정리.
///
/// 프런트의 `beforeunload` 에 맡기지 않는 이유: 강제 종료·크래시 시 새기
/// 때문이다. Rust 쪽 창 이벤트가 유일하게 믿을 수 있는 지점이다.
fn attach_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, label: String) {
    let handle = app.clone();
    window.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Focused(true) => {
            let state = handle.state::<WindowTabs>();
            state.lock().note_focus(&label);
        }
        // `Destroyed` 가 아니라 `CloseRequested` 를 쓴다 — 앱 종료 경로에서는
        // 발화하지 않아, 종료 중에 "마지막 창" 판정이 무언가를 다시 띄우는
        // 사고를 구조적으로 막는다.
        tauri::WindowEvent::CloseRequested { api, .. } if handle_window_closed(&handle, &label) => {
            api.prevent_close();
        }
        _ => {}
    });
}

/// 반환값 `true` 면 닫기를 가로챈 것 (트레이 상주 모드에서 숨기기만 함).
fn handle_window_closed(app: &AppHandle, label: &str) -> bool {
    let (closed_tabs, remaining) = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        let tabs = reg
            .windows
            .remove(label)
            .map(|st| {
                st.order
                    .iter()
                    .filter_map(|t| t.project_id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if reg.last_focused.as_deref() == Some(label) {
            reg.last_focused = None;
        }
        (tabs, reg.windows.len())
    };

    for project_id in closed_tabs {
        release_project_blocking(app, project_id);
    }
    emit_open_projects(app);

    if remaining > 0 {
        return false;
    }

    // 분리 터미널 창은 탭 창이 아니지만 **앱이 아직 하는 일**이다. 남아 있는데
    // 여기서 종료·상주 전환을 밟으면, 방금 떼어낸 터미널이 통째로 사라진다.
    let detached = app.state::<WindowTabs>().lock().terminal_window_projects();
    if !detached.is_empty() {
        return false;
    }

    // 마지막 창 — 어떤 PTY 도 주인이 없다. 접두사 없는 레거시 sid(멀티 창
    // 이전에 저장된 터미널 탭)까지 여기서 회수한다.
    crate::commands::terminal::kill_ptys_except_blocking(app, &[]);
    crate::tray::handle_last_window_closed(app, label)
}

/// 탭이 사라질 때의 프로젝트 단위 정리 — **PTY 종료만** 한다.
///
/// 예전에는 watcher 도 함께 멈췄다. 하지만 감시 범위가 "열린 탭" 에서 "추적
/// 중인 모든 프로젝트" 로 바뀌면서(2026-08-12), watcher 의 수명은 탭이 아니라
/// **앱 프로세스**에 묶인다 — 여기서 멈추면 탭을 닫는 순간 그 프로젝트가
/// 상단바에서 다시 사라진다. 종료 시 정리는 `shutdown_all_blocking` 이 한다.
///
/// 이 비동기판은 **커맨드**(탭 닫기)가 쓴다. 창 이벤트 훅은 아래 동기판이다 —
/// 왜 나뉘어야 하는지는 `commands/terminal.rs` 의 "두 갈래인 이유" 참고.
/// 여기서 동기판을 부르면 tokio 가 패닉해 **그 뒤의 창 닫기가 통째로 사라진다**
/// (2026-08-29, 떼어낸 창이 안 닫히던 뿌리).
pub(super) async fn release_project(app: &AppHandle, project_id: u32) {
    if !releasable(app, project_id) {
        return;
    }
    crate::commands::terminal::kill_ptys_with_prefix(app, &pty_prefix_for(project_id)).await;
}

/// 같은 정리를 창 이벤트 훅(메인 스레드·동기)에서. 여기서는 기다려야 한다 —
/// 마지막 창 닫힘 직후 앱이 종료될 수 있어 spawn 은 종료와 경주한다.
fn release_project_blocking(app: &AppHandle, project_id: u32) {
    if !releasable(app, project_id) {
        return;
    }
    crate::commands::terminal::kill_ptys_with_prefix_blocking(app, &pty_prefix_for(project_id));
}

/// 이 프로젝트의 셸을 정리해도 되는가.
///
/// 2026-08-15 — 터미널을 창으로 떼어냈으면 **그 창이 아직 셸의 주인**이다.
/// 탭만 보고 죽이면, 분리 창을 띄워 둔 채 프로젝트 탭을 닫는 순간 그 안의
/// 셸이 전부 사라진다 (창은 살아 있는데 내용만 죽는 셈).
fn releasable(app: &AppHandle, project_id: u32) -> bool {
    !app.state::<WindowTabs>().lock().project_in_use(project_id)
}

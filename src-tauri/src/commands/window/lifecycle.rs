//! 창 생성·정리 — URL 조립, 휴면 창 재사용, 웹뷰 띄우기, 첫 창 편입, 창 이벤트
//! 훅(포커스 추적·닫힘 시 정리·마지막 창 판정).
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

/// 새 창의 URL. 프로젝트는 프런트가 마운트 직후 `get_window_project` 로 읽지만,
/// 라벨과 딥링크 목적지는 URL 로 실어야 한다 — 갓 만든 창의 프런트는 아직 리스너를
/// 달기 전이라 `emit` 이 유실된다.
pub(super) fn window_url(label: &str, nav: Option<&WindowNavigate>) -> String {
    let mut url = format!("index.html?win={}", encode_query_value(label));
    if let Some(nav) = nav {
        url.push_str(&format!("&view={}", encode_query_value(&nav.view)));
        if let Some(entry) = nav.entry_path.as_deref() {
            url.push_str(&format!("&entry={}", encode_query_value(entry)));
        }
    }
    url
}

/// 창을 하나 연다 — 시작 창(`project = None`)이거나 그 프로젝트의 창.
///
/// **휴면 창**을 먼저 재사용한다 — 웹뷰는 살아 있는데 레지스트리에는 없는 창.
/// 두 경우에 생긴다: ① 앱 시작 직후의 `main`(아직 편입 전), ② 상주 모드에서 마지막
/// 창을 닫아 숨겨 둔 창. 재사용하지 않으면 숨은 웹뷰가 영원히 남고 매번 새 라벨이
/// 발급된다.
pub(super) async fn create_window(
    app: &AppHandle,
    project_id: Option<u32>,
    nav: Option<&WindowNavigate>,
) -> Result<String, String> {
    let dormant = {
        let state = app.state::<WindowProjects>();
        let reg = state.lock();
        let mut labels: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|l| is_app_window(l) && reg.project_of(l).is_none())
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
        app.state::<WindowProjects>()
            .lock()
            .register(&label, project_id);
        focus_window(app, &label);
        announce(app, &label);
        return Ok(label);
    }

    let label = app.state::<WindowProjects>().lock().reserve(project_id);
    let title = window_title(app, project_id).await;
    spawn_window(app, &label, nav, title).await?;
    Ok(label)
}

/// 창 제목 — 프로젝트 창이면 그 이름, 시작 창이면 앱 이름.
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
/// 새 창(`create_window`)과 세션 복원(`restore_session`)이 함께 쓴다 — 둘의 차이는
/// 라벨을 발급하느냐 저장된 것을 그대로 쓰느냐뿐이고, 띄우는 방법은 같아야 한다.
pub(super) async fn spawn_window(
    app: &AppHandle,
    label: &str,
    nav: Option<&WindowNavigate>,
    title: String,
) -> Result<(), String> {
    let builder =
        WebviewWindowBuilder::new(app, label, WebviewUrl::App(window_url(label, nav).into()))
            .title(title);
    // 제목 숨김은 macOS 전용 빌더 메서드다 (오버레이 타이틀바와 짝). 비-mac 은 OS 의
    // 네이티브 제목줄 그대로 — 제목(프로젝트 이름)이 보인다. 신호등은 셸의 윗줄(44px)
    // 가운데에 — 첫 창은 tauri.conf.json 의 `trafficLightPosition` 이 같은 값을 준다.
    #[cfg(target_os = "macos")]
    let builder = builder
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(
            TRAFFIC_LIGHT_X,
            TRAFFIC_LIGHT_Y,
        ));
    let builder = builder
        .inner_size(WINDOW_W, WINDOW_H)
        .min_inner_size(WINDOW_MIN_W, WINDOW_MIN_H)
        .resizable(true);

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            // 예약만 해두고 창이 안 뜨면 유령 엔트리가 남는다 — 되돌린다.
            app.state::<WindowProjects>().lock().remove(label);
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

/// `tauri.conf.json` 이 만든 첫 창을 시작 창으로 편입하고 훅을 붙인다.
/// 앱 시작 시 setup 에서 한 번 호출한다.
pub fn adopt_first_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FIRST_WINDOW) else {
        return;
    };
    app.state::<WindowProjects>()
        .lock()
        .register(FIRST_WINDOW, None);
    attach_window_hooks(app, &window, FIRST_WINDOW.to_string());
}

/// 창 이벤트 훅 — 포커스 추적 + 닫을 때 레지스트리 정리.
///
/// 프런트의 `beforeunload` 에 맡기지 않는 이유: 강제 종료·크래시 시 새기 때문이다.
/// Rust 쪽 창 이벤트가 유일하게 믿을 수 있는 지점이다.
fn attach_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, label: String) {
    let handle = app.clone();
    window.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Focused(true) => {
            handle.state::<WindowProjects>().lock().note_focus(&label);
        }
        // `Destroyed` 가 아니라 `CloseRequested` 를 쓴다 — 앱 종료 경로에서는
        // 발화하지 않아, 종료 중에 "마지막 창" 판정이 무언가를 다시 띄우는 사고를
        // 구조적으로 막는다.
        tauri::WindowEvent::CloseRequested { api, .. } if handle_window_closed(&handle, &label) => {
            api.prevent_close();
        }
        _ => {}
    });
}

/// 반환값 `true` 면 닫기를 가로챈 것 (macOS 에서 마지막 창을 숨기기만 함).
fn handle_window_closed(app: &AppHandle, label: &str) -> bool {
    let remaining = app.state::<WindowProjects>().lock().remove(label);
    emit_open_projects(app);
    if remaining > 0 {
        return false;
    }
    handle_last_window_closed(app, label)
}

/// 마지막 창이 닫혔을 때 앱이 종료되는가 — 플랫폼 표준을 따른다. macOS 는 창이 없어도
/// 앱이 살아 있고(독 아이콘을 누르면 `RunEvent::Reopen` 이 다시 연다), 그 밖의 OS 는
/// 종료한다. 창이 남아 있으면 어느 OS 든 종료하지 않는다 — 작업 중인 다른 창을
/// 죽이는 참사(R1)를 막는 자리다. 순수 함수라 창 런타임 없이 단위 테스트한다.
pub(super) fn exits_on_last_window_close(remaining_windows: usize, is_mac: bool) -> bool {
    remaining_windows == 0 && !is_mac
}

/// 마지막 앱 창이 닫혔다. `true` 를 돌려주면 닫기를 가로챈 것 — 창을 파괴하는 대신
/// 숨겨 두면 다음 `create_window` 가 그 휴면 창을 재사용해 즉시 뜬다.
fn handle_last_window_closed(app: &AppHandle, label: &str) -> bool {
    if exits_on_last_window_close(0, cfg!(target_os = "macos")) {
        app.exit(0);
        return false;
    }
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.hide();
    }
    true
}

//! 포커스·메뉴 브리지 — "지금 어느 창인가" 를 메뉴·딥링크에 답하고,
//! 프런트가 해석한 메뉴 언어를 되돌려 받는다.
//!
//! 메뉴 이벤트에는 대상 창이 실려 오지 않으므로 이 조회들이 그 빈자리를 메운다.

use super::*;

/// 프런트가 해석한 UI 언어를 알려 준다 — 메뉴 라벨을 그 언어로 다시 만든다.
///
/// Rust 는 프런트의 i18n 사전을 읽지 않고, `language: "system"` 을 OS 로케일로
/// 푸는 것도 백엔드에서는 불안정하다 (GUI 프로세스에는 `LANG` 이 없다).
/// **이미 해석을 끝낸 프런트가 결과만 넘겨주는 것**이 가장 정확하다.
#[tauri::command]
#[specta::specta]
pub async fn apply_menu_language(app: AppHandle, lang: String) -> Result<(), String> {
    // `apply` 가 창 메뉴 지정(macOS ⌃⌥ 창 분할)까지 함께 한다 — 언어를 바꿀
    // 때마다 서브메뉴를 새로 만들므로 지정도 매번 다시 해야 한다.
    crate::menu::apply(&app, &lang).map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn focus_window(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 앱 창을 하나 앞으로 — 없으면 시작 창을 하나 만든다.
pub async fn focus_or_open_window(app: &AppHandle) -> Result<(), String> {
    let existing = {
        let state = app.state::<WindowProjects>();
        let reg = state.lock();
        reg.preferred_window()
            .filter(|l| app.get_webview_window(l).is_some())
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        return Ok(());
    }
    create_window(app, None, None).await.map(|_| ())
}

/// 창을 앞으로 — 기다리지 않는다. 두 번째 인스턴스가 떴을 때(`instance_lock`)
/// 첫 인스턴스의 콜백이 부른다.
pub fn show_main(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = focus_or_open_window(&handle).await;
    });
}

/// 지금 포커스된 앱 창. 메뉴 이벤트에는 대상 창이 실려 오지 않으므로 여기서
/// 찾는다. 실제 포커스를 먼저 보고(가장 정확하다), 못 찾으면 레지스트리가
/// 기억하는 마지막 포커스 창으로 떨어진다 — 메뉴를 여는 순간 창이 포커스를
/// 잃는 플랫폼도 있기 때문이다.
pub fn focused_app_window(app: &AppHandle) -> Option<String> {
    let live = app
        .webview_windows()
        .into_iter()
        .find(|(label, w)| is_app_window(label) && w.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    live.or_else(|| {
        let state = app.state::<WindowProjects>();
        let reg = state.lock();
        reg.preferred_window()
    })
}

/// 프로젝트를 담은 창 하나 — 포커스된 창이 그렇다면 그 창 (`Registry::project_window`).
/// 딥링크 확인 시트처럼 **한 창에만** 띄울 것의 자리다.
pub fn focused_project_window(app: &AppHandle) -> Option<String> {
    let focused = focused_app_window(app);
    app.state::<WindowProjects>()
        .lock()
        .project_window(focused.as_deref())
}

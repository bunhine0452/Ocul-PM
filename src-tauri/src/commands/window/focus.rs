//! 포커스·메뉴 브리지 — "지금 어느 창인가" 를 메뉴·트레이·딥링크에 답하고,
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

/// 앱 창을 하나 앞으로 — 없으면 시작 탭으로 하나 만든다.
/// 트레이 메뉴 "열기" 와 상주 모드 복귀의 공용 경로.
pub async fn focus_or_open_window(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let existing = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window()
            .filter(|l| app.get_webview_window(l).is_some())
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        return Ok(());
    }
    create_window(app, None, None, None, false)
        .await
        .map(|_| ())
}

/// 지금 포커스된 앱 창. 메뉴 이벤트에는 대상 창이 실려 오지 않으므로 여기서
/// 찾는다. 실제 포커스를 먼저 보고(가장 정확하다), 못 찾으면 레지스트리가
/// 기억하는 마지막 포커스 창으로 떨어진다 — 메뉴를 여는 순간 창이 포커스를
/// 잃는 플랫폼도 있기 때문이다. 트레이 팝오버는 앱 창이 아니라 제외된다.
pub fn focused_app_window(app: &AppHandle) -> Option<String> {
    let live = app
        .webview_windows()
        .into_iter()
        .find(|(label, w)| is_app_window(label) && w.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    live.or_else(|| {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window()
    })
}

/// 지금 포커스된 **분리 터미널 창**의 라벨.
///
/// ⌘W/⇧⌘W 처리에 반드시 먼저 물어봐야 한다: `focused_app_window` 는 터미널
/// 창을 앱 창으로 치지 않아 "마지막으로 포커스된 탭 창"으로 떨어지고, 그러면
/// 터미널 창에서 누른 ⌘W 가 **다른 창의 탭**을 닫아 버린다.
pub fn focused_terminal_window(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(label, w)| {
            terminal_window_project(label).is_some() && w.is_focused().unwrap_or(false)
        })
        .map(|(label, _)| label)
}

/// 그 창에서 지금 보이고 있는 탭.
pub fn active_tab_of(app: &AppHandle, label: &str) -> Option<u32> {
    let state = app.state::<WindowTabs>();
    let reg = state.lock();
    reg.get(label).and_then(|st| st.active)
}

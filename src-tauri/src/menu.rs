//! 앱 메뉴.
//!
//! **존재 이유는 하나다: `⌘W` 를 "창 닫기" 에서 "탭 닫기" 로 되찾는 것.**
//!
//! Tauri 기본 메뉴는 `⌘W` 를 Close Window 에 묶어 두는데, macOS 는 메뉴
//! 액셀러레이터를 웹뷰보다 **먼저** 소비한다 — 프런트에서 `keydown` 을 잡아도
//! 이벤트가 도달하지 않는다. 그래서 메뉴 전체를 직접 구성하는 것 말고는
//! 방법이 없다.
//!
//! ⚠️ 직접 구성하면 **표준 항목이 자동으로 붙지 않는다.** 특히 편집 메뉴
//! (실행 취소·잘라내기·복사·붙여넣기·전체 선택)가 빠지면 웹뷰 안 텍스트
//! 입력에서 `⌘C`/`⌘V` 가 통째로 죽는다. 아래 Edit 서브메뉴는 장식이 아니다.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager};

pub const NEW_TAB: &str = "menu:new-tab";
pub const NEW_WINDOW: &str = "menu:new-window";
pub const CLOSE_TAB: &str = "menu:close-tab";
pub const CLOSE_WINDOW: &str = "menu:close-window";

/// 액셀러레이터. **`⌘W` 가 탭 닫기**이고 창 닫기는 `⇧⌘W` 로 물러난다 —
/// Chrome/Safari 와 같은 계약이고, 이 파일이 존재하는 이유다.
const ACC_NEW_TAB: &str = "CmdOrCtrl+T";
const ACC_NEW_WINDOW: &str = "Shift+CmdOrCtrl+N";
const ACC_CLOSE_TAB: &str = "CmdOrCtrl+W";
const ACC_CLOSE_WINDOW: &str = "Shift+CmdOrCtrl+W";

/// 메뉴 라벨 묶음. 프런트의 i18n 사전을 Rust 가 읽을 수 없으므로 최소 집합만
/// 여기에 둔다 — 언어는 프런트가 `apply_menu_language` 로 알려준다.
struct Labels {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    new_tab: &'static str,
    new_window: &'static str,
    close_tab: &'static str,
    close_window: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    fullscreen: &'static str,
    minimize: &'static str,
    hide: &'static str,
    quit: &'static str,
    about: &'static str,
    services: &'static str,
}

const KO: Labels = Labels {
    file: "파일",
    edit: "편집",
    view: "보기",
    window: "창",
    new_tab: "새 탭",
    new_window: "새 창",
    close_tab: "탭 닫기",
    close_window: "창 닫기",
    undo: "실행 취소",
    redo: "다시 실행",
    cut: "잘라내기",
    copy: "복사",
    paste: "붙여넣기",
    select_all: "전체 선택",
    fullscreen: "전체 화면",
    minimize: "최소화",
    hide: "Ocul-PM 가리기",
    quit: "Ocul-PM 종료",
    about: "Ocul-PM 정보",
    services: "서비스",
};

const EN: Labels = Labels {
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    new_tab: "New Tab",
    new_window: "New Window",
    close_tab: "Close Tab",
    close_window: "Close Window",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    fullscreen: "Toggle Full Screen",
    minimize: "Minimize",
    hide: "Hide Ocul-PM",
    quit: "Quit Ocul-PM",
    about: "About Ocul-PM",
    services: "Services",
};

fn labels(lang: &str) -> &'static Labels {
    if lang.starts_with("en") {
        &EN
    } else {
        &KO
    }
}

/// 메뉴 트리를 만든다. 반환값에 **창 서브메뉴가 함께 오는 이유**는 macOS 가
/// 그것을 따로 지정받아야 "이동 및 크기 조절"(창 분할 단축키)을 넣어 주기
/// 때문이다 — `apply` 를 쓰면 그 단계까지 자동이다.
pub fn build(
    app: &AppHandle,
    lang: &str,
) -> tauri::Result<(Menu<tauri::Wry>, Submenu<tauri::Wry>)> {
    let l = labels(lang);

    // ① 앱 메뉴 — macOS 는 첫 서브메뉴를 앱 이름으로 대체한다.
    let app_menu = SubmenuBuilder::new(app, "Ocul-PM")
        .about_with_text(l.about, None)
        .separator()
        .services_with_text(l.services)
        .separator()
        .hide_with_text(l.hide)
        .separator()
        .quit_with_text(l.quit)
        .build()?;

    // ② 파일 — ⌘W 를 되찾는 자리. "창 닫기" 는 ⇧⌘W 로 물러난다 (Chrome 과 동일).
    let new_tab = MenuItemBuilder::with_id(NEW_TAB, l.new_tab)
        .accelerator(ACC_NEW_TAB)
        .build(app)?;
    let new_window = MenuItemBuilder::with_id(NEW_WINDOW, l.new_window)
        .accelerator(ACC_NEW_WINDOW)
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id(CLOSE_TAB, l.close_tab)
        .accelerator(ACC_CLOSE_TAB)
        .build(app)?;
    let close_window = MenuItemBuilder::with_id(CLOSE_WINDOW, l.close_window)
        .accelerator(ACC_CLOSE_WINDOW)
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, l.file)
        .item(&new_tab)
        .item(&new_window)
        .separator()
        .item(&close_tab)
        .item(&close_window)
        .build()?;

    // ③ 편집 — **빼면 웹뷰 안에서 ⌘C/⌘V 가 죽는다.**
    let edit_menu = SubmenuBuilder::new(app, l.edit)
        .undo_with_text(l.undo)
        .redo_with_text(l.redo)
        .separator()
        .cut_with_text(l.cut)
        .copy_with_text(l.copy)
        .paste_with_text(l.paste)
        .select_all_with_text(l.select_all)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, l.view)
        .fullscreen_with_text(l.fullscreen)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, l.window)
        .minimize_with_text(l.minimize)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    Ok((menu, window_menu))
}

/// 메뉴를 만들고 붙인다 — **창 메뉴 지정까지 여기서 끝낸다.**
///
/// macOS 의 창 분할 단축키(⌃⌥←→↑↓)는 시스템 전역 키가 아니라 **"창" 메뉴 안
/// "이동 및 크기 조절" 항목의 액셀러레이터**다. AppKit 은 그 항목들을
/// `NSApp.windowsMenu` 로 지정된 서브메뉴에만 끼워 넣는다. 우리는 ⌘W 를
/// 되찾으려고 메뉴를 직접 구성했는데(파일 메뉴), 그러면서 어느 것이 창
/// 메뉴인지 알려 주지 않아 그 항목들이 아예 생기지 않았다 — 사용자 눈에는
/// "이 앱에서만 창 분할 단축키가 안 먹는" 것으로 보인다.
///
/// 언어를 바꾸면 서브메뉴를 새로 만들므로 지정도 매번 다시 해야 한다. 그래서
/// 빌드와 지정을 한 함수로 묶는다 — 호출처가 하나를 빼먹을 수 없게.
pub fn apply(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let (menu, window_menu) = build(app, lang)?;
    app.set_menu(menu)?;
    // 메인 메뉴에 붙인 **뒤에** 지정한다 — 순서가 뒤바뀌면 AppKit 이 아직
    // 메뉴바에 없는 NSMenu 를 창 메뉴로 잡는다.
    #[cfg(target_os = "macos")]
    {
        // 지정 실패가 앱을 못 뜨게 할 이유는 없다 — 단축키 하나를 잃을 뿐이다.
        if let Err(e) = window_menu.set_as_windows_menu_for_nsapp() {
            tracing::warn!(target: "menu", error = %e, "창 메뉴 지정 실패 — ⌃⌥ 창 분할이 안 먹을 수 있다");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window_menu;
    Ok(())
}

/// 메뉴 이벤트 → 탭 커맨드. 메뉴에는 대상 창이 실려 오지 않으므로 여기서
/// **지금 포커스된 창**을 찾아 그 창의 활성 탭에 적용한다.
pub fn handle_event(app: &AppHandle, id: &str) {
    use crate::commands::window as win;
    let handle = app.clone();
    match id {
        CLOSE_TAB => {
            // 여기서 닫지 않고 **프런트에 넘긴다**. 화면 안에 또 닫을 것이
            // 있을 수 있어서다(Claude Code 의 세션 탭) — 사용자는 브라우저처럼
            // 안쪽부터 닫히기를 기대하고, 무엇이 열려 있는지는 프런트만 안다.
            //
            // 탭이 하나뿐이면 그 탭을 닫는 것이 곧 창을 닫는 것이다 —
            // `close_tab` 이 빈 창을 스스로 닫는다 (Chrome 과 같다).
            use tauri_specta::Event as _;
            // 분리 터미널 창에는 탭이 없다 — ⌘W 는 그 창을 닫는 것이다. 먼저
            // 물어보지 않으면 `focused_app_window` 가 "마지막으로 포커스된 탭
            // 창"으로 떨어져 **남의 창의 탭**을 닫는다.
            if let Some(label) = win::focused_terminal_window(app) {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.close();
                }
                return;
            }
            if let Some(window) = win::focused_app_window(app) {
                let tab = win::active_tab_of(app, &window);
                // 활성 탭이 없다 = 이 창이 레지스트리에서 빠졌다(유령 창).
                // 그대로 `CloseIntent` 를 쏘면 프런트가 `tab == null` 로 걸러
                // 내고 **아무 일도 일어나지 않는다** — 사용자에게는 ⌘W 가 씹히는
                // 창이 된다. 지킬 탭이 없으니 창을 닫는 것이 요청의 답이다.
                if tab.is_none() {
                    if let Some(w) = app.get_webview_window(&window) {
                        let _ = w.close();
                    }
                    return;
                }
                let _ = win::CloseIntent { window, tab }.emit(app);
            }
        }
        CLOSE_WINDOW => {
            if let Some(label) =
                win::focused_terminal_window(app).or_else(|| win::focused_app_window(app))
            {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.close();
                }
            }
        }
        NEW_TAB => {
            // ⌘W 와 같은 이유로 **프런트에 넘긴다** (2026-09-01). 화면 안에 자기
            // 탭을 가진 것이 있고(터미널의 셸 탭), 사용자는 브라우저처럼 "지금
            // 보고 있는 것" 에 탭이 붙기를 기대한다. 포커스가 어디인지는 프런트만
            // 아는 사실이라 판단도 그쪽이 한다 — 아무도 안 받으면 창이 평소대로
            // 시작 탭을 연다.
            use tauri_specta::Event as _;
            // 분리 터미널 창에는 프로젝트 탭이 없다. 먼저 묻지 않으면
            // `focused_app_window` 가 "마지막으로 포커스된 탭 창" 으로 떨어져
            // **남의 창에** 탭이 열린다 (⌘W 가 겪었던 그 버그다).
            if let Some(label) = win::focused_terminal_window(app) {
                let _ = win::NewTabIntent { window: label }.emit(app);
                return;
            }
            match win::focused_app_window(app) {
                Some(window) => {
                    let _ = win::NewTabIntent { window }.emit(app);
                }
                // 들을 창이 하나도 없다 — 열어 줄 프런트가 없으니 Rust 가 만든다.
                None => {
                    tauri::async_runtime::spawn(async move {
                        let _ = win::new_start_tab_inner(&handle, None).await;
                    });
                }
            }
        }
        NEW_WINDOW => {
            tauri::async_runtime::spawn(async move {
                let _ = win::new_window_inner(&handle).await;
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 창 메뉴 지정을 잃지 않게 하는 소스 가드.
    ///
    /// macOS 의 창 분할 단축키(⌃⌥←→↑↓)는 `NSApp.windowsMenu` 로 지정된
    /// 서브메뉴에만 AppKit 이 끼워 넣는다. `set_menu` 를 직접 부르는 새 경로가
    /// 생기면 그 창에서만 조용히 단축키가 사라진다 — 화면으로는 티가 안 나고
    /// 사용자가 "이 앱만 창 분할이 안 된다" 고 느낄 뿐이다. 그래서 붙이는 길을
    /// `apply` 하나로 강제한다.
    #[test]
    fn set_menu_is_reached_only_through_apply() {
        for (name, src) in [
            ("lib.rs", include_str!("lib.rs")),
            ("commands/window.rs", include_str!("commands/window.rs")),
        ] {
            assert!(
                !src.contains("set_menu("),
                "{name} 이 set_menu 를 직접 부른다 — menu::apply 를 쓰세요 \
                 (창 메뉴 지정이 빠지면 ⌃⌥ 창 분할 단축키가 죽습니다)"
            );
        }
    }

    #[test]
    fn language_picks_label_set() {
        assert_eq!(labels("en").close_tab, "Close Tab");
        assert_eq!(labels("en-US").close_tab, "Close Tab");
        assert_eq!(labels("ko").close_tab, "탭 닫기");
        // 알 수 없는 값은 한국어로 — 이 앱의 기본 언어다.
        assert_eq!(labels("system").close_tab, "탭 닫기");
        assert_eq!(labels("").close_tab, "탭 닫기");
    }

    /// **이 파일의 존재 이유** — ⌘W 는 탭 닫기, 창 닫기는 ⇧⌘W 다.
    /// 둘이 뒤바뀌거나 같아지면 "⌘W 로 창이 통째로 닫히는" 예전 동작으로
    /// 조용히 되돌아간다 (Tauri 기본 메뉴가 그랬다).
    #[test]
    fn cmd_w_closes_the_tab_not_the_window() {
        assert_eq!(ACC_CLOSE_TAB, "CmdOrCtrl+W");
        assert_eq!(ACC_CLOSE_WINDOW, "Shift+CmdOrCtrl+W");
        assert_ne!(ACC_CLOSE_TAB, ACC_CLOSE_WINDOW);
    }

    /// 액셀러레이터가 겹치면 어느 항목이 이길지 플랫폼에 맡기게 된다.
    #[test]
    fn accelerators_do_not_collide() {
        let all = [ACC_NEW_TAB, ACC_NEW_WINDOW, ACC_CLOSE_TAB, ACC_CLOSE_WINDOW];
        let mut sorted = all.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), all.len(), "액셀러레이터 중복: {all:?}");
    }

    /// 메뉴 id 는 프런트와 공유하지 않지만, 서로 충돌하면 조용히 엉뚱한
    /// 동작을 한다 — 접두사로 네임스페이스를 나눠 둔다.
    #[test]
    fn menu_ids_are_namespaced_and_unique() {
        let ids = [NEW_TAB, NEW_WINDOW, CLOSE_TAB, CLOSE_WINDOW];
        for id in ids {
            assert!(id.starts_with("menu:"), "{id} 에 네임스페이스가 없다");
        }
        let mut sorted = ids.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
    }
}

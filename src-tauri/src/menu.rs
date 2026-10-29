//! 앱 메뉴.
//!
//! **존재 이유는 둘이다: 편집 메뉴(⌘C/⌘V)와 창 메뉴(⌃⌥ 창 분할)를 지키는 것.**
//!
//! 3.x 에서는 `⌘W` 를 "탭 닫기" 로 되찾으려고 메뉴 전체를 직접 구성했다. 4.0 은 창
//! 하나가 프로젝트 하나라(크롬식 탭을 걷었다) `⌘W` 는 다시 **창 닫기**다 — 그래도
//! 메뉴는 직접 구성한다. Tauri 기본 메뉴로 돌아가면 메뉴 언어를 앱 언어에 맞출 수
//! 없고, 「새 창」(⇧⌘N)이 사라진다.
//!
//! ⚠️ 직접 구성하면 **표준 항목이 자동으로 붙지 않는다.** 특히 편집 메뉴
//! (실행 취소·잘라내기·복사·붙여넣기·전체 선택)가 빠지면 웹뷰 안 텍스트
//! 입력에서 `⌘C`/`⌘V` 가 통째로 죽는다. 아래 Edit 서브메뉴는 장식이 아니다.
//!
//! ## Windows·Linux 에는 메뉴를 달지 않는다 (`#os-no-menu`)
//!
//! Linux(GTK)는 창 액셀러레이터가 웹뷰보다 먼저 받아 입력칸의 `Ctrl+C` 같은 키를
//! 가로채고, Windows(WebView2)는 웹뷰 포커스 중에는 액셀러레이터가 안 들린다. 그래서
//! 비-mac 은 메뉴 없이 — 창 키(`Ctrl+W`·`Ctrl+Shift+N`)는 프런트가 keydown 으로
//! 받고(`useWindowKeys`), 편집 키는 웹뷰 기본이 처리한다. 메뉴 트리를 만드는 코드는
//! macOS 에서만 불린다 — 비-mac 빌드의 dead_code 허용은 그 때문이다.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

pub const NEW_WINDOW: &str = "menu:new-window";
pub const CLOSE_WINDOW: &str = "menu:close-window";
/// 도움말 › 처음 쓰는 법 — 포커스된 창에 첫 실행 안내를 다시 띄운다 (ocul-next #tour-reopen).
pub const TOUR: &str = "menu:tour";

/// 메뉴의 「처음 쓰는 법」 — 그 창의 프런트가 안내 모달을 연다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, tauri_specta::Event)]
pub struct TourRequested {}

/// 액셀러레이터. 창 하나가 프로젝트 하나라 **`⌘W` 는 창 닫기**다 (macOS 표준).
const ACC_NEW_WINDOW: &str = "Shift+CmdOrCtrl+N";
const ACC_CLOSE_WINDOW: &str = "CmdOrCtrl+W";

/// 메뉴 라벨 묶음. 프런트의 i18n 사전을 Rust 가 읽을 수 없으므로 최소 집합만
/// 여기에 둔다 — 언어는 프런트가 `apply_menu_language` 로 알려준다.
struct Labels {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    new_window: &'static str,
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
    help: &'static str,
    tour: &'static str,
}

const KO: Labels = Labels {
    file: "파일",
    edit: "편집",
    view: "보기",
    window: "창",
    help: "도움말",
    tour: "처음 쓰는 법",
    new_window: "새 창",
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
    help: "Help",
    tour: "Getting Started",
    new_window: "New Window",
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
pub fn build<R: Runtime>(app: &AppHandle<R>, lang: &str) -> tauri::Result<(Menu<R>, Submenu<R>)> {
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

    // ② 파일 — 새 창(⇧⌘N, 시작 창)과 창 닫기(⌘W).
    let new_window = MenuItemBuilder::with_id(NEW_WINDOW, l.new_window)
        .accelerator(ACC_NEW_WINDOW)
        .build(app)?;
    let close_window = MenuItemBuilder::with_id(CLOSE_WINDOW, l.close_window)
        .accelerator(ACC_CLOSE_WINDOW)
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, l.file)
        .item(&new_window)
        .separator()
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

    let tour = MenuItemBuilder::with_id(TOUR, l.tour).build(app)?;
    let help_menu = SubmenuBuilder::new(app, l.help).item(&tour).build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
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
///
/// **macOS 에서만 메뉴를 붙인다.** 비-mac 은 아무것도 하지 않는다 — 모듈 머리의
/// 「Windows·Linux 에는 메뉴를 달지 않는다」 참고. 호출처(기동·언어 변경)는 OS 를
/// 가르지 않고 이 함수를 부르면 된다.
pub fn apply<R: Runtime>(app: &AppHandle<R>, lang: &str) -> tauri::Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, lang);
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let (menu, window_menu) = build(app, lang)?;
        app.set_menu(menu)?;
        // 메인 메뉴에 붙인 **뒤에** 지정한다 — 순서가 뒤바뀌면 AppKit 이 아직
        // 메뉴바에 없는 NSMenu 를 창 메뉴로 잡는다.
        // 지정 실패가 앱을 못 뜨게 할 이유는 없다 — 단축키 하나를 잃을 뿐이다.
        if let Err(e) = window_menu.set_as_windows_menu_for_nsapp() {
            tracing::warn!(target: "menu", error = %e, "창 메뉴 지정 실패 — ⌃⌥ 창 분할이 안 먹을 수 있다");
        }
        Ok(())
    }
}

/// 메뉴 이벤트 → 창 커맨드. 메뉴에는 대상 창이 실려 오지 않으므로 여기서
/// **지금 포커스된 창**을 찾는다.
pub fn handle_event(app: &AppHandle, id: &str) {
    use crate::commands::window as win;
    let handle = app.clone();
    match id {
        CLOSE_WINDOW => {
            if let Some(label) = win::focused_app_window(app) {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.close();
                }
            }
        }
        NEW_WINDOW => {
            tauri::async_runtime::spawn(async move {
                let _ = win::new_window_inner(&handle).await;
            });
        }
        TOUR => {
            use tauri_specta::Event;
            if let Some(label) = win::focused_app_window(app) {
                let _ = TourRequested {}.emit_to(app, label.as_str());
            }
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
        // `commands/window/` 는 책임별 파일로 갈라져 있다 — 창을 만들거나
        // 메뉴 언어를 되돌리는 어느 조각에서도 `set_menu` 가 새면 안 된다.
        for (name, src) in [
            ("lib.rs", include_str!("lib.rs")),
            (
                "commands/window/mod.rs",
                include_str!("commands/window/mod.rs"),
            ),
            (
                "commands/window/events.rs",
                include_str!("commands/window/events.rs"),
            ),
            (
                "commands/window/focus.rs",
                include_str!("commands/window/focus.rs"),
            ),
            (
                "commands/window/lifecycle.rs",
                include_str!("commands/window/lifecycle.rs"),
            ),
            (
                "commands/window/registry.rs",
                include_str!("commands/window/registry.rs"),
            ),
            (
                "commands/window/session.rs",
                include_str!("commands/window/session.rs"),
            ),
            (
                "commands/window/projects.rs",
                include_str!("commands/window/projects.rs"),
            ),
            (
                "commands/window/watchers.rs",
                include_str!("commands/window/watchers.rs"),
            ),
        ] {
            assert!(
                !src.contains("set_menu("),
                "{name} 이 set_menu 를 직접 부른다 — menu::apply 를 쓰세요 \
                 (창 메뉴 지정이 빠지면 ⌃⌥ 창 분할 단축키가 죽습니다)"
            );
        }
    }

    /// `#os-no-menu` — Windows·Linux 에서는 기동 때도, 언어를 바꿀 때도 앱
    /// 메뉴가 붙지 않는다. 붙으면 GTK 가 터미널의 `Ctrl+W`·`Ctrl+C` 를 웹뷰보다
    /// 먼저 먹는다. (macOS 는 메뉴 생성이 메인 스레드 전용이라 여기서 만들 수
    /// 없다 — 그쪽은 소스 가드 `set_menu_is_reached_only_through_apply` 가 문다.)
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn no_app_menu_is_attached_off_macos() {
        let app = tauri::test::mock_app();
        for lang in ["ko", "en", "system"] {
            apply(app.handle(), lang).expect("비-mac 의 apply 는 실패하지 않는다");
        }
        assert!(
            app.handle().menu().is_none(),
            "비-mac 에 앱 메뉴가 붙었다 — 터미널 키를 GTK 액셀러레이터가 가로챈다"
        );
    }

    #[test]
    fn language_picks_label_set() {
        assert_eq!(labels("en").close_window, "Close Window");
        assert_eq!(labels("en").tour, "Getting Started");
        assert_eq!(labels("ko").tour, "처음 쓰는 법");
        assert_eq!(labels("en-US").close_window, "Close Window");
        assert_eq!(labels("ko").close_window, "창 닫기");
        // 알 수 없는 값은 한국어로 — 이 앱의 기본 언어다.
        assert_eq!(labels("system").close_window, "창 닫기");
        assert_eq!(labels("").close_window, "창 닫기");
    }

    /// 창 하나 = 프로젝트 하나 (4.0) — ⌘W 는 창을 닫는다. 3.x 의 ⇧⌘W(창 닫기)·
    /// ⌘T(새 탭)는 탭과 함께 걷었다.
    #[test]
    fn cmd_w_closes_the_window() {
        assert_eq!(ACC_CLOSE_WINDOW, "CmdOrCtrl+W");
        assert_eq!(ACC_NEW_WINDOW, "Shift+CmdOrCtrl+N");
    }

    /// 액셀러레이터가 겹치면 어느 항목이 이길지 플랫폼에 맡기게 된다.
    #[test]
    fn accelerators_do_not_collide() {
        let all = [ACC_NEW_WINDOW, ACC_CLOSE_WINDOW];
        let mut sorted = all.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), all.len(), "액셀러레이터 중복: {all:?}");
    }

    /// 메뉴 id 는 프런트와 공유하지 않지만, 서로 충돌하면 조용히 엉뚱한
    /// 동작을 한다 — 접두사로 네임스페이스를 나눠 둔다.
    #[test]
    fn menu_ids_are_namespaced_and_unique() {
        let ids = [NEW_WINDOW, CLOSE_WINDOW];
        for id in ids {
            assert!(id.starts_with("menu:"), "{id} 에 네임스페이스가 없다");
        }
        let mut sorted = ids.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
    }
}

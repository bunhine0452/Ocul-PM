//! 「새 창」 커맨드 — Windows·Linux 의 `Ctrl+Shift+N` (크로스플랫폼 라운드 `#os-new-window`).
//!
//! macOS 는 앱 메뉴의 「새 창」(⇧⌘N)이 이 일을 한다 (`menu.rs` → `new_window_inner`).
//! 비-mac 은 메뉴를 달지 않으므로(`#os-no-menu`) 프런트가 키다운으로 받아 이 커맨드를
//! 부른다 (`useWindowTabKeys`). 창을 만드는 함수는 메뉴와 **같은 것**을 쓴다 — 탭을
//! 붙이지 않고 언제나 시작 탭 하나짜리 새 창이다.

use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn new_window(app: AppHandle) -> Result<(), String> {
    crate::commands::window::new_window_inner(&app).await
}

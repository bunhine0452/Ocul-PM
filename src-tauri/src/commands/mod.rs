pub mod claude_hooks;
pub mod cli_check;
pub mod config;
pub mod current_session;
pub mod diagnostics;
pub mod diff;
pub mod export;
pub mod external_editor;
pub mod git;
pub mod home;
pub mod hotspot;
pub mod index_usage;
pub mod install_kind;
pub mod journal_page;
pub mod journal_search;
pub mod mcp;
pub mod new_window;
pub mod oculpm;
mod open_native;
pub mod plan;
pub mod plan_carry;
pub mod project;
pub mod race;
pub mod related;
pub mod review;
pub mod scorecard;
pub mod tags;
pub mod term_image;
pub mod terminal;
pub mod today;
pub mod velocity;
pub mod window;

pub use claude_hooks::*;
pub use cli_check::*;
pub use config::*;
pub use current_session::*;
pub use diagnostics::*;
pub use diff::*;
pub use export::*;
pub use external_editor::*;
pub use git::*;
pub use home::*;
pub use hotspot::*;
pub use index_usage::*;
pub use install_kind::*;
pub use journal_page::*;
pub use journal_search::*;
pub use mcp::*;
#[allow(unused_imports)] // Re-exported for W1-PR6 commands; stub for now.
pub use oculpm::*;
pub use plan::*;
pub use plan_carry::*;
pub use project::*;
pub use related::*;
pub use review::*;
pub use scorecard::*;
pub use tags::*;
pub use today::*;
pub use velocity::*;
pub use window::*;

/// 동기 호출(git 서브프로세스 · 큰 파일 읽기 · diff 렌더)을 blocking 풀에서 돌린다.
/// 예전엔 `async fn` 안에서 `Command::output()` 을 그대로 불러 워커 스레드가 5~80ms 씩
/// 멈췄다 — `git.rs` 만 감싸고 `diff.rs` 는 그대로였다 (2026-10-09 리포트).
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("blocking task failed: {e}"))?
}

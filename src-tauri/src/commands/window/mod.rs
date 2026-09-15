//! 창·탭 관리 — SSOT: docs/20260811_three-features/01b-chrome-tabs.md.
//!
//! 창 모델 (크롬식 탭): 창은 **탭의 집합**이고, 탭은 두 종류다.
//!
//! - **시작 탭** — 프로젝트 메인 화면(목록·추가·관리). Chrome 의 새 탭 페이지.
//!   여기서 프로젝트를 고르면 **그 자리에서** 프로젝트 탭이 된다.
//! - **프로젝트 탭** — 그 프로젝트의 전체 셸.
//!
//! 불변식:
//! - I1 — 프로젝트당 탭 하나, **전역 유일**. 이미 열려 있으면 그 창을 포커스하고
//!   그 탭을 활성화한다. (덕분에 `OculpmManager` 가 watcher refcount 없이
//!   프로젝트당 엔트리 하나를 유지할 수 있다 — D2)
//! - I3 — **프로젝트** 탭의 프로젝트는 탭의 수명 동안 바뀌지 않는다. 시작 탭이
//!   프로젝트 탭으로 승격하는 것은 한 방향뿐이다.
//!
//! 라벨에서 프로젝트를 읽을 수 없으므로 **이 모듈이 레지스트리를 소유**한다.
//! 프런트는 `WindowTabsChanged` 로 미러링만 한다.
//!
//! 3,028줄짜리 한 파일을 책임별로 갈랐다 (2026-09-15, 800줄 한계). 공개 항목은
//! 전부 여기서 재수출하므로 `crate::commands::window::*` 경로는 그대로다.
//! 이 파일이 소유하는 것은 라벨 규약·창 크기 상수·관리 상태 `WindowTabs` 뿐이다.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_specta::Event;

mod drag;
mod events;
mod focus;
mod lifecycle;
mod registry;
mod session;
mod tabs;
mod terminal_windows;
#[cfg(test)]
mod tests;
mod watchers;

pub use drag::*;
pub use events::*;
pub use focus::*;
pub use lifecycle::*;
pub use registry::*;
pub use session::*;
pub use tabs::*;
pub use terminal_windows::*;
pub use watchers::*;

/// 추가로 만드는 창의 라벨 접두사. `tauri-plugin-window-state` 가 라벨 기준으로
/// 위치·크기를 기억하므로 `win-1`, `win-2` … 는 재실행 사이에도 재사용된다.
pub const WINDOW_PREFIX: &str = "win-";
/// `tauri.conf.json` 이 만드는 첫 창. **특별하지 않다** — 다른 창과 똑같이
/// 탭을 물고, 똑같이 닫힌다 (예전 "런처 전용 창" 개념은 시작 탭이 대체했다).
pub const FIRST_WINDOW: &str = "main";

/// 기본 크기·최소 크기는 `tauri.conf.json` 의 첫 창과 맞춘다.
const WINDOW_W: f64 = 1150.0;
const WINDOW_H: f64 = 780.0;
const WINDOW_MIN_W: f64 = 960.0;
const WINDOW_MIN_H: f64 = 640.0;

/// 분리 터미널 창 — 셸 하나가 편한 크기. 탭 창보다 훨씬 작아도 된다
/// (사이드바도 탭 스트립도 없다).
const TERM_WINDOW_W: f64 = 820.0;
const TERM_WINDOW_H: f64 = 520.0;
const TERM_WINDOW_MIN_W: f64 = 380.0;
const TERM_WINDOW_MIN_H: f64 = 240.0;

pub fn window_label(n: u32) -> String {
    format!("{WINDOW_PREFIX}{n}")
}

/// 탭을 물 수 있는 창인가 — 트레이 팝오버(`tray`)만 제외된다.
pub fn is_app_window(label: &str) -> bool {
    label == FIRST_WINDOW
        || label
            .strip_prefix(WINDOW_PREFIX)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

/// 창 위쪽 어디까지를 "탭 스트립" 으로 볼지 넘어서는 여유 (논리 px).
///
/// 창 테두리 바로 위까지 끌고 갔을 때도 놓을 수 있어야 한다 — 크롬도 스트립
/// 위쪽으로 한 뼘 넘어간 커서를 받아 준다. 아래로는 여유를 주지 않는다:
/// 스트립 밑은 콘텐츠라 거기서 놓이면 "어디에 붙었지?" 가 된다.
pub const STRIP_OVERSHOOT: f64 = 10.0;

/// 창 안쪽 좌표(논리 px)가 탭 스트립 띠 안인가.
///
/// `band` 는 스트립 높이(논리 px)로, 프런트가 자기 CSS 높이 × 웹뷰 줌으로 재서
/// 넘겨준다 — Rust 가 CSS 를 알 필요도, 줌을 추적할 필요도 없다.
pub fn hits_tab_strip(local_x: f64, local_y: f64, width: f64, band: f64) -> bool {
    local_x >= 0.0 && local_x <= width && local_y >= -STRIP_OVERSHOOT && local_y <= band
}

/// PTY 세션 id 접두사. **프로젝트** 기준이라 탭이 창을 옮겨 다녀도 유효하다 —
/// 그래서 떼어낸 탭의 셸이 죽지 않는다. 끝의 `-` 덕분에 `p1-` 이 `p12-…` 를
/// 잡아먹지 않는다. 프런트의 `TerminalSurface.newId` 와 짝이다.
pub fn pty_prefix_for(project_id: u32) -> String {
    format!("p{project_id}-")
}

/// 분리한 **터미널 전용 창**의 라벨 접두사 (2026-08-15 터미널 도크).
///
/// 탭을 물지 않는 창이라 `is_app_window` 가 일부러 false 를 준다 — 탭
/// 레지스트리·⌘W·"마지막 창" 판정이 이 창을 탭 창으로 오해하면 안 된다.
/// 프로젝트당 하나이므로 라벨에 프로젝트 id 를 박는다 (I1 과 같은 규율).
pub const TERM_WINDOW_PREFIX: &str = "term-";

pub fn terminal_window_label(project_id: u32) -> String {
    format!("{TERM_WINDOW_PREFIX}{project_id}")
}

/// 라벨이 터미널 창이면 그 프로젝트 id. 아니면 `None`.
pub fn terminal_window_project(label: &str) -> Option<u32> {
    label.strip_prefix(TERM_WINDOW_PREFIX)?.parse().ok()
}

/// 관리 상태 — 창→탭 레지스트리를 앱 전역 뮤텍스로 감싼 것. `lib.rs` 가
/// `app.manage(WindowTabs::default())` 로 한 번 심는다.
#[derive(Default)]
pub struct WindowTabs(Mutex<Registry>);

impl WindowTabs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

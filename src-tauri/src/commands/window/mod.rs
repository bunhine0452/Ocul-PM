//! 창 관리 — **창 하나 = 프로젝트 하나** (4.0, 2026-10-29).
//!
//! 창은 두 모양 중 하나다.
//!
//! - **시작 창** — 프로젝트가 없다. 최근 프로젝트 · 폴더 열기 · 처음이라면 세 단계.
//!   여기서 프로젝트를 고르면 **그 창이** 그 프로젝트가 된다.
//! - **프로젝트 창** — 프로젝트 하나의 셸.
//!
//! 불변식:
//! - I1 — 프로젝트당 창 하나, **전역 유일**. 이미 열려 있으면 새로 열지 않고 그 창을
//!   앞으로 가져온다. (덕분에 `OculpmManager` 가 watcher refcount 없이 프로젝트당
//!   엔트리 하나를 유지할 수 있다.)
//! - I3 — 프로젝트 창의 프로젝트는 창의 수명 동안 바뀌지 않는다. 시작 창이 프로젝트
//!   창이 되는 것은 한 방향뿐이다 (지운 프로젝트의 창이 시작 창으로 돌아가는 것만 예외).
//!
//! 3.x 의 크롬식 탭(탭 줄 · 떼어내기 · 창 사이 끌기)은 4.0 에서 걷었다 — 하루 3건 쓰는
//! 사람에게 탭 줄은 늘 한 칸짜리 장식이었고, 하루 60건 쓰는 사람은 프로젝트마다 창을
//! 띄워 OS 의 창 전환(⌘`)으로 오갔다.
//!
//! 라벨에서 프로젝트를 읽을 수 없으므로 **이 모듈이 레지스트리를 소유**한다.
//! 프런트는 `WindowProjectChanged` 로 따라 그리기만 한다.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_specta::Event;

mod events;
mod focus;
mod lifecycle;
mod projects;
mod registry;
mod session;
#[cfg(test)]
mod tests;
mod watchers;

pub use events::*;
pub use focus::*;
pub use lifecycle::*;
pub use projects::*;
pub use registry::*;
pub use session::*;
pub use watchers::*;

/// 추가로 만드는 창의 라벨 접두사. `tauri-plugin-window-state` 가 라벨 기준으로
/// 위치·크기를 기억하므로 `win-1`, `win-2` … 는 재실행 사이에도 재사용된다.
pub const WINDOW_PREFIX: &str = "win-";
/// `tauri.conf.json` 이 만드는 첫 창. **특별하지 않다** — 다른 창과 똑같이
/// 시작 창이거나 프로젝트 창이고, 똑같이 닫힌다.
pub const FIRST_WINDOW: &str = "main";

/// 기본 크기·최소 크기는 `tauri.conf.json` 의 첫 창과 맞춘다.
const WINDOW_W: f64 = 1150.0;
const WINDOW_H: f64 = 780.0;
/// 맥북 프로 14(1512pt)의 3분의 1 까지 — 화면 한쪽에 세워 두고 다른 일과 나란히(10-30). 좁은 창의
/// 접힘은 프런트의 640 접힘 선이 맡는다(윗줄 아이콘 · 목록 위 본문 아래).
const WINDOW_MIN_W: f64 = 480.0;
const WINDOW_MIN_H: f64 = 520.0;
/// macOS 신호등 — 셸 윗줄(`--toolbar-h` 44px)의 세로 가운데. `tauri.conf.json` 의
/// `trafficLightPosition` 과 같은 값이다(tao 는 버튼 컨테이너 높이를 `버튼 + y` 로 잡는다).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 16.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y: f64 = 20.0;

pub fn window_label(n: u32) -> String {
    format!("{WINDOW_PREFIX}{n}")
}

/// 프로젝트를 담을 수 있는 앱 창인가 — 첫 창(`main`)과 `win-N` 만 앱 창이다.
pub fn is_app_window(label: &str) -> bool {
    label == FIRST_WINDOW
        || label
            .strip_prefix(WINDOW_PREFIX)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

/// 관리 상태 — 창→프로젝트 레지스트리를 앱 전역 뮤텍스로 감싼 것. `lib.rs` 가
/// `app.manage(WindowProjects::default())` 로 한 번 심는다.
#[derive(Default)]
pub struct WindowProjects(Mutex<Registry>);

impl WindowProjects {
    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

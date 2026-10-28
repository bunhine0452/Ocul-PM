//! 프런트로 나가는 이벤트와 그 발신 helpers.
//!
//! 이벤트 구조체는 `lib.rs` 의 `collect_events!` 가 `commands::window::*` 경로로
//! 집어 가므로 이름·derive 를 바꾸지 않는다. 프런트는 여기 실린 것만 믿는다.

use super::*;

/// 한 창의 프로젝트가 바뀌었다 — 시작 창이 프로젝트를 골랐거나, 업데이트 복원이
/// 첫 창에 프로젝트를 실었거나, 지운 프로젝트의 창이 시작 창으로 돌아갔다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct WindowProjectChanged {
    pub window: String,
    /// `None` = 시작 창.
    pub project_id: Option<u32>,
}

/// 어디든 열린 프로젝트 집합이 바뀌었다 — 시작 창·프로젝트 목록의 「열림」 표시.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ProjectWindowsChanged {
    pub open: Vec<u32>,
}

/// 그 창에 자기 프로젝트를 알리고, 전역 「열림」 집합도 함께 알린다.
pub(super) fn announce(app: &AppHandle, label: &str) {
    let project_id = app
        .state::<WindowProjects>()
        .lock()
        .project_of(label)
        .flatten();
    let _ = WindowProjectChanged {
        window: label.to_string(),
        project_id,
    }
    .emit_to(app, label);
    emit_open_projects(app);
}

pub(super) fn emit_open_projects(app: &AppHandle) {
    let open = app.state::<WindowProjects>().lock().all_open_projects();
    let _ = ProjectWindowsChanged { open }.emit(app);
}

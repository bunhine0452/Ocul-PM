//! 창이 여럿일 때 「어느 창이 나를 기다리나」 (2026-11-02 — 기능 동결의 사용자 예외, `direction-20261102`).
//!
//! 프로젝트 창을 다섯 띄워 두면 Claude 가 어느 창에서 허락을 기다리는지 하나씩 눌러 봐야 알았다.
//! 새 화면은 없다. 이미 있는 자리 셋에 같은 수를 싣는다:
//!
//! - **창 제목** `ai-pm · 기다림 1` — macOS 창 메뉴 · Mission Control · ⌘` 에 보인다.
//! - **Dock 배지** — 모든 창의 기다림 합. 0 이면 지운다.
//! - **⌘O 목록 · ⌥⌘ 번호** — 프런트가 [`project_attention`] 으로 읽어 줄마다 점을 찍고 급한 것을 위로.
//!
//! 「기다림」 = Claude 가 입력 · 허락을 기다리는 세션(Notification 훅) + 앱에 떠 있는 질문(`ask_user`).
//! 「실패」 = 살아 있는 계획의 마지막 확인 명령이 ✗. 둘 다 이미 오늘 화면이 쓰는 원천을 그대로 읽는다.
//! 새로 듣는 것도 없다 — 이미 나가는 이벤트(기다림 · 질문 · 열린 창 집합)를 Rust 쪽에서 한 번 더 듣는다.

use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::oculpm::claude_waiting::{
    pending_questions, ClaudeQuestionsChanged, ClaudeWaitingChanged, ClaudeWaitingState,
    WAITING_STALE_MINUTES,
};

/// 프로젝트 하나의 주의 신호.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ProjectAttention {
    pub project_id: u32,
    /// Claude 가 기다리는 세션 + 답을 기다리는 질문.
    pub waiting: u32,
    /// 살아 있는 계획 중 마지막 확인 명령이 ✗ 인 것이 있다.
    pub failing: bool,
}

/// 주의 신호가 바뀌었을 수 있다 — ⌘O 목록이 다시 읽는다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ProjectAttentionChanged {}

/// 창 제목의 말 — 메뉴와 같은 언어(`apply_menu_language` 가 정한다). 기본은 한국어.
static TITLE_EN: AtomicBool = AtomicBool::new(false);

pub(super) fn set_title_language(lang: &str) {
    TITLE_EN.store(lang.starts_with("en"), Ordering::Relaxed);
}

/// `ai-pm` → `ai-pm · 기다림 2`. 0 이면 이름 그대로.
pub fn titled(name: &str, waiting: u32, en: bool) -> String {
    match (waiting, en) {
        (0, _) => name.to_string(),
        (n, true) => format!("{name} · {n} waiting"),
        (n, false) => format!("{name} · 기다림 {n}"),
    }
}

/// 30분 넘은 기다림은 세지 않는다 — `claude_waiting` 이 지우는 기준과 같다.
fn fresh_waiting(app: &AppHandle, project_id: u32) -> u32 {
    let Some(state) = app.try_state::<ClaudeWaitingState>() else {
        return 0;
    };
    let cutoff = chrono::Utc::now() - chrono::Duration::minutes(WAITING_STALE_MINUTES);
    let Ok(all) = state.0.lock() else { return 0 };
    all.get(&project_id).map_or(0, |table| {
        table
            .values()
            .filter(|w| {
                chrono::DateTime::parse_from_rfc3339(&w.since)
                    .map(|t| t.with_timezone(&chrono::Utc) >= cutoff)
                    .unwrap_or(true)
            })
            .count() as u32
    })
}

async fn attention_of(app: &AppHandle, project_id: u32) -> ProjectAttention {
    let db = app.state::<crate::db::Db>();
    let questions = match db.get_project(project_id).await {
        Ok(p) => pending_questions(std::path::Path::new(&p.root_path)).len() as u32,
        Err(_) => 0,
    };
    let failing = match crate::commands::plan::planner_root_of(&db, project_id).await {
        Ok(root) => {
            use crate::oculpm::planner::{digest, project::PlanCache};
            digest::load_details(&PlanCache::new(&db), project_id, &root)
                .await
                .map(|d| {
                    digest::build(d)
                        .plans
                        .iter()
                        .any(|p| p.last_verdict.as_ref().is_some_and(|v| !v.passed))
                })
                .unwrap_or(false)
        }
        Err(_) => false,
    };
    ProjectAttention {
        project_id,
        waiting: fresh_waiting(app, project_id) + questions,
        failing,
    }
}

/// ⌘O 목록 · ⌥⌘ 번호가 읽는다. 창이 없는 프로젝트는 기다림을 모른다(감시기가 안 돈다) — 0 이다.
#[tauri::command]
#[specta::specta]
pub async fn project_attention(app: AppHandle, project_ids: Vec<u32>) -> Vec<ProjectAttention> {
    let mut out = Vec::with_capacity(project_ids.len());
    for id in project_ids {
        out.push(attention_of(&app, id).await);
    }
    out
}

/// 열린 프로젝트 창의 제목과 Dock 배지를 지금 신호에 맞춘다.
pub async fn refresh_attention(app: &AppHandle) {
    let windows: Vec<(String, u32)> = {
        let state = app.state::<WindowProjects>();
        let reg = state.lock();
        reg.all_open_projects()
            .into_iter()
            .filter_map(|pid| reg.locate_project(pid).map(|label| (label, pid)))
            .collect()
    };
    let en = TITLE_EN.load(Ordering::Relaxed);
    let mut total: i64 = 0;
    for (label, pid) in &windows {
        let att = attention_of(app, *pid).await;
        total += i64::from(att.waiting);
        if let Some(win) = app.get_webview_window(label) {
            let name = lifecycle::window_title(app, Some(*pid)).await;
            let _ = win.set_title(&titled(&name, att.waiting, en));
        }
    }
    // macOS 는 Dock 배지가 앱 하나에 하나다 — 어느 창에 걸어도 같다. 리눅스는 창마다, Windows 는 무시.
    let badge = (total > 0).then_some(total);
    for label in app.webview_windows().keys() {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_badge_count(badge);
        }
    }
    let _ = ProjectAttentionChanged {}.emit(app);
}

/// 이미 나가는 이벤트 셋을 듣는다 — 내는 쪽은 고치지 않는다.
pub fn watch_attention(app: &AppHandle) {
    let kick = |app: AppHandle| {
        move || {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { refresh_attention(&app).await });
        }
    };
    let a = kick(app.clone());
    ClaudeWaitingChanged::listen_any(app, move |_| a());
    let b = kick(app.clone());
    ClaudeQuestionsChanged::listen_any(app, move |_| b());
    let c = kick(app.clone());
    ProjectWindowsChanged::listen_any(app, move |_| c());
}

#[cfg(test)]
mod tests {
    use super::titled;

    #[test]
    fn title_carries_the_count_only_when_waiting() {
        assert_eq!(titled("ai-pm", 0, false), "ai-pm");
        assert_eq!(titled("ai-pm", 2, false), "ai-pm · 기다림 2");
        assert_eq!(titled("ai-pm", 1, true), "ai-pm · 1 waiting");
    }
}

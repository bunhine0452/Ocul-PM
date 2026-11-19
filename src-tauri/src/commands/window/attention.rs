//! 창이 여럿일 때 「어느 창이 나를 기다리나」 (2026-11-02 — 기능 동결의 사용자 예외, `direction-20261102`).
//!
//! 프로젝트 창을 다섯 띄워 두면 Claude 가 어느 창에서 허락을 기다리는지 하나씩 눌러 봐야 알았다.
//! 새 화면은 없다. 이미 있는 자리 셋에 같은 수를 싣는다:
//!
//! - **창 제목** `ai-pm · 기다림 1` — macOS 창 메뉴 · Mission Control · ⌘` 에 보인다.
//! - **Dock 배지** — 모든 창의 기다림 합. 0 이면 지운다.
//! - **⌘O 목록 · ⌥⌘ 번호** — 프런트가 [`project_attention`] 으로 읽어 줄마다 점을 찍고 급한 것을 위로.
//!
//! 「기다림」 = Claude 가 입력 · 허락을 기다리는 세션(Notification 훅, 또는 앱 안 터미널의 OSC 7501
//! blocked) + 앱에 떠 있는 질문(`ask_user`). 「실패」 = 살아 있는 계획의 마지막 확인 명령이 ✗. 둘 다 이미
//! 오늘 화면이 쓰는 원천을 그대로 읽는다. 새로 듣는 것도 없다 — 이미 나가는 이벤트(기다림 · 질문 · 열린 창
//! 집합 · 터미널 세션)를 Rust 쪽에서 한 번 더 듣는다.

use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::commands::terminal::TermSessionsChanged;
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
fn fresh_waiting<R: tauri::Runtime>(app: &AppHandle<R>, project_id: u32) -> u32 {
    let Some(state) = app.try_state::<ClaudeWaitingState>() else {
        return 0;
    };
    let cutoff =
        crate::clock::now() - crate::clock::SignedDuration::from_mins(WAITING_STALE_MINUTES);
    let Ok(all) = state.0.lock() else { return 0 };
    all.get(&project_id).map_or(0, |table| {
        table
            .values()
            .filter(|w| {
                crate::clock::parse_rfc3339(&w.since)
                    .map(|t| t >= cutoff)
                    .unwrap_or(true)
            })
            .count() as u32
    })
}

/// 앱 안 터미널에서 내 손을 기다리는 세션(OSC 7501 blocked) — 플러그인 훅이 없거나 아직 안 알린 기다림.
fn in_app_waiting<R: tauri::Runtime>(app: &AppHandle<R>, project_id: u32) -> u32 {
    app.try_state::<crate::terminal::TermSessions>()
        .map_or(0, |t| t.waiting_in(project_id))
}

async fn attention_of<R: tauri::Runtime>(app: &AppHandle<R>, project_id: u32) -> ProjectAttention {
    let (questions, failing) = match app.try_state::<crate::db::Db>() {
        Some(db) => (
            questions_of(&db, project_id).await,
            failing_of(&db, project_id).await,
        ),
        None => (0, false),
    };
    // 훅은 앱 안 터미널의 claude 도 적는다 — 둘을 더하면 같은 기다림을 두 번 센다. 오늘 화면과 같은 규칙으로
    // 하나만 쓴다(`features/today/todayModel.ts` 의 buildExceptions): 앱 안 기다림이 있으면 그 셈, 없으면 훅의
    // 셈. 예전의 큰 쪽 셈은 바깥 둘 · 앱 안 하나에서 배지 2 · 오늘 1줄로 갈렸다.
    let in_app = in_app_waiting(app, project_id);
    let sessions = if in_app > 0 {
        in_app
    } else {
        fresh_waiting(app, project_id)
    };
    ProjectAttention {
        project_id,
        waiting: sessions + questions,
        failing,
    }
}

async fn questions_of(db: &crate::db::Db, project_id: u32) -> u32 {
    match db.get_project(project_id).await {
        Ok(p) => pending_questions(std::path::Path::new(&p.root_path)).len() as u32,
        Err(_) => 0,
    }
}

async fn failing_of(db: &crate::db::Db, project_id: u32) -> bool {
    let Ok(root) = crate::commands::plan::planner_root_of(db, project_id).await else {
        return false;
    };
    use crate::oculpm::planner::{digest, project::PlanCache};
    digest::load_details(&PlanCache::new(db), project_id, &root)
        .await
        .map(|d| {
            digest::build(d)
                .plans
                .iter()
                .any(|p| p.last_verdict.as_ref().is_some_and(|v| !v.passed))
        })
        .unwrap_or(false)
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

/// 터미널 세션 사건은 상태 · 제목 · 끝마다 몰려 온다 — 다시 세기는 이 간격에 한 번(창 제목 · Dock 배지).
const TERM_COALESCE: std::time::Duration = std::time::Duration::from_millis(250);
static TERM_REFRESH_PENDING: AtomicBool = AtomicBool::new(false);

/// 그 프로젝트의 앱 안 기다림 수가 지난번과 다른가 — 이번 수를 기억해 둔다. 제목 · 종 · 열고 닫기는 그 수를
/// 바꾸지 못하는데도 터미널 사건으로 온다(oh-my-zsh 는 명령마다 제목을 바꾼다). 다시 세기는 열린 창마다 DB ·
/// 질문 파일 · 계획 digest 를 다시 읽고 ⌘O 목록도 다시 묻게 하니, 수가 그대로면 건너뛴다.
fn waiting_moved(
    seen: &std::sync::Mutex<std::collections::HashMap<u32, u32>>,
    project_id: u32,
    now: u32,
) -> bool {
    seen.lock()
        .map(|mut s| s.insert(project_id, now) != Some(now))
        .unwrap_or(true)
}

/// 이미 나가는 이벤트 넷을 듣는다 — 내는 쪽은 고치지 않는다.
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
    let d = app.clone();
    let seen = std::sync::Mutex::default();
    TermSessionsChanged::listen_any(app, move |event| {
        let pid = event.payload.project_id;
        if !waiting_moved(&seen, pid, in_app_waiting(&d, pid))
            || TERM_REFRESH_PENDING.swap(true, Ordering::SeqCst)
        {
            return;
        }
        let app = d.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(TERM_COALESCE).await;
            TERM_REFRESH_PENDING.store(false, Ordering::SeqCst);
            refresh_attention(&app).await;
        });
    });
}

#[cfg(test)]
mod tests {
    use super::{titled, waiting_moved};

    #[test]
    fn title_carries_the_count_only_when_waiting() {
        assert_eq!(titled("ai-pm", 0, false), "ai-pm");
        assert_eq!(titled("ai-pm", 2, false), "ai-pm · 기다림 2");
        assert_eq!(titled("ai-pm", 1, true), "ai-pm · 1 waiting");
    }

    /// 제목만 바뀐 터미널 사건은 다시 세지 않는다 — 앱 안 기다림 수가 움직일 때만(프로젝트마다 따로).
    #[test]
    fn only_a_moved_in_app_count_asks_for_a_recount() {
        let seen = std::sync::Mutex::default();
        assert!(waiting_moved(&seen, 1, 0), "처음 보는 프로젝트는 센다");
        assert!(!waiting_moved(&seen, 1, 0), "수가 그대로인 사건(제목 · 종)");
        assert!(waiting_moved(&seen, 1, 1));
        assert!(waiting_moved(&seen, 2, 1), "다른 프로젝트");
        assert!(waiting_moved(&seen, 1, 0), "기다림이 풀렸다");
    }

    /// 앱 안 터미널의 claude 가 내 손을 기다리면 창 제목 · Dock 배지 · ⌘O 목록의 기다림이 선다 — 훅 셈과는
    /// 오늘 화면과 같은 규칙(앱 안 기다림이 있으면 그 셈만)으로, 같은 claude 를 두 번 세지 않는다.
    #[cfg(unix)]
    #[test]
    fn a_blocked_in_app_session_counts_as_waiting() {
        use crate::oculpm::claude_waiting::{ClaudeWaiting, ClaudeWaitingState};
        use tauri::Manager;
        let app = tauri::test::mock_app();
        let sessions = crate::terminal::TermSessions::default();
        app.manage(sessions.clone());
        let hooks = ClaudeWaitingState::default();
        app.manage(hooks.clone());
        let attention =
            |pid| tauri::async_runtime::block_on(super::attention_of(app.handle(), pid)).waiting;
        assert_eq!(attention(7), 0);
        let since = crate::clock::rfc3339(crate::clock::now());
        let outside = ["a", "b"].map(|id| {
            let w = ClaudeWaiting {
                session_id: id.into(),
                kind: "idle".into(),
                message: None,
                since: since.clone(),
            };
            (id.to_string(), w)
        });
        hooks
            .0
            .lock()
            .unwrap()
            .insert(7, outside.into_iter().collect());
        assert_eq!(attention(7), 2, "바깥 터미널의 기다림 둘(훅)");
        crate::terminal::tests::start_blocked(&sessions, "proj-7", 7);
        assert_eq!(
            attention(7),
            1,
            "앱 안 기다림이 서면 그 셈만 — 오늘 화면의 줄 수와 같다"
        );
        assert_eq!(attention(8), 0, "다른 프로젝트의 기다림은 세지 않는다");
        sessions.close_all();
    }
}

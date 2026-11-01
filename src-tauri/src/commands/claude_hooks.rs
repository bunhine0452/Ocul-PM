//! PR-CI0 — Claude Code 훅 연동 커맨드 (docs/claude-integration/00-master-plan.md D2).
//!
//! Today·시작 창이 읽는 훅 신호 커맨드. 실제 로직은
//! `oculpm::claude_hooks` 소유 — 여기는 project_id → 루트 해석과 에러 문자열
//! 변환만 한다 (commands 는 얇게, CLAUDE.md 규약).

use tauri::State;

use crate::db::Db;
use crate::oculpm::claude_hooks::{self, JournalMissingSignal};
use crate::oculpm::claude_waiting as waiting;

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(project.root_path))
}

/// H3b — 플러그인 SessionEnd 훅이 남긴 "일지 없이 끝난 세션" 신호를 최근
/// `days`일 범위로 반환한다 (읽기 전용, 최신 우선). 신호 파일이 없으면 빈
/// 배열 — 플러그인 미설치 프로젝트에서 에러 경로를 만들지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn journal_missing_signals(
    db: State<'_, Db>,
    project_id: u32,
    days: u32,
) -> Result<Vec<JournalMissingSignal>, String> {
    let root = project_root(&db, project_id).await?;
    Ok(claude_hooks::journal_missing_signals(&root, days))
}

/// 이 프로젝트에서 Claude 가 사람을 기다리는 세션들 (플러그인 Notification 훅, #notify-hook).
/// [`waiting::WAITING_STALE_MINUTES`] 보다 오래된 것은 지우고 돌려준다.
#[tauri::command]
#[specta::specta]
pub fn claude_waiting(
    state: State<'_, waiting::ClaudeWaitingState>,
    project_id: u32,
) -> Vec<waiting::ClaudeWaiting> {
    let cutoff = chrono::Utc::now() - chrono::Duration::minutes(waiting::WAITING_STALE_MINUTES);
    let Ok(mut all) = state.0.lock() else {
        return Vec::new();
    };
    let Some(table) = all.get_mut(&project_id) else {
        return Vec::new();
    };
    table.retain(|_, w| {
        chrono::DateTime::parse_from_rfc3339(&w.since)
            .map(|t| t.with_timezone(&chrono::Utc) >= cutoff)
            .unwrap_or(true)
    });
    let mut out: Vec<_> = table.values().cloned().collect();
    out.sort_by(|a, b| b.since.cmp(&a.since));
    out
}

/// 「알았어요」 — 그 기다림을 지운다(바깥 터미널이라 앱 안에서 갈 곳이 없다). 모든 창이 다시 읽는다.
#[tauri::command]
#[specta::specta]
pub fn claude_waiting_dismiss(
    app: tauri::AppHandle,
    state: State<'_, waiting::ClaudeWaitingState>,
    project_id: u32,
    session_id: String,
) {
    let removed = state
        .0
        .lock()
        .ok()
        .and_then(|mut all| {
            all.get_mut(&project_id)
                .map(|t| t.remove(&session_id).is_some())
        })
        .unwrap_or(false);
    if removed {
        use tauri_specta::Event;
        let _ = waiting::ClaudeWaitingChanged { project_id }.emit(&app);
    }
}

/// 앱에 떠 있는 Claude 의 질문들 (MCP `ask_user`, #ask-user) — 오래된 것부터.
#[tauri::command]
#[specta::specta]
pub async fn claude_questions(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<waiting::ClaudeQuestion>, String> {
    let root = project_root(&db, project_id).await?;
    Ok(waiting::pending_questions(&root))
}

/// 사람이 앱에서 답했다 — 기다리던 `ask_user` 가 그 답을 Claude 에게 돌려준다. 모든 창이 다시 읽는다.
#[tauri::command]
#[specta::specta]
pub async fn claude_question_answer(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    id: String,
    answer: String,
) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    waiting::write_answer(&root, &id, &answer)?;
    use tauri_specta::Event;
    let _ = waiting::ClaudeQuestionsChanged { project_id }.emit(&app);
    Ok(())
}

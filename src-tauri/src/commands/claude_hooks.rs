//! PR-CI0 — Claude Code 훅 연동 커맨드 (docs/claude-integration/00-master-plan.md D2).
//!
//! 설정 → 에이전트 탭의 옵인 토글이 이 3개 커맨드를 부른다. 실제 로직은
//! `oculpm::claude_hooks` 소유 — 여기는 project_id → 루트 해석과 에러 문자열
//! 변환만 한다 (commands 는 얇게, CLAUDE.md 규약).

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::claude_hooks::{self, ClaudeHooksStatus, JournalMissingSignal};
use crate::oculpm::first_record::{self, FirstRecordLedger};
use crate::oculpm::resume::{self, ResumeDigest};

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(project.root_path))
}

/// 현재 설치 상태 조회 (쓰기 없음).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::status(&root).map_err(|e| e.to_string())
}

/// 훅 설치 (멱등 — 드리프트 복구도 이걸 다시 부르면 된다).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_install(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::install(&root).map_err(|e| e.to_string())
}

/// 훅 제거 (우리 서명 엔트리만 — 사용자 훅·인박스 파일은 보존).
#[tauri::command]
#[specta::specta]
pub async fn claude_hooks_uninstall(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ClaudeHooksStatus, String> {
    let root = project_root(&db, project_id).await?;
    claude_hooks::uninstall(&root).map_err(|e| e.to_string())
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

/// 첫 기록 원장 — 창 안(`days`, 1~30)의 대화별 첫 일지 귀속
/// (플랜 `first-record-loop` {#p1-ledger}). Today 「첫 기록」 카드가 읽는다.
///
/// 일지 행은 캐시(037 `agent_session`)에서, 마커·세션·신호는 디스크에서.
/// 워크데이 하한은 UTC 기준에 하루를 더 물러 잡는다 — 프로젝트 tz 의 워크데이
/// 경계와 어긋나도 창이 **넓어질** 뿐 좁아지지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn first_record_ledger(
    db: State<'_, Db>,
    project_id: u32,
    days: u32,
) -> Result<FirstRecordLedger, AppError> {
    let days = days.clamp(1, 30);
    let project = db.get_project(project_id).await?;
    let root = std::path::PathBuf::from(project.root_path);
    let now = chrono::Utc::now();
    let since = (now - chrono::Duration::days(i64::from(days) + 1))
        .format("%Y%m%d")
        .to_string();
    let journals = JournalCache::new(&db)
        .entries_since_workday(project_id, &since, 500)
        .await?;
    Ok(first_record::assemble(&first_record::collect(
        &root, journals, days, now,
    )))
}

/// 이어하기 자료 — 마지막 일지·활성 계획의 다음 항목·전달 원장
/// (플랜 `first-record-loop` Phase 2). 디스크만 읽는다; 훅과 같은 선택 규칙.
#[tauri::command]
#[specta::specta]
pub async fn resume_digest(db: State<'_, Db>, project_id: u32) -> Result<ResumeDigest, AppError> {
    let project = db.get_project(project_id).await?;
    let root = std::path::PathBuf::from(project.root_path);
    Ok(resume::digest(&root, chrono::Utc::now(), 30))
}

/// 「이 맥락으로 이어서 작업」의 산출물 — 플래너 ▶실행(`DispatchPrompt`)과 같은 모양.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ResumeDispatch {
    /// `.oculpm/index/dispatch/resume.md` (앱 관리·gitignore 영역).
    pub file_rel: String,
    /// 셸 프롬프트에 프리필할 한 줄 (`claude "$(cat '…')"`). 실행(Enter)은 사용자가.
    pub command: String,
    /// 프롬프트 본문 — 돌고 있는 에이전트가 있으면 이걸 붙여넣는다.
    pub prompt: String,
}

/// 이어하기 디스패치 (first-record-loop P2-3) — 이어하기 자료를 프롬프트로 만들어
/// 디스패치 폴더에 쓰고 터미널 프리필용 명령을 돌려준다. 플래너 ▶실행과 같은
/// 핸드오프(`dispatchTarget`)를 타므로 화면이 바뀌고 무슨 일이 일어났는지 토스트가
/// 말한다 — 그전의 「빠른 터미널 열기」는 화면 아래에서 조용히 열려 아무것도
/// 바뀌지 않은 것처럼 보였다 (2026-09-22 사용자 지적).
#[tauri::command]
#[specta::specta]
pub async fn resume_dispatch_prompt(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ResumeDispatch, AppError> {
    let project = db.get_project(project_id).await?;
    let root = std::path::PathBuf::from(project.root_path);
    let digest = resume::digest(&root, chrono::Utc::now(), 30);
    if digest.last_journals.is_empty() && digest.next_items.is_empty() {
        return Err(AppError::from("이어갈 일지도 계획 항목도 없습니다"));
    }
    let lang = crate::oculpm::content_lang::current(&db).await;
    let prompt = resume::render_prompt(&digest, lang);

    let dispatch_dir = root.join(".oculpm").join("index").join("dispatch");
    std::fs::create_dir_all(&dispatch_dir)?;
    let abs = dispatch_dir.join("resume.md");
    crate::oculpm::atomic_io::write_atomic(&abs, prompt.as_bytes())
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(ResumeDispatch {
        file_rel: ".oculpm/index/dispatch/resume.md".to_string(),
        command: crate::oculpm::planner::dispatch::shell_command_for(&abs),
        prompt,
    })
}

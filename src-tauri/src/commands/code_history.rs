//! 로컬 히스토리 커맨드 (docs/20260902_vscode-borrows/06-local-history.md).
//!
//! 저장 모델과 보존 정책은 전부 [`crate::oculpm::history`] 에 있다 — 여기는
//! 경로 가드(`secure_join` → `canonical_within_root`)를 지나 그 모듈을 부르는
//! 얇은 층이다. 되돌리기도 `code_write` 와 **같은 낙관적 잠금**을 통과한다:
//! 판을 되살리는 것이 남의 최신 작업을 조용히 덮는 창구가 되면 안 된다.

use serde::Serialize;
use tauri::State;

use crate::commands::code::{
    canonical_within_root, normalize_rel, project_root, write_with_lock, CodeWriteOutcome,
};
use crate::commands::project::secure_join;
use crate::db::Db;
use crate::oculpm::history::{self, HistoryEntry, HistoryOp, HistorySource, HistoryState};

/// 프런트로 건너가는 판 하나.
///
/// `ts` 가 **십진 문자열**인 이유: specta 는 i64 를 그대로 못 내보내고(정밀도
/// 손실), f64 로 우회하면 TS 에 `number | null` 로 샌다. epoch ms 는 되돌려
/// 받아야 하는 **신원 값**이라 옵셔널이 되면 안 된다 — 그래서 경계에서만
/// 문자열이다 (docs/2026521/Errors/2026-05-21-specta-bigint-export.md 의
/// 체크리스트가 정확히 이 선택지를 적어 뒀다). 디스크의 `meta.json` 은 계속
/// 숫자다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeHistoryVersion {
    pub ts: String,
    /// blake3 hex (접두어 없음).
    pub hash: String,
    pub bytes: u32,
    pub source: HistorySource,
    pub op: HistoryOp,
}

impl From<HistoryEntry> for CodeHistoryVersion {
    fn from(e: HistoryEntry) -> Self {
        Self {
            ts: e.ts_ms.to_string(),
            hash: e.hash,
            bytes: e.bytes,
            source: e.source,
            op: e.op,
        }
    }
}

/// `ts` 문자열을 판의 신원으로 되돌린다.
fn parse_ts(ts: &str) -> Result<i64, String> {
    ts.parse::<i64>()
        .map_err(|_| "Invalid version id".to_string())
}

/// 이 파일의 판 목록 (최신순). 히스토리가 없으면 빈 배열 — 오류가 아니다.
#[tauri::command]
#[specta::specta]
pub async fn code_history_list(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<Vec<CodeHistoryVersion>, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        history::list(&root, &rel)
            .into_iter()
            .map(CodeHistoryVersion::from)
            .collect()
    })
    .await
    .map_err(|e| format!("Failed to read local history: {e}"))
}

/// 그 판의 내용. 정리돼 사라졌으면 오류다 — 빈 문자열로 접으면 "그 판이
/// 비어 있었다" 와 구별되지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn code_history_read(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    ts: String,
) -> Result<String, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let ts_ms = parse_ts(&ts)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = history::read_snapshot(&root, &rel, ts_ms)
            .ok_or_else(|| "That version has been cleaned up".to_string())?;
        String::from_utf8(bytes).map_err(|_| "That version is not text".to_string())
    })
    .await
    .map_err(|e| format!("Failed to read local history: {e}"))?
}

/// 그 판의 내용을 지금 파일에 쓴다. `base_hash` 는 프런트가 마지막으로 읽은
/// 디스크 해시 — 어긋나면 `Conflict` 를 돌려주고 아무것도 쓰지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn code_history_restore(
    db: State<'_, Db>,
    hist: State<'_, HistoryState>,
    project_id: u32,
    rel_path: String,
    ts: String,
    base_hash: String,
) -> Result<CodeWriteOutcome, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    let ts_ms = parse_ts(&ts)?;
    let root_for_task = root.clone();
    let rel_for_task = rel.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root_for_task, &full)?;
        let bytes = history::read_snapshot(&root_for_task, &rel_for_task, ts_ms)
            .ok_or_else(|| "That version has been cleaned up".to_string())?;
        let text = String::from_utf8(bytes).map_err(|_| "That version is not text".to_string())?;
        write_with_lock(&full, &text, &base_hash)
    })
    .await
    .map_err(|e| format!("Failed to restore: {e}"))??;

    // 되돌리기는 **사람의 저장**이다 — 워처가 곧 집을 그 이벤트를 에이전트
    // 쓰기로 오해하지 않게 쪽지를 남긴다 (code_write 와 같은 다리).
    if let CodeWriteOutcome::Saved { hash } = &outcome {
        hist.note_self_write(project_id, &rel, hash);
    }
    Ok(outcome)
}

/// 이 파일의 판 전부 삭제 (사용자 요청 · 민감 파일).
#[tauri::command]
#[specta::specta]
pub async fn code_history_forget(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    tauri::async_runtime::spawn_blocking(move || history::forget(&root, &rel))
        .await
        .map_err(|e| format!("Failed to clear local history: {e}"))?
        .map_err(|e| format!("Failed to clear local history: {e}"))
}

/// 지금 쓰는 용량 (바이트). 설정 화면이 자기 크기를 보여 주기 위한 것 —
/// 보이지 않는 곳에서 디스크를 먹는 기능은 반드시 자기 크기를 밝혀야 한다.
#[tauri::command]
#[specta::specta]
pub async fn code_history_usage(db: State<'_, Db>, project_id: u32) -> Result<u32, String> {
    let root = project_root(&db, project_id).await?;
    // u32 상한(4GB)은 프로젝트 예산(512MB)의 여덟 배다 — 넘칠 수 없고, 넘어도
    // 화면에는 "4GB 이상" 이 맞는 답이다.
    tauri::async_runtime::spawn_blocking(move || {
        u32::try_from(history::usage_bytes(&root)).unwrap_or(u32::MAX)
    })
    .await
    .map_err(|e| format!("Failed to measure local history: {e}"))
}

/// 프로젝트의 판 전부 삭제 (설정 화면의 "전부 지우기").
#[tauri::command]
#[specta::specta]
pub async fn code_history_clear(db: State<'_, Db>, project_id: u32) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || history::clear_all(&root))
        .await
        .map_err(|e| format!("Failed to clear local history: {e}"))?
        .map_err(|e| format!("Failed to clear local history: {e}"))
}

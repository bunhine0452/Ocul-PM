//! journal-scale-round `{#review-queue}` — bulk journal-entry verification.
//!
//! Separate file (not `commands/oculpm.rs`) because that file is already at
//! its file-size ratchet ceiling (`scripts/check-file-sizes.mjs`) — a new
//! command there would fail the gate. Thin orchestration only: the write
//! path itself lives in `OculpmManager::set_journal_verified_bulk`, which
//! reuses `set_journal_verified` per path unchanged.

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::BulkVerifyReport;

/// Verify (or un-verify) several journal entries in one round-trip, e.g.
/// "보이는 것 전부 확인" on the 일지 화면's ReviewQueueBar. Reuses
/// [`OculpmManager::set_journal_verified`] per path unchanged (same write
/// guard, same content-hash binding); one bad path is reported in `skipped`
/// instead of aborting the batch.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_journal_verified_bulk(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    paths: Vec<String>,
    verified: bool,
) -> Result<BulkVerifyReport, AppError> {
    Ok(manager
        .set_journal_verified_bulk(&db, project_id, paths, verified)
        .await?)
}

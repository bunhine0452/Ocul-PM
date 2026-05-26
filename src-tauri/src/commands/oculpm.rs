//! Tauri commands for the `.oculpm/` subsystem.
//!
//! The thin layer here only:
//! - resolves project root via the existing `Db::get_project`,
//! - delegates to `OculpmManager`, and
//! - flattens any `OculpmError` into a `String` for the wire boundary.
//!
//! W1 provides 4 commands (init / get_status / get_config / set_config).
//! W2-PR6 adds 9 more (session / file_change / snapshot / watcher).

use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::db::Db;
use crate::oculpm::agents::AgentDetection;
use crate::oculpm::cache::EntryFilters;
use crate::oculpm::error::OculpmError;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::{
    AgentSyncReport, Difficulty, EntryStatus, FileChangeEvent, IntegrityWarning, JournalEntry,
    JournalEntrySummary, LayerComparison, ManualEntryDraft, OculpmConfig, OculpmInitReport,
    OculpmIntegrityWarning, OculpmStatus, ReindexReport, Session, Snapshot, SnapshotKind,
    WatcherStatus,
};

// ─── W1 commands ────────────────────────────────────────────────────────────

/// Idempotent project initialisation — creates `.oculpm/`, writes default
/// config, acquires the lock, and patches `.gitignore`. Returns a report of
/// what changed so the UI can surface "added 5 lines to .gitignore" etc.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_init(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmInitReport, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);
    manager
        .init_project(project_id, &root)
        .await
        .map_err(|e| e.to_string())
}

/// Current `.oculpm/` status (initialised, lock, current workday, watcher).
/// Safe to call before init — returns a default uninitialised view.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_status(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmStatus, String> {
    Ok(manager.get_status(project_id).await)
}

/// Read the validated in-memory `OculpmConfig`. Errors if `oculpm_init` has
/// not been called for this project.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmConfig, String> {
    manager
        .get_config(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Validate + persist a new `OculpmConfig` (atomic write) and refresh the
/// in-memory `WorkdayResolver`. Rejects invalid tz / HH:MM without touching
/// disk.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    new_config: OculpmConfig,
) -> Result<(), String> {
    manager
        .set_config(project_id, new_config)
        .await
        .map_err(|e| e.to_string())
}

// ─── W2-PR6 commands ────────────────────────────────────────────────────────

/// Get the current active session. Returns `None` if idle or no watcher.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_current_session(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Option<Session>, String> {
    manager
        .get_current_session(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Manually start a session. Idempotent — returns existing if already active.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_start_session_manual(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Option<Session>, String> {
    manager
        .start_session_manual(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Manually end a session. `session_id` must match the active session.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_end_session_manual(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    session_id: String,
) -> Result<(), String> {
    manager
        .end_session_manual(project_id, session_id)
        .await
        .map_err(|e| e.to_string())
}

/// List sessions for a workday. `workday = None` → today.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_list_sessions(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: Option<String>,
) -> Result<Vec<Session>, String> {
    manager
        .list_sessions(project_id, workday)
        .await
        .map_err(|e| e.to_string())
}

/// Get file change events for a workday, optionally filtered by session_id.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_file_changes(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: String,
    session_id: Option<String>,
) -> Result<Vec<FileChangeEvent>, String> {
    manager
        .get_file_changes(project_id, workday, session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Read a snapshot (open or close) for a workday.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_index_snapshot(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: String,
    kind: SnapshotKind,
) -> Result<Snapshot, String> {
    manager
        .get_index_snapshot(project_id, workday, kind)
        .await
        .map_err(|e| e.to_string())
}

/// Start the filesystem watcher. Idempotent. Requires lock ownership.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_watcher_start(
    app_handle: tauri::AppHandle,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<(), String> {
    manager
        .watcher_start(project_id, Some(app_handle))
        .await
        .map_err(|e| e.to_string())
}

/// Stop the filesystem watcher. Idempotent.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_watcher_stop(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<(), String> {
    manager
        .watcher_stop(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Watcher status. Safe to call anytime — returns Stopped + zero counters if
/// the project is not initialized or the watcher hasn't started.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_watcher_status(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<WatcherStatus, String> {
    Ok(manager.watcher_status(project_id).await)
}

// ─── W3-PR3 commands ────────────────────────────────────────────────────────

/// List cached journal entries for a workday (or today if None) with filters.
/// Returns `[]` for uninitialised projects so the UI can render EmptyToday
/// without a special-case error path.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_list_journal_entries(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: Option<String>,
    filters: Option<EntryFilters>,
) -> Result<Vec<JournalEntrySummary>, String> {
    let filters = filters.unwrap_or_default();
    manager
        .list_journal_entries(&db, project_id, workday, filters)
        .await
        .map_err(|e| e.to_string())
}

/// Get a single journal entry by relative path. Falls back to on-demand
/// disk read + cache upsert if the row is missing. Returns `None` only
/// when the file does not exist on disk either.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_journal_entry(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
) -> Result<Option<JournalEntry>, String> {
    manager
        .get_journal_entry(&db, project_id, relative_path)
        .await
        .map_err(|e| e.to_string())
}

/// Toggle `verified_by_user` on a journal entry's frontmatter. Atomic
/// write-through: file is rewritten first, then the cache is upserted in
/// the same call so the UI sees the change immediately.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_journal_verified(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
    verified: bool,
) -> Result<(), String> {
    manager
        .set_journal_verified(&db, project_id, relative_path, verified)
        .await
        .map_err(|e| e.to_string())
}

/// Rebuild the journal cache from disk. Drops every cached row for the
/// project and re-walks `.oculpm/journal/`. Use after manual sqlite
/// tampering or schema migration.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_reindex_cache(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<ReindexReport, String> {
    manager
        .reindex_journal_cache(&db, project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Inline-edit one or both of `difficulty` / `status` on an existing entry.
/// Same write-through semantics as `oculpm_set_journal_verified` — atomic
/// file write then cache upsert — and returns the hydrated entry so the
/// frontend's optimistic UI can resync to truth without a second fetch.
///
/// Argument shape: send `null` for a field to leave it unchanged. To clear
/// `difficulty`, send `Some(None)` (encoded over the wire as the JSON
/// `null` *inside* a present object key); the frontend wrapper handles
/// this distinction.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_update_entry_meta(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
    difficulty_change: Option<DifficultyChange>,
    status: Option<EntryStatus>,
) -> Result<JournalEntry, String> {
    manager
        .update_journal_entry_meta(
            &db,
            project_id,
            relative_path,
            difficulty_change.map(|c| c.value),
            status,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Wire wrapper so the frontend can express "set difficulty to None" vs
/// "leave difficulty alone". Two-step Option unfolds to:
///   - omitted / null → `None` (leave alone)
///   - `{ value: null }` → `Some(None)` (clear)
///   - `{ value: "high" }` → `Some(Some(High))` (set)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct DifficultyChange {
    pub value: Option<Difficulty>,
}

/// Write a manual journal entry from the user-authored draft. Validates
/// the slug (kebab-case ASCII, 1..=60 chars), resolves the session_id
/// (active session / draft override / sentinel), writes the file with
/// the spec's `<HHMM>_<type>_<slug>.md` naming, and returns the hydrated
/// `JournalEntry`. On filename collision the writer suffixes `__2`/`__3`.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_create_manual_entry(
    app: AppHandle,
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    draft: ManualEntryDraft,
) -> Result<JournalEntry, String> {
    match manager
        .create_manual_journal_entry(&db, project_id, draft)
        .await
    {
        Ok(entry) => Ok(entry),
        // W4-PR3 — surface forbidden-path rejection to the UI as an
        // IntegrityWarning event AND a regular error. The toast lives long
        // enough for the user to read which files tripped the matcher;
        // returning the error keeps the modal in the "still editing" state.
        Err(OculpmError::ForbiddenJournalPath { paths }) => {
            let message = format!(
                "{} 개 경로가 forbid_journal_for_paths 와 매치되어 작성이 거부됨: {}",
                paths.len(),
                paths.join(", ")
            );
            let _ = OculpmIntegrityWarning {
                project_id,
                warning: IntegrityWarning {
                    kind: "forbidden_journal_path".to_string(),
                    path: paths.first().cloned().unwrap_or_default(),
                    message: message.clone(),
                },
            }
            .emit(&app);
            Err(message)
        }
        Err(e) => Err(e.to_string()),
    }
}

// ─── W4-PR2 commands — agent adapter sync + detect ──────────────────────────

/// Re-render every adapter according to `config.agents.active`. Idempotent —
/// when nothing's changed since the last sync, every result is `unchanged`
/// and disk mtimes don't move. Called by:
///   - the Greenfield wizard right after init (W3-PR10)
///   - the OculpmSettings save (W4-PR7)
///   - the watcher's `.oculpm/agents/**` handler (master template edits)
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agents_sync_active(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<AgentSyncReport, String> {
    manager
        .sync_agents(&db, project_id)
        .await
        .map_err(|e| e.to_string())
}

/// W4-PR5 — compare a session's index ndjson against the union of journal
/// `files_touched` paths. Returns matched / missing / hallucinated sets +
/// jaccard severity for the DiffVsNarrative modal (PR6). Cheap on the
/// backend; PR8 may add a frontend sessionStorage cache.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_compare_layers(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    session_id: String,
) -> Result<LayerComparison, String> {
    manager
        .compare_layers(&db, project_id, &session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Read-only adapter heuristic. Used by Settings "감지" button + Greenfield
/// default active set.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agents_detect(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Vec<AgentDetection>, String> {
    manager
        .detect_agents(project_id)
        .await
        .map_err(|e| e.to_string())
}

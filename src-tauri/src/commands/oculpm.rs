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
use crate::oculpm::agents::{AgentDetection, MasterUpgrade};
use crate::oculpm::cache::{ChangeGroup, EntryFilters, JournalCache};
use crate::oculpm::entry_diffs::EntryFileDiff;
use crate::oculpm::error::OculpmError;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::{
    AgentSyncReport, BackfillReport, Difficulty, EntryStatus, FileChangeEvent, IntegrityWarning,
    JournalEntry, JournalEntrySummary, LayerComparison, ManualEntryDraft, OculpmConfig,
    OculpmInitReport, OculpmIntegrityWarning, OculpmOverviewStats, OculpmStatus, ReindexReport,
    Session,
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
    tracing::info!(
        target: "oculpm::commands",
        project_id,
        root = %root.display(),
        "[FLOW] step 1 — oculpm_init invoked"
    );
    // AGENTS.md 마스터 언어 = AI 작성 언어. 이 프로젝트에 심을 기록 규칙을
    // 영어 사용자에게 한국어로 주지 않기 위한 것 — 최초 시드에만 반영된다.
    let template_lang = match crate::oculpm::content_lang::current(&db).await {
        crate::oculpm::content_lang::ContentLang::English => "en",
        _ => "ko",
    };
    let report = manager
        .init_project(project_id, &root, template_lang)
        .await
        .map_err(|e| {
            tracing::error!(
                target: "oculpm::commands",
                project_id,
                root = %root.display(),
                error = %e,
                "[FLOW] step 1 FAILED — init_project errored"
            );
            e.to_string()
        })?;
    tracing::info!(
        target: "oculpm::commands",
        project_id,
        wrote_config = report.wrote_config,
        wrote_gitignore = report.wrote_gitignore,
        created_dirs = ?report.created_dirs,
        "[FLOW] step 1 OK — init_project returned"
    );

    // W4 dogfooding follow-up (2026-05-26) — auto-render every active adapter
    // file (notably `AGENTS.md`) on project load. `sync_agents` is idempotent:
    // existing files with matching content stay byte-for-byte, so this is a
    // no-op after the first open. Catches the case where a project was inited
    // in a prior session (`.oculpm/config.toml` already present → init_project
    // returns the fast path) but the adapter files have never materialized on
    // disk (e.g. user deleted `AGENTS.md` manually, or pulled a fresh clone
    // that omits it). Errors are logged but never escalated — the init itself
    // succeeded and the next manual "지금 동기화" can retry.
    match manager.sync_agents(&db, project_id).await {
        Ok(report) => {
            let summary: Vec<String> = report
                .results
                .iter()
                .map(|r| format!("{}={}", r.id, r.action))
                .collect();
            tracing::info!(
                target: "oculpm::commands",
                project_id,
                results = %summary.join(", "),
                "[FLOW] step 2 OK — sync_agents finished (AGENTS.md guaranteed if active)"
            );
        }
        Err(e) => {
            tracing::warn!(
                target: "oculpm::commands",
                project_id,
                error = %e,
                "[FLOW] step 2 FAILED — sync_agents errored (non-fatal); AGENTS.md may be missing"
            );
        }
    }

    // W4 dogfooding follow-up (2026-05-26) — incremental reindex on every
    // open. Catches journal entries an external LLM wrote while the watcher
    // wasn't running (app closed, or project not yet selected when the LLM
    // ran). Without this, files on disk stay invisible in TodayScreen until
    // the user manually clicks "재인덱스" — the user-visible symptom of
    // "AI made files but I don't see them" reported in the W4 thread.
    //
    // Incremental is cheap (mtime check skips parse for unchanged rows) and
    // it deletes cache rows whose files no longer exist on disk, so we run
    // it unconditionally. Errors are warn-only; the watcher will still
    // capture *future* edits even if this initial reindex fails.
    match manager.reindex_journal_cache_incremental(&db, project_id).await {
        Ok(r) => tracing::info!(
            target: "oculpm::commands",
            project_id,
            inserted = r.inserted,
            updated = r.updated,
            deleted = r.deleted,
            skipped = r.skipped,
            completed_at = %r.completed_at,
            "[FLOW] step 2.5 OK — incremental reindex picked up pre-existing journal entries"
        ),
        Err(e) => tracing::warn!(
            target: "oculpm::commands",
            project_id,
            error = %e,
            "[FLOW] step 2.5 FAILED — reindex errored (non-fatal); on-disk entries may not appear until next watcher event"
        ),
    }

    // Backfill per-entry diff sidecars for entries the live watcher never saw
    // (written while the app was closed → imported via reindex above, or
    // authored before the feature shipped). Idempotent + best-effort: already
    // captured entries are skipped with no git work, so after the first pass
    // this is near-free. The git-history fallback reconstructs diffs even for
    // already-committed entries, which is the dominant case for this app
    // (journals written by an external agent, reviewed after committing).
    match manager.backfill_entry_diffs(&db, project_id).await {
        Ok(n) if n > 0 => tracing::info!(
            target: "oculpm::commands",
            project_id,
            captured = n,
            "[FLOW] step 2.6 OK — backfilled diff sidecars for past entries"
        ),
        Ok(_) => {}
        Err(e) => tracing::warn!(
            target: "oculpm::commands",
            project_id,
            error = %e,
            "[FLOW] step 2.6 FAILED — entry-diff backfill errored (non-fatal)"
        ),
    }

    // Count the recorded diffs into per-file line churn so Today's 「라인 변화」
    // ring has real numbers. Runs after 2.6 so sidecars captured in that pass
    // are counted in the same open; each entry drops off the work-list once
    // counted, so repeat opens are near-free.
    match manager.backfill_line_counts(&db, project_id).await {
        Ok(n) if n > 0 => tracing::info!(
            target: "oculpm::commands",
            project_id,
            counted = n,
            "[FLOW] step 2.7 OK — backfilled line churn from diff sidecars"
        ),
        Ok(_) => {}
        Err(e) => tracing::warn!(
            target: "oculpm::commands",
            project_id,
            error = %e,
            "[FLOW] step 2.7 FAILED — line-count backfill errored (non-fatal)"
        ),
    }
    Ok(report)
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

/// 터미널이 감지한 코딩 에이전트 실행 신호 (OSC 133;C/D → 세션 경계).
///
/// 훅 브리지가 없는 에이전트(cursor·gemini·codex)까지 세션 시작·종료를 실측으로
/// 만든다. 감시가 꺼져 있으면 `false` 를 돌려주고 아무 일도 하지 않는다 —
/// 터미널 사용이 감시를 켜는 부작용을 내면 안 된다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agent_run_signal(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    started: bool,
    agent_label: String,
) -> Result<bool, String> {
    manager
        .agent_run_signal(project_id, started, &agent_label)
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
    db: State<'_, Db>,
    project_id: u32,
    workday: Option<String>,
) -> Result<Vec<Session>, String> {
    manager
        .list_sessions(&db, project_id, workday)
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

/// Start the filesystem watcher. Idempotent. Requires lock ownership.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_watcher_start(
    app_handle: tauri::AppHandle,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<(), String> {
    tracing::info!(
        target: "oculpm::commands",
        project_id,
        "[FLOW] step 3 — watcher_start invoked"
    );
    match manager.watcher_start(project_id, Some(app_handle)).await {
        Ok(()) => {
            tracing::info!(
                target: "oculpm::commands",
                project_id,
                "[FLOW] step 3 OK — watcher running (.oculpm/journal/** changes will be captured)"
            );
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                target: "oculpm::commands",
                project_id,
                error = %e,
                "[FLOW] step 3 FAILED — watcher_start errored; external LLM writes won't be detected"
            );
            Err(e.to_string())
        }
    }
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

/// v2 U12 (N3) — 워크데이 버킷 하나.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct WorkdayBucket {
    pub workday: String,
    pub entries: Vec<JournalEntrySummary>,
}

/// v2 U12 (N3) — Today/저널 타임라인의 단일 집계 응답. 기존에 Today 오픈이
/// [요일당 list 7회 + 오늘 엔트리당 get 1회 + 플랜당 get 1회 + 365일 히트맵]
/// = 12+N 회 IPC 를 유발하던 것을 이 커맨드 1회로 대체한다.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct WorkdayBrief {
    pub days: Vec<WorkdayBucket>,
    /// `lines_workday` 로 지정한 워크데이의 라인 증감 합 (미지정 시 0/0).
    /// diff 사이드카에서 파생된 값 — 프론트매터 `bytes_*` 가 아니다.
    pub lines_added: u32,
    pub lines_removed: u32,
    /// 활성 플랜의 미완 항목 (진행중 우선) — Today "다음 할 일" + 스탠드업 공유.
    pub open_plan_items: Vec<crate::db::OpenPlanItem>,
    /// 프로젝트 전체 일지 수 (365일 히트맵 대체 스칼라).
    pub total_entries: u32,
}

/// v2 U12 — 워크데이 집합의 일지 요약 + 오늘 bytes 합 + 미완 플랜 항목 +
/// 총 일지 수를 IPC 1회에. 서버측 fan-in — SQL 비용은 기존과 동일하고
/// 왕복(직렬화·스케줄링)만 제거된다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_workday_brief(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workdays: Vec<String>,
    lines_workday: Option<String>,
) -> Result<WorkdayBrief, String> {
    let cache = crate::oculpm::cache::JournalCache::new(&db);

    let mut days = Vec::with_capacity(workdays.len().min(62));
    for wd in workdays.into_iter().take(62) {
        let entries = manager
            .list_journal_entries(&db, project_id, Some(wd.clone()), EntryFilters::default())
            .await
            .map_err(|e| e.to_string())?;
        days.push(WorkdayBucket { workday: wd, entries });
    }

    let (lines_added, lines_removed) = match &lines_workday {
        Some(wd) => cache
            .workday_lines(project_id, wd)
            .await
            .map_err(|e| e.to_string())?,
        None => (0, 0),
    };

    let open_plan_items = db
        .list_open_plan_items(project_id, 24)
        .await
        .map_err(|e| e.to_string())?;
    let total_entries = cache
        .count_entries(project_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WorkdayBrief {
        days,
        lines_added,
        lines_removed,
        open_plan_items,
        total_entries,
    })
}

/// v2 U7 — 커맨드 팔레트 엔티티 점프 ("go to anything"): 일지·플랜·플랜
/// 항목·토의를 제목으로 통합 검색한다. SQLite 캐시만 읽는 저비용 경로
/// (타이핑 debounce 마다 호출됨).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_search_entities(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<crate::db::EntityHit>, String> {
    db.search_oculpm_entities(project_id, query, limit)
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

/// Read the per-file diffs recorded for a journal entry at the moment it was
/// first indexed (see `oculpm::entry_diffs`). Returns `[]` when nothing was
/// captured — the entry predates the feature, the project isn't a git repo, or
/// it was written after committing — and the UI renders "기록된 변경 없음".
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_entry_diffs(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
) -> Result<Vec<EntryFileDiff>, String> {
    // Lazily reconstruct on a sidecar miss (committed-after-journal, externally
    // authored, pre-feature) so the entry's diff shows immediately instead of
    // "기록된 변경 없음". Root comes from the DB, so it works without an active
    // manager (the journal screen reads from the SQLite cache).
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);
    manager
        .read_or_reconstruct_entry_diffs(&db, project_id, root, relative_path)
        .await
        .map_err(|e| e.to_string())
}

/// Group the watcher's changed file paths by the journal entry that recorded
/// each, with the plan items linked to that entry (Dogfooding #3). Files no
/// entry recorded land in a trailing `entry_path: None` bucket.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_group_changes(
    db: State<'_, Db>,
    project_id: u32,
    paths: Vec<String>,
) -> Result<Vec<ChangeGroup>, String> {
    JournalCache::new(&db)
        .group_changes(project_id, paths)
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

/// F7a-B Unit B — apply the tz-offset coercion to the entry's on-disk
/// frontmatter once (explicit user action). Only timestamps are written; the
/// slug stays display-coerced (filename coupling). Returns the re-projected
/// entry so the UI can drop the "보정됨" tz note.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_coerce_entry_on_disk(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
) -> Result<JournalEntry, String> {
    manager
        .coerce_journal_entry_timestamps_on_disk(&db, project_id, relative_path)
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
                "{} paths matched forbid_journal_for_paths, so the write was refused: {}",
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

/// Is a newer agent-rules master template available than the one on disk?
/// `None` = up-to-date. Surfaced as an "update" prompt on project open.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agents_check_master_upgrade(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Option<MasterUpgrade>, String> {
    manager
        .check_master_upgrade(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Upgrade the on-disk master to the embedded one + re-sync adapters (AGENTS.md
/// etc.). The previous master is backed up to `_template.md.bak`.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agents_apply_master_upgrade(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<AgentSyncReport, String> {
    manager
        .apply_master_upgrade(&db, project_id)
        .await
        .map_err(|e| e.to_string())
}

/// W4-PR5 — compare a session's index ndjson against the union of journal
/// `files_touched` paths. Returns matched / missing / hallucinated sets +
/// jaccard severity. (Lite-W6 PR3 retired the DiffVsNarrative UI; the
/// command is kept for backend introspection + potential future surfaces.)
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

/// W4 dogfooding follow-up (2026-05-26) — return the project's master template
/// text so the UI's "프롬프트 복사" action can paste it into a chat. Read-only;
/// does not touch any adapter files. Separates the *file sync* concern (which
/// `oculpm_agents_sync_active` already handles) from the *one-shot prompt
/// delivery* concern that the user actually wants when clicking "복사".
#[tauri::command]
#[specta::specta]
pub async fn oculpm_agents_get_master_template(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<String, String> {
    manager
        .read_master_template(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// W4 dogfooding follow-up (2026-05-26) — return the absolute path to the
/// directory holding the daily-rotated `oculpm.log.YYYY-MM-DD` files. Settings
/// uses this for the "로그 폴더 열기" button (delegates to opener plugin).
/// Returns `None` if the process started with file logging disabled (test
/// runs / unsupported platform).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_log_dir() -> Result<Option<String>, String> {
    Ok(crate::log_dir().map(|p| p.display().to_string()))
}

/// W4 dogfooding (2026-05-27) — overwrite the body markdown of an existing
/// journal entry. Frontmatter is preserved verbatim. Returns the hydrated
/// entry so the UI can resync without a second fetch.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_update_entry_body(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
    body_markdown: String,
) -> Result<JournalEntry, String> {
    manager
        .update_journal_entry_body(&db, project_id, relative_path, body_markdown)
        .await
        .map_err(|e| e.to_string())
}

/// W4 dogfooding (2026-05-27) — open a journal entry's `.md` file with the
/// OS default app. The opener plugin's path-glob scope keeps rejecting
/// project-local paths (3 dogfooding regressions); this command resolves the
/// absolute path inside the backend and invokes `open` / `xdg-open` /
/// `cmd /c start` directly, sidestepping the scope check entirely.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_open_entry_in_editor(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
) -> Result<(), String> {
    let abs = manager
        .resolve_journal_absolute(project_id, &relative_path)
        .await
        .map_err(|e| e.to_string())?;
    if !abs.exists() {
        return Err(format!("file not found: {}", abs.display()));
    }
    open_native(&abs).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).status().and_then(|s| {
        if s.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(format!("open exited with {s}")))
        }
    })
}

#[cfg(target_os = "linux")]
fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(path).status().and_then(|s| {
        if s.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(format!("xdg-open exited with {s}")))
        }
    })
}

#[cfg(target_os = "windows")]
fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &path.display().to_string()])
        .status()
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err(std::io::Error::other(format!("start exited with {s}")))
            }
        })
}

/// W4 dogfooding follow-up (2026-05-26) — bridge `console.*` calls from the
/// webview into the backend's `tracing` layers so the user only has to grab
/// **one** file when something breaks. The frontend wraps console.log/warn/
/// error in `setupOculpmLogBridge()` (App.tsx) and forwards every call here.
///
/// We intentionally don't echo back to the webview; the webview already
/// printed the original line in DevTools. We just want it in `oculpm.log`.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_log(level: String, target: String, message: String) {
    let target_str = format!("oculpm::frontend::{target}");
    match level.as_str() {
        "error" => tracing::error!(target: "oculpm::frontend", source = %target_str, "{message}"),
        "warn" => tracing::warn!(target: "oculpm::frontend", source = %target_str, "{message}"),
        "info" => tracing::info!(target: "oculpm::frontend", source = %target_str, "{message}"),
        _ => tracing::debug!(target: "oculpm::frontend", source = %target_str, "{message}"),
    }
}

// ─── W5-PR5 — Overview stats ────────────────────────────────────────────────

/// Single-shot fetch of every Overview widget. `window_days` clamps to
/// 1..=365 inside the manager — the modal-facing default is 90 (heatmap).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_overview_stats(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    window_days: u32,
) -> Result<OculpmOverviewStats, String> {
    manager
        .overview_stats(&db, project_id, window_days)
        .await
        .map_err(|e| e.to_string())
}

// ─── F5 — git-history backfill ──────────────────────────────────────────────

/// Synthesise one journal entry per recent git commit (cold-start backfill).
/// Idempotent: re-running only adds commits not seen before. `max_commits`
/// caps the scan (clamped 1..=2000 in the manager).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_backfill_from_git(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    max_commits: u32,
) -> Result<BackfillReport, String> {
    manager
        .backfill_from_git(&db, project_id, max_commits)
        .await
        .map_err(|e| e.to_string())
}

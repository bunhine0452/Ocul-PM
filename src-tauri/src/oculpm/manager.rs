//! `OculpmManager` — orchestrator for per-project `.oculpm/` lifecycle.
//!
//! W1-PR6 scope: project init (mkdir + .schema-version + config.toml + lock
//! acquire), per-project status, and config get/set. The watcher, session
//! actor, and `on_project_opened` / `on_project_closed` hooks land in W2 and
//! W1-PR7 respectively.
//!
//! W2-PR4 added `recover_zombie_sessions` — runs after lock acquisition but
//! before the watcher boots, finalising any `ended_at == null` sessions from
//! the most recent workdays as `crash_recovered`.
//!
//! AppHandle is intentionally *not* stored here yet. We'll thread it in once
//! W2 needs to emit Tauri events — keeping it out for now means tests can
//! construct a real `OculpmManager` without a Wry runtime.

#![allow(dead_code)] // Most surface is consumed by W1-PR7 + W2 + W4 commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::db::Db;
use crate::oculpm::atomic_io::{write_atomic, write_managed_block, ManagedBlockResult};
use crate::oculpm::cache::{CacheReindexReport, EntryFilters, JournalCache, PathChangeKind};
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{parse_frontmatter_and_body, write_frontmatter_and_body};
use crate::oculpm::index::IndexWriter;
use crate::oculpm::lock::{LockAcquisition, LockGuard};
use crate::oculpm::markdown::parse_body;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{
    AgentRef, CommentStyle, EndedReason, EntryStatus, EntryType, FileChangeEvent, JournalEntry,
    JournalEntrySummary, JournalFrontmatter, LockStateView, ManualEntryDraft, OculpmConfig,
    OculpmInitReport, OculpmStatus, ReindexReport, Session, SessionEnd, Snapshot, SnapshotKind,
    WatcherStateView, WatcherStatus,
};
use crate::oculpm::watcher::ProjectWatcher;

/// `.gitignore` managed-block body. Matches `00-spec.md` §1.2.
const GITIGNORE_BLOCK_BODY: &str = "\
.oculpm/index/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
";

/// Number of most-recent workdays to scan for zombie sessions on startup.
/// Kept as a named constant so W4's "full check" command can reference the
/// same default. See `docs/major_update/oculpm/W2/PR4-crash-recovery.md` §2.
pub const RECOVERY_WORKDAYS: usize = 3;

/// Process-wide orchestrator: holds one `ProjectEntry` per open project,
/// owns the lock guards + future watcher/session actors. Tauri `State`-managed.
#[derive(Default)]
pub struct OculpmManager {
    projects: RwLock<HashMap<u32, ProjectEntry>>,
}

/// Per-project in-memory state. The `LockGuard` is the live ownership token —
/// `None` means another instance holds the on-disk lock, so we operate in
/// read-only mode (no journal writes from this process).
struct ProjectEntry {
    root: PathBuf,
    config: OculpmConfig,
    resolver: WorkdayResolver,
    lock: Option<LockGuard>,
    // W2-PR6: watcher/session lifecycle
    index_writer: Arc<IndexWriter>,
    session: Option<SessionActor>,
    watcher: Option<ProjectWatcher>,
}

impl OculpmManager {
    /// Empty manager. Project entries are added by `init_project` on first open.
    pub fn new() -> Self {
        Self::default()
    }

    /// Initialise `.oculpm/` for a project. Idempotent — calling twice with
    /// the same `project_id` returns a no-op report on the second call.
    pub async fn init_project(
        &self,
        project_id: u32,
        root: &Path,
    ) -> Result<OculpmInitReport, OculpmError> {
        // Fast path: already initialised in this session.
        {
            let projects = self.projects.read().await;
            if let Some(entry) = projects.get(&project_id) {
                return Ok(OculpmInitReport {
                    created_dirs: Vec::new(),
                    wrote_config: false,
                    // W1-PR8 will populate this; for now stay false on idempotent calls.
                    wrote_gitignore: false,
                    lock_state: lock_state_from_guard(&entry.lock),
                });
            }
        }

        // First-time init for this session.
        let mut report = OculpmInitReport {
            created_dirs: Vec::new(),
            wrote_config: false,
            wrote_gitignore: false,
            lock_state: LockStateView::Uninitialized,
        };

        // 1. Build (or load) the config + resolver. Resolver is built from
        //    the same config so any tz/HH:MM error surfaces here, not later.
        let config_path = root.join(".oculpm").join("config.toml");
        let mut wrote_config = false;
        let config = if config_path.exists() {
            let cfg = OculpmConfig::load(&config_path)?;
            cfg.validate()?;
            cfg
        } else {
            let cfg = OculpmConfig::default_for_new_project();
            // Defaults are validated by `roundtrip_default` (W1-PR4), so this
            // can't fail in practice — kept as a guard.
            cfg.validate()?;
            wrote_config = true;
            cfg
        };
        let resolver = WorkdayResolver::new(&config.workday.timezone, &config.workday.day_starts_at)?;

        // 2. Ensure `.oculpm/` exists.
        let oculpm_dir = resolver.project_oculpm_dir(root);
        let dir_existed_before = oculpm_dir.exists();
        std::fs::create_dir_all(&oculpm_dir).map_err(|source| OculpmError::Io {
            path: oculpm_dir.clone(),
            source,
        })?;
        if !dir_existed_before {
            report.created_dirs.push(".oculpm".to_string());
        }

        // 3. `.schema-version`. Only write if missing — preserve user/migration tooling intent.
        let schema_version_path = resolver.schema_version_path(root);
        if !schema_version_path.exists() {
            write_atomic(&schema_version_path, b"1\n")?;
        }

        // 4. Persist config (atomic) only if we just generated defaults.
        if wrote_config {
            config.save(&config_path)?;
            report.wrote_config = true;
        }

        // 5. Acquire the lock. Storing the guard in `ProjectEntry` keeps the
        //    heartbeat task alive for the duration of the project being open.
        let lock_path = resolver.lock_path(root);
        let acq = LockGuard::acquire(&lock_path).await?;
        let (guard, lock_state) = match acq {
            LockAcquisition::Acquired(g) => (Some(g), LockStateView::Healthy),
            LockAcquisition::Recovered { guard, .. } => (Some(guard), LockStateView::Recovered),
            LockAcquisition::Held { .. } => (None, LockStateView::HeldByOther),
        };
        report.lock_state = lock_state;

        // 5.5 (W2-PR4) Crash recovery — scan recent workdays for zombie
        //     sessions (ended_at == null) and finalize them as
        //     `crash_recovered`. Runs *before* the watcher boots so there is
        //     no race with new events being appended.
        //     Only runs when we hold the lock (Acquired or Recovered).
        let index_writer = Arc::new(IndexWriter::new(root.to_path_buf(), resolver.clone()));
        if guard.is_some() {
            if let Err(e) = Self::recover_zombie_sessions(&index_writer, RECOVERY_WORKDAYS).await {
                tracing::warn!(
                    target: "oculpm::manager",
                    project_id,
                    error = %e,
                    "crash recovery failed (non-fatal) — continuing init"
                );
            }
        }

        // 6. `.gitignore` managed block. Idempotent: only flips `wrote_gitignore`
        //    when we actually inserted or updated. An orphan begin/end marker
        //    raises `ManagedBlockMismatch`, which we surface to the caller —
        //    the rest of init has already succeeded but the lock-acquire side
        //    effects (file + heartbeat) need to be undone before we return.
        let gitignore_path = root.join(".gitignore");
        match write_managed_block(
            &gitignore_path,
            "oculpm",
            GITIGNORE_BLOCK_BODY,
            CommentStyle::Hash,
        ) {
            Ok(result) => {
                report.wrote_gitignore = matches!(
                    result,
                    ManagedBlockResult::Inserted | ManagedBlockResult::Updated
                );
            }
            Err(e) => {
                // Drop the just-acquired guard so the on-disk `.lock` file and
                // heartbeat task don't outlive a failed init.
                drop(guard);
                return Err(e);
            }
        }

        // 7. Stash the entry.
        let entry = ProjectEntry {
            root: root.to_path_buf(),
            config,
            resolver,
            lock: guard,
            index_writer,
            session: None,
            watcher: None,
        };
        self.projects.write().await.insert(project_id, entry);

        Ok(report)
    }

    /// Snapshot of the project's current `.oculpm/` state. Safe to call for an
    /// uninitialised project — returns a default `Uninitialized` status.
    pub async fn get_status(&self, project_id: u32) -> OculpmStatus {
        let projects = self.projects.read().await;
        match projects.get(&project_id) {
            Some(entry) => OculpmStatus {
                initialized: true,
                // We validated on init; assume still valid until set_config
                // re-validates. Future PRs may add disk re-checks here.
                config_valid: true,
                lock_state: lock_state_from_guard(&entry.lock),
                current_workday: entry.resolver.workday_of(chrono::Utc::now()),
                // W2 swaps this to `Running` once the watcher boots.
                watcher_state: WatcherStateView::Stopped,
            },
            None => OculpmStatus {
                initialized: false,
                config_valid: false,
                lock_state: LockStateView::Uninitialized,
                current_workday: String::new(),
                watcher_state: WatcherStateView::Stopped,
            },
        }
    }

    /// Read the in-memory `OculpmConfig` for an initialised project. Errors
    /// with `NotInitialized` if `init_project` hasn't been called.
    pub async fn get_config(&self, project_id: u32) -> Result<OculpmConfig, OculpmError> {
        let projects = self.projects.read().await;
        projects
            .get(&project_id)
            .map(|e| e.config.clone())
            .ok_or(OculpmError::NotInitialized(project_id))
    }

    /// Validate + persist + update in-memory state. Also refreshes the
    /// `WorkdayResolver` so subsequent `get_status` calls reflect any tz
    /// change immediately.
    pub async fn set_config(
        &self,
        project_id: u32,
        new_config: OculpmConfig,
    ) -> Result<(), OculpmError> {
        new_config.validate()?;
        let new_resolver = WorkdayResolver::new(
            &new_config.workday.timezone,
            &new_config.workday.day_starts_at,
        )?;

        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        let config_path = entry.root.join(".oculpm").join("config.toml");
        new_config.save(&config_path)?;
        entry.config = new_config;
        entry.resolver = new_resolver;
        Ok(())
    }

    /// Release the lock and forget this project's in-memory state. Idempotent:
    /// a no-op if the project was never initialised. The actual cleanup happens
    /// in `LockGuard::drop` when the removed `ProjectEntry` falls out of scope.
    pub async fn on_project_closed(&self, project_id: u32) -> Result<(), OculpmError> {
        let mut projects = self.projects.write().await;
        if projects.remove(&project_id).is_some() {
            tracing::info!(
                target: "oculpm::manager",
                project_id,
                "released lock for closed project"
            );
        }
        Ok(())
    }

    /// Sync best-effort shutdown for `RunEvent::ExitRequested` — drops every
    /// `ProjectEntry`, which fires `LockGuard::drop` synchronously and removes
    /// the on-disk lock file.
    ///
    /// We use `try_write` with a short retry loop because we cannot `await`
    /// from inside Tauri's run-event callback. If every retry contends (which
    /// would mean some other tokio task is mid-mutation at shutdown), the
    /// `OculpmManager` will still get dropped when Tauri's `State` container
    /// tears down — `LockGuard::drop` covers us via RAII as a last resort.
    pub fn shutdown_all_blocking(&self) {
        for attempt in 0..10 {
            if let Ok(mut projects) = self.projects.try_write() {
                let count = projects.len();
                projects.clear();
                if count > 0 {
                    tracing::info!(
                        target: "oculpm::manager",
                        project_count = count,
                        "released project locks on shutdown"
                    );
                }
                return;
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        tracing::warn!(
            target: "oculpm::manager",
            "shutdown_all_blocking: projects map locked after 10 retries — relying on Drop"
        );
    }

    // ─── W2-PR4: crash recovery ─────────────────────────────────────────────

    /// Scan the most recent `max_workdays` workday directories for zombie
    /// sessions (`ended_at == null`) and finalize each as `crash_recovered`.
    ///
    /// `ended_at` is set to the timestamp of the last `FileChangeEvent` for
    /// that session (reverse ndjson scan), falling back to `started_at` if the
    /// session has zero recorded events.
    ///
    /// This is a static method on `OculpmManager` rather than an instance
    /// method so it can be called during `init_project` before the
    /// `ProjectEntry` is inserted into the projects map.
    pub(crate) async fn recover_zombie_sessions(
        index_writer: &IndexWriter,
        max_workdays: usize,
    ) -> Result<u32, OculpmError> {
        let all_workdays = index_writer.list_workdays().await?;
        let recent: Vec<&str> = all_workdays
            .iter()
            .take(max_workdays)
            .map(|s| s.as_str())
            .collect();

        let mut recovered_count: u32 = 0;

        for workday in &recent {
            let sessions = index_writer.list_sessions(workday).await?;
            for s in sessions.iter().filter(|s| s.ended_at.is_none()) {
                let last_ts = index_writer.last_event_ts(workday, &s.id).await?;
                let ended_at = last_ts.unwrap_or_else(|| s.started_at.clone());

                index_writer
                    .finalize_session(
                        &s.id,
                        SessionEnd {
                            ended_at,
                            ended_reason: EndedReason::CrashRecovered,
                        },
                    )
                    .await?;

                recovered_count += 1;
                tracing::info!(
                    target: "oculpm::manager",
                    session_id = %s.id,
                    workday,
                    "recovered zombie session"
                );
            }
        }

        if recovered_count > 0 {
            tracing::info!(
                target: "oculpm::manager",
                recovered_count,
                workdays_scanned = recent.len(),
                "crash recovery complete"
            );
        }

        Ok(recovered_count)
    }

    // ─── W2-PR6: watcher / session / index commands ─────────────────────────

    /// Start the filesystem watcher + session actor for the given project.
    /// Idempotent — if already running, returns Ok.
    pub async fn watcher_start(
        &self,
        project_id: u32,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), OculpmError> {
        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        if entry.lock.is_none() {
            return Err(OculpmError::InvalidConfig(
                "read-only mode: lock held by another instance".to_string(),
            ));
        }

        // Idempotent: already running.
        if entry.watcher.is_some() {
            return Ok(());
        }

        // Spawn session actor first — watcher needs it.
        let session = SessionActor::spawn(
            project_id,
            entry.resolver.clone(),
            entry.index_writer.clone(),
            entry.config.session.clone(),
            app_handle.clone(),
        );
        let watcher = ProjectWatcher::start(
            project_id,
            entry.root.clone(),
            session.clone(),
            entry.index_writer.clone(),
            entry.config.clone(),
            app_handle,
        )
        .await?;

        entry.session = Some(session);
        entry.watcher = Some(watcher);
        Ok(())
    }

    /// Stop the watcher + gracefully shutdown the session actor.
    /// Idempotent — if already stopped, returns Ok.
    pub async fn watcher_stop(&self, project_id: u32) -> Result<(), OculpmError> {
        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        if let Some(watcher) = entry.watcher.take() {
            watcher.stop().await?;
        }
        if let Some(session) = entry.session.take() {
            session.shutdown().await?;
        }
        Ok(())
    }

    /// Watcher status. Safe to call before init — returns Stopped + 0 counters.
    pub async fn watcher_status(&self, project_id: u32) -> WatcherStatus {
        let projects = self.projects.read().await;
        match projects.get(&project_id) {
            Some(entry) => match &entry.watcher {
                Some(w) => w.status(),
                None => WatcherStatus {
                    state: WatcherStateView::Stopped,
                    events_seen_total: 0,
                    events_ignored_total: 0,
                    last_event_at: None,
                    debounce_ms: entry.config.watcher.debounce_ms,
                },
            },
            None => WatcherStatus {
                state: WatcherStateView::Stopped,
                events_seen_total: 0,
                events_ignored_total: 0,
                last_event_at: None,
                debounce_ms: 0,
            },
        }
    }

    /// Get the current active session (if any). Returns None if idle/closing
    /// or if the project hasn't started a watcher yet.
    pub async fn get_current_session(
        &self,
        project_id: u32,
    ) -> Result<Option<Session>, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        match &entry.session {
            Some(actor) => actor.get_current_session().await,
            None => Ok(None),
        }
    }

    /// Manually start a session. Idempotent — if already active, returns the
    /// existing session. If no watcher is running, starts one first.
    pub async fn start_session_manual(
        &self,
        project_id: u32,
    ) -> Result<Option<Session>, OculpmError> {
        {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            if let Some(actor) = &entry.session {
                actor.manual_start()?;
                // Give the actor a moment to process.
                tokio::task::yield_now().await;
                return actor.get_current_session().await;
            }
        }
        // No session actor → need to start watcher first.
        self.watcher_start(project_id, None).await?;
        let projects = self.projects.read().await;
        let entry = projects.get(&project_id).ok_or(OculpmError::NotInitialized(project_id))?;
        if let Some(actor) = &entry.session {
            actor.manual_start()?;
            tokio::task::yield_now().await;
            return actor.get_current_session().await;
        }
        Ok(None)
    }

    /// Manually end a session. The session_id must match the active session.
    pub async fn end_session_manual(
        &self,
        project_id: u32,
        session_id: String,
    ) -> Result<(), OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        match &entry.session {
            Some(actor) => actor.manual_end(session_id),
            None => Err(OculpmError::InvalidConfig(
                "no active session actor".to_string(),
            )),
        }
    }

    /// List sessions for a given workday (or today if None).
    pub async fn list_sessions(
        &self,
        project_id: u32,
        workday: Option<String>,
    ) -> Result<Vec<Session>, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        let wd = workday.unwrap_or_else(|| entry.resolver.workday_of(chrono::Utc::now()));
        entry.index_writer.list_sessions(&wd).await
    }

    /// Get file changes for a workday, optionally filtered by session_id.
    pub async fn get_file_changes(
        &self,
        project_id: u32,
        workday: String,
        session_id: Option<String>,
    ) -> Result<Vec<FileChangeEvent>, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        let events = entry.index_writer.read_file_changes(&workday, None).await?;
        Ok(match session_id {
            Some(sid) => events.into_iter().filter(|e| e.session_id == sid).collect(),
            None => events,
        })
    }

    /// Read a snapshot (open or close) for a given workday.
    pub async fn get_index_snapshot(
        &self,
        project_id: u32,
        workday: String,
        kind: SnapshotKind,
    ) -> Result<Snapshot, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        entry
            .index_writer
            .read_snapshot(&workday, kind)
            .await?
            .ok_or_else(|| OculpmError::InvalidConfig(format!(
                "snapshot not captured for workday={workday}, kind={kind:?}"
            )))
    }

    // ─── W3-PR3: journal cache + manual entry coordination ──────────────────

    /// Resolve a project's `.oculpm/journal/` absolute root. Used by the
    /// journal commands to drive `JournalCache` calls.
    pub async fn journal_root(&self, project_id: u32) -> Result<PathBuf, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.resolver.journal_root(&entry.root))
    }

    /// List cached journal entries for `(project_id, workday?)` with
    /// arbitrary filters. Thin wrapper over [`JournalCache::list_entries`].
    pub async fn list_journal_entries(
        &self,
        db: &Db,
        project_id: u32,
        workday: Option<String>,
        filters: EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        JournalCache::new(db)
            .list_entries(project_id, workday.as_deref(), &filters)
            .await
    }

    /// Get a single cached entry. Falls back to an on-demand disk read +
    /// upsert if the row is missing but the file exists.
    pub async fn get_journal_entry(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
    ) -> Result<Option<JournalEntry>, OculpmError> {
        let cache = JournalCache::new(db);
        if let Some(entry) = cache.get_entry(project_id, &relative_path).await? {
            return Ok(Some(entry));
        }
        // Cache miss — check disk.
        let journal_root = self.journal_root(project_id).await?;
        let abs = journal_root.join(&relative_path);
        if !abs.exists() {
            return Ok(None);
        }
        cache
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Created,
            )
            .await?;
        cache.get_entry(project_id, &relative_path).await
    }

    /// Toggle `verified_by_user` on a journal entry. Reads the disk file,
    /// mutates the frontmatter only, atomic-writes it back, then upserts the
    /// cache so the UI sees the change before the next watcher event lands.
    pub async fn set_journal_verified(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        verified: bool,
    ) -> Result<(), OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let abs = journal_root.join(&relative_path);
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, body) = parse_frontmatter_and_body(&text);
        let Some(mut fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot verify entry with broken frontmatter".to_string(),
            ));
        };
        fm.verified_by_user = verified;
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        // Write-through: parse new text + upsert. The new mtime is whatever
        // the OS just wrote — re-stat for accuracy.
        let (parsed2, body2) = parse_frontmatter_and_body(&new_text);
        let body_parsed = parse_body(&body2);
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        JournalCache::new(db)
            .upsert_entry(
                project_id,
                &relative_path,
                &parsed2,
                &body_parsed,
                mtime,
                &new_text,
            )
            .await?;
        Ok(())
    }

    /// Update one or both of `difficulty` / `status` on an existing entry.
    /// Mirrors [`set_journal_verified`] — read → parse → mutate frontmatter →
    /// atomic-write → cache upsert — but operates on the W3 inline-edit
    /// fields. `None` for a field means "leave unchanged", so callers can
    /// edit either independently or both in one round-trip.
    ///
    /// Returns the freshly-upserted `JournalEntry` so the frontend can render
    /// the updated detail pane without a second `get_journal_entry` call.
    pub async fn update_journal_entry_meta(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        difficulty: Option<Option<crate::oculpm::spec::Difficulty>>,
        status: Option<crate::oculpm::spec::EntryStatus>,
    ) -> Result<JournalEntry, OculpmError> {
        if difficulty.is_none() && status.is_none() {
            return Err(OculpmError::InvalidConfig(
                "update_journal_entry_meta called with no fields to change".to_string(),
            ));
        }
        let journal_root = self.journal_root(project_id).await?;
        let abs = journal_root.join(&relative_path);
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, body) = parse_frontmatter_and_body(&text);
        let Some(mut fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot edit entry with broken frontmatter".to_string(),
            ));
        };
        if let Some(new_diff) = difficulty {
            fm.difficulty = new_diff;
        }
        if let Some(new_status) = status {
            fm.status = new_status;
        }
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        let (parsed2, body2) = parse_frontmatter_and_body(&new_text);
        let body_parsed = parse_body(&body2);
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        let cache = JournalCache::new(db);
        cache
            .upsert_entry(
                project_id,
                &relative_path,
                &parsed2,
                &body_parsed,
                mtime,
                &new_text,
            )
            .await?;
        // Return the hydrated entry so the UI can update without a second
        // fetch — keeps optimistic UI in sync with cache truth.
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| OculpmError::InvalidConfig(
                format!("entry vanished after upsert: {relative_path}")
            ))
    }

    /// Rebuild the cache from `.oculpm/journal/` ground truth. Drops every
    /// row for the project and re-walks. Returns the user-facing report
    /// shape from `spec::ReindexReport` (project_id + completed_at included).
    pub async fn reindex_journal_cache(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<ReindexReport, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let report = JournalCache::new(db)
            .reindex_full(project_id, &journal_root)
            .await?;
        Ok(reindex_report_to_spec(project_id, report))
    }

    /// Write a manual journal entry the user authored via the modal. Resolves
    /// session_id (existing active session → draft override → sentinel),
    /// constructs frontmatter, writes the file atomically with the spec's
    /// `<HHMM>_<type>_<slug>.md` naming, and upserts the cache.
    pub async fn create_manual_journal_entry(
        &self,
        db: &Db,
        project_id: u32,
        draft: ManualEntryDraft,
    ) -> Result<JournalEntry, OculpmError> {
        validate_slug(&draft.slug)?;

        // Snapshot the per-project state we need without holding the lock
        // across disk IO.
        let (root, resolver, language) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.root.clone(),
                entry.resolver.clone(),
                "ko".to_string(), // No top-level language field yet; default per spec.
            )
        };
        let now_utc = chrono::Utc::now();
        let workday = resolver.workday_of(now_utc);
        let local_now = now_utc.with_timezone(&chrono_tz_from(&resolver));
        let hhmm = format!("{:02}{:02}", local_now.hour(), local_now.minute());

        // Resolve session_id: explicit → active → sentinel.
        let session_id = if let Some(sid) = draft.session_id.clone() {
            sid
        } else if let Ok(Some(sess)) = self.get_current_session(project_id).await {
            sess.id
        } else {
            format!(
                "manual-{workday}-{}{:02}{:02}",
                local_now.hour(),
                local_now.minute(),
                local_now.second()
            )
        };

        // Build the frontmatter.
        let fm = JournalFrontmatter {
            schema_version: 1,
            entry_type: draft.entry_type,
            slug: draft.slug.clone(),
            status: draft.status.unwrap_or(EntryStatus::Planned),
            difficulty: draft.difficulty,
            created_at: local_now.to_rfc3339(),
            updated_at: None,
            session_id,
            agent: AgentRef {
                id: "manual".to_string(),
                version: None,
            },
            language,
            verified_by_user: true,
            files_touched: draft.files_touched.clone(),
            related: Vec::new(),
            tags: draft.tags.clone(),
        };

        // Compose body: first-line title with [ ] / [x] marker derived from
        // status (done → [x], else [ ]).
        let marker = if matches!(fm.status, EntryStatus::Done) {
            "[x]"
        } else {
            "[ ]"
        };
        let body = if draft.body_markdown.is_empty() {
            format!("{marker} {}\n", draft.title)
        } else {
            format!("{marker} {}\n\n{}", draft.title, draft.body_markdown)
        };
        let text = write_frontmatter_and_body(&fm, &body);

        // Resolve target path + write atomically. On filename collision we
        // suffix `__2`, `__3`, … per spec §2.1.
        let category_dir = resolver.journal_dir(&root, &workday, draft.entry_type);
        std::fs::create_dir_all(&category_dir).map_err(|source| OculpmError::Io {
            path: category_dir.clone(),
            source,
        })?;
        let type_str = entry_type_filename_token(draft.entry_type);
        let base_name = format!("{hhmm}_{type_str}_{}", draft.slug);
        let (abs, file_name) = pick_nonconflicting_path(&category_dir, &base_name);
        write_atomic(&abs, text.as_bytes())?;

        // Upsert into the cache so the caller can re-read immediately.
        let relative_path = format!(
            "{workday}/{}/{file_name}",
            category_subdir(draft.entry_type)
        );
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| now_utc.timestamp());
        let (parsed, body_text) = parse_frontmatter_and_body(&text);
        let body_parsed = parse_body(&body_text);
        let cache = JournalCache::new(db);
        cache
            .upsert_entry(
                project_id,
                &relative_path,
                &parsed,
                &body_parsed,
                mtime,
                &text,
            )
            .await?;
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(
                    "manual entry was written but cache hydration failed".to_string(),
                )
            })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// W3-PR3 helpers (file-private)
// ─────────────────────────────────────────────────────────────────────────────

use chrono::Timelike;

/// Spec §2.1 — kebab-case ASCII, 1..=60 chars.
fn validate_slug(slug: &str) -> Result<(), OculpmError> {
    if slug.is_empty() || slug.len() > 60 {
        return Err(OculpmError::InvalidConfig(format!(
            "slug must be 1..=60 characters (got {})",
            slug.len()
        )));
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(OculpmError::InvalidConfig(
            "slug must match [a-z0-9-] (kebab-case, ASCII)".to_string(),
        ));
    }
    Ok(())
}

fn entry_type_filename_token(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

fn category_subdir(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "Bugs",
        EntryType::Feature => "Features_to_add",
        EntryType::Error => "Errors",
        EntryType::Refactor => "Refactors",
        EntryType::Chore => "Chores",
    }
}

/// Resolve a non-conflicting file path: `base.md` first, then `base__2.md`,
/// `base__3.md`, …. Returns the absolute path and the chosen file name.
fn pick_nonconflicting_path(dir: &Path, base: &str) -> (PathBuf, String) {
    let initial = format!("{base}.md");
    let first = dir.join(&initial);
    if !first.exists() {
        return (first, initial);
    }
    for n in 2..=999 {
        let name = format!("{base}__{n}.md");
        let p = dir.join(&name);
        if !p.exists() {
            return (p, name);
        }
    }
    // Theoretical fallback — collisions beyond 999 are absurd. Use timestamp.
    let name = format!("{base}__{}.md", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let p = dir.join(&name);
    (p, name)
}

/// Extract the project tz from a `WorkdayResolver` for local-time
/// formatting. `WorkdayResolver` exposes `tz` as a public field.
fn chrono_tz_from(resolver: &WorkdayResolver) -> chrono_tz::Tz {
    resolver.tz
}

fn reindex_report_to_spec(project_id: u32, r: CacheReindexReport) -> ReindexReport {
    let _ = r.elapsed_ms; // captured in tracing log; not part of spec shape
    let _ = r.parse_errors; // surfaced via integrity events, not the public report
    ReindexReport {
        project_id,
        inserted: r.inserted,
        updated: r.updated,
        deleted: r.deleted,
        skipped: r.skipped_unchanged,
        completed_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn lock_state_from_guard(guard: &Option<LockGuard>) -> LockStateView {
    match guard {
        Some(_) => LockStateView::Healthy,
        None => LockStateView::HeldByOther,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Case 1 — fresh project: init creates `.oculpm/`, config.toml,
    /// .schema-version, and acquires the lock.
    #[tokio::test]
    async fn init_creates_files_and_acquires_lock() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        let report = manager.init_project(1, dir.path()).await.unwrap();
        assert!(report.wrote_config, "config.toml must be created on fresh init");
        assert!(matches!(report.lock_state, LockStateView::Healthy));

        let p = dir.path();
        assert!(p.join(".oculpm").exists());
        assert!(p.join(".oculpm/config.toml").exists());
        assert!(p.join(".oculpm/.schema-version").exists());
        assert!(p.join(".oculpm/.lock").exists());

        let schema = std::fs::read_to_string(p.join(".oculpm/.schema-version")).unwrap();
        assert_eq!(schema.trim(), "1");
    }

    /// Case 2 — calling init twice is a no-op for the second call.
    #[tokio::test]
    async fn init_is_idempotent() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        let r1 = manager.init_project(1, dir.path()).await.unwrap();
        let r2 = manager.init_project(1, dir.path()).await.unwrap();
        assert!(r1.wrote_config);
        assert!(!r2.wrote_config, "second init must not rewrite config.toml");
        assert_eq!(r2.created_dirs, Vec::<String>::new());
    }

    /// Case 3 — get_status reflects current workday + healthy lock.
    #[tokio::test]
    async fn get_status_after_init() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        // Before init.
        let s0 = manager.get_status(1).await;
        assert!(!s0.initialized);
        assert!(matches!(s0.lock_state, LockStateView::Uninitialized));

        manager.init_project(1, dir.path()).await.unwrap();

        let s1 = manager.get_status(1).await;
        assert!(s1.initialized);
        assert!(s1.config_valid);
        assert!(matches!(s1.lock_state, LockStateView::Healthy));
        assert_eq!(s1.current_workday.len(), 8, "workday is YYYYMMDD");
        assert!(matches!(s1.watcher_state, WatcherStateView::Stopped));
    }

    /// Case 5 — on_project_closed releases the lock and forgets the project.
    #[tokio::test]
    async fn on_project_closed_releases_lock() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        manager.init_project(1, dir.path()).await.unwrap();
        assert!(dir.path().join(".oculpm/.lock").exists());

        manager.on_project_closed(1).await.unwrap();

        assert!(
            !dir.path().join(".oculpm/.lock").exists(),
            "LockGuard::drop must remove the lock file synchronously"
        );

        // Forgotten from the in-memory map.
        let status = manager.get_status(1).await;
        assert!(!status.initialized);

        // Idempotent — closing again is a no-op.
        manager.on_project_closed(1).await.unwrap();
    }

    /// Case 6 — shutdown_all_blocking releases every project's lock.
    #[tokio::test]
    async fn shutdown_all_releases_every_lock() {
        let dir1 = tempdir().unwrap();
        let dir2 = tempdir().unwrap();
        let manager = OculpmManager::new();

        manager.init_project(1, dir1.path()).await.unwrap();
        manager.init_project(2, dir2.path()).await.unwrap();
        assert!(dir1.path().join(".oculpm/.lock").exists());
        assert!(dir2.path().join(".oculpm/.lock").exists());

        manager.shutdown_all_blocking();

        assert!(!dir1.path().join(".oculpm/.lock").exists());
        assert!(!dir2.path().join(".oculpm/.lock").exists());

        // Map is empty.
        let s1 = manager.get_status(1).await;
        let s2 = manager.get_status(2).await;
        assert!(!s1.initialized);
        assert!(!s2.initialized);
    }

    // ─── W1-PR8 — `.gitignore` managed block ───────────────────────────────

    /// PR8 case 1 — no `.gitignore` → init creates one containing only our
    /// managed block + `wrote_gitignore = true`.
    #[tokio::test]
    async fn init_creates_gitignore_when_missing() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        let report = manager.init_project(1, dir.path()).await.unwrap();
        assert!(report.wrote_gitignore);

        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.contains("# oculpm:begin v1"));
        assert!(gi.contains(".oculpm/index/"));
        assert!(gi.contains(".oculpm/.lock"));
        assert!(gi.contains(".oculpm/.schema-version"));
        assert!(gi.contains(".oculpm/oculpm.log"));
        assert!(gi.contains(".oculpm.backup-*/"));
        assert!(gi.contains("# oculpm:end"));
        // Block-only file must not start with a blank line.
        assert!(gi.starts_with("# oculpm:begin v1"));
    }

    /// PR8 case 2 — pre-existing `.gitignore` → our block is appended with
    /// exactly one blank-line separator, user content is preserved.
    #[tokio::test]
    async fn init_appends_block_to_existing_gitignore() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        std::fs::write(
            dir.path().join(".gitignore"),
            "node_modules/\ndist/\n",
        )
        .unwrap();

        let report = manager.init_project(1, dir.path()).await.unwrap();
        assert!(report.wrote_gitignore);

        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.starts_with("node_modules/\ndist/\n"));
        assert!(gi.contains("dist/\n\n# oculpm:begin v1"));
        assert!(gi.contains(".oculpm/index/"));
    }

    /// PR8 case 3 — second init on the same project is a fast-path no-op, so
    /// `wrote_gitignore = false` and the file is byte-identical.
    #[tokio::test]
    async fn init_is_idempotent_for_gitignore() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        let r1 = manager.init_project(1, dir.path()).await.unwrap();
        assert!(r1.wrote_gitignore);
        let snapshot = std::fs::read(dir.path().join(".gitignore")).unwrap();

        let r2 = manager.init_project(1, dir.path()).await.unwrap();
        assert!(!r2.wrote_gitignore);
        let after = std::fs::read(dir.path().join(".gitignore")).unwrap();
        assert_eq!(snapshot, after, ".gitignore must not be rewritten on idempotent init");
    }

    /// PR8 case 4 — pre-existing orphan `# oculpm:begin v1` (no end marker)
    /// → init returns `ManagedBlockMismatch` and drops the lock so a retry is
    /// possible after the user fixes the file.
    #[tokio::test]
    async fn init_errors_on_orphan_managed_block_and_releases_lock() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        std::fs::write(
            dir.path().join(".gitignore"),
            "# oculpm:begin v1\n.oculpm/index/\n",
        )
        .unwrap();

        let err = manager.init_project(1, dir.path()).await.unwrap_err();
        assert!(matches!(err, OculpmError::ManagedBlockMismatch { .. }));

        // Lock file must not survive a failed init.
        assert!(
            !dir.path().join(".oculpm/.lock").exists(),
            "LockGuard must be dropped when init fails after the lock was acquired"
        );

        // Project is not registered, so the manager's view stays uninitialised.
        assert!(!manager.get_status(1).await.initialized);
    }

    /// PR8 case 5 — CRLF in the pre-existing `.gitignore` is preserved.
    #[tokio::test]
    async fn init_preserves_crlf_in_gitignore() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();

        std::fs::write(
            dir.path().join(".gitignore"),
            "node_modules/\r\ndist/\r\n",
        )
        .unwrap();

        let report = manager.init_project(1, dir.path()).await.unwrap();
        assert!(report.wrote_gitignore);

        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.contains("\r\n# oculpm:begin v1\r\n"));
        assert!(gi.contains(".oculpm/index/\r\n"));
        assert!(gi.contains("\r\n# oculpm:end\r\n"));
        assert!(!gi.contains(".oculpm/index/\n.oculpm/.lock\n"));
    }

    /// Case 4 — set_config persists to disk + updates the in-memory resolver.
    #[tokio::test]
    async fn set_config_persists_and_updates_resolver() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();
        manager.init_project(1, dir.path()).await.unwrap();

        // Mutate + save.
        let mut updated = manager.get_config(1).await.unwrap();
        updated.session.inactivity_timeout_minutes = 60;
        updated.workday.day_starts_at = "03:00".into();
        manager.set_config(1, updated).await.unwrap();

        // In-memory readback.
        let got = manager.get_config(1).await.unwrap();
        assert_eq!(got.session.inactivity_timeout_minutes, 60);
        assert_eq!(got.workday.day_starts_at, "03:00");

        // Disk readback.
        let disk = OculpmConfig::load(&dir.path().join(".oculpm/config.toml")).unwrap();
        assert_eq!(disk.session.inactivity_timeout_minutes, 60);
        assert_eq!(disk.workday.day_starts_at, "03:00");

        // set_config rejects invalid config without persisting.
        let mut bad = OculpmConfig::default_for_new_project();
        bad.workday.timezone = "Bogus/Tz".into();
        let err = manager.set_config(1, bad).await.unwrap_err();
        assert!(matches!(err, OculpmError::InvalidTimezone(_)));
        // Disk untouched.
        let disk2 = OculpmConfig::load(&dir.path().join(".oculpm/config.toml")).unwrap();
        assert_eq!(disk2.workday.day_starts_at, "03:00");
    }

    // ─── W2-PR4 — Crash recovery ───────────────────────────────────────────

    use crate::oculpm::spec::{EndedReason, FileChangeEvent, FileOp, Session, SessionEnd};

    fn make_writer(root: &Path) -> IndexWriter {
        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        IndexWriter::new(root.to_path_buf(), resolver)
    }

    fn make_zombie_session(id: &str, started_at: &str) -> Session {
        Session {
            id: id.to_string(),
            started_at: started_at.to_string(),
            ended_at: None,
            ended_reason: None,
            active_window_ms: 0,
            file_event_count: 0,
            files_unique: 0,
            git_head_at_start: None,
            git_head_at_end: None,
            agent_label_guess: None,
            linked_journal_entries: Vec::new(),
        }
    }

    fn make_event(session_id: &str, ts: &str, path: &str) -> FileChangeEvent {
        FileChangeEvent {
            ts: ts.to_string(),
            session_id: session_id.to_string(),
            op: FileOp::Update,
            path: path.to_string(),
            hash_before: None,
            hash_after: Some("blake3:abc".into()),
            bytes: 100,
        }
    }

    /// PR4 test 1 — two zombie sessions (yesterday + today), both recovered.
    #[tokio::test]
    async fn recover_two_zombie_sessions() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        // Yesterday
        writer
            .upsert_session(&make_zombie_session(
                "20260522-001",
                "2026-05-22T09:00:00Z",
            ))
            .await
            .unwrap();
        writer
            .append_file_change(&make_event(
                "20260522-001",
                "2026-05-22T10:30:00Z",
                "src/a.rs",
            ))
            .await
            .unwrap();

        // Today
        writer
            .upsert_session(&make_zombie_session(
                "20260523-001",
                "2026-05-23T14:00:00Z",
            ))
            .await
            .unwrap();
        writer
            .append_file_change(&make_event(
                "20260523-001",
                "2026-05-23T15:45:00Z",
                "src/b.rs",
            ))
            .await
            .unwrap();

        let count = OculpmManager::recover_zombie_sessions(&writer, 3)
            .await
            .unwrap();
        assert_eq!(count, 2, "both zombie sessions must be recovered");

        // Verify yesterday's session.
        let sessions_y = writer.list_sessions("20260522").await.unwrap();
        let s1 = &sessions_y[0];
        assert_eq!(s1.ended_at.as_deref(), Some("2026-05-22T10:30:00Z"));
        assert!(matches!(
            s1.ended_reason,
            Some(EndedReason::CrashRecovered)
        ));

        // Verify today's session.
        let sessions_t = writer.list_sessions("20260523").await.unwrap();
        let s2 = &sessions_t[0];
        assert_eq!(s2.ended_at.as_deref(), Some("2026-05-23T15:45:00Z"));
        assert!(matches!(
            s2.ended_reason,
            Some(EndedReason::CrashRecovered)
        ));
    }

    /// PR4 test 2 — 3-day limit: zombie in a 4-day-old workday is NOT recovered.
    #[tokio::test]
    async fn recover_respects_three_day_limit() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        // 4 workdays: 20260520, 21, 22, 23.
        for (wd, sid) in &[
            ("20260520", "20260520-001"),
            ("20260521", "20260521-001"),
            ("20260522", "20260522-001"),
            ("20260523", "20260523-001"),
        ] {
            writer
                .upsert_session(&make_zombie_session(
                    sid,
                    &format!("{}-{}T09:00:00Z", &wd[..4], &wd[4..6]),
                ))
                .await
                .unwrap();
        }

        let count = OculpmManager::recover_zombie_sessions(&writer, 3)
            .await
            .unwrap();
        // Only 3 most recent: 20260523, 20260522, 20260521.
        assert_eq!(count, 3, "only the 3 most recent workdays are scanned");

        // The 4th-oldest (20260520) should still be a zombie.
        let old = writer.list_sessions("20260520").await.unwrap();
        assert!(
            old[0].ended_at.is_none(),
            "4-day-old zombie must NOT be recovered"
        );
    }

    /// PR4 test 3 — last_event_ts fallback: session with zero events gets
    /// `ended_at = started_at`.
    #[tokio::test]
    async fn recover_fallback_to_started_at_when_no_events() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        writer
            .upsert_session(&make_zombie_session(
                "20260523-001",
                "2026-05-23T14:00:00Z",
            ))
            .await
            .unwrap();
        // No events appended.

        let count = OculpmManager::recover_zombie_sessions(&writer, 3)
            .await
            .unwrap();
        assert_eq!(count, 1);

        let sessions = writer.list_sessions("20260523").await.unwrap();
        assert_eq!(
            sessions[0].ended_at.as_deref(),
            Some("2026-05-23T14:00:00Z"),
            "ended_at must fall back to started_at"
        );
        assert!(matches!(
            sessions[0].ended_reason,
            Some(EndedReason::CrashRecovered)
        ));
    }

    /// PR4 test 4 — finalize then list: after recovery, list_sessions returns
    /// the updated ended_reason.
    #[tokio::test]
    async fn recover_then_list_shows_updated_reason() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        writer
            .upsert_session(&make_zombie_session(
                "20260523-001",
                "2026-05-23T09:00:00Z",
            ))
            .await
            .unwrap();
        // Also add a normal (already ended) session to confirm it's untouched.
        let mut ended = make_zombie_session("20260523-002", "2026-05-23T12:00:00Z");
        ended.ended_at = Some("2026-05-23T13:00:00Z".into());
        ended.ended_reason = Some(EndedReason::InactivityTimeout);
        writer.upsert_session(&ended).await.unwrap();

        OculpmManager::recover_zombie_sessions(&writer, 3)
            .await
            .unwrap();

        let sessions = writer.list_sessions("20260523").await.unwrap();
        // Session 001 should be crash_recovered.
        assert!(matches!(
            sessions[0].ended_reason,
            Some(EndedReason::CrashRecovered)
        ));
        // Session 002 should be untouched (InactivityTimeout).
        assert!(matches!(
            sessions[1].ended_reason,
            Some(EndedReason::InactivityTimeout)
        ));
        assert_eq!(
            sessions[1].ended_at.as_deref(),
            Some("2026-05-23T13:00:00Z"),
            "already-ended session must not be modified"
        );
    }

    /// PR4 test 5 — race-free: recovery function is a standalone await-able
    /// call that completes before returning, so no concurrent watcher can
    /// interleave. We verify this by asserting the return type is a plain
    /// Result (not a JoinHandle) and that the sessions.json is fully flushed.
    #[tokio::test]
    async fn recover_is_synchronous_and_flushed() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        writer
            .upsert_session(&make_zombie_session(
                "20260523-001",
                "2026-05-23T14:00:00Z",
            ))
            .await
            .unwrap();

        // `recover_zombie_sessions` is .await-ed directly — when it returns,
        // all disk I/O must be complete.
        let count = OculpmManager::recover_zombie_sessions(&writer, 3)
            .await
            .unwrap();
        assert_eq!(count, 1);

        // Verify disk flush: read the raw sessions.json and confirm ended_at
        // is populated — no deferred write.
        let sessions_path = dir
            .path()
            .join(".oculpm/index/20260523/sessions.json");
        let raw = std::fs::read_to_string(&sessions_path).unwrap();
        assert!(raw.contains("crash_recovered"));
        assert!(raw.contains("2026-05-23T14:00:00Z"));
    }

    /// PR4 test 6 — list_workdays returns dirs in descending order and ignores
    /// non-YYYYMMDD directory names.
    #[tokio::test]
    async fn list_workdays_order_and_filtering() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());

        // Create workday dirs + a non-workday dir.
        for wd in &["20260521", "20260523", "20260520", "20260522"] {
            writer.ensure_workday_dirs(wd).await.unwrap();
        }
        // Create a non-YYYYMMDD dir that should be ignored.
        std::fs::create_dir_all(
            dir.path().join(".oculpm/index/not-a-workday"),
        )
        .unwrap();

        let workdays = writer.list_workdays().await.unwrap();
        assert_eq!(
            workdays,
            vec!["20260523", "20260522", "20260521", "20260520"],
            "must be sorted descending, non-YYYYMMDD excluded"
        );
    }

    // ─── W3-PR3: journal/manual-entry/verified/reindex ──────────────────

    mod journal_w3_pr3 {
        use super::*;
        use crate::db::Db;
        use crate::oculpm::spec::{Difficulty, EntryStatus, EntryType, FileTouched, ManualEntryDraft};

        async fn fresh_manager_and_db() -> (
            OculpmManager,
            Db,
            tempfile::TempDir, // project root + db dir
            std::path::PathBuf,
        ) {
            let dir = tempfile::tempdir().unwrap();
            let db_path = dir.path().join("ai-pm.db");
            let db = Db::open(db_path).await.expect("open db");
            let manager = OculpmManager::new();
            let project_root = dir.path().join("project");
            std::fs::create_dir_all(&project_root).unwrap();
            manager.init_project(7, &project_root).await.unwrap();
            (manager, db, dir, project_root)
        }

        fn minimal_draft(slug: &str) -> ManualEntryDraft {
            ManualEntryDraft {
                entry_type: EntryType::Bug,
                slug: slug.to_string(),
                title: "Manual entry title".to_string(),
                difficulty: Some(Difficulty::Medium),
                body_markdown: "Body text\n".to_string(),
                session_id: None,
                files_touched: vec![FileTouched {
                    path: "src/a.rs".to_string(),
                    op: crate::oculpm::spec::FileOp::Update,
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: None,
                }],
                status: Some(EntryStatus::Done),
                tags: vec!["alpha".into()],
            }
        }

        #[tokio::test]
        async fn create_manual_entry_writes_file_and_caches_with_agent_manual() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let entry = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("my-slug"))
                .await
                .expect("created");

            assert_eq!(entry.frontmatter.agent.id, "manual");
            assert_eq!(entry.frontmatter.entry_type, EntryType::Bug);
            assert_eq!(entry.frontmatter.slug, "my-slug");
            assert_eq!(entry.frontmatter.tags, vec!["alpha".to_string()]);
            assert!(entry.frontmatter.verified_by_user);
            assert_eq!(entry.frontmatter.files_touched.len(), 1);

            // File exists on disk under journal/<workday>/Bugs/.
            let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
            assert!(abs.exists(), "file written to {}", abs.display());

            // Listed via cache too.
            let rows = manager
                .list_journal_entries(&db, 7, None, EntryFilters::default())
                .await
                .unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].slug, "my-slug");
        }

        #[tokio::test]
        async fn create_manual_entry_rejects_invalid_slug() {
            let (manager, db, _dir, _root) = fresh_manager_and_db().await;
            // Uppercase + space → fails kebab-case ASCII rule.
            let res = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("Bad Slug!"))
                .await;
            assert!(res.is_err());
            let res2 = manager
                .create_manual_journal_entry(&db, 7, minimal_draft(""))
                .await;
            assert!(res2.is_err());
            let too_long = "a".repeat(61);
            let res3 = manager
                .create_manual_journal_entry(&db, 7, minimal_draft(&too_long))
                .await;
            assert!(res3.is_err());
        }

        #[tokio::test]
        async fn create_manual_entry_handles_filename_collision_with_suffix() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let a = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("collide"))
                .await
                .expect("first");
            let b = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("collide"))
                .await
                .expect("second");

            assert_ne!(a.relative_path, b.relative_path, "must not overwrite");
            assert!(
                b.relative_path.contains("__2"),
                "second write should suffix __2: {}",
                b.relative_path
            );
            // Both files on disk.
            let r = project_root.join(".oculpm/journal");
            assert!(r.join(&a.relative_path).exists());
            assert!(r.join(&b.relative_path).exists());
        }

        #[tokio::test]
        async fn set_journal_verified_flips_frontmatter_and_cache() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            // verified=true by default for manual drafts → flip to false.
            let entry = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("verify-me"))
                .await
                .unwrap();
            assert!(entry.frontmatter.verified_by_user);

            manager
                .set_journal_verified(&db, 7, entry.relative_path.clone(), false)
                .await
                .unwrap();
            let raw =
                std::fs::read_to_string(project_root.join(".oculpm/journal").join(&entry.relative_path))
                    .unwrap();
            assert!(raw.contains("verified_by_user: false"));

            let fresh = manager
                .get_journal_entry(&db, 7, entry.relative_path.clone())
                .await
                .unwrap()
                .unwrap();
            assert!(!fresh.frontmatter.verified_by_user, "cache reflects new flag");

            // Round-trip back to true.
            manager
                .set_journal_verified(&db, 7, entry.relative_path.clone(), true)
                .await
                .unwrap();
            let fresh2 = manager
                .get_journal_entry(&db, 7, entry.relative_path)
                .await
                .unwrap()
                .unwrap();
            assert!(fresh2.frontmatter.verified_by_user);
        }

        #[tokio::test]
        async fn set_journal_verified_rejects_broken_frontmatter() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            // Write a deliberately broken entry directly to disk.
            let rel = "20260524/Bugs/0000_bug_broken.md";
            let abs = project_root.join(".oculpm/journal").join(rel);
            std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
            std::fs::write(
                &abs,
                "---\nschema_version: 1\ntype: bug\n  bad: [unclosed\n---\n[x] body\n",
            )
            .unwrap();
            // Get the entry through the manager so the on-demand cache path
            // runs (parse_ok=0 → row exists as chore).
            manager
                .get_journal_entry(&db, 7, rel.to_string())
                .await
                .unwrap();

            let res = manager
                .set_journal_verified(&db, 7, rel.to_string(), true)
                .await;
            assert!(res.is_err());
            let msg = res.unwrap_err().to_string();
            assert!(msg.contains("broken frontmatter"), "got: {msg}");
        }

        #[tokio::test]
        async fn reindex_journal_cache_returns_spec_report_shape() {
            let (manager, db, _dir, _root) = fresh_manager_and_db().await;
            manager
                .create_manual_journal_entry(&db, 7, minimal_draft("a"))
                .await
                .unwrap();
            manager
                .create_manual_journal_entry(&db, 7, minimal_draft("b"))
                .await
                .unwrap();
            // Wipe cache, then ask manager to reindex.
            db.conn()
                .call(|c| -> rusqlite::Result<()> {
                    c.execute("DELETE FROM oculpm_journal WHERE project_id = 7", [])?;
                    Ok(())
                })
                .await
                .unwrap();
            let report = manager.reindex_journal_cache(&db, 7).await.unwrap();
            assert_eq!(report.project_id, 7);
            assert_eq!(report.inserted, 2);
            assert!(!report.completed_at.is_empty());
            // Sanity: list works after reindex.
            let rows = manager
                .list_journal_entries(&db, 7, None, EntryFilters::default())
                .await
                .unwrap();
            assert_eq!(rows.len(), 2);
        }

        #[tokio::test]
        async fn get_journal_entry_falls_back_to_disk_on_cache_miss() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            // Hand-write an entry to disk that the cache hasn't seen.
            let rel = "20260524/Bugs/0900_bug_handwritten.md";
            let abs = project_root.join(".oculpm/journal").join(rel);
            std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
            let fm = "schema_version: 1\ntype: bug\nslug: handwritten\nstatus: planned\ncreated_at: \"2026-05-24T09:00:00+09:00\"\nsession_id: \"20260524-001\"\nagent: { id: claude-code }\nlanguage: ko";
            std::fs::write(&abs, format!("---\n{fm}\n---\n[ ] Hand title\n")).unwrap();

            // Cache is empty; manager must on-demand parse + upsert.
            let entry = manager
                .get_journal_entry(&db, 7, rel.to_string())
                .await
                .unwrap()
                .expect("fall-back path");
            assert_eq!(entry.frontmatter.slug, "handwritten");
            // Second call now hits the cache.
            let entry2 = manager
                .get_journal_entry(&db, 7, rel.to_string())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(entry2.title, entry.title);
        }

        #[tokio::test]
        async fn list_journal_entries_returns_empty_for_uninitialised_project() {
            // No init for project_id=99 — manager has no entry, so cache
            // returns empty Vec (NotInitialized would break Today UX).
            let dir = tempfile::tempdir().unwrap();
            let db_path = dir.path().join("ai-pm.db");
            let db = Db::open(db_path).await.unwrap();
            let manager = OculpmManager::new();
            // list_journal_entries doesn't touch manager state (only cache),
            // so it shouldn't error for an unknown project.
            let rows = manager
                .list_journal_entries(&db, 99, None, EntryFilters::default())
                .await
                .unwrap();
            assert!(rows.is_empty());
        }

        #[tokio::test]
        async fn create_manual_entry_with_explicit_session_id_keeps_it() {
            let (manager, db, _dir, _root) = fresh_manager_and_db().await;
            let mut draft = minimal_draft("explicit-sid");
            draft.session_id = Some("20260524-042".to_string());
            let entry = manager
                .create_manual_journal_entry(&db, 7, draft)
                .await
                .unwrap();
            assert_eq!(entry.frontmatter.session_id, "20260524-042");
        }

        #[tokio::test]
        async fn create_manual_entry_planned_status_uses_unchecked_marker() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let mut draft = minimal_draft("planned-x");
            draft.status = Some(EntryStatus::Planned);
            let entry = manager
                .create_manual_journal_entry(&db, 7, draft)
                .await
                .unwrap();
            let raw =
                std::fs::read_to_string(project_root.join(".oculpm/journal").join(&entry.relative_path))
                    .unwrap();
            // Body starts with "[ ] Manual entry title"
            assert!(raw.contains("[ ] Manual entry title"), "raw: {raw}");
            assert_eq!(entry.checkbox, Some(false));
        }
    }
}

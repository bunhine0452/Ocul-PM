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

use regex::Regex;
use tokio::sync::RwLock;

use crate::db::Db;
use crate::oculpm::agents::{self, AgentDetection};
use crate::oculpm::atomic_io::{write_atomic, write_managed_block, ManagedBlockResult};
use crate::oculpm::cache::{CacheReindexReport, EntryFilters, JournalCache, PathChangeKind};
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{
    backfill_tz_offset, parse_frontmatter_and_body, write_frontmatter_and_body,
};
use crate::oculpm::index::IndexWriter;
use crate::oculpm::lock::{LockAcquisition, LockGuard};
use crate::oculpm::markdown::parse_body;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::redact::{
    build_forbidden_matcher, compile_redact_patterns, is_forbidden_path, redact_text,
};
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{
    AgentRef, AgentSyncReport, BackfillReport, CommentStyle, EndedReason, EntryStatus, EntryType,
    FileChangeEvent, FileOp, FileTouched, JournalEntry, JournalEntrySummary, JournalFrontmatter,
    LayerComparison, LockStateView, ManualEntryDraft, OculpmConfig, OculpmInitReport,
    OculpmOverviewStats, OculpmStatus, ReindexReport, Session, SessionEnd, Severity, Snapshot,
    SnapshotKind, WatcherStateView, WatcherStatus,
};
use crate::oculpm::watcher::ProjectWatcher;

/// `.gitignore` managed-block body. Matches `00-spec.md` §1.2.
/// `.oculpm/hooks/` — PR-CI0: Claude Code 훅 인박스. 이벤트 payload 에 대화
/// 내용(prompt / last_assistant_message)이 포함되므로 머신 로컬로만 남긴다.
const GITIGNORE_BLOCK_BODY: &str = "\
.oculpm/index/
.oculpm/hooks/
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
    /// N4 — per-project serializer for plan-file writes. Every writer (in-app
    /// edits `plan_apply_edit`/`plan_set_status`/…, in-app `plan_ai_refresh`,
    /// and the background `reconcile`) holds this around its read-modify-write
    /// so concurrent writers can't clobber each other (last-writer-wins lost
    /// updates). Lazily created per project.
    plan_write_locks: RwLock<HashMap<u32, Arc<tokio::sync::Mutex<()>>>>,
}

/// Cloned view of a project's lazy-loaded state. Used by `overview_stats`
/// (and other callers) that need to do IO outside the manager's RwLock guard.
struct ProjectSnapshot {
    root: PathBuf,
    resolver: WorkdayResolver,
    config: OculpmConfig,
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

    /// N4 — the per-project plan-write serializer (lazily created). Hold the
    /// returned mutex's guard around any read-modify-write of a
    /// `.oculpm/planner/*.md` so the in-app writers and the background
    /// `reconcile` never clobber each other.
    pub async fn plan_write_lock(&self, project_id: u32) -> Arc<tokio::sync::Mutex<()>> {
        {
            let map = self.plan_write_locks.read().await;
            if let Some(l) = map.get(&project_id) {
                return l.clone();
            }
        }
        let mut map = self.plan_write_locks.write().await;
        map.entry(project_id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
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
    ///
    /// W4 dogfooding follow-up (2026-05-26) — reuses an existing
    /// `entry.session` if one is alive. Together with `watcher_stop` no
    /// longer shutting down the session actor, this means rapidly toggling
    /// between the Start screen and a project view keeps the *same*
    /// session_id across cycles, instead of multiplying sessions per
    /// toggle (the user-visible repro of W4 §발견 2 bis).
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
            tracing::debug!(
                target: "oculpm::manager",
                project_id,
                "watcher_start: already running, no-op"
            );
            return Ok(());
        }

        // Reuse the existing session actor if one survived a prior
        // watcher_stop. This is the bug fix for "navigate-out-and-back
        // multiplies sessions": before, every cycle spawned a fresh
        // SessionActor and lost the resume baseline.
        let reused_session = entry.session.is_some();
        let session = if let Some(s) = entry.session.as_ref() {
            s.clone()
        } else {
            SessionActor::spawn(
                project_id,
                entry.resolver.clone(),
                entry.index_writer.clone(),
                entry.config.session.clone(),
                app_handle.clone(),
            )
        };
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
        tracing::info!(
            target: "oculpm::manager",
            project_id,
            reused_session,
            "[FLOW] watcher_start: watcher + session attached (reused_session={reused_session})"
        );
        Ok(())
    }

    /// Stop the watcher. **Does not shut down the session actor** — see
    /// the note below.
    ///
    /// Why: `watcher_stop` is called by the frontend whenever the UI
    /// unmounts the project view (e.g. user navigates back to the Start
    /// screen and forward again). Previously this also called
    /// `session.shutdown()` which finalised the active session with
    /// `AppQuit`. The resume mechanism (see `try_resume_session`) only
    /// rescues sessions closed with `InactivityTimeout`, so every
    /// navigation cycle produced a fresh session id — the exact bug from
    /// W4 dogfooding §발견 2 reappeared in a different shape (2026-05-26).
    ///
    /// Now: stop the fs watcher (so we're not paying for OS-watch threads
    /// while the user is off the project view) but keep the session actor
    /// alive. The session's own inactivity timer governs end-of-session:
    /// if the user comes back fast, the same session continues; if they
    /// stay away past `inactivity_timeout_minutes`, the session naturally
    /// ends with `InactivityTimeout` and the next activity within
    /// `session_resume_grace_minutes` rescues it via the existing path.
    ///
    /// Real app shutdown still finalises sessions:
    /// - `on_project_closed` calls `session.shutdown()` explicitly.
    /// - Process exit drops every `ProjectEntry`; the session actor's
    ///   sender drops, the receive loop ends, and `recover_zombie_sessions`
    ///   on next launch finalises anything stuck in Active.
    ///
    /// Idempotent — calling twice is a no-op the second time.
    pub async fn watcher_stop(&self, project_id: u32) -> Result<(), OculpmError> {
        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        let had_watcher = entry.watcher.is_some();
        if let Some(watcher) = entry.watcher.take() {
            watcher.stop().await?;
        }
        tracing::info!(
            target: "oculpm::manager",
            project_id,
            had_watcher,
            session_alive = entry.session.is_some(),
            "[FLOW] watcher_stop: watcher halted, session actor kept alive (will end via inactivity timer if user doesn't return)"
        );
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

    /// Compile this project's `auto_redact_patterns` from its in-memory config
    /// for the cache-projection paths (reindex / cache-miss disk read). Empty
    /// when the project isn't registered (no config in memory) — callers then
    /// project without masking; the disk-rooted paths use
    /// [`redact::patterns_for_project`][crate::oculpm::redact::patterns_for_project]
    /// instead so they still mask for unregistered projects.
    async fn redact_patterns(&self, project_id: u32) -> Vec<Regex> {
        match self.get_config(project_id).await {
            Ok(cfg) => compile_redact_patterns(&cfg.git.auto_redact_patterns),
            Err(_) => Vec::new(),
        }
    }

    /// Resolve a project's timezone for read-time `created_at`/`updated_at`
    /// offset backfill (F7a-B). Falls back to UTC for an unregistered project
    /// or an unparseable tz, so projection never fails on the tz lookup.
    async fn tz_for(&self, project_id: u32) -> chrono_tz::Tz {
        match self.get_config(project_id).await {
            Ok(cfg) => cfg.workday.timezone.parse().unwrap_or(chrono_tz::UTC),
            Err(_) => chrono_tz::UTC,
        }
    }

    /// Resolve a project's repository root — the directory that holds `.oculpm/`.
    /// Used to drive git (per-entry diff capture) against the working tree.
    pub async fn project_root(&self, project_id: u32) -> Result<PathBuf, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.root.clone())
    }

    /// Backfill per-entry diff sidecars for entries that never got one — written
    /// before this feature shipped, or imported via reindex (app closed when the
    /// entry was authored) rather than seen by the live watcher. Idempotent and
    /// best-effort: entries that already have a sidecar are skipped with no git
    /// work, so this is cheap on every project open after the first pass. The
    /// git-history fallback in [`entry_diffs`] reconstructs diffs even for
    /// already-committed entries. Returns how many sidecars were newly written.
    pub async fn backfill_entry_diffs(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<u32, OculpmError> {
        use crate::oculpm::entry_diffs;
        let root = self.project_root(project_id).await?;
        // R1 — compile redaction once; each diff sidecar is masked at capture.
        let redact = crate::oculpm::redact::patterns_for_project(&root);
        let journal_root = self.journal_root(project_id).await?;
        let cache = JournalCache::new(db);
        let mut captured = 0u32;
        for (relative_path, _mtime) in crate::oculpm::cache::walk_journal(&journal_root) {
            if entry_diffs::sidecar_exists(&root, &relative_path) {
                continue;
            }
            let touched = match cache.get_entry(project_id, &relative_path).await {
                Ok(Some(e)) => e.frontmatter.files_touched,
                _ => continue,
            };
            if touched.is_empty() {
                continue;
            }
            // Prefetch last-indexed baselines so the blocking capture can run the
            // snapshot fallback (tier 2) without touching the async Db itself.
            let mut snapshots: HashMap<String, Vec<u8>> = HashMap::new();
            for f in &touched {
                if let Ok(Some(snap)) = db.get_file_snapshot(project_id, f.path.clone()).await {
                    snapshots.insert(f.path.clone(), snap.content);
                }
            }
            let root2 = root.clone();
            let rel2 = relative_path.clone();
            let redact2 = redact.clone();
            let res = tokio::task::spawn_blocking(move || {
                entry_diffs::capture_entry_diffs(&root2, &rel2, &touched, &snapshots, &redact2)
            })
            .await;
            match res {
                Ok(Ok(_)) => {
                    if entry_diffs::sidecar_exists(&root, &relative_path) {
                        captured += 1;
                    }
                }
                Ok(Err(e)) => tracing::warn!(
                    target: "oculpm::manager",
                    project_id, path = %relative_path, error = %e,
                    "entry-diff backfill: sidecar write failed"
                ),
                Err(e) => tracing::warn!(
                    target: "oculpm::manager",
                    project_id, path = %relative_path, error = %e,
                    "entry-diff backfill: blocking task panicked"
                ),
            }
        }
        Ok(captured)
    }

    /// Read an entry's recorded diffs, lazily reconstructing them on a cache miss.
    ///
    /// `oculpm_get_entry_diffs` used to be a pure sidecar read, so an entry whose
    /// sidecar was never written — committed *after* the journal, imported via
    /// reindex, or authored before this feature — showed "기록된 변경 없음" until
    /// the next project-open backfill ran. That's the case the user hits when
    /// they open an entry having committed in between. This reconstructs on
    /// demand with the same 3-tier capture the watcher/backfill use, so the diff
    /// appears immediately (and the sidecar is persisted for next time). A clean
    /// (truly empty) result still reads back as `[]` — capture writes no sidecar.
    pub async fn read_or_reconstruct_entry_diffs(
        &self,
        db: &Db,
        project_id: u32,
        root: PathBuf,
        relative_path: String,
    ) -> Result<Vec<crate::oculpm::entry_diffs::EntryFileDiff>, OculpmError> {
        use crate::oculpm::entry_diffs;
        // `root` is resolved by the caller from the DB (not `self.project_root`),
        // so reconstruction works even when the project isn't registered in the
        // manager — the journal screen reads straight from the SQLite cache and
        // a project can be browsed without an active watcher.
        let existing = entry_diffs::read_entry_diffs(&root, &relative_path);
        if !existing.is_empty() {
            return Ok(existing);
        }
        // Cache miss → reconstruct from the entry's files_touched, mirroring
        // `backfill_entry_diffs` for a single entry.
        let cache = JournalCache::new(db);
        let touched = match cache.get_entry(project_id, &relative_path).await {
            Ok(Some(e)) => e.frontmatter.files_touched,
            _ => return Ok(Vec::new()),
        };
        if touched.is_empty() {
            return Ok(Vec::new());
        }
        let mut snapshots: HashMap<String, Vec<u8>> = HashMap::new();
        for f in &touched {
            if let Ok(Some(snap)) = db.get_file_snapshot(project_id, f.path.clone()).await {
                snapshots.insert(f.path.clone(), snap.content);
            }
        }
        // R1 — `root` may be an unregistered project (browsed from the cache),
        // so load redaction from disk rather than the in-memory config.
        let redact = crate::oculpm::redact::patterns_for_project(&root);
        let root2 = root.clone();
        let rel2 = relative_path.clone();
        let _ = tokio::task::spawn_blocking(move || {
            entry_diffs::capture_entry_diffs(&root2, &rel2, &touched, &snapshots, &redact)
        })
        .await;
        Ok(entry_diffs::read_entry_diffs(&root, &relative_path))
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
        // Project the disk file with on-read masking so a secret in an
        // agent-authored entry never reaches the cache (→ AI context). Compiled
        // only on the (rare) miss path, not on the cache-hit fast path above.
        let redact = self.redact_patterns(project_id).await;
        let redacting = JournalCache::with_redaction(db, redact).with_tz(self.tz_for(project_id).await);
        redacting
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Created,
            )
            .await?;
        redacting.get_entry(project_id, &relative_path).await
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

        // Re-project through the redacting cache (same path the watcher uses):
        // disk keeps the agent's original body (SSOT), the cache row is masked
        // on projection. This re-reads the just-written file, so the frontmatter
        // edit and the body masking are both reflected. R1 — closes the cache
        // re-pollution bypass where a frontmatter-only edit re-inserted an
        // agent body's plaintext secret into the cache (→ AI context).
        let redact = self.redact_patterns(project_id).await;
        JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
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

        // Re-project through the redacting cache (disk keeps the agent's body;
        // the cache row is masked on projection — R1, mirrors set_journal_verified).
        let redact = self.redact_patterns(project_id).await;
        let cache = JournalCache::with_redaction(db, redact).with_tz(self.tz_for(project_id).await);
        cache
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
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

    /// F7a-B Unit B — write the tz-offset backfill into the on-disk frontmatter
    /// once, on explicit user request. This is the **only** path that
    /// intentionally modifies the agent's source file (every other coercion is
    /// cache/display-only). Scope is timestamps (`created_at`/`updated_at`)
    /// only: the slug is deliberately left alone because it's coupled to the
    /// filename, and rewriting one without the other would desync them. Errors
    /// when there's nothing to coerce. Returns the re-projected entry.
    pub async fn coerce_journal_entry_timestamps_on_disk(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
    ) -> Result<JournalEntry, OculpmError> {
        let tz = self.tz_for(project_id).await;
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
        let mut changed = false;
        if let Some(fixed) = backfill_tz_offset(&fm.created_at, tz) {
            fm.created_at = fixed;
            changed = true;
        }
        if let Some(u) = fm.updated_at.clone() {
            if let Some(fixed) = backfill_tz_offset(&u, tz) {
                fm.updated_at = Some(fixed);
                changed = true;
            }
        }
        if !changed {
            return Err(OculpmError::InvalidConfig(
                "보정할 시간대가 없습니다 (이미 오프셋이 있거나 시간 형식이 아닙니다).".to_string(),
            ));
        }
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        // Re-project (masked + tz) so the cache reflects the now-offset source.
        let redact = self.redact_patterns(project_id).await;
        let cache = JournalCache::with_redaction(db, redact).with_tz(tz);
        cache
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
            )
            .await?;
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(format!("entry vanished after coerce: {relative_path}"))
            })
    }

    /// Replace the body markdown of an existing entry, keeping the YAML
    /// frontmatter intact. Same atomic-write + cache-upsert pattern as
    /// `update_journal_entry_meta`.
    pub async fn update_journal_entry_body(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        new_body: String,
    ) -> Result<JournalEntry, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let abs = journal_root.join(&relative_path);
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, _body) = parse_frontmatter_and_body(&text);
        let Some(fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot edit body of entry with broken frontmatter".to_string(),
            ));
        };
        // R1 — mask secrets in the edited body before writing. We author this
        // write, so at-write masking keeps both the disk file and the cache
        // (upserted from `new_text` below) free of plaintext keys.
        let redact = self.redact_patterns(project_id).await;
        let (new_body, _hits) = redact_text(&new_body, &redact);
        let new_text = write_frontmatter_and_body(&fm, &new_body);
        write_atomic(&abs, new_text.as_bytes())?;

        let (parsed2, body2) = parse_frontmatter_and_body(&new_text);
        let body_parsed = parse_body(&body2);
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        // .with_tz mirrors update_journal_entry_meta — keep the cache row's
        // backfilled created_at offset consistent on a body edit (F7a-B). The
        // body is already masked at-write above, so no redaction needed here.
        let cache = JournalCache::new(db).with_tz(self.tz_for(project_id).await);
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
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| OculpmError::InvalidConfig(
                format!("entry vanished after upsert: {relative_path}")
            ))
    }

    /// Resolve a journal-relative path to its absolute on-disk location so
    /// the commands layer can open it natively (sidestepping the opener
    /// plugin's scope check that has bitten dogfooding twice).
    pub async fn resolve_journal_absolute(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<PathBuf, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        Ok(journal_root.join(relative_path))
    }

    // ─── W4-PR2: agent adapter sync + detect ────────────────────────────────

    /// Sync every known adapter to disk based on the current
    /// `config.agents.active`. Idempotent; safe to call from init, Settings
    /// save, and watcher-driven master-template change notifications.
    ///
    /// W4-PR4: after each adapter write the per-adapter blake3 hash is
    /// upserted into `oculpm_agent_state` so the watcher's drift detector
    /// can tell "we just wrote this" (no drift) from "user/tool wrote this"
    /// (emit). Hashes are best-effort: a None `last_hash` (removed / error
    /// / unhashable) leaves the previous row in place — the watcher will
    /// either find no row (no drift comparison possible) or the stale row,
    /// which the next successful sync overwrites.
    pub async fn sync_agents(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<AgentSyncReport, OculpmError> {
        let (root, config) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (entry.root.clone(), entry.config.clone())
        };
        let report = agents::sync_active(&root, &config).await?;
        for r in &report.results {
            if let Some(hash) = r.last_hash.clone() {
                if let Err(e) = db
                    .oculpm_agent_state_upsert(project_id, r.id.clone(), hash)
                    .await
                {
                    tracing::warn!(
                        target: "oculpm::manager",
                        project_id,
                        agent_id = %r.id,
                        error = %e,
                        "oculpm_agent_state upsert failed (drift detection may emit a false positive)"
                    );
                }
            }
        }
        Ok(report)
    }

    /// Is a newer master template available than the one on disk? (Surfaced as
    /// an "update agent rules" prompt for projects initialized before a
    /// template bump.)
    pub async fn check_master_upgrade(
        &self,
        project_id: u32,
    ) -> Result<Option<agents::MasterUpgrade>, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?
                .root
                .clone()
        };
        Ok(agents::master_upgrade_available(&root))
    }

    /// Upgrade the on-disk master to the embedded one (backing up the old) and
    /// re-sync all active adapters so AGENTS.md etc. pick up the new rules.
    pub async fn apply_master_upgrade(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<AgentSyncReport, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?
                .root
                .clone()
        };
        agents::upgrade_master(&root)?;
        self.sync_agents(db, project_id).await
    }

    /// Compare the on-disk adapter file at `relative_path` against the last
    /// hash we recorded for the matching agent. Returns
    /// `Some((agent_id, expected, actual))` when they differ — the watcher
    /// then emits `OculpmAgentDrift`. Returns `None` when the path isn't an
    /// adapter we know about, when there's no prior hash to compare, or
    /// when current and stored hashes match. See `W4-PR4` docs.
    pub async fn check_agent_drift(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<(String, String, String)>, OculpmError> {
        let Some(adapter) = agents::lookup_adapter_by_path(relative_path) else {
            return Ok(None);
        };
        let root = {
            let projects = self.projects.read().await;
            let Some(entry) = projects.get(&project_id) else {
                return Ok(None);
            };
            entry.root.clone()
        };
        let abs = root.join(adapter.adapter_path);
        let Some(actual) = agents::current_disk_hash(adapter, &abs) else {
            return Ok(None);
        };
        let Some((expected, _ts)) = db
            .oculpm_agent_state_get(project_id, adapter.id.to_string())
            .await
            .map_err(|e| OculpmError::Sqlite(e.to_string()))?
        else {
            return Ok(None);
        };
        if actual == expected {
            Ok(None)
        } else {
            Ok(Some((adapter.id.to_string(), expected, actual)))
        }
    }

    // ─── W4-PR5: compare_layers ─────────────────────────────────────────────

    /// Diff a session's `file_changes.ndjson` (ground truth) against the
    /// union of `files_touched[].path` from every journal entry stamped with
    /// that `session_id`. (Lite-W6 PR3 retired the DiffVsNarrative UI; the
    /// data is still produced for backend introspection.)
    ///
    /// Forbidden + already-redacted paths are stripped from BOTH sides before
    /// the comparison so they never count as mismatches (a `.env` change is
    /// excluded from the index per W4-PR3 and can't appear in a journal
    /// either; symmetry keeps jaccard from artificially tanking).
    pub async fn compare_layers(
        &self,
        db: &Db,
        project_id: u32,
        session_id: &str,
    ) -> Result<LayerComparison, OculpmError> {
        // workday = session_id 의 첫 8자 ("20260524-001" → "20260524").
        // 끝의 - 가 없거나 형식이 다를 경우 session_id 전체를 workday 로 사용
        // → cache 쿼리가 빈 결과 반환하면 호출자에게 자연스러운 신호.
        let workday = session_id
            .split_once('-')
            .map(|(w, _)| w.to_string())
            .unwrap_or_else(|| session_id.to_string());

        let (writer, forbid_patterns, root) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.index_writer.clone(),
                entry.config.git.forbid_journal_for_paths.clone(),
                entry.root.clone(),
            )
        };

        let forbidden = build_forbidden_matcher(&root, &forbid_patterns);
        let is_excluded = |p: &str| -> bool {
            p.starts_with("**redacted/sensitive**:")
                || is_forbidden_path(&forbidden, p)
                // W4 dogfooding (2026-05-27) — the watcher now drops these at
                // capture time, but historical ndjson written before the
                // suppression fix still contains them. Filtering here keeps
                // `LayerComparison` honest across the upgrade boundary.
                || is_noise_path(p)
        };

        let file_changes = writer.read_file_changes(&workday, None).await?;
        let index_set: std::collections::BTreeSet<String> = file_changes
            .into_iter()
            .filter(|ev| ev.session_id == session_id)
            .map(|ev| ev.path)
            .filter(|p| !is_excluded(p))
            .collect();

        let cache = JournalCache::new(db);
        let journal_paths = cache.files_for_session(project_id, session_id).await?;
        let journal_set: std::collections::BTreeSet<String> = journal_paths
            .into_iter()
            .filter(|p| !is_excluded(p))
            .collect();

        let matched: Vec<String> = index_set.intersection(&journal_set).cloned().collect();
        let only_in_index: Vec<String> = index_set.difference(&journal_set).cloned().collect();
        let only_in_journal: Vec<String> = journal_set.difference(&index_set).cloned().collect();

        let union_count = index_set.union(&journal_set).count();
        let jaccard = if union_count == 0 {
            1.0
        } else {
            matched.len() as f32 / union_count as f32
        };
        let severity = severity_from_jaccard(jaccard, union_count);

        Ok(LayerComparison {
            session_id: session_id.to_string(),
            workday,
            index_files: index_set.into_iter().collect(),
            journal_files: journal_set.into_iter().collect(),
            matched,
            only_in_index,
            only_in_journal,
            mismatch_severity: severity,
            jaccard_index: jaccard,
        })
    }

    /// Read-only adapter heuristic — backs the Settings "감지" button + the
    /// Greenfield wizard's default active set.
    pub async fn detect_agents(&self, project_id: u32) -> Result<Vec<AgentDetection>, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            entry.root.clone()
        };
        Ok(agents::detect(&root))
    }

    /// Return the on-disk master template (`.oculpm/agents/_template.md`).
    /// Falls back to the embedded `MASTER_KO` if the file is missing — this
    /// lets the UI's "프롬프트 복사" action work even before the first sync
    /// has written the template to disk.
    pub async fn read_master_template(
        &self,
        project_id: u32,
    ) -> Result<String, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            entry.root.clone()
        };
        let path = root.join(".oculpm").join("agents").join("_template.md");
        match tokio::fs::read_to_string(&path).await {
            Ok(text) => Ok(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Ok(agents::MASTER_KO.to_string())
            }
            Err(source) => Err(OculpmError::Io { path, source }),
        }
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
        let redact = self.redact_patterns(project_id).await;
        let report = JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .reindex_full(project_id, &journal_root)
            .await?;
        Ok(reindex_report_to_spec(project_id, report))
    }

    /// W4 dogfooding follow-up (2026-05-26) — mtime-keyed incremental reindex.
    /// Cheap to call on every project open: files whose mtime matches the
    /// cached row are skipped (no parse, no upsert). Surfaces files that were
    /// created on disk while the app was closed (external LLM ran without the
    /// watcher running) so they appear in TodayScreen without the user having
    /// to click "재인덱스".
    ///
    /// Returns the report shape so the caller can decide whether to surface
    /// a "X entries imported" toast or log only.
    pub async fn reindex_journal_cache_incremental(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<ReindexReport, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let redact = self.redact_patterns(project_id).await;
        let report = JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .reindex_incremental(project_id, &journal_root)
            .await?;
        Ok(reindex_report_to_spec(project_id, report))
    }

    // ─── F5: git-history backfill ───────────────────────────────────────────

    /// Synthesise one journal entry per recent git commit so a repo with rich
    /// history but an empty `.oculpm/journal/` isn't a blank wall on day 1
    /// (the cold-start cliff). Idempotent: a durable sidecar of processed
    /// commit SHAs (`.oculpm/index/git-backfill.json`) means re-running only
    /// adds new commits. Each entry's per-file diff is captured via
    /// `entry_diffs` — its tier-3 nearest-commit path finds exactly this
    /// commit — and masked; the narrative body is redacted at write.
    /// `max_commits` caps the scan (clamped to 1..=2000).
    pub async fn backfill_from_git(
        &self,
        db: &Db,
        project_id: u32,
        max_commits: u32,
    ) -> Result<BackfillReport, OculpmError> {
        use std::collections::{HashMap, HashSet};

        let (root, resolver, language, redact_strings) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.root.clone(),
                entry.resolver.clone(),
                "ko".to_string(),
                entry.config.git.auto_redact_patterns.clone(),
            )
        };

        let cap = max_commits.clamp(1, 2000);
        let root2 = root.clone();
        let commits = tokio::task::spawn_blocking(move || crate::git::commits_for_backfill(&root2, cap))
            .await
            .map_err(|e| OculpmError::InvalidConfig(format!("git backfill task panicked: {e}")))?
            .map_err(OculpmError::InvalidConfig)?;

        let redact = compile_redact_patterns(&redact_strings);
        let tz = chrono_tz_from(&resolver);

        // Durable processed-SHA set for idempotency.
        let sidecar = root.join(".oculpm").join("index").join("git-backfill.json");
        let mut processed: HashSet<String> = std::fs::read(&sidecar)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
            .map(|v| v.into_iter().collect())
            .unwrap_or_default();

        let cache = JournalCache::new(db);
        let scanned = commits.len() as u32;
        let mut created = 0u32;
        let mut skipped = 0u32;

        // Oldest → newest so on-disk filenames read chronologically.
        for c in commits.iter().rev() {
            if processed.contains(&c.sha) {
                skipped += 1;
                continue;
            }
            let Some(commit_utc) = chrono::DateTime::from_timestamp(c.timestamp as i64, 0) else {
                continue;
            };
            let local = commit_utc.with_timezone(&tz);
            let workday = resolver.workday_of(commit_utc);
            let hhmm = format!("{:02}{:02}", local.hour(), local.minute());
            let entry_type = infer_entry_type(&c.subject);
            let slug = slug_from_subject(&c.subject, &c.short_sha);

            let files_touched: Vec<FileTouched> = c
                .files
                .iter()
                .map(|f| FileTouched {
                    path: f.path.clone(),
                    op: status_to_op(f.status),
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: f.rename_from.clone(),
                })
                .collect();

            let fm = JournalFrontmatter {
                schema_version: 1,
                entry_type,
                slug: slug.clone(),
                status: EntryStatus::Done,
                difficulty: None,
                created_at: local.to_rfc3339(),
                updated_at: None,
                session_id: format!(
                    "{workday}{}",
                    crate::oculpm::reconcile::GIT_BACKFILL_SESSION_SUFFIX
                ),
                agent: AgentRef {
                    id: infer_agent_id(&c.body),
                    version: None,
                },
                language: language.clone(),
                verified_by_user: false,
                files_touched: files_touched.clone(),
                related: Vec::new(),
                tags: vec!["git-backfill".to_string(), c.short_sha.clone()],
            };

            let title = c.subject.trim();
            let (body_masked, _hits) = redact_text(&c.body, &redact);
            let body_md = if body_masked.trim().is_empty() {
                format!("[x] {title}\n")
            } else {
                format!("[x] {title}\n\n{}\n", body_masked.trim())
            };
            let text = write_frontmatter_and_body(&fm, &body_md);

            let category_dir = resolver.journal_dir(&root, &workday, entry_type);
            if std::fs::create_dir_all(&category_dir).is_err() {
                continue;
            }
            let base = format!("{hhmm}_{}_{}", entry_type_filename_token(entry_type), slug);
            let (abs, file_name) = pick_nonconflicting_path(&category_dir, &base);
            if write_atomic(&abs, text.as_bytes()).is_err() {
                continue;
            }

            let relative_path = format!("{workday}/{}/{file_name}", category_subdir(entry_type));
            let mtime = std::fs::metadata(&abs)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or_else(|| commit_utc.timestamp());
            let (parsed, body_text) = parse_frontmatter_and_body(&text);
            let body_parsed = parse_body(&body_text);
            let _ = cache
                .upsert_entry(project_id, &relative_path, &parsed, &body_parsed, mtime, &text)
                .await;

            // Capture this commit's per-file diff (entry_diffs tier-3) + mask.
            let root3 = root.clone();
            let rel3 = relative_path.clone();
            let touched3 = files_touched.clone();
            let redact3 = redact.clone();
            let _ = tokio::task::spawn_blocking(move || {
                crate::oculpm::entry_diffs::capture_entry_diffs(
                    &root3,
                    &rel3,
                    &touched3,
                    &HashMap::new(),
                    &redact3,
                )
            })
            .await;

            processed.insert(c.sha.clone());
            created += 1;
        }

        // Persist the processed set (best-effort).
        if let Some(parent) = sidecar.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let list: Vec<String> = processed.into_iter().collect();
        if let Ok(json) = serde_json::to_vec(&list) {
            let _ = std::fs::write(&sidecar, json);
        }

        Ok(BackfillReport {
            project_id,
            scanned,
            created,
            skipped,
        })
    }

    // ─── W5-PR6: Observed agent ids ─────────────────────────────────────────

    /// Distinct agents that have actually written an entry. Drives the
    /// agent dropdown in `CategoryFilterBar`. Tolerant of uninitialized
    /// projects — returns `Ok(vec![])`.
    pub async fn observed_agent_ids(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<Vec<String>, OculpmError> {
        JournalCache::new(db).observed_agent_ids(project_id).await
    }

    // ─── W5-PR5: Overview stats ─────────────────────────────────────────────

    /// Single-shot Overview widgets fetch. `window_days` clamps to 1..=365 —
    /// the heatmap caps at ~90, but we allow 365 so a future "1년 보기" toggle
    /// works without a backend change.
    pub async fn overview_stats(
        &self,
        db: &Db,
        project_id: u32,
        window_days: u32,
    ) -> Result<OculpmOverviewStats, OculpmError> {
        let snapshot = self.project_snapshot(project_id).await?;
        let current_workday = snapshot.resolver.workday_of(chrono::Utc::now());
        let window = window_days.clamp(1, 365);
        JournalCache::new(db)
            .overview_stats(project_id, window, &current_workday)
            .await
    }

    /// Snapshot of a project's lazy-loaded state (root + resolver + config).
    /// Cloned so the caller can drop the read lock before doing IO.
    async fn project_snapshot(&self, project_id: u32) -> Result<ProjectSnapshot, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(ProjectSnapshot {
            root: entry.root.clone(),
            resolver: entry.resolver.clone(),
            config: entry.config.clone(),
        })
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
        let (root, resolver, language, forbid_patterns, redact_strings) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.root.clone(),
                entry.resolver.clone(),
                "ko".to_string(), // No top-level language field yet; default per spec.
                entry.config.git.forbid_journal_for_paths.clone(),
                entry.config.git.auto_redact_patterns.clone(),
            )
        };

        // W4-PR3 — reject the whole entry if any declared file_touched path is
        // in `git.forbid_journal_for_paths`. We check before any disk write so
        // a forbidden draft never produces a partial entry on disk; the
        // command layer is expected to translate this into an
        // `OculpmIntegrityWarning` toast for the user.
        if !forbid_patterns.is_empty() && !draft.files_touched.is_empty() {
            let matcher = build_forbidden_matcher(&root, &forbid_patterns);
            let hits: Vec<String> = draft
                .files_touched
                .iter()
                .filter(|ft| is_forbidden_path(&matcher, &ft.path))
                .map(|ft| ft.path.clone())
                .collect();
            if !hits.is_empty() {
                return Err(OculpmError::ForbiddenJournalPath { paths: hits });
            }
        }
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
            // PR-CI1 — 자동 초안(journal_draft)이 실측 에이전트를 넘긴다;
            // None(수동 모달)이면 기존 의미("manual", 사용자 검증 완료) 유지.
            agent: draft.agent.clone().unwrap_or(AgentRef {
                id: "manual".to_string(),
                version: None,
            }),
            language,
            verified_by_user: draft.verified_by_user.unwrap_or(true),
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
        // R1 — mask any secret the user pasted into the modal *before* it touches
        // disk, so a manual entry never persists a plaintext key (committing
        // `.oculpm/` to git would otherwise leak it). We author this file, so
        // at-write masking is correct here — unlike agent-authored entries, which
        // we mask only on cache projection to preserve their on-disk SSOT. The
        // returned entry carries the masked body, surfacing the redaction in the
        // modal without a separate toast. Frontmatter is left untouched (paths /
        // session_id never match a secret pattern; masking only the body avoids
        // any risk of corrupting the YAML).
        let redact = compile_redact_patterns(&redact_strings);
        let (body, _hits) = redact_text(&body, &redact);
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

/// W4 dogfooding (2026-05-27) — mirror of `watcher::is_self_suppressed` +
/// `watcher::is_agent_state_path`, applied retroactively in `compare_layers`
/// so ndjson entries captured before the watcher fix don't keep showing up
/// as `journal 누락`. Keep this list in sync with the watcher's two helpers.
fn is_noise_path(p: &str) -> bool {
    if p.ends_with(".tmp") || p.contains(".tmp.") {
        return true;
    }
    if p.ends_with(".swp") || p.ends_with(".swo") || p.ends_with('~') {
        return true;
    }
    let basename = p.rsplit('/').next().unwrap_or(p);
    if basename == ".DS_Store" || basename == "Thumbs.db" || basename.starts_with("._") {
        return true;
    }
    const AGENT_STATE_DIRS: &[&str] = &[
        ".claude/",
        ".cursor/",
        ".gemini/",
        ".codeium/",
        ".aider/",
        ".windsurf/",
        ".copilot/",
        ".continue/",
        ".agent/",
        ".qodo/",
        ".antigravity/",
    ];
    // An adapter file itself (e.g., `.claude/CLAUDE.md`) lives in one of these
    // dirs — but adapters never enter the ndjson pipeline (watcher returns at
    // step 4.5), so any path that DID reach the index from inside `.claude/`
    // is by definition not the adapter file. Filtering the whole prefix is
    // safe and intentionally symmetric with the watcher.
    AGENT_STATE_DIRS.iter().any(|d| p.starts_with(d))
}

/// W4-PR5 — bucket jaccard into the three-level severity. `union_count == 0`
/// (no activity at all on either side) collapses to `Ok` regardless of the
/// `1.0` jaccard we synthesised, so the UI doesn't trumpet a useless "in
/// sync" alert for sessions where nothing happened.
fn severity_from_jaccard(jaccard: f32, union_count: usize) -> Severity {
    if union_count == 0 {
        return Severity::Ok;
    }
    if jaccard >= 0.8 {
        Severity::Ok
    } else if jaccard >= 0.5 {
        Severity::Warning
    } else {
        Severity::Critical
    }
}

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

// ─── F5 git-backfill helpers ────────────────────────────────────────────────

/// Infer an entry type from a (conventional-commit) subject prefix.
fn infer_entry_type(subject: &str) -> EntryType {
    let prefix: String = subject
        .trim_start()
        .split([':', '(', ' ', '/'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match prefix.as_str() {
        "feat" | "feature" => EntryType::Feature,
        "fix" | "bug" | "bugfix" | "hotfix" => EntryType::Bug,
        "refactor" | "perf" | "style" => EntryType::Refactor,
        _ => EntryType::Chore,
    }
}

/// Build a valid `[a-z0-9-]{1,60}` slug from a commit subject (stripping a
/// conventional-commit `type(scope): ` prefix), falling back to
/// `commit-<short_sha>` when the subject is non-ASCII (e.g. Korean) or yields
/// nothing. Always satisfies [`validate_slug`].
fn slug_from_subject(subject: &str, short_sha: &str) -> String {
    let body = subject.splitn(2, ':').nth(1).unwrap_or(subject);
    let mut out = String::new();
    let mut dash = false;
    for c in body.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        format!("commit-{short_sha}")
    } else {
        s
    }
}

/// Heuristic agent attribution from a commit body's trailers / co-author lines.
fn infer_agent_id(body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    // v2 U4 — 짧거나 흔한 이름(zed⊂optimized, cline⊂decline 등)은 부분 문자열
    // 매치가 오탐하므로 단어 단위로 본다.
    let has_word = |w: &str| {
        lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|t| t == w)
    };
    if lower.contains("claude") {
        "claude-code".to_string()
    } else if lower.contains("cursor") {
        "cursor".to_string()
    } else if lower.contains("antigravity") {
        "antigravity".to_string()
    } else if lower.contains("gemini") {
        "gemini-cli".to_string()
    } else if has_word("copilot") {
        "copilot".to_string()
    } else if has_word("codex") {
        "codex".to_string()
    } else if has_word("windsurf") {
        "windsurf".to_string()
    } else if has_word("aider") {
        "aider".to_string()
    } else if has_word("cline") {
        "cline".to_string()
    } else if has_word("zed") {
        "zed".to_string()
    } else {
        "git".to_string()
    }
}

/// Map a git name-status code to a journal `FileOp`.
fn status_to_op(status: char) -> FileOp {
    match status {
        'A' | 'C' => FileOp::Create,
        'D' => FileOp::Delete,
        'R' => FileOp::Rename,
        _ => FileOp::Update,
    }
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

    /// F7a-B Unit B — "원본 고치기": the tz-offset coercion is written into the
    /// on-disk frontmatter exactly once, and re-running errors (nothing left to
    /// coerce). The body is preserved.
    #[tokio::test]
    async fn coerce_timestamps_writes_offset_to_disk_once() {
        let dir = tempdir().unwrap();
        let db = crate::db::Db::open(dir.path().join("test.db")).await.unwrap();
        let manager = OculpmManager::new();
        manager.init_project(1, dir.path()).await.unwrap();

        // A journal entry whose created_at lacks a tz offset.
        let rel = "20260524/Bugs/0925_bug_notz.md";
        let abs = dir.path().join(".oculpm/journal").join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        let content = "---\nschema_version: 1\ntype: bug\nslug: notz\nstatus: done\n\
                       created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
                       agent: { id: claude-code }\nlanguage: ko\n---\n[x] body line\n";
        std::fs::write(&abs, content).unwrap();

        let updated = manager
            .coerce_journal_entry_timestamps_on_disk(&db, 1, rel.to_string())
            .await
            .unwrap();
        // Returned (re-projected) entry carries the +09:00 offset…
        assert_eq!(updated.frontmatter.created_at, "2026-05-24T09:25:13+09:00");
        // …and so does the on-disk source file now (SSOT was rewritten once).
        let on_disk = std::fs::read_to_string(&abs).unwrap();
        assert!(
            on_disk.contains("2026-05-24T09:25:13+09:00"),
            "disk not coerced: {on_disk}"
        );
        // Body preserved.
        assert!(on_disk.contains("[x] body line"), "body lost: {on_disk}");

        // Re-running has nothing to coerce → error (idempotent guard).
        let again = manager
            .coerce_journal_entry_timestamps_on_disk(&db, 1, rel.to_string())
            .await;
        assert!(again.is_err(), "second coerce should error (already offset)");
    }

    /// N4 — the plan-write lock is one shared instance per project (so all
    /// writers contend on it), distinct across projects, and actually excludes.
    #[tokio::test]
    async fn plan_write_lock_is_shared_per_project() {
        let manager = OculpmManager::new();
        let a1 = manager.plan_write_lock(1).await;
        let a2 = manager.plan_write_lock(1).await;
        let b = manager.plan_write_lock(2).await;
        assert!(std::sync::Arc::ptr_eq(&a1, &a2), "same project shares one lock");
        assert!(!std::sync::Arc::ptr_eq(&a1, &b), "different projects differ");
        // Held lock blocks the shared handle (real mutual exclusion).
        let _g = a1.lock().await;
        assert!(a2.try_lock().is_err(), "held lock must block the shared handle");
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

    use crate::oculpm::spec::{EndedReason, FileChangeEvent, FileOp, Session};

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
            let db_path = dir.path().join("ocul-pm.db");
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
                agent: None,
                verified_by_user: None,
            }
        }

        /// PR-CI1 — 자동 초안의 실측 귀속 오버라이드: agent/verified_by_user 를
        /// draft 가 넘기면 그대로 frontmatter 에 쓰인다.
        #[tokio::test]
        async fn create_manual_entry_honours_agent_override() {
            let (manager, db, _dir, _project_root) = fresh_manager_and_db().await;
            let mut draft = minimal_draft("auto-draft-slug");
            draft.agent = Some(crate::oculpm::spec::AgentRef {
                id: "claude-code".to_string(),
                version: Some("claude-haiku-4-5-20251001".to_string()),
            });
            draft.verified_by_user = Some(false);
            let entry = manager
                .create_manual_journal_entry(&db, 7, draft)
                .await
                .expect("created");
            assert_eq!(entry.frontmatter.agent.id, "claude-code");
            assert_eq!(
                entry.frontmatter.agent.version.as_deref(),
                Some("claude-haiku-4-5-20251001")
            );
            assert!(!entry.frontmatter.verified_by_user);
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
        async fn create_manual_entry_masks_secret_in_body_at_write() {
            // R1: a user pastes a key into the modal. The on-disk markdown and
            // the returned entry must both carry [REDACTED], never the plaintext
            // — so committing `.oculpm/` can't leak it and the cache (→ AI) stays
            // clean. Uses the project's default `auto_redact_patterns`.
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let mut draft = minimal_draft("leaky");
            draft.body_markdown =
                "deploy key AKIAABCDEFGHIJKLMNOP do not share\n".to_string();
            let entry = manager
                .create_manual_journal_entry(&db, 7, draft)
                .await
                .expect("created");

            assert!(
                entry.body_markdown.contains("[REDACTED]"),
                "returned body should be masked: {}",
                entry.body_markdown
            );
            assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));

            let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
            let on_disk = std::fs::read_to_string(&abs).unwrap();
            assert!(on_disk.contains("[REDACTED]"), "disk should be masked: {on_disk}");
            assert!(
                !on_disk.contains("AKIAABCDEFGHIJKLMNOP"),
                "plaintext key must never reach disk"
            );
        }

        #[tokio::test]
        async fn update_journal_entry_body_masks_secret_on_disk_and_cache() {
            // R1: editing a body via the in-app editor is a WE-authored write, so
            // it masks at-write — disk, the returned entry, AND the cache row all
            // carry [REDACTED], never the plaintext.
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let entry = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("editme"))
                .await
                .expect("created");
            let updated = manager
                .update_journal_entry_body(
                    &db,
                    7,
                    entry.relative_path.clone(),
                    "edited body with ghp_abcdefghijklmnopqrstuvwxyz0123456789 token\n".to_string(),
                )
                .await
                .expect("updated");

            assert!(updated.body_markdown.contains("[REDACTED]"));
            assert!(!updated
                .body_markdown
                .contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));

            let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
            let on_disk = std::fs::read_to_string(&abs).unwrap();
            assert!(on_disk.contains("[REDACTED]"));
            assert!(!on_disk.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        }

        #[tokio::test]
        async fn set_journal_verified_keeps_agent_secret_masked_in_cache() {
            // R1 regression: a frontmatter-only edit must NOT re-pollute the cache
            // with an agent body's plaintext secret. The agent's on-disk body is
            // preserved (SSOT); the cache row stays masked (→ AI context clean).
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let rel = "20260524/Bugs/0925_bug_agent.md";
            let abs = project_root.join(".oculpm/journal").join(rel);
            std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
            // Agent-authored entry on disk with a secret in the body (NOT via the
            // masking manual-create path).
            let content = "---\nschema_version: 1\ntype: bug\nslug: agent-bug\nstatus: planned\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: { id: claude-code }\nlanguage: ko\n---\n[ ] agent did a thing\n\nleaked AKIAABCDEFGHIJKLMNOP oops\n";
            std::fs::write(&abs, content).unwrap();

            // Index (masks on projection).
            manager.reindex_journal_cache(&db, 7).await.unwrap();
            let cached = manager
                .get_journal_entry(&db, 7, rel.to_string())
                .await
                .unwrap()
                .expect("indexed");
            assert!(
                cached.body_markdown.contains("[REDACTED]"),
                "indexed body should be masked"
            );

            // Toggle verified — must NOT re-pollute the cache.
            manager
                .set_journal_verified(&db, 7, rel.to_string(), true)
                .await
                .unwrap();
            let after = manager
                .get_journal_entry(&db, 7, rel.to_string())
                .await
                .unwrap()
                .expect("still present");
            assert!(after.frontmatter.verified_by_user, "verified flag set");
            assert!(
                after.body_markdown.contains("[REDACTED]"),
                "cache must stay masked after a frontmatter-only edit"
            );
            assert!(
                !after.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"),
                "no plaintext re-pollution into the cache"
            );

            // Disk SSOT preserved — the agent's original body is untouched.
            let on_disk = std::fs::read_to_string(&abs).unwrap();
            assert!(
                on_disk.contains("AKIAABCDEFGHIJKLMNOP"),
                "agent's on-disk body is preserved (we never rewrite it)"
            );
        }

        #[tokio::test]
        async fn backfill_from_git_creates_typed_entries_and_is_idempotent() {
            // F5: a repo with git history but empty journal gets one entry per
            // commit, typed from the conventional-commit prefix, tagged
            // `git-backfill`, and a re-run adds nothing (idempotent).
            fn git(root: &std::path::Path, args: &[&str]) -> bool {
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(root)
                    .args(args)
                    .output()
                    .ok()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            if !git(&project_root, &["init", "-q"]) {
                return; // git unavailable → skip cleanly
            }
            git(&project_root, &["config", "user.email", "t@t.dev"]);
            git(&project_root, &["config", "user.name", "t"]);
            std::fs::write(project_root.join("a.rs"), "fn a() {}\n").unwrap();
            git(&project_root, &["add", "."]);
            git(&project_root, &["commit", "-qm", "feat: add a"]);
            std::fs::write(project_root.join("a.rs"), "fn a() { /* fixed */ }\n").unwrap();
            git(&project_root, &["add", "."]);
            git(&project_root, &["commit", "-qm", "fix: patch a"]);

            let report = manager.backfill_from_git(&db, 7, 50).await.expect("backfill");
            assert_eq!(report.created, 2, "two commits → two entries");
            assert_eq!(report.skipped, 0);

            let rows = manager
                .list_journal_entries(&db, 7, None, EntryFilters::default())
                .await
                .unwrap();
            assert_eq!(rows.len(), 2);
            assert!(rows.iter().any(|r| r.entry_type == EntryType::Feature), "feat → Feature");
            assert!(rows.iter().any(|r| r.entry_type == EntryType::Bug), "fix → Bug");
            assert!(rows.iter().all(|r| r.tags.contains(&"git-backfill".to_string())));

            // Idempotent re-run — nothing new.
            let report2 = manager.backfill_from_git(&db, 7, 50).await.expect("backfill 2");
            assert_eq!(report2.created, 0, "re-run creates nothing");
            assert_eq!(report2.skipped, 2);
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
            let db_path = dir.path().join("ocul-pm.db");
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

        // ─── W4-PR3 — forbidden files_touched reject ──────────────────────

        #[tokio::test]
        async fn create_manual_entry_rejects_forbidden_files_touched() {
            let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
            let mut draft = minimal_draft("with-secret");
            draft.files_touched = vec![
                crate::oculpm::spec::FileTouched {
                    path: "src/a.rs".to_string(),
                    op: crate::oculpm::spec::FileOp::Update,
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: None,
                },
                // `.env.local` is in default `forbid_journal_for_paths`
                // (`.env.*` + `**/.env.*`).
                crate::oculpm::spec::FileTouched {
                    path: "src/.env.local".to_string(),
                    op: crate::oculpm::spec::FileOp::Update,
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: None,
                },
            ];
            let res = manager.create_manual_journal_entry(&db, 7, draft).await;
            match res {
                Err(OculpmError::ForbiddenJournalPath { paths }) => {
                    assert_eq!(paths, vec!["src/.env.local".to_string()]);
                }
                other => panic!("expected ForbiddenJournalPath, got {other:?}"),
            }

            // No journal file should have been written.
            let journal_root = project_root.join(".oculpm/journal");
            if journal_root.exists() {
                let any_md = walkdir::WalkDir::new(&journal_root)
                    .into_iter()
                    .flatten()
                    .any(|e| e.path().extension().is_some_and(|ext| ext == "md"));
                assert!(!any_md, "no .md should have been written on rejection");
            }
        }

        #[tokio::test]
        async fn create_manual_entry_accepts_when_no_forbidden_paths() {
            let (manager, db, _dir, _root) = fresh_manager_and_db().await;
            // Sanity: a regular draft still succeeds (guards against false
            // positives in the new forbid check).
            let entry = manager
                .create_manual_journal_entry(&db, 7, minimal_draft("clean-path"))
                .await
                .expect("clean draft must succeed");
            assert_eq!(entry.frontmatter.slug, "clean-path");
        }
    }

    // ─── W4-PR4 — agent drift detection ────────────────────────────────────

    mod agent_drift_w4_pr4 {
        use super::*;

        /// Switch the active agent set on the in-memory project entry without
        /// running through `set_config` (which would validate + persist to
        /// disk). Tests only need the in-memory mutation.
        async fn activate(manager: &OculpmManager, project_id: u32, ids: &[&str]) {
            let mut projects = manager.projects.write().await;
            let entry = projects.get_mut(&project_id).unwrap();
            entry.config.agents.active = ids.iter().map(|s| s.to_string()).collect();
        }

        async fn fresh_with_active(active: &[&str]) -> (OculpmManager, Db, tempfile::TempDir, std::path::PathBuf) {
            let dir = tempfile::tempdir().unwrap();
            let db_path = dir.path().join("ocul-pm.db");
            let db = Db::open(db_path).await.expect("open db");
            let manager = OculpmManager::new();
            let project_root = dir.path().join("project");
            std::fs::create_dir_all(&project_root).unwrap();
            manager.init_project(7, &project_root).await.unwrap();
            activate(&manager, 7, active).await;
            (manager, db, dir, project_root)
        }

        /// (1) External edit of an Overwrite-mode adapter (`cursor`) ⇒
        /// `check_agent_drift` reports drift.
        #[tokio::test]
        async fn cursor_external_edit_is_detected_as_drift() {
            let (manager, db, _dir, root) = fresh_with_active(&["cursor"]).await;
            let report = manager.sync_agents(&db, 7).await.unwrap();
            // Sanity: cursor was actually written + baseline hash recorded.
            let cursor = report.results.iter().find(|r| r.id == "cursor").unwrap();
            assert!(cursor.last_hash.is_some());

            // User / external tool edits the file.
            let cursor_path = root.join(".cursor/rules/ocul-pm.mdc");
            let mut content = std::fs::read_to_string(&cursor_path).unwrap();
            content.push_str("\n# manual edit by user\n");
            std::fs::write(&cursor_path, &content).unwrap();

            let drift = manager
                .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
                .await
                .unwrap();
            let (agent_id, expected, actual) = drift.expect("expected drift after external edit");
            assert_eq!(agent_id, "cursor");
            assert_ne!(expected, actual);
            assert_eq!(expected, cursor.last_hash.clone().unwrap());
        }

        /// (2) Edits OUTSIDE the managed block (Claude Code adapter) ⇒
        /// `check_agent_drift` reports no drift (block hash unchanged).
        #[tokio::test]
        async fn claude_code_outside_block_edit_is_not_drift() {
            let (manager, db, _dir, root) = fresh_with_active(&["claude-code"]).await;
            // Pre-seed user content so the file has both pre/post-block regions.
            let path = root.join(".claude/CLAUDE.md");
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "# user header\n\n").unwrap();
            manager.sync_agents(&db, 7).await.unwrap();

            // Append user text AFTER the end marker — the block hash must stay.
            let mut text = std::fs::read_to_string(&path).unwrap();
            text.push_str("\n## My personal notes (outside block)\n");
            std::fs::write(&path, &text).unwrap();

            let drift = manager
                .check_agent_drift(&db, 7, ".claude/CLAUDE.md")
                .await
                .unwrap();
            assert!(drift.is_none(), "outside-block edit must not be drift, got {drift:?}");
        }

        /// (3) Edit INSIDE the managed block ⇒ drift detected.
        #[tokio::test]
        async fn claude_code_inside_block_edit_is_drift() {
            let (manager, db, _dir, root) = fresh_with_active(&["claude-code"]).await;
            manager.sync_agents(&db, 7).await.unwrap();

            // Insert one extra line between the begin/end markers.
            let path = root.join(".claude/CLAUDE.md");
            let text = std::fs::read_to_string(&path).unwrap();
            let begin = text.find("<!-- oculpm:begin v1 -->").unwrap();
            let end = text.find("<!-- oculpm:end -->").unwrap();
            // Inject a line right after the begin marker line.
            let begin_line_end = text[begin..].find('\n').map(|n| begin + n + 1).unwrap();
            assert!(begin_line_end < end);
            let mutated = format!(
                "{}# adversarial edit inside block\n{}",
                &text[..begin_line_end],
                &text[begin_line_end..]
            );
            std::fs::write(&path, mutated).unwrap();

            let drift = manager
                .check_agent_drift(&db, 7, ".claude/CLAUDE.md")
                .await
                .unwrap();
            let (agent_id, expected, actual) = drift.expect("inside-block edit must be drift");
            assert_eq!(agent_id, "claude-code");
            assert_ne!(expected, actual);
        }

        /// Re-syncing after drift writes a fresh baseline → next check passes.
        #[tokio::test]
        async fn resync_after_drift_clears_the_alert() {
            let (manager, db, _dir, root) = fresh_with_active(&["cursor"]).await;
            manager.sync_agents(&db, 7).await.unwrap();

            // Drift the file.
            let cursor_path = root.join(".cursor/rules/ocul-pm.mdc");
            std::fs::write(&cursor_path, "drifted\n").unwrap();
            assert!(manager
                .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
                .await
                .unwrap()
                .is_some());

            // User clicks 동기화 → sync_agents rewrites + reseeds the hash.
            manager.sync_agents(&db, 7).await.unwrap();
            let drift = manager
                .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
                .await
                .unwrap();
            assert!(drift.is_none(), "after resync no drift expected, got {drift:?}");
        }
    }

    // ─── W4-PR5 — compare_layers (index vs journal) ────────────────────────

    mod compare_layers_w4_pr5 {
        use super::*;
        use crate::oculpm::spec::{
            Difficulty, EntryStatus, EntryType, FileChangeEvent, FileOp, FileTouched,
            ManualEntryDraft, Severity,
        };

        const SESSION_ID: &str = "20260524-001";
        const WORKDAY: &str = "20260524";

        async fn fresh() -> (OculpmManager, Db, tempfile::TempDir, std::path::PathBuf) {
            let dir = tempfile::tempdir().unwrap();
            let db_path = dir.path().join("ocul-pm.db");
            let db = Db::open(db_path).await.expect("open db");
            let manager = OculpmManager::new();
            let project_root = dir.path().join("project");
            std::fs::create_dir_all(&project_root).unwrap();
            manager.init_project(7, &project_root).await.unwrap();
            (manager, db, dir, project_root)
        }

        async fn writer(manager: &OculpmManager) -> std::sync::Arc<IndexWriter> {
            manager.projects.read().await.get(&7).unwrap().index_writer.clone()
        }

        async fn append_index_events(manager: &OculpmManager, paths: &[&str]) {
            let writer = writer(manager).await;
            for p in paths {
                let ev = FileChangeEvent {
                    ts: "2026-05-24T10:00:00+00:00".to_string(),
                    session_id: SESSION_ID.to_string(),
                    op: FileOp::Update,
                    path: (*p).to_string(),
                    hash_before: None,
                    hash_after: None,
                    bytes: 10,
                };
                writer.append_file_change(&ev).await.expect("append");
            }
        }

        fn draft_with_files(slug: &str, paths: &[&str]) -> ManualEntryDraft {
            ManualEntryDraft {
                entry_type: EntryType::Bug,
                slug: slug.to_string(),
                title: "compare-layers seed".to_string(),
                difficulty: Some(Difficulty::Medium),
                body_markdown: String::new(),
                session_id: Some(SESSION_ID.to_string()),
                files_touched: paths
                    .iter()
                    .map(|p| FileTouched {
                        path: (*p).to_string(),
                        op: FileOp::Update,
                        bytes_added: None,
                        bytes_removed: None,
                        rename_from: None,
                    })
                    .collect(),
                status: Some(EntryStatus::Done),
                tags: Vec::new(),
                agent: None,
                verified_by_user: None,
            }
        }

        async fn seed_journal(manager: &OculpmManager, db: &Db, slug: &str, paths: &[&str]) {
            manager
                .create_manual_journal_entry(db, 7, draft_with_files(slug, paths))
                .await
                .expect("seed journal");
        }

        /// Both empty → trivially `Ok` with jaccard 1.0 (treated as "no
        /// activity nothing to disagree on" by the severity bucketer).
        #[tokio::test]
        async fn empty_session_is_ok() {
            let (manager, db, _dir, _root) = fresh().await;
            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(cmp.session_id, SESSION_ID);
            assert_eq!(cmp.workday, WORKDAY);
            assert!(cmp.index_files.is_empty());
            assert!(cmp.journal_files.is_empty());
            assert_eq!(cmp.mismatch_severity, Severity::Ok);
            assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
        }

        /// 10 / 10 perfect overlap → `Ok`, jaccard 1.0.
        #[tokio::test]
        async fn perfect_overlap_is_ok() {
            let (manager, db, _dir, _root) = fresh().await;
            let files: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
            let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
            append_index_events(&manager, &refs).await;
            seed_journal(&manager, &db, "perfect", &refs).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(cmp.matched.len(), 10);
            assert!(cmp.only_in_index.is_empty());
            assert!(cmp.only_in_journal.is_empty());
            assert_eq!(cmp.mismatch_severity, Severity::Ok);
            assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
        }

        /// 10 / 9 (9 matched, 1 missing narrative) → jaccard 9/10 = 0.9 → `Ok`.
        #[tokio::test]
        async fn near_perfect_is_ok() {
            let (manager, db, _dir, _root) = fresh().await;
            let index: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
            let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
            append_index_events(&manager, &index_refs).await;
            // Journal records 9 of the 10 — file_9 missing.
            let journal_refs: Vec<&str> = index_refs[..9].to_vec();
            seed_journal(&manager, &db, "near", &journal_refs).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(cmp.matched.len(), 9);
            assert_eq!(cmp.only_in_index, vec!["src/file_9.rs".to_string()]);
            assert!(cmp.only_in_journal.is_empty());
            assert_eq!(cmp.mismatch_severity, Severity::Ok);
            assert!((cmp.jaccard_index - 0.9).abs() < 0.01);
        }

        /// 8 / 8 with 6 matched + 2 hallucinated → jaccard 6 / (8 + 8 - 6) = 0.6
        /// → `Warning`.
        #[tokio::test]
        async fn moderate_mismatch_is_warning() {
            let (manager, db, _dir, _root) = fresh().await;
            let index: Vec<String> = (0..8).map(|i| format!("src/file_{i}.rs")).collect();
            let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
            append_index_events(&manager, &index_refs).await;
            // Journal: 6 matching + 2 hallucinated.
            let journal: Vec<String> = (0..6)
                .map(|i| format!("src/file_{i}.rs"))
                .chain(["src/hallucinated_a.rs".to_string(), "src/hallucinated_b.rs".to_string()])
                .collect();
            let journal_refs: Vec<&str> = journal.iter().map(|s| s.as_str()).collect();
            seed_journal(&manager, &db, "moderate", &journal_refs).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(cmp.matched.len(), 6);
            assert_eq!(cmp.only_in_index.len(), 2);
            assert_eq!(cmp.only_in_journal.len(), 2);
            assert_eq!(cmp.mismatch_severity, Severity::Warning);
            assert!(
                (cmp.jaccard_index - 0.6).abs() < 0.05,
                "jaccard {} not near 0.6",
                cmp.jaccard_index
            );
        }

        /// 10 / 5 with 4 matched + 1 hallucinated → jaccard 4/11 ≈ 0.36 →
        /// `Critical`.
        #[tokio::test]
        async fn heavy_mismatch_is_critical() {
            let (manager, db, _dir, _root) = fresh().await;
            let index: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
            let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
            append_index_events(&manager, &index_refs).await;
            // Journal: 4 matched + 1 hallucinated.
            let journal: Vec<String> = (0..4)
                .map(|i| format!("src/file_{i}.rs"))
                .chain(["src/hallucinated.rs".to_string()])
                .collect();
            let journal_refs: Vec<&str> = journal.iter().map(|s| s.as_str()).collect();
            seed_journal(&manager, &db, "heavy", &journal_refs).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(cmp.matched.len(), 4);
            assert_eq!(cmp.only_in_index.len(), 6);
            assert_eq!(cmp.only_in_journal, vec!["src/hallucinated.rs".to_string()]);
            assert_eq!(cmp.mismatch_severity, Severity::Critical);
        }

        /// Forbidden paths in EITHER set must be stripped before the
        /// comparison so they don't tank the jaccard. Without this, the index
        /// (which already masks forbidden paths via watcher) and the journal
        /// (which lists them verbatim) would always disagree.
        #[tokio::test]
        async fn forbidden_paths_are_excluded_from_both_sides() {
            let (manager, db, _dir, _root) = fresh().await;
            // Index has 3 real paths + 1 masked redacted entry (the watcher
            // would produce these for `.env` writes).
            let writer = writer(&manager).await;
            for p in &["src/a.rs", "src/b.rs", "src/c.rs", "**redacted/sensitive**:abcd1234"] {
                let ev = FileChangeEvent {
                    ts: "2026-05-24T10:00:00+00:00".to_string(),
                    session_id: SESSION_ID.to_string(),
                    op: FileOp::Update,
                    path: (*p).to_string(),
                    hash_before: None,
                    hash_after: None,
                    bytes: 10,
                };
                writer.append_file_change(&ev).await.unwrap();
            }
            // Journal: same 3 real paths only (no forbidden — they'd be
            // reject by create_manual_journal_entry per W4-PR3 anyway).
            seed_journal(&manager, &db, "stripped", &["src/a.rs", "src/b.rs", "src/c.rs"]).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            // Redacted path is stripped from index_files → exact match.
            assert_eq!(cmp.index_files.len(), 3);
            assert_eq!(cmp.matched.len(), 3);
            assert!(cmp.only_in_index.is_empty());
            assert!(cmp.only_in_journal.is_empty());
            assert_eq!(cmp.mismatch_severity, Severity::Ok);
        }

        /// W4 dogfooding (2026-05-27) — atomic-write tmps, editor noise, and
        /// agent-state peers must be stripped from the index side of the
        /// comparison so they don't manufacture fake `journal 누락` rows.
        /// Without this, the user's storygame session showed 18/3 with
        /// jaccard 17% even though all 3 real files were correctly journaled.
        #[tokio::test]
        async fn noise_paths_are_excluded_from_index_side() {
            let (manager, db, _dir, _root) = fresh().await;
            // Simulate a session that wrote one real file via 4 atomic-write
            // bursts (one rename target + 3 random-suffix tmp files), plus a
            // few `.claude/` state writes the agent did in the background.
            append_index_events(
                &manager,
                &[
                    "game.js",
                    "game.js.tmp.5C0aH-rJ",
                    "game.js.tmp.iy3-fa9",
                    "game.js.tmp.AbcDef1",
                    ".claude/settings.json",
                    ".claude/settings.local.json",
                    "src/main.rs.swp",
                    ".DS_Store",
                ],
            )
            .await;
            // Journal: the LLM correctly logs only the real file.
            seed_journal(&manager, &db, "noise", &["game.js"]).await;

            let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
            assert_eq!(
                cmp.index_files,
                vec!["game.js".to_string()],
                "noise must be stripped from the index side",
            );
            assert_eq!(cmp.matched.len(), 1);
            assert!(cmp.only_in_index.is_empty(), "{:?}", cmp.only_in_index);
            assert!(cmp.only_in_journal.is_empty());
            assert_eq!(cmp.mismatch_severity, Severity::Ok);
            assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
        }
    }

}

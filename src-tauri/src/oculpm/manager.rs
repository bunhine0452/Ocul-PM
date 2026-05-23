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

use tokio::sync::RwLock;

use crate::oculpm::atomic_io::{write_atomic, write_managed_block, ManagedBlockResult};
use crate::oculpm::error::OculpmError;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::lock::{LockAcquisition, LockGuard};
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::spec::{
    CommentStyle, EndedReason, LockStateView, OculpmConfig, OculpmInitReport, OculpmStatus,
    SessionEnd, WatcherStateView,
};

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
        if guard.is_some() {
            let index_writer = IndexWriter::new(root.to_path_buf(), resolver.clone());
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
}

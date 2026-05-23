//! `OculpmManager` — orchestrator for per-project `.oculpm/` lifecycle.
//!
//! W1-PR6 scope: project init (mkdir + .schema-version + config.toml + lock
//! acquire), per-project status, and config get/set. The watcher, session
//! actor, and `on_project_opened` / `on_project_closed` hooks land in W2 and
//! W1-PR7 respectively.
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
use crate::oculpm::lock::{LockAcquisition, LockGuard};
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::spec::{
    CommentStyle, LockStateView, OculpmConfig, OculpmInitReport, OculpmStatus, WatcherStateView,
};

/// `.gitignore` managed-block body. Matches `00-spec.md` §1.2.
const GITIGNORE_BLOCK_BODY: &str = "\
.oculpm/index/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
";

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
}

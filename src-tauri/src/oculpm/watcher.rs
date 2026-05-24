//! Filesystem watcher — W2-PR3.
//!
//! Wraps `notify-debouncer-full` and routes each batch through:
//!   1. self-suppress (our own `.oculpm/index/`, `.lock`, log, `*.tmp`),
//!   2. `.oculpm/agents/**` / `.oculpm/journal/**` → tauri event emit only,
//!   3. `watcher.ignore` glob + project `.gitignore`,
//!   4. classify into `FileOp` + blake3 hash (≤ 8 MB),
//!   5. `git.forbid_journal_for_paths` masking,
//!   6. `SessionActor::note_activity` (which stamps session_id + ts and
//!      writes the ndjson line),
//!   7. `oculpm:file_changed` emit.
//!
//! Threading model: `notify-debouncer-full` runs its own OS-watch thread;
//! we bridge its callback to a tokio `mpsc` channel and drain the channel in
//! a single tokio task. `stop` drops the debouncer (kills the OS thread) and
//! awaits the task (drains pending events).
//!
//! See `docs/major_update/oculpm/W2/PR3-watcher-notify.md`.

#![allow(dead_code)] // Consumed by W2-PR6 (commands) + W2 manager bootstrap.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap,
};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::db::Db;
use crate::oculpm::cache::{JournalCache, PathChangeKind};
use crate::oculpm::error::OculpmError;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::redact::{self, build_forbidden_matcher};
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{
    FileChangeEvent, FileOp, OculpmAgentsTemplateChanged, OculpmConfig, OculpmFileChanged,
    OculpmJournalPathChanged, WatcherStateView, WatcherStatus,
};

/// Files ≤ this byte cap get a blake3 hash; larger files leave `hash_after`
/// as `None` (consumers infer "large-file-hash-skipped" from the absence).
const HASH_BYTE_CAP: u64 = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────────

/// Active filesystem watcher for one project. Dropping or calling `stop`
/// halts the debouncer thread and ends the event-processing task.
pub struct ProjectWatcher {
    project_id: u32,
    /// `Option` so `stop` can `take()` and drop ahead of awaiting the task.
    debouncer: Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>,
    join_handle: JoinHandle<()>,
    stats: Arc<RwLock<WatcherStatsInner>>,
    debounce_ms: u32,
}

#[derive(Debug, Default)]
struct WatcherStatsInner {
    events_seen_total: u32,
    events_ignored_total: u32,
    last_event_at: Option<DateTime<Utc>>,
}

impl ProjectWatcher {
    /// Build the matchers, spawn the debouncer thread, and start the
    /// processing task. Returns once notify is registered and the receive
    /// loop is running.
    pub async fn start(
        project_id: u32,
        root: PathBuf,
        session: SessionActor,
        index_writer: Arc<IndexWriter>,
        config: OculpmConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<Self, OculpmError> {
        // Canonicalize so notify-reported paths (macOS resolves `/tmp` →
        // `/private/tmp`) compare cleanly against the stored root.
        let root = root.canonicalize().unwrap_or(root);

        let user_ignore = build_gitignore_from_lines(&root, &config.watcher.ignore);
        let project_gitignore = if config.watcher.respect_gitignore {
            load_project_gitignore(&root)
        } else {
            None
        };
        // Forbidden-path matcher delegated to `oculpm::redact` (W4-PR3) so the
        // watcher and `manager::create_manual_journal_entry` see the same
        // glob semantics — see `oculpm::redact::is_forbidden_path`.
        let forbidden = build_forbidden_matcher(&root, &config.git.forbid_journal_for_paths);

        let stats = Arc::new(RwLock::new(WatcherStatsInner::default()));
        let inner = WatcherInner {
            project_id,
            root: root.clone(),
            session,
            index_writer,
            app_handle,
            user_ignore,
            project_gitignore,
            forbidden,
            stats: stats.clone(),
        };

        // Bridge std/sync notify worker → tokio task.
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<DebounceEventResult>();
        let debounce_ms = config.watcher.debounce_ms;
        let mut debouncer = new_debouncer(
            Duration::from_millis(u64::from(debounce_ms)),
            None,
            move |result: DebounceEventResult| {
                // UnboundedSender::send is sync and can be called outside a
                // tokio runtime — perfect for the debouncer's worker thread.
                let _ = event_tx.send(result);
            },
        )
        .map_err(|e| OculpmError::Io {
            path: root.clone(),
            source: std::io::Error::other(format!("notify init: {e}")),
        })?;

        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| OculpmError::Io {
                path: root.clone(),
                source: std::io::Error::other(format!("notify watch: {e}")),
            })?;

        let join_handle = tokio::spawn(async move {
            while let Some(result) = event_rx.recv().await {
                match result {
                    Ok(events) => {
                        for ev in events {
                            inner.handle_event(ev).await;
                        }
                    }
                    Err(errs) => {
                        tracing::warn!(target: "oculpm::watcher", ?errs, "debouncer reported errors");
                    }
                }
            }
        });

        Ok(Self {
            project_id,
            debouncer: Some(debouncer),
            join_handle,
            stats,
            debounce_ms,
        })
    }

    /// Halt the OS watcher + drain pending events. Idempotent — calling
    /// `stop` twice is a no-op the second time.
    pub async fn stop(mut self) -> Result<(), OculpmError> {
        // Drop the debouncer first → its internal worker thread exits → the
        // event_tx captured in the callback drops → recv returns None → the
        // tokio task finishes after draining any buffered events.
        self.debouncer.take();
        self.join_handle
            .await
            .map_err(|_| OculpmError::ActorClosed)?;
        Ok(())
    }

    pub fn project_id(&self) -> u32 {
        self.project_id
    }

    pub fn status(&self) -> WatcherStatus {
        let stats = self.stats.read().unwrap();
        WatcherStatus {
            state: if self.debouncer.is_some() {
                WatcherStateView::Running
            } else {
                WatcherStateView::Stopped
            },
            events_seen_total: stats.events_seen_total,
            events_ignored_total: stats.events_ignored_total,
            last_event_at: stats.last_event_at.map(|t| t.to_rfc3339()),
            debounce_ms: self.debounce_ms,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner: event processing
// ─────────────────────────────────────────────────────────────────────────────

struct WatcherInner {
    project_id: u32,
    root: PathBuf,
    session: SessionActor,
    index_writer: Arc<IndexWriter>,
    app_handle: Option<tauri::AppHandle>,
    user_ignore: Gitignore,
    project_gitignore: Option<Gitignore>,
    forbidden: Gitignore,
    stats: Arc<RwLock<WatcherStatsInner>>,
}

impl WatcherInner {
    async fn handle_event(&self, ev: DebouncedEvent) {
        // notify emits one event per path-change; for renames the debouncer
        // batches Modify(Name(From)) + Modify(Name(To)) but we process them
        // one path at a time and let "file exists?" decide Create vs Delete.
        let path = match ev.event.paths.first() {
            Some(p) => p.clone(),
            None => return,
        };

        self.bump_seen();

        let rel_str = match path.strip_prefix(&self.root) {
            Ok(p) => p.to_string_lossy().to_string(),
            // Outside our watched root — ignore quietly.
            Err(_) => {
                self.bump_ignored();
                return;
            }
        };

        // 1. Self-suppress.
        if is_self_suppressed(&rel_str) {
            self.bump_ignored();
            return;
        }

        // 2. .oculpm/agents/** — emit + cascading re-sync of every active
        //    adapter. The cascade is what makes `_template.md` (master) the
        //    single source of truth: users edit one file and Cursor / Claude
        //    Code / etc. all get the new rules in one debounce window.
        //    Adapter writes themselves land outside `.oculpm/agents/` so
        //    there's no feedback loop. Idempotency in `sync_active` covers
        //    the spurious self-event when we wrote the master ourselves.
        if rel_str.starts_with(".oculpm/agents/") {
            self.emit_agents_template_changed(&rel_str);
            self.cascade_agents_resync().await;
            return;
        }

        // 3. .oculpm/journal/** — emit Tauri event AND invalidate the SQLite
        //    cache so list/get queries see the change without waiting for a
        //    manual reindex. Before this wire-up, the watcher only emitted
        //    the event and the frontend's refetch hit a stale cache (file
        //    deletes never disappeared from Today UI). See dogfooding F-2.
        if rel_str.starts_with(".oculpm/journal/") {
            let op = classify_journal_op(&ev.event.kind);
            self.emit_journal_path_changed(&rel_str, op);
            self.apply_journal_cache_invalidation(&rel_str, op).await;
            return;
        }

        // 4. config.toml — restart deferred to W4.
        if rel_str == ".oculpm/config.toml" {
            tracing::info!(
                target: "oculpm::watcher",
                "config.toml changed — watcher restart deferred to W4"
            );
            return;
        }

        // 5. Skip directories — we only track files.
        if path.is_dir() {
            self.bump_ignored();
            return;
        }

        // 6. ignore / gitignore filters.
        if !self.should_track(&path) {
            self.bump_ignored();
            return;
        }

        // 7. Classify + hash.
        let mut change = match self.classify(&path, &ev.event.kind).await {
            Some(c) => c,
            None => {
                self.bump_ignored();
                return;
            }
        };

        // 8. Forbidden-path masking.
        if self.is_forbidden(&path) {
            change.path = format!("**redacted/sensitive**:{}", short_hash_of(&change.path));
            change.hash_before = None;
            change.hash_after = None;
        }

        // 9. Route to session actor (which stamps session_id + ts and writes
        //    the ndjson line). Watcher leaves those fields empty.
        if let Err(e) = self.session.note_activity(change.clone()) {
            tracing::warn!(target: "oculpm::watcher", error = ?e, "session note_activity failed");
            return;
        }

        // 10. Emit file_changed.
        self.emit_file_changed(&change);
        self.touch_last_event_at();
    }

    fn should_track(&self, abs_path: &Path) -> bool {
        if self
            .user_ignore
            .matched_path_or_any_parents(abs_path, false)
            .is_ignore()
        {
            return false;
        }
        if let Some(gi) = &self.project_gitignore {
            if gi.matched_path_or_any_parents(abs_path, false).is_ignore() {
                return false;
            }
        }
        true
    }

    fn is_forbidden(&self, abs_path: &Path) -> bool {
        redact::is_forbidden_path(&self.forbidden, &abs_path.to_string_lossy())
    }

    async fn classify(&self, abs_path: &Path, kind: &EventKind) -> Option<FileChangeEvent> {
        use notify::event::ModifyKind;

        let exists = abs_path.is_file();
        let op = match kind {
            EventKind::Create(_) => FileOp::Create,
            EventKind::Remove(_) => FileOp::Delete,
            EventKind::Modify(ModifyKind::Name(_)) => {
                // Rename: split into Delete + Create across the batch — here
                // we just look at the path that this event references.
                if exists {
                    FileOp::Create
                } else {
                    FileOp::Delete
                }
            }
            EventKind::Modify(_) => FileOp::Update,
            // Access / Other / Any — ignored.
            _ => return None,
        };

        let rel = abs_path.strip_prefix(&self.root).ok()?;
        let rel_str = rel.to_string_lossy().to_string();

        let mut bytes_u: u32 = 0;
        let mut hash_after: Option<String> = None;
        if exists && !matches!(op, FileOp::Delete) {
            if let Ok(meta) = std::fs::metadata(abs_path) {
                let len = meta.len();
                bytes_u = u32::try_from(len).unwrap_or(u32::MAX);
                if len <= HASH_BYTE_CAP {
                    if let Ok(bytes) = std::fs::read(abs_path) {
                        hash_after = Some(format!("blake3:{}", blake3::hash(&bytes).to_hex()));
                    }
                }
                // Larger than cap → hash_after stays None. Consumers infer
                // "large-file-hash-skipped" from `bytes > HASH_BYTE_CAP && hash_after.is_none()`.
            }
        }

        Some(FileChangeEvent {
            ts: String::new(),         // stamped by SessionActor on append
            session_id: String::new(), // stamped by SessionActor on append
            op,
            path: rel_str,
            hash_before: None, // pre-event hash tracking is a W6 feature
            hash_after,
            bytes: bytes_u,
        })
    }

    // ─── Stats + emit helpers ───────────────────────────────────────────────

    fn bump_seen(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.events_seen_total = s.events_seen_total.saturating_add(1);
        }
    }

    fn bump_ignored(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.events_ignored_total = s.events_ignored_total.saturating_add(1);
        }
    }

    fn touch_last_event_at(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.last_event_at = Some(Utc::now());
        }
    }

    fn emit_file_changed(&self, event: &FileChangeEvent) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmFileChanged {
                project_id: self.project_id,
                event: event.clone(),
            }
            .emit(handle);
        }
    }

    fn emit_agents_template_changed(&self, relative_path: &str) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmAgentsTemplateChanged {
                project_id: self.project_id,
                relative_path: relative_path.to_string(),
            }
            .emit(handle);
        }
    }

    fn emit_journal_path_changed(&self, relative_path: &str, op: FileOp) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmJournalPathChanged {
                project_id: self.project_id,
                relative_path: relative_path.to_string(),
                op,
            }
            .emit(handle);
        }
    }

    /// Trigger a full agent-adapter re-sync (PR4 master-edit cascade). Same
    /// gating as `apply_journal_cache_invalidation` — `app_handle: None`
    /// makes this a no-op so existing unit tests stay self-contained.
    /// Failures are logged but never escalated; the next `sync_agents` call
    /// (Settings save / next agents edit) will retry.
    async fn cascade_agents_resync(&self) {
        let Some(handle) = &self.app_handle else { return };
        use tauri::Manager;
        let manager: tauri::State<'_, OculpmManager> = handle.state::<OculpmManager>();
        if let Err(e) = manager.sync_agents(self.project_id).await {
            tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                error = %e,
                "agents cascade resync failed"
            );
        }
    }

    /// Mirror a `.oculpm/journal/**` change into the SQLite cache so the next
    /// `oculpm_list_journal_entries` reflects it. Gated on `app_handle` (the
    /// only path to the process-wide `Db` state) so unit tests that pass
    /// `app_handle: None` stay self-contained — see `setup_with_config`.
    ///
    /// `full_rel_str` is relative to the project root and starts with
    /// `.oculpm/journal/`; we strip that prefix to get the cache-key form
    /// (`<workday>/<Category>/<file>.md`).
    async fn apply_journal_cache_invalidation(&self, full_rel_str: &str, op: FileOp) {
        let Some(handle) = &self.app_handle else { return };
        let Some(entry_rel) = full_rel_str.strip_prefix(".oculpm/journal/") else { return };
        if !is_journal_entry_path(entry_rel) {
            return;
        }
        use tauri::Manager;

        // Resolve PathChangeKind from FS reality, not from the event op alone.
        // See `resolve_path_change_kind` for the rationale + macOS quirks.
        let journal_root = self.root.join(".oculpm").join("journal");
        let abs = journal_root.join(entry_rel);
        let exists = abs.is_file();
        let kind = resolve_path_change_kind(op, exists);

        let db_state: tauri::State<'_, Db> = handle.state::<Db>();
        let cache = JournalCache::new(&db_state);
        match cache
            .apply_path_change(self.project_id, &journal_root, entry_rel, kind)
            .await
        {
            Ok(()) => {
                tracing::debug!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    ?kind,
                    raw_op = ?op,
                    "journal cache invalidated"
                );
            }
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    ?kind,
                    raw_op = ?op,
                    error = %e,
                    "journal cache invalidation failed (event still emitted)"
                );
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Paths the watcher must never report to avoid amplifying its own writes.
fn is_self_suppressed(rel_str: &str) -> bool {
    rel_str.starts_with(".oculpm/index/")
        || rel_str == ".oculpm/.lock"
        || rel_str == ".oculpm/oculpm.log"
        || rel_str.ends_with(".tmp")
}

/// Map a notify [`FileOp`] + disk-existence into a [`PathChangeKind`] that
/// the cache layer can act on. We trust the filesystem over the event:
///
/// - **macOS FSEvents** frequently collapses removes into `EventKind::Modify(Any)`
///   (especially when the deleted file's parent dir mutates in the same
///   debounce window). Trusting `op` alone leaves stale cache rows when the
///   user deletes a journal file from Finder.
/// - A race where Create fires for a path that was immediately deleted
///   (`exists == false`) also resolves to `Removed` — the cache delete is
///   idempotent so a no-op is the worst case.
///
/// When the file does exist, `Create` keeps its semantics and everything
/// else (Update / Delete-but-still-there / Rename / Correct) becomes
/// `Modified` so the cache re-reads the new content.
fn resolve_path_change_kind(op: FileOp, exists: bool) -> PathChangeKind {
    if !exists {
        return PathChangeKind::Removed;
    }
    match op {
        FileOp::Create => PathChangeKind::Created,
        _ => PathChangeKind::Modified,
    }
}

/// True when `entry_rel` (relative to `.oculpm/journal/`) names a real
/// journal entry — matches the skip rules in `cache::walk_journal` so the
/// watcher never tries to insert `_template.md`, `_attachments/`, or hidden
/// files into the SQLite cache.
fn is_journal_entry_path(entry_rel: &str) -> bool {
    if !entry_rel.ends_with(".md") {
        return false;
    }
    if entry_rel.starts_with('_') {
        return false;
    }
    if entry_rel.contains("/_attachments/") {
        return false;
    }
    if entry_rel.split('/').any(|seg| seg.starts_with('.')) {
        return false;
    }
    true
}

fn classify_journal_op(kind: &EventKind) -> FileOp {
    match kind {
        EventKind::Create(_) => FileOp::Create,
        EventKind::Remove(_) => FileOp::Delete,
        _ => FileOp::Update,
    }
}

fn build_gitignore_from_lines(root: &Path, lines: &[String]) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    for line in lines {
        let _ = builder.add_line(None, line);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn load_project_gitignore(root: &Path) -> Option<Gitignore> {
    let gi_path = root.join(".gitignore");
    if !gi_path.exists() {
        return None;
    }
    let (gi, _err) = Gitignore::new(&gi_path);
    Some(gi)
}

fn short_hash_of(input: &str) -> String {
    let full = blake3::hash(input.as_bytes()).to_hex().to_string();
    full[..8].to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W2/PR3-watcher-notify.md` §7.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::paths::WorkdayResolver;
    use crate::oculpm::spec::OculpmConfig;
    use tempfile::TempDir;
    use tokio::time::sleep;

    /// Most tests use a 150ms debounce + 350ms wait to keep wall-clock short.
    fn fast_config() -> OculpmConfig {
        let mut cfg = OculpmConfig::default_for_new_project();
        cfg.watcher.debounce_ms = 150;
        // Make sure node_modules / .git are in the default ignore set.
        cfg
    }

    fn today_workday(resolver: &WorkdayResolver) -> String {
        resolver.workday_of(Utc::now())
    }

    struct Setup {
        dir: TempDir,
        resolver: WorkdayResolver,
        writer: Arc<IndexWriter>,
        actor: SessionActor,
        watcher: ProjectWatcher,
    }

    async fn setup_with_config(cfg: OculpmConfig) -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        let writer = Arc::new(IndexWriter::new(
            dir.path().to_path_buf(),
            resolver.clone(),
        ));
        let actor = SessionActor::spawn(
            1,
            resolver.clone(),
            writer.clone(),
            cfg.session.clone(),
            None,
        );
        let watcher = ProjectWatcher::start(
            1,
            dir.path().to_path_buf(),
            actor.clone(),
            writer.clone(),
            cfg,
            None,
        )
        .await
        .unwrap();

        // Give notify a moment to install the FSEvents subscription on macOS.
        sleep(Duration::from_millis(150)).await;

        Setup {
            dir,
            resolver,
            writer,
            actor,
            watcher,
        }
    }

    async fn setup() -> Setup {
        setup_with_config(fast_config()).await
    }

    async fn settle() {
        sleep(Duration::from_millis(450)).await;
    }

    /// Case 1 — five distinct files modified → five ndjson events emitted.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn five_file_modifications_produce_five_ndjson_events() {
        let s = setup().await;
        for i in 0..5 {
            std::fs::write(
                s.dir.path().join(format!("file_{i}.rs")),
                format!("content-{i}"),
            )
            .unwrap();
        }
        settle().await;
        // Stop the watcher cleanly before reading (drains queued events).
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let paths: std::collections::HashSet<_> =
            events.iter().map(|e| e.path.as_str()).collect();
        for i in 0..5 {
            assert!(
                paths.contains(format!("file_{i}.rs").as_str()),
                "missing file_{i}.rs in {paths:?}"
            );
        }
    }

    /// Case 2 — node_modules is gitignored by default; events there must not
    /// produce ndjson rows.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn gitignored_paths_are_ignored() {
        // We need a project .gitignore that excludes node_modules. Build the
        // config first so respect_gitignore=true picks it up at watcher start.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules")).unwrap();

        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        let writer = Arc::new(IndexWriter::new(
            dir.path().to_path_buf(),
            resolver.clone(),
        ));
        let cfg = fast_config();
        let actor = SessionActor::spawn(
            1,
            resolver.clone(),
            writer.clone(),
            cfg.session.clone(),
            None,
        );
        let watcher = ProjectWatcher::start(
            1,
            dir.path().to_path_buf(),
            actor.clone(),
            writer.clone(),
            cfg,
            None,
        )
        .await
        .unwrap();
        sleep(Duration::from_millis(150)).await;

        std::fs::write(dir.path().join("node_modules/foo.js"), "data").unwrap();
        settle().await;
        watcher.stop().await.unwrap();
        actor.shutdown().await.unwrap();

        let events = writer
            .read_file_changes(&today_workday(&resolver), None)
            .await
            .unwrap();
        let in_node_modules: Vec<_> = events
            .iter()
            .filter(|e| e.path.starts_with("node_modules/"))
            .collect();
        assert!(
            in_node_modules.is_empty(),
            "node_modules events leaked: {in_node_modules:?}"
        );
    }

    /// Case 3 — `.env` is in `forbid_journal_for_paths` by default; the path
    /// is masked + hash fields are nulled.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn forbidden_paths_are_masked() {
        let mut cfg = fast_config();
        cfg.git.forbid_journal_for_paths = vec![".env".into(), ".env.*".into()];
        let s = setup_with_config(cfg).await;
        std::fs::write(s.dir.path().join(".env"), "API_KEY=secret").unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let env_event = events
            .iter()
            .find(|e| e.path.starts_with("**redacted/sensitive**:"))
            .expect("a redacted entry must exist for .env");
        assert!(env_event.hash_after.is_none(), "hash must be nulled");
        // No raw `.env` should appear.
        assert!(events.iter().all(|e| e.path != ".env"));
    }

    /// Case 4 — five rapid writes to the same file → debouncer collapses to
    /// one ndjson event (path appears once).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rapid_writes_to_same_file_debounced_to_one() {
        let s = setup().await;
        let target = s.dir.path().join("hot.rs");
        for i in 0..5 {
            std::fs::write(&target, format!("v{i}")).unwrap();
            sleep(Duration::from_millis(20)).await;
        }
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let hot: Vec<_> = events.iter().filter(|e| e.path == "hot.rs").collect();
        assert_eq!(hot.len(), 1, "expected debouncer to coalesce; got {hot:?}");
    }

    /// Case 5 — the session actor's own writes to `.oculpm/index/` must not
    /// boomerang back into ndjson via the watcher. After a single user-file
    /// write we expect exactly one event for that file (no `.oculpm/`-derived
    /// extras).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn self_writes_are_suppressed() {
        let s = setup().await;
        std::fs::write(s.dir.path().join("user.rs"), "content").unwrap();
        settle().await;
        // Let any spurious .oculpm/ events have a second chance.
        sleep(Duration::from_millis(300)).await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        // No event should reference a .oculpm/ path — the watcher must have
        // self-suppressed our own ndjson + sessions.json writes.
        for ev in &events {
            assert!(
                !ev.path.starts_with(".oculpm/"),
                "self-write leaked: {}",
                ev.path
            );
        }
        assert!(
            events.iter().any(|e| e.path == "user.rs"),
            "user.rs event must be present"
        );
    }

    /// Case 6 — a 9 MB file exceeds `HASH_BYTE_CAP` (8 MB) so `hash_after`
    /// stays `None`; `bytes` still reflects the size.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn large_files_skip_hashing() {
        let s = setup().await;
        let payload = vec![0u8; 9 * 1024 * 1024];
        std::fs::write(s.dir.path().join("big.bin"), &payload).unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let big = events
            .iter()
            .find(|e| e.path == "big.bin")
            .expect("big.bin event must exist");
        assert!(big.hash_after.is_none(), "large file must skip hashing");
        assert!(big.bytes >= 9 * 1024 * 1024, "bytes must reflect size");
    }

    /// Bonus — `status()` reflects running state + accumulated counters.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn status_reports_running_with_counters() {
        let s = setup().await;
        std::fs::write(s.dir.path().join("a.rs"), "data").unwrap();
        settle().await;
        let st = s.watcher.status();
        assert!(matches!(st.state, WatcherStateView::Running));
        assert!(st.events_seen_total >= 1);
        assert!(st.last_event_at.is_some());

        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();
    }

    // ─── W2-PR5 — Tauri event emit paths ───────────────────────────────────

    /// PR5 test 1 — `.oculpm/agents/_template.md` change triggers the
    /// agents_template_changed emit path (no panic with `app_handle: None`,
    /// not routed to session ndjson).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agents_template_change_emits_without_panic() {
        let s = setup().await;
        std::fs::create_dir_all(s.dir.path().join(".oculpm/agents")).unwrap();
        std::fs::write(
            s.dir.path().join(".oculpm/agents/_template.md"),
            "# template\n",
        )
        .unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        // agents/ changes must NOT appear in ndjson.
        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let agents_events: Vec<_> = events
            .iter()
            .filter(|e| e.path.contains("agents"))
            .collect();
        assert!(
            agents_events.is_empty(),
            "agents/ events must be emit-only, not in ndjson: {agents_events:?}"
        );
    }

    /// PR5 test 2 — `.oculpm/journal/<workday>/Bugs/foo.md` change triggers
    /// the journal_path_changed emit path (no panic, not routed to ndjson).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn journal_change_emits_without_panic() {
        let s = setup().await;
        let journal_dir = s.dir.path().join(".oculpm/journal/20260523/Bugs");
        std::fs::create_dir_all(&journal_dir).unwrap();
        std::fs::write(journal_dir.join("foo.md"), "# Bug report\n").unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let journal_events: Vec<_> = events
            .iter()
            .filter(|e| e.path.contains("journal"))
            .collect();
        assert!(
            journal_events.is_empty(),
            "journal/ events must be emit-only, not in ndjson: {journal_events:?}"
        );
    }

    // ─── F-2 fix — kind resolution + path filtering ────────────────────────

    #[test]
    fn resolve_path_change_kind_uses_filesystem_truth() {
        // The macOS FSEvents quirk: a Modify(Any) on a deleted file must
        // still drop the cache row. Same for Create races and explicit Delete.
        assert_eq!(
            resolve_path_change_kind(FileOp::Delete, false),
            PathChangeKind::Removed
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Update, false),
            PathChangeKind::Removed,
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Create, false),
            PathChangeKind::Removed,
        );
        // File exists → Create stays Created, everything else collapses to
        // Modified so the cache re-reads. A "Delete but the file still
        // exists" event (rare race) re-syncs as Modified, which is safe.
        assert_eq!(
            resolve_path_change_kind(FileOp::Create, true),
            PathChangeKind::Created
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Update, true),
            PathChangeKind::Modified
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Delete, true),
            PathChangeKind::Modified,
        );
    }

    #[test]
    fn is_journal_entry_path_matches_walk_journal_skip_rules() {
        // Real entries — must pass.
        assert!(is_journal_entry_path("20260524/Bugs/0925_bug_a.md"));
        assert!(is_journal_entry_path("20260524/Features_to_add/1000_feature.md"));

        // Skipped by cache::walk_journal — must fail.
        assert!(!is_journal_entry_path("_template.md"));
        assert!(!is_journal_entry_path("20260524/_attachments/note.md"));
        assert!(!is_journal_entry_path("20260524/Bugs/.draft.md"));
        assert!(!is_journal_entry_path("20260524/Bugs/0925_bug_a.txt"));
        assert!(!is_journal_entry_path("20260524/Bugs/"));
    }
}

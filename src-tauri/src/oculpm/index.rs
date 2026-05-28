//! `.oculpm/index/<workday>/` writer + reader (W2-PR1).
//!
//! Scope:
//! - `sessions.json`  — atomic upsert/finalize, `started_at` ASC sorted reads.
//! - `file_changes.ndjson` — append-only via `atomic_io::append_ndjson` with
//!   corrupted-tail recovery on read.
//! - `snapshot_{open,close}.json` — full snapshots, including `merkle_root`
//!   over blake3-hashed project files and best-effort git metadata.
//!
//! Every on-disk path is resolved through `WorkdayResolver` — no `.join`
//! string composition lives here. See `00-spec.md §4`.
//!
//! All public methods are `async fn` to match the W2 phase guide signatures,
//! even when the underlying syscalls are sync. This keeps callers (W2-PR2
//! `SessionActor`, W2-PR3 `Watcher`) in a uniform `.await` shape and gives us
//! room to migrate to `tokio::fs` later without churning callers.

#![allow(dead_code)] // Consumed by W2-PR2 + W2-PR3 + W2-PR6.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::{append_ndjson, write_atomic, NDJSON_LINE_CAP};
use crate::oculpm::error::OculpmError;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::spec::{
    FileChangeEvent, IntegrityWarning, OculpmIntegrityWarning, Session, SessionEnd, Snapshot,
    SnapshotGit, SnapshotKind, SnapshotTree,
};

const SCHEMA_VERSION: u32 = 1;

/// Per-project writer/reader for the `.oculpm/index/` tree. Cheap to clone —
/// holds only the project root + resolver + optional emit context.
#[derive(Clone)]
pub struct IndexWriter {
    root: PathBuf,
    resolver: WorkdayResolver,
    /// (project_id, AppHandle) — when set, integrity warnings (ndjson corruption,
    /// etc.) are emitted as `oculpm:integrity_warning` Tauri events. `None` in
    /// unit tests and pre-init callers.
    emit_ctx: Option<(u32, tauri::AppHandle)>,
}

// Manual Debug because `tauri::AppHandle` doesn't implement Debug.
impl std::fmt::Debug for IndexWriter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IndexWriter")
            .field("root", &self.root)
            .field("resolver", &self.resolver)
            .field("emit_ctx", &self.emit_ctx.as_ref().map(|(id, _)| id))
            .finish()
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionsFile {
    schema_version: u32,
    sessions: Vec<Session>,
}

impl IndexWriter {
    /// Build a writer bound to a project root + resolver. The root is not
    /// validated here — `ensure_workday_dirs` creates directories on demand.
    pub fn new(root: PathBuf, resolver: WorkdayResolver) -> Self {
        Self {
            root,
            resolver,
            emit_ctx: None,
        }
    }

    /// Attach an emit context so integrity warnings are emitted as Tauri events.
    /// Returns `self` for builder chaining.
    pub fn with_emit_ctx(mut self, project_id: u32, app_handle: tauri::AppHandle) -> Self {
        self.emit_ctx = Some((project_id, app_handle));
        self
    }

    /// `.oculpm/index/<workday>/` mkdir (idempotent).
    pub async fn ensure_workday_dirs(&self, workday: &str) -> Result<(), OculpmError> {
        let dir = self.resolver.index_dir(&self.root, workday);
        std::fs::create_dir_all(&dir).map_err(|source| OculpmError::Io { path: dir, source })
    }

    /// Insert-or-replace `session` in the workday's `sessions.json` (matched
    /// by `session.id`). Output is re-sorted by `started_at` ASC.
    pub async fn upsert_session(&self, session: &Session) -> Result<(), OculpmError> {
        let workday = workday_from_id(&session.id)?;
        self.ensure_workday_dirs(workday).await?;
        let path = self.sessions_path(workday);
        let mut file = self.read_sessions_file(&path)?;
        if let Some(slot) = file.sessions.iter_mut().find(|s| s.id == session.id) {
            *slot = session.clone();
        } else {
            file.sessions.push(session.clone());
        }
        file.sessions
            .sort_by(|a, b| a.started_at.cmp(&b.started_at));
        self.write_sessions_file(&path, &file)
    }

    /// Mark a session ended. Idempotent: if the session is already ended,
    /// returns the existing record unchanged (logged at debug).
    pub async fn finalize_session(
        &self,
        session_id: &str,
        end: SessionEnd,
    ) -> Result<Session, OculpmError> {
        let workday = workday_from_id(session_id)?;
        let path = self.sessions_path(workday);
        let mut file = self.read_sessions_file(&path)?;
        let session = file
            .sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| OculpmError::SessionNotFound {
                session_id: session_id.to_string(),
                workday: workday.to_string(),
            })?;

        if session.ended_at.is_some() {
            tracing::debug!(
                target: "oculpm::index",
                session_id,
                "finalize_session called on already-ended session — returning existing"
            );
            return Ok(session.clone());
        }

        session.ended_at = Some(end.ended_at);
        session.ended_reason = Some(end.ended_reason);
        let updated = session.clone();
        self.write_sessions_file(&path, &file)?;
        Ok(updated)
    }

    /// Clear `ended_at` / `ended_reason` / `git_head_at_end` so a session that
    /// finalize_session previously closed becomes Active again. Used by the
    /// session actor's **resume-within-grace** path (W4 dogfooding fix —
    /// external-agent re-entry was splitting one logical work unit into N
    /// sessions because InactivityFired closed the session every time the
    /// agent paused). Idempotent: calling on an already-active session is a
    /// no-op that returns the current record.
    pub async fn unfinalize_session(
        &self,
        session_id: &str,
    ) -> Result<Session, OculpmError> {
        let workday = workday_from_id(session_id)?;
        let path = self.sessions_path(workday);
        let mut file = self.read_sessions_file(&path)?;
        let session = file
            .sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| OculpmError::SessionNotFound {
                session_id: session_id.to_string(),
                workday: workday.to_string(),
            })?;

        if session.ended_at.is_none() {
            return Ok(session.clone());
        }
        session.ended_at = None;
        session.ended_reason = None;
        session.git_head_at_end = None;
        let updated = session.clone();
        self.write_sessions_file(&path, &file)?;
        Ok(updated)
    }

    /// All sessions for `workday`, sorted by `started_at` ASC. Missing file
    /// is treated as an empty array.
    pub async fn list_sessions(&self, workday: &str) -> Result<Vec<Session>, OculpmError> {
        let path = self.sessions_path(workday);
        Ok(self.read_sessions_file(&path)?.sessions)
    }

    /// Whether `snapshot_<kind>.json` exists for the given workday. Used by
    /// `SessionActor` to take `snapshot_open` only on the first activity of
    /// the workday (and `snapshot_close` only once per boundary).
    pub fn snapshot_exists(&self, workday: &str, kind: SnapshotKind) -> bool {
        self.snapshot_path(workday, kind).exists()
    }

    /// Current `HEAD` SHA via best-effort `git rev-parse HEAD`. `None` if the
    /// root is not a git repo or `git` is unavailable. Used by `SessionActor`
    /// to populate `git_head_at_start` / `git_head_at_end`.
    pub fn current_git_head(&self) -> Option<String> {
        run_git(&self.root, &["rev-parse", "HEAD"])
    }

    /// Append one `FileChangeEvent` as a single ndjson line. The workday is
    /// derived from `ev.session_id`. Lines that would exceed `NDJSON_LINE_CAP`
    /// are rejected — callers (Watcher) shorten `path` first.
    pub async fn append_file_change(&self, ev: &FileChangeEvent) -> Result<(), OculpmError> {
        let workday = workday_from_id(&ev.session_id)?;
        self.ensure_workday_dirs(workday).await?;
        let path = self.file_changes_path(workday);
        let line = serde_json::to_string(ev).map_err(OculpmError::JsonSerialize)?;
        if line.len() > NDJSON_LINE_CAP {
            return Err(OculpmError::NdjsonLineTooLarge(line.len(), NDJSON_LINE_CAP));
        }
        append_ndjson(&path, &line)
    }

    /// Read all `FileChangeEvent`s for `workday`. If `since` is provided,
    /// returns only events with `ts > since` (lexicographic compare on
    /// RFC3339-with-offset works as long as offset is consistent — within a
    /// workday, the project tz is fixed). A corrupted tail is backed up
    /// (`.corrupted-tail-<ts>`) and the file is truncated to the valid prefix.
    pub async fn read_file_changes(
        &self,
        workday: &str,
        since: Option<&str>,
    ) -> Result<Vec<FileChangeEvent>, OculpmError> {
        let path = self.file_changes_path(workday);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => return Err(OculpmError::Io { path, source }),
        };

        let mut valid: Vec<FileChangeEvent> = Vec::new();
        let mut valid_prefix_bytes: usize = 0;
        let mut corrupted_at: Option<usize> = None;
        for (idx, raw_line) in text.split('\n').enumerate() {
            // The final element after a trailing '\n' is empty — skip it
            // without treating as corrupt. Defensive: also strip a trailing
            // '\r' so CRLF-bytes from a foreign writer don't tank a line.
            if raw_line.is_empty() {
                continue;
            }
            let line = raw_line.trim_end_matches('\r');
            match serde_json::from_str::<FileChangeEvent>(line) {
                Ok(ev) => {
                    valid.push(ev);
                    // raw_line.len() is the unaltered byte length of the chunk
                    // before split; +1 for the '\n' we removed.
                    valid_prefix_bytes += raw_line.len() + 1;
                }
                Err(_) => {
                    corrupted_at = Some(idx);
                    break;
                }
            }
        }

        if let Some(idx) = corrupted_at {
            let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
            let backup = path.with_file_name(format!(
                "{}.corrupted-tail-{}",
                path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file_changes.ndjson"),
                stamp
            ));
            std::fs::copy(&path, &backup).map_err(|source| OculpmError::Io {
                path: backup.clone(),
                source,
            })?;
            write_atomic(&path, &text.as_bytes()[..valid_prefix_bytes])?;
            tracing::warn!(
                target: "oculpm::index",
                line_index = idx,
                backup = %backup.display(),
                "truncated corrupted ndjson tail"
            );
            // W2-PR5: emit integrity_warning to frontend.
            self.emit_integrity_warning(IntegrityWarning {
                kind: "ndjson_corrupted_tail".to_string(),
                path: path.display().to_string(),
                message: format!(
                    "Corrupted ndjson at line {idx}; tail backed up to {}",
                    backup.display()
                ),
            });
        }

        Ok(match since {
            Some(min_ts) => valid
                .into_iter()
                .filter(|ev| ev.ts.as_str() > min_ts)
                .collect(),
            None => valid,
        })
    }

    /// Read a previously-captured snapshot from disk. Returns `None` if the
    /// snapshot file does not exist for the given workday+kind.
    pub async fn read_snapshot(
        &self,
        workday: &str,
        kind: SnapshotKind,
    ) -> Result<Option<Snapshot>, OculpmError> {
        let path = self.snapshot_path(workday, kind);
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => return Err(OculpmError::Io { path, source }),
        };
        let snapshot: Snapshot =
            serde_json::from_slice(&bytes).map_err(OculpmError::JsonDeserialize)?;
        Ok(Some(snapshot))
    }

    /// Capture a full snapshot (git + tree merkle) and persist it as
    /// `snapshot_open.json` or `snapshot_close.json`. Git collection is
    /// best-effort — non-git roots get empty git fields. Always emits a
    /// `merkle_root`.
    pub async fn capture_snapshot(
        &self,
        workday: &str,
        kind: SnapshotKind,
    ) -> Result<Snapshot, OculpmError> {
        self.ensure_workday_dirs(workday).await?;

        let git = collect_git_info(&self.root);
        let tree_summary = compute_tree_summary(&self.root);
        let captured_at = chrono::Utc::now()
            .with_timezone(&self.resolver.tz)
            .to_rfc3339_opts(SecondsFormat::Secs, false);

        let snapshot = Snapshot {
            schema_version: SCHEMA_VERSION,
            captured_at,
            git,
            tree_summary,
        };

        let path = self.snapshot_path(workday, kind);
        let bytes = serde_json::to_vec_pretty(&snapshot).map_err(OculpmError::JsonSerialize)?;
        write_atomic(&path, &bytes)?;
        Ok(snapshot)
    }

    /// Timestamp of the last `FileChangeEvent` for `session_id` in `workday`.
    /// Reverse-scans the ndjson file so the cost is proportional to the
    /// distance from the end rather than the file size. Returns `None` if no
    /// matching event is found (e.g. zero-event session).
    pub async fn last_event_ts(
        &self,
        workday: &str,
        session_id: &str,
    ) -> Result<Option<String>, OculpmError> {
        let path = self.file_changes_path(workday);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => return Err(OculpmError::Io { path, source }),
        };

        // Reverse iterate lines for the first match.
        for raw_line in text.lines().rev() {
            let line = raw_line.trim_end_matches('\r');
            if line.is_empty() {
                continue;
            }
            if let Ok(ev) = serde_json::from_str::<FileChangeEvent>(line) {
                if ev.session_id == session_id {
                    return Ok(Some(ev.ts));
                }
            }
            // Skip corrupted lines silently — `read_file_changes` handles
            // backup/truncation; this method is read-only.
        }
        Ok(None)
    }

    /// All `YYYYMMDD` workday directory names under `.oculpm/index/`, sorted
    /// in descending order (most recent first). Used by crash recovery to
    /// enumerate recent workdays without knowing today's date a priori.
    pub async fn list_workdays(&self) -> Result<Vec<String>, OculpmError> {
        let index_root = self.resolver.project_oculpm_dir(&self.root).join("index");
        let entries = match std::fs::read_dir(&index_root) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => {
                return Err(OculpmError::Io {
                    path: index_root,
                    source,
                })
            }
        };

        let mut workdays: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|ft| ft.is_dir()))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                // Validate YYYYMMDD format: exactly 8 ASCII digits.
                if name.len() == 8 && name.bytes().all(|b| b.is_ascii_digit()) {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();

        workdays.sort_unstable_by(|a, b| b.cmp(a)); // descending
        Ok(workdays)
    }

    // ─── emit helpers ───────────────────────────────────────────────────────

    fn emit_integrity_warning(&self, warning: IntegrityWarning) {
        if let Some((project_id, handle)) = &self.emit_ctx {
            use tauri_specta::Event;
            let _ = OculpmIntegrityWarning {
                project_id: *project_id,
                warning,
            }
            .emit(handle);
        }
    }

    // ─── path helpers ───────────────────────────────────────────────────────

    fn sessions_path(&self, workday: &str) -> PathBuf {
        self.resolver
            .index_dir(&self.root, workday)
            .join("sessions.json")
    }

    fn file_changes_path(&self, workday: &str) -> PathBuf {
        self.resolver
            .index_dir(&self.root, workday)
            .join("file_changes.ndjson")
    }

    fn snapshot_path(&self, workday: &str, kind: SnapshotKind) -> PathBuf {
        let name = match kind {
            SnapshotKind::Open => "snapshot_open.json",
            SnapshotKind::Close => "snapshot_close.json",
        };
        self.resolver.index_dir(&self.root, workday).join(name)
    }

    fn read_sessions_file(&self, path: &Path) -> Result<SessionsFile, OculpmError> {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(|source| OculpmError::JsonParse {
                path: path.to_path_buf(),
                source,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SessionsFile {
                schema_version: SCHEMA_VERSION,
                sessions: Vec::new(),
            }),
            Err(source) => Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

    fn write_sessions_file(&self, path: &Path, file: &SessionsFile) -> Result<(), OculpmError> {
        let bytes = serde_json::to_vec_pretty(file).map_err(OculpmError::JsonSerialize)?;
        write_atomic(path, &bytes)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/// Session IDs are `YYYYMMDD-NNN` per `00-spec.md §4.2`. The first 8 chars
/// are the workday key.
fn workday_from_id(id: &str) -> Result<&str, OculpmError> {
    if id.len() >= 8 && id.as_bytes()[..8].iter().all(|b| b.is_ascii_digit()) {
        Ok(&id[..8])
    } else {
        Err(OculpmError::InvalidSessionId(id.to_string()))
    }
}

fn collect_git_info(root: &Path) -> SnapshotGit {
    let head_sha = run_git(root, &["rev-parse", "HEAD"]).unwrap_or_default();
    let branch = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let porcelain = run_git(root, &["status", "--porcelain"]).unwrap_or_default();
    let mut dirty_files = Vec::new();
    let mut untracked_files = Vec::new();
    for line in porcelain.lines() {
        // Porcelain format: `XY <path>` where XY is two status chars.
        if line.len() < 4 {
            continue;
        }
        let status = &line[..2];
        let path = line[3..].trim();
        if status == "??" {
            untracked_files.push(path.to_string());
        } else {
            dirty_files.push(path.to_string());
        }
    }
    SnapshotGit {
        head_sha,
        branch,
        dirty_files,
        untracked_files,
    }
}

fn run_git(root: &Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Walk the project root, hash each file with blake3, then compute
/// merkle_root = blake3(sorted_concat(per-file hex digest)). `.oculpm/` is
/// always excluded — our own state must not invalidate snapshots.
fn compute_tree_summary(root: &Path) -> SnapshotTree {
    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .build();

    let mut hashes: BTreeSet<String> = BTreeSet::new();
    let mut count: u32 = 0;
    for entry in walker.flatten() {
        let p = entry.path();
        // Defensive: even if standard_filters skipped `.oculpm/`, exclude it
        // explicitly so callers can disable filters without surprise.
        if p.components().any(|c| c.as_os_str() == ".oculpm") {
            continue;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(bytes) = std::fs::read(p) {
            hashes.insert(blake3::hash(&bytes).to_hex().to_string());
            count = count.saturating_add(1);
        }
    }
    let mut hasher = blake3::Hasher::new();
    for h in &hashes {
        hasher.update(h.as_bytes());
    }
    SnapshotTree {
        total_tracked_files: count,
        merkle_root: format!("blake3:{}", hasher.finalize().to_hex()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W2/PR1-index-writer.md` §4.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::{EndedReason, FileOp};
    use std::sync::Arc;
    use tempfile::tempdir;

    fn make_writer(root: &Path) -> IndexWriter {
        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        IndexWriter::new(root.to_path_buf(), resolver)
    }

    fn make_event(session_id: &str, seq: u32, path: &str) -> FileChangeEvent {
        FileChangeEvent {
            ts: format!("2026-05-22T20:55:{:02}.000+09:00", seq % 60),
            session_id: session_id.to_string(),
            op: FileOp::Update,
            path: path.to_string(),
            hash_before: Some("blake3:before".into()),
            hash_after: Some("blake3:after".into()),
            bytes: 1024 + seq,
        }
    }

    fn make_session(id: &str, started_at: &str) -> Session {
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

    /// Case 1 — append 100 events, read them back in order, payload byte-equal.
    #[tokio::test]
    async fn append_and_read_roundtrip_preserves_order() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        let sid = "20260522-001";
        for i in 0..100 {
            writer
                .append_file_change(&make_event(sid, i, &format!("src/file_{i}.rs")))
                .await
                .unwrap();
        }
        let events = writer.read_file_changes("20260522", None).await.unwrap();
        assert_eq!(events.len(), 100);
        for (i, ev) in events.iter().enumerate() {
            assert_eq!(ev.path, format!("src/file_{i}.rs"));
            assert_eq!(ev.bytes, 1024 + i as u32);
        }
    }

    /// Case 2 — corrupted last line is dropped + backed up; main file truncated.
    #[tokio::test]
    async fn corrupted_tail_is_backed_up_and_truncated() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        let sid = "20260522-001";
        writer
            .append_file_change(&make_event(sid, 0, "ok1.rs"))
            .await
            .unwrap();
        writer
            .append_file_change(&make_event(sid, 1, "ok2.rs"))
            .await
            .unwrap();

        // Append a half-written JSON line (no trailing '\n').
        let path = writer.file_changes_path("20260522");
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            f.write_all(b"{\"ts\":\"x\",\"session_id\"").unwrap();
        }

        let events = writer.read_file_changes("20260522", None).await.unwrap();
        assert_eq!(events.len(), 2, "corrupted tail must be dropped");
        assert_eq!(events[0].path, "ok1.rs");
        assert_eq!(events[1].path, "ok2.rs");

        // Main file shrunk to just the two valid lines.
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after.lines().count(), 2);

        // Backup exists with original (longer) content.
        let dir_path = path.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir_path)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains(".corrupted-tail-")
            })
            .collect();
        assert_eq!(backups.len(), 1, "exactly one backup must be created");
        let backup_bytes = std::fs::read(backups[0].path()).unwrap();
        assert!(
            backup_bytes.len() > after.len(),
            "backup must retain the full pre-truncation bytes"
        );
    }

    /// Case 3 — 10 tasks × 100 lines concurrent append: all 1000 lines land
    /// without interleaving (relies on POSIX O_APPEND single-write atomicity).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_append_does_not_lose_lines() {
        let dir = tempdir().unwrap();
        let writer = Arc::new(make_writer(dir.path()));
        let sid = "20260522-001";

        let mut handles = Vec::new();
        for task_id in 0..10u32 {
            let w = writer.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100u32 {
                    let ev = make_event(
                        sid,
                        task_id * 100 + i,
                        &format!("task{task_id}/file{i}.rs"),
                    );
                    w.append_file_change(&ev).await.unwrap();
                }
            }));
        }
        for h in handles {
            h.await.unwrap();
        }

        let events = writer.read_file_changes("20260522", None).await.unwrap();
        assert_eq!(events.len(), 1000, "all concurrent appends must persist");
    }

    /// Case 4 — merkle_root is deterministic for the same input; changes when
    /// any file changes.
    #[tokio::test]
    async fn snapshot_merkle_root_is_deterministic() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"alpha").unwrap();
        std::fs::write(dir.path().join("b.txt"), b"bravo").unwrap();
        std::fs::write(dir.path().join("c.txt"), b"charlie").unwrap();
        let writer = make_writer(dir.path());

        let s1 = writer
            .capture_snapshot("20260522", SnapshotKind::Open)
            .await
            .unwrap();
        let s2 = writer
            .capture_snapshot("20260522", SnapshotKind::Open)
            .await
            .unwrap();
        assert_eq!(s1.tree_summary.merkle_root, s2.tree_summary.merkle_root);
        assert_eq!(s1.tree_summary.total_tracked_files, 3);
        assert!(s1.tree_summary.merkle_root.starts_with("blake3:"));

        // Disk file persisted.
        assert!(dir
            .path()
            .join(".oculpm/index/20260522/snapshot_open.json")
            .exists());

        // Change a file → merkle changes.
        std::fs::write(dir.path().join("a.txt"), b"alpha-mutated").unwrap();
        let s3 = writer
            .capture_snapshot("20260522", SnapshotKind::Close)
            .await
            .unwrap();
        assert_ne!(s1.tree_summary.merkle_root, s3.tree_summary.merkle_root);
        assert!(dir
            .path()
            .join(".oculpm/index/20260522/snapshot_close.json")
            .exists());
    }

    /// Case 5 — sessions arrive in started_at-descending order; on-disk file
    /// stores them ASC.
    #[tokio::test]
    async fn upsert_session_sorts_by_started_at_asc() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        // Insert in non-monotonic order.
        writer
            .upsert_session(&make_session("20260522-002", "2026-05-22T11:00:00+09:00"))
            .await
            .unwrap();
        writer
            .upsert_session(&make_session("20260522-001", "2026-05-22T09:00:00+09:00"))
            .await
            .unwrap();
        writer
            .upsert_session(&make_session("20260522-003", "2026-05-22T13:00:00+09:00"))
            .await
            .unwrap();

        let sessions = writer.list_sessions("20260522").await.unwrap();
        let ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["20260522-001", "20260522-002", "20260522-003"]);
    }

    /// Case 6 — finalizing an already-ended session is idempotent: returns the
    /// existing record without overwriting ended_reason/ended_at.
    #[tokio::test]
    async fn finalize_session_is_idempotent_on_ended_session() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        writer
            .upsert_session(&make_session("20260522-001", "2026-05-22T09:00:00+09:00"))
            .await
            .unwrap();

        let first = writer
            .finalize_session(
                "20260522-001",
                SessionEnd {
                    ended_at: "2026-05-22T10:00:00+09:00".into(),
                    ended_reason: EndedReason::InactivityTimeout,
                },
            )
            .await
            .unwrap();
        assert_eq!(first.ended_at.as_deref(), Some("2026-05-22T10:00:00+09:00"));
        assert!(matches!(
            first.ended_reason,
            Some(EndedReason::InactivityTimeout)
        ));

        // Second call with a different reason — must NOT overwrite.
        let second = writer
            .finalize_session(
                "20260522-001",
                SessionEnd {
                    ended_at: "2026-05-22T12:34:56+09:00".into(),
                    ended_reason: EndedReason::AppQuit,
                },
            )
            .await
            .unwrap();
        assert_eq!(second.ended_at.as_deref(), Some("2026-05-22T10:00:00+09:00"));
        assert!(matches!(
            second.ended_reason,
            Some(EndedReason::InactivityTimeout)
        ));

        // Missing session → explicit SessionNotFound.
        let err = writer
            .finalize_session(
                "20260522-999",
                SessionEnd {
                    ended_at: "2026-05-22T13:00:00+09:00".into(),
                    ended_reason: EndedReason::Manual,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, OculpmError::SessionNotFound { .. }));
    }

    /// Case 7 — `since` filter returns only events strictly greater than the
    /// supplied timestamp.
    #[tokio::test]
    async fn read_file_changes_since_filter() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        let sid = "20260522-001";

        let make_ts = |sec: u32| -> FileChangeEvent {
            FileChangeEvent {
                ts: format!("2026-05-22T20:55:{:02}.000+09:00", sec),
                session_id: sid.into(),
                op: FileOp::Update,
                path: format!("f{sec}.rs"),
                hash_before: None,
                hash_after: None,
                bytes: 10,
            }
        };
        for sec in [1, 5, 10, 15, 20] {
            writer.append_file_change(&make_ts(sec)).await.unwrap();
        }

        let after_10 = writer
            .read_file_changes("20260522", Some("2026-05-22T20:55:10.000+09:00"))
            .await
            .unwrap();
        let paths: Vec<_> = after_10.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["f15.rs", "f20.rs"], "strictly greater than");
    }

    /// Bonus — invalid session_id format is rejected without touching disk.
    #[tokio::test]
    async fn invalid_session_id_is_rejected() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path());
        let bad = make_session("bogus", "2026-05-22T09:00:00+09:00");
        let err = writer.upsert_session(&bad).await.unwrap_err();
        assert!(matches!(err, OculpmError::InvalidSessionId(_)));
        // No directory created.
        assert!(!dir.path().join(".oculpm/index").exists());
    }

    // ─── W2-PR5 — integrity_warning emit path ──────────────────────────────

    /// PR5 test — corrupted ndjson triggers the integrity_warning emit path
    /// without panic when `emit_ctx` is `None`. The `emit_integrity_warning`
    /// helper is called but safely no-ops.
    #[tokio::test]
    async fn integrity_warning_emit_path_safe_without_app_handle() {
        let dir = tempdir().unwrap();
        let writer = make_writer(dir.path()); // emit_ctx = None
        let sid = "20260522-001";

        writer
            .append_file_change(&make_event(sid, 0, "ok.rs"))
            .await
            .unwrap();

        // Inject a corrupted line.
        let path = writer.file_changes_path("20260522");
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            f.write_all(b"NOT-JSON\n").unwrap();
        }

        // This must not panic even though emit_integrity_warning is called.
        let events = writer.read_file_changes("20260522", None).await.unwrap();
        assert_eq!(events.len(), 1, "only valid event survives");
        assert_eq!(events[0].path, "ok.rs");

        // Backup file created as evidence of corruption recovery.
        let dir_path = path.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir_path)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains(".corrupted-tail-")
            })
            .collect();
        assert_eq!(backups.len(), 1, "corruption backup must exist");
    }
}

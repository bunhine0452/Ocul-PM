//! W5-PR1 — migrate `changelog_entries` + `changelog_files` to `.oculpm/journal/`.
//!
//! SSOT: `docs/major_update/oculpm/W5/PR1-migrate-dry-run.md`.
//!
//! Two-phase contract:
//!
//! - [`dry_run`] reads SQLite + plans every target path, conflict resolution,
//!   forbidden-file filter, and the synthetic-session clustering. **Never
//!   touches disk.**
//! - [`execute`] takes the plan from `dry_run` (with optional user toggles on
//!   `will_skip`) and writes the journal markdown + appends sessions.ndjson +
//!   reindexes the cache. Creates a backup directory with a JSONL manifest
//!   first so PR2's `rollback` can undo every write.
//!
//! The watcher pause/resume + lock coordination live in PR3 (the Tauri command
//! wrapper) — this module is intentionally a pure-data orchestrator so unit
//! tests can drive it without a manager.

#![allow(dead_code)] // Consumed by PR2 (rollback) and PR3 (Tauri commands).

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::db::{ChangelogEntry, ChangelogFileEntry, Db};
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::write_frontmatter_and_body;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::redact::{build_forbidden_matcher, is_forbidden_path};
use crate::oculpm::spec::{
    AgentRef, ConflictResolution, EndedReason, EntryStatus, EntryType, FileOp, FileTouched,
    MigrationConflict, MigrationEntryPlan, MigrationFailure, MigrationPlan, MigrationProgress,
    MigrationReport, MigrationWorkdayPlan, OculpmConfig, RollbackReport, Session,
};

/// Markdown body cap. Anything longer is truncated and the entry gets
/// `tags: [body-truncated]` so the user can find them later.
const BODY_BYTE_CAP: usize = 64 * 1024;

/// Max slug length (kebab-case ASCII). Matches PR1 doc §3 step 3.
const SLUG_MAX_LEN: usize = 40;

/// Max attempts to disambiguate a target path via `slug__N` suffix before
/// declaring the entry skipped. Two collisions per minute is the realistic
/// worst case; we cap at __9 to keep filenames readable.
const MAX_SUFFIX_ATTEMPTS: u32 = 9;

/// Inactivity gap (seconds) that splits adjacent entries into separate
/// synthetic sessions. Matches PR1 doc §4 — "30 minutes".
const SESSION_GAP_SECONDS: i64 = 30 * 60;

/// Each entry's `estimated_bytes_written` adds this much padding to cover
/// the frontmatter YAML + spec.md §3 keys. Empirically frontmatter is
/// ~400-600 bytes; round up for safety.
const FRONTMATTER_BYTE_ESTIMATE: u32 = 800;

// ─────────────────────────────────────────────────────────────────────────────
// dry_run
// ─────────────────────────────────────────────────────────────────────────────

/// Build a [`MigrationPlan`] without touching the disk. Safe to call multiple
/// times; the result is fully serializable for the frontend modal.
pub async fn dry_run(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    config: &OculpmConfig,
) -> Result<MigrationPlan, OculpmError> {
    let entries = fetch_all_entries(db, project_id).await?;

    if entries.is_empty() {
        return Ok(empty_plan(project_id, root));
    }

    let forbidden_matcher = build_forbidden_matcher(root, &config.git.forbid_journal_for_paths);
    let journal_root = resolver.journal_root(root);

    // Group entries by workday so we can do session clustering + collision
    // detection per workday folder.
    let mut by_workday: BTreeMap<String, Vec<EntryWithFiles>> = BTreeMap::new();
    for ewf in entries {
        let workday = resolver.workday_of(unix_to_utc(ewf.entry.created_at));
        by_workday.entry(workday).or_default().push(ewf);
    }

    let mut workday_plans: Vec<MigrationWorkdayPlan> = Vec::new();
    let mut conflicts: Vec<MigrationConflict> = Vec::new();
    let mut forbidden_hits: u32 = 0;
    let mut estimated_bytes: u32 = 0;

    for (workday, mut entries) in by_workday {
        // Sort by created_at ASC so HHMM ordering is deterministic and
        // session clustering walks entries chronologically.
        entries.sort_by_key(|e| e.entry.created_at);

        let sessions = cluster_sessions(&workday, &entries);

        let mut used_paths: HashSet<String> = HashSet::new();
        let mut plan_entries: Vec<MigrationEntryPlan> = Vec::with_capacity(entries.len());

        for (idx, ewf) in entries.iter().enumerate() {
            let entry = &ewf.entry;
            let utc = unix_to_utc(entry.created_at);
            let hhmm = resolver.hhmm_of(utc);
            let type_inferred = infer_type(entry.category.as_deref(), title_or_intent(entry));
            let slug = make_slug(entry);
            let session_id = sessions
                .iter()
                .find(|s| s.contains_index(idx))
                .map(|s| s.id.clone())
                .unwrap_or_else(|| format!("{workday}-m01"));

            let mut forbidden_files: Vec<String> = Vec::new();
            for f in &ewf.files {
                if is_forbidden_path(&forbidden_matcher, &f.file_path) {
                    forbidden_files.push(f.file_path.clone());
                }
            }
            if !forbidden_files.is_empty() {
                forbidden_hits = forbidden_hits.saturating_add(forbidden_files.len() as u32);
            }

            // Resolve conflicts inside the plan + against disk.
            let (final_path, resolution) = resolve_target_path(
                &journal_root,
                &workday,
                type_inferred,
                &hhmm,
                &slug,
                &mut used_paths,
            );

            if let Some(res) = resolution {
                conflicts.push(MigrationConflict {
                    source_entry_id: entry.id,
                    conflicting_target_path: final_path.clone(),
                    resolution: res,
                });
            }

            let will_skip = matches!(resolution, Some(ConflictResolution::Skipped))
                || !forbidden_files.is_empty();

            estimated_bytes = estimated_bytes
                .saturating_add(entry.ai_summary.len() as u32)
                .saturating_add(FRONTMATTER_BYTE_ESTIMATE);

            plan_entries.push(MigrationEntryPlan {
                source_entry_id: entry.id,
                target_relative_path: final_path,
                type_inferred,
                slug,
                session_id,
                forbidden_files,
                will_skip,
            });
        }

        workday_plans.push(MigrationWorkdayPlan {
            workday,
            synthetic_session_count: sessions.len() as u32,
            entries: plan_entries,
        });
    }

    let source_entry_count: u32 = workday_plans
        .iter()
        .map(|w| w.entries.len() as u32)
        .sum();

    Ok(MigrationPlan {
        project_id,
        source_entry_count,
        by_workday: workday_plans,
        conflicts,
        backup_dir: backup_dir_name(),
        forbidden_path_hits: forbidden_hits,
        estimated_bytes_written: estimated_bytes,
    })
}

fn empty_plan(project_id: u32, _root: &Path) -> MigrationPlan {
    MigrationPlan {
        project_id,
        source_entry_count: 0,
        by_workday: Vec::new(),
        conflicts: Vec::new(),
        backup_dir: backup_dir_name(),
        forbidden_path_hits: 0,
        estimated_bytes_written: 0,
    }
}

/// `.oculpm.backup-pre-migration-YYYYMMDDTHHMMSSZ` — basename only. The full
/// path is `root.join(...)` at execute time so PR2's rollback can locate it
/// purely by basename (anti-arbitrary-path-deletion guard).
pub fn backup_dir_name() -> String {
    format!(
        ".oculpm.backup-pre-migration-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// execute
// ─────────────────────────────────────────────────────────────────────────────

/// JSONL row in `backup_dir/manifest.json`. One per successfully-written
/// markdown file. PR2's rollback reads this back to invert each write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub source_entry_id: u32,
    pub target_relative_path: String,
    pub session_id: String,
    pub workday: String,
    pub written_at: String,
}

/// Execute the plan. Caller must have already paused the watcher (PR3) — this
/// function only manages disk + cache state.
pub async fn execute(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    _config: &OculpmConfig,
    plan: MigrationPlan,
    progress: Option<mpsc::Sender<MigrationProgress>>,
) -> Result<MigrationReport, OculpmError> {
    let backup_dir = root.join(&plan.backup_dir);
    let journal_root = resolver.journal_root(root);

    let total: u32 = plan
        .by_workday
        .iter()
        .flat_map(|w| w.entries.iter())
        .filter(|e| !e.will_skip)
        .count() as u32;

    // 1. Capture SQLite dump into backup_dir *before* any disk write to journal.
    create_backup_dir(&backup_dir, db, project_id).await?;

    let mut success_count: u32 = 0;
    let mut skip_count: u32 = 0;
    let mut failures: Vec<MigrationFailure> = Vec::new();
    let mut processed: u32 = 0;

    // For frontmatter `agent` + body. We re-fetch entries by id to keep the
    // plan small (frontend doesn't need ai_summary etc.).
    let entries = fetch_entries_map(db, project_id).await?;

    let index_writer = IndexWriter::new(root.to_path_buf(), resolver.clone());

    for workday_plan in &plan.by_workday {
        // 2. Append synthetic sessions. We do this *before* writing entries
        //    so a partial failure mid-entry-loop still has well-formed
        //    sessions.ndjson for rollback to filter out by session_id.
        let synthetic_session_ids = synthetic_sessions_for_workday(workday_plan, &entries);
        for session in &synthetic_session_ids {
            if let Err(e) = index_writer.upsert_session(session).await {
                // Non-fatal: continuing without sessions just degrades the
                // Today timeline. Caller can still rollback.
                tracing::warn!(
                    target: "oculpm::migrate",
                    project_id,
                    session_id = %session.id,
                    error = %e,
                    "failed to upsert synthetic session"
                );
            }
        }

        for plan_entry in &workday_plan.entries {
            if plan_entry.will_skip {
                skip_count += 1;
                continue;
            }

            let Some(source) = entries.get(&plan_entry.source_entry_id) else {
                failures.push(MigrationFailure {
                    source_entry_id: plan_entry.source_entry_id,
                    reason: "source entry not found in db".to_string(),
                });
                continue;
            };

            match write_one_entry(
                project_id,
                &journal_root,
                &workday_plan.workday,
                plan_entry,
                source,
                resolver,
                &backup_dir,
            ) {
                Ok(()) => {
                    success_count += 1;
                    processed += 1;
                    if let Some(tx) = &progress {
                        let _ = tx
                            .send(MigrationProgress {
                                project_id,
                                processed,
                                total,
                                current_entry: plan_entry.slug.clone(),
                            })
                            .await;
                    }
                }
                Err(e) => {
                    failures.push(MigrationFailure {
                        source_entry_id: plan_entry.source_entry_id,
                        reason: e.to_string(),
                    });
                }
            }
        }
    }

    // 3. Reindex cache so Today picks up the new entries immediately.
    let cache = JournalCache::new(db);
    if let Err(e) = cache.reindex_incremental(project_id, &journal_root).await {
        tracing::warn!(
            target: "oculpm::migrate",
            project_id,
            error = %e,
            "incremental reindex failed after migration (non-fatal)"
        );
    }

    let failure_count = failures.len() as u32;
    Ok(MigrationReport {
        project_id,
        success_count,
        skip_count,
        failure_count,
        backup_dir: plan.backup_dir,
        completed_at: Utc::now().to_rfc3339(),
        failures,
    })
}

async fn create_backup_dir(
    backup_dir: &Path,
    db: &Db,
    project_id: u32,
) -> Result<(), OculpmError> {
    std::fs::create_dir_all(backup_dir).map_err(|source| OculpmError::Io {
        path: backup_dir.to_path_buf(),
        source,
    })?;

    // Dump entries + files JSON. Re-fetch via the db API so we don't
    // depend on the plan having the full body (the plan keeps slugs only).
    let entries = fetch_all_entries(db, project_id).await?;

    let entry_dump: Vec<&ChangelogEntry> = entries.iter().map(|e| &e.entry).collect();
    let file_dump: Vec<&ChangelogFileEntry> =
        entries.iter().flat_map(|e| e.files.iter()).collect();

    let entries_json =
        serde_json::to_vec_pretty(&entry_dump).map_err(OculpmError::JsonSerialize)?;
    let files_json =
        serde_json::to_vec_pretty(&file_dump).map_err(OculpmError::JsonSerialize)?;
    write_atomic(&backup_dir.join("changelog_entries.json"), &entries_json)?;
    write_atomic(&backup_dir.join("changelog_files.json"), &files_json)?;

    // Empty manifest file (JSONL). write_one_entry appends one line per success.
    let manifest = backup_dir.join("manifest.json");
    write_atomic(&manifest, b"")?;
    Ok(())
}

fn write_one_entry(
    _project_id: u32,
    journal_root: &Path,
    workday: &str,
    plan_entry: &MigrationEntryPlan,
    source: &EntryWithFiles,
    resolver: &WorkdayResolver,
    backup_dir: &Path,
) -> Result<(), OculpmError> {
    let utc = unix_to_utc(source.entry.created_at);
    let created_at_rfc3339 = utc.with_timezone(&resolver.tz).to_rfc3339();

    let mut tags: Vec<String> = Vec::new();
    if source.entry.pinned {
        tags.push("pinned".into());
    }

    // files_touched — exclude forbidden paths even when the user toggled
    // will_skip back to false. The forbidden filter is a hard floor.
    let forbidden: HashSet<&str> = plan_entry
        .forbidden_files
        .iter()
        .map(String::as_str)
        .collect();
    let files_touched: Vec<FileTouched> = source
        .files
        .iter()
        .filter(|f| !forbidden.contains(f.file_path.as_str()))
        .map(|f| FileTouched {
            path: f.file_path.clone(),
            op: map_change_type(&f.change_type),
            bytes_added: Some(f.lines_added),
            bytes_removed: Some(f.lines_removed),
            rename_from: None,
        })
        .collect();

    let agent = AgentRef {
        id: source
            .entry
            .external_tool
            .clone()
            .unwrap_or_else(|| "manual".to_string()),
        version: None,
    };

    // Body — first line is `[x] <title>`, then ## sections. Filter out
    // forbidden files from the body listing too so secrets never land on
    // disk via the journal markdown.
    let safe_files: Vec<&ChangelogFileEntry> = source
        .files
        .iter()
        .filter(|f| !forbidden.contains(f.file_path.as_str()))
        .collect();
    let (body_markdown, truncated) = build_body(&source.entry, &safe_files);
    if truncated {
        tags.push("body-truncated".into());
    }

    let fm = crate::oculpm::spec::JournalFrontmatter {
        schema_version: 1,
        entry_type: plan_entry.type_inferred,
        slug: plan_entry.slug.clone(),
        status: EntryStatus::Done,
        difficulty: None,
        created_at: created_at_rfc3339,
        updated_at: None,
        session_id: plan_entry.session_id.clone(),
        agent,
        language: "ko".into(),
        verified_by_user: true,
        files_touched,
        related: Vec::new(),
        tags,
    };

    let markdown = write_frontmatter_and_body(&fm, &body_markdown);
    let target_abs = journal_root.join(&plan_entry.target_relative_path);
    write_atomic(&target_abs, markdown.as_bytes())?;

    // Append manifest line *after* the write succeeds so rollback sees a
    // consistent record of disk state.
    let manifest_path = backup_dir.join("manifest.json");
    let manifest_entry = ManifestEntry {
        source_entry_id: source.entry.id,
        target_relative_path: plan_entry.target_relative_path.clone(),
        session_id: plan_entry.session_id.clone(),
        workday: workday.to_string(),
        written_at: Utc::now().to_rfc3339(),
    };
    let line = serde_json::to_string(&manifest_entry).map_err(OculpmError::JsonSerialize)?;
    append_jsonl_line(&manifest_path, &line)?;

    Ok(())
}

/// Append `line` + newline to `path`, creating the file if missing. The
/// atomic_io module's `append_ndjson` caps lines at 4 KB and our manifest
/// lines stay well under that, but it returns an error for >4 KB which we
/// don't want for very-long path edge cases — manifest doesn't need PIPE_BUF
/// atomicity (single producer). So we use a plain append here.
fn append_jsonl_line(path: &Path, line: &str) -> Result<(), OculpmError> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|source| OculpmError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line.as_bytes());
    buf.push(b'\n');
    f.write_all(&buf).map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    f.sync_data().map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// rollback (W5-PR2)
// ─────────────────────────────────────────────────────────────────────────────

/// Bundles an [`execute`] error with the rollback that ran afterwards. The
/// rollback itself may also error — both are surfaced so PR3's command
/// envelope can pick which one to display.
#[derive(Debug)]
pub struct MigrationFailureWithRollback {
    pub execute_error: OculpmError,
    pub rollback: Result<RollbackReport, OculpmError>,
}

impl std::fmt::Display for MigrationFailureWithRollback {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.rollback {
            Ok(r) => write!(
                f,
                "migration failed ({}); auto-rollback removed {} files",
                self.execute_error,
                r.removed_paths.len()
            ),
            Err(rb) => write!(
                f,
                "migration failed ({}); rollback also failed ({})",
                self.execute_error, rb
            ),
        }
    }
}

impl std::error::Error for MigrationFailureWithRollback {}

/// Undo a migration `execute` using the JSONL `manifest.json` left in
/// `backup_dir`. Idempotent — re-rolling-back the same `backup_dir` is safe
/// and just bumps `manifest_entries_missing_on_disk`.
///
/// The backup directory itself is **never** deleted, so the user can still
/// inspect / recover from `backup_dir/changelog_entries.json`.
pub async fn rollback(
    db: &Db,
    project_id: u32,
    root: &Path,
    backup_dir_basename: &str,
    resolver: &WorkdayResolver,
) -> Result<RollbackReport, OculpmError> {
    let backup_dir = root.join(backup_dir_basename);
    let manifest_path = backup_dir.join("manifest.json");

    let manifest_text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(OculpmError::InvalidConfig(format!(
                "backup_dir '{}' has no manifest.json — cannot rollback",
                backup_dir_basename
            )));
        }
        Err(source) => {
            return Err(OculpmError::Io {
                path: manifest_path,
                source,
            });
        }
    };

    let mut manifest_entries: Vec<ManifestEntry> = Vec::new();
    for line in manifest_text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // Tolerate a single trailing partial line (write killed mid-flush).
        match serde_json::from_str::<ManifestEntry>(line) {
            Ok(e) => manifest_entries.push(e),
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::migrate",
                    error = %e,
                    line = %line,
                    "skipping unparseable manifest line"
                );
            }
        }
    }

    let manifest_entries_total = manifest_entries.len() as u32;

    let journal_root = resolver.journal_root(root);
    let mut removed_paths: Vec<String> = Vec::new();
    let mut missing_on_disk: u32 = 0;
    let mut deleted_cache_rows: u32 = 0;

    let cache = JournalCache::new(db);

    // Per-workday session id buckets — used after the file-delete loop to
    // strip the synthetic session ids from each workday's sessions.json.
    let mut synthetic_by_workday: BTreeMap<String, HashSet<String>> = BTreeMap::new();

    for m in &manifest_entries {
        let abs = journal_root.join(&m.target_relative_path);
        match std::fs::remove_file(&abs) {
            Ok(()) => {
                removed_paths.push(m.target_relative_path.clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                missing_on_disk += 1;
            }
            Err(source) => {
                return Err(OculpmError::Io { path: abs, source });
            }
        }
        if cache
            .delete_entry(project_id, &m.target_relative_path)
            .await?
        {
            deleted_cache_rows += 1;
        }
        synthetic_by_workday
            .entry(m.workday.clone())
            .or_default()
            .insert(m.session_id.clone());
    }

    let mut stripped_session_count: u32 = 0;
    for (workday, ids) in &synthetic_by_workday {
        stripped_session_count += strip_synthetic_sessions(resolver, root, workday, ids)?;
        prune_empty_dirs(&journal_root.join(workday));
    }

    Ok(RollbackReport {
        project_id,
        backup_dir: backup_dir_basename.to_string(),
        removed_paths,
        deleted_cache_rows,
        manifest_entries_total,
        manifest_entries_missing_on_disk: missing_on_disk,
        stripped_session_count,
        backup_dir_preserved: true,
        completed_at: Utc::now().to_rfc3339(),
    })
}

/// Read `.oculpm/index/<workday>/sessions.json`, drop sessions whose `id`
/// appears in `synthetic_ids`, write back. Returns count actually removed.
fn strip_synthetic_sessions(
    resolver: &WorkdayResolver,
    root: &Path,
    workday: &str,
    synthetic_ids: &HashSet<String>,
) -> Result<u32, OculpmError> {
    let path = resolver.index_dir(root, workday).join("sessions.json");
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(source) => return Err(OculpmError::Io { path, source }),
    };

    let mut value: serde_json::Value = serde_json::from_str(&text).map_err(|source| {
        OculpmError::JsonParse {
            path: path.clone(),
            source,
        }
    })?;

    let arr = match value.get_mut("sessions").and_then(|v| v.as_array_mut()) {
        Some(a) => a,
        None => return Ok(0),
    };

    let before = arr.len() as u32;
    arr.retain(|s| {
        s.get("id")
            .and_then(|v| v.as_str())
            .map(|id| !synthetic_ids.contains(id))
            .unwrap_or(true)
    });
    let removed = before - arr.len() as u32;

    if removed == 0 {
        return Ok(0);
    }

    let bytes = serde_json::to_vec_pretty(&value).map_err(OculpmError::JsonSerialize)?;
    write_atomic(&path, &bytes)?;
    Ok(removed)
}

/// Remove empty workday + type folders left behind by the rollback. Best
/// effort — silent on IO errors so a misbehaving directory doesn't sink the
/// whole rollback.
fn prune_empty_dirs(workday_dir: &Path) {
    // Type-folder layer.
    if let Ok(read) = std::fs::read_dir(workday_dir) {
        for entry in read.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Ok(sub) = std::fs::read_dir(&p) {
                    if sub.count() == 0 {
                        let _ = std::fs::remove_dir(&p);
                    }
                }
            }
        }
    }
    // Workday folder itself.
    if let Ok(sub) = std::fs::read_dir(workday_dir) {
        if sub.count() == 0 {
            let _ = std::fs::remove_dir(workday_dir);
        }
    }
}

/// Run [`execute`]; on `Err`, automatically run [`rollback`] using the
/// plan's `backup_dir`. The PR3 command wrapper uses this so partial
/// disk state never lingers when the migration aborts.
pub async fn execute_with_rollback(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    config: &OculpmConfig,
    plan: MigrationPlan,
    progress: Option<mpsc::Sender<MigrationProgress>>,
) -> Result<MigrationReport, MigrationFailureWithRollback> {
    let backup_dir_basename = plan.backup_dir.clone();
    match execute(db, project_id, root, resolver, config, plan, progress).await {
        Ok(report) => Ok(report),
        Err(execute_error) => {
            let rb = rollback(db, project_id, root, &backup_dir_basename, resolver).await;
            Err(MigrationFailureWithRollback {
                execute_error,
                rollback: rb,
            })
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct EntryWithFiles {
    entry: ChangelogEntry,
    files: Vec<ChangelogFileEntry>,
}

async fn fetch_all_entries(
    db: &Db,
    project_id: u32,
) -> Result<Vec<EntryWithFiles>, OculpmError> {
    // db.list_changelog_entries returns rows sorted by (pinned DESC,
    // created_at DESC). We sort ASC later. Use a large limit to cover any
    // realistic backlog (W4 dogfooding shows < 1000 entries per project).
    let entries = db
        .list_changelog_entries(project_id, None, 100_000)
        .await
        .map_err(|e| OculpmError::Sqlite(e.to_string()))?;

    let mut out: Vec<EntryWithFiles> = Vec::with_capacity(entries.len());
    for e in entries {
        let files = db
            .list_changelog_files(e.id)
            .await
            .map_err(|err| OculpmError::Sqlite(err.to_string()))?;
        out.push(EntryWithFiles { entry: e, files });
    }
    Ok(out)
}

async fn fetch_entries_map(
    db: &Db,
    project_id: u32,
) -> Result<std::collections::HashMap<u32, EntryWithFiles>, OculpmError> {
    let entries = fetch_all_entries(db, project_id).await?;
    Ok(entries.into_iter().map(|e| (e.entry.id, e)).collect())
}

fn unix_to_utc(secs: u32) -> DateTime<Utc> {
    Utc.timestamp_opt(secs as i64, 0)
        .single()
        .unwrap_or_else(Utc::now)
}

fn title_or_intent(e: &ChangelogEntry) -> &str {
    if let Some(t) = e.title.as_deref().filter(|s| !s.trim().is_empty()) {
        return t;
    }
    if let Some(t) = e.user_intent.as_deref().filter(|s| !s.trim().is_empty()) {
        return t;
    }
    // ai_summary first line, with length cap applied later.
    e.ai_summary
        .lines()
        .next()
        .unwrap_or("untitled")
}

/// Map SQLite `category` + heuristic on the title to an `EntryType`.
pub fn infer_type(category: Option<&str>, title: &str) -> EntryType {
    if let Some(cat) = category.map(str::to_ascii_lowercase) {
        match cat.as_str() {
            "feature" | "feat" => return EntryType::Feature,
            "bug" | "fix" => return EntryType::Bug,
            "error" => return EntryType::Error,
            "refactor" | "refac" => return EntryType::Refactor,
            "docs" | "doc" | "test" | "chore" => return EntryType::Chore,
            _ => {}
        }
    }
    keyword_infer_type(title)
}

fn keyword_infer_type(title: &str) -> EntryType {
    let lower = title.to_ascii_lowercase();
    if lower.contains("fix")
        || lower.contains("버그")
        || lower.contains("오류")
        || lower.contains("에러")
    {
        return EntryType::Bug;
    }
    if lower.contains("feat")
        || lower.contains("add")
        || lower.contains("기능")
        || lower.contains("추가")
    {
        return EntryType::Feature;
    }
    if lower.contains("refactor") || lower.contains("리팩") {
        return EntryType::Refactor;
    }
    EntryType::Chore
}

fn make_slug(e: &ChangelogEntry) -> String {
    let source = title_or_intent(e);
    let mut s = slug::slugify(source);
    if s.is_empty() {
        s = format!("entry-{}", e.id);
    }
    if s.len() > SLUG_MAX_LEN {
        s.truncate(SLUG_MAX_LEN);
        // After truncation we may end on a `-`; tidy.
        while s.ends_with('-') {
            s.pop();
        }
        if s.is_empty() {
            s = format!("entry-{}", e.id);
        }
    }
    s
}

fn map_change_type(s: &str) -> FileOp {
    match s {
        "created" => FileOp::Create,
        "modified" => FileOp::Update,
        "deleted" => FileOp::Delete,
        "renamed" => FileOp::Rename,
        _ => FileOp::Update,
    }
}

fn type_folder(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "Bugs",
        EntryType::Feature => "Features_to_add",
        EntryType::Error => "Errors",
        EntryType::Refactor => "Refactors",
        EntryType::Chore => "Chores",
    }
}

fn type_token(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

/// Compute the final relative path inside `<journal_root>/`, resolving
/// in-plan + on-disk collisions via `slug__2`, `slug__3`, ... up to
/// [`MAX_SUFFIX_ATTEMPTS`]. Returns the path + `Some(resolution)` if it
/// differed from the bare slug.
fn resolve_target_path(
    journal_root: &Path,
    workday: &str,
    t: EntryType,
    hhmm: &str,
    slug: &str,
    used: &mut HashSet<String>,
) -> (String, Option<ConflictResolution>) {
    let base = |s: &str| format!("{}/{}/{}_{}_{}.md", workday, type_folder(t), hhmm, type_token(t), s);
    let candidate = base(slug);
    if !used.contains(&candidate) && !journal_root.join(&candidate).exists() {
        used.insert(candidate.clone());
        return (candidate, None);
    }

    for n in 2..=MAX_SUFFIX_ATTEMPTS {
        let suffixed = format!("{slug}__{n}");
        let cand = base(&suffixed);
        if !used.contains(&cand) && !journal_root.join(&cand).exists() {
            used.insert(cand.clone());
            return (cand, Some(ConflictResolution::SuffixAdded));
        }
    }

    // Out of suffix attempts — mark as skipped. We still return the bare
    // candidate as the "would-be" path so the modal can surface it.
    (candidate, Some(ConflictResolution::Skipped))
}

// ─── Session clustering ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct SyntheticSessionPlan {
    id: String,
    started_at: i64,
    ended_at: i64,
    /// Indices into the per-workday `entries` slice this session covers.
    indices: Vec<usize>,
}

impl SyntheticSessionPlan {
    fn contains_index(&self, idx: usize) -> bool {
        self.indices.contains(&idx)
    }
}

/// 30-minute-gap clustering. Returns a sessions list, one per cluster, with
/// ids `<workday>-mNN` (m for "migrated"). The 'm' avoids collision with
/// real watcher-allocated NNN ids while staying compliant with the
/// `YYYYMMDD-NNN` shape (first 8 chars digits) that index validation
/// enforces.
fn cluster_sessions(workday: &str, entries: &[EntryWithFiles]) -> Vec<SyntheticSessionPlan> {
    let mut sessions: Vec<SyntheticSessionPlan> = Vec::new();
    if entries.is_empty() {
        return sessions;
    }

    let mut current_indices: Vec<usize> = vec![0];
    let mut prev_ts = entries[0].entry.created_at as i64;
    let mut session_start = prev_ts;

    for (i, e) in entries.iter().enumerate().skip(1) {
        let ts = e.entry.created_at as i64;
        if ts - prev_ts > SESSION_GAP_SECONDS {
            sessions.push(SyntheticSessionPlan {
                id: format!("{workday}-m{:02}", sessions.len() + 1),
                started_at: session_start,
                ended_at: prev_ts,
                indices: std::mem::take(&mut current_indices),
            });
            session_start = ts;
        }
        current_indices.push(i);
        prev_ts = ts;
    }
    sessions.push(SyntheticSessionPlan {
        id: format!("{workday}-m{:02}", sessions.len() + 1),
        started_at: session_start,
        ended_at: prev_ts,
        indices: current_indices,
    });
    sessions
}

fn synthetic_sessions_for_workday(
    workday_plan: &MigrationWorkdayPlan,
    entries: &std::collections::HashMap<u32, EntryWithFiles>,
) -> Vec<Session> {
    // Re-derive cluster bounds from the plan's session_ids — entries with the
    // same session_id share a cluster, started_at = min(created_at),
    // ended_at = max(created_at).
    let mut by_session: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    let mut linked: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for pe in &workday_plan.entries {
        if let Some(ewf) = entries.get(&pe.source_entry_id) {
            by_session
                .entry(pe.session_id.clone())
                .or_default()
                .push(ewf.entry.created_at as i64);
        }
        if !pe.will_skip {
            linked
                .entry(pe.session_id.clone())
                .or_default()
                .push(pe.target_relative_path.clone());
        }
    }

    by_session
        .into_iter()
        .filter_map(|(id, mut ts)| {
            if ts.is_empty() {
                return None;
            }
            ts.sort_unstable();
            let started = ts[0];
            let ended = *ts.last().unwrap();
            let linked_paths = linked.remove(&id).unwrap_or_default();
            let file_count: u32 = linked_paths.len() as u32;
            Some(Session {
                id,
                started_at: rfc3339(started),
                ended_at: Some(rfc3339(ended)),
                ended_reason: Some(EndedReason::SyntheticMigrated),
                active_window_ms: ((ended - started).max(0) * 1000)
                    .try_into()
                    .unwrap_or(u32::MAX),
                file_event_count: file_count,
                files_unique: file_count,
                git_head_at_start: None,
                git_head_at_end: None,
                agent_label_guess: Some("migrated".into()),
                linked_journal_entries: linked_paths,
            })
        })
        .collect()
}

fn rfc3339(unix: i64) -> String {
    Utc.timestamp_opt(unix, 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

// ─── body builder ────────────────────────────────────────────────────────────

fn build_body(entry: &ChangelogEntry, files: &[&ChangelogFileEntry]) -> (String, bool) {
    let title = title_or_intent(entry);
    let mut s = String::with_capacity(entry.ai_summary.len() + 256);
    s.push_str("[x] ");
    s.push_str(title);
    s.push_str("\n\n## 변경 요약\n");
    s.push_str(&entry.ai_summary);
    if !entry.ai_summary.ends_with('\n') {
        s.push('\n');
    }
    if !files.is_empty() {
        s.push_str("\n## 파일 변경\n");
        for f in files {
            if let Some(summary) = &f.per_file_summary {
                s.push_str(&format!("- `{}` — {}\n", f.file_path, summary));
            } else {
                s.push_str(&format!("- `{}` ({})\n", f.file_path, f.change_type));
            }
        }
    }

    let truncated = s.len() > BODY_BYTE_CAP;
    if truncated {
        // Truncate at a UTF-8 char boundary at or before the cap.
        let mut end = BODY_BYTE_CAP;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n\n[migration: body truncated at 64KB]\n");
    }
    (s, truncated)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W5/PR1-migrate-dry-run.md` §7.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::OculpmConfig;
    use chrono::TimeZone;
    use tempfile::tempdir;

    fn kst() -> WorkdayResolver {
        WorkdayResolver::new("Asia/Seoul", "00:00").unwrap()
    }

    fn default_config() -> OculpmConfig {
        OculpmConfig::default_for_new_project()
    }

    /// KST midnight (15:00 UTC) on 2026-05-22.
    fn kst_midnight_22() -> i64 {
        Utc.with_ymd_and_hms(2026, 5, 21, 15, 0, 0).unwrap().timestamp()
    }

    async fn fresh_db() -> (Db, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Db::open(db_path).await.expect("open db");
        // Seed a project row so changelog FK constraints pass.
        let _ = db
            .create_project("migration-test".into(), dir.path().to_string_lossy().into())
            .await
            .expect("create project");
        (db, dir)
    }

    /// Insert one entry at `base_ts + offset_secs`. Returns the new id.
    async fn seed(
        db: &Db,
        project_id: u32,
        base_ts: i64,
        offset_secs: i64,
        title: &str,
        category: Option<&str>,
        files: &[(&str, &str)],
        external_tool: Option<&str>,
    ) -> u32 {
        let entry = db
            .insert_changelog_entry(
                project_id,
                Some(title.to_string()),
                None,
                format!("AI summary for {title}"),
                Some(title.to_string()),
                category.map(str::to_string),
                external_tool.map(str::to_string),
                files.len() as u32,
                10,
                3,
            )
            .await
            .expect("insert entry");
        // Overwrite created_at to the test fixture time. `insert_changelog_entry`
        // uses `unixepoch()` default, so we patch it.
        db.conn()
            .call({
                let id = entry.id as i64;
                let ts = (base_ts + offset_secs) as i64;
                move |c| {
                    c.execute(
                        "UPDATE changelog_entries SET created_at = ?1 WHERE id = ?2",
                        rusqlite::params![ts, id],
                    )?;
                    Ok::<(), rusqlite::Error>(())
                }
            })
            .await
            .unwrap();
        for (path, change_type) in files {
            db.insert_changelog_file(
                entry.id,
                (*path).to_string(),
                (*change_type).to_string(),
                10,
                3,
                None,
                Some(format!("touched {path}")),
                None,
                None,
            )
            .await
            .expect("insert file");
        }
        entry.id
    }

    // ─── dry_run ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn dry_run_yields_zero_for_empty_changelog() {
        let (db, tmp) = fresh_db().await;
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        assert_eq!(plan.source_entry_count, 0);
        assert!(plan.by_workday.is_empty());
        assert!(plan.conflicts.is_empty());
        assert_eq!(plan.forbidden_path_hits, 0);
    }

    #[tokio::test]
    async fn dry_run_counts_match_source_entry_count() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..30 {
            // 31 seconds apart — every entry triggers a new session under
            // the 30-min rule? No, 30-min rule is `> 30min`. 31s apart all
            // collapse into one session.
            seed(
                &db,
                1,
                base,
                3600 + i * 31, // 01:00 KST + 31s steps
                &format!("entry {i}"),
                Some("feature"),
                &[("src/a.rs", "modified")],
                Some("claude-code"),
            )
            .await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        assert_eq!(plan.source_entry_count, 30);
        assert_eq!(plan.by_workday.len(), 1);
        assert_eq!(plan.by_workday[0].entries.len(), 30);
    }

    #[tokio::test]
    async fn dry_run_clusters_30min_gaps_into_separate_sessions() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        // Three entries close together, then a 31-min gap, then two more.
        seed(&db, 1, base, 3600, "a1", Some("feature"), &[], None).await;
        seed(&db, 1, base, 3660, "a2", Some("feature"), &[], None).await;
        seed(&db, 1, base, 3720, "a3", Some("feature"), &[], None).await;
        // gap > 30 min
        seed(
            &db,
            1,
            base,
            3720 + 31 * 60 + 1,
            "b1",
            Some("feature"),
            &[],
            None,
        )
        .await;
        seed(
            &db,
            1,
            base,
            3720 + 32 * 60,
            "b2",
            Some("feature"),
            &[],
            None,
        )
        .await;

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        assert_eq!(plan.by_workday.len(), 1);
        assert_eq!(plan.by_workday[0].synthetic_session_count, 2);

        let session_ids: HashSet<&str> = plan.by_workday[0]
            .entries
            .iter()
            .map(|e| e.session_id.as_str())
            .collect();
        assert_eq!(session_ids.len(), 2, "expected 2 distinct session ids");
    }

    #[tokio::test]
    async fn dry_run_assigns_workdays_via_resolver() {
        // 03:00-start: an entry at KST 02:00 belongs to *previous* workday.
        let resolver = WorkdayResolver::new("Asia/Seoul", "03:00").unwrap();
        let (db, tmp) = fresh_db().await;
        // KST 02:00 on 2026-05-23 == UTC 17:00 on 2026-05-22.
        // With 03:00 start, this belongs to workday "20260522".
        let early_ts = Utc
            .with_ymd_and_hms(2026, 5, 22, 17, 0, 0)
            .unwrap()
            .timestamp();
        seed(&db, 1, early_ts, 0, "before-boundary", None, &[], None).await;
        // KST 04:00 on 2026-05-23 == UTC 19:00 on 2026-05-22.
        // Belongs to workday "20260523".
        let after_ts = Utc
            .with_ymd_and_hms(2026, 5, 22, 19, 0, 0)
            .unwrap()
            .timestamp();
        seed(&db, 1, after_ts, 0, "after-boundary", None, &[], None).await;

        let plan = dry_run(&db, 1, tmp.path(), &resolver, &default_config())
            .await
            .unwrap();
        let workdays: HashSet<&str> = plan
            .by_workday
            .iter()
            .map(|w| w.workday.as_str())
            .collect();
        assert!(workdays.contains("20260522"));
        assert!(workdays.contains("20260523"));
    }

    #[tokio::test]
    async fn dry_run_does_not_touch_disk() {
        let (db, tmp) = fresh_db().await;
        seed(&db, 1, kst_midnight_22(), 3600, "x", None, &[], None).await;

        // Capture filesystem state before + after dry_run.
        let count_before = walkdir::WalkDir::new(tmp.path()).into_iter().count();
        let _ = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let count_after = walkdir::WalkDir::new(tmp.path()).into_iter().count();
        assert_eq!(count_before, count_after, "dry_run must not touch disk");
    }

    #[tokio::test]
    async fn dry_run_infers_type_from_category_then_keywords() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(&db, 1, base, 3600, "title-feature", Some("feature"), &[], None).await;
        seed(&db, 1, base, 3601, "title-bug", Some("bug"), &[], None).await;
        seed(
            &db,
            1,
            base,
            3602,
            "fix the broken thing",
            None,
            &[],
            None,
        )
        .await;
        seed(
            &db,
            1,
            base,
            3603,
            "리팩터링 진행",
            None,
            &[],
            None,
        )
        .await;
        // Category "docs" folds to Chore per spec.
        seed(&db, 1, base, 3604, "title-docs", Some("docs"), &[], None).await;

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let by_title: std::collections::HashMap<String, EntryType> = plan.by_workday[0]
            .entries
            .iter()
            .map(|e| (e.slug.clone(), e.type_inferred))
            .collect();

        assert_eq!(by_title["title-feature"], EntryType::Feature);
        assert_eq!(by_title["title-bug"], EntryType::Bug);
        assert_eq!(by_title["fix-the-broken-thing"], EntryType::Bug);
        // 리팩 keyword → Refactor.
        assert_eq!(
            by_title.values().filter(|t| **t == EntryType::Refactor).count(),
            1
        );
        assert_eq!(by_title["title-docs"], EntryType::Chore);
    }

    // ─── execute ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn execute_writes_target_files_with_synthetic_sessions() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..5 {
            seed(
                &db,
                1,
                base,
                3600 + i * 60,
                &format!("entry {i}"),
                Some("feature"),
                &[("src/a.rs", "modified")],
                None,
            )
            .await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let backup_basename = plan.backup_dir.clone();
        let report = execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();
        assert_eq!(report.success_count, 5);
        assert_eq!(report.failure_count, 0);

        // 5 markdown files written
        let workday_dir = tmp.path().join(".oculpm/journal/20260522/Features_to_add");
        let mds: Vec<_> = std::fs::read_dir(&workday_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
            .collect();
        assert_eq!(mds.len(), 5);

        // sessions.json has one synthetic session entry
        let sessions_path = tmp.path().join(".oculpm/index/20260522/sessions.json");
        let txt = std::fs::read_to_string(&sessions_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&txt).unwrap();
        let sessions = parsed
            .get("sessions")
            .and_then(|s| s.as_array())
            .expect("sessions array");
        assert_eq!(sessions.len(), 1, "expected 1 synthetic session in {txt}");
        let id = sessions[0]["id"].as_str().unwrap();
        assert!(id.starts_with("20260522-m"), "got id {id}");

        // backup dir exists with manifest
        let bd = tmp.path().join(&backup_basename);
        assert!(bd.exists());
        assert!(bd.join("manifest.json").exists());
    }

    #[tokio::test]
    async fn execute_backs_up_sqlite_dumps_before_writing() {
        let (db, tmp) = fresh_db().await;
        seed(&db, 1, kst_midnight_22(), 3600, "e1", None, &[("a", "modified")], None).await;
        seed(&db, 1, kst_midnight_22(), 3601, "e2", None, &[("b", "modified")], None).await;

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let bd = tmp.path().join(&plan.backup_dir);
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        let entries_json = std::fs::read_to_string(bd.join("changelog_entries.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&entries_json).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);

        let files_json = std::fs::read_to_string(bd.join("changelog_files.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&files_json).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn execute_appends_manifest_per_entry_write() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..5 {
            seed(&db, 1, base, 3600 + i, &format!("e{i}"), None, &[], None).await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let bd = tmp.path().join(&plan.backup_dir);
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        let manifest = std::fs::read_to_string(bd.join("manifest.json")).unwrap();
        let lines: Vec<&str> = manifest.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 5);
        for line in lines {
            let v: ManifestEntry = serde_json::from_str(line).unwrap();
            assert!(v.target_relative_path.ends_with(".md"));
            assert_eq!(v.workday, "20260522");
        }
    }

    #[tokio::test]
    async fn execute_triggers_incremental_reindex() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..5 {
            seed(&db, 1, base, 3600 + i, &format!("e{i}"), None, &[], None).await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // After migration, the journal cache should list all 5 entries.
        let cache = JournalCache::new(&db);
        let rows = cache
            .list_entries(1, Some("20260522"), &crate::oculpm::cache::EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 5);
    }

    #[tokio::test]
    async fn execute_skips_will_skip_entries() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(&db, 1, base, 3600, "keep", None, &[], None).await;
        seed(&db, 1, base, 3601, "drop", None, &[], None).await;

        let mut plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        // User toggles one off.
        plan.by_workday[0].entries[1].will_skip = true;
        let drop_id = plan.by_workday[0].entries[1].source_entry_id;
        let report = execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();
        assert_eq!(report.success_count, 1);
        assert_eq!(report.skip_count, 1);

        // Manifest doesn't include the dropped one.
        let cache = JournalCache::new(&db);
        let rows = cache
            .list_entries(1, Some("20260522"), &crate::oculpm::cache::EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_ne!(rows[0].slug, format!("drop"), "got slug {}", rows[0].slug);
        let _ = drop_id; // suppress unused; the id is implicit in the manifest absence
    }

    // ─── conflict + forbidden ───────────────────────────────────────────────

    #[tokio::test]
    async fn dry_run_resolves_filename_collision_with_suffix() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        // Two entries at the same minute with the same title — they'll have
        // the same hhmm + slug.
        seed(&db, 1, base, 3600, "dup title", Some("feature"), &[], None).await;
        seed(&db, 1, base, 3600, "dup title", Some("feature"), &[], None).await;

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        assert_eq!(plan.conflicts.len(), 1);
        assert!(matches!(
            plan.conflicts[0].resolution,
            ConflictResolution::SuffixAdded
        ));
        // The conflicting path uses __2 suffix.
        assert!(
            plan.by_workday[0]
                .entries
                .iter()
                .any(|e| e.target_relative_path.contains("__2")),
            "expected __2 suffix path; got {:?}",
            plan.by_workday[0]
                .entries
                .iter()
                .map(|e| e.target_relative_path.clone())
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn dry_run_marks_forbidden_files_for_skip() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(
            &db,
            1,
            base,
            3600,
            "with-env",
            Some("feature"),
            &[("src/.env.local", "modified"), ("src/safe.rs", "modified")],
            None,
        )
        .await;

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let entry = &plan.by_workday[0].entries[0];
        assert!(
            !entry.forbidden_files.is_empty(),
            "expected forbidden file detection"
        );
        assert!(entry.will_skip, "forbidden default → will_skip=true");
        assert!(plan.forbidden_path_hits >= 1);
    }

    #[tokio::test]
    async fn execute_skips_forbidden_entries_unless_user_overrides() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(
            &db,
            1,
            base,
            3600,
            "with-env",
            Some("feature"),
            &[("src/.env.local", "modified"), ("src/safe.rs", "modified")],
            None,
        )
        .await;

        let mut plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        // User toggles back on after reviewing.
        plan.by_workday[0].entries[0].will_skip = false;
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // The .md was written, but files_touched in frontmatter must not
        // include the forbidden file.
        let workday_dir = tmp.path().join(".oculpm/journal/20260522/Features_to_add");
        let md = std::fs::read_dir(&workday_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
            .expect("at least one .md was written");
        let text = std::fs::read_to_string(md.path()).unwrap();
        assert!(text.contains("src/safe.rs"), "safe path must remain");
        assert!(
            !text.contains(".env.local"),
            "forbidden path must be stripped from frontmatter"
        );
    }

    #[tokio::test]
    async fn execute_truncates_body_at_64kb_with_tag() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        // Insert directly with an oversized ai_summary.
        let huge = "가".repeat(40_000); // ~120KB UTF-8
        let entry = db
            .insert_changelog_entry(
                1,
                Some("huge".into()),
                None,
                huge,
                Some("huge".into()),
                Some("feature".into()),
                None,
                0,
                0,
                0,
            )
            .await
            .unwrap();
        db.conn()
            .call({
                let id = entry.id as i64;
                let ts = (base + 3600) as i64;
                move |c| {
                    c.execute(
                        "UPDATE changelog_entries SET created_at = ?1 WHERE id = ?2",
                        rusqlite::params![ts, id],
                    )?;
                    Ok::<(), rusqlite::Error>(())
                }
            })
            .await
            .unwrap();

        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        let workday_dir = tmp.path().join(".oculpm/journal/20260522/Features_to_add");
        let md = std::fs::read_dir(&workday_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
            .unwrap();
        let text = std::fs::read_to_string(md.path()).unwrap();
        assert!(text.contains("body-truncated"), "tag must be present");
        assert!(
            text.contains("[migration: body truncated"),
            "truncation marker must be in body"
        );
        // Total size on disk is bounded — body cap + frontmatter + truncation marker.
        assert!(
            text.len() < BODY_BYTE_CAP + 4096,
            "file size {} exceeded cap + frontmatter slack",
            text.len()
        );
    }

    // ─── rollback (W5-PR2) ──────────────────────────────────────────────────

    #[tokio::test]
    async fn rollback_deletes_files_from_manifest_and_preserves_backup() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..3 {
            seed(
                &db,
                1,
                base,
                3600 + i * 60,
                &format!("e{i}"),
                Some("feature"),
                &[("src/a.rs", "modified")],
                None,
            )
            .await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let backup_basename = plan.backup_dir.clone();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // Sanity: 3 .md files exist
        let workday_dir = tmp.path().join(".oculpm/journal/20260522/Features_to_add");
        assert_eq!(
            std::fs::read_dir(&workday_dir).unwrap().count(),
            3,
            "expected 3 entries before rollback"
        );

        // Rollback
        let report = rollback(&db, 1, tmp.path(), &backup_basename, &kst())
            .await
            .unwrap();
        assert_eq!(report.removed_paths.len(), 3);
        assert_eq!(report.manifest_entries_missing_on_disk, 0);
        assert_eq!(report.deleted_cache_rows, 3);
        assert!(report.backup_dir_preserved);

        // Disk is clean — the .md files are gone (workday folder pruned too).
        assert!(!workday_dir.exists() || std::fs::read_dir(&workday_dir).unwrap().count() == 0);

        // Backup dir + manifest still preserved.
        let bd = tmp.path().join(&backup_basename);
        assert!(bd.join("manifest.json").exists());
        assert!(bd.join("changelog_entries.json").exists());
    }

    #[tokio::test]
    async fn rollback_is_idempotent_when_files_already_missing() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(&db, 1, base, 3600, "e1", None, &[], None).await;
        seed(&db, 1, base, 3660, "e2", None, &[], None).await;
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let backup_basename = plan.backup_dir.clone();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // First rollback — should succeed and remove 2 files.
        let r1 = rollback(&db, 1, tmp.path(), &backup_basename, &kst())
            .await
            .unwrap();
        assert_eq!(r1.removed_paths.len(), 2);
        assert_eq!(r1.manifest_entries_missing_on_disk, 0);

        // Second rollback against the same backup_dir — all files already gone.
        let r2 = rollback(&db, 1, tmp.path(), &backup_basename, &kst())
            .await
            .unwrap();
        assert_eq!(r2.removed_paths.len(), 0);
        assert_eq!(
            r2.manifest_entries_missing_on_disk, r2.manifest_entries_total,
            "all manifest entries should be reported missing on re-rollback"
        );
        assert!(r2.backup_dir_preserved);
    }

    #[tokio::test]
    async fn rollback_strips_synthetic_sessions_from_index() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        for i in 0..3 {
            seed(&db, 1, base, 3600 + i * 60, &format!("e{i}"), None, &[], None).await;
        }
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let backup_basename = plan.backup_dir.clone();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // Sessions.json contains exactly one synthetic session.
        let sessions_path = tmp.path().join(".oculpm/index/20260522/sessions.json");
        let before: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&sessions_path).unwrap()).unwrap();
        assert_eq!(before["sessions"].as_array().unwrap().len(), 1);

        let report = rollback(&db, 1, tmp.path(), &backup_basename, &kst())
            .await
            .unwrap();
        assert_eq!(report.stripped_session_count, 1);

        // After rollback, sessions array is empty (the only entry was synthetic).
        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&sessions_path).unwrap()).unwrap();
        assert_eq!(
            after["sessions"].as_array().unwrap().len(),
            0,
            "all synthetic sessions removed"
        );
    }

    #[tokio::test]
    async fn rollback_preserves_non_synthetic_sessions() {
        let (db, tmp) = fresh_db().await;
        let base = kst_midnight_22();
        seed(&db, 1, base, 3600, "e1", None, &[], None).await;
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let backup_basename = plan.backup_dir.clone();
        execute(&db, 1, tmp.path(), &kst(), &default_config(), plan, None)
            .await
            .unwrap();

        // Inject a real watcher-style session into sessions.json before rollback.
        let resolver = kst();
        let writer =
            IndexWriter::new(tmp.path().to_path_buf(), resolver.clone());
        let real_session = Session {
            id: "20260522-001".into(),
            started_at: rfc3339(base + 1800),
            ended_at: Some(rfc3339(base + 2000)),
            ended_reason: Some(EndedReason::Manual),
            active_window_ms: 200_000,
            file_event_count: 0,
            files_unique: 0,
            git_head_at_start: None,
            git_head_at_end: None,
            agent_label_guess: None,
            linked_journal_entries: Vec::new(),
        };
        writer.upsert_session(&real_session).await.unwrap();

        // Rollback strips only the synthetic one.
        rollback(&db, 1, tmp.path(), &backup_basename, &resolver)
            .await
            .unwrap();

        let sessions_path = tmp.path().join(".oculpm/index/20260522/sessions.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&sessions_path).unwrap()).unwrap();
        let arr = parsed["sessions"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], "20260522-001");
    }

    #[tokio::test]
    async fn execute_with_rollback_returns_ok_on_success() {
        let (db, tmp) = fresh_db().await;
        seed(&db, 1, kst_midnight_22(), 3600, "happy", None, &[], None).await;
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        let report = execute_with_rollback(
            &db,
            1,
            tmp.path(),
            &kst(),
            &default_config(),
            plan,
            None,
        )
        .await
        .expect("wrapper passes Ok through");
        assert_eq!(report.success_count, 1);
        // Backup dir should still be present so the user can review.
        let bd = tmp.path().join(&report.backup_dir);
        assert!(bd.exists());
    }

    #[tokio::test]
    async fn execute_with_rollback_triggers_rollback_when_backup_dir_blocked() {
        let (db, tmp) = fresh_db().await;
        seed(&db, 1, kst_midnight_22(), 3600, "e1", None, &[], None).await;
        let plan = dry_run(&db, 1, tmp.path(), &kst(), &default_config())
            .await
            .unwrap();
        // Pre-create a *file* (not directory) at the backup_dir path so
        // `create_dir_all` fails inside execute — simulates a partial-failure
        // path without needing real fault injection infrastructure.
        let blocker = tmp.path().join(&plan.backup_dir);
        std::fs::write(&blocker, b"blocking file").unwrap();

        let err = execute_with_rollback(
            &db,
            1,
            tmp.path(),
            &kst(),
            &default_config(),
            plan,
            None,
        )
        .await
        .expect_err("wrapper must surface failure");

        // execute failed at create_backup_dir (blocked by the regular file we
        // pre-created). Rollback also fails (manifest never written), but the
        // wrapper bundles both — the execute_error is the primary signal.
        match &err.execute_error {
            OculpmError::Io { .. } => {}
            other => panic!("expected Io error from create_dir_all, got {other:?}"),
        }
        assert!(
            err.rollback.is_err(),
            "rollback should fail because no manifest was written"
        );

        // The blocker file is still where we left it — wrapper didn't try
        // to delete anything outside the journal tree.
        assert!(blocker.exists());
    }
}

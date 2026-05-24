//! Read-side SQLite cache over `.oculpm/journal/<workday>/<Category>/*.md`.
//!
//! The cache is **lossy by design** — every row can be dropped and rebuilt
//! by walking the journal directory via [`JournalCache::reindex_full`]. The
//! on-disk markdown is the single source of truth; SQLite exists only to
//! keep the Today UI's list/filter/search calls in the millisecond range.
//!
//! See `docs/major_update/oculpm/01-backend.md` §9 (SSOT for table shape)
//! and `docs/major_update/oculpm/W3/PR2-cache-sqlite.md`.

#![allow(dead_code)] // Surfaced as Tauri commands by `commands/oculpm.rs`
                     // (W3-PR3) and consumed by `WorkspaceContext` (W3-PR4).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::Utc;
use rusqlite::{params, params_from_iter, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;
use walkdir::WalkDir;

use crate::db::Db;
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{parse_frontmatter_and_body, ParsedFrontmatter};
use crate::oculpm::markdown::{parse_body, ParsedBody};
use crate::oculpm::spec::{
    AgentRef, Difficulty, EntryStatus, EntryType, FileOp, FileTouched, JournalEntry,
    JournalEntrySummary, JournalFrontmatter,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// User-facing filter for `list_entries`. Empty `types` means "all types".
/// `search` matches against `title`, `slug`, `body_markdown`, and any tag
/// in `oculpm_journal_tags` (case-insensitive for ASCII; substring for
/// other scripts including Hangul).
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct EntryFilters {
    pub types: Vec<EntryType>,
    pub verified_only: bool,
    /// Reserved for W4 (LayerComparison). PR2 wires the column path but
    /// `mismatch_only=true` returns no rows because no entry has been
    /// flagged yet.
    pub mismatch_only: bool,
    /// `checkbox == Some(false)` OR `status != "done"`.
    pub unfinished_only: bool,
    pub search: Option<String>,
}

/// Result of a reindex pass. All counters are `u32` to stay specta-safe
/// (avoids BigInt export — see `oculpm/spec.rs` doc on `u32` caps).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CacheReindexReport {
    pub inserted: u32,
    pub updated: u32,
    pub deleted: u32,
    pub skipped_unchanged: u32,
    pub parse_errors: u32,
    pub elapsed_ms: u32,
}

/// File-system event kind delivered by the watcher (W2-PR5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathChangeKind {
    Created,
    Modified,
    Removed,
}

// ─────────────────────────────────────────────────────────────────────────────
// JournalCache
// ─────────────────────────────────────────────────────────────────────────────

/// Thin facade over the `oculpm_journal*` tables. Holds a shared reference
/// to the process-wide [`Db`] connection — no extra connection pooling.
pub struct JournalCache<'a> {
    db: &'a Db,
}

impl<'a> JournalCache<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    // ────────── single-entry operations ──────────

    /// Insert or replace one journal entry. Cheap when `body_md_hash`
    /// matches the existing row: only the `file_mtime` column changes,
    /// avoiding a wholesale rewrite of the tags/files child tables.
    ///
    /// `full_text` is the original on-disk markdown (frontmatter + body) —
    /// it drives the content hash used by the mtime-only fast path. Hashing
    /// only `body.raw` would miss frontmatter-only edits like the
    /// `verified_by_user` toggle.
    pub async fn upsert_entry(
        &self,
        project_id: u32,
        relative_path: &str,
        parsed: &ParsedFrontmatter,
        body: &ParsedBody,
        file_mtime: i64,
        full_text: &str,
    ) -> Result<UpsertOutcome, OculpmError> {
        let snapshot = CacheRowSnapshot::from(parsed, body, relative_path, full_text)?;
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let snap = snapshot.clone();

        let outcome = self
            .db
            .conn()
            .call(move |c| {
                let existing: Option<(String, i64)> = c
                    .query_row(
                        "SELECT body_md_hash, file_mtime FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                    )
                    .optional()?;

                if let Some((ref existing_hash, existing_mtime)) = existing {
                    if existing_hash == &snap.body_md_hash {
                        // Body identical — bump mtime only and exit.
                        if existing_mtime != file_mtime {
                            c.execute(
                                "UPDATE oculpm_journal SET file_mtime = ?1
                                 WHERE project_id = ?2 AND relative_path = ?3",
                                params![file_mtime, pid, &rp],
                            )?;
                            return Ok(UpsertOutcomeRaw::MtimeOnly);
                        }
                        return Ok(UpsertOutcomeRaw::SkippedUnchanged);
                    }
                }

                let tx = c.transaction()?;
                // Wholesale rewrite of the entry + child tables.
                tx.execute(
                    "INSERT INTO oculpm_journal
                     (project_id, relative_path, workday, type, slug, status, difficulty,
                      title, checkbox, session_id, agent_id, language, verified_by_user,
                      created_at, updated_at, file_mtime, body_markdown, body_md_hash,
                      parse_ok, parse_warnings)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
                     ON CONFLICT(project_id, relative_path) DO UPDATE SET
                       workday = excluded.workday,
                       type = excluded.type,
                       slug = excluded.slug,
                       status = excluded.status,
                       difficulty = excluded.difficulty,
                       title = excluded.title,
                       checkbox = excluded.checkbox,
                       session_id = excluded.session_id,
                       agent_id = excluded.agent_id,
                       language = excluded.language,
                       verified_by_user = excluded.verified_by_user,
                       created_at = excluded.created_at,
                       updated_at = excluded.updated_at,
                       file_mtime = excluded.file_mtime,
                       body_markdown = excluded.body_markdown,
                       body_md_hash = excluded.body_md_hash,
                       parse_ok = excluded.parse_ok,
                       parse_warnings = excluded.parse_warnings",
                    params![
                        pid,
                        &rp,
                        &snap.workday,
                        &snap.entry_type,
                        &snap.slug,
                        &snap.status,
                        &snap.difficulty,
                        &snap.title,
                        snap.checkbox,
                        &snap.session_id,
                        &snap.agent_id,
                        &snap.language,
                        snap.verified_by_user as i64,
                        &snap.created_at,
                        &snap.updated_at,
                        file_mtime,
                        &snap.body_markdown,
                        &snap.body_md_hash,
                        snap.parse_ok as i64,
                        &snap.parse_warnings,
                    ],
                )?;

                tx.execute(
                    "DELETE FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                for f in &snap.files {
                    tx.execute(
                        "INSERT INTO oculpm_journal_files
                         (project_id, relative_path, file_path, op, bytes_added, bytes_removed)
                         VALUES (?1,?2,?3,?4,?5,?6)",
                        params![pid, &rp, &f.path, &f.op, f.bytes_added, f.bytes_removed],
                    )?;
                }

                tx.execute(
                    "DELETE FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                for t in &snap.tags {
                    tx.execute(
                        "INSERT OR IGNORE INTO oculpm_journal_tags
                         (project_id, relative_path, tag)
                         VALUES (?1,?2,?3)",
                        params![pid, &rp, t],
                    )?;
                }
                tx.commit()?;
                Ok(if existing.is_some() {
                    UpsertOutcomeRaw::Updated
                } else {
                    UpsertOutcomeRaw::Inserted
                })
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(outcome.into())
    }

    /// Remove an entry. Idempotent — deleting a non-existent row is `Ok(())`
    /// with no side effects.
    pub async fn delete_entry(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<bool, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let removed = self
            .db
            .conn()
            .call(move |c| {
                let tx = c.transaction()?;
                let removed = tx.execute(
                    "DELETE FROM oculpm_journal
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.commit()?;
                Ok(removed > 0)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(removed)
    }

    // ────────── reads ──────────

    pub async fn list_entries(
        &self,
        project_id: u32,
        workday: Option<&str>,
        filters: &EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        let pid = project_id as i64;
        let workday = workday.map(str::to_string);
        let filters = filters.clone();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let (sql, bound) = build_list_sql(pid, workday.as_deref(), &filters);
                let mut stmt = c.prepare(&sql)?;
                let collected: rusqlite::Result<Vec<JournalEntrySummary>> = stmt
                    .query_map(params_from_iter(bound.iter()), summary_from_row)?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;

        // Hydrate per-row tag/file counts in one extra query for the rows
        // returned. (Naive N+1 would be unacceptable; we batch with IN.)
        if rows.is_empty() {
            return Ok(rows);
        }
        let mut by_path: HashMap<String, (Vec<String>, u32)> = HashMap::new();
        let pid2 = project_id as i64;
        let paths: Vec<String> = rows.iter().map(|r| r.relative_path.clone()).collect();
        let paths_for_query = paths.clone();
        let agg = self
            .db
            .conn()
            .call(move |c| {
                let mut out: HashMap<String, (Vec<String>, u32)> = HashMap::new();
                let placeholders = (1..=paths_for_query.len())
                    .map(|i| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(",");
                let tag_sql = format!(
                    "SELECT relative_path, tag FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path IN ({placeholders})"
                );
                let mut bound: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(paths_for_query.len() + 1);
                bound.push(Box::new(pid2));
                for p in &paths_for_query {
                    bound.push(Box::new(p.clone()));
                }
                let mut stmt = c.prepare(&tag_sql)?;
                let bound_refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
                let tag_iter = stmt.query_map(params_from_iter(bound_refs.iter().copied()), |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?;
                for row in tag_iter {
                    let (path, tag) = row?;
                    out.entry(path).or_default().0.push(tag);
                }

                let file_sql = format!(
                    "SELECT relative_path, COUNT(*) FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path IN ({placeholders})
                     GROUP BY relative_path"
                );
                let mut stmt2 = c.prepare(&file_sql)?;
                let bound_refs2: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
                let file_iter = stmt2.query_map(
                    params_from_iter(bound_refs2.iter().copied()),
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u32)),
                )?;
                for row in file_iter {
                    let (path, count) = row?;
                    out.entry(path).or_default().1 = count;
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        by_path.extend(agg);

        let mut hydrated = rows;
        for row in &mut hydrated {
            if let Some((tags, files_count)) = by_path.remove(&row.relative_path) {
                row.tags = tags;
                row.files_count = files_count;
            }
        }
        Ok(hydrated)
    }

    pub async fn get_entry(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<JournalEntry>, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let row = self
            .db
            .conn()
            .call(move |c| {
                let row: Option<EntryRow> = c
                    .query_row(
                        "SELECT relative_path, type, slug, status, difficulty, title, checkbox,
                                session_id, agent_id, language, verified_by_user, created_at,
                                updated_at, file_mtime, body_markdown
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        entry_row_from,
                    )
                    .optional()?;
                let Some(row) = row else { return Ok(None) };
                let files: Vec<FileTouched> = {
                    let mut stmt = c.prepare(
                        "SELECT file_path, op, bytes_added, bytes_removed
                         FROM oculpm_journal_files
                         WHERE project_id = ?1 AND relative_path = ?2",
                    )?;
                    let collected: rusqlite::Result<Vec<FileTouched>> = stmt
                        .query_map(params![pid, &rp], file_touched_from_row)?
                        .collect();
                    collected?
                };
                let tags: Vec<String> = {
                    let mut stmt = c.prepare(
                        "SELECT tag FROM oculpm_journal_tags
                         WHERE project_id = ?1 AND relative_path = ?2",
                    )?;
                    let collected: rusqlite::Result<Vec<String>> = stmt
                        .query_map(params![pid, &rp], |r| r.get::<_, String>(0))?
                        .collect();
                    collected?
                };
                Ok(Some((row, files, tags)))
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(row.map(|(r, files, tags)| {
            let entry_type = parse_entry_type_str(&r.entry_type).unwrap_or(EntryType::Chore);
            let status = parse_entry_status_str(&r.status).unwrap_or(EntryStatus::Planned);
            let difficulty = r.difficulty.as_deref().and_then(parse_difficulty_str);
            let body_bytes = r.body_markdown.len() as u32;
            JournalEntry {
                relative_path: r.relative_path,
                frontmatter: JournalFrontmatter {
                    schema_version: 1,
                    entry_type,
                    slug: r.slug,
                    status,
                    difficulty,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    session_id: r.session_id,
                    agent: AgentRef {
                        id: r.agent_id,
                        version: None,
                    },
                    language: r.language,
                    verified_by_user: r.verified_by_user,
                    files_touched: files,
                    related: Vec::new(), // related is not cached separately yet
                    tags,
                },
                title: r.title,
                checkbox: r.checkbox.map(|n| n != 0),
                body_markdown: r.body_markdown,
                byte_size: body_bytes,
                mtime: r.file_mtime.to_string(),
            }
        }))
    }

    // ────────── reindex ──────────

    /// Drop every cached row for `project_id` and rebuild from disk. Use
    /// after manual SQLite tampering or schema migration. O(journal-size).
    pub async fn reindex_full(
        &self,
        project_id: u32,
        journal_root: &Path,
    ) -> Result<CacheReindexReport, OculpmError> {
        let started = Instant::now();
        // Drop everything for this project — three tables, one tx.
        let pid = project_id as i64;
        self.db
            .conn()
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM oculpm_journal WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_files WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_tags WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.commit()?;
                Ok(())
            })
            .await
            .map_err(map_sqlite_err)?;

        let mut report = CacheReindexReport {
            inserted: 0,
            updated: 0,
            deleted: 0,
            skipped_unchanged: 0,
            parse_errors: 0,
            elapsed_ms: 0,
        };

        for (relative_path, mtime) in walk_journal(journal_root) {
            let abs = journal_root.join(&relative_path);
            let text = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue, // file deleted between walk and read
            };
            let (parsed, body_text) = parse_frontmatter_and_body(&text);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            let body = parse_body(&body_text);
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &text)
                .await
            {
                Ok(UpsertOutcome::Inserted) => report.inserted += 1,
                Ok(UpsertOutcome::Updated) => report.updated += 1,
                Ok(UpsertOutcome::MtimeOnly | UpsertOutcome::SkippedUnchanged) => {
                    report.skipped_unchanged += 1
                }
                Err(e) => {
                    tracing::warn!(target: "oculpm::cache", path = %relative_path, error = %e, "reindex upsert failed");
                    report.parse_errors += 1;
                }
            }
        }

        report.elapsed_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(report)
    }

    /// Incremental rebuild — only re-parse files whose `file_mtime` differs
    /// from the cached value, and delete rows whose underlying file is
    /// gone. O(walk + changed-files).
    pub async fn reindex_incremental(
        &self,
        project_id: u32,
        journal_root: &Path,
    ) -> Result<CacheReindexReport, OculpmError> {
        let started = Instant::now();
        let known = self.load_known_mtimes(project_id).await?;
        let mut report = CacheReindexReport {
            inserted: 0,
            updated: 0,
            deleted: 0,
            skipped_unchanged: 0,
            parse_errors: 0,
            elapsed_ms: 0,
        };

        let mut seen: HashMap<String, ()> = HashMap::new();
        for (relative_path, mtime) in walk_journal(journal_root) {
            seen.insert(relative_path.clone(), ());
            let cached_mtime = known.get(&relative_path).copied();
            if cached_mtime == Some(mtime) {
                report.skipped_unchanged += 1;
                continue;
            }
            let abs = journal_root.join(&relative_path);
            let text = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let (parsed, body_text) = parse_frontmatter_and_body(&text);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            let body = parse_body(&body_text);
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &text)
                .await
            {
                Ok(UpsertOutcome::Inserted) => report.inserted += 1,
                Ok(UpsertOutcome::Updated) => report.updated += 1,
                Ok(UpsertOutcome::MtimeOnly | UpsertOutcome::SkippedUnchanged) => {
                    report.skipped_unchanged += 1
                }
                Err(e) => {
                    tracing::warn!(target: "oculpm::cache", path = %relative_path, error = %e, "incremental upsert failed");
                    report.parse_errors += 1;
                }
            }
        }

        // Anything in the cache that we didn't observe on disk is gone.
        for path in known.keys() {
            if !seen.contains_key(path) && self.delete_entry(project_id, path).await? {
                report.deleted += 1;
            }
        }

        report.elapsed_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(report)
    }

    /// Handle a single path-level change event from the watcher (W2-PR5).
    /// Created/Modified are coalesced — the cache always reads the latest
    /// on-disk state rather than trusting the event payload.
    pub async fn apply_path_change(
        &self,
        project_id: u32,
        journal_root: &Path,
        relative_path: &str,
        kind: PathChangeKind,
    ) -> Result<(), OculpmError> {
        match kind {
            PathChangeKind::Removed => {
                self.delete_entry(project_id, relative_path).await?;
            }
            PathChangeKind::Created | PathChangeKind::Modified => {
                let abs = journal_root.join(relative_path);
                let meta = std::fs::metadata(&abs).map_err(|source| OculpmError::Io {
                    path: abs.clone(),
                    source,
                })?;
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or_else(|| Utc::now().timestamp());
                let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
                    path: abs,
                    source,
                })?;
                let (parsed, body_text) = parse_frontmatter_and_body(&text);
                let body = parse_body(&body_text);
                self.upsert_entry(project_id, relative_path, &parsed, &body, mtime, &text)
                    .await?;
            }
        }
        Ok(())
    }

    async fn load_known_mtimes(
        &self,
        project_id: u32,
    ) -> Result<HashMap<String, i64>, OculpmError> {
        let pid = project_id as i64;
        let map = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, file_mtime FROM oculpm_journal
                     WHERE project_id = ?1",
                )?;
                let mut out: HashMap<String, i64> = HashMap::new();
                let rows = stmt.query_map(params![pid], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })?;
                for row in rows {
                    let (k, v) = row?;
                    out.insert(k, v);
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(map)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/// The outcome the test/UI surface cares about — collapses the more
/// granular `UpsertOutcomeRaw` from inside the sqlite closure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    Inserted,
    Updated,
    /// body unchanged, mtime bumped — counted as `skipped_unchanged` in
    /// reindex reports since the body is what users care about.
    MtimeOnly,
    /// body and mtime both identical to the cached row — true no-op.
    SkippedUnchanged,
}

#[derive(Debug, Clone, Copy)]
enum UpsertOutcomeRaw {
    Inserted,
    Updated,
    MtimeOnly,
    SkippedUnchanged,
}

impl From<UpsertOutcomeRaw> for UpsertOutcome {
    fn from(value: UpsertOutcomeRaw) -> Self {
        match value {
            UpsertOutcomeRaw::Inserted => Self::Inserted,
            UpsertOutcomeRaw::Updated => Self::Updated,
            UpsertOutcomeRaw::MtimeOnly => Self::MtimeOnly,
            UpsertOutcomeRaw::SkippedUnchanged => Self::SkippedUnchanged,
        }
    }
}

/// Owned snapshot of the row we're about to write — kept apart from the
/// async closure so it can be moved into `.call(move |c| { ... })`.
#[derive(Debug, Clone)]
struct CacheRowSnapshot {
    workday: String,
    entry_type: String,
    slug: String,
    status: String,
    difficulty: Option<String>,
    title: String,
    checkbox: Option<i64>,
    session_id: String,
    agent_id: String,
    language: String,
    verified_by_user: bool,
    created_at: String,
    updated_at: Option<String>,
    body_markdown: String,
    body_md_hash: String,
    parse_ok: bool,
    parse_warnings: Option<String>,
    files: Vec<CacheFileRow>,
    tags: Vec<String>,
}

#[derive(Debug, Clone)]
struct CacheFileRow {
    path: String,
    op: String,
    bytes_added: Option<u32>,
    bytes_removed: Option<u32>,
}

impl CacheRowSnapshot {
    fn from(
        parsed: &ParsedFrontmatter,
        body: &ParsedBody,
        relative_path: &str,
        full_text: &str,
    ) -> Result<Self, OculpmError> {
        // Hash the full on-disk text so frontmatter-only edits (verified
        // toggle, status change) defeat the mtime-only fast path.
        let body_md_hash = blake3::hash(full_text.as_bytes()).to_hex().to_string();
        let workday = workday_from_relative_path(relative_path);
        let parse_warnings = if parsed.parse_warnings.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&parsed.parse_warnings).map_err(OculpmError::JsonSerialize)?)
        };

        match &parsed.parsed {
            Some(fm) => Ok(Self {
                workday,
                entry_type: entry_type_as_str(fm.entry_type).to_string(),
                slug: fm.slug.clone(),
                status: entry_status_as_str(fm.status).to_string(),
                difficulty: fm.difficulty.map(|d| difficulty_as_str(d).to_string()),
                title: body.title.clone(),
                checkbox: body.checkbox.map(i64::from),
                session_id: fm.session_id.clone(),
                agent_id: fm.agent.id.clone(),
                language: fm.language.clone(),
                verified_by_user: fm.verified_by_user,
                created_at: fm.created_at.clone(),
                updated_at: fm.updated_at.clone(),
                body_markdown: body.raw.clone(),
                body_md_hash,
                parse_ok: parsed.parse_warnings.is_empty(),
                parse_warnings,
                files: fm
                    .files_touched
                    .iter()
                    .map(|f| CacheFileRow {
                        path: f.path.clone(),
                        op: file_op_as_str(f.op).to_string(),
                        bytes_added: f.bytes_added,
                        bytes_removed: f.bytes_removed,
                    })
                    .collect(),
                tags: fm.tags.clone(),
            }),
            None => {
                // Frontmatter unparseable — synthesise a "chore" row so the
                // entry still appears in the cache (and the UI can show a
                // warning badge). The PR1 parser preserves raw_yaml, so we
                // never lose user data.
                Ok(Self {
                    workday,
                    entry_type: "chore".to_string(),
                    slug: derive_slug_from_path(relative_path),
                    status: "planned".to_string(),
                    difficulty: None,
                    title: if body.title.is_empty() {
                        relative_path.to_string()
                    } else {
                        body.title.clone()
                    },
                    checkbox: body.checkbox.map(i64::from),
                    session_id: String::new(),
                    agent_id: "unknown".to_string(),
                    language: "ko".to_string(),
                    verified_by_user: false,
                    created_at: String::new(),
                    updated_at: None,
                    body_markdown: body.raw.clone(),
                    body_md_hash,
                    parse_ok: false,
                    parse_warnings,
                    files: Vec::new(),
                    tags: Vec::new(),
                })
            }
        }
    }
}

#[derive(Debug)]
struct EntryRow {
    relative_path: String,
    entry_type: String,
    slug: String,
    status: String,
    difficulty: Option<String>,
    title: String,
    checkbox: Option<i64>,
    session_id: String,
    agent_id: String,
    language: String,
    verified_by_user: bool,
    created_at: String,
    updated_at: Option<String>,
    file_mtime: i64,
    body_markdown: String,
}

fn entry_row_from(r: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRow> {
    Ok(EntryRow {
        relative_path: r.get(0)?,
        entry_type: r.get(1)?,
        slug: r.get(2)?,
        status: r.get(3)?,
        difficulty: r.get(4)?,
        title: r.get(5)?,
        checkbox: r.get(6)?,
        session_id: r.get(7)?,
        agent_id: r.get(8)?,
        language: r.get(9)?,
        verified_by_user: r.get::<_, i64>(10)? != 0,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
        file_mtime: r.get(13)?,
        body_markdown: r.get(14)?,
    })
}

fn summary_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<JournalEntrySummary> {
    let entry_type_str: String = r.get("type")?;
    let status_str: String = r.get("status")?;
    let difficulty_str: Option<String> = r.get("difficulty")?;
    let checkbox: Option<i64> = r.get("checkbox")?;
    Ok(JournalEntrySummary {
        relative_path: r.get("relative_path")?,
        workday: r.get("workday")?,
        entry_type: parse_entry_type_str(&entry_type_str).unwrap_or(EntryType::Chore),
        slug: r.get("slug")?,
        status: parse_entry_status_str(&status_str).unwrap_or(EntryStatus::Planned),
        difficulty: difficulty_str.as_deref().and_then(parse_difficulty_str),
        title: r.get("title")?,
        checkbox: checkbox.map(|n| n != 0),
        session_id: r.get("session_id")?,
        agent_id: r.get("agent_id")?,
        verified_by_user: r.get::<_, i64>("verified_by_user")? != 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        tags: Vec::new(),     // filled by list_entries' batch query
        files_count: 0,       // filled by list_entries' batch query
    })
}

fn file_touched_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FileTouched> {
    let op_str: String = r.get(1)?;
    Ok(FileTouched {
        path: r.get(0)?,
        op: parse_file_op_str(&op_str).unwrap_or(FileOp::Update),
        bytes_added: r.get::<_, Option<i64>>(2)?.map(|n| n as u32),
        bytes_removed: r.get::<_, Option<i64>>(3)?.map(|n| n as u32),
        rename_from: None,
    })
}

fn build_list_sql(
    project_id: i64,
    workday: Option<&str>,
    filters: &EntryFilters,
) -> (String, Vec<Box<dyn rusqlite::ToSql + Send>>) {
    let mut sql = String::from(
        "SELECT relative_path, workday, type, slug, status, difficulty, title, checkbox,
                session_id, agent_id, verified_by_user, created_at, updated_at
         FROM oculpm_journal
         WHERE project_id = ?1",
    );
    let mut bound: Vec<Box<dyn rusqlite::ToSql + Send>> = Vec::new();
    bound.push(Box::new(project_id));

    if let Some(wd) = workday {
        bound.push(Box::new(wd.to_string()));
        sql.push_str(&format!(" AND workday = ?{}", bound.len()));
    }
    if !filters.types.is_empty() {
        let placeholders: Vec<String> = filters
            .types
            .iter()
            .map(|t| {
                bound.push(Box::new(entry_type_as_str(*t).to_string()));
                format!("?{}", bound.len())
            })
            .collect();
        sql.push_str(&format!(" AND type IN ({})", placeholders.join(",")));
    }
    if filters.verified_only {
        sql.push_str(" AND verified_by_user = 1");
    }
    if filters.mismatch_only {
        // Reserved for W4 — no row carries the flag yet. Use an impossible
        // predicate so the result set is provably empty without raising.
        sql.push_str(" AND 0 = 1");
    }
    if filters.unfinished_only {
        sql.push_str(" AND (status != 'done' OR checkbox = 0)");
    }
    if let Some(q) = filters.search.as_ref().filter(|q| !q.trim().is_empty()) {
        let needle = format!("%{}%", q.trim());
        bound.push(Box::new(needle));
        let idx = bound.len();
        sql.push_str(&format!(
            " AND (LOWER(title) LIKE LOWER(?{idx})
                  OR LOWER(slug) LIKE LOWER(?{idx})
                  OR body_markdown LIKE ?{idx}
                  OR relative_path IN (
                       SELECT relative_path FROM oculpm_journal_tags
                       WHERE project_id = ?1 AND tag LIKE ?{idx}
                  ))"
        ));
    }
    sql.push_str(" ORDER BY workday DESC, created_at DESC, relative_path DESC");
    (sql, bound)
}

fn walk_journal(journal_root: &Path) -> Vec<(String, i64)> {
    if !journal_root.exists() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for entry in WalkDir::new(journal_root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let rel: PathBuf = match path.strip_prefix(journal_root) {
            Ok(p) => p.to_path_buf(),
            Err(_) => continue,
        };
        // Skip implementation files: _template.md, _attachments/, .* hidden.
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str.starts_with('_')
            || rel_str.contains("/_attachments/")
            || rel_str
                .split('/')
                .any(|seg| seg.starts_with('.'))
        {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push((rel_str, mtime));
    }
    out
}

fn workday_from_relative_path(relative_path: &str) -> String {
    // `<workday>/<Category>/<file>.md` — workday is the first path segment.
    relative_path
        .split('/')
        .next()
        .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or("00000000")
        .to_string()
}

fn derive_slug_from_path(relative_path: &str) -> String {
    relative_path
        .rsplit('/')
        .next()
        .and_then(|s| s.strip_suffix(".md"))
        .unwrap_or(relative_path)
        .to_string()
}

// ────────── enum <-> str ──────────

fn entry_type_as_str(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

fn parse_entry_type_str(s: &str) -> Option<EntryType> {
    match s {
        "bug" => Some(EntryType::Bug),
        "feature" => Some(EntryType::Feature),
        "error" => Some(EntryType::Error),
        "refactor" => Some(EntryType::Refactor),
        "chore" => Some(EntryType::Chore),
        _ => None,
    }
}

fn entry_status_as_str(s: EntryStatus) -> &'static str {
    match s {
        EntryStatus::Planned => "planned",
        EntryStatus::InProgress => "in_progress",
        EntryStatus::Done => "done",
        EntryStatus::Abandoned => "abandoned",
    }
}

fn parse_entry_status_str(s: &str) -> Option<EntryStatus> {
    match s {
        "planned" => Some(EntryStatus::Planned),
        "in_progress" => Some(EntryStatus::InProgress),
        "done" => Some(EntryStatus::Done),
        "abandoned" => Some(EntryStatus::Abandoned),
        _ => None,
    }
}

fn difficulty_as_str(d: Difficulty) -> &'static str {
    match d {
        Difficulty::Superhigh => "superhigh",
        Difficulty::High => "high",
        Difficulty::Medium => "medium",
        Difficulty::Low => "low",
        Difficulty::Verylow => "verylow",
    }
}

fn parse_difficulty_str(s: &str) -> Option<Difficulty> {
    match s {
        "superhigh" => Some(Difficulty::Superhigh),
        "high" => Some(Difficulty::High),
        "medium" => Some(Difficulty::Medium),
        "low" => Some(Difficulty::Low),
        "verylow" => Some(Difficulty::Verylow),
        _ => None,
    }
}

fn file_op_as_str(op: FileOp) -> &'static str {
    match op {
        FileOp::Create => "create",
        FileOp::Update => "update",
        FileOp::Delete => "delete",
        FileOp::Rename => "rename",
        FileOp::Correct => "correct",
    }
}

fn parse_file_op_str(s: &str) -> Option<FileOp> {
    match s {
        "create" => Some(FileOp::Create),
        "update" | "modify" => Some(FileOp::Update),
        "delete" => Some(FileOp::Delete),
        "rename" => Some(FileOp::Rename),
        "correct" => Some(FileOp::Correct),
        _ => None,
    }
}

fn map_sqlite_err(e: tokio_rusqlite::Error) -> OculpmError {
    OculpmError::Sqlite(e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use std::fs;
    use tempfile::tempdir;

    async fn fresh_db() -> (Db, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Db::open(db_path).await.expect("open db");
        (db, dir)
    }

    fn write_entry(root: &Path, rel: &str, frontmatter: &str, body: &str) -> PathBuf {
        let abs = root.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        let text = if frontmatter.is_empty() {
            body.to_string()
        } else {
            format!("---\n{frontmatter}\n---\n{body}")
        };
        fs::write(&abs, text).unwrap();
        abs
    }

    fn standard_frontmatter(slug: &str) -> String {
        format!(
            "schema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ndifficulty: medium\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\ntags: [\"alpha\", \"beta\"]"
        )
    }

    #[tokio::test]
    async fn empty_journal_full_reindex_yields_zero_counts() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        fs::create_dir_all(&journal_root).unwrap();
        let report = cache.reindex_full(1, &journal_root).await.unwrap();
        assert_eq!(report.inserted, 0);
        assert_eq!(report.deleted, 0);
        assert_eq!(report.parse_errors, 0);
    }

    #[tokio::test]
    async fn three_entries_upsert_via_full_reindex() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-a"),
            "[x] Title A\n\n## body\n",
        );
        write_entry(
            &journal_root,
            "20260524/Bugs/1030_bug_b.md",
            &standard_frontmatter("bug-b"),
            "[ ] Title B\n",
        );
        write_entry(
            &journal_root,
            "20260524/Bugs/1100_bug_c.md",
            &standard_frontmatter("bug-c"),
            "[x] Title C\n",
        );

        let report = cache.reindex_full(1, &journal_root).await.unwrap();
        assert_eq!(report.inserted, 3, "report: {report:?}");
        let rows = cache
            .list_entries(1, Some("20260524"), &EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 3);
        let slugs: Vec<&str> = rows.iter().map(|r| r.slug.as_str()).collect();
        assert!(slugs.contains(&"bug-a"));
        assert!(slugs.contains(&"bug-b"));
        assert!(slugs.contains(&"bug-c"));
        // tags hydrated
        assert!(rows.iter().all(|r| r.tags.contains(&"alpha".to_string())));
        // files_count = 1 (one file_touched per entry)
        assert!(rows.iter().all(|r| r.files_count == 1));
    }

    #[tokio::test]
    async fn delete_on_disk_then_incremental_reindex_drops_row() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let a = write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-a"),
            "[x] A\n",
        );
        write_entry(
            &journal_root,
            "20260524/Bugs/1000_bug_b.md",
            &standard_frontmatter("bug-b"),
            "[ ] B\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();
        fs::remove_file(&a).unwrap();

        let report = cache.reindex_incremental(1, &journal_root).await.unwrap();
        assert_eq!(report.deleted, 1, "report: {report:?}");
        let rows = cache
            .list_entries(1, None, &EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slug, "bug-b");
    }

    #[tokio::test]
    async fn incremental_skips_unchanged_files() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-a"),
            "[x] A\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();
        let report = cache.reindex_incremental(1, &journal_root).await.unwrap();
        assert_eq!(report.inserted, 0);
        assert_eq!(report.updated, 0);
        assert_eq!(report.skipped_unchanged, 1, "report: {report:?}");
    }

    #[tokio::test]
    async fn body_unchanged_with_new_mtime_is_mtime_only() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let path = write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-a"),
            "[x] A\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();
        let new_mtime = std::fs::metadata(&path).unwrap();
        // Rewrite identical body with no mtime change isn't reliable across
        // file systems, so we drive upsert directly with a different mtime.
        let original = std::fs::read_to_string(&path).unwrap();
        let (pf, body_text) = parse_frontmatter_and_body(&original);
        let body = parse_body(&body_text);
        let outcome = cache
            .upsert_entry(
                1,
                "20260524/Bugs/0925_bug_a.md",
                &pf,
                &body,
                new_mtime
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0)
                    + 1000, // force mtime delta
                &original,
            )
            .await
            .unwrap();
        assert_eq!(outcome, UpsertOutcome::MtimeOnly);
    }

    #[tokio::test]
    async fn frontmatter_parse_error_still_caches_with_parse_ok_false() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        // Missing required `slug` field — parser yields parsed=None.
        let broken = "schema_version: 1\ntype: bug\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en";
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_broken.md",
            broken,
            "[x] still has a title\n",
        );
        let report = cache.reindex_full(1, &journal_root).await.unwrap();
        assert_eq!(report.parse_errors, 1, "report: {report:?}");
        assert_eq!(report.inserted, 1, "row still inserted (parse_ok=0)");

        let entry = cache
            .get_entry(1, "20260524/Bugs/0925_bug_broken.md")
            .await
            .unwrap()
            .expect("entry exists");
        // Fallback title from body's first non-blank line.
        assert_eq!(entry.title, "still has a title");
        assert_eq!(entry.frontmatter.entry_type, EntryType::Chore);
    }

    #[tokio::test]
    async fn list_entries_filter_by_type() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-a"),
            "[x] A\n",
        );
        let feat_fm = standard_frontmatter("feat-a").replace("type: bug", "type: feature");
        write_entry(
            &journal_root,
            "20260524/Features_to_add/1000_feature_x.md",
            &feat_fm,
            "[ ] F\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();

        let only_features = cache
            .list_entries(
                1,
                None,
                &EntryFilters {
                    types: vec![EntryType::Feature],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(only_features.len(), 1);
        assert_eq!(only_features[0].slug, "feat-a");
    }

    #[tokio::test]
    async fn list_entries_search_matches_korean_substring() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_a.md",
            &standard_frontmatter("bug-korean"),
            "[x] 한국어 제목\n\n버그가 발생했어요.\n",
        );
        write_entry(
            &journal_root,
            "20260524/Bugs/1030_bug_b.md",
            &standard_frontmatter("bug-other"),
            "[ ] English only\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();

        let rows = cache
            .list_entries(
                1,
                None,
                &EntryFilters {
                    search: Some("한국어".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slug, "bug-korean");
    }

    #[tokio::test]
    async fn list_entries_verified_only_excludes_unverified() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let verified_fm =
            standard_frontmatter("v").replace("language: ko", "language: ko\nverified_by_user: true");
        write_entry(
            &journal_root,
            "20260524/Bugs/0925_bug_v.md",
            &verified_fm,
            "[x] V\n",
        );
        write_entry(
            &journal_root,
            "20260524/Bugs/1030_bug_u.md",
            &standard_frontmatter("u"),
            "[x] U\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();

        let rows = cache
            .list_entries(
                1,
                None,
                &EntryFilters {
                    verified_only: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slug, "v");
    }

    #[tokio::test]
    async fn apply_path_change_created_then_removed_round_trip() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_a.md";
        write_entry(
            &journal_root,
            rel,
            &standard_frontmatter("bug-a"),
            "[x] A\n",
        );

        cache
            .apply_path_change(1, &journal_root, rel, PathChangeKind::Created)
            .await
            .unwrap();
        let rows = cache
            .list_entries(1, None, &EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);

        std::fs::remove_file(journal_root.join(rel)).unwrap();
        cache
            .apply_path_change(1, &journal_root, rel, PathChangeKind::Removed)
            .await
            .unwrap();
        let rows = cache
            .list_entries(1, None, &EntryFilters::default())
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn reindex_full_drops_previous_project_rows() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_a.md";
        write_entry(&journal_root, rel, &standard_frontmatter("a"), "[x] A\n");
        cache.reindex_full(1, &journal_root).await.unwrap();
        std::fs::remove_file(journal_root.join(rel)).unwrap();
        let report = cache.reindex_full(1, &journal_root).await.unwrap();
        assert_eq!(report.inserted, 0);
        let rows = cache
            .list_entries(1, None, &EntryFilters::default())
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn template_and_attachments_are_skipped() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        // Real entry
        write_entry(&journal_root, "20260524/Bugs/0925_bug_a.md", &standard_frontmatter("a"), "[x]\n");
        // Should-be-skipped helpers
        write_entry(&journal_root, "_template.md", "", "ignored template\n");
        write_entry(&journal_root, "20260524/_attachments/note.md", "", "scratch\n");
        write_entry(&journal_root, "20260524/Bugs/.draft.md", "", "hidden\n");

        let report = cache.reindex_full(1, &journal_root).await.unwrap();
        assert_eq!(report.inserted, 1, "only real entry should be cached");
    }

    #[tokio::test]
    async fn get_entry_returns_none_for_missing_path() {
        let (db, _dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let result = cache.get_entry(1, "20260524/Bugs/none.md").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn upsert_outcome_signals_inserted_then_updated() {
        let (db, dir) = fresh_db().await;
        let cache = JournalCache::new(&db);
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_a.md";
        let abs = write_entry(&journal_root, rel, &standard_frontmatter("a"), "[x] v1\n");
        let mtime = std::fs::metadata(&abs).unwrap();
        let text1 = std::fs::read_to_string(&abs).unwrap();
        let (pf1, body_text1) = parse_frontmatter_and_body(&text1);
        let body1 = parse_body(&body_text1);
        let mtime_secs = mtime
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        assert_eq!(
            cache
                .upsert_entry(1, rel, &pf1, &body1, mtime_secs, &text1)
                .await
                .unwrap(),
            UpsertOutcome::Inserted
        );
        // Rewrite with different body → Updated
        std::fs::write(&abs, format!("---\n{}\n---\n[x] v2\n", standard_frontmatter("a"))).unwrap();
        let text2 = std::fs::read_to_string(&abs).unwrap();
        let (pf2, body_text2) = parse_frontmatter_and_body(&text2);
        let body2 = parse_body(&body_text2);
        assert_eq!(
            cache
                .upsert_entry(1, rel, &pf2, &body2, mtime_secs + 10, &text2)
                .await
                .unwrap(),
            UpsertOutcome::Updated
        );
    }
}

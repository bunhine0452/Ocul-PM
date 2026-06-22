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
use chrono_tz::Tz;
use regex::Regex;
use rusqlite::{params, params_from_iter, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;
use walkdir::WalkDir;

use crate::db::Db;
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{
    backfill_tz_offset, iso_lacks_offset, normalize_slug, parse_frontmatter_and_body,
    ParsedFrontmatter,
};
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
    /// W5-PR6 — agent_id filter. Empty = no constraint (all agents).
    #[serde(default)]
    pub agents: Vec<String>,
    /// W5-PR6 — difficulty filter. Empty = no constraint. Note the cache
    /// column is nullable ("미지정"); difficulty filter therefore *cannot*
    /// match the null bucket — that's a separate W6 toggle.
    #[serde(default)]
    pub difficulties: Vec<Difficulty>,
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

/// One plan item linked (via the plan-log `journal_ref`) to a changed-file
/// group's journal entry. Dogfooding #3 — surfaces "어떤 plan 에서" in the diff.
#[derive(Debug, Clone, Serialize, Type)]
pub struct ChangePlanRef {
    pub plan_id: String,
    pub plan_title: String,
    pub item_title: String,
}

/// A group of changed files attributed to one journal entry (Dogfooding #3).
/// `entry_path == None` is the trailing "미기록 변경" bucket for files no
/// journal entry recorded.
#[derive(Debug, Clone, Serialize, Type)]
pub struct ChangeGroup {
    pub entry_path: Option<String>,
    pub entry_title: Option<String>,
    pub entry_type: Option<String>,
    pub created_at: Option<String>,
    pub plan_refs: Vec<ChangePlanRef>,
    pub files: Vec<String>,
}

/// Thin facade over the `oculpm_journal*` tables. Holds a shared reference
/// to the process-wide [`Db`] connection — no extra connection pooling.
pub struct JournalCache<'a> {
    db: &'a Db,
    /// On-projection secret masking applied to journal text *before* it enters
    /// SQLite. Empty (the [`new`][Self::new] default) → no masking. Populated
    /// via [`with_redaction`][Self::with_redaction] on the paths that project
    /// agent-authored disk content into the cache (watcher, reindex, cache-miss
    /// disk read) so a pasted key never reaches the cache → AI context. The
    /// on-disk markdown is left untouched (it is the SSOT). See dev-report §2.
    redact: Vec<Regex>,
    /// Project timezone for read-time `created_at`/`updated_at` offset backfill
    /// (F7a-B). `None` (the query-path default) → detect-and-warn only, no
    /// rewrite. Set via [`with_tz`][Self::with_tz] on the indexing/projection
    /// paths. Disk is never touched — only the cached/displayed value.
    tz: Option<Tz>,
}

impl<'a> JournalCache<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self {
            db,
            redact: Vec::new(),
            tz: None,
        }
    }

    /// Like [`new`][Self::new] but masks secrets matching `redact` as journal
    /// text is projected into the cache (dev-report §2 / R1). Use this on the
    /// watcher / reindex / disk-read paths; the read-only query paths can stay
    /// on [`new`][Self::new] since the cache they read is already masked.
    pub fn with_redaction(db: &'a Db, redact: Vec<Regex>) -> Self {
        Self {
            db,
            redact,
            tz: None,
        }
    }

    /// Attach the project timezone so [`CacheRowSnapshot::from`] backfills a
    /// missing offset onto `created_at`/`updated_at` (F7a-B). Chainable after
    /// [`with_redaction`][Self::with_redaction] on every disk→cache projection
    /// path. Without it the coercion degrades to detect-and-warn (still safe).
    pub fn with_tz(mut self, tz: Tz) -> Self {
        self.tz = Some(tz);
        self
    }

    /// Parse a journal file's raw text for projection into the cache, masking
    /// secrets in the **body only** — never the YAML frontmatter, where a
    /// `[REDACTED]` placeholder would parse as a flow sequence (`['REDACTED']`)
    /// and degrade the row to an unparseable `chore` (dev-report §2 / R1). The
    /// at-write writers (`create_manual_journal_entry` / `update_journal_entry_body`)
    /// already mask only the body for the same reason.
    ///
    /// Returns `(frontmatter, masked body, full-text for the body-hash gate,
    /// redacted span count)`. This is the **single producer** of the cache's
    /// `full_text`, so the body-hash basis is consistent across every projection
    /// path. When nothing is masked it returns `raw` verbatim, so a no-secret
    /// file projects byte-identically to the non-redacting path (the no-churn
    /// mtime fast path in [`upsert_entry`][Self::upsert_entry] still holds);
    /// only when a secret is actually replaced does it rebuild a deterministic
    /// `---\n<frontmatter>\n---\n<masked body>` so re-scans stay stable.
    pub(crate) fn project_text(
        &self,
        raw: &str,
    ) -> (ParsedFrontmatter, ParsedBody, String, usize) {
        let (parsed, body_text) = parse_frontmatter_and_body(raw);
        if self.redact.is_empty() {
            let body = parse_body(&body_text);
            return (parsed, body, raw.to_string(), 0);
        }
        let (masked_body, hits) = crate::oculpm::redact::redact_text(&body_text, &self.redact);
        if hits.is_empty() {
            // No secret in the body → identical projection to the non-redacting
            // path (full_text == raw keeps the hash basis stable).
            let body = parse_body(&body_text);
            return (parsed, body, raw.to_string(), 0);
        }
        let full = if parsed.raw_yaml.is_empty() {
            masked_body.clone()
        } else {
            format!("---\n{}\n---\n{}", parsed.raw_yaml, masked_body)
        };
        let body = parse_body(&masked_body);
        (parsed, body, full, hits.len())
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
        let snapshot = CacheRowSnapshot::from(parsed, body, relative_path, full_text, self.tz)?;
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
                      title, checkbox, session_id, agent_id, agent_version, language,
                      verified_by_user, created_at, updated_at, file_mtime, body_markdown,
                      body_md_hash, parse_ok, parse_warnings)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)
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
                       agent_version = excluded.agent_version,
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
                        &snap.agent_version,
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

    /// W4-PR5 — distinct `files_touched[].path` union across every journal
    /// entry that names `session_id`. Drives `LayerComparison` without
    /// hydrating the full entries. Uses `idx_oculpm_journal_session` for the
    /// session lookup; the join into `oculpm_journal_files` is bounded by the
    /// per-entry primary key so cost stays O(entries-in-session).
    ///
    /// Intentionally workday-free: a `session_id` is globally unique
    /// (`YYYYMMDD-NNN`) so the session index alone is enough, and not
    /// requiring callers to know the *cache row's* workday avoids subtle
    /// drift when the frontmatter workday and the session_id prefix
    /// disagree (e.g., manual `session_id` overrides in `ManualEntryDraft`).
    pub async fn files_for_session(
        &self,
        project_id: u32,
        session_id: &str,
    ) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let session_id = session_id.to_string();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT f.file_path
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id
                      AND j.relative_path = f.relative_path
                     WHERE j.project_id = ?1
                       AND j.session_id = ?2",
                )?;
                let collected: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid, &session_id], |r| r.get::<_, String>(0))?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    /// Group changed file paths by the journal entry that most recently touched
    /// each (Dogfooding #3). Each entry group carries the plan items linked to
    /// it (via the plan-log `journal_ref`). Paths no entry recorded fall into a
    /// trailing `entry_path: None` bucket. Entry groups are newest-first.
    pub async fn group_changes(
        &self,
        project_id: u32,
        paths: Vec<String>,
    ) -> Result<Vec<ChangeGroup>, OculpmError> {
        let pid = project_id as i64;
        let groups = self
            .db
            .conn()
            .call(move |c| {
                let mut find = c.prepare(
                    "SELECT j.relative_path, j.title, j.type, j.created_at
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id AND j.relative_path = f.relative_path
                     WHERE f.project_id = ?1 AND f.file_path = ?2
                     ORDER BY j.created_at DESC
                     LIMIT 1",
                )?;
                let mut plan_stmt = c.prepare(
                    "SELECT DISTINCT p.plan_id, p.title, pi.title
                     FROM oculpm_plan_item_updates u
                     JOIN oculpm_plans p
                       ON p.project_id = u.project_id AND p.plan_id = u.plan_id
                     JOIN oculpm_plan_items pi
                       ON pi.project_id = u.project_id AND pi.plan_id = u.plan_id
                      AND pi.item_id = u.item_id
                     WHERE u.project_id = ?1 AND u.journal_ref LIKE '%' || ?2",
                )?;

                let mut order: Vec<String> = Vec::new();
                let mut by_entry: HashMap<String, (String, String, String, Vec<String>)> =
                    HashMap::new();
                let mut untracked: Vec<String> = Vec::new();

                for path in &paths {
                    let hit = find
                        .query_row(params![pid, path], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                                r.get::<_, String>(3)?,
                            ))
                        })
                        .optional()?;
                    match hit {
                        Some((rp, title, ty, created)) => {
                            let e = by_entry.entry(rp.clone()).or_insert_with(|| {
                                order.push(rp.clone());
                                (title, ty, created, Vec::new())
                            });
                            e.3.push(path.clone());
                        }
                        None => untracked.push(path.clone()),
                    }
                }

                let mut out: Vec<ChangeGroup> = Vec::new();
                for rp in &order {
                    let (title, ty, created, files) = by_entry.remove(rp).unwrap();
                    let refs: Vec<ChangePlanRef> = plan_stmt
                        .query_map(params![pid, rp], |r| {
                            Ok(ChangePlanRef {
                                plan_id: r.get(0)?,
                                plan_title: r.get(1)?,
                                item_title: r.get(2)?,
                            })
                        })?
                        .filter_map(|x| x.ok())
                        .collect();
                    out.push(ChangeGroup {
                        entry_path: Some(rp.clone()),
                        entry_title: Some(title),
                        entry_type: Some(ty),
                        created_at: Some(created),
                        plan_refs: refs,
                        files,
                    });
                }
                out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                if !untracked.is_empty() {
                    out.push(ChangeGroup {
                        entry_path: None,
                        entry_title: None,
                        entry_type: None,
                        created_at: None,
                        plan_refs: Vec::new(),
                        files: untracked,
                    });
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(groups)
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
                                updated_at, file_mtime, body_markdown, parse_ok, parse_warnings
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
                parse_ok: r.parse_ok,
                parse_warnings: parse_warnings_vec(&r.parse_warnings),
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
            let raw = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue, // file deleted between walk and read
            };
            let (parsed, body, full, _redacted) = self.project_text(&raw);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &full)
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
    ///
    /// R1 redaction caveat (dev-report §2): masking is applied as files are
    /// re-projected, but an mtime-unchanged file is skipped *before* masking.
    /// So a secret that was already projected into the cache by a pre-redaction
    /// build is NOT scrubbed by an incremental pass — only a content edit (mtime
    /// bump) or a full reindex (the manual "재인덱스" button → [`reindex_full`],
    /// which always re-projects with masking) clears it. New projects are fully
    /// covered: redaction is on by default from creation, so every first
    /// projection is masked. Scrubbing stale pre-R1 rows is a follow-up.
    ///
    /// [`reindex_full`]: Self::reindex_full
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
            let raw = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let (parsed, body, full, _redacted) = self.project_text(&raw);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &full)
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
    ///
    /// Returns `(outcome, redacted_spans)`. The outcome lets the caller (watcher)
    /// decide whether to emit `OculpmJournalAdded` (new row → toast + optimistic
    /// UI add) vs `OculpmJournalUpdated` (row mutated → silent refresh) vs
    /// nothing (mtime-only / unchanged hash). For `Removed`, the outcome is
    /// `None` and the watcher emits via `oculpm-journal-path-changed` only.
    /// `redacted_spans` is how many secrets this cache (when built with
    /// [`with_redaction`][Self::with_redaction]) masked on projection — the
    /// watcher turns a non-zero count into an integrity warning.
    pub async fn apply_path_change(
        &self,
        project_id: u32,
        journal_root: &Path,
        relative_path: &str,
        kind: PathChangeKind,
    ) -> Result<(Option<UpsertOutcome>, usize), OculpmError> {
        match kind {
            PathChangeKind::Removed => {
                self.delete_entry(project_id, relative_path).await?;
                Ok((None, 0))
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
                let raw = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
                    path: abs,
                    source,
                })?;
                let (parsed, body, full, redacted) = self.project_text(&raw);
                let outcome = self
                    .upsert_entry(project_id, relative_path, &parsed, &body, mtime, &full)
                    .await?;
                Ok((Some(outcome), redacted))
            }
        }
    }

    /// W4 dogfooding follow-up (2026-05-26) — fetch a single entry's summary
    /// by `(project_id, relative_path)`. Used by the watcher right after
    /// `apply_path_change` to attach the hydrated row to `OculpmJournalAdded`/
    /// `OculpmJournalUpdated` events without round-tripping through
    /// `list_entries` (which scans + batch-aggregates the whole workday).
    ///
    /// Tags / `files_count` are filled with a single follow-up query each so
    /// the toast can render badges. Returns `None` if no row matches — e.g.
    /// the path was deleted between the upsert and this read.
    pub async fn get_summary_by_path(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<JournalEntrySummary>, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let summary = self
            .db
            .conn()
            .call(move |c| {
                let row: rusqlite::Result<Option<JournalEntrySummary>> = c
                    .query_row(
                        "SELECT relative_path, workday, type, slug, status, difficulty,
                                title, checkbox, session_id, agent_id, agent_version,
                                verified_by_user, created_at, updated_at, parse_ok, parse_warnings
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        summary_from_row,
                    )
                    .optional();
                row
            })
            .await
            .map_err(map_sqlite_err)?;

        let Some(mut summary) = summary else {
            return Ok(None);
        };

        // Hydrate tags + files_count with two single-path queries (cheap).
        let pid2 = project_id as i64;
        let rp2 = relative_path.to_string();
        let (tags, files_count) = self
            .db
            .conn()
            .call(move |c| {
                let mut tag_stmt = c.prepare(
                    "SELECT tag FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                )?;
                let tags: rusqlite::Result<Vec<String>> = tag_stmt
                    .query_map(params![pid2, &rp2], |r| r.get::<_, String>(0))?
                    .collect();
                let tags = tags?;

                let file_count: i64 = c
                    .query_row(
                        "SELECT COUNT(*) FROM oculpm_journal_files
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid2, &rp2],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                Ok((tags, file_count as u32))
            })
            .await
            .map_err(map_sqlite_err)?;

        summary.tags = tags;
        summary.files_count = files_count;
        Ok(Some(summary))
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

    // ───────── W5-PR6: Observed agent ids ─────────

    /// Distinct `agent_id` values across this project's cache rows, sorted
    /// ASC. Drives `CategoryFilterBar` 's agent dropdown so users can filter
    /// by any agent that has actually written an entry — not just the known
    /// 6 (`claude-code`, `cursor`, ...).
    pub async fn observed_agent_ids(
        &self,
        project_id: u32,
    ) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT agent_id FROM oculpm_journal
                     WHERE project_id = ?1 AND parse_ok = 1
                     ORDER BY agent_id ASC",
                )?;
                let rows: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid], |r| r.get::<_, String>(0))?
                    .collect();
                rows
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    // ───────── W5-PR5: Overview aggregates ─────────

    /// Single-shot fetch of every overview widget. Each sub-query is
    /// `GROUP BY` against an existing index (workday / agent_id / difficulty),
    /// so the worst-case cost is ~O(rows) per project. The window is filled
    /// with empty cells for every day even when no entries exist — the
    /// heatmap UI relies on a dense array.
    pub async fn overview_stats(
        &self,
        project_id: u32,
        window_days: u32,
        current_workday: &str,
    ) -> Result<crate::oculpm::spec::OculpmOverviewStats, OculpmError> {
        use crate::oculpm::spec::{
            AgentCount, DifficultyMix, HeatmapCell, JournalEntrySummary, OculpmOverviewStats,
            SessionDailyAgg,
        };

        let pid = project_id as i64;
        let window = window_days.max(1);

        // Date range — generate every workday in [start, end].
        let end = parse_workday(current_workday).unwrap_or_else(today_fallback);
        let start = end - chrono::Duration::days(window as i64 - 1);
        let workday_list: Vec<String> = (0..window as i64)
            .map(|i| format_workday(start + chrono::Duration::days(i)))
            .collect();
        let start_key = workday_list.first().cloned().unwrap_or_default();

        let start_for_query = start_key.clone();

        // Per-workday journal entry counts.
        let entry_counts: std::collections::HashMap<String, u32> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT workday, COUNT(*) AS n FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY workday",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(w, n)| (w, n as u32))
                        .collect::<std::collections::HashMap<_, _>>())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        // Per-workday file event counts (sum across the workday's sessions).
        let file_event_counts: std::collections::HashMap<String, u32> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT workday, COALESCE(SUM(file_event_count), 0)
                         FROM oculpm_sessions_cache
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY workday",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(w, n)| (w, n.max(0) as u32))
                        .collect::<std::collections::HashMap<_, _>>())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        let heatmap_cells: Vec<HeatmapCell> = workday_list
            .iter()
            .map(|w| {
                let entry_count = *entry_counts.get(w).unwrap_or(&0);
                let file_event_count = *file_event_counts.get(w).unwrap_or(&0);
                let score = entry_count
                    .saturating_mul(5)
                    .saturating_add(file_event_count);
                HeatmapCell {
                    workday: w.clone(),
                    entry_count,
                    file_event_count,
                    score,
                }
            })
            .collect();

        // Difficulty mix — exclude rows where parse_ok = 0 so the null bucket
        // reflects "intentionally unset", not "frontmatter broken".
        let difficulty_mix: DifficultyMix = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT COALESCE(difficulty, '__null__') AS d, COUNT(*)
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2 AND parse_ok = 1
                         GROUP BY d",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    let mut mix = DifficultyMix {
                        verylow: 0,
                        low: 0,
                        medium: 0,
                        high: 0,
                        superhigh: 0,
                        null_count: 0,
                    };
                    for (k, n) in rows? {
                        let n = n.max(0) as u32;
                        match k.as_str() {
                            "verylow" => mix.verylow = n,
                            "low" => mix.low = n,
                            "medium" => mix.medium = n,
                            "high" => mix.high = n,
                            "superhigh" => mix.superhigh = n,
                            _ => mix.null_count = n,
                        }
                    }
                    Ok(mix)
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        // Agent breakdown — already-cached agent_id column.
        let agent_rows: Vec<(String, u32)> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT agent_id, COUNT(*) FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY agent_id
                         ORDER BY COUNT(*) DESC",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(id, n)| (id, n.max(0) as u32))
                        .collect())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        let total_entries: u32 = agent_rows.iter().map(|(_, n)| n).sum();
        let agent_breakdown: Vec<AgentCount> = agent_rows
            .into_iter()
            .map(|(agent_id, n)| AgentCount {
                agent_id,
                entry_count: n,
                share: if total_entries > 0 {
                    n as f32 / total_entries as f32
                } else {
                    0.0
                },
            })
            .collect();

        // Unfinished — reuse list_entries pipeline but cap at 50 most recent.
        let unfinished_entries: Vec<JournalEntrySummary> = {
            let filters = EntryFilters {
                unfinished_only: true,
                ..Default::default()
            };
            let mut all = self.list_entries(project_id, None, &filters).await?;
            all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            all.into_iter().take(50).collect()
        };

        // Recent sessions — last 30 days, most recent first.
        let recent_sessions: Vec<SessionDailyAgg> = self
            .db
            .conn()
            .call({
                let start_key_30 = format_workday(
                    end - chrono::Duration::days(29),
                );
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT s.workday,
                                COUNT(*),
                                COALESCE(SUM(CAST((julianday(s.ended_at) - julianday(s.started_at)) * 86400 AS INTEGER)), 0),
                                COALESCE(SUM(files_unique), 0),
                                (SELECT COUNT(*) FROM oculpm_journal j
                                  WHERE j.project_id = s.project_id AND j.workday = s.workday) AS journal_count,
                                SUM(CASE WHEN file_event_count > 0 THEN 1 ELSE 0 END) AS with_events
                         FROM oculpm_sessions_cache s
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY s.workday
                         ORDER BY s.workday DESC",
                    )?;
                    let rows: rusqlite::Result<Vec<SessionDailyAgg>> = stmt
                        .query_map(params![pid, &start_key_30], |r| {
                            let workday: String = r.get(0)?;
                            let session_count: i64 = r.get(1)?;
                            let active_seconds: i64 = r.get(2)?;
                            let files_unique: i64 = r.get(3)?;
                            let journal_entry_count: i64 = r.get(4)?;
                            let with_events: i64 = r.get(5)?;
                            let narrative_rate = if with_events > 0 {
                                journal_entry_count as f32 / with_events as f32
                            } else {
                                0.0
                            };
                            Ok(SessionDailyAgg {
                                workday,
                                session_count: session_count.max(0) as u32,
                                total_active_seconds: active_seconds.max(0) as u32,
                                files_unique: files_unique.max(0) as u32,
                                journal_entry_count: journal_entry_count.max(0) as u32,
                                narrative_rate,
                            })
                        })?
                        .collect();
                    rows
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(OculpmOverviewStats {
            generated_at: chrono::Utc::now().to_rfc3339(),
            window_days: window,
            heatmap_cells,
            difficulty_mix,
            agent_breakdown,
            unfinished_entries,
            recent_sessions,
        })
    }
}

/// Parse "YYYYMMDD" → NaiveDate.
fn parse_workday(s: &str) -> Option<chrono::NaiveDate> {
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year = s[0..4].parse::<i32>().ok()?;
    let month = s[4..6].parse::<u32>().ok()?;
    let day = s[6..8].parse::<u32>().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, month, day)
}

fn format_workday(d: chrono::NaiveDate) -> String {
    use chrono::Datelike;
    format!("{:04}{:02}{:02}", d.year(), d.month(), d.day())
}

fn today_fallback() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive()
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
    agent_version: Option<String>,
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

/// Coerce one timestamp field for the cache projection (F7a-B). With a project
/// `tz`, backfill a missing offset (DST-correct) and record what changed; with
/// `None`, only flag the missing offset. Returns the value to store in cache;
/// the on-disk file is never modified here.
fn coerce_timestamp(s: &str, tz: Option<Tz>, field: &str, warns: &mut Vec<String>) -> String {
    match tz {
        Some(tz) => match backfill_tz_offset(s, tz) {
            Some(fixed) => {
                warns.push(format!(
                    "{field} '{s}' lacks a timezone offset; backfilled to '{fixed}' ({tz}) for display (disk unchanged)"
                ));
                fixed
            }
            // Lacks an offset but couldn't be backfilled — e.g. a DST
            // spring-forward gap (a local time that doesn't exist). Still flag
            // it rather than letting the more-suspicious value pass silently.
            None => {
                if iso_lacks_offset(s) {
                    warns.push(format!(
                        "{field} '{s}' lacks a timezone offset (could not backfill in {tz})"
                    ));
                }
                s.to_string()
            }
        },
        None => {
            if iso_lacks_offset(s) {
                warns.push(format!(
                    "{field} '{s}' lacks a timezone offset (interpreted as project-local)"
                ));
            }
            s.to_string()
        }
    }
}

impl CacheRowSnapshot {
    fn from(
        parsed: &ParsedFrontmatter,
        body: &ParsedBody,
        relative_path: &str,
        full_text: &str,
        tz: Option<Tz>,
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
            Some(fm) => {
                // F7a-B read-time coercion — cache/display only, disk untouched.
                // Coercion notes are advisory: they're appended to the displayed
                // `parse_warnings` (lighting the ⚠ badge) but do NOT flip
                // `parse_ok`, which stays a *structural* signal ("frontmatter
                // parsed"). A tz-less created_at is common and structurally fine,
                // so it must keep `parse_ok = true` — otherwise parse_ok-gated
                // queries (e.g. overview difficulty_mix) would wrongly drop it.
                let mut warns = parsed.parse_warnings.clone();
                let created_at = coerce_timestamp(&fm.created_at, tz, "created_at", &mut warns);
                let updated_at = fm
                    .updated_at
                    .as_deref()
                    .map(|u| coerce_timestamp(u, tz, "updated_at", &mut warns));
                let slug = match normalize_slug(&fm.slug) {
                    Some(norm) => {
                        warns.push(format!(
                            "slug '{}' is not kebab-case; using '{norm}' for display (disk unchanged)",
                            fm.slug
                        ));
                        norm
                    }
                    None => fm.slug.clone(),
                };
                let parse_ok = parsed.parse_warnings.is_empty();
                let parse_warnings = if warns.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&warns).map_err(OculpmError::JsonSerialize)?)
                };
                Ok(Self {
                    workday,
                    entry_type: entry_type_as_str(fm.entry_type).to_string(),
                    slug,
                    status: entry_status_as_str(fm.status).to_string(),
                    difficulty: fm.difficulty.map(|d| difficulty_as_str(d).to_string()),
                    title: body.title.clone(),
                    checkbox: body.checkbox.map(i64::from),
                    session_id: fm.session_id.clone(),
                    agent_id: fm.agent.id.clone(),
                    agent_version: fm.agent.version.clone(),
                    language: fm.language.clone(),
                    verified_by_user: fm.verified_by_user,
                    created_at,
                    updated_at,
                    body_markdown: body.raw.clone(),
                    body_md_hash,
                    parse_ok,
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
                })
            }
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
                    agent_version: None,
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
    parse_ok: bool,
    parse_warnings: Option<String>,
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
        parse_ok: r.get::<_, i64>(15)? != 0,
        parse_warnings: r.get(16)?,
    })
}

/// Decode the stored `parse_warnings` column (a JSON string array, or NULL) into
/// a `Vec<String>` for the DTO. Malformed JSON / NULL → empty (F7a).
fn parse_warnings_vec(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
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
        agent_version: r.get("agent_version")?,
        verified_by_user: r.get::<_, i64>("verified_by_user")? != 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        tags: Vec::new(),     // filled by list_entries' batch query
        files_count: 0,       // filled by list_entries' batch query
        parse_ok: r.get::<_, i64>("parse_ok")? != 0,
        parse_warnings: parse_warnings_vec(&r.get::<_, Option<String>>("parse_warnings")?),
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
                session_id, agent_id, agent_version, verified_by_user, created_at, updated_at,
                parse_ok, parse_warnings
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
    if !filters.agents.is_empty() {
        let placeholders: Vec<String> = filters
            .agents
            .iter()
            .map(|a| {
                bound.push(Box::new(a.clone()));
                format!("?{}", bound.len())
            })
            .collect();
        sql.push_str(&format!(" AND agent_id IN ({})", placeholders.join(",")));
    }
    if !filters.difficulties.is_empty() {
        let placeholders: Vec<String> = filters
            .difficulties
            .iter()
            .map(|d| {
                bound.push(Box::new(difficulty_as_str(*d).to_string()));
                format!("?{}", bound.len())
            })
            .collect();
        sql.push_str(&format!(
            " AND difficulty IN ({})",
            placeholders.join(",")
        ));
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

pub(crate) fn walk_journal(journal_root: &Path) -> Vec<(String, i64)> {
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

    fn default_redact() -> Vec<Regex> {
        crate::oculpm::redact::compile_redact_patterns(
            &crate::oculpm::spec::OculpmConfig::default_for_new_project()
                .git
                .auto_redact_patterns,
        )
    }

    /// F7a-B: an agent wrote `created_at` without a tz offset. The indexing
    /// projection (`.with_tz`) backfills the project offset into the cached
    /// value and records a warning (flipping `parse_ok`) — while the on-disk
    /// file is left exactly as authored.
    #[tokio::test]
    async fn with_tz_backfills_offset_and_warns_disk_unchanged() {
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_notz.md";
        let fm = "schema_version: 1\ntype: bug\nslug: notz\nstatus: done\n\
                  created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
                  agent: { id: claude-code }\nlanguage: ko";
        let abs = write_entry(&journal_root, rel, fm, "[x] body\n");
        let on_disk_before = std::fs::read_to_string(&abs).unwrap();

        let seoul: Tz = "Asia/Seoul".parse().unwrap();
        JournalCache::with_redaction(&db, default_redact())
            .with_tz(seoul)
            .reindex_full(1, &journal_root)
            .await
            .unwrap();

        let entry = JournalCache::new(&db)
            .get_entry(1, rel)
            .await
            .unwrap()
            .expect("row exists");
        // Cached value carries the backfilled +09:00 offset…
        assert_eq!(entry.frontmatter.created_at, "2026-05-24T09:25:13+09:00");
        // …recorded as an *advisory* warning (lights the ⚠ badge) but the
        // frontmatter parsed structurally, so parse_ok stays true.
        assert!(entry.parse_ok, "tz coercion is advisory, not a parse failure");
        assert!(
            entry.parse_warnings.iter().any(|w| w.contains("timezone offset")),
            "warns: {:?}",
            entry.parse_warnings
        );
        // …but the on-disk SSOT is byte-identical to what the agent wrote.
        assert_eq!(std::fs::read_to_string(&abs).unwrap(), on_disk_before);
    }

    /// Without `.with_tz`, the same tz-less entry is only *flagged* (detect +
    /// warn), and the cached value is left untouched — proving backfill is the
    /// tz facade's doing, not unconditional.
    #[tokio::test]
    async fn without_tz_detects_but_does_not_rewrite() {
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_notz2.md";
        let fm = "schema_version: 1\ntype: bug\nslug: notz2\nstatus: done\n\
                  created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
                  agent: { id: claude-code }\nlanguage: ko";
        write_entry(&journal_root, rel, fm, "[x] body\n");

        JournalCache::with_redaction(&db, default_redact())
            .reindex_full(1, &journal_root)
            .await
            .unwrap();

        let entry = JournalCache::new(&db)
            .get_entry(1, rel)
            .await
            .unwrap()
            .expect("row exists");
        assert_eq!(entry.frontmatter.created_at, "2026-05-24T09:25:13"); // unchanged
        assert!(entry.parse_ok, "detect-only warning is advisory, not a parse failure");
        assert!(entry
            .parse_warnings
            .iter()
            .any(|w| w.contains("timezone offset")));
    }

    #[tokio::test]
    async fn reindex_with_redaction_masks_secret_in_cache_body() {
        // R1: an agent-authored entry pastes an AWS key into the body. A cache
        // built with redaction must mask it on projection so the cached
        // body_markdown (→ AI context) never carries the plaintext, while a
        // plain cache leaves it as-is (proves masking is the facade's doing).
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_secret.md";
        write_entry(
            &journal_root,
            rel,
            &standard_frontmatter("bug-secret"),
            "[x] leaked\n\napi key: AKIAABCDEFGHIJKLMNOP done\n",
        );

        JournalCache::with_redaction(&db, default_redact())
            .reindex_full(1, &journal_root)
            .await
            .unwrap();
        let entry = JournalCache::new(&db)
            .get_entry(1, rel)
            .await
            .unwrap()
            .expect("row exists");
        assert!(
            entry.body_markdown.contains("[REDACTED]"),
            "body should be masked: {}",
            entry.body_markdown
        );
        assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
    }

    #[tokio::test]
    async fn apply_path_change_reports_redacted_count() {
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_two.md";
        write_entry(
            &journal_root,
            rel,
            &standard_frontmatter("bug-two"),
            "[x] two\n\ntoken=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
        );

        let (outcome, redacted) = JournalCache::with_redaction(&db, default_redact())
            .apply_path_change(1, &journal_root, rel, PathChangeKind::Created)
            .await
            .unwrap();
        assert!(matches!(outcome, Some(UpsertOutcome::Inserted)));
        assert_eq!(redacted, 1, "one GitHub PAT masked");

        let entry = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
        assert!(entry.body_markdown.contains("[REDACTED]"));
        assert!(!entry.body_markdown.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
    }

    #[tokio::test]
    async fn redaction_masks_body_but_preserves_secret_like_frontmatter() {
        // R1 regression: masking touches the BODY only. A slug that itself
        // matches a redact pattern (`sk-…`) must survive — masking the YAML
        // would turn `slug: [REDACTED]` into a flow sequence and degrade the
        // row to an unparseable chore (wrong slug/type/status in the cache).
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_sk.md";
        // slug matches `sk-[A-Za-z0-9_-]{20,}`; body carries an AWS key.
        let fm = standard_frontmatter("sk-secret-looking-slug-1234");
        write_entry(
            &journal_root,
            rel,
            &fm,
            "[x] done\n\nleaked AKIAABCDEFGHIJKLMNOP here\n",
        );

        JournalCache::with_redaction(&db, default_redact())
            .reindex_full(1, &journal_root)
            .await
            .unwrap();
        let entry = JournalCache::new(&db)
            .get_entry(1, rel)
            .await
            .unwrap()
            .expect("row exists");
        // Frontmatter parsed intact — slug NOT masked.
        assert_eq!(entry.frontmatter.slug, "sk-secret-looking-slug-1234");
        assert_eq!(entry.frontmatter.entry_type, EntryType::Bug);
        // Body masked.
        assert!(entry.body_markdown.contains("[REDACTED]"));
        assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
    }

    #[tokio::test]
    async fn reindex_incremental_does_not_scrub_preexisting_unmasked_secret() {
        // R1 KNOWN LIMITATION (dev-report §2 follow-up): a secret projected into
        // the cache by a pre-redaction build is NOT scrubbed by an incremental
        // reindex when the file's mtime is unchanged (the file is skipped before
        // masking). Only a full reindex or a content edit clears it. This pins
        // the behavior so a future "fix" updates the test deliberately.
        let (db, dir) = fresh_db().await;
        let journal_root = dir.path().join("journal");
        let rel = "20260524/Bugs/0925_bug_stale.md";
        write_entry(
            &journal_root,
            rel,
            &standard_frontmatter("stale"),
            "[x] x\n\nkey AKIAABCDEFGHIJKLMNOP\n",
        );

        // First projection WITHOUT redaction (simulates a pre-R1 build).
        JournalCache::new(&db)
            .reindex_full(1, &journal_root)
            .await
            .unwrap();
        let before = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
        assert!(before.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));

        // Incremental WITH redaction but unchanged mtime → file skipped → secret survives.
        JournalCache::with_redaction(&db, default_redact())
            .reindex_incremental(1, &journal_root)
            .await
            .unwrap();
        let after = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
        assert!(
            after.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"),
            "known limitation: incremental skip leaves the stale secret"
        );

        // A FULL reindex with redaction DOES scrub it (the escape hatch).
        JournalCache::with_redaction(&db, default_redact())
            .reindex_full(1, &journal_root)
            .await
            .unwrap();
        let healed = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
        assert!(healed.body_markdown.contains("[REDACTED]"));
        assert!(!healed.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
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

    // ───────── W5-PR5: overview_stats ──────────

    /// Insert one journal row directly into the cache via reindex_full of a
    /// hand-written .md file. Helper for the overview tests below.
    fn write_journal(
        root: &Path,
        relative_path: &str,
        difficulty: Option<&str>,
        agent_id: &str,
        created_at: &str,
        unfinished: bool,
    ) {
        let mut fm = format!(
            "schema_version: 1\ntype: bug\nslug: x\nstatus: {status}\n",
            status = if unfinished { "in_progress" } else { "done" },
        );
        if let Some(d) = difficulty {
            fm.push_str(&format!("difficulty: {d}\n"));
        }
        fm.push_str(&format!(
            "created_at: \"{created_at}\"\nsession_id: \"20260520-001\"\nagent: {{ id: {agent_id} }}\nlanguage: ko",
        ));
        let body = if unfinished {
            "[ ] Title X\n\n## body\n"
        } else {
            "[x] Title X\n\n## body\n"
        };
        write_entry(root, relative_path, &fm, body);
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_session_async<'a>(
        cache: &'a JournalCache<'a>,
        project_id: u32,
        session_id: &str,
        workday: &str,
        started_at: &str,
        ended_at: &str,
        file_event_count: u32,
        files_unique: u32,
    ) {
        let pid = project_id as i64;
        let sid = session_id.to_string();
        let wd = workday.to_string();
        let s = started_at.to_string();
        let e = ended_at.to_string();
        cache
            .db
            .conn()
            .call(move |c| {
                c.execute(
                    "INSERT INTO oculpm_sessions_cache (project_id, session_id, workday, started_at, ended_at, ended_reason, file_event_count, files_unique, agent_label_guess)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, NULL)",
                    params![pid, &sid, &wd, &s, &e, file_event_count as i64, files_unique as i64],
                )?;
                Ok::<(), rusqlite::Error>(())
            })
            .await
            .unwrap();
    }
    async fn fresh_cache_with_project() -> (Db, tempfile::TempDir, PathBuf) {
        let (db, dir) = fresh_db().await;
        // Project row for FK constraints elsewhere.
        let _ = db
            .create_project("ov".into(), dir.path().to_string_lossy().into())
            .await
            .unwrap();
        let journal_root = dir.path().join("journal");
        std::fs::create_dir_all(&journal_root).unwrap();
        (db, dir, journal_root)
    }

    #[tokio::test]
    async fn overview_stats_aggregates_heatmap_cells_for_window() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        // 3 entries on 20260522.
        write_journal(
            &journal_root,
            "20260522/Bugs/0900_bug_a.md",
            Some("medium"),
            "claude-code",
            "2026-05-22T09:00:00+09:00",
            false,
        );
        write_journal(
            &journal_root,
            "20260522/Bugs/1000_bug_b.md",
            Some("low"),
            "cursor",
            "2026-05-22T10:00:00+09:00",
            false,
        );
        write_journal(
            &journal_root,
            "20260522/Bugs/1100_bug_c.md",
            None,
            "claude-code",
            "2026-05-22T11:00:00+09:00",
            false,
        );
        cache.reindex_full(1, &journal_root).await.unwrap();

        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        assert_eq!(stats.window_days, 7);
        assert_eq!(stats.heatmap_cells.len(), 7);
        // Most cells are empty; the 20260522 one has 3 entries.
        let last = stats.heatmap_cells.last().unwrap();
        assert_eq!(last.workday, "20260522");
        assert_eq!(last.entry_count, 3);
        assert_eq!(last.score, 15); // 3 * 5 + 0 file events
        let prior = stats.heatmap_cells.first().unwrap();
        assert_eq!(prior.entry_count, 0);
    }

    #[tokio::test]
    async fn overview_stats_groups_difficulty_mix_with_null_count() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        write_journal(&journal_root, "20260522/Bugs/0900_bug_a.md", Some("medium"), "x", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_bug_b.md", Some("medium"), "x", "2026-05-22T09:10:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0920_bug_c.md", Some("high"), "x", "2026-05-22T09:20:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0930_bug_d.md", None, "x", "2026-05-22T09:30:00+09:00", false);
        cache.reindex_full(1, &journal_root).await.unwrap();

        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        assert_eq!(stats.difficulty_mix.medium, 2);
        assert_eq!(stats.difficulty_mix.high, 1);
        assert_eq!(stats.difficulty_mix.null_count, 1);
        assert_eq!(stats.difficulty_mix.low, 0);
    }

    #[tokio::test]
    async fn overview_stats_agent_breakdown_share_sums_to_one() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "claude-code", "2026-05-22T09:10:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "cursor", "2026-05-22T09:20:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0930_d.md", None, "manual", "2026-05-22T09:30:00+09:00", false);
        cache.reindex_full(1, &journal_root).await.unwrap();

        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        let total_share: f32 = stats.agent_breakdown.iter().map(|a| a.share).sum();
        assert!(
            (total_share - 1.0).abs() < 1e-5,
            "agent shares should sum to 1.0, got {total_share}"
        );
        let claude = stats
            .agent_breakdown
            .iter()
            .find(|a| a.agent_id == "claude-code")
            .expect("claude-code present");
        assert_eq!(claude.entry_count, 2);
    }

    #[tokio::test]
    async fn overview_stats_unfinished_caps_at_fifty() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        for i in 0..60 {
            let h = i / 60;
            let m = i % 60;
            write_journal(
                &journal_root,
                &format!("20260522/Bugs/{:02}{:02}_bug_{}.md", h, m, i),
                None,
                "x",
                &format!("2026-05-22T{:02}:{:02}:00+09:00", h, m),
                true, // unfinished
            );
        }
        cache.reindex_full(1, &journal_root).await.unwrap();

        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        assert_eq!(stats.unfinished_entries.len(), 50);
        // Most-recent first — first entry's created_at >= second's.
        for pair in stats.unfinished_entries.windows(2) {
            assert!(
                pair[0].created_at >= pair[1].created_at,
                "expected DESC ordering by created_at; got {} then {}",
                pair[0].created_at,
                pair[1].created_at
            );
        }
    }

    // ───────── W5-PR6: agent filter + observed_agent_ids ──────────

    #[tokio::test]
    async fn list_entries_filter_by_agent_includes_only_matching() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "manual", "2026-05-22T09:20:00+09:00", false);
        cache.reindex_full(1, &journal_root).await.unwrap();

        let rows = cache
            .list_entries(
                1,
                None,
                &EntryFilters {
                    agents: vec!["cursor".into()],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].agent_id, "cursor");
    }

    #[tokio::test]
    async fn list_entries_filter_by_agent_empty_set_shows_all() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "manual", "2026-05-22T09:20:00+09:00", false);
        cache.reindex_full(1, &journal_root).await.unwrap();

        let rows = cache
            .list_entries(1, None, &EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 3, "empty agents = no constraint");
    }

    #[tokio::test]
    async fn list_entries_filter_combines_type_and_agent() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        // bug + claude-code, bug + cursor, feature + cursor.
        write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
        // Switch the third row to a feature by overwriting frontmatter type.
        let feat_fm = "schema_version: 1\ntype: feature\nslug: x\nstatus: done\ncreated_at: \"2026-05-22T09:20:00+09:00\"\nsession_id: \"20260520-001\"\nagent: { id: cursor }\nlanguage: ko";
        write_entry(
            &journal_root,
            "20260522/Features_to_add/0920_c.md",
            feat_fm,
            "[x] feat\n",
        );
        cache.reindex_full(1, &journal_root).await.unwrap();

        let rows = cache
            .list_entries(
                1,
                None,
                &EntryFilters {
                    types: vec![EntryType::Bug],
                    agents: vec!["cursor".into()],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(rows.len(), 1, "intersection of bug + cursor = 1");
        assert_eq!(rows[0].agent_id, "cursor");
        assert_eq!(rows[0].entry_type, EntryType::Bug);
    }

    #[tokio::test]
    async fn observed_agent_ids_returns_distinct_sorted() {
        let (db, _dir, journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        // Insert in non-alphabetical order, with duplicates.
        write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "manual", "2026-05-22T09:00:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "claude-code", "2026-05-22T09:10:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "claude-code", "2026-05-22T09:20:00+09:00", false);
        write_journal(&journal_root, "20260522/Bugs/0930_d.md", None, "cursor", "2026-05-22T09:30:00+09:00", false);
        cache.reindex_full(1, &journal_root).await.unwrap();

        let agents = cache.observed_agent_ids(1).await.unwrap();
        assert_eq!(agents, vec!["claude-code", "cursor", "manual"]);
    }

    #[tokio::test]
    async fn overview_stats_recent_sessions_narrative_rate_handles_zero_sessions() {
        let (db, _dir, _journal_root) = fresh_cache_with_project().await;
        let cache = JournalCache::new(&db);
        // No sessions, no entries — narrative_rate must be 0 (not NaN) for
        // every day in the window. recent_sessions itself is empty.
        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        assert!(stats.recent_sessions.is_empty());

        // Now insert a session with file_event_count=0 — narrative_rate must
        // still be 0.0 (no with_events sessions).
        insert_session_async(
            &cache,
            1,
            "20260522-001",
            "20260522",
            "2026-05-22T09:00:00+09:00",
            "2026-05-22T10:00:00+09:00",
            0,
            0,
        )
        .await;
        let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
        assert_eq!(stats.recent_sessions.len(), 1);
        let row = &stats.recent_sessions[0];
        assert_eq!(row.session_count, 1);
        assert!(row.narrative_rate.is_finite());
        assert_eq!(row.narrative_rate, 0.0);
    }
}

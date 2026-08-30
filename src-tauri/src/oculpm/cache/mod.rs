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

/// Version of the F7a-B frontmatter coercion (tz-offset backfill + slug
/// normalization) applied to a cached row. **Bump this whenever the coercion
/// logic changes** so the incremental indexer re-projects rows stamped with an
/// older version exactly once — even when their mtime is unchanged — then stamps
/// them current (and skips again thereafter).
///
/// History: 1 — tz backfill + Unicode-aware (Hangul-preserving) slug normalize.
pub const COERCION_VERSION: i64 = 1;

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
    /// `verified_by_user` of the entry — `None` for the untracked bucket. The
    /// diff group header renders the same toggle the entry detail has, so a
    /// review can be closed without leaving the diff (polish-round Phase 2).
    pub verified_by_user: Option<bool>,
    pub plan_refs: Vec<ChangePlanRef>,
    pub files: Vec<String>,
}

/// One journal entry inside a workday range, with its touched file paths
/// (F4 retro). A lean projection — just the columns the retro signal pass
/// aggregates over, so the heavier `JournalEntrySummary` hydration is avoided.
#[derive(Debug, Clone)]
pub struct RangeEntry {
    pub relative_path: String,
    pub workday: String,
    /// Raw frontmatter type: `bug | feature | error | refactor | chore`.
    pub entry_type: String,
    pub status: String,
    pub difficulty: Option<String>,
    pub agent_id: String,
    pub title: String,
    pub files: Vec<String>,
    /// Frontmatter tags — drives the tag-cluster pass (skill promotion).
    pub tags: Vec<String>,
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

mod conv;
mod files;
mod query;
mod reindex;
mod stats;
mod write;

use conv::*;

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
    pub(crate) fn project_text(&self, raw: &str) -> (ParsedFrontmatter, ParsedBody, String, usize) {
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
            Some(
                serde_json::to_string(&parsed.parse_warnings)
                    .map_err(OculpmError::JsonSerialize)?,
            )
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
    /// PR-CI1 — 021 컬럼. 하이드레이션이 frontmatter.agent.version 으로 복원.
    agent_version: Option<String>,
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
        agent_version: r.get(17)?,
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
        agent_version: r.get("agent_version")?,
        verified_by_user: r.get::<_, i64>("verified_by_user")? != 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        tags: Vec::new(), // filled by list_entries' batch query
        files_count: 0,   // filled by list_entries' batch query
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
    workdays: &[String],
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

    // 하나면 `=`, 여럿이면 `IN` — 둘 다 (project_id, workday) 인덱스를 탄다.
    match workdays {
        [] => {}
        [wd] => {
            bound.push(Box::new(wd.clone()));
            sql.push_str(&format!(" AND workday = ?{}", bound.len()));
        }
        many => {
            let placeholders: Vec<String> = many
                .iter()
                .map(|wd| {
                    bound.push(Box::new(wd.clone()));
                    format!("?{}", bound.len())
                })
                .collect();
            sql.push_str(&format!(" AND workday IN ({})", placeholders.join(",")));
        }
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
        sql.push_str(&format!(" AND difficulty IN ({})", placeholders.join(",")));
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
            || rel_str.split('/').any(|seg| seg.starts_with('.'))
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

// ────────── enum <-> str ──────────

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

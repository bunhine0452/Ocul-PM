//! Per-entry diff capture — "이후 일지부터" diff history (MVP).
//!
//! `compute_diff` is *live* (`git diff HEAD` / snapshot vs disk), so once a file
//! is committed or changed further, the diff that a journal entry described is
//! gone. This module persists, at the moment the watcher first indexes a NEW
//! entry, a unified-diff patch per `files_touched[].path`, so the 작업 일지 can
//! re-open "그 시점의 변경" at any later time.
//!
//! ## Storage
//! Sidecar JSON at `.oculpm/index/diffs/<flattened-entry-rel>.json` (the path is
//! flattened `<workday>__<Category>__<stem>.json` to stay collision-free in one
//! dir). `.oculpm/index/` is already self-suppressed by the watcher, so writing
//! here never re-triggers it, and it's durable — unlike the SQLite journal cache
//! it is NOT rebuilt from the markdown, so the recorded diffs survive a cache
//! rebuild.
//!
//! ## Capture model (4-tier)
//! Capture tries, per `files_touched[].path`, in order:
//!   1. working-tree `git diff HEAD -- <path>` (the dogfooding flow: agent edits
//!      then writes the journal before committing → exactly the entry's diff);
//!   2. when (1) is empty or git is unavailable (non-git project / committed /
//!      HEAD-less repo) — a **snapshot fallback** (PR-R3): diff the last-indexed
//!      content (`file_snapshots`, the same baseline `compute_diff` uses)
//!      against the current disk content. The caller pre-fetches snapshots via
//!      `Db` and passes them in, so this fn stays blocking/pure;
//!   3. when (1) and (2) both come up empty — a **git-history fallback**: find
//!      the commit that touched the path nearest the entry's timestamp and use
//!      its diff. This makes the common "review *after* committing" flow work,
//!      and lets `backfill_entry_diffs` reconstruct diffs for entries that were
//!      written before this feature existed or imported via reindex rather than
//!      the live watcher (`git::diff_at_nearest_commit`);
//!   4. when (1)–(3) are all empty and the file is **brand new** — a **created-
//!      file fallback**: `git diff HEAD` cannot see an untracked file (the agent
//!      writes the journal right after `Write`, before `git add`), and there's no
//!      snapshot baseline or commit history for it yet, so all three tiers come
//!      up empty and the create previously showed nothing. Synthesise the diff
//!      from an empty baseline vs current disk content (the whole file as
//!      additions). Guarded by `git::path_in_head` so a *tracked, unchanged*
//!      file (a legitimate empty tier 1) is never rendered as all-additions;
//!      outside git it falls back to the recorded `op == create`.
//!
//! Because of (3)/(4), capture is no longer strictly going-forward: any committed
//! or newly-created entry with `files_touched` can be reconstructed. Remaining
//! limits, surfaced as "기록된 변경 없음" when they bite:
//!   - intermediate states never committed nor seen by the indexer are gone
//!     (e.g. edit → journal → revert before any commit/index);
//!   - tier 3 is a timestamp heuristic — for a file touched by many commits at
//!     once it can attribute the wrong one;
//!   - the shared `file_snapshots` baseline is *not advanced* here (that would
//!     disturb the live 변경 diff screen), so multiple same-file entries between
//!     two reindexes share the same fallback diff.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::git;
use crate::oculpm::redact::redact_text;
use crate::oculpm::spec::{FileOp, FileTouched};

/// One file's recorded diff for a journal entry. `patch` is a git-style unified
/// diff (`a/ b/` headers) — never stored empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct EntryFileDiff {
    pub path: String,
    pub patch: String,
}

/// On-disk sidecar shape. `entry` echoes the cache-key relative path for
/// debuggability; `schema_version` lets the reader reject future shapes.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntryDiffsFile {
    schema_version: u32,
    captured_at: String,
    entry: String,
    files: Vec<EntryFileDiff>,
}

/// v2 (2026-06-19): added tier 4 (created-file fallback).
/// v3 (2026-06-22): secret redaction applied to patch content at capture time
/// (dev-report §2 / R1), so the sidecar — read by the 변경 모달 and folded into
/// AI context — never holds a plaintext key. Bumping invalidates older sidecars
/// on read, so an entry captured before redaction self-heals on next open: the
/// lazy reconstruct re-captures with masking and rewrites the sidecar (see
/// `capture_entry_diffs`'s fresh-schema guard).
const SCHEMA_VERSION: u32 = 3;
/// Per-file patch cap (matches the spirit of `compute_diff`'s truncation —
/// keeps a runaway generated file from bloating the sidecar).
const MAX_PATCH_BYTES: usize = 256 * 1024;

/// Sidecar path for `entry_rel` (cache-key form `<workday>/<Category>/<file>.md`).
/// Returns `None` for anything that isn't a `.md` under a workday, or that would
/// escape the diffs dir.
fn sidecar_path(root: &Path, entry_rel: &str) -> Option<PathBuf> {
    let stem = entry_rel.strip_suffix(".md")?;
    if stem.is_empty() || stem.contains("..") || stem.starts_with('/') {
        return None;
    }
    let key = stem.replace('/', "__");
    Some(
        root.join(".oculpm")
            .join("index")
            .join("diffs")
            .join(format!("{key}.json")),
    )
}

/// Capture + persist diffs for a freshly-indexed entry. Best-effort: files whose
/// git patch is empty or errors are skipped, and a fully-empty result writes
/// nothing. Captures once — if a sidecar already exists it is left untouched (the
/// caller only invokes this on `Inserted`, so this just guards re-entry).
///
/// Never returns the underlying error to the caller's control flow beyond IO on
/// the final write; callers should log-and-continue.
///
/// `redact` are the project's compiled `auto_redact_patterns`; each file's patch
/// is masked *at capture time* (dev-report §2 / R1) so the persisted sidecar
/// never holds a plaintext key (it is read by the 변경 모달 and folded into AI
/// context). Pass an empty slice to disable masking. Returns the number of
/// redacted spans across all files so callers can surface an integrity warning.
pub fn capture_entry_diffs(
    root: &Path,
    entry_rel: &str,
    touched: &[FileTouched],
    snapshots: &HashMap<String, Vec<u8>>,
    redact: &[Regex],
) -> std::io::Result<usize> {
    let Some(out) = sidecar_path(root, entry_rel) else {
        return Ok(0);
    };
    // Skip only when a *current-schema* sidecar already exists. An older-schema
    // one (pre-redaction / pre tier-4) is upgraded in place: it may have missed
    // a newly created file or still hold a plaintext secret, so we re-capture
    // and overwrite. The caller invokes this on `Inserted` (no sidecar yet) and
    // on lazy reconstruct (where a stale sidecar is exactly what we refresh).
    if sidecar_is_current(&out) {
        return Ok(0);
    }

    let entry_time = entry_unix_time(entry_rel);
    let mut files = Vec::new();
    let mut redacted_spans = 0usize;
    // `files_touched` is agent-written text that ships with the repo. A path
    // that is absolute, climbs out with `..`, or walks through a folder link
    // pointing outside is never read by any tier — tier 4 used to read
    // `/Users/me/.ssh/id_rsa` as a "new file" and store it in the sidecar.
    // (A link *as the last segment* still gets its git tiers; the disk tiers
    // check it again, following it.)
    let touched: Vec<&FileTouched> = touched
        .iter()
        .filter(|f| crate::path_guard::secure_join_entry(root, &f.path).is_ok())
        .collect();
    // Tier 1 (working-tree `git diff HEAD`) is one git call for every touched
    // file (Phase 3 — was two processes per file). Misses fall through to the
    // per-file tiers below exactly as before.
    let touched_paths: Vec<String> = touched.iter().map(|f| f.path.clone()).collect();
    let mut tier1 = git::diff_patches(root, &touched_paths, MAX_PATCH_BYTES);
    for f in touched {
        // Resolve the raw patch through the 4-tier fallback (see module docs).
        // Tier 1 = working-tree `git diff HEAD`. Empty/error → tier 2 snapshot,
        // tier 3 git-history (runs even when `entry_time` is None — newest
        // commit), tier 4 created-file.
        let patch = match tier1.remove(&f.path) {
            Some(p) if !p.trim().is_empty() => Some(p),
            _ => snapshot_patch(root, &f.path, snapshots)
                .or_else(|| history_patch(root, &f.path, entry_time))
                .or_else(|| new_file_patch(root, &f.path, f.op)),
        };
        let Some(patch) = patch else { continue };
        // Mask secrets in the diff hunk content before the sidecar is written.
        let (patch, hits) = redact_text(&patch, redact);
        redacted_spans += hits.len();
        files.push(EntryFileDiff {
            path: f.path.clone(),
            patch,
        });
    }

    persist(&out, entry_rel, files)?;
    Ok(redacted_spans)
}

/// Git-history fallback (tier 3) for a single file: the diff of the commit that
/// touched `rel_path` nearest the entry's timestamp (or the newest commit when
/// `around_unix` is `None`). `None` on no history / non-git / empty patch.
fn history_patch(root: &Path, rel_path: &str, around_unix: Option<i64>) -> Option<String> {
    match crate::git::diff_at_nearest_commit(root, rel_path, around_unix, MAX_PATCH_BYTES) {
        Ok(p) if !p.trim().is_empty() => Some(p),
        _ => None,
    }
}

/// Derive an entry's wall-clock timestamp (local unix seconds) from its
/// cache-key path `<workday=YYYYMMDD>/<Category>/<HHMM>_<slug>.md`. Used to
/// anchor the git-history fallback. `None` if either component isn't numeric.
fn entry_unix_time(entry_rel: &str) -> Option<i64> {
    use chrono::TimeZone;
    let workday = entry_rel.split('/').next()?;
    let file = entry_rel.rsplit('/').next()?;
    if workday.len() != 8 || !workday.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let hhmm: String = file.chars().take(4).collect();
    if hhmm.len() != 4 || !hhmm.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i32 = workday[0..4].parse().ok()?;
    let month: u32 = workday[4..6].parse().ok()?;
    let day: u32 = workday[6..8].parse().ok()?;
    let hour: u32 = hhmm[0..2].parse().ok()?;
    let min: u32 = hhmm[2..4].parse().ok()?;
    chrono::Local
        .with_ymd_and_hms(year, month, day, hour, min, 0)
        .single()
        .map(|dt| dt.timestamp())
}

/// Created-file fallback (tier 4) for a single file: synthesise the diff of a
/// brand-new file as an empty baseline vs current disk content (the whole file
/// rendered as additions). This is the only tier that recovers the dogfooding
/// flow's most common shape — the agent `Write`s a NEW file then writes the
/// journal before `git add`, so `git diff HEAD` can't see the untracked path,
/// there's no snapshot baseline, and the file isn't in history yet.
///
/// Guarded so an *unchanged tracked* file (a legitimately empty tier 1) is never
/// mis-rendered as all-additions:
///   - in a git repo, only when the path is NOT in `HEAD` (untracked / new);
///   - outside any git repo, only when the entry recorded `op == create`.
///
/// Returns `None` for a deleted/unreadable path or an empty file.
fn new_file_patch(root: &Path, rel_path: &str, op: FileOp) -> Option<String> {
    let treat_as_new = match git::path_in_head(root, rel_path) {
        Some(true) => false,          // tracked & in HEAD → a real no-op, leave empty
        Some(false) => true,          // git repo, not in HEAD → genuinely new
        None => op == FileOp::Create, // non-git → trust the recorded op
    };
    if !treat_as_new {
        return None;
    }
    let disk = std::fs::read(crate::path_guard::secure_join(root, rel_path).ok()?).ok()?;
    if disk.is_empty() {
        return None; // an empty new file has nothing meaningful to show
    }
    let next = String::from_utf8_lossy(&disk);
    let patch = crate::git::render_unified_diff(rel_path, "", &next, MAX_PATCH_BYTES);
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

/// Whether the sidecar at `out` exists AND is the current schema version. Lets
/// `capture_entry_diffs` skip already-captured entries but still upgrade stale
/// (older-schema) sidecars in place.
fn sidecar_is_current(out: &Path) -> bool {
    let Ok(bytes) = std::fs::read(out) else {
        return false;
    };
    // An empty marker (`files: []`) exists so `backfill_entry_diffs` stops
    // re-running git on every open, but it is *not* "current" here: the lazy
    // reconstruct path (변경 모달) may capture again — the file may have been
    // committed or indexed since — and this call is the only chance it gets.
    matches!(
        serde_json::from_slice::<EntryDiffsFile>(&bytes),
        Ok(f) if f.schema_version == SCHEMA_VERSION && !f.files.is_empty()
    )
}

/// Snapshot fallback for a single file: render a unified diff of the supplied
/// last-indexed baseline vs current disk content. Returns `None` when there's no
/// baseline, the file can't be read, or content is unchanged.
fn snapshot_patch(
    root: &Path,
    rel_path: &str,
    snapshots: &HashMap<String, Vec<u8>>,
) -> Option<String> {
    let baseline = snapshots.get(rel_path)?;
    let disk = std::fs::read(crate::path_guard::secure_join(root, rel_path).ok()?).ok()?;
    if disk == *baseline {
        return None;
    }
    let prev = String::from_utf8_lossy(baseline);
    let next = String::from_utf8_lossy(&disk);
    let patch = crate::git::render_unified_diff(rel_path, &prev, &next, MAX_PATCH_BYTES);
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

/// Write the sidecar. Split out so the capture logic is testable without a git
/// repo.
///
/// An **empty** result is written too (`files: []`). It used to be skipped, so
/// entries whose diff is unrecoverable (path never in git nor snapshots) had no
/// sidecar, `sidecar_exists` stayed false, and `backfill_entry_diffs` re-ran
/// `git diff` + `git log` for every such entry on every project open —
/// delaying the watcher start on old projects (2026-08-30 audit). The empty
/// marker is the memory that says "we looked, there is nothing".
fn persist(out: &Path, entry_rel: &str, files: Vec<EntryFileDiff>) -> std::io::Result<()> {
    let payload = EntryDiffsFile {
        schema_version: SCHEMA_VERSION,
        captured_at: chrono::Local::now().to_rfc3339(),
        entry: entry_rel.to_string(),
        files,
    };
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(&payload)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(out, json)
}

/// Whether a sidecar already exists for `entry_rel`. Lets `backfill_entry_diffs`
/// skip already-captured entries without any git work, so the backfill is cheap
/// to run on every project open after the first pass.
pub fn sidecar_exists(root: &Path, entry_rel: &str) -> bool {
    sidecar_path(root, entry_rel)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Read the recorded diffs for an entry. Returns an empty vec when there's no
/// sidecar, it can't be read, or it's an unsupported schema — the UI renders the
/// empty case as "기록된 변경 없음".
pub fn read_entry_diffs(root: &Path, entry_rel: &str) -> Vec<EntryFileDiff> {
    let Some(p) = sidecar_path(root, entry_rel) else {
        return Vec::new();
    };
    let Ok(bytes) = std::fs::read(&p) else {
        return Vec::new();
    };
    match serde_json::from_slice::<EntryDiffsFile>(&bytes) {
        Ok(f) if f.schema_version == SCHEMA_VERSION => f.files,
        _ => Vec::new(),
    }
}

/// One file's `+`/`-` line counts, derived from its recorded patch.
pub struct FileLineCounts {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

/// Count added/removed lines in a unified diff. Header lines (`+++`/`---`),
/// hunk markers (`@@`) and the no-newline marker (`\`) are not content, so only
/// single `+`/`-` prefixed lines count.
pub fn count_patch_lines(patch: &str) -> (u32, u32) {
    let mut added = 0u32;
    let mut removed = 0u32;
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        match line.as_bytes().first() {
            Some(b'+') => added += 1,
            Some(b'-') => removed += 1,
            _ => {}
        }
    }
    (added, removed)
}

/// Per-file line churn for an entry, from its durable diff sidecar. Empty when
/// the entry has no sidecar — the caller leaves the cache columns NULL so a
/// later sweep can fill them once a diff is captured.
pub fn line_counts(root: &Path, entry_rel: &str) -> Vec<FileLineCounts> {
    read_entry_diffs(root, entry_rel)
        .into_iter()
        .map(|d| {
            let (added, removed) = count_patch_lines(&d.patch);
            FileLineCounts {
                path: d.path,
                added,
                removed,
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "entry_diffs_tests.rs"]
mod tests;

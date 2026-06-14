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
//! ## Capture model (3-tier)
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
//!      the live watcher (`git::diff_at_nearest_commit`).
//!
//! Because of (3), capture is no longer strictly going-forward: any committed
//! entry with `files_touched` can be reconstructed. Remaining limits, surfaced
//! as "기록된 변경 없음" when they bite:
//!   - intermediate states never committed nor seen by the indexer are gone
//!     (e.g. edit → journal → revert before any commit/index);
//!   - tier 3 is a timestamp heuristic — for a file touched by many commits at
//!     once it can attribute the wrong one;
//!   - the shared `file_snapshots` baseline is *not advanced* here (that would
//!     disturb the live 변경 diff screen), so multiple same-file entries between
//!     two reindexes share the same fallback diff.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::git;
use crate::oculpm::spec::FileTouched;

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

const SCHEMA_VERSION: u32 = 1;
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
pub fn capture_entry_diffs(
    root: &Path,
    entry_rel: &str,
    touched: &[FileTouched],
    snapshots: &HashMap<String, Vec<u8>>,
) -> std::io::Result<()> {
    let Some(out) = sidecar_path(root, entry_rel) else {
        return Ok(());
    };
    if out.exists() {
        return Ok(());
    }

    let entry_time = entry_unix_time(entry_rel);
    let mut files = Vec::new();
    for f in touched {
        match git::diff_patch(root, &f.path, None, None, MAX_PATCH_BYTES) {
            Ok(patch) if !patch.trim().is_empty() => {
                files.push(EntryFileDiff {
                    path: f.path.clone(),
                    patch,
                });
            }
            // Empty git patch (committed / unchanged) or a recoverable git error
            // (non-git project) → tier 2 snapshot fallback, then tier 3
            // git-history fallback (see module docs). Tier 3 runs even when
            // `entry_time` is None (filename has no HH:MM) — it then uses the
            // newest commit touching the path, so externally-authored journals
            // without the `HHMM_` prefix still recover their diff.
            _ => {
                let patch = snapshot_patch(root, &f.path, snapshots)
                    .or_else(|| history_patch(root, &f.path, entry_time));
                if let Some(patch) = patch {
                    files.push(EntryFileDiff {
                        path: f.path.clone(),
                        patch,
                    });
                }
            }
        }
    }

    persist(&out, entry_rel, files)
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

/// Snapshot fallback for a single file: render a unified diff of the supplied
/// last-indexed baseline vs current disk content. Returns `None` when there's no
/// baseline, the file can't be read, or content is unchanged.
fn snapshot_patch(
    root: &Path,
    rel_path: &str,
    snapshots: &HashMap<String, Vec<u8>>,
) -> Option<String> {
    let baseline = snapshots.get(rel_path)?;
    let disk = std::fs::read(root.join(rel_path)).ok()?;
    if disk == *baseline {
        return None;
    }
    let prev = String::from_utf8_lossy(baseline);
    let next = String::from_utf8_lossy(&disk);
    let patch = crate::commands::diff::render_unified_diff(rel_path, &prev, &next, MAX_PATCH_BYTES);
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

/// Write the sidecar (or skip when there's nothing to record). Split out so the
/// capture logic is testable without a git repo.
fn persist(out: &Path, entry_rel: &str, files: Vec<EntryFileDiff>) -> std::io::Result<()> {
    if files.is_empty() {
        return Ok(());
    }
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
    sidecar_path(root, entry_rel).map(|p| p.exists()).unwrap_or(false)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_flattens_and_rejects_traversal() {
        let root = Path::new("/proj");
        let p = sidecar_path(root, "20260604/Bugs/0925_bug_a.md").unwrap();
        assert!(p.ends_with(".oculpm/index/diffs/20260604__Bugs__0925_bug_a.json"));
        // not a markdown entry / traversal / absolute → None.
        assert!(sidecar_path(root, "20260604/Bugs/0925_bug_a.txt").is_none());
        assert!(sidecar_path(root, "../../etc/passwd.md").is_none());
        assert!(sidecar_path(root, "/abs/x.md").is_none());
    }

    #[test]
    fn persist_then_read_roundtrips() {
        let tmp = std::env::temp_dir().join(format!("ocul-entrydiff-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let entry = "20260604/Features_to_add/1000_feature_x.md";
        let files = vec![
            EntryFileDiff {
                path: "src/a.ts".into(),
                patch: "@@ -1 +1 @@\n-old\n+new\n".into(),
            },
            EntryFileDiff {
                path: "src/b.ts".into(),
                patch: "@@ -0,0 +1 @@\n+added\n".into(),
            },
        ];
        let out = sidecar_path(&tmp, entry).unwrap();
        persist(&out, entry, files.clone()).unwrap();

        let got = read_entry_diffs(&tmp, entry);
        assert_eq!(got, files);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn empty_set_writes_no_file_and_reads_empty() {
        let tmp = std::env::temp_dir().join(format!("ocul-entrydiff-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let entry = "20260604/Chores/0800_chore.md";
        let out = sidecar_path(&tmp, entry).unwrap();
        persist(&out, entry, Vec::new()).unwrap();
        assert!(!out.exists(), "empty set must not create a sidecar");
        assert!(read_entry_diffs(&tmp, entry).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn capture_on_non_git_root_records_nothing() {
        let tmp = std::env::temp_dir().join(format!("ocul-entrydiff-nogit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let entry = "20260604/Bugs/0925_bug_a.md";
        let touched = vec![FileTouched {
            path: "src/a.ts".into(),
            op: crate::oculpm::spec::FileOp::Update,
            bytes_added: Some(10),
            bytes_removed: Some(2),
            rename_from: None,
        }];
        // No git repo + no snapshot baseline → nothing recorded.
        capture_entry_diffs(&tmp, entry, &touched, &HashMap::new()).unwrap();
        assert!(read_entry_diffs(&tmp, entry).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn snapshot_fallback_records_diff_on_non_git_root() {
        // PR-R3: non-git project (or committed file) → git patch empty, but a
        // last-indexed snapshot baseline that differs from disk yields a diff.
        let tmp =
            std::env::temp_dir().join(format!("ocul-entrydiff-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        let entry = "20260604/Bugs/0930_bug_b.md";
        let rel = "src/a.ts";
        // Current disk content (post-edit).
        std::fs::write(tmp.join(rel), "const neo = 2;\n").unwrap();
        let touched = vec![FileTouched {
            path: rel.into(),
            op: crate::oculpm::spec::FileOp::Update,
            bytes_added: Some(10),
            bytes_removed: Some(2),
            rename_from: None,
        }];
        // Baseline (pre-edit) snapshot the indexer would have captured.
        let mut snapshots = HashMap::new();
        snapshots.insert(rel.to_string(), b"const old = 1;\n".to_vec());

        capture_entry_diffs(&tmp, entry, &touched, &snapshots).unwrap();

        let got = read_entry_diffs(&tmp, entry);
        assert_eq!(got.len(), 1, "snapshot fallback should record one file");
        assert_eq!(got[0].path, rel);
        assert!(got[0].patch.contains("const neo = 2;"));
        assert!(got[0].patch.contains("const old = 1;"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn snapshot_fallback_skips_when_unchanged() {
        let tmp =
            std::env::temp_dir().join(format!("ocul-entrydiff-snapsame-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        let entry = "20260604/Bugs/0931_bug_c.md";
        let rel = "src/a.ts";
        std::fs::write(tmp.join(rel), "same\n").unwrap();
        let touched = vec![FileTouched {
            path: rel.into(),
            op: crate::oculpm::spec::FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        }];
        let mut snapshots = HashMap::new();
        snapshots.insert(rel.to_string(), b"same\n".to_vec()); // identical → no diff
        capture_entry_diffs(&tmp, entry, &touched, &snapshots).unwrap();
        assert!(read_entry_diffs(&tmp, entry).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn entry_unix_time_parses_and_rejects() {
        assert!(entry_unix_time("20260604/Bugs/2101_bug_x.md").is_some());
        // non-numeric workday / HHMM → None (history fallback simply skipped).
        assert!(entry_unix_time("notaday0/Bugs/2101_x.md").is_none());
        assert!(entry_unix_time("20260604/Bugs/xx01_x.md").is_none());
        assert!(entry_unix_time("2026060/Bugs/2101_x.md").is_none());
    }

    fn git(root: &Path, args: &[&str]) -> Result<(), ()> {
        std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|_| ())
            .ok_or(())
    }

    #[test]
    fn history_fallback_records_committed_diff() {
        // tier 3: the file is already committed (working tree clean → `git diff
        // HEAD` empty) and there's no snapshot baseline, but the commit nearest
        // the entry timestamp is found and its diff recorded.
        let tmp = std::env::temp_dir().join(format!("ocul-entrydiff-hist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        // Skip cleanly if git is unavailable in the test environment.
        if git(&tmp, &["init", "-q"]).is_err() {
            return;
        }
        git(&tmp, &["config", "user.email", "t@t.dev"]).unwrap();
        git(&tmp, &["config", "user.name", "t"]).unwrap();
        let rel = "src/a.ts";
        std::fs::write(tmp.join(rel), "const old = 1;\n").unwrap();
        git(&tmp, &["add", "."]).unwrap();
        git(&tmp, &["commit", "-qm", "base"]).unwrap();
        std::fs::write(tmp.join(rel), "const neo = 2;\n").unwrap();
        git(&tmp, &["add", "."]).unwrap();
        git(&tmp, &["commit", "-qm", "change"]).unwrap();

        // Entry dated late today → nearest (most recent) commit = the change.
        let workday = chrono::Local::now().format("%Y%m%d").to_string();
        let entry = format!("{workday}/Bugs/2359_bug_hist.md");
        let touched = vec![FileTouched {
            path: rel.into(),
            op: crate::oculpm::spec::FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        }];

        capture_entry_diffs(&tmp, &entry, &touched, &HashMap::new()).unwrap();
        let got = read_entry_diffs(&tmp, &entry);
        assert_eq!(got.len(), 1, "history fallback should record one file");
        assert!(
            got[0].patch.contains("const neo = 2;"),
            "expected the change commit's diff, got: {}",
            got[0].patch
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn history_fallback_records_when_filename_has_no_hhmm() {
        // Regression (2026-06-14): an externally-authored journal whose filename
        // has no `HHMM_` prefix → entry_unix_time() is None. Tier 3 must STILL
        // recover the committed diff (previously it was skipped entirely, so the
        // UI showed "기록된 변경 없음"). Falls back to the newest commit.
        let tmp =
            std::env::temp_dir().join(format!("ocul-entrydiff-nohhmm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        if git(&tmp, &["init", "-q"]).is_err() {
            return;
        }
        git(&tmp, &["config", "user.email", "t@t.dev"]).unwrap();
        git(&tmp, &["config", "user.name", "t"]).unwrap();
        let rel = "src/page.tsx";
        std::fs::write(tmp.join(rel), "const a = 1;\n").unwrap();
        git(&tmp, &["add", "."]).unwrap();
        git(&tmp, &["commit", "-qm", "base"]).unwrap();
        std::fs::write(tmp.join(rel), "const a = 2;\n").unwrap();
        git(&tmp, &["add", "."]).unwrap();
        git(&tmp, &["commit", "-qm", "change"]).unwrap();

        let workday = chrono::Local::now().format("%Y%m%d").to_string();
        let entry = format!("{workday}/Bugs/intl-en-saju.md"); // no HHMM prefix
        assert!(
            entry_unix_time(&entry).is_none(),
            "fixture must have an unparseable timestamp"
        );
        let touched = vec![FileTouched {
            path: rel.into(),
            op: crate::oculpm::spec::FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        }];

        capture_entry_diffs(&tmp, &entry, &touched, &HashMap::new()).unwrap();
        let got = read_entry_diffs(&tmp, &entry);
        assert_eq!(got.len(), 1, "no-HHMM entry should still recover via newest commit");
        assert!(
            got[0].patch.contains("const a = 2;"),
            "expected the newest commit's diff, got: {}",
            got[0].patch
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

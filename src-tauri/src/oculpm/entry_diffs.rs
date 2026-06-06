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
//! ## Capture model (PR-R3 — snapshot fallback)
//! Capture tries, per `files_touched[].path`, in order:
//!   1. working-tree `git diff HEAD -- <path>` (the dogfooding flow: agent edits
//!      then writes the journal before committing → exactly the entry's diff);
//!   2. when (1) is empty or git is unavailable (non-git project / committed /
//!      HEAD-less repo) — a **snapshot fallback**: diff the last-indexed content
//!      (`file_snapshots`, the same baseline `compute_diff` uses) against the
//!      current disk content. The caller (watcher) pre-fetches snapshots via
//!      `Db` and passes them in, so this fn stays blocking/pure.
//!
//! Remaining limits, surfaced as "기록된 변경 없음" when they bite:
//!   - going-forward only (no backfill — past content is unrecoverable);
//!   - if neither git nor a snapshot baseline differs from disk, nothing is
//!     recorded (truly nothing changed at index time);
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
            // (non-git project) → try the snapshot fallback: diff the last-indexed
            // baseline against current disk (PR-R3).
            _ => {
                if let Some(patch) = snapshot_patch(root, &f.path, snapshots) {
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
}

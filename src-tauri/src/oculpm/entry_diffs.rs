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
//! ## Capture model + limits (MVP)
//! Capture is the working-tree `git diff HEAD -- <path>` at index time. For the
//! dogfooding flow (agent edits files, then writes the journal, usually before
//! committing) that is exactly the entry's diff. Known limits, accepted for the
//! MVP and surfaced to the user as "기록된 변경 없음" when they bite:
//!   - going-forward only (no backfill — past content is unrecoverable);
//!   - non-git projects, or entries written *after* committing, yield an empty
//!     git patch and are simply skipped (no snapshot fallback here — that path
//!     needs `Db` and is left for a follow-up);
//!   - multiple same-file entries with uncommitted cumulative edits all capture
//!     the same working-tree diff (no per-entry isolation without advancing a
//!     snapshot).

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
            // Empty patch (committed / unchanged) or a recoverable git error
            // (non-git project) → nothing to record for this file.
            _ => {}
        }
    }

    persist(&out, entry_rel, files)
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
        capture_entry_diffs(&tmp, entry, &touched).unwrap();
        // No git repo → git::diff_patch errs → nothing recorded.
        assert!(read_entry_diffs(&tmp, entry).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

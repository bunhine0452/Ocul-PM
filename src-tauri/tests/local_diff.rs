//! Lite-W6 PR11 — integration coverage for the LocalDiffView backend.
//!
//! `git::diff_patch` is the load-bearing helper that PR6.2's `compute_diff`
//! wraps. Constructing a `Tauri::State<Embedder>` for a full `compute_diff`
//! round-trip is heavyweight, so this suite exercises the inner helper
//! against a real `git` subprocess on a tempdir checkout. The shapes it
//! checks: git path returns a unified diff containing the change, non-git
//! returns the explicit "Not a git repository." sentinel that `compute_diff`
//! pattern-matches on, and the `max_bytes` truncation suffix fires when the
//! patch grows past the cap.

use std::path::Path;
use std::process::Command;

use ai_pm_lib::db::Db;
use ai_pm_lib::git;

fn run_git_in(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("HOME", root)
        .status()
        .expect("spawn git");
    assert!(
        status.success(),
        "git {} failed in {}",
        args.join(" "),
        root.display()
    );
}

/// Initialise a fresh repo with a committed baseline file. Returns the
/// project root + the relative path of the baseline file (`src/main.rs`).
fn setup_repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    run_git_in(root, &["init", "--initial-branch=main", "--quiet"]);
    run_git_in(root, &["config", "user.email", "ci@ai-pm.test"]);
    run_git_in(root, &["config", "user.name", "ai-pm-ci"]);
    run_git_in(root, &["config", "commit.gpgsign", "false"]);

    let src = root.join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("main.rs"), "fn main() {\n    println!(\"v1\");\n}\n").unwrap();
    run_git_in(root, &["add", "."]);
    run_git_in(root, &["commit", "-m", "baseline", "--quiet"]);

    (dir, "src/main.rs".to_string())
}

#[test]
fn diff_patch_returns_unified_diff_for_a_modified_file() {
    let (dir, rel) = setup_repo();
    let root = dir.path();
    // Modify the working tree.
    std::fs::write(root.join(&rel), "fn main() {\n    println!(\"v2\");\n}\n").unwrap();

    let patch = git::diff_patch(root, &rel, None, None, 65_536).expect("diff_patch ok");
    assert!(patch.contains("--- a/src/main.rs"), "missing --- header: {patch}");
    assert!(patch.contains("+++ b/src/main.rs"), "missing +++ header: {patch}");
    assert!(patch.contains("-    println!(\"v1\");"), "missing - line: {patch}");
    assert!(patch.contains("+    println!(\"v2\");"), "missing + line: {patch}");
}

#[test]
fn diff_patch_returns_empty_string_when_working_tree_matches_head() {
    let (dir, rel) = setup_repo();
    let root = dir.path();
    let patch = git::diff_patch(root, &rel, None, None, 65_536).expect("diff_patch ok");
    assert!(
        patch.is_empty(),
        "expected empty patch for unmodified file, got: {patch:?}"
    );
}

#[test]
fn diff_patch_truncates_oversized_output_with_suffix() {
    let (dir, rel) = setup_repo();
    let root = dir.path();

    // Append 1 MB of repeated lines so the resulting diff overflows the cap.
    let mut bloated = String::from("fn main() {\n    println!(\"v2\");\n}\n");
    for i in 0..50_000 {
        bloated.push_str(&format!("// padding line {i:05}\n"));
    }
    std::fs::write(root.join(&rel), bloated).unwrap();

    let patch = git::diff_patch(root, &rel, None, None, 4_096).expect("diff_patch ok");
    assert!(
        patch.contains("... (truncated,"),
        "missing truncation marker in: {}",
        &patch[..patch.len().min(200)],
    );
    // The marker itself can spill a few extra bytes past the cap, but the
    // bulk of the patch must respect the budget.
    assert!(
        patch.len() < 4_096 + 512,
        "truncation budget overshot: {}",
        patch.len(),
    );
}

#[test]
fn diff_patch_returns_explicit_error_when_not_a_git_repository() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = git::diff_patch(dir.path(), "src/main.rs", None, None, 65_536)
        .expect_err("expected Err for non-git dir");
    assert_eq!(err, "Not a git repository.");
}

/// PR6.6 — fresh repo with no commits is the dogfood-observed failure mode.
/// `compute_diff` pattern-matches on this error in `is_recoverable_git_failure`
/// to route to the snapshot fallback. Lock the exact substring here so a git
/// stderr-rewording upstream surfaces as a test failure rather than a silent
/// regression that drops users back on the "fatal: bad revision 'HEAD'" UX.
#[test]
fn diff_patch_signals_headless_repo_with_bad_revision_head() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    run_git_in(root, &["init", "--initial-branch=main", "--quiet"]);
    run_git_in(root, &["config", "user.email", "ci@ai-pm.test"]);
    run_git_in(root, &["config", "user.name", "ai-pm-ci"]);
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();

    let err = git::diff_patch(root, "src/main.rs", None, None, 65_536)
        .expect_err("expected Err for HEAD-less repo");
    assert!(
        err.contains("bad revision 'HEAD'") || err.contains("ambiguous argument 'HEAD'"),
        "expected HEAD-less marker in git error, got: {err}"
    );
}

/// PR6.6 — DB round-trip for the snapshot upsert that powers the LocalDiffView
/// fallback. Verifies single-row UNIQUE(project_id, path) semantics: a second
/// upsert with new content updates in place rather than producing a second row.
#[tokio::test]
async fn file_snapshot_upsert_is_idempotent_per_path() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ai-pm.db"))
        .await
        .expect("open db");
    let project_id = db
        .create_project("snap-test".into(), dir.path().to_string_lossy().into())
        .await
        .expect("create project");

    db.upsert_file_snapshot(
        project_id,
        "src/lib.rs".into(),
        b"first content\n".to_vec(),
        "hash-v1".into(),
    )
    .await
    .expect("first upsert");

    let v1 = db
        .get_file_snapshot(project_id, "src/lib.rs".into())
        .await
        .expect("get v1")
        .expect("row v1");
    assert_eq!(v1.content, b"first content\n");
    assert_eq!(v1.hash, "hash-v1");

    // Second upsert with new content + hash should update in place.
    db.upsert_file_snapshot(
        project_id,
        "src/lib.rs".into(),
        b"second content\n".to_vec(),
        "hash-v2".into(),
    )
    .await
    .expect("second upsert");

    let v2 = db
        .get_file_snapshot(project_id, "src/lib.rs".into())
        .await
        .expect("get v2")
        .expect("row v2");
    assert_eq!(v2.content, b"second content\n");
    assert_eq!(v2.hash, "hash-v2");
    assert_eq!(v2.id, v1.id, "UNIQUE(project_id, path) must keep id stable");
}

/// PR6.6 — sibling lookup returns None for a path that was never snapshotted.
/// Drives the `DiffSource::SnapshotsUnavailable` branch in `compute_diff` so
/// the UI knows to suggest a partial reindex instead of rendering an empty
/// diff (which would look like "no changes").
#[tokio::test]
async fn get_file_snapshot_returns_none_for_unindexed_path() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ai-pm.db"))
        .await
        .expect("open db");
    let project_id = db
        .create_project("snap-empty".into(), dir.path().to_string_lossy().into())
        .await
        .expect("create project");

    let none = db
        .get_file_snapshot(project_id, "src/never-indexed.rs".into())
        .await
        .expect("get ok");
    assert!(none.is_none(), "expected None for unindexed path");
}

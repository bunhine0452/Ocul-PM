//! 변경 파일 목록 — 변경 diff 화면의 **행**. 작업 트리의 미커밋 변경
//! (`uncommitted_changes`, `git status --porcelain`)과 트리가 깨끗할 때의
//! 직전 커밋(`last_commit_changes`). 둘 다 `GitChange` 행을 프로젝트 루트
//! 기준 경로로 내놓는다 — 중첩 저장소 되맞춤은 `nesting` 에 맡긴다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{discover_repos, nesting, primary_repo, run_git, EMPTY_TREE};

/// A single uncommitted change from `git status`. `op` is one of `"A"` / `"M"` /
/// `"D"` so it lines up directly with the frontend `ChangeOp` union used by the
/// 변경 diff 화면. Renames/copies report the *new* path as an add.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitChange {
    pub path: String,
    pub op: String,
}

/// The most recent commit's metadata + the files it touched. Powers the 변경
/// diff 화면's "직전 커밋" baseline, shown when the working tree is clean so the
/// screen isn't empty after a coding agent commits its work.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LastCommitChanges {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub changes: Vec<GitChange>,
}

/// All uncommitted changes (staged + unstaged + untracked) as `GitChange`
/// rows. This is the **persistent** source for the 변경 diff 화면: unlike the
/// live file-watcher buffer it survives app restarts and project switches, and
/// reflects edits made while the app was closed. Non-git projects / git
/// failures yield an empty Vec so the caller can fall back to the watcher.
pub fn uncommitted_changes(root: &Path) -> Vec<GitChange> {
    // Discover the repo(s) for this project. Nested repos (git below the .oculpm
    // root) are found and reported with paths relative to `root`, so the change
    // list is git-backed (survives restarts/updates) for those layouts too.
    let mut changes = Vec::new();
    for repo in discover_repos(root) {
        let nesting = nesting::repo_nesting(root, &repo); // 저장소당 한 번만
        let out = match run_git(
            &repo,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        ) {
            Ok(o) => o,
            Err(_) => continue,
        };

        let mut tokens = out.split('\0');
        while let Some(entry) = tokens.next() {
            // `-z` entries are `XY<space>PATH`. A rename/copy (X in {R,C}) is
            // followed by a separate NUL-terminated token holding the original
            // path — consume it so it isn't parsed as its own entry.
            if entry.len() < 4 {
                continue;
            }
            let bytes = entry.as_bytes();
            let x = bytes[0] as char;
            let y = bytes[1] as char;
            let raw = &entry[3..];
            if x == 'R' || x == 'C' {
                let _ = tokens.next();
            }
            // `None` = 저장소가 함께 바꾼 **프로젝트 밖** 파일 (여기서 뺀다).
            if let Some(path) = nesting::rebase(&nesting, raw) {
                changes.push(GitChange {
                    path,
                    op: porcelain_op(x, y).to_string(),
                });
            }
        }
    }
    changes
}

/// Files changed by the most recent commit (`HEAD~1..HEAD`, or against the empty
/// tree for a root commit), with the commit's sha/subject. `None` for non-git
/// projects and repos with no commits yet (unborn HEAD).
pub fn last_commit_changes(root: &Path) -> Option<LastCommitChanges> {
    let repo = primary_repo(root)?;
    // Commit metadata; fails on an unborn HEAD (no commits) → None.
    let meta = run_git(
        &repo,
        &["log", "-1", "--no-color", "--pretty=format:%H\x1f%s"],
    )
    .ok()?;
    let (sha, subject) = meta.split_once('\x1f')?;
    let sha = sha.to_string();
    let short_sha: String = sha.chars().take(7).collect();
    let from = if run_git(&repo, &["rev-parse", "--verify", "-q", "HEAD~1"]).is_ok() {
        "HEAD~1"
    } else {
        EMPTY_TREE
    };
    let changes = changes_in_range(&repo, root, from, "HEAD");
    Some(LastCommitChanges {
        sha,
        short_sha,
        subject: subject.to_string(),
        changes,
    })
}

/// `git diff --name-status -z <from> <to>` parsed into `GitChange` rows, with
/// paths made relative to the project `root` (nested-repo aware). Mirrors the
/// op mapping the 변경 diff 화면 expects (`A`/`M`/`D`; rename/copy → add).
fn changes_in_range(repo: &Path, root: &Path, from: &str, to: &str) -> Vec<GitChange> {
    let Ok(out) = run_git(repo, &["diff", "--name-status", "-z", from, to]) else {
        return Vec::new();
    };
    let mut changes = Vec::new();
    let nesting = nesting::repo_nesting(root, repo);
    let mut tokens = out.split('\0').filter(|t| !t.is_empty());
    while let Some(status) = tokens.next() {
        let code = status.chars().next().unwrap_or('M');
        // With `-z`, status and path(s) are separate NUL tokens. A rename/copy
        // (R/C) carries two path tokens (old, new); we report the new path.
        let raw = if code == 'R' || code == 'C' {
            let _old = tokens.next();
            tokens.next()
        } else {
            tokens.next()
        };
        let Some(raw) = raw else { break };
        let op = match code {
            'A' | 'R' | 'C' => "A",
            'D' => "D",
            _ => "M",
        };
        if let Some(path) = nesting::rebase(&nesting, raw) {
            changes.push(GitChange {
                path,
                op: op.to_string(),
            });
        }
    }
    changes
}

/// Map a `git status --porcelain` XY status pair to the `"A"`/`"M"`/`"D"` op the
/// UI understands. Untracked (`??`), additions and rename/copy targets are
/// adds; any deletion is a delete; everything else is a modification.
pub(super) fn porcelain_op(x: char, y: char) -> &'static str {
    if x == '?' {
        return "A";
    }
    if x == 'D' || y == 'D' {
        return "D";
    }
    if x == 'A' || x == 'R' || x == 'C' {
        return "A";
    }
    "M"
}

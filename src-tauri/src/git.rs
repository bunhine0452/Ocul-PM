//! Lightweight wrappers around the local `git` CLI for read-only operations.
//! Operates on any local clone — does NOT require a GitHub token or network.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitCommit {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix timestamp in seconds (author date).
    pub timestamp: i32,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
    /// e.g. "github.com" — derived from the URL.
    pub host: Option<String>,
    pub owner: Option<String>,
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitRepoStatus {
    pub is_git_repo: bool,
    pub head_branch: Option<String>,
    pub remotes: Vec<GitRemote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitTag {
    pub name: String,
    /// SHA the tag points to.
    pub sha: String,
    /// Tagger date (unix seconds). For lightweight tags this falls back to the
    /// referenced commit's author date.
    pub timestamp: i32,
    /// Annotated tag message (empty for lightweight tags).
    pub message: String,
    /// Subject of the commit this tag points to.
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChangelogFile {
    pub path: String,
    pub content: String,
}

/// A single uncommitted change from `git status`. `op` is one of `"A"` / `"M"` /
/// `"D"` so it lines up directly with the frontend `ChangeOp` union used by the
/// 변경 diff 화면. Renames/copies report the *new* path as an add.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitChange {
    pub path: String,
    pub op: String,
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root);
    cmd.args(args);
    let out = cmd
        .output()
        .map_err(|e| format!("Failed to run git ({}): {}", args.join(" "), e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn is_repo(root: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Recent commits, newest first. Excludes merge commits by default.
pub fn log(root: &Path, limit: u32) -> Result<Vec<GitCommit>, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }

    // Use ASCII unit separator (0x1f) to safely split fields containing pipes.
    let text = run_git(
        root,
        &[
            "log",
            "--no-color",
            "--no-merges",
            &format!("-n{}", limit.max(1)),
            "--pretty=format:%H\x1f%an\x1f%ae\x1f%at\x1f%s",
        ],
    )?;

    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
        if parts.len() < 5 {
            continue;
        }
        let sha = parts[0].to_string();
        let short_sha: String = sha.chars().take(7).collect();
        commits.push(GitCommit {
            sha,
            short_sha,
            author_name: parts[1].to_string(),
            author_email: parts[2].to_string(),
            timestamp: parts[3].parse().unwrap_or(0),
            subject: parts[4].to_string(),
        });
    }
    Ok(commits)
}

pub fn remotes(root: &Path) -> Result<Vec<GitRemote>, String> {
    if !is_repo(root) {
        return Ok(Vec::new());
    }
    let text = run_git(root, &["remote", "-v"])?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in text.lines() {
        // "origin\thttps://github.com/foo/bar.git (fetch)"
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("");
        let url = parts.next().unwrap_or("");
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let key = format!("{}|{}", name, url);
        if !seen.insert(key) {
            continue;
        }
        let (host, owner, repo) = parse_remote_url(url);
        out.push(GitRemote {
            name: name.to_string(),
            url: url.to_string(),
            host,
            owner,
            repo,
        });
    }
    Ok(out)
}

/// List tags newest first. For each tag returns the SHA it points to and the
/// tag/commit metadata needed to render a changelog.
pub fn tags(root: &Path, limit: u32) -> Result<Vec<GitTag>, String> {
    if !is_repo(root) {
        return Ok(Vec::new());
    }
    // Format fields with the unit separator so subjects/messages with `|` are safe.
    // %(taggerdate:unix) is empty for lightweight tags — we fall back to the
    // referenced commit's author date via %(*authordate:unix).
    let format = "%(refname:short)\x1f\
                  %(*objectname)\x1f%(objectname)\x1f\
                  %(taggerdate:unix)\x1f%(*authordate:unix)\x1f\
                  %(contents:subject)\x1f%(*subject)\x1f\
                  %(contents:body)";
    let text = run_git(
        root,
        &[
            "tag",
            "-l",
            "--sort=-creatordate",
            &format!("--format={}", format),
        ],
    )?;

    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(8, '\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        let name = parts[0].to_string();
        if name.is_empty() {
            continue;
        }
        // Annotated tag points at a commit via *objectname; lightweight tag uses objectname.
        let sha = if !parts[1].is_empty() { parts[1] } else { parts[2] }.to_string();
        let timestamp = if !parts[3].is_empty() {
            parts[3].parse().unwrap_or(0)
        } else {
            parts[4].parse().unwrap_or(0)
        };
        // Subject: prefer commit subject (resolved via *subject) over annotated tag subject.
        let subject = if !parts[6].is_empty() {
            parts[6].to_string()
        } else {
            parts[5].to_string()
        };
        let message = parts.get(7).map(|s| s.trim().to_string()).unwrap_or_default();

        if sha.is_empty() {
            continue;
        }
        out.push(GitTag {
            name,
            sha,
            timestamp,
            message,
            subject,
        });
        if out.len() >= limit as usize {
            break;
        }
    }
    Ok(out)
}

/// Commits between two refs (`from..to`). Used to assemble per-tag commit
/// lists for an auto-generated changelog.
pub fn log_range(root: &Path, from: &str, to: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }
    let range = if from.is_empty() {
        to.to_string()
    } else {
        format!("{}..{}", from, to)
    };
    let text = run_git(
        root,
        &[
            "log",
            "--no-color",
            "--no-merges",
            &range,
            &format!("-n{}", limit.max(1)),
            "--pretty=format:%H\x1f%an\x1f%ae\x1f%at\x1f%s",
        ],
    )?;

    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
        if parts.len() < 5 {
            continue;
        }
        let sha = parts[0].to_string();
        let short_sha: String = sha.chars().take(7).collect();
        commits.push(GitCommit {
            sha,
            short_sha,
            author_name: parts[1].to_string(),
            author_email: parts[2].to_string(),
            timestamp: parts[3].parse().unwrap_or(0),
            subject: parts[4].to_string(),
        });
    }
    Ok(commits)
}

/// Locate a CHANGELOG-like file at the project root (case-insensitive) and
/// return its content. None if the project doesn't ship one.
pub fn read_changelog(root: &Path) -> Result<Option<ChangelogFile>, String> {
    const CANDIDATES: &[&str] = &[
        "CHANGELOG.md",
        "CHANGELOG",
        "CHANGES.md",
        "CHANGES",
        "HISTORY.md",
        "HISTORY",
        "RELEASES.md",
        "RELEASES",
        "NEWS.md",
        "NEWS",
    ];

    // First pass: exact case match (cheap).
    for name in CANDIDATES {
        let p = root.join(name);
        if p.is_file() {
            let content = std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read {}: {}", p.display(), e))?;
            return Ok(Some(ChangelogFile {
                path: name.to_string(),
                content,
            }));
        }
    }

    // Second pass: case-insensitive directory scan (covers `changelog.md` etc.).
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(None);
    };
    let lower_candidates: Vec<String> = CANDIDATES.iter().map(|s| s.to_lowercase()).collect();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if lower_candidates.contains(&name.to_lowercase()) {
            let p = entry.path();
            let content = std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read {}: {}", p.display(), e))?;
            return Ok(Some(ChangelogFile {
                path: name,
                content,
            }));
        }
    }
    Ok(None)
}

pub fn status(root: &Path) -> GitRepoStatus {
    if !is_repo(root) {
        return GitRepoStatus {
            is_git_repo: false,
            head_branch: None,
            remotes: Vec::new(),
        };
    }
    let head_branch = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD");
    let remotes = remotes(root).unwrap_or_default();
    GitRepoStatus {
        is_git_repo: true,
        head_branch,
        remotes,
    }
}

/// Lite-W6 PR5 — slim wrapper for the TitleBar mini git chip (UI consumer
/// arrives in PR7). Returns just the branch + the count of `git status
/// --porcelain` lines (staged + unstaged + untracked).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitHeadStatusBrief {
    pub is_git_repo: bool,
    /// `None` when the repo is in detached-HEAD state or there is no repo.
    pub head_branch: Option<String>,
    /// Count of `--porcelain` lines. Capped at u32::MAX in practice.
    pub uncommitted: u32,
}

pub fn head_status_brief(root: &Path) -> GitHeadStatusBrief {
    if !is_repo(root) {
        return GitHeadStatusBrief {
            is_git_repo: false,
            head_branch: None,
            uncommitted: 0,
        };
    }
    let head_branch = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD");
    let uncommitted = run_git(root, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.is_empty()).count() as u32)
        .unwrap_or(0);
    GitHeadStatusBrief {
        is_git_repo: true,
        head_branch,
        uncommitted,
    }
}

/// All uncommitted changes (staged + unstaged + untracked) as `GitChange`
/// rows. This is the **persistent** source for the 변경 diff 화면: unlike the
/// live file-watcher buffer it survives app restarts and project switches, and
/// reflects edits made while the app was closed. Non-git projects / git
/// failures yield an empty Vec so the caller can fall back to the watcher.
pub fn uncommitted_changes(root: &Path) -> Vec<GitChange> {
    if !is_repo(root) {
        return Vec::new();
    }
    let out = match run_git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ) {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let mut changes = Vec::new();
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
        let path = entry[3..].to_string();
        if x == 'R' || x == 'C' {
            let _ = tokens.next();
        }
        changes.push(GitChange {
            path,
            op: porcelain_op(x, y).to_string(),
        });
    }
    changes
}

/// Map a `git status --porcelain` XY status pair to the `"A"`/`"M"`/`"D"` op the
/// UI understands. Untracked (`??`), additions and rename/copy targets are
/// adds; any deletion is a delete; everything else is a modification.
fn porcelain_op(x: char, y: char) -> &'static str {
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

/// Unified-diff for a single tracked path. `from`/`to` are commit-ish refs;
/// defaulting both to `None` returns the working tree vs `HEAD` diff. Output
/// is truncated (suffix marker appended) once it exceeds `max_bytes`.
///
/// Lite-W6 PR4 retired this helper alongside the changelog commands. PR6
/// resurrects it for LocalDiffView (the *git path* of `compute_diff`).
pub fn diff_patch(
    root: &Path,
    file_path: &str,
    from: Option<&str>,
    to: Option<&str>,
    max_bytes: usize,
) -> Result<String, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }

    let mut args = vec!["diff", "--unified=3"];
    match (from, to) {
        (Some(f), Some(t)) => {
            args.push(f);
            args.push(t);
        }
        (Some(f), None) => {
            args.push(f);
        }
        _ => {
            args.push("HEAD");
        }
    }
    args.push("--");
    args.push(file_path);

    let text = run_git(root, &args)?;

    Ok(truncate_patch(text, max_bytes))
}

/// Cap a unified-diff blob at `max_bytes`, appending a truncation marker. Keeps
/// a runaway generated file from bloating callers (sidecars, IPC payloads).
fn truncate_patch(text: String, max_bytes: usize) -> String {
    if text.len() > max_bytes {
        let truncated: String = text.chars().take(max_bytes).collect();
        format!(
            "{}\n\n... (truncated, {} bytes total)",
            truncated,
            text.len()
        )
    } else {
        text
    }
}

/// Reconstruct the diff a journal entry described *after* the work was already
/// committed — the last-resort fallback when there's no working-tree diff
/// (`git diff HEAD` empty) and no snapshot baseline. Finds the commit that
/// touched `file_path` nearest in time to `around_unix` (the entry's
/// timestamp) and returns that commit's unified diff for the file.
///
/// Heuristic, so it can mis-attribute when a file is touched by many commits
/// near the same time — but a best-effort "그 시점의 변경" beats "기록 없음".
/// Among candidates ordered by time-distance it returns the first whose
/// `git show` is non-empty (skipping merges / no-op touches), trying a few.
/// When `around_unix` is `None` (the entry's filename carries no parseable
/// HH:MM, e.g. an externally-authored journal), it falls back to the newest
/// commit that touched the path. Returns an empty string when the path has no
/// history or nothing yields a patch.
pub fn diff_at_nearest_commit(
    root: &Path,
    file_path: &str,
    around_unix: Option<i64>,
    max_bytes: usize,
) -> Result<String, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }

    // "<hash> <author-unixtime>" per commit touching the path (newest first).
    let listing = run_git(
        root,
        &["log", "--format=%H %at", "--max-count=200", "--", file_path],
    )?;
    let mut candidates: Vec<(String, i64)> = listing
        .lines()
        .filter_map(|l| {
            let (h, t) = l.split_once(' ')?;
            Some((h.to_string(), t.trim().parse().ok()?))
        })
        .collect();
    if candidates.is_empty() {
        return Ok(String::new());
    }
    // With a timestamp, pick the commit nearest the entry; without one, keep
    // git-log order (newest first) so the most recent change wins.
    if let Some(t) = around_unix {
        candidates.sort_by_key(|(_, ts)| (ts - t).abs());
    }

    for (hash, _) in candidates.into_iter().take(5) {
        // `--format=` drops the commit header, leaving just the patch; `show`
        // (unlike `diff <h>^ <h>`) also handles the root commit (full-file add).
        let patch = run_git(
            root,
            &["show", "--format=", "--unified=3", &hash, "--", file_path],
        )
        .unwrap_or_default();
        if !patch.trim().is_empty() {
            return Ok(truncate_patch(patch, max_bytes));
        }
    }
    Ok(String::new())
}

/// Parse `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git`,
/// `ssh://git@github.com/owner/repo.git` into (host, owner, repo).
fn parse_remote_url(url: &str) -> (Option<String>, Option<String>, Option<String>) {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");

    // SSH shorthand: git@host:owner/repo
    if let Some((left, right)) = trimmed.split_once(':') {
        if left.contains('@') && !left.contains("//") {
            let host = left.rsplit('@').next().unwrap_or("").to_string();
            let mut p = right.splitn(2, '/');
            return (
                non_empty(host),
                p.next().map(String::from).and_then(non_empty),
                p.next().map(String::from).and_then(non_empty),
            );
        }
    }

    // URL forms: https://, http://, ssh://[user@]host/...
    let body = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("ssh://");
    let body = body.split_once('@').map(|(_, rest)| rest).unwrap_or(body);

    let mut parts = body.splitn(3, '/');
    let host = parts.next().map(String::from).and_then(non_empty);
    let owner = parts.next().map(String::from).and_then(non_empty);
    let repo = parts.next().map(String::from).and_then(non_empty);
    (host, owner, repo)
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_op_maps_status_pairs() {
        // Untracked file (`?? path`).
        assert_eq!(porcelain_op('?', '?'), "A");
        // Added to index.
        assert_eq!(porcelain_op('A', ' '), "A");
        // Rename / copy targets count as adds (new path).
        assert_eq!(porcelain_op('R', ' '), "A");
        assert_eq!(porcelain_op('C', ' '), "A");
        // Any deletion → delete, regardless of which column.
        assert_eq!(porcelain_op('D', ' '), "D");
        assert_eq!(porcelain_op(' ', 'D'), "D");
        assert_eq!(porcelain_op('M', 'D'), "D");
        // Plain modifications (staged, unstaged, or both).
        assert_eq!(porcelain_op('M', ' '), "M");
        assert_eq!(porcelain_op(' ', 'M'), "M");
        assert_eq!(porcelain_op('M', 'M'), "M");
    }
}


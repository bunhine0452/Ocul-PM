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

// ---------- G1: Diff utilities (MASTER-GUIDE §4.1) ----------

/// Per-file diff statistics returned by `diff_stat`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DiffFileStat {
    pub file_path: String,
    pub change_type: String, // "A" added, "M" modified, "D" deleted, "R" renamed
    pub lines_added: u32,
    pub lines_removed: u32,
    /// For renames: the old path.
    pub old_path: Option<String>,
}

/// Get per-file diff stats. Compares working tree vs HEAD if `from`/`to` are None.
/// Alternatively compares `from..to` (two commit-ish refs).
pub fn diff_stat(
    root: &Path,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<DiffFileStat>, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }

    let mut args = vec!["diff", "--numstat", "--diff-filter=AMDRT", "-z"];
    match (from, to) {
        (Some(f), Some(t)) => {
            args.push(f);
            args.push(t);
        }
        (Some(f), None) => {
            args.push(f);
        }
        _ => {
            // Working tree vs HEAD
            args.push("HEAD");
        }
    }

    let text = run_git(root, &args)?;
    let mut results = Vec::new();

    // --numstat -z output: "added\tremoved\0old_path\0new_path\0" for renames,
    // "added\tremoved\0path\0" for normal changes.
    // We parse by splitting on NUL.
    let parts: Vec<&str> = text.split('\0').collect();
    let mut i = 0;
    while i < parts.len() {
        let stat_line = parts[i].trim();
        if stat_line.is_empty() {
            i += 1;
            continue;
        }

        // stat_line = "10\t5" or "-\t-" (binary)
        let mut cols = stat_line.split('\t');
        let added_str = cols.next().unwrap_or("0");
        let removed_str = cols.next().unwrap_or("0");

        let lines_added = added_str.parse::<u32>().unwrap_or(0);
        let lines_removed = removed_str.parse::<u32>().unwrap_or(0);

        i += 1;
        if i >= parts.len() {
            break;
        }
        let file_path = parts[i].to_string();
        i += 1;

        // Detect change type via a separate call would be expensive;
        // infer from context: if lines_added>0 && lines_removed==0 for new files, etc.
        // For better accuracy, we'll use --name-status separately.
        results.push(DiffFileStat {
            file_path,
            change_type: "M".to_string(), // Will be refined below
            lines_added,
            lines_removed,
            old_path: None,
        });
    }

    // Refine change types using --name-status
    let mut status_args = vec!["diff", "--name-status", "--diff-filter=AMDRT", "-z"];
    match (from, to) {
        (Some(f), Some(t)) => {
            status_args.push(f);
            status_args.push(t);
        }
        (Some(f), None) => {
            status_args.push(f);
        }
        _ => {
            status_args.push("HEAD");
        }
    }

    if let Ok(status_text) = run_git(root, &status_args) {
        let status_parts: Vec<&str> = status_text.split('\0').collect();
        let mut si = 0;
        let mut status_map: std::collections::HashMap<String, (String, Option<String>)> =
            std::collections::HashMap::new();

        while si < status_parts.len() {
            let status = status_parts[si].trim();
            if status.is_empty() {
                si += 1;
                continue;
            }

            let change_type = status.chars().next().unwrap_or('M').to_string();
            si += 1;

            if change_type.starts_with('R') || change_type.starts_with('C') {
                // Rename/Copy: two paths follow
                if si + 1 < status_parts.len() {
                    let old_path = status_parts[si].to_string();
                    let new_path = status_parts[si + 1].to_string();
                    status_map.insert(new_path, ("R".to_string(), Some(old_path)));
                    si += 2;
                } else {
                    si += 1;
                }
            } else if si < status_parts.len() {
                let path = status_parts[si].to_string();
                status_map.insert(path, (change_type, None));
                si += 1;
            }
        }

        for entry in &mut results {
            if let Some((ct, old)) = status_map.get(&entry.file_path) {
                entry.change_type = ct.clone();
                entry.old_path = old.clone();
            }
        }
    }

    Ok(results)
}

/// List paths that exist in the working tree but are neither tracked nor
/// ignored. `git diff HEAD` skips these entirely, which means a newly-created
/// file would otherwise never make it into a changelog entry. We respect the
/// repo's gitignore rules so generated artefacts don't sneak in.
pub fn list_untracked(root: &Path) -> Result<Vec<String>, String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }
    // `--others`: untracked. `--exclude-standard`: honour .gitignore /
    // info/exclude / core.excludesFile. `-z`: NUL-separated to survive
    // spaces and unicode.
    let text = run_git(
        root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    Ok(text
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect())
}

/// Get unified diff patch for a specific file. Returns the diff text.
/// `max_bytes` caps the output to prevent huge diffs from blowing up memory.
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

    if text.len() > max_bytes {
        let truncated: String = text.chars().take(max_bytes).collect();
        Ok(format!("{}\n\n... (truncated, {} bytes total)", truncated, text.len()))
    } else {
        Ok(text)
    }
}

/// Get overall diff summary (total files, lines added, lines removed).
pub fn diff_shortstat(
    root: &Path,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(u32, u32, u32), String> {
    if !is_repo(root) {
        return Err("Not a git repository.".to_string());
    }

    let mut args = vec!["diff", "--shortstat"];
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

    let text = run_git(root, &args)?;
    // Parse "3 files changed, 10 insertions(+), 5 deletions(-)"
    let mut files = 0u32;
    let mut added = 0u32;
    let mut removed = 0u32;

    for part in text.split(',') {
        let part = part.trim();
        if part.contains("file") {
            files = part.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if part.contains("insertion") {
            added = part.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if part.contains("deletion") {
            removed = part.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        }
    }

    Ok((files, added, removed))
}

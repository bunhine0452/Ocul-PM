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


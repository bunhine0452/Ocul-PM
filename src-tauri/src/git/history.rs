//! 커밋 목록 — `git log` 출력을 DTO 로 읽는 파서들. Today 의 최근 커밋(`log`),
//! 커밋 그래프(`graph`), git 이력 백필(`commits_for_backfill`). 셋 다 "구분자로
//! 이어 붙인 pretty-format 을 줄 단위로 가른다"는 같은 모양이라 한자리에 둔다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{primary_repo, run_git};

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

/// Recent commits, newest first. Excludes merge commits by default.
pub fn log(root: &Path, limit: u32) -> Result<Vec<GitCommit>, String> {
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };

    // Use ASCII unit separator (0x1f) to safely split fields containing pipes.
    let text = run_git(
        &repo,
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

/// One commit in the graph view (Today git graph). Carries `parents` for lane
/// routing and `refs` (branch/tag/HEAD decorations) so the UI can badge tips.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitGraphCommit {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    /// Unix timestamp in seconds (author date).
    pub timestamp: i32,
    pub subject: String,
    /// Ref names pointing here (e.g. `main`, `origin/main`, a tag), HEAD-/tag-
    /// prefixes stripped.
    pub refs: Vec<String>,
}

/// Commit DAG across all branches/tags (`--all`), newest first in date order,
/// for the Today graph. Includes parents + ref decorations; lane assignment is
/// computed on the frontend.
pub fn graph(root: &Path, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };
    let text = run_git(
        &repo,
        &[
            "log",
            "--no-color",
            "--all",
            "--date-order",
            &format!("-n{}", limit.max(1)),
            "--pretty=format:%H\x1f%P\x1f%an\x1f%at\x1f%D\x1f%s",
        ],
    )?;
    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(6, '\x1f').collect();
        if parts.len() < 6 {
            continue;
        }
        let sha = parts[0].to_string();
        let short_sha: String = sha.chars().take(7).collect();
        let parents = parts[1]
            .split_whitespace()
            .map(String::from)
            .collect::<Vec<_>>();
        // %D: "HEAD -> main, origin/main, tag: v1.0" (empty when undecorated).
        let refs = parts[4]
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| {
                s.trim_start_matches("HEAD -> ")
                    .trim_start_matches("tag: ")
                    .to_string()
            })
            .collect::<Vec<_>>();
        commits.push(GitGraphCommit {
            sha,
            short_sha,
            parents,
            author_name: parts[2].to_string(),
            timestamp: parts[3].parse().unwrap_or(0),
            subject: parts[5].to_string(),
            refs,
        });
    }
    Ok(commits)
}

/// One commit plus its body and changed files — the raw material for
/// git-history journal backfill (F5). Internal to the backend (not a wire DTO).
#[derive(Debug, Clone)]
pub struct BackfillCommit {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds (author date).
    pub timestamp: i32,
    pub subject: String,
    pub body: String,
    pub files: Vec<BackfillFileChange>,
}

#[derive(Debug, Clone)]
pub struct BackfillFileChange {
    /// First letter of the git name-status code: `A`/`M`/`D`/`R`/`C`.
    pub status: char,
    pub path: String,
    pub rename_from: Option<String>,
}

/// List up to `limit` recent non-merge commits (newest first) with their body
/// and changed files in a single `git log --name-status` call. Used by the
/// git-history backfill to synthesise one journal entry per commit.
pub fn commits_for_backfill(root: &Path, limit: u32) -> Result<Vec<BackfillCommit>, String> {
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };
    // RS (0x1e) separates commit records; US (0x1f) separates header fields.
    // `--name-status` appends "STATUS\tPATH" lines after each header.
    let text = run_git(
        &repo,
        &[
            "log",
            "--no-color",
            "--no-merges",
            "-M",
            &format!("-n{}", limit.max(1)),
            "--name-status",
            "--pretty=format:\x1e%H\x1f%an\x1f%ae\x1f%at\x1f%s\x1f%b\x1f",
        ],
    )?;

    let mut out = Vec::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim_start_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(7, '\x1f');
        let sha = parts.next().unwrap_or("").to_string();
        if sha.is_empty() {
            continue;
        }
        let author_name = parts.next().unwrap_or("").to_string();
        let author_email = parts.next().unwrap_or("").to_string();
        let timestamp = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let subject = parts.next().unwrap_or("").to_string();
        let body = parts.next().unwrap_or("").trim().to_string();
        let files = parse_name_status(parts.next().unwrap_or(""));
        let short_sha: String = sha.chars().take(7).collect();
        out.push(BackfillCommit {
            sha,
            short_sha,
            author_name,
            author_email,
            timestamp,
            subject,
            body,
            files,
        });
    }
    Ok(out)
}

/// Parse a `git log --name-status` block into changed files. Handles renames
/// (`R100\told\tnew`) by recording the new path + `rename_from`.
fn parse_name_status(block: &str) -> Vec<BackfillFileChange> {
    let mut out = Vec::new();
    for line in block.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let code = cols.next().unwrap_or("");
        let Some(status) = code.chars().next() else {
            continue;
        };
        let p1 = super::repo::unquote_git_path(cols.next().unwrap_or(""));
        let p2 = cols.next().map(super::repo::unquote_git_path);
        let renamed = if status == 'R' || status == 'C' {
            p2
        } else {
            None
        };
        if let Some(p2) = renamed {
            out.push(BackfillFileChange {
                status,
                path: p2,
                rename_from: Some(p1),
            });
        } else if !p1.is_empty() {
            out.push(BackfillFileChange {
                status,
                path: p1,
                rename_from: None,
            });
        }
    }
    out
}

//! 저장소 머리글 — 현재 브랜치·리모트(`status`)와 타이틀바 git 칩이 쓰는
//! 미커밋 개수(`head_status_brief`). 리모트 URL 을 host/owner/repo 로 푸는
//! 파서도 `GitRemote` 를 만드는 쪽이라 여기 산다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{primary_repo, run_git};

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

pub fn status(root: &Path) -> GitRepoStatus {
    let Some(repo) = primary_repo(root) else {
        return GitRepoStatus {
            is_git_repo: false,
            head_branch: None,
            remotes: Vec::new(),
        };
    };
    let root = repo.as_path();
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

pub fn remotes(root: &Path) -> Result<Vec<GitRemote>, String> {
    let Some(repo) = primary_repo(root) else {
        return Ok(Vec::new());
    };
    let text = run_git(&repo, &["remote", "-v"])?;

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
    let Some(repo) = primary_repo(root) else {
        return GitHeadStatusBrief {
            is_git_repo: false,
            head_branch: None,
            uncommitted: 0,
        };
    };
    let root = repo.as_path();
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

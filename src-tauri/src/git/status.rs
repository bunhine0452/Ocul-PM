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
    // 가지 이름은 `.git/HEAD` 에서 바로 읽는다 — 떨어진 HEAD 면 없음(`rev-parse
    // --abbrev-ref` 의 `HEAD` 와 같은 뜻). 파일로 못 읽는 저장소(reftable 등)만 git 에
    // 묻는다 (Windows 성능 라운드 2026-11-11).
    let head_branch = match super::head::head_of(root) {
        Some(super::head::Head::Branch { name, .. }) => Some(name),
        Some(super::head::Head::Detached(_)) => None,
        None => run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "HEAD"),
    };
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
    let text = remote_listing(&repo)?;

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

/// `git remote -v` — 저장소 설정(`config`)의 수정 시각이 그대로면 지난 답을 쓴다.
/// 리모트는 설정 파일에만 산다 (Windows 성능 라운드 2026-11-11). 설정 자리를 못 찾으면
/// 매번 묻는다.
fn remote_listing(repo: &Path) -> Result<String, String> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::SystemTime;
    type Memo = HashMap<std::path::PathBuf, (SystemTime, String)>;
    static MEMO: LazyLock<Mutex<Memo>> = LazyLock::new(Default::default);
    let stamp = super::head::git_dirs(&repo.join(".git")).and_then(|d| {
        std::fs::metadata(d.common_dir.join("config"))
            .ok()?
            .modified()
            .ok()
    });
    if let Some(stamp) = stamp {
        if let Some((seen, text)) = MEMO.lock().ok().and_then(|m| m.get(repo).cloned()) {
            if seen == stamp {
                return Ok(text);
            }
        }
    }
    let text = run_git(repo, &["remote", "-v"])?;
    if let (Some(stamp), Ok(mut m)) = (stamp, MEMO.lock()) {
        m.insert(repo.to_path_buf(), (stamp, text.clone()));
    }
    Ok(text)
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

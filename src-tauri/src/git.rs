//! Lightweight wrappers around the local `git` CLI for read-only operations.
//! Operates on any local clone — does NOT require a GitHub token or network.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

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

/// Git's well-known empty-tree object. `git diff <empty-tree> HEAD` renders the
/// whole tree as additions — used as the baseline when HEAD is a root commit
/// (no `HEAD~1` parent).
pub(crate) const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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

// Now only referenced from tests — project queries go through `primary_repo`
// (nested-aware). Kept as a focused predicate for the test fixtures.
#[allow(dead_code)]
fn is_repo(root: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Resolve the git work-tree root that contains `path` (a file or directory).
/// Walks up from the nearest existing ancestor via `rev-parse --show-toplevel`,
/// so it finds the repo even when it sits *below* the Ocul-PM project root — the
/// `.oculpm/` folder can be opened on a parent of the actual git repo. Returns
/// `None` when `path` is not inside any repo.
pub fn repo_root_for(path: &Path) -> Option<PathBuf> {
    // `git -C` needs an existing directory — climb to the nearest one.
    let mut anchor = path;
    let dir = loop {
        if anchor.is_dir() {
            break anchor;
        }
        if anchor.exists() {
            // a file → use its parent
            break anchor.parent()?;
        }
        anchor = anchor.parent()?;
    };
    let out = run_git(dir, &["rev-parse", "--show-toplevel"]).ok()?;
    let top = out.trim();
    if top.is_empty() {
        None
    } else {
        Some(PathBuf::from(top))
    }
}

/// The path of `abs` relative to its repo `repo`, as a git pathspec. Resilient
/// to symlinked roots (e.g. macOS `/var` → `/private/var`, which `rev-parse
/// --show-toplevel` canonicalizes but `root.join(path)` does not) and to deleted
/// files (canonicalizes the parent dir, re-attaches the file name).
fn repo_relative(repo: &Path, abs: &Path) -> Option<String> {
    if let Ok(real) = std::fs::canonicalize(abs) {
        if let Ok(rel) = real.strip_prefix(repo) {
            return Some(rel.to_string_lossy().to_string());
        }
    }
    if let (Some(parent), Some(name)) = (abs.parent(), abs.file_name()) {
        if let Ok(preal) = std::fs::canonicalize(parent) {
            if let Ok(rel) = preal.strip_prefix(repo) {
                return Some(rel.join(name).to_string_lossy().to_string());
            }
        }
    }
    abs.strip_prefix(repo)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Find the git work-tree root(s) relevant to a project at `root`. The common
/// case (root is, or is inside, one repo) returns a single root. When the
/// `.oculpm/` folder sits above the actual repo(s), it discovers repo roots a
/// few levels down — so the 변경 diff 화면 stays git-backed (persistent across
/// restarts/updates) instead of falling back to the volatile watcher buffer.
fn discover_repos(root: &Path) -> Vec<PathBuf> {
    if let Some(r) = repo_root_for(root) {
        return vec![r];
    }
    const SKIP: &[&str] = &[
        ".git",
        "node_modules",
        ".oculpm",
        "target",
        "dist",
        "build",
        ".next",
        ".venv",
        "venv",
        "__pycache__",
        ".turbo",
        ".cache",
    ];
    let mut repos = Vec::new();
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir() || !SKIP.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() && entry.path().join(".git").exists() {
            repos.push(entry.path().to_path_buf());
            if repos.len() >= 25 {
                break;
            }
        }
    }
    repos
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

/// The single git work-tree to use for project-level queries (log, status,
/// branch, remotes, tags). Returns `root` itself when it is — or sits inside —
/// a repo, otherwise the first repo discovered just below it. This is what lets
/// every git-backed view work when the `.oculpm/` folder is opened on a *parent*
/// of the actual repo (nested-repo case); previously only the diff path handled
/// it and log/status/branch reported "not a git repo". `None` = no repo found.
fn primary_repo(root: &Path) -> Option<PathBuf> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    // 호출마다 `rev-parse --show-toplevel`(그리고 중첩 저장소면 디렉터리 걷기)을
    // 다시 돌리고 있었다 — Today 한 화면이 마운트마다 git 프로세스 ~15개를 띄운
    // 절반이 이 재해석이었다 (2026-08-30 감사). 저장소 루트는 사실상 안 바뀌므로
    // 짧게 기억한다. TTL 을 두는 이유: 나중에 `git init` 한 프로젝트가 영원히
    // "저장소 아님" 으로 남지 않게.
    const TTL: Duration = Duration::from_secs(30);
    static CACHE: LazyLock<Mutex<HashMap<PathBuf, (Instant, Option<PathBuf>)>>> =
        LazyLock::new(Default::default);

    let now = Instant::now();
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, repo)) = cache.get(root) {
            if now.duration_since(*at) < TTL {
                return repo.clone();
            }
        }
    }
    let repo = discover_repos(root).into_iter().next();
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(root.to_path_buf(), (now, repo.clone()));
    }
    repo
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
        let p1 = cols.next().unwrap_or("");
        let p2 = cols.next();
        let renamed = if status == 'R' || status == 'C' {
            p2
        } else {
            None
        };
        if let Some(p2) = renamed {
            out.push(BackfillFileChange {
                status,
                path: p2.to_string(),
                rename_from: Some(p1.to_string()),
            });
        } else if !p1.is_empty() {
            out.push(BackfillFileChange {
                status,
                path: p1.to_string(),
                rename_from: None,
            });
        }
    }
    out
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

/// List tags newest first. For each tag returns the SHA it points to and the
/// tag/commit metadata needed to render a changelog.
pub fn tags(root: &Path, limit: u32) -> Result<Vec<GitTag>, String> {
    let Some(repo) = primary_repo(root) else {
        return Ok(Vec::new());
    };
    let root = repo.as_path();
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
        let sha = if !parts[1].is_empty() {
            parts[1]
        } else {
            parts[2]
        }
        .to_string();
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
        let message = parts
            .get(7)
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

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
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };
    let root = repo.as_path();
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
        // Prefix to make each repo's paths relative to the project root.
        let prefix = repo.strip_prefix(root).ok().map(PathBuf::from);
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
            let path = match &prefix {
                Some(p) if !p.as_os_str().is_empty() => p.join(raw).to_string_lossy().to_string(),
                _ => raw.to_string(),
            };
            changes.push(GitChange {
                path,
                op: porcelain_op(x, y).to_string(),
            });
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
    let prefix = repo.strip_prefix(root).ok().map(PathBuf::from);
    let Ok(out) = run_git(repo, &["diff", "--name-status", "-z", from, to]) else {
        return Vec::new();
    };
    let mut changes = Vec::new();
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
        let path = match &prefix {
            Some(p) if !p.as_os_str().is_empty() => p.join(raw).to_string_lossy().to_string(),
            _ => raw.to_string(),
        };
        let op = match code {
            'A' | 'R' | 'C' => "A",
            'D' => "D",
            _ => "M",
        };
        changes.push(GitChange {
            path,
            op: op.to_string(),
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
    // Resolve the repo that actually contains the file — it may be nested below
    // `root` (the .oculpm folder can sit above the git repo). Run git there with
    // the path made relative to that repo.
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs).ok_or_else(|| "Not a git repository.".to_string())?;
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());

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
    args.push(&rel);

    let text = run_git(&repo, &args)?;

    Ok(truncate_patch(text, max_bytes))
}

/// 거터 계산에 쓰는 HEAD 블롭 상한 — 에디터가 여는 파일 상한(2MB)과 같게.
const GUTTER_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 에디터 거터에 그릴 한 덩어리의 변경. 줄 번호는 **1-based, 현재 버퍼 기준**.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GitLineChange {
    /// 첫 줄 (포함).
    pub start_line: u32,
    /// 마지막 줄 (포함). `deleted` 는 start_line == end_line 이고, 그 줄
    /// **다음에** 무언가 지워졌다는 뜻이다 (지워진 줄은 화면에 없으므로).
    pub end_line: u32,
    pub kind: GitLineChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum GitLineChangeKind {
    Added,
    Modified,
    Deleted,
}

/// HEAD 의 그 파일과 **지금 버퍼**를 줄 단위로 비교한다 (에디터 거터).
///
/// `git diff` 를 쓰지 않는 이유: 그건 디스크를 보는데, 거터는 **저장하기 전에**
/// 무엇을 고쳤는지 보여야 쓸모가 있다. 그래서 HEAD 블롭만 git 에서 가져오고
/// 비교는 여기서 한다.
///
/// HEAD 에 없는 파일(새 파일)은 전부 `added` 다. 저장소 밖이면 빈 목록 —
/// 오류가 아니다(추적되지 않는 폴더를 열어도 편집기는 동작해야 한다).
pub fn line_changes(root: &Path, file_path: &str, current: &str) -> Vec<GitLineChange> {
    if repo_root_for(&root.join(file_path)).is_none() {
        return Vec::new();
    }
    // `show_file_bytes` 가 중첩 저장소 해석까지 안에서 한다 — 여기서 미리 풀면
    // 그 계약과 어긋난다. 상한은 에디터가 여는 파일 상한과 같게 둔다.
    let head = match show_file_bytes(root, file_path, "HEAD", GUTTER_MAX_BYTES) {
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            // 바이너리였다 — 거터로 말할 것이 없다.
            Err(_) => return Vec::new(),
        },
        // HEAD 에 없다 = 새 파일. 전부 추가로 표시한다.
        None => {
            return vec![GitLineChange {
                start_line: 1,
                end_line: current.lines().count().max(1) as u32,
                kind: GitLineChangeKind::Added,
            }]
        }
    };
    diff_line_changes(&head, current)
}

/// 두 텍스트의 줄 차이 → 거터 덩어리. IO 가 없어 순수 함수로 테스트한다.
///
/// `similar` 의 그룹(연속 변경 묶음)을 그대로 쓰지 않고 직접 접는 이유는
/// **삭제와 수정을 구별**해야 하기 때문이다: 지운 줄은 화면에 없으므로 그 자리를
/// 앞 줄에 붙은 표식 하나로 알려야 하고, 지움+삽입이 붙어 있으면 그건 수정이다.
pub fn diff_line_changes(before: &str, after: &str) -> Vec<GitLineChange> {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(before, after);
    // (새 파일 줄번호, 태그) 를 순서대로 훑으며 연속 구간을 접는다.
    let mut out: Vec<GitLineChange> = Vec::new();
    // 마지막으로 본 새-파일 줄 (1-based). 삭제 표식을 붙일 자리.
    let mut last_new_line: u32 = 0;
    // 지금 쌓는 중인 삽입 구간.
    let mut run: Option<(u32, u32)> = None;
    // 이 삽입 구간 직전에 삭제가 있었나 → 수정으로 본다.
    let mut run_after_delete = false;
    // 삽입이 뒤따르지 않은 채 끝난 삭제.
    let mut pending_delete = false;

    let flush = |out: &mut Vec<GitLineChange>, run: &mut Option<(u32, u32)>, modified: bool| {
        if let Some((start, end)) = run.take() {
            out.push(GitLineChange {
                start_line: start,
                end_line: end,
                kind: if modified {
                    GitLineChangeKind::Modified
                } else {
                    GitLineChangeKind::Added
                },
            });
        }
    };

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                flush(&mut out, &mut run, run_after_delete);
                run_after_delete = false;
                if pending_delete {
                    out.push(GitLineChange {
                        start_line: last_new_line.max(1),
                        end_line: last_new_line.max(1),
                        kind: GitLineChangeKind::Deleted,
                    });
                    pending_delete = false;
                }
                last_new_line = change
                    .new_index()
                    .map(|i| i as u32 + 1)
                    .unwrap_or(last_new_line);
            }
            ChangeTag::Delete => {
                // 삽입 구간이 열려 있는데 삭제가 오면 별개의 덩어리다.
                flush(&mut out, &mut run, run_after_delete);
                run_after_delete = false;
                pending_delete = true;
            }
            ChangeTag::Insert => {
                let line = change
                    .new_index()
                    .map(|i| i as u32 + 1)
                    .unwrap_or(last_new_line + 1);
                if pending_delete {
                    run_after_delete = true;
                    pending_delete = false;
                }
                run = Some(match run {
                    Some((start, _)) => (start, line),
                    None => (line, line),
                });
                last_new_line = line;
            }
        }
    }
    flush(&mut out, &mut run, run_after_delete);
    if pending_delete {
        out.push(GitLineChange {
            start_line: last_new_line.max(1),
            end_line: last_new_line.max(1),
            kind: GitLineChangeKind::Deleted,
        });
    }
    out
}

/// Size in bytes of the blob at `<rev>:<path>` (`git cat-file -s`). `None`
/// when the path isn't in that rev, the rev doesn't exist (unborn HEAD, root
/// commit's `HEAD~1`), or the file isn't inside any repo. Nested-repo aware.
pub fn blob_size(root: &Path, file_path: &str, rev: &str) -> Option<u64> {
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs)?;
    let out = run_git(&repo, &["cat-file", "-s", &format!("{rev}:{rel}")]).ok()?;
    out.trim().parse().ok()
}

/// Raw bytes of `<rev>:<path>` via `git show` — binary-safe, unlike `run_git`
/// which funnels stdout through a lossy UTF-8 conversion. Powers the 변경 diff
/// 화면's image "이전" preview. `None` when the blob doesn't exist at that rev
/// or exceeds `max_bytes` (the caller renders a size-only card instead).
pub fn show_file_bytes(
    root: &Path,
    file_path: &str,
    rev: &str,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs)?;
    let out = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["show", &format!("{rev}:{rel}")])
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.len() > max_bytes {
        return None;
    }
    Some(out.stdout)
}

/// Whether `file_path` exists in the repo's `HEAD` commit.
///   - `None`        — the path isn't inside any git repo.
///   - `Some(true)`  — tracked and present in `HEAD`.
///   - `Some(false)` — inside a repo but NOT in `HEAD`: an untracked/newly
///     created file, a staged-but-never-committed add, or an unborn-HEAD repo.
///
/// Lets the entry-diff capture tell "tracked file with an empty `git diff HEAD`"
/// (a genuine no-op) apart from "brand-new file git diff can't see" (untracked),
/// so only the latter is synthesised as a create diff. Resolves the repo that
/// actually contains the file (it may sit below the Ocul-PM project root).
pub fn path_in_head(root: &Path, file_path: &str) -> Option<bool> {
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());
    // `cat-file -e HEAD:<rel>` exits 0 iff the blob exists in HEAD; any failure
    // (missing path, or unborn HEAD in a fresh repo) means "not in HEAD".
    Some(run_git(&repo, &["cat-file", "-e", &format!("HEAD:{rel}")]).is_ok())
}

/// Cap a unified-diff blob at `max_bytes`, appending a truncation marker. Keeps
/// a runaway generated file from bloating callers (sidecars, IPC payloads).
fn truncate_patch(text: String, max_bytes: usize) -> String {
    if text.len() > max_bytes {
        format!(
            "{}\n\n... (truncated, {} bytes total)",
            truncate_at_char_boundary(&text, max_bytes),
            text.len()
        )
    } else {
        text
    }
}

/// Longest prefix of `text` that fits in `max_bytes` *bytes* without splitting
/// a UTF-8 char. The old `chars().take(max_bytes)` counted characters, so a
/// multibyte (한글) patch blew the budget by up to 4× before truncating.
pub(crate) fn truncate_at_char_boundary(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
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
    // Resolve the repo containing the file (may be nested below `root`).
    let abs = root.join(file_path);
    let Some(repo) = repo_root_for(&abs) else {
        return Ok(String::new());
    };
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());

    // "<hash> <author-unixtime>" per commit touching the path (newest first).
    let listing = run_git(
        &repo,
        &["log", "--format=%H %at", "--max-count=200", "--", &rel],
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
            &repo,
            &["show", "--format=", "--unified=3", &hash, "--", &rel],
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

    // ─── 에디터 거터 (#git-gutter) ─────────────────────────────────────────

    /// `(시작, 끝, 종류)` 로 줄여 읽기 쉽게.
    fn shape(changes: &[GitLineChange]) -> Vec<(u32, u32, GitLineChangeKind)> {
        changes
            .iter()
            .map(|c| (c.start_line, c.end_line, c.kind))
            .collect()
    }

    #[test]
    fn gutter_marks_added_lines() {
        let got = diff_line_changes("a\nb\n", "a\nX\nY\nb\n");
        assert_eq!(shape(&got), vec![(2, 3, GitLineChangeKind::Added)]);
    }

    #[test]
    fn gutter_marks_a_replaced_line_as_modified_not_add_plus_delete() {
        // 지움+삽입이 붙어 있으면 사람 눈에는 "고쳤다" 다 — 표식 두 개를
        // 겹쳐 그리면 거터가 시끄럽고 무슨 일이 났는지 안 보인다.
        let got = diff_line_changes("a\nb\nc\n", "a\nB\nc\n");
        assert_eq!(shape(&got), vec![(2, 2, GitLineChangeKind::Modified)]);
    }

    #[test]
    fn gutter_marks_deletions_on_the_surviving_line_above() {
        // 지워진 줄은 화면에 없다 — 남아 있는 앞 줄에 표식을 붙인다.
        let got = diff_line_changes("a\nb\nc\n", "a\nc\n");
        assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
    }

    #[test]
    fn gutter_marks_a_deletion_at_the_end_of_file() {
        let got = diff_line_changes("a\nb\n", "a\n");
        assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
    }

    #[test]
    fn gutter_marks_a_deletion_at_the_start_of_file() {
        // 앞에 남은 줄이 없으면 1행에 붙인다 (0행은 없다).
        let got = diff_line_changes("a\nb\n", "b\n");
        assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
    }

    #[test]
    fn gutter_keeps_separate_hunks_separate() {
        let got = diff_line_changes("a\nb\nc\nd\n", "a\nX\nc\nd\nY\n");
        assert_eq!(
            shape(&got),
            vec![
                (2, 2, GitLineChangeKind::Modified),
                (5, 5, GitLineChangeKind::Added)
            ]
        );
    }

    #[test]
    fn gutter_is_empty_when_nothing_changed() {
        assert!(diff_line_changes("a\nb\n", "a\nb\n").is_empty());
    }

    #[test]
    fn gutter_handles_korean_lines() {
        // 줄 단위 비교라 바이트 폭은 상관없어야 한다 (회귀 방지).
        let got = diff_line_changes("가\n나\n", "가\n다\n");
        assert_eq!(shape(&got), vec![(2, 2, GitLineChangeKind::Modified)]);
    }

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

    fn git(dir: &Path, args: &[&str]) -> Result<(), ()> {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|_| ())
            .ok_or(())
    }

    /// Regression (2026-06-14): when the git repo sits *below* the project root
    /// (the .oculpm folder is opened on a parent), the live 변경 diff 화면 used
    /// to fall back to the volatile watcher buffer — so it reset on every app
    /// update. The git layer must discover the nested repo and report/diff its
    /// changes with paths relative to the project root.
    #[test]
    fn nested_repo_below_root_is_diffable() {
        let root = std::env::temp_dir().join(format!("ocul-nested-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let repo = root.join("app");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        // root itself is NOT a repo; `app/` is.
        if git(&repo, &["init", "-q"]).is_err() {
            return; // git unavailable
        }
        git(&repo, &["config", "user.email", "t@t.dev"]).unwrap();
        git(&repo, &["config", "user.name", "t"]).unwrap();
        let rel_in_repo = "src/page.tsx";
        std::fs::write(repo.join(rel_in_repo), "const a = 1;\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "base"]).unwrap();
        // Modify (uncommitted) — should surface in the change list.
        std::fs::write(repo.join(rel_in_repo), "const a = 2;\n").unwrap();

        // root is not itself a repo, but discovery finds app/.
        assert!(!is_repo(&root), "root must not be a repo for this fixture");
        let changes = uncommitted_changes(&root);
        assert!(
            changes.iter().any(|c| c.path == "app/src/page.tsx"),
            "expected the nested repo's change at a root-relative path, got: {changes:?}"
        );

        // Per-file diff resolves the nested repo and shows the working change.
        let patch = diff_patch(&root, "app/src/page.tsx", None, None, 64 * 1024).unwrap();
        assert!(patch.contains("const a = 2;"), "diff_patch: {patch}");

        // Commit it, then the history fallback still recovers the diff.
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "change"]).unwrap();
        let hist = diff_at_nearest_commit(&root, "app/src/page.tsx", None, 64 * 1024).unwrap();
        assert!(hist.contains("const a = 2;"), "history: {hist}");

        let _ = std::fs::remove_dir_all(&root);
    }
}

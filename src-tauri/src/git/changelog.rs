//! 체인지로그 조립 재료 — 태그 목록(`tags`), 태그 사이 커밋(`log_range`),
//! 프로젝트의 CHANGELOG 파일(`read_changelog`). 화면(Lite-W6 PR4)은 물러났지만
//! 셋이 한 기능이었고 함께 쓰이므로 이력 파서(`history`)와 섞지 않고 따로 둔다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{primary_repo, run_git, GitCommit};

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

/// 릴리스 노트 초안이 기본 기준으로 삼을 **가장 최근 `v*` 태그**
/// (`{#release-notes-draft}`).
///
/// 두 물음이 다르다. `describe --tags --abbrev=0` 은 "`to` 에서 **거슬러 닿는**
/// 마지막 태그"를 준다 — 지난 릴리스 이후를 묻는 자리에서 원하는 답이 이쪽이다.
/// 닿는 태그가 없을 때만(갓 만든 브랜치·얕은 클론) 저장소 전체에서 버전 정렬로
/// 고른다. 둘 다 없으면 `None` — 호출자는 "태그가 없다"를 초안에 적는다.
pub fn latest_version_tag(root: &Path, to: &str) -> Result<Option<String>, String> {
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };
    let root = repo.as_path();
    let described = run_git(
        root,
        &["describe", "--tags", "--abbrev=0", "--match", "v*", to],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    if described.is_some() {
        return Ok(described);
    }
    let listed = run_git(root, &["tag", "--list", "v*", "--sort=-v:refname"])?;
    Ok(listed
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(String::from))
}

/// `from..to` 커밋 하나 — 파일까지. [`log_range`] 와 달리 `--name-only` 를 함께
/// 읽는다: 릴리스 노트 초안은 "이 커밋이 만진 파일"로 일지에 가중을 매긴다.
#[derive(Debug, Clone)]
pub struct RangeCommit {
    pub sha: String,
    pub short_sha: String,
    /// Unix seconds (author date).
    pub timestamp: i32,
    pub subject: String,
    /// 저장소 기준 경로. 프로젝트 기준으로 되맞추는 것은 호출자의 몫이다
    /// (`git::nesting::rebase`).
    pub files: Vec<String>,
}

/// `from..to` 의 비-머지 커밋 + 각 커밋이 만진 파일 (`{#release-notes-draft}`).
///
/// `commits_for_backfill`(history) 과 모양이 같지만 **범위를 받는다** — 백필은
/// "최근 N개"를, 여기는 "태그 사이"를 묻는다. 상태 문자(`A`/`M`/`D`)는 쓰지
/// 않으므로 `--name-only` 로 족하다.
pub fn log_range_with_files(
    root: &Path,
    from: &str,
    to: &str,
    limit: u32,
) -> Result<Vec<RangeCommit>, String> {
    let Some(repo) = primary_repo(root) else {
        return Err("Not a git repository.".to_string());
    };
    let range = if from.is_empty() {
        to.to_string()
    } else {
        format!("{from}..{to}")
    };
    // RS(0x1e) 가 커밋 레코드를, US(0x1f) 가 머리글 필드를 가른다 —
    // `commits_for_backfill` 과 같은 규약.
    let text = run_git(
        repo.as_path(),
        &[
            "log",
            "--no-color",
            "--no-merges",
            "-M",
            &range,
            &format!("-n{}", limit.max(1)),
            "--name-only",
            "--pretty=format:\x1e%H\x1f%at\x1f%s\x1f",
        ],
    )?;

    let mut out = Vec::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim_start_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(4, '\x1f');
        let sha = parts.next().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            continue;
        }
        let timestamp = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let subject = parts.next().unwrap_or("").to_string();
        let files = parts
            .next()
            .unwrap_or("")
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(super::unquote_git_path)
            .collect();
        let short_sha: String = sha.chars().take(7).collect();
        out.push(RangeCommit {
            sha,
            short_sha,
            timestamp,
            subject,
            files,
        });
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChangelogFile {
    pub path: String,
    pub content: String,
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

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

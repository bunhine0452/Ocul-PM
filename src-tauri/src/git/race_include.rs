//! 레인 준비 — `.worktreeinclude` (love-round L6 #worktreeinclude).
//!
//! 레인은 깨끗한 checkout 이라 git 이 무시하는 파일(`.env` · 로컬 설정)이 없다 — 그것 없이는 레인의 Claude 가
//! 테스트도 못 돌리는 프로젝트가 많다. Claude Code 와 같은 이름 · 같은 뜻의 파일을 읽는다: 루트의
//! `.worktreeinclude`(gitignore 문법)에 맞고 **git 이 무시하는** 파일만 레인으로 복사한다.
//!
//! 지키는 것:
//! - 루트 밖으로 나가는 경로(`..` · 절대 경로 · 루트 밖을 가리키는 폴더 링크), 심볼릭 링크 파일은 건너뛴다.
//! - 파일 하나가 [`MAX_FILE`] 를 넘거나, 합이 [`MAX_TOTAL`] 을 넘게 하는 파일은 건너뛴다(`node_modules` 는 복사가
//!   아니라 레인에서 설치할 일이다).
//! - `.oculpm/` 는 건너뛴다 — 색인은 앱의 것이고, 일지를 옮기면 레인이 쓴 일지로 세어진다(`seed_records` 가 따로 심는다).
//! - 레인에 이미 있는 파일(git 이 올린 것)은 덮지 않는다. 레인 안의 폴더 링크를 타고 레인 밖에 쓰지 않는다.
//! - 알리는 것은 복사한 파일의 **이름**뿐이다 — 내용은 어디에도(로그 · 일지 · 응답) 싣지 않는다.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use super::race::run;

/// 루트의 포함 목록 파일 — Claude Code 와 같은 이름.
pub const FILE: &str = ".worktreeinclude";
/// 파일 하나의 상한.
pub const MAX_FILE: u64 = 1024 * 1024;
/// 레인 하나에 복사하는 합의 상한.
pub const MAX_TOTAL: u64 = 20 * 1024 * 1024;

/// 복사할 후보 — 루트 기준 `/` 상대 경로와 크기. [`plan`] 이 한 번 고르고 레인마다 [`copy_into`] 한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub rel: String,
    pub size: u64,
}

/// `git ls-files -z` 출력 → 경로들.
fn nul_list(out: &str) -> Vec<&str> {
    out.split('\0').filter(|s| !s.is_empty()).collect()
}

/// 루트 안의 평범한 상대 경로인가 — `..` · 절대 · 드라이브 접두가 없다.
fn plain_relative(rel: &str) -> bool {
    let p = Path::new(rel);
    !rel.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

/// 기록 폴더 — 앱의 색인과 일지는 옮기지 않는다.
fn is_records(rel: &str) -> bool {
    rel == ".oculpm" || rel.starts_with(".oculpm/")
}

/// git 이 무시하는가 — `ignored` 는 `--directory` 로 접힌 목록이라 폴더는 `name/` 로 온다.
fn is_ignored(rel: &str, ignored: &HashSet<&str>) -> bool {
    if ignored.contains(rel) {
        return true;
    }
    let mut at = 0;
    while let Some(i) = rel[at..].find('/') {
        let end = at + i + 1;
        if ignored.contains(&rel[..end]) {
            return true;
        }
        at = end;
    }
    false
}

/// 후보를 고른다 — 순서는 git 이 준 대로, 크기 상한은 [`copy_into`] 가 레인마다 센다. 목록 파일이 없거나 git 이
/// 거절하면 빈 목록(레인은 예전처럼 깨끗한 checkout 으로 선다).
pub fn plan(root: &Path) -> Vec<Candidate> {
    if !root.join(FILE).is_file() {
        return Vec::new();
    }
    let exclude = format!("--exclude-from={FILE}");
    let Ok(matched) = run(root, &["ls-files", "-z", "--others", "--ignored", &exclude]) else {
        return Vec::new();
    };
    let Ok(ignored) = run(
        root,
        &[
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    ) else {
        return Vec::new();
    };
    let ignored: HashSet<&str> = nul_list(&ignored).into_iter().collect();
    let Ok(root_canon) = std::fs::canonicalize(root) else {
        return Vec::new();
    };
    nul_list(&matched)
        .into_iter()
        .filter(|rel| plain_relative(rel) && !is_records(rel) && is_ignored(rel, &ignored))
        .filter_map(|rel| {
            let src = root.join(rel);
            let meta = std::fs::symlink_metadata(&src).ok()?;
            if !meta.file_type().is_file() {
                return None;
            }
            // 폴더 링크를 타고 루트 밖의 파일을 가리키면 건너뛴다.
            let canon = std::fs::canonicalize(&src).ok()?;
            canon.starts_with(&root_canon).then(|| Candidate {
                rel: rel.to_string(),
                size: meta.len(),
            })
        })
        .collect()
}

/// `path` 의 가장 가까운 있는 조상이 `lane` 안인가 — 레인 안의 폴더 링크를 타고 밖에 쓰지 않게.
fn stays_inside(lane_canon: &Path, path: &Path) -> bool {
    let mut cur: Option<&Path> = Some(path);
    while let Some(p) = cur {
        if let Ok(meta) = std::fs::symlink_metadata(p) {
            if meta.file_type().is_symlink() {
                return false;
            }
            return std::fs::canonicalize(p).is_ok_and(|c| c.starts_with(lane_canon));
        }
        cur = p.parent();
    }
    false
}

/// 후보를 레인에 복사한다 — 복사한 파일의 이름(루트 기준 `/` 상대 경로)만 돌려준다.
pub fn copy_into(root: &Path, lane: &Path, plan: &[Candidate]) -> Vec<String> {
    let Ok(lane_canon) = std::fs::canonicalize(lane) else {
        return Vec::new();
    };
    let mut total = 0u64;
    let mut copied = Vec::new();
    for c in plan {
        if c.size > MAX_FILE || total + c.size > MAX_TOTAL {
            continue;
        }
        let dest: PathBuf = lane.join(&c.rel);
        if std::fs::symlink_metadata(&dest).is_ok() {
            continue;
        }
        let Some(parent) = dest.parent() else {
            continue;
        };
        if !stays_inside(&lane_canon, parent) || std::fs::create_dir_all(parent).is_err() {
            continue;
        }
        if !stays_inside(&lane_canon, parent) {
            continue;
        }
        if std::fs::copy(root.join(&c.rel), &dest).is_ok() {
            total += c.size;
            copied.push(c.rel.clone());
        }
    }
    copied
}

#[cfg(test)]
#[path = "race_include_tests.rs"]
mod tests;

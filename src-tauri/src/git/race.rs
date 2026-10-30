//! 같은 일을 worktree 여럿에서 (2026-10-30, Orca 「Parallel Worktrees」 벤치마킹).
//!
//! 같은 프롬프트를 격리된 worktree 여럿에서 돌리고, 각 변경을 비교해 하나를 고른다. 고른 것은
//! **원래 작업 폴더에 커밋 전 변경으로** 옮긴다 — 그러면 변경 화면의 검토 · 줄 메모 · 커밋 흐름을
//! 그대로 탄다. 나머지는 worktree 와 가지째 지운다.
//!
//! - 레인은 `ocul-race/<도장>-<n>` 가지의 worktree 다. 상태를 따로 적지 않는다 — `git worktree
//!   list` 에서 이 가지를 찾으면 그것이 레인이다(앱을 다시 켜도 그대로 보인다).
//! - worktree 는 앱 데이터 폴더(`races/p<프로젝트>/`)에 둔다. 프로젝트 폴더 옆에 두면 사용자의 폴더를
//!   어지럽히고, 안에 두면 워처 · `git status` 가 그것을 본다.
//! - git 은 `safe::cmd` 로만 — 저장소 설정의 훅 · 필터 · fsmonitor 가 꺼진 채다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::safe;

/// 레인 가지의 머리.
pub const BRANCH_PREFIX: &str = "ocul-race/";
/// 한 번에 만드는 레인 수의 범위.
pub const MIN_LANES: u8 = 2;
pub const MAX_LANES: u8 = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RaceLane {
    /// `<도장>-<n>` — 사람이 부르는 이름.
    pub name: String,
    pub path: String,
    pub branch: String,
    /// 기준 커밋에서 바뀐 파일 수(새 파일 포함) · 더한 줄 · 뺀 줄.
    pub files: u32,
    pub added: u32,
    pub removed: u32,
}

fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = safe::output(&mut safe::cmd(dir, args)).map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {} failed", args[0])
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `git worktree list --porcelain` → (경로, 가지 이름) — 레인 가지만.
pub fn parse_lanes(porcelain: &str) -> Vec<(String, String)> {
    porcelain
        .split("\n\n")
        .filter_map(|block| {
            let mut path = None;
            let mut branch = None;
            for line in block.lines() {
                if let Some(p) = line.strip_prefix("worktree ") {
                    path = Some(p.to_string());
                } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                    branch = Some(b.to_string());
                }
            }
            match (path, branch) {
                (Some(p), Some(b)) if b.starts_with(BRANCH_PREFIX) => Some((p, b)),
                _ => None,
            }
        })
        .collect()
}

/// 레인을 만든다 — 지금 `HEAD` 에서 `count` 개.
pub fn start(
    root: &Path,
    base_dir: &Path,
    count: u8,
    stamp: &str,
) -> Result<Vec<RaceLane>, String> {
    let count = count.clamp(MIN_LANES, MAX_LANES);
    run(root, &["rev-parse", "--verify", "HEAD"]).map_err(|_| "no_commit".to_string())?;
    std::fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
    let mut made = Vec::new();
    for n in 1..=count {
        let name = format!("{stamp}-{n}");
        let dir = base_dir.join(&name);
        let branch = format!("{BRANCH_PREFIX}{name}");
        let dir_s = dir.to_string_lossy().into_owned();
        if let Err(e) = run(root, &["worktree", "add", "-b", &branch, &dir_s, "HEAD"]) {
            // 반쯤 만든 것은 거둔다 — 남은 레인이 다음 목록에 유령으로 서지 않게.
            for lane in &made {
                let _ = remove(root, lane);
            }
            return Err(e);
        }
        made.push(RaceLane {
            name,
            path: dir_s,
            branch,
            files: 0,
            added: 0,
            removed: 0,
        });
    }
    Ok(made)
}

/// 지금 있는 레인과 각 변경의 크기.
pub fn lanes(root: &Path) -> Result<Vec<RaceLane>, String> {
    let porcelain = run(root, &["worktree", "list", "--porcelain"])?;
    Ok(parse_lanes(&porcelain)
        .into_iter()
        .map(|(path, branch)| {
            let (files, added, removed) =
                stats(root, Path::new(&path), &branch).unwrap_or((0, 0, 0));
            let name = branch.trim_start_matches(BRANCH_PREFIX).to_string();
            RaceLane {
                name,
                path,
                branch,
                files,
                added,
                removed,
            }
        })
        .collect())
}

/// 레인의 기준 커밋 — 가지를 만든 자리(그 뒤 레인이 커밋했어도, 원래 쪽이 나아갔어도).
fn base_of(root: &Path, branch: &str) -> Result<String, String> {
    Ok(run(root, &["merge-base", branch, "HEAD"])?
        .trim()
        .to_string())
}

/// 레인의 모든 변경(커밋 · 미커밋 · 새 파일)을 레인 자신의 인덱스에 올린 뒤 기준과 비교한다.
fn staged_diff(root: &Path, lane: &Path, branch: &str, extra: &[&str]) -> Result<String, String> {
    let base = base_of(root, branch)?;
    run(lane, &["add", "-A"])?;
    let mut args = vec!["diff", "--cached"];
    args.extend_from_slice(extra);
    args.push(&base);
    run(lane, &args)
}

fn stats(root: &Path, lane: &Path, branch: &str) -> Result<(u32, u32, u32), String> {
    let numstat = staged_diff(root, lane, branch, &["--numstat"])?;
    let (mut files, mut added, mut removed) = (0, 0, 0);
    for line in numstat.lines() {
        let mut cols = line.split('\t');
        let a = cols.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        let r = cols.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        files += 1;
        added += a;
        removed += r;
    }
    Ok((files, added, removed))
}

/// 이 프로젝트의 레인 하나 — 아니면 거절(터미널 cwd · 보기 · 고르기가 모두 이것으로 확인한다).
pub fn find(root: &Path, path: &Path) -> Result<RaceLane, String> {
    let want = std::fs::canonicalize(path).map_err(|_| "not_a_lane".to_string())?;
    let porcelain = run(root, &["worktree", "list", "--porcelain"])?;
    parse_lanes(&porcelain)
        .into_iter()
        .find(|(p, _)| std::fs::canonicalize(p).is_ok_and(|c| c == want))
        .map(|(path, branch)| RaceLane {
            name: branch.trim_start_matches(BRANCH_PREFIX).to_string(),
            path,
            branch,
            files: 0,
            added: 0,
            removed: 0,
        })
        .ok_or_else(|| "not_a_lane".to_string())
}

/// 레인의 변경 — 보기용 글(바이너리는 「Binary files differ」 한 줄).
pub fn patch(root: &Path, lane: &RaceLane) -> Result<String, String> {
    staged_diff(root, Path::new(&lane.path), &lane.branch, &[])
}

/// 고른 레인의 변경을 원래 작업 폴더에 커밋 전 변경으로 옮긴다. 원래 쪽에 겹치는 변경이 있으면
/// git 이 거절한 말 그대로 돌려준다(아무것도 바뀌지 않는다).
pub fn take(root: &Path, lane: &RaceLane, scratch: &Path) -> Result<(), String> {
    let diff = staged_diff(root, Path::new(&lane.path), &lane.branch, &["--binary"])?;
    if diff.trim().is_empty() {
        return Err("empty_lane".to_string());
    }
    std::fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let file = scratch.join(format!("{}.patch", lane.name));
    std::fs::write(&file, diff).map_err(|e| e.to_string())?;
    let file_s = file.to_string_lossy().into_owned();
    let applied = run(root, &["apply", "--whitespace=nowarn", &file_s]);
    let _ = std::fs::remove_file(&file);
    applied.map(|_| ())
}

fn remove(root: &Path, lane: &RaceLane) -> Result<(), String> {
    run(root, &["worktree", "remove", "--force", &lane.path])?;
    run(root, &["branch", "-D", &lane.branch])?;
    Ok(())
}

/// 레인을 모두 지운다 — worktree 와 가지째. 지운 수.
pub fn clear(root: &Path) -> Result<u32, String> {
    let all = lanes(root)?;
    let mut n = 0;
    for lane in &all {
        if remove(root, lane).is_ok() {
            n += 1;
        }
    }
    // 지운 worktree 의 관리 기록도 정리한다(폴더를 손으로 지운 경우).
    let _ = run(root, &["worktree", "prune"]);
    Ok(n)
}

/// 레인 폴더의 자리 — 앱 데이터 폴더 아래 프로젝트별.
pub fn base_dir(app_data: &Path, project_id: u32) -> PathBuf {
    app_data.join("races").join(format!("p{project_id}"))
}

#[cfg(test)]
#[path = "race_tests.rs"]
mod tests;

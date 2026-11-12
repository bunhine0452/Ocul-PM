//! 「이 기기에만 있는 것」 (2026-11-13, 플랜 `two-machines-20261113`).
//!
//! 같은 저장소를 두 기기에서 번갈아 쓰면, 한쪽에서 일하고 올리지 않은 것은 다른 쪽에 없다 — 코드만이
//! 아니라 일지와 계획도 그렇다. 올리지 않은 일지는 다른 기기의 Claude 에게 없는 일이고, 그 Claude 는
//! 옛 계획 상태로 시작한다. 오늘 화면이 그것을 한 줄로 말한다.
//!
//! 세는 것은 둘이다: 커밋 안 한 변경(그중 기록이 몇인지)과 어느 리모트에도 없는 커밋. 둘째는 **마지막으로
//! 받아 온 리모트 가지**와 견준다 — 받아 오지(fetch) 않는다. git 은 읽기만 · 네트워크 0. 리모트가 없는
//! 저장소는 올릴 곳이 없으니 아무 말도 하지 않는다(`None`).

use std::path::Path;

use serde::Serialize;

use super::{primary_repo, run_git, uncommitted_changes};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct LocalOnly {
    /// 커밋 안 한 변경 — 기록(`records`)을 포함한 전부.
    pub uncommitted: u32,
    /// 그중 기록 — `.oculpm/journal/` · `.oculpm/planner/` 아래.
    pub records: u32,
    /// 어느 리모트 가지에도 없는 커밋 (`rev-list HEAD --not --remotes`).
    pub unpushed: u32,
}

fn is_record(path: &str) -> bool {
    path.starts_with(".oculpm/journal/") || path.starts_with(".oculpm/planner/")
}

/// git 저장소가 아니거나 리모트가 없으면 `None`.
pub fn local_only(root: &Path) -> Option<LocalOnly> {
    let repo = primary_repo(root)?;
    if run_git(&repo, &["remote"]).ok()?.trim().is_empty() {
        return None;
    }
    let changes = uncommitted_changes(root);
    // 커밋이 하나도 없는 저장소는 `HEAD` 가 없어 실패한다 — 올릴 커밋도 없다.
    let unpushed = run_git(
        &repo,
        &["rev-list", "--count", "HEAD", "--not", "--remotes"],
    )
    .ok()
    .and_then(|s| s.trim().parse().ok())
    .unwrap_or(0);
    Some(LocalOnly {
        uncommitted: changes.len() as u32,
        records: changes.iter().filter(|c| is_record(&c.path)).count() as u32,
        unpushed,
    })
}

#[cfg(test)]
#[path = "local_only_tests.rs"]
mod tests;

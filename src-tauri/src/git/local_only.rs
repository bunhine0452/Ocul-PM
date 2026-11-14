//! 「이 기기에만 있는 것」 (2026-11-13, 플랜 `two-machines-20261113`).
//!
//! 같은 저장소를 두 기기에서 번갈아 쓰면, 한쪽에서 일하고 올리지 않은 것은 다른 쪽에 없다 — 코드만이
//! 아니라 일지와 계획도 그렇다. 올리지 않은 일지는 다른 기기의 Claude 에게 없는 일이고, 그 Claude 는
//! 옛 계획 상태로 시작한다. 오늘 화면이 그것을 한 줄로 말한다.
//!
//! 세는 것은 셋이다: 커밋 안 한 변경(그중 기록이 몇인지), 어느 리모트에도 없는 커밋, 그 커밋들이 바꾼 기록.
//! 커밋은 **마지막으로 받아 온 리모트 가지**와 견준다 — 받아 오지(fetch) 않는다. git 은 읽기만 · 네트워크 0.
//! 리모트가 없는 저장소는 올릴 곳이 없으니 아무 말도 하지 않는다(`None`).

use std::collections::HashSet;
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
    /// 그 커밋들이 바꾼 기록 파일 — 커밋 안 한 기록(`records`)과 같은 파일은 뺀다. 둘을 더하면 다른 기기에
    /// 없는 일지 · 계획 파일 수다(11-15). 일지를 커밋하고 아직 올리지 않은 흔한 상태를 `records` 만으로는 놓쳤다.
    pub unpushed_records: u32,
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
    let records: HashSet<&str> = changes
        .iter()
        .map(|c| c.path.as_str())
        .filter(|p| is_record(p))
        .collect();
    // 커밋이 하나도 없는 저장소는 `HEAD` 가 없어 실패한다 — 올릴 커밋도 없다.
    let unpushed = run_git(
        &repo,
        &["rev-list", "--count", "HEAD", "--not", "--remotes"],
    )
    .ok()
    .and_then(|s| s.trim().parse().ok())
    .unwrap_or(0);
    // 다 올렸으면 git 을 한 번 덜 띄운다 — 오늘 화면이 일지 · 계획 사건과 창 복귀마다 부른다.
    let unpushed_records = if unpushed == 0 {
        0
    } else {
        unpushed_records(root, &records)
    };
    Some(LocalOnly {
        uncommitted: changes.len() as u32,
        records: records.len() as u32,
        unpushed,
        unpushed_records,
    })
}

/// 어느 리모트에도 없는 커밋이 바꾼 기록 파일 수 — `skip`(커밋 안 한 기록, 이미 셌다)은 뺀다.
///
/// 저장소가 아니라 **프로젝트 루트**에서 `--relative` 로 돌린다 — 프로젝트가 저장소의 하위 폴더여도 경로가
/// `is_record` · `uncommitted_changes` 와 같은 기준(프로젝트 루트)이다. `.oculpm/` 이 저장소 밖에 있으면(중첩
/// 저장소) git 이 실패하고, 못 읽은 것은 0 이다 — 모름을 「있다」로 말하지 않는다.
fn unpushed_records(root: &Path, skip: &HashSet<&str>) -> u32 {
    // `log` 가 맨 앞이어야 `safe::cmd` 가 외부 diff 를 끈다. `--no-renames` — 이름만 볼 것이라 내용을 견주지
    // 않는다(부분 클론에서 아직 안 받은 옛 객체를 읽지 않는다). `--no-show-signature` — 서명 검사 프로그램을
    // 띄우지 않는다(사용자 전역 `log.showSignature`).
    let Ok(out) = run_git(
        root,
        &[
            "log",
            "--format=",
            "--name-only",
            "--no-renames",
            "--no-show-signature",
            "--relative",
            "HEAD",
            "--not",
            "--remotes",
            "--",
            ".oculpm/journal",
            ".oculpm/planner",
        ],
    ) else {
        return 0;
    };
    out.lines()
        .map(str::trim)
        .filter(|p| is_record(p) && !skip.contains(p))
        .collect::<HashSet<_>>()
        .len() as u32
}

#[cfg(test)]
#[path = "local_only_tests.rs"]
mod tests;

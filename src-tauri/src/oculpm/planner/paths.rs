//! 플래너 경로 도우미 — `project.rs` 에서 갈라 나왔다 (best-results UI 라운드,
//! `project.rs` 가 래칫 800줄에 걸려서). 호출부는 `project::{planner_dir, …}` 재수출로
//! 그대로다.

use std::path::{Path, PathBuf};

use crate::oculpm::planner::log_archive as archive;
use crate::oculpm::planner::parse::parse_plan;

/// `<project_root>/.oculpm/planner`.
pub fn planner_dir(project_root: &Path) -> PathBuf {
    project_root.join(".oculpm").join("planner")
}

/// Locate the plan file whose frontmatter `id` equals `plan_id` (the filename
/// may differ from the id). `None` if no file matches.
pub fn find_plan_path(planner_root: &Path, plan_id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(planner_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !archive::is_plan_path(&path) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        if parse_plan(&text, stem).frontmatter.id == plan_id {
            return Some(path);
        }
    }
    None
}

/// 제목 → 플랜 파일 이름. 한글도 살아남는다 — 구현과 근거는
/// [`crate::oculpm::frontmatter::slug_from_title`] 한 곳에 있다.
pub fn slug_for(title: &str) -> String {
    crate::oculpm::frontmatter::slug_from_title(title, "plan")
}

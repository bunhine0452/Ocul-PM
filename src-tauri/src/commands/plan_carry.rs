//! 닫힌 플랜의 미완 받은함 — `plan_locked_open` (완성도 라운드 2026-10-27).
//!
//! `plan.rs` 가 래칫 800줄에 걸려 따로 산다. 읽기 전용이고 잠긴 플랜을 절대 고치지
//! 않는다 — 옮기기는 프런트가 활성 플랜에 `plan_apply_edit(AddItem)` 으로 한다.

use std::collections::HashSet;
use std::path::Path;

use tauri::State;

use crate::db::Db;
use crate::oculpm::planner::parse::parse_plan;

use super::plan::planner_root_of;

/// 닫힌(done/archived) 플랜에 남은 미완 항목 하나 — 플래너 「닫힌 플랜의 미완」 받은함.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct LockedOpenItem {
    pub plan_id: String,
    pub plan_title: String,
    /// `done` | `archived`
    pub plan_status: String,
    pub item_id: String,
    pub title: String,
    /// `todo` | `in_progress` | `blocked`
    pub status: String,
}

/// 닫힌 플랜에 갇힌 미완 항목들 ({#archived-open-items-visibility}, 2026-10-27 실측 20개
/// 플랜에 63건). MCP `plan_status` 는 `locked_open` 으로 세어 주지만 화면에는 없었다.
/// 이미 활성 플랜으로 옮긴 것(`carry-<item_id>` 항목이 있는 것)은 뺀다 — 옮기기는
/// 원본을 고치지 않으므로(잠긴 플랜은 불변) 이 제외가 「처리됨」의 유일한 표식이다.
#[tauri::command]
#[specta::specta]
pub async fn plan_locked_open(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<LockedOpenItem>, String> {
    let root = planner_root_of(&db, project_id).await?;
    Ok(locked_open_in(&root))
}

pub fn locked_open_in(planner_root: &Path) -> Vec<LockedOpenItem> {
    let Ok(rd) = std::fs::read_dir(planner_root) else {
        return Vec::new();
    };
    let mut locked: Vec<(crate::oculpm::planner::parse::ParsedPlan, String)> = Vec::new();
    let mut active_ids: HashSet<String> = HashSet::new();
    for entry in rd.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.ends_with(".md") || name.ends_with(".log.md") {
            continue;
        }
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = name.trim_end_matches(".md");
        let parsed = parse_plan(&md, stem);
        let status = parsed.frontmatter.status.as_str().to_string();
        if status == "active" {
            active_ids.extend(parsed.items.iter().map(|i| i.item_id.clone()));
        } else {
            locked.push((parsed, status));
        }
    }
    let mut out = Vec::new();
    for (parsed, status) in locked {
        for leaf in crate::oculpm::planner::lifecycle::open_leaves(&parsed) {
            if active_ids.contains(&format!("carry-{}", leaf.item_id)) {
                continue;
            }
            out.push(LockedOpenItem {
                plan_id: parsed.frontmatter.id.clone(),
                plan_title: parsed.frontmatter.title.clone(),
                plan_status: status.clone(),
                item_id: leaf.item_id,
                title: leaf.title,
                status: leaf.status.as_str().to_string(),
            });
        }
    }
    // 최근에 닫힌 플랜이 위로 — 파일명이 곧 라운드 날짜인 경우가 많다.
    out.sort_by(|a, b| b.plan_id.cmp(&a.plan_id).then(a.item_id.cmp(&b.item_id)));
    out
}

#[cfg(test)]
mod locked_open_tests {
    use super::locked_open_in;

    fn plan(dir: &std::path::Path, id: &str, status: &str, body: &str) {
        std::fs::write(
            dir.join(format!("{id}.md")),
            format!("---\noculpm_plan: v1\nid: {id}\ntitle: \"{id} 제목\"\nstatus: {status}\ncreated: 2026-10-01\nupdated: 2026-10-01\nowner: claude-code\n---\n\n## 단계 {{#p1}}\n{body}\n"),
        )
        .unwrap();
    }

    #[test]
    fn open_leaves_of_closed_plans_minus_the_ones_already_carried() {
        let dir = tempfile::tempdir().unwrap();
        plan(
            dir.path(),
            "old-round",
            "archived",
            "- [ ] 남은 것 {#left}\n- [x] 끝난 것 {#done}\n- [~] 하다 만 것 {#half}",
        );
        plan(dir.path(), "done-round", "done", "- [ ] 옮겨진 것 {#moved}");
        plan(
            dir.path(),
            "live",
            "active",
            "- [ ] 옮겨진 것 (← done-round #moved) {#carry-moved}\n- [ ] 새 일 {#new}",
        );
        std::fs::write(
            dir.path().join("old-round.log.md"),
            "- [ ] 로그 보관함은 플랜이 아니다 {#ghost}",
        )
        .unwrap();
        let out = locked_open_in(dir.path());
        let ids: Vec<(String, String, String)> = out
            .iter()
            .map(|i| (i.plan_id.clone(), i.item_id.clone(), i.status.clone()))
            .collect();
        assert_eq!(
            ids,
            [
                ("old-round".into(), "half".into(), "in_progress".into()),
                ("old-round".into(), "left".into(), "todo".into()),
            ]
        );
        assert_eq!(out[0].plan_title, "old-round 제목");
        assert_eq!(out[0].plan_status, "archived");
    }
}

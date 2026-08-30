//! One-time migration: legacy SQLite `goals`/`subtasks` → a single
//! `_imported.md` Plan (PR-PLN 5). Each goal becomes a Phase, each subtask an
//! item; a goal with no subtasks becomes one item. Pure markdown build (tested
//! via a parse round-trip); the command reads the DB and writes the file.

#![allow(dead_code)]

use crate::oculpm::planner::parse::ItemStatus;
use crate::oculpm::planner::plan_edit::{add_item, create_plan_skeleton};

pub const IMPORTED_PLAN_ID: &str = "_imported";

pub struct ImportSubtask {
    pub title: String,
    pub done: bool,
}

pub struct ImportGoal {
    pub title: String,
    pub status: String,
    pub progress: f64,
    pub subtasks: Vec<ImportSubtask>,
}

pub fn build_imported_md(goals: &[ImportGoal], date: &str) -> String {
    let mut md = create_plan_skeleton(IMPORTED_PLAN_ID, "가져온 목표 (legacy)", "user", date);
    for (gi, g) in goals.iter().enumerate() {
        let phase = clean_phase(&g.title, gi);
        if g.subtasks.is_empty() {
            let st = goal_status(g);
            md = match add_item(&md, &phase, &g.title, &format!("g{gi}"), st) {
                Ok(next) => next,
                Err(_) => md,
            };
        } else {
            for (si, s) in g.subtasks.iter().enumerate() {
                let st = if s.done {
                    ItemStatus::Done
                } else {
                    ItemStatus::Todo
                };
                md = match add_item(&md, &phase, &s.title, &format!("g{gi}-s{si}"), st) {
                    Ok(next) => next,
                    Err(_) => md,
                };
            }
        }
    }
    md
}

fn goal_status(g: &ImportGoal) -> ItemStatus {
    if g.status == "done" || g.progress >= 1.0 {
        ItemStatus::Done
    } else if g.status == "in_progress" || g.progress > 0.0 {
        ItemStatus::InProgress
    } else {
        ItemStatus::Todo
    }
}

/// A `## ` heading can't span lines; collapse whitespace, fall back to an index.
fn clean_phase(title: &str, idx: usize) -> String {
    let t = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        format!("목표 {}", idx + 1)
    } else {
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::planner::parse::parse_plan;

    #[test]
    fn imports_goals_and_subtasks_round_trips() {
        let goals = vec![
            ImportGoal {
                title: "롤오버 안정화".into(),
                status: "in_progress".into(),
                progress: 0.5,
                subtasks: vec![
                    ImportSubtask {
                        title: "타임존 계산".into(),
                        done: true,
                    },
                    ImportSubtask {
                        title: "DST 처리".into(),
                        done: false,
                    },
                ],
            },
            ImportGoal {
                title: "문서화".into(),
                status: "open".into(),
                progress: 0.0,
                subtasks: vec![],
            },
        ];
        let md = build_imported_md(&goals, "2026-06-07");
        let p = parse_plan(&md, "_imported");
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        assert_eq!(p.frontmatter.id, "_imported");
        assert_eq!(p.items.len(), 3);

        let tz = p.items.iter().find(|i| i.item_id == "g0-s0").unwrap();
        assert_eq!(tz.title, "타임존 계산");
        assert_eq!(tz.status, ItemStatus::Done);
        assert_eq!(tz.phase.as_deref(), Some("롤오버 안정화"));

        let dst = p.items.iter().find(|i| i.item_id == "g0-s1").unwrap();
        assert_eq!(dst.status, ItemStatus::Todo);

        // goal with no subtasks → single item, status from goal
        let doc = p.items.iter().find(|i| i.item_id == "g1").unwrap();
        assert_eq!(doc.title, "문서화");
        assert_eq!(doc.status, ItemStatus::Todo);
        assert_eq!(doc.phase.as_deref(), Some("문서화"));
    }

    #[test]
    fn goal_only_done_when_progress_full() {
        let goals = vec![ImportGoal {
            title: "완료된 목표".into(),
            status: "done".into(),
            progress: 1.0,
            subtasks: vec![],
        }];
        let p = parse_plan(&build_imported_md(&goals, "2026-06-07"), "_imported");
        assert_eq!(p.items[0].status, ItemStatus::Done);
    }
}

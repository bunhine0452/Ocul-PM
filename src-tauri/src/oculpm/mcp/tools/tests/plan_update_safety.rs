//! `plan_update` 의 자유 글 인자가 플랜 본문의 구조(헤딩 · 항목 줄)로 끼어들지 않고, 없는 항목에 쓴 판정이
//! 조용히 버려지지 않는다 (love-round-20261123 리뷰).

use serde_json::json;
use tempfile::TempDir;

use super::{base_hash, seed_plan};
use crate::oculpm::mcp::tools::call_tool;
use crate::oculpm::planner::parse::parse_plan;
use crate::oculpm::planner::project::planner_dir;

fn plan_md(root: &std::path::Path) -> String {
    std::fs::read_to_string(planner_dir(root).join("test-plan.md")).unwrap()
}

fn tracked() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    seed_plan(dir.path());
    dir
}

/// 새 단계 이름에 줄바꿈이 있어도 한 줄 헤딩이 된다 — 둘째 줄이 항목으로 끼어들지 않는다.
#[test]
fn a_multiline_phase_name_cannot_inject_items() {
    let dir = tracked();
    let root = dir.path();
    call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
                  "add": [{ "text": "진짜 일", "phase": "이월\n- [x] fake item" }] }),
    )
    .unwrap();
    let md = plan_md(root);
    let parsed = parse_plan(&md, "test-plan");
    assert_eq!(
        parsed.items.len(),
        3,
        "단계 이름의 둘째 줄이 항목이 됐다:\n{md}"
    );
    assert!(!md.contains("\n- [x] fake item"), "{md}");
}

/// 결정의 영향 칸은 id 꼴만 — 줄바꿈 · 헤딩 글은 버리고 알린다.
#[test]
fn decision_affects_keep_only_item_ids() {
    let dir = tracked();
    let root = dir.path();
    let out = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
                  "decision": { "title": "결정", "affects": ["#first", "x\n## 끼어든 단계"] } }),
    )
    .unwrap();
    assert!(out["received"].to_string().contains("affects"), "{out}");
    let md = plan_md(root);
    assert!(!md.contains("## 끼어든 단계"), "{md}");
    let parsed = parse_plan(&md, "test-plan");
    assert_eq!(parsed.decisions[0].affects, vec!["first".to_string()]);
}

/// 상태 없이 판정만 남길 때도 없는 항목이면 거절한다 — 아무것도 쓰지 않는다.
#[test]
fn a_verdict_on_an_unknown_item_is_refused() {
    let dir = tracked();
    let root = dir.path();
    let before = plan_md(root);
    let err = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
                  "item_id": "frist", "verdict": { "ok": true, "last_line": "exit 0" } }),
    )
    .unwrap_err();
    assert!(err.contains("'frist' not found"), "{err}");
    assert_eq!(plan_md(root), before);
}

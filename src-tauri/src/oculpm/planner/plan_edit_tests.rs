//! `plan_edit.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다.

use super::*;

use crate::oculpm::planner::parse::parse_plan;

#[test]
fn skeleton_parses_clean() {
    let md = create_plan_skeleton("my-plan", "내 계획", "user", "2026-06-07");
    let p = parse_plan(&md, "my-plan");
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    assert_eq!(p.frontmatter.id, "my-plan");
    assert_eq!(p.frontmatter.title, "내 계획");
    assert_eq!(p.frontmatter.owner, "user");
    assert_eq!(p.items.len(), 0);
    assert_eq!(p.updates.len(), 0);
}

#[test]
fn full_write_round_trip() {
    // skeleton → add two items → flip one → log each → parse back.
    let md = create_plan_skeleton("p", "계획", "user", "2026-06-07");

    let md = add_item(&md, "Phase A", "첫 항목", "one", ItemStatus::Todo).unwrap();
    let md = append_log_row(
        &md,
        &LogRow {
            ts: "2026-06-07T10:00:00Z".into(),
            item_id: "one".into(),
            agent_id: "user".into(),
            from: None,
            to: Some(ItemStatus::Todo),
            journal_ref: None,
            note: Some("created".into()),
        },
    );

    let md = add_item(&md, "Phase A", "둘째 항목", "two", ItemStatus::Todo).unwrap();

    // flip #one → done
    let res = set_item_status(&md, "one", ItemStatus::Done).unwrap();
    assert_eq!(res.old_status, ItemStatus::Todo);
    let md = append_log_row(
        &res.md,
        &LogRow {
            ts: "2026-06-07T11:00:00Z".into(),
            item_id: "one".into(),
            agent_id: "inapp:anthropic".into(),
            from: Some(ItemStatus::Todo),
            to: Some(ItemStatus::Done),
            journal_ref: Some("journal/x.md".into()),
            note: None,
        },
    );

    // Parse the final document back.
    let p = parse_plan(&md, "p");
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    assert_eq!(p.items.len(), 2);
    let one = p.items.iter().find(|i| i.item_id == "one").unwrap();
    assert_eq!(one.status, ItemStatus::Done);
    assert_eq!(one.phase.as_deref(), Some("Phase A"));
    let two = p.items.iter().find(|i| i.item_id == "two").unwrap();
    assert_eq!(two.status, ItemStatus::Todo);

    // both items under the same phase
    assert_eq!(one.phase, two.phase);

    // log: 2 rows, latest for #one is the done transition by inapp:anthropic
    let one_updates: Vec<_> = p.updates.iter().filter(|u| u.item_id == "one").collect();
    assert_eq!(one_updates.len(), 2);
    let last = one_updates.last().unwrap();
    assert_eq!(last.agent_id, "inapp:anthropic");
    assert_eq!(last.from_status.as_deref(), Some("todo"));
    assert_eq!(last.to_status.as_deref(), Some("done"));
    assert_eq!(last.journal_ref.as_deref(), Some("journal/x.md"));
}

// 플랜 레벨 status 전이 테스트는 `planner/lifecycle.rs` 로 함께 옮겼다.

#[test]
fn set_status_missing_item_errors() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let err = set_item_status(&md, "ghost", ItemStatus::Done).unwrap_err();
    assert!(err.contains("not found"));
}

#[test]
fn add_item_duplicate_id_errors() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "P", "a", "dup", ItemStatus::Todo).unwrap();
    let err = add_item(&md, "P", "b", "dup", ItemStatus::Todo).unwrap_err();
    assert!(err.contains("already exists"));
}

#[test]
fn add_item_new_phase_then_existing_phase() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase A", "a2", "a2", ItemStatus::Todo).unwrap();
    let p = parse_plan(&md, "p");
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    let a1 = p.items.iter().find(|i| i.item_id == "a1").unwrap();
    let a2 = p.items.iter().find(|i| i.item_id == "a2").unwrap();
    let b1 = p.items.iter().find(|i| i.item_id == "b1").unwrap();
    assert_eq!(a1.phase.as_deref(), Some("Phase A"));
    assert_eq!(a2.phase.as_deref(), Some("Phase A"));
    assert_eq!(b1.phase.as_deref(), Some("Phase B"));
}

#[test]
fn preserves_unrelated_content() {
    let md = "---\nid: p\ntitle: \"t\"\n---\n## Phase A\n- [ ] keep me {#keep}\n\n사용자 메모: 보존되어야 함\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
    let res = set_item_status(md, "keep", ItemStatus::Done).unwrap();
    assert!(res.md.contains("사용자 메모: 보존되어야 함"));
    assert!(res.md.contains("- [x] keep me {#keep}"));
}

#[test]
fn set_plan_title_changes_title_and_bumps_updated() {
    let md = create_plan_skeleton("p", "옛 제목", "user", "2026-06-01");
    let out = set_plan_title(&md, "새 제목", "2026-06-15");
    let p = parse_plan(&out, "p");
    assert_eq!(p.frontmatter.title, "새 제목");
    assert_eq!(p.frontmatter.updated.as_deref(), Some("2026-06-15"));
}

/// E2 — 항목 이동: 다른 단계 끝으로 · 다른 항목 앞으로 · 하위 동반 · 거절.
#[test]
fn move_item_between_phases_and_before_siblings() {
    let md = "## A\n- [ ] one {#a1}\n  - [ ] one-child {#a1c}\n- [ ] two {#a2}\n\n## B\n- [ ] three {#b1}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
    // 단계 B 끝으로 — 하위가 따라가고 들여쓰기는 최상위.
    let out = move_item(md, "a1", Some("B"), None).unwrap();
    assert_eq!(
        out,
        "## A\n- [ ] two {#a2}\n\n## B\n- [ ] three {#b1}\n- [ ] one {#a1}\n  - [ ] one-child {#a1c}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n"
    );
    // b1 앞으로.
    let out = move_item(md, "a2", None, Some("b1")).unwrap();
    assert!(out.contains("## B\n- [ ] two {#a2}\n- [ ] three {#b1}"));
    assert!(!out.contains("- [ ] two {#a2}\n\n## B"));
    // 자기 하위 앞으로는 거절, 없는 항목·단계도 거절.
    assert!(move_item(md, "a1", None, Some("a1c")).is_err());
    assert!(move_item(md, "ghost", Some("B"), None).is_err());
    assert!(move_item(md, "a1", Some("Z"), None).is_err());
    assert!(move_item(md, "a1", None, None).is_err());
}

#[test]
fn remove_item_drops_the_line() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "P", "a", "a1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "P", "b", "b1", ItemStatus::Todo).unwrap();
    let out = remove_item(&md, "a1").unwrap();
    let p = parse_plan(&out, "p");
    assert_eq!(p.items.len(), 1);
    assert_eq!(p.items[0].item_id, "b1");
    assert!(remove_item(&out, "ghost").is_err());
}

#[test]
fn rename_item_keeps_status_and_marker() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "P", "옛 항목", "x", ItemStatus::Done).unwrap();
    let out = rename_item(&md, "x", "새 항목").unwrap();
    let p = parse_plan(&out, "p");
    let it = p.items.iter().find(|i| i.item_id == "x").unwrap();
    assert_eq!(it.title, "새 항목");
    assert_eq!(it.status, ItemStatus::Done);
}

#[test]
fn rename_phase_keeps_items_and_id() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
    let out = rename_phase(&md, "Phase A", "Phase A — 캐시 안정화").unwrap();
    let p = parse_plan(&out, "p");
    assert!(p.phases.iter().any(|ph| ph.name == "Phase A — 캐시 안정화"));
    let a1 = p.items.iter().find(|i| i.item_id == "a1").unwrap();
    assert_eq!(a1.phase.as_deref(), Some("Phase A — 캐시 안정화"));
    // empty title + missing phase both error.
    assert!(rename_phase(&out, "Phase B", "  ").is_err());
    assert!(rename_phase(&out, "ghost", "x").is_err());
}

#[test]
fn rename_phase_preserves_brace_id() {
    let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n## 옛 단계 {#ph1}\n- [ ] a {#a}\n";
    let out = rename_phase(md, "옛 단계", "새 단계").unwrap();
    assert!(out.contains("## 새 단계 {#ph1}"), "{out}");
    let p = parse_plan(&out, "p");
    let ph = p.phases.iter().find(|ph| ph.name == "새 단계").unwrap();
    assert_eq!(ph.id.as_deref(), Some("ph1"));
}

#[test]
fn remove_phase_drops_heading_and_items() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
    let out = remove_phase(&md, "Phase A").unwrap();
    let p = parse_plan(&out, "p");
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    assert!(!p.phases.iter().any(|ph| ph.name == "Phase A"));
    assert!(p.phases.iter().any(|ph| ph.name == "Phase B"));
    assert!(p.items.iter().all(|i| i.item_id != "a1"));
    assert!(p.items.iter().any(|i| i.item_id == "b1"));
    assert!(remove_phase(&out, "ghost").is_err());
}

#[test]
fn move_phase_swaps_adjacent_and_no_ops_at_edges() {
    let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
    let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
    let md = add_item(&md, "Phase C", "c1", "c1", ItemStatus::Todo).unwrap();

    let names = |m: &str| -> Vec<String> {
        parse_plan(m, "p")
            .phases
            .into_iter()
            .map(|p| p.name)
            .collect()
    };

    let up = move_phase(&md, "Phase B", true).unwrap();
    assert_eq!(names(&up), vec!["Phase B", "Phase A", "Phase C"]);
    // items still belong to their (now reordered) phases.
    let p = parse_plan(&up, "p");
    assert_eq!(
        p.items
            .iter()
            .find(|i| i.item_id == "a1")
            .unwrap()
            .phase
            .as_deref(),
        Some("Phase A")
    );

    let down = move_phase(&up, "Phase A", false).unwrap();
    assert_eq!(names(&down), vec!["Phase B", "Phase C", "Phase A"]);

    // boundary no-ops return the document unchanged.
    assert_eq!(move_phase(&down, "Phase B", true).unwrap(), down);
    assert_eq!(move_phase(&down, "Phase A", false).unwrap(), down);
    assert!(move_phase(&down, "ghost", true).is_err());
}

#[test]
fn move_phase_leaves_decisions_in_place() {
    let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n## Phase A\n- [ ] a {#a}\n\n## Phase B\n- [ ] b {#b}\n\n## 결정 (Decisions)\n### Decision X {#dx}\n본문\n";
    let out = move_phase(md, "Phase B", false).unwrap(); // B is last phase → no-op
    assert_eq!(out, md);
    let up = move_phase(md, "Phase B", true).unwrap();
    let p = parse_plan(&up, "p");
    assert_eq!(
        p.phases
            .iter()
            .map(|ph| ph.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Phase B", "Phase A"]
    );
    // decisions survived intact.
    assert!(up.contains("## 결정 (Decisions)"));
    assert_eq!(p.decisions.len(), 1);
}

// ─── 3-depth (#plan-3depth) ─────────────────────────────────────────────

const NESTED: &str = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [ ] 부모 {#parent}\n  - [ ] 하나 {#c1}\n  - [ ] 둘 {#c2}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";

/// 자식 변경이 부모 글리프를 롤업으로 정규화한다 (파일과 파생값의 일치).
#[test]
fn rolled_set_normalizes_parent_glyph() {
    let r1 = set_item_status_rolled(NESTED, "c1", ItemStatus::Done).unwrap();
    assert!(r1.md.contains("- [~] 부모 {#parent}"), "{}", r1.md);
    let r2 = set_item_status_rolled(&r1.md, "c2", ItemStatus::Done).unwrap();
    assert!(r2.md.contains("- [x] 부모 {#parent}"), "{}", r2.md);
    assert!(r2.md.contains("  - [x] 하나 {#c1}"));
}

/// 리뷰 M1 — dedup 된 부모 id(`x`→`x-2`)로 정규화하면 원래 `{#x-2}` 를
/// 달고 있던 방관자 항목을 덮어쓸 수 있다: 원문 항목 줄이 유일할 때만
/// 정규화하고, 모호하면 건드리지 않는다 (파생값은 파서가 계속 보장).
#[test]
fn rolled_set_skips_normalization_on_ambiguous_parent_id() {
    let md = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [ ] one {#x}\n- [ ] two {#x}\n  - [ ] kid {#k}\n- [ ] bystander {#x-2}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
    let r = set_item_status_rolled(md, "k", ItemStatus::Done).unwrap();
    assert!(
        r.md.contains("- [ ] bystander {#x-2}"),
        "방관자 불가침: {}",
        r.md
    );
    assert!(r.md.contains("  - [x] kid {#k}"));
}

/// 리뷰 M2 — 최상위 부모 삭제 시 하위가 직전 항목에 위치상 입양돼 그
/// 항목이 파생·잠금 상태가 되던 문제: 하위를 최상위로 승격해 보존한다.
#[test]
fn remove_parent_promotes_children_to_top_level() {
    let md = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [x] prev {#prev}\n- [ ] gone {#gone}\n  - [ ] a {#a}\n  - [x] b {#b}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
    let out = remove_item(md, "gone").unwrap();
    assert!(out.contains("\n- [ ] a {#a}"), "승격: {out}");
    assert!(out.contains("\n- [x] b {#b}"));
    let parsed = crate::oculpm::planner::parse::parse_plan(&out, "n");
    let prev = parsed.items.iter().find(|i| i.item_id == "prev").unwrap();
    assert_eq!(
        prev.status,
        ItemStatus::Done,
        "prev 가 입양으로 파생되면 안 됨"
    );
}

/// 부모 직접 설정은 거부 — 상태는 하위 롤업으로만 움직인다 (phase 와 동일).
#[test]
fn rolled_set_rejects_parent_with_children() {
    let err = set_item_status_rolled(NESTED, "parent", ItemStatus::Done).unwrap_err();
    assert!(err.contains("하위"), "{err}");
    // 중첩 없는 항목은 종전과 동일하게 동작.
    let flat = NESTED.replace("  - [ ] 하나 {#c1}\n  - [ ] 둘 {#c2}\n", "");
    let ok = set_item_status_rolled(&flat, "parent", ItemStatus::Done).unwrap();
    assert!(ok.md.contains("- [x] 부모 {#parent}"));
}

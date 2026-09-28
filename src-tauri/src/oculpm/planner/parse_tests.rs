//! `parse.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다 (`plan_edit_tests.rs` 와 같은 모양).

use super::*;

/// 공유 픽스처 — VS Code 확장(`extension/src/oculpm/*.test.ts`)이 같은
/// 파일을 읽어 자기 파서를 판정한다. 규격이 바뀌면 양쪽이 같이 붉어진다.
const SAMPLE: &str = include_str!("../../../tests/fixtures/plan_sample.md");

#[test]
fn parses_full_plan() {
    let p = parse_plan(SAMPLE, "from-filename");
    assert!(p.warnings.is_empty(), "warnings: {:?}", p.warnings);

    assert_eq!(p.frontmatter.id, "fastembed-stabilize");
    assert_eq!(p.frontmatter.title, "fastembed 안정화");
    assert_eq!(p.frontmatter.status, PlanStatus::Active);
    assert_eq!(p.frontmatter.owner, "claude-code");
    assert_eq!(p.frontmatter.created.as_deref(), Some("2026-06-07"));

    // 6 items total (incl. nested + Phase B).
    assert_eq!(p.items.len(), 6);

    let abs = &p.items[0];
    assert_eq!(abs.item_id, "abs-cache");
    assert_eq!(abs.status, ItemStatus::Done);
    assert_eq!(abs.title, "fastembed 캐시 절대경로 고정");
    assert_eq!(abs.phase.as_deref(), Some("Phase A — 캐시 경로 안정화"));
    assert!(abs.parent_item.is_none());

    let nested = p
        .items
        .iter()
        .find(|i| i.item_id == "fresh-machine")
        .unwrap();
    assert_eq!(nested.parent_item.as_deref(), Some("seed-verify"));

    let dl = p.items.iter().find(|i| i.item_id == "dl-ux").unwrap();
    assert_eq!(dl.status, ItemStatus::Blocked);
    assert_eq!(dl.note.as_deref(), Some("진행 UI 부재"));

    let bundle = p.items.iter().find(|i| i.item_id == "bundle").unwrap();
    assert_eq!(bundle.status, ItemStatus::Deferred);

    let searchscope = p
        .items
        .iter()
        .find(|i| i.item_id == "search-scopes")
        .unwrap();
    assert_eq!(searchscope.phase.as_deref(), Some("Phase B — 검색 품질"));
    assert_eq!(searchscope.status, ItemStatus::Todo);

    // Decision.
    assert_eq!(p.decisions.len(), 1);
    let d = &p.decisions[0];
    assert_eq!(d.decision_id, "d-cache-abs");
    assert!(d.title.starts_with("Decision A — 캐시는"));
    assert_eq!(d.locked_at.as_deref(), Some("2026-06-07"));
    assert_eq!(d.agent_id.as_deref(), Some("claude-code"));
    assert_eq!(d.affects, vec!["abs-cache", "seed-verify"]);
    assert!(d.body.contains("CWD"));

    // Update log.
    assert_eq!(p.updates.len(), 2);
    let u0 = &p.updates[0];
    assert_eq!(u0.item_id, "abs-cache");
    assert_eq!(u0.agent_id, "claude-code");
    assert_eq!(u0.from_status.as_deref(), Some("in_progress"));
    assert_eq!(u0.to_status.as_deref(), Some("done"));
    assert_eq!(
        u0.journal_ref.as_deref(),
        Some("journal/20260607/Bugs/0902_bug_onnx.md")
    );
    let u1 = &p.updates[1];
    assert_eq!(u1.agent_id, "user");
    assert_eq!(u1.from_status.as_deref(), Some("todo"));
    assert_eq!(u1.to_status.as_deref(), Some("in_progress"));
    assert!(u1.journal_ref.is_none());
}

#[test]
fn progress_rollup_counts_blocked_excludes_deferred_dropped() {
    let p = parse_plan(SAMPLE, "x");
    // 3-depth: seed-verify 는 부모(파생)라 제외 — 리프만 센다.
    // Countable leaves: abs-cache(done=1) fresh-machine(todo=0)
    // search-scopes(todo=0) dl-ux(blocked=0). bundle(deferred) excluded.
    // (1 + 0 + 0 + 0) / 4 = 1/4 — 막힘은 분모에 남는다 (막힌 계획은 100% 가 아니다).
    assert!((p.progress() - 0.25).abs() < 1e-9, "got {}", p.progress());
}

/// 3-depth — 하위가 있는 부모의 상태는 롤업이 파일 글리프를 이긴다.
/// SAMPLE 의 seed-verify 는 `[~]` 이지만 유일한 하위가 todo 라 Todo 로 파생.
#[test]
fn parent_status_is_rolled_up_from_children() {
    let p = parse_plan(SAMPLE, "x");
    let parent = p.items.iter().find(|i| i.item_id == "seed-verify").unwrap();
    assert_eq!(
        parent.status,
        ItemStatus::Todo,
        "글리프 [~] 보다 롤업(하위 todo)이 정답"
    );
    let leaf = p
        .items
        .iter()
        .find(|i| i.item_id == "fresh-machine")
        .unwrap();
    assert_eq!(leaf.status, ItemStatus::Todo);
}

/// 리뷰 F7/L2 — 탭 들여쓰기도 중첩이고, `###` 헤딩은 입양을 끊는다.
#[test]
fn tab_indent_nests_and_subheading_breaks_adoption() {
    let md = "---\noculpm_plan: v1\nid: t\ntitle: \"t\"\nstatus: active\n---\n\n## P {#p}\n- [ ] a {#a}\n\t- [ ] tabbed {#tb}\n\n### 메모\n  - [ ] stray {#st}\n";
    let p = parse_plan(md, "t");
    let tb = p.items.iter().find(|i| i.item_id == "tb").unwrap();
    assert_eq!(tb.parent_item.as_deref(), Some("a"), "탭도 중첩");
    let st = p.items.iter().find(|i| i.item_id == "st").unwrap();
    assert_eq!(st.parent_item, None, "### 너머 입양 금지");
}

#[test]
fn rollup_status_covers_the_vocabulary() {
    use ItemStatus::*;
    assert_eq!(rollup_status(&[Done, Done]), Done);
    assert_eq!(rollup_status(&[Todo, Todo]), Todo);
    assert_eq!(rollup_status(&[Done, Todo]), InProgress);
    assert_eq!(rollup_status(&[Done, InProgress]), InProgress);
    assert_eq!(
        rollup_status(&[Done, Blocked, Todo]),
        Blocked,
        "blocked 최우선"
    );
    assert_eq!(rollup_status(&[Dropped, Dropped]), Dropped);
    assert_eq!(
        rollup_status(&[Done, Dropped]),
        Done,
        "dropped 는 모수 제외"
    );
    assert_eq!(rollup_status(&[Deferred, Deferred]), Deferred);
}

#[test]
fn phase_titled_with_the_word_decision_keeps_its_items() {
    // Regression (2026-07-30): `is_decisions_heading` was a substring test,
    // so this real heading from `.oculpm/planner/claude-integration.md`
    // opened the decisions section and silently dropped every item under
    // it — the plan reported 13 of its 20 items in the UI and in the MCP
    // `plan_status`, with nothing anywhere to indicate the loss.
    let md = "---\noculpm_plan: v1\nid: p\ntitle: \"t\"\nstatus: active\n---\n\
              ## Phase A — 기록의 결정론화 {#phase-a}\n\
              - [x] 훅 브리지 {#ci0}\n\
              - [ ] 실기기 확인 {#ci0-verify}\n\
              \n\
              ## 결정 (Decisions)\n\
              ### Decision A — 제목 {#d-a}\n\
              - 잠금 2026-07-30 · claude-code\n";
    let p = parse_plan(md, "p");

    assert_eq!(p.items.len(), 2, "items: {:?}", p.items);
    assert!(p
        .items
        .iter()
        .all(|i| i.phase.as_deref() == Some("Phase A — 기록의 결정론화")));
    // The genuine decisions heading still opens the decisions section.
    assert_eq!(p.decisions.len(), 1);
    assert_eq!(p.decisions[0].decision_id, "d-a");
    // ...and it must NOT have been registered as a phase.
    assert_eq!(p.phases.len(), 1);
    assert_eq!(p.phases[0].id.as_deref(), Some("phase-a"));
}

#[test]
fn decisions_heading_variants_still_open_the_decisions_section() {
    for heading in [
        "## 결정",
        "## 결정사항",
        "## Decisions",
        "## 결정 (Decisions)",
    ] {
        let md = format!(
            "---\noculpm_plan: v1\nid: p\ntitle: \"t\"\n---\n\
             ## Phase A\n- [ ] a {{#a}}\n\n{heading}\n### D — t {{#d}}\n본문\n"
        );
        let p = parse_plan(&md, "p");
        assert_eq!(
            p.decisions.len(),
            1,
            "heading {heading:?} → {:?}",
            p.decisions
        );
        assert_eq!(p.phases.len(), 1, "heading {heading:?} leaked into phases");
    }
}

#[test]
fn missing_id_falls_back_to_filename_quietly() {
    let md = "---\noculpm_plan: v1\ntitle: \"무제\"\n---\n## P\n- [ ] 무언가\n";
    let p = parse_plan(md, "my-file");
    assert_eq!(p.frontmatter.id, "my-file");
    // filename id + present title → no frontmatter warnings.
    assert!(
        !p.warnings
            .iter()
            .any(|w| w.contains("id missing") || w.contains("title missing")),
        "{:?}",
        p.warnings
    );
    // Item without {#id} → generated, warned.
    assert_eq!(p.items.len(), 1);
    assert!(p.warnings.iter().any(|w| w.contains("no {#id}")));
}

#[test]
fn title_falls_back_to_h1_without_warning() {
    // No frontmatter at all — just an H1 + phase + item (the real-world
    // shape an external agent produced).
    let md = "# Plan — Lean Autonomous Adelie\n\n## Phase 0 — 안전망 {#p0}\n- [ ] 분기 {#b}\n";
    let p = parse_plan(md, "autonomy-refactor");
    assert_eq!(p.frontmatter.id, "autonomy-refactor"); // filename
    assert_eq!(p.frontmatter.title, "Lean Autonomous Adelie"); // H1, "Plan — " stripped
                                                               // phase {#id} stripped from the display name
    assert_eq!(p.items[0].phase.as_deref(), Some("Phase 0 — 안전망"));
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
}

#[test]
fn wrapped_item_id_on_continuation_line_is_found() {
    let md =
        "# 테스트 계획\n\n## Phase 1\n- [ ] 긴 항목 설명 첫 줄\n      (둘째 줄 계속) {#wrap-id}\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.items.len(), 1);
    assert_eq!(p.items[0].item_id, "wrap-id");
    assert!(p.items[0].title.contains("둘째 줄 계속"));
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
}

/// 2026-08-30 감사 재현: "agent"·"시각" 이 든 데이터 행이 헤더로 오인돼
/// 사라지던 것. 헤더는 첫 셀이 시각이 아닌 행뿐이고, `\|` 는 글자다.
#[test]
fn log_rows_with_agent_or_sigak_in_cells_are_data_not_header() {
    let md = "## P\n- [x] a {#a}\n- [x] b {#b}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n| 2026-08-29T17:53:00+09:00 | #a | claude-code | →x | .oculpm/journal/20260829/Chores/1753_chore_agent-discipline-redesign-plan.md | 실측 기준선 |\n| 2026-08-14T20:11:34+09:00 | #b | claude-code | ☐→x | journal/20260814/Features_to_add/2011_feature_acp0.md | agent-client-protocol 2.0 · 시각 보정 a \\| b |\n<!-- oculpm:plan-log end -->\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.updates.len(), 2, "{:?}", p.updates);
    assert_eq!(p.updates[0].item_id, "a");
    assert_eq!(
        p.updates[0].journal_ref.as_deref(),
        Some(".oculpm/journal/20260829/Chores/1753_chore_agent-discipline-redesign-plan.md")
    );
    assert_eq!(
        p.updates[1].note.as_deref(),
        Some("agent-client-protocol 2.0 · 시각 보정 a | b"),
        "이스케이프된 파이프는 글자로 복원된다"
    );
}

#[test]
fn change_column_accepts_bracketed_glyphs() {
    // Agents writing `→[ ]` (created as todo) in the plan-log change cell.
    let md = "## P\n- [ ] x {#x}\n\n<!-- oculpm:plan-log begin v1 -->\n| ts | item | agent | change | journal | note |\n|---|---|---|---|---|---|\n| 2026-06-07T10:00:00+09:00 | #x | claude-code | →[ ] | | created |\n<!-- oculpm:plan-log end -->\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.updates.len(), 1);
    assert_eq!(p.updates[0].to_status.as_deref(), Some("todo"));
}

#[test]
fn phase_ids_are_captured_for_tracking() {
    let md = "# T\n## Phase 0 — 안전망 {#p0}\n- [x] a {#a}\n## Phase 1 {#p1}\n- [ ] b {#b}\n## Phase A\n- [ ] c {#c}\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.phases.len(), 3);
    assert_eq!(p.phases[0].id.as_deref(), Some("p0"));
    assert_eq!(p.phases[0].name, "Phase 0 — 안전망");
    assert_eq!(p.phases[1].id.as_deref(), Some("p1"));
    // phase without {#id} → grouping only
    assert!(p.phases[2].id.is_none());
    assert_eq!(p.phases[2].name, "Phase A");
    // items still group by phase name
    assert_eq!(p.items[0].phase.as_deref(), Some("Phase 0 — 안전망"));
}

#[test]
fn unknown_glyph_defaults_todo_with_warning() {
    let md = "---\nid: x\n---\n## P\n- [?] 이상한 글리프 {#weird}\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.items[0].status, ItemStatus::Todo);
    assert!(p.warnings.iter().any(|w| w.contains("unknown item glyph")));
}

#[test]
fn no_frontmatter_is_fail_soft() {
    let md = "## Phase A\n- [x] 일했음 {#did}\n";
    let p = parse_plan(md, "stem");
    assert_eq!(p.frontmatter.id, "stem");
    assert_eq!(p.items.len(), 1);
    assert_eq!(p.items[0].status, ItemStatus::Done);
}

#[test]
fn plain_bullets_are_not_items() {
    let md = "---\nid: x\n---\n## P\n- 그냥 텍스트 (체크박스 없음)\n- [x] 진짜 항목 {#real}\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.items.len(), 1);
    assert_eq!(p.items[0].item_id, "real");
}

#[test]
fn duplicate_ids_are_deduped() {
    let md = "---\nid: x\n---\n## P\n- [ ] a {#dup}\n- [ ] b {#dup}\n";
    let p = parse_plan(md, "x");
    assert_eq!(p.items[0].item_id, "dup");
    assert_eq!(p.items[1].item_id, "dup-2");
}

#[test]
fn empty_plan_progress_is_zero() {
    let p = parse_plan("---\nid: x\n---\n", "x");
    assert_eq!(p.items.len(), 0);
    assert_eq!(p.progress(), 0.0);
}

#[test]
fn fuzz_random_bytes_never_panic() {
    let mut state: u64 = 0x0123_4567_89ab_cdef;
    for _ in 0..256 {
        let mut buf = Vec::with_capacity(1024);
        for _ in 0..1024 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            buf.push((state >> 33) as u8);
        }
        let s = String::from_utf8_lossy(&buf);
        let _ = parse_plan(&s, "fuzz");
    }
}

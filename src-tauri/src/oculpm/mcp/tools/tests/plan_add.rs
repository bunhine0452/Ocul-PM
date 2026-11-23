//! `plan_update` 의 새 인자 — `add`(항목 더하기) · `decision`(결정 블록) · `verdict`/`note` 만(상태 그대로).
//! 모두 같은 계약(문지기 + base_hash CAS) 안에서 쓴다 (love-round-20261123 #mcp-plan-add-item).

use serde_json::json;
use tempfile::TempDir;

use super::{base_hash, seed_plan};
use crate::oculpm::mcp::tools::call_tool;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
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

/// 항목을 단계 끝에 더하고 plan-log 에 `→☐` 행을 남긴다. 파서가 경고 없이 읽고, 응답의 hash 로 다음
/// 갱신이 곧바로 통과한다.
#[test]
fn add_appends_items_to_a_phase_with_a_log_row() {
    let dir = tracked();
    let root = dir.path();
    let out = call_tool(
        root,
        "plan_update",
        &json!({
            "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
            "add": [
                { "text": "이월된 일 셋째", "phase": "Phase 1", "id": "carry-three" },
                { "text": "Windows smoke check", "phase": "p1" }
            ]
        }),
    )
    .unwrap();
    assert_eq!(out["added"][0]["id"], "carry-three", "{out}");
    assert_eq!(
        out["added"][1]["id"], "windows-smoke-check",
        "텍스트에서 지은 id: {out}"
    );
    let md = plan_md(root);
    let parsed = parse_plan(&md, "test-plan");
    assert!(parsed.warnings.is_empty(), "{:?}\n{md}", parsed.warnings);
    let ids: Vec<&str> = parsed.items.iter().map(|i| i.item_id.as_str()).collect();
    assert_eq!(
        ids,
        ["first", "second", "carry-three", "windows-smoke-check"]
    );
    assert_eq!(parsed.items[2].phase.as_deref(), Some("Phase 1"));
    assert!(md.contains("| #carry-three | claude-code | →☐ |"), "{md}");

    // 응답의 hash 가 다음 CAS 의 재료다.
    call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": out["hash"], "item_id": "carry-three", "status": "x" }),
    )
    .expect("직전 응답의 hash 와 글리프 상태가 통과해야 한다");
    assert!(plan_md(root).contains("- [x] 이월된 일 셋째 {#carry-three}"));
}

/// `parent` 를 주면 그 최상위 항목의 하위로 들어가고, 부모 글리프가 롤업으로 함께 맞춰진다.
#[test]
fn add_under_a_parent_nests_once_and_rolls_the_parent_up() {
    let dir = tracked();
    let root = dir.path();
    call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"), "item_id": "first", "status": "done" }),
    )
    .unwrap();
    call_tool(
        root,
        "plan_update",
        &json!({
            "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
            "add": { "text": "남은 하위", "parent": "#first", "id": "kid" }
        }),
    )
    .expect("객체 하나도 add 로 받는다");
    let md = plan_md(root);
    assert!(
        md.contains("- [ ] 첫 항목 {#first}\n  - [ ] 남은 하위 {#kid}\n"),
        "부모 [x] → 롤업 [ ]:\n{md}"
    );
    let parsed = parse_plan(&md, "test-plan");
    assert_eq!(
        parsed
            .items
            .iter()
            .find(|i| i.item_id == "kid")
            .unwrap()
            .parent_item
            .as_deref(),
        Some("first")
    );

    let err = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"), "add": [{ "text": "손주", "parent": "kid" }] }),
    )
    .unwrap_err();
    assert!(err.contains("one level"), "{err}");
}

/// **같은 base_hash 로 add 를 두 번 동시에** — 하나만 쓰이고 다른 하나는 CAS 로 거절된다. 둘 다 쓰이면
/// 나중 쪽이 앞의 항목을 덮어 하나가 사라진다 (파이썬으로 직접 고치던 시절의 사고 모양).
#[test]
fn two_concurrent_adds_with_one_hash_write_once_and_refuse_once() {
    let dir = tracked();
    let root = std::sync::Arc::new(dir.path().to_path_buf());
    let hash = base_hash(&root, "test-plan");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = ["left", "right"]
        .into_iter()
        .map(|id| {
            let (root, hash, barrier) = (root.clone(), hash.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                call_tool(
                    &root,
                    "plan_update",
                    &json!({ "plan_id": "test-plan", "base_hash": hash, "add": [{ "text": id, "id": id }] }),
                )
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let oks = results.iter().filter(|r| r.is_ok()).count();
    assert_eq!(oks, 1, "정확히 하나만 써야 한다: {results:?}");
    let err = results.iter().find_map(|r| r.as_ref().err()).unwrap();
    assert!(err.starts_with("write-conflict:"), "{err}");
    let md = plan_md(root.as_path());
    assert_eq!(
        usize::from(md.contains("{#left}")) + usize::from(md.contains("{#right}")),
        1,
        "{md}"
    );
}

/// 결정 블록 — `## 결정` 섹션을 만들고 그 아래 `### Decision 1 — …` 을 쓴다. plan-log 에도 한 줄.
#[test]
fn decision_locks_a_block_under_the_decisions_section() {
    let dir = tracked();
    let root = dir.path();
    let out = call_tool(
        root,
        "plan_update",
        &json!({
            "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
            "decision": { "title": "새 도구 대신 인자", "body": "계약이 둘이 되면 덜 지키는 쪽이 이긴다", "affects": ["first"] }
        }),
    )
    .unwrap();
    let id = out["decision"]["id"].as_str().unwrap().to_string();
    assert_eq!(id, "decision", "한글 제목은 `decision` 으로: {out}");
    let md = plan_md(root);
    let parsed = parse_plan(&md, "test-plan");
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    assert_eq!(parsed.items.len(), 2, "결정은 항목이 아니다");
    let d = &parsed.decisions[0];
    assert_eq!(d.title, "Decision 1 — 새 도구 대신 인자");
    assert_eq!(d.agent_id.as_deref(), Some("claude-code"));
    assert_eq!(d.affects, vec!["first".to_string()]);
    assert!(
        md.contains("| #decision | claude-code |  |  | 결정: 새 도구 대신 인자 |"),
        "{md}"
    );
}

/// 확인 명령만 돌린 경우 — 상태를 안 바꾸고 판정 한 줄만 남긴다 (항목 칸 `—`). 앱의 판정 읽기가 그 줄을
/// 「마지막 판정」으로 읽는다.
#[test]
fn a_verdict_alone_leaves_statuses_untouched_and_is_read_as_the_last_verdict() {
    let dir = tracked();
    let root = dir.path();
    let before = parse_plan(&plan_md(root), "test-plan");
    call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
                  "verdict": { "ok": false, "last_line": "2 failed,\n418 passed" } }),
    )
    .unwrap();
    let md = plan_md(root);
    let after = parse_plan(&md, "test-plan");
    let st = |p: &crate::oculpm::planner::parse::ParsedPlan| {
        p.items
            .iter()
            .map(|i| i.status)
            .collect::<Vec<ItemStatus>>()
    };
    assert_eq!(st(&before), st(&after), "상태는 그대로");
    let here = crate::oculpm::planner::judge::HERE;
    assert!(
        md.contains(&format!(
            "| — | claude-code |  |  | 판정 ✗ 2 failed, 418 passed · {here} |"
        )),
        "{md}"
    );
    let v =
        crate::oculpm::planner::judge::last_verdict(&after.updates).expect("판정이 읽혀야 한다");
    assert!(!v.passed);
    assert!(
        v.summary.starts_with("2 failed, 418 passed"),
        "{}",
        v.summary
    );

    // 항목을 함께 주면 그 항목에 — 상태는 역시 그대로.
    call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan"),
                  "item_id": "second", "verdict": { "ok": true, "last_line": "exit 0" } }),
    )
    .unwrap();
    assert!(plan_md(root).contains(&format!(
        "| #second | claude-code |  |  | 판정 ✓ exit 0 · {here} |"
    )));
}

/// 단계를 안 주면 마지막 단계에, 없는 단계 이름이면 새 단계에 — 둘 다 응답 `received` 로 알린다.
#[test]
fn phase_defaults_and_new_phases_are_announced() {
    let dir = tracked();
    let root = dir.path();
    let out = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "hash": base_hash(root, "test-plan"),
                  "add": [{ "text": "기본 자리" }, { "text": "새 자리", "phase": "이월" }] }),
    )
    .unwrap();
    let received = out["received"].to_string();
    assert!(
        received.contains("`hash` 를 `base_hash` 으로 받았어요"),
        "{received}"
    );
    assert!(received.contains("마지막 단계 「Phase 1」"), "{received}");
    assert!(
        received.contains("단계 「이월」 가 없어 새로"),
        "{received}"
    );
    let parsed = parse_plan(&plan_md(root), "test-plan");
    assert_eq!(parsed.items[2].phase.as_deref(), Some("Phase 1"));
    assert_eq!(
        parsed.items[2].item_id, "item-3",
        "한글뿐인 텍스트는 위치로"
    );
    assert_eq!(parsed.items[3].phase.as_deref(), Some("이월"));
}

/// 빠진 인자는 한 번에 전부 — 한 개씩 왕복하지 않는다. 아무것도 쓰지 않는다.
#[test]
fn missing_arguments_are_named_all_at_once() {
    let dir = tracked();
    let root = dir.path();
    let before = plan_md(root);
    let err = call_tool(root, "plan_update", &json!({ "item_id": "first" })).unwrap_err();
    for k in ["`plan_id`", "`base_hash`", "`status`"] {
        assert!(err.contains(k), "{k} 가 빠졌다: {err}");
    }
    assert!(err.contains("plan_status"), "base_hash 를 얻는 길: {err}");
    let err = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": base_hash(root, "test-plan") }),
    )
    .unwrap_err();
    assert!(err.contains("할 일이 없어요"), "{err}");
    let err = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": "test-plan", "base_hash": "x", "add": [{ "phase": "Phase 1" }] }),
    )
    .unwrap_err();
    assert!(err.contains("add[0].text"), "{err}");
    assert_eq!(plan_md(root), before);
}

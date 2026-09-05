//! `plan_*` — 상태 읽기·글리프 갱신·새 계획, 그리고 페이지네이션.

use super::{base_hash, seed_plan};
use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// Seed a plan with `n` todo items plus one done + one dropped, so the
/// summary/full split and paging have something to bite on.
fn seed_big_plan(root: &Path, id: &str, n: usize) {
    let dir = planner_dir(root);
    std::fs::create_dir_all(&dir).unwrap();
    let mut md = format!(
        "---\noculpm_plan: v1\nid: {id}\ntitle: \"큰 플랜\"\nstatus: active\n\
         created: 2026-07-30\nupdated: 2026-07-30\nowner: claude-code\n---\n\n## Phase 1 {{#p1}}\n"
    );
    for i in 0..n {
        md.push_str(&format!("- [ ] 항목 {i} {{#it-{i}}}\n"));
    }
    md.push_str("- [x] 끝난 항목 {#fin}\n- [-] 버린 항목 {#gone}\n");
    md.push_str("\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n");
    std::fs::write(dir.join(format!("{id}.md")), md).unwrap();
}

#[test]
fn plan_status_lists_active_items() {
    let dir = TempDir::new().unwrap();
    seed_plan(dir.path());
    let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    let plans = out["plans"].as_array().unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0]["id"], "test-plan");
    assert_eq!(plans[0]["progress"]["total"], 2);
    // 항목은 중첩 JSON 이 아니라 TSV 로 실린다 (실측 −37%).
    let tsv = out["items_tsv"].as_str().unwrap();
    let lines: Vec<&str> = tsv.lines().collect();
    assert_eq!(lines[0], "plan\titem\tst\tphase\ttitle\tparent");
    assert_eq!(lines.len(), 3, "헤더 + 항목 2개: {tsv}");
    assert_eq!(lines[1], "test-plan\tfirst\t \tPhase 1\t첫 항목\t");
    assert_eq!(lines[2], "test-plan\tsecond\t~\tPhase 1\t둘째 항목\t");
    assert_eq!(out["returned"], 2);
    assert_eq!(out["total"], 2);
    assert_eq!(out["more"], false);
}

#[test]
fn plan_status_legend_matches_the_on_disk_glyph_vocabulary() {
    // 와이어와 파일이 같은 어휘를 쓰게 한다 — 모델이 읽은 글자를 그대로
    // 파일에 쓰므로 번역 단계가 없다. 상태가 하나 늘면 이 테스트가 깨진다.
    let dir = TempDir::new().unwrap();
    seed_plan(dir.path());
    let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    let legend = out["legend"].as_str().unwrap();
    for st in [
        ItemStatus::Todo,
        ItemStatus::InProgress,
        ItemStatus::Done,
        ItemStatus::Blocked,
        ItemStatus::Deferred,
        ItemStatus::Dropped,
    ] {
        let tok = st.token();
        let shown = if tok == " " { "' '" } else { tok };
        assert!(
            legend.contains(&format!("{shown}={}", st.as_str())),
            "legend 에 {} 누락: {legend}",
            st.as_str()
        );
    }
}

#[test]
fn plan_status_summary_hides_terminal_items_and_full_shows_them() {
    let dir = TempDir::new().unwrap();
    seed_big_plan(dir.path(), "big", 3);

    let summary = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    assert_eq!(summary["total"], 3, "summary 는 done/dropped 제외");
    assert!(!summary["items_tsv"].as_str().unwrap().contains("끝난 항목"));
    assert!(summary["note"].as_str().unwrap().contains("view=\"full\""));

    let full = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "view": "full" }),
    )
    .unwrap();
    assert_eq!(full["total"], 5);
    assert!(full["items_tsv"].as_str().unwrap().contains("끝난 항목"));
    assert!(full.get("note").is_none());
    // 진척은 두 뷰에서 같다 — 필터는 표시만 줄이고 계산을 바꾸지 않는다.
    assert_eq!(
        summary["plans"][0]["progress"],
        full["plans"][0]["progress"]
    );
}

#[test]
fn plan_status_status_filter_overrides_the_view() {
    let dir = TempDir::new().unwrap();
    seed_big_plan(dir.path(), "big", 2);
    let out = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "status": ["done"] }),
    )
    .unwrap();
    assert_eq!(out["total"], 1);
    assert!(out["items_tsv"].as_str().unwrap().contains("끝난 항목"));

    let err = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "status": ["없는상태"] }),
    )
    .unwrap_err();
    assert!(err.contains("invalid status"), "{err}");
}

#[test]
fn plan_status_pages_by_item_id_cursor() {
    let dir = TempDir::new().unwrap();
    seed_big_plan(dir.path(), "big", 5);

    let p1 = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "limit": 2 }),
    )
    .unwrap();
    assert_eq!(p1["returned"], 2);
    assert_eq!(p1["total"], 5);
    assert_eq!(p1["more"], true);
    // cursor 는 오프셋이 아니라 항목 id — 필터가 달라져도 같은 자리를 가리킨다.
    let cursor = p1["next_cursor"].as_str().unwrap().to_string();
    assert_eq!(cursor, "it-2");

    let p2 = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "limit": 2, "cursor": cursor }),
    )
    .unwrap();
    assert_eq!(p2["returned"], 2);
    assert!(p2["items_tsv"].as_str().unwrap().contains("it-3"));
    assert!(!p2["items_tsv"].as_str().unwrap().contains("\tit-1\t"));

    let bad = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "cursor": "없는항목" }),
    )
    .unwrap_err();
    assert!(bad.contains("cursor"), "{bad}");
}

#[test]
fn plan_status_narrows_to_one_plan_and_errors_on_unknown() {
    let dir = TempDir::new().unwrap();
    seed_plan(dir.path());
    seed_big_plan(dir.path(), "other", 2);

    let out = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "plan_id": "other" }),
    )
    .unwrap();
    assert_eq!(out["plans"].as_array().unwrap().len(), 1);
    assert!(!out["items_tsv"].as_str().unwrap().contains("test-plan"));

    let err = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "plan_id": "nope" }),
    )
    .unwrap_err();
    assert!(err.contains("not found"), "{err}");
}

#[test]
fn plan_status_surfaces_parser_warnings() {
    // 망가진 플랜을 갱신하라고 시키면서 그 사실을 숨기지 않는다.
    let dir = TempDir::new().unwrap();
    let pdir = planner_dir(dir.path());
    std::fs::create_dir_all(&pdir).unwrap();
    std::fs::write(
        pdir.join("warn.md"),
        "---\noculpm_plan: v1\nid: warn\ntitle: \"경고 플랜\"\nstatus: active\n---\n\
         \n## Phase 1\n- [ ] id 가 없는 항목\n",
    )
    .unwrap();
    let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    let warnings = out["warnings"].as_array().expect("warnings 노출");
    assert!(
        warnings
            .iter()
            .any(|w| w.as_str().unwrap().starts_with("warn: ")),
        "plan_id 로 귀속: {warnings:?}"
    );
}

#[test]
fn plan_status_tsv_cells_never_break_columns() {
    let dir = TempDir::new().unwrap();
    let pdir = planner_dir(dir.path());
    std::fs::create_dir_all(&pdir).unwrap();
    std::fs::write(
        pdir.join("tabby.md"),
        "---\noculpm_plan: v1\nid: tabby\ntitle: \"탭 플랜\"\nstatus: active\n---\n\
         \n## Phase\tA\n- [ ] 탭\t들어간 제목 {#t1}\n",
    )
    .unwrap();
    let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    let tsv = out["items_tsv"].as_str().unwrap();
    for line in tsv.lines() {
        assert_eq!(line.split('\t').count(), 6, "열이 6개여야 함: {line:?}");
    }
}

#[test]
fn plan_update_flips_glyph_appends_log_and_respects_lock() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_plan(root);
    let args = serde_json::json!({
        "plan_id": "test-plan", "item_id": "#first", "status": "done",
        "journal_path": "journal/20260720/Bugs/1200_bug_x.md", "note": "MCP 경유",
        "base_hash": base_hash(root, "test-plan")
    });
    let out = call_tool(root, "plan_update", &args).unwrap();
    assert_eq!(out["from"], "todo");
    assert_eq!(out["to"], "done");

    let md = std::fs::read_to_string(planner_dir(root).join("test-plan.md")).unwrap();
    assert!(md.contains("- [x] 첫 항목 {#first}"));
    assert!(
        md.contains("| #first | claude-code |"),
        "plan-log append: {md}"
    );
    assert!(md.contains("MCP 경유"));

    // 잠긴 plan 은 거부.
    let locked = md.replace("status: active", "status: done");
    std::fs::write(planner_dir(root).join("test-plan.md"), locked).unwrap();
    let err = call_tool(root, "plan_update", &args).unwrap_err();
    assert!(err.contains("locked"));
}

#[test]
fn plan_update_note_and_journal_ref_are_redacted() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_plan(root);
    let args = serde_json::json!({
        "plan_id": "test-plan", "item_id": "second", "status": "done",
        "note": "키 sk-abcdefghijklmnopqrstuvwx 로 검증함",
        "base_hash": base_hash(root, "test-plan")
    });
    call_tool(root, "plan_update", &args).unwrap();
    let md = std::fs::read_to_string(planner_dir(root).join("test-plan.md")).unwrap();
    assert!(
        !md.contains("sk-abcdefghijklmnopqrstuvwx"),
        "시크릿이 plan-log 에 남음"
    );
    assert!(md.contains("[REDACTED]"), "{md}");
}

/// TK0 — plan_create: 생성물이 파서 경고 0 으로 읽히고, plan_status 가
/// 같은 와이어에서 즉시 본다. id 규칙(명시/유도/한글 폴백/중복 접미)과
/// 재생성 거부까지 한 번에 잠근다.
#[test]
fn plan_create_produces_parseable_plan_and_status_sees_it() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    let args = serde_json::json!({
        "plan_id": "token-diet",
        "title": "토큰 \"다이어트\" 라운드",
        "description": "템플릿 v6 슬림화 라운드.",
        "phases": [
            { "title": "Phase 1 — 도구", "id": "tools", "items": [
                { "text": "plan_create MCP 도구", "id": "plan-create" },
                { "text": "한글만 있는 항목" },
                { "text": "Fix cache invalidation bug" }
            ]},
            { "title": "Phase 2 — 템플릿", "items": [
                { "text": "둘째 한글 항목" }
            ]}
        ]
    });
    let out = call_tool(root, "plan_create", &args).unwrap();
    assert_eq!(out["path"], ".oculpm/planner/token-diet.md");
    assert_eq!(out["items"], 4);

    let md = std::fs::read_to_string(root.join(".oculpm/planner/token-diet.md")).unwrap();
    assert!(
        md.contains("title: \"토큰 \\\"다이어트\\\" 라운드\""),
        "{md}"
    );
    assert!(md.contains("## Phase 1 — 도구 {#tools}"), "{md}");
    assert!(
        md.contains("- [ ] plan_create MCP 도구 {#plan-create}"),
        "{md}"
    );
    assert!(md.contains("{#tools-2}"), "한글 항목은 위치 폴백 id: {md}");
    assert!(
        md.contains("{#fix-cache-invalidation-bug}"),
        "영문은 텍스트 유도 id: {md}"
    );
    assert!(md.contains("{#p2-1}"), "auto phase id 폴백: {md}");
    assert!(md.contains("<!-- oculpm:plan-log begin v1 -->"), "{md}");

    // 같은 와이어(plan_status)에서 경고 없이 보인다.
    let status = call_tool(root, "plan_status", &serde_json::json!({})).unwrap();
    assert_eq!(status["plans"].as_array().unwrap().len(), 1);
    assert_eq!(status["total"], 4);
    assert!(status.get("warnings").is_none(), "{status}");

    // 재생성 거부 + plan_update 로 항목 갱신 가능(왕복).
    let err = call_tool(root, "plan_create", &args).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    call_tool(
        root,
        "plan_update",
        &serde_json::json!({
            "plan_id": "token-diet", "item_id": "plan-create", "status": "done",
            "base_hash": base_hash(root, "token-diet")
        }),
    )
    .unwrap();

    // 잘못된 id 는 조용한 변형 대신 거부.
    let bad =
        serde_json::json!({ "plan_id": "Bad_ID", "title": "t", "phases": [{ "title": "p" }] });
    assert!(call_tool(root, "plan_create", &bad)
        .unwrap_err()
        .contains("kebab"));
}

/// 3-depth — plan_create 중첩 생성 → TSV parent 열 → 부모 직접 갱신 거부
/// → 자식 갱신 시 부모 글리프 정규화까지 한 와이어에서 검증.
#[test]
fn nested_plan_roundtrip_over_the_wire() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    let args = serde_json::json!({
        "plan_id": "nested", "title": "중첩", "phases": [{
            "title": "P1", "id": "p1", "items": [{
                "text": "부모 작업", "id": "papa",
                "children": [
                    { "text": "하위 하나", "id": "kid-a" },
                    { "text": "하위 둘", "id": "kid-b" }
                ]
            }]
        }]
    });
    let out = call_tool(root, "plan_create", &args).unwrap();
    assert_eq!(out["items"], 3, "부모 1 + 하위 2");
    let md = std::fs::read_to_string(root.join(".oculpm/planner/nested.md")).unwrap();
    assert!(md.contains("\n  - [ ] 하위 하나 {#kid-a}"), "{md}");

    // TSV parent 열: 하위는 부모 id, 부모/최상위는 빈칸.
    let status = call_tool(root, "plan_status", &serde_json::json!({})).unwrap();
    let tsv = status["items_tsv"].as_str().unwrap();
    assert!(
        tsv.lines()
            .any(|l| l.starts_with("nested\tkid-a\t") && l.ends_with("\tpapa")),
        "{tsv}"
    );
    assert!(
        tsv.lines()
            .any(|l| l.starts_with("nested\tpapa\t") && l.ends_with("\t")),
        "{tsv}"
    );

    // 부모 직접 갱신은 거부, 자식 갱신은 부모 글리프를 롤업으로 정규화.
    let err = call_tool(
        root,
        "plan_update",
        &serde_json::json!({
            "plan_id": "nested", "item_id": "papa", "status": "done",
            "base_hash": base_hash(root, "nested")
        }),
    )
    .unwrap_err();
    assert!(err.contains("하위"), "{err}");
    call_tool(
        root,
        "plan_update",
        &serde_json::json!({
            "plan_id": "nested", "item_id": "kid-a", "status": "done",
            "base_hash": base_hash(root, "nested")
        }),
    )
    .unwrap();
    let md = std::fs::read_to_string(root.join(".oculpm/planner/nested.md")).unwrap();
    assert!(md.contains("- [~] 부모 작업 {#papa}"), "부모 정규화: {md}");
}

// ── journal_search / journal_read ────────────────────────────────────────

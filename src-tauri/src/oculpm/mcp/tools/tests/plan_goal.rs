//! 고도 — 플랜의 완료 조건(`done_when`). `plan.rs` 가 래칫 800줄에 걸려 따로 산다.

use tempfile::TempDir;

use crate::oculpm::mcp::tools::call_tool;
/// 고도 — `done_when` 은 본문의 「**완료 조건:**」 한 줄이 되고, `plan_status` 가 항목과
/// 함께 돌려준다. 없으면 `null` 이 곧 신호다.
#[test]
fn plan_create_writes_done_when_and_plan_status_returns_it() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    let out = call_tool(
        dir.path(),
        "plan_create",
        &serde_json::json!({
            "plan_id": "goal-plan",
            "title": "목표 플랜",
            "done_when": "  훅이\n목표를 싣는다  ",
            "phases": [{ "title": "단계", "items": [{ "text": "첫 일", "id": "first" }] }]
        }),
    )
    .unwrap();
    let md = std::fs::read_to_string(dir.path().join(out["path"].as_str().unwrap())).unwrap();
    assert!(md.contains("\n**완료 조건:** 훅이 목표를 싣는다\n"), "{md}");
    assert!(
        md.find("완료 조건").unwrap() < md.find("## 단계").unwrap(),
        "목표는 단계 앞: {md}"
    );

    let status = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    assert_eq!(status["plans"][0]["done_when"], "훅이 목표를 싣는다");

    call_tool(
        dir.path(),
        "plan_create",
        &serde_json::json!({ "plan_id": "no-goal", "title": "목표 없음", "phases": [{ "title": "단계", "items": [{ "text": "x" }] }] }),
    )
    .unwrap();
    let status = call_tool(
        dir.path(),
        "plan_status",
        &serde_json::json!({ "plan_id": "no-goal" }),
    )
    .unwrap();
    assert!(status["plans"][0]["done_when"].is_null());
}

/// 깊이 — `check` 는 「**확인 명령:**」 줄이 되어 완료 조건 바로 다음에 서고, `plan_status` 가
/// 돌려준다. 마지막 미완 항목을 `done` 으로 닫는 `plan_update` 는 **항목 완료 ≠ 목표 달성**
/// 안내를 `warnings` 로 보탠다 — 그 전 항목을 닫을 때는 아니다.
#[test]
fn check_line_is_shipped_and_the_last_close_gets_a_goal_nudge() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    let out = call_tool(
        dir.path(),
        "plan_create",
        &serde_json::json!({
            "plan_id": "checked",
            "title": "확인 명령 플랜",
            "done_when": "둘 다 초록",
            "check": "pnpm test &&\n cargo test",
            "phases": [{ "title": "단계", "items": [
                { "text": "첫 일", "id": "a" }, { "text": "둘째 일", "id": "b" }
            ] }]
        }),
    )
    .unwrap();
    let md = std::fs::read_to_string(dir.path().join(out["path"].as_str().unwrap())).unwrap();
    assert!(
        md.contains("**완료 조건:** 둘 다 초록\n**확인 명령:** pnpm test && cargo test\n"),
        "{md}"
    );
    let status = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
    assert_eq!(status["plans"][0]["check"], "pnpm test && cargo test");
    let mut hash = out["hash"].as_str().unwrap().to_string();

    let first = call_tool(
        dir.path(),
        "plan_update",
        &serde_json::json!({ "plan_id": "checked", "item_id": "a", "status": "done", "base_hash": hash }),
    )
    .unwrap();
    assert!(
        first.get("warnings").is_none(),
        "아직 미완이 남았다: {first}"
    );
    hash = first["hash"].as_str().unwrap().to_string();

    let last = call_tool(
        dir.path(),
        "plan_update",
        &serde_json::json!({ "plan_id": "checked", "item_id": "b", "status": "done", "base_hash": hash }),
    )
    .unwrap();
    let w = last["warnings"][0].as_str().unwrap_or_default();
    assert!(w.contains("항목 완료는 목표 달성이 아니다"), "{last}");
    assert!(
        w.contains("`pnpm test && cargo test`") && w.contains("「둘 다 초록」"),
        "{w}"
    );
    assert!(w.contains("/oculpm:redteam checked"), "{w}");
}

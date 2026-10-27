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

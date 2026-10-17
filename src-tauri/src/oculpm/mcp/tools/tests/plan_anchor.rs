//! plan_create 의 앵커 중복 (`plan.rs` 가 800줄 래칫 위라 옆으로 나왔다).

use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// plan_create — 항목 글에 자기 앵커를 붙여 와도 한 번만 쓴다 (실측 2026-10-18:
/// `… {#pin-badge} {#pin-badge}` 35항목, 앞의 것이 제목에 글자로 남았다). id 를
/// 안 줬으면 붙여 온 앵커가 곧 id 다.
#[test]
fn plan_create_does_not_double_an_anchor_carried_in_the_text() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let args = serde_json::json!({
        "plan_id": "anchor-dup",
        "title": "앵커 중복",
        "phases": [{ "title": "P0", "items": [
            { "text": "지정 배지 {#pin-badge}", "id": "pin-badge", "children": [
                { "text": "하위 {#pin-sub}" }
            ]},
            { "text": "공유 렌더 {#notice-render}" }
        ]}]
    });
    call_tool(root, "plan_create", &args).unwrap();
    let md = std::fs::read_to_string(root.join(".oculpm/planner/anchor-dup.md")).unwrap();
    assert!(md.contains("- [ ] 지정 배지 {#pin-badge}\n"), "{md}");
    assert!(md.contains("  - [ ] 하위 {#pin-sub}\n"), "{md}");
    assert!(md.contains("- [ ] 공유 렌더 {#notice-render}\n"), "{md}");
    let status = call_tool(root, "plan_status", &serde_json::json!({})).unwrap();
    let text = status.to_string();
    assert!(
        !text.contains("{#"),
        "titles must not carry anchors: {text}"
    );
}

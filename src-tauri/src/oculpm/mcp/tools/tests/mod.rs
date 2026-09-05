//! `tools` 의 테스트 — 도구 갈래로 나눈다.
//!
//! 본문에서 한 번 갈라 나왔는데(2026-09-04) 그 파일이 1,703줄이라 파일 크기
//! 래칫에 다시 걸렸다. 래칫은 800줄을 넘는 **기존** 파일은 더 늘리지만 않으면
//! 봐주지만, 쪼개서 나온 파일은 「신규」라 상한을 그대로 맞는다. 그래서 도구
//! 갈래로 한 번 더 나눴다 — 동작은 그대로고, 옮기기만 했다.

mod a2a;
mod guards;
mod journal;
mod plan;
mod search;

use super::*;

/// `plan_update` 의 필수 `base_hash` — **도구가 실제로 발급하는 자리**에서
/// 가져온다 (플랜 `v3-record-integrity` `{#plan-status-hash}`).
///
/// 파일을 테스트가 직접 해싱하지 않는 이유: 발급(`plan_status`)과 대조
/// (`plan_update`)가 서로 다른 바이트를 보게 되는 회귀를 그 방식으로는 못 본다.
fn base_hash(root: &Path, plan_id: &str) -> String {
    let status = call_tool(
        root,
        "plan_status",
        &serde_json::json!({ "plan_id": plan_id }),
    )
    .unwrap_or_else(|e| panic!("plan_status 실패: {e}"));
    status["plans"][0]["hash"]
        .as_str()
        .unwrap_or_else(|| panic!("plan_status 가 hash 를 안 줬다: {status}"))
        .to_string()
}

fn seed_plan(root: &Path) {
    let dir = planner_dir(root);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("test-plan.md"),
        "---\noculpm_plan: v1\nid: test-plan\ntitle: \"테스트 플랜\"\nstatus: active\ncreated: 2026-07-20\nupdated: 2026-07-20\nowner: claude-code\n---\n\n## Phase 1 {#p1}\n- [ ] 첫 항목 {#first}\n- [~] 둘째 항목 {#second}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n",
    )
    .unwrap();
}

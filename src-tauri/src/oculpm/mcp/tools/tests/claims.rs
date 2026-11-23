//! `plan_status` 의 `plans[].claims` — `[~]` 를 누가 · 언제 잡았는지, 오래됐는지
//! (love-round-20261123 #stale-in-progress-claims).

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::oculpm::mcp::tools::call_tool;
use crate::oculpm::planner::project::planner_dir;

fn hours_ago(h: i64) -> String {
    let now = crate::clock::now().as_second();
    jiff::Timestamp::from_second(now - h * 3600)
        .unwrap()
        .to_string()
}

fn seed(root: &std::path::Path) {
    let dir = planner_dir(root);
    std::fs::create_dir_all(&dir).unwrap();
    let md = format!(
        "---\noculpm_plan: v1\nid: claims\ntitle: \"잡기\"\nstatus: active\n---\n\n## 단계\n\
         - [~] 방금 잡은 일 {{#fresh}}\n- [~] 그저께 잡은 일 {{#old}}\n- [~] 손으로 고친 일 {{#bare}}\n\
         - [~] 부모 {{#papa}}\n  - [~] 하위 {{#kid}}\n- [ ] 안 잡은 일 {{#idle}}\n\n\
         <!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n\
         | {old} | #old | codex | ☐→~ |  | 잡음 |\n\
         | {fresh_early} | #fresh | codex | ☐→~ |  | 잡음 |\n\
         | {fresh} | #fresh | claude-code | ☐→~ |  | 다시 잡음 |\n\
         | {kid} | #kid | claude-code | ☐→~ |  | 잡음 |\n\
         <!-- oculpm:plan-log end -->\n",
        old = hours_ago(72),
        fresh_early = hours_ago(100),
        fresh = hours_ago(3),
        kid = hours_ago(1),
    );
    std::fs::write(dir.join("claims.md"), md).unwrap();
}

fn claim<'a>(claims: &'a [Value], item: &str) -> &'a Value {
    claims
        .iter()
        .find(|c| c["item"] == item)
        .unwrap_or_else(|| panic!("{item} 잡기가 없다: {claims:?}"))
}

/// 마지막 `→~` 행이 주인이다 — 48시간이 지났거나 기록이 없으면 stale. 부모(롤업)와 `[ ]` 는 안 싣는다.
#[test]
fn claims_name_the_owner_and_flag_old_or_unrecorded_ones() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    seed(dir.path());
    let out = call_tool(dir.path(), "plan_status", &json!({})).unwrap();
    let claims = out["plans"][0]["claims"]
        .as_array()
        .expect("claims")
        .clone();

    let fresh = claim(&claims, "fresh");
    assert_eq!(fresh["by"], "claude-code", "마지막 →~ 행이 주인: {fresh}");
    assert_eq!(fresh["stale"], false, "{fresh}");
    assert_eq!(fresh["age_h"], 3, "{fresh}");

    let old = claim(&claims, "old");
    assert_eq!(old["by"], "codex");
    assert_eq!(old["stale"], true, "72시간: {old}");

    let bare = claim(&claims, "bare");
    assert_eq!(bare["by"], Value::Null);
    assert_eq!(
        bare["stale"], true,
        "잡은 기록이 없으면 살아 있다고 볼 근거가 없다: {bare}"
    );

    assert_eq!(claim(&claims, "kid")["stale"], false);
    assert!(
        claims
            .iter()
            .all(|c| c["item"] != "papa" && c["item"] != "idle"),
        "부모 롤업 · 안 잡은 일은 잡기가 아니다: {claims:?}"
    );
    assert!(out["legend"].as_str().unwrap().contains("이어받음"));
}

/// 잡기가 없으면 `claims` 를 싣지 않는다 — 기본 출력을 부풀리지 않는다.
#[test]
fn plans_without_claims_carry_no_claims_field() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    let pdir = planner_dir(dir.path());
    std::fs::create_dir_all(&pdir).unwrap();
    std::fs::write(
        pdir.join("calm.md"),
        "---\noculpm_plan: v1\nid: calm\ntitle: \"조용\"\nstatus: active\n---\n\n## 단계\n- [ ] 일 {#a}\n",
    )
    .unwrap();
    let out = call_tool(dir.path(), "plan_status", &json!({})).unwrap();
    assert!(out["plans"][0].get("claims").is_none(), "{out}");
}

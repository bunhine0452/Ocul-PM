//! plan-log 이력 분리가 **읽기를 가르지 않는다** (`{#plan-log-archive}`).
//!
//! 분리 자체는 단위 테스트(`planner::log_archive`)가 문다. 여기서 무는 것은
//! 그 다음 질문 하나다: 행이 `<plan_id>.log.md` 로 나간 뒤에도
//! `plan_item_history` 와 플래너 목록이 예전과 **같은 것**을 보는가.
//!
//! 갈라지면 증상이 조용하다 — 이력 뷰에서 오래된 행이 말없이 사라지거나,
//! 보관함이 빈 플랜 한 장으로 목록에 끼어든다. 둘 다 사용자가 "원래 없었나"
//! 로 넘길 만한 모양이라 게이트가 아니면 안 잡힌다.

use std::path::Path;

use ocul_pm_lib::db::Db;
use ocul_pm_lib::oculpm::mcp::tools::call_tool;
use ocul_pm_lib::oculpm::planner::log_archive::{archive_path, LOG_KEEP};
use ocul_pm_lib::oculpm::planner::project::{planner_dir, PlanCache};
use serde_json::json;

const PLAN_ID: &str = "history";

/// plan-log 에 데이터 행 `rows` 개를 심은 활성 플랜.
fn seed(root: &Path, rows: usize) {
    let dir = planner_dir(root);
    std::fs::create_dir_all(&dir).unwrap();
    let mut md = format!(
        "---\noculpm_plan: v1\nid: {PLAN_ID}\ntitle: \"이력\"\nstatus: active\n\
         created: 2026-09-01\nupdated: 2026-09-01\nowner: claude-code\n---\n\n\
         ## Phase 1 {{#p1}}\n- [ ] 항목 {{#first}}\n\n\
         <!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n\
         |---|---|---|---|---|---|\n"
    );
    for i in 0..rows {
        md.push_str(&format!(
            "| 2026-09-{:02}T0{}:00:00+09:00 | #first | claude-code | ☐→x | | seed-{i} |\n",
            (i % 28) + 1,
            i % 10
        ));
    }
    md.push_str("<!-- oculpm:plan-log end -->\n");
    std::fs::write(dir.join(format!("{PLAN_ID}.md")), md).unwrap();
}

#[tokio::test]
async fn archived_rows_stay_in_the_item_history_and_never_become_a_plan() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // 60 행 + 갱신 1 행 = 61 → 21 행이 아카이브로 나간다.
    seed(root, 60);

    let hash = call_tool(root, "plan_status", &json!({ "plan_id": PLAN_ID })).unwrap()["plans"][0]
        ["hash"]
        .as_str()
        .unwrap()
        .to_string();
    call_tool(
        root,
        "plan_update",
        &json!({
            "plan_id": PLAN_ID, "item_id": "first", "status": "done",
            "base_hash": hash, "note": "분리 유발"
        }),
    )
    .unwrap();
    assert!(
        archive_path(&planner_dir(root), PLAN_ID).exists(),
        "아카이브가 안 생겼다"
    );

    let db = Db::open(root.join("test.db")).await.expect("open db");
    let pid = db
        .create_project("hist".into(), root.to_string_lossy().to_string())
        .await
        .expect("create project");
    let cache = PlanCache::new(&db);
    let planner_root = planner_dir(root);

    // 보관함은 플랜이 아니다.
    let plans = cache.list(pid, &planner_root).await.expect("list");
    assert_eq!(plans.len(), 1, "아카이브가 플랜으로 샜다: {plans:?}");
    assert_eq!(plans[0].plan_id, PLAN_ID);

    // 이력은 본문 40 + 아카이브 21 = 61 행 전부.
    let hist = cache
        .item_history(pid, &planner_root, PLAN_ID, "first")
        .await
        .expect("history");
    assert_eq!(hist.len(), 61, "아카이브 행이 이력에서 사라졌다");
    assert!(
        hist.iter().any(|u| u.note.as_deref() == Some("seed-0")),
        "가장 오래된 행이 없다"
    );
    assert!(
        hist.iter().any(|u| u.note.as_deref() == Some("분리 유발")),
        "방금 쓴 행이 없다"
    );

    // 본문에는 최신 40행만 남아 있다 — 파일을 직접 읽는 에이전트가 무는 자리.
    let body = std::fs::read_to_string(planner_dir(root).join(format!("{PLAN_ID}.md"))).unwrap();
    assert_eq!(
        body.lines()
            .filter(|l| l.trim_start().starts_with("| 2026-09-"))
            .count(),
        LOG_KEEP
    );
}

//! v2 U7 (docs/20260706_v2/02-features-spec.md §2) — `search_oculpm_entities`
//! 통합 테스트: 4개 캐시 테이블 병합, prefix>substring 랭킹, LIKE 와일드카드
//! 이스케이프, limit, 프로젝트 격리.

use ocul_pm_lib::db::{Db, EntityKind};

async fn seeded_db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    db.conn()
        .call(|c| {
            c.execute_batch(
                r#"
        INSERT INTO oculpm_journal (project_id, relative_path, workday, type, slug, status,
            title, session_id, agent_id, language, created_at, file_mtime, body_markdown, body_md_hash)
        VALUES
          (1, '20260706/Features_to_add/1000_feature_nav.md', '20260706', 'feature', 'nav-registry',
           'done', '내비 레지스트리 구현', 's1', 'claude-code', 'ko', '2026-07-06T10:00:00+09:00', 0, '', 'h'),
          (1, '20260705/Bugs/0900_bug_toast.md', '20260705', 'bug', 'toast-theme',
           'done', '토스트가 내비 위를 가림', 's1', 'claude-code', 'ko', '2026-07-05T09:00:00+09:00', 0, '', 'h');
        INSERT INTO oculpm_plans (project_id, plan_id, title, status, owner_agent, progress, file_path, updated_at)
        VALUES (1, 'v2-release', '내비 포함 v2 릴리스', 'active', 'claude-code', 0,
                '.oculpm/planner/v2-release.md', '2026-07-06T11:00:00+09:00');
        INSERT INTO oculpm_plan_items (project_id, plan_id, item_id, title, status, order_idx)
        VALUES (1, 'v2-release', 'nav-registry', '내비 단축키 정비', 'done', 0);
        INSERT INTO oculpm_discussions (project_id, discussion_id, title, status, owner,
            option_count, next_step_count, file_path, created_at, updated_at)
        VALUES (1, 'nav-strategy', '내비 전략 토의', 'open', 'claude-code', 0, 0,
                '.oculpm/discussion/nav-strategy/discussion.md',
                '2026-07-01T09:00:00+09:00', '2026-07-01T09:00:00+09:00');
        "#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    (dir, db)
}

#[tokio::test]
async fn merges_all_kinds_and_ranks_prefix_first() {
    let (_dir, db) = seeded_db().await;
    let hits = db
        .search_oculpm_entities(1, "내비".into(), 10)
        .await
        .unwrap();
    // 5행 전부 매치 (4 prefix + 1 substring).
    assert_eq!(hits.len(), 5);
    // substring 매치("토스트가 내비 위를 가림")는 맨 뒤.
    assert_eq!(hits[4].title, "토스트가 내비 위를 가림");
    // prefix 매치들은 최신순 — plan(11:00)과 그 plan 시각을 상속한 item 이
    // journal(10:00)·discussion(07-01)보다 앞.
    assert_eq!(hits[0].kind, EntityKind::Plan);
    assert!(hits[..4].iter().all(|h| h.title.starts_with("내비")));
    // plan_item id 는 "plan#item" 라우팅 키.
    let item = hits.iter().find(|h| h.kind == EntityKind::PlanItem).unwrap();
    assert_eq!(item.id, "v2-release#nav-registry");
    assert_eq!(item.subtitle, "내비 포함 v2 릴리스");
}

#[tokio::test]
async fn escapes_like_wildcards() {
    let (_dir, db) = seeded_db().await;
    // '%' 가 와일드카드로 해석되면 전 행이 반환된다 — 이스케이프 계약.
    let hits = db.search_oculpm_entities(1, "%".into(), 10).await.unwrap();
    assert!(hits.is_empty());
}

#[tokio::test]
async fn respects_limit_and_project_isolation() {
    let (_dir, db) = seeded_db().await;
    let one = db.search_oculpm_entities(1, "내비".into(), 1).await.unwrap();
    assert_eq!(one.len(), 1);
    let other = db
        .search_oculpm_entities(2, "내비".into(), 10)
        .await
        .unwrap();
    assert!(other.is_empty());
    let blank = db.search_oculpm_entities(1, "  ".into(), 10).await.unwrap();
    assert!(blank.is_empty());
}

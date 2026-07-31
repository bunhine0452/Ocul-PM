//! 메인 화면 집계 `home::collect` 통합 테스트.
//!
//! 이 커맨드는 프로젝트 선택 화면 전체가 의존하는 단일 데이터원이라, 경계
//! 동작을 여기서 못박는다. 특히:
//!   - 창(days) **밖**으로 밀려난 조용한 프로젝트도 `last_at` 은 잡혀야 한다
//!     (그러지 않으면 "마지막 활동" 이 창 경계에서 정보가 후퇴한다).
//!   - `oculpm_plan_items` 는 플래너가 채우는 **투영** 테이블이라 비어 있는
//!     것이 정상 — 그때 `next_tasks` 가 빈 배열이어야 하고, 화면은 그 줄을
//!     그리지 않는다.
//!   - 일지 0건이어도 플랜/정체성만 있는 프로젝트가 결과에서 빠지면 안 된다
//!     (그린필드 직후가 정확히 그 상태다).

use chrono::{Duration, Local};

use ocul_pm_lib::db::Db;
use ocul_pm_lib::home;

/// 로컬 캘린더 기준 YYYYMMDD — `home::workday_key` 와 같은 규약.
fn workday(offset_days: i64) -> String {
    (Local::now().date_naive() - Duration::days(offset_days))
        .format("%Y%m%d")
        .to_string()
}

/// RFC3339 created_at — 워크데이와 어긋나지 않게 같은 오프셋에서 만든다.
fn created_at(offset_days: i64, hhmm: &str) -> String {
    let d = Local::now().date_naive() - Duration::days(offset_days);
    format!("{}T{}:00+09:00", d.format("%Y-%m-%d"), hhmm)
}

async fn empty_db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    (dir, db)
}

async fn insert_entry(
    db: &Db,
    project_id: i64,
    offset_days: i64,
    hhmm: &str,
    ty: &str,
    title: &str,
    agent: &str,
    version: Option<&str>,
) {
    let wd = workday(offset_days);
    let at = created_at(offset_days, hhmm);
    let path = format!("{wd}/{ty}/{}_{}.md", hhmm.replace(':', ""), ty);
    let (ty, title, agent) = (ty.to_string(), title.to_string(), agent.to_string());
    let version = version.map(|s| s.to_string());
    db.conn()
        .call(move |c| {
            c.execute(
                "INSERT INTO oculpm_journal (project_id, relative_path, workday, type, slug,
                     status, title, session_id, agent_id, agent_version, language, created_at,
                     file_mtime, body_markdown, body_md_hash)
                 VALUES (?1, ?2, ?3, ?4, 'slug', 'done', ?5, 's1', ?6, ?7, 'ko', ?8, 0, '', 'h')",
                rusqlite::params![project_id, path, wd, ty, title, agent, version, at],
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
}

// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn empty_db_returns_empty_brief_not_error() {
    let (_dir, db) = empty_db().await;
    let brief = home::collect(&db, 14).await.unwrap();

    assert!(brief.projects.is_empty());
    assert!(brief.feed.is_empty());
    assert_eq!(brief.today_total, 0);
    assert_eq!(brief.active_projects, 0);
    // 창 계산은 데이터와 무관하게 항상 성립해야 한다.
    assert_eq!(brief.today_workday, workday(0));
    assert_eq!(brief.since_workday, workday(13));
}

#[tokio::test]
async fn last_activity_survives_outside_the_window() {
    // 창(14일) 밖 20일 전 일지 1건뿐인 프로젝트. days 버킷에는 안 잡히지만
    // last_at / total_entries 는 반드시 잡혀야 한다 — 안 그러면 화면이
    // "기록 없음"으로 거짓말한다.
    let (_dir, db) = empty_db().await;
    insert_entry(&db, 1, 20, "09:00", "chore", "오래된 정리", "claude-code", None).await;

    let brief = home::collect(&db, 14).await.unwrap();
    let p = &brief.projects[0];

    assert_eq!(p.project_id, 1);
    assert_eq!(p.total_entries, 1);
    assert_eq!(p.last_workday.as_deref(), Some(workday(20).as_str()));
    assert_eq!(p.last_title.as_deref(), Some("오래된 정리"));
    assert_eq!(p.last_type.as_deref(), Some("chore"));
    assert!(p.days.is_empty(), "창 밖이므로 일별 버킷은 비어야 한다");
    assert_eq!(p.today_count, 0);
    // 7일 창에도 없으므로 활동 중으로 세면 안 된다.
    assert_eq!(brief.active_projects, 0);
}

#[tokio::test]
async fn today_count_and_active_projects_use_distinct_windows() {
    let (_dir, db) = empty_db().await;
    // p1: 오늘 2건 → today_count 2, 활동 중
    insert_entry(&db, 1, 0, "09:00", "feature", "오늘 A", "claude-code", None).await;
    insert_entry(&db, 1, 0, "11:00", "bug", "오늘 B", "claude-code", None).await;
    // p2: 5일 전 1건 → today_count 0 이지만 7일 창 안이라 활동 중
    insert_entry(&db, 2, 5, "10:00", "refactor", "닷새 전", "cursor", None).await;
    // p3: 10일 전 1건 → 14일 창(days)에는 있으나 7일 창 밖 → 활동 중 아님
    insert_entry(&db, 3, 10, "10:00", "chore", "열흘 전", "cursor", None).await;

    let brief = home::collect(&db, 14).await.unwrap();

    assert_eq!(brief.today_total, 2);
    assert_eq!(brief.active_projects, 2, "p1(오늘) + p2(5일 전)만 활동 중");

    let p1 = brief.projects.iter().find(|p| p.project_id == 1).unwrap();
    assert_eq!(p1.today_count, 2);
    assert_eq!(p1.days.len(), 1, "같은 날 2건은 한 버킷으로 접힌다");
    assert_eq!(p1.days[0].count, 2);

    let p3 = brief.projects.iter().find(|p| p.project_id == 3).unwrap();
    assert_eq!(p3.today_count, 0);
    assert_eq!(p3.days.len(), 1, "10일 전은 14일 창 안이므로 버킷에 남는다");
}

#[tokio::test]
async fn latest_entry_wins_per_project_and_feed_is_cross_project() {
    let (_dir, db) = empty_db().await;
    insert_entry(&db, 1, 2, "09:00", "chore", "예전 것", "cursor", None).await;
    insert_entry(&db, 1, 0, "14:00", "feature", "최신 것", "claude-code", Some("Opus 5")).await;
    insert_entry(&db, 2, 1, "10:00", "bug", "다른 프로젝트", "gemini-cli", None).await;

    let brief = home::collect(&db, 14).await.unwrap();

    let p1 = brief.projects.iter().find(|p| p.project_id == 1).unwrap();
    assert_eq!(p1.last_title.as_deref(), Some("최신 것"));
    assert_eq!(p1.last_agent_id.as_deref(), Some("claude-code"));
    assert_eq!(p1.last_agent_version.as_deref(), Some("Opus 5"));

    // 피드는 프로젝트를 가로질러 최신순.
    assert_eq!(brief.feed.len(), 3);
    assert_eq!(brief.feed[0].title, "최신 것");
    assert_eq!(brief.feed[1].title, "다른 프로젝트");
    assert_eq!(brief.feed[2].title, "예전 것");
    assert_eq!(brief.feed[0].entry_type, "feature");
}

#[tokio::test]
async fn feed_is_capped_at_twelve() {
    let (_dir, db) = empty_db().await;
    for i in 0..20 {
        insert_entry(&db, 1, 0, &format!("{:02}:00", i), "chore", "행", "cursor", None).await;
    }
    let brief = home::collect(&db, 14).await.unwrap();
    assert_eq!(brief.feed.len(), 12);
    assert_eq!(brief.projects[0].total_entries, 20, "총계는 캡과 무관하다");
}

#[tokio::test]
async fn missing_plan_projection_yields_empty_next_tasks() {
    // 플랜 파일이 디스크에 있어도 플래너를 연 적이 없으면 투영 테이블이 비어
    // 있다. 그때 next_tasks 는 빈 배열이어야 한다 (거짓 값 금지).
    let (_dir, db) = empty_db().await;
    insert_entry(&db, 1, 0, "09:00", "feature", "일지만 있음", "claude-code", None).await;

    let brief = home::collect(&db, 14).await.unwrap();
    let p = &brief.projects[0];
    assert!(p.next_tasks.is_empty());
    assert!(p.active_plan.is_none());
}

#[tokio::test]
async fn active_plan_yields_next_tasks_in_progress_first() {
    let (_dir, db) = empty_db().await;
    insert_entry(&db, 1, 0, "09:00", "feature", "일지", "claude-code", None).await;
    db.conn()
        .call(|c| {
            c.execute_batch(
                r#"
INSERT INTO oculpm_plans (project_id, plan_id, title, status, owner_agent, progress, file_path, updated_at)
VALUES (1, 'home-redesign', '메인 화면 재구성', 'active', 'claude-code', 0.25,
        '.oculpm/planner/home-redesign.md', '2026-07-31T10:00:00+09:00'),
       (1, 'old-plan', '끝난 계획', 'done', 'claude-code', 1.0,
        '.oculpm/planner/old-plan.md', '2026-07-01T10:00:00+09:00');
INSERT INTO oculpm_plan_items (project_id, plan_id, item_id, title, status, order_idx, phase)
VALUES (1, 'home-redesign', 'a', '토큰 전역화', 'done',        0, 'Phase A'),
       (1, 'home-redesign', 'b', '레일 조립',   'todo',        1, 'Phase B'),
       (1, 'home-redesign', 'c', '벤토 밴드',   'in_progress', 2, 'Phase B'),
       (1, 'home-redesign', 'd', '테스트 갱신', 'todo',        3, 'Phase C'),
       (1, 'old-plan',      'z', '옛 항목',     'todo',        0, NULL);
"#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();

    let brief = home::collect(&db, 14).await.unwrap();
    let p = &brief.projects[0];

    // 상한 3, 진행중이 먼저, 그 다음 order_idx.
    assert_eq!(p.next_tasks.len(), 3);
    assert_eq!(p.next_tasks[0].item_title, "벤토 밴드");
    assert_eq!(p.next_tasks[0].status, "in_progress");
    assert_eq!(p.next_tasks[1].item_title, "레일 조립");
    assert_eq!(p.next_tasks[2].item_title, "테스트 갱신");
    // status='done' 인 플랜의 항목은 섞이면 안 된다.
    assert!(p.next_tasks.iter().all(|i| i.plan_id == "home-redesign"));

    let plan = p.active_plan.as_ref().unwrap();
    assert_eq!(plan.plan_id, "home-redesign");
    assert_eq!(plan.plan_title, "메인 화면 재구성");
    assert_eq!(plan.done, 1, "done 1건 / 전체 4건");
    assert_eq!(plan.total, 4);
}

#[tokio::test]
async fn project_with_only_plan_or_identity_is_not_dropped() {
    // 그린필드 직후 — 일지 0건이지만 플랜/정체성은 있다. 홈에서 사라지면 안 된다.
    let (_dir, db) = empty_db().await;
    db.conn()
        .call(|c| {
            c.execute_batch(
                r#"
INSERT INTO projects (id, name, root_path, created_at) VALUES (7, 'fresh', '/tmp/fresh', 0);
INSERT INTO project_overviews (project_id, identity) VALUES (7, '갓 만든 프로젝트');
INSERT INTO oculpm_plans (project_id, plan_id, title, status, owner_agent, progress, file_path, updated_at)
VALUES (7, 'kickoff', '착수', 'active', 'claude-code', 0, '.oculpm/planner/kickoff.md', '2026-07-31T10:00:00+09:00');
INSERT INTO oculpm_plan_items (project_id, plan_id, item_id, title, status, order_idx)
VALUES (7, 'kickoff', 'a', '첫 항목', 'todo', 0);
"#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();

    let brief = home::collect(&db, 14).await.unwrap();
    let p = brief.projects.iter().find(|p| p.project_id == 7).unwrap();

    assert_eq!(p.total_entries, 0);
    assert!(p.last_at.is_none());
    assert_eq!(p.identity.as_deref(), Some("갓 만든 프로젝트"));
    assert_eq!(p.next_tasks.len(), 1);
}

#[tokio::test]
async fn blank_identity_is_treated_as_absent() {
    let (_dir, db) = empty_db().await;
    insert_entry(&db, 1, 0, "09:00", "chore", "일지", "cursor", None).await;
    db.conn()
        .call(|c| {
            c.execute_batch(
                "INSERT INTO projects (id, name, root_path, created_at) VALUES (1, 'p', '/tmp/p', 0);
                 INSERT INTO project_overviews (project_id, identity) VALUES (1, '');",
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();

    let brief = home::collect(&db, 14).await.unwrap();
    assert!(brief.projects[0].identity.is_none(), "빈 문자열은 없는 것과 같다");
}

#[tokio::test]
async fn days_arg_is_clamped_and_window_follows_it() {
    let (_dir, db) = empty_db().await;

    // 0 → 하한 1 (오늘만)
    let brief = home::collect(&db, 0).await.unwrap();
    assert_eq!(brief.since_workday, workday(0));

    // 9999 → 상한 62
    let brief = home::collect(&db, 9999).await.unwrap();
    assert_eq!(brief.since_workday, workday(61));

    // 7 → 오늘 포함 7일
    let brief = home::collect(&db, 7).await.unwrap();
    assert_eq!(brief.since_workday, workday(6));
}

#[tokio::test]
async fn workday_bucket_query_stays_covering_with_no_temp_btree() {
    // 일별 버킷 쿼리는 선행 컬럼(project_id) 없이 workday 범위만 준다. 그래도
    // idx_oculpm_journal_workday(project_id, workday) 가 **커버링**이라 테이블
    // 접근이 없고, 인덱스 순서가 GROUP BY 순서와 같아 정렬용 임시 B-트리도
    // 만들지 않는다 (SQLite 는 skip-scan 으로 workday 범위를 좁힌다).
    //
    // workday 단독 인덱스를 따로 만들 필요가 없다는 뜻이다 — 그 인덱스는
    // project_id 를 담지 않아 커버링이 못 되고, 행마다 테이블 조회 + GROUP BY
    // 용 임시 B-트리가 붙어 오히려 느리다. 20,000행 + ANALYZE 로 실측했더니
    // SQLite 는 단독 인덱스가 있어도 쓰지 않고 이 커버링 인덱스를 골랐다.
    // 이 테스트는 그 성질이 깨지는 순간(예: 인덱스 정의 변경)을 잡는다.
    let (_dir, db) = empty_db().await;
    let plan = db
        .conn()
        .call(|c| {
            let mut stmt = c.prepare(
                "EXPLAIN QUERY PLAN
                 SELECT project_id, workday, COUNT(*)
                   FROM oculpm_journal WHERE workday >= ?1
                  GROUP BY project_id, workday",
            )?;
            let rows = stmt
                .query_map(rusqlite::params!["20260101"], |r| r.get::<_, String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok::<String, tokio_rusqlite::Error>(rows.join(" | "))
        })
        .await
        .unwrap();

    assert!(
        plan.contains("COVERING INDEX"),
        "커버링 인덱스로 테이블 접근을 피해야 한다 — 실제 계획: {plan}"
    );
    assert!(
        !plan.contains("TEMP B-TREE"),
        "인덱스 순서가 GROUP BY 순서와 같아 임시 B-트리가 없어야 한다 — 실제 계획: {plan}"
    );
}

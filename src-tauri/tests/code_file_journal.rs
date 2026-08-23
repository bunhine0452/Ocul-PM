//! 코드 화면 일지 칩 (#agent-diff) — 파일 → 일지 역조회 통합 테스트.
//!
//! `oculpm_journal_files` × `oculpm_journal` 조인이 이 기능의 유일한 새 백엔드
//! 로직이다: 최신순 정렬, 프로젝트 격리, 그 파일을 만진 일지만.

use ocul_pm_lib::db::Db;

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
          (1, '20260822/Bugs/0900_bug_old.md', '20260822', 'bug', 'old',
           'done', '어제의 수정', 's1', 'claude-code', 'ko', '2026-08-22T09:00:00+09:00', 0, '', 'h'),
          (1, '20260823/Features_to_add/1000_feature_new.md', '20260823', 'feature', 'new',
           'done', '오늘의 기능', 's2', 'cursor', 'ko', '2026-08-23T10:00:00+09:00', 0, '', 'h'),
          (2, '20260823/Bugs/1100_bug_other.md', '20260823', 'bug', 'other',
           'done', '남의 프로젝트', 's3', 'claude-code', 'ko', '2026-08-23T11:00:00+09:00', 0, '', 'h');
        INSERT INTO oculpm_journal_files (project_id, relative_path, file_path, op)
        VALUES
          (1, '20260822/Bugs/0900_bug_old.md', 'src/app.ts', 'update'),
          (1, '20260823/Features_to_add/1000_feature_new.md', 'src/app.ts', 'update'),
          (1, '20260823/Features_to_add/1000_feature_new.md', 'src/other.ts', 'create'),
          (2, '20260823/Bugs/1100_bug_other.md', 'src/app.ts', 'update');
        "#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    (dir, db)
}

#[tokio::test]
async fn returns_entries_for_the_file_newest_first() {
    let (_dir, db) = seeded_db().await;
    let rows = db
        .oculpm_journal_for_file(1, "src/app.ts".into(), 20)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "이 파일을 만진 일지만: {rows:?}");
    // 최신순 — 칩 팝오버의 맨 위가 가장 최근 작업이어야 한다.
    assert_eq!(rows[0].title, "오늘의 기능");
    assert_eq!(rows[0].agent_id, "cursor");
    assert_eq!(rows[0].op, "update");
    assert_eq!(rows[0].journal_path, "20260823/Features_to_add/1000_feature_new.md");
    assert_eq!(rows[1].title, "어제의 수정");
}

#[tokio::test]
async fn isolates_projects_and_files() {
    let (_dir, db) = seeded_db().await;
    // 프로젝트 격리 — 2번 프로젝트의 같은 경로가 새어 들어오면 안 된다.
    let rows = db.oculpm_journal_for_file(2, "src/app.ts".into(), 20).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "남의 프로젝트");
    // 아무 일지도 안 만진 파일은 빈 목록 (칩이 안 뜬다).
    assert!(db
        .oculpm_journal_for_file(1, "src/untouched.ts".into(), 20)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn respects_the_limit() {
    let (_dir, db) = seeded_db().await;
    let rows = db.oculpm_journal_for_file(1, "src/app.ts".into(), 1).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "오늘의 기능", "잘라도 최신이 남는다");
}

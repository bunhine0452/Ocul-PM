//! v2 U11 (docs/20260706_v2/03-performance-spec.md §3) — chunk_fts 통합 테스트.
//! trigram FTS 가 LIKE 와 동일한 substring 의미를 보존하는지, 트리거 동기화
//! (insert/update/delete)와 3자 미만 LIKE 폴백을 검증한다.

use ocul_pm_lib::db::Db;

async fn seeded() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    db.conn()
        .call(|c| {
            c.execute_batch(
                r#"
        INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');
        INSERT INTO files (id, project_id, path, hash, size, mtime)
        VALUES (10, 1, 'src/a.ts', 'h1', 100, 0), (11, 1, 'src/b.ts', 'h2', 100, 0);
        INSERT INTO chunks (id, file_id, kind, start_line, end_line, content) VALUES
          (100, 10, 'lines', 1, 5, 'export function parseFallbacks(raw: string) {}'),
          (101, 11, 'lines', 1, 5, '한글 주석이 포함된 청크 내용입니다');
        "#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    (dir, db)
}

#[tokio::test]
async fn fts_matches_substring_like_semantics() {
    let (_dir, db) = seeded().await;
    // 식별자 중간 substring — trigram 이라 매치돼야 한다 (unicode61 이면 실패).
    let hits = db.search_text(1, "Fallback".into(), 10).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file_path, "src/a.ts");
    // 한글 substring.
    let ko = db.search_text(1, "주석이 포함".into(), 10).await.unwrap();
    assert_eq!(ko.len(), 1);
    assert_eq!(ko[0].file_path, "src/b.ts");
}

#[tokio::test]
async fn short_query_falls_back_to_like() {
    let (_dir, db) = seeded().await;
    // 2자 쿼리는 trigram 매치 불가 — LIKE 폴백 경로로 여전히 찾아야 한다.
    let hits = db.search_text(1, "한글".into(), 10).await.unwrap();
    assert_eq!(hits.len(), 1);
}

#[tokio::test]
async fn fts_query_operators_are_neutralized() {
    let (_dir, db) = seeded().await;
    // FTS 연산자 문자가 든 쿼리가 에러 없이 (phrase 인용으로) 처리된다.
    for q in ["a AND b", "col:x", "\"quoted\"", "star*"] {
        let res = db.search_text(1, q.to_string(), 10).await;
        assert!(res.is_ok(), "query {q:?} must not error");
    }
}

#[tokio::test]
async fn triggers_keep_fts_in_sync() {
    let (_dir, db) = seeded().await;
    // update
    db.conn()
        .call(|c| {
            c.execute(
                "UPDATE chunks SET content = 'totally different body' WHERE id = 100",
                [],
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    assert!(db.search_text(1, "Fallback".into(), 10).await.unwrap().is_empty());
    assert_eq!(db.search_text(1, "different body".into(), 10).await.unwrap().len(), 1);

    // delete
    db.conn()
        .call(|c| {
            c.execute("DELETE FROM chunks WHERE id = 100", [])?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    assert!(db.search_text(1, "different body".into(), 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn project_isolation_holds_on_fts_path() {
    let (_dir, db) = seeded().await;
    let other = db.search_text(2, "Fallback".into(), 10).await.unwrap();
    assert!(other.is_empty());
}

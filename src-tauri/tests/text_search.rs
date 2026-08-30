//! `search_text` 통합 테스트 — 정확 substring 검색(LIKE) 의 의미와 격리.
//!
//! 예전 `fts_search.rs`(v2 U11) 는 trigram FTS5 를 전제했지만 그 마이그레이션은
//! 등록된 적이 없어 테스트가 늘 LIKE 폴백으로 통과하고 있었다. 2026-08-30 에
//! FTS 를 폐기하면서(`improvement-audit-round.md` D2) 이 파일이 실제 경로를
//! 그대로 검증하도록 바꿨다: substring 의미 · 한글 · LIKE 메타문자 무해화 ·
//! 프로젝트 격리 · 삭제 반영.

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
          (101, 11, 'lines', 1, 5, '한글 주석이 포함된 청크 내용입니다 100% _under_');
        "#,
            )?;
            Ok::<(), tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    (dir, db)
}

#[tokio::test]
async fn matches_identifier_substrings_and_korean() {
    let (_dir, db) = seeded().await;
    // 식별자 중간 substring.
    let hits = db.search_text(1, "Fallback".into(), 10).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file_path, "src/a.ts");
    assert_eq!(hits[0].distance, 0.0, "텍스트 매치는 유사도가 없다");
    // 한글 substring — 2자 쿼리도 된다 (trigram 의 3자 하한이 사라졌다).
    let ko = db.search_text(1, "한글".into(), 10).await.unwrap();
    assert_eq!(ko.len(), 1);
    assert_eq!(ko[0].file_path, "src/b.ts");
}

#[tokio::test]
async fn like_metacharacters_are_literal() {
    let (_dir, db) = seeded().await;
    // `%` 와 `_` 는 와일드카드가 아니라 글자로 매치돼야 한다.
    assert_eq!(db.search_text(1, "100%".into(), 10).await.unwrap().len(), 1);
    assert_eq!(db.search_text(1, "_under_".into(), 10).await.unwrap().len(), 1);
    assert!(db.search_text(1, "100_".into(), 10).await.unwrap().is_empty());
    // FTS 연산자처럼 보이는 입력도 그냥 글자다 — 에러 없이 빈 결과.
    for q in ["a AND b", "col:x", "\"quoted\"", "star*"] {
        let res = db.search_text(1, q.to_string(), 10).await;
        assert!(res.is_ok(), "query {q:?} must not error");
    }
}

#[tokio::test]
async fn reflects_updates_and_deletes_immediately() {
    let (_dir, db) = seeded().await;
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
async fn project_isolation_holds() {
    let (_dir, db) = seeded().await;
    let other = db.search_text(2, "Fallback".into(), 10).await.unwrap();
    assert!(other.is_empty());
}

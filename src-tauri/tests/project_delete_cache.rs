//! 프로젝트를 지우면 그 프로젝트의 파생 캐시도 함께 지워진다 (2026-10-04).
//!
//! `files` 계열은 `projects` 에 `ON DELETE CASCADE` 로 매달려 따라 지워지지만,
//! `.oculpm/` 캐시 표들은 FK 가 없어 행이 그대로 남았다 — 설치본 DB 에서 지운
//! 프로젝트 7개의 일지 482건·플랜 항목 1,175건 등 약 1만 행이 고아였다.

use ocul_pm_lib::db::{Db, PROJECT_CACHE_TABLES};

async fn table_count(db: &Db, sql: String) -> i64 {
    db.conn()
        .call(move |c| Ok::<i64, tokio_rusqlite::Error>(c.query_row(&sql, [], |r| r.get(0))?))
        .await
        .unwrap()
}

/// 스키마의 프로젝트 범위 표 중 `projects` 로 FK 가 없는 것은 **전부** 목록에
/// 있어야 한다 — 새 캐시 표가 생기면 여기서 먼저 걸린다.
#[tokio::test]
async fn every_unchained_project_table_is_listed() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let unchained: Vec<String> = db
        .conn()
        .call(|c| {
            let mut stmt = c.prepare(
                "SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) p
                 WHERE m.type = 'table' AND p.name = 'project_id'
                   AND m.sql NOT LIKE '%VIRTUAL%'
                   AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f
                                   WHERE f.\"table\" = 'projects')
                   AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f
                                   WHERE f.on_delete = 'CASCADE')
                 ORDER BY m.name",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            Ok::<_, tokio_rusqlite::Error>(rows.collect::<Result<Vec<_>, _>>()?)
        })
        .await
        .unwrap();
    let mut listed: Vec<String> = PROJECT_CACHE_TABLES.iter().map(|s| s.to_string()).collect();
    listed.sort();
    assert_eq!(
        unchained, listed,
        "FK 없는 프로젝트 표와 PROJECT_CACHE_TABLES 가 어긋난다"
    );
}

#[tokio::test]
async fn deleting_a_project_clears_its_cache_rows_only() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let gone = db
        .create_project("gone".into(), "/tmp/gone".into())
        .await
        .unwrap();
    let kept = db
        .create_project("kept".into(), "/tmp/kept".into())
        .await
        .unwrap();
    for pid in [gone, kept] {
        db.conn()
            .call(move |c| {
                c.execute(
                    "INSERT INTO oculpm_agent_state (project_id, agent_id, last_hash, last_written_at)
                     VALUES (?1, 'claude-code', 'h', 0)",
                    [pid],
                )?;
                c.execute(
                    "INSERT INTO recall_stats (project_id, kind, ref, score, use_count, last_used)
                     VALUES (?1, 'journal', 'x', 0.5, 1, 0)",
                    [pid],
                )?;
                Ok::<(), tokio_rusqlite::Error>(())
            })
            .await
            .unwrap();
    }

    db.delete_project(gone).await.unwrap();

    for table in ["oculpm_agent_state", "recall_stats"] {
        let left = table_count(
            &db,
            format!("SELECT COUNT(*) FROM {table} WHERE project_id = {gone}"),
        )
        .await;
        assert_eq!(left, 0, "{table} 에 지운 프로젝트의 행이 남았다");
        let other = table_count(
            &db,
            format!("SELECT COUNT(*) FROM {table} WHERE project_id = {kept}"),
        )
        .await;
        assert_eq!(other, 1, "{table} 에서 남의 행까지 지웠다");
    }
}

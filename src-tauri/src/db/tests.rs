use super::*;
use tempfile::tempdir;

/// 러너가 건너뛴 마이그레이션의 결과를 다음 실행이 스스로 메운다.
///
/// 재현: main 의 028 이 더한 두 컬럼을 지우되 `user_version` 은 28 로 둔다 —
/// 병합되지 않은 브랜치가 같은 번호를 먼저 써 버린 DB 와 같은 상태다. 예전엔
/// 이 DB 에서 Today 를 열 때마다 `no such column: f.lines_added` 가 났다.
#[tokio::test]
async fn heals_a_column_a_reused_migration_number_skipped() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("ocul-pm.db");

    let db = Db::open(path.clone()).await.unwrap();
    db.conn()
        .call(|c| -> Result<()> {
            c.execute_batch(
                "ALTER TABLE oculpm_journal_files DROP COLUMN lines_added;
                 ALTER TABLE oculpm_journal_files DROP COLUMN lines_removed;",
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let version: i64 = db
        .conn()
        .call(|c| -> Result<i64> {
            let v = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            Ok(v)
        })
        .await
        .unwrap();
    assert_eq!(
        version,
        MIGRATIONS.last().unwrap().0,
        "user_version 은 그대로여야 재현이 성립한다"
    );
    drop(db);

    let db = Db::open(path).await.unwrap();
    let sums: (i64, i64) = db
        .conn()
        .call(|c| -> Result<(i64, i64)> {
            let v = c.query_row(
                "SELECT COALESCE(SUM(f.lines_added), 0), COALESCE(SUM(f.lines_removed), 0)
                   FROM oculpm_journal_files f
                   JOIN oculpm_journal j
                     ON j.project_id = f.project_id
                    AND j.relative_path = f.relative_path
                  WHERE j.project_id = ?1 AND j.workday = ?2",
                params![1_i64, "20260821"],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            Ok(v)
        })
        .await
        .unwrap();
    assert_eq!(sums, (0, 0), "Today 의 워크데이 합 질의가 다시 돌아야 한다");
}

/// 이미 컬럼이 있는 DB 를 두 번 열어도 아무 일도 없어야 한다 (멱등).
#[tokio::test]
async fn healing_is_a_no_op_on_an_intact_schema() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("ocul-pm.db");
    drop(Db::open(path.clone()).await.unwrap());
    let db = Db::open(path).await.unwrap();

    let count: i64 = db
        .conn()
        .call(|c| -> Result<i64> {
            let v = c.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('oculpm_journal_files')
                  WHERE name IN ('lines_added', 'lines_removed')",
                [],
                |r| r.get(0),
            )?;
            Ok(v)
        })
        .await
        .unwrap();
    assert_eq!(count, 2);
}

/// 새 `ADD COLUMN` 마이그레이션을 쓰면서 [`ADDITIVE_COLUMNS`] 에 적는 걸
/// 잊으면, 그 컬럼만 안전망 밖에 남는다 — 여기서 막는다.
#[test]
fn every_added_column_is_declared_for_healing() {
    for (version, sql) in MIGRATIONS {
        for line in sql.lines() {
            let line = line.trim();
            let Some(rest) = line.strip_prefix("ALTER TABLE ") else {
                continue;
            };
            let mut words = rest.split_whitespace();
            let table = words.next().unwrap_or_default();
            if words.next() != Some("ADD") || words.next() != Some("COLUMN") {
                continue;
            }
            let column = words.next().unwrap_or_default();
            assert!(
                ADDITIVE_COLUMNS
                    .iter()
                    .any(|(t, c, _)| *t == table && *c == column),
                "마이그레이션 {version} 의 {table}.{column} 이 ADDITIVE_COLUMNS 에 없다"
            );
        }
    }
}

/// 적용 이력이 `user_version` 정수 하나라, 등록이 어긋나면 마이그레이션이 영영
/// 안 돈다 — `025_fts.sql` 이 파일만 있고 등록되지 않은 채 v2 릴리스를 통과해
/// 검색이 넉 달 동안 LIKE 폴백으로만 돌았다(2026-08-30 감사). 등록 번호는
/// 단조 증가하고, 디스크의 모든 파일이 **파일명 번호 그대로** 등록돼야 한다.
#[test]
fn migration_registry_matches_disk() {
    for w in MIGRATIONS.windows(2) {
        assert!(
            w[0].0 < w[1].0,
            "등록 번호가 단조 증가해야 한다: {} → {}",
            w[0].0,
            w[1].0
        );
    }

    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut on_disk: Vec<i64> = std::fs::read_dir(&dir)
        .expect("migrations/ 디렉터리")
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".sql"))
        .map(|n| {
            let digits: String = n.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits
                .parse::<i64>()
                .unwrap_or_else(|_| panic!("마이그레이션 파일명은 숫자로 시작해야 한다: {n}"))
        })
        .collect();
    on_disk.sort_unstable();

    let registered: Vec<i64> = MIGRATIONS.iter().map(|(v, _)| *v).collect();
    assert_eq!(
        on_disk, registered,
        "migrations/*.sql 과 MIGRATIONS 등록이 다르다 — 파일만 있거나 번호가 어긋난 항목이 있다"
    );
}

/// 진단 탭이 보여 줄 크기 지표 — 새 DB 라도 0 이 아니어야 하고, dbstat 상위 표가
/// 채워져야 한다(번들 SQLite 에 DBSTAT 가 켜져 있다는 사실의 회귀 방지).
#[tokio::test]
async fn health_reports_sizes_and_top_tables() {
    let dir = tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let h = db.health().await.unwrap();
    assert!(h.db_bytes > 0.0);
    assert!(!h.top_tables.is_empty(), "dbstat 이 비어 있다");
    assert!(h.top_tables.windows(2).all(|w| w[0].bytes >= w[1].bytes));
    // 압축은 빈 DB 에서도 에러 없이 돈다 (VACUUM 은 트랜잭션 밖).
    db.compact().await.unwrap();
    assert!(db.health().await.unwrap().db_bytes > 0.0);
}

/// 발동 원장 적재는 CAS 다 — 같은 청크를 두 번 더하면 배지가 거짓말을 한다.
/// (a) 낡은 재개점의 적재는 버려지고, (b) 파일이 줄어 0 부터 다시 읽은 적재는
/// 옛 행을 지운 뒤 들어간다, (c) 비우기는 두 표를 함께 비운다.
#[tokio::test]
async fn firing_apply_scan_is_compare_and_swap() {
    let dir = tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    db.conn()
        .call(|c| -> Result<()> {
            c.execute_batch(
                "INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');",
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let row = |n: u32| {
        vec![(
            "rule".to_string(),
            "/r/a.md".to_string(),
            "20260830".to_string(),
            n,
            100u64,
        )]
    };
    async fn count(db: &Db) -> u32 {
        db.firing_aggregates(1, "20260101".into(), "20261231".into())
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.count)
            .sum::<u32>()
    }

    // 첫 적재: 재개점 0 → 100.
    assert!(db
        .firing_apply_scan(1, "s/x.jsonl".into(), 0, false, 100, row(1))
        .await
        .unwrap());
    assert_eq!(count(&db).await, 1);
    // 같은 청크를 낡은 재개점(0) 으로 또 — 버려진다.
    assert!(!db
        .firing_apply_scan(1, "s/x.jsonl".into(), 0, false, 100, row(1))
        .await
        .unwrap());
    assert_eq!(count(&db).await, 1, "이중 집계가 없어야 한다");
    // 이어 붙이기: 100 → 250.
    assert!(db
        .firing_apply_scan(1, "s/x.jsonl".into(), 100, false, 250, row(2))
        .await
        .unwrap());
    assert_eq!(count(&db).await, 3);
    // 회전: 파일이 줄어 0 부터 다시 읽음 — 옛 행을 지우고 새로.
    assert!(db
        .firing_apply_scan(1, "s/x.jsonl".into(), 250, true, 40, row(5))
        .await
        .unwrap());
    assert_eq!(count(&db).await, 5, "reset 은 가산이 아니라 교체");
    let points = db.firing_scan_points(1).await.unwrap();
    assert_eq!(points, vec![("s/x.jsonl".to_string(), 40u64)]);

    db.firing_clear(1).await.unwrap();
    assert_eq!(count(&db).await, 0);
    assert!(db.firing_scan_points(1).await.unwrap().is_empty());
    assert!(db.firing_last_scan_at(1).await.unwrap().is_none());
}

fn unit_vec(dim: usize, hot: usize) -> Vec<u8> {
    let mut v = vec![0f32; dim];
    v[hot] = 1.0;
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// 완성도 라운드 Phase 3 — `project_id` 가 vec0 partition key 라 KNN 이 다른
/// 프로젝트의 벡터를 아예 보지 않는다. 예전엔 `k` 를 5배 과다 조회한 뒤
/// `files.project_id` 로 걸렀다 — 다른 프로젝트가 크면 내 결과가 밀려났다.
#[tokio::test]
async fn knn_search_stays_inside_the_project_partition() {
    let dir = tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let a = db
        .create_project("a".into(), "/tmp/a".into())
        .await
        .unwrap();
    let b = db
        .create_project("b".into(), "/tmp/b".into())
        .await
        .unwrap();
    let (fa, _) = db
        .upsert_file(a, "src/a.rs".into(), "h1".into(), 1, 1, Some("rust".into()))
        .await
        .unwrap();
    let (fb, _) = db
        .upsert_file(b, "src/b.rs".into(), "h2".into(), 1, 1, Some("rust".into()))
        .await
        .unwrap();
    let row = |content: &str, hot: usize| ChunkInsert {
        kind: "fn".into(),
        start_line: 1,
        end_line: 3,
        content: content.into(),
        embedding: unit_vec(384, hot),
    };
    db.insert_chunks_with_embeddings(a, fa, vec![row("fn a() {\n}\n", 0)])
        .await
        .unwrap();
    // b 는 a 의 질의 벡터와 **완전히 같은** 임베딩을 셋 — 파티션이 없다면 이
    // 셋이 a 의 하나를 밀어낸다.
    db.insert_chunks_with_embeddings(
        b,
        fb,
        vec![
            row("fn b1() {\n}\n", 0),
            row("fn b2() {\n}\n", 0),
            row("fn b3() {\n}\n", 0),
        ],
    )
    .await
    .unwrap();

    let hits = db
        .search_chunks(a, unit_vec(384, 0), 1, false)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file_path, "src/a.rs");
    let hits_b = db
        .search_chunks(b, unit_vec(384, 0), 10, false)
        .await
        .unwrap();
    assert_eq!(hits_b.len(), 3);
    assert!(hits_b.iter().all(|h| h.file_path == "src/b.rs"));
}

/// 032 마이그레이션의 원시 연산 — 예전 모양의 vec0 표에서 파티션 키가 있는 새
/// 표로 `INSERT … SELECT` 가 벡터 blob 을 그대로 옮긴다 (sqlite-vec 0.1.9).
/// 이 한 문장이 안 되면 사용자 DB 의 임베딩이 통째로 사라지므로 따로 못 박는다.
#[tokio::test]
async fn vec0_rows_copy_between_old_and_partitioned_tables() {
    let dir = tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let query = unit_vec(384, 7);
    let n: i64 = db
        .conn()
        .call(move |c| -> Result<i64> {
            c.execute_batch(
                "CREATE VIRTUAL TABLE old_t USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384]);
                 CREATE VIRTUAL TABLE new_t USING vec0(
                   chunk_id INTEGER PRIMARY KEY,
                   project_id INTEGER PARTITION KEY,
                   embedding FLOAT[384]);",
            )?;
            c.execute(
                "INSERT INTO old_t (chunk_id, embedding) VALUES (?1, ?2)",
                params![1i64, unit_vec(384, 7)],
            )?;
            c.execute(
                "INSERT INTO old_t (chunk_id, embedding) VALUES (?1, ?2)",
                params![2i64, unit_vec(384, 9)],
            )?;
            c.execute_batch(
                "INSERT INTO new_t (chunk_id, project_id, embedding)
                   SELECT chunk_id, 1, embedding FROM old_t;",
            )?;
            let n: i64 = c.query_row("SELECT COUNT(*) FROM new_t", [], |r| r.get(0))?;
            let nearest: i64 = c.query_row(
                "SELECT chunk_id FROM new_t WHERE embedding MATCH ?1 AND k = 1 AND project_id = 1",
                params![query],
                |r| r.get(0),
            )?;
            assert_eq!(nearest, 1, "copied vectors must still be searchable");
            Ok(n)
        })
        .await
        .unwrap();
    assert_eq!(n, 2);
}

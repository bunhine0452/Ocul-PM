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
    // `drop` 이 아니라 닫힐 때까지 기다린다 — 안 그러면 아래 재열기가 닫는 중인
    // 연결의 잠금과 부딪힌다 (#db-win-locked-flake).
    db.close().await.unwrap();

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
    Db::open(path.clone()).await.unwrap().close().await.unwrap();
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

/// `{#snapshot-git-dup}` — `retain_file_snapshots` 는 keep 밖의 것을 전부
/// 지운다: HEAD 가 서빙하는 파일의 복사본도, 디스크에서 사라진 고아도. 다른
/// 프로젝트는 손대지 않는다.
#[tokio::test]
async fn retain_file_snapshots_drops_unlisted_and_orphans() {
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
    for (pid, path) in [
        (a, "src/tracked.rs"),
        (a, "src/untracked.rs"),
        (a, ".vscode-test/orphan.js"), // 디스크에서 사라진 고아
        (b, "src/tracked.rs"),
    ] {
        db.upsert_file_snapshot(pid, path.into(), b"x".to_vec(), "h".into())
            .await
            .unwrap();
    }

    let removed = db
        .retain_file_snapshots(a, vec!["src/untracked.rs".into()])
        .await
        .unwrap();
    assert_eq!(removed, 2, "HEAD 복사본 하나 + 고아 하나");
    assert!(db
        .get_file_snapshot(a, "src/untracked.rs".into())
        .await
        .unwrap()
        .is_some());
    assert!(db
        .get_file_snapshot(a, "src/tracked.rs".into())
        .await
        .unwrap()
        .is_none());
    assert!(db
        .get_file_snapshot(a, ".vscode-test/orphan.js".into())
        .await
        .unwrap()
        .is_none());
    assert!(
        db.get_file_snapshot(b, "src/tracked.rs".into())
            .await
            .unwrap()
            .is_some(),
        "다른 프로젝트는 무사하다"
    );

    // 빈 keep = 전부 지운다 (비-git 파일이 하나도 없는 프로젝트).
    assert_eq!(db.retain_file_snapshots(a, vec![]).await.unwrap(), 1);
    db.delete_file_snapshot(b, "src/tracked.rs".into())
        .await
        .unwrap();
    assert!(db
        .get_file_snapshot(b, "src/tracked.rs".into())
        .await
        .unwrap()
        .is_none());
}

/// 새 버전이 쌓은 DB(더 높은 `user_version`)는 열지 않는다 — 모르는 스키마 위에서
/// 도는 대신 기동 대화상자가 이유를 보인다.
#[tokio::test]
async fn refuses_a_database_from_a_newer_app() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("ocul-pm.db");
    let db = Db::open(path.clone()).await.unwrap();
    let latest = registry::MIGRATIONS.last().unwrap().0;
    db.conn()
        .call(move |c| -> Result<()> {
            c.pragma_update(None, "user_version", latest + 1)?;
            Ok(())
        })
        .await
        .unwrap();
    db.close().await.unwrap();

    let err = Db::open(path).await.err().expect("더 새 스키마를 열었다");
    assert!(err.to_string().contains("newer than this app"), "{err}");
}

/// 사본은 하나만 남는다 — 버전마다 수백 MB 를 쌓지 않는다.
#[tokio::test]
async fn keeps_only_the_latest_pre_migration_backup() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("ocul-pm.db");
    let db = Db::open(path.clone()).await.unwrap();
    db.backup_before_migration(30).await;
    assert!(dir.path().join("ocul-pm.db.bak-v30").is_file());
    db.backup_before_migration(31).await;
    assert!(dir.path().join("ocul-pm.db.bak-v31").is_file());
    assert!(!dir.path().join("ocul-pm.db.bak-v30").exists());
}

/// 043 — 4.0 이 코드 색인을 걷는다. 3.x 가 쌓은 DB(042 까지의 스키마 + 색인 표 ·
/// vec0 · 그 그림자 표에 행이 든 상태)를 새 앱이 열면 색인 표가 전부 사라지고,
/// diff 기준선(`file_snapshots`)과 일지 캐시는 그대로다. vec0 가상 표의 DROP 은
/// sqlite-vec 가 로드돼 있어야 되므로 그 경로를 실제로 탄다. 파괴적이라 열기 전
/// 사본(`.bak-v42`)이 남는다.
#[tokio::test]
async fn migration_043_drops_the_code_index_but_keeps_baselines() {
    let dir = tempdir().unwrap();
    // sqlite-vec 자동 확장은 프로세스에 한 번 걸린다 — 아래 날 연결도 받는다.
    Db::open(dir.path().join("warm.db")).await.unwrap();

    let path = dir.path().join("ocul-pm.db");
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for (v, sql) in registry::MIGRATIONS.iter().filter(|(v, _)| *v <= 42) {
            c.execute_batch(sql).unwrap();
            c.pragma_update(None, "user_version", v).unwrap();
        }
        c.execute_batch(
            "INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');
             INSERT INTO files (id, project_id, path, hash, size, mtime)
               VALUES (10, 1, 'src/a.rs', 'h', 1, 0), (11, 1, 'src/b.rs', 'h', 1, 0);
             INSERT INTO chunks (id, file_id, kind, start_line, end_line, content)
               VALUES (100, 10, 'lines', 1, 2, 'fn a() {}');
             INSERT INTO symbol_definitions
               (file_id, name, kind, start_line, end_line, start_byte, end_byte)
               VALUES (10, 'a', 'function', 1, 2, 0, 9);
             INSERT INTO file_dependencies (project_id, source_file_id, target_file_id)
               VALUES (1, 10, 11);
             INSERT INTO file_snapshots (project_id, path, content, hash, captured_at)
               VALUES (1, 'notes.txt', x'78', 'h', 0);",
        )
        .unwrap();
        c.execute(
            "INSERT INTO chunk_embeddings (chunk_id, project_id, embedding) VALUES (100, 1, ?1)",
            [vec![0u8; 384 * 4]],
        )
        .unwrap();
        let shadow: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'chunk_embeddings_%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(shadow > 0, "3.x DB 에는 vec0 그림자 표가 있다");
    }

    let db = Db::open(path.clone()).await.unwrap();
    let (left, version, snaps): (Vec<String>, i64, i64) = db
        .conn()
        .call(|c| -> Result<_> {
            let mut stmt = c.prepare(
                "SELECT name FROM sqlite_master
                 WHERE name IN ('files', 'chunks', 'symbol_definitions', 'file_dependencies',
                                'graph_nodes', 'graph_edges', 'symbol_relations',
                                'chunks_after_delete')
                    OR name LIKE 'chunk_embeddings%'",
            )?;
            let left = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let version = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            let snaps = c.query_row("SELECT COUNT(*) FROM file_snapshots", [], |r| r.get(0))?;
            Ok((left, version, snaps))
        })
        .await
        .unwrap();
    assert!(left.is_empty(), "색인 표가 남았다: {left:?}");
    assert_eq!(version, 43);
    assert_eq!(snaps, 1, "diff 기준선은 남는다");
    assert!(dir.path().join("ocul-pm.db.bak-v42").is_file());
    // 이미 지운 DB 를 다시 열어도 (`IF EXISTS`) 아무 일 없다.
    db.close().await.unwrap();
    Db::open(path).await.unwrap();
}

#[test]
fn only_statements_that_remove_data_count_as_destructive() {
    assert!(is_destructive("DROP TABLE retro_insights;"));
    assert!(is_destructive("delete from chunks where 1;"));
    assert!(!is_destructive(
        "CREATE TABLE a (id INTEGER REFERENCES b(id) ON DELETE CASCADE);"
    ));
    assert!(!is_destructive(
        "CREATE TRIGGER t AFTER DELETE ON chunks BEGIN SELECT 1; END;"
    ));
}

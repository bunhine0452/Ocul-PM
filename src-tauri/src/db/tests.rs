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
    assert_eq!(version, MIGRATIONS.last().unwrap().0, "user_version 은 그대로여야 재현이 성립한다");
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

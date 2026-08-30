//! AD-1 발동 원장의 파생 캐시 접근자 (migrations/030_context_firings.sql).
//!
//! SSOT 는 transcript 파일이다 — 여기 있는 건 전부 재스캔으로 복구되는 집계다.
//! 쓰기는 UPSERT 뿐이라 같은 파일을 다시 스캔해도 결과가 같다(멱등).

use super::*;

/// 창(window) 집계 1행 — 커맨드가 라벨만 붙여 프런트로 넘긴다.
#[derive(Debug, Clone)]
pub struct FiringAggregate {
    pub kind: String,
    pub key: String,
    pub count: u32,
    pub bytes: u64,
    pub sessions: u32,
    pub last_workday: Option<String>,
}

impl Db {
    /// 파일별 재개점 — `(session_file, bytes_consumed)`.
    pub async fn firing_scan_points(&self, project_id: u32) -> Result<Vec<(String, u64)>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT session_file, bytes_consumed
                     FROM context_firing_scan WHERE project_id = ?1",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
    }

    /// 한 파일의 스캔 결과를 반영한다 — 집계 행 UPSERT + 재개점 갱신을
    /// 한 트랜잭션으로. 중간에 죽어도 오프셋만 앞서가는 일은 없다.
    ///
    /// 가산 UPSERT 가 옳으려면 **같은 청크가 두 번 더해지지 않아야** 한다.
    /// 그래서 (a) `expected_resume` 로 CAS 한다 — 트랜잭션 안에서 읽은 재개점이
    /// 기대값과 다르면(다른 스캔이 먼저 앞서갔다) 아무것도 쓰지 않고 `false`,
    /// (b) `reset`(파일이 줄어 0 부터 다시 읽음) 이면 이 세션 파일의 기존
    /// 행을 먼저 지운다. 둘 다 없던 2026-08-29 판은 탭 전환마다 재마운트되는
    /// 훅이 동시에 스캔하면 이중 집계가 영구히 남았다.
    pub async fn firing_apply_scan(
        &self,
        project_id: u32,
        session_file: String,
        expected_resume: u64,
        reset: bool,
        bytes_consumed: u64,
        rows: Vec<(String, String, String, u32, u64)>,
    ) -> Result<bool> {
        let applied = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                let current: Option<i64> = tx
                    .query_row(
                        "SELECT bytes_consumed FROM context_firing_scan
                         WHERE project_id = ?1 AND session_file = ?2",
                        params![project_id as i64, &session_file],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.unwrap_or(0) as u64 != expected_resume {
                    // 다른 스캔이 이 파일을 먼저 소비했다 — 이 청크는 이미
                    // 반영됐거나 그쪽 재개점이 정답이다. 조용히 버린다.
                    return Ok(false);
                }
                if reset {
                    tx.execute(
                        "DELETE FROM context_firings
                         WHERE project_id = ?1 AND session_file = ?2",
                        params![project_id as i64, &session_file],
                    )?;
                }
                for (kind, key, workday, count, bytes) in rows {
                    tx.execute(
                        "INSERT INTO context_firings (
                            project_id, kind, key, workday, session_file, count, bytes
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                         ON CONFLICT(project_id, kind, key, workday, session_file) DO UPDATE SET
                            count = count + excluded.count,
                            bytes = bytes + excluded.bytes",
                        params![
                            project_id as i64,
                            kind,
                            key,
                            workday,
                            session_file,
                            count as i64,
                            bytes as i64,
                        ],
                    )?;
                }
                tx.execute(
                    "INSERT INTO context_firing_scan (
                        project_id, session_file, bytes_consumed, scanned_at
                     ) VALUES (?1, ?2, ?3, unixepoch())
                     ON CONFLICT(project_id, session_file) DO UPDATE SET
                        bytes_consumed = excluded.bytes_consumed,
                        scanned_at = excluded.scanned_at",
                    params![project_id as i64, session_file, bytes_consumed as i64],
                )?;
                tx.commit()?;
                Ok(true)
            })
            .await?;
        Ok(applied)
    }

    /// 원장을 통째로 비운다 — `firing_rebuild` 의 첫 단계. SSOT 는 transcript
    /// 라 잃는 것이 없고, 이중 집계·낡은 재개점을 되돌릴 유일한 길이다.
    pub async fn firing_clear(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM context_firings WHERE project_id = ?1",
                    params![project_id as i64],
                )?;
                tx.execute(
                    "DELETE FROM context_firing_scan WHERE project_id = ?1",
                    params![project_id as i64],
                )?;
                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// workday 창의 발동 집계 (발동 많은 순).
    pub async fn firing_aggregates(
        &self,
        project_id: u32,
        since: String,
        until: String,
    ) -> Result<Vec<FiringAggregate>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT kind, key, SUM(count), SUM(bytes),
                            COUNT(DISTINCT session_file), MAX(workday)
                     FROM context_firings
                     WHERE project_id = ?1 AND workday >= ?2 AND workday <= ?3
                     GROUP BY kind, key
                     ORDER BY SUM(count) DESC, key ASC",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64, since, until], |r| {
                        Ok(FiringAggregate {
                            kind: r.get(0)?,
                            key: r.get(1)?,
                            count: r.get::<_, i64>(2)? as u32,
                            bytes: r.get::<_, i64>(3)? as u64,
                            sessions: r.get::<_, i64>(4)? as u32,
                            last_workday: r.get(5)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
    }

    /// 창 안에서 발동이 하나라도 관측된 세션 수 — 세션당 예산의 분모.
    pub async fn firing_session_count(
        &self,
        project_id: u32,
        since: String,
        until: String,
    ) -> Result<u32> {
        let n = self
            .conn
            .call(move |c| {
                let n: i64 = c.query_row(
                    "SELECT COUNT(DISTINCT session_file) FROM context_firings
                     WHERE project_id = ?1 AND workday >= ?2 AND workday <= ?3",
                    params![project_id as i64, since, until],
                    |r| r.get(0),
                )?;
                Ok(n)
            })
            .await?;
        Ok(n as u32)
    }

    /// 마지막 스캔 시각 (unix). 한 번도 안 돌았으면 None.
    pub async fn firing_last_scan_at(&self, project_id: u32) -> Result<Option<u32>> {
        let at = self
            .conn
            .call(move |c| {
                let at: Option<i64> = c.query_row(
                    "SELECT MAX(scanned_at) FROM context_firing_scan WHERE project_id = ?1",
                    params![project_id as i64],
                    |r| r.get(0),
                )?;
                Ok(at)
            })
            .await?;
        Ok(at.map(|v| v as u32))
    }
}

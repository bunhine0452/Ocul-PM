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

/// `firing_apply_scan` 에 넘기는 집계 행. 튜플 6칸이 되면서 자리를 헷갈릴 수
/// 있게 됐다 — 이름을 붙인다.
#[derive(Debug, Clone)]
pub struct FiringScanRow {
    pub kind: String,
    pub key: String,
    pub workday: String,
    pub count: u32,
    pub bytes: u64,
    pub last_prompt: Option<String>,
    pub last_ts: i64,
}

impl Db {
    /// 파일별 재개점 — `(session_file, bytes_consumed, 이월 프롬프트)`.
    /// 셋째 값은 지난 스캔이 그 파일 끝에서 들고 있던 사용자 프롬프트다
    /// (`#firing-quotes` — 재개점이 프롬프트와 발동 사이에 놓이는 경우).
    #[allow(clippy::type_complexity)]
    pub async fn firing_scan_points(
        &self,
        project_id: u32,
    ) -> Result<Vec<(String, u64, Option<String>)>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT session_file, bytes_consumed, last_prompt
                     FROM context_firing_scan WHERE project_id = ?1",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)? as u64,
                            r.get::<_, Option<String>>(2)?,
                        ))
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
        carry_prompt: Option<String>,
        rows: Vec<FiringScanRow>,
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
                for row in rows {
                    // 인용은 가산이 아니라 **가장 늦은 것으로 교체**다. SQLite 의
                    // DO UPDATE SET 은 우변을 갱신 전 행으로 평가하므로 두 줄의
                    // 순서에 의존하지 않는다.
                    tx.execute(
                        "INSERT INTO context_firings (
                            project_id, kind, key, workday, session_file, count, bytes,
                            last_prompt, last_ts
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                         ON CONFLICT(project_id, kind, key, workday, session_file) DO UPDATE SET
                            count = count + excluded.count,
                            bytes = bytes + excluded.bytes,
                            last_prompt = CASE WHEN excluded.last_ts >= last_ts
                                               THEN excluded.last_prompt ELSE last_prompt END,
                            last_ts = MAX(last_ts, excluded.last_ts)",
                        params![
                            project_id as i64,
                            row.kind,
                            row.key,
                            row.workday,
                            session_file,
                            row.count as i64,
                            row.bytes as i64,
                            row.last_prompt,
                            row.last_ts,
                        ],
                    )?;
                }
                tx.execute(
                    "INSERT INTO context_firing_scan (
                        project_id, session_file, bytes_consumed, scanned_at, last_prompt
                     ) VALUES (?1, ?2, ?3, unixepoch(), ?4)
                     ON CONFLICT(project_id, session_file) DO UPDATE SET
                        bytes_consumed = excluded.bytes_consumed,
                        scanned_at = excluded.scanned_at,
                        last_prompt = excluded.last_prompt",
                    params![
                        project_id as i64,
                        session_file,
                        bytes_consumed as i64,
                        carry_prompt
                    ],
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

    /// 한 항목의 발동 인용 — 최근순 (`#firing-quotes`).
    ///
    /// 프롬프트가 없는 행은 뺀다. 인용이 없다는 것과 발동이 없다는 것은 다르고,
    /// 빈 줄을 「최근 이렇게 불렀다」로 보여 주면 거짓말이 된다.
    pub async fn firing_quotes(
        &self,
        project_id: u32,
        kind: String,
        key: String,
        since: String,
        limit: u32,
    ) -> Result<Vec<(String, String, u32)>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT workday, last_prompt, count
                     FROM context_firings
                     WHERE project_id = ?1 AND kind = ?2 AND key = ?3
                       AND workday >= ?4 AND last_prompt IS NOT NULL AND last_prompt <> ''
                     ORDER BY last_ts DESC, workday DESC
                     LIMIT ?5",
                )?;
                let out = stmt
                    .query_map(
                        params![project_id as i64, kind, key, since, limit as i64],
                        |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, i64>(2)? as u32,
                            ))
                        },
                    )?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
    }

    /// 주어진 세션들의 **규칙** 주입 바이트 합 — 세션 창 예산의 분자.
    ///
    /// 분모(세션 수)는 디스크의 transcript 에서 오고 여기서는 그 세션들의 몫만
    /// 더한다. 원장에 행이 없는 세션은 규칙이 안 걸린 세션이라 0 으로 잡히는
    /// 것이 맞다 — 종전처럼 분모에서 빼면 평균이 부풀려진다.
    pub async fn firing_rule_bytes_for_sessions(
        &self,
        project_id: u32,
        session_files: Vec<String>,
    ) -> Result<u64> {
        if session_files.is_empty() {
            return Ok(0);
        }
        let bytes = self
            .conn
            .call(move |c| {
                let holes = vec!["?"; session_files.len()].join(",");
                let sql = format!(
                    "SELECT COALESCE(SUM(bytes), 0) FROM context_firings
                     WHERE project_id = ? AND kind = ? AND session_file IN ({holes})"
                );
                let mut vals: Vec<rusqlite::types::Value> =
                    Vec::with_capacity(session_files.len() + 2);
                vals.push(rusqlite::types::Value::Integer(project_id as i64));
                vals.push(rusqlite::types::Value::Text(
                    crate::oculpm::firing_ledger::KIND_RULE.to_string(),
                ));
                vals.extend(session_files.into_iter().map(rusqlite::types::Value::Text));
                let n: i64 =
                    c.query_row(&sql, rusqlite::params_from_iter(vals), |r| r.get(0))?;
                Ok(n)
            })
            .await?;
        Ok(bytes.max(0) as u64)
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

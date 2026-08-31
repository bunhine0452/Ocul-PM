//! 자동화 런타임 상태의 파생 캐시 접근자 (migrations/033_automation.sql).
//!
//! SSOT 는 `.oculpm/automation/{schedules,watchers}/<id>.md` 다 (Decision 1) —
//! 여기 있는 건 전부 정의 파일에서 재생성되는 상태와, 되짚어 볼 실행 이력이다.
//! 정의가 사라지면 상태·이력도 지운다([`Db::automation_prune_orphans`]).
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각 — 다른 db/*.rs 와 같은 결.

use super::*;

/// 스케줄/워처 하나의 런타임 상태 (`automation_state` 한 행).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutomationState {
    pub automation_id: String,
    /// ISO8601. 스케줄만 채운다.
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
}

/// 실행 이력 한 건 (`automation_runs` 한 행). 드롭·스킵도 남는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutomationRun {
    pub id: i64,
    pub automation_id: String,
    pub session_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub journal_path: Option<String>,
    pub note: Option<String>,
}

/// `automation_runs.status` 어휘. 문자열 오타로 조용히 갈라지지 않게 한곳에 둔다.
pub const RUN_OK: &str = "ok";
pub const RUN_FAILED: &str = "failed";
pub const RUN_SKIPPED: &str = "skipped";
pub const RUN_DROPPED: &str = "dropped";
pub const RUN_CANCELLED: &str = "cancelled";

#[allow(dead_code)] // 목록/이력 조회는 Phase 1 의 자동화 탭이 소비한다.
impl Db {
    pub async fn automation_state_list(&self, project_id: u32) -> Result<Vec<AutomationState>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT automation_id, next_run_at, last_run_at, last_status, last_error
                     FROM automation_state WHERE project_id = ?1
                     ORDER BY automation_id ASC",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64], |r| {
                        Ok(AutomationState {
                            automation_id: r.get(0)?,
                            next_run_at: r.get(1)?,
                            last_run_at: r.get(2)?,
                            last_status: r.get(3)?,
                            last_error: r.get(4)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
    }

    /// 상태 행을 통째로 덮어쓴다 (읽고-고쳐-쓰는 호출부가 전체 모양을 들고 온다).
    pub async fn automation_state_upsert(
        &self,
        project_id: u32,
        st: AutomationState,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO automation_state
                       (project_id, automation_id, next_run_at, last_run_at, last_status, last_error)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(project_id, automation_id) DO UPDATE SET
                       next_run_at = excluded.next_run_at,
                       last_run_at = excluded.last_run_at,
                       last_status = excluded.last_status,
                       last_error  = excluded.last_error",
                    params![
                        project_id as i64,
                        st.automation_id,
                        st.next_run_at,
                        st.last_run_at,
                        st.last_status,
                        st.last_error
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 파일 SSOT 고아 정리 — `known` 에 없는 정의의 상태·이력을 지운다.
    /// 반환값은 지운 상태 행 수.
    ///
    /// **호출부 계약**: `known` 은 디렉터리를 **성공적으로 읽은** 결과여야 한다.
    /// 읽기에 실패해 빈 벡터를 넘기면 이 함수는 프로젝트의 상태를 전부 지운다
    /// (정의가 하나도 없는 프로젝트와 구분할 방법이 없다).
    pub async fn automation_prune_orphans(
        &self,
        project_id: u32,
        known: Vec<String>,
    ) -> Result<u32> {
        let removed = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                let removed = if known.is_empty() {
                    let n = tx.execute(
                        "DELETE FROM automation_state WHERE project_id = ?1",
                        params![project_id as i64],
                    )?;
                    tx.execute(
                        "DELETE FROM automation_runs WHERE project_id = ?1",
                        params![project_id as i64],
                    )?;
                    n
                } else {
                    // 목록 길이만큼 자리표시자를 만든다 (id 는 kebab 로 정규화돼
                    // 있지만 문자열 보간은 하지 않는다).
                    let holes = (0..known.len())
                        .map(|i| format!("?{}", i + 2))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut args: Vec<Box<dyn rusqlite::ToSql>> =
                        Vec::with_capacity(1 + known.len());
                    args.push(Box::new(project_id as i64));
                    for id in &known {
                        args.push(Box::new(id.clone()));
                    }
                    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
                    let n = tx.execute(
                        &format!(
                            "DELETE FROM automation_state
                             WHERE project_id = ?1 AND automation_id NOT IN ({holes})"
                        ),
                        refs.as_slice(),
                    )?;
                    tx.execute(
                        &format!(
                            "DELETE FROM automation_runs
                             WHERE project_id = ?1 AND automation_id NOT IN ({holes})"
                        ),
                        refs.as_slice(),
                    )?;
                    n
                };
                tx.commit()?;
                Ok(removed as u32)
            })
            .await?;
        Ok(removed)
    }

    /// 실행 시작을 원장에 적고 run id 를 돌려준다. 끝나면
    /// [`Db::automation_run_finish`] 로 닫는다 — 앱이 죽으면 `ended_at` 이
    /// 비어 남고, 그 자체가 "돌다 말았다" 는 정직한 기록이다.
    pub async fn automation_run_start(
        &self,
        project_id: u32,
        automation_id: String,
        session_id: String,
        started_at: String,
        status: String,
    ) -> Result<i64> {
        let id = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO automation_runs
                       (project_id, automation_id, session_id, started_at, status)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        project_id as i64,
                        automation_id,
                        session_id,
                        started_at,
                        status
                    ],
                )?;
                Ok(c.last_insert_rowid())
            })
            .await?;
        Ok(id)
    }

    pub async fn automation_run_finish(
        &self,
        run_id: i64,
        status: String,
        ended_at: String,
        journal_path: Option<String>,
        note: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE automation_runs
                     SET status = ?2, ended_at = ?3, journal_path = ?4, note = ?5
                     WHERE id = ?1",
                    params![run_id, status, ended_at, journal_path, note],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 실행 이력 역순. `automation_id` 가 `None` 이면 프로젝트 전체.
    pub async fn automation_runs_list(
        &self,
        project_id: u32,
        automation_id: Option<String>,
        limit: u32,
    ) -> Result<Vec<AutomationRun>> {
        let lim = limit.clamp(1, 500) as i64;
        let rows = self
            .conn
            .call(move |c| {
                let map = |r: &rusqlite::Row<'_>| {
                    Ok(AutomationRun {
                        id: r.get(0)?,
                        automation_id: r.get(1)?,
                        session_id: r.get(2)?,
                        started_at: r.get(3)?,
                        ended_at: r.get(4)?,
                        status: r.get(5)?,
                        journal_path: r.get(6)?,
                        note: r.get(7)?,
                    })
                };
                const COLS: &str = "id, automation_id, session_id, started_at, ended_at, \
                                    status, journal_path, note";
                let out = match automation_id {
                    Some(aid) => {
                        let mut stmt = c.prepare(&format!(
                            "SELECT {COLS} FROM automation_runs
                             WHERE project_id = ?1 AND automation_id = ?2
                             ORDER BY started_at DESC, id DESC LIMIT ?3"
                        ))?;
                        let rows = stmt
                            .query_map(params![project_id as i64, aid, lim], map)?
                            .collect::<std::result::Result<Vec<_>, _>>()?;
                        rows
                    }
                    None => {
                        let mut stmt = c.prepare(&format!(
                            "SELECT {COLS} FROM automation_runs
                             WHERE project_id = ?1
                             ORDER BY started_at DESC, id DESC LIMIT ?2"
                        ))?;
                        let rows = stmt
                            .query_map(params![project_id as i64, lim], map)?
                            .collect::<std::result::Result<Vec<_>, _>>()?;
                        rows
                    }
                };
                Ok(out)
            })
            .await?;
        Ok(rows)
    }

    /// 일일 예산 판정용 — `started_at >= since` 이면서 **실제로 모델을 부른**
    /// 실행 건수. 드롭·스킵은 과금되지 않았으므로 세지 않는다.
    pub async fn automation_billable_runs_since(
        &self,
        project_id: u32,
        since: String,
    ) -> Result<u32> {
        let n = self
            .conn
            .call(move |c| {
                let n: i64 = c.query_row(
                    "SELECT COUNT(*) FROM automation_runs
                     WHERE project_id = ?1 AND started_at >= ?2
                       AND status NOT IN ('dropped', 'skipped')",
                    params![project_id as i64, since],
                    |r| r.get(0),
                )?;
                Ok(n)
            })
            .await?;
        Ok(n as u32)
    }
}

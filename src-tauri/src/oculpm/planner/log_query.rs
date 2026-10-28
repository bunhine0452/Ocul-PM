//! 플랜 하나의 **변경 로그 전체** — 항목별 `item_history` 의 플랜 단위 쌍 (UI 밀도 라운드 3).
//!
//! 플래너 시안의 「변경 로그 N행」 접힘이 읽는다. 투영은 `PlanCache::reproject_all` 이
//! 이미 한 뒤라 여기서는 `oculpm_plan_item_updates` 를 플랜 열쇠로 읽기만 한다 —
//! `project.rs` 가 파일 크기 래칫에 닿아 질의 하나를 이 모듈로 뺐다.

use rusqlite::params;

use crate::db::Db;

use super::project::PlanItemUpdateDto;

/// 플랜의 로그 행 전부, 시각 오름차순. 투영이 끝난 뒤에 부른다.
pub async fn plan_log_rows(
    db: &Db,
    project_id: u32,
    plan_id: &str,
) -> Result<Vec<PlanItemUpdateDto>, String> {
    let pid = project_id as i64;
    let plan = plan_id.to_string();
    db.conn()
        .call(
            move |c| -> Result<Vec<PlanItemUpdateDto>, tokio_rusqlite::Error> {
                let mut stmt = c.prepare(
                    "SELECT ts, item_id, agent_id, from_status, to_status, journal_ref, note
                     FROM oculpm_plan_item_updates
                     WHERE project_id = ?1 AND plan_id = ?2
                     ORDER BY ts",
                )?;
                let rows = stmt
                    .query_map(params![pid, plan], |r| {
                        Ok(PlanItemUpdateDto {
                            ts: r.get(0)?,
                            item_id: r.get(1)?,
                            agent_id: r.get(2)?,
                            from_status: r.get(3)?,
                            to_status: r.get(4)?,
                            journal_ref: r.get(5)?,
                            note: r.get(6)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            },
        )
        .await
        .map_err(|e| e.to_string())
}

//! 목표·서브태스크·회고·블루프린트 — 대시보드 집계 포함.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
    /// v2 U10 (C1) — 활성 플랜들의 미완 항목 (todo/in_progress/blocked).
    /// 진행중 우선, 그다음 최근 갱신 플랜, 플랜 내 순서 유지 (Today "다음 할 일"
    /// 위젯과 스탠드업이 같은 순서를 공유).
    pub async fn list_open_plan_items(
        &self,
        project_id: u32,
        cap: u32,
    ) -> Result<Vec<OpenPlanItem>> {
        let lim = cap.clamp(1, 100) as i64;
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT p.plan_id, p.title, i.item_id, i.title, i.phase, i.status
                     FROM oculpm_plan_items i
                     JOIN oculpm_plans p
                       ON p.project_id = i.project_id AND p.plan_id = i.plan_id
                     WHERE i.project_id = ?1 AND p.status = 'active'
                       AND i.status IN ('todo', 'in_progress', 'blocked')
                     ORDER BY (i.status = 'in_progress') DESC, p.updated_at DESC, i.order_idx ASC
                     LIMIT ?2",
                )?;
                let rows = stmt
                    .query_map(params![project_id as i64, lim], |r| {
                        Ok(OpenPlanItem {
                            plan_id: r.get(0)?,
                            plan_title: r.get(1)?,
                            item_id: r.get(2)?,
                            item_title: r.get(3)?,
                            phase: r.get(4)?,
                            status: r.get(5)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(rows)
    }

    // ---------- Goals ----------

    // ---------- Subtasks ----------
}

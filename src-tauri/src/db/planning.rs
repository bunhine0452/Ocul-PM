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

    pub async fn create_goal(
        &self,
        project_id: Option<u32>,
        title: String,
        description: Option<String>,
        priority: i32,
        due_date: Option<i32>,
    ) -> Result<Goal> {
        let goal = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO goals (project_id, title, description, priority, due_date)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        project_id.map(|id| id as i64),
                        &title,
                        &description,
                        priority,
                        due_date
                    ],
                )?;
                let id = c.last_insert_rowid();
                c.query_row(
                    "SELECT id, project_id, title, description, status, priority,
                            due_date, progress, created_at, updated_at
                     FROM goals WHERE id = ?1",
                    [id],
                    goal_from_row,
                )
            })
            .await?;
        Ok(goal)
    }

    pub async fn list_goals(
        &self,
        project_id: Option<u32>,
        status_filter: Option<String>,
    ) -> Result<Vec<Goal>> {
        let goals = self
            .conn
            .call(move |c| {
                let mut sql = String::from(
                    "SELECT id, project_id, title, description, status, priority,
                            due_date, progress, created_at, updated_at
                     FROM goals WHERE 1=1",
                );
                let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

                if let Some(pid) = project_id {
                    sql.push_str(" AND project_id = ?");
                    param_values.push(Box::new(pid as i64));
                }
                if let Some(ref status) = status_filter {
                    sql.push_str(" AND status = ?");
                    param_values.push(Box::new(status.clone()));
                }
                sql.push_str(" ORDER BY priority DESC, due_date ASC NULLS LAST, id DESC");

                let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                    param_values.iter().map(|p| p.as_ref()).collect();
                let mut stmt = c.prepare(&sql)?;
                let rows = stmt
                    .query_map(params_ref.as_slice(), goal_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(goals)
    }

    pub async fn get_goal(&self, goal_id: u32) -> Result<Goal> {
        let goal = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT id, project_id, title, description, status, priority,
                            due_date, progress, created_at, updated_at
                     FROM goals WHERE id = ?1",
                    [goal_id as i64],
                    goal_from_row,
                )
            })
            .await?;
        Ok(goal)
    }

    pub async fn dashboard_stats(&self, project_id: Option<u32>) -> Result<DashboardStats> {
        let stats = self
            .conn
            .call(move |c| {
                let filter = if let Some(pid) = project_id {
                    format!("WHERE project_id = {}", pid)
                } else {
                    String::new()
                };

                let total: u32 = c.query_row(
                    &format!("SELECT COUNT(*) FROM goals {filter}"),
                    [],
                    |r| r.get(0),
                )?;
                let open: u32 = c.query_row(
                    &format!("SELECT COUNT(*) FROM goals {filter} {} status = 'open'",
                        if filter.is_empty() { "WHERE" } else { "AND" }),
                    [],
                    |r| r.get(0),
                )?;
                let in_progress: u32 = c.query_row(
                    &format!("SELECT COUNT(*) FROM goals {filter} {} status = 'in_progress'",
                        if filter.is_empty() { "WHERE" } else { "AND" }),
                    [],
                    |r| r.get(0),
                )?;
                let done: u32 = c.query_row(
                    &format!("SELECT COUNT(*) FROM goals {filter} {} status = 'done'",
                        if filter.is_empty() { "WHERE" } else { "AND" }),
                    [],
                    |r| r.get(0),
                )?;
                let cancelled: u32 = c.query_row(
                    &format!("SELECT COUNT(*) FROM goals {filter} {} status = 'cancelled'",
                        if filter.is_empty() { "WHERE" } else { "AND" }),
                    [],
                    |r| r.get(0),
                )?;

                let avg_progress: f64 = c.query_row(
                    &format!("SELECT COALESCE(AVG(progress), 0.0) FROM goals {filter} {} status IN ('open','in_progress')",
                        if filter.is_empty() { "WHERE" } else { "AND" }),
                    [],
                    |r| r.get(0),
                )?;

                // Overdue: has due_date in the past & not done/cancelled
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i32;
                let overdue: u32 = c.query_row(
                    &format!(
                        "SELECT COUNT(*) FROM goals {filter} {} due_date IS NOT NULL AND due_date < ? AND status NOT IN ('done','cancelled')",
                        if filter.is_empty() { "WHERE" } else { "AND" }
                    ),
                    [now],
                    |r| r.get(0),
                )?;

                // Due today (within 24h)
                let today_end = now + 86400;
                let due_today: u32 = c.query_row(
                    &format!(
                        "SELECT COUNT(*) FROM goals {filter} {} due_date IS NOT NULL AND due_date >= ? AND due_date < ? AND status NOT IN ('done','cancelled')",
                        if filter.is_empty() { "WHERE" } else { "AND" }
                    ),
                    params![now, today_end],
                    |r| r.get(0),
                )?;

                Ok(DashboardStats {
                    total,
                    open,
                    in_progress,
                    done,
                    cancelled,
                    overdue,
                    due_today,
                    avg_progress,
                })
            })
            .await?;
        Ok(stats)
    }

    // ---------- Subtasks ----------

    pub async fn list_subtasks(&self, goal_id: u32) -> Result<Vec<Subtask>> {
        let subtasks = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, goal_id, title, done, sort_order
                     FROM subtasks WHERE goal_id = ? ORDER BY sort_order ASC",
                )?;
                let rows = stmt
                    .query_map([goal_id as i64], |r| {
                        Ok(Subtask {
                            id: r.get::<_, i64>(0)? as u32,
                            goal_id: r.get::<_, i64>(1)? as u32,
                            title: r.get(2)?,
                            done: r.get::<_, i32>(3)? != 0,
                            sort_order: r.get::<_, i64>(4)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(subtasks)
    }

    // ---------- F4: Retro insights ----------

    pub async fn get_retro_insight(
        &self,
        project_id: u32,
        range_key: String,
    ) -> Result<Option<RetroInsight>> {
        let retro = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT project_id, range_key, signature, retro_md,
                            generated_at, generated_by_model
                     FROM retro_insights WHERE project_id = ?1 AND range_key = ?2",
                    params![project_id as i64, range_key],
                    retro_insight_from_row,
                )
                .optional()
            })
            .await?;
        Ok(retro)
    }

    pub async fn upsert_retro_insight(
        &self,
        project_id: u32,
        range_key: String,
        signature: String,
        retro_md: String,
        generated_at: u32,
        generated_by_model: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO retro_insights (
                        project_id, range_key, signature, retro_md,
                        generated_at, generated_by_model
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(project_id, range_key) DO UPDATE SET
                        signature = excluded.signature,
                        retro_md = excluded.retro_md,
                        generated_at = excluded.generated_at,
                        generated_by_model = excluded.generated_by_model",
                    params![
                        project_id as i64,
                        range_key,
                        signature,
                        retro_md,
                        generated_at as i64,
                        generated_by_model,
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    // ---------- Blueprints (W6 / G4) ----------

    #[allow(clippy::too_many_arguments)]
    pub async fn save_blueprint(
        &self,
        id: Option<u32>,
        name: String,
        idea_text: Option<String>,
        target_users: Option<String>,
        stack_choice: Option<String>,
        folder_name: Option<String>,
        folder_path: Option<String>,
        seed_goals_json: Option<String>,
        wizard_step: u32,
    ) -> Result<ProjectBlueprint> {
        let bp = self
            .conn
            .call(move |c| {
                if let Some(existing_id) = id {
                    c.execute(
                        "UPDATE project_blueprints SET
                           name = ?1, idea_text = ?2, target_users = ?3,
                           stack_choice = ?4, folder_name = ?5, folder_path = ?6,
                           seed_goals_json = ?7, wizard_step = ?8,
                           updated_at = unixepoch()
                         WHERE id = ?9",
                        params![
                            &name,
                            &idea_text,
                            &target_users,
                            &stack_choice,
                            &folder_name,
                            &folder_path,
                            &seed_goals_json,
                            wizard_step as i64,
                            existing_id as i64,
                        ],
                    )?;
                    c.query_row(
                        "SELECT id, name, idea_text, target_users, stack_choice,
                                folder_name, folder_path, seed_goals_json,
                                wizard_step, created_at, updated_at
                         FROM project_blueprints WHERE id = ?1",
                        [existing_id as i64],
                        blueprint_from_row,
                    )
                } else {
                    c.execute(
                        "INSERT INTO project_blueprints
                           (name, idea_text, target_users, stack_choice,
                            folder_name, folder_path, seed_goals_json, wizard_step)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            &name,
                            &idea_text,
                            &target_users,
                            &stack_choice,
                            &folder_name,
                            &folder_path,
                            &seed_goals_json,
                            wizard_step as i64,
                        ],
                    )?;
                    let row_id = c.last_insert_rowid();
                    c.query_row(
                        "SELECT id, name, idea_text, target_users, stack_choice,
                                folder_name, folder_path, seed_goals_json,
                                wizard_step, created_at, updated_at
                         FROM project_blueprints WHERE id = ?1",
                        [row_id],
                        blueprint_from_row,
                    )
                }
            })
            .await?;
        Ok(bp)
    }

    pub async fn get_blueprint(&self, blueprint_id: u32) -> Result<ProjectBlueprint> {
        let bp = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT id, name, idea_text, target_users, stack_choice,
                            folder_name, folder_path, seed_goals_json,
                            wizard_step, created_at, updated_at
                     FROM project_blueprints WHERE id = ?1",
                    [blueprint_id as i64],
                    blueprint_from_row,
                )
            })
            .await?;
        Ok(bp)
    }

    pub async fn list_blueprints(&self) -> Result<Vec<ProjectBlueprint>> {
        let bps = self
            .conn
            .call(|c| {
                let mut stmt = c.prepare(
                    "SELECT id, name, idea_text, target_users, stack_choice,
                            folder_name, folder_path, seed_goals_json,
                            wizard_step, created_at, updated_at
                     FROM project_blueprints ORDER BY updated_at DESC",
                )?;
                let rows = stmt
                    .query_map([], blueprint_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(bps)
    }

    pub async fn delete_blueprint(&self, blueprint_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM project_blueprints WHERE id = ?",
                    [blueprint_id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }
}

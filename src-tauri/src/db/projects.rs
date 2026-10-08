//! 프로젝트 CRUD 와 개요 — 생성·목록·이름/외형 변경·삭제·overview 캐시.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

/// `projects` 에 FK 로 매달리지 않은 프로젝트 범위 표 — 프로젝트 행을 지워도
/// 따라 지워지지 않는다. 전부 `.oculpm/` 디스크에서 다시 만드는 파생 캐시라
/// [`Db::delete_project`] 가 같은 트랜잭션에서 함께 지운다.
///
/// `tests/project_delete_cache.rs` 가 스키마와 이 목록을 대조한다 — 새 캐시 표를
/// 만들면 거기서 먼저 걸린다 (2026-10-04: 지운 프로젝트 7개의 행 1만 개가 고아였다).
pub const PROJECT_CACHE_TABLES: &[&str] = &[
    "oculpm_agent_state",
    "oculpm_discussion_attachments",
    "oculpm_discussion_log",
    "oculpm_discussions",
    "oculpm_journal",
    "oculpm_journal_files",
    "oculpm_journal_tags",
    "oculpm_plan_decisions",
    "oculpm_plan_item_updates",
    "oculpm_plan_items",
    "oculpm_plans",
    "oculpm_sessions_cache",
    "oculpm_settings",
    "recall_stats",
];

impl Db {
    // ---------- Projects ----------

    pub async fn create_project(&self, name: String, root_path: String) -> Result<u32> {
        let id = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO projects (name, root_path) VALUES (?1, ?2)
                     ON CONFLICT(root_path) DO UPDATE SET name = excluded.name,
                       updated_at = unixepoch()",
                    (name, root_path),
                )?;
                Ok(c.last_insert_rowid())
            })
            .await?;
        Ok(id as u32)
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>> {
        let projects = self
            .conn
            .call(|c| {
                let mut stmt = c.prepare(
                    "SELECT id, name, root_path, created_at, icon, color, theme_id
                     FROM projects ORDER BY id DESC",
                )?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok(Project {
                            id: r.get::<_, i64>(0)? as u32,
                            name: r.get(1)?,
                            root_path: r.get(2)?,
                            created_at: r.get::<_, i64>(3)? as u32,
                            icon: r.get(4)?,
                            color: r.get(5)?,
                            theme_id: r.get(6)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(projects)
    }

    pub async fn get_project(&self, project_id: u32) -> Result<Project> {
        let project = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, name, root_path, created_at, icon, color, theme_id
                     FROM projects WHERE id = ?",
                )?;
                let proj = stmt.query_row([project_id as i64], |r| {
                    Ok(Project {
                        id: r.get::<_, i64>(0)? as u32,
                        name: r.get(1)?,
                        root_path: r.get(2)?,
                        created_at: r.get::<_, i64>(3)? as u32,
                        icon: r.get(4)?,
                        color: r.get(5)?,
                        theme_id: r.get(6)?,
                    })
                })?;
                Ok(proj)
            })
            .await?;
        Ok(project)
    }

    /// 프로젝트 루트 경로 — 없으면 `project_not_found`.
    ///
    /// 명령마다 `get_project` 를 감싸는 `project_root` 가 18벌이었고 반환 타입도
    /// `String`·`AppError` 로 갈렸다 (2026-10-09 리포트). 새 명령은 이것을 쓴다.
    pub async fn project_root(
        &self,
        project_id: u32,
    ) -> std::result::Result<std::path::PathBuf, crate::app_error::AppError> {
        self.get_project(project_id)
            .await
            .map(|p| std::path::PathBuf::from(p.root_path))
            .map_err(|e| crate::app_error::AppError::new("project_not_found", e.to_string()))
    }

    pub async fn delete_project(&self, id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                for table in PROJECT_CACHE_TABLES {
                    tx.execute(
                        &format!("DELETE FROM {table} WHERE project_id = ?1"),
                        [id as i64],
                    )?;
                }
                tx.execute("DELETE FROM projects WHERE id = ?1", [id as i64])?;
                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 겉모습(아이콘·색) 저장. `None` 은 "기본값으로 되돌리기" 다 — 빈 문자열이
    /// 아니라 NULL 로 써야 프런트의 이름 기반 기본값이 다시 살아난다.
    pub async fn set_project_appearance(
        &self,
        id: u32,
        icon: Option<String>,
        color: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE projects SET icon = ?1, color = ?2, updated_at = unixepoch()
                     WHERE id = ?3",
                    rusqlite::params![icon, color, id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 프로젝트에 묶인 테마 id. `None` 은 바인딩 해제 — `set_project_appearance`
    /// 와 같은 이유로 빈 문자열이 아니라 NULL 로 써야 전역 폴백이 되살아난다.
    pub async fn set_project_theme(&self, id: u32, theme_id: Option<String>) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE projects SET theme_id = ?1, updated_at = unixepoch() WHERE id = ?2",
                    rusqlite::params![theme_id, id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn rename_project(&self, id: u32, name: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE projects SET name = ?, updated_at = unixepoch() WHERE id = ?",
                    params![&name, id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn list_project_files(&self, project_id: u32) -> Result<Vec<(u32, String)>> {
        let files = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare("SELECT id, path FROM files WHERE project_id = ?")?;
                let rows = stmt
                    .query_map([project_id as i64], |r| {
                        Ok((r.get::<_, i64>(0)? as u32, r.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(files)
    }

    // ---------- Project Overview (G2) ----------

    /// Fetches the stored overview for a project. Returns `None` when the row
    /// does not exist yet; callers can then decide whether to trigger
    /// `generate_project_overview`.
    pub async fn get_project_overview(&self, project_id: u32) -> Result<Option<ProjectOverview>> {
        let overview = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT project_id, identity, stack_json, overview_md,
                            source_signature, generated_at, generated_by_model
                     FROM project_overviews WHERE project_id = ?1",
                    params![project_id as i64],
                    project_overview_from_row,
                )
                .optional()
            })
            .await?;
        Ok(overview)
    }

    /// Inserts or updates a project overview row. Used by both LLM-driven
    /// generation and manual user edits (in the manual case, pass
    /// `source_signature=None` to disable auto-regeneration).
    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_project_overview(
        &self,
        project_id: u32,
        identity: Option<String>,
        stack_json: Option<String>,
        overview_md: Option<String>,
        source_signature: Option<String>,
        generated_at: Option<u32>,
        generated_by_model: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO project_overviews (
                        project_id, identity, stack_json, overview_md,
                        source_signature, generated_at, generated_by_model
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(project_id) DO UPDATE SET
                        identity = excluded.identity,
                        stack_json = excluded.stack_json,
                        overview_md = excluded.overview_md,
                        source_signature = excluded.source_signature,
                        generated_at = excluded.generated_at,
                        generated_by_model = excluded.generated_by_model",
                    params![
                        project_id as i64,
                        identity,
                        stack_json,
                        overview_md,
                        source_signature,
                        generated_at.map(|v| v as i64),
                        generated_by_model,
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }
}

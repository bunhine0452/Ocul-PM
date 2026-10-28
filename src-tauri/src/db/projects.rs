//! 프로젝트 CRUD — 생성·목록·이름/외형 변경·삭제 (LLM 개요 접근자는 4.0 에서 걷었다;
//! 옛 `project_overviews` 행은 시작 탭 집계(`home.rs`)가 읽기만 한다).
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
                    "SELECT id, name, root_path, created_at, icon, color
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
                    "SELECT id, name, root_path, created_at, icon, color
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
}

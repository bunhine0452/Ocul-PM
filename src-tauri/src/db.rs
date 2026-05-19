use std::path::PathBuf;
use std::sync::Once;

use rusqlite::params;
use rusqlite::OptionalExtension;
use tokio_rusqlite::Connection;
use tracing::info;

use crate::error::Result;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/001_initial.sql")),
    (2, include_str!("../migrations/002_chunks.sql")),
    (3, include_str!("../migrations/003_subtasks.sql")),
];

pub struct Db {
    conn: Connection,
    path: PathBuf,
}

impl Db {
    pub async fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        Self::register_sqlite_vec();

        let conn = Connection::open(path.clone()).await?;
        conn.call(|c| {
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = NORMAL;",
            )?;
            Ok(())
        })
        .await?;

        let db = Self { conn, path };
        db.migrate().await?;
        info!(path = %db.path.display(), "database ready");
        Ok(db)
    }

    /// Register sqlite-vec as a SQLite auto-extension exactly once per process.
    /// Auto-extensions are applied to every new connection, including ours.
    fn register_sqlite_vec() {
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    async fn migrate(&self) -> Result<()> {
        self.conn
            .call(|c| {
                let current: i64 =
                    c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                for (version, sql) in MIGRATIONS {
                    if current < *version {
                        let tx = c.transaction()?;
                        tx.execute_batch(sql)?;
                        tx.pragma_update(None, "user_version", *version)?;
                        tx.commit()?;
                        info!(version, "migration applied");
                    }
                }
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn settings_set(&self, key: String, value: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO settings (key, value, updated_at)
                     VALUES (?1, ?2, unixepoch())
                     ON CONFLICT(key) DO UPDATE SET
                       value = excluded.value,
                       updated_at = excluded.updated_at",
                    (key, value),
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn settings_get(&self, key: String) -> Result<Option<String>> {
        let value = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    [key],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(Into::into)
            })
            .await?;
        Ok(value)
    }

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
                    "SELECT id, name, root_path, created_at FROM projects ORDER BY id DESC",
                )?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok(Project {
                            id: r.get::<_, i64>(0)? as u32,
                            name: r.get(1)?,
                            root_path: r.get(2)?,
                            created_at: r.get::<_, i64>(3)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(projects)
    }

    // ---------- Files ----------

    /// Insert or update a file. Returns `(file_id, changed)` where `changed`
    /// is true if the hash changed (or the file is new) — in that case
    /// callers should re-chunk and re-embed.
    pub async fn upsert_file(
        &self,
        project_id: u32,
        path: String,
        hash: String,
        size: i64,
        mtime: i64,
        language: Option<String>,
    ) -> Result<(u32, bool)> {
        let result = self
            .conn
            .call(move |c| {
                let existing: Option<(i64, String)> = c
                    .query_row(
                        "SELECT id, hash FROM files WHERE project_id = ?1 AND path = ?2",
                        params![project_id as i64, &path],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;

                if let Some((id, prev_hash)) = existing {
                    if prev_hash == hash {
                        return Ok((id as u32, false));
                    }
                    c.execute(
                        "UPDATE files SET hash = ?, size = ?, mtime = ?, language = ?,
                           indexed_at = unixepoch() WHERE id = ?",
                        params![&hash, size, mtime, &language, id],
                    )?;
                    c.execute("DELETE FROM chunks WHERE file_id = ?", [id])?;
                    Ok((id as u32, true))
                } else {
                    c.execute(
                        "INSERT INTO files (project_id, path, hash, size, mtime, language)
                         VALUES (?, ?, ?, ?, ?, ?)",
                        params![project_id as i64, &path, &hash, size, mtime, &language],
                    )?;
                    Ok((c.last_insert_rowid() as u32, true))
                }
            })
            .await?;
        Ok(result)
    }

    // ---------- Chunks + embeddings ----------

    pub async fn insert_chunk_with_embedding(
        &self,
        file_id: u32,
        kind: String,
        start_line: u32,
        end_line: u32,
        content: String,
        embedding_bytes: Vec<u8>,
    ) -> Result<u32> {
        let id = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "INSERT INTO chunks (file_id, kind, start_line, end_line, content)
                     VALUES (?, ?, ?, ?, ?)",
                    params![file_id as i64, &kind, start_line as i64, end_line as i64, &content],
                )?;
                let chunk_id = tx.last_insert_rowid();
                tx.execute(
                    "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)",
                    params![chunk_id, &embedding_bytes],
                )?;
                tx.commit()?;
                Ok(chunk_id as u32)
            })
            .await?;
        Ok(id)
    }

    pub async fn search_chunks(
        &self,
        project_id: u32,
        query_embedding_bytes: Vec<u8>,
        limit: u32,
    ) -> Result<Vec<ChunkSearchResult>> {
        // Over-fetch from the vector index so we still have `limit` results
        // after filtering by project_id.
        let k = (limit as i64).max(1).saturating_mul(5);
        let results = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT c.id, f.path, c.start_line, c.end_line, c.content, ce.distance
                     FROM chunk_embeddings ce
                     JOIN chunks c ON c.id = ce.chunk_id
                     JOIN files f ON f.id = c.file_id
                     WHERE ce.embedding MATCH ?1 AND k = ?2
                       AND f.project_id = ?3
                     ORDER BY ce.distance ASC
                     LIMIT ?4",
                )?;
                let rows = stmt
                    .query_map(
                        params![&query_embedding_bytes, k, project_id as i64, limit as i64],
                        |r| {
                            Ok(ChunkSearchResult {
                                chunk_id: r.get::<_, i64>(0)? as u32,
                                file_path: r.get(1)?,
                                start_line: r.get::<_, i64>(2)? as u32,
                                end_line: r.get::<_, i64>(3)? as u32,
                                content: r.get(4)?,
                                distance: r.get(5)?,
                            })
                        },
                    )?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(results)
    }

    pub async fn count_chunks(&self, project_id: u32) -> Result<u32> {
        let count = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT COUNT(*) FROM chunks c
                     JOIN files f ON f.id = c.file_id
                     WHERE f.project_id = ?",
                    [project_id as i64],
                    |r| r.get::<_, i64>(0),
                )
            })
            .await?;
        Ok(count as u32)
    }

    /// Drop all indexed files (and, via cascade + trigger, chunks +
    /// embeddings) for a project so the next index pass rebuilds from scratch.
    pub async fn clear_project_index(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM files WHERE project_id = ?",
                    [project_id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn count_files(&self, project_id: u32) -> Result<u32> {
        let count = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT COUNT(*) FROM files WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get::<_, i64>(0),
                )
            })
            .await?;
        Ok(count as u32)
    }

    pub async fn health(&self) -> Result<DbHealth> {
        let path = self.path.display().to_string();
        let (sqlite_version, vec_version, schema_version) = self
            .conn
            .call(|c| {
                let sqlite_version: String =
                    c.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
                let vec_version: String =
                    c.query_row("SELECT vec_version()", [], |r| r.get(0))?;
                let schema_version: u32 =
                    c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                Ok((sqlite_version, vec_version, schema_version))
            })
            .await?;
        Ok(DbHealth {
            sqlite_version,
            vec_version,
            schema_version,
            path,
        })
    }

    // ---------- Goals ----------

    pub async fn create_goal(
        &self,
        project_id: Option<u32>,
        title: String,
        description: Option<String>,
        priority: i32,
        due_date: Option<i64>,
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
                .map_err(Into::into)
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
                .map_err(Into::into)
            })
            .await?;
        Ok(goal)
    }

    pub async fn update_goal(
        &self,
        goal_id: u32,
        title: Option<String>,
        description: Option<Option<String>>,
        status: Option<String>,
        priority: Option<i32>,
        due_date: Option<Option<i64>>,
        progress: Option<f64>,
    ) -> Result<Goal> {
        let goal = self
            .conn
            .call(move |c| {
                if let Some(ref v) = title {
                    c.execute(
                        "UPDATE goals SET title = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }
                if let Some(ref v) = description {
                    c.execute(
                        "UPDATE goals SET description = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }
                if let Some(ref v) = status {
                    c.execute(
                        "UPDATE goals SET status = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }
                if let Some(v) = priority {
                    c.execute(
                        "UPDATE goals SET priority = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }
                if let Some(ref v) = due_date {
                    c.execute(
                        "UPDATE goals SET due_date = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }
                if let Some(v) = progress {
                    c.execute(
                        "UPDATE goals SET progress = ?, updated_at = unixepoch() WHERE id = ?",
                        params![v, goal_id as i64],
                    )?;
                }

                c.query_row(
                    "SELECT id, project_id, title, description, status, priority,
                            due_date, progress, created_at, updated_at
                     FROM goals WHERE id = ?1",
                    [goal_id as i64],
                    goal_from_row,
                )
                .map_err(Into::into)
            })
            .await?;
        Ok(goal)
    }

    pub async fn delete_goal(&self, goal_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM goals WHERE id = ?", [goal_id as i64])?;
                Ok(())
            })
            .await?;
        Ok(())
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
                    .as_secs() as i64;
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

    pub async fn create_subtask(&self, goal_id: u32, title: String) -> Result<Subtask> {
        let subtask = self
            .conn
            .call(move |c| {
                let max_order: i32 = c
                    .query_row(
                        "SELECT COALESCE(MAX(sort_order), -1) FROM subtasks WHERE goal_id = ?",
                        [goal_id as i64],
                        |r| r.get(0),
                    )
                    .unwrap_or(-1);
                c.execute(
                    "INSERT INTO subtasks (goal_id, title, sort_order) VALUES (?, ?, ?)",
                    params![goal_id as i64, &title, max_order + 1],
                )?;
                let id = c.last_insert_rowid();
                Ok(Subtask {
                    id: id as u32,
                    goal_id,
                    title,
                    done: false,
                    sort_order: (max_order + 1) as u32,
                })
            })
            .await?;
        Ok(subtask)
    }

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

    pub async fn toggle_subtask(&self, subtask_id: u32) -> Result<Subtask> {
        let subtask = self
            .conn
            .call(move |c| {
                c.execute(
                    "UPDATE subtasks SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END
                     WHERE id = ?",
                    [subtask_id as i64],
                )?;
                c.query_row(
                    "SELECT id, goal_id, title, done, sort_order FROM subtasks WHERE id = ?",
                    [subtask_id as i64],
                    |r| {
                        Ok(Subtask {
                            id: r.get::<_, i64>(0)? as u32,
                            goal_id: r.get::<_, i64>(1)? as u32,
                            title: r.get(2)?,
                            done: r.get::<_, i32>(3)? != 0,
                            sort_order: r.get::<_, i64>(4)? as u32,
                        })
                    },
                )
                .map_err(Into::into)
            })
            .await?;
        Ok(subtask)
    }

    pub async fn delete_subtask(&self, subtask_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM subtasks WHERE id = ?", [subtask_id as i64])?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn health(&self) -> Result<DbHealth> {
        let path = self.path.display().to_string();
        let (sqlite_version, vec_version, schema_version) = self
            .conn
            .call(|c| {
                let sqlite_version: String =
                    c.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
                let vec_version: String =
                    c.query_row("SELECT vec_version()", [], |r| r.get(0))?;
                let schema_version: u32 =
                    c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                Ok((sqlite_version, vec_version, schema_version))
            })
            .await?;
        Ok(DbHealth {
            sqlite_version,
            vec_version,
            schema_version,
            path,
        })
    }
}

// ---------- Row mapper ----------

fn goal_from_row(r: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: r.get::<_, i64>(0)? as u32,
        project_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u32),
        title: r.get(2)?,
        description: r.get(3)?,
        status: r.get(4)?,
        priority: r.get(5)?,
        due_date: r.get(6)?,
        progress: r.get(7)?,
        created_at: r.get::<_, i64>(8)? as u32,
        updated_at: r.get::<_, i64>(9)? as u32,
    })
}

// ---------- Types ----------

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct DbHealth {
    pub sqlite_version: String,
    pub vec_version: String,
    pub schema_version: u32,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Project {
    pub id: u32,
    pub name: String,
    pub root_path: String,
    pub created_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChunkSearchResult {
    pub chunk_id: u32,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub distance: f32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Goal {
    pub id: u32,
    pub project_id: Option<u32>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i32,
    pub due_date: Option<i64>,
    pub progress: f64,
    pub created_at: u32,
    pub updated_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Subtask {
    pub id: u32,
    pub goal_id: u32,
    pub title: String,
    pub done: bool,
    pub sort_order: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DashboardStats {
    pub total: u32,
    pub open: u32,
    pub in_progress: u32,
    pub done: u32,
    pub cancelled: u32,
    pub overdue: u32,
    pub due_today: u32,
    pub avg_progress: f64,
}


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
    (4, include_str!("../migrations/004_conversations.sql")),
    (5, include_str!("../migrations/005_ast_dependencies.sql")),
    (6, include_str!("../migrations/006_file_changes.sql")),
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

    pub async fn settings_get_all(&self) -> Result<Vec<(String, String)>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare("SELECT key, value FROM settings")?;
                let items: Vec<(String, String)> = stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(items)
            })
            .await?;
        Ok(rows)
    }

    pub async fn settings_clear(&self) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM settings", [])?;
                Ok(())
            })
            .await?;
        Ok(())
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

    pub async fn get_project(&self, project_id: u32) -> Result<Project> {
        let project = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, name, root_path, created_at FROM projects WHERE id = ?",
                )?;
                let proj = stmt.query_row([project_id as i64], |r| {
                    Ok(Project {
                        id: r.get::<_, i64>(0)? as u32,
                        name: r.get(1)?,
                        root_path: r.get(2)?,
                        created_at: r.get::<_, i64>(3)? as u32,
                    })
                })?;
                Ok(proj)
            })
            .await?;
        Ok(project)
    }

    pub async fn delete_project(&self, id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM projects WHERE id = ?", [id as i64])?;
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
                    c.execute("DELETE FROM symbol_definitions WHERE file_id = ?", [id])?;
                    c.execute("DELETE FROM file_dependencies WHERE source_file_id = ?", [id])?;
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
        due_date: Option<Option<i32>>,
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

    // ---------- Conversations (chat history) ----------

    pub async fn conversation_create(
        &self,
        title: String,
        provider: Option<String>,
        model: Option<String>,
        project_id: Option<u32>,
    ) -> Result<Conversation> {
        let conv = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO conversations (title, provider, model, project_id)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        &title,
                        &provider,
                        &model,
                        project_id.map(|id| id as i64),
                    ],
                )?;
                let id = c.last_insert_rowid();
                c.query_row(
                    "SELECT id, title, provider, model, project_id,
                            created_at, updated_at, last_message_at
                     FROM conversations WHERE id = ?1",
                    [id],
                    conversation_from_row,
                )
                .map_err(Into::into)
            })
            .await?;
        Ok(conv)
    }

    pub async fn conversation_list(&self, project_id: Option<u32>) -> Result<Vec<Conversation>> {
        let convs = self
            .conn
            .call(move |c| {
                if let Some(pid) = project_id {
                    let mut stmt = c.prepare(
                        "SELECT id, title, provider, model, project_id,
                                created_at, updated_at, last_message_at
                         FROM conversations
                         WHERE project_id = ?1
                         ORDER BY COALESCE(last_message_at, updated_at) DESC, id DESC",
                    )?;
                    let rows = stmt
                        .query_map([pid as i64], conversation_from_row)?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    Ok(rows)
                } else {
                    let mut stmt = c.prepare(
                        "SELECT id, title, provider, model, project_id,
                                created_at, updated_at, last_message_at
                         FROM conversations
                         ORDER BY COALESCE(last_message_at, updated_at) DESC, id DESC",
                    )?;
                    let rows = stmt
                        .query_map([], conversation_from_row)?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    Ok(rows)
                }
            })
            .await?;
        Ok(convs)
    }

    pub async fn conversation_rename(&self, id: u32, title: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE conversations SET title = ?, updated_at = unixepoch()
                     WHERE id = ?",
                    params![&title, id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn conversation_set_context(
        &self,
        id: u32,
        provider: Option<String>,
        model: Option<String>,
        project_id: Option<u32>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE conversations
                     SET provider = ?, model = ?, project_id = ?, updated_at = unixepoch()
                     WHERE id = ?",
                    params![
                        &provider,
                        &model,
                        project_id.map(|v| v as i64),
                        id as i64,
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn conversation_delete(&self, id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM conversations WHERE id = ?", [id as i64])?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn chat_message_append(
        &self,
        conversation_id: u32,
        role: String,
        content: String,
        provider: Option<String>,
        model: Option<String>,
    ) -> Result<ChatMessage> {
        let msg = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "INSERT INTO chat_messages
                       (conversation_id, role, content, provider, model)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        conversation_id as i64,
                        &role,
                        &content,
                        &provider,
                        &model,
                    ],
                )?;
                let id = tx.last_insert_rowid();
                tx.execute(
                    "UPDATE conversations
                     SET last_message_at = unixepoch(), updated_at = unixepoch()
                     WHERE id = ?",
                    [conversation_id as i64],
                )?;
                let row = tx.query_row(
                    "SELECT id, conversation_id, role, content, provider, model, created_at
                     FROM chat_messages WHERE id = ?1",
                    [id],
                    chat_message_from_row,
                )?;
                tx.commit()?;
                Ok(row)
            })
            .await?;
        Ok(msg)
    }

    pub async fn chat_message_list(&self, conversation_id: u32) -> Result<Vec<ChatMessage>> {
        let msgs = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, conversation_id, role, content, provider, model, created_at
                     FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC",
                )?;
                let rows = stmt
                    .query_map([conversation_id as i64], chat_message_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(msgs)
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

    // ---------- AST & Code Analysis ----------

    pub async fn insert_symbol_definition(
        &self,
        file_id: u32,
        symbol: crate::ast::SymbolDef,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO symbol_definitions (file_id, name, kind, start_line, end_line, start_byte, end_byte)
                     VALUES (?, ?, ?, ?, ?, ?, ?)",
                    params![
                        file_id as i64,
                        &symbol.name,
                        &symbol.kind,
                        symbol.start_line as i64,
                        symbol.end_line as i64,
                        symbol.start_byte as i64,
                        symbol.end_byte as i64,
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn insert_file_dependency(
        &self,
        project_id: u32,
        source_file_id: u32,
        target_file_id: u32,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT OR IGNORE INTO file_dependencies (project_id, source_file_id, target_file_id)
                     VALUES (?, ?, ?)",
                    params![project_id as i64, source_file_id as i64, target_file_id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn get_dependency_graph(&self, project_id: u32) -> Result<DependencyGraph> {
        let graph = self
            .conn
            .call(move |c| {
                // Get nodes (files in project)
                let mut stmt = c.prepare(
                    "SELECT id, path, language, size FROM files WHERE project_id = ?"
                )?;
                let nodes = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(DependencyNode {
                            file_id: r.get::<_, i64>(0)? as u32,
                            path: r.get(1)?,
                            language: r.get(2)?,
                            size: r.get::<_, i64>(3)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                // Get edges
                let mut stmt = c.prepare(
                    "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?"
                )?;
                let edges = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(DependencyEdge {
                            source_file_id: r.get::<_, i64>(0)? as u32,
                            target_file_id: r.get::<_, i64>(1)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(DependencyGraph { nodes, edges })
            })
            .await?;
        Ok(graph)
    }

    pub async fn get_file_symbols(&self, file_id: u32) -> Result<Vec<crate::ast::SymbolDef>> {
        let symbols = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT name, kind, start_line, end_line, start_byte, end_byte
                     FROM symbol_definitions
                     WHERE file_id = ?
                     ORDER BY start_line ASC"
                )?;
                let rows = stmt
                    .query_map([file_id as i64], |r| {
                        Ok(crate::ast::SymbolDef {
                            name: r.get(0)?,
                            kind: r.get(1)?,
                            start_line: r.get::<_, i64>(2)? as u32,
                            end_line: r.get::<_, i64>(3)? as u32,
                            start_byte: r.get::<_, i64>(4)? as u32,
                            end_byte: r.get::<_, i64>(5)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(symbols)
    }

    pub async fn list_project_files(&self, project_id: u32) -> Result<Vec<(u32, String)>> {
        let files = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, path FROM files WHERE project_id = ?"
                )?;
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

    pub async fn clear_project_dependencies(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM file_dependencies WHERE project_id = ?", [project_id as i64])?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    // ---------- File Changes ----------

    pub async fn insert_file_change(
        &self,
        project_id: u32,
        file_path: String,
        change_type: String,
        old_hash: Option<String>,
        new_hash: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO file_changes (project_id, file_path, change_type, old_hash, new_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![project_id as i64, &file_path, &change_type, &old_hash, &new_hash],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn list_file_changes(
        &self,
        project_id: u32,
        since: i64,
    ) -> Result<Vec<FileChange>> {
        let changes = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, project_id, file_path, change_type, old_hash, new_hash, detected_at, summary
                     FROM file_changes
                     WHERE project_id = ?1 AND detected_at >= ?2
                     ORDER BY detected_at DESC",
                )?;
                let rows = stmt
                    .query_map(params![project_id as i64, since], |r| {
                        Ok(FileChange {
                            id: r.get::<_, i64>(0)? as u32,
                            project_id: r.get::<_, i64>(1)? as u32,
                            file_path: r.get(2)?,
                            change_type: r.get(3)?,
                            old_hash: r.get(4)?,
                            new_hash: r.get(5)?,
                            detected_at: r.get::<_, i64>(6)? as u32,
                            summary: r.get(7)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(changes)
    }

    /// Returns the stored hash for a file by project_id and path.
    pub async fn get_file_hash(&self, project_id: u32, path: String) -> Result<Option<(u32, String)>> {
        let result = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT id, hash FROM files WHERE project_id = ?1 AND path = ?2",
                    params![project_id as i64, &path],
                    |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(Into::into)
            })
            .await?;
        Ok(result)
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

fn conversation_from_row(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get::<_, i64>(0)? as u32,
        title: r.get(1)?,
        provider: r.get(2)?,
        model: r.get(3)?,
        project_id: r.get::<_, Option<i64>>(4)?.map(|v| v as u32),
        created_at: r.get::<_, i64>(5)? as u32,
        updated_at: r.get::<_, i64>(6)? as u32,
        last_message_at: r.get::<_, Option<i64>>(7)?.map(|v| v as u32),
    })
}

fn chat_message_from_row(r: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: r.get::<_, i64>(0)? as u32,
        conversation_id: r.get::<_, i64>(1)? as u32,
        role: r.get(2)?,
        content: r.get(3)?,
        provider: r.get(4)?,
        model: r.get(5)?,
        created_at: r.get::<_, i64>(6)? as u32,
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
    pub due_date: Option<i32>,
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
pub struct Conversation {
    pub id: u32,
    pub title: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub project_id: Option<u32>,
    pub created_at: u32,
    pub updated_at: u32,
    pub last_message_at: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChatMessage {
    pub id: u32,
    pub conversation_id: u32,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: u32,
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

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyNode {
    pub file_id: u32,
    pub path: String,
    pub language: Option<String>,
    pub size: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyEdge {
    pub source_file_id: u32,
    pub target_file_id: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyGraph {
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FileChange {
    pub id: u32,
    pub project_id: u32,
    pub file_path: String,
    pub change_type: String,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
    pub detected_at: u32,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct EditPromptResult {
    pub english_prompt: String,
    pub korean_summary: String,
    pub related_files: Vec<String>,
}

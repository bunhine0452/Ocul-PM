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
    (7, include_str!("../migrations/007_changelog.sql")),
    (8, include_str!("../migrations/008_project_overview.sql")),
    (9, include_str!("../migrations/009_conversation_actions.sql")),
    (10, include_str!("../migrations/011_project_blueprints.sql")),
    (12, include_str!("../migrations/012_oculpm_journal.sql")),
    (13, include_str!("../migrations/013_oculpm_agent_state.sql")),
    (14, include_str!("../migrations/014_oculpm_migrations.sql")),
    (15, include_str!("../migrations/015_file_snapshots.sql")),
    (16, include_str!("../migrations/016_oculpm_planner.sql")),
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

    /// Borrow the underlying async sqlite connection. Used by sibling
    /// subsystems (e.g. `oculpm::cache`) that need to share the same db
    /// connection without duplicating the migration/open machinery, and by
    /// integration tests in `src-tauri/tests/` that need raw `UPDATE` access
    /// (e.g. to override `created_at` timestamps on changelog rows).
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Register sqlite-vec as a SQLite auto-extension exactly once per process.
    /// Auto-extensions are applied to every new connection, including ours.
    fn register_sqlite_vec() {
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut rusqlite::ffi::sqlite3,
                    *mut *mut i8,
                    *const rusqlite::ffi::sqlite3_api_routines,
                ) -> i32,
            >(
                sqlite_vec::sqlite3_vec_init as *const ()
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
                .optional()})
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

    // ---------- Oculpm agent state (W4-PR4) ----------
    //
    // Per-adapter hash of the bytes we last wrote — drives the watcher's
    // drift comparator. Schema in migrations/013_oculpm_agent_state.sql.
    // Stored as `String` on the wire (blake3 hex) so a missing row is
    // unambiguously "we never synced this adapter."

    pub async fn oculpm_agent_state_upsert(
        &self,
        project_id: u32,
        agent_id: String,
        last_hash: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO oculpm_agent_state
                       (project_id, agent_id, last_hash, last_written_at)
                     VALUES (?1, ?2, ?3, unixepoch())
                     ON CONFLICT(project_id, agent_id) DO UPDATE SET
                       last_hash = excluded.last_hash,
                       last_written_at = excluded.last_written_at",
                    params![project_id as i64, agent_id, last_hash],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn oculpm_agent_state_get(
        &self,
        project_id: u32,
        agent_id: String,
    ) -> Result<Option<(String, i64)>> {
        let row = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT last_hash, last_written_at FROM oculpm_agent_state
                     WHERE project_id = ?1 AND agent_id = ?2",
                    params![project_id as i64, agent_id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                )
                .optional()})
            .await?;
        Ok(row)
    }

    pub async fn oculpm_agent_state_clear_project(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM oculpm_agent_state WHERE project_id = ?1",
                    params![project_id as i64],
                )?;
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

    /// PR-R1b (A2) — exact substring search over indexed chunk text. Same
    /// coverage as semantic search (the chunk index); `distance` is a sentinel
    /// 0.0 — callers should not show a similarity score for text matches.
    pub async fn search_text(
        &self,
        project_id: u32,
        query: String,
        limit: u32,
    ) -> Result<Vec<ChunkSearchResult>> {
        let pattern = format!("%{}%", escape_like(&query));
        let lim = limit.max(1) as i64;
        let results = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT c.id, f.path, c.start_line, c.end_line, c.content
                     FROM chunks c
                     JOIN files f ON f.id = c.file_id
                     WHERE f.project_id = ?1 AND c.content LIKE ?2 ESCAPE '\\'
                     ORDER BY f.path ASC, c.start_line ASC
                     LIMIT ?3",
                )?;
                let rows = stmt
                    .query_map(params![project_id as i64, pattern, lim], |r| {
                        Ok(ChunkSearchResult {
                            chunk_id: r.get::<_, i64>(0)? as u32,
                            file_path: r.get(1)?,
                            start_line: r.get::<_, i64>(2)? as u32,
                            end_line: r.get::<_, i64>(3)? as u32,
                            content: r.get(4)?,
                            distance: 0.0,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(results)
    }

    /// PR-R1b (A2) — symbol-name search over the AST symbol index. Exact-name
    /// matches rank first, then shorter names, then path.
    pub async fn search_symbols(
        &self,
        project_id: u32,
        query: String,
        limit: u32,
    ) -> Result<Vec<SymbolSearchResult>> {
        let pattern = format!("%{}%", escape_like(&query));
        let lim = limit.max(1) as i64;
        let results = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT s.name, s.kind, f.path, s.start_line, s.end_line
                     FROM symbol_definitions s
                     JOIN files f ON f.id = s.file_id
                     WHERE f.project_id = ?1 AND s.name LIKE ?2 ESCAPE '\\'
                     ORDER BY (s.name = ?3) DESC, length(s.name) ASC, f.path ASC, s.start_line ASC
                     LIMIT ?4",
                )?;
                let rows = stmt
                    .query_map(params![project_id as i64, pattern, query, lim], |r| {
                        Ok(SymbolSearchResult {
                            name: r.get(0)?,
                            kind: r.get(1)?,
                            file_path: r.get(2)?,
                            start_line: r.get::<_, i64>(3)? as u32,
                            end_line: r.get::<_, i64>(4)? as u32,
                        })
                    })?
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
                )})
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
                )})
            .await?;
        Ok(goal)
    }

    #[allow(clippy::too_many_arguments)]
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
                )})
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
                )})
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
                )})
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
                // Check if the most recent change for this file has the exact same attributes
                let latest: Option<(String, Option<String>, Option<String>)> = c
                    .query_row(
                        "SELECT change_type, old_hash, new_hash 
                         FROM file_changes 
                         WHERE project_id = ?1 AND file_path = ?2 
                         ORDER BY detected_at DESC, id DESC 
                         LIMIT 1",
                        params![project_id as i64, &file_path],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()?;

                if let Some((latest_change, latest_old, latest_new)) = latest {
                    if latest_change == change_type && latest_old == old_hash && latest_new == new_hash {
                        return Ok(());
                    }
                }

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

    /// Delete `file_changes` audit rows for the given project + paths.
    /// Used by `commit_changelog_entry` so the "오늘 변경사항" panel does not
    /// keep surfacing files that have already been recorded into a changelog
    /// entry. We delete (rather than soft-mark) because the rows are otherwise
    /// recoverable from the changelog itself.
    pub async fn delete_file_changes_for_paths(
        &self,
        project_id: u32,
        paths: Vec<String>,
    ) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                {
                    let mut stmt = tx.prepare(
                        "DELETE FROM file_changes WHERE project_id = ?1 AND file_path = ?2",
                    )?;
                    for p in &paths {
                        stmt.execute(params![project_id as i64, p])?;
                    }
                }
                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// Refresh the indexed hash for a single file (project_id, path → hash).
    /// Called after a changelog commit so `detect_file_changes` does not pick
    /// the same file up again on the next scan. No-op if the file row does not
    /// yet exist in `files` — the next full reindex will pick it up.
    pub async fn refresh_file_hash(
        &self,
        project_id: u32,
        path: String,
        new_hash: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE files SET hash = ?1, indexed_at = unixepoch()
                     WHERE project_id = ?2 AND path = ?3",
                    params![&new_hash, project_id as i64, &path],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn clean_duplicate_file_changes(&self) -> Result<()> {
        self.conn
            .call(|c| {
                c.execute(
                    "DELETE FROM file_changes
                     WHERE id NOT IN (
                         SELECT MIN(id)
                         FROM file_changes
                         GROUP BY project_id, file_path, change_type, old_hash, new_hash
                     )",
                    [],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
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
                .optional()})
            .await?;
        Ok(result)
    }

    // ---------- G1: Changelog (legacy, read-only) ----------
    //
    // Lite-W6 PR4: the user-facing changelog UI and the write/update/delete
    // commands have been retired. The read methods + truncate-for-project
    // helper below stay because:
    //   - `migrate_from_sqlite` still drains legacy tables into journal/
    //   - `delete_legacy_changelog` (manager.rs) backs up and truncates after
    //     a confirmed migration
    //   - `delete_project` cascade still needs to clear changelog rows for
    //     projects created on v0.x
    // The 007 schema migration is left in place so upgrading users can still
    // be migrated; a separate `DROP TABLE` migration is deferred to 1.1.
    //
    // `insert_changelog_entry` and `insert_changelog_file` are kept only as
    // test seeding helpers (the only production writers — `commit_changelog
    // _entry` and the related commands — were deleted in PR4) so that
    // `migrate_from_sqlite`, `delete_legacy_changelog`, and the integration
    // tests under `tests/` can build legacy fixtures inline. They survive
    // here as plain `pub` methods because integration tests link the lib
    // as an external crate and would not see `#[cfg(test)]` items.

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_changelog_entry(
        &self,
        project_id: u32,
        user_intent: Option<String>,
        prompt_text: Option<String>,
        ai_summary: String,
        title: Option<String>,
        category: Option<String>,
        external_tool: Option<String>,
        files_changed: u32,
        lines_added: u32,
        lines_removed: u32,
    ) -> Result<ChangelogEntry> {
        let entry = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO changelog_entries
                     (project_id, user_intent, prompt_text, ai_summary, title, category,
                      external_tool, files_changed, lines_added, lines_removed)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        project_id as i64,
                        &user_intent,
                        &prompt_text,
                        &ai_summary,
                        &title,
                        &category,
                        &external_tool,
                        files_changed as i64,
                        lines_added as i64,
                        lines_removed as i64,
                    ],
                )?;
                let id = c.last_insert_rowid();
                c.query_row(
                    "SELECT id, project_id, user_intent, prompt_text, ai_summary, title,
                            category, external_tool, files_changed, lines_added, lines_removed,
                            created_at, pinned
                     FROM changelog_entries WHERE id = ?1",
                    [id],
                    changelog_entry_from_row,
                )})
            .await?;
        Ok(entry)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_changelog_file(
        &self,
        entry_id: u32,
        file_path: String,
        change_type: String,
        lines_added: u32,
        lines_removed: u32,
        diff_patch: Option<String>,
        per_file_summary: Option<String>,
        old_hash: Option<String>,
        new_hash: Option<String>,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO changelog_files
                     (entry_id, file_path, change_type, lines_added, lines_removed,
                      diff_patch, per_file_summary, old_hash, new_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        entry_id as i64,
                        &file_path,
                        &change_type,
                        lines_added as i64,
                        lines_removed as i64,
                        &diff_patch,
                        &per_file_summary,
                        &old_hash,
                        &new_hash,
                    ],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn list_changelog_entries(
        &self,
        project_id: u32,
        since: Option<i64>,
        limit: u32,
    ) -> Result<Vec<ChangelogEntry>> {
        let entries = self
            .conn
            .call(move |c| {
                // Build SQL with placeholder count matching the actual bound params.
                // Previously the LIMIT clause always used `?3`, but when `since` is
                // None we only bind 2 params → sqlite raises
                // "Wrong number of parameters passed to query. Got 2, needed 3".
                let rows: Vec<ChangelogEntry> = if let Some(s) = since {
                    let mut stmt = c.prepare(
                        "SELECT id, project_id, user_intent, prompt_text, ai_summary, title,
                                category, external_tool, files_changed, lines_added, lines_removed,
                                created_at, pinned
                         FROM changelog_entries
                         WHERE project_id = ?1 AND created_at >= ?2
                         ORDER BY pinned DESC, created_at DESC LIMIT ?3",
                    )?;
                    let collected: rusqlite::Result<Vec<ChangelogEntry>> = stmt
                        .query_map(
                            params![project_id as i64, s, limit as i64],
                            changelog_entry_from_row,
                        )?
                        .collect();
                    collected?
                } else {
                    let mut stmt = c.prepare(
                        "SELECT id, project_id, user_intent, prompt_text, ai_summary, title,
                                category, external_tool, files_changed, lines_added, lines_removed,
                                created_at, pinned
                         FROM changelog_entries
                         WHERE project_id = ?1
                         ORDER BY pinned DESC, created_at DESC LIMIT ?2",
                    )?;
                    let collected: rusqlite::Result<Vec<ChangelogEntry>> = stmt
                        .query_map(
                            params![project_id as i64, limit as i64],
                            changelog_entry_from_row,
                        )?
                        .collect();
                    collected?
                };
                Ok(rows)
            })
            .await?;
        Ok(entries)
    }

    pub async fn get_changelog_entry(&self, entry_id: u32) -> Result<ChangelogEntry> {
        let entry = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT id, project_id, user_intent, prompt_text, ai_summary, title,
                            category, external_tool, files_changed, lines_added, lines_removed,
                            created_at, pinned
                     FROM changelog_entries WHERE id = ?1",
                    [entry_id as i64],
                    changelog_entry_from_row,
                )})
            .await?;
        Ok(entry)
    }

    pub async fn list_changelog_files(&self, entry_id: u32) -> Result<Vec<ChangelogFileEntry>> {
        let files = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, entry_id, file_path, change_type, lines_added, lines_removed,
                            per_file_summary, diff_patch
                     FROM changelog_files
                     WHERE entry_id = ?1
                     ORDER BY file_path ASC",
                )?;
                let rows = stmt
                    .query_map([entry_id as i64], |r| {
                        Ok(ChangelogFileEntry {
                            id: r.get::<_, i64>(0)? as u32,
                            entry_id: r.get::<_, i64>(1)? as u32,
                            file_path: r.get(2)?,
                            change_type: r.get(3)?,
                            lines_added: r.get::<_, i64>(4)? as u32,
                            lines_removed: r.get::<_, i64>(5)? as u32,
                            per_file_summary: r.get(6)?,
                            diff_patch: r.get(7)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(files)
    }

    // ---------- W5-PR7: oculpm_migrations + legacy deletion ----------

    /// Insert one history row recording a successful `migrate_from_sqlite`.
    /// Returns the new row id so the caller can correlate.
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_oculpm_migration(
        &self,
        project_id: u32,
        report_timestamp: u32,
        source_entry_count: u32,
        success_count: u32,
        skip_count: u32,
        failure_count: u32,
        backup_dir: String,
        report_json: String,
    ) -> Result<u32> {
        let id = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO oculpm_migrations
                     (project_id, report_timestamp, source_entry_count, success_count,
                      skip_count, failure_count, backup_dir, report_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        project_id as i64,
                        report_timestamp as i64,
                        source_entry_count as i64,
                        success_count as i64,
                        skip_count as i64,
                        failure_count as i64,
                        &backup_dir,
                        &report_json,
                    ],
                )?;
                Ok(c.last_insert_rowid() as u32)
            })
            .await?;
        Ok(id)
    }

    /// Read all history rows for a project, most-recent first.
    pub async fn list_oculpm_migrations(
        &self,
        project_id: u32,
    ) -> Result<Vec<crate::oculpm::spec::MigrationHistoryEntry>> {
        use crate::oculpm::spec::MigrationHistoryEntry;
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, report_timestamp, source_entry_count, success_count,
                            skip_count, failure_count, backup_dir,
                            legacy_deleted_at, legacy_delete_backup_dir
                     FROM oculpm_migrations
                     WHERE project_id = ?1
                     ORDER BY report_timestamp DESC",
                )?;
                let rows: rusqlite::Result<Vec<MigrationHistoryEntry>> = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(MigrationHistoryEntry {
                            id: r.get::<_, i64>(0)? as u32,
                            report_timestamp: r.get::<_, i64>(1)? as u32,
                            source_entry_count: r.get::<_, i64>(2)? as u32,
                            success_count: r.get::<_, i64>(3)? as u32,
                            skip_count: r.get::<_, i64>(4)? as u32,
                            failure_count: r.get::<_, i64>(5)? as u32,
                            backup_dir: r.get(6)?,
                            legacy_deleted_at: r
                                .get::<_, Option<i64>>(7)?
                                .map(|v| v as u32),
                            legacy_delete_backup_dir: r.get(8)?,
                        })
                    })?
                    .collect();
                rows
            })
            .await?;
        Ok(rows)
    }

    /// Mark a history row as the source of a legacy deletion. Stores the
    /// safety-backup basename so the user can later open it.
    pub async fn mark_oculpm_migration_deleted(
        &self,
        history_id: u32,
        deleted_at: u32,
        safety_backup_dir: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE oculpm_migrations
                     SET legacy_deleted_at = ?1, legacy_delete_backup_dir = ?2
                     WHERE id = ?3",
                    params![deleted_at as i64, &safety_backup_dir, history_id as i64],
                )?;
                Ok::<(), rusqlite::Error>(())
            })
            .await?;
        Ok(())
    }

    /// Read all legacy changelog rows + their files for the safety dump.
    /// Returns (entries_count, files_count) for the report.
    pub async fn truncate_changelog_for_project(
        &self,
        project_id: u32,
    ) -> Result<(u32, u32)> {
        let counts = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                let entries: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM changelog_entries WHERE project_id = ?1",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                let files: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM changelog_files f
                     INNER JOIN changelog_entries e ON e.id = f.entry_id
                     WHERE e.project_id = ?1",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                // files cascade via FK ON DELETE CASCADE in 007_changelog.sql.
                tx.execute(
                    "DELETE FROM changelog_entries WHERE project_id = ?1",
                    [project_id as i64],
                )?;
                tx.commit()?;
                Ok((entries as u32, files as u32))
            })
            .await?;
        Ok(counts)
    }

    // ---------- Conversation Actions (UI-5 / W5) ----------

    /// Idempotent insert (UPSERT on (conversation_id, message_index)).
    /// Returns the resulting row so the frontend can update its UI without a
    /// follow-up list call.
    pub async fn record_conversation_action(
        &self,
        conversation_id: u32,
        message_index: u32,
        status: String,
    ) -> Result<ConversationAction> {
        let row = self
            .conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO conversation_actions (conversation_id, message_index, status)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(conversation_id, message_index) DO UPDATE SET
                       status = excluded.status,
                       applied_at = unixepoch()",
                    params![conversation_id as i64, message_index as i64, status],
                )?;
                c.query_row(
                    "SELECT id, conversation_id, message_index, status, applied_at
                     FROM conversation_actions
                     WHERE conversation_id = ?1 AND message_index = ?2",
                    params![conversation_id as i64, message_index as i64],
                    |r| {
                        Ok(ConversationAction {
                            id: r.get::<_, i64>(0)? as u32,
                            conversation_id: r.get::<_, i64>(1)? as u32,
                            message_index: r.get::<_, i64>(2)? as u32,
                            status: r.get(3)?,
                            applied_at: r.get::<_, i64>(4)? as u32,
                        })
                    },
                )})
            .await?;
        Ok(row)
    }

    pub async fn list_conversation_actions(
        &self,
        conversation_id: u32,
    ) -> Result<Vec<ConversationAction>> {
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, conversation_id, message_index, status, applied_at
                     FROM conversation_actions
                     WHERE conversation_id = ?1
                     ORDER BY message_index ASC",
                )?;
                let rows = stmt
                    .query_map([conversation_id as i64], |r| {
                        Ok(ConversationAction {
                            id: r.get::<_, i64>(0)? as u32,
                            conversation_id: r.get::<_, i64>(1)? as u32,
                            message_index: r.get::<_, i64>(2)? as u32,
                            status: r.get(3)?,
                            applied_at: r.get::<_, i64>(4)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(rows)
    }

    // ---------- Project Overview (G2) ----------

    /// Fetches the stored overview for a project. Returns `None` when the row
    /// does not exist yet; callers can then decide whether to trigger
    /// `generate_project_overview`.
    pub async fn get_project_overview(
        &self,
        project_id: u32,
    ) -> Result<Option<ProjectOverview>> {
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
                .optional()})
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

    // ---------- File snapshots (PR6.6 / Lite-W6) ----------

    /// Upsert the snapshot row for a single path. Used by the indexer at the
    /// end of a per-file index pass and by the `resnapshot_paths` command
    /// behind the LocalDiffView "비우기" action.
    pub async fn upsert_file_snapshot(
        &self,
        project_id: u32,
        path: String,
        content: Vec<u8>,
        hash: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO file_snapshots (project_id, path, content, hash, captured_at)
                     VALUES (?1, ?2, ?3, ?4, unixepoch())
                     ON CONFLICT(project_id, path) DO UPDATE SET
                       content = excluded.content,
                       hash = excluded.hash,
                       captured_at = excluded.captured_at",
                    params![project_id as i64, &path, &content, &hash],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// Fetch the snapshot row for a path. Returns `None` when no snapshot has
    /// been captured yet — `compute_diff` surfaces this as
    /// `DiffSource::SnapshotsUnavailable` so the UI can ask the user to run a
    /// partial reindex first.
    pub async fn get_file_snapshot(
        &self,
        project_id: u32,
        path: String,
    ) -> Result<Option<FileSnapshot>> {
        let snapshot = self
            .conn
            .call(move |c| {
                let row = c
                    .query_row(
                        "SELECT id, project_id, path, content, hash, captured_at
                         FROM file_snapshots WHERE project_id = ?1 AND path = ?2",
                        params![project_id as i64, &path],
                        |r| {
                            Ok(FileSnapshot {
                                id: r.get::<_, i64>(0)? as u32,
                                project_id: r.get::<_, i64>(1)? as u32,
                                path: r.get(2)?,
                                content: r.get(3)?,
                                hash: r.get(4)?,
                                captured_at: r.get::<_, i64>(5)? as u32,
                            })
                        },
                    )
                    .optional()?;
                Ok(row)
            })
            .await?;
        Ok(snapshot)
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
                    )} else {
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
                    )}
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
                )})
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

// ---------- Row mapper ----------

fn blueprint_from_row(r: &rusqlite::Row) -> rusqlite::Result<ProjectBlueprint> {
    Ok(ProjectBlueprint {
        id: r.get::<_, i64>(0)? as u32,
        name: r.get(1)?,
        idea_text: r.get(2)?,
        target_users: r.get(3)?,
        stack_choice: r.get(4)?,
        folder_name: r.get(5)?,
        folder_path: r.get(6)?,
        seed_goals_json: r.get(7)?,
        wizard_step: r.get::<_, i64>(8)? as u32,
        created_at: r.get::<_, i64>(9)? as u32,
        updated_at: r.get::<_, i64>(10)? as u32,
    })
}

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

fn changelog_entry_from_row(r: &rusqlite::Row) -> rusqlite::Result<ChangelogEntry> {
    Ok(ChangelogEntry {
        id: r.get::<_, i64>(0)? as u32,
        project_id: r.get::<_, i64>(1)? as u32,
        user_intent: r.get(2)?,
        prompt_text: r.get(3)?,
        ai_summary: r.get(4)?,
        title: r.get(5)?,
        category: r.get(6)?,
        external_tool: r.get(7)?,
        files_changed: r.get::<_, i64>(8)? as u32,
        lines_added: r.get::<_, i64>(9)? as u32,
        lines_removed: r.get::<_, i64>(10)? as u32,
        created_at: r.get::<_, i64>(11)? as u32,
        pinned: r.get::<_, i32>(12)? != 0,
    })
}

fn project_overview_from_row(r: &rusqlite::Row) -> rusqlite::Result<ProjectOverview> {
    Ok(ProjectOverview {
        project_id: r.get::<_, i64>(0)? as u32,
        identity: r.get(1)?,
        stack_json: r.get(2)?,
        overview_md: r.get(3)?,
        source_signature: r.get(4)?,
        generated_at: r.get::<_, Option<i64>>(5)?.map(|v| v as u32),
        generated_by_model: r.get(6)?,
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

/// PR-R1b (A2) — a symbol hit from `search_symbols` (name LIKE over the AST
/// symbol index). Unlike `SymbolDef` it carries the owning file path.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SymbolSearchResult {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// Escape LIKE wildcards so a user query is matched literally (paired with
/// `ESCAPE '\'` in the SQL). Without this, `%`/`_` in a query would act as
/// wildcards and `\` would corrupt the pattern.
fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
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

/// PR6.6 — `file_snapshots` row. `content` is raw bytes (1.0 ships
/// uncompressed; zstd is a 1.1 candidate). Not exported via specta because no
/// Tauri command returns it directly — `compute_diff` only consumes it
/// internally to produce a unified-diff string.
#[derive(Debug, Clone)]
pub struct FileSnapshot {
    pub id: u32,
    pub project_id: u32,
    pub path: String,
    pub content: Vec<u8>,
    pub hash: String,
    pub captured_at: u32,
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

// ---------- G3: Clarify types (MASTER-GUIDE §4.3) ----------

/// A single clarifying question shown to the user before we let the LLM
/// produce the final English prompt. `kind` is either `"choice"` (radio
/// buttons with `options`) or `"text"` (free-form input, `options` empty).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ClarifyQuestion {
    pub id: String,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub options: Vec<String>,
}

/// Backend response for the ambiguity-check pass. When `auto_proceed` is true
/// the caller may skip the clarify dialog entirely and go straight to
/// `generate_edit_prompt_with_answers` with no answers.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ClarifyResult {
    pub ambiguity_score: f32,
    pub questions: Vec<ClarifyQuestion>,
    pub auto_proceed: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ClarifyAnswer {
    pub id: String,
    pub answer: String,
}

// ---------- UI-5: ConversationAction (W5) ----------

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ConversationAction {
    pub id: u32,
    pub conversation_id: u32,
    pub message_index: u32,
    pub status: String,
    pub applied_at: u32,
}

// ---------- G1: Changelog types (MASTER-GUIDE §4.1) ----------

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChangelogEntry {
    pub id: u32,
    pub project_id: u32,
    pub user_intent: Option<String>,
    pub prompt_text: Option<String>,
    pub ai_summary: String,
    pub title: Option<String>,
    pub category: Option<String>,
    pub external_tool: Option<String>,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub created_at: u32,
    pub pinned: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChangelogFileEntry {
    pub id: u32,
    pub entry_id: u32,
    pub file_path: String,
    pub change_type: String,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub per_file_summary: Option<String>,
    pub diff_patch: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ProjectOverview {
    pub project_id: u32,
    pub identity: Option<String>,
    /// JSON-encoded stack metadata. Stored as TEXT for forward compatibility
    /// (the LLM is free to add new keys without a migration).
    pub stack_json: Option<String>,
    pub overview_md: Option<String>,
    pub source_signature: Option<String>,
    pub generated_at: Option<u32>,
    pub generated_by_model: Option<String>,
}

// ---------- G4: Greenfield Blueprint (W6) ----------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ProjectBlueprint {
    pub id: u32,
    pub name: String,
    pub idea_text: Option<String>,
    pub target_users: Option<String>,
    pub stack_choice: Option<String>,
    pub folder_name: Option<String>,
    pub folder_path: Option<String>,
    pub seed_goals_json: Option<String>,
    pub wizard_step: u32,
    pub created_at: u32,
    pub updated_at: u32,
}

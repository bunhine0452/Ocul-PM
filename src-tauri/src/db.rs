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
}

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

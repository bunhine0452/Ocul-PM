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
    (17, include_str!("../migrations/017_embedding_model_quantized.sql")),
    (18, include_str!("../migrations/018_code_graph.sql")),
    (19, include_str!("../migrations/019_symbol_relations.sql")),
    (20, include_str!("../migrations/020_symbol_relations_from.sql")),
    (21, include_str!("../migrations/021_oculpm_agent_version.sql")),
    (22, include_str!("../migrations/022_retro_insights.sql")),
    (23, include_str!("../migrations/023_coercion_version.sql")),
    (24, include_str!("../migrations/024_oculpm_discussion.sql")),
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
        include_docs: bool,
    ) -> Result<Vec<ChunkSearchResult>> {
        // Over-fetch from the vector index so we still have `limit` results
        // after filtering by project_id.
        let k = (limit as i64).max(1).saturating_mul(5);
        let results = self
            .conn
            .call(move |c| {
                // Bug 2 — drop single-line chunks (no newline in `content`).
                // These are the import/brace "gap" fragments that the AST
                // chunker used to emit between symbols; they match weakly on
                // almost any query and crowd out real results. Genuine symbol
                // chunks carry an `// AST Symbol: …\n` prefix so they always
                // contain a newline and survive this filter. The 5× over-fetch
                // (`k`) keeps `limit` results after the filter. (Re-indexing
                // also stops new noise at the source — see indexer::chunk_file.)
                //
                // 의미검색 문서 제외 — by default semantic search hides prose
                // files (.md/.txt/…) that match loosely and bury real code
                // hits; `include_docs` opts them back in.
                let mut sql = String::from(
                    "SELECT c.id, f.path, c.start_line, c.end_line, c.content, ce.distance
                     FROM chunk_embeddings ce
                     JOIN chunks c ON c.id = ce.chunk_id
                     JOIN files f ON f.id = c.file_id
                     WHERE ce.embedding MATCH ?1 AND k = ?2
                       AND f.project_id = ?3
                       AND instr(c.content, char(10)) > 0",
                );
                if !include_docs {
                    sql.push_str(DOC_EXCLUDE_SQL);
                }
                sql.push_str(" ORDER BY ce.distance ASC LIMIT ?4");
                let mut stmt = c.prepare(&sql)?;
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

    /// v2 U7 — 팔레트 엔티티 점프: 일지·플랜·플랜 항목·토의 제목 통합 검색.
    /// 각 kind 를 개별 쿼리(prefix 매치 우선 스코어)로 뽑아 Rust 에서 병합
    /// 정렬(score ASC, 최신 ASC 문자열 비교 역순)한다. docs 파일은 캐시
    /// 테이블이 없어 프런트가 `docs_tree` 로 별도 처리한다.
    pub async fn search_oculpm_entities(
        &self,
        project_id: u32,
        query: String,
        limit: u32,
    ) -> Result<Vec<EntityHit>> {
        let q = query.trim().to_string();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let prefix = format!("{}%", escape_like(&q));
        let sub = format!("%{}%", escape_like(&q));
        let lim = limit.clamp(1, 50) as i64;
        let hits = self
            .conn
            .call(move |c| {
                // (score, recency, hit) — recency 는 RFC3339 문자열 (사전순 ≈ 시간순).
                let mut acc: Vec<(i64, String, EntityHit)> = Vec::new();

                {
                    let mut stmt = c.prepare(
                        "SELECT relative_path, title, workday, type, created_at,
                                CASE WHEN title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_journal
                         WHERE project_id = ?1
                           AND (title LIKE ?3 ESCAPE '\\' OR slug LIKE ?3 ESCAPE '\\')
                         ORDER BY 6 ASC, created_at DESC LIMIT ?4",
                    )?;
                    let rows = stmt.query_map(
                        params![project_id as i64, prefix, sub, lim],
                        |r| {
                            let workday: String = r.get(2)?;
                            let ty: String = r.get(3)?;
                            Ok((
                                r.get::<_, i64>(5)?,
                                r.get::<_, String>(4)?,
                                EntityHit {
                                    kind: EntityKind::Journal,
                                    id: r.get(0)?,
                                    title: r.get(1)?,
                                    subtitle: format!("{workday} · {ty}"),
                                },
                            ))
                        },
                    )?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                {
                    let mut stmt = c.prepare(
                        "SELECT plan_id, title, status, updated_at,
                                CASE WHEN title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_plans
                         WHERE project_id = ?1
                           AND (title LIKE ?3 ESCAPE '\\' OR plan_id LIKE ?3 ESCAPE '\\')
                         ORDER BY 5 ASC, updated_at DESC LIMIT ?4",
                    )?;
                    let rows = stmt.query_map(
                        params![project_id as i64, prefix, sub, lim],
                        |r| {
                            let status: String = r.get(2)?;
                            Ok((
                                r.get::<_, i64>(4)?,
                                r.get::<_, String>(3)?,
                                EntityHit {
                                    kind: EntityKind::Plan,
                                    id: r.get(0)?,
                                    title: r.get(1)?,
                                    subtitle: format!("플랜 · {status}"),
                                },
                            ))
                        },
                    )?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                {
                    let mut stmt = c.prepare(
                        "SELECT i.plan_id, i.item_id, i.title, p.title,
                                COALESCE(i.last_update, p.updated_at),
                                CASE WHEN i.title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_plan_items i
                         JOIN oculpm_plans p
                           ON p.project_id = i.project_id AND p.plan_id = i.plan_id
                         WHERE i.project_id = ?1 AND i.title LIKE ?3 ESCAPE '\\'
                         ORDER BY 6 ASC, 5 DESC LIMIT ?4",
                    )?;
                    let rows = stmt.query_map(
                        params![project_id as i64, prefix, sub, lim],
                        |r| {
                            let plan_id: String = r.get(0)?;
                            let item_id: String = r.get(1)?;
                            Ok((
                                r.get::<_, i64>(5)?,
                                r.get::<_, String>(4)?,
                                EntityHit {
                                    kind: EntityKind::PlanItem,
                                    id: format!("{plan_id}#{item_id}"),
                                    title: r.get(2)?,
                                    subtitle: r.get(3)?,
                                },
                            ))
                        },
                    )?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                {
                    let mut stmt = c.prepare(
                        "SELECT discussion_id, title, status, updated_at,
                                CASE WHEN title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_discussions
                         WHERE project_id = ?1
                           AND (title LIKE ?3 ESCAPE '\\' OR discussion_id LIKE ?3 ESCAPE '\\')
                         ORDER BY 5 ASC, updated_at DESC LIMIT ?4",
                    )?;
                    let rows = stmt.query_map(
                        params![project_id as i64, prefix, sub, lim],
                        |r| {
                            let status: String = r.get(2)?;
                            Ok((
                                r.get::<_, i64>(4)?,
                                r.get::<_, String>(3)?,
                                EntityHit {
                                    kind: EntityKind::Discussion,
                                    id: r.get(0)?,
                                    title: r.get(1)?,
                                    subtitle: format!("토의 · {status}"),
                                },
                            ))
                        },
                    )?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                // prefix 매치 우선, 동점이면 최신 우선.
                acc.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
                acc.truncate(lim as usize);
                Ok(acc.into_iter().map(|(_, _, h)| h).collect::<Vec<_>>())
            })
            .await?;
        Ok(hits)
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

    /// Drop a single file (and, via FK cascade + trigger, its chunks,
    /// embeddings, and symbols) from the index. Used by the watcher's
    /// incremental auto-index when a file is deleted on disk so search stops
    /// returning hits from a file that no longer exists.
    pub async fn delete_file_by_path(&self, project_id: u32, path: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM files WHERE project_id = ?1 AND path = ?2",
                    params![project_id as i64, &path],
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

    /// PR-GR2 — replace a file's raw relations (delete + insert in one tx) so
    /// re-indexing a changed file doesn't duplicate rows. Resolved into edges by
    /// rebuild_code_graph. `relations` is (kind, name) — already de-duped.
    pub async fn replace_symbol_relations(
        &self,
        file_id: u32,
        relations: Vec<(String, Option<String>, String)>, // (kind, from_symbol, name)
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM symbol_relations WHERE file_id = ?",
                    params![file_id as i64],
                )?;
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO symbol_relations (file_id, kind, from_symbol, name) VALUES (?, ?, ?, ?)",
                    )?;
                    for (kind, from_symbol, name) in &relations {
                        ins.execute(params![file_id as i64, kind, from_symbol, name])?;
                    }
                }
                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// PR-GR1 — rebuild the code graph (graph_nodes/graph_edges) for a project
    /// from the already-indexed files / symbol_definitions / file_dependencies.
    /// Pure SQL, LLM-free, deterministic (docs/graph-upgrade D-A). Full rebuild
    /// in one transaction, run at the end of indexing. Fills `contains`
    /// (file→symbol) + `imports` (file→file); calls/inherits land in PR-GR2.
    pub async fn rebuild_code_graph(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM graph_edges WHERE project_id = ?",
                    params![project_id as i64],
                )?;
                tx.execute(
                    "DELETE FROM graph_nodes WHERE project_id = ?",
                    params![project_id as i64],
                )?;

                // file nodes
                let files: Vec<(i64, String, Option<String>)> = {
                    let mut s = tx.prepare("SELECT id, path, language FROM files WHERE project_id = ?")?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                let mut file_node: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO graph_nodes (project_id, kind, file_id, symbol_id, label, sub_kind, language, start_line, end_line)
                         VALUES (?, 'file', ?, NULL, ?, NULL, ?, NULL, NULL)",
                    )?;
                    for (fid, path, lang) in &files {
                        let label = path.rsplit('/').next().unwrap_or(path.as_str()).to_string();
                        ins.execute(params![project_id as i64, fid, label, lang])?;
                        file_node.insert(*fid, tx.last_insert_rowid());
                    }
                }

                // symbol nodes + `contains` edges (file → its symbols)
                let syms: Vec<(i64, i64, String, String, i64, i64)> = {
                    let mut s = tx.prepare(
                        "SELECT sd.id, sd.file_id, sd.name, sd.kind, sd.start_line, sd.end_line
                         FROM symbol_definitions sd JOIN files f ON f.id = sd.file_id
                         WHERE f.project_id = ?",
                    )?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)?,
                            r.get::<_, i64>(5)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO graph_nodes (project_id, kind, file_id, symbol_id, label, sub_kind, language, start_line, end_line)
                         VALUES (?, 'symbol', ?, ?, ?, ?, NULL, ?, ?)",
                    )?;
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, 'contains', ?, ?, 1.0, 'forward', 0)",
                    )?;
                    for (sid, fid, name, kind, sl, el) in &syms {
                        ins.execute(params![project_id as i64, fid, sid, name, kind, sl, el])?;
                        let node_id = tx.last_insert_rowid();
                        if let Some(&fnode) = file_node.get(fid) {
                            ins_edge.execute(params![project_id as i64, fnode, node_id])?;
                        }
                    }
                }

                // `imports` edges (file → file), mapped onto file nodes
                {
                    let deps: Vec<(i64, i64)> = {
                        let mut s = tx.prepare(
                            "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        rows.collect::<rusqlite::Result<Vec<_>>>()?
                    };
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, 'imports', ?, ?, 1.0, 'forward', 0)",
                    )?;
                    for (src, tgt) in &deps {
                        if let (Some(&s), Some(&t)) = (file_node.get(src), file_node.get(tgt)) {
                            ins_edge.execute(params![project_id as i64, s, t])?;
                        }
                    }
                }

                // calls / inherits / implements edges (file → file), resolved
                // from raw symbol_relations (PR-GR2). File-level for readability:
                // a callee/parent `name` resolves to the file(s) defining a
                // symbol of that name. Confident (estimated=0) when the source
                // file imports that file; else a single global definer is an
                // estimated guess (estimated=1). Ambiguous (>1, not imported) is
                // skipped to avoid noise.
                {
                    let mut defs: std::collections::HashMap<String, Vec<i64>> =
                        std::collections::HashMap::new();
                    {
                        let mut s = tx.prepare(
                            "SELECT sd.name, sd.file_id FROM symbol_definitions sd
                             JOIN files f ON f.id = sd.file_id WHERE f.project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        for row in rows {
                            let (name, fid) = row?;
                            defs.entry(name).or_default().push(fid);
                        }
                    }
                    let mut imports_of: std::collections::HashMap<i64, std::collections::HashSet<i64>> =
                        std::collections::HashMap::new();
                    {
                        let mut s = tx.prepare(
                            "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        for row in rows {
                            let (sfid, tfid) = row?;
                            imports_of.entry(sfid).or_default().insert(tfid);
                        }
                    }
                    let rels: Vec<(i64, String, String)> = {
                        let mut s = tx.prepare(
                            "SELECT sr.file_id, sr.kind, sr.name FROM symbol_relations sr
                             JOIN files f ON f.id = sr.file_id WHERE f.project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((
                                r.get::<_, i64>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                            ))
                        })?;
                        rows.collect::<rusqlite::Result<Vec<_>>>()?
                    };
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, ?, ?, ?, ?, 'forward', ?)",
                    )?;
                    for (src_fid, kind, name) in &rels {
                        let candidates = match defs.get(name) {
                            Some(c) => c,
                            None => continue,
                        };
                        let imported = imports_of.get(src_fid);
                        let mut targets: Vec<i64> = Vec::new();
                        let mut estimated = 0i64;
                        for &cand in candidates {
                            if cand != *src_fid && imported.map_or(false, |s| s.contains(&cand)) {
                                targets.push(cand);
                            }
                        }
                        if targets.is_empty() {
                            let others: Vec<i64> =
                                candidates.iter().copied().filter(|&c| c != *src_fid).collect();
                            if others.len() == 1 {
                                targets.push(others[0]);
                                estimated = 1;
                            }
                        }
                        let weight: f64 = if estimated == 1 { 0.5 } else { 0.8 };
                        for tgt in targets {
                            if let (Some(&s), Some(&t)) = (file_node.get(src_fid), file_node.get(&tgt)) {
                                ins_edge.execute(params![project_id as i64, kind, s, t, weight, estimated])?;
                            }
                        }
                    }
                }

                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// PR-GR1 — read the code graph for rendering. `symbol_level=false` returns
    /// only file nodes + file→file (`imports`) edges (equivalent to
    /// get_dependency_graph but typed); `true` also includes symbol nodes +
    /// `contains` edges.
    pub async fn get_code_graph(&self, project_id: u32, symbol_level: bool) -> Result<CodeGraph> {
        // Lazy backfill: projects indexed before PR-GR1 have empty graph tables
        // (they fill on the next index). If the graph is empty but the project
        // has files, build it once now so the Code Map works without a reindex.
        let needs_backfill = self
            .conn
            .call(move |c| {
                let nodes: i64 = c.query_row(
                    "SELECT COUNT(*) FROM graph_nodes WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                let files: i64 = c.query_row(
                    "SELECT COUNT(*) FROM files WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                Ok(nodes == 0 && files > 0)
            })
            .await?;
        if needs_backfill {
            self.rebuild_code_graph(project_id).await?;
        }

        let graph = self
            .conn
            .call(move |c| {
                let node_sql = if symbol_level {
                    "SELECT gn.id, gn.kind, gn.label, gn.sub_kind, gn.language, gn.file_id, f.path, gn.start_line, gn.end_line
                     FROM graph_nodes gn JOIN files f ON f.id = gn.file_id WHERE gn.project_id = ?"
                } else {
                    "SELECT gn.id, gn.kind, gn.label, gn.sub_kind, gn.language, gn.file_id, f.path, gn.start_line, gn.end_line
                     FROM graph_nodes gn JOIN files f ON f.id = gn.file_id WHERE gn.project_id = ? AND gn.kind = 'file'"
                };
                let mut stmt = c.prepare(node_sql)?;
                let nodes = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(GraphNodeDto {
                            id: r.get::<_, i64>(0)? as u32,
                            kind: r.get(1)?,
                            label: r.get(2)?,
                            sub_kind: r.get(3)?,
                            language: r.get(4)?,
                            file_id: r.get::<_, i64>(5)? as u32,
                            file_path: r.get(6)?,
                            start_line: r.get::<_, Option<i64>>(7)?.map(|v| v as u32),
                            end_line: r.get::<_, Option<i64>>(8)?.map(|v| v as u32),
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                let edge_sql = if symbol_level {
                    "SELECT id, edge_type, source_id, target_id, weight, direction, estimated
                     FROM graph_edges WHERE project_id = ?"
                } else {
                    "SELECT ge.id, ge.edge_type, ge.source_id, ge.target_id, ge.weight, ge.direction, ge.estimated
                     FROM graph_edges ge
                     JOIN graph_nodes s ON s.id = ge.source_id
                     JOIN graph_nodes t ON t.id = ge.target_id
                     WHERE ge.project_id = ? AND s.kind = 'file' AND t.kind = 'file'"
                };
                let mut stmt = c.prepare(edge_sql)?;
                let edges = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(GraphEdgeDto {
                            id: r.get::<_, i64>(0)? as u32,
                            edge_type: r.get(1)?,
                            source: r.get::<_, i64>(2)? as u32,
                            target: r.get::<_, i64>(3)? as u32,
                            weight: r.get::<_, f64>(4)? as f32,
                            direction: r.get(5)?,
                            estimated: r.get::<_, i64>(6)? != 0,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(CodeGraph { nodes, edges })
            })
            .await?;
        Ok(graph)
    }

    /// PR-GR4 — change-impact analysis. Given changed file paths, return the
    /// files that (transitively) import them (reverse-dependency BFS over
    /// file_dependencies). `depth` = hops from the nearest changed file.
    pub async fn get_change_impact(
        &self,
        project_id: u32,
        changed_paths: Vec<String>,
    ) -> Result<ImpactReport> {
        let report = self
            .conn
            .call(move |c| {
                use std::collections::{HashMap, HashSet, VecDeque};
                // path <-> file_id
                let mut path_to_id: HashMap<String, i64> = HashMap::new();
                let mut id_to_path: HashMap<i64, String> = HashMap::new();
                {
                    let mut s = c.prepare("SELECT id, path FROM files WHERE project_id = ?")?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    })?;
                    for row in rows {
                        let (id, path) = row?;
                        path_to_id.insert(path.clone(), id);
                        id_to_path.insert(id, path);
                    }
                }
                // reverse adjacency: target_file_id -> [source_file_id] (source imports target)
                let mut importers: HashMap<i64, Vec<i64>> = HashMap::new();
                {
                    let mut s = c.prepare(
                        "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                    )?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                    })?;
                    for row in rows {
                        let (src, tgt) = row?;
                        importers.entry(tgt).or_default().push(src);
                    }
                }
                // seeds = changed files present in the index
                let mut seeds: Vec<i64> = Vec::new();
                let mut matched: Vec<String> = Vec::new();
                for p in &changed_paths {
                    if let Some(&id) = path_to_id.get(p) {
                        seeds.push(id);
                        matched.push(p.clone());
                    }
                }
                let seed_set: HashSet<i64> = seeds.iter().copied().collect();
                let mut depth: HashMap<i64, u32> = HashMap::new();
                let mut queue: VecDeque<i64> = VecDeque::new();
                for &s in &seeds {
                    depth.insert(s, 0);
                    queue.push_back(s);
                }
                while let Some(cur) = queue.pop_front() {
                    let d = depth[&cur];
                    if let Some(srcs) = importers.get(&cur) {
                        for &src in srcs {
                            if !depth.contains_key(&src) {
                                depth.insert(src, d + 1);
                                queue.push_back(src);
                            }
                        }
                    }
                }
                let mut affected: Vec<ImpactNode> = depth
                    .into_iter()
                    .filter(|(id, _)| !seed_set.contains(id))
                    .filter_map(|(id, d)| {
                        id_to_path.get(&id).map(|p| ImpactNode {
                            file_id: id as u32,
                            path: p.clone(),
                            depth: d,
                        })
                    })
                    .collect();
                affected.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.path.cmp(&b.path)));
                Ok(ImpactReport { changed: matched, affected })
            })
            .await?;
        Ok(report)
    }

    /// PR-GR3 — symbol-level calls for one file's symbols ("which function calls
    /// which"). Resolves each callee name to a defining file: same file →
    /// imported file → single global definer (estimated). Read-only.
    pub async fn get_file_calls(&self, file_id: u32) -> Result<Vec<SymbolCall>> {
        let calls = self
            .conn
            .call(move |c| {
                use std::collections::{HashMap, HashSet};
                let project_id: i64 = c.query_row(
                    "SELECT project_id FROM files WHERE id = ?",
                    [file_id as i64],
                    |r| r.get(0),
                )?;
                // name -> [(path, file_id)] defining a symbol of that name
                let mut defs: HashMap<String, Vec<(String, i64)>> = HashMap::new();
                {
                    let mut s = c.prepare(
                        "SELECT sd.name, f.path, f.id FROM symbol_definitions sd
                         JOIN files f ON f.id = sd.file_id WHERE f.project_id = ?",
                    )?;
                    let rows = s.query_map([project_id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
                    })?;
                    for row in rows {
                        let (n, p, fid) = row?;
                        defs.entry(n).or_default().push((p, fid));
                    }
                }
                let mut imported: HashSet<i64> = HashSet::new();
                {
                    let mut s = c.prepare(
                        "SELECT target_file_id FROM file_dependencies WHERE source_file_id = ?",
                    )?;
                    let rows = s.query_map([file_id as i64], |r| r.get::<_, i64>(0))?;
                    for row in rows {
                        imported.insert(row?);
                    }
                }
                let rels: Vec<(String, Option<String>, String)> = {
                    let mut s = c.prepare(
                        "SELECT kind, from_symbol, name FROM symbol_relations WHERE file_id = ?
                         ORDER BY from_symbol IS NULL, from_symbol, kind, name",
                    )?;
                    let rows = s.query_map([file_id as i64], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                let self_id = file_id as i64;
                let mut out = Vec::new();
                for (kind, from_symbol, name) in rels {
                    let (target_path, estimated) = match defs.get(&name) {
                        None => (None, false),
                        Some(list) => {
                            if let Some((p, _)) = list.iter().find(|(_, fid)| *fid == self_id) {
                                (Some(p.clone()), false)
                            } else if let Some((p, _)) =
                                list.iter().find(|(_, fid)| imported.contains(fid))
                            {
                                (Some(p.clone()), false)
                            } else {
                                let others: Vec<&(String, i64)> =
                                    list.iter().filter(|(_, fid)| *fid != self_id).collect();
                                if others.len() == 1 {
                                    (Some(others[0].0.clone()), true)
                                } else {
                                    (None, false)
                                }
                            }
                        }
                    };
                    out.push(SymbolCall { from_symbol, kind, callee: name, target_path, estimated });
                }
                Ok(out)
            })
            .await?;
        Ok(calls)
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

    // ---------- G1: Changelog (legacy, inert) ----------
    //
    // The `changelog_entries` / `changelog_files` / `oculpm_migrations` tables +
    // their schema migrations are retained (no DROP) for safety, but ALL reader/
    // writer code and the SQLite→`.oculpm` migration subsystem were removed
    // 2026-06-22: no v0.x public release exists to upgrade from, so the migration
    // was pure dead code (dev-report §3-C, decision "C"). The tables sit unused.

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

fn retro_insight_from_row(r: &rusqlite::Row) -> rusqlite::Result<RetroInsight> {
    Ok(RetroInsight {
        project_id: r.get::<_, i64>(0)? as u32,
        range_key: r.get(1)?,
        signature: r.get(2)?,
        retro_md: r.get(3)?,
        generated_at: r.get::<_, i64>(4)? as u32,
        generated_by_model: r.get(5)?,
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

/// v2 U7 (docs/20260706_v2/02-features-spec.md §2) — 팔레트 "go to anything"
/// 히트 한 건. `id` 는 kind 별 라우팅 키: journal=relative_path,
/// plan=plan_id, plan_item="plan_id#item_id", discussion=discussion_id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Journal,
    Plan,
    PlanItem,
    Discussion,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EntityHit {
    pub kind: EntityKind,
    pub id: String,
    pub title: String,
    /// 보조 문맥 — 일지: "워크데이 · 타입", 플랜 항목: 플랜 제목, 토의: status.
    pub subtitle: String,
}

/// SQL fragment that excludes prose/documentation files from a result set by
/// path suffix (의미검색 문서 제외). Appended to `search_chunks` when the
/// caller asks for code-only results. Lives here next to the search queries so
/// the extension list stays in one place.
const DOC_EXCLUDE_SQL: &str = " AND lower(f.path) NOT LIKE '%.md' \
     AND lower(f.path) NOT LIKE '%.mdx' \
     AND lower(f.path) NOT LIKE '%.markdown' \
     AND lower(f.path) NOT LIKE '%.txt' \
     AND lower(f.path) NOT LIKE '%.text' \
     AND lower(f.path) NOT LIKE '%.rst' \
     AND lower(f.path) NOT LIKE '%.adoc' \
     AND lower(f.path) NOT LIKE '%.asciidoc' \
     AND lower(f.path) NOT LIKE '%.org'";

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

// Code graph (PR-GR1) — multi-relation, file + symbol level. Returned by
// `get_code_graph`; built by `rebuild_code_graph`. See docs/graph-upgrade/.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GraphNodeDto {
    pub id: u32,
    pub kind: String, // "file" | "symbol"
    pub label: String,
    pub sub_kind: Option<String>,
    pub language: Option<String>,
    pub file_id: u32,
    pub file_path: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GraphEdgeDto {
    pub id: u32,
    pub edge_type: String, // imports | contains | calls | inherits | implements | similar_to
    pub source: u32,
    pub target: u32,
    pub weight: f32,
    pub direction: String,
    pub estimated: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct CodeGraph {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
}

// Change-impact (PR-GR4) — reverse-dependency BFS from a set of changed files.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ImpactNode {
    pub file_id: u32,
    pub path: String,
    pub depth: u32, // hops from the nearest changed file (1 = direct importer)
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ImpactReport {
    /// Changed paths that were found in the index (subset of the input).
    pub changed: Vec<String>,
    /// Files that (transitively) import a changed file, nearest first.
    pub affected: Vec<ImpactNode>,
}

// Symbol-level call (PR-GR3) — "which function calls/uses which".
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SymbolCall {
    /// Caller symbol in this file (None = file top-level).
    pub from_symbol: Option<String>,
    pub kind: String, // calls | inherits | implements
    pub callee: String,
    /// Resolved defining file path (None = external / unresolved).
    pub target_path: Option<String>,
    pub estimated: bool,
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

/// F4 — one cached retrospective for a workday range. `signature` is a hash of
/// the deterministic signals; when it diverges from the current signals the
/// frontend marks the cached narrative stale. Mirrors `project_overviews`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct RetroInsight {
    pub project_id: u32,
    /// "YYYYMMDD..YYYYMMDD" (inclusive workday range).
    pub range_key: String,
    pub signature: String,
    pub retro_md: String,
    pub generated_at: u32,
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

//! 코드 인덱스 — 파일/청크/심볼 업서트, 임베딩·FTS·엔티티 검색, 해시·스냅샷.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
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
                    c.execute(
                        "DELETE FROM file_dependencies WHERE source_file_id = ?",
                        [id],
                    )?;
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

    /// 한 배치의 청크+임베딩을 트랜잭션 하나로 적재한다.
    ///
    /// 예전에는 청크 하나마다 이 일을 했다 — tokio-rusqlite 채널 왕복 1회,
    /// BEGIN/COMMIT 1회, 문장 준비 2회. 파일 5,000개 × 청크 20개면 왕복 10만 번이
    /// 되어 첫 인덱싱의 실질적인 병목이었다. 임베딩은 이미 EMBED_BATCH 단위로
    /// 묶여 있으니 적재도 같은 단위로 묶는다.
    ///
    /// `prepare_cached` 는 같은 SQL 을 배치 안에서 재사용해 파싱을 한 번만 한다.
    pub async fn insert_chunks_with_embeddings(
        &self,
        file_id: u32,
        rows: Vec<ChunkInsert>,
    ) -> Result<usize> {
        if rows.is_empty() {
            return Ok(0);
        }
        let inserted = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                {
                    // 준비된 문장은 tx 를 빌리므로 commit(자기 소유 소비) 전에
                    // 반드시 스코프를 닫아 드롭시켜야 한다.
                    let mut insert_chunk = tx.prepare_cached(
                        "INSERT INTO chunks (file_id, kind, start_line, end_line, content)
                         VALUES (?, ?, ?, ?, ?)",
                    )?;
                    let mut insert_embedding = tx.prepare_cached(
                        "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)",
                    )?;
                    for row in &rows {
                        insert_chunk.execute(params![
                            file_id as i64,
                            &row.kind,
                            row.start_line as i64,
                            row.end_line as i64,
                            &row.content,
                        ])?;
                        let chunk_id = tx.last_insert_rowid();
                        insert_embedding.execute(params![chunk_id, &row.embedding])?;
                    }
                }
                tx.commit()?;
                Ok(rows.len())
            })
            .await?;
        Ok(inserted)
    }

    /// 한 파일치 심볼 정의를 트랜잭션 하나로 적재한다 (위와 같은 이유).
    pub async fn insert_symbol_definitions(
        &self,
        file_id: u32,
        symbols: Vec<crate::ast::SymbolDef>,
    ) -> Result<usize> {
        if symbols.is_empty() {
            return Ok(0);
        }
        let inserted = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                {
                    let mut stmt = tx.prepare_cached(
                        "INSERT INTO symbol_definitions
                           (file_id, name, kind, start_line, end_line, start_byte, end_byte)
                         VALUES (?, ?, ?, ?, ?, ?, ?)",
                    )?;
                    for symbol in &symbols {
                        stmt.execute(params![
                            file_id as i64,
                            &symbol.name,
                            &symbol.kind,
                            symbol.start_line as i64,
                            symbol.end_line as i64,
                            symbol.start_byte as i64,
                            symbol.end_byte as i64,
                        ])?;
                    }
                }
                tx.commit()?;
                Ok(symbols.len())
            })
            .await?;
        Ok(inserted)
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
    ///
    /// LIKE 풀스캔이 맞다 (2026-08-30 결정, `improvement-audit-round.md` D2):
    /// v2 U11 이 설계한 trigram FTS5 는 등록된 적이 없어 항상 이 경로로 폴백돼
    /// 왔고, 라이브 DB 로 재 보니 트라이그램 색인이 **본문의 2.1배(376MB)** 에
    /// 첫 적재 15초인 반면 LIKE 는 오염된 178MB 위에서도 132ms 였다. 색인 소음
    /// (031) 을 걷어내면 프로젝트당 수십 MB — 수십 ms 다. 2배 디스크를 낼 만한
    /// 차이가 아니라 FTS 파일과 폴백 분기를 함께 걷어냈다.
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
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
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
                        })?;
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
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
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
                        })?;
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
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
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
                        })?;
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
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
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
                        })?;
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

    /// Newest `indexed_at` across the project's files — `None` when nothing
    /// has been indexed yet (the doctor row "마지막 색인").
    pub async fn last_indexed_at(&self, project_id: u32) -> Result<Option<i64>> {
        let ts = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT MAX(indexed_at) FROM files WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get::<_, Option<i64>>(0),
                )
            })
            .await?;
        Ok(ts)
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

    /// Returns the stored hash for a file by project_id and path.
    pub async fn get_file_hash(
        &self,
        project_id: u32,
        path: String,
    ) -> Result<Option<(u32, String)>> {
        let result = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT id, hash FROM files WHERE project_id = ?1 AND path = ?2",
                    params![project_id as i64, &path],
                    |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, String>(1)?)),
                )
                .optional()
            })
            .await?;
        Ok(result)
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
}

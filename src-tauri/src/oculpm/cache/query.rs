//! 엔트리 조회 — 목록·단건·개수·경로별 요약·기간 조회.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl<'a> JournalCache<'a> {
    // ────────── reads ──────────

    pub async fn list_entries(
        &self,
        project_id: u32,
        workday: Option<&str>,
        filters: &EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        let workdays: Vec<String> = workday.map(str::to_string).into_iter().collect();
        self.list_entries_in(project_id, workdays, filters).await
    }

    /// 여러 워크데이의 요약을 **왕복 한 번**에 (완성도 라운드 Phase 3).
    ///
    /// `oculpm_workday_brief` 가 날짜마다 `list_entries` 를 돌려 Today 7일이
    /// 14회, 일지 14일이 28회의 직렬 커넥션 왕복이었다. `workday IN (…)` 은
    /// `idx_oculpm_journal_workday` 를 그대로 타고, 태그·파일 수 하이드레이션도
    /// 한 번이면 된다. 정렬은 `list_entries` 와 같다(workday DESC, created_at
    /// DESC) — 호출자가 `workday` 로 버킷을 나누면 날짜 안 순서가 보존된다.
    pub async fn list_entries_for_workdays(
        &self,
        project_id: u32,
        workdays: &[String],
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        if workdays.is_empty() {
            return Ok(Vec::new());
        }
        self.list_entries_in(project_id, workdays.to_vec(), &EntryFilters::default())
            .await
    }

    async fn list_entries_in(
        &self,
        project_id: u32,
        workdays: Vec<String>,
        filters: &EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        let pid = project_id as i64;
        let filters = filters.clone();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let (sql, bound) = build_list_sql(pid, &workdays, &filters);
                let mut stmt = c.prepare(&sql)?;
                let collected: rusqlite::Result<Vec<JournalEntrySummary>> = stmt
                    .query_map(params_from_iter(bound.iter()), summary_from_row)?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;

        // Hydrate per-row tag/file counts in one extra query for the rows
        // returned. (Naive N+1 would be unacceptable; we batch with IN.)
        if rows.is_empty() {
            return Ok(rows);
        }
        let mut by_path: HashMap<String, (Vec<String>, u32)> = HashMap::new();
        let pid2 = project_id as i64;
        let paths: Vec<String> = rows.iter().map(|r| r.relative_path.clone()).collect();
        let paths_for_query = paths.clone();
        let agg = self
            .db
            .conn()
            .call(move |c| {
                let mut out: HashMap<String, (Vec<String>, u32)> = HashMap::new();
                let placeholders = (1..=paths_for_query.len())
                    .map(|i| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(",");
                let tag_sql = format!(
                    "SELECT relative_path, tag FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path IN ({placeholders})"
                );
                let mut bound: Vec<Box<dyn rusqlite::ToSql>> =
                    Vec::with_capacity(paths_for_query.len() + 1);
                bound.push(Box::new(pid2));
                for p in &paths_for_query {
                    bound.push(Box::new(p.clone()));
                }
                let mut stmt = c.prepare(&tag_sql)?;
                let bound_refs: Vec<&dyn rusqlite::ToSql> =
                    bound.iter().map(|b| b.as_ref()).collect();
                let tag_iter = stmt
                    .query_map(params_from_iter(bound_refs.iter().copied()), |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })?;
                for row in tag_iter {
                    let (path, tag) = row?;
                    out.entry(path).or_default().0.push(tag);
                }

                let file_sql = format!(
                    "SELECT relative_path, COUNT(*) FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path IN ({placeholders})
                     GROUP BY relative_path"
                );
                let mut stmt2 = c.prepare(&file_sql)?;
                let bound_refs2: Vec<&dyn rusqlite::ToSql> =
                    bound.iter().map(|b| b.as_ref()).collect();
                let file_iter = stmt2
                    .query_map(params_from_iter(bound_refs2.iter().copied()), |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u32))
                    })?;
                for row in file_iter {
                    let (path, count) = row?;
                    out.entry(path).or_default().1 = count;
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        by_path.extend(agg);

        let mut hydrated = rows;
        for row in &mut hydrated {
            if let Some((tags, files_count)) = by_path.remove(&row.relative_path) {
                row.tags = tags;
                row.files_count = files_count;
            }
        }
        Ok(hydrated)
    }

    /// v2 U12 — 프로젝트 전체 일지 수. Today 가 365일 히트맵 전체를 받아
    /// 프런트에서 숫자 하나로 축약하던 것을 대체한다.
    pub async fn count_entries(&self, project_id: u32) -> Result<u32, OculpmError> {
        let pid = project_id as i64;
        let count = self
            .db
            .conn()
            .call(move |c| {
                c.query_row(
                    "SELECT COUNT(*) FROM oculpm_journal WHERE project_id = ?1",
                    params![pid],
                    |r| r.get::<_, i64>(0),
                )
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(count.max(0) as u32)
    }

    /// F4 — every journal entry whose `workday` falls in `[since, until]`
    /// (inclusive, string-compared "YYYYMMDD"), each carrying its touched file
    /// paths and tags. Three bounded queries (entries, files, tags) joined in
    /// Rust — no per-entry N+1. Newest workday first. Drives the deterministic
    /// retro signal + promotion passes without hydrating the full summary.
    pub async fn range_entries(
        &self,
        project_id: u32,
        since: &str,
        until: &str,
    ) -> Result<Vec<RangeEntry>, OculpmError> {
        let pid = project_id as i64;
        let since = since.to_string();
        let until = until.to_string();
        let (since_q, until_q) = (since.clone(), until.clone());
        let (since_t, until_t) = (since.clone(), until.clone());

        let mut entries: Vec<RangeEntry> = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, workday, type, status, difficulty, agent_id, title
                     FROM oculpm_journal
                     WHERE project_id = ?1 AND workday >= ?2 AND workday <= ?3
                     ORDER BY workday DESC, relative_path",
                )?;
                let collected: rusqlite::Result<Vec<RangeEntry>> = stmt
                    .query_map(params![pid, &since_q, &until_q], |r| {
                        Ok(RangeEntry {
                            relative_path: r.get(0)?,
                            workday: r.get(1)?,
                            entry_type: r.get(2)?,
                            status: r.get(3)?,
                            difficulty: r.get(4)?,
                            agent_id: r.get(5)?,
                            title: r.get(6)?,
                            files: Vec::new(),
                            tags: Vec::new(),
                        })
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;

        if entries.is_empty() {
            return Ok(entries);
        }

        // Files for every entry in the same range, in one join.
        let files: Vec<(String, String)> = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT f.relative_path, f.file_path
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id
                      AND j.relative_path = f.relative_path
                     WHERE j.project_id = ?1 AND j.workday >= ?2 AND j.workday <= ?3",
                )?;
                let collected: rusqlite::Result<Vec<(String, String)>> = stmt
                    .query_map(params![pid, &since, &until], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;

        let mut by_path: HashMap<String, Vec<String>> = HashMap::new();
        for (rel, file) in files {
            by_path.entry(rel).or_default().push(file);
        }
        for e in &mut entries {
            if let Some(fs) = by_path.remove(&e.relative_path) {
                e.files = fs;
            }
        }

        // Tags for every entry in the same range, same one-join shape as files.
        let tags: Vec<(String, String)> = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT t.relative_path, t.tag
                     FROM oculpm_journal_tags t
                     JOIN oculpm_journal j
                       ON j.project_id = t.project_id
                      AND j.relative_path = t.relative_path
                     WHERE j.project_id = ?1 AND j.workday >= ?2 AND j.workday <= ?3",
                )?;
                let collected: rusqlite::Result<Vec<(String, String)>> = stmt
                    .query_map(params![pid, &since_t, &until_t], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;

        let mut tags_by_path: HashMap<String, Vec<String>> = HashMap::new();
        for (rel, tag) in tags {
            tags_by_path.entry(rel).or_default().push(tag);
        }
        for e in &mut entries {
            if let Some(ts) = tags_by_path.remove(&e.relative_path) {
                e.tags = ts;
            }
        }
        Ok(entries)
    }

    pub async fn get_entry(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<JournalEntry>, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let row = self
            .db
            .conn()
            .call(move |c| {
                let row: Option<EntryRow> = c
                    .query_row(
                        "SELECT relative_path, type, slug, status, difficulty, title, checkbox,
                                session_id, agent_id, language, verified_by_user, created_at,
                                updated_at, file_mtime, body_markdown, parse_ok, parse_warnings,
                                agent_version
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        entry_row_from,
                    )
                    .optional()?;
                let Some(row) = row else { return Ok(None) };
                let files: Vec<FileTouched> = {
                    let mut stmt = c.prepare(
                        "SELECT file_path, op, bytes_added, bytes_removed
                         FROM oculpm_journal_files
                         WHERE project_id = ?1 AND relative_path = ?2",
                    )?;
                    let collected: rusqlite::Result<Vec<FileTouched>> = stmt
                        .query_map(params![pid, &rp], file_touched_from_row)?
                        .collect();
                    collected?
                };
                let tags: Vec<String> = {
                    let mut stmt = c.prepare(
                        "SELECT tag FROM oculpm_journal_tags
                         WHERE project_id = ?1 AND relative_path = ?2",
                    )?;
                    let collected: rusqlite::Result<Vec<String>> = stmt
                        .query_map(params![pid, &rp], |r| r.get::<_, String>(0))?
                        .collect();
                    collected?
                };
                Ok(Some((row, files, tags)))
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(row.map(|(r, files, tags)| {
            let entry_type = parse_entry_type_str(&r.entry_type).unwrap_or(EntryType::Chore);
            let status = parse_entry_status_str(&r.status).unwrap_or(EntryStatus::Planned);
            let difficulty = r.difficulty.as_deref().and_then(parse_difficulty_str);
            let body_bytes = r.body_markdown.len() as u32;
            JournalEntry {
                relative_path: r.relative_path,
                frontmatter: JournalFrontmatter {
                    schema_version: 1,
                    entry_type,
                    slug: r.slug,
                    status,
                    difficulty,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    session_id: r.session_id,
                    agent: AgentRef {
                        id: r.agent_id,
                        // PR-CI1 에서 발견한 잠복 버그 fix — 021 부터 캐시 행에
                        // agent_version 이 있는데 하이드레이션이 버리고 있었다.
                        version: r.agent_version,
                    },
                    language: r.language,
                    verified_by_user: r.verified_by_user,
                    files_touched: files,
                    related: Vec::new(), // related is not cached separately yet
                    tags,
                },
                title: r.title,
                checkbox: r.checkbox.map(|n| n != 0),
                body_markdown: r.body_markdown,
                byte_size: body_bytes,
                mtime: r.file_mtime.to_string(),
                parse_ok: r.parse_ok,
                parse_warnings: parse_warnings_vec(&r.parse_warnings),
            }
        }))
    }

    /// W4 dogfooding follow-up (2026-05-26) — fetch a single entry's summary
    /// by `(project_id, relative_path)`. Used by the watcher right after
    /// `apply_path_change` to attach the hydrated row to `OculpmJournalAdded`/
    /// `OculpmJournalUpdated` events without round-tripping through
    /// `list_entries` (which scans + batch-aggregates the whole workday).
    ///
    /// Tags / `files_count` are filled with a single follow-up query each so
    /// the toast can render badges. Returns `None` if no row matches — e.g.
    /// the path was deleted between the upsert and this read.
    pub async fn get_summary_by_path(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<JournalEntrySummary>, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let summary = self
            .db
            .conn()
            .call(move |c| {
                let row: rusqlite::Result<Option<JournalEntrySummary>> = c
                    .query_row(
                        "SELECT relative_path, workday, type, slug, status, difficulty,
                                title, checkbox, session_id, agent_id, agent_version,
                                verified_by_user, created_at, updated_at, parse_ok, parse_warnings
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        summary_from_row,
                    )
                    .optional();
                row
            })
            .await
            .map_err(map_sqlite_err)?;

        let Some(mut summary) = summary else {
            return Ok(None);
        };

        // Hydrate tags + files_count with two single-path queries (cheap).
        let pid2 = project_id as i64;
        let rp2 = relative_path.to_string();
        let (tags, files_count) = self
            .db
            .conn()
            .call(move |c| {
                let mut tag_stmt = c.prepare(
                    "SELECT tag FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                )?;
                let tags: rusqlite::Result<Vec<String>> = tag_stmt
                    .query_map(params![pid2, &rp2], |r| r.get::<_, String>(0))?
                    .collect();
                let tags = tags?;

                let file_count: i64 = c
                    .query_row(
                        "SELECT COUNT(*) FROM oculpm_journal_files
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid2, &rp2],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                Ok((tags, file_count as u32))
            })
            .await
            .map_err(map_sqlite_err)?;

        summary.tags = tags;
        summary.files_count = files_count;
        Ok(Some(summary))
    }
}

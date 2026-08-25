//! 파일 축 조회 — 세션/엔트리/작업일 기준 touched 파일과 줄수.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl<'a> JournalCache<'a> {

    /// W4-PR5 — distinct `files_touched[].path` union across every journal
    /// entry that names `session_id`. Drives `LayerComparison` without
    /// hydrating the full entries. Uses `idx_oculpm_journal_session` for the
    /// session lookup; the join into `oculpm_journal_files` is bounded by the
    /// per-entry primary key so cost stays O(entries-in-session).
    ///
    /// Intentionally workday-free: a `session_id` is globally unique
    /// (`YYYYMMDD-NNN`) so the session index alone is enough, and not
    /// requiring callers to know the *cache row's* workday avoids subtle
    /// drift when the frontmatter workday and the session_id prefix
    /// disagree (e.g., manual `session_id` overrides in `ManualEntryDraft`).
    pub async fn files_for_session(
        &self,
        project_id: u32,
        session_id: &str,
    ) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let session_id = session_id.to_string();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT f.file_path
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id
                      AND j.relative_path = f.relative_path
                     WHERE j.project_id = ?1
                       AND j.session_id = ?2",
                )?;
                let collected: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid, &session_id], |r| r.get::<_, String>(0))?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    /// `(relative_path, session_id, created_at)` for every journal entry of a
    /// workday — the raw material for session attribution.
    ///
    /// Entries whose `session_id` is synthetic (`manual-…` / `mcp-…`) can't be
    /// joined against a real session, so the caller resolves them by
    /// `created_at` via [`session::resolve_session_for_timestamp`]. Returning
    /// the three columns lets that happen in one query instead of per-entry
    /// lookups.
    pub async fn entries_for_workday_attribution(
        &self,
        project_id: u32,
        workday: &str,
    ) -> Result<Vec<(String, String, String)>, OculpmError> {
        let pid = project_id as i64;
        let workday = workday.to_string();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, session_id, created_at
                     FROM oculpm_journal
                     WHERE project_id = ?1 AND workday = ?2
                     ORDER BY created_at ASC",
                )?;
                let collected: rusqlite::Result<Vec<(String, String, String)>> = stmt
                    .query_map(params![pid, &workday], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    /// Distinct `files_touched[].path` union across the given journal entries.
    /// Empty input short-circuits to an empty result (no query, and it avoids
    /// building a zero-placeholder `IN ()` which SQLite rejects).
    pub async fn files_for_entry_paths(
        &self,
        project_id: u32,
        relative_paths: &[String],
    ) -> Result<Vec<String>, OculpmError> {
        if relative_paths.is_empty() {
            return Ok(Vec::new());
        }
        let pid = project_id as i64;
        let owned: Vec<String> = relative_paths.to_vec();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let placeholders = std::iter::repeat("?")
                    .take(owned.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "SELECT DISTINCT file_path
                     FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path IN ({placeholders})"
                );
                let mut stmt = c.prepare(&sql)?;
                let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(owned.len() + 1);
                binds.push(Box::new(pid));
                for p in &owned {
                    binds.push(Box::new(p.clone()));
                }
                let refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
                let collected: rusqlite::Result<Vec<String>> = stmt
                    .query_map(refs.as_slice(), |r| r.get::<_, String>(0))?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    /// Distinct `files_touched[].path` union across every journal entry of a
    /// **workday**, regardless of which `session_id` each entry names.
    ///
    /// Dogfooding (2026-08-20) — the honesty audit asks "did anyone write this
    /// file down?", and that question is workday-scoped, not session-scoped.
    /// Agents mint their own `session_id` values (`manual-20260820-205400`)
    /// that never match the watcher's (`20260820-002`), so
    /// [`files_for_session`] returned an empty set and every changed file
    /// looked unrecorded. Coverage is judged against this union instead; the
    /// session-exact set still drives `matched` / `only_in_journal` / jaccard.
    ///
    /// Uses `idx_oculpm_journal_workday`; cost is O(entries-in-workday).
    pub async fn files_for_workday(
        &self,
        project_id: u32,
        workday: &str,
    ) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let workday = workday.to_string();
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT f.file_path
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id
                      AND j.relative_path = f.relative_path
                     WHERE j.project_id = ?1
                       AND j.workday = ?2",
                )?;
                let collected: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid, &workday], |r| r.get::<_, String>(0))?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }

    /// v2 U12 — 한 워크데이의 라인 증감 합. Today 히어로가 엔트리마다
    /// `get_journal_entry` 를 N 회 부르던 것을 SUM 한 방으로 대체한다.
    ///
    /// `lines_*` 는 프론트매터가 아니라 diff 사이드카에서 파생된 값이다
    /// ([`set_line_counts`]). 예전엔 프론트매터의 `bytes_*` 를 합했는데, 그
    /// 필드를 채우는 쓰기 경로가 하나도 없어서(에이전트가 손으로 적어야 했다)
    /// 링이 늘 0 이었다.
    pub async fn workday_lines(
        &self,
        project_id: u32,
        workday: &str,
    ) -> Result<(u32, u32), OculpmError> {
        let pid = project_id as i64;
        let workday = workday.to_string();
        let sums = self
            .db
            .conn()
            .call(move |c| {
                c.query_row(
                    "SELECT COALESCE(SUM(f.lines_added), 0), COALESCE(SUM(f.lines_removed), 0)
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id
                      AND j.relative_path = f.relative_path
                     WHERE j.project_id = ?1 AND j.workday = ?2",
                    params![pid, &workday],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                )
                .map_err(Into::into)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok((sums.0.max(0) as u32, sums.1.max(0) as u32))
    }

    /// Entries with at least one file row whose line churn is still unknown —
    /// the work-list for the backfill sweep. An entry re-indexed after its
    /// sidecar was written comes back here (the upsert re-inserts file rows with
    /// NULL columns), which is exactly how it gets refilled.
    pub async fn entries_missing_line_counts(
        &self,
        project_id: u32,
    ) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT relative_path
                       FROM oculpm_journal_files
                      WHERE project_id = ?1 AND lines_added IS NULL",
                )?;
                let collected: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid], |r| r.get::<_, String>(0))?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }
}

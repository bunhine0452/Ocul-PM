//! 파일 변경 이력과 .oculpm 연동 — file_changes, 일지 역참조, 에이전트 상태.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {

    /// 이 파일을 `files_touched` 로 만진 일지들 — 최신순.
    ///
    /// 코드 화면의 일지 칩이 부른다. 인덱스(`idx_oculpm_journal_files_lookup`)는
    /// 일지→파일 방향뿐이지만 이 테이블은 프로젝트당 수천 행 규모라 풀 스캔도
    /// 밀리초다 — 전용 인덱스는 필요해질 때.
    pub async fn oculpm_journal_for_file(
        &self,
        project_id: u32,
        file_path: String,
        limit: u32,
    ) -> Result<Vec<FileJournalEntry>> {
        let lim = limit.clamp(1, 50) as i64;
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT j.relative_path, j.title, j.type, j.agent_id, j.created_at, f.op
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id AND j.relative_path = f.relative_path
                     WHERE f.project_id = ?1 AND f.file_path = ?2
                     ORDER BY j.created_at DESC
                     LIMIT ?3",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64, file_path, lim], |r| {
                        Ok(FileJournalEntry {
                            journal_path: r.get(0)?,
                            title: r.get(1)?,
                            entry_type: r.get(2)?,
                            agent_id: r.get(3)?,
                            created_at: r.get(4)?,
                            op: r.get(5)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
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
}

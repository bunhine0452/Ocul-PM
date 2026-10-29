//! .oculpm 연동 — 일지 역참조, 에이전트 상태.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
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
                .optional()
            })
            .await?;
        Ok(row)
    }

    // ---------- File Changes ----------
}

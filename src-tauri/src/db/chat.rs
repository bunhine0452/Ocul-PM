//! 대화·메시지 — conversation/chat_message CRUD 와 액션 기록.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
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
                    params![&title, &provider, &model, project_id.map(|id| id as i64),],
                )?;
                let id = c.last_insert_rowid();
                c.query_row(
                    "SELECT id, title, provider, model, project_id,
                            created_at, updated_at, last_message_at
                     FROM conversations WHERE id = ?1",
                    [id],
                    conversation_from_row,
                )
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
                    params![&provider, &model, project_id.map(|v| v as i64), id as i64,],
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
                    params![conversation_id as i64, &role, &content, &provider, &model,],
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
                )
            })
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
}

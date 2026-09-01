//! 설정·모바일 기기 — settings_* 키값, Claude 훅 오프셋, 페어링된 기기 목록.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
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

    // ── 모바일 브리지 — 페어링 기기 (#mb0-pairing) ──────────────────────

    pub async fn mobile_device_insert(
        &self,
        name: String,
        token_hash: String,
        created_at: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO mobile_devices (name, token_hash, created_at) VALUES (?1, ?2, ?3)",
                    params![name, token_hash, created_at],
                )?;
                Ok(())
            })
            .await
            .map_err(Into::into)
    }

    pub async fn mobile_device_list(&self) -> Result<Vec<MobileDevice>> {
        self.conn
            .call(|c| {
                let mut stmt = c.prepare(
                    "SELECT id, name, created_at, last_seen_at FROM mobile_devices ORDER BY id",
                )?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok(MobileDevice {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            created_at: r.get(2)?,
                            last_seen_at: r.get(3)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
            .map_err(Into::into)
    }

    /// 삭제하며 해시를 돌려준다 — 인증 미들웨어의 메모리 집합에서도 빼야 한다.
    pub async fn mobile_device_delete(&self, id: u32) -> Result<Option<String>> {
        self.conn
            .call(move |c| {
                let hash = c
                    .query_row(
                        "DELETE FROM mobile_devices WHERE id = ?1 RETURNING token_hash",
                        params![id],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                Ok(hash)
            })
            .await
            .map_err(Into::into)
    }

    /// 인증 미들웨어가 서버 기동 시 메모리에 올리는 해시 전집합.
    pub async fn mobile_device_hashes(&self) -> Result<Vec<String>> {
        self.conn
            .call(|c| {
                let mut stmt = c.prepare("SELECT token_hash FROM mobile_devices")?;
                let rows = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
            .map_err(Into::into)
    }

    pub async fn mobile_device_touch(&self, token_hash: String, seen_at: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE mobile_devices SET last_seen_at = ?1 WHERE token_hash = ?2",
                    params![seen_at, token_hash],
                )?;
                Ok(())
            })
            .await
            .map_err(Into::into)
    }

    pub async fn settings_get(&self, key: String) -> Result<Option<String>> {
        let value = self
            .conn
            .call(move |c| {
                c.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                    r.get::<_, String>(0)
                })
                .optional()
            })
            .await?;
        Ok(value)
    }

    /// 키를 지운다 — **없어도 성공**이다.
    ///
    /// 한 번만 쓰고 버리는 값(창 세션 스냅숏)의 소비에 쓴다. 빈 문자열 sentinel
    /// 대신 진짜로 지우는 이유: `settings_get_all` 이 그 값을 계속 실어 나르고,
    /// "빈 문자열 = 없음" 규약을 읽는 쪽마다 되풀이해야 하기 때문이다.
    pub async fn settings_delete(&self, key: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM settings WHERE key = ?1", [key])?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    // ─── PR-CI0: Claude Code 훅 인박스 소비 오프셋 (claude_hooks bridge) ─────

    pub async fn claude_hooks_offset_get(&self, root: String) -> Result<Option<i64>> {
        let value = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT consumed_bytes FROM claude_hooks_inbox WHERE root = ?1",
                    [root],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
            })
            .await?;
        Ok(value)
    }

    pub async fn claude_hooks_offset_set(&self, root: String, consumed_bytes: i64) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO claude_hooks_inbox (root, consumed_bytes, updated_at)
                     VALUES (?1, ?2, unixepoch())
                     ON CONFLICT(root) DO UPDATE SET
                       consumed_bytes = excluded.consumed_bytes,
                       updated_at = excluded.updated_at",
                    (root, consumed_bytes),
                )?;
                Ok(())
            })
            .await?;
        Ok(())
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
}

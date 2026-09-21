//! 태그의 **원재료** 질의 — 집계·정규화는 `oculpm::tags` 가 한다
//! ({#tag-merge}).
//!
//! SQL 로 `GROUP BY tag` 하지 않는 이유는 `journal_search::cache::fetch_rows`
//! 가 질의 매칭을 SQL 로 내리지 않는 이유와 같다: SQLite 의 `lower()` 는 ASCII
//! 전용이고, 우리 정규화는 밑줄·구두점·연속 하이픈까지 본다. SQL 로 절반만
//! 접으면 캐시와 디스크가 **다른 답**을 낸다. 행을 그대로 받아 Rust 에서 한 번
//! 접는다 — 806종짜리 표라 비용이 아니다.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다.

use super::*;

/// 태그 한 개가 걸린 일지 한 건 — `(태그 원문, 일지 경로, workday)`.
pub type TagRow = (String, String, String);

impl JournalCache<'_> {
    /// 이 프로젝트의 태그 부착 전부. 정렬은 하지 않는다 (호출부가 접는다).
    pub async fn tag_rows(&self, project_id: u32) -> Result<Vec<TagRow>, OculpmError> {
        let pid = project_id as i64;
        self.db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT t.tag, t.relative_path, j.workday
                     FROM oculpm_journal_tags t
                     JOIN oculpm_journal j
                       ON j.project_id = t.project_id
                      AND j.relative_path = t.relative_path
                     WHERE t.project_id = ?1",
                )?;
                let collected: rusqlite::Result<Vec<TagRow>> = stmt
                    .query_map(params![pid], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get(2)?))
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)
    }
}

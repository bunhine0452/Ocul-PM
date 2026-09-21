//! 주간 롤업의 원재료 질의 (journal-scale-round `{#rollup-weekly}`).
//!
//! `range_entries` 와 같은 모양(세 질의를 Rust 에서 잇는다)이되 **본문과 본문
//! 해시**를 함께 싣는다. 둘이 다른 이유:
//!
//! * 본문 — 결정적 생성기가 「결정」 문장을 본문에서 고른다. 제목만으로는
//!   "무엇을 정했는가"가 남지 않는다.
//! * 본문 해시 — 롤업 frontmatter 의 `entries_hash` 재료다. 원본이 바뀌면
//!   롤업이 「오래됨」이 되는 판정이 이 값 위에 선다.
//!
//! 본문은 **캐시에 들어올 때 이미 마스킹돼 있다** (`cache` 모듈 §리댁션) —
//! 그래서 여기서 다시 가릴 것이 없고, `commands/summary.rs` 가 같은 근거로
//! `range_entries` 만 읽는다.

use super::*;

/// 롤업 한 건의 원재료. `RangeEntry` 에 본문·본문해시를 더한 판.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollupSourceEntry {
    pub relative_path: String,
    pub workday: String,
    /// `bug | feature | error | refactor | chore`.
    pub entry_type: String,
    /// `planned | in_progress | done | abandoned`.
    pub status: String,
    pub agent_id: String,
    pub title: String,
    pub body_markdown: String,
    /// blake3 hex — `entries_hash` 의 재료.
    pub body_md_hash: String,
    pub files: Vec<String>,
}

impl JournalCache<'_> {
    /// `[since, until]`(포함, `YYYYMMDD` 문자열 비교) 안의 일지 전부를 본문까지.
    /// **오래된 workday 순** — 롤업 본문이 한 주를 시간순으로 읽게 한다
    /// (`range_entries` 는 최신순이라 방향이 반대다).
    pub async fn rollup_source_entries(
        &self,
        project_id: u32,
        since: &str,
        until: &str,
    ) -> Result<Vec<RollupSourceEntry>, OculpmError> {
        let pid = project_id as i64;
        let (since, until) = (since.to_string(), until.to_string());
        let (since_e, until_e) = (since.clone(), until.clone());

        let mut entries: Vec<RollupSourceEntry> = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, workday, type, status, agent_id, title,
                            body_markdown, body_md_hash
                     FROM oculpm_journal
                     WHERE project_id = ?1 AND workday >= ?2 AND workday <= ?3
                     ORDER BY workday, relative_path",
                )?;
                let collected: rusqlite::Result<Vec<RollupSourceEntry>> = stmt
                    .query_map(params![pid, &since_e, &until_e], |r| {
                        Ok(RollupSourceEntry {
                            relative_path: r.get(0)?,
                            workday: r.get(1)?,
                            entry_type: r.get(2)?,
                            status: r.get(3)?,
                            agent_id: r.get(4)?,
                            title: r.get(5)?,
                            body_markdown: r.get(6)?,
                            body_md_hash: r.get(7)?,
                            files: Vec::new(),
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
                     WHERE j.project_id = ?1 AND j.workday >= ?2 AND j.workday <= ?3
                     ORDER BY f.file_path",
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
        Ok(entries)
    }
}

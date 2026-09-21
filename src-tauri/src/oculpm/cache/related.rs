//! 관련 후보의 **원재료** 수집 — 점수는 `oculpm::related` 가 낸다
//! ({#related-suggest}).
//!
//! 한 번의 `call` 안에서 네 질의를 돌린다. 왕복을 넷으로 쪼개면 그만큼 DB 큐를
//! 네 번 타고, 이 커맨드는 일지를 **열 때마다** 불린다.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다.

use super::*;

use crate::oculpm::related::{EntryRow, FileRow, PlanRefRow};

/// 대상 일지 하나에 대한 후보 계산의 입력 전부.
pub struct RelatedRaw {
    pub entries: Vec<EntryRow>,
    pub file_rows: Vec<FileRow>,
    pub plan_refs: Vec<PlanRefRow>,
    pub total_entries: u32,
}

/// 메타를 가져올 일지 수의 상한. 제목 유사도는 corpus 전체를 봐야 하지만,
/// 상한 없는 조회는 상한이 아니다 — 최신순으로 자른다 (경로가 곧 시각).
const MAX_ENTRIES_SCANNED: i64 = 5000;
/// plan-log 귀속 행의 상한. 같은 이유의 안전핀.
const MAX_PLAN_REFS: i64 = 20000;

impl JournalCache<'_> {
    /// `target_files` 를 만진 일지들, 프로젝트의 일지 메타, plan-log 귀속을
    /// 한 번에. 파일이 없으면 파일 축 질의는 건너뛴다 (`IN ()` 는 SQLite 가
    /// 거부하고, 빈 결과를 얻자고 질의를 돌릴 이유도 없다).
    pub async fn related_raw(
        &self,
        project_id: u32,
        target_files: &[String],
    ) -> Result<RelatedRaw, OculpmError> {
        let pid = project_id as i64;
        let files: Vec<String> = target_files.to_vec();
        self.db
            .conn()
            .call(move |c| -> rusqlite::Result<RelatedRaw> {
                let total_entries: u32 = c.query_row(
                    "SELECT COUNT(*) FROM oculpm_journal WHERE project_id = ?1",
                    params![pid],
                    |r| r.get::<_, i64>(0),
                )? as u32;

                let mut stmt = c.prepare(
                    "SELECT relative_path, title, workday, type
                     FROM oculpm_journal
                     WHERE project_id = ?1
                     ORDER BY relative_path DESC
                     LIMIT ?2",
                )?;
                let entries = stmt
                    .query_map(params![pid, MAX_ENTRIES_SCANNED], |r| {
                        Ok(EntryRow {
                            relative_path: r.get(0)?,
                            title: r.get(1)?,
                            workday: r.get(2)?,
                            entry_type: r.get(3)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                let file_rows = if files.is_empty() {
                    Vec::new()
                } else {
                    let placeholders = std::iter::repeat_n("?", files.len())
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!(
                        "SELECT relative_path, file_path
                         FROM oculpm_journal_files
                         WHERE project_id = ?1 AND file_path IN ({placeholders})"
                    );
                    let mut stmt = c.prepare(&sql)?;
                    let mut binds: Vec<Box<dyn rusqlite::ToSql>> =
                        Vec::with_capacity(files.len() + 1);
                    binds.push(Box::new(pid));
                    for f in &files {
                        binds.push(Box::new(f.clone()));
                    }
                    let rows = stmt
                        .query_map(params_from_iter(binds.iter().map(|b| b.as_ref())), |r| {
                            Ok(FileRow {
                                relative_path: r.get(0)?,
                                file_path: r.get(1)?,
                            })
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    rows
                };

                // plan-log 귀속. 이 표는 플랜 커맨드(`reproject_all`)가 채운다 —
                // 앱이 플래너/오늘 화면을 한 번도 안 그린 세션에서는 비어 있을
                // 수 있고, 그때 이 신호는 그냥 없는 것으로 친다 (후보가 조금
                // 줄 뿐 틀린 후보가 나오지는 않는다).
                let mut stmt = c.prepare(
                    "SELECT plan_id, item_id, journal_ref
                     FROM oculpm_plan_item_updates
                     WHERE project_id = ?1 AND journal_ref IS NOT NULL
                     LIMIT ?2",
                )?;
                let plan_refs = stmt
                    .query_map(params![pid, MAX_PLAN_REFS], |r| {
                        Ok(PlanRefRow {
                            plan_id: r.get(0)?,
                            item_id: r.get(1)?,
                            journal_ref: r.get(2)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(RelatedRaw {
                    entries,
                    file_rows,
                    plan_refs,
                    total_entries,
                })
            })
            .await
            .map_err(map_sqlite_err)
    }
}

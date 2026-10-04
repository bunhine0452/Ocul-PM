//! 집계 — 변경 그룹화, 관측된 에이전트.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl<'a> JournalCache<'a> {
    /// Group changed file paths by the journal entry that most recently touched
    /// each (Dogfooding #3). Each entry group carries the plan items linked to
    /// it (via the plan-log `journal_ref`). Paths no entry recorded fall into a
    /// trailing `entry_path: None` bucket. Entry groups are newest-first.
    pub async fn group_changes(
        &self,
        project_id: u32,
        paths: Vec<String>,
    ) -> Result<Vec<ChangeGroup>, OculpmError> {
        let pid = project_id as i64;
        let groups = self
            .db
            .conn()
            .call(move |c| {
                let mut find = c.prepare(
                    "SELECT j.relative_path, j.title, j.type, j.created_at, j.verified_by_user,
                            j.verified_stale
                     FROM oculpm_journal_files f
                     JOIN oculpm_journal j
                       ON j.project_id = f.project_id AND j.relative_path = f.relative_path
                     WHERE f.project_id = ?1 AND f.file_path = ?2
                     ORDER BY j.created_at DESC
                     LIMIT 1",
                )?;
                let mut plan_stmt = c.prepare(
                    "SELECT DISTINCT p.plan_id, p.title, pi.title
                     FROM oculpm_plan_item_updates u
                     JOIN oculpm_plans p
                       ON p.project_id = u.project_id AND p.plan_id = u.plan_id
                     JOIN oculpm_plan_items pi
                       ON pi.project_id = u.project_id AND pi.plan_id = u.plan_id
                      AND pi.item_id = u.item_id
                     WHERE u.project_id = ?1 AND u.journal_ref LIKE '%' || ?2",
                )?;

                let mut order: Vec<String> = Vec::new();
                #[allow(clippy::type_complexity)]
                let mut by_entry: HashMap<
                    String,
                    (String, String, String, bool, bool, Vec<String>),
                > = HashMap::new();
                let mut untracked: Vec<String> = Vec::new();

                for path in &paths {
                    let hit = find
                        .query_row(params![pid, path], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                                r.get::<_, String>(3)?,
                                r.get::<_, i64>(4)? != 0,
                                r.get::<_, i64>(5)? != 0,
                            ))
                        })
                        .optional()?;
                    match hit {
                        Some((rp, title, ty, created, verified, stale)) => {
                            let e = by_entry.entry(rp.clone()).or_insert_with(|| {
                                order.push(rp.clone());
                                (title, ty, created, verified, stale, Vec::new())
                            });
                            e.5.push(path.clone());
                        }
                        None => untracked.push(path.clone()),
                    }
                }

                let mut out: Vec<ChangeGroup> = Vec::new();
                for rp in &order {
                    let (title, ty, created, verified, stale, files) = by_entry.remove(rp).unwrap();
                    let refs: Vec<ChangePlanRef> = plan_stmt
                        .query_map(params![pid, rp], |r| {
                            Ok(ChangePlanRef {
                                plan_id: r.get(0)?,
                                plan_title: r.get(1)?,
                                item_title: r.get(2)?,
                            })
                        })?
                        .filter_map(|x| x.ok())
                        .collect();
                    out.push(ChangeGroup {
                        entry_path: Some(rp.clone()),
                        entry_title: Some(title),
                        entry_type: Some(ty),
                        created_at: Some(created),
                        verified_by_user: Some(verified),
                        verified_stale: Some(stale),
                        plan_refs: refs,
                        files,
                    });
                }
                out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                if !untracked.is_empty() {
                    out.push(ChangeGroup {
                        entry_path: None,
                        entry_title: None,
                        entry_type: None,
                        created_at: None,
                        verified_by_user: None,
                        verified_stale: None,
                        plan_refs: Vec::new(),
                        files: untracked,
                    });
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(groups)
    }

    // ───────── W5-PR6: Observed agent ids ─────────

    /// Distinct `agent_id` values across this project's cache rows, sorted
    /// ASC. Drives `CategoryFilterBar` 's agent dropdown so users can filter
    /// by any agent that has actually written an entry — not just the known
    /// 6 (`claude-code`, `cursor`, ...).
    pub async fn observed_agent_ids(&self, project_id: u32) -> Result<Vec<String>, OculpmError> {
        let pid = project_id as i64;
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT DISTINCT agent_id FROM oculpm_journal
                     WHERE project_id = ?1 AND parse_ok = 1
                     ORDER BY agent_id ASC",
                )?;
                let rows: rusqlite::Result<Vec<String>> = stmt
                    .query_map(params![pid], |r| r.get::<_, String>(0))?
                    .collect();
                rows
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }
}

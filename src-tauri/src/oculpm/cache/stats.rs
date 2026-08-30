//! 집계 — 변경 그룹화, 관측된 에이전트, 개요 통계.
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
                    "SELECT j.relative_path, j.title, j.type, j.created_at
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
                let mut by_entry: HashMap<String, (String, String, String, Vec<String>)> =
                    HashMap::new();
                let mut untracked: Vec<String> = Vec::new();

                for path in &paths {
                    let hit = find
                        .query_row(params![pid, path], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                                r.get::<_, String>(3)?,
                            ))
                        })
                        .optional()?;
                    match hit {
                        Some((rp, title, ty, created)) => {
                            let e = by_entry.entry(rp.clone()).or_insert_with(|| {
                                order.push(rp.clone());
                                (title, ty, created, Vec::new())
                            });
                            e.3.push(path.clone());
                        }
                        None => untracked.push(path.clone()),
                    }
                }

                let mut out: Vec<ChangeGroup> = Vec::new();
                for rp in &order {
                    let (title, ty, created, files) = by_entry.remove(rp).unwrap();
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

    // ───────── W5-PR5: Overview aggregates ─────────

    /// Single-shot fetch of every overview widget. Each sub-query is
    /// `GROUP BY` against an existing index (workday / agent_id / difficulty),
    /// so the worst-case cost is ~O(rows) per project. The window is filled
    /// with empty cells for every day even when no entries exist — the
    /// heatmap UI relies on a dense array.
    pub async fn overview_stats(
        &self,
        project_id: u32,
        window_days: u32,
        current_workday: &str,
    ) -> Result<crate::oculpm::spec::OculpmOverviewStats, OculpmError> {
        use crate::oculpm::spec::{
            AgentCount, DifficultyMix, HeatmapCell, JournalEntrySummary, OculpmOverviewStats,
            SessionDailyAgg,
        };

        let pid = project_id as i64;
        let window = window_days.max(1);

        // Date range — generate every workday in [start, end].
        let end = parse_workday(current_workday).unwrap_or_else(today_fallback);
        let start = end - chrono::Duration::days(window as i64 - 1);
        let workday_list: Vec<String> = (0..window as i64)
            .map(|i| format_workday(start + chrono::Duration::days(i)))
            .collect();
        let start_key = workday_list.first().cloned().unwrap_or_default();

        let start_for_query = start_key.clone();

        // Per-workday journal entry counts.
        let entry_counts: std::collections::HashMap<String, u32> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT workday, COUNT(*) AS n FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY workday",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(w, n)| (w, n as u32))
                        .collect::<std::collections::HashMap<_, _>>())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        // Per-workday file event counts (sum across the workday's sessions).
        let file_event_counts: std::collections::HashMap<String, u32> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT workday, COALESCE(SUM(file_event_count), 0)
                         FROM oculpm_sessions_cache
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY workday",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(w, n)| (w, n.max(0) as u32))
                        .collect::<std::collections::HashMap<_, _>>())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        let heatmap_cells: Vec<HeatmapCell> = workday_list
            .iter()
            .map(|w| {
                let entry_count = *entry_counts.get(w).unwrap_or(&0);
                let file_event_count = *file_event_counts.get(w).unwrap_or(&0);
                let score = entry_count
                    .saturating_mul(5)
                    .saturating_add(file_event_count);
                HeatmapCell {
                    workday: w.clone(),
                    entry_count,
                    file_event_count,
                    score,
                }
            })
            .collect();

        // Difficulty mix — exclude rows where parse_ok = 0 so the null bucket
        // reflects "intentionally unset", not "frontmatter broken".
        let difficulty_mix: DifficultyMix = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT COALESCE(difficulty, '__null__') AS d, COUNT(*)
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2 AND parse_ok = 1
                         GROUP BY d",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    let mut mix = DifficultyMix {
                        verylow: 0,
                        low: 0,
                        medium: 0,
                        high: 0,
                        superhigh: 0,
                        null_count: 0,
                    };
                    for (k, n) in rows? {
                        let n = n.max(0) as u32;
                        match k.as_str() {
                            "verylow" => mix.verylow = n,
                            "low" => mix.low = n,
                            "medium" => mix.medium = n,
                            "high" => mix.high = n,
                            "superhigh" => mix.superhigh = n,
                            _ => mix.null_count = n,
                        }
                    }
                    Ok(mix)
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        // Agent breakdown — already-cached agent_id column.
        let agent_rows: Vec<(String, u32)> = self
            .db
            .conn()
            .call({
                let start_key = start_for_query.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT agent_id, COUNT(*) FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY agent_id
                         ORDER BY COUNT(*) DESC",
                    )?;
                    let rows: rusqlite::Result<Vec<(String, i64)>> = stmt
                        .query_map(params![pid, &start_key], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?
                        .collect();
                    Ok(rows?
                        .into_iter()
                        .map(|(id, n)| (id, n.max(0) as u32))
                        .collect())
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        let total_entries: u32 = agent_rows.iter().map(|(_, n)| n).sum();
        let agent_breakdown: Vec<AgentCount> = agent_rows
            .into_iter()
            .map(|(agent_id, n)| AgentCount {
                agent_id,
                entry_count: n,
                share: if total_entries > 0 {
                    n as f32 / total_entries as f32
                } else {
                    0.0
                },
            })
            .collect();

        // Unfinished — reuse list_entries pipeline but cap at 50 most recent.
        let unfinished_entries: Vec<JournalEntrySummary> = {
            let filters = EntryFilters {
                unfinished_only: true,
                ..Default::default()
            };
            let mut all = self.list_entries(project_id, None, &filters).await?;
            all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            all.into_iter().take(50).collect()
        };

        // Recent sessions — last 30 days, most recent first.
        let recent_sessions: Vec<SessionDailyAgg> = self
            .db
            .conn()
            .call({
                let start_key_30 = format_workday(
                    end - chrono::Duration::days(29),
                );
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT s.workday,
                                COUNT(*),
                                COALESCE(SUM(CAST((julianday(s.ended_at) - julianday(s.started_at)) * 86400 AS INTEGER)), 0),
                                COALESCE(SUM(files_unique), 0),
                                (SELECT COUNT(*) FROM oculpm_journal j
                                  WHERE j.project_id = s.project_id AND j.workday = s.workday) AS journal_count,
                                SUM(CASE WHEN file_event_count > 0 THEN 1 ELSE 0 END) AS with_events
                         FROM oculpm_sessions_cache s
                         WHERE project_id = ?1 AND workday >= ?2
                         GROUP BY s.workday
                         ORDER BY s.workday DESC",
                    )?;
                    let rows: rusqlite::Result<Vec<SessionDailyAgg>> = stmt
                        .query_map(params![pid, &start_key_30], |r| {
                            let workday: String = r.get(0)?;
                            let session_count: i64 = r.get(1)?;
                            let active_seconds: i64 = r.get(2)?;
                            let files_unique: i64 = r.get(3)?;
                            let journal_entry_count: i64 = r.get(4)?;
                            let with_events: i64 = r.get(5)?;
                            let narrative_rate = if with_events > 0 {
                                journal_entry_count as f32 / with_events as f32
                            } else {
                                0.0
                            };
                            Ok(SessionDailyAgg {
                                workday,
                                session_count: session_count.max(0) as u32,
                                total_active_seconds: active_seconds.max(0) as u32,
                                files_unique: files_unique.max(0) as u32,
                                journal_entry_count: journal_entry_count.max(0) as u32,
                                narrative_rate,
                            })
                        })?
                        .collect();
                    rows
                }
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(OculpmOverviewStats {
            generated_at: chrono::Utc::now().to_rfc3339(),
            window_days: window,
            heatmap_cells,
            difficulty_mix,
            agent_breakdown,
            unfinished_entries,
            recent_sessions,
        })
    }
}

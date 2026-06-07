//! Projection: Plan markdown SSOT → `oculpm_plan*` SQLite cache + command DTOs.
//!
//! Mirrors `oculpm::cache::JournalCache` — the markdown file is the source of
//! truth, this rebuilds the SQLite rows from it. `reproject_all` is the only
//! writer; the read commands reproject-then-read so they're always fresh even
//! before the watcher live-push lands (PR-PLN 3).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::Serialize;

use crate::db::Db;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus, ParsedPlan};
use crate::oculpm::redact::{compile_redact_patterns, redact_text};
use crate::oculpm::spec::OculpmConfig;

/// `<project_root>/.oculpm/planner`.
pub fn planner_dir(project_root: &Path) -> PathBuf {
    project_root.join(".oculpm").join("planner")
}

/// Locate the plan file whose frontmatter `id` equals `plan_id` (the filename
/// may differ from the id). `None` if no file matches.
pub fn find_plan_path(planner_root: &Path, plan_id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(planner_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        if parse_plan(&text, stem).frontmatter.id == plan_id {
            return Some(path);
        }
    }
    None
}

/// ASCII slug from a title; falls back to `"plan"` when nothing ASCII remains
/// (e.g. a purely Korean title).
pub fn slug_for(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        "plan".to_string()
    } else {
        s
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command DTOs (specta + serde)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanSummary {
    pub plan_id: String,
    pub title: String,
    pub status: String,
    pub owner_agent: String,
    pub progress: f64,
    pub file_path: String,
    pub updated_at: String,
    pub item_count: u32,
    pub done_count: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanItemDto {
    pub item_id: String,
    pub phase: Option<String>,
    pub title: String,
    pub status: String,
    pub order_idx: u32,
    pub parent_item: Option<String>,
    pub note: Option<String>,
    pub last_agent: Option<String>,
    pub last_update: Option<String>,
    /// Distinct journal entries linked to this item via the plan-log (the
    /// agent's `일지` column). Drives the 📓 link + the progress suggestion.
    pub journal_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanDecisionDto {
    pub decision_id: String,
    pub title: String,
    pub body: String,
    pub locked_at: Option<String>,
    pub agent_id: Option<String>,
    pub affects: Vec<String>,
}

/// A trackable phase (`## Heading {#id}`) — rollup status + who last touched it.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanPhaseDto {
    pub phase_id: Option<String>,
    pub name: String,
    pub status: String,
    pub progress: f64,
    pub item_count: u32,
    pub done_count: u32,
    pub last_agent: Option<String>,
    pub last_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanDetail {
    pub plan: PlanSummary,
    pub items: Vec<PlanItemDto>,
    pub phases: Vec<PlanPhaseDto>,
    pub decisions: Vec<PlanDecisionDto>,
    /// Non-fatal parse warnings (broken glyphs, missing ids, …). Surfaced so
    /// the UI never fails silently on a malformed plan.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanItemUpdateDto {
    pub ts: String,
    pub item_id: String,
    pub agent_id: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub journal_ref: Option<String>,
    pub note: Option<String>,
}

/// Recent plan activity across all plans — drives the Today "계획 업데이트" block.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanActivityDto {
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
    pub item_title: String,
    pub agent_id: String,
    pub ts: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub note: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

/// A parsed plan plus the file metadata the projection needs.
struct LoadedPlan {
    plan_id: String,
    file_path: String, // relative to project root, e.g. ".oculpm/planner/x.md"
    updated_at: String,
    parsed: ParsedPlan,
}

/// Parse every top-level `*.md` under `planner_root`. Missing dir → empty.
/// Subdirectories (e.g. `_archive/`) are not listed as active plans.
fn load_all_plans(planner_root: &Path) -> Vec<LoadedPlan> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(planner_root) else {
        return out;
    };
    // Secret masking: a plan that accidentally contains a key gets redacted on
    // the projection (read) side, so the SQLite cache, DTOs, and UI never show
    // it. Patterns come from the project's `.oculpm/config.toml`; empty/missing
    // config → no-op.
    let redact_patterns = planner_root
        .parent()
        .map(|oculpm_dir| oculpm_dir.join("config.toml"))
        .and_then(|p| OculpmConfig::load(&p).ok())
        .map(|cfg| compile_redact_patterns(&cfg.git.auto_redact_patterns))
        .unwrap_or_default();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("plan")
            .to_string();
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let (text, _hits) = redact_text(&text, &redact_patterns);
        let parsed = parse_plan(&text, &stem);
        let updated_at = parsed
            .frontmatter
            .updated
            .clone()
            .or_else(|| parsed.frontmatter.created.clone())
            .unwrap_or_default();
        out.push(LoadedPlan {
            plan_id: parsed.frontmatter.id.clone(),
            file_path: format!(".oculpm/planner/{file_name}"),
            updated_at,
            parsed,
        });
    }
    out.sort_by(|a, b| a.plan_id.cmp(&b.plan_id));
    out
}

/// item_id → (latest_ts, agent_id), derived from the append-only update log.
/// ISO-8601 timestamps sort lexically, so a string max is the latest.
fn last_update_map(parsed: &ParsedPlan) -> HashMap<String, (String, String)> {
    let mut map: HashMap<String, (String, String)> = HashMap::new();
    for u in &parsed.updates {
        let better = match map.get(&u.item_id) {
            Some((ts, _)) => u.ts > *ts,
            None => true,
        };
        if better {
            map.insert(u.item_id.clone(), (u.ts.clone(), u.agent_id.clone()));
        }
    }
    map
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO builders
// ─────────────────────────────────────────────────────────────────────────────

fn summary_dto(loaded: &LoadedPlan) -> PlanSummary {
    let p = &loaded.parsed;
    let done = p
        .items
        .iter()
        .filter(|i| i.status == ItemStatus::Done)
        .count() as u32;
    PlanSummary {
        plan_id: loaded.plan_id.clone(),
        title: p.frontmatter.title.clone(),
        status: p.frontmatter.status.as_str().to_string(),
        owner_agent: p.frontmatter.owner.clone(),
        progress: p.progress(),
        file_path: loaded.file_path.clone(),
        updated_at: loaded.updated_at.clone(),
        item_count: p.items.len() as u32,
        done_count: done,
    }
}

fn detail_dto(loaded: &LoadedPlan) -> PlanDetail {
    let p = &loaded.parsed;
    let last = last_update_map(p);
    // item_id → distinct linked journal refs (first-seen order).
    let mut jrefs: HashMap<String, Vec<String>> = HashMap::new();
    for u in &p.updates {
        if let Some(jr) = &u.journal_ref {
            let v = jrefs.entry(u.item_id.clone()).or_default();
            if !v.contains(jr) {
                v.push(jr.clone());
            }
        }
    }
    let items = p
        .items
        .iter()
        .map(|i| {
            let (last_update, last_agent) = match last.get(&i.item_id) {
                Some((ts, agent)) => (Some(ts.clone()), Some(agent.clone())),
                None => (None, None),
            };
            PlanItemDto {
                item_id: i.item_id.clone(),
                phase: i.phase.clone(),
                title: i.title.clone(),
                status: i.status.as_str().to_string(),
                order_idx: i.order_idx,
                parent_item: i.parent_item.clone(),
                note: i.note.clone(),
                last_agent,
                last_update,
                journal_refs: jrefs.get(&i.item_id).cloned().unwrap_or_default(),
            }
        })
        .collect();
    let decisions = p
        .decisions
        .iter()
        .map(|d| PlanDecisionDto {
            decision_id: d.decision_id.clone(),
            title: d.title.clone(),
            body: d.body.clone(),
            locked_at: d.locked_at.clone(),
            agent_id: d.agent_id.clone(),
            affects: d.affects.clone(),
        })
        .collect();
    // Phase nodes — status is the rollup of their child items (or, for an
    // empty phase, the latest plan-log status for the phase id). Attribution
    // comes from plan-log entries that reference the phase {#id}.
    let phases = p
        .phases
        .iter()
        .map(|ph| {
            let in_phase: Vec<_> = p
                .items
                .iter()
                .filter(|i| i.phase.as_deref() == Some(ph.name.as_str()))
                .collect();
            let mut sum = 0.0;
            let mut n = 0u32;
            let mut done = 0u32;
            for it in &in_phase {
                if let Some(w) = it.status.weight() {
                    sum += w;
                    n += 1;
                }
                if it.status == ItemStatus::Done {
                    done += 1;
                }
            }
            let progress = if n == 0 { 0.0 } else { sum / n as f64 };
            let status = if !in_phase.is_empty() {
                if progress >= 1.0 {
                    "done"
                } else if progress > 0.0 {
                    "in_progress"
                } else {
                    "todo"
                }
            } else {
                ph.id
                    .as_ref()
                    .and_then(|id| {
                        p.updates
                            .iter()
                            .filter(|u| &u.item_id == id)
                            .max_by(|a, b| a.ts.cmp(&b.ts))
                    })
                    .and_then(|u| u.to_status.as_deref())
                    .unwrap_or("todo")
            }
            .to_string();
            let (last_update, last_agent) = ph
                .id
                .as_ref()
                .and_then(|id| last.get(id))
                .map(|(ts, a)| (Some(ts.clone()), Some(a.clone())))
                .unwrap_or((None, None));
            PlanPhaseDto {
                phase_id: ph.id.clone(),
                name: ph.name.clone(),
                status,
                progress,
                item_count: in_phase.len() as u32,
                done_count: done,
                last_agent,
                last_update,
            }
        })
        .collect();

    PlanDetail {
        plan: summary_dto(loaded),
        items,
        phases,
        decisions,
        warnings: p.warnings.clone(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owned row data for the SQLite write (moved into the connection closure)
// ─────────────────────────────────────────────────────────────────────────────

struct PlanRow {
    plan_id: String,
    title: String,
    status: String,
    owner: String,
    progress: f64,
    file_path: String,
    updated_at: String,
}
struct ItemRow {
    plan_id: String,
    item_id: String,
    phase: Option<String>,
    title: String,
    status: String,
    order_idx: i64,
    parent_item: Option<String>,
    note: Option<String>,
    last_agent: Option<String>,
    last_update: Option<String>,
}
struct UpdateRow {
    plan_id: String,
    item_id: String,
    ts: String,
    agent_id: String,
    from_status: Option<String>,
    to_status: Option<String>,
    journal_ref: Option<String>,
    note: Option<String>,
}
struct DecisionRow {
    plan_id: String,
    decision_id: String,
    title: String,
    body: String,
    locked_at: Option<String>,
    agent_id: Option<String>,
    affects: String, // CSV
}
#[derive(Default)]
struct ProjectionRows {
    plans: Vec<PlanRow>,
    items: Vec<ItemRow>,
    updates: Vec<UpdateRow>,
    decisions: Vec<DecisionRow>,
}

fn build_rows(loaded: &[LoadedPlan]) -> ProjectionRows {
    let mut rows = ProjectionRows::default();
    for lp in loaded {
        let p = &lp.parsed;
        let last = last_update_map(p);
        rows.plans.push(PlanRow {
            plan_id: lp.plan_id.clone(),
            title: p.frontmatter.title.clone(),
            status: p.frontmatter.status.as_str().to_string(),
            owner: p.frontmatter.owner.clone(),
            progress: p.progress(),
            file_path: lp.file_path.clone(),
            updated_at: lp.updated_at.clone(),
        });
        for it in &p.items {
            let (lu, la) = match last.get(&it.item_id) {
                Some((ts, agent)) => (Some(ts.clone()), Some(agent.clone())),
                None => (None, None),
            };
            rows.items.push(ItemRow {
                plan_id: lp.plan_id.clone(),
                item_id: it.item_id.clone(),
                phase: it.phase.clone(),
                title: it.title.clone(),
                status: it.status.as_str().to_string(),
                order_idx: it.order_idx as i64,
                parent_item: it.parent_item.clone(),
                note: it.note.clone(),
                last_agent: la,
                last_update: lu,
            });
        }
        for u in &p.updates {
            rows.updates.push(UpdateRow {
                plan_id: lp.plan_id.clone(),
                item_id: u.item_id.clone(),
                ts: u.ts.clone(),
                agent_id: u.agent_id.clone(),
                from_status: u.from_status.clone(),
                to_status: u.to_status.clone(),
                journal_ref: u.journal_ref.clone(),
                note: u.note.clone(),
            });
        }
        for d in &p.decisions {
            rows.decisions.push(DecisionRow {
                plan_id: lp.plan_id.clone(),
                decision_id: d.decision_id.clone(),
                title: d.title.clone(),
                body: d.body.clone(),
                locked_at: d.locked_at.clone(),
                agent_id: d.agent_id.clone(),
                affects: d.affects.join(","),
            });
        }
    }
    rows
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanCache
// ─────────────────────────────────────────────────────────────────────────────

pub struct PlanCache<'a> {
    db: &'a Db,
}

impl<'a> PlanCache<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Parse every plan file and rebuild this project's SQLite projection.
    /// Returns the loaded plans so callers build DTOs without re-parsing.
    async fn reproject_all(
        &self,
        project_id: u32,
        planner_root: &Path,
    ) -> Result<Vec<LoadedPlan>, String> {
        let loaded = load_all_plans(planner_root);
        let pid = project_id as i64;
        let rows = build_rows(&loaded);

        self.db
            .conn()
            .call(move |c| -> Result<(), tokio_rusqlite::Error> {
                let tx = c.transaction()?;
                tx.execute("DELETE FROM oculpm_plans WHERE project_id = ?1", params![pid])?;
                tx.execute(
                    "DELETE FROM oculpm_plan_items WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_plan_item_updates WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_plan_decisions WHERE project_id = ?1",
                    params![pid],
                )?;

                for p in &rows.plans {
                    tx.execute(
                        "INSERT INTO oculpm_plans
                         (project_id, plan_id, title, status, owner_agent, progress, file_path, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            pid, p.plan_id, p.title, p.status, p.owner, p.progress, p.file_path,
                            p.updated_at
                        ],
                    )?;
                }
                for it in &rows.items {
                    tx.execute(
                        "INSERT INTO oculpm_plan_items
                         (project_id, plan_id, item_id, phase, title, status, order_idx,
                          parent_item, note, last_agent, last_update)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                        params![
                            pid, it.plan_id, it.item_id, it.phase, it.title, it.status,
                            it.order_idx, it.parent_item, it.note, it.last_agent, it.last_update
                        ],
                    )?;
                }
                for u in &rows.updates {
                    tx.execute(
                        "INSERT INTO oculpm_plan_item_updates
                         (project_id, plan_id, item_id, ts, agent_id, from_status, to_status,
                          journal_ref, note)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                        params![
                            pid, u.plan_id, u.item_id, u.ts, u.agent_id, u.from_status,
                            u.to_status, u.journal_ref, u.note
                        ],
                    )?;
                }
                for d in &rows.decisions {
                    tx.execute(
                        "INSERT INTO oculpm_plan_decisions
                         (project_id, plan_id, decision_id, title, body, locked_at, agent_id, affects)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            pid, d.plan_id, d.decision_id, d.title, d.body, d.locked_at,
                            d.agent_id, d.affects
                        ],
                    )?;
                }
                tx.commit()?;
                Ok(())
            })
            .await
            .map_err(|e| e.to_string())?;

        Ok(loaded)
    }

    /// Reproject + return plan summaries.
    pub async fn list(
        &self,
        project_id: u32,
        planner_root: &Path,
    ) -> Result<Vec<PlanSummary>, String> {
        let loaded = self.reproject_all(project_id, planner_root).await?;
        Ok(loaded.iter().map(summary_dto).collect())
    }

    /// Reproject + return one plan's detail (items + decisions + warnings).
    pub async fn get(
        &self,
        project_id: u32,
        planner_root: &Path,
        plan_id: &str,
    ) -> Result<Option<PlanDetail>, String> {
        let loaded = self.reproject_all(project_id, planner_root).await?;
        Ok(loaded.iter().find(|l| l.plan_id == plan_id).map(detail_dto))
    }

    /// Reproject + return one item's attribution history (read from SQLite,
    /// validating the projection round-trip).
    pub async fn item_history(
        &self,
        project_id: u32,
        planner_root: &Path,
        plan_id: &str,
        item_id: &str,
    ) -> Result<Vec<PlanItemUpdateDto>, String> {
        self.reproject_all(project_id, planner_root).await?;
        let pid = project_id as i64;
        let plan = plan_id.to_string();
        let item = item_id.to_string();
        self.db
            .conn()
            .call(move |c| -> Result<Vec<PlanItemUpdateDto>, tokio_rusqlite::Error> {
                let mut stmt = c.prepare(
                    "SELECT ts, item_id, agent_id, from_status, to_status, journal_ref, note
                     FROM oculpm_plan_item_updates
                     WHERE project_id = ?1 AND plan_id = ?2 AND item_id = ?3
                     ORDER BY ts",
                )?;
                let rows = stmt
                    .query_map(params![pid, plan, item], |r| {
                        Ok(PlanItemUpdateDto {
                            ts: r.get(0)?,
                            item_id: r.get(1)?,
                            agent_id: r.get(2)?,
                            from_status: r.get(3)?,
                            to_status: r.get(4)?,
                            journal_ref: r.get(5)?,
                            note: r.get(6)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// Recent plan activity across all plans (for the Today dashboard).
    /// Reprojects first, then reads the update log joined with item/plan titles.
    pub async fn recent_activity(
        &self,
        project_id: u32,
        planner_root: &Path,
        limit: u32,
    ) -> Result<Vec<PlanActivityDto>, String> {
        let loaded = self.reproject_all(project_id, planner_root).await?;
        // (plan_id, phase_id) → phase name, to resolve plan-log refs that point
        // at a phase heading rather than a leaf item.
        let mut phase_names: HashMap<(String, String), String> = HashMap::new();
        for lp in &loaded {
            for ph in &lp.parsed.phases {
                if let Some(id) = &ph.id {
                    phase_names.insert((lp.plan_id.clone(), id.clone()), ph.name.clone());
                }
            }
        }
        let pid = project_id as i64;
        let lim = limit.max(1) as i64;
        let rows = self
            .db
            .conn()
            .call(move |c| -> Result<Vec<PlanActivityDto>, tokio_rusqlite::Error> {
                let mut stmt = c.prepare(
                    "SELECT u.plan_id, COALESCE(p.title, u.plan_id), u.item_id,
                            COALESCE(it.title, u.item_id), u.agent_id, u.ts,
                            u.from_status, u.to_status, u.note
                     FROM oculpm_plan_item_updates u
                     LEFT JOIN oculpm_plans p
                       ON p.project_id = u.project_id AND p.plan_id = u.plan_id
                     LEFT JOIN oculpm_plan_items it
                       ON it.project_id = u.project_id AND it.plan_id = u.plan_id
                          AND it.item_id = u.item_id
                     WHERE u.project_id = ?1
                     ORDER BY u.ts DESC
                     LIMIT ?2",
                )?;
                let rows = stmt
                    .query_map(params![pid, lim], |r| {
                        Ok(PlanActivityDto {
                            plan_id: r.get(0)?,
                            plan_title: r.get(1)?,
                            item_id: r.get(2)?,
                            item_title: r.get(3)?,
                            agent_id: r.get(4)?,
                            ts: r.get(5)?,
                            from_status: r.get(6)?,
                            to_status: r.get(7)?,
                            note: r.get(8)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await
            .map_err(|e| e.to_string())?;

        // Resolve phase refs: when item_id matched no leaf item, the SQL
        // COALESCE returned the raw id — swap in the phase name if it's a phase.
        let resolved = rows
            .into_iter()
            .map(|mut r| {
                if r.item_title == r.item_id {
                    if let Some(name) = phase_names.get(&(r.plan_id.clone(), r.item_id.clone())) {
                        r.item_title = name.clone();
                    }
                }
                r
            })
            .collect();
        Ok(resolved)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const PLAN: &str = r#"---
oculpm_plan: v1
id: demo-plan
title: "데모 계획"
status: active
owner: claude-code
updated: 2026-06-07
---

## Phase A — 기반
- [x] 첫 항목 {#one}
- [~] 둘째 항목 {#two}

<!-- oculpm:plan-log begin v1 -->
| ts | item | agent | change | journal | note |
|---|---|---|---|---|---|
| 2026-06-07T10:00:00+09:00 | #one | claude-code | ~→x | journal/x.md | 완료 |
| 2026-06-07T11:00:00+09:00 | #two | user | ☐→~ | | 시작 |
<!-- oculpm:plan-log end -->
"#;

    #[tokio::test]
    async fn projection_round_trip_list_get_history() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::create_dir_all(planner_dir(&root)).unwrap();
        std::fs::write(planner_dir(&root).join("demo-plan.md"), PLAN).unwrap();

        let db = Db::open(dir.path().join("test.db")).await.expect("open db");
        let pid = db
            .create_project("demo".into(), root.to_string_lossy().to_string())
            .await
            .expect("create project");

        let cache = PlanCache::new(&db);
        let planner_root = planner_dir(&root);

        // list
        let summaries = cache.list(pid, &planner_root).await.expect("list");
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.plan_id, "demo-plan");
        assert_eq!(s.title, "데모 계획");
        assert_eq!(s.item_count, 2);
        assert_eq!(s.done_count, 1);
        // (done=1, in_progress=.5) / 2 = 0.75
        assert!((s.progress - 0.75).abs() < 1e-9);

        // get
        let detail = cache
            .get(pid, &planner_root, "demo-plan")
            .await
            .expect("get")
            .expect("found");
        assert_eq!(detail.items.len(), 2);
        let one = detail.items.iter().find(|i| i.item_id == "one").unwrap();
        assert_eq!(one.status, "done");
        assert_eq!(one.last_agent.as_deref(), Some("claude-code"));
        assert_eq!(one.phase.as_deref(), Some("Phase A — 기반"));
        assert_eq!(one.journal_refs, vec!["journal/x.md"]);

        // history (read back from SQLite — validates projection write)
        let hist = cache
            .item_history(pid, &planner_root, "demo-plan", "two")
            .await
            .expect("history");
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].agent_id, "user");
        assert_eq!(hist[0].to_status.as_deref(), Some("in_progress"));

        // missing plan → None
        let none = cache.get(pid, &planner_root, "nope").await.expect("get");
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn phase_tracking_resolves_in_detail_and_activity() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::create_dir_all(planner_dir(&root)).unwrap();
        // No frontmatter, # H1, a phase with {#id} referenced in the plan-log —
        // the exact shape an external agent produced.
        let md = "# T\n## Phase 1 — 핵심 {#p1}\n- [x] a {#a}\n- [~] b {#b}\n\n\
                  <!-- oculpm:plan-log begin v1 -->\n\
                  | ts | item | agent | change | journal | note |\n\
                  |---|---|---|---|---|---|\n\
                  | 2026-06-07T10:00:00+09:00 | #p1 | claude-code | →☐ | | phase 생성 |\n\
                  | 2026-06-07T11:00:00+09:00 | #a | user | ~→x | | |\n\
                  <!-- oculpm:plan-log end -->\n";
        std::fs::write(planner_dir(&root).join("demo.md"), md).unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("p".into(), root.to_string_lossy().to_string())
            .await
            .unwrap();
        let cache = PlanCache::new(&db);
        let pr = planner_dir(&root);

        let detail = cache.get(pid, &pr, "demo").await.unwrap().unwrap();
        assert_eq!(detail.phases.len(), 1);
        let ph = &detail.phases[0];
        assert_eq!(ph.phase_id.as_deref(), Some("p1"));
        assert_eq!(ph.name, "Phase 1 — 핵심");
        // a done + b in_progress → rollup in_progress
        assert_eq!(ph.status, "in_progress");
        assert_eq!(ph.last_agent.as_deref(), Some("claude-code"));

        // recent activity resolves #p1 to the phase name (not the raw id)
        let act = cache.recent_activity(pid, &pr, 10).await.unwrap();
        let phase_act = act.iter().find(|a| a.item_id == "p1").unwrap();
        assert_eq!(phase_act.item_title, "Phase 1 — 핵심");
    }
}

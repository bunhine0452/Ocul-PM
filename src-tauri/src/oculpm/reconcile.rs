//! F1 — automatic journal→plan reconciliation.
//!
//! When `agents.auto_reconcile` is on, the watcher calls [`reconcile_entry`]
//! after a *new* journal entry is indexed. It asks the configured LLM "which
//! item of the single active plan did this entry advance, and to what status?"
//! and applies only the valid status flips, stamped `agent_id = auto:<provider>`
//! with the entry path filled into the plan-log `journal_ref` (the column that
//! was always `None` before F1).
//!
//! This is the opt-in, billable, background counterpart of the user-driven
//! `plan_ai_refresh` (commands/plan.rs): it reuses the same prompt + tolerant
//! parser (`planner::ai`) and the same plan-log edit primitives, but scopes the
//! journal context to the **one** entry just written.
//!
//! Safety properties:
//! - **Opt-in** — never runs unless the config flag is set (checked by caller).
//! - **Single active plan only** — skips (no-op) on 0 or >1 active plans, so we
//!   never guess which plan a journal entry belongs to.
//! - **Loop-safe** — only triggered by *journal* inserts; it writes only to
//!   `.oculpm/planner/*.md`, which never produces a journal event.
//! - **Fail-soft** — every skip/credential-miss returns `Skipped`, never errors
//!   up into the watcher; a hard error is logged and swallowed by the caller.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use regex::Regex;

use crate::db::Db;
use crate::llm;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::planner::ai::{build_user_prompt, parse_ai_edits, SYSTEM_PROMPT};
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
use crate::oculpm::planner::plan_edit::{append_log_row, set_item_status, LogRow};
use crate::oculpm::planner::project::{find_plan_path, planner_dir, PlanCache};

/// How much of the entry body we feed the model. Enough for a status decision
/// without ballooning the prompt (bodies can be long).
const BODY_EXCERPT_CAP: usize = 1500;

/// Synthetic session-id suffix git-history backfill stamps on every entry it
/// creates (`<workday>-git`, see `manager::backfill_from_git`). Shared here so
/// reconcile's cost guard and the backfill writer can never drift: a backfill
/// of hundreds of commits must never each trigger a billable reconcile.
pub const GIT_BACKFILL_SESSION_SUFFIX: &str = "-git";

/// True for entries synthesised by git-history backfill — never reconcile them.
pub fn is_git_backfill_session(session_id: &str) -> bool {
    session_id.ends_with(GIT_BACKFILL_SESSION_SUFFIX)
}

/// Result of a reconciliation attempt. `Skipped` carries a static reason for
/// the watcher log; `Applied` reports how many item statuses were flipped.
#[derive(Debug, PartialEq, Eq)]
pub enum ReconcileOutcome {
    Skipped(&'static str),
    Applied { count: usize, plan_id: String },
}

/// Serialise a snake_case spec enum (EntryType/EntryStatus) to its wire string
/// (`feature`, `done`, …) without hard-coding every variant.
fn enum_str<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|j| j.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Build the single-entry journal block the plan-AI prompt expects in place of
/// the recent-entries list `plan_ai_refresh` uses. Pure + unit-tested.
fn entry_block(entry_type: &str, status: &str, title: &str, files: &[String], body: &str) -> String {
    let files_line = if files.is_empty() {
        "(없음)".to_string()
    } else {
        files.join(", ")
    };
    let trimmed = body.trim();
    let excerpt: String = if trimmed.chars().count() > BODY_EXCERPT_CAP {
        trimmed.chars().take(BODY_EXCERPT_CAP).collect::<String>() + "…"
    } else {
        trimmed.to_string()
    };
    format!(
        "- [type={entry_type}, status={status}] {title}\n  files: {files_line}\n  내용: {excerpt}"
    )
}

/// Reconcile the single active plan against one freshly-written journal entry.
/// See the module docs for the safety contract. `redact`/`tz` mirror the
/// watcher's so the cache read masks secrets + backfills tz exactly as the
/// indexing path did.
pub async fn reconcile_entry(
    db: &Db,
    project_id: u32,
    root: &Path,
    entry_rel: &str,
    redact: Vec<Regex>,
    tz: chrono_tz::Tz,
) -> Result<ReconcileOutcome, String> {
    // ── 0. Load the just-written entry (masked + tz-backfilled like indexing).
    // Done first so we can cheaply bail on entries that must never trigger a
    // billable call — notably git-backfill (`<workday>-git`), where a single
    // backfill run synthesises hundreds of entries at once. ──
    let cache = JournalCache::with_redaction(db, redact).with_tz(tz);
    let entry = match cache
        .get_entry(project_id, entry_rel)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(e) => e,
        None => return Ok(ReconcileOutcome::Skipped("entry missing from cache")),
    };
    if is_git_backfill_session(&entry.frontmatter.session_id) {
        return Ok(ReconcileOutcome::Skipped("git-backfill entry"));
    }

    // ── 1. Resolve provider / model / key (global app settings + keychain) ──
    let provider = match db
        .settings_get("default_provider".to_string())
        .await
        .map_err(|e| e.to_string())?
    {
        Some(p) if !p.trim().is_empty() => p,
        _ => return Ok(ReconcileOutcome::Skipped("no default provider configured")),
    };
    let model = match db
        .settings_get(format!("model_{provider}"))
        .await
        .map_err(|e| e.to_string())?
    {
        Some(m) if !m.trim().is_empty() => m,
        _ => match db
            .settings_get("default_model".to_string())
            .await
            .map_err(|e| e.to_string())?
        {
            Some(m) if !m.trim().is_empty() => m,
            _ => return Ok(ReconcileOutcome::Skipped("no model configured")),
        },
    };
    let api_key = match crate::secrets::get(&format!("{provider}_api_key")).map_err(|e| e.to_string())? {
        Some(k) => k,
        None => return Ok(ReconcileOutcome::Skipped("no api key for provider")),
    };

    // ── 2. Find the single active plan (skip if 0 or >1 — never guess) ──
    let planner_root = planner_dir(root);
    let summaries = PlanCache::new(db).list(project_id, &planner_root).await?;
    let mut active = summaries.into_iter().filter(|s| s.status == "active");
    let plan = match (active.next(), active.next()) {
        (Some(p), None) => p,
        (None, _) => return Ok(ReconcileOutcome::Skipped("no active plan")),
        (Some(_), Some(_)) => {
            return Ok(ReconcileOutcome::Skipped("multiple active plans (ambiguous)"))
        }
    };
    let plan_id = plan.plan_id.clone();
    let path = find_plan_path(&planner_root, &plan_id).ok_or("active plan file vanished")?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = parse_plan(&md, &plan_id);
    // Locked plans (done/archived) reject edits — same rule as plan_apply_edit.
    if parsed.frontmatter.status.as_str() != "active" {
        return Ok(ReconcileOutcome::Skipped("active plan is locked"));
    }
    if parsed.items.is_empty() {
        return Ok(ReconcileOutcome::Skipped("active plan has no items"));
    }
    let items_block = parsed
        .items
        .iter()
        .map(|i| format!("- {{#{}}} [{}] {}", i.item_id, i.status.as_str(), i.title))
        .collect::<Vec<_>>()
        .join("\n");

    // ── 3. Build the prompt context from the entry loaded in step 0 ──
    let files: Vec<String> = entry
        .frontmatter
        .files_touched
        .iter()
        .map(|f| f.path.clone())
        .collect();
    let journal_block = entry_block(
        &enum_str(&entry.frontmatter.entry_type),
        &enum_str(&entry.frontmatter.status),
        &entry.title,
        &files,
        &entry.body_markdown,
    );

    // ── 4. Ask the LLM which items advanced (reuse the plan-AI prompt) ──
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
    let user_msg = build_user_prompt(&parsed.frontmatter.title, &items_block, &journal_block);
    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: SYSTEM_PROMPT.to_string(),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: user_msg,
                },
            ],
            llm::ChatOptions {
                model,
                temperature: Some(0.1),
                max_tokens: Some(400),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // ── 5. Apply valid, changed status flips via the plan-log path ──
    let edits = parse_ai_edits(&response.content);
    let agent = format!("auto:{provider}");
    let ts = chrono::Utc::now().to_rfc3339();
    let existing: HashSet<String> = parsed.items.iter().map(|i| i.item_id.clone()).collect();
    let cur_status: HashMap<String, ItemStatus> = parsed
        .items
        .iter()
        .map(|i| (i.item_id.clone(), i.status))
        .collect();

    let mut cur = md.clone();
    let mut applied = 0usize;
    for e in edits {
        if !existing.contains(&e.item_id) {
            continue; // never invent ids
        }
        let Some(ns) = ItemStatus::parse_status(&e.status) else {
            continue;
        };
        if cur_status.get(&e.item_id) == Some(&ns) {
            continue; // no-op
        }
        if let Ok(res) = set_item_status(&cur, &e.item_id, ns) {
            let row = LogRow {
                ts: ts.clone(),
                item_id: e.item_id.clone(),
                agent_id: agent.clone(),
                from: Some(res.old_status),
                to: Some(ns),
                // F1 — fill the previously-always-None journal_ref so the
                // plan item links back to the entry that advanced it.
                journal_ref: Some(entry_rel.to_string()),
                note: Some("자동 화해".to_string()),
            };
            cur = append_log_row(&res.md, &row);
            applied += 1;
        }
    }

    if applied == 0 {
        return Ok(ReconcileOutcome::Skipped("no applicable status changes"));
    }
    // CAS — the LLM call took seconds; if the plan changed under us in the
    // meantime (a user edit, in-app AI refresh, or external agent), bail rather
    // than clobber. Explicit/human edits win; the background pass yields. (The
    // residual window before write_atomic is sub-millisecond; full serialisation
    // across all plan writers is N4.)
    let on_disk = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if on_disk != md {
        return Ok(ReconcileOutcome::Skipped("plan changed during reconcile"));
    }
    write_atomic(&path, cur.as_bytes()).map_err(|e| e.to_string())?;
    // Reproject so the cache reflects the new statuses immediately.
    let _ = PlanCache::new(db).get(project_id, &planner_root, &plan_id).await;
    Ok(ReconcileOutcome::Applied {
        count: applied,
        plan_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_block_lists_files_and_excerpts_body() {
        let block = entry_block(
            "feature",
            "done",
            "회고 화면 추가",
            &["src/a.rs".to_string(), "src/b.rs".to_string()],
            "  본문 내용입니다.\n\n## 섹션\n끝.  ",
        );
        assert!(block.contains("[type=feature, status=done] 회고 화면 추가"));
        assert!(block.contains("files: src/a.rs, src/b.rs"));
        assert!(block.contains("본문 내용입니다."));
        // body is trimmed
        assert!(!block.contains("  본문"));
    }

    #[test]
    fn entry_block_handles_no_files() {
        let block = entry_block("chore", "planned", "잡일", &[], "x");
        assert!(block.contains("files: (없음)"));
    }

    #[test]
    fn entry_block_truncates_long_body() {
        let body = "가".repeat(BODY_EXCERPT_CAP + 500);
        let block = entry_block("bug", "in_progress", "t", &[], &body);
        assert!(block.ends_with('…'));
        // excerpt capped (+ a few chars of fixed scaffolding), nowhere near the
        // full 2000-char body.
        assert!(block.chars().count() < BODY_EXCERPT_CAP + 100);
    }

    #[test]
    fn enum_str_serialises_snake_case() {
        use crate::oculpm::spec::{EntryStatus, EntryType};
        assert_eq!(enum_str(&EntryType::Feature), "feature");
        assert_eq!(enum_str(&EntryStatus::Done), "done");
    }

    #[test]
    fn git_backfill_sessions_are_detected() {
        // Matches `manager::backfill_from_git`'s `<workday>-git` format.
        assert!(is_git_backfill_session("20260624-git"));
        // Live + manual sessions must NOT be treated as backfill.
        assert!(!is_git_backfill_session("20260624-001"));
        assert!(!is_git_backfill_session("20260624-m02"));
        assert!(!is_git_backfill_session("manual-20260624-160000"));
    }
}

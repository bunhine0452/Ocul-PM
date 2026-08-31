//! F1 — automatic journal→plan reconciliation.
//!
//! When `agents.auto_reconcile` is on, the watcher calls [`reconcile_entry`]
//! after a *new* journal entry is indexed. For **each active plan** it asks the
//! configured LLM "which item of this plan did the entry advance, and to what
//! status?" and applies only the valid status flips, stamped
//! `agent_id = auto:<provider>` with the entry path filled into the plan-log
//! `journal_ref` (the column that was always `None` before F1).
//!
//! This is the opt-in, billable, background counterpart of the user-driven
//! `plan_ai_refresh` (commands/plan.rs): it reuses the same prompt + tolerant
//! parser (`planner::ai`) and the same plan-log edit primitives, but scopes the
//! journal context to the **one** entry just written.
//!
//! Safety properties:
//! - **Opt-in** — never runs unless the config flag is set (checked by caller).
//! - **All active plans** — every active plan is reconciled independently (one
//!   LLM call each); a plan whose items the entry didn't touch is a no-op. Cost
//!   scales with the number of active plans (bounded by the opt-in).
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
use crate::oculpm::planner::plan_edit::{append_log_row, set_item_status_rolled, LogRow};
use crate::oculpm::planner::project::{find_plan_path, planner_dir, PlanCache};

/// How much of the entry body we feed the model. Enough for a status decision
/// without ballooning the prompt (bodies can be long).
const BODY_EXCERPT_CAP: usize = 1500;

/// Synthetic session-id suffix git-history backfill stamps on every entry it
/// creates (`<workday>-git`, see `manager::backfill_from_git`). Shared here so
/// reconcile's cost guard and the backfill writer can never drift: a backfill
/// of hundreds of commits must never each trigger a billable reconcile.
pub const GIT_BACKFILL_SESSION_SUFFIX: &str = crate::oculpm::session_id::GIT_BACKFILL_SUFFIX;

/// True for entries synthesised by git-history backfill — never reconcile them.
pub fn is_git_backfill_session(session_id: &str) -> bool {
    crate::oculpm::session_id::SessionId::new(session_id).is_git_backfill()
}

/// What one active plan's reconciliation did.
#[derive(Debug, PartialEq, Eq)]
pub struct PlanReconcileResult {
    pub plan_id: String,
    /// Item statuses flipped in this plan (0 = considered but nothing changed).
    pub applied: usize,
    /// Why nothing was applied, when the cause is a failure rather than a
    /// no-op: LLM call error (expired key, quota) or plan write error. Used to
    /// be swallowed with `Err(_) => continue`, so a dead key turned auto-
    /// reconcile into a permanent silent no-op (2026-08-30 audit).
    pub error: Option<String>,
}

/// Result of a reconciliation attempt. `Skipped` carries a static reason for
/// the watcher log (entry/credential/no-active-plan level). `Ran` reports the
/// per-active-plan results — every active plan is reconciled (the user chose
/// "all active plans"); the watcher emits an event per plan that changed.
#[derive(Debug, PartialEq, Eq)]
pub enum ReconcileOutcome {
    Skipped(&'static str),
    Ran(Vec<PlanReconcileResult>),
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
fn entry_block(
    entry_type: &str,
    status: &str,
    title: &str,
    files: &[String],
    body: &str,
) -> String {
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

/// Reconcile every active plan against one freshly-written journal entry.
/// See the module docs for the safety contract. `redact`/`tz` mirror the
/// watcher's so the cache read masks secrets + backfills tz exactly as the
/// indexing path did.
#[allow(clippy::too_many_arguments)]
pub async fn reconcile_entry(
    db: &Db,
    project_id: u32,
    root: &Path,
    entry_rel: &str,
    redact: Vec<Regex>,
    tz: chrono_tz::Tz,
    // N4 — the shared per-project plan-write lock. Acquired only for the final
    // read-recheck-write (NOT during the LLM call), so user edits never block on
    // our network round-trip.
    plan_lock: std::sync::Arc<tokio::sync::Mutex<()>>,
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

    // ── 1. Core Model 해석 (Osaurus 라운드 D2) ──
    // 대화용 `default_*` 를 읽지 않는다 — 배경 작업은 전용 슬롯을 쓴다. 이미
    // 자동화를 켜 둔 사용자는 `core_model::seed_if_automation_enabled` 가
    // 프로젝트를 열 때 대화 모델을 1회 복사해 두므로 동작이 바뀌지 않는다.
    let target = match crate::oculpm::automation::core_model::resolve(db).await? {
        Some(t) => t,
        None => return Ok(ReconcileOutcome::Skipped("no core model configured")),
    };
    if !target.has_any_key() {
        return Ok(ReconcileOutcome::Skipped(
            "no api key for the core model chain",
        ));
    }

    // ── 2. Build the prompt context from the entry loaded in step 0 (shared by
    // every active plan's reconciliation). ──
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

    // ── 3. Reconcile EVERY active plan (user chose "all active plans"). ──
    let planner_root = planner_dir(root);
    let summaries = PlanCache::new(db).list(project_id, &planner_root).await?;
    let active: Vec<_> = summaries
        .into_iter()
        .filter(|s| s.status == "active")
        .collect();
    if active.is_empty() {
        return Ok(ReconcileOutcome::Skipped("no active plan"));
    }
    let mut results: Vec<PlanReconcileResult> = Vec::new();
    for plan in &active {
        let plan_id = plan.plan_id.clone();
        let Some(path) = find_plan_path(&planner_root, &plan_id) else {
            continue; // vanished between list and read — skip this plan
        };
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        let parsed = parse_plan(&md, &plan_id);
        // Locked (done/archived) or empty plans are skipped (same rule as
        // plan_apply_edit); other active plans still get their turn.
        if parsed.frontmatter.status.as_str() != "active" || parsed.items.is_empty() {
            continue;
        }
        // 3-depth — 부모 항목은 목록에서 제외: 상태가 파생이라 모델이 제안해도
        // 거부돼 조용한 no-op 이 된다 (매 회차 재제안 루프 방지).
        let parents = parsed.parent_ids();
        let items_block = parsed
            .items
            .iter()
            .filter(|i| !parents.contains(i.item_id.as_str()))
            .map(|i| format!("- {{#{}}} [{}] {}", i.item_id, i.status.as_str(), i.title))
            .collect::<Vec<_>>()
            .join("\n");

        // Ask the LLM which of THIS plan's items the entry advanced.
        let user_msg = build_user_prompt(&parsed.frontmatter.title, &items_block, &journal_block);
        // 폴백 체인을 그대로 탄다 — 배경 작업이 체인 없이 한 번 실패하고 끝나면
        // 조용한 소실이 된다 (Core Model 도 failover 를 쓴다).
        let response = match crate::commands::llm::chat(
            target.provider.clone(),
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: crate::oculpm::content_lang::current(db)
                        .await
                        .apply(SYSTEM_PROMPT),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: user_msg,
                },
            ],
            llm::ChatOptions {
                model: target.model.clone(),
                temperature: Some(0.1),
                max_tokens: Some(400),
            },
            target.fallbacks.clone(),
        )
        .await
        {
            Ok(r) => r,
            // One plan's LLM error must not abort the others — but it must not
            // vanish either: log it and carry it in the result so the watcher
            // can surface it once.
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::reconcile",
                    project_id,
                    plan_id = %plan_id,
                    error = %e,
                    "auto-reconcile: LLM call failed"
                );
                results.push(PlanReconcileResult {
                    plan_id,
                    applied: 0,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };

        // 귀속은 **실제로 답한** 프로바이더로 — 폴백을 탔으면 그 사실이 남는다.
        let agent = format!("auto:{}", response.provider);

        // Apply valid, changed status flips to this plan's markdown.
        let edits = parse_ai_edits(&response.content);
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
            if let Ok(res) = set_item_status_rolled(&cur, &e.item_id, ns) {
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
            results.push(PlanReconcileResult {
                plan_id,
                applied: 0,
                error: None,
            });
            continue;
        }
        // N4 — take the shared plan-write lock ONLY for the recheck→write (the
        // LLM call above ran unlocked). CAS against the snapshot the edits were
        // built from: if the plan changed under us, yield rather than clobber.
        {
            let _plan_guard = plan_lock.lock().await;
            let Ok(on_disk) = std::fs::read_to_string(&path) else {
                continue;
            };
            if on_disk != md {
                // A user edit / in-app refresh landed during our LLM call; yield
                // (the proposed flips are dropped, not retried). Logged so the
                // dropped reconciliation is diagnosable rather than invisible.
                tracing::info!(
                    target: "oculpm::reconcile",
                    project_id,
                    plan_id = %plan_id,
                    "auto-reconcile yielded: plan changed during LLM call (edits dropped)"
                );
                results.push(PlanReconcileResult {
                    plan_id,
                    applied: 0,
                    error: None,
                });
                continue; // plan changed during reconcile — skip this one
            }
            if let Err(e) = write_atomic(&path, cur.as_bytes()) {
                tracing::warn!(
                    target: "oculpm::reconcile",
                    project_id,
                    plan_id = %plan_id,
                    error = %e,
                    "auto-reconcile: plan write failed"
                );
                results.push(PlanReconcileResult {
                    plan_id,
                    applied: 0,
                    error: Some(e.to_string()),
                });
                continue;
            }
        }
        // Reproject so the cache reflects the new statuses immediately.
        let _ = PlanCache::new(db)
            .get(project_id, &planner_root, &plan_id)
            .await;
        results.push(PlanReconcileResult {
            plan_id,
            applied,
            error: None,
        });
    }

    Ok(ReconcileOutcome::Ran(results))
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

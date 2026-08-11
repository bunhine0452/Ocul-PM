//! Planner (file-based Plan) commands — PR-PLN 0 read side.
//!
//! Each command reprojects the `.oculpm/planner/*.md` SSOT into the
//! `oculpm_plan*` cache and returns DTOs, so results are always fresh even
//! before the watcher live-push lands. Writes (`plan_apply_edit` /
//! `plan_create`) land in PR-PLN 1.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::Db;
use crate::llm;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::{EntryFilters, JournalCache};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::planner::ai::{build_user_prompt, parse_ai_edits, SYSTEM_PROMPT};
use crate::oculpm::planner::dispatch::{
    build_dispatch_prompt, project_redact_patterns, shell_command_for,
};
use crate::oculpm::planner::migrate::{build_imported_md, ImportGoal, ImportSubtask, IMPORTED_PLAN_ID};
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
use crate::oculpm::planner::plan_edit::{
    add_item, append_log_row, create_plan_skeleton, move_phase, remove_item, remove_phase,
    rename_item, rename_phase, set_item_status_rolled, set_plan_status, set_plan_title, LogRow,
};
use crate::oculpm::planner::project::{
    find_plan_path, planner_dir, slug_for, PlanActivityDto, PlanCache, PlanDetail,
    PlanItemUpdateDto, PlanSummary,
};

async fn planner_root_of(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(planner_dir(Path::new(&project.root_path)))
}

/// List the project's plans (summary + progress + done counts).
#[tauri::command]
#[specta::specta]
pub async fn plan_list(db: State<'_, Db>, project_id: u32) -> Result<Vec<PlanSummary>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db).list(project_id, &root).await
}

/// One plan's detail: items (with per-item last attribution), decisions, and
/// non-fatal parse warnings. `None` when the plan_id isn't found.
#[tauri::command]
#[specta::specta]
pub async fn plan_get(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
) -> Result<Option<PlanDetail>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// Append-only attribution history for one item (who changed it, when,
/// from→to, linked journal).
#[tauri::command]
#[specta::specta]
pub async fn plan_item_history(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
    item_id: String,
) -> Result<Vec<PlanItemUpdateDto>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db)
        .item_history(project_id, &root, &plan_id, &item_id)
        .await
}

/// Recent plan activity across all plans — Today's "계획 업데이트" block.
#[tauri::command]
#[specta::specta]
pub async fn plan_recent_updates(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<PlanActivityDto>, String> {
    let root = planner_root_of(&db, project_id).await?;
    PlanCache::new(&db)
        .recent_activity(project_id, &root, limit)
        .await
}

// ─── write side (PR-PLN 1) ───────────────────────────────────────────────────

/// An edit applied by the app / in-app AI to a plan. External agents edit the
/// `.md` directly per AGENTS.md (PR-PLN 2); this is the in-app equivalent.
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanEditOp {
    /// Flip an existing item's status.
    SetStatus { item_id: String, status: String },
    /// Add a new item under a phase (created if absent).
    AddItem {
        phase: String,
        title: String,
        item_id: Option<String>,
        status: Option<String>,
    },
    /// Remove an existing item.
    RemoveItem { item_id: String },
    /// Rename an existing item's title.
    RenameItem { item_id: String, title: String },
    /// Rename a phase heading (keeps its items + tracking id).
    RenamePhase { from: String, to: String },
    /// Remove a phase heading and every item under it.
    RemovePhase { phase: String },
    /// Reorder a phase among its siblings (`up = true` moves it earlier).
    MovePhase { phase: String, up: bool },
}

/// True when a plan is locked (frontmatter `status` is anything other than
/// `active` — i.e. `done`/`archived`). Locked plans reject in-app edits + AI
/// refresh; AGENTS.md tells external agents the same (Planner #1).
fn is_plan_locked(md: &str, plan_id: &str) -> bool {
    parse_plan(md, plan_id).frontmatter.status.as_str() != "active"
}

const LOCKED_MSG: &str =
    "이 계획은 완료·잠금 상태입니다. 새 계획을 만들어 진행하세요.";

fn free_plan_path(root: &Path, base: &str) -> (String, PathBuf) {
    let mut id = base.to_string();
    let mut n = 2;
    loop {
        let path = root.join(format!("{id}.md"));
        if !path.exists() {
            return (id, path);
        }
        id = format!("{base}-{n}");
        n += 1;
    }
}

/// Create a new empty plan (`.oculpm/planner/<slug>.md`) and return its summary.
#[tauri::command]
#[specta::specta]
pub async fn plan_create(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    title: String,
) -> Result<PlanSummary, String> {
    // N4 — serialize against other plan writers (incl. background reconcile).
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let (id, path) = free_plan_path(&root, &slug_for(&title));
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let md = create_plan_skeleton(&id, title.trim(), "user", &date);
    write_atomic(&path, md.as_bytes()).map_err(|e| e.to_string())?;

    let summaries = PlanCache::new(&db).list(project_id, &root).await?;
    summaries
        .into_iter()
        .find(|s| s.plan_id == id)
        .ok_or_else(|| "plan created but missing from projection".to_string())
}

/// Apply an edit to a plan's `.md` SSOT: mutate the body (glyph / new item) and
/// append an attribution row to the plan-log, stamped with `agent_id`
/// (defaults to `user`). Returns the refreshed plan detail.
#[tauri::command]
#[specta::specta]
pub async fn plan_apply_edit(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan_id: String,
    op: PlanEditOp,
    agent_id: Option<String>,
) -> Result<Option<PlanDetail>, String> {
    // N4 — serialize against other plan writers (incl. background reconcile).
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    let agent = agent_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "user".to_string());
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if is_plan_locked(&md, &plan_id) {
        return Err(LOCKED_MSG.to_string());
    }
    let ts = chrono::Utc::now().to_rfc3339();

    let new_md = match op {
        PlanEditOp::SetStatus { item_id, status } => {
            let new_status = ItemStatus::parse_status(&status)
                .ok_or_else(|| format!("unknown status '{status}'"))?;
            let res = set_item_status_rolled(&md, &item_id, new_status)?;
            let row = LogRow {
                ts,
                item_id,
                agent_id: agent,
                from: Some(res.old_status),
                to: Some(new_status),
                journal_ref: None,
                note: None,
            };
            append_log_row(&res.md, &row)
        }
        PlanEditOp::AddItem {
            phase,
            title,
            item_id,
            status,
        } => {
            let st = match status {
                Some(s) => ItemStatus::parse_status(&s)
                    .ok_or_else(|| format!("unknown status '{s}'"))?,
                None => ItemStatus::Todo,
            };
            let iid = item_id
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| slug_for(&title));
            let added = add_item(&md, &phase, &title, &iid, st)?;
            let row = LogRow {
                ts,
                item_id: iid,
                agent_id: agent,
                from: None,
                to: Some(st),
                journal_ref: None,
                note: Some("created".to_string()),
            };
            append_log_row(&added, &row)
        }
        PlanEditOp::RemoveItem { item_id } => {
            let removed = remove_item(&md, &item_id)?;
            let row = LogRow {
                ts,
                item_id,
                agent_id: agent,
                from: None,
                to: None,
                journal_ref: None,
                note: Some("삭제".to_string()),
            };
            append_log_row(&removed, &row)
        }
        PlanEditOp::RenameItem { item_id, title } => {
            let renamed = rename_item(&md, &item_id, &title)?;
            let row = LogRow {
                ts,
                item_id,
                agent_id: agent,
                from: None,
                to: None,
                journal_ref: None,
                note: Some("이름 변경".to_string()),
            };
            append_log_row(&renamed, &row)
        }
        // Phase structural ops are not item attribution, so they edit the body
        // directly without a plan-log row.
        PlanEditOp::RenamePhase { from, to } => rename_phase(&md, &from, &to)?,
        PlanEditOp::RemovePhase { phase } => remove_phase(&md, &phase)?,
        PlanEditOp::MovePhase { phase, up } => move_phase(&md, &phase, up)?,
    };

    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// Set a plan's lifecycle status (`active` / `done` / `archived`). `done` and
/// `archived` LOCK the plan: `plan_apply_edit` / `plan_ai_refresh` refuse to
/// touch it and AGENTS.md tells external agents the same — so finished plans
/// stay frozen and work moves to a new plan (Planner #1). Returns refreshed
/// detail.
#[tauri::command]
#[specta::specta]
pub async fn plan_set_status(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan_id: String,
    status: String,
) -> Result<Option<PlanDetail>, String> {
    if !matches!(status.as_str(), "active" | "done" | "archived") {
        return Err(format!("unknown plan status '{status}'"));
    }
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = set_plan_status(&md, &status, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// Rename a plan (frontmatter `title:`). The plan `id` / filename stay the same
/// so item attribution + references keep working. Returns refreshed detail.
#[tauri::command]
#[specta::specta]
pub async fn plan_rename(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan_id: String,
    title: String,
) -> Result<Option<PlanDetail>, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("제목을 입력하세요.".to_string());
    }
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = set_plan_title(&md, t, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// Delete a plan: remove its `.oculpm/planner/<id>.md` file and drop the cache
/// rows (a full reproject from disk is the only cache writer, so listing after
/// the unlink cleans up). Works regardless of lock state.
#[tauri::command]
#[specta::specta]
pub async fn plan_delete(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan_id: String,
) -> Result<(), String> {
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    PlanCache::new(&db).list(project_id, &root).await?;
    Ok(())
}

// ─── in-app AI refresh + migration (PR-PLN 5) ────────────────────────────────

/// Ask the configured in-app LLM to update item statuses from recent journal
/// activity. The model proposes `{item_id, status}` edits; we apply the valid,
/// changed ones via the same plan-log path, stamped `agent_id = inapp:<provider>`.
#[tauri::command]
#[specta::specta]
pub async fn plan_ai_refresh(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan_id: String,
    provider: String,
    model: String,
) -> Result<Option<PlanDetail>, String> {
    // N4 — held for the whole command (incl. the LLM call). This is
    // user-initiated and rare, so briefly blocking other writers is acceptable
    // and guarantees no lost update without a separate CAS.
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;
    let root = planner_root_of(&db, project_id).await?;
    let path =
        find_plan_path(&root, &plan_id).ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("plan")
        .to_string();
    let parsed = parse_plan(&md, &stem);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(LOCKED_MSG.to_string());
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

    // Recent journal context (all days; cap at 25 for prompt size).
    let filters = EntryFilters {
        types: Vec::new(),
        verified_only: false,
        mismatch_only: false,
        unfinished_only: false,
        search: None,
        agents: Vec::new(),
        difficulties: Vec::new(),
    };
    let entries = JournalCache::new(&db)
        .list_entries(project_id, None, &filters)
        .await
        .map_err(|e| e.to_string())?;
    let journal_block = entries
        .iter()
        .take(25)
        .map(|e| format!("- [{:?}] {:?}: {}", e.status, e.entry_type, e.title))
        .collect::<Vec<_>>()
        .join("\n");

    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("{provider} API 키가 설정되지 않았습니다"))?
    };
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
    let user_msg = build_user_prompt(&parsed.frontmatter.title, &items_block, &journal_block);
    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: crate::oculpm::content_lang::current(&db)
                        .await
                        .apply(SYSTEM_PROMPT),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: user_msg,
                },
            ],
            llm::ChatOptions {
                model: model.clone(),
                temperature: Some(0.2),
                max_tokens: Some(800),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let edits = parse_ai_edits(&response.content);
    let agent = format!("inapp:{provider}");
    let ts = chrono::Utc::now().to_rfc3339();
    let existing: HashSet<String> = parsed.items.iter().map(|i| i.item_id.clone()).collect();
    let cur_status: HashMap<String, ItemStatus> =
        parsed.items.iter().map(|i| (i.item_id.clone(), i.status)).collect();

    let mut cur = md;
    for e in edits {
        if !existing.contains(&e.item_id) {
            continue;
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
                journal_ref: None,
                note: Some("AI 갱신".to_string()),
            };
            cur = append_log_row(&res.md, &row);
        }
    }

    write_atomic(&path, cur.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

/// One-time import of legacy `goals`/`subtasks` into `_imported.md`.
#[tauri::command]
#[specta::specta]
pub async fn plan_migrate_goals(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<PlanSummary, String> {
    let root = planner_root_of(&db, project_id).await?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{IMPORTED_PLAN_ID}.md"));
    if path.exists() {
        return Err("이미 _imported.md 가 있습니다 (한 번만 가져올 수 있어요).".to_string());
    }
    let goals = db
        .list_goals(Some(project_id), None)
        .await
        .map_err(|e| e.to_string())?;
    if goals.is_empty() {
        return Err("가져올 기존 목표가 없습니다.".to_string());
    }
    let mut import: Vec<ImportGoal> = Vec::new();
    for g in &goals {
        let subs = db.list_subtasks(g.id).await.map_err(|e| e.to_string())?;
        import.push(ImportGoal {
            title: g.title.clone(),
            status: g.status.clone(),
            progress: g.progress,
            subtasks: subs
                .iter()
                .map(|s| ImportSubtask {
                    title: s.title.clone(),
                    done: s.done,
                })
                .collect(),
        });
    }
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let md = build_imported_md(&import, &date);
    write_atomic(&path, md.as_bytes()).map_err(|e| e.to_string())?;

    let summaries = PlanCache::new(&db).list(project_id, &root).await?;
    summaries
        .into_iter()
        .find(|s| s.plan_id == IMPORTED_PLAN_ID)
        .ok_or_else(|| "가져왔지만 투영에 없습니다".to_string())
}

// ─── IN2 — 플래너 디스패치 ───────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DispatchPrompt {
    /// 조립된 프롬프트 파일 (프로젝트 상대 — `.oculpm/index/dispatch/…`).
    pub file_rel: String,
    /// 터미널에 프리필할 한 줄 명령 (`claude "$(cat '…')"`). 실행은 사용자가.
    pub command: String,
    pub item_title: String,
}

/// IN2 (#in2-dispatch) — 항목 실행 프롬프트를 조립해 `.oculpm/index/dispatch/`
/// (앱 관리·gitignore 영역)에 쓰고, 터미널 프리필용 한 줄 명령을 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn plan_dispatch_prompt(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
    item_id: String,
) -> Result<DispatchPrompt, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);
    let planner_root = planner_dir(&root);
    let path = find_plan_path(&planner_root, &plan_id)
        .ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let patterns = project_redact_patterns(&root);
    let built = build_dispatch_prompt(&root, &plan_id, &md, &item_id, &patterns)?;

    let dispatch_dir = root.join(".oculpm").join("index").join("dispatch");
    std::fs::create_dir_all(&dispatch_dir).map_err(|e| e.to_string())?;
    let file_name = format!("{plan_id}-{item_id}.md");
    let abs = dispatch_dir.join(&file_name);
    write_atomic(&abs, built.prompt.as_bytes()).map_err(|e| e.to_string())?;

    // B1 (#statusline-badge) — "지금 무엇이 디스패치돼 있나" 플래그.
    // 플러그인 statusline 스크립트가 읽어 터미널 상태줄에 표시한다.
    // 실패는 디스패치를 막지 않는다 (배지는 편의).
    write_dispatch_flag(&dispatch_dir, &built.item_title, Some((&plan_id, &item_id)), 86_400);

    Ok(DispatchPrompt {
        file_rel: format!(".oculpm/index/dispatch/{file_name}"),
        command: shell_command_for(&abs),
        item_title: built.item_title,
    })
}

/// `.oculpm/index/dispatch/current.json` — 가장 최근 디스패치 항목 (B1 배지).
/// plan 항목이면 statusline 이 글리프를 재확인할 수 있게 plan 상대경로·id 포함.
pub(crate) fn write_dispatch_flag(
    dispatch_dir: &std::path::Path,
    title: &str,
    plan_item: Option<(&str, &str)>,
    ttl_secs: u64,
) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // statusline 은 의존성 없는 sed 파서라 JSON 이스케이프를 못 다룬다 —
    // 배지는 표시 전용이므로 따옴표·역슬래시를 쓰기 측에서 순화해 계약을
    // 앱이 보장한다 (리뷰 지적: 제목의 " 가 배지를 절단).
    let title: String = title
        .chars()
        .map(|c| match c {
            '"' => '\'',
            '\\' => ' ',
            c => c,
        })
        .collect();
    let flag = match plan_item {
        Some((plan_id, item_id)) => serde_json::json!({
            "title": title,
            "plan_rel": format!(".oculpm/planner/{plan_id}.md"),
            "item_id": item_id,
            "ts": ts,
            "ttl": ttl_secs,
        }),
        None => serde_json::json!({ "title": title, "ts": ts, "ttl": ttl_secs }),
    };
    if let Err(e) = write_atomic(&dispatch_dir.join("current.json"), flag.to_string().as_bytes()) {
        tracing::warn!(target: "oculpm::plan", error = %e, "dispatch 배지 플래그 쓰기 실패 (무해)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// current.json 키 스냅샷 — statusline 의 sed 파서와의 크로스-언어 계약.
    /// 키 개명·ts 단위 변경은 배지를 무증상으로 죽인다 (리뷰 MED).
    #[test]
    fn dispatch_flag_keys_and_title_sanitized() {
        let dir = tempfile::TempDir::new().unwrap();
        write_dispatch_flag(dir.path(), "릴리스 \"v2\" 준비\\끝", Some(("my-plan", "item-1")), 86_400);
        let raw = std::fs::read_to_string(dir.path().join("current.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for key in ["title", "plan_rel", "item_id", "ts", "ttl"] {
            assert!(v.get(key).is_some(), "current.json 키 누락: {key}");
        }
        assert_eq!(v["plan_rel"], ".oculpm/planner/my-plan.md");
        assert!(v["ts"].as_u64().unwrap() > 1_700_000_000, "ts 는 unix 초");
        // sed 단순 파서 계약: 제목에 따옴표·역슬래시가 남지 않는다.
        let title = v["title"].as_str().unwrap();
        assert!(!title.contains('"') && !title.contains('\\'), "살균 실패: {title}");
        // 회고 배지(plan 없음)는 짧은 ttl.
        write_dispatch_flag(dir.path(), "회고 W31", None, 7_200);
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("current.json")).unwrap()).unwrap();
        assert_eq!(v["ttl"], 7_200);
        assert!(v.get("plan_rel").is_none());
    }
}

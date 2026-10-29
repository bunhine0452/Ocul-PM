//! Planner (file-based Plan) commands — PR-PLN 0 read side.
//!
//! Each command reprojects the `.oculpm/planner/*.md` SSOT into the
//! `oculpm_plan*` cache and returns DTOs, so results are always fresh even
//! before the watcher live-push lands. Writes (`plan_apply_edit` /
//! `plan_create`) land in PR-PLN 1.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::Db;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::planner::dispatch::{
    build_dispatch_prompt, project_redact_patterns, shell_command_for,
};
use crate::oculpm::planner::log_archive::archive_overflow;
use crate::oculpm::planner::log_query::plan_log_rows;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
use crate::oculpm::planner::plan_edit::{
    add_item, append_log_row, create_plan_skeleton, move_item, move_phase, remove_item,
    remove_phase, rename_item, rename_phase, set_item_status_rolled, LogRow,
};
use crate::oculpm::planner::project::{
    find_plan_path, planner_dir, slug_for, PlanCache, PlanDetail, PlanItemUpdateDto, PlanSummary,
};

pub(super) async fn planner_root_of(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
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

/// 플랜 하나의 변경 로그 전체 — 플래너 「변경 로그 N행」 접힘 (UI 밀도 라운드 3).
/// 항목 하나의 `plan_item_history` 와 같은 투영을 거친다 (`plan_get` 이 먼저 돌아
/// 캐시를 채워 둔다).
#[tauri::command]
#[specta::specta]
pub async fn plan_log(
    db: State<'_, Db>,
    project_id: u32,
    plan_id: String,
) -> Result<Vec<PlanItemUpdateDto>, String> {
    plan_log_rows(&db, project_id, &plan_id).await
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
    /// Move an item (with its children) — before another item, or to the end
    /// of a phase when `before` is absent (E2, 2026-09-11).
    MoveItem {
        item_id: String,
        phase: Option<String>,
        before: Option<String>,
    },
}

/// True when a plan is locked (frontmatter `status` is anything other than
/// `active` — i.e. `done`/`archived`). Locked plans reject in-app edits + AI
/// refresh; AGENTS.md tells external agents the same (Planner #1).
fn is_plan_locked(md: &str, plan_id: &str) -> bool {
    parse_plan(md, plan_id).frontmatter.status.as_str() != "active"
}

const LOCKED_MSG: &str = "이 계획은 완료·잠금 상태입니다. 새 계획을 만들어 진행하세요.";

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
                Some(s) => {
                    ItemStatus::parse_status(&s).ok_or_else(|| format!("unknown status '{s}'"))?
                }
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
        PlanEditOp::MoveItem {
            item_id,
            phase,
            before,
        } => {
            let moved = move_item(&md, &item_id, phase.as_deref(), before.as_deref())?;
            let row = LogRow {
                ts,
                item_id,
                agent_id: agent,
                from: None,
                to: None,
                journal_ref: None,
                note: Some(match (&phase, &before) {
                    (_, Some(b)) => format!("이동 → {b} 앞"),
                    (Some(p), None) => format!("이동 → {p}"),
                    (None, None) => "이동".to_string(),
                }),
            };
            append_log_row(&moved, &row)
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

    // 로그 표가 넘쳤으면 `<plan_id>.log.md` 로 갈라 낸 뒤 본문을 쓴다.
    let new_md = archive_overflow(&root, &plan_id, &new_md)?;
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    PlanCache::new(&db).get(project_id, &root, &plan_id).await
}

// ─── migration (PR-PLN 5) ────────────────────────────────────────────────────
// (앱 안 LLM 의 「AI 갱신」 `plan_ai_refresh` 는 4.0 에서 걷었다 — 플랜 상태는
// 에이전트가 `plan_update` 로 고친다.)

// ─── IN2 — 플래너 디스패치 ───────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DispatchPrompt {
    /// 조립된 프롬프트 파일 (프로젝트 상대 — `.oculpm/index/dispatch/…`).
    pub file_rel: String,
    /// 터미널에 프리필할 한 줄 명령 (`claude "$(cat '…')"`). 실행은 사용자가.
    pub command: String,
    /// 조립된 프롬프트 **본문**. 터미널에서 이미 코딩 에이전트가 돌고 있으면
    /// 프런트가 한 줄 명령 대신 이걸 그대로 붙여넣는다 — 돌던 세션을 끊고
    /// `claude` 를 또 띄우는 대신, 하던 대화에 이어 붙이기 위해서다.
    pub prompt: String,
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
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);
    let planner_root = planner_dir(&root);
    let path = find_plan_path(&planner_root, &plan_id)
        .ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let patterns = project_redact_patterns(&root);
    // 이 프롬프트를 읽고 에이전트가 일지를 쓴다 — 여기 언어가 곧 일지 언어다.
    let lang = crate::oculpm::content_lang::current(&db).await;
    let built = build_dispatch_prompt(&root, &plan_id, &md, &item_id, &patterns, lang)?;

    let dispatch_dir = root.join(".oculpm").join("index").join("dispatch");
    std::fs::create_dir_all(&dispatch_dir).map_err(|e| e.to_string())?;
    let file_name = format!("{plan_id}-{item_id}.md");
    let abs = dispatch_dir.join(&file_name);
    write_atomic(&abs, built.prompt.as_bytes()).map_err(|e| e.to_string())?;

    // B1 (#statusline-badge) — "지금 무엇이 디스패치돼 있나" 플래그.
    // 플러그인 statusline 스크립트가 읽어 터미널 상태줄에 표시한다.
    // 실패는 디스패치를 막지 않는다 (배지는 편의).
    write_dispatch_flag(
        &dispatch_dir,
        &built.item_title,
        Some((&plan_id, &item_id)),
        86_400,
    );

    Ok(DispatchPrompt {
        file_rel: format!(".oculpm/index/dispatch/{file_name}"),
        command: shell_command_for(&abs),
        prompt: built.prompt,
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
    if let Err(e) = write_atomic(
        &dispatch_dir.join("current.json"),
        flag.to_string().as_bytes(),
    ) {
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
        write_dispatch_flag(
            dir.path(),
            "릴리스 \"v2\" 준비\\끝",
            Some(("my-plan", "item-1")),
            86_400,
        );
        let raw = std::fs::read_to_string(dir.path().join("current.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for key in ["title", "plan_rel", "item_id", "ts", "ttl"] {
            assert!(v.get(key).is_some(), "current.json 키 누락: {key}");
        }
        assert_eq!(v["plan_rel"], ".oculpm/planner/my-plan.md");
        assert!(v["ts"].as_u64().unwrap() > 1_700_000_000, "ts 는 unix 초");
        // sed 단순 파서 계약: 제목에 따옴표·역슬래시가 남지 않는다.
        let title = v["title"].as_str().unwrap();
        assert!(
            !title.contains('"') && !title.contains('\\'),
            "살균 실패: {title}"
        );
        // 회고 배지(plan 없음)는 짧은 ttl.
        write_dispatch_flag(dir.path(), "회고 W31", None, 7_200);
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("current.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v["ttl"], 7_200);
        assert!(v.get("plan_rel").is_none());
    }
}

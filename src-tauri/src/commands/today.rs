//! Today 의 계획 쪽 집계 한 번 (`oculpm::planner::digest`) — 4.0 `{#ui-today}`.

use tauri::State;

use crate::db::Db;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::planner::digest::{self, TodayDigest};
use crate::oculpm::planner::project::PlanCache;
use crate::oculpm::planner::stale;

use super::plan::planner_root_of;

/// 활성 플랜의 판정·다음 리프·사람 몫·막힘과 일지 → 계획 연결. LLM 0 · 네트워크 0.
#[tauri::command]
#[specta::specta]
pub async fn today_digest(db: State<'_, Db>, project_id: u32) -> Result<TodayDigest, String> {
    let root = planner_root_of(&db, project_id).await?;
    let details = digest::load_details(&PlanCache::new(&db), project_id, &root).await?;
    let mut out = digest::build(details);
    mark_stale(&db, project_id, &mut out).await;
    Ok(out)
}

/// 판정 ✓ 인 계획마다 그 뒤에 다시 저장된 파일을 채운다 (`stale`). 캐시를 못 읽으면 그 계획은
/// 비워 둔다 — 모르는 것을 낡았다고 하지 않는다. 기준 시각과 다른 OS 의 ✓ 를 다루는 규칙은
/// `DigestPlan::stale_baseline` · `settle` 에 있다.
async fn mark_stale(db: &Db, project_id: u32, out: &mut TodayDigest) {
    let Ok(project) = db.get_project(project_id).await else {
        return;
    };
    let root = std::path::PathBuf::from(&project.root_path);
    let cache = JournalCache::new(db);
    for plan in &mut out.plans {
        let Some(since) = plan.stale_baseline().map(str::to_string) else {
            continue;
        };
        let refs: Vec<String> = out
            .journal_plan
            .iter()
            .filter(|l| l.plan_id == plan.plan_id)
            .map(|l| stale::journal_rel(&l.journal_ref))
            .collect();
        let Ok(files) = cache.files_for_entry_paths(project_id, &refs).await else {
            continue;
        };
        let root = root.clone();
        let changed =
            tokio::task::spawn_blocking(move || stale::changed_after(&root, &files, &since))
                .await
                .unwrap_or_default();
        plan.settle(changed);
    }
}

/// 이 기기에만 있는 것 — 커밋 안 한 변경(그중 기록) · 어느 리모트에도 없는 커밋 (`git::local_only`).
/// git 저장소가 아니거나 리모트가 없으면 `None`. git 은 읽기만 · 네트워크 0.
#[tauri::command]
#[specta::specta]
pub async fn today_local_only(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<crate::git::local_only::LocalOnly>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(project.root_path);
    tokio::task::spawn_blocking(move || crate::git::local_only::local_only(&root))
        .await
        .map_err(|e| e.to_string())
}

/// 그날 일지 중 동료가 git 으로 더한 것과 그 사람 (`git::authors`). 기록을 안 올리는 저장소면 빈 목록.
#[tauri::command]
#[specta::specta]
pub async fn today_teammates(
    db: State<'_, Db>,
    project_id: u32,
    workday: String,
) -> Result<Vec<crate::git::authors::TeamJournal>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(project.root_path);
    tokio::task::spawn_blocking(move || crate::git::authors::teammates(&root, &workday))
        .await
        .map_err(|e| e.to_string())
}

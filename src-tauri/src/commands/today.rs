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
/// 비워 둔다 — 모르는 것을 낡았다고 하지 않는다.
async fn mark_stale(db: &Db, project_id: u32, out: &mut TodayDigest) {
    let Ok(project) = db.get_project(project_id).await else {
        return;
    };
    let root = std::path::PathBuf::from(&project.root_path);
    let cache = JournalCache::new(db);
    for plan in &mut out.plans {
        let Some(v) = plan.last_verdict.as_ref().filter(|v| v.passed) else {
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
        let (root, ts) = (root.clone(), v.ts.clone());
        plan.stale_files =
            tokio::task::spawn_blocking(move || stale::changed_after(&root, &files, &ts))
                .await
                .unwrap_or_default();
    }
}

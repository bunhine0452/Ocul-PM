//! Phase 5 — A2A 화면 커맨드 (thin). 로직은 `oculpm::a2a` 소유.
//!
//! 화면이 보는 것은 셋이다: **누가 붙어 있나**(참여자), **누가 무엇을 쥐고
//! 있나**(임대), **나를 기다리는 것**(넘어온 태스크). 프런트는 파일을 직접
//! 읽지 않으므로 이 얇은 층이 그 창구다.
//!
//! 쓰기는 둘뿐이고 **둘 다 사용자가 눌러야 일어난다** — 넘어온 작업의
//! 수락·거절, 그리고 붙잡힌 구역의 강제 해제. 승인 없는 자동 행동은 없다
//! (`docs/a2a/00-master-plan.md` D5).

use std::path::PathBuf;

use chrono::Utc;
use serde::Serialize;
use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::a2a::{leases, registry, tasks};

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, AppError> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// 화면 한 벌 — 한 번의 왕복으로 그린다.
///
/// 셋을 따로 부르면 서로 다른 순간의 사실이 한 화면에 섞인다("A 가 쥐고 있다"
/// 옆에 "A 는 없다"). 같은 시각으로 한 번에 읽는다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct A2aOverview {
    pub participants: Vec<registry::AgentCard>,
    pub leases: Vec<leases::Lease>,
    /// 아직 안 끝난 태스크 전부 (누가 누구에게 넘겼든).
    pub open_tasks: Vec<tasks::Task>,
}

/// 지금 이 프로젝트의 협업 상태 (읽기 전용).
#[tauri::command]
#[specta::specta]
pub async fn a2a_overview(db: State<'_, Db>, project_id: u32) -> Result<A2aOverview, AppError> {
    let root = project_root(&db, project_id).await?;
    let now = Utc::now();
    Ok(A2aOverview {
        participants: registry::list_live(&root, now),
        leases: leases::active(&root, now),
        open_tasks: tasks::list(&root)
            .into_iter()
            .filter(|t| !t.state.is_terminal())
            .collect(),
    })
}

/// 넘어온 작업을 **사용자가** 수락하거나 거절한다.
///
/// 자동 수락은 없다 (D5). 사람 없는 루프에서 두 에이전트가 같은 저장소를
/// 고치는 것을 막는 유일한 지점이 여기다.
#[tauri::command]
#[specta::specta]
pub async fn a2a_decide_task(
    db: State<'_, Db>,
    project_id: u32,
    task_id: String,
    accept: bool,
) -> Result<tasks::Task, AppError> {
    let root = project_root(&db, project_id).await?;
    let task = tasks::read(&root, &task_id).ok_or_else(|| AppError::code("a2a_task_not_found"))?;
    // 수행자 이름으로 움직인다 — 이 결정은 받은 쪽의 것이다.
    let by = task.to.clone();
    let (state, note) = if accept {
        (tasks::TaskState::Working, "사용자가 수락했습니다")
    } else {
        (tasks::TaskState::Canceled, "사용자가 거절했습니다")
    };
    tasks::advance(&root, &task_id, &by, state, Some(note), Utc::now())
        .map_err(|e| AppError::new("a2a_task_update_failed", e.to_string()))
}

/// 붙잡힌 구역을 사용자가 놓아 준다 (주인이 사라졌는데 기한이 남았을 때).
#[tauri::command]
#[specta::specta]
pub async fn a2a_release_lease(
    db: State<'_, Db>,
    project_id: u32,
    lease_id: String,
) -> Result<bool, AppError> {
    let root = project_root(&db, project_id).await?;
    Ok(leases::release(&root, &lease_id, tasks::SYSTEM_ACTOR))
}

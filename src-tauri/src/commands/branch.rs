//! 브랜치 축 커맨드 (플랜 `v3-surface` {#branch-index} {#branch-story-view}
//! {#branch-digest}).
//!
//! 전부 **읽기 전용 + 오프라인**이다. 재료는 로컬 git 히스토리와 이미 있는
//! SQLite 캐시뿐이고, 새 저장 형식도 마이그레이션도 없다 — 왜 그런지는
//! `oculpm::index::branch` 의 모듈 주석에 있다.
//!
//! 여기서는 조립만 한다: 어느 브랜치인지 고르고, git 을 blocking 풀에서 읽고,
//! 창 안의 일지를 캐시에서 꺼내 파생부에 넘긴다.

use std::path::PathBuf;

use tauri::State;

use crate::db::Db;
use crate::oculpm::index::branch as axis;

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// git 은 서브프로세스라 런타임 워커를 붙잡지 않게 blocking 풀로
/// (`commands/git.rs` 와 같은 규율).
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// 로컬 브랜치 목록 (최근 커밋 순).
#[tauri::command]
#[specta::specta]
pub async fn branch_list(
    db: State<'_, Db>,
    project_id: u32,
    limit: u32,
) -> Result<Vec<axis::BranchRef>, String> {
    let root = project_root(&db, project_id).await?;
    blocking(move || axis::list_branches(&root, limit)).await
}

/// 이 브랜치의 이야기 — 커밋·일지·플랜 항목·파일을 한 좌표로.
///
/// `branch` 가 없으면 지금 체크아웃된 브랜치, `base` 가 없으면
/// main/master/develop 중 있는 첫 번째를 기준으로 잡는다.
#[tauri::command]
#[specta::specta]
pub async fn branch_story(
    db: State<'_, Db>,
    project_id: u32,
    branch: Option<String>,
    base: Option<String>,
) -> Result<axis::BranchStory, String> {
    let root = project_root(&db, project_id).await?;
    let story_root = root.clone();
    let refs = blocking(move || axis::list_branches(&story_root, 200)).await?;
    let current = refs.iter().find(|b| b.is_current).map(|b| b.name.clone());
    let Some(target) = branch.filter(|b| !b.is_empty()).or(current.clone()) else {
        return Err("This repository has no local branch yet.".to_string());
    };
    let is_current = current.as_deref() == Some(target.as_str());

    let (git_root, git_branch, git_base) = (root.clone(), target.clone(), base.clone());
    let g = blocking(move || {
        axis::read_branch_git(&git_root, &git_branch, git_base.as_deref(), is_current)
    })
    .await?;

    let changed = g.changed_paths();
    let direct = axis::journal_rel_paths(&changed);
    let commit_workdays: Vec<String> = g.commits.iter().map(|c| c.workday.clone()).collect();
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let (since, until) = axis::workday_window(&commit_workdays, &direct, &today, is_current);

    let rows = axis::entries_in_window(&db, project_id, &since, &until).await?;
    let entries = axis::attribute_entries(&rows, &direct, &changed);
    let recorded = axis::recorded_paths(&rows, &entries, &changed);
    let files = axis::build_files(&g, &recorded);
    let plan_items = axis::plan_items_for_entries(
        &db,
        project_id,
        entries.iter().map(|e| e.relative_path.clone()).collect(),
    )
    .await?;

    // 원장이 실려 온 양은 따로 센다 — `files` 는 `.oculpm/` 를 뺀 목록이라
    // 여기서 세지 않으면 "일지를 N건 실었다"를 말할 자리가 사라진다.
    let journal_files = direct.len() as u32;
    // 미커밋 수도 `files` 기준이다 (원장 제외). 두 숫자가 같은 모집단을
    // 봐야 화면에서 나란히 읽힌다.
    let uncommitted_files = files.iter().filter(|f| f.uncommitted).count() as u32;

    Ok(axis::BranchStory {
        branch: target,
        base: g.base.clone(),
        merge_base: g.merge_base.clone(),
        is_current,
        since_workday: since,
        until_workday: until,
        commits: g.commits,
        recorded_files: files.iter().filter(|f| f.recorded).count() as u32,
        files,
        entries,
        plan_items,
        uncommitted_files,
        journal_files,
        truncated: g.truncated,
    })
}

/// {#branch-digest} — 브랜치 이야기를 마크다운 한 장으로. **내보내기만 한다**:
/// 동기화도, 업로드도, 원격 호출도 없다 (v3-round 의 경계 결정).
/// 저장 대화상자 + 파일 쓰기는 일지 내보내기와 같은 자리를 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn branch_export_digest(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    branch: Option<String>,
    base: Option<String>,
) -> Result<Option<String>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let story = branch_story(db, project_id, branch, base).await?;
    let md = super::export::render_branch_digest(&story, &project.name);
    let safe: String = story
        .branch
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    super::export::save_markdown(&app, &format!("oculpm-branch-{safe}.md"), &md).await
}

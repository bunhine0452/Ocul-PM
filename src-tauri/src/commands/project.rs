use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tracing::info;

use crate::db::{Db, Project};
use crate::path_guard::secure_join;

// 코드 색인·의미 검색(`index_project` · `search_chunks`/`search_text`/`search_symbols` ·
// `clear_project_index` · `project_stats` · `read_file_range`)은 4.0 에서 걷었다 —
// 에이전트는 자기 grep 이 있고, 사용자 DB 의 절반이 그 색인이었다.

// ---------- Folder picker ----------

#[tauri::command]
#[specta::specta]
pub async fn select_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| match p {
        FilePath::Path(p) => p.to_str().map(String::from),
        _ => None,
    }))
}

// ---------- Projects ----------

#[tauri::command]
#[specta::specta]
pub async fn list_projects(db: State<'_, Db>) -> Result<Vec<Project>, String> {
    db.list_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_project(
    db: State<'_, Db>,
    name: String,
    root_path: String,
) -> Result<u32, String> {
    // 웹뷰가 넘기는 경로를 그대로 받던 자리 — 루트·홈을 들이면 거기 `.oculpm/` 이
    // 깔리고 워처가 디스크 전체를 걷는다. 코드는 프런트가 문장으로 옮긴다(StartTab).
    if crate::oculpm::paths::is_unsafe_project_root(Path::new(&root_path)) {
        return Err("unsafe_project_root".to_string());
    }
    db.create_project(name, root_path)
        .await
        .map_err(|e| e.to_string())
}

/// OS 휴지통으로 — macOS 는 `NSFileManager`(Finder 를 AppleScript 로 부르는 기본값은
/// 자동화 권한 창을 띄우고 `osascript` 를 띄운다).
fn move_to_trash(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_project(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    manager: State<'_, crate::oculpm::manager::OculpmManager>,
    project_id: u32,
    // Independently opt in to removing Ocul-PM's on-disk artifacts from the
    // project folder: the `.oculpm/` directory and/or `AGENTS.md`. Both off by
    // default so the plain "워크스페이스에서 제거" stays non-destructive. They go
    // to the OS trash, not `remove_dir_all` — journals are the user's record and a
    // misclick should be recoverable (10-30, 시작 창의 「기록 폴더도 휴지통으로」).
    delete_oculpm: bool,
    delete_agents_md: bool,
) -> Result<(), String> {
    // 매니저에서 **먼저** 잊는다 (감사 라운드 2026-09-11 A1) — 워처·세션·락을
    // 놓지 않으면 사라진 프로젝트를 두드리고, 아래의 `.oculpm` 삭제 뒤에도 살아
    // 있는 세션 액터가 index 를 되살릴 수 있다.
    manager.forget_project(project_id).await;
    // 창에서도 걷는다 — 왜 **행을 지우기 전**인지는 그 함수에 적어 두었다.
    crate::commands::window::close_project_surfaces(&app, project_id).await;
    if delete_oculpm || delete_agents_md {
        // Capture the root BEFORE the DB row is gone. If the project lookup
        // fails we skip file cleanup (nothing reliable to point at) and still
        // remove the workspace entry below.
        if let Ok(project) = db.get_project(project_id).await {
            let root = PathBuf::from(&project.root_path);
            if delete_oculpm {
                let oculpm_dir = root.join(".oculpm");
                if oculpm_dir.is_dir() {
                    move_to_trash(&oculpm_dir).map_err(|e| {
                        format!("Could not move the .oculpm folder to the trash: {e}")
                    })?;
                }
            }
            if delete_agents_md {
                let agents_md = root.join("AGENTS.md");
                if agents_md.is_file() {
                    move_to_trash(&agents_md)
                        .map_err(|e| format!("Could not move AGENTS.md to the trash: {e}"))?;
                }
            }
        }
    }
    db.delete_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    // 빠진 페이지는 저절로 안 돌아오므로 VACUUM (Phase 3). **기다리지 않는다**
    // (2026-09-22): 수 초~수십 초인데 DB 연결이 하나라 그동안 모든 호출이 줄을
    // 선다 — 2026-09-17 06:12 에 다른 탭의 init 이 3초 만에 실패한 이유다.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        match app_handle.state::<Db>().compact().await {
            Ok(()) => info!(project_id, "db compacted after project delete"),
            Err(e) => tracing::warn!(project_id, error = %e, "db compact after delete failed"),
        }
    });
    Ok(())
}

async fn get_project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

#[tauri::command]
#[specta::specta]
pub async fn read_project_file(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<String, String> {
    let root = get_project_root(&db, project_id).await?;
    let full_path = secure_join(&root, &rel_path)?;
    tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))
}

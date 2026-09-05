//! ACP 대화에 파일을 얹는 두 표면 — 첨부 대화상자와 `@` 멘션 목록.
//!
//! [`acp`](super::acp) 에서 갈라져 나왔다. 이유는 [`acp_recording`](super::acp_recording)
//! 과 같다: 그 파일이 크기 래칫 상한이라 새 배선을 넣을 자리가 없었고, 잘라 낼
//! 자리를 찾다 보니 "프로젝트 파일을 고른다"는 관심사 하나가 통째로 독립해 있었다.
//! 커맨드 이름·시그니처·동작은 그대로다 (`bindings.ts` 무변경).

use tauri::{AppHandle, State};

use super::acp::project_root;
use crate::app_error::AppError;
use crate::db::Db;

/// 파일 선택 대화상자 (다중 선택, 프로젝트 루트에서 시작). 취소하면 빈 배열.
#[tauri::command]
#[specta::specta]
pub async fn acp_pick_files(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<String>, AppError> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let root = project_root(&db, project_id).await?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<FilePath>>>();
    app.dialog()
        .file()
        .set_directory(root)
        .pick_files(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.await.map_err(|e| e.to_string())?;
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| match p {
            FilePath::Path(path) => Some(path.display().to_string()),
            _ => None,
        })
        .collect())
}

/// `@` 멘션 자동완성용 프로젝트 파일 목록.
///
/// 인덱스(DB)가 아니라 **디스크를 직접 걷는다** — 인덱싱 전이거나 방금 만든
/// 파일도 멘션할 수 있어야 하기 때문이다. `ignore` 크레이트라 .gitignore 를
/// 존중한다(node_modules/target 이 딸려오지 않는다).
#[tauri::command]
#[specta::specta]
pub async fn acp_list_files(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<String>, AppError> {
    let root = project_root(&db, project_id).await?;
    let needle = query.to_lowercase();
    let cap = limit.clamp(1, 200) as usize;

    let matches = tauri::async_runtime::spawn_blocking(move || {
        let mut found: Vec<String> = Vec::new();
        for entry in ignore::WalkBuilder::new(&root)
            .hidden(true)
            .build()
            .flatten()
        {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root) else {
                continue;
            };
            let rel = rel.display().to_string();
            if needle.is_empty() || rel.to_lowercase().contains(&needle) {
                found.push(rel);
                if found.len() >= cap {
                    break;
                }
            }
        }
        found
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(matches)
}

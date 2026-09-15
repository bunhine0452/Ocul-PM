//! 파일·폴더 조작 — 생성(`code_create`·`code_mkdir`)·이름 바꾸기/이동
//! (`code_rename`)·휴지통 삭제(`code_delete`).
//!
//! 읽기·저장과 달리 **링크 자체**를 다뤄야 하고 아직 없는 경로도 받아야 해서
//! 가드가 다르다(`guards::resolve_for_mutation`). 덮어쓰기·영구 삭제는 없다.

use std::path::Path;

use serde::Serialize;
use tauri::State;

use super::guards::{normalize_rel, resolve_for_mutation};
use super::project_root;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 파일/폴더를 만들거나 옮긴 결과. 프런트가 그대로 열거나 탭 경로를 갈아끼운다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodePathResult {
    /// 프로젝트 루트 기준 슬래시 경로 — `code_read`/`code_write` 인자와 같은 계약.
    pub relative_path: String,
    pub is_dir: bool,
}

/// 빈 파일 생성. 없는 중간 폴더는 같이 만든다 (VS Code 의 "새 파일" 과 같이
/// `a/b/c.ts` 를 한 번에 받는다). 이미 있으면 **덮어쓰지 않고** 오류다.
#[tauri::command]
#[specta::specta]
pub async fn code_create(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        create_file(&full)?;
        Ok(CodePathResult {
            relative_path: rel,
            is_dir: false,
        })
    })
    .await
    .map_err(|e| format!("Failed to create the file: {e}"))?
}

/// 폴더 생성. 중간 폴더도 같이 만들되, 대상이 **이미 있으면 오류** —
/// `create_dir_all` 의 조용한 성공은 트리에 아무 변화가 없어 사용자를 헷갈리게 한다.
#[tauri::command]
#[specta::specta]
pub async fn code_mkdir(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        create_dir(&full)?;
        Ok(CodePathResult {
            relative_path: rel,
            is_dir: true,
        })
    })
    .await
    .map_err(|e| format!("Failed to create the folder: {e}"))?
}

/// 이름 바꾸기 겸 이동 — 트리의 드래그 이동도 이 하나를 쓴다 (둘은 같은 연산이다:
/// 목적지의 부모가 다르면 이동, 같으면 이름 바꾸기).
///
/// 대상이 이미 있으면 오류다. `fs::rename` 은 파일을 말없이 덮어쓰므로 반드시
/// 먼저 막는다 — 이름 오타 한 번에 남의 파일이 사라지면 안 된다.
#[tauri::command]
#[specta::specta]
pub async fn code_rename(
    db: State<'_, Db>,
    project_id: u32,
    from_rel: String,
    to_rel: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let from = normalize_rel(&from_rel)?;
    let to = normalize_rel(&to_rel)?;
    let from_full = secure_join(&root, &from)?;
    let to_full = secure_join(&root, &to)?;
    tauri::async_runtime::spawn_blocking(move || {
        let from_full = resolve_for_mutation(&root, &from_full)?;
        let to_full = resolve_for_mutation(&root, &to_full)?;
        let is_dir = rename_path(&from_full, &to_full)?;
        // 로컬 히스토리를 새 경로 키로 옮긴다 (내용 유지). 워처는 rename 을
        // 경로별 Delete + Create 로 흘려보내 둘을 잇지 못하므로, 앱 안에서
        // 이름을 바꾸는 이 자리가 유일한 다리다. 실패는 조용히 넘긴다 —
        // 판을 못 옮긴 것이 이름 바꾸기를 되돌릴 이유는 아니다.
        if let Err(e) = crate::oculpm::history::rename(&root, &from, &to) {
            tracing::warn!(from = %from, to = %to, error = %e, "local history: rename failed");
        }
        Ok(CodePathResult {
            relative_path: to,
            is_dir,
        })
    })
    .await
    .map_err(|e| format!("Failed to rename: {e}"))?
}

/// 삭제 — **OS 휴지통으로 보낸다**, 영구 삭제가 아니다.
///
/// 폴더 삭제는 재귀라 한 번의 오조작으로 잃는 것이 크다. 앱이 되돌릴 수 없는
/// 삭제를 만들지 않는 것이 원칙이고, 되돌리기는 OS 가 이미 잘한다. 휴지통이
/// 실패하면 **영구 삭제로 물러서지 않고** 오류를 그대로 알린다.
#[tauri::command]
#[specta::specta]
pub async fn code_delete(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        delete_to_trash(&full)
    })
    .await
    .map_err(|e| format!("Failed to delete: {e}"))?
}

/// 빈 파일 생성. 중간 폴더는 만들되 대상이 이미 있으면 오류 — 깨진 심링크도
/// "있음" 이라 [`resolve_for_mutation`] 의 가드와 짝을 이룬다.
pub(super) fn create_file(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create the folder: {e}"))?;
    }
    // create_new = 만들어져 있으면 실패. 위의 검사와 생성 사이 경쟁을 커널이 막는다.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(full)
        .map(|_| ())
        .map_err(|e| format!("Failed to create the file: {e}"))
}

/// 폴더 생성. `create_dir_all` 은 이미 있어도 성공하는데, 그러면 트리에 아무
/// 변화가 없어 사용자는 만들어진 줄 안다 — 먼저 막는다.
pub(super) fn create_dir(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    std::fs::create_dir_all(full).map_err(|e| format!("Failed to create the folder: {e}"))
}

/// 이름 바꾸기/이동. 돌려주는 bool 은 옮긴 것이 폴더였는지 (프런트가 탭 경로를
/// 하나만 갈아끼울지, 접두사 전체를 갈아끼울지 정하는 데 쓴다).
pub(super) fn rename_path(from: &Path, to: &Path) -> Result<bool, String> {
    let meta = from
        .symlink_metadata()
        .map_err(|e| format!("Failed to read the source path: {e}"))?;
    if to.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    // 폴더를 자기 후손으로 옮기면 `fs::rename` 이 EINVAL 을 내거나 (플랫폼에 따라)
    // 가지를 통째로 잃는다 — 드래그 이동에서 실제로 일어나는 실수라 먼저 막는다.
    if meta.is_dir() && to.starts_with(from) {
        return Err("Cannot move a folder into itself".to_string());
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create the folder: {e}"))?;
    }
    std::fs::rename(from, to).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(meta.is_dir())
}

/// 휴지통으로. 영구 삭제로 물러서지 않는다 — 휴지통이 안 되는 환경(네트워크
/// 볼륨 등)에서는 조용히 지우는 것보다 실패를 말하는 쪽이 옳다.
pub(super) fn delete_to_trash(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_err() {
        return Err("That path no longer exists".to_string());
    }
    trash::delete(full).map_err(|e| format!("Failed to move to the Trash: {e}"))
}

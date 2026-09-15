//! 에디터 인라인 비교의 원본 — 이 파일을 만진 일지(`code_file_entries`, 브레드
//! 크럼 칩 → diff 사이드카)와 HEAD 시점 내용(`code_head_content`).
//!
//! 디스크의 지금 본문을 다루는 `read_write` 와 달리 둘 다 **다른 시점**을
//! 읽는다 — 하나는 일지 캐시, 하나는 git 객체.

use tauri::State;

use super::project_root;
use super::read_write::MAX_EDIT_BYTES;
use crate::db::Db;

/// 이 파일을 `files_touched` 로 만진 일지들 — 에디터 브레드크럼의 일지 칩.
///
/// 에이전트가 이 파일에 무슨 일을 했는지가 **편집 중에** 보이는 창구다. 클릭은
/// 일지 화면으로 점프하고, diff 사이드카가 있으면 인라인 비교의 원본이 된다.
#[tauri::command]
#[specta::specta]
pub async fn code_file_entries(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<Vec<crate::db::FileJournalEntry>, String> {
    db.oculpm_journal_for_file(project_id, rel_path, 20)
        .await
        .map_err(|e| e.to_string())
}

/// HEAD 시점의 파일 내용 — 인라인 비교("HEAD 와 비교")의 원본.
///
/// `None` = HEAD 에 없다(새 파일·저장소 밖) 또는 바이너리. 오류가 아니다 —
/// 비교할 기준이 없다는 것도 답이다.
#[tauri::command]
#[specta::specta]
pub async fn code_head_content(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<Option<String>, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::git::show_file_bytes(&root, &rel_path, "HEAD", MAX_EDIT_BYTES as usize)?;
        String::from_utf8(bytes).ok()
    })
    .await
    .map_err(|e| format!("Failed to read HEAD content: {e}"))
}

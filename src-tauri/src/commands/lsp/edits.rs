//! 언어 서버로 **파일을 고치는** 세 창구 — 포맷 · 이름 바꾸기 · 코드 액션.
//!
//! 읽기 질의(`mod.rs`)와 실패 모드가 반대다. 읽기는 낡은 답을 빈 결과로 접지만,
//! 여기서는 사용자가 누른 동작이 조용히 아무 일도 안 하면 안 되므로 오류를
//! 그대로 올려 다시 시도하게 한다. 이름 바꾸기와 코드 액션 적용은 같은
//! [`apply_workspace_edit`] 을 지난다 — 전부 아니면 전무.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use super::{project_root, query_result, resolve_in_root};
use crate::db::Db;
use crate::lsp::spec::{LspCodeAction, LspRenameResult};
use crate::lsp::state::{position_params, LspState};

/// 포맷팅 — **디스크가 아니라 넘겨받은 텍스트에** 적용해 돌려준다.
///
/// 이름 바꾸기·코드 액션과 정반대의 선택이다. 그것들은 열려 있지 않은 파일까지
/// 고치므로 디스크에 적용하고 미저장 버퍼를 금지했다. 포맷팅은 **지금 편집 중인
/// 한 파일**이 대상이라, 저장을 강요하는 대신 버퍼를 그대로 다듬어 돌려주는
/// 것이 맞다 (저장 시 포맷도 이 위에 얹힌다).
///
/// 호출 전에 프런트가 `lsp_change` 로 현재 버퍼를 밀어 넣어야 한다 — 서버가
/// 아는 문서와 여기 넘긴 `text` 가 다르면 편집 오프셋이 어긋난다.
/// 바뀐 것이 없으면 `None`(서버가 빈 편집을 준 경우 포함).
/// ⇧⌥F 의 선택 범위 (0-based UTF-16 — 다른 LSP 좌표와 같은 규약).
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct LspFormatRange {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_format(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    text: String,
    tab_size: u32,
    insert_spaces: bool,
    // 선택 범위 — 있으면 `rangeFormatting`: 남의 코드가 섞인 파일에서 전체
    // 포맷은 diff 를 통째로 물들이므로 선택만 다듬는 길이 필요하다. 서버가
    // range 를 모르면 전체로 접는다 (없는 것보단 낫다).
    range: Option<LspFormatRange>,
) -> Result<Option<String>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(None);
    };
    let options = serde_json::json!({
        "tabSize": tab_size.clamp(1, 16),
        "insertSpaces": insert_spaces,
        "trimTrailingWhitespace": true,
        "insertFinalNewline": true,
    });
    let uri = crate::lsp::registry::path_to_uri(&file);
    let (method, params) = match range {
        Some(r) if client.supports("documentRangeFormattingProvider") => (
            "textDocument/rangeFormatting",
            serde_json::json!({
                "textDocument": { "uri": uri },
                "range": {
                    "start": { "line": r.start_line, "character": r.start_character },
                    "end": { "line": r.end_line, "character": r.end_character },
                },
                "options": options,
            }),
        ),
        _ if client.supports("documentFormattingProvider") => (
            "textDocument/formatting",
            serde_json::json!({ "textDocument": { "uri": uri }, "options": options }),
        ),
        _ => return Ok(None),
    };
    let result = client.request(method, params).await?;
    let edits = crate::lsp::edit::text_edits_from_result(&result);
    if edits.is_empty() {
        return Ok(None);
    }
    let formatted = crate::lsp::edit::apply_text_edits(&text, &edits)?;
    Ok((formatted != text).then_some(formatted))
}

/// 이름 바꾸기 — 서버가 준 `WorkspaceEdit` 을 **전부 아니면 전무**로 적용한다.
///
/// 이 라운드의 읽기 기능들과 달리 실패 모드가 파괴적이라 순서가 곧 안전장치다
/// (설계 SSOT §이름 바꾸기):
///
/// 1. 모든 파일의 새 내용을 **메모리에서 먼저** 만든다.
/// 2. 하나라도 실패하면 아무것도 쓰지 않고 오류를 돌려준다.
/// 3. 전부 성공했을 때만 원자적으로 쓴다.
///
/// 되돌리기는 없다 — 다중 파일 undo 스택 대신 git 에 맡긴다(변경 diff 화면이
/// 이미 있다). 대신 무엇을 바꿨는지 파일·건수로 보고한다.
///
/// **미저장 버퍼가 있으면 프런트가 먼저 막는다.** 서버는 `didChange` 로 받은
/// 버퍼 내용을 보고 편집을 계산하는데 우리는 디스크에 적용하므로, 둘이 다르면
/// 오프셋이 어긋나 엉뚱한 자리를 덮어쓴다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_rename(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
    new_name: String,
) -> Result<LspRenameResult, String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("새 이름이 비어 있습니다".to_string());
    }

    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let client = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
        .ok_or("이 파일에는 언어 서버가 붙지 않았습니다")?;
    if !client.supports("renameProvider") {
        return Err("이 언어 서버는 이름 바꾸기를 지원하지 않습니다".to_string());
    }

    let mut params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    params["newName"] = serde_json::Value::String(new_name);
    let result = client.request("textDocument/rename", params).await?;

    // 정의로 이동과 같은 이유로 canonical 루트로 비교한다 (심링크 아래 저장소).
    // 적용은 코드 액션과 **같은 경로**를 쓴다 (전부-아니면-전무 · 뒤에서부터 ·
    // 겹침 거부 · 프로젝트 밖 거부). 정의로 이동과 같은 이유로 canonical 루트.
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    apply_workspace_edit(&result, &canon_root)
}

/// 커서(또는 선택 범위)에서 쓸 수 있는 코드 액션 목록.
///
/// 진단을 `context` 에 실어 보내는 것이 요점이다 — 서버가 준 **원본** 객체를
/// 그대로 돌려줘야 자기 `data` 를 알아보고 quick fix 를 내놓는다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_code_actions(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
) -> Result<Vec<LspCodeAction>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(Vec::new());
    };
    if !client.supports("codeActionProvider") {
        return Ok(Vec::new());
    }

    let diagnostics = lsp
        .diagnostics_overlapping(&file, start_line, end_line)
        .await;
    let params = serde_json::json!({
        "textDocument": { "uri": crate::lsp::registry::path_to_uri(&file) },
        "range": {
            "start": { "line": start_line, "character": start_character },
            "end": { "line": end_line, "character": end_character },
        },
        "context": { "diagnostics": diagnostics },
    });
    let Some(result) = query_result(
        "textDocument/codeAction",
        client.request("textDocument/codeAction", params).await,
    )?
    else {
        return Ok(Vec::new());
    };
    let (actions, raw) = crate::lsp::spec::code_actions_from_json(&result);
    // 적용은 인덱스로 되짚는다 — 원본(서버별 data 포함)은 여기 남겨 둔다.
    lsp.set_code_actions(&file, raw).await;
    Ok(actions)
}

/// 코드 액션 하나를 적용한다.
///
/// 편집 적용은 **이름 바꾸기와 같은 경로**를 쓴다 — 전부-아니면-전무, 뒤에서부터,
/// 겹침 거부, 프로젝트 밖 거부. 미저장 버퍼 게이트도 프런트에서 같이 건다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_apply_code_action(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    index: u32,
) -> Result<LspRenameResult, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let action = lsp
        .code_action_at(&file, index as usize)
        .await
        .ok_or("액션 목록이 오래됐습니다 — 다시 열어 주세요")?;
    let client = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
        .ok_or("이 파일에는 언어 서버가 붙지 않았습니다")?;

    // `edit` 이 없으면 `codeAction/resolve` 로 채운다 (rust-analyzer 의 기본 방식).
    let resolved = match action.get("edit") {
        Some(_) => action,
        None => client.request("codeAction/resolve", action).await?,
    };
    let edit = resolved
        .get("edit")
        .ok_or("서버가 이 액션의 편집을 돌려주지 않았습니다")?;

    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    apply_workspace_edit(edit, &canon_root)
}

/// `WorkspaceEdit` 을 디스크에 적용한다 — **전부 아니면 전무**.
///
/// 이름 바꾸기와 코드 액션이 공유한다. 순서가 곧 안전장치다: 모든 파일의 새
/// 내용을 메모리에서 먼저 만들고, 하나라도 실패하면 아무것도 쓰지 않는다.
fn apply_workspace_edit(
    edit: &serde_json::Value,
    canon_root: &Path,
) -> Result<LspRenameResult, String> {
    let by_file = crate::lsp::edit::workspace_edit_from_json(edit, canon_root)?;
    if by_file.is_empty() {
        return Err("바꿀 곳을 찾지 못했습니다".to_string());
    }

    // 1단계 — 전부 메모리에서.
    let mut staged: Vec<(PathBuf, String, u32)> = Vec::new();
    for (abs, edits) in &by_file {
        let before = std::fs::read_to_string(abs)
            .map_err(|e| format!("{} 를 읽지 못했습니다: {e}", abs.display()))?;
        let after = crate::lsp::edit::apply_text_edits(&before, edits)
            .map_err(|e| format!("{}: {e}", abs.display()))?;
        staged.push((abs.clone(), after, edits.len() as u32));
    }

    // 2단계 — 여기까지 왔으면 전부 성공이다.
    let mut files = Vec::with_capacity(staged.len());
    let mut total_edits = 0u32;
    for (abs, after, count) in staged {
        crate::oculpm::atomic_io::write_atomic(&abs, after.as_bytes())
            .map_err(|e| format!("{} 를 쓰지 못했습니다: {e}", abs.display()))?;
        total_edits += count;
        files.push(crate::lsp::spec::LspRenamedFile {
            path: abs
                .strip_prefix(canon_root)
                .unwrap_or(&abs)
                .to_string_lossy()
                .to_string(),
            edit_count: count,
        });
    }
    Ok(LspRenameResult { files, total_edits })
}

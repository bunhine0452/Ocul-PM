//! 코드 화면 ↔ 언어 서버 창구.
//!
//! 얇게 유지한다 — 프로세스 수명·프레이밍·상관은 `crate::lsp` 가 하고, 여기서는
//! 프로젝트 루트 해석과 **경로 가드**만 얹는다. 가드는 `commands/code.rs` 와
//! 같은 계약이다: 프로젝트 밖 파일을 언어 서버에 열어 주지 않는다.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::db::Db;
use crate::lsp::spec::{
    LspCodeAction, LspCompletionItem, LspFileDiagnostics, LspHover, LspLocation, LspReferenceFile,
    LspRenameResult, LspServerInfo, LspSignatureHelp, LspSymbol, LspWorkspaceSymbol,
};
use crate::lsp::state::{position_params, LspState};

/// 완성 항목 상한. rust-analyzer 는 스코프에 따라 수천 개를 준다 — 상한이
/// 없으면 그대로 IPC 를 타고 넘어와 입력이 끊긴다.
const COMPLETION_LIMIT: usize = 200;

/// 워크스페이스 심볼 상한. 짧은 질의(`a`)에 서버가 수천 개를 준다 — 팔레트가
/// 보여줄 수 있는 것보다 많이 받아도 IPC 비용만 든다.
const WORKSPACE_SYMBOL_LIMIT: usize = 100;

/// 참조 미리보기를 위해 읽는 파일의 상한. 참조가 수백 개면 그만큼 파일을 읽게
/// 되므로 큰 파일에서 멈춘다 (미리보기가 비는 것이 목록이 안 뜨는 것보다 낫다).
const PREVIEW_FILE_MAX_BYTES: u64 = 2 * 1024 * 1024;

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// 프로젝트 상대 경로 → 절대 경로. 심볼릭 링크로 프로젝트를 빠져나가는 경로를
/// 거부한다 (`code_read`/`code_write` 와 같은 가드).
fn resolve_in_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("Path is empty".to_string());
    }
    let full = root.join(relative);
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let canon = std::fs::canonicalize(&full).map_err(|e| format!("Failed to read file: {e}"))?;
    if !canon.starts_with(&canon_root) {
        return Err("Path escapes the project root".to_string());
    }
    Ok(canon)
}

/// 이 프로젝트의 언어 서버 일람 — 설치됨/미설치/실행 중.
#[tauri::command]
#[specta::specta]
pub async fn lsp_status(
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
) -> Result<Vec<LspServerInfo>, String> {
    let root = project_root(&db, project_id).await?;
    Ok(lsp.status(project_id, &root).await)
}

/// 파일을 열었다고 알린다 (필요하면 서버를 띄운다).
///
/// 반환 `false` = 이 파일은 LSP 대상이 아니거나 서버가 없다. **오류가 아니다** —
/// css·md 를 열 때마다 오류 토스트가 뜨면 안 된다. 왜 안 붙었는지는
/// `LspServerStateChanged` 이벤트가 따로 말한다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_open(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    text: String,
) -> Result<bool, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(false);
    };
    let version = lsp.next_version(&file).await;
    client.did_open(&file, &text, version).await?;
    Ok(true)
}

/// 편집 내용을 서버에 밀어 넣는다 (full sync — 설계 SSOT §문서 동기).
///
/// 프런트가 디바운스해서 부른다. 서버가 없으면 조용히 no-op.
#[tauri::command]
#[specta::specta]
pub async fn lsp_change(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    text: String,
) -> Result<bool, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(false);
    };
    let version = lsp.next_version(&file).await;
    client.did_change(&file, &text, version).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_close(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    // 이미 지워진 파일도 닫을 수 있어야 하므로 canonicalize 실패를 삼킨다.
    let Ok(file) = resolve_in_root(&root, &path) else {
        return Ok(());
    };
    if let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    {
        let _ = client.did_close(&file).await;
    }
    lsp.forget_document(&file).await;
    Ok(())
}

/// 커서 위치의 자동완성.
///
/// `line`/`character` 는 **0-based UTF-16** — 프런트가 만든 값을 그대로 넘긴다.
/// 여기서 다시 세면 한글이 있는 줄에서 어긋난다 (설계 SSOT §위치 인코딩).
#[tauri::command]
#[specta::specta]
pub async fn lsp_completion(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspCompletionItem>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(Vec::new());
    };
    if !client.supports("completionProvider") {
        return Ok(Vec::new());
    }
    let params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    let result = client.request("textDocument/completion", params).await?;
    Ok(crate::lsp::spec::completions_from_json(
        &result,
        COMPLETION_LIMIT,
    ))
}

/// 커서 위치의 타입·문서 (호버).
///
/// `None` = 보여줄 것이 없다 (서버 없음 · 그 자리에 심볼 없음). 오류가 아니다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_hover(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
) -> Result<Option<LspHover>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(None);
    };
    if !client.supports("hoverProvider") {
        return Ok(None);
    }
    let params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    let result = client.request("textDocument/hover", params).await?;
    Ok(crate::lsp::spec::hover_from_json(&result))
}

/// 커서 위치 심볼의 정의.
///
/// 프로젝트 **밖**(표준 라이브러리·의존성)을 가리키면 `path` 가 `None` 인
/// 위치를 돌려준다 — 코드 화면은 열 수 없지만, 조용히 아무 일도 안 하는 대신
/// 어디로 가려 했는지 말할 수 있다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_definition(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
) -> Result<Option<LspLocation>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(None);
    };
    if !client.supports("definitionProvider") {
        return Ok(None);
    }
    let params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    let result = client.request("textDocument/definition", params).await?;
    // 프로젝트 루트는 canonicalize 해서 비교한다 — 서버는 심링크가 풀린
    // 실경로로 답하는데, 저장소가 심링크 아래에 있으면 접두사가 안 맞아
    // 프로젝트 안의 정의까지 "밖" 으로 판정된다.
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    Ok(crate::lsp::spec::definition_from_json(&result, &canon_root))
}

/// 커서 위치 심볼을 쓰는 모든 곳 (`textDocument/references`).
///
/// 정의로 이동이 "한 곳" 이라면 이쪽은 "전부" 다 — 파일별로 묶어서 돌려주고,
/// 각 줄의 원문을 미리보기로 붙인다(파일을 열지 않고 판단할 수 있게).
/// 선언 자체도 포함한다(`includeDeclaration`) — 빼면 "쓰는 곳 3군데" 라는
/// 목록에 정작 정의가 없어 헷갈린다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_references(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspReferenceFile>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(Vec::new());
    };
    if !client.supports("referencesProvider") {
        return Ok(Vec::new());
    }
    let mut params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    params["context"] = serde_json::json!({ "includeDeclaration": true });
    let result = client.request("textDocument/references", params).await?;

    // 정의로 이동과 같은 이유로 canonical 루트와 비교한다 — 저장소가 심링크
    // 아래에 있으면 접두사가 안 맞아 프로젝트 안의 참조까지 "밖" 으로 읽힌다.
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    let mut cache: std::collections::HashMap<PathBuf, Option<Vec<String>>> =
        std::collections::HashMap::new();
    Ok(crate::lsp::spec::references_from_json(
        &result,
        &canon_root,
        |p| {
            cache
                .entry(p.to_path_buf())
                .or_insert_with(|| read_preview_lines(p))
                .clone()
        },
    ))
}

/// 파일 안의 구조 (`textDocument/documentSymbol`) — 아웃라인.
#[tauri::command]
#[specta::specta]
pub async fn lsp_document_symbols(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
) -> Result<Vec<LspSymbol>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(Vec::new());
    };
    if !client.supports("documentSymbolProvider") {
        return Ok(Vec::new());
    }
    let params = serde_json::json!({
        "textDocument": { "uri": crate::lsp::registry::path_to_uri(&file) }
    });
    let result = client
        .request("textDocument/documentSymbol", params)
        .await?;
    Ok(crate::lsp::spec::document_symbols_from_json(&result))
}

/// 지금 언어 서버가 아는 이 프로젝트의 진단 전부 — 문제 패널의 초기 스냅샷.
///
/// 서버를 **띄우지 않는다**: 이미 떠 있는 서버가 밀어 준 것을 읽기만 한다.
/// 화면을 열었다는 이유로 프로젝트의 모든 언어 서버가 기동하면, 안 보고 있는
/// 언어까지 색인을 시작한다. 서버가 없으면 빈 배열이고 그게 정직한 답이다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_diagnostics_snapshot(
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
) -> Result<Vec<LspFileDiagnostics>, String> {
    let root = project_root(&db, project_id).await?;
    Ok(lsp.diagnostics_snapshot(&root).await)
}

/// 프로젝트 전체 심볼 검색 (`workspace/symbol`) — ⌘K 팔레트가 쓴다.
///
/// **어느 서버에 물을지**가 이 커맨드의 문제다. 워크스페이스 심볼은 파일에
/// 매이지 않으므로 `ensure_for_file` 을 쓸 수 없다 — 지금 떠 있는 서버 전부에
/// 묻고 합친다. 서버를 새로 띄우지는 않는다: 팔레트에 글자를 칠 때마다
/// rust-analyzer 가 뜨면 안 된다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_workspace_symbols(
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    query: String,
) -> Result<Vec<LspWorkspaceSymbol>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let root = project_root(&db, project_id).await?;
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    let clients = lsp.running_clients(project_id).await;

    let mut out: Vec<LspWorkspaceSymbol> = Vec::new();
    for client in clients {
        if !client.supports("workspaceSymbolProvider") {
            continue;
        }
        let params = serde_json::json!({ "query": query });
        // 한 서버가 느리거나 오류를 내도 나머지 결과는 보여준다 — 팔레트가
        // 통째로 죽는 것이 가장 나쁘다.
        let Ok(result) = client.request("workspace/symbol", params).await else {
            continue;
        };
        out.extend(crate::lsp::spec::workspace_symbols_from_json(
            &result,
            &canon_root,
            WORKSPACE_SYMBOL_LIMIT,
        ));
    }
    out.truncate(WORKSPACE_SYMBOL_LIMIT);
    Ok(out)
}

/// 인자를 입력하는 동안의 시그니처 힌트 (`textDocument/signatureHelp`).
#[tauri::command]
#[specta::specta]
pub async fn lsp_signature_help(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
    line: u32,
    character: u32,
) -> Result<Option<LspSignatureHelp>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(None);
    };
    if !client.supports("signatureHelpProvider") {
        return Ok(None);
    }
    let params = position_params(crate::lsp::registry::path_to_uri(&file), line, character);
    let result = client.request("textDocument/signatureHelp", params).await?;
    Ok(crate::lsp::spec::signature_help_from_json(&result))
}

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

/// 참조 미리보기용 줄 읽기. 큰 파일·바이너리는 건너뛴다 — 미리보기가 비는 것이
/// 목록이 안 뜨는 것보다 낫다.
fn read_preview_lines(path: &Path) -> Option<Vec<String>> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > PREVIEW_FILE_MAX_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(text.lines().map(str::to_string).collect())
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
    let result = client.request("textDocument/codeAction", params).await?;
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

/// 이 프로젝트의 언어 서버를 전부 정리한다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_stop(lsp: State<'_, LspState>, project_id: u32) -> Result<(), String> {
    lsp.stop_project(project_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn resolve_rejects_escapes_and_accepts_real_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "fn main() {}").unwrap();

        let ok = resolve_in_root(root, "src/a.rs").unwrap();
        assert!(ok.ends_with("src/a.rs"));

        for bad in [
            "",
            "   ",
            "../outside.rs",
            "src/../../outside.rs",
            "nope.rs",
        ] {
            assert!(resolve_in_root(root, bad).is_err(), "통과시켰다: {bad:?}");
        }
    }

    /// 심볼릭 링크로 프로젝트를 빠져나가는 경로 — `code_read` 와 같은 계약.
    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlinks_pointing_outside() {
        let tmp = TempDir::new().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.rs"), "// secret").unwrap();
        let root = tmp.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.rs"), root.join("link.rs")).unwrap();

        assert!(
            resolve_in_root(&root, "link.rs").is_err(),
            "프로젝트 밖을 가리키는 링크를 언어 서버에 열어 줬다"
        );
    }
}

//! 코드 화면 ↔ 언어 서버 창구.
//!
//! 얇게 유지한다 — 프로세스 수명·프레이밍·상관은 `crate::lsp` 가 하고, 여기서는
//! 프로젝트 루트 해석과 **경로 가드**만 얹는다. 가드는 `commands/code.rs` 와
//! 같은 계약이다: 프로젝트 밖 파일을 언어 서버에 열어 주지 않는다.
//!
//! 읽기 질의(열기·호버·정의·참조·심볼·토큰)는 여기, **파일을 고치는** 셋
//! (포맷·이름 바꾸기·코드 액션)은 `edits` 에 있다 — 실패 모드가 다르다
//! (읽기는 빈 결과로 접고, 쓰기는 오류를 올려 사용자가 다시 시도하게 한다).
//! 공개 경로는 여기서 다시 내보내 그대로다.

mod edits;

pub use edits::*;

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::Db;
use crate::lsp::client::RpcError;
use crate::lsp::semantic::LspSemanticLegend;
use crate::lsp::spec::{
    LspCompletionItem, LspFileDiagnostics, LspHover, LspLocation, LspReferenceFile, LspServerInfo,
    LspSignatureHelp, LspSymbol, LspWorkspaceSymbol,
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

pub(super) async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// 프로젝트 상대 경로 → 절대 경로. 심볼릭 링크로 프로젝트를 빠져나가는 경로를
/// 거부한다 (`code_read`/`code_write` 와 같은 가드).
pub(super) fn resolve_in_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
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

/// 읽기 질의(호버·정의·참조·완성·심볼·토큰·시그니처·코드 액션)의 응답 정리.
///
/// 취소 부류(`ContentModified` -32801 · `RequestCancelled` · `ServerCancelled`)는
/// LSP 명세상 「문서가 바뀌었으니 다시 물어라」 는 정상 신호다 — rust-analyzer 는
/// 커서가 움직이는 동안의 호버에 흔히 낸다. 오류로 올리면 프런트가 ERROR 로
/// 남기고(설치본 로그 2026-09-1x), 진짜 실패가 그 사이에 묻힌다. 여기서 `None`
/// (= 지금은 보여줄 것이 없다) 으로 접고 debug 로만 남긴다. **문자열이 아니라
/// 코드로** 판별한다 ([`RpcError::is_stale`]).
///
/// 쓰기(포맷·이름 바꾸기·코드 액션 적용)는 이걸 타지 않는다 — 사용자가 누른
/// 동작이 조용히 아무 일도 안 하면 안 되므로 오류로 올려 다시 시도하게 한다.
pub(super) fn query_result(
    method: &str,
    res: Result<Value, RpcError>,
) -> Result<Option<Value>, String> {
    match res {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.is_stale() => {
            tracing::debug!(target: "lsp", method, code = ?e.code, "질의가 낡았다 — 빈 결과로 접는다");
            Ok(None)
        }
        Err(e) => Err(e.to_string()),
    }
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
    let Some(result) = query_result(
        "textDocument/completion",
        client.request("textDocument/completion", params).await,
    )?
    else {
        return Ok(Vec::new());
    };
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
    let Some(result) = query_result(
        "textDocument/hover",
        client.request("textDocument/hover", params).await,
    )?
    else {
        return Ok(None);
    };
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
    let Some(result) = query_result(
        "textDocument/definition",
        client.request("textDocument/definition", params).await,
    )?
    else {
        return Ok(None);
    };
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
    let Some(result) = query_result(
        "textDocument/references",
        client.request("textDocument/references", params).await,
    )?
    else {
        return Ok(Vec::new());
    };

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
    let Some(result) = query_result(
        "textDocument/documentSymbol",
        client.request("textDocument/documentSymbol", params).await,
    )?
    else {
        return Ok(Vec::new());
    };
    Ok(crate::lsp::spec::document_symbols_from_json(&result))
}

/// 이 파일의 언어 서버가 쓰는 시맨틱 토큰 legend (숫자 → 이름 표).
///
/// **요청이 나가지 않는다** — legend 는 `initialize` 답에 이미 들어 있다.
/// 화면은 이 표를 받은 뒤에야 공급자를 달 수 있어서 토큰 데이터와 분리했다:
/// Monaco 는 공급자마다 legend 를 **한 번만** 읽어 캐시하므로, 표가 빈 채로
/// 등록하면 그 편집기는 끝까지 색을 못 칠한다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_semantic_legend(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
) -> Result<Option<LspSemanticLegend>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(None);
    };
    let Some(cap) = client.capability("semanticTokensProvider") else {
        return Ok(None);
    };
    Ok(crate::lsp::semantic::legend_from_capability(cap))
}

/// 파일 전체의 시맨틱 토큰 (`textDocument/semanticTokens/full`).
///
/// 서버가 안 하면 빈 배열이고, 화면은 그때 Monarch 강조를 그대로 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn lsp_semantic_tokens(
    app: AppHandle,
    db: State<'_, Db>,
    lsp: State<'_, LspState>,
    project_id: u32,
    path: String,
) -> Result<Vec<u32>, String> {
    let root = project_root(&db, project_id).await?;
    let file = resolve_in_root(&root, &path)?;
    let Some(client) = lsp
        .ensure_for_file(&app, &db, project_id, &root, &file)
        .await?
    else {
        return Ok(Vec::new());
    };
    if !client.supports("semanticTokensProvider") {
        return Ok(Vec::new());
    }
    let params = serde_json::json!({
        "textDocument": { "uri": crate::lsp::registry::path_to_uri(&file) }
    });
    let Some(result) = query_result(
        "textDocument/semanticTokens/full",
        client
            .request("textDocument/semanticTokens/full", params)
            .await,
    )?
    else {
        return Ok(Vec::new());
    };
    Ok(crate::lsp::semantic::tokens_from_json(&result))
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
    let Some(result) = query_result(
        "textDocument/signatureHelp",
        client.request("textDocument/signatureHelp", params).await,
    )?
    else {
        return Ok(None);
    };
    Ok(crate::lsp::spec::signature_help_from_json(&result))
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

    /// 설치본 로그 2026-09-1x: `lspHover failed: content modified (code -32801)` 이
    /// ERROR 로 남았다. 취소 부류는 「지금은 없음」으로 접히고, 그 밖의 오류는
    /// 코드가 보이는 문자열로 그대로 올라간다.
    #[test]
    fn query_result_folds_stale_answers_and_keeps_real_failures() {
        let stale = RpcError::from_json(&serde_json::json!({
            "code": RpcError::CONTENT_MODIFIED, "message": "content modified"
        }));
        assert_eq!(query_result("textDocument/hover", Err(stale)), Ok(None));
        let cancelled = RpcError::from_json(&serde_json::json!({
            "code": RpcError::REQUEST_CANCELLED, "message": "cancelled"
        }));
        assert_eq!(query_result("textDocument/hover", Err(cancelled)), Ok(None));

        let real = RpcError::from_json(&serde_json::json!({
            "code": -32603, "message": "internal error"
        }));
        assert_eq!(
            query_result("textDocument/hover", Err(real)),
            Err("internal error (code -32603)".to_string())
        );
        assert_eq!(
            query_result("textDocument/hover", Err(RpcError::transport("timeout"))),
            Err("timeout".to_string())
        );
        assert_eq!(
            query_result(
                "textDocument/hover",
                Ok(serde_json::json!({ "contents": "x" }))
            ),
            Ok(Some(serde_json::json!({ "contents": "x" })))
        );
    }

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
    // PORT-TEST(L-FS): 경로 탈출 가드 — Windows 판(심링크/정션, 권한 없으면 skip 사유)은 L-FS 가 쓴다.
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

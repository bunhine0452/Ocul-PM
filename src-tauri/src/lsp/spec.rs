//! LSP 의 느슨한 JSON 을 프런트가 쓸 수 있는 좁은 타입으로 옮긴다.
//!
//! 변환을 **순수 함수**로 두는 이유: 서버마다 같은 필드를 다르게 채운다.
//! rust-analyzer 는 `detail` 에 타입을, typescript-language-server 는 시그니처를
//! 넣고, `documentation` 은 문자열일 수도 `{kind, value}` 객체일 수도 있다.
//! 이 관용 처리를 테스트로 잠가 두지 않으면 서버를 하나 늘릴 때마다 조용히 빈
//! 값이 뜬다.
//!
//! **위치는 변환하지 않는다** — LSP 의 `character` 는 UTF-16 코드 유닛이고
//! 프런트(JS)도 UTF-16 이라 숫자를 그대로 통과시킨다. Rust 에서 오프셋으로
//! 바꾸는 순간 한글 주석이 있는 줄에서 어긋난다 (설계 SSOT §위치 인코딩).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LspSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspDiagnostic {
    /// 0-based, LSP 원본 그대로 (UTF-16 코드 유닛).
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub severity: LspSeverity,
    pub message: String,
    /// `rustc` · `clippy` · `ts` 등. 어느 도구가 한 말인지 밝힌다.
    pub source: Option<String>,
}

/// 한 파일에 걸린 진단 전부 — 문제 패널의 초기 스냅샷 한 줄.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspFileDiagnostics {
    /// 프로젝트 상대 경로 (`LspDiagnosticsPublished.path` 와 같은 표기).
    pub path: String,
    pub diagnostics: Vec<LspDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspCompletionItem {
    pub label: String,
    /// 타입/시그니처 — 목록 오른쪽에 흐리게.
    pub detail: Option<String>,
    /// `function` · `variable` · `struct` … CM6 아이콘으로 매핑된다.
    pub kind: Option<String>,
    /// 라벨과 실제로 넣을 텍스트가 다를 때만 (`insertText`/`textEdit`).
    pub insert_text: Option<String>,
    /// 정렬용 — 서버가 준 순서를 존중한다. CM6 가 자체 정렬하지 않게 한다.
    pub sort_text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LspServerState {
    /// 프로세스는 떴고 initialize 진행 중.
    Starting,
    /// 인덱싱 중 — 진단이 아직 안 올 수 있다. 이 상태를 밝히지 않으면
    /// 사용자가 "고장" 으로 읽는다.
    Indexing,
    Ready,
    /// 바이너리가 PATH 에 없다. 조용히 실패하지 않고 이 사실을 말한다.
    Missing,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspServerInfo {
    pub language_id: String,
    pub command: String,
    pub state: LspServerState,
    /// 서버 루트 (프로젝트 상대). 모노레포에서 어느 워크스페이스에 붙었는지.
    pub root: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspHover {
    /// 마크다운 원문. 프런트가 코드 블록과 산문으로 갈라 렌더한다.
    pub contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspLocation {
    /// 프로젝트 상대 경로. 프로젝트 **밖**(의존성 소스·표준 라이브러리)이면
    /// `None` — 코드 화면이 열 수 없는 파일이다. 조용히 아무 일도 안 하는
    /// 대신 어디로 가려 했는지 말해 주기 위해 `display` 를 함께 준다.
    pub path: Option<String>,
    /// 사람에게 보여줄 이름 (프로젝트 안이면 상대 경로, 밖이면 파일명).
    pub display: String,
    /// 0-based, LSP 원본 그대로.
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspCodeAction {
    /// 마지막 목록에서의 자리. 적용할 때 이 번호로 되짚는다 — 서버별 `data` 가
    /// 붙은 원본 객체를 프런트로 왕복시키지 않기 위해서다.
    pub index: u32,
    pub title: String,
    /// `quickfix` · `refactor` · `source` … 없을 수도 있다.
    pub kind: Option<String>,
    /// 서버가 "이걸 먼저" 라고 표시한 것 (대개 가장 그럴듯한 fix).
    pub preferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspRenamedFile {
    /// 프로젝트 상대 경로.
    pub path: String,
    pub edit_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspRenameResult {
    pub files: Vec<LspRenamedFile>,
    pub total_edits: u32,
}

/// 참조 하나 — 파일 안의 한 자리.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspReferenceHit {
    /// 0-based, LSP 원본 그대로.
    pub line: u32,
    pub character: u32,
    /// 그 줄의 원문(앞뒤 공백 제거·길이 제한). 목록에서 **무엇이 걸렸는지**를
    /// 파일을 열지 않고 판단하게 해 준다 — 이게 없으면 경로+줄번호만 남아
    /// 하나하나 열어 봐야 한다.
    pub preview: String,
}

/// 파일 하나에 모인 참조들. 목록이 파일 단위로 접히도록 서버 응답을 묶는다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspReferenceFile {
    /// 프로젝트 상대 경로. 밖(의존성·표준 라이브러리)이면 `None` — 열 수는
    /// 없지만 어디서 쓰이는지는 보여 준다.
    pub path: Option<String>,
    pub display: String,
    pub hits: Vec<LspReferenceHit>,
}

/// 파일 안의 심볼 하나 (아웃라인 한 줄).
///
/// 서버는 트리(`DocumentSymbol`)나 평면(`SymbolInformation`) 둘 중 하나로 답한다.
/// 우리는 **문서 순서의 평면 목록 + `depth`** 로 통일한다 — 아웃라인은 어차피
/// 들여쓴 목록으로 그리고, 재귀 타입을 IPC 경계로 보내지 않아도 된다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspSymbol {
    pub name: String,
    /// 시그니처·타입 등 서버가 준 부가 설명.
    pub detail: Option<String>,
    /// `function` · `struct` · `method` … 아이콘·색으로 쓴다.
    pub kind: String,
    /// 0-based 중첩 깊이.
    pub depth: u32,
    /// 점프 대상 — `selectionRange`(이름 자체) 우선. `range` 는 블록 전체라
    /// 커서가 함수 위 빈 줄에 떨어진다.
    pub line: u32,
    pub character: u32,
}

/// 워크스페이스 심볼 검색 결과 한 줄.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspWorkspaceSymbol {
    pub name: String,
    pub kind: String,
    /// 담고 있는 것 (클래스·모듈 이름). 서버가 줄 때만.
    pub container: Option<String>,
    /// 프로젝트 상대 경로. 밖이면 `None`.
    pub path: Option<String>,
    pub display: String,
    pub line: u32,
    pub character: u32,
}

/// 시그니처 라벨 안에서 인자 하나가 차지하는 구간.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspParamSpan {
    /// `label` 문자열 안의 UTF-16 오프셋 [start, end).
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspSignature {
    pub label: String,
    pub documentation: Option<String>,
    pub parameters: Vec<LspParamSpan>,
}

/// `textDocument/signatureHelp` — 인자를 입력하는 동안 뜨는 것.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspSignatureHelp {
    pub signatures: Vec<LspSignature>,
    pub active_signature: u32,
    /// 지금 입력 중인 인자. 범위를 벗어나면 강조하지 않는다.
    pub active_parameter: u32,
}

// ─── 변환 ───────────────────────────────────────────────────────────────────

/// `publishDiagnostics` 의 배열을 좁은 타입으로. 읽을 수 없는 항목은 **버린다**
/// — 한 항목이 이상하다고 그 파일의 진단 전체를 잃는 것이 더 나쁘다.
pub fn diagnostics_from_json(items: &Value) -> Vec<LspDiagnostic> {
    items
        .as_array()
        .map(|arr| arr.iter().filter_map(diagnostic_from_json).collect())
        .unwrap_or_default()
}

fn diagnostic_from_json(item: &Value) -> Option<LspDiagnostic> {
    let range = item.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    let message = item.get("message").and_then(Value::as_str)?.to_string();
    Some(LspDiagnostic {
        start_line: start.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
        start_character: start.get("character").and_then(Value::as_u64).unwrap_or(0) as u32,
        end_line: end.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
        end_character: end.get("character").and_then(Value::as_u64).unwrap_or(0) as u32,
        // 심각도 미지정은 LSP 상 "클라이언트가 정한다" — 경고로 둔다.
        // 오류로 올리면 없는 빨간 줄이 생기고, 힌트로 내리면 진짜 문제가 묻힌다.
        severity: match item.get("severity").and_then(Value::as_u64) {
            Some(1) => LspSeverity::Error,
            Some(3) => LspSeverity::Info,
            Some(4) => LspSeverity::Hint,
            _ => LspSeverity::Warning,
        },
        message,
        source: item
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// `textDocument/completion` 의 응답. 서버는 배열이나 `{isIncomplete, items}`
/// 둘 중 하나로 준다 — 둘 다 받는다.
pub fn completions_from_json(result: &Value, limit: usize) -> Vec<LspCompletionItem> {
    let items = match result {
        Value::Array(a) => a.as_slice(),
        _ => match result.get("items").and_then(Value::as_array) {
            Some(a) => a.as_slice(),
            None => return Vec::new(),
        },
    };
    items
        .iter()
        .filter_map(completion_from_json)
        .take(limit)
        .collect()
}

fn completion_from_json(item: &Value) -> Option<LspCompletionItem> {
    let label = item.get("label").and_then(Value::as_str)?.to_string();
    Some(LspCompletionItem {
        label,
        detail: item
            .get("detail")
            .and_then(Value::as_str)
            .map(str::to_string)
            // rust-analyzer 는 detail 대신 labelDetails.description 을 쓰기도 한다.
            .or_else(|| {
                item.get("labelDetails")?
                    .get("description")?
                    .as_str()
                    .map(str::to_string)
            }),
        kind: item
            .get("kind")
            .and_then(Value::as_u64)
            .map(completion_kind_name),
        // textEdit 이 있으면 그쪽이 정답이다 (서버가 대체 범위까지 정한 경우).
        insert_text: item
            .get("textEdit")
            .and_then(|e| e.get("newText"))
            .and_then(Value::as_str)
            .or_else(|| item.get("insertText").and_then(Value::as_str))
            .map(str::to_string),
        sort_text: item
            .get("sortText")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// `textDocument/hover` 의 응답.
///
/// `contents` 가 세 가지 모양으로 온다 — 이 관용 처리가 이 함수의 전부다:
///   - `MarkupContent`  `{ kind, value }`            (요즘 서버 대부분)
///   - `MarkedString`   `"..."` 또는 `{ language, value }` (구형)
///   - 위의 **배열**                                  (rust-analyzer 가 쓴다)
pub fn hover_from_json(result: &Value) -> Option<LspHover> {
    let contents = result.get("contents")?;
    let text = match contents {
        Value::Array(parts) => parts
            .iter()
            .filter_map(marked_string_to_markdown)
            .collect::<Vec<_>>()
            .join("\n\n"),
        other => marked_string_to_markdown(other)?,
    };
    let trimmed = text.trim();
    // 빈 호버는 없는 것과 같다 — 빈 툴팁이 뜨는 것을 막는다.
    (!trimmed.is_empty()).then(|| LspHover {
        contents: trimmed.to_string(),
    })
}

fn marked_string_to_markdown(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => {
            let value = o.get("value")?.as_str()?;
            match o.get("language").and_then(Value::as_str) {
                // 구형 `MarkedString{language,value}` 는 코드다 — 펜스를 씌워
                // 프런트가 산문과 구별할 수 있게 한다.
                Some(lang) => Some(format!("```{lang}\n{value}\n```")),
                None => Some(value.to_string()),
            }
        }
        _ => None,
    }
}

/// `textDocument/codeAction` 의 응답 → 우리가 **적용할 수 있는** 것만.
///
/// 응답에는 `Command` 와 `CodeAction` 이 섞여 온다. `Command` 만 있는 항목은
/// `workspace/executeCommand` 로 서버에 실행을 맡기는 방식인데, 그러면 서버가
/// `workspace/applyEdit` 를 **요청**으로 되보내고 우리가 답해야 한다 — 아직
/// 그 경로가 없으므로 **목록에서 뺀다**. 눌러도 아무 일 없는 항목을 보여주는
/// 것보다 안 보여주는 게 낫다.
///
/// `edit` 없이 `data` 만 있는 항목은 정상이다 — `codeAction/resolve` 로 나중에
/// 채운다 (rust-analyzer 가 이 방식을 쓴다).
pub fn code_actions_from_json(result: &Value) -> (Vec<LspCodeAction>, Vec<Value>) {
    let Some(items) = result.as_array() else {
        return (Vec::new(), Vec::new());
    };
    let mut out = Vec::new();
    let mut raw = Vec::new();
    for item in items {
        // 제목이 없으면 사용자에게 보여줄 수 없다.
        let Some(title) = item.get("title").and_then(Value::as_str) else {
            continue;
        };
        let applicable = item.get("edit").is_some() || item.get("data").is_some();
        if !applicable {
            continue; // command 전용 — 위 주석 참고
        }
        out.push(LspCodeAction {
            index: raw.len() as u32,
            title: title.to_string(),
            kind: item.get("kind").and_then(Value::as_str).map(str::to_string),
            preferred: item
                .get("isPreferred")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
        raw.push(item.clone());
    }
    (out, raw)
}

/// `textDocument/definition` 의 응답 → 첫 위치 하나.
///
/// 네 가지 모양으로 온다: `Location` · `Location[]` · `LocationLink[]` · null.
/// 여러 개일 때 첫 번째만 쓰는 이유는, 정의가 여럿인 경우(트레이트 구현 등)에
/// 고르게 하는 UI 가 아직 없어서다 — 목록 UI 는 후속 라운드 몫이고, 그때까지
/// **첫 번째로 이동하는 것이 아무 일도 안 하는 것보다 낫다**.
pub fn definition_from_json(result: &Value, project_root: &std::path::Path) -> Option<LspLocation> {
    let first = match result {
        Value::Array(a) => a.first()?,
        Value::Null => return None,
        other => other,
    };
    // LocationLink 는 uri/range 대신 targetUri/targetSelectionRange 를 쓴다.
    let uri = first
        .get("uri")
        .or_else(|| first.get("targetUri"))
        .and_then(Value::as_str)?;
    let range = first
        .get("range")
        // targetSelectionRange 가 심볼 이름 자체를 가리킨다 (targetRange 는
        // 정의 블록 전체라 커서가 함수 맨 위 빈 줄에 떨어진다).
        .or_else(|| first.get("targetSelectionRange"))
        .or_else(|| first.get("targetRange"))?;
    let start = range.get("start")?;

    let path = super::registry::uri_to_path(uri)?;
    let rel = path
        .strip_prefix(project_root)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let display = rel.clone().unwrap_or_else(|| {
        path.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| uri.to_string())
    });

    Some(LspLocation {
        path: rel,
        display,
        line: start.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
        character: start.get("character").and_then(Value::as_u64).unwrap_or(0) as u32,
    })
}

/// 미리보기 한 줄의 상한 — 목록이 가로로 터지지 않게.
const PREVIEW_MAX_CHARS: usize = 160;

/// `textDocument/references` 응답 → **파일별로 묶은** 목록.
///
/// 미리보기는 호출자가 파일을 읽어 넘긴다(`line_source`) — 여기서 IO 를 하지
/// 않아야 순수 함수로 테스트된다. 파일을 못 읽으면 미리보기만 비고 자리는 남는다.
pub fn references_from_json(
    result: &Value,
    project_root: &std::path::Path,
    mut line_source: impl FnMut(&std::path::Path) -> Option<Vec<String>>,
) -> Vec<LspReferenceFile> {
    let Value::Array(items) = result else {
        return Vec::new();
    };
    // 서버는 파일 순서를 보장하지 않는다 — 경로로 묶고 정렬해 목록이 안정된다.
    let mut by_file: std::collections::BTreeMap<std::path::PathBuf, Vec<(u32, u32)>> =
        std::collections::BTreeMap::new();
    for item in items {
        let Some(uri) = item
            .get("uri")
            .or_else(|| item.get("targetUri"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Some(start) = item
            .get("range")
            .or_else(|| item.get("targetSelectionRange"))
            .and_then(|r| r.get("start"))
        else {
            continue;
        };
        let Some(path) = super::registry::uri_to_path(uri) else {
            continue;
        };
        by_file.entry(path).or_default().push((
            start.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
            start.get("character").and_then(Value::as_u64).unwrap_or(0) as u32,
        ));
    }

    by_file
        .into_iter()
        .map(|(path, mut positions)| {
            positions.sort_unstable();
            positions.dedup();
            let lines = line_source(&path);
            let rel = path
                .strip_prefix(project_root)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
            let display = rel.clone().unwrap_or_else(|| {
                path.file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string())
            });
            let hits = positions
                .into_iter()
                .map(|(line, character)| LspReferenceHit {
                    line,
                    character,
                    preview: lines
                        .as_ref()
                        .and_then(|ls| ls.get(line as usize))
                        .map(|l| clip(l.trim(), PREVIEW_MAX_CHARS))
                        .unwrap_or_default(),
                })
                .collect();
            LspReferenceFile {
                path: rel,
                display,
                hits,
            }
        })
        .collect()
}

/// `textDocument/documentSymbol` → 문서 순서의 평면 목록 + 깊이.
///
/// 두 모양을 다 받는다: 계층형 `DocumentSymbol`(children 있음)과 평면
/// `SymbolInformation`(location 있음). 후자는 깊이가 없으므로 전부 0 이다.
pub fn document_symbols_from_json(result: &Value) -> Vec<LspSymbol> {
    fn walk(items: &[Value], depth: u32, out: &mut Vec<LspSymbol>) {
        for item in items {
            let Some(name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            // 계층형은 selectionRange/range, 평면형은 location.range.
            let range = item
                .get("selectionRange")
                .or_else(|| item.get("range"))
                .or_else(|| item.get("location").and_then(|l| l.get("range")));
            let start = range.and_then(|r| r.get("start"));
            out.push(LspSymbol {
                name: name.to_string(),
                detail: item
                    .get("detail")
                    .and_then(Value::as_str)
                    .filter(|d| !d.is_empty())
                    .map(str::to_string),
                kind: symbol_kind_name(item.get("kind").and_then(Value::as_u64).unwrap_or(0)),
                depth,
                line: start
                    .and_then(|s| s.get("line"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32,
                character: start
                    .and_then(|s| s.get("character"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32,
            });
            if let Some(Value::Array(children)) = item.get("children") {
                walk(children, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    if let Value::Array(items) = result {
        walk(items, 0, &mut out);
    }
    out
}

/// `workspace/symbol` → 검색 결과. 프로젝트 밖 심볼도 남긴다(열 수는 없지만
/// 어디 있는지는 말한다 — 정의로 이동과 같은 태도).
pub fn workspace_symbols_from_json(
    result: &Value,
    project_root: &std::path::Path,
    limit: usize,
) -> Vec<LspWorkspaceSymbol> {
    let Value::Array(items) = result else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(Value::as_str)?;
            // WorkspaceSymbol 은 location 이 `{uri}` 만일 수도 있다 (range 없음).
            let location = item.get("location")?;
            let uri = location.get("uri").and_then(Value::as_str)?;
            let start = location.get("range").and_then(|r| r.get("start"));
            let path = super::registry::uri_to_path(uri)?;
            let rel = path
                .strip_prefix(project_root)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
            let display = rel.clone().unwrap_or_else(|| {
                path.file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| uri.to_string())
            });
            Some(LspWorkspaceSymbol {
                name: name.to_string(),
                kind: symbol_kind_name(item.get("kind").and_then(Value::as_u64).unwrap_or(0)),
                container: item
                    .get("containerName")
                    .and_then(Value::as_str)
                    .filter(|c| !c.is_empty())
                    .map(str::to_string),
                path: rel,
                display,
                line: start
                    .and_then(|s| s.get("line"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32,
                character: start
                    .and_then(|s| s.get("character"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32,
            })
        })
        .take(limit)
        .collect()
}

/// `textDocument/signatureHelp` → 좁은 타입.
///
/// 인자 라벨은 문자열이거나 `[start, end]` 오프셋 쌍이다. 문자열이면 시그니처
/// 라벨 안에서 **찾아** 구간으로 바꾼다 — 프런트가 강조할 수 있으려면 어느
/// 쪽이든 구간이어야 하고, 이 변환을 두 군데서 하면 곧 어긋난다.
pub fn signature_help_from_json(result: &Value) -> Option<LspSignatureHelp> {
    let Value::Array(sigs) = result.get("signatures")? else {
        return None;
    };
    if sigs.is_empty() {
        return None;
    }
    let signatures: Vec<LspSignature> = sigs
        .iter()
        .map(|sig| {
            let label = sig
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let parameters = match sig.get("parameters") {
                Some(Value::Array(params)) => params
                    .iter()
                    .filter_map(|p| param_span(p.get("label")?, &label))
                    .collect(),
                _ => Vec::new(),
            };
            LspSignature {
                label,
                documentation: doc_string(sig.get("documentation")),
                parameters,
            }
        })
        .collect();
    Some(LspSignatureHelp {
        active_signature: result
            .get("activeSignature")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        active_parameter: result
            .get("activeParameter")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        signatures,
    })
}

/// 인자 라벨(문자열 또는 오프셋 쌍) → 라벨 안의 UTF-16 구간.
fn param_span(raw: &Value, signature_label: &str) -> Option<LspParamSpan> {
    if let Value::Array(pair) = raw {
        let start = pair.first()?.as_u64()? as u32;
        let end = pair.get(1)?.as_u64()? as u32;
        return (end > start).then_some(LspParamSpan { start, end });
    }
    let needle = raw.as_str()?;
    if needle.is_empty() {
        return None;
    }
    // 바이트 인덱스로 찾은 뒤 UTF-16 오프셋으로 옮긴다 — 라벨에 한글·이모지가
    // 있으면 둘이 다르고, 프런트(JS 문자열)는 UTF-16 으로 자른다.
    let byte_at = signature_label.find(needle)?;
    let start = signature_label[..byte_at].encode_utf16().count() as u32;
    Some(LspParamSpan {
        start,
        end: start + needle.encode_utf16().count() as u32,
    })
}

/// `string | MarkupContent | MarkedString[]` → 평문/마크다운 문자열.
fn doc_string(raw: Option<&Value>) -> Option<String> {
    let raw = raw?;
    let text = match raw {
        Value::String(s) => s.clone(),
        Value::Object(_) => raw.get("value").and_then(Value::as_str)?.to_string(),
        _ => return None,
    };
    (!text.trim().is_empty()).then_some(text)
}

/// 길이 제한 — **문자 단위**로 자른다 (바이트로 자르면 한글 중간에서 깨진다).
fn clip(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect::<String>() + "…"
}

/// LSP `SymbolKind` (1-26) → 사람이 읽는 이름. 아웃라인 아이콘·색의 근거.
fn symbol_kind_name(kind: u64) -> String {
    match kind {
        1 => "file",
        2 => "module",
        3 => "namespace",
        4 => "package",
        5 => "class",
        6 => "method",
        7 => "property",
        8 => "field",
        9 => "constructor",
        10 => "enum",
        11 => "interface",
        12 => "function",
        13 => "variable",
        14 => "constant",
        15 => "string",
        16 => "number",
        17 => "boolean",
        18 => "array",
        19 => "object",
        20 => "key",
        21 => "null",
        22 => "enum-member",
        23 => "struct",
        24 => "event",
        25 => "operator",
        26 => "type-parameter",
        _ => "symbol",
    }
    .to_string()
}

/// LSP `CompletionItemKind` (1-25) → CM6 가 아는 이름.
fn completion_kind_name(kind: u64) -> String {
    match kind {
        2 | 3 => "function",
        4 => "class",    // Constructor
        5 => "property", // Field
        6 => "variable",
        7 | 22 => "class", // Class · Struct
        8 => "interface",
        9 => "namespace",
        10 => "property",
        11 | 12 => "constant", // Unit · Value
        13 => "enum",
        14 => "keyword",
        15 => "text", // Snippet — 우리는 snippetSupport 를 끄므로 텍스트로 온다
        21 => "constant",
        23 => "type", // Event
        _ => "text",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ─── Phase 2 — 참조 · 아웃라인 · 워크스페이스 심볼 · 시그니처 ────────────

    #[test]
    fn references_group_by_file_and_carry_a_preview() {
        let raw = json!([
            { "uri": "file:///w/ai-pm/src/b.rs", "range": { "start": { "line": 2, "character": 4 } } },
            { "uri": "file:///w/ai-pm/src/a.rs", "range": { "start": { "line": 0, "character": 8 } } },
            { "uri": "file:///w/ai-pm/src/a.rs", "range": { "start": { "line": 5, "character": 1 } } },
            // 같은 자리가 두 번 와도 한 줄이다 (서버가 중복을 보낼 수 있다).
            { "uri": "file:///w/ai-pm/src/a.rs", "range": { "start": { "line": 0, "character": 8 } } },
        ]);
        let got = references_from_json(&raw, root(), |p| {
            if p.ends_with("a.rs") {
                Some(vec![
                    "    fn 대상() {}".to_string(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    "  대상();".to_string(),
                ])
            } else {
                None // 못 읽는 파일 — 자리는 남고 미리보기만 빈다
            }
        });

        // 파일 경로로 정렬돼 목록이 안정적이다.
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].path.as_deref(), Some("src/a.rs"));
        assert_eq!(got[1].path.as_deref(), Some("src/b.rs"));
        assert_eq!(got[0].hits.len(), 2, "중복 제거");
        assert_eq!(got[0].hits[0].line, 0);
        assert_eq!(got[0].hits[0].preview, "fn 대상() {}", "앞뒤 공백은 떼고");
        assert_eq!(got[0].hits[1].preview, "대상();");
        assert_eq!(got[1].hits[0].preview, "", "못 읽어도 자리는 남는다");
    }

    #[test]
    fn references_outside_the_project_keep_a_display_name() {
        let raw = json!([
            { "uri": "file:///elsewhere/dep/lib.rs", "range": { "start": { "line": 9, "character": 0 } } },
        ]);
        let got = references_from_json(&raw, root(), |_| None);
        assert_eq!(got.len(), 1);
        assert!(got[0].path.is_none(), "열 수 없는 파일은 path 가 없다");
        assert_eq!(got[0].display, "lib.rs", "그래도 어디인지는 말한다");
    }

    #[test]
    fn document_symbols_flatten_the_hierarchy_with_depth() {
        let raw = json!([{
            "name": "Widget",
            "kind": 23,
            "range": { "start": { "line": 10, "character": 0 } },
            "selectionRange": { "start": { "line": 10, "character": 7 } },
            "children": [{
                "name": "draw",
                "detail": "fn(&self)",
                "kind": 6,
                "selectionRange": { "start": { "line": 12, "character": 7 } },
                "children": [],
            }],
        }]);
        let got = document_symbols_from_json(&raw);
        assert_eq!(got.len(), 2);
        assert_eq!(
            (got[0].name.as_str(), got[0].depth, got[0].kind.as_str()),
            ("Widget", 0, "struct")
        );
        // selectionRange 를 쓴다 — range 를 쓰면 커서가 블록 맨 위 빈 줄에 떨어진다.
        assert_eq!(got[0].character, 7);
        assert_eq!(
            (got[1].name.as_str(), got[1].depth, got[1].kind.as_str()),
            ("draw", 1, "method")
        );
        assert_eq!(got[1].detail.as_deref(), Some("fn(&self)"));
    }

    #[test]
    fn document_symbols_accept_the_flat_shape_too() {
        // SymbolInformation — children 이 없고 위치가 location.range 안에 있다.
        let raw = json!([{
            "name": "main",
            "kind": 12,
            "location": { "uri": "file:///w/ai-pm/src/main.rs", "range": { "start": { "line": 3, "character": 3 } } },
        }]);
        let got = document_symbols_from_json(&raw);
        assert_eq!(got.len(), 1);
        assert_eq!(
            (got[0].kind.as_str(), got[0].depth, got[0].line),
            ("function", 0, 3)
        );
    }

    #[test]
    fn workspace_symbols_keep_container_and_respect_the_limit() {
        let items: Vec<_> = (0..5)
            .map(|i| {
                json!({
                    "name": format!("sym{i}"),
                    "kind": 12,
                    "containerName": "mod_a",
                    "location": { "uri": "file:///w/ai-pm/src/a.rs", "range": { "start": { "line": i, "character": 0 } } },
                })
            })
            .collect();
        let got = workspace_symbols_from_json(&json!(items), root(), 3);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].container.as_deref(), Some("mod_a"));
        assert_eq!(got[0].path.as_deref(), Some("src/a.rs"));
    }

    #[test]
    fn signature_help_turns_string_labels_into_spans() {
        let raw = json!({
            "signatures": [{
                "label": "fn 더하기(왼쪽: i32, 오른쪽: i32) -> i32",
                "documentation": { "kind": "markdown", "value": "둘을 더한다" },
                "parameters": [{ "label": "왼쪽: i32" }, { "label": "오른쪽: i32" }],
            }],
            "activeSignature": 0,
            "activeParameter": 1,
        });
        let got = signature_help_from_json(&raw).unwrap();
        assert_eq!(got.active_parameter, 1);
        let sig = &got.signatures[0];
        assert_eq!(sig.documentation.as_deref(), Some("둘을 더한다"));
        // 구간은 **UTF-16** 오프셋이어야 한다 — 프런트(JS 문자열)가 그 단위로
        // 자른다. 바이트로 주면 한글이 든 라벨에서 강조가 어긋난다.
        let utf16: Vec<u16> = sig.label.encode_utf16().collect();
        let slice_of = |s: &LspParamSpan| {
            String::from_utf16(&utf16[s.start as usize..s.end as usize]).unwrap()
        };
        assert_eq!(slice_of(&sig.parameters[0]), "왼쪽: i32");
        assert_eq!(slice_of(&sig.parameters[1]), "오른쪽: i32");
    }

    #[test]
    fn signature_help_accepts_offset_pair_labels() {
        let raw = json!({
            "signatures": [{ "label": "add(a, b)", "parameters": [{ "label": [4, 5] }, { "label": [7, 8] }] }],
        });
        let got = signature_help_from_json(&raw).unwrap();
        assert_eq!(got.signatures[0].parameters[0].start, 4);
        assert_eq!(got.signatures[0].parameters[1].end, 8);
        // 필드가 없으면 0 으로 — 첫 시그니처·첫 인자.
        assert_eq!((got.active_signature, got.active_parameter), (0, 0));
    }

    #[test]
    fn signature_help_is_none_when_there_is_nothing_to_show() {
        assert!(signature_help_from_json(&json!({ "signatures": [] })).is_none());
        assert!(signature_help_from_json(&json!(null)).is_none());
    }

    #[test]
    fn preview_clipping_counts_characters_not_bytes() {
        // 바이트로 자르면 한글 중간에서 깨진다.
        assert_eq!(clip("가나다라", 2), "가나…");
        assert_eq!(clip("짧다", 10), "짧다");
    }

    #[test]
    fn reads_a_rust_analyzer_diagnostic_verbatim() {
        let raw = json!([{
            "range": { "start": { "line": 41, "character": 8 }, "end": { "line": 41, "character": 19 } },
            "severity": 1,
            "source": "rustc",
            "message": "cannot find value `foo` in this scope",
        }]);
        let got = diagnostics_from_json(&raw);
        assert_eq!(got.len(), 1);
        let d = &got[0];
        // 0-based 그대로 — 여기서 +1 하면 프런트에서 또 해서 두 줄 밀린다.
        assert_eq!((d.start_line, d.start_character), (41, 8));
        assert_eq!((d.end_line, d.end_character), (41, 19));
        assert_eq!(d.severity, LspSeverity::Error);
        assert_eq!(d.source.as_deref(), Some("rustc"));
    }

    #[test]
    fn severity_maps_all_four_and_defaults_to_warning() {
        let mk = |sev: Value| {
            json!([{ "range": { "start": {"line":0,"character":0}, "end": {"line":0,"character":1} },
                     "severity": sev, "message": "m" }])
        };
        for (sev, want) in [
            (json!(1), LspSeverity::Error),
            (json!(2), LspSeverity::Warning),
            (json!(3), LspSeverity::Info),
            (json!(4), LspSeverity::Hint),
        ] {
            assert_eq!(diagnostics_from_json(&mk(sev)).remove(0).severity, want);
        }
        // 미지정 — 오류로 올리면 없는 빨간 줄이, 힌트로 내리면 진짜 문제가 묻힌다.
        assert_eq!(
            diagnostics_from_json(&mk(json!(null))).remove(0).severity,
            LspSeverity::Warning
        );
    }

    /// 한 항목이 망가졌다고 그 파일의 진단 전체를 잃으면 안 된다.
    #[test]
    fn drops_unreadable_items_but_keeps_the_rest() {
        let raw = json!([
            { "message": "range 가 없다" },
            { "range": { "start": {"line":1,"character":0}, "end": {"line":1,"character":2} }, "message": "정상" },
            { "range": { "start": {"line":2,"character":0}, "end": {"line":2,"character":2} } },
        ]);
        let got = diagnostics_from_json(&raw);
        assert_eq!(got.len(), 1, "정상 항목 하나만 남아야 한다");
        assert_eq!(got[0].message, "정상");
    }

    #[test]
    fn diagnostics_tolerates_non_array_input() {
        assert!(diagnostics_from_json(&json!(null)).is_empty());
        assert!(diagnostics_from_json(&json!({})).is_empty());
    }

    /// 서버는 배열이나 `{isIncomplete, items}` 둘 중 하나로 준다.
    #[test]
    fn completions_accept_both_response_shapes() {
        let bare = json!([{ "label": "push", "kind": 2 }]);
        let wrapped = json!({ "isIncomplete": true, "items": [{ "label": "push", "kind": 2 }] });
        for r in [bare, wrapped] {
            let got = completions_from_json(&r, 50);
            assert_eq!(got.len(), 1);
            assert_eq!(got[0].label, "push");
            assert_eq!(got[0].kind.as_deref(), Some("function"));
        }
    }

    /// rust-analyzer 는 detail 대신 labelDetails.description 을 쓰기도 한다.
    #[test]
    fn detail_falls_back_to_label_details() {
        let r =
            json!([{ "label": "len", "labelDetails": { "description": "fn(&self) -> usize" } }]);
        assert_eq!(
            completions_from_json(&r, 50)[0].detail.as_deref(),
            Some("fn(&self) -> usize")
        );
    }

    /// textEdit 이 있으면 그쪽이 정답 — insertText 보다 강하다.
    #[test]
    fn text_edit_beats_insert_text() {
        let r = json!([{
            "label": "foo",
            "insertText": "foo_insert",
            "textEdit": { "newText": "foo_edit", "range": { "start": {"line":0,"character":0}, "end": {"line":0,"character":3} } },
        }]);
        assert_eq!(
            completions_from_json(&r, 50)[0].insert_text.as_deref(),
            Some("foo_edit")
        );
    }

    /// 완성 목록은 수천 개가 온다 — 상한이 없으면 IPC 로 그대로 넘어간다.
    #[test]
    fn completions_respect_the_limit() {
        let items: Vec<Value> = (0..500)
            .map(|i| json!({ "label": format!("i{i}") }))
            .collect();
        assert_eq!(completions_from_json(&json!(items), 100).len(), 100);
    }

    // ── 호버 ────────────────────────────────────────────────────────────────

    #[test]
    fn hover_reads_all_three_content_shapes() {
        // MarkupContent — 요즘 서버 대부분.
        let markup = json!({ "contents": { "kind": "markdown", "value": "fn len() -> usize" } });
        assert_eq!(
            hover_from_json(&markup).unwrap().contents,
            "fn len() -> usize"
        );

        // 구형 MarkedString(문자열).
        let bare = json!({ "contents": "그냥 텍스트" });
        assert_eq!(hover_from_json(&bare).unwrap().contents, "그냥 텍스트");

        // 구형 MarkedString{language,value} — 코드이므로 펜스를 씌운다.
        let coded = json!({ "contents": { "language": "rust", "value": "struct Foo;" } });
        assert_eq!(
            hover_from_json(&coded).unwrap().contents,
            "```rust\nstruct Foo;\n```"
        );
    }

    /// rust-analyzer 는 배열로 준다 — 시그니처 블록 + 문서를 이어 붙여야 한다.
    #[test]
    fn hover_joins_array_parts() {
        let arr = json!({ "contents": [
            { "language": "rust", "value": "fn push(&mut self, v: T)" },
            "벡터 끝에 밀어 넣는다.",
        ]});
        let got = hover_from_json(&arr).unwrap().contents;
        assert!(got.contains("```rust\nfn push"), "{got}");
        assert!(got.contains("벡터 끝에"), "{got}");
    }

    #[test]
    fn hover_is_none_when_there_is_nothing_to_show() {
        assert!(hover_from_json(&json!(null)).is_none());
        assert!(hover_from_json(&json!({})).is_none());
        // 빈 값은 없는 것과 같다 — 빈 툴팁이 뜨면 안 된다.
        assert!(hover_from_json(&json!({ "contents": "   " })).is_none());
        assert!(hover_from_json(&json!({ "contents": [] })).is_none());
    }

    // ── 코드 액션 ───────────────────────────────────────────────────────────

    #[test]
    fn keeps_actions_we_can_actually_apply() {
        let r = json!([
            { "title": "가져오기 추가", "kind": "quickfix", "edit": { "changes": {} }, "isPreferred": true },
            { "title": "나중에 채울 것", "kind": "refactor", "data": { "id": 7 } },
        ]);
        let (actions, raw) = code_actions_from_json(&r);
        assert_eq!(actions.len(), 2);
        assert_eq!(raw.len(), 2);
        assert_eq!(actions[0].title, "가져오기 추가");
        assert_eq!(actions[0].kind.as_deref(), Some("quickfix"));
        assert!(actions[0].preferred);
        // data 만 있는 것도 정상 — codeAction/resolve 로 채운다.
        assert!(!actions[1].preferred);
        // 인덱스가 raw 배열의 자리와 일치해야 적용이 맞는 액션을 집는다.
        assert_eq!(actions[1].index, 1);
    }

    /// `command` 만 있는 항목은 `workspace/executeCommand` → 서버가 되보내는
    /// `workspace/applyEdit` 요청 경로가 필요한데 아직 없다. 눌러도 아무 일
    /// 없는 항목을 보여주느니 목록에서 뺀다.
    #[test]
    fn drops_command_only_actions_that_would_do_nothing() {
        let r = json!([
            { "title": "서버가 직접 실행", "command": { "command": "rust-analyzer.run", "arguments": [] } },
            { "title": "적용 가능", "edit": { "changes": {} } },
        ]);
        let (actions, raw) = code_actions_from_json(&r);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].title, "적용 가능");
        // 인덱스는 **남은 것 기준**이어야 한다 — 원본 배열 자리를 쓰면
        // 적용 때 엉뚱한(걸러낸) 액션을 집는다.
        assert_eq!(actions[0].index, 0);
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0]["title"], "적용 가능");
    }

    #[test]
    fn code_actions_tolerate_empty_and_malformed_responses() {
        for r in [
            json!(null),
            json!([]),
            json!({}),
            json!([{ "kind": "quickfix" }]),
        ] {
            let (actions, raw) = code_actions_from_json(&r);
            assert!(actions.is_empty(), "{r}");
            assert!(raw.is_empty());
        }
    }

    // ── 정의로 이동 ─────────────────────────────────────────────────────────

    fn root() -> &'static std::path::Path {
        std::path::Path::new("/w/ai-pm")
    }

    #[test]
    fn definition_reads_location_and_array_and_link_shapes() {
        let range = json!({ "start": { "line": 41, "character": 7 }, "end": { "line": 41, "character": 10 } });

        let single = json!({ "uri": "file:///w/ai-pm/src/a.rs", "range": range });
        let array = json!([{ "uri": "file:///w/ai-pm/src/a.rs", "range": range }]);
        let link = json!([{
            "targetUri": "file:///w/ai-pm/src/a.rs",
            "targetSelectionRange": range,
            "targetRange": { "start": { "line": 38, "character": 0 }, "end": { "line": 50, "character": 1 } },
        }]);

        for r in [single, array, link] {
            let got = definition_from_json(&r, root()).unwrap();
            assert_eq!(got.path.as_deref(), Some("src/a.rs"));
            assert_eq!(got.display, "src/a.rs");
            // targetSelectionRange(심볼 이름)가 targetRange(정의 블록 전체)를
            // 이겨야 한다 — 아니면 커서가 함수 맨 위 빈 줄에 떨어진다.
            assert_eq!((got.line, got.character), (41, 7));
        }
    }

    /// 표준 라이브러리·의존성으로 가는 정의 — 코드 화면이 열 수 없다.
    /// 조용히 무시하지 않고 어디로 가려 했는지 말할 수 있게 한다.
    #[test]
    fn definition_outside_the_project_keeps_a_display_name() {
        let r = json!({
            "uri": "file:///Users/x/.rustup/toolchains/stable/lib/rustlib/src/rust/library/core/src/option.rs",
            "range": { "start": { "line": 100, "character": 0 }, "end": { "line": 100, "character": 5 } },
        });
        let got = definition_from_json(&r, root()).unwrap();
        assert!(got.path.is_none(), "프로젝트 밖인데 열 수 있는 경로를 줬다");
        assert_eq!(got.display, "option.rs");
        assert_eq!(got.line, 100);
    }

    #[test]
    fn definition_is_none_when_the_server_found_nothing() {
        assert!(definition_from_json(&json!(null), root()).is_none());
        assert!(definition_from_json(&json!([]), root()).is_none());
        // range 가 없는 항목은 이동할 자리가 없다.
        assert!(definition_from_json(&json!({ "uri": "file:///w/ai-pm/a.rs" }), root()).is_none());
    }

    #[test]
    fn completion_without_a_label_is_dropped() {
        let r = json!([{ "kind": 2 }, { "label": "ok" }]);
        let got = completions_from_json(&r, 50);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].label, "ok");
    }
}

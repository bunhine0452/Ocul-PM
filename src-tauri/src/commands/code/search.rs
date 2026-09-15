//! 전역 검색 · 치환 (VS Code 검색 사이드바의 백엔드).
//!
//! 트리와 같은 시야로 디스크를 직접 읽고, 좌표는 CodeMirror 가 쓰는 **UTF-16
//! 단위**로 넘긴다. 치환은 줄 종결자를 보존하고 `read_write::write_with_lock`
//! 을 그대로 타서 원자적이다.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::guards::canonical_within_root;
use super::project_root;
use super::read_write::{looks_binary, write_with_lock, CodeWriteOutcome, MAX_EDIT_BYTES};
use crate::commands::fsutil::natural_cmp;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 전역 검색의 총 매치 상한. 이보다 많으면 `truncated` — 그 크기의 결과 목록은
/// 훑는 물건이 아니라 좁히라는 신호다 (VS Code 도 같은 이유로 잘라 알린다).
const MAX_SEARCH_HITS: usize = 2_000;

/// 미리보기 창 — 매치 앞뒤로 남기는 글자 수. 사이드바 폭에서 의미 있는 문맥은
/// 앞 몇십 자뿐이고, 뒤는 CSS 말줄임이 알아서 자른다.
const PREVIEW_BEFORE_CHARS: usize = 40;
const PREVIEW_AFTER_CHARS: usize = 200;

/// 전역 검색의 매치 하나. `col`/`len` 은 **UTF-16 단위** — CodeMirror 의 문서
/// 오프셋과 JS 문자열 인덱스가 그 단위라, 여기서 변환해 주면 프런트는 그대로
/// 선택 범위로 쓴다 (바이트 오프셋을 넘기면 한글에서 어긋난다).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchHit {
    /// 1-based 줄 번호.
    pub line: u32,
    /// 줄 안 매치 시작 (UTF-16, 0-based).
    pub col: u32,
    /// 매치 길이 (UTF-16).
    pub len: u32,
    /// 매치 주변 한 줄 미리보기 — 들여쓰기와 먼 앞부분은 잘라 낸다.
    pub preview: String,
    /// `preview` 안에서의 매치 시작 (UTF-16) — 목록의 하이라이트용.
    pub preview_col: u32,
}

/// 한 파일의 매치 묶음. `path` 는 다른 code_* 커맨드와 같은 루트 기준 슬래시 경로.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchFile {
    pub path: String,
    pub hits: Vec<CodeSearchHit>,
}

/// `code_search` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchResult {
    pub files: Vec<CodeSearchFile>,
    pub total_hits: u32,
    /// [`MAX_SEARCH_HITS`] 상한에 걸려 잘렸다 — UI 가 "더 좁혀라" 로 알린다.
    pub truncated: bool,
}

/// 한 매치만 바꿀 때의 좌표 — `code_search` 가 준 그 좌표를 그대로 되돌려 받는다.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct CodeReplaceTarget {
    pub path: String,
    /// 1-based 줄 번호.
    pub line: u32,
    /// 줄 안 매치 시작 (UTF-16, 0-based).
    pub col: u32,
}

/// `code_search_replace` 결과. 파일 단위 실패는 전체를 멈추지 않고 `errors` 로
/// 모은다 — 100개 파일 중 1개가 그 사이 바뀌었다고 99개를 포기할 이유가 없다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeReplaceOutcome {
    pub files_changed: u32,
    pub hits_replaced: u32,
    pub errors: Vec<String>,
}

/// 프로젝트 전역 텍스트 검색 (VS Code 검색 사이드바의 백엔드).
///
/// 시야는 [`code_tree`] 와 같다: gitignore 존중 + 숨김 파일 포함 + `.git` 제외.
/// 트리에 보이는 것만 검색된다 — 두 창구의 시야가 어긋나면 "트리에 없는 파일이
/// 검색에 나온다" 류의 혼란이 생긴다. SQLite 인덱스를 쓰는 의미/정확 검색과
/// 달리 **디스크를 직접 읽는다** — 인덱싱 여부·신선도와 무관하게 지금 상태다.
#[tauri::command]
#[specta::specta]
pub async fn code_search(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<CodeSearchResult, String> {
    if query.is_empty() {
        return Ok(CodeSearchResult {
            files: Vec::new(),
            total_hits: 0,
            truncated: false,
        });
    }
    let re = build_search_regex(&query, case_sensitive, whole_word, is_regex)?;
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || search_project(&root, &re, MAX_SEARCH_HITS))
        .await
        .map_err(|e| format!("Failed to search the project: {e}"))
}

/// 검색 조건과 같은 패턴으로 파일들 안의 매치를 치환한다.
///
/// `target` 이 있으면 **그 한 매치만** (paths 는 무시), 없으면 `paths` 의 모든
/// 매치를 바꾼다. 매치는 디스크의 **지금 내용**에서 다시 찾는다 — 검색 결과가
/// 낡았어도 "지금 매치되는 것을 바꾼다" 는 계약은 깨지지 않는다. 쓰기는
/// [`write_with_lock`] 을 그대로 타서 원자적이고, 치환 도중 파일이 또 바뀌면
/// 그 파일만 오류로 모은다.
///
/// 정규식 모드에서는 치환문의 `$1`/`${name}` 그룹 참조를 펼치고, 일반 모드에서는
/// 문자 그대로 넣는다 (VS Code 와 같은 규칙).
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn code_search_replace(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    replacement: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
    paths: Vec<String>,
    target: Option<CodeReplaceTarget>,
) -> Result<CodeReplaceOutcome, String> {
    if query.is_empty() {
        return Ok(CodeReplaceOutcome {
            files_changed: 0,
            hits_replaced: 0,
            errors: Vec::new(),
        });
    }
    let re = build_search_regex(&query, case_sensitive, whole_word, is_regex)?;
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let scope: Vec<(String, Option<(u32, u32)>)> = match &target {
            Some(t) => vec![(t.path.clone(), Some((t.line, t.col)))],
            None => paths.into_iter().map(|p| (p, None)).collect(),
        };
        let mut files_changed = 0u32;
        let mut hits_replaced = 0u32;
        let mut errors = Vec::new();
        for (rel, at) in scope {
            match replace_in_file(&root, &rel, &re, &replacement, is_regex, at) {
                Ok(0) => {}
                Ok(n) => {
                    files_changed += 1;
                    hits_replaced += n;
                }
                Err(e) => errors.push(format!("{rel}: {e}")),
            }
        }
        Ok(CodeReplaceOutcome {
            files_changed,
            hits_replaced,
            errors,
        })
    })
    .await
    .map_err(|e| format!("Failed to replace: {e}"))?
}

/// 검색 조건 → 정규식. 일반 모드는 통째로 이스케이프하고, 단어 단위는
/// `\b(?:…)\b` 로 감싼다 — 비캡처 그룹이라 정규식 모드의 `$1` 번호가 밀리지
/// 않는다. regex 크레이트는 선형 시간이라 사용자 패턴으로 역추적 폭발이 없다.
pub(super) fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<regex::Regex, String> {
    let base = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid pattern: {e}"))
}

pub(super) fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// UTF-16 열 → 바이트 오프셋. 좌표가 문자 경계와 안 맞으면(그 사이 파일이
/// 바뀌었으면) None — 엉뚱한 자리를 바꾸는 것보다 그 매치를 포기하는 쪽이 옳다.
fn utf16_col_to_byte(line: &str, col: u32) -> Option<usize> {
    if col == 0 {
        return Some(0);
    }
    let mut units = 0u32;
    for (i, ch) in line.char_indices() {
        if units == col {
            return Some(i);
        }
        units += ch.len_utf16() as u32;
    }
    (units == col).then_some(line.len())
}

/// 매치 하나 → 좌표 + 미리보기. 들여쓰기는 잘라 내되 매치 자체는 항상 창 안에
/// 온전히 남긴다 (창 상한은 글자 수 기준이라 UTF-8 경계가 깨질 일이 없다).
fn make_hit(line_no: u32, line: &str, mstart: usize, mend: usize) -> CodeSearchHit {
    let indent = line.len() - line.trim_start().len();
    let vis_start = indent.min(mstart);
    let win_start = line[vis_start..mstart]
        .char_indices()
        .rev()
        .nth(PREVIEW_BEFORE_CHARS - 1)
        .map(|(i, _)| vis_start + i)
        .unwrap_or(vis_start);
    let win_end = line[mend..]
        .char_indices()
        .nth(PREVIEW_AFTER_CHARS)
        .map(|(i, _)| mend + i)
        .unwrap_or(line.len());
    CodeSearchHit {
        line: line_no,
        col: utf16_len(&line[..mstart]),
        len: utf16_len(&line[mstart..mend]),
        preview: line[win_start..win_end].to_string(),
        preview_col: utf16_len(&line[win_start..mstart]),
    }
}

/// 한 파일 본문의 매치들. 줄 단위로 찾는다 — `^`/`$` 가 자연스럽게 줄 경계가
/// 되고, 패턴이 줄을 넘을 수 없다는 것이 검색·치환 양쪽의 공통 계약이다.
/// 빈 매치(`a*` 류)는 버린다 — 글자 사이마다 잡히는 결과는 목록으로서 무의미하다.
pub(super) fn search_content(
    re: &regex::Regex,
    content: &str,
    budget: usize,
) -> (Vec<CodeSearchHit>, bool) {
    let mut hits = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            if hits.len() >= budget {
                return (hits, true);
            }
            hits.push(make_hit(idx as u32 + 1, line, m.start(), m.end()));
        }
    }
    (hits, false)
}

/// 트리와 같은 시야로 걷는 전역 검색. 에디터가 못 여는 파일(바이너리·2MB 초과·
/// 비 UTF-8)은 건너뛴다 — 결과를 눌러도 열 수 없는 매치는 목록에 둘 이유가 없다.
pub(super) fn search_project(root: &Path, re: &regex::Regex, max_hits: usize) -> CodeSearchResult {
    let mut files: Vec<CodeSearchFile> = Vec::new();
    let mut total: usize = 0;
    let mut truncated = false;
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
    {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > MAX_EDIT_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if looks_binary(&bytes) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let (hits, over) = search_content(re, &content, max_hits - total);
        if !hits.is_empty() {
            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            total += hits.len();
            files.push(CodeSearchFile {
                path: rel.to_string_lossy().replace('\\', "/"),
                hits,
            });
        }
        if over {
            truncated = true;
            break;
        }
    }
    files.sort_by(|a, b| natural_cmp(&a.path, &b.path));
    CodeSearchResult {
        files,
        total_hits: total as u32,
        truncated,
    }
}

/// 한 줄 안의 치환. `only_at` 이 있으면 그 바이트에서 시작하는 매치만 바꾼다.
/// 빈 매치는 검색과 같은 이유로 건너뛴다. 바뀐 것이 없으면 None.
fn replace_line(
    re: &regex::Regex,
    line: &str,
    replacement: &str,
    expand: bool,
    only_at: Option<usize>,
) -> Option<(String, u32)> {
    let mut out = String::with_capacity(line.len());
    let mut last = 0usize;
    let mut count = 0u32;
    for caps in re.captures_iter(line) {
        let m = caps.get(0).expect("group 0 always exists");
        if m.start() == m.end() {
            continue;
        }
        if only_at.is_some_and(|b| b != m.start()) {
            continue;
        }
        out.push_str(&line[last..m.start()]);
        if expand {
            caps.expand(replacement, &mut out);
        } else {
            out.push_str(replacement);
        }
        last = m.end();
        count += 1;
    }
    if count == 0 {
        return None;
    }
    out.push_str(&line[last..]);
    Some((out, count))
}

/// 본문 전체의 치환 — 줄 종결자(`\n`/`\r\n`·마지막 줄의 부재)를 **그대로 보존**
/// 한다. 줄로 갈랐다 다시 합치는 방식은 CRLF 파일을 통째로 LF 로 만드는 회귀가
/// 있어, 종결자를 본문에서 떼어 두었다가 그대로 되붙인다.
pub(super) fn replace_in_content(
    content: &str,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    target: Option<(u32, u32)>,
) -> Option<(String, u32)> {
    let mut out = String::with_capacity(content.len());
    let mut total = 0u32;
    for (idx, raw) in content.split_inclusive('\n').enumerate() {
        let line_no = idx as u32 + 1;
        let body_len = raw.len()
            - if raw.ends_with("\r\n") {
                2
            } else {
                usize::from(raw.ends_with('\n'))
            };
        let (body, term) = raw.split_at(body_len);
        let only_at = match target {
            Some((l, _)) if l != line_no => {
                out.push_str(raw);
                continue;
            }
            Some((_, col)) => match utf16_col_to_byte(body, col) {
                Some(b) => Some(b),
                None => {
                    out.push_str(raw);
                    continue;
                }
            },
            None => None,
        };
        match replace_line(re, body, replacement, expand, only_at) {
            Some((new_body, n)) => {
                total += n;
                out.push_str(&new_body);
                out.push_str(term);
            }
            None => out.push_str(raw),
        }
    }
    if total == 0 {
        None
    } else {
        Some((out, total))
    }
}

/// 파일 하나의 치환 — 읽기와 같은 경로 가드를 지나 [`write_with_lock`] 으로
/// 원자적으로 쓴다. 바꿀 매치가 없으면 0 (오류가 아니다 — 검색 후 파일이
/// 바뀌었을 수 있고, 그때 "지금은 매치가 없다" 는 정답이다).
pub(super) fn replace_in_file(
    root: &Path,
    rel: &str,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    target: Option<(u32, u32)>,
) -> Result<u32, String> {
    let full = secure_join(root, rel)?;
    let full = canonical_within_root(root, &full)?;
    let meta = std::fs::metadata(&full).map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Err("File is too large to edit".to_string());
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("Failed to read file: {e}"))?;
    if looks_binary(&bytes) {
        return Err("Binary file".to_string());
    }
    let base_hash = blake3::hash(&bytes).to_hex().to_string();
    let content = String::from_utf8(bytes).map_err(|_| "Not a UTF-8 text file".to_string())?;
    let Some((new_content, count)) = replace_in_content(&content, re, replacement, expand, target)
    else {
        return Ok(0);
    };
    match write_with_lock(&full, &new_content, &base_hash)? {
        CodeWriteOutcome::Saved { .. } => Ok(count),
        CodeWriteOutcome::Conflict { .. } => {
            Err("File changed on disk during the replace".to_string())
        }
    }
}

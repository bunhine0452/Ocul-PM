//! 일지 **관련도 검색** ({#search-cache} · {#search-rank}).
//!
//! 프런트의 검색 화면이 지금까지 쓰던 `oculpm_search_entities` 는 제목만 보는
//! "go to anything" 점프대다. 일지 727건에서 "예전에 이거 왜 그랬지"를 묻는
//! 질문은 본문·태그·건드린 파일까지 봐야 답이 나오고, 그 판정은 MCP 도구
//! `journal_search` 가 이미 하고 있다.
//!
//! 그래서 이 커맨드는 **같은 캐시 조회 + 같은 랭킹 함수**를 부른다
//! (`oculpm::journal_search`). 화면과 에이전트가 같은 질의에 다른 답을 주면
//! 사용자는 둘 중 하나를 믿기를 그만둔다.
//!
//! MCP 쪽과 다른 점 하나: 여기서는 캐시가 **늘** 있다 (앱이 돌고 있으니까).
//! 디스크 폴백이 없는 대신, 행이 없으면 그냥 빈 결과다.

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::journal_search::alive::{gone_entries, gone_last};
use crate::oculpm::journal_search::cache::SqlFilters;
use crate::oculpm::journal_search::{rank, tokenize};

/// 인자를 안 주면 이만큼. MCP 도구의 기본 상한과 같은 값이다.
const DEFAULT_SEARCH_LIMIT: u32 = 20;
/// 한 번에 넘길 수 있는 최대.
const MAX_SEARCH_LIMIT: u32 = 200;

/// 프런트가 거르는 축. 전부 선택이고, 빈 값은 "제약 없음".
#[derive(Debug, Clone, Default, serde::Deserialize, specta::Type)]
pub struct JournalSearchFilters {
    /// `bug|feature|error|refactor|chore`.
    #[serde(default)]
    pub types: Vec<String>,
    /// `planned|in_progress|done|abandoned`.
    #[serde(default)]
    pub status: Vec<String>,
    /// 태그는 **전부** 가진 일지만 (AND).
    #[serde(default)]
    pub tags: Vec<String>,
    /// `files_touched` 경로의 부분 일치.
    #[serde(default)]
    pub file: Option<String>,
    /// `YYYYMMDD` 이상.
    #[serde(default)]
    pub since: Option<String>,
    /// `YYYYMMDD` 이하.
    #[serde(default)]
    pub until: Option<String>,
}

/// 히트 한 건.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct JournalSearchHit {
    pub relative_path: String,
    pub workday: String,
    /// `bug|feature|…`, 판정 불가면 `?`.
    pub entry_type: String,
    /// `planned|in_progress|…`, 판정 불가면 `?`.
    pub status: String,
    pub title: String,
    /// 본문 한 줄 발췌 — 본문 매치면 매치 근방, 아니면 앞머리.
    pub snippet: String,
    /// 어디서 걸렸는가: `title|tag|slug|path|body|filter`.
    pub matched_field: String,
    /// 사람이 읽는 매치 자리 (`title` · `tag:cache` · `path:src/…` · 발췌).
    pub why: String,
    /// 관련도 점수 — 정렬은 이미 되어 있고, 화면이 등급을 나눌 때 쓴다.
    pub score: f64,
}

/// 상한이 걸린 검색 결과.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct JournalSearchPage {
    pub hits: Vec<JournalSearchHit>,
    /// **상한을 걸기 전** 매치 건수. 상한이 있는데 그 사실이 안 보이면
    /// 사용자는 "전부 보고 있다"고 읽는다 (`oculpm_list_journal_entries_page`
    /// 와 같은 계약).
    pub total: u32,
}

/// 일지를 관련도순으로 찾는다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_search_journal(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    filters: Option<JournalSearchFilters>,
    limit: Option<u32>,
) -> Result<JournalSearchPage, AppError> {
    let filters = filters.unwrap_or_default();
    let limit = limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT) as usize;
    let sql = SqlFilters {
        types: filters.types,
        status: filters.status,
        tags: filters.tags.iter().map(|t| t.to_lowercase()).collect(),
        file: filters
            .file
            .as_deref()
            .map(|f| f.replace('\\', "/").to_lowercase())
            .filter(|f| !f.is_empty()),
        since: filters.since.filter(|s| !s.is_empty()),
        until: filters.until.filter(|s| !s.is_empty()),
    };
    let rows = JournalCache::new(&db).search_rows(project_id, sql).await?;
    let root = db.project_root(project_id).await?;
    // 에이전트의 `journal_search` 와 같은 순서 — 건드린 파일이 하나도 남지 않은 일지는 뒤로.
    let (scored, _gone) = gone_last(&root, rank(rows, &tokenize(Some(query.as_str()))));
    let total = scored.len() as u32;
    let hits = scored
        .iter()
        .take(limit)
        .map(|(hit, _alive)| JournalSearchHit {
            relative_path: hit.row.relative_path.clone(),
            workday: hit.row.workday.clone(),
            entry_type: hit.row.type_token.clone(),
            status: hit.row.status_token.clone(),
            title: hit.row.title.clone(),
            snippet: hit.snippet(),
            matched_field: hit.matched_field().to_string(),
            why: hit.why(),
            score: hit.score,
        })
        .collect();
    Ok(JournalSearchPage { hits, total })
}

/// 건드린 파일이 지금 프로젝트에 하나도 없는 일지의 경로 — 일지 화면이 한 줄로 접는다.
/// 일지는 지우지 않는다. 판정은 `journal_search::alive` (파일이 있는가, LLM 0 · git 0).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_gone_journals(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<String>, AppError> {
    let touches = JournalCache::new(&db).file_touches(project_id).await?;
    let root = db.project_root(project_id).await?;
    Ok(gone_entries(&root, touches))
}

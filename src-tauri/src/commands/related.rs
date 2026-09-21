//! 일지 사이의 **관련 후보** 커맨드 둘 (플랜 `journal-scale-round`
//! {#related-suggest} · {#related-ui}).
//!
//! `commands/oculpm.rs` 에 붙이지 않고 갈라 둔 이유는 `journal_page.rs` 와
//! 같다 — 그 파일은 이미 한계(800줄)를 넘어 래칫이 성장을 막고 있고, 여기
//! 있는 것은 "후보를 고르고 이어 준다"는 **하나의 계약**이다.
//!
//! 층 나눔: 점수는 순수 모듈(`oculpm::related`)이, 원재료 질의는 캐시
//! (`cache/related.rs`)가, 디스크 쓰기는 매니저(`manager::add_journal_related`)가
//! 한다. 여기는 셋을 잇기만 한다.

use std::path::PathBuf;

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::related::{
    suggest_related, RelatedSuggestion, SuggestInput, TargetEntry, DEFAULT_LIMIT, MAX_LIMIT,
};
use crate::oculpm::spec::JournalEntry;

/// 이 일지 옆에 두어야 할 과거 일지 후보.
///
/// **대상 일지는 디스크에서 읽는다.** 캐시가 아니라 원본이어야 하는 이유는
/// `related` 가 캐시에 없기 때문이다 (`cache/query.rs` 가 빈 배열로 투영한다)
/// — 이미 이어 둔 것을 빼려면 원본 프런트매터를 봐야 한다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_suggest_related(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
    limit: Option<u32>,
) -> Result<Vec<RelatedSuggestion>, AppError> {
    let abs: PathBuf = manager
        .resolve_journal_absolute(project_id, &relative_path)
        .await?;
    let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
        path: abs.clone(),
        source,
    })?;
    let (parsed, body) = parse_frontmatter_and_body(&text);
    let parsed_body = crate::oculpm::markdown::parse_body(&body);
    let target = TargetEntry {
        relative_path: relative_path.clone(),
        title: parsed_body.title,
        files: parsed
            .parsed
            .as_ref()
            .map(|fm| fm.files_touched.iter().map(|f| f.path.clone()).collect())
            .unwrap_or_default(),
        already_related: parsed
            .parsed
            .as_ref()
            .map(|fm| fm.related.iter().map(|r| r.ref_path.clone()).collect())
            .unwrap_or_default(),
    };

    let raw = crate::oculpm::cache::JournalCache::new(&db)
        .related_raw(project_id, &target.files)
        .await?;
    let input = SuggestInput {
        target,
        entries: raw.entries,
        file_rows: raw.file_rows,
        plan_refs: raw.plan_refs,
        total_entries: raw.total_entries,
    };
    let limit = limit
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_LIMIT)
        .min(MAX_LIMIT);
    Ok(suggest_related(&input, limit))
}

/// 후보 하나를 **디스크 원본**의 frontmatter `related` 에 더한다. 워처가
/// 그 변경을 보고 캐시를 갱신하지만, 화면이 왕복을 기다리지 않게 재투영된
/// 엔트리를 그대로 돌려준다 (`oculpm_coerce_entry_on_disk` 와 같은 계약).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_add_related(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    relative_path: String,
    related_ref: String,
    kind: String,
) -> Result<JournalEntry, AppError> {
    Ok(manager
        .add_journal_related(&db, project_id, relative_path, related_ref, kind)
        .await?)
}

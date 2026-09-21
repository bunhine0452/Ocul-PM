//! journal-scale-round {#tag-merge} — 「태그 정리」 시트의 데이터원.
//!
//! `commands/oculpm.rs` 에 붙이지 않고 갈라 둔 이유는 `related.rs` 와 같다 —
//! 그 파일은 이미 한계(800줄)를 넘어 래칫이 성장을 막고 있고, 여기 있는 것은
//! "프로젝트의 태그 어휘를 본다·모은다"는 **하나의 계약**이다.
//!
//! 층 나눔: 정규화·유사 판정은 순수 모듈(`oculpm::tags`)이, 원재료 질의는
//! 캐시(`cache/tags.rs`)가, 디스크 쓰기는 매니저(`manager::merge_journal_tags`)가
//! 한다. 여기는 셋을 잇고 **집계**만 한다.

use std::collections::HashMap;

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::cache::JournalCache;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::tags::{
    build_dictionary, is_source_marker, normalize_tag, suggest_similar, TagMergeReport, TagStat,
};

/// 이 프로젝트의 태그 어휘 — 빈도 내림차순, 동점은 사전순(결정적).
///
/// 출처 표식(`mcp-tool`)은 어휘가 아니라 기록 경로의 표식이라 뺀다
/// ({#tag-source-marker}). `suggest_into` 는 **사전에 없는** 태그에만 붙는다 —
/// 이미 사전에 오른 말은 모을 데가 아니라 모일 곳이다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_tag_stats(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<TagStat>, AppError> {
    let rows = JournalCache::new(&db).tag_rows(project_id).await?;

    // 정규화해서 접는다 — `Bug` 3건 + `bug` 2건은 「bug 5건」 한 줄이다.
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut last: HashMap<String, String> = HashMap::new();
    for (tag, _rel, workday) in rows {
        let norm = normalize_tag(&tag);
        if norm.is_empty() || is_source_marker(&norm) {
            continue;
        }
        *counts.entry(norm.clone()).or_insert(0) += 1;
        let slot = last.entry(norm).or_default();
        if workday > *slot {
            *slot = workday;
        }
    }

    let dictionary = build_dictionary(&counts);
    let mut out: Vec<TagStat> = counts
        .into_iter()
        .map(|(tag, count)| TagStat {
            suggest_into: suggest_similar(&tag, &dictionary).map(|(into, _)| into),
            last_workday: last.remove(&tag).unwrap_or_default(),
            tag,
            count,
        })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    Ok(out)
}

/// `from` 의 태그들을 `into` 하나로 모은다 — **디스크 원본**의 frontmatter 를
/// 다시 쓰고, 워처가 캐시를 재투영한다. 되돌리기는 없다 (git 이 그 길이다).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_tag_merge(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    from: Vec<String>,
    into: String,
) -> Result<TagMergeReport, AppError> {
    Ok(manager
        .merge_journal_tags(&db, project_id, from, into)
        .await?)
}

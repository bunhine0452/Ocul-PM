//! 일지 목록의 **상한 있는** 조회 (`{#journal-timeline-limit}`).
//!
//! `commands/oculpm.rs` 에 붙이지 않고 갈라 둔 이유는 둘이다. 그 파일은 이미
//! 1100줄로 한계(800)를 한참 넘어 래칫이 성장을 막고 있고, 여기 있는 것은
//! "일지 목록 한 쪽"이라는 **하나의 계약**이라 옮겨 두면 그 계약이 통째로
//! 눈에 들어온다.
//!
//! 계약: 상한을 걸되 **몇 건 중 몇 건인지 말한다.** 상한이 있는데 그 사실이
//! 안 보이면 사용자는 "전부 보고 있다"고 읽는다.

use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::cache::{EntryFilters, EntryPage};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::JournalEntrySummary;

/// 인자를 안 주면 이만큼. 하루 여러 건이 흔한 저장소에서 한 화면분을 넉넉히 덮는다.
const DEFAULT_ENTRY_PAGE: u32 = 200;
/// 한 번에 넘길 수 있는 최대 — 「더 보기」로 늘려 가는 상한이다. 상한을 두는
/// 커맨드가 상한 없는 값을 받으면 상한이 아니다.
const MAX_ENTRY_PAGE: u32 = 1000;

/// 상한이 걸린 일지 목록 한 쪽.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct JournalEntryPage {
    pub entries: Vec<JournalEntrySummary>,
    /// **상한을 걸기 전** 조건에 맞는 전체 건수. 화면이 "몇 건 중 몇 건"을
    /// 말하는 근거다 — 이 숫자가 없으면 상한은 있는데 안 보이는 상한이 된다.
    pub total: u32,
}

/// `oculpm_list_journal_entries` 의 상한 있는 판.
///
/// 기존 커맨드는 그대로 둔다 (호출자가 여럿이고, 상한이 필요 없는 자리도
/// 있다). 프런트의 **타임라인 목록 경로는 반드시 이쪽**이다: 검색창에 한
/// 글자만 쳐도 14일 창이 사라지면서 전 이력이 한 번에 넘어왔고, 가상화가 없는
/// 타임라인이 그만큼의 카드를 통째로 마운트했다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_list_journal_entries_page(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: Option<String>,
    filters: Option<EntryFilters>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<JournalEntryPage, AppError> {
    let page = EntryPage {
        limit: limit.unwrap_or(DEFAULT_ENTRY_PAGE).clamp(1, MAX_ENTRY_PAGE),
        offset: offset.unwrap_or(0),
    };
    let (entries, total) = manager
        .list_journal_entries_page(&db, project_id, workday, filters.unwrap_or_default(), page)
        .await
        .map_err(AppError::from)?;
    Ok(JournalEntryPage { entries, total })
}

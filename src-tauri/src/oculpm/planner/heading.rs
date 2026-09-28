//! `## ` 헤딩의 읽는 법 — 파서(`parse`)와 편집기(`plan_edit`)가 **같은 함수**를 쓴다.
//!
//! 둘이 따로 판정하던 동안 두 가지가 어긋났다 (L-FS3 발견):
//! - phase 이름 — 파서는 `{#id}` 앵커를 뗀 이름을 쓰는데 `add_item` 은 원문 헤딩과
//!   비교해서, `## P {#p}` 에 항목을 더하면 `## P` 섹션이 하나 더 생겼다
//!   (#plan-add-item-anchored-phase).
//! - 결정 섹션 — 파서는 이름 **전체**로, 편집기는 부분 문자열로 판정해서
//!   `move_phase` 가 「결정 반영」 같은 보통 phase 에서 이동 범위를 끊었다
//!   (#plan-decisions-heading-mismatch).

use crate::oculpm::planner::parse::extract_brace_id;

/// `## ` 뒤의 헤딩 본문을 (표시 이름, `{#id}`) 로 — 앵커를 떼고 다듬은 이름.
/// 앵커 자리는 [`crate::oculpm::planner::parse::anchor_span`] 이 정한다.
pub(crate) fn split_phase_heading(h: &str) -> (String, Option<String>) {
    let mut name = h.trim().to_string();
    let id = extract_brace_id(&mut name);
    (name.trim().to_string(), id)
}

/// Headings that open the `## 결정` section, matched as a **whole label**.
///
/// This used to be a substring test (`contains("결정") || contains("decision")`),
/// which swallowed any phase whose title merely mentioned the word: the real
/// plan heading `## Phase A — 기록의 결정론화 {#phase-a}` was classified as the
/// decisions section, so all 7 checklist items under it vanished from both the
/// Planner UI and the MCP `plan_status` (20 items on disk → 13 reported).
///
/// Anchoring the match inverts the failure mode. An unrecognised decisions
/// label now renders as a phase — visible, and the user can rename it —
/// instead of a phase silently eating its own items, which no UI can reveal.
const DECISIONS_HEADINGS: &[&str] = &[
    "결정",
    "결정사항",
    "결정 사항",
    "주요 결정",
    "결정 기록",
    "결정 로그",
    "decision",
    "decisions",
    "decision log",
    "decision records",
];

/// 이 헤딩 이름(앵커를 뗀 것)이 결정 섹션을 여는가.
pub(crate) fn is_decisions_heading(h: &str) -> bool {
    // `## 결정 (Decisions)` is the form AGENTS.md §7 documents, so a trailing
    // parenthetical gloss is stripped before matching.
    let mut s = h.trim();
    if s.ends_with(')') || s.ends_with('）') {
        if let Some(open) = s.rfind(['(', '（']) {
            s = s[..open].trim_end();
        }
    }
    let norm = s
        .trim_end_matches([':', '.', '·', '—', '-'])
        .trim()
        .to_lowercase();
    DECISIONS_HEADINGS.contains(&norm.as_str())
}

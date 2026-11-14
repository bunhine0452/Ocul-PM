//! 계획 명령 DTO (specta + serde) — `project.rs` 가 투영하고 명령이 내보내는 모양.
//!
//! `project.rs` 에서 떼어 냈다(11-15): 판정의 지금 모습 두 칸을 더하자 그 파일이 래칫(800줄)을
//! 넘었다. 경로는 그대로다 — `project.rs` 가 다시 내보낸다(`pub use`).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanSummary {
    pub plan_id: String,
    pub title: String,
    pub status: String,
    pub owner_agent: String,
    pub progress: f64,
    pub file_path: String,
    pub updated_at: String,
    pub item_count: u32,
    pub done_count: u32,
    /// 「마지막 판정」 (`judge.rs`) — 확인 명령을 돌린 가장 최근 결과. 선택 필드(TS `?:`).
    #[serde(default)]
    pub last_verdict: Option<super::judge::PlanVerdict>,
    /// 판정 ✓ 뒤에 다시 저장된, 이 계획이 다룬 파일 — 「통과 뒤 바뀜」. `digest::DigestPlan::stale_files`
    /// 와 같은 계산이고(`digest::verdict_now`) 계획 명령이 채운다. 투영(`summary_dto`)은 비워 둔다. 선택 필드.
    #[serde(default)]
    pub stale_files: Vec<String>,
    /// 가장 최근 ✓ 가 다른 OS 에서 돌았고 이 기기에서는 아직이다 — 「여기선 아직」, 그 OS.
    /// `digest::DigestPlan::verdict_from` 과 같은 뜻이다. 선택 필드.
    #[serde(default)]
    pub verdict_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanItemDto {
    pub item_id: String,
    pub phase: Option<String>,
    pub title: String,
    pub status: String,
    pub order_idx: u32,
    pub parent_item: Option<String>,
    pub note: Option<String>,
    pub last_agent: Option<String>,
    pub last_update: Option<String>,
    /// Distinct journal entries linked to this item via the plan-log (the
    /// agent's `일지` column). Drives the 📓 link + the progress suggestion.
    pub journal_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanDecisionDto {
    pub decision_id: String,
    pub title: String,
    pub body: String,
    pub locked_at: Option<String>,
    pub agent_id: Option<String>,
    pub affects: Vec<String>,
}

/// A trackable phase (`## Heading {#id}`) — rollup status + who last touched it.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanPhaseDto {
    pub phase_id: Option<String>,
    pub name: String,
    pub status: String,
    pub progress: f64,
    pub item_count: u32,
    pub done_count: u32,
    pub last_agent: Option<String>,
    pub last_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanDetail {
    pub plan: PlanSummary,
    pub items: Vec<PlanItemDto>,
    pub phases: Vec<PlanPhaseDto>,
    pub decisions: Vec<PlanDecisionDto>,
    /// Non-fatal parse warnings (broken glyphs, missing ids, …). Surfaced so
    /// the UI never fails silently on a malformed plan.
    pub warnings: Vec<String>,
    /// 「완료 조건」 한 줄 — 없으면 `None` 이 곧 신호다 (머리글이 「없음」을 말한다).
    pub done_when: Option<String>,
    /// 「확인 명령」 한 줄 — 마지막 항목을 닫을 때 돌릴 것.
    pub check: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct PlanItemUpdateDto {
    pub ts: String,
    pub item_id: String,
    pub agent_id: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub journal_ref: Option<String>,
    pub note: Option<String>,
}

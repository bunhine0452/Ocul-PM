//! AI-maintained Plan subsystem (Planner Upgrade).
//!
//! The SSOT is `.oculpm/planner/<slug>.md` — see `docs/planner-upgrade/`
//! (especially `01-data-model-and-markdown-spec.md`). This module parses that
//! markdown into a structured [`parse::ParsedPlan`] that the watcher projects
//! into the `oculpm_plan*` cache tables. The markdown is always the source of
//! truth; the SQLite rows are a reconstructible projection.

pub mod ai;
pub mod dispatch;
/// 플랜 레벨 status 전이의 유일한 문지기 (`{#done-transition-guard}`).
pub mod lifecycle;
pub mod migrate;
pub mod parse;
pub mod plan_edit;
pub mod project;

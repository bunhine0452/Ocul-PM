//! 문제 해결(Discussion) subsystem — the pre-decision exploration document type.
//!
//! The SSOT is `.oculpm/discussion/<slug>/discussion.md` (+ an `attachments/`
//! sidecar) — see `docs/discussion-feature/` (especially
//! `01-data-model-and-markdown-spec.md`). This module parses that markdown into
//! a structured [`parse::ParsedDiscussion`] that the read commands project into
//! the `oculpm_discussion*` cache tables. The markdown is always the source of
//! truth; the SQLite rows are a reconstructible projection.

pub mod doc_edit;
pub mod parse;
pub mod project;

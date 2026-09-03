//! `.oculpm/` filesystem subsystem.
//!
//! See `docs/major_update/oculpm/` for the SSOT — especially `00-spec.md`
//! and the phase guides in `phases/`.
//!
//! This module is the file-based replacement for the legacy SQLite changelog
//! pipeline. The on-disk layout, frontmatter schema, and locking protocol are
//! all specified in `00-spec.md` and must not be changed without bumping the
//! `schema_version`.

pub mod a2a;
pub mod agent_surface;
pub mod agents;
pub mod atomic_io;
pub mod automation;
pub mod cache;
pub mod chain;
pub mod claude_hooks;
pub mod config;
pub mod content_lang;
pub mod defer_ledger;
pub mod discussion;
pub mod entry_diffs;
pub mod error;
pub mod evals;
pub mod firing_ledger;
pub mod framing;
pub mod frontmatter;
pub mod history;
pub mod import;
pub mod index;
pub mod journal_draft;
pub mod lock;
pub mod manager;
pub mod markdown;
pub mod mcp;
pub mod paths;
pub mod planner;
pub mod readme;
pub mod reconcile;
pub mod redact;
pub mod retro_file;
pub mod rule_negation;
pub mod rule_promotion;
pub mod rule_scope;
pub mod rules;
pub mod session;
pub mod session_id;
pub mod shell_integration;
pub mod skill_dormancy;
pub mod skill_promotion;
pub mod skill_trigger;
pub mod spec;
pub mod stack_detect;
pub mod supervisor;
pub mod transcript;
pub mod watcher;

#[allow(unused_imports)] // Re-exported for sibling modules landing in W1-PR3..PR8.
pub use error::{OculpmError, OculpmResult};

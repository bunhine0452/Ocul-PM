//! `.oculpm/` filesystem subsystem.
//!
//! See `docs/major_update/oculpm/` for the SSOT — especially `00-spec.md`
//! and the phase guides in `phases/`.
//!
//! This module is the file-based replacement for the legacy SQLite changelog
//! pipeline. The on-disk layout, frontmatter schema, and locking protocol are
//! all specified in `00-spec.md` and must not be changed without bumping the
//! `schema_version`.

pub mod agents;
pub mod atomic_io;
pub mod cache;
pub mod config;
pub mod entry_diffs;
pub mod error;
pub mod frontmatter;
pub mod index;
pub mod lock;
pub mod manager;
pub mod markdown;
pub mod paths;
pub mod planner;
pub mod redact;
pub mod session;
pub mod spec;
pub mod watcher;

#[allow(unused_imports)] // Re-exported for sibling modules landing in W1-PR3..PR8.
pub use error::{OculpmError, OculpmResult};

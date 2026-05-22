//! `.oculpm/` filesystem subsystem.
//!
//! See `docs/major_update/oculpm/` for the SSOT — especially `00-spec.md`
//! and the phase guides in `phases/`.
//!
//! This module is the file-based replacement for the legacy SQLite changelog
//! pipeline. The on-disk layout, frontmatter schema, and locking protocol are
//! all specified in `00-spec.md` and must not be changed without bumping the
//! `schema_version`.

pub mod atomic_io;
pub mod config;
pub mod error;
pub mod lock;
pub mod paths;
pub mod spec;

#[allow(unused_imports)] // Re-exported for sibling modules landing in W1-PR3..PR8.
pub use error::{OculpmError, OculpmResult};

//! Error types for the `.oculpm/` subsystem.
//!
//! Variants are added as later PRs land (`OculpmError::*`). Keep this enum
//! flat — `std::error::Error` and `Display` are derived via `thiserror`.

use std::path::PathBuf;
use thiserror::Error;

#[allow(dead_code)] // Variants are consumed by sibling modules landing in W1-PR4..PR8.
#[derive(Debug, Error)]
pub enum OculpmError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    // W1-PR3 — WorkdayResolver
    #[error("invalid timezone: {0}")]
    InvalidTimezone(String),

    #[error("invalid HH:MM '{0}' (expected 00:00 - 23:59)")]
    InvalidHHMM(String),

    /// Placeholder used by stub modules. Real variants land in W1-PR4..PR8.
    #[error("not yet implemented")]
    NotImplemented,
}

#[allow(dead_code)] // Used by sibling modules landing in W1-PR3..PR8.
pub type OculpmResult<T> = Result<T, OculpmError>;

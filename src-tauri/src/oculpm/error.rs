//! Error types for the `.oculpm/` subsystem.
//!
//! Variants are added as later PRs land (`OculpmError::*`). Keep this enum
//! flat — `std::error::Error` and `Display` are derived via `thiserror`.

use std::path::PathBuf;
use thiserror::Error;

/// Unified error type for every `.oculpm/` subsystem operation. Flat by
/// design — `thiserror` provides `Display` + `std::error::Error`.
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

    // W1-PR4 — OculpmConfig
    #[error("config parse error: {0}")]
    ConfigParse(#[from] toml::de::Error),

    #[error("config serialize error: {0}")]
    ConfigSerialize(#[from] toml::ser::Error),

    #[error("invalid config: {0}")]
    InvalidConfig(String),

    // W1-PR5 — atomic_io + lock
    #[error("managed block mismatch in {path}: only one of begin/end markers present")]
    ManagedBlockMismatch { path: PathBuf },

    #[error("ndjson line is {0} bytes (cap is {1})")]
    NdjsonLineTooLarge(usize, usize),

    #[error("ndjson line must not contain a newline character")]
    NdjsonLineHasNewline,

    #[error("json parse error in {path}: {source}")]
    JsonParse {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("json serialize error: {0}")]
    JsonSerialize(serde_json::Error),

    #[error("json deserialize error: {0}")]
    JsonDeserialize(serde_json::Error),

    // W1-PR6 — OculpmManager
    #[error("project {0} is not initialized; call oculpm_init first")]
    NotInitialized(u32),

    // W2-PR1 — IndexWriter
    #[error("invalid session_id '{0}' (expected YYYYMMDD-NNN)")]
    InvalidSessionId(String),

    #[error("session '{session_id}' not found in workday '{workday}'")]
    SessionNotFound {
        session_id: String,
        workday: String,
    },

    // W2-PR2 — SessionActor
    #[error("session actor channel closed")]
    ActorClosed,

    // W3-PR2 — JournalCache (SQLite cache layer)
    #[error("sqlite cache error: {0}")]
    Sqlite(String),

    // W4-PR3 — redact / forbid_journal_for_paths
    #[error(
        "refusing to write journal entry: files_touched contains forbidden paths: {}",
        .paths.join(", ")
    )]
    ForbiddenJournalPath { paths: Vec<String> },

    /// Placeholder used by stub modules. Real variants land in later phases.
    #[error("not yet implemented")]
    NotImplemented,
}

#[allow(dead_code)] // Used by sibling modules landing in W1-PR3..PR8.
pub type OculpmResult<T> = Result<T, OculpmError>;

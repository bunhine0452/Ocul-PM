//! Error types for the `.oculpm/` subsystem.
//!
//! Variants are added as later PRs land (`OculpmError::*`). Keep this enum
//! flat — `std::error::Error` and `Display` are derived via `thiserror`.

use std::path::PathBuf;
use thiserror::Error;

/// Unified error type for every `.oculpm/` subsystem operation. Flat by
/// design — `thiserror` provides `Display` + `std::error::Error`.
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

    /// 일지 상대경로가 `.oculpm/journal/` 밖을 가리킨다 (절대경로·`..`·빈 경로).
    #[error("invalid journal path: {0}")]
    InvalidPath(String),

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
    SessionNotFound { session_id: String, workday: String },

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

    /// `.oculpm/` 자신이나 그 안에 심볼릭 링크가 있다. 이 폴더는 저장소에 실려
    /// 오므로 그 링크는 남이 만든 것이고, 따라가면 읽기·쓰기가 프로젝트 밖으로
    /// 나간다 — 열기를 거부한다. 값은 `.oculpm` 기준 상대경로(자신이면 빈 문자열).
    #[error("refusing to open the project: .oculpm/{0} is a symbolic link")]
    SymlinkInOculpm(String),

    /// 프로젝트 루트가 파일시스템 루트·사용자 홈과 그 위·최상위 시스템 폴더다
    /// (`paths::is_unsafe_project_root`).
    #[error(
        "refusing to use {0} as a project root (filesystem root, home folder or a system folder)"
    )]
    UnsafeProjectRoot(String),

    /// Placeholder used by stub modules. Real variants land in later phases.
    #[error("not yet implemented")]
    NotImplemented,
}

impl OculpmError {
    /// 이 오류가 "그 경로에 이미 파일이 있다" 인가 — 배타적 생성
    /// (`atomic_io::write_atomic_new`) 의 `AlreadyExists` 를 호출자가 "다음
    /// 이름으로" 신호로 읽을 수 있게 한다. 다른 io 오류와 섞이면 그 신호가
    /// 사라져 진짜 실패(권한·디스크)까지 재시도 루프에 삼켜진다.
    pub fn is_already_exists(&self) -> bool {
        matches!(
            self,
            OculpmError::Io { source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        )
    }
}

pub type OculpmResult<T> = Result<T, OculpmError>;

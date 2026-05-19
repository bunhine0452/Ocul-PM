use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("tokio-sqlite: {0}")]
    TokioSqlite(#[from] tokio_rusqlite::Error),

    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("keychain: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

use std::path::PathBuf;
use std::sync::Once;

use rusqlite::OptionalExtension;
use tokio_rusqlite::Connection;
use tracing::info;

use crate::error::Result;

const MIGRATIONS: &[(i64, &str)] =
    &[(1, include_str!("../migrations/001_initial.sql"))];

pub struct Db {
    conn: Connection,
    path: PathBuf,
}

impl Db {
    pub async fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        Self::register_sqlite_vec();

        let conn = Connection::open(path.clone()).await?;
        conn.call(|c| {
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = NORMAL;",
            )?;
            Ok(())
        })
        .await?;

        let db = Self { conn, path };
        db.migrate().await?;
        info!(path = %db.path.display(), "database ready");
        Ok(db)
    }

    /// Register sqlite-vec as a SQLite auto-extension exactly once per process.
    /// Auto-extensions are applied to every new connection, including ours.
    fn register_sqlite_vec() {
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    async fn migrate(&self) -> Result<()> {
        self.conn
            .call(|c| {
                let current: i64 =
                    c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                for (version, sql) in MIGRATIONS {
                    if current < *version {
                        let tx = c.transaction()?;
                        tx.execute_batch(sql)?;
                        tx.pragma_update(None, "user_version", *version)?;
                        tx.commit()?;
                        info!(version, "migration applied");
                    }
                }
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn settings_set(&self, key: String, value: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO settings (key, value, updated_at)
                     VALUES (?1, ?2, unixepoch())
                     ON CONFLICT(key) DO UPDATE SET
                       value = excluded.value,
                       updated_at = excluded.updated_at",
                    (key, value),
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn settings_get(&self, key: String) -> Result<Option<String>> {
        let value = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    [key],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(Into::into)
            })
            .await?;
        Ok(value)
    }

    pub async fn health(&self) -> Result<DbHealth> {
        let path = self.path.display().to_string();
        let (sqlite_version, vec_version, schema_version) = self
            .conn
            .call(|c| {
                let sqlite_version: String =
                    c.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
                let vec_version: String =
                    c.query_row("SELECT vec_version()", [], |r| r.get(0))?;
                let schema_version: u32 =
                    c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                Ok((sqlite_version, vec_version, schema_version))
            })
            .await?;
        Ok(DbHealth {
            sqlite_version,
            vec_version,
            schema_version,
            path,
        })
    }
}

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct DbHealth {
    pub sqlite_version: String,
    pub vec_version: String,
    pub schema_version: u32,
    pub path: String,
}

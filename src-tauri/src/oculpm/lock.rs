//! Single-process advisory lock for `.oculpm/`.
//!
//! `.oculpm/.lock` is a JSON file describing the live process that owns the
//! project's `.oculpm/` tree. While owned, the lock task pulses the
//! `heartbeat_at` field every 30 seconds. If a second instance finds a lock
//! whose heartbeat is older than `STALE_THRESHOLD_SECS` (5 minutes), it
//! assumes the previous owner crashed and recovers the lock.
//!
//! See `docs/major_update/oculpm/00-spec.md` §6 for the protocol.

#![allow(dead_code)] // Whole module is consumed by OculpmManager (W1-PR7).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::OculpmError;

const SCHEMA_VERSION: u32 = 1;
const HEARTBEAT_INTERVAL_SECS: u64 = 30;
const STALE_THRESHOLD_SECS: i64 = 5 * 60;

#[derive(Debug, Serialize, Deserialize)]
struct LockFile {
    schema_version: u32,
    pid: u32,
    hostname: String,
    started_at: String,
    heartbeat_at: String,
}

/// Diagnostics about a stale lock that we just took over — surfaced through
/// `LockAcquisition::Recovered` so callers can emit an integrity_warning.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ZombieInfo {
    pub previous_pid: u32,
    pub heartbeat_age_seconds: i64,
}

/// Outcome of `LockGuard::acquire`. Maps to `LockStateView` for the UI.
#[allow(dead_code)]
#[derive(Debug)]
pub enum LockAcquisition {
    /// No prior lock; we created a fresh one.
    Acquired(LockGuard),
    /// Lock is owned by another live process — caller should fall back to
    /// read-only mode.
    Held { by_pid: u32, heartbeat_at: String },
    /// Prior lock was stale (heartbeat older than threshold); we took over.
    Recovered { guard: LockGuard, info: ZombieInfo },
}

/// RAII handle for an owned lock. Drop or `release()` cleans up the lock file
/// and the heartbeat task.
#[allow(dead_code)]
#[derive(Debug)]
pub struct LockGuard {
    path: PathBuf,
    /// `Some` only between successful `acquire` and `release`/`drop`.
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
    /// Set so the heartbeat task can exit cleanly when `release` is called.
    shutdown: Arc<Notify>,
}

impl LockGuard {
    /// Try to acquire the lock at `path`.
    pub async fn acquire(path: &Path) -> Result<LockAcquisition, OculpmError> {
        match std::fs::read_to_string(path) {
            Ok(text) => {
                let existing: LockFile =
                    serde_json::from_str(&text).map_err(|source| OculpmError::JsonParse {
                        path: path.to_path_buf(),
                        source,
                    })?;
                let age = heartbeat_age_seconds(&existing.heartbeat_at)?;
                if age <= STALE_THRESHOLD_SECS {
                    return Ok(LockAcquisition::Held {
                        by_pid: existing.pid,
                        heartbeat_at: existing.heartbeat_at,
                    });
                }
                let guard = Self::write_fresh(path)?;
                Ok(LockAcquisition::Recovered {
                    guard,
                    info: ZombieInfo {
                        previous_pid: existing.pid,
                        heartbeat_age_seconds: age,
                    },
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let guard = Self::write_fresh(path)?;
                Ok(LockAcquisition::Acquired(guard))
            }
            Err(source) => Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

    fn write_fresh(path: &Path) -> Result<LockGuard, OculpmError> {
        let pid = std::process::id();
        let now = chrono::Utc::now().to_rfc3339();
        let lock = LockFile {
            schema_version: SCHEMA_VERSION,
            pid,
            hostname: detect_hostname(),
            started_at: now.clone(),
            heartbeat_at: now,
        };
        let text = serde_json::to_string_pretty(&lock).map_err(OculpmError::JsonSerialize)?;
        write_atomic(path, text.as_bytes())?;

        let shutdown = Arc::new(Notify::new());
        let path_clone = path.to_path_buf();
        let shutdown_clone = shutdown.clone();
        let heartbeat_handle = tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(tokio::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
            // Skip the immediate first tick — the lock was just written.
            interval.tick().await;
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let p = path_clone.clone();
                        // File I/O is cheap; doing it inline keeps the task
                        // tiny. If it ever becomes a hot path, wrap in
                        // spawn_blocking.
                        let _ = heartbeat_pulse(&p, pid);
                    }
                    _ = shutdown_clone.notified() => break,
                }
            }
        });

        Ok(LockGuard {
            path: path.to_path_buf(),
            heartbeat_handle: Some(heartbeat_handle),
            shutdown,
        })
    }

    /// Stop the heartbeat task and remove the lock file.
    #[allow(dead_code)] // Used by OculpmManager teardown (W1-PR7).
    pub async fn release(mut self) -> Result<(), OculpmError> {
        self.shutdown.notify_waiters();
        if let Some(handle) = self.heartbeat_handle.take() {
            // best-effort: short timeout so a wedged task can't block release.
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(1),
                async { let _ = handle.await; },
            )
            .await;
        }
        match std::fs::remove_file(&self.path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(source) => Err(OculpmError::Io {
                path: self.path.clone(),
                source,
            }),
        }
    }
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        // Sync cleanup only — Drop can't await. If `release` was called this
        // becomes a no-op because `heartbeat_handle` is already None.
        self.shutdown.notify_waiters();
        if let Some(handle) = self.heartbeat_handle.take() {
            handle.abort();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

fn heartbeat_age_seconds(heartbeat_at: &str) -> Result<i64, OculpmError> {
    let parsed = chrono::DateTime::parse_from_rfc3339(heartbeat_at)
        .map_err(|_| OculpmError::InvalidConfig(format!("invalid heartbeat_at: {heartbeat_at}")))?;
    let now = chrono::Utc::now();
    Ok((now - parsed.with_timezone(&chrono::Utc)).num_seconds())
}

/// Re-write the lock file with an updated `heartbeat_at`. Bails out silently
/// if another process now owns the lock (different pid) or the file was
/// removed, since both are recoverable situations the caller doesn't need to
/// know about immediately.
fn heartbeat_pulse(path: &Path, expected_pid: u32) -> Result<(), OculpmError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Ok(()),
    };
    let mut lock: LockFile = match serde_json::from_str(&text) {
        Ok(l) => l,
        Err(_) => return Ok(()),
    };
    if lock.pid != expected_pid {
        return Ok(());
    }
    lock.heartbeat_at = chrono::Utc::now().to_rfc3339();
    let new_text = serde_json::to_string_pretty(&lock).map_err(OculpmError::JsonSerialize)?;
    write_atomic(path, new_text.as_bytes())
}

fn detect_hostname() -> String {
    // Cross-platform best-effort. We use the env var as a cheap signal and
    // fall back to a sentinel — the hostname is informational only.
    std::env::var("HOSTNAME")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("COMPUTERNAME").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "unknown".into())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Helper: build a `LockFile` JSON with a specific pid and heartbeat,
    /// then drop it on disk. Lets us simulate "another process is alive"
    /// and "stale lock" scenarios without spawning real processes.
    fn write_synthetic_lock(path: &Path, pid: u32, heartbeat_at: &str) {
        let lock = LockFile {
            schema_version: SCHEMA_VERSION,
            pid,
            hostname: "test".into(),
            started_at: heartbeat_at.into(),
            heartbeat_at: heartbeat_at.into(),
        };
        let text = serde_json::to_string_pretty(&lock).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Case 1 — fresh path: acquire creates the file and reports `Acquired`.
    #[tokio::test]
    async fn acquire_fresh() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Acquired(guard) => {
                assert!(path.exists(), "lock file must exist");
                guard.release().await.unwrap();
                assert!(!path.exists(), "release must remove lock file");
            }
            other => panic!("expected Acquired, got {:?}", other),
        }
    }

    /// Case 2 — fresh held lock by another pid: returns `Held` without
    /// touching the file.
    #[tokio::test]
    async fn acquire_held_when_fresh_other_pid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let now = chrono::Utc::now().to_rfc3339();
        let other_pid = std::process::id().wrapping_add(99);
        write_synthetic_lock(&path, other_pid, &now);

        let before = std::fs::read(&path).unwrap();
        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Held { by_pid, .. } => {
                assert_eq!(by_pid, other_pid);
                let after = std::fs::read(&path).unwrap();
                assert_eq!(before, after, "Held must not modify the lock file");
            }
            other => panic!("expected Held, got {:?}", other),
        }
    }

    /// Case 3 — stale lock (heartbeat older than threshold): recover.
    #[tokio::test]
    async fn acquire_recovered_when_stale() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");
        let stale = (chrono::Utc::now() - chrono::Duration::seconds(STALE_THRESHOLD_SECS + 60))
            .to_rfc3339();
        write_synthetic_lock(&path, 1, &stale);

        let acq = LockGuard::acquire(&path).await.unwrap();
        match acq {
            LockAcquisition::Recovered { info, guard } => {
                assert_eq!(info.previous_pid, 1);
                assert!(info.heartbeat_age_seconds > STALE_THRESHOLD_SECS);
                guard.release().await.unwrap();
            }
            other => panic!("expected Recovered, got {:?}", other),
        }
    }

    /// Case 4 — heartbeat_pulse updates the `heartbeat_at` field while keeping
    /// pid + started_at intact.
    #[tokio::test]
    async fn heartbeat_pulse_updates_timestamp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".lock");

        // Acquire and immediately read the on-disk state.
        let acq = LockGuard::acquire(&path).await.unwrap();
        let guard = match acq {
            LockAcquisition::Acquired(g) => g,
            other => panic!("expected Acquired, got {:?}", other),
        };
        let first: LockFile =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        // Force a pulse rather than wait the full 30s interval.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        heartbeat_pulse(&path, std::process::id()).unwrap();

        let second: LockFile =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(first.pid, second.pid);
        assert_eq!(first.started_at, second.started_at);
        assert_ne!(
            first.heartbeat_at, second.heartbeat_at,
            "heartbeat_at must advance"
        );

        guard.release().await.unwrap();
    }
}

//! `.oculpm/index/` 사용량 조회 + diff 사이드카 정리 (플랜 `journal-scale-round`
//! `{#index-usage}`).
//!
//! 이 저장소 자신이 표본이다: 일지 원문은 4MB인데 `index/` 는 330MB —
//! `index/history/`(로컬 히스토리 스냅샷, [`crate::oculpm::history`])가 280MB,
//! `index/diffs/`(일지 diff 사이드카, [`crate::oculpm::entry_diffs`])가 39MB,
//! 나머지는 워크데이별 캐시 산출물이다. `.oculpm/index/` 는 이미 앱 관리
//! 영역이라 사용자 눈에 안 띄는데, 로컬 히스토리 쪽은 `code_history_usage`/
//! `code_history_clear`(설정 → 코드 탭)가 이미 다루고 있다 — 여기서는 그
//! 옆에 diff 사이드카까지 **세 갈래**로 합쳐 보여주고, diff 쪽만 지우는
//! 손잡이를 하나 더 낸다(전문 스냅샷과 달리 diff 는 git 에서 다시 만들 수
//! 있어 잃을 것이 적다 — [`crate::oculpm::manager::indexing`]의
//! `read_or_reconstruct_entry_diffs` 폴백).
//!
//! `.oculpm/index/` 전체는 워처가 자기 억제한다
//! ([`crate::oculpm::watcher::classify::is_self_suppressed`]) — 여길 지워도
//! 이벤트가 되돌아오지 않는다.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;
use tauri::State;

use crate::commands::code::project_root;
use crate::db::Db;
use crate::oculpm::history;

/// `history`/`diffs`/그 밖(워크데이 캐시 등) 세 갈래 사용량. specta 는 `u64` 를
/// 못 내보내 정밀도를 잃으므로(`DbHealth::db_bytes` 와 같은 관례) `f64` 로
/// 건넌다 — JS `number` 는 2^53 까지 정확하다.
#[derive(Debug, Clone, Serialize, Type)]
pub struct IndexUsage {
    pub history_bytes: f64,
    pub history_files: u32,
    pub diffs_bytes: f64,
    pub diffs_files: u32,
    pub other_bytes: f64,
    pub total_bytes: f64,
}

fn index_root(root: &Path) -> PathBuf {
    root.join(".oculpm").join("index")
}

/// diff 사이드카 뿌리. [`crate::oculpm::entry_diffs`]의 `sidecar_path` 와 같은
/// 경로 규칙이지만 그 함수는 파일 하나(`entry_rel` 이 있어야)만 계산하므로
/// 여긴 디렉터리째 다시 적는다 — 그 파일이 이미 800줄 래칫에 걸려 있어(898줄)
/// 한 줄도 못 늘린다.
fn diffs_root(root: &Path) -> PathBuf {
    index_root(root).join("diffs")
}

/// 한 파일/디렉터리의 (바이트, 파일 수). 심링크는 크기에 넣지 않는다 —
/// `read_dir`(`DirEntry::file_type`)은 심링크를 따라가지 않으므로 여기서
/// `is_symlink()` 만 걸러 주면 된다.
fn entry_usage(path: &Path) -> (u64, u32) {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_dir() {
        walk_usage(path)
    } else {
        (meta.len(), 1)
    }
}

/// 디렉터리 전체를 재귀로 더한다. 없는 디렉터리는 (0, 0) — 오류가 아니다
/// (`history::usage_bytes` 와 같은 관용).
fn walk_usage(dir: &Path) -> (u64, u32) {
    let mut bytes = 0u64;
    let mut files = 0u32;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        let (b, f) = entry_usage(&entry.path());
        bytes = bytes.saturating_add(b);
        files = files.saturating_add(f);
    }
    (bytes, files)
}

/// `index_root` 바로 아래에서 `history`/`diffs` 를 뺀 나머지(워크데이별 캐시,
/// `config.toml` 이 참조하는 파생물 등). 큰 두 갈래를 두 번 안 걷도록 이름으로
/// 건너뛴다.
fn other_usage(index_root: &Path) -> (u64, u32) {
    let mut bytes = 0u64;
    let mut files = 0u32;
    let Ok(rd) = std::fs::read_dir(index_root) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        let name = entry.file_name();
        if name == OsStr::new("history") || name == OsStr::new("diffs") {
            continue;
        }
        let (b, f) = entry_usage(&entry.path());
        bytes = bytes.saturating_add(b);
        files = files.saturating_add(f);
    }
    (bytes, files)
}

/// 지금 `.oculpm/index/` 가 먹는 용량 — 세 갈래로 쪼개서. 보이지 않는 곳에서
/// 디스크를 먹는 기능은 반드시 자기 크기를 밝혀야 한다(`history.rs` 와 같은
/// 원칙).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_index_usage(db: State<'_, Db>, project_id: u32) -> Result<IndexUsage, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let idx = index_root(&root);
        let (history_bytes, history_files) = walk_usage(&history::history_root(&root));
        let (diffs_bytes, diffs_files) = walk_usage(&diffs_root(&root));
        let (other_bytes, _other_files) = other_usage(&idx);
        let total_bytes = history_bytes
            .saturating_add(diffs_bytes)
            .saturating_add(other_bytes);
        IndexUsage {
            history_bytes: history_bytes as f64,
            history_files,
            diffs_bytes: diffs_bytes as f64,
            diffs_files,
            other_bytes: other_bytes as f64,
            total_bytes: total_bytes as f64,
        }
    })
    .await
    .map_err(|e| format!("Failed to measure index usage: {e}"))
}

/// diff 사이드카 전부 삭제 — 전문 스냅샷(로컬 히스토리)과 달리 diff 는 git 이
/// 있으면 다시 만들 수 있다(`read_or_reconstruct_entry_diffs`). git 이 없는
/// 프로젝트라면 이후 일지들은 캡처 시점의 diff 를 다시 못 얻으니, 그 사실은
/// 프런트 확인 문구가 말한다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_index_clear_diffs(db: State<'_, Db>, project_id: u32) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = diffs_root(&root);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to clear diff sidecars: {e}"))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Failed to clear diff sidecars: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walk_usage_sums_nested_files_and_counts() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("ab/cdef")).unwrap();
        std::fs::write(tmp.path().join("ab/cdef/meta.json"), b"{}").unwrap();
        std::fs::write(tmp.path().join("ab/cdef/1-abc.snap"), b"hello world").unwrap();
        let (bytes, files) = walk_usage(tmp.path());
        assert_eq!(files, 2);
        assert_eq!(bytes, 2 + 11);
    }

    #[test]
    fn walk_usage_missing_dir_is_zero_not_error() {
        let tmp = tempfile::tempdir().unwrap();
        let (bytes, files) = walk_usage(&tmp.path().join("does-not-exist"));
        assert_eq!((bytes, files), (0, 0));
    }

    #[test]
    fn other_usage_skips_history_and_diffs_dirnames() {
        let tmp = tempfile::tempdir().unwrap();
        let idx = tmp.path();
        std::fs::create_dir_all(idx.join("history/ab")).unwrap();
        std::fs::write(idx.join("history/ab/f.snap"), b"12345").unwrap();
        std::fs::create_dir_all(idx.join("diffs")).unwrap();
        std::fs::write(idx.join("diffs/e.json"), b"1234567890").unwrap();
        std::fs::create_dir_all(idx.join("20260921")).unwrap();
        std::fs::write(idx.join("20260921/sessions.json"), b"abc").unwrap();
        let (bytes, files) = other_usage(idx);
        assert_eq!(files, 1);
        assert_eq!(bytes, 3);
    }
}

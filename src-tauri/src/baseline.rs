//! diff 기준선 스냅샷 동기 — 4.0 에서 걷은 코드 색인의 **남은 한 조각**.
//!
//! `file_snapshots` 는 git 이 `HEAD` 로 기준선을 주지 못하는 파일(HEAD 없는 저장소 ·
//! git 아닌 프로젝트 · 추적 안 된 파일)의 「앱이 마지막으로 본 내용」이다. 읽는 쪽은
//! 변경 화면(`compute_diff` 의 스냅샷 폴백)과 일지별 diff 캡처(`entry_diffs` 2단계) —
//! 약속 3번(일지마다 diff)이 거기 서 있다. 예전엔 그 표를 쓰는 쪽이 코드 색인(전체
//! 걷기 + 워처 증분)이었다. 색인을 걷으며 **쓰기만** 이 모듈로 옮겼다:
//!
//! - 워처가 파일 하나의 변경을 보면 [`sync_one`] — HEAD 에 있으면 스냅샷을 지우고,
//!   없으면 찍는다 (`{#snapshot-git-dup}` 규칙 그대로).
//! - 지워지면 그 경로(폴더면 그 아래)의 스냅샷을 지운다.
//! - 앱이 뜰 때 [`prune`] — 꺼진 사이 커밋됐거나 사라진 파일의 스냅샷을 걷는다
//!   (예전 전체 색인 끝의 `retain_file_snapshots` 자리).
//!
//! 범위 판정(벤더·캐시 폴더 · 잠금·비밀 파일 · worktree 사본 · 크기 상한 · 바이너리 ·
//! minified)은 색인 걷기의 것을 그대로 가져왔다 — 스냅샷 표가 다시 부풀지 않게.

use std::path::{Component, Path};

use crate::db::Db;

pub(crate) mod low_value;
pub(crate) mod worktree;

/// 스냅샷을 찍을 파일의 크기 상한 (예전 색인 기본값 `max_file_size_kb = 500`).
pub const MAX_FILE_BYTES: u64 = 500_000;
const MAX_BINARY_PROBE: usize = 1024;

/// 한 줄이 이 길이를 넘는 파일은 minified/생성 파일로 보고 찍지 않는다.
pub const MAX_LINE_BYTES: usize = 4_096;

/// `.gitignore` 와 무관하게 절대 보지 않는 디렉터리 이름 — 벤더·캐시·빌드 산출물.
const DENY_DIR_NAMES: &[&str] = &[
    "node_modules",
    "vendor",
    ".dart_tool",
    ".git",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".gradle",
    "Pods",
    "DerivedData",
    "coverage",
    "bower_components",
    ".svelte-kit",
    ".angular",
    ".parcel-cache",
];

/// 생성되거나 거대한 직렬화 덩어리인 파일 이름.
const SKIP_FILENAMES: &[&str] = &[
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "composer.lock",
    "poetry.lock",
    "uv.lock",
];

/// 건너뛰는 이름 접미.
const SKIP_SUFFIXES: &[&str] = &[".min.js", ".min.css", ".min.mjs", ".map", ".lock", ".snap"];

/// 경로만으로 내리는 앞 절반 — 이름(잠금·비밀) · 벤더 폴더 · 루트 아래 worktree 사본.
/// 워처는 이걸로 곁일을 띄우기 **전에** 거른다. 루트 **아래**(`rel`)만 본다.
pub(crate) fn in_scope(root: &Path, rel: &Path) -> bool {
    !(is_skipped_name(rel) || has_denied_component(rel))
        && !worktree::under_linked_worktree(root, rel)
}

/// 파일 하나가 스냅샷 대상인가 — 경로 판정 + 링크 아님 + 크기 + 바이너리 탐침.
pub fn is_baseline_path(root: &Path, rel: &Path) -> bool {
    if !in_scope(root, rel) {
        return false;
    }
    let path = &root.join(rel);
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return false;
    }
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    low_value::size_ok(path, metadata.len(), MAX_FILE_BYTES) && !looks_binary(path)
}

/// 읽은 내용이 사람이 읽는 텍스트인가 — minified/생성 파일 판정.
pub fn is_text_content(content: &str) -> bool {
    !content.lines().any(|line| line.len() > MAX_LINE_BYTES)
}

/// 경로 구성 요소 중 하나라도 [`DENY_DIR_NAMES`] 에 있으면 true.
pub(crate) fn has_denied_component(path: &Path) -> bool {
    path.components().any(|c| {
        matches!(c, Component::Normal(name)
            if name.to_str().is_some_and(|n| DENY_DIR_NAMES.contains(&n)))
    })
}

pub(crate) fn is_skipped_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if SKIP_FILENAMES.contains(&name) || crate::oculpm::redact::is_secret_file_name(name) {
        return true;
    }
    SKIP_SUFFIXES.iter().any(|s| name.ends_with(s))
}

/// 머리 1KB 에 NUL 이 있거나 UTF-8 이 아니면 바이너리로 본다. 탐침 끝에서 잘린
/// 멀티바이트 한 글자(`error_len() == None`)는 증거가 아니다.
fn looks_binary(path: &Path) -> bool {
    use std::io::Read;
    let mut buf = [0u8; MAX_BINARY_PROBE];
    let Ok(n) = std::fs::File::open(path).and_then(|mut f| f.read(&mut buf)) else {
        return true;
    };
    let head = &buf[..n];
    head.contains(&0) || std::str::from_utf8(head).is_err_and(|e| e.error_len().is_some())
}

/// [`sync_one`] 이 아무것도 쓰지 않은 이유. 워처는 「사라졌다」·「생성물」을 일상으로
/// (debug) 남기고 나머지를 WARN 으로 남긴다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    NotFound,
    /// 범위 밖(벤더·비밀·크기·바이너리) — 경로 판정이 뒤늦게 바뀐 경우.
    OutOfScope,
    ReadFailed {
        error: String,
    },
    WriteFailed {
        error: String,
    },
    /// minified/생성 파일 — 한 줄이 [`MAX_LINE_BYTES`] 를 넘는다.
    Generated,
}

impl SkipReason {
    /// 「그 사이 파일이 사라졌다」 인가 — 실패가 아니라 일상이다.
    pub fn is_routine(&self) -> bool {
        match self {
            SkipReason::NotFound | SkipReason::OutOfScope | SkipReason::Generated => true,
            SkipReason::ReadFailed { error } => {
                error.contains("No such file or directory")
                    || error.contains("os error 2")
                    || error.contains("Is a directory")
                    || error.contains("did not contain valid UTF-8")
            }
            SkipReason::WriteFailed { .. } => false,
        }
    }
}

/// 파일 하나의 기준선 동기. 내용이 저장된 스냅샷과 같으면 아무것도 하지 않고
/// `Ok(false)`, 지우거나 찍었으면 `Ok(true)`.
pub async fn sync_one(
    db: &Db,
    project_id: u32,
    root: &Path,
    rel: &str,
) -> Result<bool, SkipReason> {
    let abs = crate::path_guard::secure_join(root, rel)
        .map_err(|error| SkipReason::ReadFailed { error })?;
    if !abs.exists() {
        return Err(SkipReason::NotFound);
    }
    if !is_baseline_path(root, Path::new(rel)) {
        return Err(SkipReason::OutOfScope);
    }
    let content = std::fs::read_to_string(&abs).map_err(|e| SkipReason::ReadFailed {
        error: e.to_string(),
    })?;
    if !is_text_content(&content) {
        return Err(SkipReason::Generated);
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let stored = db
        .snapshot_hash(project_id, rel.to_string())
        .await
        .map_err(|e| SkipReason::WriteFailed {
            error: e.to_string(),
        })?;
    if stored.as_deref() == Some(hash.as_str()) {
        return Ok(false);
    }
    // HEAD 가 서빙하면 안 찍고 지운다 (`{#snapshot-git-dup}`).
    let in_head = {
        let (root, rel) = (root.to_path_buf(), rel.to_string());
        tokio::task::spawn_blocking(move || crate::git::path_in_head(&root, &rel) == Some(true))
            .await
            .unwrap_or(false)
    };
    db.sync_file_snapshot(project_id, rel, content.as_bytes(), &hash, in_head)
        .await
        .map_err(|e| SkipReason::WriteFailed {
            error: e.to_string(),
        })?;
    Ok(true)
}

/// 지워진 경로의 스냅샷을 걷는다. 경로가 디스크에 아예 없으면 **그 아래도** 걷는다 —
/// 폴더를 통째로 옮기거나 지우면 안의 파일마다 Remove 가 온다는 보장이 없다.
pub async fn remove(db: &Db, project_id: u32, root: &Path, rel: &str) -> crate::error::Result<()> {
    if root.join(rel).exists() {
        db.delete_file_snapshot(project_id, rel.to_string()).await
    } else {
        db.delete_file_snapshots_under(project_id, rel.to_string())
            .await
            .map(|_| ())
    }
}

/// 앱이 뜰 때 한 번 — 꺼진 사이 사라졌거나 HEAD 에 들어간 파일의 스냅샷을 걷는다.
/// stat 과 `git ls-tree` 뿐이고 파일을 읽지 않는다. 걷은 수를 돌려준다.
pub async fn prune(db: &Db, project_id: u32, root: &Path) -> Result<u32, String> {
    let paths = db
        .snapshot_paths(project_id)
        .await
        .map_err(|e| e.to_string())?;
    if paths.is_empty() {
        return Ok(0);
    }
    let root = root.to_path_buf();
    let keep = tokio::task::spawn_blocking(move || {
        let mut head = crate::git::nesting::HeadIndex::default();
        paths
            .into_iter()
            .filter(|rel| root.join(rel).is_file() && !head.contains(&root, rel))
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    db.retain_file_snapshots(project_id, keep)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 경로 판정은 루트 **아래**만 본다 — 루트가 `~/.cache/…` 나 `…/vendor/…` 아래에
    /// 있어도 그 프로젝트의 파일은 찍는다.
    #[test]
    fn denied_names_above_the_root_do_not_count() {
        let dir = tempfile::tempdir().unwrap();
        for parent in ["vendor", ".cache", "target"] {
            let root = dir.path().join(parent).join("proj");
            for rel in ["src/a.ts", "vendor/x.ts"] {
                std::fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
                std::fs::write(root.join(rel), "export const a = 1;\n").unwrap();
            }
            assert!(is_baseline_path(&root, Path::new("src/a.ts")), "{parent}");
            assert!(
                !is_baseline_path(&root, Path::new("vendor/x.ts")),
                "{parent}"
            );
        }
    }

    /// 잠금·비밀 파일 · 데이터 파일 · 바이너리 · 비 UTF-8 은 찍지 않는다.
    #[test]
    fn locks_secrets_data_and_binaries_are_out_of_scope() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let write = |rel: &str, body: &[u8]| {
            std::fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
            std::fs::write(root.join(rel), body).unwrap();
        };
        write("src/a.rs", b"fn a() {}\n");
        write("pnpm-lock.yaml", b"x: 1\n");
        write(".env", b"API_KEY=x\n");
        write("data/rows.tsv", b"a\tb\n");
        write("a.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n");
        write("memo.txt", b"\xc7\xd1\xb1\xdb \xb8\xde\xb8\xf0\n");
        assert!(is_baseline_path(root, Path::new("src/a.rs")));
        for rel in [
            "pnpm-lock.yaml",
            ".env",
            "data/rows.tsv",
            "a.pdf",
            "memo.txt",
        ] {
            assert!(!is_baseline_path(root, Path::new(rel)), "{rel}");
        }
        // 탐침 경계에서 잘린 한글 한 글자는 텍스트다.
        let mut ko = vec![b'a'; 1023];
        ko.extend_from_slice("가".as_bytes());
        write("cut.md", &ko);
        assert!(is_baseline_path(root, Path::new("cut.md")));
    }

    #[test]
    fn only_vanished_and_out_of_scope_files_are_routine() {
        assert!(SkipReason::NotFound.is_routine());
        assert!(SkipReason::Generated.is_routine());
        assert!(SkipReason::ReadFailed {
            error: "No such file or directory (os error 2)".into()
        }
        .is_routine());
        assert!(!SkipReason::ReadFailed {
            error: "Permission denied (os error 13)".into()
        }
        .is_routine());
        assert!(!SkipReason::WriteFailed {
            error: "database is locked".into()
        }
        .is_routine());
    }

    /// git 이 아닌 프로젝트: 바뀐 파일은 찍히고, 같은 내용이면 다시 쓰지 않으며,
    /// 사라지면(폴더째여도) 걷힌다. 기동 정리는 디스크에 없는 것만 걷는다.
    #[tokio::test]
    async fn sync_remove_and_prune_keep_the_baseline_honest() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("a.txt"), "v1\n").unwrap();
        std::fs::write(root.join("notes/b.md"), "b\n").unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("proj".into(), root.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(sync_one(&db, pid, &root, "a.txt").await, Ok(true));
        assert_eq!(sync_one(&db, pid, &root, "a.txt").await, Ok(false));
        assert_eq!(sync_one(&db, pid, &root, "notes/b.md").await, Ok(true));
        let snap = db.get_file_snapshot(pid, "a.txt".into()).await.unwrap();
        assert_eq!(snap.map(|s| s.content), Some(b"v1\n".to_vec()));
        assert_eq!(
            sync_one(&db, pid, &root, "gone.txt").await,
            Err(SkipReason::NotFound)
        );

        // 폴더째 사라졌다 — 이벤트는 폴더 하나뿐.
        std::fs::remove_dir_all(root.join("notes")).unwrap();
        remove(&db, pid, &root, "notes").await.unwrap();
        assert!(db
            .get_file_snapshot(pid, "notes/b.md".into())
            .await
            .unwrap()
            .is_none());

        // 앱이 꺼진 사이 지워진 파일 — 기동 정리가 걷는다.
        std::fs::remove_file(root.join("a.txt")).unwrap();
        std::fs::write(root.join("c.txt"), "c\n").unwrap();
        assert_eq!(sync_one(&db, pid, &root, "c.txt").await, Ok(true));
        assert_eq!(prune(&db, pid, &root).await, Ok(1));
        assert!(db
            .get_file_snapshot(pid, "a.txt".into())
            .await
            .unwrap()
            .is_none());
        assert!(db
            .get_file_snapshot(pid, "c.txt".into())
            .await
            .unwrap()
            .is_some());
    }
}

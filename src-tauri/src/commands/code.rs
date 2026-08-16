//! 코드 화면 백엔드 — 프로젝트 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md).
//!
//! SSOT 는 디스크다 — docs 뷰어와 같은 원칙으로 캐시를 두지 않는다. 모든 경로는
//! project.rs 의 [`secure_join`] 을 거쳐 프로젝트 루트 밖으로 못 나간다.
//!
//! 쓰기는 낙관적 잠금이다: 프런트가 읽을 때 받은 blake3 해시를 저장 시 되돌려
//! 보내고, 디스크가 그 사이 바뀌었으면 덮어쓰지 않고 `Conflict` 를 돌려준다
//! (에이전트가 활발히 파일을 고치는 앱 특성상 이 창구가 반드시 필요하다).
//! 저장 자체는 같은 디렉터리 임시 파일 + rename 으로 원자적이다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::docs::natural_cmp;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 트리 상한 — 이 이상은 `truncated` 로 알리고 자른다. gitignore 를 존중한
/// 걸음에서 소스 파일이 2만을 넘는 저장소는 트리 UI 자체가 무의미해지는
/// 크기라, 그때는 검색으로 여는 흐름이 맞다.
const MAX_TREE_FILES: usize = 20_000;

/// 에디터로 여는 파일의 상한. 이보다 크면 `too_large` — 뷰어가 아니라 로그/
/// 데이터 파일이라 외부 에디터로 보낸다 (base64 왕복·CM 하이라이트 비용 방어).
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// 바이너리 판정 프로브 크기 — 선두 8KB 에 NUL 이 있으면 바이너리로 본다.
const BINARY_PROBE_BYTES: usize = 8192;

/// 코드 트리 한 노드. `relative_path` 는 프로젝트 루트 기준 슬래시 경로 —
/// 그대로 `code_read`/`code_write` 인자로 쓴다 (docs 뷰어와 같은 계약).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeTreeNode {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<CodeTreeNode>,
}

/// `code_tree` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeTree {
    pub nodes: Vec<CodeTreeNode>,
    pub file_count: u32,
    /// [`MAX_TREE_FILES`] 상한에 걸려 잘렸다 — UI 가 배지로 알린다.
    pub truncated: bool,
}

/// `code_read` 응답. `binary`/`too_large` 면 `content` 는 빈 문자열이고
/// UI 는 "외부 에디터로 열기" 안내를 그린다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeFileContent {
    pub content: String,
    /// blake3(원본 바이트) hex — 저장 시 `base_hash` 로 되돌려 보내는 토큰.
    pub hash: String,
    pub bytes: u32,
    pub binary: bool,
    pub too_large: bool,
}

/// `code_write` 결과 — 충돌은 오류가 아니라 정상 분기라 Err 로 보내지 않는다
/// (프런트가 배너로 병합 선택지를 그려야 한다).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind")]
pub enum CodeWriteOutcome {
    #[serde(rename = "saved")]
    Saved { hash: String },
    #[serde(rename = "conflict")]
    Conflict { disk_hash: String },
}

/// 프로젝트의 코드 파일 트리. gitignore·hidden 을 존중한다 (인덱서와 같은 시야).
#[tauri::command]
#[specta::specta]
pub async fn code_tree(db: State<'_, Db>, project_id: u32) -> Result<CodeTree, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || build_code_tree(&root, MAX_TREE_FILES))
        .await
        .map_err(|e| format!("Failed to walk the project tree: {e}"))
}

/// 단일 파일 본문 + 해시. 바이너리/대용량은 본문 없이 플래그만 세운다.
#[tauri::command]
#[specta::specta]
pub async fn code_read(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeFileContent, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Ok(CodeFileContent {
            content: String::new(),
            hash: String::new(),
            bytes: meta.len().min(u32::MAX as u64) as u32,
            binary: false,
            too_large: true,
        });
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let len = bytes.len() as u32;
    if looks_binary(&bytes) {
        return Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(CodeFileContent {
            content,
            hash,
            bytes: len,
            binary: false,
            too_large: false,
        }),
        // UTF-8 이 아니면 텍스트 에디터 대상이 아니다 — 바이너리로 취급.
        Err(_) => Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        }),
    }
}

/// 파일 저장 (낙관적 잠금). **기존 파일만** — 신규 생성은 v1 스코프 밖이라
/// 트리와 어긋난 유령 경로 생성을 막는다.
#[tauri::command]
#[specta::specta]
pub async fn code_write(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    content: String,
    base_hash: String,
) -> Result<CodeWriteOutcome, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || write_with_lock(&full, &content, &base_hash))
        .await
        .map_err(|e| format!("Failed to save file: {e}"))?
}

// ─── helpers ────────────────────────────────────────────────────────────────

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE_BYTES)].contains(&0)
}

/// 걸음(파일 목록) → 중첩 트리. 폴더 우선 + 자연 정렬은 [`sort_nodes`] 가 맡고,
/// 파일이 없는 폴더는 구조적으로 생기지 않는다 (파일 경로에서만 폴더를 만든다).
fn build_code_tree(root: &Path, max_files: usize) -> CodeTree {
    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .build()
        .flatten()
    {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if files.len() >= max_files {
            truncated = true;
            break;
        }
        files.push(rel);
    }
    let file_count = files.len() as u32;

    #[derive(Default)]
    struct DirAcc {
        dirs: BTreeMap<String, DirAcc>,
        files: Vec<String>,
    }
    let mut top = DirAcc::default();
    for rel in &files {
        let mut cursor = &mut top;
        let segs: Vec<&str> = rel.split('/').collect();
        for seg in &segs[..segs.len() - 1] {
            cursor = cursor.dirs.entry((*seg).to_string()).or_default();
        }
        cursor.files.push(segs[segs.len() - 1].to_string());
    }

    fn to_nodes(acc: DirAcc, prefix: &str) -> Vec<CodeTreeNode> {
        let mut out = Vec::new();
        for (name, child) in acc.dirs {
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let children = to_nodes(child, &rel);
            out.push(CodeTreeNode {
                name,
                relative_path: rel,
                is_dir: true,
                children,
            });
        }
        for name in acc.files {
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            out.push(CodeTreeNode {
                name,
                relative_path: rel,
                is_dir: false,
                children: Vec::new(),
            });
        }
        sort_nodes(&mut out);
        out
    }

    CodeTree {
        nodes: to_nodes(top, ""),
        file_count,
        truncated,
    }
}

/// 폴더 우선, 그다음 자연 정렬 (docs 트리의 `natural_cmp` 재사용 — `10-x` 가
/// `2-x` 뒤에 오도록).
fn sort_nodes(nodes: &mut [CodeTreeNode]) {
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

/// 해시 대조 → 같은 디렉터리 임시 파일 → 권한 복사 → rename. 동기 IO 라
/// spawn_blocking 안에서 부른다.
fn write_with_lock(full: &Path, content: &str, base_hash: &str) -> Result<CodeWriteOutcome, String> {
    let disk = std::fs::read(full).map_err(|e| format!("Failed to read file before save: {e}"))?;
    let disk_hash = blake3::hash(&disk).to_hex().to_string();
    if disk_hash != base_hash {
        return Ok(CodeWriteOutcome::Conflict { disk_hash });
    }

    let parent = full
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let file_name = full
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let tmp = parent.join(format!(".{file_name}.oculpm-save-tmp"));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Failed to save file: {e}"))?;
    // rename 은 inode 를 갈아끼우므로 원본 권한(실행 비트 등)을 임시 파일에
    // 먼저 옮겨 둬야 저장 후에도 유지된다.
    if let Ok(meta) = std::fs::metadata(full) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    if let Err(e) = std::fs::rename(&tmp, full) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to save file: {e}"));
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    Ok(CodeWriteOutcome::Saved { hash })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, contents: &[u8]) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, contents).unwrap();
    }

    fn names(nodes: &[CodeTreeNode]) -> Vec<String> {
        nodes.iter().map(|n| n.name.clone()).collect()
    }

    #[test]
    fn tree_nests_and_respects_gitignore() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // ignore 크레이트는 git 저장소일 때만 .gitignore 를 적용한다.
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"node_modules/\ndist/\n");
        write(root, "src/main.rs", b"fn main() {}");
        write(root, "src/lib.rs", b"pub fn x() {}");
        write(root, "README.md", b"# hi");
        write(root, "node_modules/pkg/index.js", b"ignored");
        write(root, "dist/out.js", b"ignored");
        write(root, ".hidden/secret.txt", b"hidden skipped");

        let tree = build_code_tree(root, MAX_TREE_FILES);
        let top = names(&tree.nodes);
        assert!(top.contains(&"src".to_string()), "{top:?}");
        assert!(top.contains(&"README.md".to_string()), "{top:?}");
        assert!(!top.contains(&"node_modules".to_string()), "gitignore: {top:?}");
        assert!(!top.contains(&"dist".to_string()), "gitignore: {top:?}");
        assert!(!top.contains(&".hidden".to_string()), "hidden: {top:?}");
        assert!(!tree.truncated);
        // 폴더 우선 정렬 + 중첩 경로.
        assert!(tree.nodes[0].is_dir, "dirs first: {top:?}");
        let src = tree.nodes.iter().find(|n| n.name == "src").unwrap();
        assert_eq!(src.relative_path, "src");
        let lib = src.children.iter().find(|n| n.name == "lib.rs").unwrap();
        assert_eq!(lib.relative_path, "src/lib.rs");
        assert!(!lib.is_dir);
    }

    #[test]
    fn tree_truncates_at_cap() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for i in 0..10 {
            write(root, &format!("f{i}.txt"), b"x");
        }
        let tree = build_code_tree(root, 5);
        assert!(tree.truncated);
        assert_eq!(tree.file_count, 5);
    }

    #[test]
    fn binary_probe_detects_nul() {
        assert!(looks_binary(b"\x00\x01\x02"));
        assert!(looks_binary(b"PNG\x00 blob"));
        assert!(!looks_binary(b"plain text \xEA\xB0\x80"));
        assert!(!looks_binary(b""));
    }

    #[test]
    fn write_saves_when_hash_matches() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "a.txt", b"before");
        let base = blake3::hash(b"before").to_hex().to_string();

        let out = write_with_lock(&root.join("a.txt"), "after", &base).unwrap();
        match out {
            CodeWriteOutcome::Saved { hash } => {
                assert_eq!(hash, blake3::hash(b"after").to_hex().to_string());
            }
            other => panic!("expected Saved, got {other:?}"),
        }
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "after");
    }

    #[test]
    fn write_conflicts_on_stale_hash() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "a.txt", b"disk version");
        let stale = blake3::hash(b"what the editor read").to_hex().to_string();

        let out = write_with_lock(&root.join("a.txt"), "my edit", &stale).unwrap();
        match out {
            CodeWriteOutcome::Conflict { disk_hash } => {
                assert_eq!(disk_hash, blake3::hash(b"disk version").to_hex().to_string());
            }
            other => panic!("expected Conflict, got {other:?}"),
        }
        // 덮어쓰지 않았다.
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "disk version");
    }

    #[test]
    fn write_rejects_missing_file() {
        let tmp = TempDir::new().unwrap();
        let out = write_with_lock(&tmp.path().join("nope.txt"), "x", "hash");
        assert!(out.is_err(), "새 파일 생성은 v1 스코프 밖");
    }

    #[cfg(unix)]
    #[test]
    fn write_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "run.sh", b"#!/bin/sh\necho hi");
        let p = root.join("run.sh");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        let base = blake3::hash(b"#!/bin/sh\necho hi").to_hex().to_string();

        write_with_lock(&p, "#!/bin/sh\necho bye", &base).unwrap();
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755, "실행 비트가 저장 후에도 유지돼야 한다");
    }
}

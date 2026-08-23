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
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::commands::docs::natural_cmp;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 트리 상한 — 이 이상은 `truncated` 로 알리고 자른다. gitignore 를 존중한
/// 걸음에서 소스 파일이 2만을 넘는 저장소는 트리 UI 자체가 무의미해지는
/// 크기라, 그때는 검색으로 여는 흐름이 맞다.
const MAX_TREE_FILES: usize = 20_000;

/// 한 디렉터리에서 한 번에 돌려주는 항목 상한. 지연 로딩은 **무시된 것까지**
/// 보여주므로 `node_modules` 같은 폴더가 그대로 열린다 — 한 단계라 깊이 폭발은
/// 없지만 폭은 막아 둔다.
const MAX_DIR_ENTRIES: usize = 5_000;

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

/// 디렉터리 한 단계의 항목. 지연 로딩 트리가 폴더를 펼칠 때마다 이것만 받는다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeDirEntry {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    /// 저장소가 무시하도록 정한 항목(gitignore · git exclude · global). 숨기지
    /// 않고 **흐리게** 그린다 — 디스크에 있는 것은 보이되 성질은 밝힌다.
    pub ignored: bool,
}

/// `code_dir` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeDirListing {
    pub entries: Vec<CodeDirEntry>,
    /// [`MAX_DIR_ENTRIES`] 에 걸려 잘렸다 — UI 가 밝힌다.
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

/// 프로젝트의 코드 파일 트리. gitignore 는 존중하되 **숨김 파일은 보여 준다** —
/// `.oculpm/` · `.claude/` · `.github/` · `.env` 처럼 실제로 편집하는 것들이
/// 전부 점 파일이라, 숨기면 이 화면이 IDE 로서 반쪽이 된다 (VS Code 탐색기도
/// 점 파일을 보여 준다). 인덱서와는 이 축에서만 시야가 다르다.
#[tauri::command]
#[specta::specta]
pub async fn code_tree(db: State<'_, Db>, project_id: u32) -> Result<CodeTree, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || build_code_tree(&root, MAX_TREE_FILES))
        .await
        .map_err(|e| format!("Failed to walk the project tree: {e}"))
}

/// 디렉터리 **한 단계**만 읽는다 — 지연 로딩 트리의 창구.
///
/// [`code_tree`] 와 시야가 다르다: 여기서는 `.git` 을 뺀 **디스크에 있는 것 전부**를
/// 돌려주고, 무시된 항목은 지우는 대신 `ignored` 로 표시한다. 한 번에 전부 걷는
/// [`code_tree`] 로는 이럴 수 없다 — 이 저장소만 해도 무시를 끄면 114,419 파일이라
/// 상한에 걸려 트리가 통째로 잘린다. 한 단계씩 읽으면 그 비용이 펼친 폴더에만 든다.
///
/// `rel_path` 가 비면 프로젝트 루트.
#[tauri::command]
#[specta::specta]
pub async fn code_dir(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeDirListing, String> {
    let root = project_root(&db, project_id).await?;
    let full = if rel_path.is_empty() {
        root.clone()
    } else {
        secure_join(&root, &rel_path)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        if !full.is_dir() {
            return Err("Not a directory".to_string());
        }
        Ok(read_dir_level(&root, &full, MAX_DIR_ENTRIES))
    })
    .await
    .map_err(|e| format!("Failed to read the directory: {e}"))?
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
    let full = canonical_within_root(&root, &full)?;
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
    tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        write_with_lock(&full, &content, &base_hash)
    })
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

/// [`secure_join`] 은 어휘적 검사만 한다 — 경로에 심링크가 끼어 있으면 루트
/// 밖 파일이 열린다 (예: 프로젝트 안 `leak → ~/.ssh/id_rsa`. 트리 걸음은
/// 심링크를 안 따라가지만 `rel_path` 는 임의의 IPC 인자다). 실존 경로로
/// 해석해 루트 안인지 다시 확인하고, 해석된 경로를 돌려준다 — 루트 안을
/// 가리키는 심링크는 그 대상으로 저장되므로 링크 자체도 깨지지 않는다.
fn canonical_within_root(root: &Path, full: &Path) -> Result<PathBuf, String> {
    let canon_root = std::fs::canonicalize(root)
        .map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let canon = std::fs::canonicalize(full).map_err(|e| format!("Failed to read file: {e}"))?;
    if canon.starts_with(&canon_root) {
        Ok(canon)
    } else {
        Err("Path escapes the project root".to_string())
    }
}

/// 걸음(파일 목록) → 중첩 트리. 폴더 우선 + 자연 정렬은 [`sort_nodes`] 가 맡고,
/// 파일이 없는 폴더는 구조적으로 생기지 않는다 (파일 경로에서만 폴더를 만든다).
fn build_code_tree(root: &Path, max_files: usize) -> CodeTree {
    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        // 숨김 필터만 끈다 — gitignore 는 그대로 둔다 (node_modules·target 까지
        // 걸으면 상한을 즉시 넘겨 트리가 통째로 잘린다).
        .hidden(false)
        // `.git` 만은 예외로 막는다. 저장소 객체 DB 는 수만 파일이라 이것 하나로
        // 상한을 다 먹고, 사람이 여기서 편집할 것은 하나도 없다. (ripgrep 도
        // `--hidden` 에 같은 예외를 둔다.) 중첩 저장소가 있으므로 깊이 무관하게.
        .filter_entry(|e| e.file_name() != ".git")
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

/// 한 디렉터리를 읽어 `ignored` 를 채운다.
///
/// 무시 여부는 직접 판정하지 않고 **같은 걸음에 한 번 더 물어서** 얻는다:
/// `max_depth(1)` 걸음이 살려 둔 이름의 집합을 만들고, `read_dir` 이 본 것 중
/// 거기 없는 것을 무시된 것으로 본다. gitignore 는 중첩 `.gitignore` · git
/// exclude · global 까지 얽혀 있어 손으로 다시 판정하면 [`code_tree`] 와 시야가
/// 어긋나기 시작한다 — 판정 주체를 하나로 둔다.
fn read_dir_level(root: &Path, dir: &Path, max_entries: usize) -> CodeDirListing {
    let mut kept: std::collections::HashSet<std::ffi::OsString> = std::collections::HashSet::new();
    for entry in ignore::WalkBuilder::new(dir)
        .standard_filters(true)
        .hidden(false)
        .max_depth(Some(1))
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
    {
        if entry.depth() == 1 {
            kept.insert(entry.file_name().to_os_string());
        }
    }

    let Ok(read) = std::fs::read_dir(dir) else {
        return CodeDirListing { entries: Vec::new(), truncated: false };
    };

    let mut entries: Vec<CodeDirEntry> = Vec::new();
    let mut truncated = false;
    for item in read.flatten() {
        let name_os = item.file_name();
        if name_os == ".git" {
            continue;
        }
        let name = name_os.to_string_lossy().to_string();
        // 심링크는 따라가지 않고 링크 자체의 종류로 본다 — 루프와 루트 밖 탈출을
        // 트리 단계에서부터 막는다 (여는 시점의 canonical 가드와 이중 방어).
        let Ok(meta) = item.metadata() else { continue };
        let full = item.path();
        let Ok(rel) = full.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if entries.len() >= max_entries {
            truncated = true;
            break;
        }
        entries.push(CodeDirEntry {
            name,
            relative_path: rel,
            is_dir: meta.is_dir(),
            ignored: !kept.contains(&name_os),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    CodeDirListing { entries, truncated }
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

/// 저장 직렬화 — 같은 파일에 저장이 동시에 두 건 들어오면 둘 다 해시 검사를
/// 통과한 뒤 서로를 덮어써, 둘 다 Saved 를 돌려주면서 한쪽 편집이 조용히
/// 사라진다. 저장은 드물고 짧아 경로별이 아닌 전역 뮤텍스로 충분하다.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 해시 대조 → 같은 디렉터리 임시 파일 → 권한 복사 → rename. 동기 IO 라
/// spawn_blocking 안에서 부른다.
fn write_with_lock(full: &Path, content: &str, base_hash: &str) -> Result<CodeWriteOutcome, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
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
        // 실패해도 저장은 계속하지만(내용 보존이 우선), 실행 비트가 조용히
        // 사라지는 종류의 회귀라 진단 가능하게 남긴다.
        if let Err(e) = std::fs::set_permissions(&tmp, meta.permissions()) {
            tracing::warn!(path = %full.display(), error = %e, "failed to preserve permissions on save");
        }
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

        let tree = build_code_tree(root, MAX_TREE_FILES);
        let top = names(&tree.nodes);
        assert!(top.contains(&"src".to_string()), "{top:?}");
        assert!(top.contains(&"README.md".to_string()), "{top:?}");
        assert!(!top.contains(&"node_modules".to_string()), "gitignore: {top:?}");
        assert!(!top.contains(&"dist".to_string()), "gitignore: {top:?}");
        assert!(!tree.truncated);
        // 폴더 우선 정렬 + 중첩 경로.
        assert!(tree.nodes[0].is_dir, "dirs first: {top:?}");
        let src = tree.nodes.iter().find(|n| n.name == "src").unwrap();
        assert_eq!(src.relative_path, "src");
        let lib = src.children.iter().find(|n| n.name == "lib.rs").unwrap();
        assert_eq!(lib.relative_path, "src/lib.rs");
        assert!(!lib.is_dir);
    }

    /// 숨김 파일은 보여 주되 `.git` 객체 DB 는 막는다 — 이 화면에서 실제로
    /// 편집하는 것이 대부분 점 파일(.oculpm·.claude·.env)이기 때문이다.
    #[test]
    fn tree_shows_hidden_files_but_never_dot_git() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"secret-ignored/\n");
        write(root, ".env", b"KEY=1");
        write(root, ".oculpm/journal/20260823/note.md", b"# hi");
        write(root, ".git/objects/ab/cdef", b"blob");
        write(root, "nested/.git/objects/12/3456", b"blob");
        write(root, "secret-ignored/.env", b"still ignored");

        let tree = build_code_tree(root, MAX_TREE_FILES);
        let top = names(&tree.nodes);
        assert!(top.contains(&".env".to_string()), "hidden file: {top:?}");
        assert!(top.contains(&".gitignore".to_string()), "hidden file: {top:?}");
        assert!(top.contains(&".oculpm".to_string()), "hidden dir: {top:?}");
        assert!(!top.contains(&".git".to_string()), "dot-git: {top:?}");
        // 숨김을 켜도 gitignore 는 여전히 이긴다.
        assert!(!top.contains(&"secret-ignored".to_string()), "gitignore: {top:?}");
        // 중첩 저장소의 .git 도 깊이와 무관하게 막힌다.
        let nested = tree.nodes.iter().find(|n| n.name == "nested");
        assert!(nested.is_none(), "nested holds only .git: {top:?}");
    }

    /// 지연 로딩의 계약 — 무시된 것도 **보이되** `ignored` 로 표시된다.
    /// (한 번에 다 걷는 `code_tree` 는 이럴 수 없다: 무시를 끄면 상한에 걸린다.)
    #[test]
    fn dir_level_shows_ignored_entries_but_flags_them() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"node_modules/\ntarget/\n*.log\n");
        write(root, "src/main.rs", b"fn main() {}");
        write(root, "node_modules/pkg/index.js", b"ignored");
        write(root, "target/debug/bin", b"ignored");
        write(root, "debug.log", b"ignored");
        write(root, ".env", b"KEY=1");

        let out = read_dir_level(root, root, MAX_DIR_ENTRIES);
        let by_name: std::collections::HashMap<&str, &CodeDirEntry> =
            out.entries.iter().map(|e| (e.name.as_str(), e)).collect();

        assert!(!out.truncated);
        assert!(by_name.contains_key("node_modules"), "ignored dir must be listed");
        assert!(by_name["node_modules"].ignored, "and flagged");
        assert!(by_name["target"].ignored);
        assert!(by_name["debug.log"].ignored);
        assert!(!by_name["src"].ignored, "tracked dir is not ignored");
        assert!(!by_name[".gitignore"].ignored, "hidden but tracked");
        assert!(!by_name[".env"].ignored, "hidden, not in this .gitignore");
        assert!(!by_name.contains_key(".git"), "the object DB is never listed");
        // 한 단계만 읽는다 — 손자는 안 나온다.
        assert!(!by_name.contains_key("index.js"), "one level only: {:?}", by_name.keys());
    }

    #[test]
    fn dir_level_reads_one_level_and_sorts_dirs_first() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "b.txt", b"x");
        write(root, "a.txt", b"x");
        write(root, "zdir/inner.txt", b"x");
        write(root, "adir/inner.txt", b"x");

        let out = read_dir_level(root, root, MAX_DIR_ENTRIES);
        let names: Vec<&str> = out.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["adir", "zdir", "a.txt", "b.txt"]);
        // 하위 디렉터리를 직접 물으면 그 단계가 나온다.
        let sub = read_dir_level(root, &root.join("zdir"), MAX_DIR_ENTRIES);
        let sub_names: Vec<&str> = sub.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(sub_names, vec!["inner.txt"]);
        assert_eq!(sub.entries[0].relative_path, "zdir/inner.txt");
    }

    #[test]
    fn dir_level_truncates_wide_directories() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for i in 0..10 {
            write(root, &format!("f{i}.txt"), b"x");
        }
        let out = read_dir_level(root, root, 4);
        assert!(out.truncated);
        assert_eq!(out.entries.len(), 4);
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

    #[test]
    fn canonical_allows_regular_file_in_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "a.txt", b"x");
        let p = canonical_within_root(root, &root.join("a.txt")).unwrap();
        assert!(p.ends_with("a.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn canonical_rejects_symlink_escaping_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::write(tmp.path().join("secret.txt"), b"top secret").unwrap();
        std::os::unix::fs::symlink(tmp.path().join("secret.txt"), root.join("leak.txt")).unwrap();

        let err = canonical_within_root(&root, &root.join("leak.txt")).unwrap_err();
        assert!(err.contains("escapes"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn canonical_resolves_symlink_within_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("real.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("alias.txt")).unwrap();

        // 루트 안 심링크는 허용 — 대상 경로로 해석돼 저장해도 링크가 안 깨진다.
        let p = canonical_within_root(&root, &root.join("alias.txt")).unwrap();
        assert!(p.ends_with("real.txt"), "{p:?}");
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

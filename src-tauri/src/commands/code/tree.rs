//! 파일 트리 — 한 번에 걷는 `code_tree` 와 한 단계씩 읽는 `code_dir`.
//!
//! 두 창구의 시야(gitignore 존중 · 숨김 파일 포함 · `.git` 제외)가 어긋나면
//! "트리에 없는 파일이 검색에 나온다" 류의 혼란이 생긴다 — 판정 주체를
//! 여기 하나로 둔다. 검색(`search`)도 같은 걸음을 쓴다.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use super::guards::canonical_within_root;
use super::project_root;
use crate::commands::fsutil::natural_cmp;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 트리 상한 — 이 이상은 `truncated` 로 알리고 자른다. gitignore 를 존중한
/// 걸음에서 소스 파일이 2만을 넘는 저장소는 트리 UI 자체가 무의미해지는
/// 크기라, 그때는 검색으로 여는 흐름이 맞다.
pub(super) const MAX_TREE_FILES: usize = 20_000;

/// 한 디렉터리에서 한 번에 돌려주는 항목 상한. 지연 로딩은 **무시된 것까지**
/// 보여주므로 `node_modules` 같은 폴더가 그대로 열린다 — 한 단계라 깊이 폭발은
/// 없지만 폭은 막아 둔다.
pub(super) const MAX_DIR_ENTRIES: usize = 5_000;

/// 코드 트리 한 노드. `relative_path` 는 프로젝트 루트 기준 슬래시 경로 —
/// 그대로 `code_read`/`code_write` 인자로 쓴다.
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

/// 걸음(파일 목록) → 중첩 트리. 폴더 우선 + 자연 정렬은 [`sort_nodes`] 가 맡고,
/// 파일이 없는 폴더는 구조적으로 생기지 않는다 (파일 경로에서만 폴더를 만든다).
pub(super) fn build_code_tree(root: &Path, max_files: usize) -> CodeTree {
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
pub(super) fn read_dir_level(root: &Path, dir: &Path, max_entries: usize) -> CodeDirListing {
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
        return CodeDirListing {
            entries: Vec::new(),
            truncated: false,
        };
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
        let Ok(rel) = full.strip_prefix(root) else {
            continue;
        };
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

/// 폴더 우선, 그다음 자연 정렬 (`fsutil::natural_cmp` — `10-x` 가
/// `2-x` 뒤에 오도록).
fn sort_nodes(nodes: &mut [CodeTreeNode]) {
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

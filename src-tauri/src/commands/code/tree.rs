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

/// 심볼릭 링크가 가리키는 곳 — 트리가 링크를 **어떻게 다룰지**를 정한다.
///
/// 여는 시점의 가드(`canonical_within_root`)는 루트 밖을 거부하는데, 트리가
/// 링크를 평범한 파일처럼 그리면 사용자는 클릭한 뒤에야 「Path escapes the
/// project root」라는 뜬금없는 보안 문구를 본다 (설치본 로그 2026-09-17/18,
/// `acestep → ~/Desktop/Local_ai/…`). 그래서 트리 단계에서 미리 판정해 싣는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SymlinkTarget {
    /// 프로젝트 안을 가리킨다 — 대상의 종류(`is_dir`)로 그리고, 평범하게 연다.
    Inside,
    /// 프로젝트 밖을 가리킨다 — 보이되 열 수 없다 (가드가 거부한다).
    Outside,
    /// 가리키는 곳이 없다 (대상이 지워졌거나 옮겨졌다).
    Dangling,
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
    /// 심볼릭 링크면 어디를 가리키는지. 평범한 항목은 `None`.
    /// `Outside`·`Dangling` 은 `is_dir` 가 항상 `false` 다 — 펼치거나 열 수
    /// 없는 것을 폴더로 그리면 드롭·펼침이 전부 가드에 부딪힌다.
    pub link: Option<SymlinkTarget>,
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
    let rel_dir = normalize_dir_path(&rel_path);
    let full = if rel_dir.is_empty() {
        root.clone()
    } else {
        secure_join(&root, &rel_dir)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        if !full.is_dir() {
            return Err("Not a directory".to_string());
        }
        Ok(read_dir_level(&root, &rel_dir, &full, MAX_DIR_ENTRIES))
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

/// `code_dir` 의 `rel_path` 인자 정리 — 슬래시 방향·양끝·중복 슬래시. 자식의
/// `relative_path` 가 이 접두로 만들어지므로 여기서 한 번 고른다.
pub(super) fn normalize_dir_path(rel: &str) -> String {
    rel.replace('\\', "/")
        .split('/')
        .filter(|seg| !seg.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// 심링크 항목의 판정 — 대상을 끝까지 풀어 루트 안인지, 그리고 폴더인지.
///
/// `Outside`·`Dangling` 은 `is_dir = false` 로 고정한다: 열 수도 펼칠 수도 없는
/// 것을 폴더로 그리면 드롭 대상·펼침이 전부 가드에 부딪히며 오류를 낸다.
fn classify_symlink(canon_root: &Path, full: &Path) -> (bool, SymlinkTarget) {
    match std::fs::canonicalize(full) {
        Ok(target) if target.starts_with(canon_root) => (target.is_dir(), SymlinkTarget::Inside),
        Ok(_) => (false, SymlinkTarget::Outside),
        Err(_) => (false, SymlinkTarget::Dangling),
    }
}

/// 한 디렉터리를 읽어 `ignored` 와 `link` 를 채운다.
///
/// `rel_dir` 은 사용자가 펼친 폴더의 **프로젝트 상대 경로**(루트는 `""`) 다.
/// 자식의 `relative_path` 는 `dir` 에서 `root` 를 떼어 만들지 않고 이 접두에
/// 이름을 붙여 만든다 — `dir` 은 canonical 이라 루트 안을 가리키는 심링크
/// 폴더를 펼치면 **대상**의 경로가 되어 트리의 자리(링크 이름)와 어긋나고,
/// 루트 자체가 심링크 아래에 있으면(`/tmp` → `/private/tmp`) 접두가 안 맞아
/// 목록이 통째로 빈다.
///
/// 무시 여부는 직접 판정하지 않고 **같은 걸음에 한 번 더 물어서** 얻는다:
/// `max_depth(1)` 걸음이 살려 둔 이름의 집합을 만들고, `read_dir` 이 본 것 중
/// 거기 없는 것을 무시된 것으로 본다. gitignore 는 중첩 `.gitignore` · git
/// exclude · global 까지 얽혀 있어 손으로 다시 판정하면 [`code_tree`] 와 시야가
/// 어긋나기 시작한다 — 판정 주체를 하나로 둔다.
pub(super) fn read_dir_level(
    root: &Path,
    rel_dir: &str,
    dir: &Path,
    max_entries: usize,
) -> CodeDirListing {
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
    // 심링크 판정의 기준. 루트를 못 풀면(지워진 프로젝트) 링크는 전부 밖으로
    // 본다 — 안이라고 잘못 말하는 쪽이 더 나쁘다.
    let canon_root = std::fs::canonicalize(root).ok();

    let mut entries: Vec<CodeDirEntry> = Vec::new();
    let mut truncated = false;
    for item in read.flatten() {
        let name_os = item.file_name();
        if name_os == ".git" {
            continue;
        }
        let name = name_os.to_string_lossy().to_string();
        // `DirEntry::metadata` 는 링크를 따라가지 않는다 — 심링크는 여기서
        // 따로 판정한다. 안 하면 링크 폴더가 **파일처럼** 그려지고, 클릭한
        // 뒤에야 가드의 거절을 본다.
        let Ok(meta) = item.metadata() else { continue };
        let full = item.path();
        let (is_dir, link) = if meta.is_symlink() {
            let (is_dir, target) = match &canon_root {
                Some(canon_root) => classify_symlink(canon_root, &full),
                None => (false, SymlinkTarget::Outside),
            };
            (is_dir, Some(target))
        } else {
            (meta.is_dir(), None)
        };
        let rel = if rel_dir.is_empty() {
            name.clone()
        } else {
            format!("{rel_dir}/{name}")
        };
        if entries.len() >= max_entries {
            truncated = true;
            break;
        }
        entries.push(CodeDirEntry {
            name,
            relative_path: rel,
            is_dir,
            ignored: !kept.contains(&name_os),
            link,
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

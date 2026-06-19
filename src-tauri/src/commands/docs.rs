//! `./docs` 문서 뷰어 — 프로젝트 루트의 `docs/` 폴더를 읽기 전용 위키처럼 탐색·렌더한다.
//!
//! SSOT 는 디스크의 마크다운이다. `.oculpm` 저널과 달리 SQLite 캐시를 두지 않고
//! 요청마다 직접 읽는다 — docs 는 자주 바뀌지 않고 한 번에 읽는 양도 작다.
//!
//! 보안: 모든 읽기 경로는 [`secure_docs_join`] 을 거쳐 `root/docs` 밖으로 탈출할 수
//! 없도록 강제한다 (project.rs 의 `secure_join` 패턴을 docs 하위로 좁힌 것).

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::db::Db;

/// 프로젝트 루트 기준 문서 폴더 이름. v1 은 `docs` 고정 (CLAUDE.md 의 docs/ 컨벤션).
const DOCS_DIRNAME: &str = "docs";

/// 트리에 노출할 마크다운 확장자. 이미지는 인라인 참조로만 로드하므로 트리엔 넣지 않는다.
const MD_EXTS: &[&str] = &["md", "markdown", "mdx"];

/// docs 트리 한 노드. `relative_path` 는 **프로젝트 루트 기준** 슬래시 경로
/// (예: `docs/graph-upgrade/00-master-plan.md`) — 그대로 `docs_read`/`docs_asset` 인자로 쓴다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DocsTreeNode {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<DocsTreeNode>,
}

/// `docs_tree` 응답. `exists=false` 면 프로젝트에 `docs/` 폴더가 없다 (빈 상태 UI).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DocsTree {
    pub exists: bool,
    pub nodes: Vec<DocsTreeNode>,
}

/// `docs_asset` 응답 — 이미지 바이트를 base64 + MIME 으로. 프런트는 `data:` URI 로 조립한다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DocsAsset {
    pub mime: String,
    pub base64: String,
}

/// 16MB 초과 이미지는 거부 — base64 는 ~33% 부풀고 webview 로 통째로 넘기므로 상한을 둔다.
const MAX_ASSET_BYTES: usize = 16 * 1024 * 1024;

/// 프로젝트 `docs/` 폴더를 마크다운 트리로 반환한다. 폴더가 없으면 `exists=false`.
#[tauri::command]
#[specta::specta]
pub async fn docs_tree(db: State<'_, Db>, project_id: u32) -> Result<DocsTree, String> {
    let root = project_root(&db, project_id).await?;
    let docs_dir = root.join(DOCS_DIRNAME);
    if !docs_dir.is_dir() {
        return Ok(DocsTree {
            exists: false,
            nodes: Vec::new(),
        });
    }
    let mut nodes = build_docs_nodes(&root, &docs_dir);
    sort_docs(&mut nodes);
    Ok(DocsTree {
        exists: true,
        nodes,
    })
}

/// 단일 문서의 마크다운 본문을 읽는다. `rel_path` 는 프로젝트 루트 기준 (`docs/...`).
#[tauri::command]
#[specta::specta]
pub async fn docs_read(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<String, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_docs_join(&root, &rel_path)?;
    tokio::fs::read_to_string(&full)
        .await
        .map_err(|e| format!("문서를 읽지 못했습니다: {e}"))
}

/// 문서가 참조하는 이미지를 base64 로 읽는다. `rel_path` 는 프로젝트 루트 기준.
#[tauri::command]
#[specta::specta]
pub async fn docs_asset(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<DocsAsset, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_docs_join(&root, &rel_path)?;
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("이미지를 읽지 못했습니다: {e}"))?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("이미지가 너무 큽니다 (16MB 초과)".to_string());
    }
    let mime = mime_for(&full);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(DocsAsset {
        mime,
        base64: encoded,
    })
}

// ─── helpers ────────────────────────────────────────────────────────────────

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// `root/docs` 안으로 정규화 + 가둔다. `..` 등으로 docs 밖을 가리키면 거부.
fn secure_docs_join(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let clean = crate::indexer::clean_path(&root.join(rel_path));
    let docs_dir = crate::indexer::clean_path(&root.join(DOCS_DIRNAME));
    if clean.starts_with(&docs_dir) {
        Ok(clean)
    } else {
        Err("접근이 거부되었습니다: docs 폴더 밖의 경로입니다".to_string())
    }
}

/// `dir` 을 재귀적으로 걸어 마크다운 파일 + (마크다운을 품은) 폴더만 트리로 만든다.
/// 마크다운이 하나도 없는 폴더, 숨김(.) 항목, 심볼릭 링크는 제외한다. 공개(테스트용).
fn build_docs_nodes(root: &Path, dir: &Path) -> Vec<DocsTreeNode> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        // 심볼릭 링크는 루프/탈출 위험이 있어 따라가지 않는다.
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let rel = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if file_type.is_dir() {
            let children = build_docs_nodes(root, &path);
            // 마크다운 후손이 없는 폴더는 위키에서 노이즈이므로 가지치기.
            if children.is_empty() {
                continue;
            }
            out.push(DocsTreeNode {
                name,
                relative_path: rel,
                is_dir: true,
                children,
            });
        } else if is_markdown(&path) {
            out.push(DocsTreeNode {
                name,
                relative_path: rel,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }
    out
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MD_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// README/index 를 각 단계 최상단에 고정하고, 나머지는 자연 정렬(숫자 인지)한다.
/// docs 의 `00-`, `01-` 접두 컨벤션이 사람이 읽는 순서 그대로 나오도록.
fn sort_docs(nodes: &mut Vec<DocsTreeNode>) {
    nodes.sort_by(|a, b| {
        pin_rank(&a.name)
            .cmp(&pin_rank(&b.name))
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    for n in nodes.iter_mut() {
        sort_docs(&mut n.children);
    }
}

fn pin_rank(name: &str) -> u8 {
    let lower = name.to_lowercase();
    if lower == "readme.md" || lower == "index.md" {
        0
    } else {
        1
    }
}

/// 자연 정렬: 숫자 런은 수치로, 나머지는 소문자 사전식으로 비교.
/// 예: `2-x.md` < `10-x.md` (사전식이면 `10` < `2` 가 되는 문제를 피한다).
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na = take_digits(&mut ai);
                    let nb = take_digits(&mut bi);
                    // 앞자리 0 제거 후 자릿수 → 사전식으로 수치 비교 (파싱 오버플로 회피).
                    let va = na.trim_start_matches('0');
                    let vb = nb.trim_start_matches('0');
                    let ord = va.len().cmp(&vb.len()).then_with(|| va.cmp(vb));
                    if ord != Ordering::Equal {
                        return ord;
                    }
                } else {
                    if ca != cb {
                        return ca.cmp(&cb);
                    }
                    ai.next();
                    bi.next();
                }
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    while let Some(c) = it.peek().copied() {
        if c.is_ascii_digit() {
            s.push(c);
            it.next();
        } else {
            break;
        }
    }
    s
}

fn mime_for(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, contents: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, contents).unwrap();
    }

    fn names(nodes: &[DocsTreeNode]) -> Vec<String> {
        nodes.iter().map(|n| n.name.clone()).collect()
    }

    #[test]
    fn lists_markdown_and_prunes_empty_dirs() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "docs/README.md", "# hi");
        write(root, "docs/01-spec.md", "spec");
        write(root, "docs/img/logo.png", "binary"); // 이미지뿐인 폴더 → 가지치기
        write(root, "docs/sub/02-deep.md", "deep");
        write(root, "docs/notes.txt", "ignored"); // 비마크다운 → 제외

        let docs = root.join("docs");
        let mut nodes = build_docs_nodes(root, &docs);
        sort_docs(&mut nodes);

        let top = names(&nodes);
        assert!(top.contains(&"README.md".to_string()));
        assert!(top.contains(&"01-spec.md".to_string()));
        assert!(top.contains(&"sub".to_string()));
        assert!(!top.contains(&"img".to_string()), "이미지뿐인 폴더는 제외: {top:?}");
        assert!(!top.contains(&"notes.txt".to_string()), "비마크다운 제외: {top:?}");
    }

    #[test]
    fn relative_paths_are_project_root_relative() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "docs/sub/02-deep.md", "deep");
        let mut nodes = build_docs_nodes(root, &root.join("docs"));
        sort_docs(&mut nodes);
        let sub = nodes.iter().find(|n| n.name == "sub").unwrap();
        assert_eq!(sub.relative_path, "docs/sub");
        let leaf = &sub.children[0];
        assert_eq!(leaf.relative_path, "docs/sub/02-deep.md");
        assert!(!leaf.is_dir);
    }

    #[test]
    fn readme_pinned_then_natural_numeric_order() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for f in ["10-ten.md", "2-two.md", "00-zero.md", "README.md", "alpha.md"] {
            write(root, &format!("docs/{f}"), "x");
        }
        let mut nodes = build_docs_nodes(root, &root.join("docs"));
        sort_docs(&mut nodes);
        assert_eq!(
            names(&nodes),
            vec!["README.md", "00-zero.md", "2-two.md", "10-ten.md", "alpha.md"],
        );
    }

    #[test]
    fn secure_docs_join_blocks_traversal() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "docs/ok.md", "x");
        write(root, "secret.txt", "nope");

        assert!(secure_docs_join(root, "docs/ok.md").is_ok());
        // docs 밖 (프로젝트 루트 파일) — 거부
        assert!(secure_docs_join(root, "secret.txt").is_err());
        // 트래버설로 루트 위 탈출 시도 — 거부
        assert!(secure_docs_join(root, "docs/../secret.txt").is_err());
        assert!(secure_docs_join(root, "docs/../../etc/passwd").is_err());
    }

    #[test]
    fn mime_detection() {
        assert_eq!(mime_for(Path::new("a/b.png")), "image/png");
        assert_eq!(mime_for(Path::new("a/b.JPG")), "image/jpeg");
        assert_eq!(mime_for(Path::new("a/b.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a/b.unknown")), "application/octet-stream");
    }
}

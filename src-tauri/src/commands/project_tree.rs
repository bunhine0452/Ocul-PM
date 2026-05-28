//! Project file tree builder for the Lite-W6 FileExplorer rewrite (PR8).
//!
//! Walks the project root with the `ignore` crate (respects `.gitignore` and
//! sibling rules) plus forced excludes for `.git/` and `.oculpm/` so the tree
//! stays readable in a real dogfood checkout. Returns a single rooted tree
//! the frontend can render directly — no flattening required.

use std::path::{Path, PathBuf};

use ignore::{overrides::OverrideBuilder, WalkBuilder};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ProjectTreeNode {
    pub name: String,
    /// Forward-slash relative path from the project root. `""` for the root
    /// node so the frontend can use it as the React key without collisions.
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<ProjectTreeNode>,
}

#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
pub struct ListProjectTreeOpts {
    /// Cap on directory descent. `None` walks the entire tree (default).
    pub max_depth: Option<u32>,
}

#[tauri::command]
#[specta::specta]
pub async fn list_project_tree(
    db: State<'_, Db>,
    project_id: u32,
    opts: Option<ListProjectTreeOpts>,
) -> Result<ProjectTreeNode, String> {
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    let project = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;

    let root = PathBuf::from(&project.root_path);
    if !root.exists() {
        return Err(format!(
            "project root does not exist: {}",
            root.display()
        ));
    }

    let opts = opts.unwrap_or_default();
    Ok(build_project_tree(&root, opts.max_depth))
}

/// Walk `root` and assemble the tree. Public for unit testing.
pub fn build_project_tree(root: &Path, max_depth: Option<u32>) -> ProjectTreeNode {
    let mut root_node = ProjectTreeNode {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        relative_path: String::new(),
        is_dir: true,
        children: Vec::new(),
    };

    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(true)
        // Surface dotfiles (`.gitignore`, `.env.example`, `.github/`) — only
        // the explicit excludes below should disappear.
        .hidden(false)
        // Respect .gitignore even when the project isn't a git checkout.
        .require_git(false);
    if let Some(depth) = max_depth {
        builder.max_depth(Some(depth as usize));
    }

    let mut overrides = OverrideBuilder::new(root);
    // OverrideBuilder treats `!pattern` as an *exclusion* on top of the
    // standard ignore rules (mirrors the convention in indexer.rs:74).
    let _ = overrides.add("!.git/");
    let _ = overrides.add("!.oculpm/");
    if let Ok(ov) = overrides.build() {
        builder.overrides(ov);
    }

    let walker = builder.build();
    for entry in walker.flatten() {
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel = match path.strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str.is_empty() {
            continue;
        }
        let parts: Vec<&str> = rel_str.split('/').filter(|s| !s.is_empty()).collect();
        if parts.is_empty() {
            continue;
        }

        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        insert_into_tree(&mut root_node, &parts, is_dir);
    }

    sort_tree(&mut root_node);
    root_node
}

fn insert_into_tree(node: &mut ProjectTreeNode, parts: &[&str], leaf_is_dir: bool) {
    if parts.is_empty() {
        return;
    }
    let head = parts[0];
    let rest = &parts[1..];
    let mut path_so_far = node.relative_path.clone();
    if !path_so_far.is_empty() {
        path_so_far.push('/');
    }
    path_so_far.push_str(head);

    let pos = node.children.iter().position(|c| c.name == head);
    let idx = if let Some(idx) = pos {
        idx
    } else {
        node.children.push(ProjectTreeNode {
            name: head.to_string(),
            relative_path: path_so_far,
            is_dir: if rest.is_empty() { leaf_is_dir } else { true },
            children: Vec::new(),
        });
        node.children.len() - 1
    };

    if !rest.is_empty() {
        insert_into_tree(&mut node.children[idx], rest, leaf_is_dir);
    } else if pos.is_some() {
        // The walker can yield a directory before some of its children — make
        // sure the leaf-vs-dir flag reflects the latest visit.
        node.children[idx].is_dir = leaf_is_dir;
    }
}

fn sort_tree(node: &mut ProjectTreeNode) {
    node.children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    for child in &mut node.children {
        sort_tree(child);
    }
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

    fn names(node: &ProjectTreeNode) -> Vec<String> {
        node.children.iter().map(|c| c.name.clone()).collect()
    }

    #[test]
    fn excludes_oculpm_and_git_dirs() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "src/main.rs", "fn main() {}");
        write(tmp.path(), ".oculpm/config.toml", "x = 1");
        write(tmp.path(), ".oculpm/journal/2026-05-29/a.md", "hi");
        write(tmp.path(), ".git/HEAD", "ref: refs/heads/main");
        write(tmp.path(), "README.md", "# hi");

        let tree = build_project_tree(tmp.path(), None);
        let top = names(&tree);
        assert!(!top.iter().any(|n| n == ".oculpm"), "{:?}", top);
        assert!(!top.iter().any(|n| n == ".git"), "{:?}", top);
        assert!(top.iter().any(|n| n == "src"));
        assert!(top.iter().any(|n| n == "README.md"));
    }

    #[test]
    fn respects_gitignore_node_modules() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".gitignore", "node_modules/\n");
        write(tmp.path(), "src/app.ts", "export {};");
        write(tmp.path(), "node_modules/dep/index.js", "module.exports = {};");

        let tree = build_project_tree(tmp.path(), None);
        let top = names(&tree);
        assert!(!top.iter().any(|n| n == "node_modules"), "{:?}", top);
        assert!(top.iter().any(|n| n == "src"));
    }

    #[test]
    fn sorts_dirs_before_files_then_alphabetical() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "zeta/inner.txt", "");
        write(tmp.path(), "alpha.txt", "");
        write(tmp.path(), "bravo.txt", "");
        write(tmp.path(), "delta/inner.txt", "");

        let tree = build_project_tree(tmp.path(), None);
        let names_lower: Vec<String> = tree
            .children
            .iter()
            .map(|c| c.name.to_lowercase())
            .collect();
        assert_eq!(names_lower, vec!["delta", "zeta", "alpha.txt", "bravo.txt"]);
    }

    #[test]
    fn populates_relative_path_for_nested_nodes() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "src/features/today/index.tsx", "");

        let tree = build_project_tree(tmp.path(), None);
        // src
        let src = tree
            .children
            .iter()
            .find(|c| c.name == "src")
            .expect("src exists");
        assert_eq!(src.relative_path, "src");
        assert!(src.is_dir);
        // src/features
        let features = src
            .children
            .iter()
            .find(|c| c.name == "features")
            .expect("features exists");
        assert_eq!(features.relative_path, "src/features");
        // leaf
        let today = features
            .children
            .iter()
            .find(|c| c.name == "today")
            .unwrap();
        let leaf = today.children.iter().find(|c| c.name == "index.tsx").unwrap();
        assert_eq!(leaf.relative_path, "src/features/today/index.tsx");
        assert!(!leaf.is_dir);
    }

    #[test]
    fn respects_max_depth() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "a/b/c/leaf.txt", "");

        let shallow = build_project_tree(tmp.path(), Some(2));
        let a = shallow.children.iter().find(|c| c.name == "a").unwrap();
        let b = a.children.iter().find(|c| c.name == "b").unwrap();
        // max_depth=2 — `a` (depth 1) and `b` (depth 2) emitted; deeper skipped.
        assert!(b.children.is_empty(), "{:?}", b.children);
    }
}

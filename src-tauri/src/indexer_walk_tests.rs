//! `walk_text_files` · `is_indexable_path` 가 무엇을 걷지 않는가 (`indexer.rs` 에서 옮겨 왔다).

use super::*;
use std::fs;

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn rel_paths(root: &Path, config: &IndexConfig) -> Vec<String> {
    let mut v: Vec<String> = walk_text_files(root, config)
        .into_iter()
        .map(|p| crate::git::slash(p.strip_prefix(root).unwrap()))
        .collect();
    v.sort();
    v
}

/// 2026-08-30 사고 재현: `.git` 이 없어도 `.gitignore` 는 적용돼야 한다.
#[test]
fn gitignore_is_honored_without_a_git_dir() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, ".gitignore", "generated/\n");
    write(root, "src/a.ts", "export const a = 1;\n");
    write(root, "generated/big.ts", "export const g = 1;\n");
    assert!(!root.join(".git").exists());
    assert_eq!(rel_paths(root, &IndexConfig::default()), vec!["src/a.ts"]);
}

/// 보안 피드백 2차 — `is_file()` 이 링크를 따라가, 저장소에 심은
/// `notes.txt -> 밖의 비밀` 이 프로젝트를 열자마자 색인(청크·임베딩)됐다.
#[test]
fn a_file_link_is_never_indexed() {
    let dir = tempfile::tempdir().unwrap();
    let (root, outside) = (dir.path().join("proj"), dir.path().join("outside"));
    write(&root, "src/a.ts", "export const a = 1;\n");
    write(&outside, "secret.txt", "TOKEN=abc\n");
    if !crate::test_links::file(&outside.join("secret.txt"), &root.join("notes.txt")) {
        return;
    }
    assert_eq!(rel_paths(&root, &IndexConfig::default()), vec!["src/a.ts"]);
    assert!(!is_indexable_path(
        &root,
        Path::new("notes.txt"),
        &IndexConfig::default()
    ));
}

/// `.gitignore` 자체가 없어도 벤더 디렉터리는 절대 걷지 않는다.
#[test]
fn vendor_dirs_are_denied_without_any_gitignore() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "src/a.ts", "export const a = 1;\n");
    write(root, "node_modules/pkg/index.js", "module.exports = 1;\n");
    write(
        root,
        "nested/node_modules/pkg/index.js",
        "module.exports = 1;\n",
    );
    write(root, "target/debug/build.rs", "fn main() {}\n");
    write(root, "__pycache__/x.pyc.py", "x = 1\n");
    assert_eq!(rel_paths(root, &IndexConfig::default()), vec!["src/a.ts"]);
    // 워처 경로 판정도 같은 그물을 쓴다.
    assert!(!is_indexable_path(
        root,
        Path::new("node_modules/pkg/index.js"),
        &IndexConfig::default()
    ));
    assert!(is_indexable_path(
        root,
        Path::new("src/a.ts"),
        &IndexConfig::default()
    ));
}

/// `{#idx-nested-worktree}` — 루트 아래 연결된 worktree 는 걷기·워처 판정 모두
/// 건너뛰고, 서브모듈은 남긴다. 루트가 worktree 여도 그 파일은 색인한다.
#[test]
fn linked_worktrees_under_the_root_are_not_walked() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("proj");
    write(&root, "src/a.ts", "export const a = 1;\n");
    write(
        &root,
        "wt/feat/.git",
        "gitdir: /x/proj/.git/worktrees/feat\n",
    );
    write(&root, "wt/feat/src/a.ts", "export const a = 2;\n");
    write(
        &root,
        "libs/sub/.git",
        "gitdir: ../../.git/modules/libs/sub\n",
    );
    write(&root, "libs/sub/b.ts", "export const b = 1;\n");
    let cfg = IndexConfig::default();
    assert_eq!(rel_paths(&root, &cfg), vec!["libs/sub/b.ts", "src/a.ts"]);
    assert!(!is_indexable_path(
        &root,
        Path::new("wt/feat/src/a.ts"),
        &cfg
    ));
    assert!(is_indexable_path(&root, Path::new("libs/sub/b.ts"), &cfg));

    let wt_root = root.join("wt/feat");
    assert_eq!(rel_paths(&wt_root, &cfg), vec!["src/a.ts"]);
    assert!(is_indexable_path(&wt_root, Path::new("src/a.ts"), &cfg));
}

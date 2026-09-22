//! 트리(`code_tree`) · 디렉터리 한 단계(`code_dir`) 의 단위 테스트 —
//! `tests.rs` 가 파일 크기 래칫에 걸려 갈라 냈다. 도우미 `write` 는 그쪽 것을
//! 그대로 쓴다.

use super::tests::write;
use super::*;
use std::fs;
use tempfile::TempDir;

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
    assert!(
        !top.contains(&"node_modules".to_string()),
        "gitignore: {top:?}"
    );
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
    assert!(
        top.contains(&".gitignore".to_string()),
        "hidden file: {top:?}"
    );
    assert!(top.contains(&".oculpm".to_string()), "hidden dir: {top:?}");
    assert!(!top.contains(&".git".to_string()), "dot-git: {top:?}");
    // 숨김을 켜도 gitignore 는 여전히 이긴다.
    assert!(
        !top.contains(&"secret-ignored".to_string()),
        "gitignore: {top:?}"
    );
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

    let out = read_dir_level(root, "", root, MAX_DIR_ENTRIES);
    let by_name: std::collections::HashMap<&str, &CodeDirEntry> =
        out.entries.iter().map(|e| (e.name.as_str(), e)).collect();

    assert!(!out.truncated);
    assert!(
        by_name.contains_key("node_modules"),
        "ignored dir must be listed"
    );
    assert!(by_name["node_modules"].ignored, "and flagged");
    assert!(by_name["target"].ignored);
    assert!(by_name["debug.log"].ignored);
    assert!(!by_name["src"].ignored, "tracked dir is not ignored");
    assert!(!by_name[".gitignore"].ignored, "hidden but tracked");
    assert!(!by_name[".env"].ignored, "hidden, not in this .gitignore");
    assert!(
        !by_name.contains_key(".git"),
        "the object DB is never listed"
    );
    // 한 단계만 읽는다 — 손자는 안 나온다.
    assert!(
        !by_name.contains_key("index.js"),
        "one level only: {:?}",
        by_name.keys()
    );
}

#[test]
fn dir_level_reads_one_level_and_sorts_dirs_first() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "b.txt", b"x");
    write(root, "a.txt", b"x");
    write(root, "zdir/inner.txt", b"x");
    write(root, "adir/inner.txt", b"x");

    let out = read_dir_level(root, "", root, MAX_DIR_ENTRIES);
    let names: Vec<&str> = out.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["adir", "zdir", "a.txt", "b.txt"]);
    // 하위 디렉터리를 직접 물으면 그 단계가 나온다.
    let sub = read_dir_level(root, "zdir", &root.join("zdir"), MAX_DIR_ENTRIES);
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
    let out = read_dir_level(root, "", root, 4);
    assert!(out.truncated);
    assert_eq!(out.entries.len(), 4);
}

/// 설치본 로그 2026-09-17/18: 루트 밖 폴더를 가리키는 심링크(`acestep`)가
/// 트리에 **파일처럼** 그려져, 클릭하면 「Path escapes the project root」가
/// 떴다. 트리가 미리 판정해 싣는다 — 밖은 `Outside` + 파일 아님·폴더 아님,
/// 안은 대상의 종류로, 깨진 것은 `Dangling`.
#[test]
fn dir_level_classifies_symlinks_by_target() {
    let tmp = TempDir::new().unwrap();
    let outside = tmp.path().join("outside");
    fs::create_dir_all(outside.join("sub")).unwrap();
    fs::write(outside.join("secret.txt"), b"x").unwrap();
    let root = tmp.path().join("root");
    write(&root, "real/inner.txt", b"x");
    write(&root, "plain.txt", b"x");
    std::os::unix::fs::symlink(&outside, root.join("escape_dir")).unwrap();
    std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("escape_file")).unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("alias_dir")).unwrap();
    std::os::unix::fs::symlink(root.join("plain.txt"), root.join("alias_file")).unwrap();
    std::os::unix::fs::symlink(root.join("gone.txt"), root.join("broken")).unwrap();

    let out = read_dir_level(&root, "", &root, MAX_DIR_ENTRIES);
    let by_name: std::collections::HashMap<&str, &CodeDirEntry> =
        out.entries.iter().map(|e| (e.name.as_str(), e)).collect();

    // 밖 — 보이되 폴더가 아니다(펼칠 수 없다).
    let e = by_name["escape_dir"];
    assert_eq!(e.link, Some(SymlinkTarget::Outside));
    assert!(!e.is_dir, "밖을 가리키는 링크 폴더는 폴더로 그리지 않는다");
    assert_eq!(by_name["escape_file"].link, Some(SymlinkTarget::Outside));
    // 안 — 대상의 종류를 따른다.
    let a = by_name["alias_dir"];
    assert_eq!(a.link, Some(SymlinkTarget::Inside));
    assert!(a.is_dir, "안을 가리키는 링크 폴더는 폴더다");
    let f = by_name["alias_file"];
    assert_eq!(f.link, Some(SymlinkTarget::Inside));
    assert!(!f.is_dir);
    // 깨진 것.
    assert_eq!(by_name["broken"].link, Some(SymlinkTarget::Dangling));
    assert!(!by_name["broken"].is_dir);
    // 평범한 항목은 표시가 없다.
    assert_eq!(by_name["real"].link, None);
    assert_eq!(by_name["plain.txt"].link, None);
    // 밖을 가리키는 링크는 여는 가드도 여전히 거부한다 — 트리 표시는 가드를
    // 대체하지 않고 **앞에서** 알릴 뿐이다.
    assert!(canonical_within_root(&root, &root.join("escape_dir")).is_err());
    assert!(canonical_within_root(&root, &root.join("escape_file")).is_err());
}

/// 안을 가리키는 링크 폴더를 펼치면 자식은 **링크 자리**의 경로를 받는다 —
/// canonical 대상(`real/inner.txt`)이 아니라 `alias_dir/inner.txt`. 대상의
/// 경로를 주면 트리는 `alias_dir` 아래에 `real/…` 을 그려 자리와 이름이
/// 어긋나고, 조상 펼침·선택 강조가 전부 빗나간다. 루트 자체가 심링크 아래에
/// 있어도(`/tmp` → `/private/tmp`) 같은 이유로 접두가 어긋나지 않아야 한다.
#[test]
fn dir_level_builds_child_paths_from_the_requested_dir_not_the_canonical_one() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("root");
    write(&root, "real/inner.txt", b"x");
    std::os::unix::fs::symlink(root.join("real"), root.join("alias_dir")).unwrap();

    // 커맨드가 하는 그대로: 링크를 canonical 로 풀어 읽되, 접두는 요청 경로.
    let canon = canonical_within_root(&root, &root.join("alias_dir")).unwrap();
    assert!(canon.ends_with("real"));
    let out = read_dir_level(&root, "alias_dir", &canon, MAX_DIR_ENTRIES);
    assert_eq!(out.entries.len(), 1);
    assert_eq!(out.entries[0].relative_path, "alias_dir/inner.txt");
    // 그 경로는 그대로 열 수 있어야 한다 (가드가 링크를 풀어 안으로 본다).
    assert!(canonical_within_root(&root, &root.join("alias_dir/inner.txt")).is_ok());

    // 심링크 아래의 루트: TempDir 자체를 링크로 한 번 더 감싼다.
    let linked_root = tmp.path().join("root_link");
    std::os::unix::fs::symlink(&root, &linked_root).unwrap();
    let canon_sub = canonical_within_root(&linked_root, &linked_root.join("real")).unwrap();
    let out = read_dir_level(&linked_root, "real", &canon_sub, MAX_DIR_ENTRIES);
    assert_eq!(
        out.entries
            .iter()
            .map(|e| e.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["real/inner.txt"],
        "루트가 심링크 아래에 있어도 목록이 비지 않는다"
    );
}

/// `rel_path` 인자의 정리 — 프런트가 만든 경로는 이미 깨끗하지만 IPC 인자다.
#[test]
fn normalize_dir_path_trims_slashes() {
    assert_eq!(normalize_dir_path(""), "");
    assert_eq!(normalize_dir_path("/"), "");
    assert_eq!(normalize_dir_path("src/"), "src");
    assert_eq!(normalize_dir_path("/src//a\\b/"), "src/a/b");
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

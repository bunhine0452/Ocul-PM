//! `files_touched` 를 안 준 일지는 git 작업 트리로 채운다 — 추정이고, 그렇게 말한다.

use serde_json::json;

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::mcp::tools::call_tool;

fn git(root: &std::path::Path, args: &[&str]) {
    // git 은 `git::safe` 만 띄운다 — 저장소 설정이 고른 명령을 끄는 창구가 하나여야 한다.
    let out = crate::git::safe::output(&mut crate::git::safe::cmd(root, args)).expect("git");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn repo() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    git(&root, &["init", "-q"]);
    git(&root, &["config", "user.email", "t@example.com"]);
    git(&root, &["config", "user.name", "t"]);
    std::fs::write(root.join("kept.rs"), "fn k() {}\n").unwrap();
    git(&root, &["add", "kept.rs"]);
    git(&root, &["commit", "-q", "-m", "init"]);
    (dir, root)
}

fn write_entry(root: &std::path::Path, args: serde_json::Value) -> (serde_json::Value, String) {
    let out = call_tool(root, "journal_write", &args).expect("journal_write");
    let rel = out["path"].as_str().unwrap().to_string();
    let md = std::fs::read_to_string(root.join(&rel)).unwrap();
    (out, md)
}

#[test]
fn an_entry_without_files_gets_the_working_tree_changes_as_an_estimate() {
    let (_dir, root) = repo();
    std::fs::write(root.join("kept.rs"), "fn k() { /* edited */ }\n").unwrap();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/new.rs"), "fn n() {}\n").unwrap();
    // .oculpm 아래는 작업의 손자국이 아니다.
    std::fs::write(root.join(".oculpm/scratch.md"), "x").unwrap();

    let (out, md) = write_entry(
        &root,
        json!({ "type": "chore", "slug": "no-files", "title": "t", "body_markdown": "## 변경 요약\nx\n\n## 검증\ny\n" }),
    );
    let warnings = out["warnings"].to_string();
    assert!(warnings.contains("추정"), "{warnings}");
    let (pf, _) = parse_frontmatter_and_body(&md);
    let fm = pf.parsed.expect("parsed");
    let mut paths: Vec<(String, String)> = fm
        .files_touched
        .iter()
        .map(|f| (f.path.clone(), format!("{:?}", f.op).to_ascii_lowercase()))
        .collect();
    paths.sort();
    assert_eq!(
        paths,
        [
            ("kept.rs".to_string(), "update".to_string()),
            ("src/new.rs".to_string(), "create".to_string())
        ]
    );
    assert!(
        fm.tags.iter().any(|t| t == "files-inferred"),
        "{:?}",
        fm.tags
    );
}

#[test]
fn an_explicit_empty_list_or_a_clean_tree_is_left_alone() {
    let (_dir, root) = repo();
    std::fs::write(root.join("kept.rs"), "fn k() { /* edited */ }\n").unwrap();
    // 빈 배열을 **명시**한 것은 「건드린 파일 없음」이다 — 지어내지 않는다.
    let (out, md) = write_entry(
        &root,
        json!({ "type": "chore", "slug": "explicit-empty", "title": "t", "body_markdown": "## 변경 요약\nx\n\n## 검증\ny\n", "files_touched": [] }),
    );
    assert!(!out["warnings"].to_string().contains("추정"));
    let fm = parse_frontmatter_and_body(&md).0.parsed.unwrap();
    assert!(fm.files_touched.is_empty());
    assert!(!fm.tags.iter().any(|t| t == "files-inferred"));

    // 깨끗한 트리면 채울 것이 없다.
    git(&root, &["commit", "-q", "-am", "edit"]);
    let (out, md) = write_entry(
        &root,
        json!({ "type": "chore", "slug": "clean-tree", "title": "t", "body_markdown": "## 변경 요약\nx\n\n## 검증\ny\n" }),
    );
    assert!(!out["warnings"].to_string().contains("추정"));
    assert!(parse_frontmatter_and_body(&md)
        .0
        .parsed
        .unwrap()
        .files_touched
        .is_empty());
}

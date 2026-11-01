//! `git` 모듈 단위 테스트 — 패치 가르기·스냅샷 렌더·거터·porcelain 매핑·중첩
//! 저장소 회귀. 예전 `git.rs` 의 `mod tests` 를 그대로 옮겼다.

use std::path::Path;

use super::changes::porcelain_op;
use super::diff::split_multi_diff;
use super::repo::is_repo;
use super::*;

// ─── 일지 diff 캡처 묶음 (완성도 라운드 Phase 3) ─────────────────────────

/// `git diff -- a b c` 출력을 `diff --git` 머리글로 가른다 — 각 조각은
/// 자기 머리글부터, 키는 새 이름(`b/`) 쪽이다.
#[test]
fn split_multi_diff_keys_each_patch_by_its_b_path() {
    let text = "diff --git a/src/a.rs b/src/a.rs\nindex 1..2 100644\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/docs/old.md b/docs/new.md\nsimilarity index 90%\nrename from docs/old.md\nrename to docs/new.md\n";
    let parts = split_multi_diff(text);
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0].0, "src/a.rs");
    assert!(parts[0].1.starts_with("diff --git a/src/a.rs b/src/a.rs\n"));
    assert!(parts[0].1.contains("+y\n"));
    assert!(!parts[0].1.contains("rename"));
    assert_eq!(parts[1].0, "docs/new.md");
    assert!(parts[1].1.contains("rename to docs/new.md"));
}

#[test]
fn split_multi_diff_of_empty_output_is_empty() {
    assert!(split_multi_diff("").is_empty());
    // 머리글 없는 잡음은 어느 조각에도 붙지 않는다.
    assert!(split_multi_diff("warning: LF will be replaced\n").is_empty());
}

// ─── 스냅샷 diff 렌더 ─────────────────────────────────────────────────

#[test]
fn render_unified_diff_produces_git_compatible_headers() {
    let prev = "line a\nline b\nline c\n";
    let next = "line a\nline B\nline c\n";
    let out = render_unified_diff("src/sample.txt", prev, next, 65_536);
    assert!(
        out.starts_with("diff --git a/src/sample.txt b/src/sample.txt\n"),
        "missing diff header: {out}"
    );
    assert!(
        out.contains("--- a/src/sample.txt"),
        "missing --- header: {out}"
    );
    assert!(
        out.contains("+++ b/src/sample.txt"),
        "missing +++ header: {out}"
    );
    assert!(out.contains("-line b"), "missing - line: {out}");
    assert!(out.contains("+line B"), "missing + line: {out}");
}

#[test]
fn render_unified_diff_truncates_oversized_output() {
    let mut prev = String::new();
    let mut next = String::new();
    for i in 0..2_000 {
        prev.push_str(&format!("prev line {i}\n"));
        next.push_str(&format!("next line {i}\n"));
    }
    let out = render_unified_diff("big.txt", &prev, &next, 1_024);
    assert!(out.contains("... (truncated,"), "missing truncation marker");
    assert!(
        out.len() < 1_024 + 512,
        "truncation budget overshot: {}",
        out.len()
    );
}

#[test]
fn render_unified_diff_truncation_respects_byte_budget_for_multibyte_text() {
    // 옛 구현은 chars 기준으로 잘라 한글 diff 가 예산의 최대 3~4배로 부풀었다.
    let prev: String = "이전 줄입니다\n".repeat(2_000);
    let next: String = "다음 줄입니다\n".repeat(2_000);
    let out = render_unified_diff("big-ko.txt", &prev, &next, 1_024);
    assert!(out.contains("... (truncated,"), "missing truncation marker");
    assert!(
        out.len() < 1_024 + 128,
        "byte budget overshot: {}",
        out.len()
    );
}

#[test]
fn porcelain_op_maps_status_pairs() {
    // Untracked file (`?? path`).
    assert_eq!(porcelain_op('?', '?'), "A");
    // Added to index.
    assert_eq!(porcelain_op('A', ' '), "A");
    // Rename / copy targets count as adds (new path).
    assert_eq!(porcelain_op('R', ' '), "A");
    assert_eq!(porcelain_op('C', ' '), "A");
    // Any deletion → delete, regardless of which column.
    assert_eq!(porcelain_op('D', ' '), "D");
    assert_eq!(porcelain_op(' ', 'D'), "D");
    assert_eq!(porcelain_op('M', 'D'), "D");
    // Plain modifications (staged, unstaged, or both).
    assert_eq!(porcelain_op('M', ' '), "M");
    assert_eq!(porcelain_op(' ', 'M'), "M");
    assert_eq!(porcelain_op('M', 'M'), "M");
}

fn git(dir: &Path, args: &[&str]) -> Result<(), ()> {
    crate::proc::std_cmd("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| ())
        .ok_or(())
}

/// Regression (2026-06-14): when the git repo sits *below* the project root
/// (the .oculpm folder is opened on a parent), the live 변경 diff 화면 used
/// to fall back to the volatile watcher buffer — so it reset on every app
/// update. The git layer must discover the nested repo and report/diff its
/// changes with paths relative to the project root.
#[test]
fn nested_repo_below_root_is_diffable() {
    let root = std::env::temp_dir().join(format!("ocul-nested-git-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("app");
    std::fs::create_dir_all(repo.join("src")).unwrap();
    // root itself is NOT a repo; `app/` is.
    if git(&repo, &["init", "-q"]).is_err() {
        return; // git unavailable
    }
    git(&repo, &["config", "user.email", "t@t.dev"]).unwrap();
    git(&repo, &["config", "user.name", "t"]).unwrap();
    let rel_in_repo = "src/page.tsx";
    std::fs::write(repo.join(rel_in_repo), "const a = 1;\n").unwrap();
    git(&repo, &["add", "."]).unwrap();
    git(&repo, &["commit", "-qm", "base"]).unwrap();
    // Modify (uncommitted) — should surface in the change list.
    std::fs::write(repo.join(rel_in_repo), "const a = 2;\n").unwrap();

    // root is not itself a repo, but discovery finds app/.
    assert!(!is_repo(&root), "root must not be a repo for this fixture");
    let changes = uncommitted_changes(&root);
    assert!(
        changes.iter().any(|c| c.path == "app/src/page.tsx"),
        "expected the nested repo's change at a root-relative path, got: {changes:?}"
    );

    // Per-file diff resolves the nested repo and shows the working change.
    let patch = diff_patch(&root, "app/src/page.tsx", None, None, 64 * 1024).unwrap();
    assert!(patch.contains("const a = 2;"), "diff_patch: {patch}");

    // Commit it, then the history fallback still recovers the diff.
    git(&repo, &["add", "."]).unwrap();
    git(&repo, &["commit", "-qm", "change"]).unwrap();
    let hist = diff_at_nearest_commit(&root, "app/src/page.tsx", None, 64 * 1024).unwrap();
    assert!(hist.contains("const a = 2;"), "history: {hist}");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn unquote_git_path_handles_plain_quoted_and_octal_forms() {
    use super::repo::unquote_git_path;
    assert_eq!(unquote_git_path("src/a.rs"), "src/a.rs");
    assert_eq!(unquote_git_path("\"docs/a b.md\""), "docs/a b.md");
    // `quotepath=on` 의 8진수 이스케이프 — "한글 파일.md".
    assert_eq!(
        unquote_git_path("\"\\355\\225\\234\\352\\270\\200 \\355\\214\\214\\354\\235\\274.md\""),
        "한글 파일.md"
    );
    assert_eq!(unquote_git_path("\"a\\\"b\\\\c.md\""), "a\"b\\c.md");
    // 따옴표가 한쪽만 있으면 감싼 것이 아니다 — 그대로.
    assert_eq!(unquote_git_path("\"half"), "\"half");
}

#[test]
fn split_multi_diff_reads_quoted_headers() {
    let text = "diff --git \"a/docs/한글 파일.md\" \"b/docs/한글 파일.md\"\n\
                index 1..2 100644\n--- \"a/docs/한글 파일.md\"\n+++ \"b/docs/한글 파일.md\"\n\
                @@ -1 +1 @@\n-x\n+y\n\
                diff --git a/src/a.rs b/src/a.rs\n@@ -1 +1 @@\n-1\n+2\n";
    let parts = split_multi_diff(text);
    let keys: Vec<&str> = parts.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, vec!["docs/한글 파일.md", "src/a.rs"]);
    assert!(parts[0].1.contains("+y"));
    assert!(
        !parts[0].1.contains("+2"),
        "두 번째 파일의 패치가 첫 조각에 붙었다"
    );
}

/// 한국어 파일명(공백 포함)이 git 을 지나며 8진수 이스케이프·C-quote 로 바뀌지
/// 않고 실제 이름으로 돌아오는지 — 백필(`--name-status`)·일지 diff 캡처
/// (`diff_patches`)·변경 목록(`uncommitted_changes`) 세 경로 전부.
#[test]
fn korean_file_names_survive_every_git_reader() {
    let root = std::env::temp_dir().join(format!("ocul-quotepath-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("docs")).unwrap();
    if git(&root, &["init", "-q"]).is_err() {
        return; // git unavailable
    }
    git(&root, &["config", "user.email", "t@t.dev"]).unwrap();
    git(&root, &["config", "user.name", "t"]).unwrap();
    // 기본값을 강제해 이 머신의 전역 설정과 무관하게 재현한다.
    git(&root, &["config", "core.quotepath", "true"]).unwrap();
    let rel = "docs/한글 파일.md";
    std::fs::write(root.join(rel), "처음\n").unwrap();
    git(&root, &["add", rel]).unwrap();
    git(&root, &["commit", "-qm", "base"]).unwrap();

    let commits = commits_for_backfill(&root, 5).unwrap();
    assert_eq!(
        commits[0].files[0].path, rel,
        "name-status: {:?}",
        commits[0].files
    );

    std::fs::write(root.join(rel), "고침\n").unwrap();
    let changes = uncommitted_changes(&root);
    assert!(
        changes.iter().any(|c| c.path == rel),
        "porcelain: {changes:?}"
    );

    let patches = diff_patches(&root, &[rel.to_string()], 64 * 1024);
    let patch = patches
        .get(rel)
        .unwrap_or_else(|| panic!("diff_patches 에 {rel} 가 없다: {patches:?}"));
    assert!(patch.contains("+고침"), "{patch}");

    let _ = std::fs::remove_dir_all(&root);
}

/// 보안 피드백 3차 (2026-10-08): 블롭 질의는 저장소를 **경로에서** 푼다. 프로젝트
/// 옆의 다른 저장소를 `../`·절대경로·밖을 가리키는 링크로 가리키면, 그 저장소에
/// 커밋된 내용이 나왔다 (`code_head_content`·이미지 미리보기 "이전"·거터).
#[test]
fn blob_queries_stay_inside_the_project_root() {
    let tmp = tempfile::tempdir().unwrap();
    let (proj, other) = (tmp.path().join("proj"), tmp.path().join("other"));
    for repo in [&proj, &other] {
        std::fs::create_dir_all(repo).unwrap();
        if git(repo, &["init", "-q"]).is_err() {
            return; // git unavailable
        }
        git(repo, &["config", "user.email", "t@t.dev"]).unwrap();
        git(repo, &["config", "user.name", "t"]).unwrap();
    }
    std::fs::write(proj.join("mine.txt"), "mine\n").unwrap();
    std::fs::write(other.join("secret.txt"), "theirs\n").unwrap();
    for repo in [&proj, &other] {
        git(repo, &["add", "."]).unwrap();
        git(repo, &["commit", "-qm", "base"]).unwrap();
    }

    assert_eq!(
        show_file_bytes(&proj, "mine.txt", "HEAD", 1024).as_deref(),
        Some(&b"mine\n"[..])
    );
    let absolute = other.join("secret.txt").to_string_lossy().into_owned();
    let mut escapes = vec!["../other/secret.txt".to_string(), absolute];
    if crate::test_links::dir(&other, &proj.join("link")) {
        escapes.push("link/secret.txt".to_string());
    }
    for rel in &escapes {
        assert_eq!(show_file_bytes(&proj, rel, "HEAD", 1024), None, "{rel}");
        assert_eq!(blob_size(&proj, rel, "HEAD"), None, "{rel}");
        assert_eq!(path_in_head(&proj, rel), None, "{rel}");
    }
}

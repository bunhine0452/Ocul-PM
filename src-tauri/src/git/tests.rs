//! `git` 모듈 단위 테스트 — 패치 가르기·스냅샷 렌더·거터·porcelain 매핑·중첩
//! 저장소 회귀. 예전 `git.rs` 의 `mod tests` 를 그대로 옮겼다.

use std::path::Path;
use std::process::Command;

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

// ─── 에디터 거터 (#git-gutter) ─────────────────────────────────────────

/// `(시작, 끝, 종류)` 로 줄여 읽기 쉽게.
fn shape(changes: &[GitLineChange]) -> Vec<(u32, u32, GitLineChangeKind)> {
    changes
        .iter()
        .map(|c| (c.start_line, c.end_line, c.kind))
        .collect()
}

#[test]
fn gutter_marks_added_lines() {
    let got = diff_line_changes("a\nb\n", "a\nX\nY\nb\n");
    assert_eq!(shape(&got), vec![(2, 3, GitLineChangeKind::Added)]);
}

#[test]
fn gutter_marks_a_replaced_line_as_modified_not_add_plus_delete() {
    // 지움+삽입이 붙어 있으면 사람 눈에는 "고쳤다" 다 — 표식 두 개를
    // 겹쳐 그리면 거터가 시끄럽고 무슨 일이 났는지 안 보인다.
    let got = diff_line_changes("a\nb\nc\n", "a\nB\nc\n");
    assert_eq!(shape(&got), vec![(2, 2, GitLineChangeKind::Modified)]);
}

#[test]
fn gutter_marks_deletions_on_the_surviving_line_above() {
    // 지워진 줄은 화면에 없다 — 남아 있는 앞 줄에 표식을 붙인다.
    let got = diff_line_changes("a\nb\nc\n", "a\nc\n");
    assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
}

#[test]
fn gutter_marks_a_deletion_at_the_end_of_file() {
    let got = diff_line_changes("a\nb\n", "a\n");
    assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
}

#[test]
fn gutter_marks_a_deletion_at_the_start_of_file() {
    // 앞에 남은 줄이 없으면 1행에 붙인다 (0행은 없다).
    let got = diff_line_changes("a\nb\n", "b\n");
    assert_eq!(shape(&got), vec![(1, 1, GitLineChangeKind::Deleted)]);
}

#[test]
fn gutter_keeps_separate_hunks_separate() {
    let got = diff_line_changes("a\nb\nc\nd\n", "a\nX\nc\nd\nY\n");
    assert_eq!(
        shape(&got),
        vec![
            (2, 2, GitLineChangeKind::Modified),
            (5, 5, GitLineChangeKind::Added)
        ]
    );
}

#[test]
fn gutter_is_empty_when_nothing_changed() {
    assert!(diff_line_changes("a\nb\n", "a\nb\n").is_empty());
}

#[test]
fn gutter_handles_korean_lines() {
    // 줄 단위 비교라 바이트 폭은 상관없어야 한다 (회귀 방지).
    let got = diff_line_changes("가\n나\n", "가\n다\n");
    assert_eq!(shape(&got), vec![(2, 2, GitLineChangeKind::Modified)]);
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
    Command::new("git")
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

/// 태그 사이 범위 읽기 (`{#release-notes-draft}`) — 기준 태그 해석과, 그 범위
/// 커밋이 **만진 파일**까지. 셋을 한 픽스처로 묶는 이유는 셋이 한 물음이기
/// 때문이다: "지난 릴리스 이후 무엇이 바뀌었나".
#[test]
fn a_tag_range_yields_only_the_commits_after_it_with_their_files() {
    let root = std::env::temp_dir().join(format!("ocul-relnotes-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    if git(&root, &["init", "-q"]).is_err() {
        return; // git unavailable
    }
    git(&root, &["config", "user.email", "t@t.dev"]).unwrap();
    git(&root, &["config", "user.name", "t"]).unwrap();

    let commit = |name: &str, body: &str, msg: &str| {
        std::fs::write(root.join(name), body).unwrap();
        git(&root, &["add", name]).unwrap();
        git(&root, &["commit", "-qm", msg]).unwrap();
    };
    commit("src/a.rs", "1\n", "base");
    git(&root, &["tag", "v1.0.0"]).unwrap();
    commit("src/b.rs", "1\n", "feat: b");
    commit("src/c.rs", "1\n", "fix: c");
    git(&root, &["tag", "v1.1.0"]).unwrap();
    commit("src/d.rs", "1\n", "chore: d");

    // 기준은 HEAD 에서 거슬러 닿는 마지막 태그 — 만든 순서가 아니라 도달성이다.
    assert_eq!(
        latest_version_tag(&root, "HEAD").unwrap().as_deref(),
        Some("v1.1.0")
    );

    let after = log_range_with_files(&root, "v1.1.0", "HEAD", 50).unwrap();
    assert_eq!(after.len(), 1, "{after:?}");
    assert_eq!(after[0].subject, "chore: d");
    assert_eq!(after[0].files, vec!["src/d.rs".to_string()]);

    // 태그 두 개 사이는 그 사이 커밋만 — 기준 커밋(base)은 빠진다.
    let between = log_range_with_files(&root, "v1.0.0", "v1.1.0", 50).unwrap();
    let subjects: Vec<&str> = between.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, vec!["fix: c", "feat: b"], "최신 먼저");
    let files: Vec<&str> = between
        .iter()
        .flat_map(|c| c.files.iter().map(String::as_str))
        .collect();
    assert_eq!(files, vec!["src/c.rs", "src/b.rs"]);
    assert!(between.iter().all(|c| c.timestamp > 0), "{between:?}");

    // 기준이 비면 이력 전체.
    assert_eq!(
        log_range_with_files(&root, "", "HEAD", 50).unwrap().len(),
        4
    );

    let _ = std::fs::remove_dir_all(&root);
}

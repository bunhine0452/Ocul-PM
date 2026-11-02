//! `git::receipt` — 진짜 git 저장소로: 갈라진 뒤의 커밋 · 커밋 전 변경 · 새 파일을 일지와 대조한다.

use super::*;

fn git(dir: &Path, args: &[&str]) {
    let ok = crate::proc::std_cmd("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?}");
}

fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

const JOURNAL: &str = "---\nschema_version: 1\ntype: bug\nslug: \"a\"\nstatus: done\n\
created_at: \"2026-11-02T10:00:00+09:00\"\nsession_id: \"20261102-001\"\nagent:\n  id: \"claude-code\"\n\
language: \"ko\"\nverified_by_user: false\nfiles_touched:\n  - path: \"src/a.ts\"\n    op: update\n---\n\
[x] 셸: 이름이 겹쳤다\n\n## 발생 원인\n여백\n\n## 검증\n- `pnpm test`: 993 passed\n";

#[test]
fn a_branch_is_reconciled_against_its_journals() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "core.autocrlf", "false"]);
    write(r, "src/a.ts", "1\n");
    write(r, "src/b.ts", "1\n");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "first"]);
    git(r, &["checkout", "-q", "-b", "feat/x"]);
    // 커밋한 변경 둘(하나는 일지에 있다) · 커밋 전 변경 하나 · 새 파일 하나(한글 이름).
    write(r, "src/a.ts", "2\n");
    write(r, ".oculpm/journal/20261102/Bugs/1000_bug_a.md", JOURNAL);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "fix"]);
    write(r, "src/b.ts", "2\n");
    write(r, "docs/새 문서.md", "새\n");

    let got = build(r).unwrap();
    assert_eq!(got.branch, "feat/x");
    assert_eq!(got.base_label, "main");
    assert_eq!(got.commits, 1);
    assert_eq!(got.files, 3);
    assert_eq!(got.journals.len(), 1);
    let j = &got.journals[0];
    assert_eq!(j.path, "20261102/Bugs/1000_bug_a.md");
    assert_eq!(j.title, "셸: 이름이 겹쳤다");
    assert_eq!(j.kind, "bug");
    assert_eq!(j.proof.as_deref(), Some("pnpm test: 993 passed"));
    assert_eq!(
        got.unrecorded,
        vec!["docs/새 문서.md".to_string(), "src/b.ts".to_string()]
    );
}

#[test]
fn on_the_base_branch_only_uncommitted_work_counts() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    git(r, &["init", "-q", "-b", "main"]);
    write(r, "src/a.ts", "1\n");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "first"]);
    write(r, "src/a.ts", "2\n");
    let got = build(r).unwrap();
    assert_eq!((got.commits, got.files), (0, 1));
    assert_eq!(got.unrecorded, vec!["src/a.ts".to_string()]);
}

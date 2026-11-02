//! `git::authors` — 진짜 저장소로: 동료가 더한 일지만, 내 것 · 커밋 전 것은 빼고.

use super::*;

fn git(dir: &Path, args: &[&str]) {
    let ok = crate::proc::std_cmd("git")
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?}");
}

fn write(root: &Path, rel: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, "x\n").unwrap();
}

#[test]
fn only_journals_added_by_someone_else_are_teammates() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.name", "나"]);
    git(r, &["config", "user.email", "Me@Example.com"]);
    write(r, ".oculpm/journal/20261102/Bugs/0900_bug_mine.md");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "mine"]);
    write(
        r,
        ".oculpm/journal/20261102/Features_to_add/1000_feature_theirs.md",
    );
    write(r, ".oculpm/journal/20261101/Bugs/1000_bug_yesterday.md");
    git(r, &["add", "-A"]);
    git(
        r,
        &[
            "-c",
            "user.name=민지",
            "-c",
            "user.email=minji@example.com",
            "commit",
            "-q",
            "-m",
            "theirs",
        ],
    );
    write(r, ".oculpm/journal/20261102/Chores/1100_chore_draft.md");

    assert_eq!(
        teammates(r, "20261102"),
        vec![TeamJournal {
            path: "20261102/Features_to_add/1000_feature_theirs.md".into(),
            author: "민지".into()
        }]
    );
    assert!(
        teammates(r, "2026-11-02").is_empty(),
        "날짜 꼴이 아니면 git 을 부르지 않는다"
    );
}

#[test]
fn the_newest_add_wins() {
    let out = "@@B\tb@x\n\n.oculpm/journal/20261102/Bugs/a.md\n@@A\ta@x\n\n.oculpm/journal/20261102/Bugs/a.md\n.oculpm/journal/20261102/Bugs/x.txt\n";
    let m = parse_log(out);
    assert_eq!(m.len(), 1);
    assert_eq!(
        m["20261102/Bugs/a.md"],
        ("B".to_string(), "b@x".to_string())
    );
}

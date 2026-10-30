//! `git::race` — 레인을 만들고 · 재고 · 가져오고 · 지운다. 진짜 git 저장소로.

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

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    std::fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-q", "-m", "first"]);
    dir
}

#[test]
fn parse_keeps_only_race_branches() {
    let p = "worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /x/1030-1-1\nHEAD 1\nbranch refs/heads/ocul-race/1030-1-1\n\nworktree /y\nHEAD 2\ndetached\n";
    assert_eq!(
        parse_lanes(p),
        vec![("/x/1030-1-1".to_string(), "ocul-race/1030-1-1".to_string())]
    );
}

#[test]
fn start_take_and_clear_a_race() {
    let root = repo();
    let data = tempfile::tempdir().unwrap();
    let base = base_dir(data.path(), 7);
    let made = start(root.path(), &base, 9, "1030-1812").unwrap();
    assert_eq!(made.len(), MAX_LANES as usize, "개수는 2~4 로 묶인다");

    // 레인 1: 고친 줄 + 새 파일 + 커밋 하나. 레인 2: 손대지 않음.
    let one = Path::new(&made[0].path);
    std::fs::write(one.join("a.txt"), "one\nTWO\nthree\n").unwrap();
    git(one, &["commit", "-q", "-am", "lane edit"]);
    std::fs::write(one.join("new.txt"), "fresh\n").unwrap();

    let listed = lanes(root.path()).unwrap();
    let l1 = listed.iter().find(|l| l.name == "1030-1812-1").unwrap();
    assert_eq!((l1.files, l1.added, l1.removed), (2, 3, 1));
    let l2 = listed.iter().find(|l| l.name == "1030-1812-2").unwrap();
    assert_eq!(l2.files, 0);
    assert!(patch(root.path(), &find(root.path(), one).unwrap())
        .unwrap()
        .contains("+TWO"));

    // 고르면 원래 폴더에 커밋 전 변경으로 — 원래 가지의 커밋은 그대로.
    take(root.path(), &find(root.path(), one).unwrap(), data.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("a.txt")).unwrap(),
        "one\nTWO\nthree\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("new.txt")).unwrap(),
        "fresh\n"
    );
    assert_eq!(
        take(
            root.path(),
            &find(root.path(), Path::new(&made[1].path)).unwrap(),
            data.path()
        )
        .unwrap_err(),
        "empty_lane"
    );

    // 레인이 아닌 곳은 거절한다 — 원래 폴더 · 아무 폴더.
    assert_eq!(find(root.path(), root.path()).unwrap_err(), "not_a_lane");
    assert_eq!(find(root.path(), data.path()).unwrap_err(), "not_a_lane");

    assert_eq!(clear(root.path()).unwrap(), MAX_LANES as u32);
    assert!(lanes(root.path()).unwrap().is_empty());
    assert!(!one.exists());
}

#[test]
fn a_repo_without_commits_cannot_race() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    let data = tempfile::tempdir().unwrap();
    assert_eq!(
        start(dir.path(), data.path(), 2, "x").unwrap_err(),
        "no_commit"
    );
}

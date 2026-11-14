//! `git::local_only` — 진짜 저장소로. 리모트 가지는 올리지(push) 않고 ref 를 직접 세운다:
//! 원장이 git 의 네트워크 하위 명령을 테스트에서도 막는다.

use super::*;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = crate::proc::std_cmd("git")
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(root: &Path, rel: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, "x\n").unwrap();
}

fn commit(root: &Path, rel: &str) {
    write(root, rel);
    git(root, &["add", "--", rel]);
    git(root, &["commit", "-q", "-m", rel]);
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.name", "나"]);
    git(r, &["config", "user.email", "me@example.com"]);
    dir
}

#[test]
fn a_repo_with_nowhere_to_send_says_nothing() {
    assert_eq!(
        local_only(tempfile::tempdir().unwrap().path()),
        None,
        "git 아님"
    );
    let dir = repo();
    commit(dir.path(), "a.txt");
    assert_eq!(local_only(dir.path()), None, "리모트 없음");
}

#[test]
fn counts_what_the_other_machine_cannot_see() {
    let dir = repo();
    let r = dir.path();
    // 주소는 쓰이지 않는다(받아 오지 않는다) — 리모트가 「있다」는 것만.
    git(r, &["remote", "add", "origin", "../nowhere.git"]);
    assert_eq!(
        local_only(r),
        Some(LocalOnly::default()),
        "커밋 전 빈 저장소"
    );

    commit(r, "a.txt");
    // 여기까지가 「올린 것」 — 리모트 가지를 지금 커밋에 세운다.
    let pushed = git(r, &["rev-parse", "HEAD"]);
    git(r, &["update-ref", "refs/remotes/origin/main", &pushed]);
    assert_eq!(local_only(r), Some(LocalOnly::default()), "다 올렸다");

    commit(r, "b.txt");
    commit(r, ".oculpm/journal/20261113/Bugs/0900_bug_a.md");
    write(r, "c.txt");
    write(r, ".oculpm/journal/20261113/Bugs/1000_bug_b.md");
    write(r, ".oculpm/planner/p.md");
    assert_eq!(
        local_only(r),
        Some(LocalOnly {
            uncommitted: 3,
            records: 2,
            unpushed: 2,
            unpushed_records: 1,
        })
    );

    // 다른 가지 이름으로 올라가 있어도 리모트에 있는 것이다.
    let head = git(r, &["rev-parse", "HEAD"]);
    git(r, &["update-ref", "refs/remotes/origin/feat", &head]);
    let now = local_only(r).unwrap();
    assert_eq!((now.unpushed, now.unpushed_records), (0, 0));
}

/// 일지를 커밋하고 아직 안 올린 흔한 상태 (11-15) — 커밋 안 한 기록이 0 이어도 다른 기기에는 없는 일지다.
#[test]
fn counts_journals_committed_but_not_pushed_once() {
    let dir = repo();
    let r = dir.path();
    git(r, &["remote", "add", "origin", "../nowhere.git"]);
    commit(r, "a.txt");
    let pushed = git(r, &["rev-parse", "HEAD"]);
    git(r, &["update-ref", "refs/remotes/origin/main", &pushed]);

    commit(r, ".oculpm/journal/20261115/Bugs/0900_bug_a.md");
    commit(r, ".oculpm/planner/p.md");
    commit(r, "code-only.txt");
    let only_commits = local_only(r).unwrap();
    assert_eq!(
        (
            only_commits.records,
            only_commits.unpushed,
            only_commits.unpushed_records
        ),
        (0, 3, 2),
        "커밋 안 한 기록은 없지만 안 올린 커밋 안에 일지와 계획이 있다 · 코드만 바꾼 커밋은 기록이 아니다"
    );

    // 안 올린 커밋에 든 계획을 다시 고쳤다 — 한 파일이라 한 번만 센다(커밋 안 한 기록 쪽에서).
    std::fs::write(r.join(".oculpm/planner/p.md"), "y\n").unwrap();
    let both = local_only(r).unwrap();
    assert_eq!((both.records, both.unpushed_records), (1, 1));
}

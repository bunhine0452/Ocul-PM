//! `git::arrived` — 진짜 저장소로. 받아 오지 않는다: 리모트 가지의 reflog 를 손으로 적어
//! 「받아 온 구간」 을 만든다 (원장이 git 의 네트워크 하위 명령을 테스트에서도 막는다).

use super::*;

const ZERO: &str = "0000000000000000000000000000000000000000";

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

/// 파일 하나를 더한 커밋 — 그 커밋의 oid.
fn commit(root: &Path, rel: &str) -> String {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, "x\n").unwrap();
    git(root, &["add", "--", rel]);
    git(root, &["commit", "-q", "-m", rel]);
    git(root, &["rev-parse", "HEAD"])
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.name", "나"]);
    git(r, &["config", "user.email", "me@example.com"]);
    dir
}

/// `origin/main` 의 reflog 를 통째로 적는다 — (옛, 새, 시각, 메시지).
fn remote_log(root: &Path, moves: &[(&str, &str, u32, &str)]) {
    let dir = root.join(".git/logs/refs/remotes/origin");
    std::fs::create_dir_all(&dir).unwrap();
    let text: String = moves
        .iter()
        .map(|(old, new, at, msg)| {
            format!("{old} {new} 김 아무개 <me@example.com> {at} +0900\t{msg}\n")
        })
        .collect();
    std::fs::write(dir.join("main"), text).unwrap();
}

/// 이 기기에서 만든 커밋이라는 흔적(HEAD reflog)을 지운다 — 픽스처의 커밋을 「다른 곳에서 온 것」 으로.
fn made_elsewhere(root: &Path) {
    std::fs::remove_file(root.join(".git/logs/HEAD")).unwrap();
}

const BUG: &str = ".oculpm/journal/20261113/Bugs/0900_bug_한글-제목.md";
const FEAT: &str = ".oculpm/journal/20261113/Features_to_add/1000_feature_y.md";

#[test]
fn journals_added_by_a_pulled_range_arrive() {
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    commit(r, BUG);
    commit(r, "src/b.rs");
    let c4 = commit(r, FEAT);
    made_elsewhere(r);
    remote_log(
        r,
        &[
            (ZERO, &c1, 100, "fetch origin: storing head"),
            (&c1, &c4, 2000, "pull: fast-forward"),
        ],
    );

    let got = arrived(r, 1000).unwrap();
    assert_eq!(
        got.journals,
        vec![
            "20261113/Features_to_add/1000_feature_y.md",
            "20261113/Bugs/0900_bug_한글-제목.md"
        ],
        "받아 온 구간이 더한 일지만 · 코드 파일은 아니다"
    );
    assert_eq!(got.synced_at, Some(2000));

    let later = arrived(r, 3000).unwrap();
    assert!(
        later.journals.is_empty(),
        "그 전에 받아 온 것은 오늘 것이 아니다"
    );
    assert_eq!(later.synced_at, Some(2000), "주고받은 때는 그대로 안다");
}

#[test]
fn what_this_machine_sent_is_not_an_arrival() {
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    remote_log(
        r,
        &[
            (ZERO, &c1, 100, "update by push"),
            (&c1, &c2, 2000, "update by push"),
        ],
    );
    assert_eq!(
        arrived(r, 0),
        Some(Arrived::default()),
        "올리기만 한 저장소 — 받아 온 일지도, 「받아 온 지」 도 말하지 않는다"
    );
}

#[test]
fn a_fetched_journal_that_is_not_in_the_tree_has_not_arrived() {
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    made_elsewhere(r);
    remote_log(r, &[(&c1, &c2, 2000, "fetch origin: fast-forward")]);
    // 받아 왔지만 이 가지에 합치지 않았다 — 작업 트리에 그 파일이 없다.
    std::fs::remove_file(r.join(BUG)).unwrap();
    let got = arrived(r, 0).unwrap();
    assert!(got.journals.is_empty(), "{:?}", got.journals);
    assert_eq!(got.synced_at, Some(2000));
}

#[test]
fn my_own_work_merged_elsewhere_is_not_an_arrival() {
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    remote_log(r, &[(&c1, &c2, 2000, "fetch origin: fast-forward")]);
    assert_eq!(
        arrived(r, 0),
        Some(Arrived::default()),
        "여기서 만든 커밋 그대로 — 받아 온 일지도, 「주고받은 지」 도 말하지 않는다"
    );

    // 리베이스 머지 — oid 는 바뀌고 작성 시각은 남는다. 이 기기의 HEAD reflog 에는 옛 oid 만 있다.
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    let authored = git(r, &["log", "-1", "--format=%at"]);
    std::fs::write(
        r.join(".git/logs/HEAD"),
        format!("{c1} {c1} 나 <me@example.com> {authored} +0900\tcommit: 옛 oid 로 만든 그 일지\n"),
    )
    .unwrap();
    remote_log(r, &[(&c1, &c2, 2000, "pull: fast-forward")]);
    assert_eq!(arrived(r, 0), Some(Arrived::default()), "작성 시각이 같다");
}

#[test]
fn a_fetch_that_brought_nothing_still_counts_as_talking_to_the_remote() {
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    made_elsewhere(r);
    remote_log(r, &[(&c1, &c2, 2000, "pull: fast-forward")]);
    // 새 것이 없던 받아 오기는 reflog 에 줄을 남기지 않는다 — FETCH_HEAD 의 수정 시각이 그때다.
    std::fs::write(r.join(".git/FETCH_HEAD"), "").unwrap();
    let at = arrived(r, 0).unwrap().synced_at.unwrap();
    assert!(at > 2000, "FETCH_HEAD 가 더 최근이다: {at}");
}

#[test]
fn outside_a_branch_nothing_is_known() {
    assert_eq!(
        arrived(tempfile::tempdir().unwrap().path(), 0),
        None,
        "git 아님"
    );
    let dir = repo();
    let r = dir.path();
    let c1 = commit(r, "a.txt");
    let c2 = commit(r, BUG);
    remote_log(r, &[(&c1, &c2, 2000, "pull: fast-forward")]);
    git(r, &["checkout", "-q", "--detach"]);
    assert_eq!(arrived(r, 0), None, "떨어진 HEAD");
}

#[test]
fn reflog_lines_are_read_from_both_ends() {
    let a = "1111111111111111111111111111111111111111";
    let b = "2222222222222222222222222222222222222222";
    let text = format!(
        "{a} {b} 이름 사이 빈칸 <x@example.com> 1763000000 +0900\tpull --rebase: fast-forward\n\
         {b} {a} me <x@example.com> 1763000100 -0500\tupdate by push\n\
         {ZERO} {a} me <x@example.com> 1763000200 +0000\tfetch origin: storing head\n\
         깨진 줄\n"
    );
    let moves = parse_reflog(&text);
    assert_eq!(moves.len(), 3);
    assert_eq!((moves[0].at, moves[0].incoming()), (1763000000, true));
    assert!(!moves[1].incoming(), "이 기기가 올린 것");
    assert!(!moves[2].incoming(), "가지가 처음 생긴 것");
}

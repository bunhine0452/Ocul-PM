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
    // Windows 러너의 전역 core.autocrlf=true 가 가져온 파일을 CRLF 로 쓴다 — 줄끝을 저장소에 고정한다.
    git(dir.path(), &["config", "core.autocrlf", "false"]);
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

/// `.oculpm` 을 git 에 안 올린 저장소 — 레인에 기록 폴더를 심어 레인의 Claude 가 일지를 쓰게 하고, 그 일지의
/// 제목 · 증거 · 끝 줄을 띠에 싣는다. 기록 폴더는 코드 변경으로 세지도 가져오지도 않는다.
#[test]
fn a_lane_gets_records_and_reports_its_evidence() {
    let root = repo();
    std::fs::create_dir_all(root.path().join(".oculpm")).unwrap();
    std::fs::write(
        root.path().join(".oculpm/config.toml"),
        "[agents]\ntemplate_language = \"ko\"\n",
    )
    .unwrap();
    let data = tempfile::tempdir().unwrap();
    let made = start(root.path(), &base_dir(data.path(), 1), 2, "s").unwrap();
    let one = Path::new(&made[0].path);
    assert!(
        one.join(".oculpm/config.toml").is_file(),
        "레인에 기록 폴더를 심는다"
    );

    // 레인의 Claude 가 코드를 고치고 일지를 쓴다.
    std::fs::write(one.join("a.txt"), "one\nTWO\n").unwrap();
    let day = one.join(".oculpm/journal/20261030/Bugs");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(
        day.join("1200_bug_cache.md"),
        "---\nschema_version: 1\ntype: bug\nslug: \"cache\"\nstatus: done\n---\n[x] 캐시: 만료 고침\n\n\
         ## 발생 원인\n만료를 안 봤다.\n\n## 해결 방법\n본다.\n\n## 검증\n- `cargo test` → 12 passed\n",
    )
    .unwrap();

    let all = lanes(root.path()).unwrap();
    let l1 = all.iter().find(|l| l.name == "s-1").unwrap();
    assert_eq!(l1.files, 1, "기록 폴더는 코드 변경으로 세지 않는다");
    assert_eq!(l1.journals, 1);
    assert_eq!(l1.journal_title.as_deref(), Some("캐시: 만료 고침"));
    assert_eq!(l1.evidence, crate::oculpm::evidence::COMMAND);
    assert_eq!(l1.proof.as_deref(), Some("cargo test → 12 passed"));
    let l2 = all.iter().find(|l| l.name == "s-2").unwrap();
    assert_eq!(
        (l2.journals, l2.evidence),
        (0, 0),
        "일지 없는 레인은 증거도 없다"
    );

    // 가져와도 원래 쪽 config.toml 과 부딪치지 않고, 레인의 일지는 코드처럼 섞이지 않는다.
    take(root.path(), &find(root.path(), one).unwrap(), data.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("a.txt")).unwrap(),
        "one\nTWO\n"
    );
    assert!(!root.path().join(".oculpm/journal").exists());
    assert_eq!(clear(root.path()).unwrap(), 2);
}

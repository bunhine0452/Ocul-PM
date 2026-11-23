//! `git::race_include` — `.worktreeinclude` 로 레인에 git 무시 파일을 복사한다. 진짜 git 저장소로.

use super::*;
use crate::git::race;

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

fn write(dir: &Path, rel: &str, body: &[u8]) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `.gitignore` · `.worktreeinclude` 를 올린 저장소. 무시 파일은 아직 없다.
fn repo(include: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "core.autocrlf", "false"]);
    write(dir.path(), "a.txt", b"one\n");
    write(
        dir.path(),
        ".gitignore",
        b".env\nconfig/*.local.json\nbig.bin\nsecret.key\n.oculpm/\nlink.env\n",
    );
    if let Some(include) = include {
        write(dir.path(), FILE, include.as_bytes());
    }
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-q", "-m", "first"]);
    dir
}

const INCLUDE: &str = ".env\nconfig/*.local.json\nbig.bin\n*.draft\n.oculpm/\nlink.env\n";

fn names(plan: &[Candidate]) -> Vec<&str> {
    let mut v: Vec<&str> = plan.iter().map(|c| c.rel.as_str()).collect();
    v.sort_unstable();
    v
}

#[test]
fn no_include_file_means_a_clean_checkout() {
    let root = repo(None);
    write(root.path(), ".env", b"TOKEN=x\n");
    assert!(plan(root.path()).is_empty());
    let data = tempfile::tempdir().unwrap();
    let made = race::start(root.path(), &race::base_dir(data.path(), 1), 2, "s").unwrap();
    assert_eq!(made[0].included, Some(vec![]));
    assert!(!Path::new(&made[0].path).join(".env").exists());
}

/// 목록에 맞고 **git 이 무시하는** 파일만 — 무시되지 않은 새 파일 · 목록 밖의 무시 파일 · 1MB 넘는 파일 · 기록
/// 폴더는 아니다.
#[test]
fn only_listed_and_ignored_small_files_outside_records_are_candidates() {
    let root = repo(Some(INCLUDE));
    write(root.path(), ".env", b"TOKEN=x\n");
    write(root.path(), "config/app.local.json", b"{}\n");
    write(root.path(), "notes.draft", b"untracked but not ignored\n");
    write(root.path(), "secret.key", b"ignored but not listed\n");
    write(root.path(), ".oculpm/index/cache.db", b"app-managed\n");
    write(root.path(), "big.bin", &vec![0u8; (MAX_FILE + 1) as usize]);
    let p = plan(root.path());
    assert_eq!(names(&p), vec![".env", "big.bin", "config/app.local.json"]);

    let lane = tempfile::tempdir().unwrap();
    let copied = copy_into(root.path(), lane.path(), &p);
    assert_eq!(
        copied.len(),
        2,
        "1MB 를 넘는 파일은 복사하지 않는다: {copied:?}"
    );
    assert_eq!(
        std::fs::read(lane.path().join(".env")).unwrap(),
        b"TOKEN=x\n"
    );
    assert!(lane.path().join("config/app.local.json").is_file());
    assert!(!lane.path().join("big.bin").exists());
}

/// 레인을 만들면 레인마다 같은 파일이 들어가고, 무시 파일이라 레인의 변경으로 세지 않는다.
#[test]
fn start_copies_into_every_lane_and_the_copy_is_not_a_lane_change() {
    let root = repo(Some(INCLUDE));
    write(root.path(), ".env", b"TOKEN=x\n");
    let data = tempfile::tempdir().unwrap();
    let made = race::start(root.path(), &race::base_dir(data.path(), 2), 2, "t").unwrap();
    for lane in &made {
        assert_eq!(lane.included, Some(vec![".env".to_string()]));
        assert_eq!(
            std::fs::read(Path::new(&lane.path).join(".env")).unwrap(),
            b"TOKEN=x\n"
        );
    }
    let listed = race::lanes(root.path()).unwrap();
    assert!(listed.iter().all(|l| l.files == 0 && l.included.is_none()));
}

/// 합의 상한 — 넘게 하는 파일은 건너뛰고, 그 뒤의 작은 파일은 들어간다. 이미 있는 파일은 덮지 않는다.
#[test]
fn total_cap_skips_what_would_overflow_and_never_overwrites() {
    // 크기는 후보가 말한 값으로 센다 — 실제 파일은 한 글자다(시험이 20MB 를 쓰지 않게).
    let root = tempfile::tempdir().unwrap();
    let mut plan: Vec<Candidate> = (0..19)
        .map(|i| Candidate {
            rel: format!("f{i}"),
            size: MAX_FILE,
        })
        .collect();
    plan.push(Candidate {
        rel: "near".into(),
        size: MAX_FILE - 10,
    });
    plan.push(Candidate {
        rel: "over".into(),
        size: 20,
    });
    plan.push(Candidate {
        rel: "own".into(),
        size: 1,
    });
    plan.push(Candidate {
        rel: "fits".into(),
        size: 10,
    });
    for c in &plan {
        write(root.path(), &c.rel, b"x");
    }
    let lane = tempfile::tempdir().unwrap();
    write(lane.path(), "own", b"lane's own");
    let copied = copy_into(root.path(), lane.path(), &plan);
    assert_eq!(copied.len(), 21);
    assert!(copied.contains(&"near".to_string()) && copied.contains(&"fits".to_string()));
    assert!(
        !copied.contains(&"over".to_string()),
        "합이 20MB 를 넘게 하는 파일"
    );
    assert!(!lane.path().join("over").exists());
    assert_eq!(
        std::fs::read(lane.path().join("own")).unwrap(),
        b"lane's own"
    );
}

#[test]
fn paths_that_leave_the_root_are_not_plain() {
    assert!(plain_relative("config/a.json"));
    assert!(!plain_relative("../x"));
    assert!(!plain_relative("/etc/passwd"));
    assert!(!plain_relative("a/../../x"));
    assert!(!plain_relative(""));
    assert!(is_records(".oculpm/index/x"));
    assert!(!is_records(".oculpmx"));
    let ignored: HashSet<&str> = ["node_modules/", ".env"].into_iter().collect();
    assert!(is_ignored("node_modules/a/b.js", &ignored));
    assert!(is_ignored(".env", &ignored));
    assert!(!is_ignored("src/.env", &ignored));
}

/// 심볼릭 링크 파일, 루트 밖을 가리키는 링크는 후보가 아니다. 레인 안의 폴더 링크를 타고 밖에 쓰지 않는다.
#[cfg(unix)]
#[test]
fn symlinks_never_carry_a_copy_across_the_boundary() {
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "secret", b"outside\n");
    let root = repo(Some(INCLUDE));
    std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("link.env"))
        .unwrap();
    assert!(plan(root.path()).is_empty(), "링크 파일은 건너뛴다");

    let lane = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), lane.path().join("out")).unwrap();
    write(root.path(), "out/x.env", b"x\n");
    let cand = [Candidate {
        rel: "out/x.env".into(),
        size: 2,
    }];
    assert!(copy_into(root.path(), lane.path(), &cand).is_empty());
    assert!(
        !outside.path().join("x.env").exists(),
        "레인 밖에 쓰지 않는다"
    );
}

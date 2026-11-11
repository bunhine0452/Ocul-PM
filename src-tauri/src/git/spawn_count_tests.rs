//! git 을 **몇 번** 띄우는가 — Windows 성능 라운드 (2026-11-11).
//!
//! 윈도우에서 프로세스 하나가 10~30 ms 다. 화면 한 번 · 저장 한 번 · 일지 하나에 git 이
//! 몇 개 뜨는지가 곧 체감 속도라, 그 수를 테스트로 잠근다. 수는 `safe::spawn_count`
//! (스레드별 계수기)로 센다 — 나란히 도는 다른 테스트가 섞이지 않는다.
//!
//! 저장소는 테스트마다 새 임시 폴더라 캐시는 차갑게 시작한다. 「처음」 과 「다시」 를
//! 따로 잰다 — 변경 화면은 파일이 바뀔 때마다 다시 읽으므로 「다시」 가 체감을 정한다.

use std::collections::HashMap;
use std::path::Path;

use super::safe::spawn_count;
use super::*;
use crate::oculpm::spec::{FileOp, FileTouched};

fn git(dir: &Path, args: &[&str]) {
    let ok = crate::proc::std_cmd("git")
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    assert!(ok, "git {args:?}");
}

/// `root` 에 커밋 셋 — 파일 `n` 개를 하나씩 더하고, 마지막 커밋이 그중 하나를 고친다.
fn repo_with_files(n: usize) -> (tempfile::TempDir, std::path::PathBuf, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    std::fs::create_dir_all(root.join("src/deep")).unwrap();
    std::fs::create_dir_all(root.join("src/other")).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    let mut files = Vec::new();
    for i in 0..n {
        let rel = if i % 2 == 0 {
            format!("src/deep/f{i}.rs")
        } else {
            format!("src/other/f{i}.rs")
        };
        std::fs::write(root.join(&rel), format!("fn f{i}() {{}}\n")).unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-qm", &format!("add {i}")]);
        files.push(rel);
    }
    std::fs::write(root.join(&files[0]), "fn changed() {}\n").unwrap();
    git(&root, &["commit", "-qam", "change 0"]);
    (dir, root, files)
}

fn measure<T>(f: impl FnOnce() -> T) -> (usize, T) {
    let before = spawn_count();
    let out = f();
    (spawn_count() - before, out)
}

/// (a) 변경 화면 한 번 = 미커밋 목록 + 직전 커밋 + 머리글(브랜치·리모트).
#[test]
fn diff_screen_load_spawns() {
    let (_d, root, _) = repo_with_files(2);
    let load = || {
        let u = uncommitted_changes(&root);
        let l = last_commit_changes(&root);
        let s = status(&root);
        (u, l, s)
    };
    let (cold, (_, last, st)) = measure(load);
    assert!(last.is_some_and(|l| l.subject == "change 0" && l.changes.len() == 1));
    assert_eq!(st.head_branch.as_deref(), Some("main"));
    let (warm, _) = measure(load);
    eprintln!("[spawns] diff screen load: cold {cold} · warm {warm}");
    assert!(warm <= DIFF_WARM_MAX, "변경 화면 다시 읽기에 git {warm}개");
}

/// (b) 에이전트 저장 한 번의 기준선 동기 — 파일이 HEAD 에 있는가.
#[test]
fn baseline_save_spawns() {
    let (_d, root, files) = repo_with_files(4);
    let (first, a) = measure(|| path_in_head(&root, &files[0]));
    let (second, b) = measure(|| path_in_head(&root, &files[1]));
    std::fs::write(root.join("src/deep/new.rs"), "x\n").unwrap();
    let (third, c) = measure(|| path_in_head(&root, "src/deep/new.rs"));
    assert_eq!((a, b, c), (Some(true), Some(true), Some(false)));
    eprintln!("[spawns] baseline save: first {first} · other dir {second} · new file {third}");
    assert!(
        second + third <= SAVE_WARM_MAX,
        "저장 두 번에 git {}",
        second + third
    );
}

/// (c) 커밋이 끝난 일지 하나의 diff 캡처 — 파일 `N` 개가 전부 1단계(작업 트리)를 빗나간다.
#[test]
fn capture_spawns_for_n_committed_files() {
    const N: usize = 6;
    let (_d, root, files) = repo_with_files(N);
    let touched: Vec<FileTouched> = files
        .iter()
        .map(|p| FileTouched {
            path: p.clone(),
            op: FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        })
        .collect();
    let workday = chrono::Local::now().format("%Y%m%d").to_string();
    let entry = format!("{workday}/Bugs/2359_bug_spawns.md");
    let (n, res) = measure(|| {
        crate::oculpm::entry_diffs::capture_entry_diffs(
            &root,
            &entry,
            &touched,
            &HashMap::new(),
            &[],
        )
    });
    res.unwrap();
    let got = crate::oculpm::entry_diffs::read_entry_diffs(&root, &entry);
    assert_eq!(got.len(), N, "파일마다 커밋 diff 가 남는다");
    assert!(
        got[0].patch.contains("+fn changed() {}"),
        "{}",
        got[0].patch
    );
    eprintln!("[spawns] capture {N} committed files: {n}");
    assert!(n <= CAPTURE_MAX, "캡처 한 번에 git {n}개");
}

/// (c') 흔한 모양 — 에이전트가 파일 `N` 개를 한 커밋으로 올린 뒤의 캡처.
#[test]
fn capture_spawns_for_files_committed_together() {
    const N: usize = 6;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    std::fs::create_dir_all(root.join("src")).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    let files: Vec<String> = (0..N).map(|i| format!("src/f{i}.rs")).collect();
    for f in &files {
        std::fs::write(root.join(f), "a\n").unwrap();
    }
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-qm", "base"]);
    for f in &files {
        std::fs::write(root.join(f), "b\n").unwrap();
    }
    git(&root, &["commit", "-qam", "work"]);
    let touched: Vec<FileTouched> = files
        .iter()
        .map(|p| FileTouched {
            path: p.clone(),
            op: FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        })
        .collect();
    let workday = chrono::Local::now().format("%Y%m%d").to_string();
    let entry = format!("{workday}/Bugs/2359_bug_together.md");
    let (n, res) = measure(|| {
        crate::oculpm::entry_diffs::capture_entry_diffs(
            &root,
            &entry,
            &touched,
            &HashMap::new(),
            &[],
        )
    });
    res.unwrap();
    let got = crate::oculpm::entry_diffs::read_entry_diffs(&root, &entry);
    assert_eq!(got.len(), N);
    assert!(got.iter().all(|d| d.patch.contains("+b")), "{got:?}");
    eprintln!("[spawns] capture {N} files committed together: {n}");
    assert!(n <= CAPTURE_TOGETHER_MAX, "캡처 한 번에 git {n}개");
}

// 상한 — 지금 값에 맞춰 잠근다 (늘면 붉어진다). 이 라운드 전: 변경 화면 다시 읽기 6 ·
// 저장 두 번 4 · 따로 올린 6 파일 캡처 18.
const DIFF_WARM_MAX: usize = 1;
const SAVE_WARM_MAX: usize = 0;
const CAPTURE_MAX: usize = 10;
const CAPTURE_TOGETHER_MAX: usize = 5;

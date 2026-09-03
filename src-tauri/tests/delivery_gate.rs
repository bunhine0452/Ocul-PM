//! 배달 게이트가 **실제로 막는지** (플랜 `mcp-lifecycle-hooks`).
//!
//! `plugin/oculpm/hooks/delivery-gate.sh` 는 이 제품에서 기록 규율을 프롬프트가
//! 아니라 기계로 강제하는 **유일한 자리**다 (에이전틱 A/B 실측 2026-07-31:
//! 규칙 주입만으로는 헤드리스 세션 준수 0/12).
//!
//! 그런데 여태 그 계약을 무는 것은 `plugin_manifest.rs` 의 **문자열 존재 단언**
//! 뿐이었다 — 스크립트에 `exit 2` 라는 글자가 있는지만 봤다. 판정 로직을 통째로
//! 지우고 그 글자만 남겨도 통과한다. block/buzz 의 리뷰 규칙 3번이 말하는
//! 그대로다: **없애도 아무 테스트가 안 깨지는 가드는 아무것도 지키지 않는다.**
//!
//! 그래서 여기서는 스크립트를 진짜 실행하고 종료 코드를 본다.
//!
//! 유닉스 전용 — `/bin/sh` 와 git 이 있어야 하고, 훅 자체가 유닉스 셸이다.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn repo_root() -> PathBuf {
    // `src-tauri/` 에서 도는 테스트 — 플러그인은 저장소 루트 아래에 있다.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn gate_path() -> PathBuf {
    repo_root().join("plugin/oculpm/hooks/delivery-gate.sh")
}

/// 훅이 보는 stdin payload.
fn payload(session: &str, stop_hook_active: bool) -> String {
    format!(
        r#"{{"session_id":"{session}","hook_event_name":"Stop","stop_hook_active":{stop_hook_active}}}"#
    )
}

fn run_gate(root: &Path, payload: &str) -> Output {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new("/bin/sh")
        .arg(gate_path())
        .env("CLAUDE_PROJECT_DIR", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("훅을 띄우지 못했다");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(payload.as_bytes())
        .expect("payload 쓰기");
    child.wait_with_output().expect("훅 종료 대기")
}

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("git 실행");
    assert!(out.status.success(), "git {args:?} 실패: {out:?}");
}

/// 추적 중이고 커밋 하나가 있는 저장소 + 세션 마커.
fn tracked_repo(session: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
    std::fs::create_dir_all(root.join(".oculpm/journal")).unwrap();

    git(root, &["init", "-q"]);
    git(root, &["config", "user.email", "t@example.com"]);
    git(root, &["config", "user.name", "t"]);
    std::fs::write(root.join("README.md"), "seed\n").unwrap();
    git(root, &["add", "README.md"]);
    git(root, &["commit", "-qm", "seed"]);

    // 세션 마커 — 판정 기준점(이보다 새 변경만 이 세션의 것).
    std::fs::write(
        root.join(format!(".oculpm/hooks/.session-start-{session}")),
        "",
    )
    .unwrap();
    // mtime 비교가 초 단위 파일시스템에서도 갈리도록 한 박자 벌린다.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    dir
}

fn touch_code(root: &Path, name: &str) {
    std::fs::write(root.join(name), "changed\n").unwrap();
}

/// **이 게이트의 존재 이유** — 코드가 바뀌었는데 일지가 없으면 턴을 막는다.
#[test]
fn it_blocks_when_code_changed_without_a_journal() {
    let dir = tracked_repo("s1");
    touch_code(dir.path(), "src.rs");

    let out = run_gate(dir.path(), &payload("s1", false));
    assert_eq!(out.status.code(), Some(2), "차단은 exit 2 여야 한다");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("작업 일지가 없습니다"),
        "에이전트가 읽을 사유가 없다: {stderr}"
    );
    // 세션당 1회 — 플래그가 남는다.
    assert!(dir.path().join(".oculpm/hooks/.delivery-gate-s1").exists());
}

/// 이 세션에 일지를 이미 썼으면 통과한다.
#[test]
fn a_journal_written_this_session_lets_the_turn_end() {
    let dir = tracked_repo("s2");
    touch_code(dir.path(), "src.rs");
    let day = dir.path().join(".oculpm/journal/20260903/Bugs");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(day.join("1000_bug_x.md"), "[x] 고쳤다\n").unwrap();

    let out = run_gate(dir.path(), &payload("s2", false));
    assert_eq!(out.status.code(), Some(0), "일지가 있으면 막지 않는다");
}

/// **무한 차단 금지** — 이 게이트의 차단으로 이어진 턴이면 재차단하지 않는다.
#[test]
fn it_never_blocks_twice_in_a_row() {
    let dir = tracked_repo("s3");
    touch_code(dir.path(), "src.rs");

    let blocked = run_gate(dir.path(), &payload("s3", false));
    assert_eq!(blocked.status.code(), Some(2));
    // 공식 플래그가 붙어 돌아온 턴.
    let again = run_gate(dir.path(), &payload("s3", true));
    assert_eq!(
        again.status.code(),
        Some(0),
        "stop_hook_active 가드가 죽었다"
    );
    // 플래그를 지워도 세션당 1회 규율이 남아 다시 막지 않는다.
    let third = run_gate(dir.path(), &payload("s3", false));
    assert_eq!(third.status.code(), Some(0), "세션당 1회 규율이 죽었다");
}

/// 일지·훅 파일만 바뀐 것은 **코드 변경이 아니다** — 기록하고 끝낸 세션을
/// 붙잡으면 도구가 아니라 방해다.
#[test]
fn changes_inside_oculpm_alone_are_not_code_changes() {
    let dir = tracked_repo("s4");
    std::fs::write(dir.path().join(".oculpm/notes.md"), "메모\n").unwrap();

    let out = run_gate(dir.path(), &payload("s4", false));
    assert_eq!(out.status.code(), Some(0));
}

/// 세션 시작 **전부터** 있던 WIP 는 이 세션의 변경이 아니다.
#[test]
fn work_older_than_the_session_marker_is_not_attributed_to_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
    std::fs::create_dir_all(root.join(".oculpm/journal")).unwrap();
    git(root, &["init", "-q"]);
    git(root, &["config", "user.email", "t@example.com"]);
    git(root, &["config", "user.name", "t"]);
    std::fs::write(root.join("README.md"), "seed\n").unwrap();
    git(root, &["add", "README.md"]);
    git(root, &["commit", "-qm", "seed"]);

    // 변경이 **먼저**, 마커가 나중 — 이전 세션의 WIP 를 흉내 낸다.
    touch_code(root, "old_wip.rs");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(root.join(".oculpm/hooks/.session-start-s5"), "").unwrap();

    let out = run_gate(root, &payload("s5", false));
    assert_eq!(out.status.code(), Some(0), "남의 WIP 로 이 세션을 막았다");
}

/// 추적되지 않는 프로젝트에서는 **아무것도 하지 않는다.**
#[test]
fn an_untracked_project_is_silent() {
    let dir = tempfile::tempdir().unwrap();
    let out = run_gate(dir.path(), &payload("s6", false));
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stderr.is_empty());
}

/// 세션 마커가 없으면 **판정 불가** — 조용히 통과한다 (모름을 위반으로 읽지
/// 않는다는, 이 저장소가 반복해서 지키는 규율).
#[test]
fn without_a_session_marker_it_stays_silent() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
    git(root, &["init", "-q"]);
    touch_code(root, "src.rs");

    let out = run_gate(root, &payload("s7", false));
    assert_eq!(out.status.code(), Some(0));
}

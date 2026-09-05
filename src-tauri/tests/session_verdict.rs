//! 세 표면이 **같은 판정**을 부르는지 — 셸 훅(SessionEnd)이 남긴 원장 줄을
//! 앱(`claude_hooks::journal_missing_signals`)이 그대로 읽어 내는 왕복.
//!
//! 이 저장소는 "판정 로직을 지우고 `exit 2` 라는 글자만 남겨도 통과하던"
//! 테스트로 데인 적이 있다. 그래서 여기서도 문자열이 아니라 **행위**를 잰다:
//! 진짜 훅을 실행하고, 진짜 원장 파일을 만들고, 진짜 리더로 읽는다.
//!
//! 유닉스 전용 — 훅이 `/bin/sh` 이고 git 이 필요하다.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use ocul_pm_lib::oculpm::claude_hooks::journal_missing_signals;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn run_hook(name: &str, root: &Path, payload: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new("/bin/sh")
        .arg(repo_root().join("plugin/oculpm/hooks").join(name))
        .env("CLAUDE_PROJECT_DIR", root)
        .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"))
        .env_remove("CLAUDE_PLUGIN_ROOT")
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

/// 커밋 하나가 있는 저장소 + 이 대화의 세그먼트 마커·생존 흔적.
fn repo_with_session(conversation: &str) -> tempfile::TempDir {
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
    std::fs::write(
        root.join(format!(".oculpm/hooks/.session-start-{conversation}")),
        "",
    )
    .unwrap();
    std::fs::write(
        root.join(format!(".oculpm/hooks/.session-live-{conversation}")),
        "",
    )
    .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    dir
}

fn end_payload(conversation: &str) -> String {
    format!(r#"{{"session_id":"{conversation}","hook_event_name":"SessionEnd","reason":"clear"}}"#)
}

/// 미기록 대화 — 원장에 `missing` 이 남고, 앱이 그 줄을 신호로 읽는다.
#[test]
fn an_unrecorded_conversation_lands_in_the_ledger_and_the_app_reads_it() {
    let dir = repo_with_session("c1");
    std::fs::write(dir.path().join("src.rs"), "changed\n").unwrap();

    let out = run_hook("session-end.sh", dir.path(), &end_payload("c1"));
    assert_eq!(out.status.code(), Some(0), "SessionEnd 는 언제나 무해하다");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("일지 없이 끝났습니다"), "{stderr}");

    let ledger =
        std::fs::read_to_string(dir.path().join(".oculpm/hooks/journal-missing.jsonl")).unwrap();
    assert!(ledger.contains(r#""verdict":"missing""#), "{ledger}");
    assert!(
        ledger.ends_with('\n'),
        "줄이 개행으로 닫혀야 한다: {ledger:?}"
    );

    let signals = journal_missing_signals(dir.path(), 7);
    assert_eq!(signals.len(), 1, "앱이 그 줄을 신호로 읽어야 한다");
    assert_eq!(signals[0].session_id, "c1");
    assert_eq!(signals[0].segments, 1);

    // 세그먼트가 끝났으니 마커도 생존 흔적도 남지 않는다.
    assert!(!dir.path().join(".oculpm/hooks/.session-start-c1").exists());
    assert!(!dir.path().join(".oculpm/hooks/.session-live-c1").exists());
}

/// 옆 대화가 살아 있으면 **판정 불가**로 적힌다 — 미기록으로 뭉뚱그리지
/// 않는다. 그리고 판정 불가는 신호가 아니므로 카드에 뜨지 않는다.
#[test]
fn a_live_peer_is_recorded_as_undecided_not_missing() {
    let dir = repo_with_session("c2");
    std::fs::write(dir.path().join(".oculpm/hooks/.session-start-peer"), "").unwrap();
    std::fs::write(dir.path().join(".oculpm/hooks/.session-live-peer"), "").unwrap();
    std::fs::write(dir.path().join("src.rs"), "changed\n").unwrap();

    let out = run_hook("session-end.sh", dir.path(), &end_payload("c2"));
    assert_eq!(out.status.code(), Some(0));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("일지 없이 끝났습니다"),
        "판정 불가를 미기록이라고 말했다: {stderr}"
    );

    let ledger =
        std::fs::read_to_string(dir.path().join(".oculpm/hooks/journal-missing.jsonl")).unwrap();
    assert!(ledger.contains(r#""verdict":"undecided""#), "{ledger}");
    assert!(ledger.contains(r#""basis":"live_peers""#), "{ledger}");
    assert!(
        journal_missing_signals(dir.path(), 7).is_empty(),
        "판정 불가가 카드에 미기록으로 떴다"
    );
}

/// 기록한 대화는 원장에 아무것도 남기지 않는다 (신호 원장이지 감사 로그가
/// 아니다).
#[test]
fn a_recorded_conversation_leaves_no_row() {
    let dir = repo_with_session("c3");
    std::fs::write(dir.path().join("src.rs"), "changed\n").unwrap();
    let day = dir.path().join(".oculpm/journal/20260905/Chores");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(day.join("0001_chore_x.md"), "[x] 기록했다\n").unwrap();

    let out = run_hook("session-end.sh", dir.path(), &end_payload("c3"));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("세션 기록됨"), "{stderr}");
    assert!(!dir
        .path()
        .join(".oculpm/hooks/journal-missing.jsonl")
        .exists());
}

/// **진입점이 없으면 침묵한다.** 옛 셸 판정으로 폴백하지 않는다 — 폴백은
/// 방금 걷어낸 오탐을 되살리고, 바이너리가 없으면 게이트가 지시하는
/// `journal_write` 자체가 존재하지 않는다.
#[test]
fn without_the_verdict_binary_the_hooks_stay_silent() {
    use std::io::Write;
    let dir = repo_with_session("c4");
    std::fs::write(dir.path().join("src.rs"), "changed\n").unwrap();
    // bin/ 이 없는 가짜 플러그인 루트.
    let empty_plugin = tempfile::tempdir().unwrap();

    for (hook, payload) in [
        (
            "delivery-gate.sh",
            r#"{"session_id":"c4","hook_event_name":"Stop","stop_hook_active":false}"#.to_string(),
        ),
        ("session-end.sh", end_payload("c4")),
    ] {
        let mut child = Command::new("/bin/sh")
            .arg(repo_root().join("plugin/oculpm/hooks").join(hook))
            .env("CLAUDE_PROJECT_DIR", dir.path())
            .env("CLAUDE_PLUGIN_ROOT", empty_plugin.path())
            .env_remove("OCULPM_MCP_BIN")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(payload.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(0), "{hook} 이 세션을 막았다");
    }
    assert!(
        !dir.path().join(".oculpm/hooks/.delivery-gate-c4").exists(),
        "판정도 못 했는데 대화당 1회 플래그를 태웠다"
    );
    assert!(
        !dir.path()
            .join(".oculpm/hooks/journal-missing.jsonl")
            .exists(),
        "판정도 못 했는데 원장에 적었다"
    );
}

// ─── Claude Code 밖 ─────────────────────────────────────────────────────────

/// **Codex 도 이 훅들을 돌린다** (플랜 `v3-record-integrity` {#gate-beyond-cc}).
///
/// 실측 근거 (2026-09-03, Codex 0.153.4): 이 저장소의 `.oculpm/hooks/` 에
/// `SessionStart`·`Stop`·`SessionEnd` 세 이벤트가 Codex 세션(`transcript_path`
/// 가 `~/.codex/sessions/...`)에서 발화한 기록이 남아 있다. Codex 는 플러그인
/// 루트의 `hooks/hooks.json` 을 관례로 찾아 읽고 `CLAUDE_PLUGIN_ROOT` 도
/// 실어 준다 — 다만 **`CLAUDE_PROJECT_DIR` 은 주지 않는다.**
///
/// 그래서 예전에는 루트가 `.`(프로세스 cwd)로 접혔다. 세션 작업 폴더에서 훅이
/// 돌면 우연히 맞지만, 우연에 기대면 조용히 틀린다 — 틀린 방향이 **침묵**이라
/// 아무도 모른다. 이제 payload 의 `cwd` 가 그 자리를 대신하고, 이 테스트는
/// 훅을 **엉뚱한 디렉터리에서** 띄워 그것을 잰다.
#[test]
fn the_hooks_find_the_project_without_a_claude_project_dir() {
    use std::io::Write;
    let dir = repo_with_session("codex-1");
    let root = dir.path();
    std::fs::write(root.join("src.rs"), "codex 가 고쳤다\n").unwrap();
    // 훅이 도는 자리는 프로젝트가 아니다 — `.` 폴백으로는 절대 못 찾는다.
    let elsewhere = tempfile::tempdir().unwrap();

    let payload = format!(
        r#"{{"session_id":"codex-1","transcript_path":"/tmp/rollout.jsonl","cwd":"{}","hook_event_name":"SessionEnd","model":"gpt-5.6-terra","permission_mode":"default"}}"#,
        root.display()
    );
    let mut child = Command::new("/bin/sh")
        .arg(repo_root().join("plugin/oculpm/hooks/session-end.sh"))
        .current_dir(elsewhere.path())
        .env_remove("CLAUDE_PROJECT_DIR")
        .env_remove("CLAUDE_PLUGIN_ROOT")
        .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "SessionEnd 는 언제나 무해하다");

    let ledger = std::fs::read_to_string(root.join(".oculpm/hooks/journal-missing.jsonl"))
        .expect("payload 의 cwd 로 프로젝트를 못 찾았다 — 판정이 통째로 침묵했다");
    assert!(ledger.contains(r#""verdict":"missing""#), "{ledger}");
    assert_eq!(journal_missing_signals(root, 7).len(), 1);
    // 엉뚱한 자리에 파일을 흘리지 않는다.
    assert!(!elsewhere.path().join(".oculpm").exists());
}

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
//! 훅을 돌리는 셸은 Claude Code 와 같다 — macOS·Linux `/bin/sh`, Windows 는
//! **Git Bash** (<https://code.claude.com/docs/en/hooks> 「Shell Form」: Windows 는
//! Git Bash, 없으면 PowerShell). 그래서 Windows 러너에서도 같은 스크립트가 같은
//! 판정을 내는지 잰다 (크로스플랫폼 `#integ-hooks`).
// 테스트 픽스처의 git·셸·자식 프로세스 — 앱이 띄우는 프로세스가 아니라 proc.rs
// 창구 규칙(clippy.toml disallowed-methods) 밖이다.
#![allow(clippy::disallowed_methods)]

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

/// Claude Code 가 셸 형 훅을 돌리는 셸 — macOS·Linux `sh`, Windows Git Bash
/// (`bin\bash.exe` — Unix 도구를 `System32` 보다 앞에 두는 진입점).
fn hook_shell() -> PathBuf {
    if !cfg!(windows) {
        return PathBuf::from("/bin/sh");
    }
    let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|p| PathBuf::from(p).join("Git"))
        .collect();
    // `git --exec-path` = `<Git>/mingw64/libexec/git-core`.
    if let Ok(out) = Command::new("git").arg("--exec-path").output() {
        let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        roots.extend(exec.ancestors().nth(3).map(Path::to_path_buf));
    }
    roots
        .into_iter()
        .map(|r| r.join("bin").join("bash.exe"))
        .find(|p| p.is_file())
        .expect("Git Bash(bin\\bash.exe) 를 못 찾았다 — Windows 에서 훅을 돌리는 셸이라 이 테스트의 전제다")
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

    let mut child = Command::new(hook_shell())
        .arg(gate_path())
        .env("CLAUDE_PROJECT_DIR", root)
        // 판정 진입점 — 셔틀(`plugin/oculpm/bin/oculpm-mcp`)이 이 변수를 가장
        // 먼저 본다. 카고가 이번 빌드의 바이너리를 주므로 설치본이 아니라
        // **지금 고친 코드**를 시험한다.
        .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"))
        // 이 테스트를 도는 세션 자신이 플러그인을 로드했으면 이 변수가 설정돼
        // 있어 설치본을 가리킨다. 훅이 `$0` 로 스스로를 찾게 지운다.
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
    // 사유만으로는 모자란다 — 문구가 **무엇을 하라**까지 말해야 게이트가
    // 잔소리가 아니라 지시가 된다 (도구 이름 + 그 대화가 바꾼 파일).
    assert!(
        stderr.contains("journal_write") && stderr.contains("src.rs"),
        "에이전트가 무엇을 해야 할지 모른다: {stderr}"
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

// ─────────────────────────────────────────────────────────────────────────────
// 병렬 세션 (v3-record-integrity {#gate-parallel-test})
// ─────────────────────────────────────────────────────────────────────────────

/// 옆 대화가 **살아 있다**는 흔적을 남긴다 — 마커(시작했다) + 생존 파일(이번
/// 턴에 Stop 훅이 돌았다). 게이트는 이 둘이 다 있는 대화만 용의자로 센다.
fn live_peer(root: &Path, conversation: &str) {
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
}

/// **골든 케이스 (2026-09-05 실측)** — 저장소에 한 글자도 쓰지 않은 읽기 전용
/// 조사 세션에 `.delivery-gate-…` 플래그가 생겼다. 같은 워킹트리에서 **다른
/// 에이전트**가 편집한 파일이 이 세션의 마커보다 새로웠다는 것이 유일한 근거
/// 였다. 프로젝트 전역 mtime 은 *누가* 고쳤는지 말하지 못한다 — 말하지 못하면
/// 침묵해야지, 아무나 붙잡으면 안 된다.
#[test]
fn a_live_peers_edits_do_not_accuse_a_read_only_session() {
    let dir = tracked_repo("sA");
    live_peer(dir.path(), "sB");
    // 옆 대화 B 가 파일을 고쳤다. A 는 읽기만 했다.
    touch_code(dir.path(), "src.rs");

    let out = run_gate(dir.path(), &payload("sA", false));
    assert_eq!(
        out.status.code(),
        Some(0),
        "읽기만 한 세션을 옆 세션의 편집으로 붙잡았다: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !dir.path().join(".oculpm/hooks/.delivery-gate-sA").exists(),
        "발화 플래그까지 남겨 이 세션의 남은 턴을 영영 판정 불가로 만들었다"
    );
}

/// 그런데 **죽은 옆 세션**(마커만 남고 생존 흔적이 없다)은 용의자가 아니다.
/// 크래시 잔여 마커는 7일간 남는다 — 그것만으로 판정을 접으면 게이트는
/// 사고 한 번에 영구히 침묵한다.
#[test]
fn a_stale_peer_marker_does_not_mute_the_gate() {
    let dir = tracked_repo("sC");
    // 마커만 있고 생존 파일이 없다 = 크래시로 남은 잔여.
    std::fs::write(dir.path().join(".oculpm/hooks/.session-start-dead"), "").unwrap();
    touch_code(dir.path(), "src.rs");

    let out = run_gate(dir.path(), &payload("sC", false));
    assert_eq!(
        out.status.code(),
        Some(2),
        "잔여 마커 하나로 게이트가 영구 침묵했다"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 확인 게이트 (플랜 `agent-era-20261122` {#check-gate})
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_UPDATE_TOOL: &str = "mcp__plugin_oculpm_oculpm__plan_update";

/// 훅 payload 에 트랜스크립트 경로를 싣는다 (Windows 경로의 `\` 는 JSON 이 알아서 싼다).
fn payload_with_transcript(session: &str, transcript: &Path) -> String {
    serde_json::json!({
        "session_id": session,
        "hook_event_name": "Stop",
        "stop_hook_active": false,
        "transcript_path": transcript.to_string_lossy(),
    })
    .to_string()
}

/// 성공한 도구 호출 하나 — 호출 줄과 결과 줄.
fn tool_call(id: &str, name: &str, input: serde_json::Value) -> String {
    let call = serde_json::json!({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": id, "name": name, "input": input}
    ]}});
    let result = serde_json::json!({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": id, "is_error": false}
    ]}});
    format!("{call}\n{result}\n")
}

fn write_transcript(root: &Path, lines: &[String]) -> PathBuf {
    let path = root.join(".oculpm/hooks/transcript.jsonl");
    std::fs::write(&path, lines.concat()).unwrap();
    path
}

/// 확인 명령이 있는 진행 중 계획 하나.
fn plan_with_check(root: &Path, check: &str) {
    let planner = root.join(".oculpm/planner");
    std::fs::create_dir_all(&planner).unwrap();
    std::fs::write(
        planner.join("round.md"),
        format!(
            "---\noculpm_plan: v1\nid: round\ntitle: \"라운드\"\nstatus: active\ncreated: 2026-11-22\nupdated: 2026-11-22\nowner: claude-code\n---\n\n**완료 조건:** 초록\n**확인 명령:** {check}\n\n## 단계 {{#p}}\n- [x] 하나 {{#a}}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n"
        ),
    )
    .unwrap();
}

fn close_item(note: Option<&str>) -> String {
    let mut input = serde_json::json!({"plan_id": "round", "item_id": "a", "status": "done"});
    if let Some(note) = note {
        input["note"] = note.into();
    }
    tool_call("p1", PLAN_UPDATE_TOOL, input)
}

/// **이 게이트의 존재 이유** — 항목을 닫았는데 확인 명령을 돌린 기록이 없으면 한 번 짚는다.
/// 「됐다」 는 주장은 판정이 아니다.
#[test]
fn it_asks_for_a_verdict_when_an_item_was_closed_without_one() {
    let dir = tracked_repo("c1");
    let root = dir.path();
    plan_with_check(root, "cargo test --locked");
    let transcript = write_transcript(root, &[close_item(Some("다 됐다"))]);

    let out = run_gate(root, &payload_with_transcript("c1", &transcript));
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("확인 게이트")
            && stderr.contains("cargo test --locked")
            && stderr.contains("plan_update")
            && stderr.contains("판정 ✓"),
        "무엇을 돌리고 어디에 남길지 말해야 한다: {stderr}"
    );
    assert!(
        !stderr.contains("배달 게이트"),
        "바꾼 파일이 없는데 일지를 요구했다: {stderr}"
    );
    assert!(root.join(".oculpm/hooks/.check-gate-c1").exists());
    assert!(
        !root.join(".oculpm/hooks/.delivery-gate-c1").exists(),
        "뜨지 않은 게이트의 플래그를 남기면 그 게이트가 이 대화에서 꺼진다"
    );
    // 대화당 한 번.
    let again = run_gate(root, &payload_with_transcript("c1", &transcript));
    assert_eq!(again.status.code(), Some(0), "확인 게이트가 두 번 떴다");
}

/// 판정을 남겼으면(실패 판정이어도) 조용하다 — 닫기 전이든 뒤든.
#[test]
fn a_verdict_in_the_same_conversation_lets_the_turn_end() {
    let dir = tracked_repo("c2");
    let root = dir.path();
    plan_with_check(root, "cargo test --locked");
    for note in ["판정 ✓ 1227 passed; 0 failed", "판정 ✗ 2 failed"] {
        let transcript = write_transcript(root, &[close_item(Some(note))]);
        let out = run_gate(root, &payload_with_transcript("c2", &transcript));
        assert_eq!(
            out.status.code(),
            Some(0),
            "{note}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    assert!(!root.join(".oculpm/hooks/.check-gate-c2").exists());
}

/// 확인 명령이 없는 계획은 물을 것이 없고, 트랜스크립트가 없으면 모른다 — 둘 다 침묵.
#[test]
fn no_check_command_or_no_transcript_is_silent() {
    let dir = tracked_repo("c3");
    let root = dir.path();
    plan_with_check(root, "cargo test");
    let transcript = write_transcript(root, &[close_item(None)]);
    // 트랜스크립트 경로가 없는 payload — 예전 모양 그대로.
    assert_eq!(run_gate(root, &payload("c3", false)).status.code(), Some(0));
    // 확인 명령 줄을 지운 계획.
    let plan = root.join(".oculpm/planner/round.md");
    let text = std::fs::read_to_string(&plan).unwrap();
    std::fs::write(&plan, text.replace("**확인 명령:** cargo test\n", "")).unwrap();
    let out = run_gate(root, &payload_with_transcript("c3", &transcript));
    assert_eq!(out.status.code(), Some(0), "{out:?}");
}

/// 일지도 없고 판정도 없으면 **한 번에** 둘 다 말한다 — 두 번 막아 두 턴을 쓰지 않는다.
#[test]
fn both_gates_speak_in_one_block() {
    let dir = tracked_repo("c4");
    let root = dir.path();
    plan_with_check(root, "pnpm test");
    touch_code(root, "src.rs");
    let transcript = write_transcript(root, &[close_item(None)]);

    let out = run_gate(root, &payload_with_transcript("c4", &transcript));
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("배달 게이트") && stderr.contains("src.rs"),
        "{stderr}"
    );
    assert!(
        stderr.contains("확인 게이트") && stderr.contains("pnpm test"),
        "{stderr}"
    );
    for flag in [".delivery-gate-c4", ".check-gate-c4"] {
        assert!(root.join(".oculpm/hooks").join(flag).exists(), "{flag}");
    }
    assert_eq!(
        run_gate(root, &payload_with_transcript("c4", &transcript))
            .status
            .code(),
        Some(0)
    );
}

/// 배달 게이트가 먼저 뜬 대화에서도, 나중에 항목을 판정 없이 닫으면 확인 게이트는 따로 한 번 뜬다.
#[test]
fn the_check_gate_still_fires_after_the_journal_gate_did() {
    let dir = tracked_repo("c5");
    let root = dir.path();
    plan_with_check(root, "make check");
    touch_code(root, "src.rs");
    let empty = write_transcript(root, &[]);
    assert_eq!(
        run_gate(root, &payload_with_transcript("c5", &empty))
            .status
            .code(),
        Some(2),
        "배달 게이트"
    );
    let transcript = write_transcript(root, &[close_item(None)]);
    let out = run_gate(root, &payload_with_transcript("c5", &transcript));
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("확인 게이트") && !stderr.contains("배달 게이트"),
        "이미 뜬 배달 게이트를 다시 말했다: {stderr}"
    );
}

/// 임시 폴더에 훅과 가짜 「바이너리」 를 두고 돌린다 — 옛 판 앱 · 앱이 없는 기기를 흉내 낸다.
fn run_isolated_gate(
    plugin: &Path,
    root: &Path,
    payload: &str,
    binary: Option<&Path>,
    remote: bool,
) -> Output {
    use std::io::Write;
    use std::process::Stdio;

    let home = plugin.join("empty-home");
    std::fs::create_dir_all(&home).unwrap();
    let mut cmd = Command::new(hook_shell());
    cmd.arg(plugin.join("hooks/delivery-gate.sh"))
        .env("CLAUDE_PROJECT_DIR", root)
        .env_remove("CLAUDE_PLUGIN_ROOT")
        .env_remove("OCULPM_MCP_BIN")
        .env_remove("CLAUDE_CODE_REMOTE")
        .env("HOME", &home)
        .env("LOCALAPPDATA", &home);
    for var in ["XDG_DATA_HOME", "ProgramFiles", "ProgramW6432"] {
        cmd.env_remove(var);
    }
    if let Some(binary) = binary {
        cmd.env("OCULPM_MCP_BIN", binary);
    }
    if remote {
        cmd.env("CLAUDE_CODE_REMOTE", "true");
    }
    let mut child = cmd
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

/// 훅과 셔틀만 임시 폴더로 — 리포 안에서 돌리면 셔틀이 개발 빌드를 찾아 버린다.
fn isolated_plugin() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for rel in ["hooks/delivery-gate.sh", "bin/oculpm-mcp"] {
        let to = dir.path().join(rel);
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::copy(repo_root().join("plugin/oculpm").join(rel), &to).unwrap();
        make_executable(&to);
    }
    dir
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// **플러그인만 먼저 올라간 사용자** — 옛 앱의 바이너리는 `gate` 를 몰라 exit 2 를 낸다.
/// 그때 훅이 예전 `verdict` 로 물러나 배달 게이트를 그대로 지킨다.
#[test]
fn an_old_binary_without_gate_keeps_the_journal_gate() {
    let dir = tracked_repo("o1");
    let root = dir.path();
    let plugin = isolated_plugin();
    let old = plugin.path().join("old-oculpm-mcp");
    std::fs::write(
        &old,
        "#!/bin/sh\ncase \"$1\" in\n  verdict) echo \"oculpm 배달 게이트: 옛 판의 전문\"; exit 10 ;;\n  *) echo \"oculpm-mcp: unknown argument $1\" >&2; exit 2 ;;\nesac\n",
    )
    .unwrap();
    make_executable(&old);
    let out = run_isolated_gate(
        plugin.path(),
        root,
        &payload("o1", false),
        Some(&old),
        false,
    );
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stderr).contains("옛 판의 전문"));
    assert!(root.join(".oculpm/hooks/.delivery-gate-o1").exists());
    assert!(!root.join(".oculpm/hooks/.check-gate-o1").exists());
}

/// **앱이 없는 클라우드 세션** — 바이너리를 못 찾으면 로컬에서는 예전처럼 침묵하지만, 클라우드
/// (`CLAUDE_CODE_REMOTE=true`)에서는 셸이 대신 묻는다: 이 대화의 편집이 있는데 마커보다 새 일지가
/// 없으면 한 번 막고, **도구 없이 할 수 있는 지시**(규격서를 읽고 파일로)를 한다.
/// macOS 는 개발 기기에 설치본(`/Applications`)이 있을 수 있어 제외한다.
#[cfg(not(target_os = "macos"))]
#[test]
fn a_cloud_session_without_the_app_is_still_asked_for_a_journal() {
    let dir = tracked_repo("r1");
    let root = dir.path();
    let plugin = isolated_plugin();
    let edit = tool_call(
        "e1",
        "Edit",
        serde_json::json!({"file_path": root.join("src.rs").to_string_lossy()}),
    );
    let transcript = write_transcript(root, &[edit]);
    let stop = payload_with_transcript("r1", &transcript);

    // 로컬(표식 없음) — 침묵. MCP 도구가 없는 곳에서 journal_write 를 시키지 않는다.
    let local = run_isolated_gate(plugin.path(), root, &stop, None, false);
    assert_eq!(local.status.code(), Some(0), "{local:?}");
    assert!(local.stderr.is_empty());

    let out = run_isolated_gate(plugin.path(), root, &stop, None, true);
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("journal-spec.md") && !stderr.contains("journal_write"),
        "없는 도구를 시키면 안 된다: {stderr}"
    );
    assert!(root.join(".oculpm/hooks/.delivery-gate-r1").exists());
    // 대화당 한 번.
    assert_eq!(
        run_isolated_gate(plugin.path(), root, &stop, None, true)
            .status
            .code(),
        Some(0)
    );
}

/// 클라우드 폴백이 붙잡지 않는 것 — 일지를 쓴 세션, `.oculpm/` 안만 고친 세션, 읽기만 한 세션.
#[cfg(not(target_os = "macos"))]
#[test]
fn the_cloud_fallback_stays_silent_when_recorded_or_nothing_was_edited() {
    let plugin = isolated_plugin();
    let edit_of = |root: &Path, rel: &str| {
        tool_call(
            "e1",
            "Write",
            serde_json::json!({"file_path": root.join(rel).to_string_lossy().replace('\\', "/")}),
        )
    };
    let run = |root: &Path, session: &str, lines: &[String]| {
        let transcript = write_transcript(root, lines);
        run_isolated_gate(
            plugin.path(),
            root,
            &payload_with_transcript(session, &transcript),
            None,
            true,
        )
    };

    // 일지를 썼다 (마커보다 새 일지).
    let recorded = tracked_repo("r2");
    let root = recorded.path();
    let day = root.join(".oculpm/journal/20261122/Bugs");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(day.join("1000_bug_x.md"), "[x] 고쳤다\n").unwrap();
    let out = run(root, "r2", &[edit_of(root, "src.rs")]);
    assert_eq!(out.status.code(), Some(0), "{out:?}");

    // 기록 폴더 안만 고쳤다.
    let inside = tracked_repo("r3");
    let root = inside.path();
    let out = run(root, "r3", &[edit_of(root, ".oculpm/planner/p.md")]);
    assert_eq!(out.status.code(), Some(0), "{out:?}");

    // 읽기만 했다.
    let read_only = tracked_repo("r4");
    let root = read_only.path();
    let read = tool_call("r1", "Read", serde_json::json!({"file_path": "/x/src.rs"}));
    let out = run(root, "r4", &[read]);
    assert_eq!(out.status.code(), Some(0), "{out:?}");
}

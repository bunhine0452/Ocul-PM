//! **크로스에이전트 상호 인식** — 앱 안 ACP 대화와 Claude Code 대화가 같은
//! 워킹트리에서 서로를 용의자로 보는가 (플랜 `v3-record-integrity`
//! {#gate-beyond-cc}).
//!
//! 이 항목의 존재 이유가 여기 두 방향으로 적혀 있다.
//!
//! - **ACP → CC**: 앱 안 대화가 고친 파일이 옆 Claude Code 세션의 게이트를
//!   울리면 안 된다. 2026-09-05 에 실제로 그랬다 — 저장소에 한 글자도 쓰지 않은
//!   조사 세션이 붙잡혔고, 근거는 "다른 에이전트가 고친 파일이 내 마커보다
//!   새롭다" 하나였다. 판정을 고쳐도 **흔적을 안 남기는 편집자**가 있으면 그대로
//!   재발한다.
//! - **CC → ACP**: 반대도 같다. 살아 있는 CC 대화가 있으면 앱 안 대화의 판정은
//!   이의가 아니라 **판정 불가**여야 한다.
//!
//! 재는 것은 **행위**다: 진짜 git 저장소를 만들고, 진짜 훅을 실행하고, 앱 쪽은
//! 인프로세스 판정을 그대로 부른다. 첫 테스트에는 **대조군**이 붙어 있다 —
//! 흔적이 없으면 게이트가 실제로 울린다는 것을 같은 자리에서 보인다. 대조군이
//! 없으면 "원래 안 울리는 상황"을 고쳤다고 착각할 수 있다.
//!
//! 유닉스 전용 — 훅이 `/bin/sh` 이고 git 이 필요하다.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use ocul_pm_lib::acp::journal_gate::{self, AcpGateState};
use ocul_pm_lib::oculpm::claude_hooks::journal_missing_signals;
use ocul_pm_lib::oculpm::verdict::markers;

const ACP_UUID: &str = "9f1c0d2e-1111-4444-8888-aaaabbbbcccc";
const ACP_TOKEN: &str = "acp-20260905-abcd1234";

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("git 실행");
    assert!(out.status.success(), "git {args:?} 실패: {out:?}");
}

/// 커밋 하나가 있는 추적 저장소 + **Claude Code 대화 하나의** 마커·생존 흔적.
fn repo_with_cc_session(conversation: &str) -> tempfile::TempDir {
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
    for name in [
        format!(".session-start-{conversation}"),
        format!(".session-live-{conversation}"),
    ] {
        std::fs::write(root.join(".oculpm/hooks").join(name), "").unwrap();
    }
    // 마커보다 **새로운** 변경만 이 대화의 것으로 세므로, 그 경계를 벌린다.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    dir
}

/// Claude Code 의 `Stop` 훅을 실제로 돌린다. 종료 코드 2 = 턴 차단.
fn run_delivery_gate(root: &Path, conversation: &str) -> Output {
    use std::io::Write;
    let payload = format!(
        r#"{{"session_id":"{conversation}","cwd":"{}","hook_event_name":"Stop","stop_hook_active":false}}"#,
        root.display()
    );
    let mut child = Command::new("/bin/sh")
        .arg(repo_root().join("plugin/oculpm/hooks/delivery-gate.sh"))
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

fn touch_code(root: &Path, name: &str) {
    std::fs::write(root.join(name), "// ACP 대화가 고쳤다\n").unwrap();
}

/// 이 대화가 자기 이름으로 쓴 일지.
fn write_journal(root: &Path, conversation: &str, slug: &str) {
    let dir = root.join(".oculpm/journal/20260905/Chores");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("0001_chore_{slug}.md")),
        format!(
            "---\nschema_version: 1\ntype: chore\nslug: {slug}\nstatus: done\ndifficulty: low\n\
             created_at: 2026-09-05T10:00:00+09:00\nsession_id: 20260905-001\nagent:\n  \
             id: claude-code\n  session: {conversation}\n---\n[x] 기록했다\n"
        ),
    )
    .unwrap();
}

// ─── ACP → CC ───────────────────────────────────────────────────────────────

/// **이 항목의 존재 이유.** 앱 안 ACP 대화의 편집이 옆 Claude Code 세션의 턴을
/// 막으면 안 된다.
///
/// 대조군이 같은 테스트 안에 있다: 흔적을 남기기 **전**에는 게이트가 실제로
/// 막는다. 그 줄이 없으면 이 단언은 "원래 안 막히는 상황"을 확인할 뿐이다.
#[test]
fn an_acp_conversations_edits_do_not_block_a_claude_code_turn() {
    let dir = repo_with_cc_session("cc-1");
    let root = dir.path();
    let state = AcpGateState::default();

    // 대조군 — 흔적 없는 편집자. 게이트는 CC 세션을 붙잡는다.
    touch_code(root, "src.rs");
    let blocked = run_delivery_gate(root, "cc-1");
    assert_eq!(
        blocked.status.code(),
        Some(2),
        "대조군이 안 막혔다 — 이 테스트가 무엇도 지키지 못한다: {}",
        String::from_utf8_lossy(&blocked.stderr)
    );
    // 대화당 1회 플래그가 섰으니 같은 대화로는 다시 못 잰다.
    std::fs::remove_file(root.join(".oculpm/hooks/.delivery-gate-cc-1")).unwrap();

    // 이제 ACP 대화가 **훅과 같은 자리에** 흔적을 남긴다.
    journal_gate::opened(root, ACP_TOKEN);
    touch_code(root, "src2.rs");
    journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN);

    let out = run_delivery_gate(root, "cc-1");
    assert_eq!(
        out.status.code(),
        Some(0),
        "ACP 대화의 편집이 CC 세션의 턴을 막았다: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !root.join(".oculpm/hooks/.delivery-gate-cc-1").exists(),
        "판정 불가인데 CC 대화의 1회 플래그를 태웠다"
    );
}

/// 흔적이 **낡으면** 다시 용의자가 아니다 — 죽은 ACP 대화가 CC 게이트를 영구히
/// 침묵시키면 게이트는 사고 한 번에 눈을 감는다.
#[test]
fn a_dead_acp_conversation_stops_shielding_the_working_tree() {
    let dir = repo_with_cc_session("cc-2");
    let root = dir.path();

    journal_gate::opened(root, ACP_TOKEN);
    // 생존 흔적만 창 밖으로 밀어 둔다 (마커는 7일까지 남는 것이 정상이다).
    let live = root
        .join(".oculpm/hooks")
        .join(format!(".session-live-{ACP_TOKEN}"));
    let file = std::fs::OpenOptions::new().write(true).open(&live).unwrap();
    let stale = std::time::SystemTime::now() - std::time::Duration::from_secs(12 * 3600);
    file.set_times(std::fs::FileTimes::new().set_modified(stale))
        .unwrap();

    touch_code(root, "src.rs");
    let out = run_delivery_gate(root, "cc-2");
    assert_eq!(
        out.status.code(),
        Some(2),
        "죽은 옆 대화의 잔여 흔적이 게이트를 침묵시켰다"
    );
}

// ─── CC → ACP ───────────────────────────────────────────────────────────────

/// 반대 방향. 살아 있는 CC 대화가 있으면 앱 안 대화의 판정은 **판정 불가**다 —
/// 이의를 내지 않고, 배너도 안 뜬다.
#[test]
fn a_live_claude_code_conversation_makes_the_acp_verdict_undecided() {
    let dir = repo_with_cc_session("cc-3");
    let root = dir.path();
    let state = AcpGateState::default();

    journal_gate::opened(root, ACP_TOKEN);
    touch_code(root, "src.rs");

    assert!(
        journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).is_none(),
        "옆 CC 대화가 살아 있는데 ACP 대화를 붙잡았다"
    );
    assert!(state.get(ACP_UUID).is_none(), "배너가 떴다");
    assert!(
        !root
            .join(".oculpm/hooks")
            .join(format!(".delivery-gate-{ACP_TOKEN}"))
            .exists(),
        "판정 불가인데 대화당 1회 플래그를 태웠다"
    );
}

/// 용의자가 우리뿐이면 붙잡는다 — 그리고 **딱 한 번**.
#[test]
fn a_lone_acp_conversation_is_objected_to_once_and_lands_in_the_ledger() {
    let dir = repo_with_cc_session("cc-4");
    let root = dir.path();
    let state = AcpGateState::default();
    // 옆 CC 대화를 죽인다 (session-end.sh 가 하는 일).
    for name in [".session-start-cc-4", ".session-live-cc-4"] {
        std::fs::remove_file(root.join(".oculpm/hooks").join(name)).unwrap();
    }

    journal_gate::opened(root, ACP_TOKEN);
    touch_code(root, "src.rs");

    let first = journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).expect("이의");
    assert_eq!(first.acp_session_id, ACP_UUID);
    assert_eq!(first.conversation, ACP_TOKEN);
    assert!(first.changed.contains(&"src.rs".to_string()), "{first:?}");
    assert!(first.action.contains("journal_write"), "{}", first.action);
    assert_eq!(state.get(ACP_UUID).as_ref(), Some(&first), "배너가 안 떴다");

    // 원장에 한 줄, 그리고 앱이 그 줄을 신호로 읽는다.
    let ledger = std::fs::read_to_string(root.join(".oculpm/hooks/journal-missing.jsonl")).unwrap();
    assert_eq!(ledger.lines().count(), 1, "{ledger}");
    assert!(ledger.contains(r#""verdict":"missing""#), "{ledger}");
    let signals = journal_missing_signals(root, 7);
    assert_eq!(signals.len(), 1);
    assert_eq!(signals[0].session_id, ACP_TOKEN);

    // 다음 턴에도 배너는 살아 있지만 **원장은 안 는다** — 한 대화가 원장을
    // 통째로 밀어내면 다른 대화의 신호가 사라진다.
    touch_code(root, "src2.rs");
    let second = journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).expect("이의");
    assert!(second.changed.len() >= 2, "{second:?}");
    let ledger = std::fs::read_to_string(root.join(".oculpm/hooks/journal-missing.jsonl")).unwrap();
    assert_eq!(ledger.lines().count(), 1, "원장이 매 턴 늘었다: {ledger}");
}

/// **기록하면 배너가 사라진다.** 한 번 뜬 경고가 안 없어지면 사용자는 배너를
/// 끄는 법을 배운다.
#[test]
fn recording_the_work_takes_the_banner_down() {
    let dir = repo_with_cc_session("cc-5");
    let root = dir.path();
    let state = AcpGateState::default();
    for name in [".session-start-cc-5", ".session-live-cc-5"] {
        std::fs::remove_file(root.join(".oculpm/hooks").join(name)).unwrap();
    }

    journal_gate::opened(root, ACP_TOKEN);
    touch_code(root, "src.rs");
    assert!(journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).is_some());

    // 에이전트가 자기 신원으로 일지를 쓴다 (판정 사다리 1순위).
    write_journal(root, ACP_TOKEN, "acp");
    assert!(
        journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).is_none(),
        "기록했는데 여전히 붙잡는다"
    );
    assert!(state.get(ACP_UUID).is_none(), "배너가 안 걷혔다");
}

/// **앱 안 대화 둘도 서로를 붙잡지 않는다.** Claude 패널과 Codex 패널을 나란히
/// 돌리는 것이 이 앱의 기본 사용법이고, 그 둘은 같은 워킹트리를 만진다.
///
/// 한쪽만 흔적을 남기던 시절이라면 이 상황에서 부지런한 쪽이 게으른 쪽의 편집을
/// 자기 것으로 뒤집어썼다. 이제 둘 다 같은 자리에 남기므로 **양쪽 다 판정 불가**다.
#[test]
fn two_in_app_conversations_do_not_accuse_each_other() {
    let dir = repo_with_cc_session("cc-6");
    let root = dir.path();
    let state = AcpGateState::default();
    // 셸 훅 쪽 대화는 없다 — 용의자는 앱 안의 둘뿐인 상황을 만든다.
    for name in [".session-start-cc-6", ".session-live-cc-6"] {
        std::fs::remove_file(root.join(".oculpm/hooks").join(name)).unwrap();
    }

    const CODEX_UUID: &str = "0a1b2c3d-2222-4444-8888-ddddeeeeffff";
    const CODEX_TOKEN: &str = "acp-20260905-99887766";
    journal_gate::opened(root, ACP_TOKEN);
    journal_gate::opened(root, CODEX_TOKEN);

    // Codex 쪽이 파일을 고쳤다. 파일시스템은 그것을 말하지 않는다.
    touch_code(root, "src.rs");

    assert!(
        journal_gate::turn_ended(&state, root, ACP_UUID, ACP_TOKEN).is_none(),
        "옆 패널의 편집으로 Claude 대화를 붙잡았다"
    );
    assert!(
        journal_gate::turn_ended(&state, root, CODEX_UUID, CODEX_TOKEN).is_none(),
        "옆 패널이 살아 있는데 Codex 대화를 붙잡았다"
    );
    assert!(
        !root.join(".oculpm/hooks/journal-missing.jsonl").exists(),
        "판정 불가인데 원장에 미기록을 적었다"
    );
}

// ─── 세그먼트를 닫는다 ──────────────────────────────────────────────────────

/// 대화를 내리면 판정 한 줄을 남기고 흔적을 거둔다 — `session-end.sh` 와 같은
/// 순서(판정 먼저, 청소 나중)여야 판정이 자기 마커를 찾을 수 있다.
#[test]
fn closing_a_conversation_judges_first_then_sweeps_its_traces() {
    let dir = repo_with_cc_session("cc-7");
    let root = dir.path();
    let state = AcpGateState::default();
    for name in [".session-start-cc-7", ".session-live-cc-7"] {
        std::fs::remove_file(root.join(".oculpm/hooks").join(name)).unwrap();
    }

    journal_gate::opened(root, ACP_TOKEN);
    touch_code(root, "src.rs");
    journal_gate::closed(&state, root, ACP_UUID, ACP_TOKEN);

    let ledger = std::fs::read_to_string(root.join(".oculpm/hooks/journal-missing.jsonl")).unwrap();
    assert!(
        ledger.contains(r#""verdict":"missing""#),
        "청소가 판정보다 먼저 돌아 마커를 못 찾았다: {ledger}"
    );
    let hooks = markers::hooks_dir(root);
    assert!(!hooks.join(format!(".session-start-{ACP_TOKEN}")).exists());
    assert!(!hooks.join(format!(".session-live-{ACP_TOKEN}")).exists());
    assert!(state.get(ACP_UUID).is_none());
}

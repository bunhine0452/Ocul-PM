//! 잠자기 막기 — 언제 잡고 푸는가(순수 판정)와, 무엇을 「일하는 세션」 으로 세는가(진짜 PTY).

use super::*;

#[test]
fn holds_only_while_enabled_and_something_works() {
    assert_eq!(step(false, true, 1), Step::Hold);
    assert_eq!(step(false, true, 3), Step::Hold);
    assert_eq!(
        step(true, true, 2),
        Step::Stay,
        "이미 잡았으면 다시 잡지 않는다"
    );
    assert_eq!(
        step(true, true, 0),
        Step::Release,
        "일하는 세션이 0 이 되면 곧바로 푼다"
    );
    assert_eq!(
        step(true, false, 4),
        Step::Release,
        "끄면 일하는 중이어도 푼다"
    );
    assert_eq!(
        step(false, false, 4),
        Step::Stay,
        "꺼져 있으면 잡지 않는다(기본)"
    );
    assert_eq!(step(false, true, 0), Step::Stay);
}

#[test]
fn only_an_explicit_on_turns_it_on() {
    assert!(enabled_from(Some("on")));
    assert!(enabled_from(Some(" on\n")));
    assert!(!enabled_from(Some("off")));
    assert!(!enabled_from(Some("true")));
    assert!(!enabled_from(Some("")));
    assert!(!enabled_from(None), "저장된 값이 없으면 꺼짐");
}

#[test]
fn supported_where_an_in_process_api_exists() {
    assert_eq!(SUPPORTED, cfg!(any(target_os = "macos", windows)));
}

/// macOS — IOKit 이 단언을 받고 돌려준다(FFI 모양이 틀리면 여기서 깨진다). 자식 프로세스 없이 프로세스 안에서.
#[cfg(target_os = "macos")]
#[test]
fn macos_assertion_is_created_and_released_in_process() {
    let h = platform::create().expect("IOPMAssertionCreateWithName 이 거절했다");
    assert!(platform::destroy(h), "IOPMAssertionRelease 가 거절했다");
}

/// 일하는 세션 — 상태가 working 이고 셸 위에서 무언가 돈다. claude 가 `state=clear` 없이 죽어 셸이 다시 앞이면
/// 낡은 working 이라 세지 않는다(잠들지 못하는 기기가 되지 않게). idle 로 바뀌면 0.
#[cfg(unix)]
#[test]
fn working_all_counts_live_working_programs_not_stale_reports() {
    use crate::terminal::tests::{sh, spec, start_cmd, wait_until};
    use std::time::Duration;

    let sessions = TermSessions::default();
    assert_eq!(sessions.working_all(), 0);
    let mut cmd = sh("exec /bin/sh -i");
    cmd.env("PS1", "$ ");
    let info = start_cmd(&sessions, spec("w", 9), cmd);
    std::thread::sleep(Duration::from_millis(300));
    sessions
        .write(
            info.id,
            "printf '\\033]7501;state=working\\033\\\\'; sleep 2; printf '\\033]7501;state=working\\033\\\\'\r",
        )
        .unwrap();
    wait_until(|| sessions.working_all() == 1, "일하는 세션을 세지 않았다");
    // sleep 이 끝나 셸이 다시 앞에 섰다 — 표의 상태는 아직 working 이지만 그것은 낡은 기록이다.
    wait_until(
        || sessions.working_all() == 0,
        "셸이 앞에 선 칸의 낡은 working 을 셌다",
    );
    assert_eq!(
        sessions.overview()[0]
            .status
            .as_ref()
            .map(|s| s.state.as_str()),
        Some("working"),
        "상태는 지우지 않는다 — 세지 않을 뿐"
    );
    sessions
        .write(
            info.id,
            "printf '\\033]7501;state=idle\\033\\\\'; sleep 30\r",
        )
        .unwrap();
    wait_until(
        || {
            sessions.overview()[0]
                .status
                .as_ref()
                .map(|s| s.state.as_str())
                == Some("idle")
                && sessions.overview()[0].busy
        },
        "idle 로 바뀌지 않았다",
    );
    assert_eq!(sessions.working_all(), 0, "idle 은 일하는 중이 아니다");
    sessions.close_all();
}

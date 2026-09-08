//! `host` 의 테스트. 본문에서 갈라 나왔다 (2026-09-08) — 파일 크기
//! 래칫(`scripts/check-file-sizes.mjs`)이 이 파일을 짚었고, 그 안에서
//! 경계가 가장 뚜렷한 덩어리가 여기였다. `frontmatter/tests.rs` 와 같은
//! 모양이고 동작은 그대로다 — 옮기면서 한 단 내어쓰기만 했다.

use super::*;

/// 붙어 있는 동안에는 무슨 일이 있어도 내려가지 않는다.
#[test]
fn a_host_with_a_client_is_never_reaped() {
    let mut w = Watchdog::default();
    for _ in 0..(ORPHAN_TICKS * 10) {
        assert_eq!(w.tick(1, true), None);
        assert_eq!(w.tick(1, false), None);
    }
}

/// 빈 호스트(세션 0 · 클라이언트 0)는 두 틱이면 끝 — 종전 계약 그대로.
#[test]
fn an_empty_host_exits_after_two_ticks() {
    let mut w = Watchdog::default();
    assert_eq!(w.tick(0, false), None);
    assert_eq!(w.tick(0, false), Some(Reap::Idle));
}

/// 세션을 쥔 고아는 [`ORPHAN_TICKS`] 에 내려간다 — 그 전에는 버틴다.
#[test]
fn an_orphan_holding_sessions_exits_after_the_grace() {
    let mut w = Watchdog::default();
    for _ in 0..(ORPHAN_TICKS - 1) {
        assert_eq!(w.tick(0, true), None);
    }
    assert_eq!(w.tick(0, true), Some(Reap::Orphan));
}

/// **세션을 쥔 호스트를 몇 분 만에 내리는 길은 없다** (2026-09-03).
///
/// 한때 있었다: 더 높은 프로토콜의 소켓이 보이면 2틱 만에 내려갔다. 그런데
/// 그 소켓을 만드는 것이 곧 업데이트였고, 그래서 업데이트 2분 뒤에 사용자가
/// 돌리던 셸이 죽었다. 유예는 붙는 이가 없는 동안에만 흐르고, 그 길이는
/// [`ORPHAN_TICKS`] 하나뿐이다.
#[test]
fn nothing_reaps_a_session_holding_host_within_minutes() {
    let mut w = Watchdog::default();
    for _ in 0..30 {
        assert_eq!(w.tick(0, true), None, "30분 안에는 아무도 못 내린다");
    }
}

/// 앱 재시작을 건너는 것이 호스트의 존재 이유다 — 붙는 이가 돌아오면
/// 유예는 처음부터 다시 센다.
#[test]
fn a_returning_client_resets_the_grace() {
    let mut w = Watchdog::default();
    for _ in 0..(ORPHAN_TICKS - 1) {
        assert_eq!(w.tick(0, true), None);
    }
    assert_eq!(w.tick(1, true), None); // 앱이 다시 붙었다
    for _ in 0..(ORPHAN_TICKS - 1) {
        assert_eq!(w.tick(0, true), None);
    }
    assert_eq!(w.tick(0, true), Some(Reap::Orphan));
}

/// Hello 는 **판과 세션 수를 말한다** — 앱이 업데이트를 건너온 빈 호스트를
/// 알아보는 근거가 이 둘뿐이다.
#[test]
fn hello_reports_the_build_and_how_many_sessions_it_holds() {
    let state = HostState::new(None);
    let Response::Proto {
        proto,
        build,
        sessions,
    } = handle_request(&state, Request::Hello)
    else {
        panic!("Hello 는 Proto 로 답한다");
    };
    assert_eq!(proto, PROTO_VERSION);
    assert_eq!(build.as_deref(), Some(APP_BUILD));
    assert_eq!(sessions, Some(0), "아무것도 안 쥔 호스트는 0 이라고 말한다");
}

/// 세션을 쥐고 있으면 **그렇다고 말한다.** 여기가 0 으로 새면 앱이 그
/// 호스트를 빈 것으로 보고 사용자의 셸째 내린다.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hello_does_not_call_a_busy_host_empty() {
    let state = HostState::new(None);
    let sid = "test-hello-count".to_string();
    let (shell_pid, fg) = sh_with_stubborn_foreground(&state, &sid).await;

    let Response::Proto { sessions, .. } = handle_request(&state, Request::Hello) else {
        panic!("Hello 는 Proto 로 답한다");
    };
    assert_eq!(sessions, Some(1), "쥔 세션을 숨기지 않는다");

    handle_request(&state, Request::Kill { sid });
    assert_gone(shell_pid, fg).await;
}

#[cfg(unix)]
fn pid_alive(pid: i32) -> bool {
    // SAFETY: 신호 0 은 존재 확인만 한다.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// HUP 을 무시하는 작업을 포그라운드에 앉힌 세션 하나 — 종료 계약을
/// 검증하는 두 테스트(Kill · Shutdown)가 같은 재료를 쓴다.
/// 반환값은 (셸 pid, 포그라운드 pgid).
#[cfg(unix)]
async fn sh_with_stubborn_foreground(state: &Arc<HostState>, sid: &str) -> (i32, i32) {
    let resp = start_session(
        state,
        sid.to_string(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        24,
        80,
        "/bin/sh".to_string(),
        vec![("PS1".to_string(), "$ ".to_string())],
        "n".to_string(),
        false,
    )
    .expect("shell starts");
    assert!(matches!(resp, Response::Session { .. }));

    // 포그라운드에 오래 도는 작업을 앉힌다. HUP 을 무시하는 셸 + sleep.
    handle_request(
        state,
        Request::Write {
            sid: sid.to_string(),
            data: "trap '' HUP; sleep 300\n".to_string(),
        },
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let (shell, fg) = {
            let sessions = state.lock_sessions();
            let s = sessions.get(sid).expect("session present");
            (
                s.child.process_id().map(|p| p as i32),
                process_group_leader_of(s),
            )
        };
        // 포그라운드 그룹이 셸에서 sleep 으로 넘어간 순간을 기다린다.
        if let (Some(shell), Some(fg)) = (shell, fg) {
            if fg != shell {
                return (shell, fg);
            }
        }
        assert!(
            std::time::Instant::now() < deadline,
            "sleep 이 포그라운드가 안 된다"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// 종료가 실제로 일어났는지 — 유예 안에 둘 다 사라져야 한다.
#[cfg(unix)]
async fn assert_gone(shell_pid: i32, fg: i32) {
    let deadline = std::time::Instant::now() + KILL_GRACE + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline && (pid_alive(fg) || pid_alive(shell_pid)) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(!pid_alive(fg), "포그라운드가 살아남았다");
    // 회수됐으면 kill(pid, 0) 은 ESRCH — 좀비는 살아 있는 것으로 보고된다.
    assert!(!pid_alive(shell_pid), "셸이 좀비로 남았다");
}

/// Kill 은 셸뿐 아니라 ^D 를 무시하는 포그라운드까지 죽이고 자식을 회수한다.
/// 예전엔 맵에서 지우기만 해 `sleep` 이 살아남고 셸은 좀비로 남았다.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_terminates_shell_and_foreground_and_reaps() {
    let state = HostState::new(None);
    let sid = "test-kill".to_string();
    let (shell_pid, fg) = sh_with_stubborn_foreground(&state, &sid).await;
    assert!(pid_alive(shell_pid) && pid_alive(fg));

    assert!(matches!(
        handle_request(&state, Request::Kill { sid: sid.clone() }),
        Response::Ok
    ));
    assert!(
        state.lock_sessions().get(&sid).is_none(),
        "맵에서 즉시 사라진다"
    );
    assert_gone(shell_pid, fg).await;
}

/// 프롬프트에 멈춰 있는 셸은 **포그라운드 명령이 아니다**. 예전엔
/// `tcgetpgrp` 이 돌려준 셸 자신을 그대로 명령줄로 바꿔 줘서, 터미널을 켜 둔
/// 것만으로 탭 닫기 확인이 떴다 (2026-09-02).
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_shell_has_no_foreground_command_but_a_running_one_does() {
    let state = HostState::new(None);
    let sid = "test-fg-idle".to_string();
    let (shell_pid, fg) = sh_with_stubborn_foreground(&state, &sid).await;

    // 돌고 있는 동안은 이름이 나온다 (`sleep`).
    let Response::Foreground { command } =
        handle_request(&state, Request::Foreground { sid: sid.clone() })
    else {
        panic!("Foreground 응답이 아니다");
    };
    let command = command.expect("포그라운드 명령이 있다");
    assert!(command.contains("sleep"), "명령줄은 {command:?}");

    // 그 작업이 끝나 셸이 다시 프롬프트를 잡으면 `None` 이다.
    handle_request(
        &state,
        Request::Write {
            sid: sid.clone(),
            data: "\u{3}".to_string(), // ^C
        },
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let seen = {
            let sessions = state.lock_sessions();
            foreground_of(sessions.get(&sid).expect("session present"))
        };
        if seen.is_none() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "^C 뒤에도 포그라운드가 셸로 안 돌아온다"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(matches!(
        handle_request(&state, Request::Foreground { sid: sid.clone() }),
        Response::Foreground { command: None }
    ));

    handle_request(&state, Request::Kill { sid });
    assert_gone(shell_pid, fg).await;
}

/// Shutdown 도 **실제로 끝낸다**. 예전엔 `sessions.clear()` 뿐이라, 프로토콜
/// 불일치로 구버전 호스트를 내리는 길에서 HUP 을 무시하는 포그라운드가
/// 그대로 고아가 됐다 (앱은 이미 손을 뗐고, 아무도 그걸 모른다).
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_terminates_sessions_instead_of_orphaning_them() {
    let state = HostState::new(None);
    let (shell_pid, fg) = sh_with_stubborn_foreground(&state, "test-shutdown").await;
    assert!(pid_alive(shell_pid) && pid_alive(fg));

    assert_eq!(shutdown_sessions(&state), 1, "한 세션을 끝냈다고 답한다");
    assert!(state.lock_sessions().is_empty());
    assert_gone(shell_pid, fg).await;
}

/// 그 자리를 **비켜 주는 것**까지가 Shutdown 의 계약이다 — 소켓 파일이 남아
/// 있으면 교체 호스트가 bind 에 실패하고, 아직 살아 있는 우리에게 접속이 돼
/// "이미 호스트가 있다"고 물러난다. 그러면 아무도 남지 않는다.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn serve_records_the_socket_so_shutdown_can_release_it() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    let state = HostState::new(None);
    let serving = state.clone();
    let path = socket.clone();
    tokio::spawn(async move {
        let _ = serve(serving, &path).await;
    });
    for _ in 0..200 {
        if socket.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(socket.exists(), "bind 후 소켓 파일이 있다");
    assert_eq!(
        state
            .socket
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_deref(),
        Some(socket.as_path()),
        "점유한 자리를 기억한다"
    );

    // Shutdown 의 앞부분(자리 비우기)만 떼어 확인한다 — 뒷부분은
    // `std::process::exit` 이라 테스트 프로세스를 함께 데려간다.
    let taken = state
        .socket
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
        .expect("기억한 경로");
    std::fs::remove_file(&taken).unwrap();
    assert!(!socket.exists(), "교체 호스트가 bind 할 자리가 비었다");
}

/// 청크 경계에 걸린 한글(3바이트)이 이월 후 온전히 복원된다.
#[test]
fn drain_utf8_carries_split_hangul() {
    let bytes = "안녕".as_bytes(); // 6 bytes
    let mut pending = bytes[..4].to_vec(); // "안" + '녕' 의 선두 1바이트
    let first = drain_utf8(&mut pending);
    assert_eq!(first, "안");
    assert_eq!(pending.len(), 1);
    pending.extend_from_slice(&bytes[4..]);
    assert_eq!(drain_utf8(&mut pending), "녕");
    assert!(pending.is_empty());
}

/// 박스 문자(─ U+2500, 3바이트)가 read 경계에서 쪼개져도 깨지지 않는다.
#[test]
fn drain_utf8_carries_split_box_drawing() {
    let line = "─".repeat(3); // 9 bytes
    let bytes = line.as_bytes();
    let mut pending = bytes[..7].to_vec();
    let first = drain_utf8(&mut pending);
    assert_eq!(first, "──");
    pending.extend_from_slice(&bytes[7..]);
    assert_eq!(drain_utf8(&mut pending), "─");
}

/// 4바이트 이모지가 1+3 으로 쪼개져도 복원된다.
#[test]
fn drain_utf8_carries_split_emoji() {
    let bytes = "🚀".as_bytes();
    let mut pending = bytes[..1].to_vec();
    assert_eq!(drain_utf8(&mut pending), "");
    pending.extend_from_slice(&bytes[1..]);
    assert_eq!(drain_utf8(&mut pending), "🚀");
}

/// 진짜 잘못된 바이트는 U+FFFD 로 치환하고 계속 동작한다 (교착 없음).
#[test]
fn drain_utf8_replaces_invalid_and_continues() {
    let mut pending = vec![b'a', 0xFF, b'b'];
    assert_eq!(drain_utf8(&mut pending), "a\u{FFFD}b");
    assert!(pending.is_empty());

    let mut mixed = vec![0xFF];
    mixed.extend_from_slice("한".as_bytes());
    mixed.extend_from_slice(&"글".as_bytes()[..2]);
    assert_eq!(drain_utf8(&mut mixed), "\u{FFFD}한");
    assert_eq!(mixed.len(), 2);
}

#[test]
fn drain_utf8_ascii_passthrough() {
    let mut pending = b"hello $ ".to_vec();
    assert_eq!(drain_utf8(&mut pending), "hello $ ");
    assert!(pending.is_empty());
}

/// KillExcept 의 보호 판정 — `-` 까지 포함한 접두사 규격이 지켜지는지.
#[test]
fn kill_except_protects_only_the_listed_prefixes() {
    let keep = vec!["p1-".to_string()];
    assert!(is_protected("p1-abc", &keep));
    assert!(!is_protected("p2-abc", &keep));
    assert!(!is_protected("p12-abc", &keep));
    assert!(!is_protected("a1b2c3d4", &keep));
    assert!(!is_protected("p1-abc", &[]));
}

/// `ps` 배관이 이 플랫폼에서 동작하는가.
#[cfg(unix)]
#[test]
fn reads_own_command_line() {
    let me = command_line_of(std::process::id() as i32);
    assert!(me.is_some_and(|line| !line.trim().is_empty()));
}

#[cfg(unix)]
#[test]
fn unknown_pid_is_none() {
    assert!(command_line_of(i32::MAX).is_none());
}

//! `host::windows` 의 테스트 — **windows 러너에서 실제 ConPTY·cmd.exe 로** 돈다.
//! 유닉스 판(`host/tests.rs` 의 `#[cfg(unix)]` 들)과 같은 계약을 같은 이름 결로 지킨다:
//! Kill 은 트리 전체를 끝내고, 놀고 있는 셸은 포그라운드가 아니며, 셸이 스스로 끝나면
//! `Exit` 가 한 번 온다.

use std::time::{Duration, Instant};

use tokio::sync::broadcast;

use super::super::*;
use super::*;

/// 테스트 셸 — 러너의 `%COMSPEC%` (cmd.exe).
fn cmd_exe() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

fn start(state: &Arc<HostState>, sid: &str, shell: &str) {
    let resp = start_session(
        state,
        sid.to_string(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        24,
        80,
        shell.to_string(),
        vec![],
        "n".to_string(),
        false,
    )
    .expect("셸이 뜬다");
    assert!(matches!(resp, Response::Session { .. }), "{resp:?}");
}

fn write(state: &Arc<HostState>, sid: &str, data: &str) {
    let resp = handle_request(
        state,
        Request::Write {
            sid: sid.to_string(),
            data: data.to_string(),
        },
    );
    assert!(matches!(resp, Response::Ok), "{resp:?}");
}

/// `sid` 의 출력에서 `needle` 이 보일 때까지 모은다. 모은 전부를 돌려준다.
async fn wait_for_output(
    events: &mut broadcast::Receiver<Event>,
    sid: &str,
    needle: &str,
    within: Duration,
) -> String {
    let mut seen = String::new();
    let outcome = tokio::time::timeout(within, async {
        loop {
            match events.recv().await {
                Ok(Event::Data { sid: s, text, .. }) if s == sid => {
                    seen.push_str(&text);
                    if seen.contains(needle) {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    })
    .await;
    assert!(
        outcome.is_ok(),
        "{needle:?} 가 안 보인다. 받은 출력: {seen:?}"
    );
    seen
}

fn shell_pid(state: &Arc<HostState>, sid: &str) -> u32 {
    state
        .lock_sessions()
        .get(sid)
        .and_then(|s| s.child.process_id())
        .expect("셸 pid")
}

fn alive(pid: u32) -> bool {
    born_if_alive(pid).is_some()
}

/// `parent` 의 살아 있는 자식 전부.
fn children_of(parent: u32) -> Vec<u32> {
    let Some(parent_born) = born_if_alive(parent) else {
        return vec![];
    };
    let mut out = vec![];
    for_each_process(|e| {
        if e.th32ParentProcessID == parent
            && born_if_alive(e.th32ProcessID).is_some_and(|b| b >= parent_born)
        {
            out.push(e.th32ProcessID);
        }
    });
    out
}

/// 조건이 설 때까지 기다린다.
async fn eventually(what: &str, within: Duration, mut ok: impl FnMut() -> bool) {
    let deadline = Instant::now() + within;
    while !ok() {
        assert!(Instant::now() < deadline, "시간 안에 안 된다: {what}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[test]
fn only_cmd_gets_the_utf8_code_page() {
    assert_eq!(
        utf8_console_args(r"C:\Windows\system32\cmd.exe"),
        &["/K", "chcp", "65001>nul"]
    );
    assert_eq!(utf8_console_args("CMD.EXE").len(), 3, "대소문자");
    // PowerShell 에 `-Command` 를 붙이면 셸 통합이 꺼진다 — 아무것도 붙이지 않는다.
    assert!(utf8_console_args(r"C:\Program Files\PowerShell\7\pwsh.exe").is_empty());
    assert!(utf8_console_args("powershell.exe").is_empty());
    assert!(utf8_console_args(r"C:\Program Files\Git\bin\bash.exe").is_empty());
}

/// **한글이 그대로 왕복한다** — 입력(UTF-8) → cmd 의 echo → ConPTY 출력(UTF-8).
/// 에코된 입력이 아니라 **실행 결과**만 만들 수 있는 문자열(`%OS%` 치환)로 단언한다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hangul_round_trips_through_conpty() {
    let state = HostState::new(None);
    let mut events = state.events.subscribe();
    let sid = "win-hangul";
    start(&state, sid, &cmd_exe());
    wait_for_output(&mut events, sid, ">", Duration::from_secs(20)).await;
    write(&state, sid, "echo 한글-ok-%OS%\r");
    wait_for_output(
        &mut events,
        sid,
        "한글-ok-Windows_NT",
        Duration::from_secs(20),
    )
    .await;
    handle_request(&state, Request::Kill { sid: sid.into() });
}

/// 리사이즈가 콘솔까지 닿는다 — cmd 의 `mode con` 이 새 폭을 말한다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_reaches_the_console() {
    let state = HostState::new(None);
    let mut events = state.events.subscribe();
    let sid = "win-resize";
    start(&state, sid, &cmd_exe());
    wait_for_output(&mut events, sid, ">", Duration::from_secs(20)).await;
    let resp = handle_request(
        &state,
        Request::Resize {
            sid: sid.into(),
            rows: 33,
            cols: 123,
        },
    );
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    write(&state, sid, "mode con\r");
    let out = wait_for_output(&mut events, sid, "123", Duration::from_secs(20)).await;
    // ConPTY 는 줄 안의 공백을 커서 이동 시퀀스로 바꿔 그리기도 한다 — 줄 단위가 아니라
    // "Columns" 바로 뒤 몇 글자 안에 새 폭이 있는지로 본다.
    let after_columns = out
        .find("Columns")
        .map(|i| out[i..].chars().take(48).collect::<String>());
    assert!(
        after_columns.as_deref().is_some_and(|s| s.contains("123")),
        "mode con 이 새 폭을 말하지 않는다: {out:?}"
    );
    handle_request(&state, Request::Kill { sid: sid.into() });
}

/// **Kill 은 트리 전체를 끝낸다** — 셸, 콘솔에 붙은 포그라운드, 그리고 콘솔에 붙지
/// 않은 자손(새 콘솔로 띄운 것 — 의사 콘솔을 닫아도 살아남는다)까지. 뒤의 것이
/// Job 종료만이 닿는 자리다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_ends_the_whole_tree() {
    let state = HostState::new(None);
    let mut events = state.events.subscribe();
    let sid = "win-kill";
    start(&state, sid, &cmd_exe());
    assert!(
        state.lock_sessions().get(sid).unwrap().job.is_some(),
        "셸이 Job 에 담겼다"
    );
    wait_for_output(&mut events, sid, ">", Duration::from_secs(20)).await;
    let shell = shell_pid(&state, sid);

    write(&state, sid, "start \"\" /min ping -n 300 127.0.0.1\r");
    eventually("새 콘솔의 ping", Duration::from_secs(20), || {
        !children_of(shell).is_empty()
    })
    .await;
    write(&state, sid, "ping -n 300 127.0.0.1\r");
    eventually("포그라운드 ping", Duration::from_secs(20), || {
        children_of(shell).len() >= 2
    })
    .await;
    let tree = children_of(shell);

    assert!(matches!(
        handle_request(&state, Request::Kill { sid: sid.into() }),
        Response::Ok
    ));
    assert!(
        state.lock_sessions().get(sid).is_none(),
        "맵에서 즉시 사라진다"
    );
    eventually(
        "셸과 자손 전부의 종료",
        KILL_GRACE + Duration::from_secs(5),
        || !alive(shell) && tree.iter().all(|pid| !alive(*pid)),
    )
    .await;
    assert!(children_of(shell).is_empty(), "살아 있는 자식이 0 이다");
}

/// 놀고 있는 셸은 포그라운드 명령이 아니고, 돌고 있는 명령은 그 이름으로 잡힌다.
/// ^C 로 그 명령이 끝나면 다시 `None` 이다 (유닉스 판과 같은 계약).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_shell_has_no_foreground_command_but_a_running_one_does() {
    let state = HostState::new(None);
    let mut events = state.events.subscribe();
    let sid = "win-fg";
    start(&state, sid, &cmd_exe());
    wait_for_output(&mut events, sid, ">", Duration::from_secs(20)).await;
    let foreground = |state: &Arc<HostState>| match handle_request(
        state,
        Request::Foreground { sid: sid.into() },
    ) {
        Response::Foreground { command } => command,
        other => panic!("Foreground 응답이 아니다: {other:?}"),
    };
    // `/K chcp` 가 끝나기를 기다린다 — 그 찰나에는 chcp 가 자식이다.
    eventually("놀고 있는 셸", Duration::from_secs(20), || {
        foreground(&state).is_none()
    })
    .await;

    write(&state, sid, "ping -n 300 127.0.0.1\r");
    eventually("ping 이 포그라운드", Duration::from_secs(20), || {
        foreground(&state).is_some_and(|c| c.to_ascii_lowercase().contains("ping"))
    })
    .await;

    write(&state, sid, "\u{3}"); // ^C
    eventually(
        "^C 뒤 다시 놀고 있음",
        Duration::from_secs(20),
        || foreground(&state).is_none(),
    )
    .await;

    handle_request(&state, Request::Kill { sid: sid.into() });
}

/// Hello 는 쥔 세션을 숨기지 않는다 — 0 으로 새면 앱이 사용자의 셸째 호스트를 내린다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hello_does_not_call_a_busy_host_empty() {
    let state = HostState::new(None);
    start(&state, "win-hello", &cmd_exe());
    let Response::Proto { sessions, .. } = handle_request(&state, Request::Hello) else {
        panic!("Hello 는 Proto 로 답한다");
    };
    assert_eq!(sessions, Some(1));
    handle_request(
        &state,
        Request::Kill {
            sid: "win-hello".into(),
        },
    );
}

/// **셸이 스스로 끝나면 `Exit` 가 온다 — 한 번만.** ConPTY 가 출력 파이프를 닫아
/// 주든 아니든 같은 결과여야 한다(종료 감시와 EOF 중 먼저 온 쪽만 정리한다).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_shell_that_exits_by_itself_reports_exit_once() {
    let state = HostState::new(None);
    let mut events = state.events.subscribe();
    let sid = "win-exit";
    start(&state, sid, &cmd_exe());
    wait_for_output(&mut events, sid, ">", Duration::from_secs(20)).await;
    let shell = shell_pid(&state, sid);
    write(&state, sid, "exit\r");

    let mut exits = 0;
    let deadline = Instant::now() + Duration::from_secs(20);
    while exits == 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, events.recv()).await {
            Ok(Ok(Event::Exit { sid: s })) if s == sid => exits += 1,
            Ok(_) => {}
            Err(_) => panic!("셸이 끝났는데 Exit 가 안 온다"),
        }
    }
    assert!(
        state.lock_sessions().get(sid).is_none(),
        "끝난 세션은 맵에서 빠진다"
    );
    assert!(!alive(shell), "셸이 끝났다");
    // 두 번째 Exit 는 없다.
    let extra = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(Event::Exit { sid: s }) = events.recv().await {
                if s == sid {
                    return;
                }
            }
        }
    })
    .await;
    assert!(extra.is_err(), "Exit 가 두 번 왔다");
}

/// 자리를 비우면(`Shutdown`·고아 종료) 받기를 멈춰 **파이프 이름이 사라진다** —
/// 그래야 교체 호스트가 첫 인스턴스를 만든다(유닉스는 소켓 파일을 지우는 자리).
#[tokio::test(flavor = "multi_thread")]
async fn vacating_releases_the_pipe_name() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    let state = HostState::new(None);
    let serving = state.clone();
    let path = socket.clone();
    tokio::spawn(async move {
        let _ = serve(serving, &path).await;
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let probe = loop {
        match pipe::connect(&socket).await {
            Ok(client) => break client,
            Err(e) => {
                assert!(Instant::now() < deadline, "호스트가 자리를 못 잡았다: {e}");
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
    };
    drop(probe);
    assert_eq!(
        state.socket.lock().unwrap().as_deref(),
        Some(socket.as_path()),
        "점유한 자리를 기억한다"
    );

    // `vacate` 의 앞부분(자리 비우기)만 — 뒷부분은 process::exit 이다.
    state.socket.lock().unwrap().take();
    eventually(
        "파이프 이름이 사라짐",
        Duration::from_secs(5),
        || {
            let me = pipe::Identity::current().unwrap();
            tokio::net::windows::named_pipe::ClientOptions::new()
                .open(me.pipe_name(&socket))
                .is_err_and(|e| e.raw_os_error() == Some(2)) // ERROR_FILE_NOT_FOUND
        },
    )
    .await;
}

/// 같은 자리에 두 번째 호스트가 뜨면 **조용히 물러난다** — 먼저 뜬 쪽이 승자.
#[tokio::test(flavor = "multi_thread")]
async fn a_second_host_at_the_same_address_steps_aside() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    let first = HostState::new(None);
    let path = socket.clone();
    tokio::spawn(async move {
        let _ = serve(first, &path).await;
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while pipe::connect(&socket).await.is_err() {
        assert!(Instant::now() < deadline, "첫 호스트가 안 떴다");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let second = tokio::time::timeout(Duration::from_secs(5), serve(HostState::new(None), &socket))
        .await
        .expect("두 번째 호스트가 물러나지 않고 매달렸다");
    assert_eq!(second, Ok(()));
}

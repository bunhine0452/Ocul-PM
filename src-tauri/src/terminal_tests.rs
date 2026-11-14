//! 앱 안 터미널의 테스트 — `terminal.rs` 가 800줄을 넘지 않게 떼어 냈다. 쓰기 줄 · 닫기 · 흐름 제어는
//! `terminal_io.rs`, 환경 · 실행 줄은 `terminal_env.rs` 의 시험 모듈에 있다(둘 다 여기 도우미를 쓴다).

use super::output::{pump_output, FLUSH_BYTES};
use super::*;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// 시험이 여는 세션의 자리 — 창 · 프로젝트만 다르고 나머지는 같다.
pub(crate) fn spec(window: &str, project_id: u32) -> OpenSpec {
    OpenSpec {
        window: window.into(),
        project_id,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: false,
        front: None,
    }
}

/// `/bin/sh -c <script>` — 이 뒤로 더한 시험들이 띄우는 셸은 모두 이 한 자리를 지난다(egress 원장 한 줄).
#[cfg(unix)]
pub(crate) fn sh(script: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", script]);
    cmd
}

/// `cond` 가 참이 될 때까지 10초 — 안 되면 `why` 로 실패한다.
#[cfg(unix)]
pub(crate) fn wait_until(cond: impl Fn() -> bool, why: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !cond() {
        assert!(Instant::now() < deadline, "{why}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// 내 손을 기다리는(OSC 7501 blocked) claude 를 흉내 내는 세션 — 상태가 표에 서면 돌아온다.
#[cfg(unix)]
pub(crate) fn start_blocked(sessions: &TermSessions, window: &str, project_id: u32) -> TermInfo {
    let script = "printf '\\033]7501;state=blocked:kind=permission\\033\\\\'; sleep 30";
    let info = sessions
        .start(
            spec(window, project_id),
            sh(script),
            "claude".into(),
            None,
            |_| {},
        )
        .unwrap();
    wait_until(
        || sessions.waiting_in(project_id) == 1,
        "blocked 상태가 표에 서지 않았다",
    );
    info
}

#[test]
fn utf8_split_across_reads_waits_for_the_rest() {
    let bytes = "가나".as_bytes();
    let mut carry = bytes[..4].to_vec(); // 「가」 3바이트 + 「나」 첫 바이트
    assert_eq!(take_utf8(&mut carry), "가");
    assert_eq!(carry.len(), 1);
    carry.extend_from_slice(&bytes[4..]);
    assert_eq!(take_utf8(&mut carry), "나");
    assert!(carry.is_empty());
}

#[test]
fn invalid_bytes_become_replacement_characters() {
    let mut carry = vec![b'a', 0xff, b'b'];
    assert_eq!(take_utf8(&mut carry), "a\u{fffd}b");
    assert!(carry.is_empty());
}

/// 잘못된 바이트는 그 자리만 대체 문자 — 그 뒤 다음 읽기로 걸친 반쪽 한글은 남겨 두었다가 잇는다.
#[test]
fn a_bad_byte_does_not_spoil_the_half_character_after_it() {
    let mut carry = vec![0xFF, b'a', 0xEA, 0xB0];
    assert_eq!(take_utf8(&mut carry), "\u{FFFD}a");
    assert_eq!(carry, [0xEA, 0xB0]);
    carry.push(0x80);
    assert_eq!(take_utf8(&mut carry), "가");
    assert!(carry.is_empty());
}

/// 진짜 PTY 왕복 — 쓴 것이 자식에게 가고, 자식의 출력과 끝이 돌아온다. 닫으면 표에서 빠진다.
#[cfg(unix)]
#[test]
fn pty_round_trip_output_input_and_exit() {
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args([
        "-c",
        "printf 'ready:'; read line; printf 'got:%s:' \"$line\"; exit 3",
    ]);
    let info = sessions
        .start(spec("main", 1), cmd, "sh".into(), None, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    assert_eq!(sessions.list("main").len(), 1);
    assert!(sessions.list("other").is_empty());
    let mut out = String::new();
    let mut code = None;
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut sent = false;
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(TermEvent::Output { data, .. }) => out.push_str(&data),
            Ok(TermEvent::Exit { code: c }) => {
                code = c;
                break;
            }
            Ok(_) | Err(_) => {}
        }
        if !sent && out.contains("ready:") {
            sessions.resize(info.id, 100, 30).unwrap();
            sessions.write(info.id, "한글\r").unwrap();
            sent = true;
        }
    }
    assert!(out.contains("got:한글:"), "출력: {out:?}");
    assert_eq!(code, Some(3));
    assert!(!sessions.list("main")[0].alive);
    sessions.close_window("main");
    assert!(sessions.list("main").is_empty());
}

/// 상태 신호 왕복 — 탐침을 보낸 프로그램이 답을 받고(claude 처럼 raw 모드로 읽는다),
/// 루트 보고가 세션 표의 상태가 되며, 같은 상태가 다시 와도 사건을 또 내지 않는다.
#[cfg(unix)]
#[test]
fn program_status_probe_is_answered_and_reports_become_the_session_status() {
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let n = crate::program_status::QUERY_REPLY.len();
    let script = format!(
        "stty raw -echo; printf '\\033]7501;?\\033\\\\'; r=$(head -c {n}); stty sane; \
         case \"$r\" in *states=idle*) printf 'REPLY_OK:';; *) printf 'REPLY_BAD:';; esac; \
         printf '\\033]7501;state=blocked:kind=question\\033\\\\'; \
         printf '\\033]7501;state=blocked:kind=question\\033\\\\'; sleep 0.3; \
         printf '\\033]7501;state=done\\033\\\\'; sleep 0.3; exit 0"
    );
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", &script]);
    sessions
        .start(spec("w", 7), cmd, "sh".into(), None, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    let mut out = String::new();
    let mut states: Vec<(String, Option<String>)> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(TermEvent::Output { data, .. }) => out.push_str(&data),
            Ok(TermEvent::Status { status: Some(st) }) => states.push((st.state, st.kind)),
            Ok(TermEvent::Exit { .. }) => break,
            Ok(_) | Err(_) => {}
        }
    }
    assert!(out.contains("REPLY_OK:"), "탐침에 답이 안 갔다: {out:?}");
    assert_eq!(
        states,
        vec![
            ("blocked".to_string(), Some("question".to_string())),
            ("done".to_string(), None),
        ],
        "같은 blocked 두 번은 사건 하나여야 한다"
    );
    let info = &sessions.overview()[0];
    assert_eq!(info.project_id, 7);
    assert_eq!(info.status.as_ref().map(|s| s.state.as_str()), Some("done"));
    assert!(
        sessions.busy_in("w").is_empty(),
        "끝난 세션은 「도는 중」이 아니다"
    );
}

#[cfg(unix)]
#[test]
fn quitting_asks_only_while_a_session_runs_and_not_twice_in_a_row() {
    let sessions = TermSessions::default();
    assert_eq!(
        sessions.ask_before_quit(),
        None,
        "세션이 없으면 묻지 않는다"
    );
    // 대화형 셸 — 작업 제어가 켜져 명령을 제 프로세스 그룹으로 앞에 세운다(사용자의 zsh 처럼).
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.arg("-i");
    cmd.env("PS1", "$ ");
    let info = sessions
        .start(spec("proj-3", 3), cmd, "sh".into(), None, |_| {})
        .unwrap();
    let wait_for = |want: bool| {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if sessions.list("proj-3")[0].busy == want {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    };
    std::thread::sleep(Duration::from_millis(300));
    assert!(wait_for(false), "빈 셸은 「무언가 도는」 세션이 아니다");
    assert_eq!(
        sessions.ask_before_quit(),
        None,
        "빈 셸만 있으면 묻지 않는다"
    );
    sessions.write(info.id, "sleep 5\r").unwrap();
    assert!(wait_for(true), "명령이 앞에 서면 무언가 도는 세션이다");
    assert_eq!(sessions.busy_in("proj-3").len(), 1);
    assert_eq!(sessions.ask_before_quit(), Some(("proj-3".to_string(), 1)));
    assert_eq!(
        sessions.ask_before_quit(),
        None,
        "방금 물었으면 두 번째 ⌘Q 는 그대로 끈다"
    );
    sessions.close_all();
}

#[test]
fn unseen_news_is_per_window_and_clears_once_when_the_window_comes_to_front() {
    let sessions = TermSessions::default();
    assert!(
        !sessions.clear_unseen("proj-1"),
        "없던 소식은 지울 것도 없다"
    );
    sessions.mark_unseen("proj-1");
    sessions.mark_unseen("proj-1");
    assert!(sessions.clear_unseen("proj-1"), "앞에 오면 한 번 지운다");
    assert!(!sessions.clear_unseen("proj-1"));
    sessions.mark_unseen("proj-2");
    sessions.close_window("proj-2");
    assert!(
        !sessions.clear_unseen("proj-2"),
        "창을 닫으면 그 소식도 없다"
    );
}

/// 실행 줄을 인자로 못 받는 셸(nushell 등)에는 업데이트 뒤 잇기가 `claude --continue` 를 쳐 넣는다 —
/// 프롬프트 환경 변수 없이. 받는 셸의 인자는 `terminal_env.rs` 의 시험이 본다.
#[cfg(unix)]
#[test]
fn a_resumed_session_types_claude_continue() {
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", "read l; printf 'got:%s:' \"$l\"; exit 0"]);
    let spec = OpenSpec {
        resume: true,
        ..spec("main", 1)
    };
    let typed = Some(shell_env::typed_line(shell_env::Launch::Resume));
    sessions
        .start(spec, cmd, "claude".into(), typed, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    let mut out = String::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(TermEvent::Output { data, .. }) => out.push_str(&data),
            Ok(TermEvent::Exit { .. }) => break,
            _ => {}
        }
    }
    assert!(out.contains("got:claude --continue:"), "출력: {out:?}");
    sessions.close_all();
}

/// 업데이트가 재시작 전에 세는 수와, 창 스냅숏에 실을 claude 세션 — 빈 셸은 어느 쪽에도 없고,
/// claude 가 아닌 프로그램은 「도는 중」 에만 든다. 맡긴 이음은 그 창이 한 번만 가져간다.
#[cfg(unix)]
#[test]
fn busy_all_counts_every_window_and_only_claude_sessions_are_resumable() {
    let sessions = TermSessions::default();
    assert_eq!(sessions.busy_all(), TermBusy::default());
    let open = |window: &str, project_id: u32, label: &str, lane: Option<&str>| {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-i");
        cmd.env("PS1", "$ ");
        let spec = OpenSpec {
            lane: lane.map(str::to_string),
            ..spec(window, project_id)
        };
        sessions
            .start(spec, cmd, label.into(), None, |_| {})
            .unwrap()
    };
    let claude = open("proj-9", 9, "claude", Some("/tmp/lane-2"));
    let other = open("proj-4", 4, "sh", None);
    let _idle = open("proj-4", 4, "sh", None);
    std::thread::sleep(Duration::from_millis(300));
    sessions.write(claude.id, "sleep 5\r").unwrap();
    sessions.write(other.id, "sleep 5\r").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && sessions.busy_all().busy < 2 {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(sessions.busy_all(), TermBusy { busy: 2, claude: 1 });
    let resumable = sessions.resumable();
    assert_eq!(resumable.len(), 1, "claude 가 도는 창만: {resumable:?}");
    assert_eq!(
        resumable["proj-9"],
        vec![TermResume {
            project_id: 9,
            lane: Some("/tmp/lane-2".into())
        }]
    );
    sessions.close_all();

    sessions.set_pending_resume("main", Vec::new());
    assert!(sessions.take_pending_resume("main").is_empty());
    let one = vec![TermResume {
        project_id: 9,
        lane: None,
    }];
    sessions.set_pending_resume("main", one.clone());
    assert!(
        sessions.take_pending_resume("proj-9").is_empty(),
        "다른 창의 것은 못 가져간다"
    );
    assert_eq!(sessions.take_pending_resume("main"), one);
    assert!(
        sessions.take_pending_resume("main").is_empty(),
        "한 번만 가져간다"
    );
}

/// 잇기는 claude 만 — 다른 이름을 알린 프로그램(Codex 는 `app=codex`)은 「다음」 으로 연 칸이어도 아니다.
/// 이름이 없으면 예전 규칙(상태 신호를 보냈거나 claude 로 열었다) 그대로.
#[test]
fn only_sessions_that_say_they_are_claude_or_say_nothing_are_resumed() {
    let row = |label: &str, app: Option<&str>, reported: bool| Row {
        window: "w".into(),
        lane: None,
        info: TermInfo {
            id: 1,
            project_id: 1,
            label: label.into(),
            started_at: String::new(),
            alive: true,
            exit_code: None,
            status: reported.then(|| TermStatus {
                state: "working".into(),
                kind: None,
                msg: None,
                since: String::new(),
                app: app.map(str::to_string),
            }),
            busy: false,
            unseen: false,
            title: None,
        },
        fg_busy: Some(true),
        shell_pid: None,
    };
    assert!(!row("claude", Some("codex"), true).runs_claude(None));
    assert!(row("claude", None, false).runs_claude(None));
    assert!(row("zsh", None, true).runs_claude(None));
    assert!(row("zsh", Some("claude"), true).runs_claude(None));
    assert!(row("zsh", Some("claude-code"), true).runs_claude(None));
    assert!(!row("zsh", None, false).runs_claude(None));
}

/// 진짜 PTY 로 — 「다음」 으로 연 칸에서 codex 가 돌다 업데이트하면 claude 로 잇지 않는다. 같은 자리의
/// claude 는 잇는다.
#[cfg(unix)]
#[test]
fn a_codex_session_is_not_carried_over_the_update_as_claude() {
    let sessions = TermSessions::default();
    let open = |window: &str| {
        let mut cmd = sh("exec /bin/sh -i");
        cmd.env("PS1", "$ ");
        let info = sessions
            .start(spec(window, 5), cmd, "claude".into(), None, |_| {})
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        info
    };
    let run = |id: u32, app: &str| {
        let line = format!("printf '\\033]7501;state=working:app={app}\\033\\\\'; sleep 5\r");
        sessions.write(id, &line).unwrap();
    };
    let codex = open("proj-5");
    run(codex.id, "codex");
    let app_of = |window: &str| {
        let list = sessions.list(window);
        let status = list.first().and_then(|i| i.status.clone());
        status.and_then(|s| s.app)
    };
    wait_until(
        || sessions.busy_all().busy == 1 && app_of("proj-5").as_deref() == Some("codex"),
        "codex 가 앞에 서지 않았다",
    );
    assert_eq!(sessions.busy_all(), TermBusy { busy: 1, claude: 0 });
    assert!(sessions.resumable().is_empty(), "codex 칸은 잇지 않는다");

    let claude = open("proj-6");
    run(claude.id, "Claude");
    wait_until(
        || sessions.busy_all().busy == 2 && app_of("proj-6").as_deref() == Some("claude"),
        "claude 가 앞에 서지 않았다",
    );
    assert_eq!(sessions.busy_all().claude, 1);
    assert_eq!(sessions.resumable().keys().collect::<Vec<_>>(), ["proj-6"]);
    sessions.close_all();
}

/// 제목은 같은 세션에서 1초에 한 번 — 1초 안에 세 번 바뀌면 사건은 하나, 간격 끝에 마지막 것 하나 더.
/// 표의 제목은 그때그때 마지막 것이다(목록을 다시 읽는 창이 늦지 않게).
#[cfg(unix)]
#[test]
fn titles_go_out_once_a_second_and_the_latest_one_last() {
    let sessions = TermSessions::default();
    let info = sessions
        .start(spec("w", 1), sh("sleep 10"), "sh".into(), None, |_| {})
        .unwrap();
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
    let (events, seen) = mpsc::channel::<TermEvent>();
    let table = sessions.inner.clone();
    let pump = std::thread::spawn(move || {
        let flow = pty_io::Flow::new(None);
        pump_output(&rx, &table, info.id, &|ev| drop(events.send(ev)), &flow);
    });
    for t in ["⠋ 하나", "⠙ 둘", "✳ 셋"] {
        tx.send(format!("\x1b]0;{t}\x07").into_bytes()).unwrap();
        std::thread::sleep(Duration::from_millis(30));
    }
    let titles = |within: Duration| {
        let deadline = Instant::now() + within;
        let mut got = Vec::new();
        while let Ok(ev) = seen.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            if let TermEvent::Title { title } = ev {
                got.push(title.unwrap_or_default());
            }
        }
        got
    };
    assert_eq!(titles(Duration::from_millis(500)), ["하나"]);
    assert_eq!(sessions.list("w")[0].title.as_deref(), Some("셋"));
    assert_eq!(titles(Duration::from_millis(1000)), ["셋"]);
    drop(tx);
    pump.join().unwrap();
    sessions.close_all();
}

/// 셸만 도는 칸의 종(셸 내장 printf)은 소식이 아니고, 셸 위에서 도는 프로그램의 종만 사건이 된다.
#[cfg(unix)]
#[test]
fn a_bell_counts_only_while_a_program_runs_on_the_shell() {
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let mut cmd = sh("exec /bin/sh -i");
    cmd.env("PS1", "$ ");
    let info = sessions
        .start(spec("w", 1), cmd, "sh".into(), None, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    let watch = |until: &str| {
        let (mut out, mut bells) = (String::new(), 0);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !out.contains(until) && Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(TermEvent::Output { data, .. }) => out.push_str(&data),
                Ok(TermEvent::Bell) => bells += 1,
                _ => {}
            }
        }
        assert!(out.contains(until), "출력: {out:?}");
        bells
    };
    sessions
        .write(info.id, "printf '\\007'; echo SHELL-'RANG'\r")
        .unwrap();
    assert_eq!(watch("SHELL-RANG"), 0, "셸만 도는 칸의 종");
    sessions
        .write(
            info.id,
            "/bin/sh -c 'printf \"\\007\"; sleep 0.5'; echo PROG-'RANG'\r",
        )
        .unwrap();
    assert_eq!(watch("PROG-RANG"), 1, "셸 위 프로그램의 종");
    sessions.close_all();
}

/// Windows 의 셸 고르기 — PATH 에서 먼저 잡히는 `pwsh.exe`, 없으면 `None`(→ `powershell.exe`).
/// 디렉터리 순서가 우선순위이고, 상대 PATH 항목은 보지 않는다.
#[test]
fn pwsh_is_found_on_path_in_order_and_only_in_absolute_dirs() {
    let root = tempfile::tempdir().unwrap();
    let empty = root.path().join("empty");
    let first = root.path().join("first");
    let second = root.path().join("second");
    for dir in [&empty, &first, &second] {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(first.join("pwsh.exe"), b"").unwrap();
    std::fs::write(second.join("pwsh.exe"), b"").unwrap();

    let path = std::env::join_paths([&empty, &second, &first]).unwrap();
    assert_eq!(find_pwsh(Some(&path)), Some(second.join("pwsh.exe")));

    let none = std::env::join_paths([&empty]).unwrap();
    assert_eq!(find_pwsh(Some(&none)), None);
    assert_eq!(find_pwsh(None), None);

    // 상대 항목(`first` 를 상대 경로로) — 작업 폴더에 따라 뜻이 바뀌므로 건너뛴다.
    let relative = std::env::join_paths([std::path::Path::new("first")]).unwrap();
    assert_eq!(find_pwsh(Some(&relative)), None);
}

/// Windows 의 자식 프로세스 탐침 — 띄운 자식이 있으면 참, 자식 없는 프로세스는 거짓.
/// 콘솔 프로그램이 자식으로 두는 콘솔 호스트는 세지 않는다(그래서 ping 은 거짓이다).
#[cfg(windows)]
#[test]
fn windows_child_probe_sees_children_but_not_console_hosts() {
    let mut ping = crate::proc::std_cmd("ping")
        .args(["-n", "6", "127.0.0.1"])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    assert_eq!(has_child_process(std::process::id()), Some(true));
    assert_eq!(has_child_process(ping.id()), Some(false));
    let _ = ping.kill();
    let _ = ping.wait();
}

/// 위 unix 판의 Windows 짝 — 실제 의사 콘솔(ConPTY)의 cmd. 빈 셸은 「도는 중」 이 아니고, 무언가 띄운
/// 셸은 claude 든 아니든 「도는 중」 이다(예전 Windows 는 상태 신호를 보낸 claude 만 셌다).
#[cfg(windows)]
#[test]
fn windows_busy_counts_running_programs_not_idle_shells() {
    let sessions = TermSessions::default();
    let open = |label: &str| {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/d", "/q"]);
        sessions
            .start(spec("main", 4), cmd, label.into(), None, |_| {})
            .unwrap()
    };
    let claude = open("claude");
    let other = open("cmd");
    let _idle = open("cmd");
    let settle = Instant::now() + Duration::from_secs(10);
    // 셸이 뜨는 동안의 순간(초기화 자식)을 지나 빈 셸 셋이 모두 쉬는 것을 본다.
    while Instant::now() < settle && sessions.busy_all().busy > 0 {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(
        sessions.busy_all(),
        TermBusy::default(),
        "빈 셸은 묻지 않는다"
    );
    sessions
        .write(claude.id, "ping -n 8 127.0.0.1 >nul\r")
        .unwrap();
    sessions
        .write(other.id, "ping -n 8 127.0.0.1 >nul\r")
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && sessions.busy_all().busy < 2 {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(sessions.busy_all(), TermBusy { busy: 2, claude: 1 });
    sessions.close_all();
}

/// 출력 묶기 — 잘게 쏟아지는 조각(ConPTY · 전체 화면 다시 그리기)이 웹뷰 송신 몇 번으로 줄고, 글자는
/// 하나도 빠지거나 뒤섞이지 않으며, 반쪽 한글도 이어 붙는다. 채널이 끊기면(EOF) 남은 것을 보낸다.
/// 웹뷰는 받는 대로 그렸다고 알린다(흐름 제어에 서지 않게).
#[test]
fn output_bursts_are_coalesced_into_few_sends_without_losing_bytes() {
    let table: Arc<Mutex<Inner>> = Arc::default();
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
    let producer = std::thread::spawn(move || {
        let mut sent = String::new();
        for i in 0..6000 {
            let piece = format!("줄 {i} — 가나다\r\n");
            let bytes = piece.as_bytes();
            // 한가운데서 잘라 두 조각으로 — 반쪽 글자가 다음 조각으로 넘어갈 수 있다.
            let cut = bytes.len() / 2;
            tx.send(bytes[..cut].to_vec()).unwrap();
            tx.send(bytes[cut..].to_vec()).unwrap();
            sent.push_str(&piece);
        }
        sent
    });
    let sends = std::cell::RefCell::new(Vec::<String>::new());
    let flow = pty_io::Flow::new(None);
    pump_output(
        &rx,
        &table,
        1,
        &|ev| {
            if let TermEvent::Output { data, n } = ev {
                assert_eq!(n as usize, data.len(), "n 은 그 조각의 바이트 수");
                flow.ack(u64::from(n));
                sends.borrow_mut().push(data);
            }
        },
        &flow,
    );
    let want = producer.join().unwrap();
    let sends = sends.into_inner();
    assert_eq!(sends.concat(), want, "묶어도 글자는 그대로");
    let chunks = 6000 * 2;
    eprintln!(
        "출력 묶기: 조각 {chunks}개({} bytes) → 송신 {}번",
        want.len(),
        sends.len()
    );
    assert!(
        sends.len() * 20 < chunks,
        "조각 {chunks}개가 송신 {}번 — 묶이지 않았다",
        sends.len()
    );
    assert!(
        sends.iter().all(|s| s.len() <= FLUSH_BYTES + 8192),
        "한 번에 너무 많이 보냈다"
    );
}

/// 상태 신호가 섞인 출력 — 상태 사건은 그 앞의 출력 뒤 · 그 조각의 출력 앞에 간다(예전 순서 그대로).
#[test]
fn status_events_keep_their_place_between_coalesced_output() {
    let sessions = TermSessions::default();
    // 표에 세션이 있어야 상태가 반영된다 — 짧은 명령 하나를 띄워 자리를 만든다.
    #[cfg(unix)]
    let cmd = {
        let mut c = CommandBuilder::new("/bin/sh");
        c.args(["-c", "sleep 2"]);
        c
    };
    #[cfg(windows)]
    let cmd = {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/d", "/q", "/c", "ping -n 3 127.0.0.1 >nul"]);
        c
    };
    let info = sessions
        .start(spec("w", 1), cmd, "sh".into(), None, |_| {})
        .unwrap();
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
    tx.send(b"before-".to_vec()).unwrap();
    tx.send(b"more-\x1b]7501;state=working\x1b\\after".to_vec())
        .unwrap();
    tx.send(b"-tail".to_vec()).unwrap();
    drop(tx);
    let events = std::cell::RefCell::new(Vec::<String>::new());
    let flow = pty_io::Flow::new(None);
    pump_output(
        &rx,
        &sessions.inner,
        info.id,
        &|ev| {
            let line = match ev {
                TermEvent::Output { data, .. } => format!("out:{}", data.replace('\x1b', "^")),
                TermEvent::Status { status } => {
                    format!("status:{}", status.map(|s| s.state).unwrap_or_default())
                }
                other => format!("{other:?}"),
            };
            events.borrow_mut().push(line);
        },
        &flow,
    );
    let events = events.into_inner();
    assert_eq!(events.len(), 3, "{events:?}");
    assert_eq!(events[0], "out:before-");
    assert_eq!(events[1], "status:working");
    assert!(
        events[2].starts_with("out:more-") && events[2].ends_with("after-tail"),
        "{events:?}"
    );
    sessions.close_all();
}

/// Windows — 세션이 여럿이어도 목록 · 개요 · 「도는 중」 을 한꺼번에 물으면 스냅숏은 한 번이다
/// (예전: 세션마다 한 번, `busy_all` 은 세션마다 두 번).
#[cfg(windows)]
#[test]
fn windows_one_process_snapshot_serves_every_session_and_call() {
    use std::sync::atomic::Ordering;
    let sessions = TermSessions::default();
    for _ in 0..3 {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/d", "/q"]);
        sessions
            .start(spec("main", 4), cmd, "cmd".into(), None, |_| {})
            .unwrap();
    }
    std::thread::sleep(PARENTS_TTL);
    let before = sessions.snapshots.load(Ordering::SeqCst);
    let _ = sessions.list("main");
    let _ = sessions.overview();
    let _ = sessions.busy_all();
    let _ = sessions.resumable();
    let taken = sessions.snapshots.load(Ordering::SeqCst) - before;
    eprintln!("세션 3개 · 호출 4번 → 스냅숏 {taken}번 (예전 셈: 3+3+6+3 = 15번)");
    assert_eq!(taken, 1);
    std::thread::sleep(PARENTS_TTL);
    let _ = sessions.list("main");
    assert_eq!(
        sessions.snapshots.load(Ordering::SeqCst) - before,
        2,
        "TTL 이 지나면 새로 뜬다"
    );
    sessions.close_all();
}

/// Windows — 터미널 셸은 「보통 이하」 로 내려가, 안에서 뜨는 빌드가 앱의 입력 · 화면을 밀지 못한다.
#[cfg(windows)]
#[test]
fn windows_terminal_shell_yields_to_ui() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetPriorityClass, OpenProcess, BELOW_NORMAL_PRIORITY_CLASS,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let mut ping = crate::proc::std_cmd("ping")
        .args(["-n", "6", "127.0.0.1"])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    yield_to_ui(ping.id());
    // SAFETY: 방금 띄운 자식의 핸들을 열어 읽고 닫는다.
    let class = unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, ping.id());
        assert!(!h.is_null());
        let c = GetPriorityClass(h);
        CloseHandle(h);
        c
    };
    let _ = ping.kill();
    let _ = ping.wait();
    assert_eq!(class, BELOW_NORMAL_PRIORITY_CLASS);
}

//! 앱 안 터미널의 테스트 — `terminal.rs` 가 800줄을 넘지 않게 떼어 냈다.

use super::output::{pump_output, FLUSH_BYTES};
use super::*;

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

/// 진짜 PTY 왕복 — 쓴 것이 자식에게 가고, 자식의 출력과 끝이 돌아온다. 닫으면 표에서 빠진다.
#[cfg(unix)]
#[test]
fn pty_round_trip_output_input_and_exit() {
    use std::sync::mpsc;
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args([
        "-c",
        "printf 'ready:'; read line; printf 'got:%s:' \"$line\"; exit 3",
    ]);
    let spec = OpenSpec {
        window: "main".into(),
        project_id: 1,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: false,
    };
    let info = sessions
        .start(spec, cmd, "sh".into(), move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    assert_eq!(sessions.list("main").len(), 1);
    assert!(sessions.list("other").is_empty());
    let mut out = String::new();
    let mut code = None;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut sent = false;
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(TermEvent::Output { data }) => out.push_str(&data),
            Ok(TermEvent::Exit { code: c }) => {
                code = c;
                break;
            }
            Ok(TermEvent::Status { .. }) | Err(_) => {}
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
    use std::sync::mpsc;
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let n = program_status::QUERY_REPLY.len();
    let script = format!(
        "stty raw -echo; printf '\\033]7501;?\\033\\\\'; r=$(head -c {n}); stty sane; \
         case \"$r\" in *states=idle*) printf 'REPLY_OK:';; *) printf 'REPLY_BAD:';; esac; \
         printf '\\033]7501;state=blocked:kind=question\\033\\\\'; \
         printf '\\033]7501;state=blocked:kind=question\\033\\\\'; sleep 0.3; \
         printf '\\033]7501;state=done\\033\\\\'; sleep 0.3; exit 0"
    );
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", &script]);
    let spec = OpenSpec {
        window: "w".into(),
        project_id: 7,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: false,
    };
    sessions
        .start(spec, cmd, "sh".into(), move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    let mut out = String::new();
    let mut states: Vec<(String, Option<String>)> = Vec::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(TermEvent::Output { data }) => out.push_str(&data),
            Ok(TermEvent::Status { status: Some(st) }) => states.push((st.state, st.kind)),
            Ok(TermEvent::Status { status: None }) => {}
            Ok(TermEvent::Exit { .. }) => break,
            Err(_) => {}
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
    let spec = OpenSpec {
        window: "proj-3".into(),
        project_id: 3,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: false,
    };
    let info = sessions.start(spec, cmd, "sh".into(), |_| {}).unwrap();
    let wait_for = |want: bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if sessions.list("proj-3")[0].busy == want {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        false
    };
    std::thread::sleep(std::time::Duration::from_millis(300));
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

#[test]
fn run_line_reads_the_prompt_from_the_environment() {
    assert_eq!(run_line(""), "claude\r", "빈 프롬프트는 그냥 claude");
    let line = run_line("다음 항목");
    assert!(line.starts_with("claude "));
    assert!(line.contains(PROMPT_ENV));
    assert!(line.ends_with('\r'));
}

/// 업데이트 뒤 잇는 세션은 셸에 `claude --continue` 를 쳐 넣는다 — 프롬프트 환경 변수 없이.
#[cfg(unix)]
#[test]
fn a_resumed_session_types_claude_continue() {
    use std::sync::mpsc;
    let sessions = TermSessions::default();
    let (tx, rx) = mpsc::channel::<TermEvent>();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", "read l; printf 'got:%s:' \"$l\"; exit 0"]);
    let spec = OpenSpec {
        window: "main".into(),
        project_id: 1,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: true,
    };
    sessions
        .start(spec, cmd, "claude".into(), move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
    let mut out = String::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(TermEvent::Output { data }) => out.push_str(&data),
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
            window: window.into(),
            project_id,
            cwd: std::env::temp_dir(),
            cols: 80,
            rows: 24,
            prompt: None,
            lane: lane.map(str::to_string),
            resume: false,
        };
        sessions.start(spec, cmd, label.into(), |_| {}).unwrap()
    };
    let claude = open("proj-9", 9, "claude", Some("/tmp/lane-2"));
    let other = open("proj-4", 4, "sh", None);
    let _idle = open("proj-4", 4, "sh", None);
    std::thread::sleep(std::time::Duration::from_millis(300));
    sessions.write(claude.id, "sleep 5\r").unwrap();
    sessions.write(other.id, "sleep 5\r").unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < deadline && sessions.busy_all().busy < 2 {
        std::thread::sleep(std::time::Duration::from_millis(50));
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
        let spec = OpenSpec {
            window: "main".into(),
            project_id: 4,
            cwd: std::env::temp_dir(),
            cols: 80,
            rows: 24,
            prompt: None,
            lane: None,
            resume: false,
        };
        sessions.start(spec, cmd, label.into(), |_| {}).unwrap()
    };
    let claude = open("claude");
    let other = open("cmd");
    let _idle = open("cmd");
    let settle = std::time::Instant::now() + std::time::Duration::from_secs(10);
    // 셸이 뜨는 동안의 순간(초기화 자식)을 지나 빈 셸 셋이 모두 쉬는 것을 본다.
    while std::time::Instant::now() < settle && sessions.busy_all().busy > 0 {
        std::thread::sleep(std::time::Duration::from_millis(100));
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
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline && sessions.busy_all().busy < 2 {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    assert_eq!(sessions.busy_all(), TermBusy { busy: 2, claude: 1 });
    sessions.close_all();
}

/// 출력 묶기 — 잘게 쏟아지는 조각(ConPTY · 전체 화면 다시 그리기)이 웹뷰 송신 몇 번으로 줄고, 글자는
/// 하나도 빠지거나 뒤섞이지 않으며, 반쪽 한글도 이어 붙는다. 채널이 끊기면(EOF) 남은 것을 보낸다.
#[test]
fn output_bursts_are_coalesced_into_few_sends_without_losing_bytes() {
    use std::sync::mpsc;
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
    pump_output(&rx, &table, 1, &|ev| {
        if let TermEvent::Output { data } = ev {
            sends.borrow_mut().push(data);
        }
    });
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
    use std::sync::mpsc;
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
    let spec = OpenSpec {
        window: "w".into(),
        project_id: 1,
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        prompt: None,
        lane: None,
        resume: false,
    };
    let info = sessions.start(spec, cmd, "sh".into(), |_| {}).unwrap();
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
    tx.send(b"before-".to_vec()).unwrap();
    tx.send(b"more-\x1b]7501;state=working\x1b\\after".to_vec())
        .unwrap();
    tx.send(b"-tail".to_vec()).unwrap();
    drop(tx);
    let events = std::cell::RefCell::new(Vec::<String>::new());
    pump_output(&rx, &sessions.inner, info.id, &|ev| {
        let line = match ev {
            TermEvent::Output { data } => format!("out:{}", data.replace('\x1b', "^")),
            TermEvent::Status { status } => {
                format!("status:{}", status.map(|s| s.state).unwrap_or_default())
            }
            TermEvent::Exit { .. } => "exit".to_string(),
        };
        events.borrow_mut().push(line);
    });
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
        let spec = OpenSpec {
            window: "main".into(),
            project_id: 4,
            cwd: std::env::temp_dir(),
            cols: 80,
            rows: 24,
            prompt: None,
            lane: None,
            resume: false,
        };
        sessions.start(spec, cmd, "cmd".into(), |_| {}).unwrap();
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

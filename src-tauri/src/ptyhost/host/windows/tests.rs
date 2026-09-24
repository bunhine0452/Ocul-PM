//! `host::windows` 의 테스트 — **windows 러너에서 실제 ConPTY·cmd.exe 로** 돈다.
//! 유닉스 판(`host/tests.rs` 의 `#[cfg(unix)]` 들)과 같은 계약을 같은 이름 결로 지킨다:
//! Kill 은 트리 전체를 끝내고, 놀고 있는 셸은 포그라운드가 아니며, 셸이 스스로 끝나면
//! `Exit` 가 한 번 온다.

use std::time::{Duration, Instant};

use tokio::sync::broadcast;

use super::super::*;
use super::*;

/// 기다림 하나의 상한 — 넘으면 받은 출력과 함께 실패한다.
const STEP_LIMIT: Duration = Duration::from_secs(30);

/// 테스트 하나의 상한 — 넘으면 **동기 호출이 매달린 것**이다. 감시 스레드가 지금 단계와
/// 받은 출력을 stderr 에 곧장 쓰고 프로세스를 끝낸다(cargo 는 다음 테스트 바이너리로 간다).
const WATCHDOG: Duration = Duration::from_secs(150);

/// 테스트 셸 — 러너의 `%COMSPEC%` (cmd.exe).
fn cmd_exe() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

/// 출력의 끝부분 — 실패 메시지용(이스케이프까지 보이게 `{:?}` 로 찍는다).
fn tail(text: &str) -> String {
    let skip = text.chars().count().saturating_sub(800);
    text.chars().skip(skip).collect()
}

/// ConPTY 위의 셸 세션 하나를 다루는 틀. 세 가지를 한다.
///
/// 1. **출력을 모으고 터미널 질의에 답한다.** 앱에서는 xterm.js 가 커서 위치(`ESC[6n`)·
///    장치 속성(`ESC[c`) 질의에 답한다. 테스트에는 답할 이가 없고, conhost·셸이 그 답을
///    기다리면 입력을 받기 전에 멈춘다.
/// 2. **실패해도 매달리지 않는다.** 세션을 안 끝낸 채 테스트가 끝나면 읽기 작업
///    (`spawn_blocking`)이 의사 콘솔이 닫히기를 영영 기다려 tokio 런타임이 못 내려가고,
///    테스트 바이너리 전체가 CI 단계 시한까지 매달린다 — 실패 메시지도 못 본다(첫 windows
///    실행이 그랬다). Drop 이 세션을 끝낸다.
/// 3. **동기 호출이 매달리면** [`WATCHDOG`] 이 끊는다.
struct Harness {
    state: Arc<HostState>,
    sid: &'static str,
    out: Arc<Mutex<String>>,
    step: Arc<Mutex<String>>,
    done: Arc<AtomicBool>,
    pump: tokio::task::JoinHandle<()>,
}

impl Harness {
    fn start(sid: &'static str, shell: &str) -> Harness {
        let state = HostState::new(None);
        let events = state.events.subscribe();
        let resp = start_session(
            &state,
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

        let out = Arc::new(Mutex::new(String::new()));
        let step = Arc::new(Mutex::new("셸 기동".to_string()));
        let done = Arc::new(AtomicBool::new(false));
        let pump = tokio::spawn(pump(state.clone(), sid, events, out.clone()));
        watchdog(sid, done.clone(), step.clone(), out.clone());
        Harness {
            state,
            sid,
            out,
            step,
            done,
            pump,
        }
    }

    fn mark(&self, what: &str) {
        *self.step.lock().unwrap() = what.to_string();
    }

    /// 지금까지 받은 출력의 길이 — 이후의 출력만 보려고 기다림에 넘긴다.
    fn len(&self) -> usize {
        self.out.lock().unwrap().len()
    }

    fn write(&self, data: &str) {
        let resp = handle_request(
            &self.state,
            Request::Write {
                sid: self.sid.to_string(),
                data: data.to_string(),
            },
        );
        assert!(matches!(resp, Response::Ok), "{resp:?}");
    }

    /// `since` 이후의 출력이 `ok` 를 만족할 때까지. 만족한 그 출력을 돌려준다.
    async fn wait_for(&self, what: &str, since: usize, ok: impl Fn(&str) -> bool) -> String {
        self.mark(what);
        let deadline = Instant::now() + STEP_LIMIT;
        loop {
            {
                let out = self.out.lock().unwrap();
                if ok(&out[since..]) {
                    return out[since..].to_string();
                }
                assert!(
                    Instant::now() < deadline,
                    "{what} — {STEP_LIMIT:?} 안에 안 왔다. 받은 출력 끝: {:?}",
                    tail(&out)
                );
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// 출력이 아닌 조건을 기다린다. 실패 메시지에는 `probe` 의 마지막 값과 출력을 싣는다.
    async fn until<T: std::fmt::Debug>(
        &self,
        what: &str,
        mut probe: impl FnMut() -> T,
        ok: impl Fn(&T) -> bool,
    ) {
        self.mark(what);
        let deadline = Instant::now() + STEP_LIMIT;
        loop {
            let seen = probe();
            if ok(&seen) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "{what} — {STEP_LIMIT:?} 안에 안 됐다. 마지막 값 {seen:?}, 받은 출력 끝: {:?}",
                tail(&self.out.lock().unwrap())
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// 프롬프트(`>`)까지.
    async fn prompt(&self) {
        self.wait_for("프롬프트", 0, |o| o.contains('>')).await;
    }

    fn shell_pid(&self) -> u32 {
        self.state
            .lock_sessions()
            .get(self.sid)
            .and_then(|s| s.child.process_id())
            .expect("셸 pid")
    }

    fn foreground(&self) -> Option<String> {
        match handle_request(
            &self.state,
            Request::Foreground {
                sid: self.sid.into(),
            },
        ) {
            Response::Foreground { command } => command,
            other => panic!("Foreground 응답이 아니다: {other:?}"),
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.done.store(true, Ordering::SeqCst);
        self.pump.abort();
        shutdown_sessions(&self.state);
    }
}

/// 출력을 모으고, 터미널 질의에 xterm.js 대신 답한다.
async fn pump(
    state: Arc<HostState>,
    sid: &'static str,
    mut events: broadcast::Receiver<Event>,
    out: Arc<Mutex<String>>,
) {
    const QUERIES: [(&[u8], &str); 3] = [
        (b"\x1b[6n", "\x1b[1;1R"),
        (b"\x1b[c", "\x1b[?1;0c"),
        (b"\x1b[0c", "\x1b[?1;0c"),
    ];
    let mut scanned = 0usize;
    loop {
        match events.recv().await {
            Ok(Event::Data { sid: s, text, .. }) if s == sid => {
                let mut replies = Vec::new();
                {
                    let mut all = out.lock().unwrap();
                    all.push_str(&text);
                    let bytes = all.as_bytes();
                    let mut next = scanned;
                    for (query, reply) in QUERIES {
                        let mut at = scanned;
                        while let Some(i) = find(&bytes[at..], query) {
                            replies.push(reply);
                            at += i + query.len();
                            next = next.max(at);
                        }
                    }
                    // 질의가 청크 경계에 걸렸을 수 있다 — 끝 몇 바이트는 다음에 다시 본다.
                    scanned = next.max(bytes.len().saturating_sub(4));
                }
                for reply in replies {
                    let _ = handle_request(
                        &state,
                        Request::Write {
                            sid: sid.to_string(),
                            data: reply.to_string(),
                        },
                    );
                }
            }
            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn watchdog(
    sid: &'static str,
    done: Arc<AtomicBool>,
    step: Arc<Mutex<String>>,
    out: Arc<Mutex<String>>,
) {
    std::thread::spawn(move || {
        let deadline = Instant::now() + WATCHDOG;
        while !done.load(Ordering::SeqCst) {
            if Instant::now() > deadline {
                let step = step.lock().map(|s| s.clone()).unwrap_or_default();
                let tail = out.lock().map(|o| tail(&o)).unwrap_or_default();
                // 테스트 출력 가로채기를 거치지 않고 곧장 — 곧 프로세스를 끝낸다.
                let _ = std::io::stderr().write_all(
                    format!(
                        "\n[watchdog] {sid}: {WATCHDOG:?} 넘게 끝나지 않는다 — 단계 {step:?}\n받은 출력 끝: {tail:?}\n"
                    )
                    .as_bytes(),
                );
                std::process::exit(101);
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
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
    let s = Harness::start("win-hangul", &cmd_exe());
    s.prompt().await;
    let since = s.len();
    s.write("echo 한글-ok-%OS%\r");
    s.wait_for("한글 출력", since, |o| o.contains("한글-ok-Windows_NT"))
        .await;
}

/// 리사이즈가 콘솔까지 닿는다 — cmd 의 `mode con` 이 새 폭을 말한다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_reaches_the_console() {
    let s = Harness::start("win-resize", &cmd_exe());
    s.prompt().await;
    s.mark("Resize 요청");
    let resp = handle_request(
        &s.state,
        Request::Resize {
            sid: s.sid.into(),
            rows: 33,
            cols: 123,
        },
    );
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    let since = s.len();
    s.write("mode con\r");
    // ConPTY 는 줄 안의 공백을 커서 이동 시퀀스로 바꿔 그리기도 한다 — 줄 단위가 아니라
    // "Columns" 바로 뒤 몇 글자 안에 새 폭이 있는지로 본다.
    s.wait_for("mode con 의 새 폭", since, |o| {
        o.find("Columns")
            .is_some_and(|i| o[i..].chars().take(48).collect::<String>().contains("123"))
    })
    .await;
}

/// **Kill 은 트리 전체를 끝낸다** — 셸, 콘솔에 붙은 포그라운드, 그리고 콘솔에 붙지
/// 않은 자손(새 콘솔로 띄운 것 — 의사 콘솔을 닫아도 살아남는다)까지. 뒤의 것이
/// Job 종료만이 닿는 자리다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_ends_the_whole_tree() {
    let s = Harness::start("win-kill", &cmd_exe());
    assert!(
        s.state.lock_sessions().get(s.sid).unwrap().job.is_some(),
        "셸이 Job 에 담겼다"
    );
    s.prompt().await;
    let shell = s.shell_pid();

    s.write("start \"\" /min ping -n 300 127.0.0.1\r");
    s.until("새 콘솔의 ping", || children_of(shell), |c| !c.is_empty())
        .await;
    s.write("ping -n 300 127.0.0.1\r");
    s.until("포그라운드 ping", || children_of(shell), |c| c.len() >= 2)
        .await;
    let tree = children_of(shell);

    s.mark("Kill");
    assert!(matches!(
        handle_request(&s.state, Request::Kill { sid: s.sid.into() }),
        Response::Ok
    ));
    assert!(
        s.state.lock_sessions().get(s.sid).is_none(),
        "맵에서 즉시 사라진다"
    );
    s.until(
        "셸과 자손 전부의 종료",
        || (alive(shell), tree.iter().filter(|p| alive(**p)).count()),
        |(shell_alive, alive_children)| !shell_alive && *alive_children == 0,
    )
    .await;
    assert!(children_of(shell).is_empty(), "살아 있는 자식이 0 이다");
}

/// 놀고 있는 셸은 포그라운드 명령이 아니고, 돌고 있는 명령은 그 이름으로 잡힌다.
/// ^C 로 그 명령이 끝나면 다시 `None` 이다 (유닉스 판과 같은 계약).
///
/// ^C 가 닿는다는 것 자체도 이 테스트가 지킨다 — CI 러너는 단계를 새 프로세스 그룹으로
/// 띄워 "Ctrl+C 무시" 가 켜진 채 물려 내려온다. 호스트도 같은 처지다(`prepare_shell`).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_shell_has_no_foreground_command_but_a_running_one_does() {
    let s = Harness::start("win-fg", &cmd_exe());
    s.prompt().await;
    // `/K chcp` 가 끝나기를 기다린다 — 그 찰나에는 chcp 가 자식이다.
    s.until("놀고 있는 셸", || s.foreground(), Option::is_none)
        .await;

    let since = s.len();
    s.write("ping -n 300 127.0.0.1\r");
    s.until(
        "ping 이 포그라운드",
        || s.foreground(),
        |c| {
            c.as_deref()
                .is_some_and(|c| c.to_ascii_lowercase().contains("ping"))
        },
    )
    .await;

    // ^C 는 ping 이 **첫 줄을 쓴 뒤에** 보낸다 (2026-09-24, L-PTY2 — 이 테스트가 가끔 ^C
    // 뒤에도 ping 이 돌아 붉었다). 콘솔의 Ctrl+C 는 그 순간 콘솔에 붙어 있는 프로세스에만
    // 간다. 막 생긴 ping 이 아직 붙기 전이면(프로세스 초기화의 처음 몇 ms) ^C 는 자식을
    // 기다리는 cmd 만 받아 삼키고 ping 은 계속 돈다 — 어느 Windows 터미널에서나 같은 콘솔
    // 의미론이다. 포그라운드 판정은 프로세스가 **생기자마자** ping 을 보므로 그 틈에 걸릴 수
    // 있었다. 러너에서 잰 값: 생긴 지 2~17ms 에 보낸 ^C 는 4/30 이 안 먹었고(전부 4ms 이하·
    // 출력 전·ping 의 "Ctrl+C 무시" 표시는 꺼짐, 두 번째 ^C 는 4/4 먹음), 첫 줄 뒤에 보낸
    // ^C 는 0/60 이었다. 첫 줄이 보였다 = 콘솔에 붙었다. 사람의 ^C 는 출력을 본 뒤라 이 틈에
    // 걸리지 않는다. 로캘과 무관하게 — 에코된 명령 뒤에 주소가 한 번 더 나오면 그 줄이다.
    s.wait_for("ping 의 첫 줄", since, |o| {
        o.contains("Pinging") || o.contains("Reply") || o.matches("127.0.0.1").count() >= 2
    })
    .await;
    s.write("\u{3}"); // ^C
    s.until("^C 뒤 다시 놀고 있음", || s.foreground(), Option::is_none)
        .await;
}

/// Hello 는 쥔 세션을 숨기지 않는다 — 0 으로 새면 앱이 사용자의 셸째 호스트를 내린다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hello_does_not_call_a_busy_host_empty() {
    let s = Harness::start("win-hello", &cmd_exe());
    let Response::Proto { sessions, .. } = handle_request(&s.state, Request::Hello) else {
        panic!("Hello 는 Proto 로 답한다");
    };
    assert_eq!(sessions, Some(1));
}

/// **셸이 스스로 끝나면 `Exit` 가 온다 — 한 번만.** ConPTY 가 출력 파이프를 닫아
/// 주든 아니든 같은 결과여야 한다(종료 감시와 EOF 중 먼저 온 쪽만 정리한다).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_shell_that_exits_by_itself_reports_exit_once() {
    let s = Harness::start("win-exit", &cmd_exe());
    s.prompt().await;
    let shell = s.shell_pid();
    let mut events = s.state.events.subscribe();
    s.write("exit\r");

    s.mark("Exit 이벤트");
    let first = tokio::time::timeout(STEP_LIMIT, async {
        loop {
            if let Ok(Event::Exit { sid }) = events.recv().await {
                if sid == s.sid {
                    return;
                }
            }
        }
    })
    .await;
    assert!(
        first.is_ok(),
        "셸이 끝났는데 Exit 가 안 온다. 받은 출력 끝: {:?}",
        tail(&s.out.lock().unwrap())
    );
    assert!(
        s.state.lock_sessions().get(s.sid).is_none(),
        "끝난 세션은 맵에서 빠진다"
    );
    assert!(!alive(shell), "셸이 끝났다");
    // 두 번째 Exit 는 없다.
    let extra = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(Event::Exit { sid }) = events.recv().await {
                if sid == s.sid {
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
    let name = pipe::Identity::current().unwrap().pipe_name(&socket);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let gone = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&name)
            .is_err_and(|e| e.raw_os_error() == Some(2)); // ERROR_FILE_NOT_FOUND
        if gone {
            break;
        }
        assert!(Instant::now() < deadline, "파이프 이름이 사라지지 않는다");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
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

//! 한 세션의 막힌 쓰기가 다른 세션을 세우지 않는다 (#pty-write-lock).
//!
//! **왜 이 파일이 있는가.** PTY 마스터로의 `write` 는 자식이 raw 모드로 tty 를
//! 잡고 입력을 읽지 않는 동안 무기한 블록한다 — vim·less·도구 호출 중인 claude,
//! 즉 터미널에서 가장 흔한 상태다 (재현으로 확인: `stty raw` + 읽지 않는
//! 포그라운드에 1 MB 를 쓰면 5초가 지나도 **0 바이트**). 예전 `host.rs` 는 그
//! `write_all` 을 **전역 세션 맵 락을 쥔 채** 요청 처리기 안에서 직접 불렀고,
//! 요청 처리는 접속별 읽기 루프 안에서 동기로 돈다. 그래서 붙여넣기 한 번이
//! 모든 세션의 모든 요청을 세웠고, 앱의 10초 요청 상한이 지나면 접속 자체가
//! 죽은 것으로 표시돼 **모든 터미널이 한꺼번에 끊겼다.**
//!
//! 모킹하지 않는 이유는 `ptyhost_reattach.rs` 와 같다 — 여기서 검증하려는 것이
//! 실제 tty 의 흐름 제어라, 가짜 sink 로 바꾸면 대상이 사라진다.

#![cfg(unix)]

use std::time::{Duration, Instant};

use ocul_pm_lib::ptyhost::client::PtyHostClient;
use ocul_pm_lib::ptyhost::host::{serve, HostState};
use ocul_pm_lib::ptyhost::protocol::{Event, Request, Response};
use ocul_pm_lib::ptyhost::writer::SessionWriter;
use tokio::sync::mpsc;

/// 큐가 막혀도 이만큼 안에 응답이 와야 한다. 앱의 요청 상한(10초)보다 훨씬
/// 짧게 잡는다 — 상한에 닿는 순간 접속이 죽은 것으로 표시되기 때문이다.
const FAST: Duration = Duration::from_secs(2);

async fn spawn_host(socket: &std::path::Path) {
    let state = HostState::new(None);
    let serve_socket = socket.to_path_buf();
    tokio::spawn(async move {
        let _ = serve(state, &serve_socket).await;
    });
    for _ in 0..200 {
        if socket.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("호스트가 소켓을 잡지 못했다");
}

async fn connect(socket: &std::path::Path) -> (PtyHostClient, mpsc::UnboundedReceiver<Event>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let client = PtyHostClient::connect(socket, move |ev| {
        let _ = tx.send(ev);
    })
    .await
    .expect("connect to the test host");
    (client, rx)
}

fn start_req(sid: &str) -> Request {
    Request::Start {
        sid: sid.to_string(),
        cwd: String::new(),
        rows: 24,
        cols: 80,
        shell: "/bin/sh".to_string(),
        env: vec![("TERM".to_string(), "dumb".to_string())],
        nonce: "n".to_string(),
        shell_integration: false,
    }
}

/// 이 세션의 tty 를 **입력을 읽지 않는 raw 모드**로 만든다 — 마스터 쪽 쓰기가
/// 실제로 막히는 유일한 상태다. 포그라운드가 셸에서 `sleep` 으로 넘어간 것을
/// 보고서야 돌아온다 (`Foreground` 는 놀고 있는 셸에는 `None` 이다).
async fn wedge_the_tty(client: &PtyHostClient, sid: &str) {
    let resp = client
        .request(Request::Write {
            sid: sid.to_string(),
            data: "stty raw; sleep 30\n".to_string(),
        })
        .await
        .expect("셸에 명령을 넣는 것까지는 막히지 않는다");
    assert!(matches!(resp, Response::Ok), "got {resp:?}");

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let resp = client
            .request(Request::Foreground {
                sid: sid.to_string(),
            })
            .await
            .expect("foreground 조회");
        if let Response::Foreground {
            command: Some(cmd), ..
        } = resp
        {
            if cmd.contains("sleep") {
                return;
            }
        }
        assert!(Instant::now() < deadline, "sleep 이 포그라운드가 안 된다");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// **이 라운드의 핵심 단언.** 한 세션이 막혀 있는 동안 다른 세션의 요청이
/// 그대로 오간다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_wedged_session_does_not_stall_the_others() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    spawn_host(&socket).await;
    let (client, _events) = connect(&socket).await;

    client.request(start_req("p1-wedged")).await.unwrap();
    client.request(start_req("p2-live")).await.unwrap();
    wedge_the_tty(&client, "p1-wedged").await;

    // 막힌 세션에 tty 입력 큐보다 훨씬 큰 덩어리를 붓는다 (= 붙여넣기).
    let paste = "x".repeat(1024 * 1024);
    let started = Instant::now();
    let resp = tokio::time::timeout(
        FAST,
        client.request(Request::Write {
            sid: "p1-wedged".into(),
            data: paste,
        }),
    )
    .await
    .expect("막힌 세션이라도 요청은 즉시 답해야 한다 — 큐에 넣는 일이므로")
    .expect("전송 실패");
    assert!(matches!(resp, Response::Ok), "got {resp:?}");

    // 그리고 **다른 세션**이 멀쩡해야 한다. 예전에는 여기서 전역 세션 락을
    // 기다리다 10초 상한에 걸려 접속 자체가 죽었다.
    let resp = tokio::time::timeout(
        FAST,
        client.request(Request::Attach {
            sid: "p2-live".into(),
        }),
    )
    .await
    .expect("막힌 세션이 다른 세션의 attach 를 막고 있다")
    .expect("전송 실패");
    assert!(
        matches!(resp, Response::Attach { attach: Some(_) }),
        "got {resp:?}"
    );

    // 살아있는 세션에 실제 입력도 그대로 간다 (큐가 세션별인지의 확인).
    let resp = tokio::time::timeout(
        FAST,
        client.request(Request::Write {
            sid: "p2-live".into(),
            data: "echo LIVE_$((1+1))\n".into(),
        }),
    )
    .await
    .expect("살아있는 세션의 쓰기가 막혔다")
    .expect("전송 실패");
    assert!(matches!(resp, Response::Ok), "got {resp:?}");

    assert!(
        started.elapsed() < Duration::from_secs(6),
        "세 요청이 {}ms 걸렸다 — 어딘가에서 서로를 기다리고 있다",
        started.elapsed().as_millis()
    );

    // **이 테스트가 헛돌지 않는다는 증거.** 막힌 세션의 큐는 실제로 차 올라야
    // 한다 — 안 찬다면 `stty raw` 가 안 먹어 tty 가 애초에 안 막힌 것이고,
    // 위의 단언들은 아무것도 증명하지 못한 것이 된다. 가득 찬 큐가 조용한
    // 유실이 아니라 **오류**라는 계약도 여기서 함께 확인한다.
    let mut refused = None;
    for _ in 0..2000 {
        let resp = tokio::time::timeout(
            FAST,
            client.request(Request::Write {
                sid: "p1-wedged".into(),
                data: "y".into(),
            }),
        )
        .await
        .expect("막힌 세션의 쓰기가 응답을 안 준다")
        .expect("전송 실패");
        if let Response::Error { message } = resp {
            refused = Some(message);
            break;
        }
    }
    let refused = refused.expect("큐가 차지 않았다 — tty 가 막히지 않아 이 테스트는 무의미하다");
    assert!(refused.contains("queue is full"), "{refused}");

    let _ = client.request(Request::KillExcept { keep: vec![] }).await;
}

/// 큐에 넣는 것과 실제로 쓰이는 것은 다르다 — 살아있는 세션의 입력은 끝내
/// 셸에 닿아야 한다 (`Response::Ok` 가 "받았다" 를 뜻하지 않게 된 대가 확인).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queued_input_still_reaches_the_shell() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    spawn_host(&socket).await;
    let (client, mut events) = connect(&socket).await;

    client.request(start_req("p1-echo")).await.unwrap();
    client
        .request(Request::Write {
            sid: "p1-echo".into(),
            data: "echo QUEUED_$((40+2))\n".into(),
        })
        .await
        .unwrap();

    let mut seen = String::new();
    tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(ev) = events.recv().await {
            if let Event::Data { text, .. } = ev {
                seen.push_str(&text);
                if seen.contains("QUEUED_42") {
                    return;
                }
            }
        }
    })
    .await
    .expect("큐를 지난 입력이 셸에 닿지 않았다");

    let _ = client.request(Request::KillExcept { keep: vec![] }).await;
}

// ─── 큐 자체의 계약 (PTY 없이) ───────────────────────────────────────────────

/// 절대 진척되지 않는 sink — raw 모드 tty 의 모형. 몇 바이트를 받았는지는
/// 세지만, 열어 주기 전까지는 첫 `write` 에서 잠긴다.
struct Wedged {
    gate: std::sync::Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}

impl std::io::Write for Wedged {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let (lock, cv) = &*self.gate;
        let mut open = lock.lock().unwrap_or_else(|p| p.into_inner());
        while !*open {
            open = cv.wait(open).unwrap_or_else(|p| p.into_inner());
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// 큐에 넣는 쪽은 **결코 블록하지 않는다** — 이것이 전역 락을 놓을 수 있는
/// 근거다. 큐 핸들을 꺼낸 뒤에도 블록한다면 락만 옮긴 것이 된다.
#[test]
fn enqueue_returns_while_the_pty_is_wedged() {
    let gate = std::sync::Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let writer = SessionWriter::spawn(Box::new(Wedged { gate: gate.clone() }));

    // 별도 스레드에서 넣는다 — 회귀했을 때 **테스트가 매달리지 않고 실패**해야
    // 한다 (동기 쓰기로 되돌린 판에서는 여기가 영영 안 돌아온다).
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..64 {
            if let Err(e) = writer.enqueue("hello") {
                let _ = done_tx.send(Err(e));
                return;
            }
        }
        let _ = done_tx.send(Ok(()));
    });
    let outcome = done_rx.recv_timeout(Duration::from_secs(3));

    // 문을 열어 쓰기 스레드가 빠져나가게 한다 (판정보다 먼저 — 실패해도 매달린
    // 스레드를 남기지 않는다).
    let (lock, cv) = &*gate;
    *lock.lock().unwrap_or_else(|p| p.into_inner()) = true;
    cv.notify_all();

    match outcome {
        Ok(Ok(())) => {}
        Ok(Err(e)) => panic!("막힌 sink 뒤에서 enqueue 가 실패했다: {e}"),
        Err(_) => panic!("막힌 sink 뒤에서 enqueue 가 블록했다 — 락만 옮긴 것이다"),
    }
}

/// 실패는 사라지지 않는다 — 비동기로 옮긴 대가로 오류가 조용해지면
/// "unknown pty session 은 조용한 성공이 아니다" 는 계약도 함께 무너진다.
#[test]
fn a_write_failure_surfaces_on_a_later_enqueue() {
    struct Broken;
    impl std::io::Write for Broken {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "gone"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let writer = SessionWriter::spawn(Box::new(Broken));
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match writer.enqueue("x") {
            Err(message) => {
                assert!(message.contains("Failed to write to PTY"), "{message}");
                return;
            }
            Ok(()) => {
                assert!(Instant::now() < deadline, "쓰기 실패가 영영 안 올라온다");
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

/// 순서가 곧 계약이다 — 키 입력이 뒤섞이면 터미널이 아니다.
#[test]
fn chunks_reach_the_pty_in_order() {
    struct Recorder(std::sync::mpsc::Sender<Vec<u8>>);
    impl std::io::Write for Recorder {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let _ = self.0.send(buf.to_vec());
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let writer = SessionWriter::spawn(Box::new(Recorder(tx)));
    for i in 0..200 {
        writer.enqueue(&format!("{i};")).unwrap();
    }
    let mut seen = String::new();
    while seen.matches(';').count() < 200 {
        let chunk = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("쓰기 스레드가 조각을 흘렸다");
        seen.push_str(&String::from_utf8_lossy(&chunk));
    }
    let expected: String = (0..200).map(|i| format!("{i};")).collect();
    assert_eq!(seen, expected, "순서가 바뀌었다");
}

//! PTY 호스트 통합 테스트 (#pty-host) — 이 기능의 존재 이유인 계약을 검증한다:
//! **클라이언트(앱)가 끊겼다 다시 붙어도 세션·스크롤백·nonce 가 그대로다.**
//!
//! 실제 유닉스 소켓 + 실제 /bin/sh PTY 를 쓴다 — 모킹하면 "재접속" 이라는
//! 대상 자체가 사라진다.

#![cfg(unix)]

use std::time::Duration;

use ocul_pm_lib::ptyhost::client::{connect_or_spawn, socket_candidates, PtyHostClient};
use ocul_pm_lib::ptyhost::host::{serve, HostState};
use ocul_pm_lib::ptyhost::protocol::{Event, Request, Response};
use tokio::sync::mpsc;
use tokio::time::timeout;

/// 이벤트를 채널로 모으는 클라이언트 접속.
async fn connect(socket: &std::path::Path) -> (PtyHostClient, mpsc::UnboundedReceiver<Event>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let client = PtyHostClient::connect(socket, move |ev| {
        let _ = tx.send(ev);
    })
    .await
    .expect("connect to the test host");
    (client, rx)
}

fn start_req(sid: &str, nonce: &str) -> Request {
    Request::Start {
        sid: sid.to_string(),
        cwd: String::new(),
        rows: 24,
        cols: 80,
        shell: "/bin/sh".to_string(),
        env: vec![("TERM".to_string(), "dumb".to_string())],
        nonce: nonce.to_string(),
        shell_integration: false,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_survives_client_reconnect() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    let state = HostState::new(None);
    let serve_socket = socket.clone();
    tokio::spawn(async move {
        let _ = serve(state, &serve_socket).await;
    });
    // bind 가 끝나기를 기다린다.
    for _ in 0..100 {
        if socket.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    // ── 첫 클라이언트: 세션을 만들고 출력을 확인한다 ─────────────────────
    let (client_a, mut events_a) = connect(&socket).await;
    let resp = client_a
        .request(start_req("p1-test", "nonce-one"))
        .await
        .unwrap();
    let Response::Session { nonce, .. } = resp else {
        panic!("expected Session, got {resp:?}")
    };
    assert_eq!(nonce, "nonce-one");

    // 에코가 아니라 **실행 결과**만 나올 수 있는 문자열을 만든다.
    client_a
        .request(Request::Write {
            sid: "p1-test".into(),
            data: "echo HELLO_$((40+2))\r".into(),
        })
        .await
        .unwrap();
    let mut seen = String::new();
    timeout(Duration::from_secs(15), async {
        while let Some(ev) = events_a.recv().await {
            if let Event::Data { text, .. } = ev {
                seen.push_str(&text);
                if seen.contains("HELLO_42") {
                    break;
                }
            }
        }
    })
    .await
    .expect("shell output did not arrive");

    // 멱등 start — 같은 sid 로 다시 부르면 (다른 nonce 를 넘겨도) 기존 세션의
    // nonce 가 돌아온다. 새 nonce 를 돌려주면 프런트가 살아있는 셸의 OSC 를
    // 전부 위조로 판정한다.
    let resp = client_a
        .request(start_req("p1-test", "nonce-two"))
        .await
        .unwrap();
    assert!(matches!(resp, Response::Session { nonce, .. } if nonce == "nonce-one"));

    // ── 앱 재시작 시뮬레이션: 접속을 끊고 새 클라이언트로 붙는다 ─────────
    drop(client_a);
    drop(events_a);
    tokio::time::sleep(Duration::from_millis(100)).await;

    let (client_b, _events_b) = connect(&socket).await;
    let resp = client_b
        .request(Request::Attach {
            sid: "p1-test".into(),
        })
        .await
        .unwrap();
    let Response::Attach {
        attach: Some(attach),
    } = resp
    else {
        panic!("session must survive the reconnect, got {resp:?}")
    };
    assert!(
        attach.text.contains("HELLO_42"),
        "scrollback must replay: {:?}",
        attach.text
    );
    assert_eq!(
        attach.nonce, "nonce-one",
        "nonce must survive — OSC 검증이 깨진다"
    );
    assert!(attach.seq > 0);

    // 미지의 세션 write 는 조용한 성공이 아니라 오류다 (A0d 계약 유지).
    let resp = client_b
        .request(Request::Write {
            sid: "ghost".into(),
            data: "x".into(),
        })
        .await
        .unwrap();
    assert!(
        matches!(resp, Response::Error { ref message } if message.contains("unknown pty session")),
        "got {resp:?}"
    );

    // ── 정리 계약: KillExcept(keep=[]) 는 전량 종료 ──────────────────────
    let resp = client_b
        .request(Request::KillExcept { keep: vec![] })
        .await
        .unwrap();
    assert!(matches!(resp, Response::Count { n: 1 }), "got {resp:?}");
    let resp = client_b
        .request(Request::Attach {
            sid: "p1-test".into(),
        })
        .await
        .unwrap();
    assert!(matches!(resp, Response::Attach { attach: None }));
}

#[tokio::test(flavor = "multi_thread")]
async fn kill_prefix_only_touches_that_window() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("host.sock");
    let state = HostState::new(None);
    let serve_socket = socket.clone();
    tokio::spawn(async move {
        let _ = serve(state, &serve_socket).await;
    });
    for _ in 0..100 {
        if socket.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let (client, _events) = connect(&socket).await;
    client.request(start_req("p1-aaa", "n1")).await.unwrap();
    client.request(start_req("p12-bbb", "n2")).await.unwrap();

    // `p1-` 은 `p12-…` 를 잡아먹지 않는다 (window.rs 접두사 규격).
    let resp = client
        .request(Request::KillPrefix {
            prefix: "p1-".into(),
        })
        .await
        .unwrap();
    assert!(matches!(resp, Response::Count { n: 1 }), "got {resp:?}");
    let resp = client
        .request(Request::Attach {
            sid: "p12-bbb".into(),
        })
        .await
        .unwrap();
    assert!(matches!(resp, Response::Attach { attach: Some(_) }));

    let _ = client.request(Request::KillExcept { keep: vec![] }).await;
}

/// **업데이트가 세션을 끊지 않는다** (2026-09-03) — 이 파일에서 가장 비싼 계약.
///
/// v2.34.0 이 소켓 이름에 프로토콜을 달면서 업데이트한 앱이 옛 자리를 쳐다보지
/// 않게 됐고, 그 안에서 돌던 사용자의 세션이 통째로 끊겼다. 이제 앱은 정식
/// 자리가 비어 있으면 옛 자리까지 두드려 **그 호스트를 그대로 이어받는다.**
/// 내리지 않는다.
#[tokio::test(flavor = "multi_thread")]
async fn the_app_adopts_a_host_left_at_an_old_address() {
    let dir = tempfile::tempdir().unwrap();
    let candidates = socket_candidates(dir.path());
    assert!(candidates.len() > 1, "옛 자리가 후보에 있어야 한다");
    let (canonical, legacy) = (candidates[0].clone(), candidates[1].clone());

    // 업데이트 **전** 판이 띄운 호스트 — 옛 자리에 살아 세션을 쥐고 있다.
    let state = HostState::new(None);
    let serve_socket = legacy.clone();
    tokio::spawn(async move {
        let _ = serve(state, &serve_socket).await;
    });
    for _ in 0..100 {
        if legacy.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let (old_client, _events) = connect(&legacy).await;
    old_client
        .request(start_req("p1-live", "n1"))
        .await
        .unwrap();
    drop(old_client); // 앱이 업데이트로 내려간다

    // 업데이트 **후** 판이 뜬다. 정식 자리는 비어 있다 — 그래도 세션을 찾는다.
    assert!(!canonical.exists(), "정식 자리는 아직 비어 있다");
    let adopted = connect_or_spawn(&candidates, false, |_| {})
        .await
        .expect("붙는 데 실패하면 안 된다")
        .expect("옛 자리의 호스트를 찾아야 한다");

    let resp = adopted
        .request(Request::Attach {
            sid: "p1-live".into(),
        })
        .await
        .unwrap();
    assert!(
        matches!(resp, Response::Attach { attach: Some(_) }),
        "업데이트를 건너 세션이 살아 있어야 한다, got {resp:?}"
    );

    let _ = adopted.request(Request::KillExcept { keep: vec![] }).await;
}

/// 아무 자리에도 호스트가 없으면 — 그리고 띄우지 말라고 했으면 — `None` 이다.
/// (세션이 없다는 뜻이고, `attach` 는 이 답을 보고 새 셸로 간다.)
#[tokio::test(flavor = "multi_thread")]
async fn no_host_anywhere_is_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let found = connect_or_spawn(&socket_candidates(dir.path()), false, |_| {})
        .await
        .expect("호스트가 없는 것은 오류가 아니다");
    assert!(found.is_none());
}

/// 시체 소켓 파일이 정식 자리를 막고 있어도 옛 자리를 계속 두드린다 —
/// 업데이트 직후가 정확히 이 모양이다 (v2.33 이 남긴 `ptyhost.sock` 시체 +
/// v2.34 가 쥐고 있는 `ptyhost-v2.sock`).
#[tokio::test(flavor = "multi_thread")]
async fn a_stale_socket_file_does_not_hide_the_live_host() {
    let dir = tempfile::tempdir().unwrap();
    let candidates = socket_candidates(dir.path());
    std::fs::write(&candidates[0], b"").unwrap(); // 시체

    let legacy = candidates[1].clone();
    let state = HostState::new(None);
    let serve_socket = legacy.clone();
    tokio::spawn(async move {
        let _ = serve(state, &serve_socket).await;
    });
    for _ in 0..100 {
        if legacy.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let found = connect_or_spawn(&candidates, false, |_| {})
        .await
        .expect("시체 파일에 걸려 넘어지면 안 된다");
    assert!(found.is_some(), "살아 있는 옛 호스트를 찾아야 한다");
}

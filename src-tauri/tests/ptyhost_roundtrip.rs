//! **왕복 한 바퀴** (#pty-tests) — 실제 앱 바이너리를 `--pty-host` 로 **분리 기동**해
//! (`main.rs` 의 분기와 `spawn_host_from` 의 분리 플래그까지) 앱이 겪는 순서 그대로 돈다:
//!
//! 세션 열기 → 한글 왕복 → 리사이즈 → 앱 재접속(attach 로 스크롤백·크기 마커) →
//! Kill 뒤 셸·자식 0 → 다시 재접속(세션 없음) → 호스트 내리기(자리가 빈다).
//!
//! 이 파일의 주 대상은 Windows 다(네임드 파이프 · ConPTY · Job Object — 사용자가 직접
//! 못 보는 OS 라 windows 러너가 눈이다). 유닉스에서도 같은 계약을 돈다.
//!
//! 앱 바이너리를 쓰는 이유: 테스트 실행 파일은 `--pty-host` 를 모른다. 호스트가 앱과
//! **다른 프로세스**로 떠 앱(여기서는 테스트)이 붙었다 떨어졌다 해도 사는지가 이 기능의
//! 존재 이유라, 같은 프로세스 안의 `serve` 로는 그 자리가 검증되지 않는다.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use ocul_pm_lib::ptyhost::client::{connect_or_spawn, spawn_host_from, PtyHostClient};
use ocul_pm_lib::ptyhost::protocol::{Event, Request, Response};
use tokio::sync::mpsc;

const APP: &str = env!("CARGO_BIN_EXE_ocul-pm");
const SID: &str = "p1-roundtrip";

/// 이벤트를 채널로 모으는 앱 쪽 접속. 호스트가 늦게 떠도 기다린다(디버그 앱 바이너리의
/// 기동은 러너에서 몇 초가 걸린다).
async fn attach_app(socket: &Path) -> (PtyHostClient, mpsc::UnboundedReceiver<Event>) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let (tx, rx) = mpsc::unbounded_channel();
        let on_event = move |ev| {
            let _ = tx.send(ev);
        };
        match connect_or_spawn(&[socket.to_path_buf()], false, on_event).await {
            Ok(Some(client)) => return (client, rx),
            Ok(None) | Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            other => panic!("호스트에 못 붙었다: {:?}", other.map(|c| c.is_some())),
        }
    }
}

/// `SID` 의 출력에서 `done` 이 참이 될 때까지 모은다.
async fn read_until(
    events: &mut mpsc::UnboundedReceiver<Event>,
    what: &str,
    mut done: impl FnMut(&str) -> bool,
) -> String {
    let mut seen = String::new();
    let outcome = tokio::time::timeout(Duration::from_secs(60), async {
        while let Some(ev) = events.recv().await {
            if let Event::Data { sid, text, .. } = ev {
                if sid == SID {
                    seen.push_str(&text);
                    if done(&seen) {
                        return;
                    }
                }
            }
        }
    })
    .await;
    assert!(outcome.is_ok(), "{what} — 받은 출력: {seen:?}");
    seen
}

/// `text` 안의 `key` 바로 뒤에 붙은 숫자. 에코된 입력(`PID=$PID`)은 숫자가 아니라 건너뛴다.
fn number_after(text: &str, key: &str) -> Option<u32> {
    text.match_indices(key).find_map(|(i, _)| {
        let digits: String = text[i + key.len()..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        digits.parse().ok()
    })
}

async fn write(client: &PtyHostClient, data: &str) {
    let resp = client
        .request(Request::Write {
            sid: SID.into(),
            data: data.into(),
        })
        .await
        .expect("전송");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
}

/// 셸마다 다른 말 — 같은 계약을 그 셸의 문법으로.
struct Script {
    shell: String,
    /// 한글 + **실행 결과**만 만들 수 있는 부분 (에코된 입력으로 통과하지 않게).
    hangul: (&'static str, &'static str),
    /// 지금 폭을 `W=<cols>` 로 말하게.
    width: &'static str,
    /// 셸 pid 를 `PID=<n>`, 자식 하나를 띄워 그 pid 를 `CHILD=<n>` 으로.
    pids: &'static str,
}

#[cfg(unix)]
fn script() -> Script {
    Script {
        shell: "/bin/sh".into(),
        hangul: ("echo 한글-ok-$((40+2))\r", "한글-ok-42"),
        width: "echo W=$(stty size | cut -d' ' -f2)\r",
        // 포그라운드 자식 — Kill 의 SIGHUP 이 닿는 자리.
        pids: "echo PID=$$; sh -c 'echo CHILD=$$; exec sleep 300'\r",
    }
}

#[cfg(windows)]
fn script() -> Script {
    // 기본 셸 후보(L-SHELL) — pwsh 가 있으면 그것, 없으면 Windows PowerShell(늘 있다).
    let pwsh = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join("pwsh.exe").is_file()))
        .unwrap_or(false);
    Script {
        shell: if pwsh { "pwsh.exe" } else { "powershell.exe" }.into(),
        hangul: ("Write-Output ('한글-ok-' + (40+2))\r", "한글-ok-42"),
        width: "Write-Output ('W=' + [Console]::WindowWidth)\r",
        // 새 (숨긴) 콘솔로 띄운 자식 — 의사 콘솔을 닫아도 살아남아 **Job 종료만** 닿는 자리.
        pids: "Write-Output \"PID=$PID\"; $c = Start-Process ping -ArgumentList '-n','300','127.0.0.1' -WindowStyle Hidden -PassThru; Write-Output \"CHILD=$($c.Id)\"\r",
    }
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    // SAFETY: 신호 0 은 존재 확인만 한다.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: 실패하면 null — 없는 프로세스다.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let mut code = 0u32;
    // SAFETY: 방금 연 핸들, 출력은 지역 변수. 끝나면 닫는다.
    let ok = unsafe { GetExitCodeProcess(handle, &mut code) };
    unsafe { CloseHandle(handle) };
    ok != 0 && code == STILL_ACTIVE as u32
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_detached_host_carries_a_session_through_the_whole_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let socket: PathBuf = dir.path().join("ptyhost.sock");
    let script = script();

    // ── 분리 기동 + 첫 접속 ─────────────────────────────────────────────
    spawn_host_from(Path::new(APP), &socket).expect("호스트를 띄운다");
    let (app, mut events) = attach_app(&socket).await;

    let resp = app
        .request(Request::Start {
            sid: SID.into(),
            cwd: String::new(),
            rows: 24,
            cols: 80,
            shell: script.shell.clone(),
            env: vec![("TERM".into(), "xterm-256color".into())],
            nonce: "nonce-rt".into(),
            shell_integration: false,
        })
        .await
        .expect("start");
    assert!(matches!(resp, Response::Session { .. }), "{resp:?}");
    read_until(&mut events, "프롬프트", |s| {
        s.contains('$') || s.contains('>')
    })
    .await;

    // ── 한글 왕복 ──────────────────────────────────────────────────────
    let (line, expected) = script.hangul;
    write(&app, line).await;
    read_until(&mut events, "한글 출력", |s| s.contains(expected)).await;

    // ── 리사이즈 → 셸이 새 폭을 본다 ───────────────────────────────────
    let resp = app
        .request(Request::Resize {
            sid: SID.into(),
            rows: 33,
            cols: 123,
        })
        .await
        .expect("resize");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    write(&app, script.width).await;
    read_until(&mut events, "새 폭", |s| {
        number_after(s, "W=") == Some(123)
    })
    .await;

    // ── 앱 재시작: 접속을 버리고 새로 붙는다 — 세션·스크롤백·크기가 그대로 ──
    drop(app);
    drop(events);
    let (app, mut events) = attach_app(&socket).await;
    let Response::Attach {
        attach: Some(snapshot),
    } = app
        .request(Request::Attach { sid: SID.into() })
        .await
        .expect("attach")
    else {
        panic!("재접속한 앱이 세션을 못 찾는다");
    };
    assert!(
        snapshot.text.contains(expected),
        "스크롤백에 한글이 남아 있다: {:?}",
        snapshot.text
    );
    assert_eq!(snapshot.nonce, "nonce-rt");
    assert_eq!(snapshot.cols, 123, "지금 폭을 이어받는다");
    let last = snapshot.sizes.last().expect("크기 마커");
    assert_eq!((last.rows, last.cols), (33, 123));

    // ── Kill 뒤 셸·자식 0 ──────────────────────────────────────────────
    write(&app, script.pids).await;
    let seen = read_until(&mut events, "PID·CHILD", |s| {
        number_after(s, "PID=").is_some() && number_after(s, "CHILD=").is_some()
    })
    .await;
    let shell = number_after(&seen, "PID=").unwrap();
    let child = number_after(&seen, "CHILD=").unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !(alive(shell) && alive(child)) {
        assert!(
            Instant::now() < deadline,
            "셸({shell})·자식({child})이 살아 있어야 한다"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let resp = app
        .request(Request::Kill { sid: SID.into() })
        .await
        .expect("kill");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    let deadline = Instant::now() + Duration::from_secs(10);
    while alive(shell) || alive(child) {
        assert!(
            Instant::now() < deadline,
            "Kill 뒤에도 살아 있다 — 셸 {shell}: {}, 자식 {child}: {}",
            alive(shell),
            alive(child)
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // ── 다시 재접속: 호스트는 살아 있고, 세션은 없다 ───────────────────
    drop(app);
    drop(events);
    let (app, _events) = attach_app(&socket).await;
    let resp = app
        .request(Request::Attach { sid: SID.into() })
        .await
        .expect("attach");
    assert!(
        matches!(resp, Response::Attach { attach: None }),
        "끝낸 세션이 남아 있다: {resp:?}"
    );

    // ── 호스트를 내린다 — 자리가 비어야 다음 호스트가 앉는다 ──────────
    let resp = app.request(Request::Shutdown).await.expect("shutdown");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    drop(app);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let found = connect_or_spawn(std::slice::from_ref(&socket), false, |_| {})
            .await
            .expect("호스트가 없는 것은 오류가 아니다");
        if found.is_none() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "내린 호스트의 자리가 비지 않는다"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // 호스트가 유예(종료 스레드) 뒤 스스로 나가며 로그를 남긴다 — 임시 폴더를 지우기 전에.
    tokio::time::sleep(Duration::from_millis(2500)).await;
}

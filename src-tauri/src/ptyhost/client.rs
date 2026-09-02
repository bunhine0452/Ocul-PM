//! PTY 호스트의 앱 쪽 클라이언트 (#pty-host).
//!
//! 접속 하나로 요청/응답(id 짝짓기)과 자발 이벤트를 같이 받는다 — LSP
//! 클라이언트와 같은 모양새다. 이벤트는 콜백으로 올린다 (terminal.rs 가
//! tauri 이벤트로 재방출).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

use super::protocol::{ClientFrame, Event, HostFrame, Request, Response, PROTO_VERSION};
use crate::framing::{encode_frame, parse_frame, Frame};

/// 스폰 후 접속 재시도 — 50ms × 60 = 최대 3초. cargo 디버그 빌드의 느린
/// 프로세스 기동까지 감안한 여유다.
const CONNECT_RETRY_MS: u64 = 50;
const CONNECT_RETRIES: u32 = 60;

/// 요청 하나의 응답 상한. 정상 왕복은 밀리초 — 이걸 넘기는 호스트는 먹통이고,
/// 상한이 없으면 그 먹통이 터미널 마운트(start/attach 대기)를 영원히 막는다.
const REQUEST_TIMEOUT_SECS: u64 = 10;

pub struct PtyHostClient {
    tx: mpsc::UnboundedSender<Vec<u8>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Response>>>>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    /// 읽기 루프. 버릴 때 **여기서 소켓을 놓아야** 호스트가 EOF 를 본다.
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for PtyHostClient {
    /// 죽었다고 표시만 하고 버린 접속이 소켓을 붙들고 있었다 (2026-09-02).
    ///
    /// 요청 타임아웃은 `alive=false` 만 세우고 이 클라이언트를 슬롯에서 뺀다.
    /// 그런데 읽기 태스크는 `read()` 에 파킹된 채 살아 있어 접속이 열린 그대로
    /// 남았고, 호스트의 **클라이언트 수가 줄지 않아** 유휴 자동 종료(클라이언트
    /// 0 · 세션 0)가 영영 걸리지 않았다. 태스크를 끊으면 read half 가 드롭되고,
    /// 쓰기 태스크는 `tx` 드롭으로 이미 끝나므로 호스트가 EOF 를 본다.
    fn drop(&mut self) {
        self.reader.abort();
    }
}

impl PtyHostClient {
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// 접속만 한다 — 호스트가 없으면 Err. 이벤트는 `on_event` 로 올라온다.
    pub async fn connect(
        socket: &Path,
        on_event: impl Fn(Event) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let stream = UnixStream::connect(socket)
            .await
            .map_err(|e| format!("pty-host connect failed: {e}"))?;
        let (mut read_half, mut write_half) = stream.into_split();

        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        tokio::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                if write_half.write_all(&bytes).await.is_err() {
                    break;
                }
            }
        });

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Response>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        let pending_reader = pending.clone();
        let alive_reader = alive.clone();
        let reader = tokio::spawn(async move {
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 16 * 1024];
            'conn: loop {
                match read_half.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        loop {
                            match parse_frame(&buf) {
                                Frame::Incomplete => break,
                                Frame::Invalid(_) => break 'conn,
                                Frame::Message { body, consumed } => {
                                    buf.drain(..consumed);
                                    let Ok(frame) = serde_json::from_slice::<HostFrame>(&body)
                                    else {
                                        continue;
                                    };
                                    match frame {
                                        HostFrame::Reply { id, resp } => {
                                            let waiter = pending_reader
                                                .lock()
                                                .unwrap_or_else(|p| p.into_inner())
                                                .remove(&id);
                                            if let Some(w) = waiter {
                                                let _ = w.send(resp);
                                            }
                                        }
                                        HostFrame::Event { ev } => on_event(ev),
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // 호스트가 죽었다(또는 프로토콜 위반). 대기 중인 요청을 전부 깨워
            // 실패시킨다 — oneshot 송신자 drop 으로 수신측이 Err 를 받는다.
            alive_reader.store(false, Ordering::SeqCst);
            pending_reader
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clear();
        });

        let client = Self {
            tx,
            pending,
            next_id: AtomicU64::new(1),
            alive,
            reader,
        };

        // 프로토콜 확인 — [`socket_name`] 이 버전마다 자리를 갈라 놓으므로
        // 여기서 불일치를 보는 일은 없어야 한다. 그래도 보게 된다면 이 자리에
        // 있는 것은 **우리 짝이 아니다** — 접속만 놓고 물러난다. 내리지
        // 않는다: 남의 호스트를 내리는 것은 남의 셸을 죽이는 것이다.
        match client.request(Request::Hello).await? {
            Response::Proto { proto } if proto == PROTO_VERSION => Ok(client),
            Response::Proto { proto } => Err(format!(
                "pty-host protocol mismatch: host={proto} app={PROTO_VERSION}"
            )),
            other => Err(format!("unexpected hello response: {other:?}")),
        }
    }

    pub async fn request(&self, req: Request) -> Result<Response, String> {
        if !self.is_alive() {
            return Err("pty-host connection lost".to_string());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(id, reply_tx);

        let json = serde_json::to_string(&ClientFrame { id, req })
            .map_err(|e| format!("failed to encode a request: {e}"))?;
        if self.tx.send(encode_frame(&json)).is_err() {
            self.pending
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&id);
            return Err("pty-host connection lost".to_string());
        }
        match tokio::time::timeout(
            std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
            reply_rx,
        )
        .await
        {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err("pty-host connection lost".to_string()),
            Err(_) => {
                // 먹통 호스트 — 이 접속을 죽은 것으로 표시해 다음 호출이
                // 재접속(필요 시 재스폰)하게 한다.
                self.alive.store(false, Ordering::SeqCst);
                self.pending
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .remove(&id);
                Err("pty-host request timed out".to_string())
            }
        }
    }
}

/// 디버그 빌드의 접미사 — dev 로 띄운 앱과 설치본은 **다른 소켓**을 쓴다.
#[cfg(debug_assertions)]
const BUILD_SUFFIX: &str = "-dev";
#[cfg(not(debug_assertions))]
const BUILD_SUFFIX: &str = "";

/// 소켓 이름 — `ptyhost-v{PROTO_VERSION}[-dev].sock`.
///
/// **이름이 격리다** (2026-09-02). 프로토콜이 다르거나 빌드 종류가 다른 두
/// 짝은 애초에 같은 자리에서 만나지 않는다. 앞서 dev 빌드를 설치본의 내장
/// 터미널에서 띄웠을 때, 두 짝이 같은 `ptyhost.sock` 에서 만나 불일치를 보고
/// 서로의 호스트를 내렸고 — 그 호스트가 쥐고 있던 셸이 곧 자기를 띄운 그
/// 터미널이었다. 버전을 올리는 것만으로 자리가 갈리므로 그 경로는 이제
/// 발화하지 않는다.
///
/// 갈라진 뒤 구버전 호스트는 아무도 붙지 않는 채 남는데, 그건 호스트가
/// 스스로 정리한다 — 더 높은 프로토콜의 소켓이 생긴 것을 보면 몇 분 안에
/// 세션을 끝내고 내려간다 (`host::superseded_by_a_newer_socket`). 남의
/// 호스트를 내리는 대신 **자기 수명을 아는 호스트**로 푼 것이다.
pub fn socket_name() -> String {
    format!("ptyhost-v{PROTO_VERSION}{BUILD_SUFFIX}.sock")
}

/// 소켓 위치 — 앱 데이터 디렉터리 아래 고정 (`logs/`·`shell-integration/` 과
/// 같은 곳). 호스트의 로그 디렉터리도 여기서 파생된다.
pub fn socket_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(socket_name())
}

/// 소켓에 버전이 붙기 전(v2.33 까지)의 고정 이름.
const LEGACY_SOCKET: &str = "ptyhost.sock";

/// 업데이트가 남긴 **옛 이름의 호스트**를 걷어낸다 (2026-09-02).
///
/// 이름이 갈리기 전에 뜬 호스트에는 이 버전부터 아무도 붙지 않는다
/// ([`socket_name`]). 그런데 그 호스트는 **자기 수명을 아는 코드가 없는**
/// 옛 빌드라, 세션을 쥔 채 로그인 세션이 끝날 때까지 남는다 — 아무도 보지
/// 않는 셸이 영영 도는 것이다. 사용자에게 `pkill` 을 시킬 수는 없으므로 앱이
/// 시작할 때 한 번 대신 걷는다.
///
/// **릴리스 빌드만** 한다. dev 빌드가 이 자리를 건드리게 두면, 설치본의 내장
/// 터미널에서 dev 를 띄우는 순간 자기를 띄운 셸을 죽인다 — 이름 격리로 없앤
/// 바로 그 사고를 한 줄로 되살리는 셈이다. 그리고 **옛 이름 하나만** 본다:
/// 버전이 붙은 자리는 임자가 있는 자리다.
///
// oculpm-defer: v2.33 이하에서 올라오는 경로 전용 이행 코드다; 옛 버전에서
// 직접 올라오는 사용자가 사실상 없어지면(대략 v2.40 이후) 지운다.
pub async fn sweep_legacy_host(app_data_dir: &Path) {
    if cfg!(debug_assertions) {
        return;
    }
    let socket = app_data_dir.join(LEGACY_SOCKET);
    if !socket.exists() {
        return;
    }
    if shutdown_host_at(&socket).await {
        tracing::info!(target: "terminal", socket = %socket.display(), "swept a pre-versioned pty-host");
    }
}

/// 이 소켓의 호스트에게 내려가 달라고 하고, 응답(또는 2초)을 기다린다.
/// 붙는 이가 없으면 소켓 파일만 걷는다. 반환값은 "살아 있는 호스트였나".
///
/// [`PtyHostClient::connect`] 를 쓰지 않는 이유: 그쪽은 프로토콜이 다르면
/// 물러난다. 여기서 상대는 정의상 **옛 프로토콜**이고, 우리는 대화가 아니라
/// 한 마디만 보내면 된다.
pub async fn shutdown_host_at(socket: &Path) -> bool {
    let Ok(mut stream) = UnixStream::connect(socket).await else {
        // 시체 파일 — 붙는 이가 없다.
        let _ = std::fs::remove_file(socket);
        return false;
    };
    let Ok(json) = serde_json::to_string(&ClientFrame {
        id: 1,
        req: Request::Shutdown,
    }) else {
        return false;
    };
    if stream.write_all(&encode_frame(&json)).await.is_err() {
        return false;
    }
    // 응답을 읽는 것은 확인용이다 — 옛 호스트는 자리를 비우고(소켓 파일 삭제)
    // 종료 유예 뒤 스스로 내려간다. 먹통이면 2초에 놓아 준다.
    let mut buf = [0u8; 256];
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf)).await;
    true
}

/// 호스트를 detach 로 띄운다 — 앱이 죽어도(업데이트 재시작) 함께 죽지 않게
/// 프로세스 그룹을 분리하고 stdio 를 끊는다. 시체 수거(wait)는 전용 스레드로.
pub fn spawn_host_process(socket: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--pty-host")
        .arg(socket)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // 새 프로세스 그룹 — 개발 중 터미널의 Ctrl+C(SIGINT to pgrp)가 호스트까지
        // 죽이지 않게. 앱 종료 자체는 자식에게 아무 신호도 보내지 않는다.
        cmd.process_group(0);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn the pty-host: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// 접속하되, 없으면 (요청 시) 띄우고 재시도한다.
pub async fn connect_or_spawn(
    socket: &Path,
    spawn_if_missing: bool,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
) -> Result<Option<PtyHostClient>, String> {
    if let Ok(c) = PtyHostClient::connect(socket, on_event.clone()).await {
        return Ok(Some(c));
    }
    if !spawn_if_missing {
        return Ok(None);
    }
    spawn_host_process(socket)?;
    let mut last = String::new();
    for _ in 0..CONNECT_RETRIES {
        tokio::time::sleep(std::time::Duration::from_millis(CONNECT_RETRY_MS)).await;
        match PtyHostClient::connect(socket, on_event.clone()).await {
            Ok(c) => return Ok(Some(c)),
            // 마지막 이유를 들고 나간다 — 프로토콜 불일치처럼 재시도로 풀리지
            // 않는 사정을 "시간 안에 안 떴다" 로 덮으면 진단이 사라진다.
            Err(e) => last = e,
        }
    }
    Err(format!("pty-host did not come up in time: {last}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 이름이 격리다 — 프로토콜을 올리면 자리가 갈려야 구·신 짝이 만나지 않는다.
    #[test]
    fn socket_name_carries_the_protocol_version() {
        let name = socket_name();
        assert!(
            name.starts_with(&format!("ptyhost-v{PROTO_VERSION}")),
            "{name}"
        );
        assert!(name.ends_with(".sock"), "{name}");
    }

    /// 테스트는 늘 디버그 빌드다 — 여기서 접미사가 빠지면 dev 로 띄운 앱이
    /// 설치본의 호스트 자리에 그대로 앉는다 (자기 셸을 죽인 사고의 조건).
    #[test]
    fn debug_builds_get_their_own_socket() {
        let name = socket_name();
        assert!(name.ends_with("-dev.sock"), "{name}");
    }
}

//! PTY 호스트의 앱 쪽 클라이언트 (#pty-host).
//!
//! 접속 하나로 요청/응답(id 짝짓기)과 자발 이벤트를 같이 받는다 — LSP
//! 클라이언트와 같은 모양새다. 이벤트는 콜백으로 올린다 (terminal.rs 가
//! tauri 이벤트로 재방출).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
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
    /// 붙어 있는 호스트가 말하는 프로토콜 번호 — 우리 것과 다를 수 있다.
    host_proto: AtomicU32,
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

    /// 이 호스트가 말하는 프로토콜 번호. 우리 것보다 **낮을 수 있다** —
    /// 업데이트를 건너온 호스트가 그렇다. 뜻이 달라진 자리는 부르는 쪽이
    /// 이 번호를 보고 맞춘다 (`commands::terminal::pty_foreground_command`).
    pub fn host_proto(&self) -> u32 {
        self.host_proto.load(Ordering::SeqCst)
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
            host_proto: AtomicU32::new(PROTO_VERSION),
            reader,
        };

        // 프로토콜 확인 — 여기서 **물러나지 않는다** (2026-09-03).
        //
        // 업데이트 직후에는 옛 호스트가 세션을 쥔 채 살아 있고, 새 앱이 거기
        // 그대로 붙는 것이 이 기능의 전부다. 번호가 다르다고 등을 돌리면 그
        // 세션은 끊긴다 — 실제로 v2.34.0 이 그렇게 끊었다. 그래서 번호는
        // **기억만** 하고, 뜻이 달라진 자리는 부르는 쪽이 맞춘다.
        //
        // 거절하는 경우는 하나다: 답이 `Proto` 가 아니면 이 자리에 있는 것은
        // 우리 호스트가 아니다. 그때도 내리지는 않는다 — 남의 호스트를
        // 내리는 것은 남의 셸을 죽이는 것이다.
        match client.request(Request::Hello).await? {
            Response::Proto { proto } => {
                client.host_proto.store(proto, Ordering::SeqCst);
                if proto != PROTO_VERSION {
                    tracing::info!(
                        target: "terminal",
                        host = proto,
                        app = PROTO_VERSION,
                        "옛 PTY 호스트를 이어받는다 — 번호 차이는 앱이 맞춘다"
                    );
                }
                Ok(client)
            }
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

/// 호스트의 **정식 자리** — `ptyhost[-dev].sock`.
///
/// **이름에 프로토콜을 담지 않는다** (2026-09-03). 담아 봤다가 이 기능의 존재
/// 이유를 잃었다: v2.34.0 이 프로토콜을 1→2 로 올리며 자리를
/// `ptyhost-v2.sock` 으로 옮기자, 업데이트한 앱이 **옛 자리를 쳐다보지 않게**
/// 되어 그 안에서 돌던 세션이 통째로 끊겼다. 호스트가 앱보다 오래 사는 이유는
/// 하나뿐인데(업데이트를 건너기 위해서), 업데이트마다 만나는 자리를 바꾸면 그
/// 하나를 스스로 취소하는 셈이다.
///
/// 그래서 자리는 고정이고, 번호 차이는 [`PtyHostClient::host_proto`] 로
/// **협상**한다 — 옛 호스트를 만나면 앱이 옛 뜻에 맞춰 준다.
///
/// `-dev` 접미사는 남는다. 그건 프로토콜이 아니라 **빌드 종류**의 격리고, 설치본의
/// 내장 터미널에서 dev 를 띄웠을 때 두 짝이 같은 자리에서 만나 서로의 호스트를
/// 내리고 자기 셸을 죽인 사고(2026-09-02)를 막는 자리다.
pub fn socket_name() -> String {
    format!("ptyhost{BUILD_SUFFIX}.sock")
}

/// 정식 자리 — 새로 띄울 때는 언제나 여기다.
pub fn socket_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(socket_name())
}

/// 옛 판이 쓰던 자리들 (최신 순).
///
/// v2.34.x 만 프로토콜을 이름에 달았다. 그 판에서 올라오는 사용자의 호스트는
/// 아직 거기 살아 세션을 쥐고 있으므로, 정식 자리가 비어 있으면 여기를 차례로
/// 두드려 **그 호스트를 그대로 이어받는다.** 내리지 않는다 — 세션을 쥔 호스트를
/// 내리는 것이 애초에 사용자가 잃은 것이었다.
///
// oculpm-defer: v2.34.x 에서 직접 올라오는 경로 전용이다; 그 판에서 올라오는
// 사용자가 사실상 없어지면 지운다.
const LEGACY_SOCKET_NAMES: &[&str] = &["ptyhost-v2"];

/// 붙어 볼 자리들 — 정식 자리가 먼저, 그다음이 옛 자리.
///
/// 빌드 격리는 옛 자리에도 그대로 붙인다 — dev 가 설치본의 옛 호스트를
/// 이어받아 버리면 이름 격리가 무의미해진다.
pub fn socket_candidates(app_data_dir: &Path) -> Vec<PathBuf> {
    let mut paths = vec![socket_path(app_data_dir)];
    paths.extend(
        LEGACY_SOCKET_NAMES
            .iter()
            .map(|stem| app_data_dir.join(format!("{stem}{BUILD_SUFFIX}.sock"))),
    );
    paths
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

/// 살아 있는 호스트에 붙는다 — **정식 자리부터 옛 자리까지** 차례로. 아무도
/// 없으면 (요청 시) 정식 자리에 띄우고 재시도한다.
///
/// 옛 자리까지 두드리는 이유가 이 함수의 전부다: 업데이트를 건너온 호스트는
/// 옛 이름 아래 세션을 쥔 채 살아 있고, 그걸 못 찾으면 새 셸이 뜬다 — 사용자
/// 눈에는 "업데이트가 터미널을 죽였다" 다.
pub async fn connect_or_spawn(
    candidates: &[PathBuf],
    spawn_if_missing: bool,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
) -> Result<Option<PtyHostClient>, String> {
    for (i, socket) in candidates.iter().enumerate() {
        if let Ok(c) = PtyHostClient::connect(socket, on_event.clone()).await {
            if i > 0 {
                tracing::info!(
                    target: "terminal",
                    socket = %socket.display(),
                    "옛 자리의 PTY 호스트를 이어받았다"
                );
            }
            return Ok(Some(c));
        }
    }
    if !spawn_if_missing {
        return Ok(None);
    }
    let socket = candidates
        .first()
        .ok_or_else(|| "no pty-host socket candidates".to_string())?;
    spawn_host_process(socket)?;
    let mut last = String::new();
    for _ in 0..CONNECT_RETRIES {
        tokio::time::sleep(std::time::Duration::from_millis(CONNECT_RETRY_MS)).await;
        match PtyHostClient::connect(socket, on_event.clone()).await {
            Ok(c) => return Ok(Some(c)),
            // 마지막 이유를 들고 나간다 — 재시도로 풀리지 않는 사정을
            // "시간 안에 안 떴다" 로 덮으면 진단이 사라진다.
            Err(e) => last = e,
        }
    }
    Err(format!("pty-host did not come up in time: {last}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **자리는 고정이다.** 프로토콜을 올린다고 이름을 옮기면 그 순간
    /// 업데이트가 세션을 끊는다 (v2.34.0 이 그렇게 끊었다).
    #[test]
    fn the_socket_name_does_not_carry_the_protocol() {
        let name = socket_name();
        assert!(name.starts_with("ptyhost"), "{name}");
        assert!(name.ends_with(".sock"), "{name}");
        assert!(
            !name.contains(&format!("v{PROTO_VERSION}")),
            "프로토콜이 이름에 새면 다음 업데이트가 또 세션을 끊는다: {name}"
        );
    }

    /// 테스트는 늘 디버그 빌드다 — 여기서 접미사가 빠지면 dev 로 띄운 앱이
    /// 설치본의 호스트 자리에 그대로 앉는다 (자기 셸을 죽인 사고의 조건).
    /// 옛 자리에도 같은 격리가 붙어야 한다.
    #[test]
    fn debug_builds_get_their_own_socket() {
        assert!(socket_name().ends_with("-dev.sock"), "{}", socket_name());
        for path in socket_candidates(Path::new("/tmp/oculpm-test")) {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            assert!(name.ends_with("-dev.sock"), "{name}");
        }
    }

    /// 정식 자리가 먼저, 옛 자리가 뒤 — 새로 띄우는 것은 언제나 정식 자리다.
    #[test]
    fn candidates_lead_with_the_canonical_socket_then_the_old_ones() {
        let dir = Path::new("/tmp/oculpm-test");
        let paths = socket_candidates(dir);
        assert_eq!(paths[0], socket_path(dir));
        assert!(
            paths.len() > 1,
            "v2.34.x 의 자리를 두드리지 않으면 그 판에서 올라온 세션이 끊긴다"
        );
        assert!(
            paths[1].to_string_lossy().contains("ptyhost-v2"),
            "{paths:?}"
        );
    }
}

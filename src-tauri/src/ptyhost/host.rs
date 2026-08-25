//! PTY 호스트 프로세스 본체 (#pty-host).
//!
//! 같은 실행파일이 `--pty-host <socket>` 으로 뜨는 **GUI 없는 모드**다. PTY
//! 세션·스크롤백·nonce 를 여기가 소유하므로, 앱이 업데이트로 재시작해도 셸
//! (Claude Code 등)은 끊기지 않는다 — 앱은 Unix 소켓으로 다시 붙어 attach 만
//! 하면 된다.
//!
//! 원칙:
//! - 세션 로직은 terminal.rs 에 있던 것을 **그대로 옮겼다** (SessionBuf ·
//!   drain_utf8 · 멱등 start · EOF 정리). 배관만 tauri 이벤트 → broadcast 로.
//! - 요청은 접속별 읽기 루프에서 **순서대로** 처리한다 — 키 입력(Write)의
//!   순서가 곧 계약이다.
//! - 유휴(클라이언트 0 · 세션 0)가 이어지면 스스로 내린다 — 데몬을 영구
//!   상주시키지 않는다 (필요할 때 앱이 다시 띄운다).

use std::collections::{HashMap, VecDeque};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc};

use super::protocol::{
    AttachPayload, ClientFrame, Event, HostFrame, Request, Response, PROTO_VERSION,
};
use crate::framing::{encode_frame, parse_frame, Frame};

/// 재접속 리플레이용 스크롤백 상한 (bytes, 청크 단위로 앞에서 버림).
const SCROLLBACK_CAP_BYTES: usize = 200_000;

/// 유휴 판정 주기. 두 번 연속 (클라이언트 0 · 세션 0) 이면 내린다 —
/// 스폰 직후 클라이언트가 붙기 전의 찰나를 오판하지 않기 위한 2회.
const IDLE_TICK_SECS: u64 = 60;

/// 이벤트 broadcast 버퍼. 소비가 느린 클라이언트는 lag 로 이벤트를 잃지만,
/// 프런트는 attach 리플레이 + seq 중복 제거가 있어 스스로 복구한다.
const EVENT_CHANNEL_CAP: usize = 4096;

#[derive(Default)]
pub struct SessionBuf {
    chunks: VecDeque<String>,
    bytes: usize,
    seq: u32,
}

impl SessionBuf {
    fn push(&mut self, text: &str) -> u32 {
        self.seq += 1;
        self.bytes += text.len();
        self.chunks.push_back(text.to_string());
        while self.bytes > SCROLLBACK_CAP_BYTES {
            match self.chunks.pop_front() {
                Some(front) => self.bytes -= front.len(),
                None => break,
            }
        }
        self.seq
    }

    fn snapshot(&self) -> (String, u32) {
        (self.chunks.iter().map(String::as_str).collect(), self.seq)
    }
}

struct HostSession {
    writer: Box<dyn std::io::Write + Send>,
    master: Box<dyn MasterPty + Send>,
    buf: Arc<Mutex<SessionBuf>>,
    nonce: String,
    shell_integration: bool,
}

pub struct HostState {
    sessions: Mutex<HashMap<String, HostSession>>,
    events: broadcast::Sender<Event>,
    clients: AtomicUsize,
    log_dir: Option<PathBuf>,
}

/// 이 세션이 살려 둘 접두사에 속하는가 (`KillExcept` 의 판정).
/// 접두사에 `-` 가 붙어 있어야 `p1-` 이 `p12-…` 를 함께 살리지 않는다.
fn is_protected(sid: &str, keep: &[String]) -> bool {
    keep.iter().any(|p| sid.starts_with(p))
}

/// `pending` 에서 디코딩 가능한 최장 prefix 를 뽑아 반환하고, 청크 경계에
/// 걸린 미완성 UTF-8 시퀀스(≤3바이트)는 `pending` 에 남겨 다음 read 로
/// 이월한다. 진짜 잘못된 바이트는 U+FFFD 로 치환하고 계속 진행한다.
pub fn drain_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                return out;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                // valid_up_to 까지는 항상 유효 — unwrap 안전.
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap());
                match e.error_len() {
                    Some(len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + len);
                    }
                    None => {
                        // 미완성 tail — 이월하고 여기서 멈춘다.
                        pending.drain(..valid);
                        return out;
                    }
                }
            }
        }
    }
}

/// 호스트 로그 — detach 프로세스라 stderr 가 버려지므로 파일에 직접 남긴다.
/// 로깅 실패는 조용히 삼킨다 (로그 때문에 세션이 죽으면 본말전도).
fn log_line(state: &HostState, msg: &str) {
    let Some(dir) = &state.log_dir else { return };
    let _ = std::fs::create_dir_all(dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("ptyhost.log"))
    {
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}

impl HostState {
    pub fn new(log_dir: Option<PathBuf>) -> Arc<Self> {
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAP);
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            events,
            clients: AtomicUsize::new(0),
            log_dir,
        })
    }

    fn lock_sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, HostSession>> {
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// 세션 하나를 실제로 띄운다 — terminal.rs 의 start 경로 이식.
#[allow(clippy::too_many_arguments)]
fn start_session(
    state: &Arc<HostState>,
    sid: String,
    cwd: String,
    rows: u16,
    cols: u16,
    shell: String,
    env: Vec<(String, String)>,
    nonce: String,
    shell_integration: bool,
) -> Result<Response, String> {
    // 이미 살아있는 세션이면 그대로 재사용 (attach 경로와의 경합 방어).
    // nonce 는 세션에 고정된 값 — 새로 받은 것 말고 기존 것을 돌려준다.
    if let Some(existing) = state.lock_sessions().get(&sid) {
        return Ok(Response::Session {
            nonce: existing.nonce.clone(),
            shell_integration: existing.shell_integration,
        });
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    for (k, v) in &env {
        cmd.env(k, v);
    }
    if !cwd.is_empty() {
        cmd.cwd(cwd);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let buf = Arc::new(Mutex::new(SessionBuf::default()));
    let session = HostSession {
        writer,
        master: pair.master,
        buf: buf.clone(),
        nonce: nonce.clone(),
        shell_integration,
    };

    {
        let mut sessions = state.lock_sessions();
        if let Some(winner) = sessions.get(&sid) {
            // 동시 start 경합에서 진 쪽 — 방금 띄운 pair/child 는 여기서 drop
            // 되며 정리된다. 반환하는 nonce 도 승자의 것이어야 한다.
            return Ok(Response::Session {
                nonce: winner.nonce.clone(),
                shell_integration: winner.shell_integration,
            });
        }
        sessions.insert(sid.clone(), session);
    }
    log_line(state, &format!("session started: {sid}"));

    // 읽기 루프 — blocking read 를 전용 스레드로.
    let st = state.clone();
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut local_buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut local_buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    pending.extend_from_slice(&local_buf[..n]);
                    let text = drain_utf8(&mut pending);
                    if text.is_empty() {
                        continue;
                    }
                    let seq = buf.lock().unwrap_or_else(|p| p.into_inner()).push(&text);
                    let _ = st.events.send(Event::Data { sid: sid.clone(), seq, text });
                }
                Err(_) => break,
            }
        }
        // EOF 시점에 이월분이 남아있으면 (비정상 스트림) lossy 로 마감.
        if !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).into_owned();
            let seq = buf.lock().unwrap_or_else(|p| p.into_inner()).push(&text);
            let _ = st.events.send(Event::Data { sid: sid.clone(), seq, text });
        }
        // 셸이 스스로 종료(exit)한 세션은 맵에서 걷어낸다 — 다음 attach 가
        // None 을 받아 새 셸을 시작하게.
        st.lock_sessions().remove(&sid);
        log_line(&st, &format!("session exited: {sid}"));
        let _ = st.events.send(Event::Exit { sid });
    });

    Ok(Response::Session { nonce, shell_integration })
}

fn handle_request(state: &Arc<HostState>, req: Request) -> Response {
    match req {
        Request::Hello => Response::Proto { proto: PROTO_VERSION },
        Request::Start { sid, cwd, rows, cols, shell, env, nonce, shell_integration } => {
            match start_session(state, sid, cwd, rows, cols, shell, env, nonce, shell_integration)
            {
                Ok(resp) => resp,
                Err(message) => Response::Error { message },
            }
        }
        Request::Attach { sid } => {
            let sessions = state.lock_sessions();
            Response::Attach {
                attach: sessions.get(&sid).map(|s| {
                    let (text, seq) =
                        s.buf.lock().unwrap_or_else(|p| p.into_inner()).snapshot();
                    AttachPayload {
                        text,
                        seq,
                        nonce: s.nonce.clone(),
                        shell_integration: s.shell_integration,
                    }
                }),
            }
        }
        Request::Write { sid, data } => {
            let mut sessions = state.lock_sessions();
            let Some(session) = sessions.get_mut(&sid) else {
                // "조용한 성공" 금지 — 호출측(디스패치 프리필)이 재시도를 판단한다.
                return Response::Error { message: format!("unknown pty session: {sid}") };
            };
            if let Err(e) = session.writer.write_all(data.as_bytes()) {
                return Response::Error { message: format!("Failed to write to PTY: {e}") };
            }
            if let Err(e) = session.writer.flush() {
                return Response::Error { message: format!("Failed to flush PTY: {e}") };
            }
            Response::Ok
        }
        Request::Resize { sid, rows, cols } => {
            let mut sessions = state.lock_sessions();
            if let Some(session) = sessions.get_mut(&sid) {
                if let Err(e) = session
                    .master
                    .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                {
                    return Response::Error { message: format!("Failed to resize PTY: {e}") };
                }
            }
            Response::Ok
        }
        Request::Kill { sid } => {
            // HostSession drop → master 닫힘 → 자식에 SIGHUP.
            state.lock_sessions().remove(&sid);
            Response::Ok
        }
        Request::KillPrefix { prefix } => {
            let mut sessions = state.lock_sessions();
            let doomed: Vec<String> =
                sessions.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
            for key in &doomed {
                sessions.remove(key);
            }
            Response::Count { n: doomed.len() as u32 }
        }
        Request::KillExcept { keep } => {
            let mut sessions = state.lock_sessions();
            let doomed: Vec<String> =
                sessions.keys().filter(|k| !is_protected(k, &keep)).cloned().collect();
            for key in &doomed {
                sessions.remove(key);
            }
            Response::Count { n: doomed.len() as u32 }
        }
        Request::Foreground { sid } => {
            // 락은 pid 를 꺼낼 때까지만 — `ps` 는 세션 맵과 무관하다.
            let leader = {
                let sessions = state.lock_sessions();
                let Some(session) = sessions.get(&sid) else {
                    return Response::Error { message: format!("unknown pty session: {sid}") };
                };
                process_group_leader_of(session)
            };
            Response::Foreground { command: leader.and_then(command_line_of) }
        }
        Request::Shutdown => {
            log_line(state, "shutdown requested");
            state.lock_sessions().clear();
            // 응답을 쓸 시간을 주고 내린다.
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                std::process::exit(0);
            });
            Response::Ok
        }
    }
}

#[cfg(unix)]
fn process_group_leader_of(session: &HostSession) -> Option<i32> {
    session.master.process_group_leader()
}

#[cfg(not(unix))]
fn process_group_leader_of(_session: &HostSession) -> Option<i32> {
    None
}

/// pid → 명령줄. 의존성을 늘리지 않으려고 `ps` 를 쓴다. 실패는 전부 `None`.
#[cfg(unix)]
fn command_line_of(pid: i32) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-o", "args=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

#[cfg(not(unix))]
fn command_line_of(_pid: i32) -> Option<String> {
    None
}

/// 접속 하나를 끝까지 상대한다 — 요청은 순서대로, 이벤트는 broadcast 구독으로.
async fn serve_connection(state: Arc<HostState>, stream: UnixStream) {
    state.clients.fetch_add(1, Ordering::SeqCst);
    let (mut read_half, mut write_half) = stream.into_split();

    // 응답과 이벤트가 같은 소켓을 쓰므로 쓰기는 한 태스크로 직렬화한다.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer_task = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if write_half.write_all(&bytes).await.is_err() {
                break;
            }
        }
    });

    // 이벤트 중계 — lag 로 놓친 이벤트는 프런트의 attach 리플레이가 흡수한다.
    let mut events = state.events.subscribe();
    let ev_tx = out_tx.clone();
    let event_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(ev) => {
                    let Ok(json) = serde_json::to_string(&HostFrame::Event { ev }) else {
                        continue;
                    };
                    if ev_tx.send(encode_frame(&json)).is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // 읽기 루프 — 완성된 프레임 단위로 순서대로 처리.
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
                        Frame::Invalid(why) => {
                            log_line(&state, &format!("protocol violation: {why}"));
                            break 'conn;
                        }
                        Frame::Message { body, consumed } => {
                            buf.drain(..consumed);
                            let Ok(frame) = serde_json::from_slice::<ClientFrame>(&body) else {
                                log_line(&state, "unparseable client frame");
                                break 'conn;
                            };
                            let resp = handle_request(&state, frame.req);
                            let Ok(json) =
                                serde_json::to_string(&HostFrame::Reply { id: frame.id, resp })
                            else {
                                continue;
                            };
                            if out_tx.send(encode_frame(&json)).is_err() {
                                break 'conn;
                            }
                        }
                    }
                }
            }
        }
    }

    event_task.abort();
    drop(out_tx);
    let _ = writer_task.await;
    state.clients.fetch_sub(1, Ordering::SeqCst);
}

/// 소켓을 점유하고 접속을 받는다 — 테스트가 임시 경로로 직접 부른다.
///
/// bind 경합: 이미 살아있는 호스트가 있으면 **조용히 물러난다** (먼저 뜬 쪽이
/// 승자). 소켓 파일만 남은 시체(host 크래시)는 걷어내고 다시 bind 한다.
pub async fn serve(state: Arc<HostState>, socket: &Path) -> Result<(), String> {
    let listener = match UnixListener::bind(socket) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            if std::os::unix::net::UnixStream::connect(socket).is_ok() {
                // 살아있는 호스트가 이미 있다 — 우리는 필요 없다.
                return Ok(());
            }
            std::fs::remove_file(socket)
                .map_err(|e| format!("failed to remove a stale socket: {e}"))?;
            UnixListener::bind(socket).map_err(|e| format!("failed to bind: {e}"))?
        }
        Err(e) => return Err(format!("failed to bind: {e}")),
    };
    // 같은 사용자만 — 소켓으로 임의 셸을 띄울 수 있으므로 남에게 열지 않는다.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600));
    }
    log_line(&state, &format!("listening on {}", socket.display()));

    // 유휴 감시 — 두 번 연속 비어 있으면 내린다.
    let idle_state = state.clone();
    tokio::spawn(async move {
        let mut empty_ticks = 0u32;
        let mut tick =
            tokio::time::interval(std::time::Duration::from_secs(IDLE_TICK_SECS));
        tick.tick().await; // 첫 tick 은 즉시 — 건너뛴다.
        loop {
            tick.tick().await;
            let idle = idle_state.clients.load(Ordering::SeqCst) == 0
                && idle_state.lock_sessions().is_empty();
            empty_ticks = if idle { empty_ticks + 1 } else { 0 };
            if empty_ticks >= 2 {
                log_line(&idle_state, "idle — exiting");
                std::process::exit(0);
            }
        }
    });

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(serve_connection(state.clone(), stream));
            }
            Err(e) => {
                log_line(&state, &format!("accept failed: {e}"));
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}

/// `--pty-host` 모드의 진입점 — main 이 GUI 대신 이것을 부른다.
pub fn run_host(socket: PathBuf) -> ! {
    let log_dir = socket.parent().map(|p| p.join("logs"));
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build the pty-host runtime");
    let state = HostState::new(log_dir);
    let result = rt.block_on(serve(state, &socket));
    if let Err(e) = result {
        eprintln!("oculpm pty-host: {e}");
        std::process::exit(1);
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// 링버퍼 — 상한 초과 시 앞 청크부터 버리고 seq 는 단조 증가.
    #[test]
    fn session_buf_caps_and_sequences() {
        let mut buf = SessionBuf::default();
        let big = "x".repeat(SCROLLBACK_CAP_BYTES / 2 + 1);
        assert_eq!(buf.push(&big), 1);
        assert_eq!(buf.push(&big), 2);
        assert_eq!(buf.push("tail"), 3); // 첫 big 이 밀려난다
        let (text, seq) = buf.snapshot();
        assert_eq!(seq, 3);
        assert!(text.ends_with("tail"));
        assert!(text.len() <= SCROLLBACK_CAP_BYTES + 4);
        assert_eq!(text.matches('x').count(), big.len());
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
}

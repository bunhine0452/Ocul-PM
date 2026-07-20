use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{Emitter, State};

// 터미널 개편 (2026-07-20):
//  - PTY 출력을 청크별 `from_utf8_lossy` 로 디코딩하던 것을 스트리밍 디코드로
//    교체. 한글(3B)·박스문자(3B)·이모지(4B)가 read(2) 청크 경계에 걸리면
//    U+FFFD 로 깨지던 버그 수정 — `drain_utf8` 이 미완성 시퀀스를 다음 read
//    로 이월한다.
//  - 세션별 스크롤백 링버퍼 + 단조 seq. 화면을 떠나도 PTY 가 살아있고
//    (`kill` 은 탭 닫기에서만), 재마운트 시 `attach_pty_session` 스냅샷을
//    리플레이한 뒤 seq 로 중복 이벤트를 걸러 이어붙인다.

/// 재접속 리플레이용 스크롤백 상한 (bytes, 청크 단위로 앞에서 버림).
const SCROLLBACK_CAP_BYTES: usize = 200_000;

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

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub buf: Arc<Mutex<SessionBuf>>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

/// `pty-data-{id}` 이벤트 페이로드. `seq` 는 attach 스냅샷과의 중복 제거용.
#[derive(Clone, Serialize)]
pub struct PtyChunk {
    pub seq: u32,
    pub text: String,
}

#[derive(Clone, Serialize, specta::Type)]
pub struct PtyAttach {
    /// 지금까지의 스크롤백 (상한 내). xterm 에 그대로 write 해 리플레이한다.
    pub text: String,
    /// 스냅샷에 포함된 마지막 청크의 seq — 이 값 이하의 라이브 이벤트는 중복.
    pub seq: u32,
}

/// `pending` 에서 디코딩 가능한 최장 prefix 를 뽑아 반환하고, 청크 경계에
/// 걸린 미완성 UTF-8 시퀀스(≤3바이트)는 `pending` 에 남겨 다음 read 로
/// 이월한다. 진짜 잘못된 바이트는 U+FFFD 로 치환하고 계속 진행한다.
fn drain_utf8(pending: &mut Vec<u8>) -> String {
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

#[tauri::command]
#[specta::specta]
pub async fn start_pty_session(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    // 이미 살아있는 세션이면 그대로 재사용 (attach 경로와의 경합 방어).
    if state.sessions.lock().unwrap().contains_key(&session_id) {
        return Ok(());
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    // xterm.js 5.x 는 트루컬러를 지원한다 — CLI 들이 24bit 팔레트를 쓰도록 광고.
    cmd.env("COLORTERM", "truecolor");
    // 한국어 입력 fix (2026-07-16): Finder 로 실행된 .app 은 LANG 이 비어 셸이
    // C 로케일로 뜬다 — zsh ZLE 가 멀티바이트(한글) 입력을 바이트 단위로 다뤄
    // 조합·백스페이스·에코가 깨진다. 기존 값은 존중하고 없을 때만 UTF-8 보장.
    if std::env::var("LANG").map(|v| v.trim().is_empty()).unwrap_or(true) {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if std::env::var("LC_ALL").is_err() && std::env::var("LC_CTYPE").is_err() {
        cmd.env("LC_CTYPE", "UTF-8");
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
    let session = PtySession {
        writer,
        master: pair.master,
        buf: buf.clone(),
    };

    {
        let mut sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&session_id) {
            // 동시 start 경합에서 진 쪽 — 방금 띄운 pair/child 는 여기서 drop
            // 되며 정리된다 (덮어쓰기로 승자 세션을 유령으로 만들지 않는다).
            return Ok(());
        }
        sessions.insert(session_id.clone(), session);
    }

    let session_id_clone = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
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
                        let seq = buf.lock().unwrap().push(&text);
                        let _ = app.emit(
                            &format!("pty-data-{session_id_clone}"),
                            PtyChunk { seq, text },
                        );
                    }
                    Err(_) => break,
                }
            }
            // EOF 시점에 이월분이 남아있으면 (비정상 스트림) lossy 로 마감.
            if !pending.is_empty() {
                let text = String::from_utf8_lossy(&pending).into_owned();
                let seq = buf.lock().unwrap().push(&text);
                let _ = app.emit(
                    &format!("pty-data-{session_id_clone}"),
                    PtyChunk { seq, text },
                );
            }
            // 셸이 스스로 종료(exit)한 세션은 맵에서 걷어낸다 — 다음 마운트의
            // attach 가 죽은 세션 대신 None 을 받아 새 셸을 시작하게.
            {
                use tauri::Manager;
                let st = app.state::<PtyState>();
                st.sessions.lock().unwrap().remove(&session_id_clone);
            }
            let _ = app.emit(&format!("pty-exit-{session_id_clone}"), ());
        })
        .await;
    });

    Ok(())
}

/// 살아있는 세션의 스크롤백 스냅샷을 반환한다 (없으면 None). 화면 재마운트가
/// `start` 대신 이걸 먼저 불러 세션을 이어받는다.
#[tauri::command]
#[specta::specta]
pub fn attach_pty_session(
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<Option<PtyAttach>, String> {
    let sessions = state.sessions.lock().unwrap();
    Ok(sessions.get(&session_id).map(|s| {
        let (text, seq) = s.buf.lock().unwrap().snapshot();
        PtyAttach { text, seq }
    }))
}

#[tauri::command]
#[specta::specta]
pub fn write_to_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn kill_pty_session(
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(_session) = sessions.remove(&session_id) {
        // PtySession dropped here: master will close, sending SIGHUP/SIGKILL to child.
    }
    Ok(())
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

    /// 스크린샷 재현 케이스 — 박스 문자(─ U+2500, 3바이트)가 4096 경계에서
    /// 쪼개져 U+FFFD 두 개로 보이던 것: 이월 디코드에서는 깨지지 않는다.
    #[test]
    fn drain_utf8_carries_split_box_drawing() {
        let line = "─".repeat(3); // 9 bytes
        let bytes = line.as_bytes();
        let mut pending = bytes[..7].to_vec(); // 두 번째 ─ 뒤 + 세 번째 ─ 의 1바이트
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

    /// 진짜 잘못된 바이트는 U+FFFD 로 치환하고, 뒤따르는 유효 텍스트와
    /// 미완성 tail 처리는 계속 동작한다 (교착 없음).
    #[test]
    fn drain_utf8_replaces_invalid_and_continues() {
        let mut pending = vec![b'a', 0xFF, b'b'];
        assert_eq!(drain_utf8(&mut pending), "a\u{FFFD}b");
        assert!(pending.is_empty());

        // invalid + 유효 한글 + 미완성 tail 혼합.
        let mut mixed = vec![0xFF];
        mixed.extend_from_slice("한".as_bytes());
        mixed.extend_from_slice(&"글".as_bytes()[..2]);
        assert_eq!(drain_utf8(&mut mixed), "\u{FFFD}한");
        assert_eq!(mixed.len(), 2);
    }

    /// ASCII 는 그대로 통과.
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
}

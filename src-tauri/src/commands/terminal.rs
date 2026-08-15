use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::oculpm::shell_integration;

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
    /// 이 세션의 OSC 위조 방지 nonce (`OCULPM_NONCE` 로 셸에 심은 값).
    pub nonce: String,
    /// 통합 스크립트를 환경에 실어 보냈다. 사용자가 rc 설치를 안 했으면 셸은
    /// 이 값을 무시하므로 "실제로 켜졌는지"는 첫 OSC 133 수신으로만 알 수 있다.
    pub shell_integration: bool,
}

impl PtySession {
    fn info(&self) -> PtySessionInfo {
        PtySessionInfo {
            nonce: self.nonce.clone(),
            shell_integration: self.shell_integration,
        }
    }
}

/// `start_pty_session` 반환값 — 프런트가 OSC 신호를 검증하는 데 필요한 정보.
#[derive(Clone, Serialize, specta::Type)]
pub struct PtySessionInfo {
    /// 이 값이 실려 있지 않은 OSC 133 페이로드는 신뢰하지 않는다.
    pub nonce: String,
    pub shell_integration: bool,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

/// 이 세션이 살려 둘 접두사에 속하는가 (`kill_except` 의 판정).
///
/// 접두사에 `-` 가 붙어 있어야 `p1-` 이 `p12-…` 를 함께 살리지 않는다 —
/// `window.rs::pty_prefix_for` 가 그 규격을 만든다.
fn is_protected(sid: &str, keep: &[String]) -> bool {
    keep.iter().any(|p| sid.starts_with(p))
}

impl PtyState {
    /// 창 하나가 소유한 세션 전량 종료 (멀티 창 T4). sid 는 프런트가
    /// `p<projectId>-` 접두사와 함께 만들고, 창의 CloseRequested 훅이 이
    /// 접두사로 자기 세션만 골라 죽인다. 반환값은 죽인 개수.
    pub fn kill_with_prefix(&self, prefix: &str) -> usize {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        let doomed: Vec<String> = sessions
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        for key in &doomed {
            // PtySession 이 여기서 drop → master 가 닫히며 자식에 SIGHUP.
            sessions.remove(key);
        }
        doomed.len()
    }

    /// 지정한 접두사들**만 남기고** 전량 종료 (2026-08-15 터미널 도크).
    ///
    /// 마지막 앱 창이 닫힐 때의 총정리에 쓴다. 예전에는 `kill_with_prefix("")`
    /// 로 전부 죽였는데, 터미널을 창으로 떼어낸 뒤(분리 창) 본 창을 닫으면
    /// 그 셸까지 함께 죽었다 — 분리 창은 살아 있는데 안의 셸만 사라지는 셈.
    /// `keep` 이 비어 있으면 예전과 동일하게 전량 종료다.
    pub fn kill_except(&self, keep: &[String]) -> usize {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        let doomed: Vec<String> =
            sessions.keys().filter(|k| !is_protected(k, keep)).cloned().collect();
        for key in &doomed {
            sessions.remove(key);
        }
        doomed.len()
    }
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
    /// 살아있는 세션의 nonce. 재마운트한 화면도 OSC 를 검증할 수 있어야 하므로
    /// start 경로와 동일한 값을 여기서도 돌려준다.
    pub nonce: String,
    pub shell_integration: bool,
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
) -> Result<PtySessionInfo, String> {
    // 이미 살아있는 세션이면 그대로 재사용 (attach 경로와의 경합 방어).
    // nonce 는 세션에 고정된 값이므로 새로 뽑지 말고 기존 것을 돌려준다.
    if let Some(existing) = state.sessions.lock().unwrap().get(&session_id) {
        return Ok(existing.info());
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

    let shell = shell_integration::current_shell();

    let mut cmd = CommandBuilder::new(&shell);
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

    // 셸 통합 (OSC 133/7). 사용자 rc 에 심긴 **비활성 한 줄**이 아래 변수를
    // 보고서야 스크립트를 source 한다 — 설치 전이면 이 env 들은 아무 일도
    // 하지 않는다(설정에서 옵인). 실패는 전부 삼킨다: 통합이 안 켜지는 것보다
    // 터미널이 안 뜨는 쪽이 훨씬 나쁘다.
    let nonce = Uuid::new_v4().simple().to_string();
    let script = materialize_integration_script(&app, &shell);
    cmd.env("OCULPM_TERM", "1");
    cmd.env("OCULPM_NONCE", &nonce);
    if let Some(path) = script.as_deref() {
        cmd.env("OCULPM_SHELL_INTEGRATION", path);
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
        nonce,
        shell_integration: script.is_some(),
    };
    let info = session.info();

    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(winner) = sessions.get(&session_id) {
            // 동시 start 경합에서 진 쪽 — 방금 띄운 pair/child 는 여기서 drop
            // 되며 정리된다 (덮어쓰기로 승자 세션을 유령으로 만들지 않는다).
            // 반환하는 nonce 도 승자의 것이어야 한다. 진 쪽 nonce 를 돌려주면
            // 프런트가 살아있는 셸의 OSC 를 전부 위조로 판정해 버린다.
            return Ok(winner.info());
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
                let st = app.state::<PtyState>();
                st.sessions.lock().unwrap().remove(&session_id_clone);
            }
            let _ = app.emit(&format!("pty-exit-{session_id_clone}"), ());
        })
        .await;
    });

    Ok(info)
}

/// 이 셸용 통합 스크립트를 앱 데이터에 실체화하고 절대경로를 돌려준다.
///
/// 지원하지 않는 셸(fish·nu·pwsh)·앱 데이터 접근 실패·쓰기 실패는 전부 `None`
/// 으로 삼킨다. 셸 통합은 부가 기능이고, 여기서 에러를 올리면 터미널 자체가
/// 안 뜬다.
fn materialize_integration_script(app: &tauri::AppHandle, shell: &str) -> Option<String> {
    let kind = shell_integration::detect_shell_kind(shell);
    let dir = app
        .path()
        .app_data_dir()
        .inspect_err(|e| tracing::warn!("셸 통합: 앱 데이터 경로 조회 실패 — {e}"))
        .ok()?;
    match shell_integration::materialize_script(&dir, kind) {
        Ok(path) => path.map(|p| p.display().to_string()),
        Err(e) => {
            tracing::warn!("셸 통합: 스크립트 생성 실패 — {e}");
            None
        }
    }
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
        PtyAttach {
            text,
            seq,
            nonce: s.nonce.clone(),
            shell_integration: s.shell_integration,
        }
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
    let Some(session) = sessions.get_mut(&session_id) else {
        // 종전엔 미지의 세션도 Ok(()) — "조용한 성공" 때문에 디스패치 프리필이
        // 세션 기동 전에 소비되고 증발했다 (A0d). 호출측이 재시도를 판단할 수
        // 있게 명시적 에러로 (키 입력 경로는 envelope 를 무시하므로 무해).
        return Err(format!("unknown pty session: {session_id}"));
    };
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {e}"))?;
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

    /// 마지막 앱 창을 닫을 때의 총정리에서, 분리 터미널 창의 셸만 살아남는다.
    /// `keep` 이 비면 예전(`kill_with_prefix("")`)과 같이 전량 대상이다.
    #[test]
    fn kill_except_protects_only_the_listed_prefixes() {
        let keep = vec!["p1-".to_string()];
        assert!(is_protected("p1-abc", &keep));
        assert!(!is_protected("p2-abc", &keep));
        // 접두사의 `-` 가 없으면 p1 이 p12 를 잡아먹는다 — 규격이 지켜지는지.
        assert!(!is_protected("p12-abc", &keep));
        // 멀티 창 이전에 저장된 접두사 없는 레거시 sid 도 보호되지 않는다.
        assert!(!is_protected("a1b2c3d4", &keep));
        assert!(!is_protected("p1-abc", &[]));
    }
}

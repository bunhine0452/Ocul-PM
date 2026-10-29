//! 앱 안 터미널 (4.0, 플랜 `terminal-v4-20261029`) — 세션은 **앱 프로세스 안에** 산다.
//!
//! 10-28 에 걷은 3.x 터미널은 앱 밖 PTY 호스트(업데이트를 견디는 세션) · 떼어낸 창 ·
//! 셸 rc 통합까지 6만여 줄이었고 10월 fix 1위였다. 다시 들이며 그 셋을 들이지 않는다:
//! 세션은 창이 닫히면 그 창의 것이, 앱이 끝나면 전부 끝난다. 셸은 사용자의 로그인 셸을
//! 그대로 띄우고(PATH 가 Finder 로 뜬 앱의 최소 PATH 가 아니게), rc 는 건드리지 않는다.
//!
//! 「다음」 을 실행할 때는 프롬프트를 환경 변수(`OCULPM_PROMPT`)로 넘기고 셸에
//! `claude "$OCULPM_PROMPT"` 한 줄을 쳐 넣는다 — 따옴표·줄바꿈을 셸 문법으로 이스케이프할
//! 일이 없고, claude 가 끝나면 셸이 남는다.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::program_status;

/// 프롬프트를 셸에 넘기는 환경 변수.
pub const PROMPT_ENV: &str = "OCULPM_PROMPT";

/// 웹뷰로 가는 세션 사건 — 출력 조각 · 끝 · 프로그램 상태(OSC 7501).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TermEvent {
    Output { data: String },
    Exit { code: Option<u32> },
    Status { status: Option<TermStatus> },
}

/// 세션 안 프로그램(주로 claude)이 스스로 알린 상태 — `program_status` 의 루트 기록.
/// `None` 은 모름(신호를 안 보내는 프로그램 · 셸만 도는 중 · `state=clear`).
#[derive(Debug, Clone, Serialize, specta::Type, PartialEq, Eq)]
pub struct TermStatus {
    /// `idle` · `working` · `done` · `blocked` · `error`
    pub state: String,
    /// blocked 일 때만 — `permission` · `question` · `auth`
    pub kind: Option<String>,
    /// 프로그램이 붙인 한 줄 (「approve Write: …」 · 「answer: Q? (A · B)」).
    pub msg: Option<String>,
    /// 이 상태로 바뀐 시각 (RFC 3339) — 같은 상태가 이어지면 그대로다.
    pub since: String,
}

/// 목록 한 줄.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TermInfo {
    pub id: u32,
    pub project_id: u32,
    /// 셸 이름 또는 `claude` (「다음」 실행).
    pub label: String,
    /// 시작 시각 (RFC 3339).
    pub started_at: String,
    /// 끝났으면 종료 코드 (모르면 `None`, 아직 돌면 `alive`).
    pub alive: bool,
    pub exit_code: Option<u32>,
    /// 세션 안 프로그램의 상태 — 끝난 뒤에도 마지막 값(done · error)이 남는다.
    pub status: Option<TermStatus>,
    /// 셸 위에서 무언가가 돈다 — 닫기 · 끄기 전에 묻고 프로젝트 목록이 센다. 빈 셸은 `false`.
    /// 표에 적어 두지 않고 목록을 줄 때마다 잰다(`Session::snapshot`).
    pub busy: bool,
}

/// 여는 데 필요한 것.
pub struct OpenSpec {
    pub window: String,
    pub project_id: u32,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    /// 있으면 그 프롬프트로 `claude` 를 바로 실행한다.
    pub prompt: Option<String>,
}

struct Session {
    window: String,
    info: TermInfo,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl Session {
    /// 셸 위에서 무언가가 도는가 — 터미널의 포그라운드 프로세스 그룹이 셸이 아니면 그렇다(macOS
    /// 터미널이 닫기 전에 묻는 기준). 빈 셸까지 세면 터미널 탭을 한 번 연 창은 닫을 때마다 물었다.
    /// 그룹을 물을 수 없는 OS 는 상태 신호를 보낸 프로그램(claude)이 있을 때만.
    fn busy(&self) -> bool {
        if !self.info.alive {
            return false;
        }
        #[cfg(unix)]
        if let (Some(fg), Some(shell)) =
            (self.master.process_group_leader(), self.child.process_id())
        {
            return fg as u32 != shell;
        }
        self.info.status.is_some()
    }

    fn snapshot(&self) -> TermInfo {
        TermInfo {
            busy: self.busy(),
            ..self.info.clone()
        }
    }
}

#[derive(Default)]
struct Inner {
    next: u32,
    map: HashMap<u32, Session>,
}

/// 앱 상태 — 모든 창의 세션 표.
#[derive(Default, Clone)]
pub struct TermSessions {
    inner: Arc<Mutex<Inner>>,
    /// 앱을 끄기 전에 물은 때 — 그 뒤 잠깐 안에 다시 끄려 하면 묻지 않고 끈다.
    quit_asked: Arc<Mutex<Option<std::time::Instant>>>,
}

/// 끄기를 물은 뒤 이 안에 한 번 더 끄면(⌘Q 두 번) 그대로 끈다 — 묻는 창이 응답하지 못해도
/// 앱을 끌 길이 남는다.
const QUIT_AGAIN_WINDOW: std::time::Duration = std::time::Duration::from_secs(10);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// 사용자의 셸 — 로그인 셸로 띄워 프로필의 PATH 를 받는다.
fn shell_command() -> (CommandBuilder, String) {
    #[cfg(windows)]
    {
        let cmd = CommandBuilder::new("powershell.exe");
        (cmd, "powershell".to_string())
    }
    #[cfg(not(windows))]
    {
        let fallback = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| fallback.to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "shell".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        (cmd, name)
    }
}

/// 「다음」 실행 때 셸에 쳐 넣는 한 줄.
fn run_line() -> String {
    if cfg!(windows) {
        format!("claude $env:{PROMPT_ENV}\r")
    } else {
        format!("claude \"${PROMPT_ENV}\"\r")
    }
}

/// 읽은 바이트에서 **완성된 UTF-8 만** 꺼낸다 — 한글 한 글자(3바이트)가 두 번의 읽기에
/// 걸쳐 오면 앞 조각을 다음 읽기까지 남긴다. 잘못된 바이트는 대체 문자로.
pub fn take_utf8(carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(carry) {
        Ok(s) => {
            let out = s.to_owned();
            carry.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let out = String::from_utf8_lossy(&carry[..valid]).into_owned();
            carry.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(carry).into_owned();
            carry.clear();
            out
        }
    }
}

/// 상태 신호 하나를 세션 표에 반영한다. 탐침이면 그 PTY 에 답을 쓰고, 루트 보고가 상태를
/// 바꾸면 웹뷰로 보낼 사건을 돌려준다. 하위 기록(`id=…`)은 지금 보지 않는다.
fn apply_program_status(
    table: &Arc<Mutex<Inner>>,
    id: u32,
    msg: program_status::Message,
) -> Option<TermEvent> {
    let mut t = table.lock().ok()?;
    let s = t.map.get_mut(&id)?;
    match msg {
        program_status::Message::Query => {
            let _ = s.writer.write_all(program_status::QUERY_REPLY);
            let _ = s.writer.flush();
            None
        }
        program_status::Message::Report(r) if r.id.is_none() => {
            let next = r.state.map(|state| TermStatus {
                state: state.as_str().to_string(),
                kind: r.kind.map(|k| k.as_str().to_string()),
                msg: r.msg.clone(),
                since: s
                    .info
                    .status
                    .as_ref()
                    .filter(|prev| prev.state == state.as_str())
                    .map(|prev| prev.since.clone())
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            });
            if s.info.status == next {
                return None;
            }
            s.info.status = next.clone();
            Some(TermEvent::Status { status: next })
        }
        program_status::Message::Report(_) => None,
    }
}

impl TermSessions {
    /// 세션을 열고 출력 스레드를 붙인다. `emit` 은 출력·끝을 웹뷰로 보낸다.
    pub fn open<F>(&self, spec: OpenSpec, emit: F) -> Result<TermInfo, String>
    where
        F: Fn(TermEvent) + Send + 'static,
    {
        let (cmd, shell_name) = shell_command();
        let label = if spec.prompt.is_some() {
            "claude".to_string()
        } else {
            shell_name
        };
        self.start(spec, cmd, label, emit)
    }

    /// 명령을 PTY 에 띄운다 — `open` 이 셸로 부르고, 테스트는 짧은 명령으로 부른다.
    fn start<F>(
        &self,
        spec: OpenSpec,
        mut cmd: CommandBuilder,
        label: String,
        emit: F,
    ) -> Result<TermInfo, String>
    where
        F: Fn(TermEvent) + Send + 'static,
    {
        let pair = native_pty_system()
            .openpty(size(spec.cols, spec.rows))
            .map_err(|e| format!("pty: {e}"))?;
        cmd.cwd(&spec.cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Claude Code 의 전체 화면 렌더러 — 일반 렌더러는 크기가 바뀔 때마다 지난 화면을
        // 다시 쏟아 스크롤백을 더럽혔다(3.x 실측, v3.13.2).
        cmd.env("CLAUDE_CODE_NO_FLICKER", "1");
        if let Some(prompt) = &spec.prompt {
            cmd.env(PROMPT_ENV, prompt);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn: {e}"))?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("reader: {e}"))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("writer: {e}"))?;
        if spec.prompt.is_some() {
            // 셸이 아직 프롬프트를 그리기 전이어도 tty 가 받아 둔다.
            let _ = writer.write_all(run_line().as_bytes());
            let _ = writer.flush();
        }

        let mut inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
        inner.next += 1;
        let id = inner.next;
        let info = TermInfo {
            id,
            project_id: spec.project_id,
            label,
            started_at: chrono::Utc::now().to_rfc3339(),
            alive: true,
            exit_code: None,
            status: None,
            busy: false,
        };
        inner.map.insert(
            id,
            Session {
                window: spec.window,
                info: info.clone(),
                master: pair.master,
                writer,
                child,
            },
        );
        drop(inner);

        let table = self.inner.clone();
        std::thread::Builder::new()
            .name(format!("term-{id}"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                let mut carry: Vec<u8> = Vec::new();
                let mut scanner = program_status::Scanner::default();
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            // 상태 신호를 **화면으로 넘기기 전에** — 탐침의 답이 xterm 의 DA1
                            // 응답보다 먼저 가야 claude 가 이 터미널이 신호를 받는다고 본다.
                            for msg in scanner.feed(&buf[..n]) {
                                if let Some(ev) = apply_program_status(&table, id, msg) {
                                    emit(ev);
                                }
                            }
                            carry.extend_from_slice(&buf[..n]);
                            let text = take_utf8(&mut carry);
                            if !text.is_empty() {
                                emit(TermEvent::Output { data: text });
                            }
                        }
                    }
                }
                // 표를 잠근 채 기다리지 않는다(try_wait) — 막히면 다른 세션 조작이 다 선다.
                // 출력이 끝나도(EOF) 자식이 아직 안 거둬졌을 수 있어 잠깐씩 다시 본다(최대 ~1초) —
                // 바로 한 번만 보면 부하가 있을 때 종료 코드를 「모름」 으로 적었다. 닫기로 끝난
                // 세션은 표에 없으므로 곧장 나온다.
                let mut code = None;
                for _ in 0..50 {
                    let seen = table.lock().ok().and_then(|mut t| {
                        let s = t.map.get_mut(&id)?;
                        Some(s.child.try_wait().ok().flatten().map(|st| st.exit_code()))
                    });
                    match seen {
                        Some(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
                        Some(found) => {
                            code = found;
                            break;
                        }
                        None => break,
                    }
                }
                if let Ok(mut t) = table.lock() {
                    if let Some(s) = t.map.get_mut(&id) {
                        s.info.alive = false;
                        s.info.exit_code = code;
                    }
                }
                emit(TermEvent::Exit { code });
            })
            .map_err(|e| format!("thread: {e}"))?;
        Ok(info)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
        let s = inner.map.get_mut(&id).ok_or("no such session")?;
        s.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
        let s = inner.map.get(&id).ok_or("no such session")?;
        s.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    /// 세션을 닫는다 — 자식을 죽이고 표에서 뺀다(PTY 가 닫혀 출력 스레드도 끝난다).
    pub fn close(&self, id: u32) {
        let removed = self.inner.lock().ok().and_then(|mut t| t.map.remove(&id));
        if let Some(mut s) = removed {
            let _ = s.child.kill();
        }
    }

    /// 그 창의 세션 목록 (연 순서).
    pub fn list(&self, window: &str) -> Vec<TermInfo> {
        let Ok(inner) = self.inner.lock() else {
            return Vec::new();
        };
        let mut out: Vec<TermInfo> = inner
            .map
            .values()
            .filter(|s| s.window == window)
            .map(Session::snapshot)
            .collect();
        out.sort_by_key(|i| i.id);
        out
    }

    /// 창이 닫힐 때 — 그 창의 세션 전부.
    /// 모든 창의 세션 — 프로젝트 목록 · 시작 창이 「어디서 무엇이 도는지」를 센다.
    pub fn overview(&self) -> Vec<TermInfo> {
        let Ok(inner) = self.inner.lock() else {
            return Vec::new();
        };
        let mut out: Vec<TermInfo> = inner.map.values().map(Session::snapshot).collect();
        out.sort_by_key(|i| i.id);
        out
    }

    /// 앱을 끄려 한다 — 무언가 도는 세션이 있으면 물을 창(첫 세션의 창)과 그 수를 돌려주고 물은
    /// 때를 적는다. 없거나 방금 물었으면(`QUIT_AGAIN_WINDOW`) `None` — 그대로 끈다.
    pub fn ask_before_quit(&self) -> Option<(String, u32)> {
        let now = std::time::Instant::now();
        let mut asked = self.quit_asked.lock().ok()?;
        if asked.is_some_and(|at| now.duration_since(at) < QUIT_AGAIN_WINDOW) {
            return None;
        }
        let inner = self.inner.lock().ok()?;
        let mut busy: Vec<&Session> = inner.map.values().filter(|s| s.busy()).collect();
        busy.sort_by_key(|s| s.info.id);
        let first = busy.first()?;
        *asked = Some(now);
        Some((first.window.clone(), busy.len() as u32))
    }

    /// 이 창에서 무언가 도는 세션 — 창을 닫기 전에 물을지 가른다.
    pub fn busy_in(&self, window: &str) -> Vec<TermInfo> {
        self.list(window).into_iter().filter(|i| i.busy).collect()
    }

    pub fn close_window(&self, window: &str) {
        let ids: Vec<u32> = self
            .inner
            .lock()
            .map(|t| {
                t.map
                    .iter()
                    .filter(|(_, s)| s.window == window)
                    .map(|(id, _)| *id)
                    .collect()
            })
            .unwrap_or_default();
        for id in ids {
            self.close(id);
        }
    }

    /// 앱이 끝날 때 — 전부. 고아 셸을 남기지 않는다.
    pub fn close_all(&self) {
        let ids: Vec<u32> = self
            .inner
            .lock()
            .map(|t| t.map.keys().copied().collect())
            .unwrap_or_default();
        for id in ids {
            self.close(id);
        }
    }
}

#[cfg(test)]
mod tests {
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
    fn run_line_reads_the_prompt_from_the_environment() {
        let line = run_line();
        assert!(line.starts_with("claude "));
        assert!(line.contains(PROMPT_ENV));
        assert!(line.ends_with('\r'));
    }
}

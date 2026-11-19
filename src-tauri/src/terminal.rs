//! 앱 안 터미널 (4.0, 플랜 `terminal-v4-20261029`) — 세션은 **앱 프로세스 안에** 산다.
//!
//! 10-28 에 걷은 3.x 터미널은 앱 밖 PTY 호스트(업데이트를 견디는 세션) · 떼어낸 창 ·
//! 셸 rc 통합까지 6만여 줄이었고 10월 fix 1위였다. 다시 들이며 그 셋을 들이지 않는다:
//! 세션은 창이 닫히면 그 창의 것이, 앱이 끝나면 전부 끝난다. 셸은 사용자의 로그인 셸을
//! 그대로 띄우고(PATH 가 Finder 로 뜬 앱의 최소 PATH 가 아니게), rc 는 건드리지 않는다.
//!
//! 「다음」 을 실행할 때는 프롬프트를 환경 변수(`OCULPM_PROMPT`)로 넘기고, 셸이 `claude "$OCULPM_PROMPT"`
//! 를 명령 인자로 받아 돌린다(`terminal_env.rs`) — 따옴표·줄바꿈을 셸 문법으로 이스케이프할 일이 없고, rc 의
//! 질문이 그 줄을 먹지 않으며, claude 가 끝나면 셸이 남는다. 계획의 확인 명령(11-15)도 같은 길이다 — 사람이
//! 확인 창에서 전문을 보고 누른 한 줄을 환경 변수(`OCULPM_CHECK`)로 받아 셸이 따로 읽는다(`eval`).
//!
//! 업데이트 재시작은 세션을 끝낸다(프로세스는 살리지 않는다). 대신 claude 가 돌던 세션의 자리를
//! 창 스냅숏에 적어 두었다가, 다시 뜬 창이 같은 폴더에서 `claude --continue` 로 대화를 잇는다
//! (`TermResume` · 10-31 사용자 결정).

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};

#[path = "terminal_output.rs"]
mod output;
#[path = "terminal_io.rs"]
mod pty_io;
#[path = "terminal_env.rs"]
mod shell_env;
#[path = "terminal_types.rs"]
mod types;
use output::pump_output;
pub use output::take_utf8;
pub use pty_io::{FrontFn, BUSY as WRITE_BUSY};
pub use types::{TermBusy, TermCheck, TermEvent, TermInfo, TermResume, TermStatus};

/// 프롬프트를 셸에 넘기는 환경 변수.
pub const PROMPT_ENV: &str = "OCULPM_PROMPT";
/// 계획의 확인 명령 한 줄을 셸에 넘기는 환경 변수 — 셸은 `eval "$OCULPM_CHECK"` 로 그 글만 따로 읽는다
/// (`terminal_env.rs` 머리말 — 앱이 붙인 줄과 한 문법으로 섞이지 않게).
pub const CHECK_ENV: &str = "OCULPM_CHECK";

/// 여는 데 필요한 것.
pub struct OpenSpec {
    pub window: String,
    pub project_id: u32,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    /// 있으면 그 프롬프트로 `claude` 를 바로 실행한다.
    pub prompt: Option<String>,
    /// 레인에서 열었으면 그 경로(받은 그대로) — 업데이트 뒤 같은 자리에서 잇는다.
    pub lane: Option<String>,
    /// 업데이트 전 대화를 잇는다 — `claude --continue`.
    pub resume: bool,
    /// 있으면 계획의 확인 명령 한 줄을 돌리고 셸로 남는다(사람이 확인 창에서 누른 뒤).
    pub check: Option<TermCheck>,
    /// 그 창이 앞에 있는가 — 출력 흐름 제어가 창이 뒤면 더 넉넉히 받는다(`pty_io::Flow`). 없으면 늘 앞.
    pub front: Option<FrontFn>,
}

struct Session {
    window: String,
    lane: Option<String>,
    info: TermInfo,
    /// 크기 바꾸기는 표 잠금 밖에서 — 잠금은 이 세션만 잡는다.
    master: pty_io::SharedMaster,
    /// 쓰기 줄 — 넣고 곧장 돌아온다. 탐침의 답도 이 줄로 간다.
    input: pty_io::Input,
    flow: Arc<pty_io::Flow>,
    child: Box<dyn Child + Send + Sync>,
    /// 제목의 두 출처 — OSC 7501 의 `title=` 이 OSC 0 · 2 보다 먼저다(`TermInfo.title`).
    program_title: Option<String>,
    osc_title: Option<String>,
}

impl Session {
    /// 잠금 안에서 이 세션을 한 줄로 베낀다 — 「도는 중」 은 잠금을 놓은 뒤 가른다(`Row::busy`).
    /// Windows 의 프로세스 스냅숏은 무거워(시스템 전체 프로세스 목록) 잠금 밖에서 한 번만 뜬다 — 예전에는
    /// 세션마다 잠금 안에서 떠, 그동안 입력 · 크기 바꾸기 · 출력 스레드의 상태 반영이 모두 그 잠금을
    /// 기다렸다(2026-11-11).
    fn row(&self) -> Row {
        Row {
            window: self.window.clone(),
            lane: self.lane.clone(),
            info: self.info.clone(),
            fg_busy: self.fg_busy(),
            shell_pid: self.child.process_id(),
        }
    }

    /// unix — 터미널의 포그라운드 프로세스 그룹이 셸이 아니다(ioctl 하나). 물을 수 없거나 Windows 면 `None`.
    fn fg_busy(&self) -> Option<bool> {
        if !self.info.alive {
            return None;
        }
        #[cfg(unix)]
        {
            let fg = self.master.lock().ok()?.process_group_leader()?;
            Some(fg as u32 != self.child.process_id()?)
        }
        #[cfg(not(unix))]
        None
    }
}

/// 세션 한 줄의 베낌 — `Session::row`.
struct Row {
    window: String,
    lane: Option<String>,
    info: TermInfo,
    /// unix — 포그라운드 프로세스 그룹이 셸이 아니다. 물을 수 없으면 `None`.
    fg_busy: Option<bool>,
    /// 셸의 pid — Windows 가 스냅숏에서 자식을 찾는다.
    shell_pid: Option<u32>,
}

impl Row {
    /// 셸 위에서 무언가가 도는가 — 터미널의 포그라운드 프로세스 그룹이 셸이 아니면 그렇다(macOS
    /// 터미널이 닫기 전에 묻는 기준). 빈 셸까지 세면 터미널 탭을 한 번 연 창은 닫을 때마다 물었다.
    /// Windows 에는 프로세스 그룹이 없다 — 셸에게 자식 프로세스가 있으면 도는 것이다(2026-11-10. 그전엔
    /// 상태 신호를 보낸 claude 만 세어, `npm run dev` 가 도는 창도 묻지 않고 닫혔다). 그것도 물을 수 없으면
    /// 상태 신호를 보낸 프로그램(claude)이 있을 때만.
    /// `parents` 는 자식을 둔 pid 들(Windows 스냅숏 한 번, `TermSessions::parents`).
    fn busy(&self, parents: Option<&HashSet<u32>>) -> bool {
        if !self.info.alive {
            return false;
        }
        if let Some(busy) = self.fg_busy {
            return busy;
        }
        if let (Some(parents), Some(pid)) = (parents, self.shell_pid) {
            return parents.contains(&pid);
        }
        self.info.status.is_some()
    }

    /// claude 가 돈다 — 무언가 돌고, 그것이 claude 라고 알렸거나(OSC 7501 `app=claude…`) claude 로 연 세션이다.
    /// 다른 이름을 알렸으면(Codex 도 2026-10-09 부터 OSC 7501 을 `app=codex` 로 보낸다) 「다음」 으로 연 세션이어도
    /// 아니다 — 업데이트 뒤 그 칸에 `claude --continue` 를 치지 않게. 이름이 없으면 예전 규칙 그대로.
    fn runs_claude(&self, parents: Option<&HashSet<u32>>) -> bool {
        if !self.busy(parents) {
            return false;
        }
        match self.info.status.as_ref().and_then(|s| s.app.as_deref()) {
            Some(app) => app.starts_with("claude"),
            None => self.info.status.is_some() || self.info.label == "claude",
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
    /// 읽지 않은 소식이 있는 창 라벨 — `TermInfo.unseen` 의 출처.
    unseen: Arc<Mutex<std::collections::HashSet<String>>>,
    /// 앱을 끄기 전에 물은 때 — 그 뒤 잠깐 안에 다시 끄려 하면 묻지 않고 끈다.
    quit_asked: Arc<Mutex<Option<std::time::Instant>>>,
    /// 업데이트 재시작 뒤 창 라벨마다 이을 claude 세션 — 창 복원이 채우고 그 창이 한 번 가져간다.
    pending_resume: Arc<Mutex<HashMap<String, Vec<TermResume>>>>,
    /// Windows — 마지막 프로세스 스냅숏(뜬 때와 자식을 둔 pid 들). `PARENTS_TTL` 동안 다시 쓴다:
    /// 프로젝트 목록 · 시작 창 · 이 창이 `TermSessionsChanged` 마다 한꺼번에 목록을 읽는다.
    #[cfg(windows)]
    parents_cache: Arc<Mutex<Option<(std::time::Instant, Arc<HashSet<u32>>)>>>,
    /// 테스트가 스냅숏을 몇 번 떴는지 센다.
    #[cfg(all(windows, test))]
    snapshots: Arc<std::sync::atomic::AtomicUsize>,
}

/// Windows 프로세스 스냅숏을 다시 쓰는 시간 — 「도는 중」 표시가 이만큼 늦을 수 있다.
#[cfg(windows)]
const PARENTS_TTL: std::time::Duration = std::time::Duration::from_millis(500);

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

/// 사용자의 셸 — 로그인 셸로 띄워 프로필의 PATH 를 받는다. `launch`(「다음」 · 잇기 · 확인 명령)가 있으면 셸이
/// 그 줄을 명령 인자로 받고, 받지 못하는 셸이면 쳐 넣을 줄을 함께 돌려준다(`shell_env::attach_launch`).
fn shell_command(
    launch: Option<shell_env::Launch<'_>>,
) -> (CommandBuilder, String, Option<String>) {
    #[cfg(windows)]
    {
        let (mut cmd, name) = match find_pwsh(std::env::var_os("PATH").as_deref()) {
            Some(pwsh) => (CommandBuilder::new(pwsh), "pwsh".to_string()),
            None => (
                CommandBuilder::new("powershell.exe"),
                "powershell".to_string(),
            ),
        };
        // 시작 배너(저작권 · 버전 안내)만 끈다 — 프로필은 그대로 읽는다. 배너는 세션을 열 때마다 몇 줄을
        // 차지하고 ConPTY 가 그만큼 더 그렸다(2026-11-11).
        cmd.arg("-NoLogo");
        let typed = shell_env::attach_launch(&mut cmd, &name, launch, &[]);
        (cmd, name, typed)
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
        // 실행 줄 끝의 `exec "$SHELL"` 가 같은 셸로 돌아오게 — 앱에 SHELL 이 없어 기본 셸을 고른 때도.
        cmd.env("SHELL", &shell);
        let typed = shell_env::attach_launch(&mut cmd, &name, launch, &["-l"]);
        (cmd, name, typed)
    }
}

/// Windows 의 셸은 PowerShell 7(`pwsh.exe`)이 PATH 에 있으면 그것이다 (2026-11-10).
///
/// 예전에는 늘 `powershell.exe`(Windows PowerShell 5.1, OS 기본)였다. PowerShell 7 을 쓰는 사람의 프로필
/// (fnm · starship · zoxide …)은 `Documents\PowerShell\` 에 있고 5.1 은 `Documents\WindowsPowerShell\` 을
/// 읽는다 — 앱 터미널만 설정이 하나도 없는 맨 셸로 떴다(사용자 지적). Windows Terminal 도 pwsh 가 있으면
/// 그것을 기본 프로필로 만든다. 없으면 5.1 그대로라 예전과 같다.
///
/// 디렉터리 순서가 곧 우선순위다(셸이 찾는 순서). Store 판 pwsh 는 `WindowsApps` 의 앱 실행 별칭인데,
/// Rust 의 `is_file()` 은 그것도 파일로 본다(이 PC 에서 직접 확인) — CreateProcess 도 그대로 띄운다.
/// 상대 PATH 항목은 작업 폴더에 따라 뜻이 바뀌므로 건너뛴다(`proc.rs` 와 같은 규칙).
#[cfg(any(windows, test))]
fn find_pwsh(path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    std::env::split_paths(path_var?)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join("pwsh.exe"))
        .find(|candidate| candidate.is_file())
}

/// Windows — 자식 프로세스를 둔 pid 들. 스냅숏 한 번으로 모든 세션을 가른다. 못 뜨면 `None`.
///
/// 콘솔 호스트(`conhost.exe` · `OpenConsole.exe`)는 세지 않는다 — 자기 콘솔을 만든 콘솔 프로그램은 그것을
/// 자식으로 둔다. PTY 의 셸은 앱이 띄운 의사 콘솔에 붙어 있어 보통 없지만, 하나라도 끼면 빈 셸이 늘
/// 「도는 중」 이 되어 닫을 때마다 묻는다. pid 재사용은 보지 않는다 — 셸이 살아 있으니 그 pid 는 셸 것이다.
#[cfg(windows)]
fn parents_with_children() -> Option<HashSet<u32>> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    const HOSTS: [&str; 2] = ["conhost.exe", "openconsole.exe"];
    // SAFETY: 스냅숏 핸들은 이 함수 안에서만 쓰고 닫는다. 항목 구조체는 dwSize 를 채워 넘긴다.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut parents = HashSet::new();
        let mut more = Process32FirstW(snap, &mut entry) != 0;
        while more {
            let parent = entry.th32ParentProcessID;
            if entry.th32ProcessID != parent && !parents.contains(&parent) {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
                if !HOSTS.contains(&name.as_str()) {
                    parents.insert(parent);
                }
            }
            more = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        Some(parents)
    }
}

/// Windows — 이 pid 를 부모로 둔 프로세스가 있나 (테스트용 한 줄 탐침).
#[cfg(all(windows, test))]
fn has_child_process(parent: u32) -> Option<bool> {
    parents_with_children().map(|p| p.contains(&parent))
}

/// Windows — 터미널 셸을 「보통 이하」 우선순위로 내린다. 그 안에서 뜨는 claude · 병렬 세션 · cargo 는
/// 이 등급을 물려받는다(CreateProcess 는 Idle · BelowNormal 부모의 등급을 자식에게 넘긴다). 앱 · 웹뷰 ·
/// ConPTY 중계(conhost)는 보통이라, CPU 가 꽉 차도 키 입력과 화면이 먼저 돈다 — macOS 가 보고 있는
/// 앱을 먼저 돌려 주는 것을 흉내 낸 것이다(2026-11-11, rustc 30개에 한글이 밀리고 화면이 끊겼다).
/// 한가할 때는 차이가 없다. 실패해도 세션은 그대로 연다.
#[cfg(windows)]
fn yield_to_ui(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    // SAFETY: 방금 띄운 자식의 pid 로 연 핸들을 쓰고 바로 닫는다.
    unsafe {
        let handle = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if handle.is_null() {
            return;
        }
        SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
        CloseHandle(handle);
    }
}

impl TermSessions {
    /// 세션을 열고 출력 스레드를 붙인다. `emit` 은 출력·끝을 웹뷰로 보낸다.
    pub fn open<F>(&self, spec: OpenSpec, emit: F) -> Result<TermInfo, String>
    where
        F: Fn(TermEvent) + Send + 'static,
    {
        let check = spec.check.as_ref().map(|c| c.line.as_str());
        if check.is_some_and(|line| !shell_env::is_one_line(line)) {
            return Err("check: not a single line".to_string());
        }
        let launch = shell_env::Launch::of(spec.prompt.as_deref(), spec.resume, check);
        let (cmd, shell_name, typed) = shell_command(launch);
        let label = match (launch, &spec.check) {
            (Some(shell_env::Launch::Check(_)), Some(c)) => c.label.clone(),
            (Some(_), _) => "claude".to_string(),
            (None, _) => shell_name,
        };
        self.start(spec, cmd, label, typed, emit)
    }

    /// 명령을 PTY 에 띄운다 — `open` 이 셸로 부르고, 테스트는 짧은 명령으로 부른다. `typed` 는 실행 줄을
    /// 인자로 못 받는 셸에 쳐 넣을 한 줄 — 셸이 아직 프롬프트를 그리기 전이어도 tty 가 받아 둔다.
    fn start<F>(
        &self,
        mut spec: OpenSpec,
        mut cmd: CommandBuilder,
        label: String,
        typed: Option<String>,
        emit: F,
    ) -> Result<TermInfo, String>
    where
        F: Fn(TermEvent) + Send + 'static,
    {
        let pair = native_pty_system()
            .openpty(size(spec.cols, spec.rows))
            .map_err(|e| format!("pty: {e}"))?;
        cmd.cwd(&spec.cwd);
        shell_env::apply_env(&mut cmd);
        if let Some(prompt) = spec.prompt.as_deref().filter(|p| !p.is_empty()) {
            cmd.env(PROMPT_ENV, prompt);
        }
        if let Some(check) = spec.check.as_ref() {
            cmd.env(CHECK_ENV, &check.line);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn: {e}"))?;
        #[cfg(windows)]
        if let Some(pid) = child.process_id() {
            yield_to_ui(pid);
        }
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("writer: {e}"))?;
        let id = {
            let mut inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
            inner.next += 1;
            inner.next
        };
        let input = pty_io::Input::spawn(id, writer)?;
        if let Some(line) = typed {
            let _ = input.send(line.into_bytes());
        }
        let flow = Arc::new(pty_io::Flow::new(spec.front.take()));
        let info = TermInfo {
            id,
            project_id: spec.project_id,
            label,
            started_at: crate::clock::rfc3339(crate::clock::now()),
            alive: true,
            exit_code: None,
            status: None,
            busy: false,
            unseen: false,
            title: None,
        };
        let session = Session {
            window: spec.window,
            lane: spec.lane,
            info: info.clone(),
            master: Arc::new(Mutex::new(pair.master)),
            input,
            flow: flow.clone(),
            child,
            program_title: None,
            osc_title: None,
        };
        self.inner
            .lock()
            .map_err(|_| "poisoned".to_string())?
            .map
            .insert(id, session);

        // 읽기와 보내기를 두 스레드로 나눈다 — 막히는 `read` 는 스스로 시간을 재지 못해, 읽은 조각을
        // 받아 모으는 쪽이 `recv_timeout` 으로 잠잠해진 때를 잰다(`pump_output`). 채널은 묶어 둔다
        // (조각 32개, 최대 ~256KB) — 웹뷰가 밀려 펌프가 서면(`pty_io::Flow`) 읽기도 서서 PTY 가 받쳐 준다.
        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(32);
        std::thread::Builder::new()
            .name(format!("term-{id}-read"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                        // 신호로 끊긴 읽기는 끝이 아니다 — 다시 읽는다.
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| format!("thread: {e}"))?;
        let table = self.inner.clone();
        std::thread::Builder::new()
            .name(format!("term-{id}"))
            .spawn(move || {
                pump_output(&rx, &table, id, &emit, &flow);
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

    /// 쓰기 줄에 넣고 곧장 돌아온다(`pty_io::Input`) — 표 잠금 안에서 PTY 에 쓰지 않는다.
    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
        let s = inner.map.get(&id).ok_or("no such session")?;
        s.input.send(data.as_bytes().to_vec())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let master = {
            let inner = self.inner.lock().map_err(|_| "poisoned".to_string())?;
            inner.map.get(&id).ok_or("no such session")?.master.clone()
        };
        let master = master.lock().map_err(|_| "poisoned".to_string())?;
        master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    /// 세션을 닫는다 — 표에서 빼고 곧장 돌아온다. 자식을 죽이고 거두는 일은 따로 돈다(`pty_io::reap`).
    pub fn close(&self, id: u32) {
        let removed = self.inner.lock().ok().and_then(|mut t| t.map.remove(&id));
        if let Some(s) = removed {
            pty_io::reap(id, s.child, s.master, s.input);
        }
    }

    /// 세션 표를 잠근 동안 베낀 줄들(연 순서) — `window` 가 있으면 그 창의 것만. 잠금은 여기서 놓는다.
    fn rows(&self, window: Option<&str>) -> Vec<Row> {
        let Ok(inner) = self.inner.lock() else {
            return Vec::new();
        };
        let mut rows: Vec<Row> = inner
            .map
            .values()
            .filter(|s| window.is_none_or(|w| s.window == w))
            .map(Session::row)
            .collect();
        drop(inner);
        rows.sort_by_key(|r| r.info.id);
        rows
    }

    /// 자식을 둔 pid 들 — Windows 만, 셸 pid 로 가를 살아 있는 세션이 있을 때만 뜬다. 잠금 밖에서
    /// 부른다. 스냅숏은 `PARENTS_TTL` 동안 다시 쓴다(목록 · 개요 · 「도는 중」 이 한꺼번에 물어도 한 번).
    fn parents(&self, rows: &[Row]) -> Option<Arc<HashSet<u32>>> {
        if !rows.iter().any(|r| r.info.alive && r.fg_busy.is_none()) {
            return None;
        }
        #[cfg(windows)]
        {
            let now = std::time::Instant::now();
            let mut cache = self.parents_cache.lock().ok()?;
            if let Some((at, parents)) = cache.as_ref() {
                if now.duration_since(*at) < PARENTS_TTL {
                    return Some(parents.clone());
                }
            }
            #[cfg(test)]
            self.snapshots
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let parents = Arc::new(parents_with_children()?);
            *cache = Some((now, parents.clone()));
            Some(parents)
        }
        #[cfg(not(windows))]
        None
    }

    /// 줄들을 목록으로 — 「도는 중」 을 재고 읽지 않음을 단다.
    fn infos(&self, rows: Vec<Row>) -> Vec<TermInfo> {
        let parents = self.parents(&rows);
        rows.into_iter()
            .map(|r| {
                let busy = r.busy(parents.as_deref());
                let info = TermInfo { busy, ..r.info };
                self.with_unseen(info, &r.window)
            })
            .collect()
    }

    /// 그 창의 세션 목록 (연 순서).
    pub fn list(&self, window: &str) -> Vec<TermInfo> {
        let rows = self.rows(Some(window));
        self.infos(rows)
    }

    /// 모든 창의 세션 — 프로젝트 목록 · 시작 창이 「어디서 무엇이 도는지」를 센다.
    pub fn overview(&self) -> Vec<TermInfo> {
        let rows = self.rows(None);
        self.infos(rows)
    }

    /// 그 세션의 프로젝트 — 닫기가 알릴 곳. 「도는 중」 을 재지 않는다.
    pub fn project_of(&self, id: u32) -> Option<u32> {
        let inner = self.inner.lock().ok()?;
        inner.map.get(&id).map(|s| s.info.project_id)
    }

    /// 앱을 끄려 한다 — 무언가 도는 세션이 있으면 물을 창(첫 세션의 창)과 그 수를 돌려주고 물은
    /// 때를 적는다. 없거나 방금 물었으면(`QUIT_AGAIN_WINDOW`) `None` — 그대로 끈다.
    pub fn ask_before_quit(&self) -> Option<(String, u32)> {
        let now = std::time::Instant::now();
        let mut asked = self.quit_asked.lock().ok()?;
        if asked.is_some_and(|at| now.duration_since(at) < QUIT_AGAIN_WINDOW) {
            return None;
        }
        let rows = self.rows(None);
        let parents = self.parents(&rows);
        let busy: Vec<&Row> = rows.iter().filter(|r| r.busy(parents.as_deref())).collect();
        let first = busy.first()?;
        *asked = Some(now);
        Some((first.window.clone(), busy.len() as u32))
    }

    /// 앱 전체에서 도는 세션과 그 가운데 claude — 업데이트가 재시작 전에 묻는다.
    pub fn busy_all(&self) -> TermBusy {
        let rows = self.rows(None);
        let parents = self.parents(&rows);
        let parents = parents.as_deref();
        let busy = rows.iter().filter(|r| r.busy(parents)).count() as u32;
        let claude = rows.iter().filter(|r| r.runs_claude(parents)).count() as u32;
        TermBusy { busy, claude }
    }

    /// 업데이트 재시작 직전 — 창 라벨마다 claude 가 돌던 세션(창 스냅숏에 싣는다).
    pub fn resumable(&self) -> HashMap<String, Vec<TermResume>> {
        let mut out: HashMap<String, Vec<TermResume>> = HashMap::new();
        let rows = self.rows(None);
        let parents = self.parents(&rows);
        for r in rows
            .into_iter()
            .filter(|r| r.runs_claude(parents.as_deref()))
        {
            out.entry(r.window).or_default().push(TermResume {
                project_id: r.info.project_id,
                lane: r.lane,
            });
        }
        out
    }

    /// 창 복원이 그 창(라벨)이 이을 세션을 맡긴다.
    pub fn set_pending_resume(&self, window: &str, resume: Vec<TermResume>) {
        if resume.is_empty() {
            return;
        }
        if let Ok(mut p) = self.pending_resume.lock() {
            p.insert(window.to_string(), resume);
        }
    }

    /// 그 창이 이을 세션을 가져간다 — 한 번만(두 번째부터 빈 목록).
    pub fn take_pending_resume(&self, window: &str) -> Vec<TermResume> {
        self.pending_resume
            .lock()
            .ok()
            .and_then(|mut p| p.remove(window))
            .unwrap_or_default()
    }

    fn with_unseen(&self, mut info: TermInfo, window: &str) -> TermInfo {
        info.unseen = self
            .unseen
            .lock()
            .map(|u| u.contains(window))
            .unwrap_or(false);
        info
    }

    /// 그 창에 읽지 않은 소식을 단다 — 상태가 기다림 · 끝냄 · 오류로 바뀌었는데 창이 뒤에 있을 때.
    pub fn mark_unseen(&self, window: &str) {
        if let Ok(mut u) = self.unseen.lock() {
            u.insert(window.to_string());
        }
    }

    /// 창이 앞에 왔다 — 소식을 지운다. 지운 것이 있었으면 `true`(목록을 다시 읽게 알린다).
    pub fn clear_unseen(&self, window: &str) -> bool {
        self.unseen
            .lock()
            .map(|mut u| u.remove(window))
            .unwrap_or(false)
    }

    /// 이 창에서 무언가 도는 세션 — 창을 닫기 전에 물을지 가른다.
    pub fn busy_in(&self, window: &str) -> Vec<TermInfo> {
        self.list(window).into_iter().filter(|i| i.busy).collect()
    }

    pub fn close_window(&self, window: &str) {
        self.clear_unseen(window);
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

    /// 앱이 끝날 때 — 전부. 고아 셸을 남기지 않게 거두기를 잠깐 기다린다(`pty_io::SHUTDOWN_WAIT`).
    pub fn close_all(&self) {
        let removed: Vec<(u32, Session)> = self
            .inner
            .lock()
            .map(|mut t| t.map.drain().collect())
            .unwrap_or_default();
        let reapers = removed
            .into_iter()
            .filter_map(|(id, s)| pty_io::reap(id, s.child, s.master, s.input))
            .collect();
        pty_io::join_until(reapers, pty_io::SHUTDOWN_WAIT);
    }
}

#[cfg(test)]
#[path = "terminal_tests.rs"]
pub(crate) mod tests;

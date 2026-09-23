//! Windows 판 — 네임드 파이프 전송(#pty-transport)과 ConPTY 위의 셸 다루기
//! (#pty-conpty · #pty-kill · #pty-liveness). `unix.rs` 와 `mod.rs` 의
//! `#[cfg(unix)]` 짝이고, 세션 기계·접속 처리는 `mod.rs` 의 것을 그대로 쓴다.
//!
//! 유닉스와 달라지는 자리 넷:
//! - **전송** — 소켓 파일 대신 사용자 전용 네임드 파이프 ([`crate::ptyhost::pipe`]).
//! - **종료** — 신호가 없다. SIGHUP 자리는 의사 콘솔 닫기(콘솔에 붙은 프로세스가
//!   `CTRL_CLOSE_EVENT` 를 받는다), SIGKILL 자리는 셸 트리 전체를 담은 Job 종료.
//! - **셸이 스스로 끝남** — ConPTY 는 셸이 끝나도 출력 파이프를 닫지 않을 수 있다.
//!   셸 프로세스를 따로 기다린다.
//! - **포그라운드** — `tcgetpgrp` 이 없다. 셸의 가장 최근 자식이 그 자리다.

use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::net::windows::named_pipe::NamedPipeServer;
use windows_sys::Win32::Foundation::{
    CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
    WaitForSingleObject, INFINITE, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::{log_line, occupy, serve_connection, HostSession, HostState, KILL_GRACE};
use crate::ptyhost::pipe::{self, PipeSecurity};
use crate::ptyhost::protocol::Event;

/// 자리를 비웠는지(`Shutdown`·고아 종료) 받기 루프가 살피는 주기.
const VACATE_POLL: Duration = Duration::from_millis(200);

/// 셸이 스스로 끝났을 때 남은 출력이 `Exit` 보다 먼저 가도록 기다리는 상한.
const DRAIN_WAIT: Duration = Duration::from_secs(2);

// ─── 전송 ────────────────────────────────────────────────────────────────────

/// 자리를 잡고 접속을 받는다 — 유닉스 `serve` 의 Windows 판. 테스트가 임시 경로로
/// 직접 부른다. 이미 살아서 받는 호스트가 있으면 **조용히 물러난다**(먼저 뜬 쪽이 승자).
///
/// 파이프 이름은 인스턴스가 하나라도 열려 있는 동안만 산다. 그래서 받는 인스턴스를
/// 늘 하나 열어 두고, 접속을 받으면 **다음 인스턴스를 먼저** 만든 뒤에 받은 것을
/// 넘긴다 — 틈이 생기면 그 찰나에 붙는 앱은 `ERROR_PIPE_BUSY` 를 보고, 인스턴스가
/// 하나도 없는 틈이면 이름이 사라져 남이 잡을 수 있다.
///
/// `Shutdown`·고아 종료가 자리를 비우면(`state.socket` 이 비면) 받는 인스턴스를
/// 닫는다. 유닉스는 소켓 파일을 지우는 것으로 끝나지만 파이프는 이름이 인스턴스와
/// 같이 살므로, **받기를 멈춰야** 이름이 비고 교체 호스트가 첫 인스턴스를 만든다.
pub async fn serve(state: Arc<HostState>, socket: &Path) -> Result<(), String> {
    let Some(pipe::Claimed {
        name,
        security,
        first,
    }) = pipe::claim(socket).await?
    else {
        return Ok(());
    };
    occupy(&state, socket);
    let mut listening = first;
    let mut vacancy = tokio::time::interval(VACATE_POLL);
    loop {
        tokio::select! {
            accepted = listening.connect() => {
                let next = next_instance(&state, &security, &name).await;
                let connected = std::mem::replace(&mut listening, next);
                match accepted {
                    Ok(()) => {
                        let (read_half, write_half) = tokio::io::split(connected);
                        tokio::spawn(serve_connection(state.clone(), read_half, write_half));
                    }
                    // 받기 전에 끊고 간 접속 — 그 인스턴스만 버린다.
                    Err(e) => log_line(&state, &format!("accept failed: {e}")),
                }
            }
            _ = vacancy.tick() => {
                if vacated(&state) {
                    drop(listening);
                    log_line(&state, "pipe released — no longer accepting");
                    // 프로세스 종료는 비운 쪽(`Shutdown`·고아 감시)이 유예 뒤에 한다.
                    return std::future::pending().await;
                }
            }
        }
    }
}

/// 다음 받는 인스턴스. 실패는 자원 고갈 같은 드문 일이라 잠깐 쉬고 다시 — 그동안
/// 들어오는 앱은 BUSY 를 보고 [`pipe::connect`] 의 대기 안에서 재시도한다.
async fn next_instance(state: &HostState, security: &PipeSecurity, name: &str) -> NamedPipeServer {
    loop {
        match security.create_instance(name, false) {
            Ok(server) => return server,
            Err(e) => {
                log_line(
                    state,
                    &format!("failed to open the next pipe instance: {e}"),
                );
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

fn vacated(state: &HostState) -> bool {
    state
        .socket
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none()
}

// ─── 셸 시작 ─────────────────────────────────────────────────────────────────

/// 셸 명령 뒤에 붙일 인자 — cmd 의 콘솔 코드 페이지를 UTF-8(65001)로 (#pty-conpty).
///
/// ConPTY 가 파이프로 내보내는 것은 언제나 UTF-8 VT 고, 들어오는 입력도 UTF-8 로
/// 읽는다. 셸 자신의 출력(`echo`·`Write-Output`)은 유니코드 API 로 쓰여 코드 페이지와
/// 무관하다. 깨지는 자리는 콘솔에 **바이트로** 쓰는 프로그램(`printf`·`WriteFile` 류)
/// 이다 — 그 출력은 콘솔 코드 페이지로 읽히고, 한국어 Windows 의 기본은 949, 영어판은
/// 437 이다. 셸이 뜨자마자 65001 로 돌려 두면 그 콘솔에서 뜨는 자식 전부가 물려받는다
/// (코드 페이지는 콘솔의 속성이다).
///
/// **셸은 받은 그대로 띄운다** — 여기서 셸을 고르지 않는다(`Request::Start.shell` =
/// 앱의 `current_shell()`). PowerShell 에는 아무것도 붙이지 않는다: `-Command`·
/// `-NoProfile` 은 셸 통합(프로필의 관리 블록)을 끈다. PowerShell 의 인코딩은 그
/// 통합 스크립트가 맡을 자리다. cmd 도 사용자 AutoRun 은 그대로 돈다(`/D` 를 쓰지 않는다).
pub(super) fn utf8_console_args(shell: &str) -> &'static [&'static str] {
    let name = Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match name.as_str() {
        // 낱말로 나눠 넘긴다 — 공백이 든 인자는 따옴표로 감싸지고, cmd 의 `/K` 는
        // 따옴표를 제 규칙으로 벗긴다. 나눠 두면 따옴표가 생길 일이 없다.
        "cmd" => &["/K", "chcp", "65001>nul"],
        _ => &[],
    }
}

// ─── 종료 (#pty-kill) ────────────────────────────────────────────────────────

/// 셸 트리를 담는 Job Object. 닫히면(호스트가 죽어도) 안의 프로세스가 전부
/// 끝난다 — 유닉스에서 호스트가 죽으면 PTY 가 닫혀 세션이 SIGHUP 을 받는 것과 같은 자리.
pub(super) struct Job(HANDLE);

// SAFETY: 커널 객체 핸들이다 — 어느 스레드에서 써도 된다.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    fn new() -> io::Result<Self> {
        // SAFETY: 이름 없는 Job, 기본 보안 속성.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job(handle);
        // SAFETY: 모두 0 인 값은 이 C 구조체의 유효한 값이다.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        // BREAKAWAY_OK: 스스로 떨어져 나가겠다고 청한 프로세스(CREATE_BREAKAWAY_FROM_JOB)만
        // 놓아 준다 — 유닉스에서 `nohup`·`setsid` 가 SIGHUP 을 피하는 자리.
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        // SAFETY: 크기를 맞춘 지역 구조체를 넘긴다.
        let ok = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    fn assign(&self, process: HANDLE) -> io::Result<()> {
        // SAFETY: 살아 있는 Job 과 프로세스 핸들.
        if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// 안에서 살아 있는 프로세스 수. 묻지 못하면 `None`.
    pub(super) fn active_processes(&self) -> Option<u32> {
        // SAFETY: 모두 0 인 값은 이 C 구조체의 유효한 값이다.
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: 크기를 맞춘 지역 구조체에 받는다.
        let ok = unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                &mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION as *mut c_void,
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                std::ptr::null_mut(),
            )
        };
        (ok != 0).then_some(info.ActiveProcesses)
    }

    fn terminate(&self) {
        // SAFETY: 살아 있는 Job 핸들.
        unsafe { TerminateJobObject(self.0, 1) };
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: CreateJobObjectW 가 준 핸들을 한 번만 닫는다.
        unsafe { CloseHandle(self.0) };
    }
}

/// 방금 띄운 셸을 새 Job 에 담는다. 실패하면 `None` 이고 그 사실을 호스트 로그에
/// 남긴다 — 그 세션의 종료는 셸 하나만 끝내는 길로 물러난다.
///
/// 셸은 이미 돌고 있다: CreateProcess 는 portable-pty 가 소유해 `CREATE_SUSPENDED`
/// 로 띄울 수 없다. 그래도 뜬 직후에 담으므로 그 사이에 셸이 자식을 낳을 틈은
/// 사실상 없다(셸은 아직 DLL 을 올리는 중이다). 담긴 뒤 낳는 자식은 전부 따라 들어온다.
pub(super) fn contain(
    state: &HostState,
    sid: &str,
    child: &dyn portable_pty::Child,
) -> Option<Job> {
    let attempt = || -> io::Result<Job> {
        let process = child
            .as_raw_handle()
            .ok_or_else(|| io::Error::other("the shell has no process handle"))?;
        let job = Job::new()?;
        job.assign(process as HANDLE)?;
        Ok(job)
    };
    attempt()
        .inspect_err(|e| {
            log_line(
                state,
                &format!("session {sid}: could not put the shell in a job ({e}) — kill reaches the shell only"),
            )
        })
        .ok()
}

/// Kill 계열의 실제 종료 — 유닉스 판(`mod.rs`)과 같은 계약: 맵에서 이미 꺼낸 세션을
/// 받아 **전부 실제로** 끝내고 회수한다. 블로킹이라 전용 스레드에서 돈다.
///
/// 1. SIGHUP 자리 — 입력을 닫고 의사 콘솔을 닫는다. 콘솔에 붙은 프로세스(셸·그
///    포그라운드)는 `CTRL_CLOSE_EVENT` 를 받고 내려온다. `ClosePseudoConsole` 은
///    Windows 판에 따라 conhost 가 끝날 때까지 막히므로 요청 처리 스레드가 아니라
///    여기서 부른다(읽기 스레드가 출력을 비워 주므로 막힘은 풀린다).
/// 2. 유예 — Job 안이 빌 때까지 [`KILL_GRACE`].
/// 3. SIGKILL 자리 — Job 종료. 콘솔에 붙지 않은 자손(새 콘솔로 띄운 것·분리된
///    것)까지 트리 전체가 끝난다.
pub(super) fn terminate_session(state: Arc<HostState>, sid: String, session: HostSession) {
    session.gone.store(true, Ordering::SeqCst);
    let HostSession {
        writer,
        master,
        mut child,
        job,
        ..
    } = session;
    std::thread::spawn(move || {
        drop(writer);
        drop(master);
        let deadline = Instant::now() + KILL_GRACE;
        while Instant::now() < deadline && !tree_is_gone(job.as_ref(), child.as_mut()) {
            std::thread::sleep(Duration::from_millis(50));
        }
        match &job {
            Some(job) => job.terminate(),
            None => {
                let _ = child.kill();
            }
        }
        let _ = child.wait();
        log_line(&state, &format!("session killed: {sid}"));
    });
}

fn tree_is_gone(job: Option<&Job>, child: &mut (dyn portable_pty::Child + Send + Sync)) -> bool {
    match job {
        Some(job) => job.active_processes() == Some(0),
        None => matches!(child.try_wait(), Ok(Some(_))),
    }
}

// ─── 셸이 스스로 끝남 (#pty-liveness) ────────────────────────────────────────

/// 셸이 **스스로** 끝나는 것을 지켜보는 장치.
///
/// 유닉스에서는 셸이 끝나면 슬레이브가 닫혀 읽기 스레드가 EOF 를 보고, 거기서 세션을
/// 걷고 `Exit` 를 낸다. ConPTY 는 Windows 판에 따라 의사 콘솔을 **호스트가 닫을
/// 때까지** 살려 두어, 셸이 `exit` 로 끝나도 출력 파이프가 안 끊긴다. 그러면 세션은
/// 죽은 채 맵에 남고 프런트는 `Exit` 를 영영 못 받는다(Hello 의 세션 수도 거짓이
/// 된다). 그래서 셸 프로세스를 따로 기다렸다가, 끝나면 EOF 자리와 같은 정리를 한다.
/// 두 길 중 **맵에서 먼저 꺼낸 쪽**만 정리하고 `Exit` 를 내므로 한 번뿐이다.
pub(super) struct ExitWatch {
    process: Option<OwnedHandle>,
    drained: Receiver<()>,
}

/// 감시 장치와, 읽기 스레드가 쥘 표(끝나면 놓여 "남은 출력을 다 보냈다" 를 알린다).
pub(super) fn watch_exit(child: &dyn portable_pty::Child) -> (ExitWatch, Sender<()>) {
    let (token, drained) = std::sync::mpsc::channel();
    let process = child.as_raw_handle().and_then(|raw: RawHandle| {
        // SAFETY: 살아 있는 셸의 프로세스 핸들 — 복제해 우리 몫으로 쥔다.
        unsafe { BorrowedHandle::borrow_raw(raw) }
            .try_clone_to_owned()
            .ok()
    });
    (ExitWatch { process, drained }, token)
}

impl ExitWatch {
    pub(super) fn start(self, state: Arc<HostState>, sid: String, gone: Arc<AtomicBool>) {
        let ExitWatch { process, drained } = self;
        let Some(process) = process else {
            log_line(
                &state,
                &format!("session {sid}: no exit watch (handle duplication failed) — relying on pipe EOF"),
            );
            return;
        };
        std::thread::spawn(move || {
            // SAFETY: 우리가 쥔 프로세스 핸들.
            unsafe { WaitForSingleObject(process.as_raw_handle() as HANDLE, INFINITE) };
            let mine = {
                let mut sessions = state.lock_sessions();
                match sessions.get(&sid) {
                    Some(s) if Arc::ptr_eq(&s.gone, &gone) => sessions.remove(&sid),
                    _ => None,
                }
            };
            // Kill 이 먼저 지나갔거나 EOF 가 먼저 정리했다.
            let Some(session) = mine else { return };
            terminate_session(state.clone(), sid.clone(), session);
            // 의사 콘솔이 닫히면 읽기 스레드가 끝까지 읽고 표를 놓는다 — 남은 출력이 먼저.
            let _ = drained.recv_timeout(DRAIN_WAIT);
            log_line(&state, &format!("session exited: {sid}"));
            let _ = state.events.send(Event::Exit { sid });
        });
    }
}

// ─── 포그라운드 (Toolhelp32) ─────────────────────────────────────────────────

/// 유닉스의 "포그라운드 프로세스 그룹 리더" 자리 — 셸의 **가장 최근에 뜬 살아 있는
/// 자식**. 자식이 없으면 셸 자신이다(→ `foreground_of` 가 "놀고 있음" 으로 접는다).
///
/// 콘솔에는 `tcgetpgrp` 이 없다. 셸이 지금 돌리는 명령은 셸의 자식이고, 여럿이면
/// 가장 나중 것이 사용자가 보고 있는 것이다. 한계: 창을 따로 띄운 GUI 프로그램
/// (`start notepad`)도 셸의 자식이라 "돌고 있는 일" 로 잡힌다.
pub(super) fn process_group_leader_of(session: &HostSession) -> Option<i32> {
    let shell = session.child.process_id()?;
    Some(newest_child_of(shell).unwrap_or(shell) as i32)
}

/// 살아 있는 프로세스를 조회용으로 연다. 없거나 못 열면 `None`.
fn open_limited(pid: u32) -> Option<OwnedHandle> {
    // SAFETY: 실패하면 null — 아래에서 가른다.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    // SAFETY: 방금 연 핸들의 소유권을 넘겨받는다.
    Some(unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) })
}

/// 살아 있으면 생성 시각(FILETIME 100ns 단위), 끝났거나 못 열면 `None`.
fn born_if_alive(pid: u32) -> Option<u64> {
    let process = open_limited(pid)?;
    let raw = process.as_raw_handle() as HANDLE;
    let mut code = 0u32;
    // SAFETY: 살아 있는 핸들, 출력은 지역 변수.
    if unsafe { GetExitCodeProcess(raw, &mut code) } == 0 || code != STILL_ACTIVE as u32 {
        return None;
    }
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: 살아 있는 핸들, 출력은 지역 변수.
    if unsafe { GetProcessTimes(raw, &mut created, &mut exited, &mut kernel, &mut user) } == 0 {
        return None;
    }
    Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}

/// `parent` 의 살아 있는 자식 중 가장 늦게 뜬 것.
///
/// 부모 pid 는 재사용된다 — 셸보다 **먼저** 태어난 "자식" 은 같은 pid 를 쓰던 옛
/// 주인의 고아다. 생성 시각으로 거른다.
fn newest_child_of(parent: u32) -> Option<u32> {
    let parent_born = born_if_alive(parent)?;
    let mut newest: Option<(u64, u32)> = None;
    for_each_process(|entry| {
        if entry.th32ParentProcessID != parent || entry.th32ProcessID == parent {
            return;
        }
        let Some(born) = born_if_alive(entry.th32ProcessID).filter(|b| *b >= parent_born) else {
            return;
        };
        if newest.is_none_or(|(t, _)| born > t) {
            newest = Some((born, entry.th32ProcessID));
        }
    });
    newest.map(|(_, pid)| pid)
}

/// 프로세스 스냅숏을 한 바퀴 돈다.
fn for_each_process(mut visit: impl FnMut(&PROCESSENTRY32W)) {
    // SAFETY: 실패하면 INVALID_HANDLE_VALUE — 아래에서 가른다.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
        return;
    }
    // SAFETY: 방금 만든 스냅숏 핸들의 소유권을 넘겨받는다(끝나면 닫힌다).
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot as RawHandle) };
    let raw = snapshot.as_raw_handle() as HANDLE;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: dwSize 를 채운 지역 구조체.
    let mut more = unsafe { Process32FirstW(raw, &mut entry) } != 0;
    while more {
        visit(&entry);
        // SAFETY: 같다.
        more = unsafe { Process32NextW(raw, &mut entry) } != 0;
    }
}

// ─── 명령줄 ──────────────────────────────────────────────────────────────────

#[link(name = "ntdll", kind = "raw-dylib")]
extern "system" {
    fn NtQueryInformationProcess(
        process: HANDLE,
        class: u32,
        info: *mut c_void,
        len: u32,
        returned: *mut u32,
    ) -> i32;
}

/// `ProcessCommandLineInformation` (Windows 8.1+) — 다른 프로세스의 명령줄을
/// `PROCESS_QUERY_LIMITED_INFORMATION` 만으로 읽는 길. 작업 관리자가 쓰는 값이다.
const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;

/// ntdll 의 `UNICODE_STRING`.
#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

/// pid → 명령줄 (유닉스 `ps -o args=` 자리). 명령줄을 못 읽으면 실행 파일 경로로
/// 물러난다 — 둘 다 "무엇이 돌고 있나" 의 답이고, 못 열면(끝났다·권한) `None`.
pub(super) fn command_line_of(pid: i32) -> Option<String> {
    let process = open_limited(u32::try_from(pid).ok()?)?;
    command_line(&process).or_else(|| image_path(&process))
}

fn command_line(process: &OwnedHandle) -> Option<String> {
    let raw = process.as_raw_handle() as HANDLE;
    let mut len = 0u32;
    // SAFETY: 길이만 묻는 호출 — 버퍼 없이 필요한 크기를 `len` 에 받는다.
    unsafe {
        NtQueryInformationProcess(
            raw,
            PROCESS_COMMAND_LINE_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut len,
        )
    };
    if len < std::mem::size_of::<UnicodeString>() as u32 || len > (1 << 20) {
        return None;
    }
    let mut buf = vec![0u64; (len as usize).div_ceil(8)];
    // SAFETY: 버퍼는 `len` 바이트 이상이다.
    let status = unsafe {
        NtQueryInformationProcess(
            raw,
            PROCESS_COMMAND_LINE_INFORMATION,
            buf.as_mut_ptr() as *mut c_void,
            len,
            &mut len,
        )
    };
    if status < 0 {
        return None;
    }
    // SAFETY: 성공한 호출은 버퍼 맨 앞에 UNICODE_STRING 을 쓴다.
    let text = unsafe { &*(buf.as_ptr() as *const UnicodeString) };
    let units = usize::from(text.length) / 2;
    let (start, end) = (buf.as_ptr() as usize, buf.as_ptr() as usize + buf.len() * 8);
    let at = text.buffer as usize;
    // 문자열은 우리 버퍼 **안**을 가리켜야 한다 — 아니면 읽지 않는다.
    if text.buffer.is_null() || units == 0 || at < start || at + units * 2 > end {
        return None;
    }
    // SAFETY: 위에서 범위를 확인했다.
    let line = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text.buffer, units) });
    let line = line.trim();
    (!line.is_empty()).then(|| line.to_string())
}

fn image_path(process: &OwnedHandle) -> Option<String> {
    let mut buf = vec![0u16; 32 * 1024];
    let mut size = buf.len() as u32;
    // SAFETY: 크기를 알린 버퍼에 받는다.
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process.as_raw_handle() as HANDLE,
            0,
            buf.as_mut_ptr(),
            &mut size,
        )
    };
    if ok == 0 || size == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

#[cfg(test)]
mod tests;

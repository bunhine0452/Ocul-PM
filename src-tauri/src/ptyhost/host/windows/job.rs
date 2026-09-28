//! 셸 트리를 담는 Job Object (#pty-kill) 와, 세션을 끝낼 때 **콘솔 쪽만** 끝내는 선별
//! (#pty-job-gui-children — 판정은 [`crate::ptyhost::survivors`]).
//!
//! ## `KILL_ON_JOB_CLOSE` 는 끝까지 켜 둔다
//!
//! 세션이 사는 동안 Job 은 "닫히면 안의 것을 전부 끝낸다" 로 산다 — 호스트가 비정상으로
//! 죽어도(패닉·강제 종료·업데이트 설치 파일의 프로세스 정리) 콘솔 고아가 남지 않는다.
//! 세션을 **정상으로** 끝낼 때만 콘솔 쪽을 먼저 끝내고, 남은 것이 GUI 쪽뿐이라고 확인한
//! 뒤에 그 제한을 풀고 핸들을 닫는다 — GUI 쪽은 Job 에 담긴 채(더는 아무도 끝내지 않는
//! Job) 산다. 대가: 호스트가 비정상으로 죽으면 GUI 자손도 함께 끝난다 — 예전과 같은 결과다.

use std::collections::HashMap;
use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_MORE_DATA, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
    JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_PROCESS_ID_LIST,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

use super::{born_if_alive, for_each_process, image_path, open_limited};
use crate::ptyhost::survivors::{self, Member, SUBSYSTEM_WINDOWS_GUI};

/// 콘솔 쪽을 끝내는 데 쓰는 상한 — 호스트의 `Shutdown` 은 종료 유예 + 700ms 뒤에 프로세스를
/// 내린다. 그 안에 끝나야 제한을 풀 수 있다(못 풀고 내려가면 GUI 쪽도 같이 끝난다).
const END_BUDGET: Duration = Duration::from_millis(450);

/// 셸 트리를 담는 Job Object.
pub(crate) struct Job(HANDLE);

// SAFETY: 커널 객체 핸들이다 — 어느 스레드에서 써도 된다.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

/// 실행 파일 → GUI 인가. 한 번의 종료 동안 같은 파일을 여러 번 읽지 않게.
#[derive(Default)]
pub(crate) struct Subsystems(HashMap<PathBuf, bool>);

impl Subsystems {
    fn is_gui(&mut self, pid: u32) -> bool {
        let Some(path) = open_limited(pid).and_then(|p| image_path(&p)) else {
            return false;
        };
        let path = PathBuf::from(path);
        *self
            .0
            .entry(path)
            .or_insert_with_key(|path| survivors::subsystem_of(path) == Some(SUBSYSTEM_WINDOWS_GUI))
    }
}

impl Job {
    pub(super) fn new() -> io::Result<Self> {
        // SAFETY: 이름 없는 Job, 기본 보안 속성.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job(handle);
        job.set_limits(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK)?;
        Ok(job)
    }

    /// BREAKAWAY_OK: 스스로 떨어져 나가겠다고 청한 프로세스(CREATE_BREAKAWAY_FROM_JOB)만
    /// 놓아 준다 — 유닉스에서 `nohup`·`setsid` 가 SIGHUP 을 피하는 자리.
    fn set_limits(&self, flags: u32) -> io::Result<()> {
        // SAFETY: 모두 0 인 값은 이 C 구조체의 유효한 값이다.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = flags;
        // SAFETY: 크기를 맞춘 지역 구조체를 넘긴다.
        let ok = unsafe {
            SetInformationJobObject(
                self.0,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub(super) fn assign(&self, process: HANDLE) -> io::Result<()> {
        // SAFETY: 살아 있는 Job 과 프로세스 핸들.
        if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// 안에서 살아 있는 프로세스 수. 묻지 못하면 `None`.
    pub(crate) fn active_processes(&self) -> Option<u32> {
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

    /// 안의 프로세스 pid 전부. 묻지 못하면 `None`.
    fn members(&self) -> Option<Vec<u32>> {
        // 머리(u32 둘) 뒤에 usize 배열 — usize 단위 버퍼로 맞춘다.
        let head = std::mem::offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList)
            .div_ceil(std::mem::size_of::<usize>());
        let mut slots = 64usize;
        for _ in 0..4 {
            let mut buf = vec![0usize; head + slots];
            let bytes = u32::try_from(buf.len() * std::mem::size_of::<usize>()).ok()?;
            // SAFETY: `bytes` 크기의 정렬된 버퍼에 받는다.
            let ok = unsafe {
                QueryInformationJobObject(
                    self.0,
                    JobObjectBasicProcessIdList,
                    buf.as_mut_ptr() as *mut c_void,
                    bytes,
                    std::ptr::null_mut(),
                )
            };
            // SAFETY: 인자 없는 조회 — 바로 앞 호출의 실패 이유.
            let more = ok == 0 && unsafe { GetLastError() } == ERROR_MORE_DATA;
            if ok == 0 && !more {
                return None;
            }
            // SAFETY: 버퍼 맨 앞은 이 구조체의 머리다(성공이든 MORE_DATA 든 채워진다).
            let list = unsafe { &*(buf.as_ptr() as *const JOBOBJECT_BASIC_PROCESS_ID_LIST) };
            let (assigned, listed) = (
                list.NumberOfAssignedProcesses as usize,
                list.NumberOfProcessIdsInList as usize,
            );
            if !more && listed >= assigned {
                return Some(
                    buf[head..head + listed.min(slots)]
                        .iter()
                        .map(|&pid| pid as u32)
                        .collect(),
                );
            }
            slots = assigned.max(slots) + 16;
        }
        None
    }

    /// 끝낼 프로세스(콘솔 쪽). 목록을 못 얻으면 `None`.
    pub(crate) fn condemned(&self, cache: &mut Subsystems) -> Option<Vec<u32>> {
        let pids = self.members()?;
        if pids.is_empty() {
            return Some(vec![]);
        }
        let mut parents: HashMap<u32, u32> = HashMap::new();
        for_each_process(|entry| {
            if pids.contains(&entry.th32ProcessID) {
                parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            }
        });
        let members: Vec<Member> = pids
            .iter()
            .filter_map(|&pid| {
                // 끝난(목록과 조회 사이에 내려온) 것은 뺀다 — 끝낼 것도, 조상으로 볼 것도 없다.
                let born = born_if_alive(pid)?;
                Some(Member {
                    pid,
                    parent: parents.get(&pid).copied().unwrap_or(0),
                    born,
                    gui: cache.is_gui(pid),
                })
            })
            .collect();
        Some(survivors::condemned(&members))
    }

    /// 세션 종료의 마지막 단계 — 콘솔 쪽을 끝내고, GUI 쪽은 놓아 준다. 남긴 프로세스 수.
    ///
    /// 콘솔 쪽을 다 끝냈다고 확인하지 못하면(목록을 못 얻음·권한·시한) 예전처럼 Job 째
    /// 끝낸다 — "Kill 뒤 콘솔 자식 0" 이 먼저다.
    pub(crate) fn end_console_side(&self, cache: &mut Subsystems) -> u32 {
        let deadline = Instant::now() + END_BUDGET;
        loop {
            match self.condemned(cache) {
                Some(doomed) if doomed.is_empty() => break,
                Some(doomed) if Instant::now() < deadline => self.end_each(&doomed, deadline),
                _ => {
                    self.terminate();
                    return 0;
                }
            }
        }
        let left = self.active_processes().unwrap_or(0);
        if left > 0 && self.set_limits(JOB_OBJECT_LIMIT_BREAKAWAY_OK).is_err() {
            // 제한을 못 풀었다 — 핸들을 닫으면 어차피 전부 끝난다.
            return 0;
        }
        left
    }

    /// `pids` 를 끝내고 `deadline` 까지 내려오기를 기다린다. 목록과 종료 사이에 pid 가
    /// 재사용됐을 수 있어 **이 Job 안의 것만** 끝낸다.
    fn end_each(&self, pids: &[u32], deadline: Instant) {
        let mut ending = Vec::new();
        for &pid in pids {
            // SAFETY: 실패하면 null — 아래에서 가른다.
            let raw = unsafe {
                OpenProcess(
                    PROCESS_TERMINATE | PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            if raw.is_null() {
                continue;
            }
            // SAFETY: 방금 연 핸들의 소유권을 넘겨받는다.
            let process = unsafe { OwnedHandle::from_raw_handle(raw as RawHandle) };
            let mut inside = 0;
            // SAFETY: 살아 있는 핸들 둘, 출력은 지역 변수.
            let checked = unsafe { IsProcessInJob(raw, self.0, &mut inside) } != 0;
            // SAFETY: 우리 Job 안의 프로세스 핸들.
            if checked && inside != 0 && unsafe { TerminateProcess(raw, 1) } != 0 {
                ending.push(process);
            }
        }
        for process in &ending {
            let left = deadline.saturating_duration_since(Instant::now());
            // SAFETY: 우리가 쥔 프로세스 핸들.
            unsafe {
                WaitForSingleObject(process.as_raw_handle() as HANDLE, left.as_millis() as u32)
            };
        }
    }

    pub(super) fn terminate(&self) {
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

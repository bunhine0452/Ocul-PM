//! 같은 호스트의 pid 가 **지금 살아 있는가** — 판정 한 곳 (크로스플랫폼 라운드
//! L-FS · 플랜 `cross-platform-port` #fs-lock).
//!
//! 이 질문을 하는 자리가 둘이었다 — `.oculpm/.lock` 의 소유자(`oculpm::lock`)와
//! A2A 참여자 카드(`oculpm::a2a::registry`). 둘이 판정을 따로 들고 있었고(한쪽은
//! `ps -p` 를 띄우고, 한쪽은 `kill(pid, 0)`), 둘 다 윈도우에서는 "모른다" 였다.
//! 그래서 윈도우에서는 죽은 앱이 남긴 락이 하트비트 창(5분) 내내 풀리지 않았고,
//! 죽은 에이전트의 카드와 작업 구역이 하트비트 TTL 까지 남았다. 여기로 모은다.
//!
//! ## 판정은 셋이다 — 모름은 죽음이 아니다
//!
//! [`State::Alive`] · [`State::Dead`] · [`State::Unknown`]. 청소하는 쪽은 `Dead` 만
//! 걷는다 (플랜 `ledger-and-liveness-honesty`). 근거 없이 `Dead` 라고 하면 살아
//! 있는 세션의 락·작업 구역을 뺏는다 — 그래서 아래 규칙은 확실한 답만 `Dead` 로 준다.
//!
//! ## 유닉스 — `kill(pid, 0)`
//!
//! 시그널을 보내지 않고 존재만 묻는다. `0` 이면 있다. `EPERM` 은 **남의 소유라 못
//! 보낼 뿐 있다** — 살아 있다 (`ps -p` 가 소유자와 무관하게 존재를 말하던 것과 같은
//! 답이다). `ESRCH` 는 없다. 그 밖의 오류는 생사를 말해 주지 않는다 — 모른다.
//!
//! ## 윈도우 — `OpenProcess` + `GetExitCodeProcess`
//!
//! `PROCESS_QUERY_LIMITED_INFORMATION` 으로 연다 — 다른 사용자·보호된 프로세스도
//! 대개 이 권한은 내준다.
//! - 열렸고 종료 코드가 `STILL_ACTIVE`(259) 면 살아 있다. 다른 값이면 끝났다 —
//!   누군가 핸들을 쥐고 있어 커널 객체만 남은 프로세스다.
//! - 못 열었는데 `ERROR_ACCESS_DENIED` 면 **있다** (유닉스의 `EPERM` 자리).
//! - `ERROR_INVALID_PARAMETER` 면 그 pid 의 프로세스가 없다.
//! - 그 밖의 실패는 모른다.
//!
//! 알려진 한계: 종료 코드 259 로 **스스로 끝난** 프로세스를 누군가 핸들로 붙잡고
//! 있으면 산 것으로 읽힌다 (`GetExitCodeProcess` 문서의 경고). 드물고, 틀려도 죽은
//! 것을 잠깐 산 것으로 보는 쪽이다 — 호출부의 하트비트 나이 판정이 뒤를 받친다.
//! pid 재사용은 두 OS 공통 한계라 같은 하트비트가 받친다.

/// pid 하나의 생사.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// 근거를 갖고 살아 있다.
    Alive,
    /// 근거를 갖고 없다. **이것만** 회수·청소의 근거가 된다.
    Dead,
    /// 판정할 수 없다. 없다는 뜻이 아니다.
    Unknown,
}

impl State {
    /// `Some(true)`=살아 있음 · `Some(false)`=없음 · `None`=모름.
    pub fn known(self) -> Option<bool> {
        match self {
            State::Alive => Some(true),
            State::Dead => Some(false),
            State::Unknown => None,
        }
    }
}

/// 이 pid 로 도는 프로세스가 있는가 (판정 규칙은 모듈 문서).
///
/// pid 0 은 어느 OS 에서도 우리가 적은 소유자일 수 없다 (유닉스는 커널,
/// 윈도우는 유휴 프로세스) — 없는 것으로 본다.
pub fn state(pid: u32) -> State {
    if pid == 0 {
        return State::Dead;
    }
    imp::state(pid)
}

/// pid → 실행 파일 이름. 사용자에게 "누가 쥐고 있는지" 를 이름으로 말해 주기
/// 위한 **표시용** 값이라 실패는 전부 `None` 이다.
pub fn exe_name(pid: u32) -> Option<String> {
    imp::exe_name(pid)
}

#[cfg(unix)]
mod imp {
    use super::State;

    pub(super) fn state(pid: u32) -> State {
        // `pid_t` 는 i32 다. 그보다 큰 값은 이 OS 에 있을 수 없는 pid 인데, 그대로
        // 캐스팅하면 음수가 되어 `kill` 이 프로세스 **그룹**을 묻는다 (`-1` 이면
        // 보낼 수 있는 전부 — "살아 있음" 이 나온다).
        let Ok(raw) = libc::pid_t::try_from(pid) else {
            return State::Dead;
        };
        // SAFETY: 시그널 0 은 아무것도 보내지 않는다 — 존재·권한 검사만 한다.
        let rc = unsafe { libc::kill(raw, 0) };
        if rc == 0 {
            return State::Alive;
        }
        from_errno(std::io::Error::last_os_error().raw_os_error())
    }

    /// `kill(pid, 0)` 실패의 errno → 생사.
    pub(super) fn from_errno(errno: Option<i32>) -> State {
        match errno {
            // 남의 소유 프로세스 — 시그널은 못 보내지만 **있다.**
            Some(libc::EPERM) => State::Alive,
            Some(libc::ESRCH) => State::Dead,
            // EINVAL 같은 그 밖의 오류는 pid 의 생사를 말해 주지 않는다.
            _ => State::Unknown,
        }
    }

    pub(super) fn exe_name(pid: u32) -> Option<String> {
        let out = crate::proc::std_cmd("ps")
            .args(["-o", "comm=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!line.is_empty()).then_some(line)
    }
}

#[cfg(windows)]
mod imp {
    use super::State;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, HANDLE,
        STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// 연 프로세스 핸들 — 드롭하면 닫힌다 (어느 갈래로 나가든 새지 않게).
    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: `open` 이 null 이 아닌 핸들만 감싼다.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// 조회 권한으로 연다. 실패하면 `GetLastError` 값.
    fn open(pid: u32) -> Result<Handle, u32> {
        // SAFETY: 인자는 값뿐이고, 실패는 null 반환으로만 알린다.
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if h.is_null() {
            // SAFETY: 바로 앞 호출의 스레드 지역 오류 값을 읽을 뿐이다.
            Err(unsafe { GetLastError() })
        } else {
            Ok(Handle(h))
        }
    }

    pub(super) fn state(pid: u32) -> State {
        let h = match open(pid) {
            Ok(h) => h,
            Err(code) => return from_open_error(code),
        };
        let mut code: u32 = 0;
        // SAFETY: `h` 는 살아 있는 조회 권한 핸들, `code` 는 유효한 출력 자리다.
        if unsafe { GetExitCodeProcess(h.0, &mut code) } == 0 {
            return State::Unknown;
        }
        if code == STILL_ACTIVE as u32 {
            State::Alive
        } else {
            State::Dead
        }
    }

    /// `OpenProcess` 실패 코드 → 생사.
    pub(super) fn from_open_error(code: u32) -> State {
        match code {
            // 있지만 우리에게 조회 권한을 안 준다 — 유닉스의 EPERM 과 같은 자리.
            ERROR_ACCESS_DENIED => State::Alive,
            // 그 pid 의 프로세스(커널 객체)가 없다.
            ERROR_INVALID_PARAMETER => State::Dead,
            _ => State::Unknown,
        }
    }

    pub(super) fn exe_name(pid: u32) -> Option<String> {
        let h = open(pid).ok()?;
        // 긴 경로(`\\?\`)까지 받는다 — 표시용이지만 잘린 이름은 틀린 이름이다.
        let mut buf = vec![0u16; 32_768];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` 는 `len` 개의 u16 을 담을 수 있고, 함수가 실제 길이로 고쳐 쓴다.
        let ok = unsafe {
            QueryFullProcessImageNameW(h.0, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
        };
        if ok == 0 || len == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        // 유닉스의 `ps -o comm=` 과 같은 결 — 전체 경로 대신 파일 이름.
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        (!name.is_empty()).then_some(name)
    }
}

#[cfg(not(any(unix, windows)))]
mod imp {
    use super::State;

    pub(super) fn state(_pid: u32) -> State {
        State::Unknown
    }

    pub(super) fn exe_name(_pid: u32) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 이 OS 에서 **늘 살아 있는** 남의 프로세스 — 유닉스 init/launchd(1),
    /// 윈도우 System(4).
    fn system_pid() -> u32 {
        if cfg!(windows) {
            4
        } else {
            1
        }
    }

    /// 한동안 도는 자식 하나 — 살아 있는 남의 pid 가 필요한 자리용.
    fn long_running_child() -> std::process::Child {
        let mut cmd = if cfg!(windows) {
            let mut c = crate::proc::std_cmd("ping");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        } else {
            let mut c = crate::proc::std_cmd("sleep");
            c.arg("30");
            c
        };
        cmd.stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("오래 도는 자식을 띄우지 못했다")
    }

    #[test]
    fn this_process_is_alive() {
        assert_eq!(state(std::process::id()), State::Alive);
        assert_eq!(state(std::process::id()).known(), Some(true));
    }

    #[test]
    fn the_system_process_is_alive_even_without_rights_over_it() {
        // 유닉스 비루트면 EPERM, 윈도우 비관리자면 ACCESS_DENIED 일 수 있다 —
        // 어느 쪽이든 "있다" 여야 한다.
        assert_eq!(state(system_pid()), State::Alive);
    }

    #[test]
    fn pids_that_cannot_exist_are_dead() {
        assert_eq!(state(0), State::Dead);
        // macOS pid_max(≈99998)·Linux 상한(4194304)보다 크다. 윈도우도 이 근처를
        // 쓰는 일은 없다.
        assert_eq!(state(4_999_999), State::Dead);
        // i32 를 넘는 값 — 유닉스에서 그대로 캐스팅하면 프로세스 그룹을 묻게 된다.
        assert_eq!(state(4_000_000_000), State::Dead);
        assert_eq!(state(u32::MAX), State::Dead);
    }

    /// 살아 있는 남의 자식 → 끝나면 없다. 윈도우는 두 갈래를 다 지난다:
    /// 핸들을 쥔 채(커널 객체가 남아 종료 코드로 판정) · 놓은 뒤(열기 자체가 실패).
    #[test]
    fn a_child_is_alive_until_it_exits_and_dead_after() {
        let mut child = long_running_child();
        let pid = child.id();
        assert_eq!(state(pid), State::Alive);

        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(state(pid), State::Dead, "핸들을 쥔 채 끝난 프로세스");
        drop(child);
        assert_eq!(state(pid), State::Dead, "핸들까지 놓은 뒤");
    }

    #[test]
    fn the_exe_name_of_a_live_child_is_its_program() {
        let mut child = long_running_child();
        let name = exe_name(child.id())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let _ = child.kill();
        let _ = child.wait();
        let want = if cfg!(windows) { "ping" } else { "sleep" };
        assert!(name.contains(want), "{name:?}");
        assert_eq!(exe_name(4_000_000_000), None);
    }

    #[cfg(unix)]
    #[test]
    fn unix_errno_rules() {
        assert_eq!(imp::from_errno(Some(libc::EPERM)), State::Alive);
        assert_eq!(imp::from_errno(Some(libc::ESRCH)), State::Dead);
        assert_eq!(imp::from_errno(Some(libc::EINVAL)), State::Unknown);
        assert_eq!(imp::from_errno(None), State::Unknown);
    }

    #[cfg(windows)]
    #[test]
    fn windows_open_error_rules() {
        use windows_sys::Win32::Foundation::{
            ERROR_ACCESS_DENIED, ERROR_INVALID_HANDLE, ERROR_INVALID_PARAMETER,
        };
        assert_eq!(imp::from_open_error(ERROR_ACCESS_DENIED), State::Alive);
        assert_eq!(imp::from_open_error(ERROR_INVALID_PARAMETER), State::Dead);
        assert_eq!(imp::from_open_error(ERROR_INVALID_HANDLE), State::Unknown);
    }
}

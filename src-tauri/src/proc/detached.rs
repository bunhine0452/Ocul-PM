//! 분리 기동 — **핸들을 하나도 물려주지 않는** 자식 (Windows, #pty-handle-inherit).
//!
//! std 의 `Command::spawn` 은 `CreateProcessW(bInheritHandles = TRUE)` 로 띄운다. 표준
//! 입출력을 넘기려면 그래야 해서인데, TRUE 면 넘기려던 셋만이 아니라 **부모의 상속 가능한
//! 핸들 전부**가 따라간다. 앱보다 오래 사는 PTY 호스트에게 그건 사고다: dev(`tauri dev`)·CI
//! (`cargo test`)에서 앱·테스트의 표준 출력은 부모가 읽는 파이프이고 그 핸들은 상속 가능하다.
//! 호스트가 그 쓰기 끝을 문 채 살아 있으면 부모는 EOF 를 못 보고, 호스트는 고아 유예(3시간)
//! 동안 산다 — 단계 전체가 매달린다(`tests/ptyhost_*.rs` 의 `ShutdownOnDrop` 이 그 흔적).
//!
//! 호스트는 표준 입출력을 어차피 버린다 — 넘길 것이 없다. 그래서 `bInheritHandles = FALSE`
//! 로 띄우고 표준 핸들 자리는 비운다(NULL). 자식의 Rust std 는 NULL 을 "없음" 으로 읽어
//! 쓰기는 버리고 읽기는 EOF 다 — 예전 `Stdio::null()`(NUL 장치)과 같은 결과다.
//!
//! `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 로 NUL 핸들만 골라 넘기는 길도 있지만, 그 핸들을
//! 상속 가능으로 만드는 순간 다른 스레드의 동시 spawn(std 는 bInheritHandles = TRUE)이 그것을
//! 물어 간다. 넘길 것이 없으면 만들지 않는 편이 곧다.

#[cfg(windows)]
pub use spawn::{spawn_detached, Detached};

/// `CommandLineToArgvW` 가 되돌려 읽는 명령줄 — std 의 `make_command_line` 과 같은 규칙.
/// 프로그램은 늘 따옴표로 감싸고(경로에는 `"` 가 올 수 없다), 인자는 공백·탭·줄바꿈·`"` 가
/// 있거나 비었을 때만 감싼다. 감쌀 때는 `"` 앞과 닫는 따옴표 앞의 역슬래시를 두 배로.
/// 끝에 NUL 을 붙여 돌려준다. NUL 이 든 입력은 거부한다.
pub(super) fn command_line(program: &[u16], args: &[&[u16]]) -> std::io::Result<Vec<u16>> {
    const QUOTE: u16 = b'"' as u16;
    const SLASH: u16 = b'\\' as u16;
    let invalid = |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidInput, what);
    if program.contains(&0) || program.contains(&QUOTE) {
        return Err(invalid("the program path has a NUL or a quote"));
    }
    let mut out = Vec::with_capacity(program.len() + 2);
    out.push(QUOTE);
    out.extend_from_slice(program);
    out.push(QUOTE);
    for arg in args {
        if arg.contains(&0) {
            return Err(invalid("an argument has a NUL"));
        }
        out.push(b' ' as u16);
        let quote = arg.is_empty()
            || arg
                .iter()
                .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'\n' as u16 || c == QUOTE);
        if !quote {
            out.extend_from_slice(arg);
            continue;
        }
        out.push(QUOTE);
        let mut slashes = 0usize;
        for &c in arg.iter() {
            if c == SLASH {
                slashes += 1;
            } else {
                if c == QUOTE {
                    // 역슬래시 n 개 + `"` → 2n+1 개 + `"`.
                    out.extend(std::iter::repeat_n(SLASH, slashes + 1));
                }
                slashes = 0;
            }
            out.push(c);
        }
        // 닫는 따옴표 앞의 역슬래시는 두 배로 — 아니면 따옴표를 이스케이프한다.
        out.extend(std::iter::repeat_n(SLASH, slashes));
        out.push(QUOTE);
    }
    out.push(0);
    Ok(out)
}

#[cfg(windows)]
mod spawn {
    use std::ffi::OsStr;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::os::windows::process::ExitStatusExt;
    use std::path::Path;
    use std::process::ExitStatus;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
        CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS, INFINITE, PROCESS_INFORMATION,
        STARTF_USESTDHANDLES, STARTUPINFOW,
    };

    /// 분리 기동한 자식. `std::process::Child` 의 쓰는 몫만 같은 모양으로 둔다.
    pub struct Detached {
        process: OwnedHandle,
        pid: u32,
    }

    impl Detached {
        pub fn id(&self) -> u32 {
            self.pid
        }

        fn raw(&self) -> HANDLE {
            self.process.as_raw_handle() as HANDLE
        }

        fn status(&self) -> io::Result<ExitStatus> {
            let mut code = 0u32;
            // SAFETY: 우리가 쥔 프로세스 핸들, 출력은 지역 변수.
            if unsafe { GetExitCodeProcess(self.raw(), &mut code) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(ExitStatus::from_raw(code))
        }

        /// 끝났으면 그 상태, 아직이면 `None`.
        pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            // SAFETY: 우리가 쥔 프로세스 핸들.
            match unsafe { WaitForSingleObject(self.raw(), 0) } {
                WAIT_OBJECT_0 => self.status().map(Some),
                WAIT_TIMEOUT => Ok(None),
                _ => Err(io::Error::last_os_error()),
            }
        }

        pub fn wait(&mut self) -> io::Result<ExitStatus> {
            // SAFETY: 우리가 쥔 프로세스 핸들.
            if unsafe { WaitForSingleObject(self.raw(), INFINITE) } != WAIT_OBJECT_0 {
                return Err(io::Error::last_os_error());
            }
            self.status()
        }

        pub fn kill(&mut self) -> io::Result<()> {
            // SAFETY: 우리가 쥔 프로세스 핸들. 이미 끝났으면 실패하지만 해는 없다.
            if unsafe { TerminateProcess(self.raw(), 1) } == 0 && self.try_wait()?.is_none() {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    /// `program`(전체 경로)을 콘솔·프로세스 그룹에서 떼어 띄운다 — 핸들은 하나도 물려주지
    /// 않는다(모듈 문서). 환경 변수는 부모의 것을 그대로 받는다.
    ///
    /// 플래그: `DETACHED_PROCESS`(콘솔을 물려받지 않는다 — dev 빌드는 콘솔 서브시스템이다) ·
    /// `CREATE_NEW_PROCESS_GROUP`(부모 콘솔의 Ctrl+C·Ctrl+Break 가 닿지 않는다 — 유닉스의
    /// `process_group(0)` 자리) · [`super::super::CREATE_NO_WINDOW`](이 창구의 규칙. 분리
    /// 기동에서는 무시되지만 뺄 이유도 없다).
    pub fn spawn_detached(
        program: &Path,
        args: &[&OsStr],
        cwd: Option<&Path>,
    ) -> io::Result<Detached> {
        let wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().collect() };
        let nul_terminated = |s: &OsStr| -> io::Result<Vec<u16>> {
            let mut v = wide(s);
            if v.contains(&0) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "a path has a NUL",
                ));
            }
            v.push(0);
            Ok(v)
        };
        let application = nul_terminated(program.as_os_str())?;
        let args: Vec<Vec<u16>> = args.iter().map(|a| wide(a)).collect();
        let arg_refs: Vec<&[u16]> = args.iter().map(Vec::as_slice).collect();
        let mut line = super::command_line(&application[..application.len() - 1], &arg_refs)?;
        let dir = cwd.map(|d| nul_terminated(d.as_os_str())).transpose()?;

        // SAFETY: 모두 0 인 값은 이 C 구조체의 유효한 값이다.
        let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        // 표준 핸들 셋을 **비워서** 넘긴다(0 = NULL). 이 플래그가 없으면 OS 가 부모의 표준
        // 핸들 값을 옮겨 적을 수 있다 — 상속되지 않은 핸들 값은 자식에게 엉뚱한 것을 가리킨다.
        startup.dwFlags = STARTF_USESTDHANDLES;
        // SAFETY: 모두 0 인 값은 이 C 구조체의 유효한 값이다.
        let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let flags = super::super::CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // SAFETY: 문자열은 전부 NUL 로 끝나고 호출 동안 산다. 명령줄 버퍼는 CreateProcessW
        // 가 고쳐 쓸 수 있어 가변으로 넘긴다. bInheritHandles = FALSE(0).
        let ok = unsafe {
            CreateProcessW(
                application.as_ptr(),
                line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                flags,
                std::ptr::null(),
                dir.as_ref().map_or(std::ptr::null(), |d| d.as_ptr()),
                &startup,
                &mut info,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: 성공한 CreateProcessW 가 준 핸들 — 스레드 핸들은 쓰지 않으니 닫고,
        // 프로세스 핸들은 소유권을 넘겨받는다.
        unsafe { CloseHandle(info.hThread) };
        let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess as RawHandle) };
        Ok(Detached {
            process,
            pid: info.dwProcessId,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn line(program: &str, args: &[&str]) -> String {
        let args: Vec<Vec<u16>> = args.iter().map(|a| w(a)).collect();
        let refs: Vec<&[u16]> = args.iter().map(Vec::as_slice).collect();
        let mut out = command_line(&w(program), &refs).unwrap();
        assert_eq!(out.pop(), Some(0), "NUL 로 끝난다");
        String::from_utf16(&out).unwrap()
    }

    /// 호스트가 실제로 받는 모양 — 공백이 든 사용자 폴더 경로가 한 인자로 간다.
    #[test]
    fn host_command_line_quotes_paths_with_spaces() {
        assert_eq!(
            line(
                r"C:\Users\Kim Hyunbin\AppData\Local\ocul-pm\ptyhost\ocul-pm.exe",
                &[
                    "--pty-host",
                    r"C:\Users\Kim Hyunbin\AppData\Roaming\x\ptyhost.sock"
                ],
            ),
            r#""C:\Users\Kim Hyunbin\AppData\Local\ocul-pm\ptyhost\ocul-pm.exe" --pty-host "C:\Users\Kim Hyunbin\AppData\Roaming\x\ptyhost.sock""#
        );
    }

    /// MSVCRT 규칙 — 역슬래시는 `"` 앞과 닫는 따옴표 앞에서만 두 배가 된다.
    #[test]
    fn quoting_follows_the_msvcrt_rules() {
        assert_eq!(line("p", &["plain"]), r#""p" plain"#);
        assert_eq!(line("p", &[""]), r#""p" """#);
        assert_eq!(
            line("p", &[r"C:\dir\"]),
            r#""p" C:\dir\"#,
            "공백 없으면 그대로"
        );
        assert_eq!(line("p", &[r"C:\my dir\"]), r#""p" "C:\my dir\\""#);
        assert_eq!(line("p", &[r#"say "hi""#]), r#""p" "say \"hi\"""#);
        assert_eq!(line("p", &[r#"a\"b"#]), r#""p" "a\\\"b""#);
        assert_eq!(line("p", &["tab\there"]), "\"p\" \"tab\there\"");
        assert_eq!(line("p", &["한글 경로"]), "\"p\" \"한글 경로\"");
    }

    #[test]
    fn nul_and_quoted_programs_are_refused() {
        assert!(command_line(&w("a\"b"), &[]).is_err());
        assert!(command_line(&w("a\0b"), &[]).is_err());
        let bad = w("x\0y");
        assert!(command_line(&w("p"), &[bad.as_slice()]).is_err());
    }

    /// 자식 쪽에서 되읽으면 같은 인자다 — 호스트의 `std::env::args()` 가 쓰는
    /// `CommandLineToArgvW` 로 확인한다.
    #[cfg(windows)]
    #[test]
    fn windows_command_line_round_trips_through_command_line_to_argv() {
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::UI::Shell::CommandLineToArgvW;

        let args = [
            "--pty-host",
            r"C:\Users\Kim Hyunbin\AppData\ptyhost.sock",
            "",
            r"C:\trailing slash\",
            r#"quote"inside"#,
            r#"a\\"b c"#,
            "한글 인자",
        ];
        let owned: Vec<Vec<u16>> = args.iter().map(|a| w(a)).collect();
        let refs: Vec<&[u16]> = owned.iter().map(Vec::as_slice).collect();
        let program = r"C:\Program Files\ocul-pm\ocul-pm.exe";
        let line = command_line(&w(program), &refs).unwrap();
        let mut count = 0i32;
        // SAFETY: NUL 로 끝나는 버퍼. 돌려받은 배열은 LocalFree 로 한 번 푼다.
        let parsed: Vec<String> = unsafe {
            let argv = CommandLineToArgvW(line.as_ptr(), &mut count);
            assert!(!argv.is_null());
            let out = (0..count as usize)
                .map(|i| {
                    let p = *argv.add(i);
                    let len = (0..).take_while(|&j| *p.add(j) != 0).count();
                    String::from_utf16(std::slice::from_raw_parts(p, len)).unwrap()
                })
                .collect();
            LocalFree(argv as _);
            out
        };
        let mut want = vec![program.to_string()];
        want.extend(args.iter().map(|a| a.to_string()));
        assert_eq!(parsed, want);
    }

    /// 분리 기동한 자식이 도는 몸 — 평소에는 곧장 끝난다. **표준 출력이 없을 때**(=
    /// [`spawn_detached`] 로 떴다) 또는 대조군이 변수로 청할 때만 오래 산다.
    #[cfg(windows)]
    #[test]
    #[ignore = "windows_detached_child_does_not_hold_the_parents_pipe 가 자식으로 띄운다"]
    fn detached_sleeper() {
        use windows_sys::Win32::System::Console::{GetStdHandle, STD_OUTPUT_HANDLE};
        // SAFETY: 인자 없는 조회.
        let no_stdout = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }.is_null();
        if no_stdout || std::env::var_os("OCULPM_TEST_SLEEPER").is_some() {
            std::thread::sleep(std::time::Duration::from_secs(120));
        }
    }

    /// **분리 기동한 자식은 부모의 상속 가능한 파이프를 물지 않는다** (#pty-handle-inherit).
    ///
    /// dev·CI 의 모양 그대로 — 부모가 상속 가능한 파이프를 쥔 채 오래 사는 자식을 띄우고,
    /// 자기 쓰기 끝을 닫는다. 자식이 그 끝을 물지 않았으면 읽기가 곧 EOF 다. 대조군(std 의
    /// spawn — bInheritHandles = TRUE)은 자식이 사는 동안 EOF 가 오지 않고, 자식을 끝내야 온다
    /// — 이 테스트가 "물고 있음" 을 실제로 가려낸다는 증거다. 자식은 이 테스트 실행 파일의
    /// [`detached_sleeper`] 다(Rust 프로그램이 표준 핸들 없이 도는 것까지 호스트와 같다).
    #[cfg(windows)]
    #[test]
    fn windows_detached_child_does_not_hold_the_parents_pipe() {
        use std::ffi::OsStr;
        use std::time::Duration;

        let exe = std::env::current_exe().unwrap();
        let args = [
            OsStr::new("proc::detached::tests::detached_sleeper"),
            OsStr::new("--exact"),
            OsStr::new("--ignored"),
        ];

        // 대조군 — std 는 상속 가능한 핸들을 전부 넘긴다.
        let (read, write) = windows_pipe::inheritable();
        let mut control = crate::proc::std_cmd(&exe)
            .args(args)
            .env("OCULPM_TEST_SLEEPER", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        drop(write);
        let eof = windows_pipe::eof_signal(read);
        let held = eof.recv_timeout(Duration::from_secs(3)).is_err();
        let still_running = control.try_wait().unwrap().is_none();
        control.kill().unwrap();
        let _ = control.wait();
        assert!(
            still_running,
            "대조군 자식이 일찍 끝났다 — 이 테스트가 아무것도 가려내지 못한다"
        );
        assert!(
            held,
            "대조군(std spawn)이 파이프를 물지 않았다 — 이 테스트가 아무것도 가려내지 못한다"
        );
        eof.recv_timeout(Duration::from_secs(20))
            .expect("대조군 자식을 끝냈는데도 EOF 가 오지 않는다");

        // 분리 기동 — 물지 않는다.
        let (read, write) = windows_pipe::inheritable();
        let mut child = spawn_detached(&exe, &args, None).unwrap();
        drop(write);
        let eof = windows_pipe::eof_signal(read);
        // 동시에 도는 다른 테스트의 std spawn 이 잠깐 물 수는 있다 — 넉넉히 기다린다.
        let got = eof.recv_timeout(Duration::from_secs(20));
        let alive = child.try_wait().unwrap();
        child.kill().unwrap();
        let _ = child.wait();
        assert!(alive.is_none(), "분리 기동한 자식이 일찍 끝났다: {alive:?}");
        assert!(
            got.is_ok(),
            "분리 기동한 자식이 부모의 상속 가능한 파이프를 물고 있다 — 부모가 EOF 를 못 본다"
        );
    }

    #[cfg(windows)]
    mod windows_pipe {
        use std::fs::File;
        use std::io::Read;
        use std::os::windows::io::{FromRawHandle, OwnedHandle, RawHandle};
        use std::sync::mpsc::Receiver;

        use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
        use windows_sys::Win32::System::Pipes::CreatePipe;

        /// 양쪽 끝이 상속 가능한 익명 파이프 — dev·CI 에서 부모가 자식 출력을 받는 모양.
        pub fn inheritable() -> (File, OwnedHandle) {
            let attrs = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: std::ptr::null_mut(),
                bInheritHandle: 1,
            };
            let (mut read, mut write) = (std::ptr::null_mut(), std::ptr::null_mut());
            // SAFETY: 출력은 지역 변수, 속성은 크기를 맞춘 지역 구조체.
            assert_ne!(unsafe { CreatePipe(&mut read, &mut write, &attrs, 0) }, 0);
            // SAFETY: 방금 만든 두 핸들의 소유권을 넘겨받는다.
            unsafe {
                (
                    File::from_raw_handle(read as RawHandle),
                    OwnedHandle::from_raw_handle(write as RawHandle),
                )
            }
        }

        /// 읽기 끝이 EOF 를 보면 한 번 울린다. 읽기는 스레드에서 — 쓰기 끝을 문 프로세스가
        /// 끝나면 그 스레드도 풀린다.
        pub fn eof_signal(mut read: File) -> Receiver<()> {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut buf = [0u8; 64];
                // std 는 BROKEN_PIPE 를 0 바이트(EOF)로 읽는다.
                while matches!(read.read(&mut buf), Ok(n) if n > 0) {}
                let _ = tx.send(());
            });
            rx
        }
    }
}

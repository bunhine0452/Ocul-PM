//! Windows 에서 **콘솔 없이 뜬** 앱 exe 의 CLI 출력이 부모(셸)의 콘솔에 찍히는가
//! (크로스플랫폼 라운드 `#os-cli-console`, D1 — 러너가 실기기다).
//!
//! ## 무엇을 검증하나 — 정확히
//!
//! 사람이 cmd 에서 릴리스 exe 로 `ocul-pm config --help` 를 치는 상황의 출발 상태는
//! 둘이다: (1) 프로세스에 콘솔이 없다(GUI 서브시스템) (2) 표준 핸들이 비어 있다
//! (셸은 GUI 자식에게 표준 핸들을 넘기지 않는다). 이 테스트가 부르는 exe 는 **디버그
//! 빌드**라 `windows_subsystem` 이 꺼진 콘솔 서브시스템이다 — 그대로 띄우면 부모
//! 콘솔을 저절로 물려받아 아무것도 검증하지 못한다. 그래서 두 조건을 손으로 만든다:
//! `DETACHED_PROCESS`(콘솔을 물려받지 않는다) + 표준 핸들 null(Rust 의
//! `Stdio::inherit` 은 부모 핸들이 null 이면 null 을 그대로 넘긴다). PE 헤더의
//! 서브시스템 값만 다르고 `main` 이 보는 세계는 같다.
//!
//! 부모 쪽은 이 테스트 프로세스가 **자기만의 새 콘솔**을 만들어(`AllocConsole`) 맡고,
//! 자식이 끝난 뒤 그 콘솔 화면 버퍼를 `ReadConsoleOutputCharacterW` 로 읽어 출력이
//! 실제로 찍혔는지 본다 — 파이프로 받으면 붙기 경로 자체를 안 타므로 화면을 읽는다.
//!
//! 대조군: 같은 조건으로 띄운 `cmd /c echo` 의 출력은 **찍히지 않아야** 한다. 그래야
//! "조건을 만들었더니 원래 다 찍히더라" 가 아님을 안다.
//!
//! 검증하지 못하는 것: 셸이 GUI exe 를 기다리지 않아 프롬프트가 먼저 돌아오는 모습,
//! Windows Terminal 탭에서의 표시 — 사람 눈의 몫이다.
#![cfg(windows)]
#![allow(clippy::disallowed_methods)]

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::Console::{
    AllocConsole, AttachConsole, FreeConsole, GetConsoleScreenBufferInfo, GetStdHandle,
    ReadConsoleOutputCharacterW, SetStdHandle, ATTACH_PARENT_PROCESS, CONSOLE_SCREEN_BUFFER_INFO,
    COORD, STD_ERROR_HANDLE, STD_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::Threading::DETACHED_PROCESS;

const DEADLINE: Duration = Duration::from_secs(120);
const STD_IDS: [STD_HANDLE; 3] = [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE];

fn app_exe() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_ocul-pm"))
}

/// 테스트 프로세스의 콘솔·표준 핸들을 잠시 바꿔 끼우고, 끝나면(패닉이어도) 되돌린다.
/// 되돌리지 않으면 libtest 의 결과 줄이 새 콘솔로 새어 CI 로그에서 사라진다.
struct PrivateConsole {
    saved: [HANDLE; 3],
    had_console: bool,
}

impl PrivateConsole {
    fn open() -> Self {
        // SAFETY: 이 프로세스 자신의 표준 핸들을 읽기만 한다.
        let saved = STD_IDS.map(|id| unsafe { GetStdHandle(id) });
        // SAFETY: 인자 없는 시스템 호출. 이 테스트 파일은 테스트가 하나라 콘솔을
        // 바꾸는 동안 다른 테스트 스레드가 없다.
        let had_console = unsafe { FreeConsole() } != 0;
        // SAFETY: 위와 같음.
        let ok = unsafe { AllocConsole() } != 0;
        assert!(ok, "AllocConsole 실패: {}", std::io::Error::last_os_error());
        Self { saved, had_console }
    }

    /// 자식을 띄우는 동안만 표준 핸들을 비운다 — `Stdio::inherit` 이 null 을 넘기게.
    fn spawn_without_std_handles(&self, cmd: &mut Command) -> std::process::Child {
        for id in STD_IDS {
            // SAFETY: 자기 프로세스의 표준 핸들 표만 바꾼다 (Drop 에서 되돌린다).
            unsafe { SetStdHandle(id, std::ptr::null_mut()) };
        }
        let child = cmd
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .creation_flags(DETACHED_PROCESS)
            .spawn();
        self.restore_std_handles();
        child.expect("자식 실행")
    }

    fn restore_std_handles(&self) {
        for (id, h) in STD_IDS.into_iter().zip(self.saved) {
            // SAFETY: 처음에 읽어 둔 값을 되돌린다.
            unsafe { SetStdHandle(id, h) };
        }
    }

    /// 이 콘솔의 화면 버퍼에서 커서 줄까지의 글자 전부.
    fn screen_text(&self) -> String {
        let name: Vec<u16> = "CONOUT$".encode_utf16().chain(Some(0)).collect();
        // SAFETY: NUL 로 끝나는 이름, 보안 기술자·템플릿 없음.
        let out = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        assert!(
            !out.is_null() && out != INVALID_HANDLE_VALUE,
            "CONOUT$ 열기 실패: {}",
            std::io::Error::last_os_error()
        );
        // SAFETY: 모든 필드가 정수인 C 구조체 — 0 은 유효한 값이다.
        let mut info: CONSOLE_SCREEN_BUFFER_INFO = unsafe { std::mem::zeroed() };
        // SAFETY: 방금 연 화면 버퍼 핸들과 쓰기 가능한 구조체.
        let ok = unsafe { GetConsoleScreenBufferInfo(out, &mut info) } != 0;
        assert!(ok, "GetConsoleScreenBufferInfo 실패");
        let width = info.dwSize.X.max(1) as usize;
        let rows = (info.dwCursorPosition.Y as usize) + 1;
        let mut buf = vec![0u16; width * rows];
        let mut read = 0u32;
        // SAFETY: buf 는 width*rows 칸이고 그 길이를 넘긴다.
        let ok = unsafe {
            ReadConsoleOutputCharacterW(
                out,
                buf.as_mut_ptr(),
                buf.len() as u32,
                COORD { X: 0, Y: 0 },
                &mut read,
            )
        } != 0;
        // SAFETY: 위에서 연 핸들을 한 번 닫는다.
        unsafe { CloseHandle(out) };
        assert!(ok, "ReadConsoleOutputCharacterW 실패");
        buf.truncate(read as usize);
        // 줄 끝의 공백 채움을 걷어 사람이 읽을 수 있게.
        String::from_utf16_lossy(&buf)
            .chars()
            .collect::<Vec<_>>()
            .chunks(width)
            .map(|row| row.iter().collect::<String>().trim_end().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl Drop for PrivateConsole {
    fn drop(&mut self) {
        self.restore_std_handles();
        // SAFETY: 인자 없는/하나짜리 시스템 호출 — 실패해도 되돌릴 것이 없다.
        unsafe {
            FreeConsole();
            if self.had_console {
                AttachConsole(ATTACH_PARENT_PROCESS);
            }
        }
    }
}

fn wait_exit(mut child: std::process::Child, what: &str) -> Option<i32> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            return status.code();
        }
        if start.elapsed() > DEADLINE {
            let _ = child.kill();
            panic!("{what} 가 {DEADLINE:?} 안에 끝나지 않았다 — CLI 가 아니라 GUI 로 샜다");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn cli_output_reaches_the_parent_console_when_started_without_one() {
    let console = PrivateConsole::open();

    // 대조군 — 붙지 않는 프로그램의 출력은 이 조건에서 사라진다.
    let control = "OCULPM-CONTROL-7f3a";
    let mut cmd = Command::new("cmd");
    cmd.args(["/d", "/c", "echo", control]);
    let child = console.spawn_without_std_handles(&mut cmd);
    wait_exit(child, "cmd /c echo");

    // stdout 경로 — `config --help` 는 사용법을 stdout 에 찍고 0 으로 끝난다.
    let mut cmd = Command::new(app_exe());
    cmd.args(["config", "--help"]);
    let child = console.spawn_without_std_handles(&mut cmd);
    let help_code = wait_exit(child, "ocul-pm config --help");

    // stderr 경로 — 명령 없는 `config` 는 사용법을 stderr 에 찍고 2 로 끝난다.
    let mut cmd = Command::new(app_exe());
    cmd.args(["config"]);
    let child = console.spawn_without_std_handles(&mut cmd);
    let bare_code = wait_exit(child, "ocul-pm config");

    let screen = console.screen_text();
    drop(console);

    assert!(
        !screen.contains(control),
        "대조군이 찍혔다 — 콘솔 없는 자식이라는 조건이 성립하지 않는다:\n{screen}"
    );
    assert_eq!(help_code, Some(0), "config --help 종료 코드");
    assert_eq!(bare_code, Some(2), "config (명령 없음) 종료 코드");
    let usage_lines = screen.matches("usage: ocul-pm config").count();
    assert_eq!(
        usage_lines, 2,
        "stdout(--help)·stderr(명령 없음) 두 번의 사용법이 부모 콘솔에 찍혀야 한다:\n{screen}"
    );
}

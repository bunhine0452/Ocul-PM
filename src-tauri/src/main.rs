// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 심(`oculpm`)으로 불렸는가 — 이 사실 하나가 CLI 냐 GUI 냐를 가른다.
    // 낱말 판정보다 먼저 안다.
    let as_shim = ocul_pm_lib::oculpm::shim::invoked_as_shim(std::env::args().next().as_deref());

    // PTY 호스트 모드 — GUI 없이 터미널 세션만 소유하는 detach 프로세스.
    // 같은 실행파일을 쓰는 이유는 ptyhost/mod.rs 참고. 반드시 tauri 빌더가
    // 돌기 전에 분기해야 한다 (창·플러그인·DB 를 전혀 만들지 않는다).
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--pty-host" {
            let Some(socket) = args.next() else {
                eprintln!("usage: ocul-pm --pty-host <socket-path>");
                std::process::exit(2);
            };
            ocul_pm_lib::ptyhost::host::run_host(std::path::PathBuf::from(socket));
        }
        // 선언적 설정 CLI (#config-cli) — 같은 실행 파일, GUI 없음. PTY 호스트와
        // 같은 이유로 tauri 빌더보다 먼저 갈라진다 (창·플러그인을 만들지 않는다).
        if a == "config" {
            attach_console_for_cli();
            ocul_pm_lib::config::cli::run(args.collect());
        }
        // 에이전트 CLI (플랜 `session-shim-cli`) — 앱 이름으로 들어온 호출에서만
        // **도구 이름과 정확히 일치**할 때 갈라진다 (macOS 가 붙이는 `-psn_…`
        // 으로 앱이 헤드리스로 뜨면 사용자는 아이콘을 눌렀는데 아무것도 안 뜨는
        // 것을 본다). 심으로 들어온 호출은 여기서 낱말을 줍지 않고 루프 아래로
        // 흘려보낸다 — 낱말부터 자르면 그 앞의 `--project <path>` 가 함께
        // 잘려나가 **엉뚱한 프로젝트에 조용히 기록된다.**
        if !as_shim && ocul_pm_lib::oculpm::agent_cli::is_cli_verb(&a) {
            attach_console_for_cli();
            let mut argv = vec![a];
            argv.extend(args);
            ocul_pm_lib::oculpm::agent_cli::run(argv);
        }
    }
    // 심(`oculpm`)으로 들어온 호출은 **낱말이 무엇이든 CLI 다.** 위 루프가 못
    // 알아본 낱말을 여기서 GUI 로 흘려보내면 두 번째 앱 인스턴스가 뜬다 —
    // 전역 훅에 남은 `oculpm hook pretooluse` 가 편집마다 창을 띄우고 훅
    // 타임아웃에 죽는 것이 사용자가 본 "떴다가 알아서 꺼지는 창" 이었다.
    // 앱 바이너리 이름(`ocul-pm`)으로 들어온 호출은 그대로 GUI 로 간다 —
    // Finder 가 붙이는 `-psn_…` 이 앱을 헤드리스로 만들면 안 되기 때문이다.
    if as_shim {
        attach_console_for_cli();
        ocul_pm_lib::oculpm::agent_cli::run(std::env::args().skip(1).collect());
    }
    #[cfg(target_os = "macos")]
    reexec_with_malloc_tuning();
    ocul_pm_lib::run()
}

/// CLI 로 갈라지는 자리에서만 부른다 — GUI 로 뜰 때는 부르지 않는다 (#os-cli-console).
///
/// Windows 릴리스 exe 는 GUI 서브시스템(`windows_subsystem = "windows"`)이라
/// cmd·PowerShell 이 띄워도 콘솔을 받지 못한다. 표준 핸들이 비어 있고 Rust 는 빈
/// 핸들로의 쓰기를 **조용히 성공**으로 삼키므로, 사람이 `ocul-pm config --help` 를
/// 치면 아무것도 안 나온다. 그래서 CLI 분기 직전에 부모(셸)의 콘솔에 붙는다.
/// macOS·Linux 에서는 아무것도 하지 않는다.
fn attach_console_for_cli() {
    #[cfg(windows)]
    win_console::attach_parent_console();
}

/// 부모 콘솔에 붙기 — [`attach_console_for_cli`] 의 Windows 몸통.
///
/// **한계:** 셸은 GUI 서브시스템 exe 를 기다리지 않는다. cmd·PowerShell 은 곧장
/// 프롬프트를 돌려주고, 출력은 그 **뒤에** 찍힌다(프롬프트 아래로 흘러나온다).
/// 종료 코드도 셸의 `%ERRORLEVEL%`·`$LASTEXITCODE` 에 실리지 않는다. 기다리게
/// 하려면 `start /wait ocul-pm …`(cmd) · `Start-Process -Wait`(PowerShell), 또는
/// 출력을 파이프로 받는다(`… | more`) — 파이프면 표준 핸들이 이미 있어 여기서
/// 붙지 않고, 셸은 파이프가 닫힐 때까지 기다린다. 이것을 없애려면 콘솔 서브시스템
/// 바이너리를 따로 싣는 수밖에 없다 (플랜 {#os-cli-console} 의 후속 검토).
///
/// 표준 핸들을 **넘겨받은** 호출(에이전트 훅 · 스크립트의 파이프·파일 리다이렉트)은
/// 건드리지 않는다 — stdout·stderr 가 둘 다 살아 있으면 붙지도 않는다. 하나만
/// 리다이렉트됐으면(`> out.toml`) 그 핸들은 그대로 두고 빈 쪽만 콘솔로 연다.
/// stdin 은 언제나 원래 값으로 둔다 — 콘솔 입력을 열면 셸과 같은 키 입력을 두고
/// 다투고, 훅처럼 stdin 을 읽는 명령이 사람 앞에서 멈춘다(예전처럼 EOF 가 낫다).
#[cfg(windows)]
mod win_console {
    use windows_sys::Win32::Foundation::{
        GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
        STD_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    fn usable(h: HANDLE) -> bool {
        !h.is_null() && h != INVALID_HANDLE_VALUE
    }

    fn std_handle(which: STD_HANDLE) -> HANDLE {
        // SAFETY: 인자만 읽는 조회다. 실패하면 null·INVALID 를 돌려줄 뿐이다.
        unsafe { GetStdHandle(which) }
    }

    pub fn attach_parent_console() {
        let stdin = std_handle(STD_INPUT_HANDLE);
        let stdout = std_handle(STD_OUTPUT_HANDLE);
        let stderr = std_handle(STD_ERROR_HANDLE);
        if usable(stdout) && usable(stderr) {
            return;
        }
        // 부모에게 콘솔이 없으면(탐색기 · 작업 스케줄러 · 이미 콘솔이 있는 디버그
        // 빌드) 실패한다 — 그때는 예전 그대로 둔다.
        // SAFETY: 인자 하나짜리 시스템 호출. 실패는 반환값으로만 알린다.
        if unsafe { AttachConsole(ATTACH_PARENT_PROCESS) } == 0 {
            return;
        }
        // AttachConsole 이 표준 핸들을 채우는지는 Windows 판마다 다르다 — 채웠든
        // 안 채웠든 같은 끝 상태가 되게 명시적으로 맞춘다.
        // SAFETY: 이 프로세스 자신의 표준 핸들 표를 바꾼다. 아직 다른 스레드가 없다.
        unsafe { SetStdHandle(STD_INPUT_HANDLE, stdin) };
        point_at_console(STD_OUTPUT_HANDLE, stdout);
        point_at_console(STD_ERROR_HANDLE, stderr);
    }

    /// 원래 살아 있던 핸들은 되돌려 두고, 비어 있던 것만 콘솔 화면 버퍼로 연다.
    fn point_at_console(which: STD_HANDLE, before: HANDLE) {
        if usable(before) {
            // SAFETY: 원래 값을 되돌린다 (위와 같음).
            unsafe { SetStdHandle(which, before) };
            return;
        }
        if usable(std_handle(which)) {
            return;
        }
        let name: Vec<u16> = "CONOUT$".encode_utf16().chain(Some(0)).collect();
        // SAFETY: NUL 로 끝나는 UTF-16 이름, 보안 기술자·템플릿 없음. 실패하면
        // INVALID_HANDLE_VALUE 가 돌아오고 아래에서 걸러진다.
        let handle = unsafe {
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
        if usable(handle) {
            // SAFETY: 방금 연 콘솔 핸들을 표준 핸들로 건다 — 프로세스가 끝날 때까지 쓴다.
            unsafe { SetStdHandle(which, handle) };
        }
    }
}

/// GUI 프로세스만 `MallocLargeCache=0` 으로 자기 자신을 다시 exec 한다
/// (`{#embed-unload}`, 2026-09-12, perf_baseline M6/M6b) — **launchd 가 띄운
/// 프로세스는 제외** (2026-09-15, macOS 27).
///
/// macOS libmalloc 은 free 된 **대형 블록을 프로세스가 죽을 때까지 dirty 로
/// 쥔다** — `malloc_zone_pressure_relief` 도 이 캐시는 안 비운다(0 바이트).
/// 임베딩 모델 로드 하나가 풋프린트 602MB 를 남기는데 그중 살아 있는 건
/// 237MB 였고, 세션을 내려도 645MB 가 그대로였다. 캐시를 끄면 로드 237MB ·
/// 내린 뒤 38MB 다 (임베딩 속도는 −8%). 이 변수는 malloc 초기화 때만 읽으므로
/// 프로세스 안에서 켤 방법이 없어 exec 로 다시 뜬다 — 창·플러그인·DB 가
/// 만들어지기 전이라 되돌릴 것이 없고, 인자(`-psn_…` 포함)는 그대로 넘긴다.
///
/// **macOS 27 은 이 re-exec 가 메뉴바 아이콘을 없앤다.** 메뉴바가 창 하나로
/// 합쳐지면서 상태 아이템은 FrontBoard 씬(`com.apple.appkit.status-items`)으로
/// 호스팅되고, MenuBarAgent 는 연결해 온 프로세스를 RunningBoard 의
/// (pid, pidversion) 핸들로 찾는다. exec 는 pid 를 지키지만 **pidversion 을
/// 올리므로** LaunchServices 가 기동 시점에 잡아 둔 핸들과 어긋나 씬 배정이
/// 거부된다 — 로그에 `RunningBoardServices: handle has mismatched pid version`
/// → `FrontBoard: Unable to assign new incoming connection to a process` 가
/// 찍히고 아이콘은 `«` 접힘 없이 그냥 없다. 터미널이 띄운 프로세스(dev 빌드)는
/// 기동 핸들이 없어 멀쩡했기에 재현이 늦었다. 그래서 launchd 자식(ppid 1 =
/// Dock·Finder·`open`·로그인 항목)에서는 exec 하지 않는다 — 그 경로는 번들
/// `Info.plist` 의 `LSEnvironment` 가 프로세스 생성 시점에 같은 변수를 넣어
/// 주므로 위의 `KEY` 검사에서 이미 돌아간다. 이 가드는 LSEnvironment 가 빠진
/// 번들에서의 실패 모드를 "아이콘 실종" 대신 "튜닝 생략" 으로 바꾸는 보험이다.
///
/// PTY 호스트·MCP 는 이 프로세스의 자식이라 저절로 물려받는다. 사용자 셸에는
/// 새면 안 되므로 호스트가 셸을 띄울 때 `OCULPM_MALLOC_TUNED` 표식과 함께
/// 걷어낸다 (`ptyhost/host`). 심·CLI 는 매 훅 호출마다 exec 를 하나 더 얹을
/// 이유가 없어 여기 오지 않는다 (위에서 이미 갈라졌다).
#[cfg(target_os = "macos")]
fn reexec_with_malloc_tuning() {
    use std::os::unix::process::CommandExt;
    const KEY: &str = "MallocLargeCache";
    let already_tuned = std::env::var_os(KEY).is_some();
    let opted_out = std::env::var_os("OCULPM_NO_MALLOC_REEXEC").is_some();
    // SAFETY: getppid 는 인자 없는 단순 시스템 콜이며 실패하지 않는다.
    let ppid = unsafe { libc::getppid() };
    if !should_reexec(already_tuned, opted_out, ppid) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // exec 는 성공하면 돌아오지 않는다. 실패하면 튜닝 없이 그냥 계속 — 앱이
    // 못 뜨는 것보다 600MB 더 쓰는 쪽이 낫다.
    let err = ocul_pm_lib::proc::std_cmd(exe)
        .args(std::env::args_os().skip(1))
        .env(KEY, "0")
        .env("OCULPM_MALLOC_TUNED", "1")
        .exec();
    eprintln!("malloc tuning re-exec failed, continuing without it: {err}");
}

/// re-exec 판정 — 순수 함수라 프로세스 없이 단위 테스트한다.
/// `ppid == 1` 은 launchd 자식, 즉 LaunchServices 가 띄운 앱이다.
#[cfg(target_os = "macos")]
fn should_reexec(already_tuned: bool, opted_out: bool, ppid: libc::pid_t) -> bool {
    !already_tuned && !opted_out && ppid != 1
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::should_reexec;

    /// macOS 27 회귀 방지 — launchd 가 띄운 프로세스는 무슨 일이 있어도 exec 로
    /// 다시 뜨지 않는다 (pidversion 이 바뀌면 메뉴바 아이콘이 사라진다).
    #[test]
    fn never_reexecs_under_launchd() {
        assert!(!should_reexec(false, false, 1));
        assert!(!should_reexec(true, false, 1));
        assert!(!should_reexec(false, true, 1));
    }

    /// 터미널·`tauri dev`·재시작 자식은 예전처럼 튜닝을 건다.
    #[test]
    fn reexecs_only_when_untuned_and_not_opted_out() {
        assert!(should_reexec(false, false, 4242));
        assert!(
            !should_reexec(true, false, 4242),
            "LSEnvironment 가 이미 걸었다"
        );
        assert!(!should_reexec(false, true, 4242), "OCULPM_NO_MALLOC_REEXEC");
    }
}

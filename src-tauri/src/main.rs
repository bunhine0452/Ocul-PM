// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
            ocul_pm_lib::config::cli::run(args.collect());
        }
        // 에이전트 CLI (플랜 `session-shim-cli`) — 심 디렉터리가 이 실행 파일로
        // 건 `oculpm` 심링크가 여기로 들어온다. **도구 이름과 정확히 일치**할
        // 때만 갈라진다 (macOS 가 붙이는 `-psn_…` 으로 앱이 헤드리스로 뜨면
        // 사용자는 아이콘을 눌렀는데 아무것도 안 뜨는 것을 본다).
        if ocul_pm_lib::oculpm::agent_cli::is_cli_verb(&a) {
            let mut argv = vec![a];
            argv.extend(args);
            ocul_pm_lib::oculpm::agent_cli::run(argv);
        }
    }
    ocul_pm_lib::run()
}

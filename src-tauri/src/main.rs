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
    }
    ocul_pm_lib::run()
}

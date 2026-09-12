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
            ocul_pm_lib::config::cli::run(args.collect());
        }
        // 에이전트 CLI (플랜 `session-shim-cli`) — 앱 이름으로 들어온 호출에서만
        // **도구 이름과 정확히 일치**할 때 갈라진다 (macOS 가 붙이는 `-psn_…`
        // 으로 앱이 헤드리스로 뜨면 사용자는 아이콘을 눌렀는데 아무것도 안 뜨는
        // 것을 본다). 심으로 들어온 호출은 여기서 낱말을 줍지 않고 루프 아래로
        // 흘려보낸다 — 낱말부터 자르면 그 앞의 `--project <path>` 가 함께
        // 잘려나가 **엉뚱한 프로젝트에 조용히 기록된다.**
        if !as_shim && ocul_pm_lib::oculpm::agent_cli::is_cli_verb(&a) {
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
        ocul_pm_lib::oculpm::agent_cli::run(std::env::args().skip(1).collect());
    }
    #[cfg(target_os = "macos")]
    reexec_with_malloc_tuning();
    ocul_pm_lib::run()
}

/// GUI 프로세스만 `MallocLargeCache=0` 으로 자기 자신을 다시 exec 한다
/// (`{#embed-unload}`, 2026-09-12, perf_baseline M6/M6b).
///
/// macOS libmalloc 은 free 된 **대형 블록을 프로세스가 죽을 때까지 dirty 로
/// 쥔다** — `malloc_zone_pressure_relief` 도 이 캐시는 안 비운다(0 바이트).
/// 임베딩 모델 로드 하나가 풋프린트 602MB 를 남기는데 그중 살아 있는 건
/// 237MB 였고, 세션을 내려도 645MB 가 그대로였다. 캐시를 끄면 로드 237MB ·
/// 내린 뒤 38MB 다 (임베딩 속도는 −8%). 이 변수는 malloc 초기화 때만 읽으므로
/// 프로세스 안에서 켤 방법이 없어 exec 로 다시 뜬다 — 창·플러그인·DB 가
/// 만들어지기 전이라 되돌릴 것이 없고, 인자(`-psn_…` 포함)는 그대로 넘긴다.
///
/// PTY 호스트·MCP 는 이 프로세스의 자식이라 저절로 물려받는다. 사용자 셸에는
/// 새면 안 되므로 호스트가 셸을 띄울 때 `OCULPM_MALLOC_TUNED` 표식과 함께
/// 걷어낸다 (`ptyhost/host`). 심·CLI 는 매 훅 호출마다 exec 를 하나 더 얹을
/// 이유가 없어 여기 오지 않는다 (위에서 이미 갈라졌다).
#[cfg(target_os = "macos")]
fn reexec_with_malloc_tuning() {
    use std::os::unix::process::CommandExt;
    const KEY: &str = "MallocLargeCache";
    if std::env::var_os(KEY).is_some() || std::env::var_os("OCULPM_NO_MALLOC_REEXEC").is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // exec 는 성공하면 돌아오지 않는다. 실패하면 튜닝 없이 그냥 계속 — 앱이
    // 못 뜨는 것보다 600MB 더 쓰는 쪽이 낫다.
    let err = std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .env(KEY, "0")
        .env("OCULPM_MALLOC_TUNED", "1")
        .exec();
    eprintln!("malloc tuning re-exec failed, continuing without it: {err}");
}

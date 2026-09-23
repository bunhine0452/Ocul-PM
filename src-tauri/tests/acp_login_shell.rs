//! PR-ACP1 — 패키징된 `.app` 의 빈약한 PATH 시나리오 (docs/acp-panel/00-master-plan.md D2).
//!
//! **별도 테스트 바이너리인 이유**: 이 테스트는 프로세스 전역인 `PATH` 를 건드린다.
//! 같은 바이너리 안의 다른 테스트와 병렬로 돌면 서로를 오염시키므로, cargo 가
//! 파일 단위로 프로세스를 분리해 준다는 성질에 기대어 격리한다.
//!
//! 재현하는 상황: Finder 에서 띄운 `.app` 은 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin`
//! 뿐이라 fnm·nvm·homebrew 의 node 가 안 보인다. 그때 로그인 셸 폴백이 실제로
//! 구조하는지 — 이게 깨지면 개발 중엔 멀쩡하다가 릴리스에서만 터진다.
//!
//! ```bash
//! cargo test --test acp_login_shell -- --ignored --nocapture
//! ```
//!
//! 무시되지 않는 테스트는 OS 별 실제 동작을 러너에서 본다 (크로스플랫폼 라운드
//! `#shell-env`): 유닉스는 `-lic` 가 진짜 bash/zsh 의 rc 를 읽어 PATH 를 받아
//! 오는지, Windows 는 셸을 띄우지 않고 `PATHEXT` 로 `.exe`·`.cmd` 를 찾는지.

use ocul_pm_lib::acp::env::{self, PathSource};

/// Finder 가 물려주는 것과 같은 최소 PATH.
const BARE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// 프로세스 전역 환경(PATH·HOME)을 만지는 테스트끼리 줄 세운다.
static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 유닉스 — 진짜 셸을 `-lic` 로 띄워 **rc 가 만든** PATH 를 받아 온다.
///
/// 임시 HOME 의 rc 가 PATH 앞에 표식 디렉터리를 붙이게 하고, 캡처한 PATH 에 그
/// 표식이 있는지 본다. bash 는 로그인 셸이라 `.bash_profile` 을, zsh 는 `-i`
/// 덕에 `.zshrc` 를 읽는다 — nvm·fnm 이 훅을 거는 자리가 거기다.
#[cfg(unix)]
#[tokio::test]
async fn login_shell_capture_reads_the_real_rc_files() {
    let _guard = ENV_LOCK.lock().await;
    let home = tempfile::tempdir().unwrap();
    std::fs::write(
        home.path().join(".bash_profile"),
        "export PATH=\"/oculpm-marker-bash-profile:$PATH\"\n",
    )
    .unwrap();
    std::fs::write(
        home.path().join(".zshrc"),
        "export PATH=\"/oculpm-marker-zshrc:$PATH\"\n",
    )
    .unwrap();
    let real_home = std::env::var_os("HOME");
    std::env::set_var("HOME", home.path());

    let mut checked = Vec::new();
    for (shell, marker) in [
        ("/bin/bash", "/oculpm-marker-bash-profile"),
        ("/bin/zsh", "/oculpm-marker-zshrc"),
        ("/usr/bin/zsh", "/oculpm-marker-zshrc"),
    ] {
        if !std::path::Path::new(shell).is_file() || checked.contains(&marker) {
            continue;
        }
        let path = env::capture_login_path(shell).await;
        let path = path.unwrap_or_else(|| panic!("{shell} -lic 로 PATH 를 못 받았다"));
        assert!(
            std::env::split_paths(&path).any(|p| p == std::path::Path::new(marker)),
            "{shell}: rc 가 붙인 {marker} 가 없다 — {path}"
        );
        checked.push(marker);
    }

    match real_home {
        Some(h) => std::env::set_var("HOME", h),
        None => std::env::remove_var("HOME"),
    }
    assert!(
        checked.contains(&"/oculpm-marker-bash-profile"),
        "bash 가 없다"
    );
    if !checked.contains(&"/oculpm-marker-zshrc") {
        eprintln!("skip: 이 러너에 zsh 가 없다 — bash 만 확인");
    }
}

/// Windows — 셸을 띄우지 않는다(프로세스 PATH 가 곧 사용자 PATH). 이름 탐색은
/// `PATHEXT` 를 따라 `cmd` → `cmd.exe`, npm 이 까는 `npm` → `npm.cmd` 를 찾는다.
#[cfg(windows)]
#[tokio::test]
async fn windows_resolves_by_pathext_without_a_login_shell() {
    let _guard = ENV_LOCK.lock().await;
    assert_eq!(env::capture_login_path("powershell.exe").await, None);

    let (cmd, source) = env::resolve_binary("cmd")
        .await
        .expect("cmd.exe 를 못 찾았다");
    assert_eq!(source, PathSource::Process);
    assert!(
        cmd.to_string_lossy()
            .to_ascii_lowercase()
            .ends_with("cmd.exe"),
        "{}",
        cmd.display()
    );

    match env::resolve_binary("npm").await {
        Some((npm, PathSource::Process)) => {
            let lower = npm.to_string_lossy().to_ascii_lowercase();
            assert!(
                lower.ends_with("npm.cmd") || lower.ends_with("npm.exe"),
                "{lower}"
            );
        }
        other => assert!(
            std::env::var_os("CI").is_none(),
            "CI 러너에는 npm 이 있어야 한다 — {other:?}"
        ),
    }

    // DAP 의 `find_program` 은 Windows 에서 `<이름>.exe` 를 먼저 찾는다 — PATH 를
    // `:` 로 자르던 때에는 이것이 늘 실패해 `dap::registry` 의 테스트가 조용히 건너뛰었다.
    // 그 전제(러너 PATH 의 cargo 가 절대경로 `cargo.exe` 로 찾힌다)를 여기서 못박는다.
    for name in ["cargo.exe", "cargo"] {
        let found = env::resolve_binary(name).await;
        use std::io::Write as _;
        let _ = writeln!(std::io::stderr(), "[resolve_binary] {name} -> {found:?}");
        match found {
            Some((cargo, PathSource::Process)) => {
                assert!(cargo.is_absolute(), "{cargo:?}");
                assert!(
                    cargo
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .ends_with("cargo.exe"),
                    "{cargo:?}"
                );
            }
            other => assert!(
                std::env::var_os("CI").is_none(),
                "CI 러너 PATH 에는 cargo 가 있어야 한다 — {name}: {other:?}"
            ),
        }
    }

    // 로그인 셸을 이어 붙이지 않는다 — 자식에게는 프로세스 PATH 그대로.
    assert_eq!(
        env::effective_path().await,
        std::env::var("PATH").unwrap_or_default()
    );
    assert!(env::resolve_binary("oculpm-surely-not-on-path-7f3a")
        .await
        .is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "외부 의존(로그인 셸·Node 설치) — 수동 실행 전용"]
async fn login_shell_rescues_node_when_process_path_is_bare() {
    let _guard = ENV_LOCK.lock().await;
    // 전제 확인: 이 머신엔 node 가 있고, 그게 시스템 경로 밖에 있다.
    // (시스템 node 를 쓰는 머신이라면 폴백을 검증할 수 없으므로 건너뛴다.)
    let Some((real, _)) = env::resolve_binary("node").await else {
        eprintln!("skip: 이 머신에 node 가 없다");
        return;
    };
    if env::search_path(BARE_PATH, "node").is_some() {
        eprintln!("skip: node 가 시스템 경로({BARE_PATH})에 있어 폴백을 검증할 수 없다");
        return;
    }
    eprintln!("실제 node = {}", real.display());

    std::env::set_var("PATH", BARE_PATH);

    let resolved = env::resolve_binary("node").await;

    let (path, source) = resolved.expect(
        "빈약한 PATH 에서 node 를 못 찾았다 — 로그인 셸 폴백이 동작하지 않으면 \
         패키징된 .app 에서 에이전트가 뜨지 않는다",
    );
    assert_eq!(
        source,
        PathSource::LoginShell,
        "프로세스 PATH 엔 없으니 로그인 셸에서 찾았다고 보고해야 한다"
    );
    assert_eq!(path, real, "폴백이 찾은 node 는 평소 쓰던 것과 같아야 한다");

    // 자식에게 물려줄 PATH 에도 로그인 셸 몫이 들어가야 어댑터가 claude 를 찾는다.
    let effective = env::effective_path().await;
    assert!(
        env::search_path(&effective, "node").is_some(),
        "effective_path 가 node 를 잃어버렸다"
    );
}

//! 세션 심(`oculpm`)을 **빌드된 앱 바이너리**로 실제로 걸고 실행한다
//! (크로스플랫폼 라운드 `#shell-shim`, D1 — 러너가 실기기다).
//!
//! 확인하는 것:
//! - 심 이름으로 들어온 호출은 낱말이 무엇이든 **CLI 로 끝난다** — 모르는 낱말도
//!   GUI(두 번째 앱 인스턴스)로 새지 않고 종료코드 1. Windows 는 셸이 넘기는
//!   `…\oculpm.exe` 가 그 이름이다.
//! - 환경변수 토큰이 있으면 그것으로, 없으면 심 **옆** 토큰으로 신원을 찾는다.
//! - Windows 는 심을 거는 세 방식(심링크 · 하드 링크 · 복사본) 전부가 CLI 로 돈다
//!   — 러너는 관리자라 `install` 이 심링크를 고르므로 나머지 둘은 손으로 건다.
#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};
use std::process::{Child, Output, Stdio};
use std::time::{Duration, Instant};

use ocul_pm_lib::oculpm::shim::{self, SessionToken};

/// 디버그 앱 바이너리 콜드 스타트 여유. 넘기면 GUI 로 샜다고 본다.
const DEADLINE: Duration = Duration::from_secs(120);

fn app_exe() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_ocul-pm"))
}

fn token(root: &Path) -> SessionToken {
    SessionToken {
        project_root: root.display().to_string(),
        agent_id: Some("claude-code".into()),
        session_id: Some("shim-cli-test".into()),
    }
}

/// 심을 실행하고 끝나기를 기다린다. 시간이 넘으면 죽이고 실패 — CLI 는 즉시 끝난다.
fn run(program: &Path, args: &[&str], env_token: Option<&Path>, cwd: &Path) -> Output {
    let mut cmd = ocul_pm_lib::proc::std_cmd(program);
    cmd.args(args)
        .current_dir(cwd)
        .env_remove(shim::ENV_TOKEN)
        .env_remove("APPIMAGE")
        .env_remove("ARGV0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(t) = env_token {
        cmd.env(shim::ENV_TOKEN, t);
    }
    let child = cmd.spawn().expect("심 실행");
    wait(child, program)
}

fn wait(mut child: Child, program: &Path) -> Output {
    let start = Instant::now();
    loop {
        if child.try_wait().expect("try_wait").is_some() {
            return child.wait_with_output().expect("출력");
        }
        if start.elapsed() > DEADLINE {
            let _ = child.kill();
            let out = child.wait_with_output().ok();
            panic!(
                "{} 가 {DEADLINE:?} 안에 끝나지 않았다 — 심 이름을 못 알아보고 GUI 로 샜다. {out:?}",
                program.display()
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn whoami(program: &Path, env_token: Option<&Path>, cwd: &Path) -> serde_json::Value {
    let out = run(program, &["whoami"], env_token, cwd);
    assert!(
        out.status.success(),
        "{}: whoami 실패 — {out:?}",
        program.display()
    );
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "{}: whoami 가 JSON 이 아니다 ({e}) — {}",
            program.display(),
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

/// 심 하나(`program`)에 대해 CLI 계약 세 가지를 본다.
fn assert_shim_is_the_cli(program: &Path, token_path: &Path, root: &Path, label: &str) {
    let elsewhere = tempfile::tempdir().unwrap();

    // 모르는 낱말 — CLI 의 "unknown tool"(1). GUI 로 샜다면 여기서 매달리거나 다른 코드.
    let out = run(program, &["definitely-not-a-tool"], None, elsewhere.path());
    assert_eq!(out.status.code(), Some(1), "{label}: {out:?}");
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("unknown tool"),
        "{label}: {out:?}"
    );

    // 환경변수 토큰.
    let with_env = whoami(program, Some(token_path), elsewhere.path());
    assert_eq!(with_env["verified_session"], true, "{label}: {with_env}");
    assert_eq!(
        with_env["project_root"],
        root.display().to_string(),
        "{label}: {with_env}"
    );

    // 환경변수가 벗겨져도 심 옆 토큰 — argv0 가 심의 전체 경로다.
    let beside = whoami(program, None, elsewhere.path());
    assert_eq!(beside["verified_session"], true, "{label}: {beside}");
    assert_eq!(beside["agent_id"], "claude-code", "{label}: {beside}");
}

#[test]
fn the_installed_shim_runs_the_cli_not_the_gui() {
    let app_data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let (installed, kind) = shim::install_pointing_at(
        app_data.path(),
        "shim-cli",
        &token(project.path()),
        &app_exe(),
    )
    .expect("심 설치");
    eprintln!("심 방식: {kind:?}");
    let name = if cfg!(windows) {
        "oculpm.exe"
    } else {
        "oculpm"
    };
    let program = installed.dir.join(name);
    assert!(program.exists(), "{}", program.display());
    assert_shim_is_the_cli(&program, &installed.token_path, project.path(), "install");
}

/// 개발자 모드가 아닌 사용자의 Windows 는 심링크가 안 된다 — 그때 타는 하드 링크와,
/// 다른 볼륨일 때의 복사본도 같은 CLI 로 돈다.
///
/// 하드 링크는 같은 볼륨에서만 된다(러너는 작업 폴더 `D:` · `%TEMP%` `C:` 라 첫
/// 실행이 `CrossesDevices` 였다) — 하드 링크 심은 앱 바이너리 옆 볼륨에, 복사본
/// 심은 `%TEMP%` 에 둔다. 앱은 `%APPDATA%` 와 설치 폴더가 같은 볼륨이면 하드 링크,
/// 다르면 복사본으로 물러난다.
#[cfg(windows)]
#[test]
fn windows_hard_link_and_copy_shims_run_the_cli() {
    let exe = app_exe();
    let same_volume = tempfile::Builder::new()
        .prefix("oculpm-shim-")
        .tempdir_in(exe.parent().unwrap())
        .unwrap();
    let other_volume = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for (sid, how, app_data) in [
        ("shim-hard", "hard link", same_volume.path()),
        ("shim-copy", "copy", other_volume.path()),
    ] {
        let (installed, _) = shim::install_pointing_at(app_data, sid, &token(project.path()), &exe)
            .expect("심 설치");
        let program = installed.dir.join("oculpm.exe");
        std::fs::remove_file(&program).unwrap();
        if how == "hard link" {
            std::fs::hard_link(&exe, &program).expect("하드 링크");
        } else {
            std::fs::copy(&exe, &program).expect("복사본");
        }
        assert_shim_is_the_cli(&program, &installed.token_path, project.path(), how);
    }
}

/// 앱 이름으로 들어온 알려진 낱말(`whoami`)은 CLI 지만, 심 옆 토큰은 줍지 않는다 —
/// 신원은 심을 거친 호출만의 것이다.
#[test]
fn the_app_name_does_not_pick_up_a_shim_token() {
    let project = tempfile::tempdir().unwrap();
    let out = run(&app_exe(), &["whoami"], None, project.path());
    assert!(out.status.success(), "{out:?}");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["verified_session"], false, "{v}");
}

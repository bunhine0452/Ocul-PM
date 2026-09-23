//! 셸 통합 단위 테스트 — 판정·rc 블록·설치/제거·스크립트 정적 규칙.
//! 진짜 셸을 띄우는 테스트는 `live_tests.rs`.

use super::*;

fn temp_locations(root: &Path) -> RcLocations {
    RcLocations {
        home: root.join("home"),
        documents: Some(root.join("Documents")),
        config: Some(root.join("config")),
    }
}

/// 테스트용 정책 조회 — 막지 않는 값.
fn remote_signed(_: &str) -> Option<String> {
    Some("RemoteSigned".to_string())
}

#[test]
fn detects_zsh_from_common_shell_paths() {
    for path in ["/bin/zsh", "/usr/local/bin/zsh", "-zsh", "zsh"] {
        assert_eq!(detect_shell_kind(path), ShellKind::Zsh, "{path}");
    }
}

#[test]
fn detects_bash_including_versioned_and_sh() {
    for path in [
        "/bin/bash",
        "/opt/homebrew/bin/bash-5.2",
        "-bash",
        "/bin/sh",
    ] {
        assert_eq!(detect_shell_kind(path), ShellKind::Bash, "{path}");
    }
}

#[test]
fn unsupported_shells_are_skipped_not_guessed() {
    for os in [HostOs::MacOs, HostOs::Linux, HostOs::Windows] {
        for path in [
            "/opt/homebrew/bin/fish",
            "/usr/bin/nu",
            r"C:\Windows\system32\cmd.exe",
            "",
        ] {
            assert_eq!(
                detect_shell_kind_for(os, path),
                ShellKind::Unsupported,
                "{os:?} {path}"
            );
        }
    }
}

/// PowerShell 은 Windows·Linux 에서만 지원이다. macOS 는 예전처럼 미지원 (D3).
#[test]
fn powershell_is_supported_off_macos_only() {
    let paths = [
        r"C:\Program Files\PowerShell\7\pwsh.exe",
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        "/usr/bin/pwsh",
        "pwsh.exe",
    ];
    for path in paths {
        assert_eq!(
            detect_shell_kind_for(HostOs::Windows, path),
            ShellKind::PowerShell,
            "{path}"
        );
        assert_eq!(
            detect_shell_kind_for(HostOs::Linux, path),
            ShellKind::PowerShell,
            "{path}"
        );
        assert_eq!(
            detect_shell_kind_for(HostOs::MacOs, path),
            ShellKind::Unsupported,
            "{path}"
        );
    }
}

/// rc 에 심는 줄은 OCULPM_SHELL_INTEGRATION 이 없으면 아무 일도 하면 안 된다
/// — 사용자의 다른 터미널을 건드리지 않는다는 설계의 핵심.
#[test]
fn rc_block_is_inert_without_the_env_var() {
    for kind in [ShellKind::Zsh, ShellKind::Bash, ShellKind::PowerShell] {
        let body = rc_block_body(kind);
        assert!(body.contains("OCULPM_SHELL_INTEGRATION"));
        // 가드 없이 무조건 실행되는 줄이 섞여 있으면 안 된다.
        for line in body.lines().filter(|l| !l.trim_start().starts_with('#')) {
            assert!(
                line.contains("OCULPM_SHELL_INTEGRATION"),
                "{kind:?} 가드 없는 실행 줄: {line}"
            );
        }
    }
    let posix = rc_block_body(ShellKind::Bash);
    assert!(posix.contains("[ -n \"$OCULPM_SHELL_INTEGRATION\" ]"));
    assert!(posix.contains("[ -r \"$OCULPM_SHELL_INTEGRATION\" ]"));
}

#[test]
fn materialize_is_idempotent_and_skips_rewrite() {
    let dir = tempfile::tempdir().unwrap();
    for kind in [ShellKind::Zsh, ShellKind::PowerShell] {
        let first = materialize_script(dir.path(), kind).unwrap().unwrap();
        let mtime1 = std::fs::metadata(&first).unwrap().modified().unwrap();
        let second = materialize_script(dir.path(), kind).unwrap().unwrap();
        assert_eq!(first, second);
        let mtime2 = std::fs::metadata(&second).unwrap().modified().unwrap();
        assert_eq!(mtime1, mtime2, "내용이 같으면 다시 쓰지 않아야 한다");
    }
    assert!(materialize_script(dir.path(), ShellKind::PowerShell)
        .unwrap()
        .unwrap()
        .ends_with("oculpm.ps1"));
}

#[test]
fn materialize_returns_none_for_unsupported_shell() {
    let dir = tempfile::tempdir().unwrap();
    assert!(materialize_script(dir.path(), ShellKind::Unsupported)
        .unwrap()
        .is_none());
}

#[test]
fn install_preserves_existing_rc_content_and_uninstall_restores_it() {
    let home = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let rc = home.path().join(".zshrc");
    let original = "export PATH=/my/bin:$PATH\nalias ll='ls -la'\n";
    std::fs::write(&rc, original).unwrap();

    install(home.path(), data.path(), "/bin/zsh").unwrap();
    let after = std::fs::read_to_string(&rc).unwrap();
    assert!(after.contains("export PATH=/my/bin:$PATH"));
    assert!(after.contains("alias ll='ls -la'"));
    assert!(after.contains("OCULPM_SHELL_INTEGRATION"));

    // 두 번 설치해도 블록이 하나뿐이어야 한다.
    install(home.path(), data.path(), "/bin/zsh").unwrap();
    let twice = std::fs::read_to_string(&rc).unwrap();
    assert_eq!(twice.matches("oculpm:begin").count(), 1);

    uninstall(home.path(), "/bin/zsh").unwrap();
    let restored = std::fs::read_to_string(&rc).unwrap();
    assert!(!restored.contains("OCULPM_SHELL_INTEGRATION"));
    assert!(restored.contains("alias ll='ls -la'"));
}

#[test]
fn status_reports_installed_state() {
    let home = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();

    let before = status(home.path(), data.path(), "/bin/zsh");
    assert_eq!(before.shell, ShellKind::Zsh);
    assert!(!before.installed);
    assert!(before.rc_path.ends_with(".zshrc"));

    install(home.path(), data.path(), "/bin/zsh").unwrap();
    let after = status(home.path(), data.path(), "/bin/zsh");
    assert!(after.installed);
    assert!(!after.block_broken);
}

#[test]
fn status_flags_a_broken_block_instead_of_claiming_not_installed() {
    let home = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    // begin 만 있고 end 가 없는 상태 — 사용자가 손으로 지운 경우.
    std::fs::write(home.path().join(".zshrc"), "# oculpm:begin v1\necho hi\n").unwrap();
    let st = status(home.path(), data.path(), "/bin/zsh");
    assert!(!st.installed);
    assert!(st.block_broken);
}

#[test]
fn install_rejects_unsupported_shell() {
    let home = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    assert!(install(home.path(), data.path(), "/opt/homebrew/bin/fish").is_err());
}

/// Windows 두 판(5.1·7)은 **서로 다른** 프로필에 심는다 — 같은 파일을 두 판이
/// 공유하지 않는다. CRLF 로 저장된 기존 프로필의 줄바꿈과 내용을 보존한다.
#[test]
fn powershell_install_status_uninstall_round_trip_on_windows_layout() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let loc = temp_locations(root.path());
    let pwsh = r"C:\Program Files\PowerShell\7\pwsh.exe";
    let desktop = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";

    let core_profile = root
        .path()
        .join("Documents")
        .join("PowerShell")
        .join("profile.ps1");
    std::fs::create_dir_all(core_profile.parent().unwrap()).unwrap();
    std::fs::write(&core_profile, "Set-Alias ll Get-ChildItem\r\n").unwrap();

    let before = status_in(HostOs::Windows, &loc, data.path(), pwsh);
    assert_eq!(before.shell, ShellKind::PowerShell);
    assert!(!before.installed);
    assert_eq!(Path::new(&before.rc_path), core_profile);
    assert!(before.script_path.ends_with("oculpm.ps1"));

    install_in(HostOs::Windows, &loc, data.path(), pwsh, &remote_signed).unwrap();
    install_in(HostOs::Windows, &loc, data.path(), pwsh, &remote_signed).unwrap();
    let text = std::fs::read_to_string(&core_profile).unwrap();
    assert!(
        text.starts_with("Set-Alias ll Get-ChildItem\r\n"),
        "{text:?}"
    );
    assert_eq!(text.matches("oculpm:begin").count(), 1);
    assert!(
        !text.replace("\r\n", "").contains('\n'),
        "CRLF 파일에 LF 가 섞였다: {text:?}"
    );
    assert!(text.is_ascii());
    assert!(status_in(HostOs::Windows, &loc, data.path(), pwsh).installed);
    // 5.1 은 아직 아니다 — 다른 파일이다.
    let desktop_status = status_in(HostOs::Windows, &loc, data.path(), desktop);
    assert!(!desktop_status.installed);
    assert!(desktop_status.rc_path.contains("WindowsPowerShell"));

    uninstall_in(HostOs::Windows, &loc, pwsh).unwrap();
    assert_eq!(
        std::fs::read_to_string(&core_profile).unwrap(),
        "Set-Alias ll Get-ChildItem\r\n\r\n"
    );
}

/// 우리가 만든 프로필은 제거 때 파일째 사라진다 — 빈 파일도 Restricted 정책
/// 아래서는 창마다 오류를 찍기 때문이다.
#[test]
fn powershell_uninstall_removes_the_profile_it_created() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let loc = temp_locations(root.path());
    let desktop = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
    install_in(HostOs::Windows, &loc, data.path(), desktop, &remote_signed).unwrap();
    let profile = root
        .path()
        .join("Documents")
        .join("WindowsPowerShell")
        .join("profile.ps1");
    assert!(profile.is_file());
    uninstall_in(HostOs::Windows, &loc, desktop).unwrap();
    assert!(!profile.exists());
}

#[test]
fn powershell_install_refuses_a_restricted_policy_without_writing() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let loc = temp_locations(root.path());
    let restricted = |_: &str| Some("Restricted".to_string());
    let err = install_in(
        HostOs::Windows,
        &loc,
        data.path(),
        "powershell.exe",
        &restricted,
    )
    .unwrap_err();
    assert!(err.to_string().contains("Set-ExecutionPolicy"), "{err}");
    assert!(
        !root.path().join("Documents").exists(),
        "막혔는데 파일을 만들었다"
    );
}

#[test]
fn powershell_on_linux_uses_the_xdg_config_profile() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let loc = temp_locations(root.path());
    let never = |_: &str| -> Option<String> { panic!("Linux 에서 실행 정책을 물었다") };
    install_in(HostOs::Linux, &loc, data.path(), "/usr/bin/pwsh", &never).unwrap();
    let profile = root
        .path()
        .join("config")
        .join("powershell")
        .join("profile.ps1");
    assert!(std::fs::read_to_string(profile)
        .unwrap()
        .contains("$env:OCULPM_SHELL_INTEGRATION"));
}

#[test]
fn powershell_without_a_documents_folder_is_an_error_not_a_guess() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let loc = RcLocations {
        documents: None,
        ..temp_locations(root.path())
    };
    assert!(install_in(
        HostOs::Windows,
        &loc,
        data.path(),
        "pwsh.exe",
        &remote_signed
    )
    .is_err());
    let st = status_in(HostOs::Windows, &loc, data.path(), "pwsh.exe");
    assert_eq!(st.shell, ShellKind::PowerShell);
    assert!(!st.installed);
    assert_eq!(st.rc_path, "");
}

/// 스크립트는 우리 PTY 밖에서 즉시 빠져나가야 하고, 4개 마커를 전부 쏴야 한다.
#[test]
fn scripts_guard_on_oculpm_term_and_emit_all_markers() {
    for script in [ZSH_SCRIPT, BASH_SCRIPT, PWSH_SCRIPT] {
        assert!(script.contains("OCULPM_TERM"));
        for marker in ["133;A", "133;B", "133;C", "133;D"] {
            assert!(script.contains(marker), "{marker} 누락");
        }
        assert!(script.contains("nonce"));
        // tmux/screen 에서는 신호가 밖으로 나가지 못하므로 스스로 꺼야 한다.
        assert!(script.contains("TMUX"));
        assert!(script.contains("OCULPM_SHIM_DIR"));
    }
}

/// nonce 규칙 — OSC 133 을 쏘는 줄은 **전부** nonce 를 싣는다. 예외(페이로드
/// 없는 B 등)를 두면 그 예외가 위조 통로가 된다.
#[test]
fn every_osc_133_emission_carries_the_nonce() {
    for (name, script) in [
        ("zsh", ZSH_SCRIPT),
        ("bash", BASH_SCRIPT),
        ("ps1", PWSH_SCRIPT),
    ] {
        let emitting = script
            .lines()
            .filter(|l| !l.trim_start().starts_with('#'))
            .filter(|l| l.contains("133;"));
        let mut count = 0;
        for line in emitting {
            count += 1;
            assert!(line.contains("nonce="), "{name}: nonce 없는 마커 — {line}");
        }
        assert!(count >= 4, "{name}: 마커 줄이 {count}개뿐");
    }
}

/// PowerShell 스크립트는 ASCII · LF 뿐이고 PS1 에 마커를 심지 않는다.
///
/// - ASCII: 5.1 은 BOM 없는 `.ps1` 을 ANSI 코드 페이지(CP949 등)로 읽는다.
/// - LF: `include_str!` 로 박히므로 체크아웃의 줄바꿈이 그대로 출하된다
///   (`.gitattributes` 가 LF 로 고정). LF 스크립트가 5.1·7 에서 도는지는
///   `live_tests` 가 windows 러너에서 실제로 본다.
/// - `function global:prompt` 금지: prompt 프레임워크가 뒤에서 통째로 갈아 끼운다.
#[test]
fn powershell_script_is_ascii_lf_and_leaves_the_prompt_alone() {
    assert!(PWSH_SCRIPT.is_ascii());
    assert!(!PWSH_SCRIPT.contains('\r'));
    assert!(!PWSH_SCRIPT.contains("function global:prompt"));
    assert!(PWSH_SCRIPT.contains("function global:PSConsoleHostReadLine"));
    // 콘솔 코드 페이지를 타는 쓰기는 한글 경로를 `?` 로 바꾼다 (주석의 언급은 제외).
    let code: Vec<&str> = PWSH_SCRIPT
        .lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .collect();
    assert!(!code.iter().any(|l| l.contains("[Console]::Write")));
    for script in [ZSH_SCRIPT, BASH_SCRIPT] {
        assert!(!script.contains('\r'), "CRLF 로 박힌 셸 스크립트는 깨진다");
    }
}

/// 이름 없는 선언 빌트인(`typeset -g`, `declare`, …)은 문법상 멀쩡하지만
/// **셸의 전 파라미터를 프롬프트 위에 토해낸다**. 실제로 한 번 새어 나갔다
/// (편집이 `typeset -g __oculpm_nonce=...` 의 이름을 주석으로 덮었다).
/// `zsh -n` 은 이걸 잡지 못하므로 여기서 잡는다.
#[test]
fn scripts_never_declare_without_a_name() {
    for (name, script) in [("zsh", ZSH_SCRIPT), ("bash", BASH_SCRIPT)] {
        for (i, line) in script.lines().enumerate() {
            let code = line.trim();
            // 주석은 이름이 아니다 — `typeset -g # 설명` 이 바로 그 사고였다.
            let mut words = code.split_whitespace().take_while(|w| !w.starts_with('#'));
            let Some(head) = words.next() else { continue };
            if !matches!(
                head,
                "typeset" | "declare" | "local" | "export" | "readonly"
            ) {
                continue;
            }
            assert!(
                words.any(|w| !w.starts_with('-')),
                "{name}:{} 이름 없는 선언 — 파라미터 표를 통째로 출력한다: {code}",
                i + 1
            );
        }
    }
}

//! PowerShell 셸 통합의 설치 쪽 — 프로필 위치 · 관리 블록 본문 · 실행 정책
//! (크로스플랫폼 라운드 `#shell-pwsh`).
//!
//! # 어디에 심는가: `$PROFILE.CurrentUserAllHosts`
//!
//! | 판 | 파일 |
//! |---|---|
//! | Windows PowerShell 5.1 (`powershell.exe`) | `<문서>\WindowsPowerShell\profile.ps1` |
//! | PowerShell 7+ (`pwsh`) — Windows | `<문서>\PowerShell\profile.ps1` |
//! | PowerShell 7+ (`pwsh`) — Linux | `$XDG_CONFIG_HOME/powershell/profile.ps1` (없으면 `~/.config`) |
//!
//! `<문서>` 는 `%USERPROFILE%\Documents` 가 **아니다** — OneDrive 가 문서 폴더를
//! 옮겨 두는 일이 흔하다. PowerShell 은 알려진 폴더(`FOLDERID_Documents`)를 보므로
//! 우리도 같은 것(`directories::UserDirs`)을 본다. windows 러너 테스트가 셸 자신이
//! 말하는 `$PROFILE.CurrentUserAllHosts` 와 이 계산을 맞대어 본다.
//!
//! # 실행 정책
//!
//! Windows 클라이언트의 Windows PowerShell 기본 정책은 `Restricted` 다. 그 상태에서
//! 프로필 파일을 만들면 통합이 안 켜지는 데서 그치지 않고 **모든 PowerShell 창이
//! 뜰 때마다** "스크립트를 실행할 수 없습니다" 오류를 찍는다(`AllSigned` 는 매번
//! 서명 확인을 묻는다). 그래서 설치 전에 셸에게 실효 정책을 묻고, 막혀 있으면
//! 쓰지 않고 이유를 돌려준다. 정책을 우리가 바꾸지는 않는다 — 보안 설정이다.
//!
//! # 인코딩
//!
//! 프로필에 넣는 블록과 스크립트는 **ASCII 뿐**이다. 5.1 은 BOM 없는 `.ps1` 을
//! 시스템 ANSI 코드 페이지로 읽고, 사용자의 기존 프로필이 CP949 로 저장돼 있을
//! 수도 있다 — 어느 쪽이든 ASCII 는 같은 바이트다. 5.1 의 `>` 가 만드는 UTF-16
//! 프로필은 읽고 쓸 수 없으므로 건드리지 않고 이유를 돌려준다.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::default_shell::HostOs;
use super::RcLocations;
use crate::oculpm::error::{OculpmError, OculpmResult};

/// 프로필 파일명 — `CurrentUserAllHosts`.
const PROFILE_FILE: &str = "profile.ps1";

/// 실효 정책을 묻는 셸이 이보다 오래 걸리면 끊는다 (pwsh 콜드 스타트는 수 초).
const POLICY_TIMEOUT: Duration = Duration::from_secs(20);

/// PowerShell 의 두 판.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Edition {
    /// Windows PowerShell 5.1 (`powershell.exe`, .NET Framework).
    Desktop,
    /// PowerShell 7+ (`pwsh`, .NET).
    Core,
}

/// 셸 경로의 파일 이름 줄기 — 경로·`-` 접두(로그인 셸 argv0)·`.exe` 를 벗긴 소문자.
pub(super) fn exe_stem(shell_path: &str) -> String {
    let base = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell_path)
        .trim_start_matches('-')
        .to_ascii_lowercase();
    base.strip_suffix(".exe").unwrap_or(&base).to_string()
}

/// 이 경로가 PowerShell 인가 (`pwsh`, `pwsh-preview`, `powershell`, `.exe` 포함).
pub(super) fn is_powershell(shell_path: &str) -> bool {
    let stem = exe_stem(shell_path);
    let head = stem.split('-').next().unwrap_or(&stem);
    matches!(head, "pwsh" | "powershell")
}

/// 이 셸이 어느 판인가. `powershell.exe` 는 Windows 에만 있다 — 다른 OS 의
/// `powershell` 은 pwsh 를 가리키는 이름뿐이다.
pub(super) fn edition_of(os: HostOs, shell_path: &str) -> Edition {
    if os == HostOs::Windows && exe_stem(shell_path) == "powershell" {
        Edition::Desktop
    } else {
        Edition::Core
    }
}

/// `$PROFILE.CurrentUserAllHosts` 에 해당하는 경로. 순수 함수.
pub(super) fn profile_path(os: HostOs, edition: Edition, loc: &RcLocations) -> Option<PathBuf> {
    match os {
        HostOs::Windows => {
            let folder = match edition {
                Edition::Desktop => "WindowsPowerShell",
                Edition::Core => "PowerShell",
            };
            loc.documents
                .as_ref()
                .map(|docs| docs.join(folder).join(PROFILE_FILE))
        }
        HostOs::Linux => loc
            .config
            .as_ref()
            .map(|config| config.join("powershell").join(PROFILE_FILE)),
        // macOS 는 PowerShell 통합을 켜지 않는다 (D3 — 예전처럼 "미지원").
        HostOs::MacOs => None,
    }
}

/// 프로필에 심는 관리 블록 본문. **ASCII 만** (모듈 문서 — 인코딩).
///
/// 두 겹의 비활성 조건: `OCULPM_SHELL_INTEGRATION` 이 있어야 하고(우리 터미널만
/// 싣는다) 그것이 `.ps1` 이어야 한다 — 같은 사람이 bash 블록도 깔아 두었다면 그
/// 변수가 bash 스크립트를 가리키는 터미널 안에서 pwsh 를 띄울 수 있다.
pub(super) fn block_body() -> String {
    [
        "# ocul-pm terminal shell integration: lets the built-in terminal see where commands start and end, their exit codes and the working directory.",
        "# OCULPM_SHELL_INTEGRATION is only set in terminals ocul-pm launches, so this line does nothing anywhere else. Turn it off in the app settings.",
        "if ($env:OCULPM_SHELL_INTEGRATION -like '*.ps1' -and (Microsoft.PowerShell.Management\\Test-Path -LiteralPath $env:OCULPM_SHELL_INTEGRATION -PathType Leaf)) { . $env:OCULPM_SHELL_INTEGRATION }",
    ]
    .join("\n")
}

/// 이 정책이 서명 없는 로컬 프로필을 막는가.
pub(super) fn policy_blocks_profiles(policy: &str) -> bool {
    matches!(
        policy.trim().to_ascii_lowercase().as_str(),
        "restricted" | "allsigned"
    )
}

/// 설치 전 확인 — 프로필 파일을 읽고 쓸 수 있고, 실행 정책이 그것을 실행한다.
///
/// `policy` 는 셸에게 실효 정책을 묻는 함수다 (테스트는 가짜를 넘긴다).
/// Windows 가 아닌 곳은 정책이 강제되지 않으므로 묻지 않는다.
pub(super) fn preflight(
    os: HostOs,
    shell_path: &str,
    profile: &Path,
    policy: &dyn Fn(&str) -> Option<String>,
) -> OculpmResult<()> {
    ensure_editable(profile)?;
    if os != HostOs::Windows {
        return Ok(());
    }
    match policy(shell_path) {
        Some(p) if policy_blocks_profiles(&p) => Err(OculpmError::InvalidConfig(format!(
            "PowerShell's execution policy is {}, so it will not run profile scripts. \
             Adding the integration would make every PowerShell window print an error at start, \
             so nothing was changed. Allow local scripts with \
             `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` and try again.",
            p.trim()
        ))),
        Some(_) => Ok(()),
        None => Err(OculpmError::InvalidConfig(format!(
            "Could not ask {shell_path} for its execution policy, so the profile was left untouched."
        ))),
    }
}

/// 프로필이 UTF-16 이거나 UTF-8 로 읽히지 않으면 손대지 않는다.
fn ensure_editable(profile: &Path) -> OculpmResult<()> {
    let bytes = match std::fs::read(profile) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(OculpmError::Io {
                path: profile.to_path_buf(),
                source,
            })
        }
    };
    let utf16 = bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]);
    if utf16 || std::str::from_utf8(&bytes).is_err() {
        return Err(OculpmError::InvalidConfig(format!(
            "{} is not saved as UTF-8{}, so ocul-pm will not edit it. \
             Re-save it as UTF-8 and try again.",
            profile.display(),
            if utf16 { " (it is UTF-16)" } else { "" }
        )));
    }
    Ok(())
}

/// 제거 뒤 우리가 만든 빈 프로필이 남았으면 지운다.
///
/// 빈 `profile.ps1` 도 `Restricted` 정책 아래서는 창마다 오류를 찍는다. 공백만
/// 남은 파일에는 지킬 사용자 내용이 없다 (BOM 은 공백으로 친다).
pub(super) fn remove_if_blank(profile: &Path) -> OculpmResult<()> {
    let Ok(text) = std::fs::read_to_string(profile) else {
        return Ok(());
    };
    if text.trim_start_matches('\u{feff}').trim().is_empty() {
        std::fs::remove_file(profile).map_err(|source| OculpmError::Io {
            path: profile.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

/// 셸에게 실효 실행 정책을 묻는다 (`Get-ExecutionPolicy`). 실패·시간 초과는 `None`.
pub(super) fn effective_execution_policy(shell_path: &str) -> Option<String> {
    use std::io::Read;
    use std::process::Stdio;

    let mut child = crate::proc::std_cmd(shell_path)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-ExecutionPolicy",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + POLICY_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    out.lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locations(root: &Path) -> RcLocations {
        RcLocations {
            home: root.join("home"),
            documents: Some(root.join("Documents")),
            config: Some(root.join("config")),
        }
    }

    #[test]
    fn powershell_names_are_recognised_with_or_without_exe() {
        for path in [
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\PowerShell.EXE",
            "/usr/bin/pwsh",
            "/opt/microsoft/powershell/7-preview/pwsh-preview",
            "pwsh",
        ] {
            assert!(is_powershell(path), "{path}");
        }
        for path in [
            "cmd.exe",
            "/bin/bash",
            "/usr/bin/pwshx",
            "powershell_ise.exe",
            "",
        ] {
            assert!(!is_powershell(path), "{path}");
        }
    }

    #[test]
    fn edition_follows_the_executable_name() {
        let desktop = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        assert_eq!(edition_of(HostOs::Windows, desktop), Edition::Desktop);
        assert_eq!(
            edition_of(HostOs::Windows, r"C:\Program Files\PowerShell\7\pwsh.exe"),
            Edition::Core
        );
        // Linux 에 `powershell` 이라는 이름이 있다면 pwsh 의 별칭이다.
        assert_eq!(
            edition_of(HostOs::Linux, "/usr/bin/powershell"),
            Edition::Core
        );
    }

    #[test]
    fn profile_path_table() {
        let root = Path::new("/r");
        let loc = locations(root);
        assert_eq!(
            profile_path(HostOs::Windows, Edition::Desktop, &loc),
            Some(
                root.join("Documents")
                    .join("WindowsPowerShell")
                    .join("profile.ps1")
            )
        );
        assert_eq!(
            profile_path(HostOs::Windows, Edition::Core, &loc),
            Some(
                root.join("Documents")
                    .join("PowerShell")
                    .join("profile.ps1")
            )
        );
        assert_eq!(
            profile_path(HostOs::Linux, Edition::Core, &loc),
            Some(root.join("config").join("powershell").join("profile.ps1"))
        );
        assert_eq!(profile_path(HostOs::MacOs, Edition::Core, &loc), None);
        let no_docs = RcLocations {
            documents: None,
            ..locations(root)
        };
        assert_eq!(profile_path(HostOs::Windows, Edition::Core, &no_docs), None);
    }

    /// 블록은 ASCII 이고, 가드 없이 실행되는 줄이 없다.
    #[test]
    fn block_is_ascii_and_inert_without_the_env_var() {
        let body = block_body();
        assert!(body.is_ascii(), "5.1 이 ANSI 로 읽는다 — ASCII 여야 한다");
        for line in body.lines().filter(|l| !l.trim_start().starts_with('#')) {
            assert!(
                line.contains("$env:OCULPM_SHELL_INTEGRATION -like '*.ps1'"),
                "가드 없는 실행 줄: {line}"
            );
        }
    }

    #[test]
    fn restricted_and_allsigned_block_profiles() {
        for p in ["Restricted", "AllSigned", " restricted\r\n"] {
            assert!(policy_blocks_profiles(p), "{p:?}");
        }
        for p in ["RemoteSigned", "Unrestricted", "Bypass"] {
            assert!(!policy_blocks_profiles(p), "{p:?}");
        }
    }

    #[test]
    fn preflight_refuses_a_blocking_policy_only_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("profile.ps1");
        let restricted = |_: &str| Some("Restricted".to_string());
        let unknown = |_: &str| None;
        let remote = |_: &str| Some("RemoteSigned".to_string());

        let err = preflight(HostOs::Windows, "powershell.exe", &profile, &restricted).unwrap_err();
        assert!(err.to_string().contains("Restricted"), "{err}");
        assert!(preflight(HostOs::Windows, "pwsh.exe", &profile, &unknown).is_err());
        assert!(preflight(HostOs::Windows, "pwsh.exe", &profile, &remote).is_ok());
        // Linux 는 정책이 강제되지 않는다 — 묻지도 않는다.
        assert!(preflight(HostOs::Linux, "/usr/bin/pwsh", &profile, &restricted).is_ok());
    }

    #[test]
    fn preflight_refuses_profiles_it_cannot_read_as_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("profile.ps1");
        let ok = |_: &str| Some("RemoteSigned".to_string());

        // 5.1 의 `>` 가 만드는 UTF-16 LE.
        let utf16: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain(
                "Set-Alias ll ls\r\n"
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes),
            )
            .collect();
        std::fs::write(&profile, &utf16).unwrap();
        let err = preflight(HostOs::Windows, "pwsh.exe", &profile, &ok).unwrap_err();
        assert!(err.to_string().contains("UTF-16"), "{err}");
        assert_eq!(
            std::fs::read(&profile).unwrap(),
            utf16,
            "읽지 못하는 파일을 고쳤다"
        );

        // CP949 로 저장된 한국어 주석 ("# 한글").
        std::fs::write(&profile, [b'#', b' ', 0xC7, 0xD1, 0xB1, 0xDB, b'\n']).unwrap();
        assert!(preflight(HostOs::Windows, "pwsh.exe", &profile, &ok).is_err());

        // UTF-8(BOM 포함)은 된다.
        std::fs::write(&profile, "\u{feff}Set-Alias ll ls\r\n").unwrap();
        assert!(preflight(HostOs::Windows, "pwsh.exe", &profile, &ok).is_ok());
    }

    #[test]
    fn a_blank_profile_is_removed_but_real_content_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("profile.ps1");
        std::fs::write(&profile, "\u{feff}\r\n\r\n").unwrap();
        remove_if_blank(&profile).unwrap();
        assert!(!profile.exists());

        std::fs::write(&profile, "Set-Alias ll ls\n").unwrap();
        remove_if_blank(&profile).unwrap();
        assert!(profile.exists());
        // 없는 파일은 조용히 지나간다.
        remove_if_blank(&dir.path().join("absent.ps1")).unwrap();
    }
}

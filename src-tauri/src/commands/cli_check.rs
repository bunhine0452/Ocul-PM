//! 외부 CLI 가 설치돼 있는지 PATH 에서 찾는다 (OS 별 탐침).
//!
//! 예전에는 새 프로젝트 마법사(`greenfield.rs`)의 일부였다. 마법사·스캐폴드 실행·초안(블루프린트)
//! 저장은 4.0 에서 걷었고, 이 탐침만 Today 의 첫 기록 카드(「Claude Code 가 있는가」)가
//! 써서 남았다.

use std::path::PathBuf;

use serde::Serialize;

// ─── CLI availability check ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CliCheckResult {
    pub available: bool,
    pub cli_name: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Check if a CLI tool is available on the system PATH (or common install
/// locations). Returns availability, resolved path, and version string.
///
/// The check uses `which`(Unix) / `where`(Windows) followed by a
/// `--version` probe. On failure, we scan well-known install directories
/// as a fallback (e.g. `~/.cargo/bin` for `cargo`).
#[tauri::command]
#[specta::specta]
pub async fn check_cli_available(cli_name: String) -> Result<CliCheckResult, String> {
    // Try `which` / `where` first
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let cli = cli_name.clone();
    let resolved_path = tokio::task::spawn_blocking(move || {
        let output = crate::proc::std_cmd(which_cmd).arg(&cli).output();
        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if cfg!(target_os = "windows") {
                    runnable_where_line(&stdout).or_else(|| find_in_common_paths(&cli))
                } else {
                    Some(stdout.lines().next().unwrap_or("").trim().to_string())
                }
            }
            _ => find_in_common_paths(&cli),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(ref path) = resolved_path {
        // Try to get version
        let p = path.clone();
        let version = tokio::task::spawn_blocking(move || get_cli_version_sync(&p))
            .await
            .ok()
            .flatten();
        Ok(CliCheckResult {
            available: true,
            cli_name,
            path: Some(path.clone()),
            version,
        })
    } else {
        Ok(CliCheckResult {
            available: false,
            cli_name,
            path: None,
            version: None,
        })
    }
}

/// `where`(Windows) 출력에서 **띄울 수 있는** 첫 줄.
///
/// `where npm` 은 Node 설치 폴더의 확장자 없는 `npm`(Git Bash 용 셸 스크립트)을
/// `npm.cmd` 보다 먼저 찍는다. 그 줄을 경로로 삼으면 `--version` 조회가
/// "올바른 Win32 응용 프로그램이 아닙니다" 로 실패하고 화면에는 버전 없는 "설치됨"
/// 이 뜬다. 순수 함수라 세 OS 러너에서 테스트한다.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn runnable_where_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            [".exe", ".cmd", ".bat", ".com"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        })
        .map(str::to_string)
}

/// Scan well-known install directories for the given CLI binary.
fn find_in_common_paths(cli_name: &str) -> Option<String> {
    let home = dirs_home().unwrap_or_default();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        windows_candidates(&home, cli_name)
    } else {
        vec![
            PathBuf::from("/usr/local/bin").join(cli_name),
            PathBuf::from("/usr/bin").join(cli_name),
            home.join(".cargo/bin").join(cli_name),
            home.join(".nvm/current/bin").join(cli_name),
            home.join(".local/bin").join(cli_name),
            PathBuf::from("/opt/homebrew/bin").join(cli_name),
        ]
    };

    for p in candidates {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// Windows 의 흔한 설치 자리 — npm 전역(`%APPDATA%\npm`, `.cmd`), cargo, Go,
/// Node 설치 폴더, pnpm 단독 설치(`%LOCALAPPDATA%\pnpm`).
fn windows_candidates(home: &std::path::Path, cli_name: &str) -> Vec<PathBuf> {
    vec![
        home.join("AppData/Roaming/npm")
            .join(format!("{cli_name}.cmd")),
        home.join(".cargo/bin").join(format!("{cli_name}.exe")),
        PathBuf::from("C:/Program Files/Go/bin").join(format!("{cli_name}.exe")),
        PathBuf::from("C:/Program Files/nodejs").join(format!("{cli_name}.exe")),
        PathBuf::from("C:/Program Files/nodejs").join(format!("{cli_name}.cmd")),
        home.join("AppData/Local/pnpm")
            .join(format!("{cli_name}.exe")),
    ]
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn get_cli_version_sync(path: &str) -> Option<String> {
    let output = crate::proc::std_cmd(path).arg("--version").output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Some(stdout.lines().next().unwrap_or("").trim().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `where npm` 의 실제 모양 — 확장자 없는 셸 스크립트가 먼저 온다.
    #[test]
    fn where_output_skips_the_extensionless_shell_script() {
        let stdout = "C:\\Program Files\\nodejs\\npm\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n";
        assert_eq!(
            runnable_where_line(stdout).as_deref(),
            Some(r"C:\Program Files\nodejs\npm.cmd")
        );
        assert_eq!(
            runnable_where_line("C:\\Go\\bin\\go.EXE\r\n").as_deref(),
            Some(r"C:\Go\bin\go.EXE"),
            "대소문자와 무관하게"
        );
        assert_eq!(
            runnable_where_line("C:\\x\\npm\r\n"),
            None,
            "띄울 수 있는 것이 없다"
        );
        assert_eq!(runnable_where_line(""), None);
    }

    /// 후보는 전부 Windows 실행 파일 이름이다 (`.exe`/`.cmd`) — 맨 이름은 없다.
    #[test]
    fn windows_candidates_carry_runnable_extensions() {
        let home = std::path::Path::new(r"C:\Users\kim");
        let all = windows_candidates(home, "pnpm");
        assert!(all.iter().any(|p| p.ends_with("npm/pnpm.cmd")));
        assert!(all.iter().any(|p| p.ends_with("pnpm/pnpm.exe")));
        for p in &all {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            assert!(ext == "exe" || ext == "cmd", "{p:?}");
        }
    }

    /// 이 러너에서 실제로 — OS 의 기본 셸은 언제나 있다. Windows 는 `where` 가
    /// 돌려준 줄에서 `cmd.exe` 를, 다른 OS 는 `which sh` 를 받아 버전 조회까지 간다.
    #[tokio::test]
    async fn the_os_shell_is_found_with_a_runnable_path() {
        let name = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        let found = check_cli_available(name.to_string()).await.unwrap();
        assert!(found.available, "{found:?}");
        let path = found.path.expect("경로");
        if cfg!(target_os = "windows") {
            assert!(path.to_ascii_lowercase().ends_with("cmd.exe"), "{path}");
        } else {
            assert!(path.ends_with("/sh"), "{path}");
        }
    }
}

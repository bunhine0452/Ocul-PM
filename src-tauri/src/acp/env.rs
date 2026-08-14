//! PR-ACP1 — 외부 런타임(node·npm·claude) 탐색 (docs/acp-panel/00-master-plan.md D2).
//!
//! 패키징된 `.app` 을 Finder 에서 실행하면 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin`
//! 뿐이다. fnm·nvm·homebrew 가 심은 shim 이 하나도 안 보인다 — 그런데 `tauri dev`
//! 로 개발할 땐 터미널 PATH 를 물려받아 멀쩡히 동작한다. fastembed 캐시 절대경로
//! 사고와 같은 계열의 함정이라, "내 컴퓨터에선 되는데 릴리스에선 안 되는" 형태로
//! 늦게 터진다.
//!
//! 그래서 프로세스 PATH 에서 못 찾으면 **로그인 셸을 한 번 띄워 PATH 를 받아온다.**
//! 셸 기동은 수백 ms 라 프로세스 수명 동안 1회만 하고 캐시한다.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// 어댑터가 딛는 Claude Agent SDK 의 하한.
pub const MIN_NODE_MAJOR: u32 = 18;

/// 로그인 셸이 느리거나(무거운 rc) 프롬프트를 기다리면 여기서 끊는다.
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// 대화형 rc 가 stdout 에 뭔가 찍어도 PATH 만 정확히 도려내기 위한 마커.
const MARK_BEGIN: &str = "__OCULPM_PATH_BEGIN__";
const MARK_END: &str = "__OCULPM_PATH_END__";

static LOGIN_PATH: OnceLock<Option<String>> = OnceLock::new();

/// 바이너리를 어느 PATH 에서 찾았는지 — 진단 UI 가 "로그인 셸에서 찾았다"를
/// 보여줘야 사용자가 왜 터미널에선 되는데 앱에선 안 되는지 이해한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum PathSource {
    /// 앱 프로세스가 물려받은 PATH.
    Process,
    /// 로그인 셸을 띄워 받아온 PATH.
    LoginShell,
}

/// PATH 문자열에서 실행 가능한 `name` 을 찾는다. 순수 함수 — 테스트 대상.
pub fn search_path(path_env: &str, name: &str) -> Option<PathBuf> {
    path_env
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(name))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// 로그인 셸을 한 번 띄워 PATH 를 받아온다. 실패는 `None` — 호출부는 프로세스
/// PATH 로만 동작하고 진단이 그 사실을 표면화한다.
async fn login_shell_path() -> Option<&'static str> {
    if let Some(cached) = LOGIN_PATH.get() {
        return cached.as_deref();
    }

    let shell = crate::oculpm::shell_integration::current_shell();
    let script = format!("printf '{MARK_BEGIN}%s{MARK_END}' \"$PATH\"");

    // `-i`(대화형)까지 주는 이유: fnm·nvm 은 `.zprofile` 이 아니라 `.zshrc` 에
    // 훅을 심는 경우가 많아 로그인 셸만으로는 shim 이 안 붙는다.
    let spawned = tokio::process::Command::new(&shell)
        .args(["-lic", &script])
        .kill_on_drop(true)
        .output();

    let value = match tokio::time::timeout(SHELL_TIMEOUT, spawned).await {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            extract_marked(&stdout).map(str::to_string)
        }
        Ok(Ok(out)) => {
            tracing::debug!(shell = %shell, code = ?out.status.code(), "login shell PATH 조회 실패");
            None
        }
        Ok(Err(e)) => {
            tracing::debug!(shell = %shell, error = %e, "login shell 실행 실패");
            None
        }
        Err(_) => {
            tracing::warn!(shell = %shell, "login shell PATH 조회 타임아웃");
            None
        }
    };

    let _ = LOGIN_PATH.set(value);
    LOGIN_PATH.get().and_then(Option::as_deref)
}

/// 마커 사이만 도려낸다. 순수 함수 — 테스트 대상.
pub fn extract_marked(stdout: &str) -> Option<&str> {
    let start = stdout.find(MARK_BEGIN)? + MARK_BEGIN.len();
    let rest = &stdout[start..];
    let end = rest.find(MARK_END)?;
    let value = rest[..end].trim();
    (!value.is_empty()).then_some(value)
}

/// 프로세스 PATH → 로그인 셸 PATH 순으로 바이너리를 찾는다.
pub async fn resolve_binary(name: &str) -> Option<(PathBuf, PathSource)> {
    if let Some(found) = std::env::var("PATH")
        .ok()
        .and_then(|p| search_path(&p, name))
    {
        return Some((found, PathSource::Process));
    }

    let login = login_shell_path().await?;
    search_path(login, name).map(|p| (p, PathSource::LoginShell))
}

/// 자식 프로세스에 물려줄 PATH — 어댑터가 다시 `claude` 를 찾아야 하므로
/// 우리가 찾은 것과 같은 PATH 를 명시적으로 넘겨준다.
pub async fn effective_path() -> String {
    let process = std::env::var("PATH").unwrap_or_default();
    match login_shell_path().await {
        Some(login) if login != process => {
            if process.is_empty() {
                login.to_string()
            } else {
                format!("{process}:{login}")
            }
        }
        _ => process,
    }
}

/// `node --version` 의 `v24.14.1` 에서 major 를 뽑는다. 순수 함수 — 테스트 대상.
pub fn parse_node_major(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// `node --version` 을 실제로 실행한다. 실패는 `None`.
pub async fn node_version(node: &Path) -> Option<String> {
    let spawned = tokio::process::Command::new(node)
        .arg("--version")
        .kill_on_drop(true)
        .output();

    match tokio::time::timeout(SHELL_TIMEOUT, spawned).await {
        Ok(Ok(out)) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!v.is_empty()).then_some(v)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_path_skips_missing_and_empty_segments() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("faux-node");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let path_env = format!("::/nope/nowhere:{}", dir.path().display());
        assert_eq!(search_path(&path_env, "faux-node"), Some(bin));
        assert_eq!(search_path(&path_env, "absent"), None);
    }

    #[cfg(unix)]
    #[test]
    fn search_path_ignores_non_executable_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("node"), "not executable").unwrap();
        assert_eq!(search_path(&dir.path().display().to_string(), "node"), None);
    }

    /// 대화형 rc 가 앞뒤로 뭘 찍어도 PATH 만 나와야 한다 — 이게 깨지면 앱이
    /// 쓰레기 PATH 로 node 를 찾다 조용히 실패한다.
    #[test]
    fn extract_marked_survives_noisy_rc_output() {
        let noisy = format!(
            "Welcome to fish!\n{MARK_BEGIN}/opt/homebrew/bin:/usr/bin{MARK_END}\nnvm loaded\n"
        );
        assert_eq!(extract_marked(&noisy), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(extract_marked("no markers here"), None);
        assert_eq!(
            extract_marked(&format!("{MARK_BEGIN}   {MARK_END}")),
            None,
            "빈 PATH 는 성공으로 치면 안 된다"
        );
    }

    #[test]
    fn parse_node_major_reads_v_prefixed_versions() {
        assert_eq!(parse_node_major("v24.14.1"), Some(24));
        assert_eq!(parse_node_major("18.0.0"), Some(18));
        assert_eq!(parse_node_major("\nv20.11.0\n"), Some(20));
        assert_eq!(parse_node_major("not-a-version"), None);
    }
}

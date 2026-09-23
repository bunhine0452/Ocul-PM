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
//!
//! ## OS 별 (크로스플랫폼 라운드 `#shell-env`)
//!
//! - **Linux**: macOS 와 같다 — 데스크톱 런처가 띄운 앱의 PATH 에는 `.bashrc` 의
//!   nvm 이 없다. `$SHELL -lic` (셸 판정은 [`current_shell`](crate::oculpm::shell_integration::current_shell)).
//! - **Windows**: 셸을 띄우지 않는다. GUI 앱은 탐색기에게서 레지스트리의 사용자·
//!   시스템 PATH 를 통째로 물려받고, 기본 셸(PowerShell)에는 `-lic` 같은 "로그인
//!   rc 를 읽고 명령 하나" 모드가 없다. 대신 이름 탐색이 `PATHEXT` 를 따른다 —
//!   npm 이 까는 `npm`·`claude` 는 `npm.cmd`·`claude.cmd` 다.
//! - PATH 목록은 OS 규칙으로 나누고 잇는다 (`:` / `;`). Windows 의 `C:\…` 를
//!   `:` 로 자르면 경로가 두 동강 난다.

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

/// PATH 목록을 잇는 문자 — `std::env::join_paths` 와 같은 규칙.
const PATH_LIST_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// PATH 문자열에서 실행 가능한 `name` 을 찾는다. 순수 함수 — 테스트 대상.
///
/// Windows 는 확장자 없는 이름에 `PATHEXT` 의 실행 확장자(`.com`·`.exe`·`.bat`·
/// `.cmd`)를 셸과 같은 순서 — 디렉터리마다 확장자 전부 — 로 붙여 본다. 찾은
/// `.cmd` 의 전체 경로는 [`proc`](crate::proc) 가 cmd 규칙으로 인용해 띄운다.
pub fn search_path(path_env: &str, name: &str) -> Option<PathBuf> {
    let pathext = std::env::var("PATHEXT").ok();
    search_path_with(path_env, name, pathext.as_deref())
}

/// [`search_path`] 의 본체 — `PATHEXT` 를 인자로 받는다 (Windows 에서만 쓴다).
fn search_path_with(path_env: &str, name: &str, pathext: Option<&str>) -> Option<PathBuf> {
    let names = candidate_names(name, pathext);
    std::env::split_paths(path_env)
        .filter(|dir| !dir.as_os_str().is_empty())
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|candidate| is_executable(candidate))
}

/// 한 디렉터리에서 시험할 파일 이름들.
#[cfg(windows)]
fn candidate_names(name: &str, pathext: Option<&str>) -> Vec<String> {
    const RUNNABLE: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];
    let lower = name.to_ascii_lowercase();
    if RUNNABLE.iter().any(|ext| lower.ends_with(ext)) {
        return vec![name.to_string()];
    }
    let mut exts: Vec<String> = Vec::new();
    for ext in pathext.unwrap_or(".COM;.EXE;.BAT;.CMD").split(';') {
        let ext = ext.trim().to_ascii_lowercase();
        if RUNNABLE.contains(&ext.as_str()) && !exts.contains(&ext) {
            exts.push(ext);
        }
    }
    if exts.is_empty() {
        exts = RUNNABLE.iter().map(|e| e.to_string()).collect();
    }
    exts.into_iter().map(|ext| format!("{name}{ext}")).collect()
}

#[cfg(not(windows))]
fn candidate_names(name: &str, _pathext: Option<&str>) -> Vec<String> {
    vec![name.to_string()]
}

/// 두 PATH 목록을 OS 구분자로 잇는다.
fn join_path_lists(first: &str, second: &str) -> String {
    format!("{first}{PATH_LIST_SEP}{second}")
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
    if cfg!(windows) {
        // 모듈 문서 — Windows 는 프로세스 PATH 가 곧 사용자 PATH 다.
        return None;
    }
    if let Some(cached) = LOGIN_PATH.get() {
        return cached.as_deref();
    }

    let shell = crate::oculpm::shell_integration::current_shell();
    let value = capture_login_path(&shell).await;
    let _ = LOGIN_PATH.set(value);
    LOGIN_PATH.get().and_then(Option::as_deref)
}

/// `shell` 을 로그인·대화형으로 한 번 띄워 그 PATH 를 받아온다 (캐시 없음).
/// Windows 에서는 셸을 띄우지 않고 `None` (모듈 문서).
pub async fn capture_login_path(shell: &str) -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    let script = format!("printf '{MARK_BEGIN}%s{MARK_END}' \"$PATH\"");

    // `-i`(대화형)까지 주는 이유: fnm·nvm 은 `.zprofile` 이 아니라 `.zshrc` 에
    // 훅을 심는 경우가 많아 로그인 셸만으로는 shim 이 안 붙는다.
    let spawned = crate::proc::tokio_cmd(shell)
        .args(["-lic", &script])
        .kill_on_drop(true)
        .output();

    match tokio::time::timeout(SHELL_TIMEOUT, spawned).await {
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
    }
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
                join_path_lists(&process, login)
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
    let spawned = crate::proc::tokio_cmd(node)
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

    /// 빈 항목·없는 디렉터리를 건너뛴다. 목록은 OS 규칙으로 나눈다 — Windows 의
    /// `C:\…` 를 `:` 로 자르던 것이 W1 windows 러너의 실패였다.
    #[test]
    fn search_path_skips_missing_and_empty_segments() {
        let dir = tempfile::tempdir().unwrap();
        // Windows 에서 확장자 없는 파일은 실행 파일이 아니다 — `PATHEXT` 로 찾는다.
        let file = if cfg!(windows) {
            "faux-node.exe"
        } else {
            "faux-node"
        };
        let bin = dir.path().join(file);
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let missing = dir.path().join("nope").join("nowhere");
        let path_env = format!(
            "{s}{s}{}{s}{}",
            missing.display(),
            dir.path().display(),
            s = PATH_LIST_SEP
        );
        assert_eq!(search_path(&path_env, "faux-node"), Some(bin));
        assert_eq!(search_path(&path_env, "absent"), None);
    }

    #[test]
    fn path_lists_join_with_the_os_separator() {
        let joined = join_path_lists("a", "b");
        assert_eq!(joined, if cfg!(windows) { "a;b" } else { "a:b" });
        assert_eq!(
            std::env::split_paths(&joined).count(),
            2,
            "split_paths 로 되돌아가야 한다"
        );
    }

    /// npm 이 까는 모양 — `npm.cmd` 만 있는 폴더. 셸과 같은 순서로 찾는다:
    /// 디렉터리가 먼저, 그 안에서 `PATHEXT` 순서. 확장자를 준 이름은 그대로.
    #[cfg(windows)]
    #[test]
    fn windows_search_follows_pathext_directory_first() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let touch = |dir: &Path, name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"").unwrap();
            p
        };
        let a_cmd = touch(a.path(), "tool.cmd");
        let a_bat = touch(a.path(), "tool.bat");
        let b_exe = touch(b.path(), "tool.exe");
        let path = format!("{};{}", a.path().display(), b.path().display());
        let std_ext = Some(".COM;.EXE;.BAT;.CMD;.VBS;.JS");

        assert_eq!(
            search_path_with(&path, "tool", std_ext),
            Some(a_bat.clone())
        );
        assert_eq!(
            search_path_with(&path, "tool", Some(".CMD;.BAT")),
            Some(a_cmd)
        );
        assert_eq!(search_path_with(&path, "tool.exe", std_ext), Some(b_exe));
        assert_eq!(
            search_path_with(&path, "TOOL.BAT", std_ext),
            Some(a.path().join("TOOL.BAT"))
        );
        // 띄울 수 없는 확장자뿐인 PATHEXT 는 기본값으로.
        assert_eq!(search_path_with(&path, "tool", Some(".JS")), Some(a_bat));
        assert_eq!(search_path_with(&path, "absent", std_ext), None);
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

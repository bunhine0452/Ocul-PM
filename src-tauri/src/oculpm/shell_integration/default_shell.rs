//! 기본 셸 판정 — 터미널이 띄울 셸과 설정 화면이 "설치됨" 을 판단하는 셸이
//! **같은 값**이어야 한다 (크로스플랫폼 라운드 `#shell-linux` · `#shell-pwsh`).
//!
//! 판정 자체는 [`resolve_default_shell`] 순수 함수다 — 환경변수·파일 존재·passwd
//! 를 인자로 받으므로 세 OS 의 표를 어느 러너에서든 돌린다. [`system_default_shell`]
//! 이 그 인자에 진짜 프로세스 환경을 꽂는다. PTY 호스트(L-PTY)는 셸을 따로
//! 고르지 않는다: 앱이 `Request::Start { shell }` 에 이 값을 실어 보낸다.
//!
//! | OS | 순서 |
//! |---|---|
//! | macOS | `$SHELL` → `/bin/zsh` — **예전 그대로** (D3, 빈 `$SHELL` 도 그대로 쓴다) |
//! | Linux 등 | `$SHELL`(있는 파일) → passwd 의 로그인 셸(있는 파일) → `/bin/bash` → `/bin/sh` |
//! | Windows | PATH 의 `pwsh.exe` → `%ProgramFiles%\PowerShell\7\pwsh.exe` → System32 `powershell.exe` → `%COMSPEC%` → `cmd.exe` |
//!
//! Windows 에서 `$SHELL` 을 보지 않는 이유: Git Bash·MSYS2 에서 앱을 띄우면
//! `SHELL=/usr/bin/bash` 같은 **MSYS 경로**가 물려 온다 — Windows 프로세스가 띄울
//! 수 있는 경로가 아니다.

use std::path::{Path, PathBuf};

/// 판정에 쓰는 OS 갈래. `cfg!` 대신 값으로 두는 이유는 세 갈래의 표를 한
/// 러너에서 전부 단위 테스트하기 위해서다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostOs {
    MacOs,
    /// macOS 가 아닌 유닉스 (Linux·BSD).
    Linux,
    Windows,
}

impl HostOs {
    /// 이 빌드가 도는 OS.
    pub const fn current() -> Self {
        if cfg!(windows) {
            HostOs::Windows
        } else if cfg!(target_os = "macos") {
            HostOs::MacOs
        } else {
            HostOs::Linux
        }
    }
}

/// 판정에 필요한 바깥 사실. 테스트는 가짜를, [`system_default_shell`] 은 진짜를 꽂는다.
pub struct ShellFacts<'a> {
    /// 환경변수 조회 (없으면 `None`, 빈 값은 `Some("")`).
    pub env: &'a dyn Fn(&str) -> Option<String>,
    /// 경로에 무언가(파일·심링크·앱 실행 별칭)가 있는가.
    pub exists: &'a dyn Fn(&Path) -> bool,
    /// passwd 에 적힌 로그인 셸 (유닉스만 의미가 있다).
    pub passwd_shell: &'a dyn Fn() -> Option<String>,
}

/// 기본 셸 경로를 고른다. 순수 함수 — 표는 모듈 문서.
pub fn resolve_default_shell(os: HostOs, facts: &ShellFacts<'_>) -> String {
    match os {
        HostOs::MacOs => (facts.env)("SHELL").unwrap_or_else(|| "/bin/zsh".to_string()),
        HostOs::Linux => linux_shell(facts),
        HostOs::Windows => windows_shell(facts),
    }
}

fn linux_shell(facts: &ShellFacts<'_>) -> String {
    let usable = |candidate: Option<String>| {
        candidate.filter(|s| !s.trim().is_empty() && (facts.exists)(Path::new(s)))
    };
    usable((facts.env)("SHELL"))
        .or_else(|| usable((facts.passwd_shell)()))
        .or_else(|| usable(Some("/bin/bash".to_string())))
        .unwrap_or_else(|| "/bin/sh".to_string())
}

fn windows_shell(facts: &ShellFacts<'_>) -> String {
    let env = |key: &str| (facts.env)(key).filter(|v| !v.trim().is_empty());
    let exists = |p: &Path| (facts.exists)(p);

    if let Some(path) = env("PATH") {
        for dir in split_windows_path_list(&path) {
            let candidate = Path::new(&dir).join("pwsh.exe");
            if exists(&candidate) {
                return display(candidate);
            }
        }
    }
    if let Some(program_files) = env("ProgramFiles") {
        let candidate = Path::new(&program_files).join(r"PowerShell\7\pwsh.exe");
        if exists(&candidate) {
            return display(candidate);
        }
    }
    let system_root = env("SystemRoot")
        .or_else(|| env("windir"))
        .unwrap_or_else(|| r"C:\Windows".to_string());
    let windows_powershell =
        Path::new(&system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    if exists(&windows_powershell) {
        return display(windows_powershell);
    }
    env("COMSPEC").unwrap_or_else(|| "cmd.exe".to_string())
}

/// Windows `PATH` 목록 분리 — `;` 로 나누고 항목을 감싼 `"` 를 벗긴다.
///
/// `std::env::split_paths` 는 **빌드한 OS 의** 규칙을 쓴다(유닉스에서는 `:`
/// 로 나눠 `C:\…` 를 쪼갠다). 판정을 순수 함수로 두고 세 OS 표를 한 러너에서
/// 돌리려고 Windows 규칙을 여기 따로 적는다.
fn split_windows_path_list(raw: &str) -> Vec<String> {
    raw.split(';')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// `Path::join` 은 호스트 OS 구분자로 잇는다 — 테스트(유닉스 러너의 Windows 표)
/// 에서도 같은 문자열이 나오게 `/` 를 `\` 로 맞춘다. 실제 Windows 에서는 무변경.
fn display(path: PathBuf) -> String {
    path.to_string_lossy().replace('/', "\\")
}

/// 이 프로세스의 진짜 환경으로 [`resolve_default_shell`] 을 돌린다.
pub fn system_default_shell() -> String {
    let env = |key: &str| std::env::var(key).ok();
    // 앱 실행 별칭(Microsoft Store 의 `pwsh.exe`)은 `metadata` 가 따라가지 못하는
    // 재분석 지점이라 `symlink_metadata` 로 "무언가 있다" 만 본다. CreateProcess 는
    // 그 별칭을 띄울 수 있다.
    let exists = |p: &Path| std::fs::symlink_metadata(p).is_ok_and(|m| !m.is_dir());
    let facts = ShellFacts {
        env: &env,
        exists: &exists,
        passwd_shell: &passwd_shell,
    };
    resolve_default_shell(HostOs::current(), &facts)
}

/// passwd 에 적힌 이 사용자의 로그인 셸 (`getpwuid_r`). 프로세스를 띄우지 않는다.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn passwd_shell() -> Option<String> {
    use std::ffi::CStr;

    let mut buf: Vec<libc::c_char> = vec![0; 16 * 1024];
    // SAFETY: passwd 는 C 구조체라 0 으로 채운 값이 유효한 초기 상태다.
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: getuid 는 실패하지 않는다. getpwuid_r 에는 살아 있는 버퍼와 그
    // 길이를 넘기고, 결과 포인터는 `found` 가 null 이 아닐 때만 읽는다.
    let rc = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut entry,
            buf.as_mut_ptr(),
            buf.len(),
            &mut found,
        )
    };
    if rc != 0 || found.is_null() || entry.pw_shell.is_null() {
        return None;
    }
    // SAFETY: pw_shell 은 `buf` 안을 가리키는 NUL 종단 문자열이고 `buf` 는 살아 있다.
    let shell = unsafe { CStr::from_ptr(entry.pw_shell) }.to_str().ok()?;
    (!shell.is_empty()).then(|| shell.to_string())
}

/// macOS 는 판정에 passwd 를 쓰지 않는다(예전 그대로 `/bin/zsh`), Windows 에는 없다.
#[cfg(not(all(unix, not(target_os = "macos"))))]
pub fn passwd_shell() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve(os: HostOs, env: &[(&str, &str)], files: &[&str], passwd: Option<&str>) -> String {
        let env: HashMap<String, String> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let files: Vec<String> = files.iter().map(|f| f.replace('/', "\\")).collect();
        let env_fn = |key: &str| env.get(key).cloned();
        let exists_fn = |p: &Path| files.contains(&p.to_string_lossy().replace('/', "\\"));
        let passwd_fn = || passwd.map(str::to_string);
        let facts = ShellFacts {
            env: &env_fn,
            exists: &exists_fn,
            passwd_shell: &passwd_fn,
        };
        resolve_default_shell(os, &facts)
    }

    /// D3 — macOS 는 한 글자도 안 바뀐다: `$SHELL` 그대로, 없으면 `/bin/zsh`.
    #[test]
    fn macos_keeps_the_old_rule() {
        assert_eq!(resolve(HostOs::MacOs, &[], &[], None), "/bin/zsh");
        assert_eq!(
            resolve(
                HostOs::MacOs,
                &[("SHELL", "/opt/homebrew/bin/fish")],
                &[],
                None
            ),
            "/opt/homebrew/bin/fish"
        );
        // 파일 존재도 passwd 도 보지 않는다 — 예전 코드가 보지 않았다.
        assert_eq!(
            resolve(
                HostOs::MacOs,
                &[("SHELL", "/nope/zsh")],
                &[],
                Some("/bin/bash")
            ),
            "/nope/zsh"
        );
    }

    #[test]
    fn linux_prefers_shell_env_then_passwd_then_bash() {
        let files = ["/usr/bin/zsh", "/bin/bash", "/usr/bin/fish"];
        assert_eq!(
            resolve(
                HostOs::Linux,
                &[("SHELL", "/usr/bin/zsh")],
                &files,
                Some("/usr/bin/fish")
            ),
            "/usr/bin/zsh"
        );
        // $SHELL 이 없거나 가리키는 파일이 없으면 passwd.
        assert_eq!(
            resolve(HostOs::Linux, &[], &files, Some("/usr/bin/fish")),
            "/usr/bin/fish"
        );
        assert_eq!(
            resolve(
                HostOs::Linux,
                &[("SHELL", "/gone/zsh")],
                &files,
                Some("/usr/bin/fish")
            ),
            "/usr/bin/fish"
        );
        // macOS 의 전제(/bin/zsh)를 쓰지 않는다 — passwd 도 없으면 bash.
        assert_eq!(
            resolve(HostOs::Linux, &[("SHELL", "")], &files, None),
            "/bin/bash"
        );
        // bash 조차 없는 최소 이미지.
        assert_eq!(resolve(HostOs::Linux, &[], &[], None), "/bin/sh");
    }

    #[test]
    fn windows_prefers_pwsh_then_windows_powershell_then_comspec() {
        let pwsh_on_path = r"C:\Tools\pwsh\pwsh.exe";
        let program_files = r"C:\Program Files\PowerShell\7\pwsh.exe";
        let desktop = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        let env = [
            ("PATH", r#"C:\Windows\system32;"C:\Tools\pwsh";;C:\Other"#),
            ("ProgramFiles", r"C:\Program Files"),
            ("SystemRoot", r"C:\Windows"),
            ("COMSPEC", r"C:\Windows\system32\cmd.exe"),
            // Git Bash 에서 띄우면 물려 오는 MSYS 경로 — 보지 않는다.
            ("SHELL", "/usr/bin/bash"),
        ];
        assert_eq!(
            resolve(
                HostOs::Windows,
                &env,
                &[pwsh_on_path, program_files, desktop],
                None
            ),
            pwsh_on_path
        );
        assert_eq!(
            resolve(HostOs::Windows, &env, &[program_files, desktop], None),
            program_files
        );
        assert_eq!(resolve(HostOs::Windows, &env, &[desktop], None), desktop);
        assert_eq!(
            resolve(HostOs::Windows, &env, &[], None),
            r"C:\Windows\system32\cmd.exe"
        );
        assert_eq!(resolve(HostOs::Windows, &[], &[], None), "cmd.exe");
    }

    #[test]
    fn windows_path_list_split_ignores_quotes_and_empty_entries() {
        assert_eq!(
            split_windows_path_list(r#"C:\a;;"C:\b c";  ;C:\d"#),
            [r"C:\a", r"C:\b c", r"C:\d"]
        );
    }

    /// 이 러너에서 실제로 고른 셸이 실제로 있다 — 판정과 파일 시스템이 어긋나면
    /// 터미널이 "Failed to spawn shell" 로 안 뜬다.
    #[test]
    fn the_system_default_shell_exists_on_this_runner() {
        let shell = system_default_shell();
        if cfg!(target_os = "macos") {
            return; // 예전 규칙 그대로 — $SHELL 의 존재를 확인하지 않는다.
        }
        if cfg!(windows) && shell.eq_ignore_ascii_case("cmd.exe") {
            panic!("Windows 에 PowerShell 이 하나도 없다고 판정했다: {shell}");
        }
        assert!(Path::new(&shell).is_file(), "고른 셸이 없다: {shell}");
        if cfg!(windows) {
            let lower = shell.to_ascii_lowercase();
            assert!(
                lower.ends_with("pwsh.exe") || lower.ends_with("powershell.exe"),
                "Windows 기본 셸은 PowerShell 이어야 한다: {shell}"
            );
        }
    }

    /// Linux 러너의 passwd 에는 로그인 셸이 적혀 있다 (`getpwuid_r` 가 실제로 돈다).
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn passwd_shell_reads_the_login_shell() {
        let shell = passwd_shell().expect("passwd 에 로그인 셸이 없다");
        assert!(shell.starts_with('/'), "{shell}");
    }
}

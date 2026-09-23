//! 프로세스 생성 단일 창구 (크로스플랫폼 라운드 D5 · 플랜 `cross-platform-port` #w1-proc).
//!
//! 앱의 자식 프로세스는 전부 여기서 만든다. `src-tauri/clippy.toml` 의
//! `disallowed-methods` 가 이 모듈 밖의 `std::process::Command::new` ·
//! `tokio::process::Command::new` 를 막는다 (#w1-proc-gate).
//!
//! ## Windows 에서 하는 일 둘
//!
//! 1. **`CREATE_NO_WINDOW`.** 릴리스 앱은 GUI 서브시스템(`windows_subsystem =
//!    "windows"`)이라 콘솔이 없다. 그 상태로 콘솔 프로그램(git · LSP · DAP ·
//!    ACP 어댑터 · npm …)을 띄우면 **자식마다 새 콘솔 창이 떴다 사라진다.**
//!    이 플래그는 콘솔을 만들되 창을 만들지 않는다 — 표준 입출력 파이프는
//!    그대로 동작한다.
//! 2. **`PATHEXT` 해석.** std 는 확장자 없는 맨 이름에 `.exe` 만 붙여 찾는다.
//!    npm 이 까는 CLI(`claude` · `codex` · `npx`)는 `claude.cmd` 같은 배치
//!    파일이라 `Command::new("claude")` 가 못 찾는다. 그래서 맨 이름이면 PATH ×
//!    PATHEXT 를 셸(cmd.exe)과 같은 순서 — 디렉터리마다 확장자 전부 — 로 뒤진다.
//!    - 첫 적중이 `.exe`/`.com` 이면 **아무것도 바꾸지 않는다.** std 가 제
//!      순서(앱 폴더 → System32 → PATH)로 같은 이름을 찾게 둔다.
//!    - 첫 적중이 `.cmd`/`.bat` 이면 그 **전체 경로**를 넘긴다. std 는 전체
//!      경로의 확장자를 보고 `cmd.exe /e:ON /v:OFF /d /c "…"` 로 감싸며 인자를
//!      cmd 규칙으로 인용한다 — `%` 치환 차단, `"` 이중화, 줄바꿈 인자 거부
//!      (CVE-2024-24576 "BatBadBut" 수정, Rust 1.77.2+).
//!    - 못 찾으면 원래 이름 그대로 — 예전과 같은 "program not found" 가 난다.
//!
//!    **`cmd /C` 를 여기서 손으로 감싸지 않는다.** 그러면 std 는 `cmd.exe` 를
//!    일반 exe 로 보고 인자를 MSVCRT 규칙으로 인용하는데, cmd 는 그 규칙을 따르지
//!    않는다 — `&`·`|`·`%VAR%` 가 인용을 뚫고 나가는 바로 그 취약점이 된다.
//!    인용 결과는 windows 러너에서 실제 배치 파일을 돌려 고정한다(아래 테스트).
//!
//! ## 그 밖의 OS
//!
//! `Command::new(program)` 그대로다 (D3 — macOS 동작 불변). `tokio_cmd` 도
//! `tokio::process::Command::new` 의 구현(`From<std::process::Command>`)과 같다.
//!
//! ## 호출부가 알아야 할 것
//!
//! - PATH 해석은 **부모 프로세스의 PATH** 로 한다. 자식에게 `.env("PATH", …)` 로
//!   다른 PATH 를 주는 호출부는 맨 이름 대신 전체 경로를 넘겨야 그 PATH 가
//!   반영된다(std 의 맨 이름 탐색은 자식 PATH 를 먼저 본다 — `.exe` 한정).
//! - Windows 에서 `creation_flags` 를 다시 부르면 **덮어쓴다.** 다른 플래그가
//!   필요하면 [`CREATE_NO_WINDOW`] 와 OR 해서 넘길 것.

use std::ffi::OsStr;

/// `CREATE_NO_WINDOW` (winbase.h). 콘솔은 만들되 창은 만들지 않는다.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 동기 자식 프로세스. 다른 OS 에서는 `std::process::Command::new(program)` 과 같다.
#[allow(clippy::disallowed_methods)] // 이 창구가 유일한 허용 자리다.
pub fn std_cmd(program: impl AsRef<OsStr>) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let program = program.as_ref();
        let resolved = resolve::batch_on_path(
            program,
            std::env::var_os("PATH").as_deref(),
            std::env::var_os("PATHEXT").as_deref(),
        );
        let mut cmd = match resolved {
            Some(path) => std::process::Command::new(path),
            None => std::process::Command::new(program),
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(program)
    }
}

/// 비동기 자식 프로세스. [`std_cmd`] 와 같은 규칙 — tokio 의 `Command::new` 도
/// 내부적으로 `From<std::process::Command>` 다.
pub fn tokio_cmd(program: impl AsRef<OsStr>) -> tokio::process::Command {
    tokio::process::Command::from(std_cmd(program))
}

/// PATH × PATHEXT 해석. 순수 함수 — PATH·PATHEXT 를 인자로 받아 프로세스 환경을
/// 건드리지 않고 테스트한다. Windows 가 아닌 곳에서는 테스트 빌드에만 있다.
#[cfg(any(windows, test))]
mod resolve {
    use std::ffi::OsStr;
    use std::path::PathBuf;

    /// CreateProcess 로 띄울 수 있는 확장자. PATHEXT 의 `.vbs`·`.js`·`.ps1` 같은
    /// 것은 셸이 연결 프로그램으로 여는 것이라 여기서는 고르지 않는다.
    const RUNNABLE: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];

    /// std 가 대신 감싸 주는 것 — 이것일 때만 전체 경로로 바꾼다.
    const BATCH: [&str; 2] = [".bat", ".cmd"];

    /// PATHEXT 가 없을 때 cmd.exe 의 기본값 중 [`RUNNABLE`] 인 것.
    const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

    /// 맨 이름(`claude`)이 PATH 에서 배치 파일로 먼저 잡히면 그 전체 경로.
    /// 그 밖(경로·확장자가 있는 이름·exe 가 먼저 잡힘·못 찾음)은 `None` —
    /// 호출부는 원래 이름을 그대로 std 에 넘긴다.
    pub(super) fn batch_on_path(
        program: &OsStr,
        path_var: Option<&OsStr>,
        pathext: Option<&OsStr>,
    ) -> Option<PathBuf> {
        let name = program.to_str()?;
        if !is_bare_name(name) {
            return None;
        }
        let lower = name.to_ascii_lowercase();
        if RUNNABLE.iter().any(|ext| lower.ends_with(ext)) {
            // `git.exe` · `claude.cmd` — std 가 PATH 에서 그대로 찾고, 배치면 감싼다.
            return None;
        }
        let exts = runnable_exts(pathext);
        for dir in std::env::split_paths(path_var?) {
            // 상대 PATH 항목(`.` 등)은 작업 폴더에 따라 뜻이 바뀐다 — 심어 둔
            // 실행 파일을 줍지 않게 건너뛴다. std 도 현재 폴더를 뒤지지 않는다.
            if !dir.is_absolute() {
                continue;
            }
            for ext in &exts {
                let candidate = dir.join(format!("{name}{ext}"));
                if candidate.is_file() {
                    return BATCH.contains(&ext.as_str()).then_some(candidate);
                }
            }
        }
        None
    }

    /// 디렉터리 구분자도 드라이브 표기(`C:`)도 없는 이름.
    fn is_bare_name(name: &str) -> bool {
        !name.is_empty() && !name.contains(['/', '\\', ':'])
    }

    /// PATHEXT 순서를 지키되 [`RUNNABLE`] 만, 소문자로, 중복 없이.
    fn runnable_exts(pathext: Option<&OsStr>) -> Vec<String> {
        let parse = |raw: &str| -> Vec<String> {
            let mut out: Vec<String> = Vec::new();
            for ext in raw.split(';') {
                let ext = ext.trim().to_ascii_lowercase();
                if RUNNABLE.contains(&ext.as_str()) && !out.contains(&ext) {
                    out.push(ext);
                }
            }
            out
        };
        let from_env = pathext
            .and_then(OsStr::to_str)
            .map(parse)
            .unwrap_or_default();
        if from_env.is_empty() {
            parse(DEFAULT_PATHEXT)
        } else {
            from_env
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::path::Path;

        fn touch(dir: &Path, file: &str) -> PathBuf {
            let p = dir.join(file);
            std::fs::write(&p, b"").unwrap();
            p
        }

        fn path_of(dirs: &[&Path]) -> std::ffi::OsString {
            std::env::join_paths(dirs).unwrap()
        }

        /// npm 이 까는 CLI 모양 — `claude.cmd` 만 있는 폴더.
        #[test]
        fn bare_name_finds_a_cmd_shim() {
            let tmp = tempfile::tempdir().unwrap();
            let shim = touch(tmp.path(), "claude.cmd");
            let path = path_of(&[tmp.path()]);
            assert_eq!(
                batch_on_path(OsStr::new("claude"), Some(&path), None),
                Some(shim)
            );
        }

        /// exe 가 먼저 잡히면 std 에 맡긴다 — std 의 exe 탐색 순서를 바꾸지 않는다.
        #[test]
        fn exe_first_is_left_to_std() {
            let tmp = tempfile::tempdir().unwrap();
            touch(tmp.path(), "tool.exe");
            touch(tmp.path(), "tool.cmd");
            let path = path_of(&[tmp.path()]);
            assert_eq!(batch_on_path(OsStr::new("tool"), Some(&path), None), None);
        }

        /// 셸과 같은 순서 — 디렉터리가 먼저, 그 안에서 PATHEXT 순서.
        #[test]
        fn earlier_directory_wins_over_extension_order() {
            let a = tempfile::tempdir().unwrap();
            let b = tempfile::tempdir().unwrap();
            let shim = touch(a.path(), "tool.bat");
            touch(b.path(), "tool.exe");
            let path = path_of(&[a.path(), b.path()]);
            assert_eq!(
                batch_on_path(OsStr::new("tool"), Some(&path), None),
                Some(shim)
            );
        }

        /// PATHEXT 순서가 같은 폴더 안의 우선순위다. 띄울 수 없는 확장자는 버린다.
        #[test]
        fn pathext_order_and_filter() {
            let tmp = tempfile::tempdir().unwrap();
            let bat = touch(tmp.path(), "tool.bat");
            touch(tmp.path(), "tool.cmd");
            touch(tmp.path(), "tool.js");
            let path = path_of(&[tmp.path()]);
            let ext = OsStr::new(".JS;.BAT;.CMD");
            assert_eq!(
                batch_on_path(OsStr::new("tool"), Some(&path), Some(ext)),
                Some(bat)
            );
            let ext = OsStr::new(".JS;.CMD;.BAT");
            assert_eq!(
                batch_on_path(OsStr::new("tool"), Some(&path), Some(ext)),
                Some(tmp.path().join("tool.cmd"))
            );
            // 띄울 수 있는 것이 하나도 없는 PATHEXT → 기본값으로.
            assert_eq!(
                runnable_exts(Some(OsStr::new(".VBS;.JS"))),
                [".com", ".exe", ".bat", ".cmd"]
            );
        }

        /// 경로·확장자가 있는 이름·빈 이름은 해석하지 않는다.
        #[test]
        fn only_bare_names_are_resolved() {
            let tmp = tempfile::tempdir().unwrap();
            touch(tmp.path(), "claude.cmd");
            let path = path_of(&[tmp.path()]);
            for name in [
                "",
                "claude.cmd",
                "claude.CMD",
                "git.exe",
                "./claude",
                "bin/claude",
                r"bin\claude",
                "C:claude",
            ] {
                assert_eq!(
                    batch_on_path(OsStr::new(name), Some(&path), None),
                    None,
                    "{name:?}"
                );
            }
        }

        /// 상대 PATH 항목은 작업 폴더를 뒤지는 셈이라 건너뛴다. PATH 가 없으면 None.
        #[test]
        fn relative_path_entries_and_missing_path_are_ignored() {
            let path = std::env::join_paths(["relative-dir"]).unwrap();
            assert_eq!(batch_on_path(OsStr::new("claude"), Some(&path), None), None);
            assert_eq!(batch_on_path(OsStr::new("claude"), None, None), None);
        }

        /// 못 찾으면 None — 호출부는 원래 이름을 넘기고 std 가 예전과 같은 에러를 낸다.
        #[test]
        fn not_found_is_none() {
            let tmp = tempfile::tempdir().unwrap();
            let path = path_of(&[tmp.path()]);
            assert_eq!(batch_on_path(OsStr::new("nope"), Some(&path), None), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D3 — Windows 가 아닌 곳에서는 이름을 한 글자도 바꾸지 않는다.
    #[cfg(not(windows))]
    #[test]
    fn non_windows_passes_the_program_through() {
        assert_eq!(std_cmd("git").get_program(), OsStr::new("git"));
        assert_eq!(tokio_cmd("git").as_std().get_program(), OsStr::new("git"));
        assert_eq!(std_cmd("/bin/sh").get_program(), OsStr::new("/bin/sh"));
    }

    /// CREATE_NO_WINDOW 를 달아도 표준 출력 파이프는 그대로 읽힌다.
    #[cfg(windows)]
    #[test]
    fn windows_console_child_output_is_captured() {
        let out = std_cmd("cmd")
            .args(["/C", "echo", "proc-ok"])
            .output()
            .unwrap();
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "proc-ok");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_tokio_child_output_is_captured() {
        let out = tokio_cmd("cmd")
            .args(["/C", "echo", "proc-ok"])
            .output()
            .await
            .unwrap();
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "proc-ok");
    }

    /// 실제 배치 파일로 PATHEXT 해석 + std 의 cmd 인용을 끝까지 돌린다.
    ///
    /// 배치는 `echo [%1]` 꼴로 인자를 되돌려 준다. `%1` 은 따옴표를 벗기지 않으므로
    /// 출력에서 std 가 무엇을 따옴표로 감쌌는지가 그대로 보인다. 단언하는 것:
    /// - 공백·`&`·`^`·`%` 가 든 인자는 따옴표로 감싸져 **한 인자로** 도착한다.
    /// - `%PATH%` 는 치환되지 않고 글자 그대로 도착한다.
    /// - 인용을 깨려는 `"` 는 이중화돼 명령 주입(`& echo INJECTED`)이 실행되지 않는다.
    /// - 줄바꿈이 든 인자는 띄우기 전에 거부된다.
    #[cfg(windows)]
    #[test]
    fn windows_batch_shim_resolution_and_quoting() {
        let tmp = tempfile::tempdir().unwrap();
        let script = "@echo off\r\n\
                      echo [%1]\r\n\
                      echo [%2]\r\n\
                      echo [%3]\r\n\
                      echo [%4]\r\n\
                      echo [%5]\r\n\
                      echo [%6]\r\n\
                      echo [%7]\r\n";
        std::fs::write(tmp.path().join("oculpm-echo-args.cmd"), script).unwrap();

        let path = std::env::join_paths(std::iter::once(tmp.path().to_path_buf()).chain(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
        ))
        .unwrap();
        let resolved = resolve::batch_on_path(OsStr::new("oculpm-echo-args"), Some(&path), None)
            .expect("맨 이름이 PATH 의 .cmd 로 풀려야 한다");
        assert_eq!(resolved, tmp.path().join("oculpm-echo-args.cmd"));

        let mut cmd = std_cmd(&resolved);
        cmd.args([
            "plain",
            "two words",
            "a&b",
            "caret^x",
            "%PATH%",
            r#"x" & echo INJECTED & ""#,
            "",
        ]);
        let out = cmd.output().expect("배치 실행");
        assert!(out.status.success(), "{out:?}");
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().map(str::trim_end).collect();
        assert_eq!(
            lines,
            [
                "[plain]",
                "[\"two words\"]",
                "[\"a&b\"]",
                "[\"caret^x\"]",
                "[\"%PATH%\"]",
                r#"["x"" & echo INJECTED & """]"#,
                "[\"\"]",
            ],
            "cmd 인용 규칙이 바뀌었다 — stdout:\n{stdout}"
        );
        assert!(!lines.contains(&"INJECTED"), "명령 주입이 실행됐다");

        // BatBadBut: 줄바꿈은 cmd 가 명령을 끊는 자리라 std 가 띄우기 전에 거부한다.
        let err = std_cmd(&resolved)
            .arg("line\r\nbreak")
            .output()
            .expect_err("줄바꿈 인자는 거부돼야 한다");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }

    /// 못 찾은 맨 이름은 그대로 std 에 간다 — 예전과 같은 NotFound 가 난다.
    #[cfg(windows)]
    #[test]
    fn windows_unresolvable_name_is_passed_through() {
        let name = "oculpm-surely-not-on-path-7f3a";
        assert_eq!(std_cmd(name).get_program(), OsStr::new(name));
        let err = std_cmd(name).output().expect_err("없는 프로그램");
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }
}

//! 실행 줄의 시험 (최종 검수 TERM-1 · TERM-2 · TERM-4 · SEC-01 · X-02) — `terminal_env.rs` 가 800줄을 넘지 않게
//! 떼어 냈다. 진짜 PTY 시험은 셸마다 앱과 같은 실행 인자로 띄우되 사용자 rc 는 읽지 않는다(빈 ZDOTDIR · HOME).
//! 그 셸이 없는 기계에서는 그 셸만 건너뛴다.

use super::super::tests::spec;
use super::super::{OpenSpec, TermCheck, TermSessions};
use super::*;

/// 사례표 — 웹뷰 `runCheck.ts` 와 같은 표(`terminal_check_cases.json`).
#[derive(serde::Deserialize)]
struct Cases {
    invisible: Vec<String>,
    visible: Vec<String>,
    lines: Vec<CaseLine>,
    ps51: Vec<Ps51Case>,
}

#[derive(serde::Deserialize)]
struct Ps51Case {
    why: String,
    line: String,
    chain: bool,
}

/// Windows PowerShell 5.1 은 `&&` · `||` 를 모른다 — 따옴표 밖의 사슬만 거절한다(사례표의 `ps51`). 5.1 에서 거절하는
/// 오류 문구는 명령이 `check_ps51_chain` 코드로 바꾸는 바로 그 글이다.
#[test]
fn ps51_refuses_chains_outside_quotes() {
    let cases: Cases =
        serde_json::from_str(include_str!("terminal_check_cases.json")).expect("사례표");
    assert!(!cases.ps51.is_empty());
    for case in &cases.ps51 {
        assert_eq!(ps51_chain(&case.line), case.chain, "{}", case.why);
        // 5.1 이 거절할 줄도 한 줄 문은 지난다 — 거절은 셸을 고른 뒤 따로 한다.
        if case.chain {
            assert!(is_one_line(&case.line), "{}", case.why);
        }
    }
    assert!(super::super::CHECK_PS51_CHAIN.starts_with("check: "));
}

#[derive(serde::Deserialize)]
struct CaseLine {
    why: String,
    line: String,
    ok: bool,
}

/// `U+202E` → 그 글자.
fn char_of(code: &str) -> char {
    let hex = code.strip_prefix("U+").expect("U+XXXX 꼴");
    char::from_u32(u32::from_str_radix(hex, 16).expect("16진수")).expect("유니코드 글자")
}

/// 두 문이 같은 표로 판정한다 — 보이지 않는 글자가 하나라도 든 줄은 열지 않고, 보이는 글자(한글 · 기호 · 이모지 ·
/// 오른쪽에서 왼쪽 글자 · 범위 바로 옆 글자)는 지난다. 최종 검수가 든 모양들(Trojan Source · 공백 밀어내기)도.
#[test]
fn the_check_gate_shares_its_cases_with_the_webview() {
    let cases: Cases =
        serde_json::from_str(include_str!("terminal_check_cases.json")).expect("사례표");
    for code in &cases.invisible {
        let c = char_of(code);
        assert!(is_invisible(c), "{code}");
        assert!(!is_one_line(&format!("pnpm test {c}x")), "{code}");
    }
    for code in &cases.visible {
        let c = char_of(code);
        assert!(!is_invisible(c), "{code}");
        assert!(is_one_line(&format!("echo {c}")), "{code}");
    }
    for case in &cases.lines {
        assert_eq!(is_one_line(&case.line), case.ok, "{}", case.why);
    }
}

/// 보이지 않는 글자가 든 확인 명령으로는 세션을 열지 않는다 — 셸을 띄우기 전에 돌아온다.
#[test]
fn open_refuses_a_check_with_invisible_characters() {
    let sessions = TermSessions::default();
    let line = "pnpm test \u{2067}; rm -rf ./build #\u{2069}".to_string();
    let label = "check".to_string();
    let spec = OpenSpec {
        check: Some(TermCheck { line, label }),
        ..spec("w", 1)
    };
    assert!(sessions.open(spec, |_| {}).is_err());
    assert!(sessions.list("w").is_empty(), "세션이 생기지 않는다");
}

/// TERM-4 — unix 의 pwsh 는 「다음」 · 잇기 · 확인 명령 세션도 로그인 셸(`-l` 이 첫 인자)로 뜬다. 빈 세션(`pwsh -l`)과
/// 같은 PATH 다. Windows 에는 뜻이 없어 그대로.
#[test]
fn pwsh_on_unix_logs_in_first_like_a_plain_session() {
    let run = Launch::Run {
        prompt_empty: false,
    };
    assert_eq!(
        args_for("pwsh", run, true).unwrap(),
        ["-l", "-NoExit", "-Command", "claude $env:OCULPM_PROMPT"]
    );
    assert_eq!(
        args_for("pwsh", Launch::Check("pnpm test"), true).unwrap(),
        ["-l", "-NoExit", "-Command", "pnpm test"]
    );
    assert_eq!(
        args_for("pwsh", Launch::Resume, false).unwrap()[0],
        "-NoExit"
    );
    if cfg!(unix) {
        assert_eq!(launch_args("pwsh", Launch::Resume).unwrap()[0], "-l");
    }
}

#[cfg(unix)]
mod pty {
    use super::super::super::tests::{spec, wait_until};
    use super::super::super::{OpenSpec, TermCheck, TermEvent, TermSessions};
    use super::super::*;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    /// 앱과 같은 실행 인자로 띄운 셸 하나 — 출력은 모아 둔다(작업 제어의 알림 · 준비 표시를 본다).
    struct Pty {
        sessions: TermSessions,
        id: u32,
        out: Arc<Mutex<String>>,
    }

    impl Pty {
        fn write(&self, data: &str) {
            self.sessions.write(self.id, data).unwrap();
        }

        fn output(&self) -> String {
            self.out.lock().unwrap().clone()
        }

        /// 할 일이 앞에 섰다 — 준비 표시(`READY`)가 찍혔고 셸이 아닌 것이 터미널 앞이다. rc 를 읽는 동안의 자식
        /// (path_helper 등)을 할 일로 잘못 보고 신호를 보내지 않게 표시를 함께 본다.
        fn wait_running(&self, why: &str) {
            wait_until(
                || self.output().contains("READY") && self.sessions.list("w")[0].busy,
                why,
            );
        }

        /// 다시 선 로그인 셸이 사람이 치는 다음 줄을 받는다 — 그 줄이 파일을 쓴다.
        fn takes_the_next_line(&self, dir: &Path, why: &str) {
            let file = dir.join("next");
            let _ = std::fs::remove_file(&file);
            self.write(&format!("printf ok > '{}'\r", file.display()));
            wait_until(
                || std::fs::read_to_string(&file).is_ok_and(|s| s == "ok"),
                why,
            );
            assert!(self.sessions.list("w")[0].alive, "{why}");
        }
    }

    impl Drop for Pty {
        fn drop(&mut self) {
            self.sessions.close_all();
        }
    }

    /// 그 셸을 앱과 같은 인자로 띄운다 — `SHELL` 은 그 셸, rc 는 빈 임시 폴더(zsh 는 ZDOTDIR, bash 는 HOME).
    /// 확인 명령이면 `start` 가 그 줄을 `OCULPM_CHECK` 로 싣는다(앱과 같은 길). 빈 `.zshenv` 를 둔다 — 시작 파일이
    /// 하나도 없으면 zsh/newuser 가 설치 메뉴를 띄워 키를 기다린다(그 스크립트를 싣는 데비안 · 우분투 zsh).
    fn launch(shell: &Path, how: Launch<'_>, spec: OpenSpec, rc: &Path) -> Pty {
        std::fs::write(rc.join(".zshenv"), "").unwrap();
        let name = shell.file_name().unwrap().to_string_lossy().into_owned();
        let mut cmd = CommandBuilder::new(shell);
        cmd.args(launch_args(&name, how).unwrap());
        cmd.env("SHELL", shell);
        cmd.env("ZDOTDIR", rc);
        cmd.env("HOME", rc);
        cmd.env("BASH_SILENCE_DEPRECATION_WARNING", "1");
        let out = Arc::new(Mutex::new(String::new()));
        let sink = out.clone();
        let sessions = TermSessions::default();
        let info = sessions
            .start(spec, cmd, "check".into(), None, move |e| {
                if let TermEvent::Output { data, .. } = e {
                    sink.lock().unwrap().push_str(&data);
                }
            })
            .unwrap();
        Pty {
            sessions,
            id: info.id,
            out,
        }
    }

    fn launch_check(shell: &Path, line: &str, rc: &Path) -> Pty {
        let check = Some(TermCheck {
            line: line.to_string(),
            label: "check".into(),
        });
        launch(
            shell,
            Launch::Check(line),
            OpenSpec {
                check,
                ..spec("w", 1)
            },
            rc,
        )
    }

    /// 이 기계에 있는 셸 — 없으면 건너뛴다(zsh 는 macOS 기본 셸, bash 는 리눅스 기본 셸).
    fn shells() -> Vec<&'static Path> {
        ["/bin/zsh", "/bin/bash"]
            .into_iter()
            .map(Path::new)
            .filter(|p| p.exists())
            .collect()
    }

    /// TERM-1 — 도는 확인 명령을 Ctrl+C 로 멈춰도 셸이 남아 다음 줄을 받는다. zsh 는 예전에 그 신호를 자기도 받은
    /// 것처럼 `-c` 의 나머지(`exec`)를 건너뛰고 끝나, 세션이 「끝남 · 코드 130」 이 됐다. Ctrl+\ 도 같은 길이다.
    /// 사슬의 뒤(`&& b`)는 돌지 않는다 — 사람이 멈춘 것은 확인 명령 전체다.
    #[test]
    fn ctrl_c_on_a_running_check_leaves_a_shell_behind() {
        for shell in shells() {
            for key in ["\x03", "\x1c"] {
                let rc = tempfile::tempdir().unwrap();
                let ran = rc.path().join("ran");
                let line = format!("printf READY; sleep 30 && printf ran > '{}'", ran.display());
                let pty = launch_check(shell, &line, rc.path());
                pty.wait_running(&format!("{shell:?}: 확인 명령이 앞에 서지 않았다"));
                pty.write(key);
                let why = format!("{shell:?} {key:?}: 신호 뒤에 셸이 남지 않았다");
                pty.takes_the_next_line(rc.path(), &why);
                assert!(!ran.exists(), "{shell:?} {key:?}: 멈춘 사슬의 뒤가 돌았다");
            }
        }
    }

    /// TERM-1 — Ctrl+Z 로 멈춘 확인 명령을 잃지 않는다. 사슬(`a && b`)째 앞으로 되돌려 끝까지 돌리고(두 번 멈춰도),
    /// 그 뒤에 셸이 남는다. 예전에는 `exec` 가 작업 표를 버려 zsh 는 멈춘 작업을 T 상태 고아로 남기고, bash 는 그
    /// 작업을 죽였다. 멈춘 `a` 만 되살리던 때는 `b` 를 조용히 건너뛰었다(이 저장소의 확인 명령이 `… && …` 사슬이다).
    #[test]
    fn ctrl_z_on_a_running_check_is_resumed_not_orphaned() {
        for shell in shells() {
            let rc = tempfile::tempdir().unwrap();
            let done = rc.path().join("done");
            let line = format!(
                "printf READY; sleep 2 && printf resumed > '{}'",
                done.display()
            );
            let pty = launch_check(shell, &line, rc.path());
            pty.wait_running(&format!("{shell:?}: 확인 명령이 앞에 서지 않았다"));
            pty.write("\x1a");
            std::thread::sleep(std::time::Duration::from_millis(500));
            pty.write("\x1a");
            wait_until(
                || std::fs::read_to_string(&done).is_ok_and(|s| s == "resumed"),
                &format!("{shell:?}: 멈춘 작업이 다시 돌지 않았다"),
            );
            let said = pty.output().to_lowercase();
            assert!(
                said.contains("suspended") || said.contains("stopped"),
                "{shell:?}: Ctrl+Z 가 작업을 멈추지 않았다(시험이 헛돈다): {said:?}"
            );
            pty.takes_the_next_line(rc.path(), &format!("{shell:?}: 작업 뒤에 셸이 남지 않았다"));
        }
    }

    /// X-02 — 끝이 `|` · `||` 이거나 `<<EOF` · 닫히지 않은 따옴표를 품은 줄도 앱이 붙인 줄을 삼키지 못한다. `eval` 이
    /// 그 글만 따로 읽어 문법 오류로 끝나고 셸이 남는다. 예전에는 `cat NOTES |` 면 새 셸이 파이프로 NOTES 를 받아 그
    /// 줄들을 명령으로 돌리고 세션이 닫혔다.
    #[test]
    fn a_dangling_check_cannot_swallow_the_shell_that_follows() {
        for shell in shells() {
            let rc = tempfile::tempdir().unwrap();
            let (notes, pwned) = (rc.path().join("NOTES"), rc.path().join("PWNED"));
            let inject = format!("printf pwned > '{}'\n", pwned.display());
            std::fs::write(&notes, inject).unwrap();
            let lines = [
                format!("cat '{}' |", notes.display()),
                "true ||".to_string(),
                "cat <<EOF".to_string(),
                "echo \"not closed".to_string(),
            ];
            for line in lines {
                let pty = launch_check(shell, &line, rc.path());
                let why = format!("{shell:?} {line:?}: 셸이 남지 않았다");
                pty.takes_the_next_line(rc.path(), &why);
                assert!(
                    !pwned.exists(),
                    "{shell:?} {line:?}: 파일 내용이 명령으로 돌았다"
                );
            }
        }
    }

    /// 「다음」 의 claude 줄도 같은 조립이다 — claude 가 SIGINT 로 죽어도 셸이 남는다. 가짜 claude(준비 표시를 찍고
    /// 기다리는 sh 스크립트)는 PATH 맨 앞(rc 안 — 시스템 path_helper 뒤)에 둔다.
    #[test]
    fn the_next_line_also_leaves_a_shell_after_ctrl_c() {
        use std::os::unix::fs::PermissionsExt;
        let Some(zsh) = shells().into_iter().find(|p| p.ends_with("zsh")) else {
            return;
        };
        let rc = tempfile::tempdir().unwrap();
        let bin = rc.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let fake = bin.join("claude");
        std::fs::write(&fake, "#!/bin/sh\nprintf READY\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = format!("export PATH='{}':$PATH\n", bin.display());
        std::fs::write(rc.path().join(".zshrc"), path).unwrap();
        let run = Launch::Run {
            prompt_empty: false,
        };
        let spec = OpenSpec {
            prompt: Some("다음 항목".into()),
            ..spec("w", 1)
        };
        let pty = launch(zsh, run, spec, rc.path());
        pty.wait_running("가짜 claude 가 앞에 서지 않았다");
        pty.write("\x03");
        pty.takes_the_next_line(rc.path(), "claude 가 SIGINT 로 죽은 뒤 셸이 남지 않았다");
    }
    /// claude 를 못 찾으면 셸이 무슨 언어로 말하든 종료 코드 127 로 표지(OSC 6973)를 남긴다 — 웹뷰가 그것을 읽어
    /// 「claude 를 못 찾았어요」 를 띄운다(love-round #launch-fail-any-locale). 한국어 로캘 bash 의 「명령어를 찾을 수
    /// 없음」 은 영어 정규식에 안 걸렸다. claude 가 있으면(가짜 claude, 종료 0) 표지가 없다. PATH 는 rc 에서 시스템
    /// 폴더만으로 좁힌다 — 이 기계에 진짜 claude 가 깔려 있어도 시험이 그것을 띄우지 않게.
    #[test]
    fn a_missing_claude_leaves_a_mark_whatever_the_shell_language() {
        use std::os::unix::fs::PermissionsExt;
        const MARK: &str = "\x1b]6973;ocul-launch=127\x07";
        for shell in shells() {
            for present in [false, true] {
                let rc = tempfile::tempdir().unwrap();
                let bin = rc.path().join("bin");
                std::fs::create_dir_all(&bin).unwrap();
                if present {
                    let fake = bin.join("claude");
                    std::fs::write(&fake, "#!/bin/sh\nprintf READY\nexit 0\n").unwrap();
                    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755))
                        .unwrap();
                }
                let path = format!("export PATH='{}':/usr/bin:/bin\n", bin.display());
                std::fs::write(rc.path().join(".zshrc"), &path).unwrap();
                std::fs::write(rc.path().join(".bash_profile"), &path).unwrap();
                let run = Launch::Run {
                    prompt_empty: false,
                };
                let spec = OpenSpec {
                    prompt: Some("다음 항목".into()),
                    ..spec("w", 1)
                };
                let pty = launch(shell, run, spec, rc.path());
                let why = format!("{shell:?} present={present}: 셸이 다시 서지 않았다");
                pty.takes_the_next_line(rc.path(), &why);
                let out = pty.output();
                assert_eq!(
                    out.contains(MARK),
                    !present,
                    "{shell:?} present={present}: {out:?}"
                );
            }
        }
    }
}

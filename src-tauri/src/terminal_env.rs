//! 앱 안 터미널 셸의 환경과 「다음」 실행 줄 — `terminal.rs` 가 800줄을 넘지 않게 떼어 냈다(2026-11-15).
//!
//! # 환경 ([`apply_env`])
//!
//! Finder 로 띄운 설치본은 `LANG` 이 없다. 그러면 zsh 가 한글을 바이트로 다뤄 백스페이스가 자모를 쪼개고
//! `ls` 의 한글이 깨지며, 같은 환경을 받는 Claude 의 Bash 도구도 한글 파일 이름을 잘못 읽는다 — 7월에 고친
//! 근본 원인(969f8405)이 4.0 에서 터미널을 다시 들일 때 빠졌다. 거꾸로 터미널에서 띄운 개발판은 그 터미널의
//! 신원(`TERM_PROGRAM=iTerm.app` · `VSCODE_*` · `TMUX` · `CLAUDECODE`)을 물려줘, 안의 claude 가 다른 터미널 ·
//! 중첩 세션으로 착각했다. 셸이 받는 환경은 여기 한 곳에서 정한다.
//!
//! # 실행 줄 ([`launch_args`])
//!
//! 「다음」 은 예전에 셸이 rc 를 읽기도 전에 `claude "$OCULPM_PROMPT"` 를 tty 에 쳐 넣었다. oh-my-zsh 업데이트
//! `[Y/n]` · p10k 마법사 · conda 질문이 앞 글자를 먹으면 나머지(`laude …`)가 명령으로 돌았다. 이제 셸이 그 줄을
//! **명령 인자**로 받는다 — `$SHELL -l -i -c 'claude "$OCULPM_PROMPT"; exec "$SHELL" -l -i'`. rc 의 질문은
//! 질문대로 묻고, claude 가 끝나면 같은 자리(같은 pid)에 로그인 셸이 선다. 달라진 것 하나: claude 줄이 셸
//! 기록(history)에 남지 않는다. 프롬프트는 여전히 환경 변수로 넘겨 셸 문법으로 이스케이프할 일이 없다.
//!
//! 맞바꾼 것 하나: rc 가 다른 프로그램을 `exec` 하면(oh-my-zsh tmux 플러그인의 `ZSH_TMUX_AUTOSTART`,
//! `[ -z "$TMUX" ] && exec tmux` — Finder 로 띄운 앱에는 `TMUX` 가 없어 늘 참이다) `-c` 의 명령은 아예 돌지
//! 않는다. 「다음」 은 claude 없이 tmux 안의 빈 셸로 조용히 끝나고, `launchCheck` 도 잡지 못한다. 쳐 넣던 때는
//! tty 에 남은 줄을 tmux 가 받아 그대로 돌렸다. rc 의 질문이 첫 글자를 먹던 쪽이 훨씬 흔해 이쪽을 골랐다.

use portable_pty::CommandBuilder;

use super::PROMPT_ENV;

/// 셋이 다 비었을 때만 `LANG` 을 정한다 — 사용자가 고른 로캘은 무엇이든 그대로.
const LOCALE_VARS: [&str; 3] = ["LANG", "LC_ALL", "LC_CTYPE"];

/// 로캘이 비었을 때의 `LANG` — 메시지는 그대로 영어(비어 있을 때의 C 와 같다)이고 글자만 UTF-8 이 된다.
/// Windows 셸(PowerShell)은 이 변수를 보지 않는다.
const DEFAULT_LANG: Option<&str> = if cfg!(target_os = "macos") {
    Some("en_US.UTF-8")
} else if cfg!(windows) {
    None
} else {
    Some("C.UTF-8")
};

/// 물려받으면 안의 프로그램이 다른 터미널 · 중첩 세션으로 착각하는 이름. `CLAUDE_CODE_SSE_PORT` 는 VS Code
/// 통합 터미널이 다는 IDE 연결 자리다 — 안의 claude 가 바깥 편집기에 붙으려 했다.
const FOREIGN: [&str; 13] = [
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERM_SESSION_ID",
    "LC_TERMINAL",
    "LC_TERMINAL_VERSION",
    "VTE_VERSION",
    "WT_SESSION",
    "WT_PROFILE_ID",
    "TMUX",
    "TMUX_PANE",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
];

/// 그 터미널들은 이 머리로 시작하는 이름을 여럿 둔다(`ITERM_SESSION_ID` · `KITTY_WINDOW_ID` · `VSCODE_PID` …).
const FOREIGN_PREFIXES: [&str; 7] = [
    "ITERM_",
    "KITTY_",
    "GHOSTTY_",
    "WEZTERM_",
    "VSCODE_",
    "ALACRITTY_",
    "KONSOLE_",
];

fn is_foreign(key: &str) -> bool {
    FOREIGN.contains(&key) || FOREIGN_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// 셸이 받을 환경을 정한다 — 앱 프로세스의 환경을 물려받은 `cmd` 위에서(`CommandBuilder` 가 만들 때 부모
/// 환경을 담는다). 부모를 따로 묻지 않고 `cmd` 의 환경을 읽으므로, 시험은 `env_clear` · `env` 로 부모를 꾸민다.
pub(super) fn apply_env(cmd: &mut CommandBuilder) {
    // ① 로캘 — 셋이 다 비었을 때만, 인코딩만.
    if let Some(lang) = DEFAULT_LANG {
        let any_set = LOCALE_VARS.iter().any(|key| {
            cmd.get_env(key)
                .is_some_and(|v| !v.to_string_lossy().trim().is_empty())
        });
        if !any_set {
            cmd.env("LANG", lang);
        }
    }
    // ② 물려받은 터미널 신원 — 머리로 찾는 것이 있어 부모 환경을 훑어 이름을 모은다.
    let foreign: Vec<String> = cmd
        .iter_full_env_as_str()
        .map(|(key, _)| key)
        .filter(|key| is_foreign(key))
        .map(str::to_string)
        .collect();
    for key in foreign {
        cmd.env_remove(key);
    }
    // ③ 이 터미널의 신원과 늘 같은 줄.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Ocul");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    // Claude Code 의 전체 화면 렌더러 — 일반 렌더러는 크기가 바뀔 때마다 지난 화면을
    // 다시 쏟아 스크롤백을 더럽혔다(3.x 실측, v3.13.2).
    cmd.env("CLAUDE_CODE_NO_FLICKER", "1");
    // Claude Code 는 TERM_PROGRAM 목록에 없는 터미널을 하이퍼링크 미지원으로 보고 경로를 맨 글자로
    // 찍는다 — 이 신호가 있으면 `file://` 절대경로로 감싸 보내고(OSC 8), 프런트가 그 링크로
    // 이미지를 미리 보여 준다(`features/terminal/fileLinks.ts`). 빼면 미리보기가 조용히 죽는다.
    cmd.env("FORCE_HYPERLINK", "1");
}

/// 「다음」 · 잇기 — 셸이 무엇을 돌리고 남을지.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Launch {
    /// `claude "$OCULPM_PROMPT"`. 프롬프트가 비면 그냥 `claude` — 「끝까지」가 띄운 뒤 입력 대기 신호를
    /// 받고 `/goal …` 을 넣는다(시작 인자로 넘기는 슬래시 명령은 문서에 없다).
    Run { prompt_empty: bool },
    /// 업데이트 전 대화를 잇는다 — 그 폴더의 가장 최근 대화(`claude --continue`).
    Resume,
}

impl Launch {
    pub(super) fn of(prompt: Option<&str>, resume: bool) -> Option<Launch> {
        if resume {
            return Some(Launch::Resume);
        }
        prompt.map(|p| Launch::Run {
            prompt_empty: p.is_empty(),
        })
    }

    /// claude 를 띄우는 명령 — `powershell` 이면 PowerShell 문법, 아니면 POSIX 셸 · fish 공통 문법.
    fn claude(self, powershell: bool) -> String {
        match self {
            Launch::Resume => "claude --continue".to_string(),
            Launch::Run { prompt_empty: true } => "claude".to_string(),
            Launch::Run { .. } if powershell => format!("claude $env:{PROMPT_ENV}"),
            Launch::Run { .. } => format!("claude \"${PROMPT_ENV}\""),
        }
    }
}

/// `-l -i -c` 를 같은 뜻으로 읽는 셸 — POSIX 셸들과 fish.
const ARGV_SHELLS: [&str; 7] = ["zsh", "bash", "fish", "sh", "dash", "ksh", "mksh"];

/// 셸 이름(`zsh` · `pwsh` …)에 맞는 실행 인자. `None` 이면 그 셸은 줄을 인자로 받지 못한다 — 문법이 다른
/// nushell · 로그인 깃발을 홀로만 받는 csh 계열 등은 예전처럼 줄을 쳐 넣는다([`typed_line`]).
///
/// unix 는 `exec "$SHELL" -l -i` 로 같은 셸에 돌아온다 — 부르는 쪽이 `SHELL` 을 그 셸로 둔다. PowerShell 은
/// `-NoExit` 이 같은 일을 한다(프로필은 한 번만 읽는다).
pub(super) fn launch_args(shell: &str, launch: Launch) -> Option<Vec<String>> {
    match shell {
        "pwsh" | "powershell" => Some(vec![
            "-NoExit".to_string(),
            "-Command".to_string(),
            launch.claude(true),
        ]),
        name if ARGV_SHELLS.contains(&name) => Some(vec![
            "-l".to_string(),
            "-i".to_string(),
            "-c".to_string(),
            format!("{}; exec \"$SHELL\" -l -i", launch.claude(false)),
        ]),
        _ => None,
    }
}

/// 인자로 못 받는 셸에 쳐 넣는 한 줄 — 셸이 아직 프롬프트를 그리기 전이어도 tty 가 받아 둔다.
pub(super) fn typed_line(launch: Launch) -> String {
    format!("{}\r", launch.claude(cfg!(windows)))
}

/// 셸 명령에 실행 줄을 붙인다 — 받는 셸이면 인자로, 아니면 `plain`(줄이 없을 때의 인자)만 붙이고 쳐 넣을
/// 줄을 돌려준다.
pub(super) fn attach_launch(
    cmd: &mut CommandBuilder,
    shell: &str,
    launch: Option<Launch>,
    plain: &[&str],
) -> Option<String> {
    let args = launch.and_then(|l| launch_args(shell, l));
    let typed = match (&args, launch) {
        (None, Some(l)) => Some(typed_line(l)),
        _ => None,
    };
    match args {
        Some(args) => cmd.args(args),
        None => cmd.args(plain),
    }
    typed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 부모 환경을 꾸민 명령 — `CommandBuilder` 는 만들 때 앱의 환경을 담으므로 비우고 시작한다.
    fn parent(vars: &[(&str, &str)]) -> CommandBuilder {
        let mut cmd = CommandBuilder::new("sh");
        cmd.env_clear();
        for (k, v) in vars {
            cmd.env(k, v);
        }
        cmd
    }

    fn get(cmd: &CommandBuilder, key: &str) -> Option<String> {
        cmd.get_env(key).map(|v| v.to_string_lossy().into_owned())
    }

    #[test]
    fn an_empty_locale_becomes_utf8_and_a_chosen_one_stays() {
        let mut cmd = parent(&[("HOME", "/Users/me")]);
        apply_env(&mut cmd);
        assert_eq!(get(&cmd, "LANG").as_deref(), DEFAULT_LANG);
        if cfg!(target_os = "macos") {
            assert_eq!(get(&cmd, "LANG").as_deref(), Some("en_US.UTF-8"));
        }

        let mut cmd = parent(&[("LANG", "ko_KR.UTF-8")]);
        apply_env(&mut cmd);
        assert_eq!(get(&cmd, "LANG").as_deref(), Some("ko_KR.UTF-8"));

        // LC_ALL 이나 LC_CTYPE 만 골랐어도 그 선택을 존중한다 — LANG 을 새로 달지 않는다.
        for key in ["LC_ALL", "LC_CTYPE"] {
            let mut cmd = parent(&[(key, "C")]);
            apply_env(&mut cmd);
            assert_eq!(get(&cmd, "LANG"), None, "{key}");
            assert_eq!(get(&cmd, key).as_deref(), Some("C"));
        }
        // 빈 값은 없는 것과 같다.
        let mut cmd = parent(&[("LANG", " ")]);
        apply_env(&mut cmd);
        assert_eq!(get(&cmd, "LANG").as_deref(), DEFAULT_LANG.or(Some(" ")));
    }

    #[test]
    fn the_parent_terminal_identity_is_scrubbed_and_ours_is_set() {
        let mut cmd = parent(&[
            ("TERM_PROGRAM", "iTerm.app"),
            ("TERM_PROGRAM_VERSION", "3.5"),
            ("ITERM_SESSION_ID", "w0t0p0"),
            ("VSCODE_PID", "123"),
            ("VSCODE_GIT_IPC_HANDLE", "/tmp/x"),
            ("TMUX", "/tmp/tmux-501/default,1,0"),
            ("TMUX_PANE", "%1"),
            ("CLAUDECODE", "1"),
            ("KITTY_WINDOW_ID", "2"),
            ("PATH", "/usr/bin"),
            ("CLAUDE_CODE_USE_BEDROCK", "1"),
        ]);
        apply_env(&mut cmd);
        for gone in [
            "ITERM_SESSION_ID",
            "VSCODE_PID",
            "VSCODE_GIT_IPC_HANDLE",
            "TMUX",
            "TMUX_PANE",
            "CLAUDECODE",
            "KITTY_WINDOW_ID",
        ] {
            assert_eq!(get(&cmd, gone), None, "{gone} 가 남았다");
        }
        assert_eq!(get(&cmd, "TERM_PROGRAM").as_deref(), Some("Ocul"));
        assert_eq!(
            get(&cmd, "TERM_PROGRAM_VERSION").as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(get(&cmd, "TERM").as_deref(), Some("xterm-256color"));
        assert_eq!(get(&cmd, "COLORTERM").as_deref(), Some("truecolor"));
        assert_eq!(get(&cmd, "CLAUDE_CODE_NO_FLICKER").as_deref(), Some("1"));
        assert_eq!(get(&cmd, "FORCE_HYPERLINK").as_deref(), Some("1"));
        // 사용자의 설정은 그대로 — 지우는 것은 터미널의 신원뿐이다.
        assert_eq!(get(&cmd, "PATH").as_deref(), Some("/usr/bin"));
        assert_eq!(get(&cmd, "CLAUDE_CODE_USE_BEDROCK").as_deref(), Some("1"));
    }

    /// 예전 `run_line` 시험을 대신한다 — 「다음」 줄은 셸이 인자로 받고, 받지 못하는 셸만 쳐 넣는다.
    #[test]
    fn launch_lines_go_in_as_arguments_where_the_shell_can_take_them() {
        let run = Launch::of(Some("다음 항목"), false).unwrap();
        let args = launch_args("zsh", run).unwrap();
        assert_eq!(&args[..3], ["-l", "-i", "-c"]);
        assert_eq!(
            args[3],
            format!("claude \"${PROMPT_ENV}\"; exec \"$SHELL\" -l -i")
        );
        for shell in ["bash", "fish", "sh", "dash", "ksh"] {
            assert_eq!(
                launch_args(shell, run).as_deref(),
                Some(&args[..]),
                "{shell}"
            );
        }
        assert_eq!(
            launch_args("zsh", Launch::Resume).unwrap()[3],
            "claude --continue; exec \"$SHELL\" -l -i"
        );
        let empty = Launch::of(Some(""), false).unwrap();
        assert_eq!(
            launch_args("bash", empty).unwrap()[3],
            "claude; exec \"$SHELL\" -l -i"
        );
        assert_eq!(
            launch_args("pwsh", run).unwrap(),
            ["-NoExit", "-Command", "claude $env:OCULPM_PROMPT"]
        );
        assert_eq!(
            launch_args("powershell", Launch::Resume).unwrap()[2],
            "claude --continue"
        );
        // nushell · csh 계열은 문법이 달라 쳐 넣는다.
        for shell in ["nu", "tcsh", "csh", "xonsh"] {
            assert_eq!(launch_args(shell, run), None, "{shell}");
        }
        assert!(typed_line(run).starts_with("claude "));
        assert!(typed_line(run).contains(PROMPT_ENV));
        assert!(typed_line(run).ends_with('\r'));
        assert_eq!(typed_line(empty), "claude\r");
        assert_eq!(typed_line(Launch::Resume), "claude --continue\r");
        assert_eq!(Launch::of(None, false), None);
        assert_eq!(Launch::of(Some("x"), true), Some(Launch::Resume));
    }

    /// 진짜 PTY 로 — 로캘 없는 부모(Finder 로 띄운 앱)에서도 셸은 UTF-8 로캘을 받고, 부모 터미널의 신원
    /// 대신 이 터미널의 신원을 본다.
    #[cfg(unix)]
    #[test]
    fn the_shell_sees_a_utf8_locale_and_this_terminal_through_a_real_pty() {
        use super::super::tests::{sh, spec};
        use super::super::{TermEvent, TermSessions};
        let sessions = TermSessions::default();
        let (tx, rx) = std::sync::mpsc::channel::<TermEvent>();
        let mut cmd =
            sh(r#"printf '[%s|%s|%s|%s]' "$LANG" "$TERM_PROGRAM" "${VSCODE_PID-}" "${TMUX-}""#);
        for key in LOCALE_VARS {
            cmd.env_remove(key);
        }
        cmd.env("TERM_PROGRAM", "iTerm.app");
        cmd.env("VSCODE_PID", "123");
        cmd.env("TMUX", "/tmp/tmux-501/default,1,0");
        sessions
            .start(spec("w", 1), cmd, "sh".into(), None, move |e| {
                let _ = tx.send(e);
            })
            .unwrap();
        let mut out = String::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(TermEvent::Output { data, .. }) => out.push_str(&data),
                Ok(TermEvent::Exit { .. }) => break,
                _ => {}
            }
        }
        let want = format!("[{}|Ocul||]", DEFAULT_LANG.unwrap_or_default());
        assert!(out.contains(&want), "출력: {out:?}");
        sessions.close_all();
    }

    /// rc 가 한 글자를 묻는 셸(oh-my-zsh 업데이트 `[Y/n]` 처럼)에서도 「다음」 은 프롬프트를 그대로 넘긴다 —
    /// 예전처럼 쳐 넣었다면 첫 글자 `c` 를 질문이 먹고 `laude …` 가 명령으로 돌았다. claude 는 셸의 작업 제어로
    /// 제 프로세스 그룹에서 돌아 「도는 중」(닫기 확인 · 업데이트 뒤 잇기의 기준)이고, 끝나면 같은 자리(같은
    /// pid)에 셸이 다시 서서 빈 셸이 된다. 가짜 claude 는 PATH 맨 앞(rc 안, 시스템 path_helper 뒤)에 둔다.
    #[cfg(unix)]
    #[test]
    fn the_next_line_survives_an_rc_file_that_asks_a_question() {
        use super::super::tests::{spec, wait_until};
        use super::super::{OpenSpec, TermSessions};
        use std::os::unix::fs::PermissionsExt;
        let zsh = std::path::Path::new("/bin/zsh");
        if !zsh.exists() {
            eprintln!("zsh 가 없다 — 건너뛴다");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let (bin, zdot, got) = (
            dir.path().join("bin"),
            dir.path().join("zdot"),
            dir.path().join("got"),
        );
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&zdot).unwrap();
        let fake = bin.join("claude");
        let script = format!(
            "#!/bin/sh\nprintf '%s' \"$1\" > '{}'\nsleep 1\n",
            got.display()
        );
        std::fs::write(&fake, script).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let rc = format!("read -k 1 answer\nexport PATH='{}':$PATH\n", bin.display());
        std::fs::write(zdot.join(".zshrc"), rc).unwrap();

        let prompt = "다음 항목 · 'quotes' \"double\" $HOME";
        let mut cmd = CommandBuilder::new(zsh);
        cmd.args(
            launch_args(
                "zsh",
                Launch::Run {
                    prompt_empty: false,
                },
            )
            .unwrap(),
        );
        cmd.env("ZDOTDIR", &zdot);
        cmd.env("SHELL", zsh);
        let spec = OpenSpec {
            prompt: Some(prompt.into()),
            ..spec("w", 1)
        };
        let sessions = TermSessions::default();
        let info = sessions
            .start(spec, cmd, "claude".into(), None, |_| {})
            .unwrap();
        // 사람이 rc 의 질문에 답한다.
        sessions.write(info.id, "y").unwrap();
        wait_until(
            || std::fs::read_to_string(&got).is_ok_and(|s| s == prompt),
            "가짜 claude 가 프롬프트를 그대로 받지 못했다",
        );
        assert!(
            sessions.list("w")[0].busy,
            "claude 가 도는 동안은 「도는 중」"
        );
        wait_until(
            || !sessions.list("w")[0].busy,
            "claude 가 끝난 뒤 빈 셸로 돌아오지 않았다",
        );
        assert!(
            sessions.list("w")[0].alive,
            "claude 가 끝난 뒤에도 셸이 남는다"
        );
        sessions.close_all();
    }
}

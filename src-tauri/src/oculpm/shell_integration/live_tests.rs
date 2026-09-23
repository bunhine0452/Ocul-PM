//! 진짜 셸을 진짜 PTY(Windows 는 ConPTY)에 띄워 OSC 133 이 **실제로** 나오는지
//! 단언한다 (크로스플랫폼 라운드 `#shell-tests`, D1 — 러너가 실기기다).
//!
//! 앱과 같은 사슬을 탄다: `install_in` 이 rc/프로필에 관리 블록을 심고 →
//! `materialize_script` 가 스크립트를 쓰고 → 셸이 그 블록으로 스크립트를 읽고 →
//! 마커가 PTY 로 나온다. 확인하는 것:
//!
//! - 모든 OSC 133 에 이 세션의 nonce 가 실린다 (없거나 다른 것 0개).
//! - 성공 명령은 `C;cmd=<명령줄>` 뒤 `D;0`, 실패는 그 종료코드.
//! - `A` 의 `cwd` 는 `;`·한글이 든 경로를 이스케이프해 실어 보낸다.
//! - 심 디렉터리가 PATH 맨 앞이다 (사용자 rc/프로필이 끝난 뒤 붙였다).
//!
//! 러너별: macOS·Linux 는 bash(+ 있으면 zsh), Linux 는 pwsh(XDG 프로필로 실제
//! 기동 경로), Windows 는 pwsh 7 과 Windows PowerShell 5.1. PowerShell 은
//! `OCULPM_TEST_PWSH=<경로>` 로 어느 OS 에서든 추가로 돌릴 수 있다.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use super::*;

const WAIT: Duration = Duration::from_secs(90);

/// PTY 하나 — 출력은 뒤에서 계속 모으고, 커서 위치 질의(DSR)에는 대신 답한다
/// (.NET 콘솔은 유닉스에서 `ESC[6n` 을 보내고 답을 기다린다 — xterm.js 가 하는 일).
struct LivePty {
    out: Arc<Mutex<Vec<u8>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    _master: Box<dyn MasterPty + Send>,
}

impl LivePty {
    fn spawn(cmd: CommandBuilder) -> Self {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 40,
                cols: 220,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let child = pair.slave.spawn_command(cmd).expect("셸 기동");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
        let out = Arc::new(Mutex::new(Vec::new()));
        {
            let out = Arc::clone(&out);
            let writer = Arc::clone(&writer);
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut scanned = 0usize;
                loop {
                    let n = match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    let mut answers = 0;
                    {
                        let mut all = out.lock().unwrap();
                        all.extend_from_slice(&buf[..n]);
                        while let Some(pos) = find(&all[scanned..], b"\x1b[6n") {
                            answers += 1;
                            scanned += pos + 4;
                        }
                        scanned = scanned.max(all.len().saturating_sub(3));
                    }
                    for _ in 0..answers {
                        let _ = writer.lock().unwrap().write_all(b"\x1b[1;1R");
                    }
                }
            });
        }
        LivePty {
            out,
            writer,
            child,
            _master: pair.master,
        }
    }

    fn send(&self, line: &str) {
        let mut w = self.writer.lock().unwrap();
        w.write_all(line.as_bytes()).unwrap();
        w.write_all(b"\r").unwrap();
        w.flush().unwrap();
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned()
    }

    /// 줄 편집기가 키를 받을 준비가 될 때까지 기다린다.
    ///
    /// 유닉스의 PSReadLine 은 ReadLine 을 시작하며 tty 를 raw 로 바꾸고 커서 위치를
    /// 묻는다(`ESC[6n`). 그 전에 친 글자는 아직 canonical 모드인 tty 가 받아 CR 을
    /// LF 로 바꾸고, PSReadLine 은 그 LF 를 Enter 로 보지 않아 줄이 실행되지 않는다
    /// (사람은 프롬프트를 보고 치므로 겪지 않는 경합 — 이 하네스가 실제로 겪었다).
    /// 그래서 `need_dsr` 면 마지막 `anchor` 뒤에 그 질의가 나온 것을 본다. 그 뒤
    /// (또는 그 밖의 셸에서는 곧바로) 출력이 잠잠해지기를 기다린다.
    fn wait_ready(&self, what: &str, anchor: &str, need_dsr: bool) {
        if need_dsr {
            self.wait_until(what, |t| {
                t.rfind(anchor).is_some_and(|i| t[i..].contains("\x1b[6n"))
            });
        }
        self.wait_quiet(Duration::from_millis(300));
    }

    /// 출력이 `quiet` 동안 늘지 않을 때까지 (최대 [`WAIT`]).
    fn wait_quiet(&self, quiet: Duration) {
        let deadline = Instant::now() + WAIT;
        let mut last = self.out.lock().unwrap().len();
        let mut since = Instant::now();
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            let len = self.out.lock().unwrap().len();
            if len != last {
                last = len;
                since = Instant::now();
            } else if since.elapsed() >= quiet {
                return;
            }
        }
    }

    /// `pred` 가 참이 될 때까지 기다린다. 시간이 다 되면 화면 기록과 함께 실패.
    fn wait_until(&self, what: &str, pred: impl Fn(&str) -> bool) -> String {
        let deadline = Instant::now() + WAIT;
        loop {
            let text = self.text();
            if pred(&text) {
                return text;
            }
            if Instant::now() > deadline {
                panic!("{what} — 시간 초과. 출력(끝부분):\n{}", visible_tail(&text));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for LivePty {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// 제어문자를 보이게 바꾼 출력 끝부분 — 실패 메시지용.
fn visible_tail(text: &str) -> String {
    let shown: String = text
        .chars()
        .map(|c| match c {
            '\x1b' => "␛".to_string(),
            '\x07' => "␇".to_string(),
            '\r' => String::new(),
            c => c.to_string(),
        })
        .collect();
    let chars: Vec<char> = shown.chars().collect();
    chars[chars.len().saturating_sub(4000)..].iter().collect()
}

/// OSC 133 하나 — 프런트 `oscShell.ts` 의 `parseOsc133` 과 같은 규칙으로 읽는다.
#[derive(Debug, Clone)]
struct Marker {
    kind: String,
    positional: Option<String>,
    fields: HashMap<String, String>,
}

fn markers(text: &str) -> Vec<Marker> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("\x1b]133;") {
        let body = &rest[start + 6..];
        let end = body.find(['\x07', '\x1b']).unwrap_or(body.len());
        let payload = &body[..end];
        let mut parts = payload.split(';');
        let kind = parts.next().unwrap_or_default().to_string();
        let rest_parts: Vec<&str> = parts.collect();
        let positional = rest_parts
            .first()
            .filter(|p| !p.contains('='))
            .map(|p| p.to_string());
        let fields = rest_parts
            .iter()
            .filter_map(|p| p.split_once('='))
            .map(|(k, v)| (k.to_string(), unescape(v)))
            .collect();
        out.push(Marker {
            kind,
            positional,
            fields,
        });
        rest = &body[end..];
    }
    out
}

/// 셸 쪽 `__oculpm_esc` 의 역변환 (프런트 `unescapeOscPayload` 와 같은 한 번의 스캔).
fn unescape(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let ahead: String = chars.clone().take(3).collect();
        let decoded = match ahead.as_str() {
            "x3b" => Some(';'),
            "x0a" => Some('\n'),
            "x0d" => Some('\r'),
            "x1b" => Some('\x1b'),
            "x07" => Some('\x07'),
            _ => None,
        };
        if let Some(d) = decoded {
            out.push(d);
            for _ in 0..3 {
                chars.next();
            }
        } else if chars.peek() == Some(&'\\') {
            out.push('\\');
            chars.next();
        } else {
            out.push('\\');
        }
    }
    out
}

/// 셸 하나를 몰아 보는 시나리오.
struct Scenario<'a> {
    name: &'a str,
    pty: LivePty,
    nonce: &'a str,
    /// 성공하는 명령 (출력은 보지 않는다 — C/D 만).
    ok_cmd: &'a str,
    /// 종료코드 7 로 끝나는 네이티브 명령.
    exit7_cmd: &'a str,
    /// 추가로 확인할 (명령, 기대 종료코드).
    extra: Vec<(&'a str, i64)>,
    /// PATH 맨 앞이 심 디렉터리면 `SHIMFIRST` 를 찍는 명령 (명령줄에 그 낱말이 붙어 있지 않게).
    shim_first_cmd: &'a str,
    cwd_leaf: &'a str,
    /// 유닉스의 PSReadLine — 입력 준비 신호가 커서 위치 질의다 ([`LivePty::wait_ready`]).
    need_dsr: bool,
}

impl Scenario<'_> {
    /// 첫 프롬프트의 A 가 이미 나왔다고 보고 명령을 차례로 돌린다.
    fn run(self) {
        let name = self.name;
        let nonce = self.nonce;
        let first = self
            .pty
            .wait_until(&format!("{name}: 첫 프롬프트의 133;A"), |t| {
                markers(t).iter().any(|m| m.kind == "A")
            });
        let a = markers(&first).into_iter().find(|m| m.kind == "A").unwrap();
        let cwd = a.fields.get("cwd").cloned().unwrap_or_default();
        assert!(
            cwd.trim_end_matches(['/', '\\']).ends_with(self.cwd_leaf),
            "{name}: A 의 cwd 가 작업 폴더가 아니다 — {cwd:?}"
        );

        let expect = |cmd: &str, code: i64| {
            self.pty
                .wait_ready(&format!("{name}: 입력 준비"), "\x1b]133;B", self.need_dsr);
            let before = markers(&self.pty.text()).len();
            self.pty.send(cmd);
            // D 와 그 뒤 다음 프롬프트의 B 까지 — 다음 명령을 칠 자리가 열린 것까지 본다.
            let text =
                self.pty
                    .wait_until(&format!("{name}: `{cmd}` 의 133;D 와 다음 B"), |t| {
                        let all = markers(t);
                        let fresh = &all[before.min(all.len())..];
                        fresh
                            .iter()
                            .position(|m| m.kind == "D")
                            .is_some_and(|d| fresh[d..].iter().any(|m| m.kind == "B"))
                    });
            let fresh = &markers(&text)[before..];
            let c = fresh.iter().find(|m| m.kind == "C");
            let c = c.unwrap_or_else(|| panic!("{name}: `{cmd}` 의 133;C 가 없다 — {fresh:?}"));
            if !cmd.starts_with("sh -c") {
                assert_eq!(c.fields.get("cmd").map(String::as_str), Some(cmd), "{name}");
            }
            let d = fresh.iter().find(|m| m.kind == "D").unwrap();
            assert_eq!(
                d.positional.as_deref(),
                Some(code.to_string().as_str()),
                "{name}: `{cmd}` 의 종료코드 — {d:?}"
            );
        };
        expect(self.ok_cmd, 0);
        expect(self.exit7_cmd, 7);
        for (cmd, code) in &self.extra {
            expect(cmd, *code);
        }

        self.pty
            .wait_ready(&format!("{name}: 입력 준비"), "\x1b]133;B", self.need_dsr);
        self.pty.send(self.shim_first_cmd);
        self.pty
            .wait_until(&format!("{name}: 심 디렉터리가 PATH 맨 앞"), |t| {
                t.contains("SHIMFIRST")
            });

        // nonce 규칙 — 나온 마커 전부가 이 세션의 nonce 를 싣는다.
        let all = markers(&self.pty.text());
        assert!(all.len() >= 8, "{name}: 마커가 너무 적다 — {all:?}");
        for m in &all {
            assert_eq!(
                m.fields.get("nonce").map(String::as_str),
                Some(nonce),
                "{name}: nonce 가 없거나 다른 마커 — {m:?}"
            );
        }
    }
}

/// 한 테스트가 쓰는 임시 자리 — 작업 폴더 이름에 `;` 와 한글을 넣어 이스케이프·인코딩을 함께 본다.
struct Sandbox {
    _root: tempfile::TempDir,
    loc: RcLocations,
    data: PathBuf,
    cwd: PathBuf,
    shim: PathBuf,
}

const CWD_LEAF: &str = "oculpm-한글;세미";

fn sandbox() -> Sandbox {
    let root = tempfile::tempdir().unwrap();
    let base = root.path().to_path_buf();
    let loc = RcLocations {
        home: base.join("home"),
        documents: Some(base.join("Documents")),
        config: Some(base.join("config")),
    };
    let data = base.join("data");
    let cwd = base.join(CWD_LEAF);
    let shim = base.join("shim");
    for dir in [&loc.home, &data, &cwd, &shim] {
        std::fs::create_dir_all(dir).unwrap();
    }
    Sandbox {
        _root: root,
        loc,
        data,
        cwd,
        shim,
    }
}

fn nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// 앱의 `start_pty_session` 이 싣는 변수와 같은 것 + 테스트를 흔드는 상속 변수 제거.
fn base_command(program: &str, sb: &Sandbox, kind: ShellKind, nonce: &str) -> CommandBuilder {
    let script = materialize_script(&sb.data, kind).unwrap().unwrap();
    let mut cmd = CommandBuilder::new(program);
    cmd.cwd(&sb.cwd);
    for var in [
        "TMUX",
        "ZDOTDIR",
        "PROMPT_COMMAND",
        "BASH_ENV",
        "ENV",
        "TERM_PROGRAM",
    ] {
        cmd.env_remove(var);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("OCULPM_TERM", "1");
    cmd.env("OCULPM_NONCE", nonce);
    cmd.env("OCULPM_SHELL_INTEGRATION", &script);
    cmd.env("OCULPM_SHIM_DIR", &sb.shim);
    cmd
}

fn install_for(os: HostOs, sb: &Sandbox, shell: &str) {
    let allow = |_: &str| Some("RemoteSigned".to_string());
    install_in(os, &sb.loc, &sb.data, shell, &allow).unwrap();
}

// ─── zsh / bash (유닉스) ────────────────────────────────────────────────────

#[cfg(unix)]
fn posix_scenario(shell: &str, name: &str) {
    let sb = sandbox();
    let n = nonce();
    let kind = detect_shell_kind(shell);
    install_for(HostOs::current(), &sb, shell);
    let mut cmd = base_command(shell, &sb, kind, &n);
    cmd.env("HOME", &sb.loc.home);
    Scenario {
        name,
        pty: LivePty::spawn(cmd),
        nonce: &n,
        ok_cmd: "echo oculpm-ok",
        exit7_cmd: "sh -c 'exit 7'",
        extra: vec![("false", 1)],
        shim_first_cmd: "[ \"${PATH%%:*}\" = \"$OCULPM_SHIM_DIR\" ] && echo SHIM\"\"FIRST",
        cwd_leaf: CWD_LEAF,
        need_dsr: false,
    }
    .run();
}

#[cfg(unix)]
#[test]
fn bash_emits_nonced_markers_through_the_rc_block() {
    posix_scenario("/bin/bash", "bash");
}

/// ubuntu 러너에는 zsh 가 기본으로 없다 — 있으면 돈다 (macOS 러너에는 있다).
#[cfg(unix)]
#[test]
fn zsh_emits_nonced_markers_through_the_rc_block() {
    let Some(zsh) = ["/bin/zsh", "/usr/bin/zsh"]
        .into_iter()
        .find(|p| Path::new(p).is_file())
    else {
        eprintln!("skip: 이 러너에 zsh 가 없다");
        return;
    };
    posix_scenario(zsh, "zsh");
}

// ─── PowerShell ────────────────────────────────────────────────────────────

/// 이 러너에서 돌릴 PowerShell 들. CI 에서는 있어야 할 것이 없으면 실패한다
/// (조용히 건너뛰면 "0건 통과" 가 "검증됨" 으로 읽힌다).
fn powershells() -> Vec<String> {
    let mut found = Vec::new();
    if let Ok(p) = std::env::var("OCULPM_TEST_PWSH") {
        found.push(p);
    }
    let ci = std::env::var_os("CI").is_some();
    if cfg!(windows) {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let desktop = format!(r"{system_root}\System32\WindowsPowerShell\v1.0\powershell.exe");
        let pwsh = find_on_path("pwsh.exe");
        assert!(!ci || pwsh.is_some(), "windows 러너에 pwsh 가 없다");
        assert!(
            !ci || Path::new(&desktop).is_file(),
            "windows 러너에 powershell.exe 가 없다"
        );
        found.extend(pwsh);
        if Path::new(&desktop).is_file() {
            found.push(desktop);
        }
    } else if cfg!(target_os = "linux") {
        let pwsh = find_on_path("pwsh");
        assert!(!ci || pwsh.is_some(), "ubuntu 러너에 pwsh 가 없다");
        found.extend(pwsh);
    }
    found.dedup();
    found
}

fn find_on_path(name: &str) -> Option<String> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
        .map(|p| p.display().to_string())
}

fn pwsh_command(shell: &str, sb: &Sandbox, nonce: &str, no_profile: bool) -> CommandBuilder {
    let mut cmd = base_command(shell, sb, ShellKind::PowerShell, nonce);
    cmd.arg("-NoLogo");
    if no_profile {
        cmd.arg("-NoProfile");
    }
    cmd.env("POWERSHELL_UPDATECHECK", "Off");
    cmd.env("POWERSHELL_TELEMETRY_OPTOUT", "1");
    cmd
}

fn pwsh_scenario<'a>(name: &'a str, pty: LivePty, n: &'a str) -> Scenario<'a> {
    Scenario {
        name,
        pty,
        nonce: n,
        ok_cmd: "Write-Output oculpm-ok",
        exit7_cmd: if cfg!(windows) { "cmd /c exit 7" } else { "sh -c 'exit 7'" },
        extra: vec![("Get-Item -LiteralPath oculpm-surely-missing", 1)],
        shim_first_cmd: "if ((\"$env:PATH\" -split [IO.Path]::PathSeparator)[0] -eq $env:OCULPM_SHIM_DIR) { 'SHIM' + 'FIRST' }",
        cwd_leaf: CWD_LEAF,
        need_dsr: cfg!(unix),
    }
}

/// 관리 블록을 담은 프로필을 **손으로 dot-source** 해 싣는다 — 사용자의 진짜
/// 프로필을 건드리지 않고 5.1·7 을 둘 다 도는 길. 블록 → 스크립트 사슬과
/// PSReadLine 감싸기, LF 스크립트 로드, 콘솔 코드 페이지 밖 문자(한글 cwd)를 본다.
#[test]
fn powershell_emits_nonced_markers_through_the_profile_block() {
    let shells = powershells();
    if shells.is_empty() {
        eprintln!("skip: 이 러너에서 돌릴 PowerShell 이 없다 (OCULPM_TEST_PWSH 로 지정 가능)");
        return;
    }
    for shell in shells {
        let sb = sandbox();
        let n = nonce();
        let os = if cfg!(windows) {
            HostOs::Windows
        } else {
            HostOs::Linux
        };
        install_for(os, &sb, &shell);
        let profile =
            powershell::profile_path(os, powershell::edition_of(os, &shell), &sb.loc).unwrap();
        let pty = LivePty::spawn(pwsh_command(&shell, &sb, &n, true));
        // 첫 프롬프트("PS …> ")가 뜬 뒤 프로필을 싣는다.
        pty.wait_until(&format!("{shell}: 첫 프롬프트"), |t| t.contains("> "));
        pty.wait_ready(&format!("{shell}: 첫 입력 준비"), "> ", cfg!(unix));
        pty.send(&format!(
            ". '{}'",
            profile.display().to_string().replace('\'', "''")
        ));
        pwsh_scenario(&shell, pty, &n).run();
    }
}

/// Linux 의 pwsh 는 `$XDG_CONFIG_HOME/powershell/profile.ps1` 을 **스스로** 읽는다
/// — 진짜 기동 경로(프로필이 첫 프롬프트 전에 돈다)를 사용자 파일 없이 탄다.
/// 첫 입력 전에 A 가 나오면 PSReadLine 이 프로필보다 먼저 올라와 있다는 뜻이다.
#[cfg(unix)]
#[test]
fn pwsh_loads_the_integration_from_its_real_profile_location() {
    let shells: Vec<String> = powershells()
        .into_iter()
        .filter(|s| !s.to_ascii_lowercase().ends_with(".exe"))
        .collect();
    let Some(shell) = shells.first() else {
        eprintln!("skip: 이 러너에 pwsh 가 없다");
        return;
    };
    let sb = sandbox();
    let n = nonce();
    install_for(HostOs::Linux, &sb, shell);
    let mut cmd = pwsh_command(shell, &sb, &n, false);
    cmd.env("XDG_CONFIG_HOME", sb.loc.config.as_ref().unwrap());
    cmd.env("XDG_DATA_HOME", &sb.loc.home);
    cmd.env("HOME", &sb.loc.home);
    pwsh_scenario("pwsh (XDG 프로필)", LivePty::spawn(cmd), &n).run();
}

/// Windows 러너(CI 한정)에서는 **진짜** `$PROFILE.CurrentUserAllHosts` 에 공개
/// `install` 로 심고 프로필 있는 기동으로 확인한 뒤 되돌린다 — 실행 정책 확인,
/// 알려진 폴더 "문서" 계산, 프로필보다 먼저 올라오는 PSReadLine 을 실제로 탄다.
/// 개발 PC 에서는 사용자 프로필을 건드리지 않도록 돌지 않는다.
#[cfg(windows)]
#[test]
fn windows_powershell_loads_the_integration_from_the_real_profile() {
    if std::env::var_os("GITHUB_ACTIONS").is_none() {
        eprintln!("skip: 진짜 프로필을 쓰는 테스트 — GitHub Actions 러너에서만 돈다");
        return;
    }
    let home = directories::BaseDirs::new()
        .unwrap()
        .home_dir()
        .to_path_buf();
    for shell in powershells() {
        let sb = sandbox();
        let n = nonce();
        let loc = RcLocations::system(&home);
        let edition = powershell::edition_of(HostOs::Windows, &shell);
        let profile = powershell::profile_path(HostOs::Windows, edition, &loc).unwrap();
        let existed = profile.exists();
        install(&home, &sb.data, &shell).unwrap_or_else(|e| panic!("{shell}: install — {e}"));
        // 시나리오가 실패해도 러너의 프로필은 되돌린다. Drop 안에서는 단언하지 않는다
        // (되감기 중 두 번째 패닉은 테스트 바이너리 전체를 죽인다).
        struct Restore<'a>(&'a Path, &'a str);
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                let _ = uninstall(self.0, self.1);
            }
        }
        let restore = Restore(&home, &shell);
        assert!(status(&home, &sb.data, &shell).installed, "{shell}");
        let label = format!("{shell} (진짜 프로필)");
        let pty = LivePty::spawn(pwsh_command(&shell, &sb, &n, false));
        pwsh_scenario(&label, pty, &n).run();
        drop(restore);
        assert!(
            !status(&home, &sb.data, &shell).installed,
            "{shell}: 제거가 안 됐다"
        );
        if !existed {
            assert!(
                !profile.exists(),
                "{shell}: 제거 뒤 우리가 만든 프로필이 남았다"
            );
        }
    }
}

/// 우리가 계산한 프로필 자리가 셸 자신이 말하는 `$PROFILE.CurrentUserAllHosts`
/// 와 같다 — OneDrive 로 옮겨진 문서 폴더·XDG 를 셸과 같은 규칙으로 읽는다는 증거.
#[test]
fn computed_profile_path_matches_what_the_shell_reports() {
    let os = HostOs::current();
    if os == HostOs::MacOs && std::env::var_os("OCULPM_TEST_PWSH").is_none() {
        eprintln!("skip: macOS 는 PowerShell 통합 대상이 아니다");
        return;
    }
    let home = directories::BaseDirs::new()
        .unwrap()
        .home_dir()
        .to_path_buf();
    for shell in powershells() {
        let out = crate::proc::std_cmd(&shell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$PROFILE.CurrentUserAllHosts",
            ])
            .env("POWERSHELL_UPDATECHECK", "Off")
            .output()
            .unwrap_or_else(|e| panic!("{shell}: {e}"));
        let reported = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let loc = RcLocations::system(&home);
        let ours = powershell::profile_path(os, powershell::edition_of(os, &shell), &loc);
        if os == HostOs::MacOs {
            assert!(ours.is_none());
            continue;
        }
        assert_eq!(
            ours.map(|p| p.display().to_string()),
            Some(reported),
            "{shell}: 셸이 읽는 프로필과 우리가 쓰는 프로필이 다르다"
        );
        if os == HostOs::Windows {
            let policy = powershell::effective_execution_policy(&shell)
                .unwrap_or_else(|| panic!("{shell}: 실행 정책을 못 읽었다"));
            eprintln!("{shell}: 실효 실행 정책 = {policy}");
        }
    }
}

#[test]
fn marker_parser_matches_the_frontend_rules() {
    let text = "x\x1b]133;D;7;nonce=n\x07y\x1b]133;A;nonce=n;cwd=C:\\\\a\\x3bb\x07\x1b]133;B;nonce=n\x1b\\";
    let m = markers(text);
    assert_eq!(m.len(), 3);
    assert_eq!(m[0].positional.as_deref(), Some("7"));
    assert_eq!(m[1].fields.get("cwd").map(String::as_str), Some("C:\\a;b"));
    assert_eq!(m[2].kind, "B");
}

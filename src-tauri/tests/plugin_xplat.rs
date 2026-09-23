//! 플러그인의 크로스플랫폼 표면 — 크로스플랫폼 라운드 L-INTEG
//! (`#integ-plugin-bin` · `#integ-hooks` · `#integ-sidecar`).
//!
//! 사용자는 Windows·Linux 를 직접 못 돌린다. 그래서 여기서는 훅과 셔틀을 **그 OS
//! 러너에서 그 OS 의 방식으로 실제로 돌린다** — 문자열 단언이 아니다.
//!
//! 훅을 무엇이 어떻게 돌리나 (조사 근거):
//! - **Claude Code** — 셸 형 훅은 macOS·Linux `sh -c`, Windows **Git Bash**(없으면
//!   PowerShell). <https://code.claude.com/docs/en/hooks> 「Shell Form」·`shell` 필드.
//! - **Codex** — macOS·Linux `$SHELL -lc`, Windows `%COMSPEC% /C "<명령>"`(cmd.exe).
//!   훅 항목의 `commandWindows` 가 있으면 Windows 에서 그것을 쓴다 (openai/codex
//!   `codex-rs/hooks/src/engine/command_runner.rs` `default_shell_command` ·
//!   `codex-rs/config/src/hook_config.rs` `command_windows`). 신뢰 해시는 **고른
//!   명령**으로 매기고 `command_windows` 는 비워서 잰다(`discovery.rs` `hook_hash`) —
//!   그래서 `commandWindows` 를 더해도 macOS·Linux 사용자에게 재신뢰를 묻지 않는다.
//!
//! 그래서 Claude 판 `hooks.json` 은 그대로 두고(Git Bash 가 sh 를 돈다), Codex 판만
//! `commandWindows` 로 `run-sh.cmd` → Git Bash → 같은 sh 파일을 부른다.
//!
//! 테스트 픽스처의 셸·git·자식 프로세스 — 앱이 띄우는 프로세스가 아니라 proc.rs
//! 창구 규칙(clippy.toml disallowed-methods) 밖이다.
#![allow(clippy::disallowed_methods)]

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn claude_plugin() -> PathBuf {
    repo_root().join("plugin").join("oculpm")
}

fn codex_plugin() -> PathBuf {
    repo_root().join("plugin").join("oculpm-codex")
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{} 읽기 실패: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} 파싱 실패: {e}", path.display()))
}

/// Claude Code 가 셸 형 훅을 돌리는 셸 — macOS·Linux `sh`, Windows Git Bash.
fn hook_shell() -> PathBuf {
    #[cfg(windows)]
    {
        git_bash()
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/bin/sh")
    }
}

/// Git for Windows 의 `bin\bash.exe` — `usr\bin\bash.exe` 와 달리 Unix 도구를
/// `System32` 보다 앞에 둔다 (그렇지 않으면 `find`·`sort` 가 Windows 판으로 풀린다).
#[cfg(windows)]
fn git_bash() -> PathBuf {
    let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|p| PathBuf::from(p).join("Git"))
        .collect();
    // `git --exec-path` = `<Git>/mingw64/libexec/git-core`.
    if let Ok(out) = Command::new("git").arg("--exec-path").output() {
        let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        roots.extend(exec.ancestors().nth(3).map(Path::to_path_buf));
    }
    roots
        .into_iter()
        .map(|r| r.join("bin").join("bash.exe"))
        .find(|p| p.is_file())
        .expect("Git Bash(bin\\bash.exe) 를 못 찾았다 — Windows 에서 훅을 돌리는 셸이라 이 테스트의 전제다")
}

fn spawn_with_stdin(mut cmd: Command, stdin: &str) -> Output {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("자식을 띄우지 못했다");
    // 훅이 stdin 을 다 읽기 전에 끝나도 EPIPE 로 테스트가 죽지 않게.
    let _ = child
        .stdin
        .take()
        .expect("stdin")
        .write_all(stdin.as_bytes());
    child.wait_with_output().expect("종료 대기")
}

fn payload(event: &str, session: &str, root: &Path) -> String {
    json!({
        "session_id": session,
        "hook_event_name": event,
        "cwd": root.to_string_lossy(),
        "transcript_path": root.join("transcript.jsonl").to_string_lossy(),
        "stop_hook_active": false,
    })
    .to_string()
}

/// 추적 중인 프로젝트 + 활성 플랜 하나.
fn tracked_project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let planner = dir.path().join(".oculpm").join("planner");
    std::fs::create_dir_all(&planner).unwrap();
    std::fs::write(
        planner.join("p.md"),
        "---\nstatus: active\n---\n# 플랜\n\n- [ ] 첫 항목 {#first}\n",
    )
    .unwrap();
    dir
}

fn inbox_lines(root: &Path) -> Vec<Value> {
    let text =
        std::fs::read_to_string(root.join(".oculpm/hooks/claude-events.jsonl")).unwrap_or_default();
    text.lines()
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("깨진 인박스 줄 {l:?}: {e}")))
        .collect()
}

fn describe(out: &Output) -> String {
    format!(
        "exit={:?}\n--- stdout\n{}\n--- stderr\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

/// 훅 묶음 전체를 **한 대화처럼** 돌리고 결과를 잰다 —
/// SessionStart → Stop → SubagentStart → SessionEnd. `run` 이 훅 하나를 그 OS·
/// 그 에이전트의 방식으로 띄운다.
fn exercise_bundle(hooks: &Value, root: &Path, run: &dyn Fn(&Value, &str) -> Output) {
    let sid = "xplat-1";
    let hooks_dir = root.join(".oculpm").join("hooks");
    let at = |event: &str, i: usize| &hooks["hooks"][event][0]["hooks"][i];

    // SessionStart — 싱크 · 플랜 컨텍스트 · 세션 마커.
    let start = payload("SessionStart", sid, root);
    let out = run(at("SessionStart", 0), &start);
    assert_eq!(out.status.code(), Some(0), "싱크: {}", describe(&out));
    let lines = inbox_lines(root);
    assert_eq!(lines.len(), 1, "인박스에 한 줄: {lines:?}");
    assert_eq!(lines[0]["session_id"], sid);
    assert!(
        lines[0]["oculpm_ts"].is_string(),
        "타임스탬프: {:?}",
        lines[0]
    );

    let out = run(at("SessionStart", 1), &start);
    assert_eq!(
        out.status.code(),
        Some(0),
        "plan-context: {}",
        describe(&out)
    );
    let ctx: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "plan-context 출력이 JSON 이 아니다 ({e}): {}",
            describe(&out)
        )
    });
    assert_eq!(ctx["hookSpecificOutput"]["hookEventName"], "SessionStart");
    let text = ctx["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap_or_default();
    assert!(
        text.contains("[plan: p]") && text.contains("첫 항목"),
        "활성 플랜이 실리지 않았다: {text}"
    );
    let ledger = std::fs::read_to_string(hooks_dir.join("resume-delivered.jsonl")).unwrap();
    assert!(ledger.contains(sid), "전달 원장: {ledger}");

    let out = run(at("SessionStart", 2), &start);
    assert_eq!(
        out.status.code(),
        Some(0),
        "session-marker: {}",
        describe(&out)
    );
    assert!(hooks_dir.join(format!(".session-start-{sid}")).is_file());
    assert!(hooks_dir.join(format!(".session-live-{sid}")).is_file());

    // Stop — 싱크 + 배달 게이트 (git 저장소가 아니라 판정 불가 → 침묵).
    let stop = payload("Stop", sid, root);
    assert_eq!(run(at("Stop", 0), &stop).status.code(), Some(0));
    assert_eq!(inbox_lines(root).len(), 2);
    let out = run(at("Stop", 1), &stop);
    assert_eq!(
        out.status.code(),
        Some(0),
        "delivery-gate: {}",
        describe(&out)
    );

    // SubagentStart — 같은 plan-context 가 이벤트 이름을 따라간다.
    let sub = payload("SubagentStart", sid, root);
    let out = run(&hooks["hooks"]["SubagentStart"][0]["hooks"][0], &sub);
    let ctx: Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|e| panic!("SubagentStart 출력 ({e}): {}", describe(&out)));
    assert_eq!(ctx["hookSpecificOutput"]["hookEventName"], "SubagentStart");

    // SessionEnd — 마커를 치우고 이벤트를 남긴다.
    let out = run(at("SessionEnd", 0), &payload("SessionEnd", sid, root));
    assert_eq!(
        out.status.code(),
        Some(0),
        "session-end: {}",
        describe(&out)
    );
    assert!(!hooks_dir.join(format!(".session-start-{sid}")).exists());
    assert_eq!(inbox_lines(root).len(), 3);
}

/// **Claude Code 판 훅이 이 OS 의 훅 셸에서 돈다** — macOS·Linux `sh -c`,
/// Windows Git Bash `-c` (환경변수·경로는 Windows 표기 그대로).
#[test]
fn claude_hooks_run_under_the_platform_hook_shell() {
    let project = tracked_project();
    let root = project.path();
    let hooks = read_json(&claude_plugin().join("hooks/hooks.json"));
    exercise_bundle(&hooks, root, &|hook, stdin| {
        let command = hook["command"].as_str().expect("command");
        let mut cmd = Command::new(hook_shell());
        cmd.arg("-c")
            .arg(command)
            .current_dir(root)
            .env("CLAUDE_PROJECT_DIR", root)
            .env("CLAUDE_PLUGIN_ROOT", claude_plugin())
            .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"));
        spawn_with_stdin(cmd, stdin)
    });
}

/// Windows 의 Codex 가 하는 그대로 — `cmd.exe /d /c "<commandWindows>"`
/// (`raw_arg` 로 바깥 따옴표를 싼다), `CLAUDE_PLUGIN_ROOT` 만 싣고
/// `CLAUDE_PROJECT_DIR` 은 없다. payload 의 `cwd` 는 JSON 이스케이프된 Windows 경로다.
#[cfg(windows)]
fn run_like_codex_on_windows(command: &str, root: &Path, stdin: &str) -> Output {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("cmd.exe");
    cmd.args(["/d", "/c"])
        .raw_arg(format!("\"{command}\""))
        .current_dir(root)
        .env_remove("CLAUDE_PROJECT_DIR")
        .env("CLAUDE_PLUGIN_ROOT", codex_plugin())
        .env("PLUGIN_ROOT", codex_plugin())
        .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"));
    spawn_with_stdin(cmd, stdin)
}

#[cfg(windows)]
#[test]
fn codex_hooks_run_through_cmd_on_windows() {
    let project = tracked_project();
    let root = project.path();
    let hooks = read_json(&codex_plugin().join("hooks/hooks.json"));
    exercise_bundle(&hooks, root, &|hook, stdin| {
        let command = hook["commandWindows"].as_str().expect("commandWindows");
        run_like_codex_on_windows(command, root, stdin)
    });
}

/// 배달 게이트의 **차단(exit 2)** 이 cmd → run-sh.cmd → Git Bash 를 지나 Codex 까지
/// 그대로 닿는가. 종료 코드가 한 겹에서라도 0 으로 접히면 게이트는 조용히 죽는다.
#[cfg(windows)]
#[test]
fn the_codex_gate_blocks_through_cmd_on_windows() {
    let project = tracked_project();
    let root = project.path();
    for args in [
        &["init", "-q"][..],
        &["config", "user.email", "t@example.com"],
        &["config", "user.name", "t"],
    ] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
    std::fs::write(root.join("README.md"), "seed\n").unwrap();
    for args in [&["add", "README.md"][..], &["commit", "-qm", "seed"]] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
    let hooks_dir = root.join(".oculpm/hooks");
    std::fs::create_dir_all(&hooks_dir).unwrap();
    std::fs::write(hooks_dir.join(".session-start-g1"), "").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(root.join("src.rs"), "changed\n").unwrap();

    let hooks = read_json(&codex_plugin().join("hooks/hooks.json"));
    let gate = hooks["hooks"]["Stop"][0]["hooks"][1]["commandWindows"]
        .as_str()
        .expect("게이트 commandWindows");
    // 트랜스크립트 없이 — tests/delivery_gate.rs 와 같은 판정 조건.
    let stop = json!({"session_id": "g1", "hook_event_name": "Stop", "stop_hook_active": false,
                      "cwd": root.to_string_lossy()});
    let out = run_like_codex_on_windows(gate, root, &stop.to_string());
    assert_eq!(
        out.status.code(),
        Some(2),
        "차단이 cmd 를 못 지났다: {}",
        describe(&out)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("journal_write") && stderr.contains("src.rs"),
        "{stderr}"
    );
}

/// Git Bash 가 없으면 **소리 내고** 건너뛴다 — 훅 실패로 대화를 막지도, 조용히
/// 넘어가지도 않는다 (D4). stdin 은 소비한다.
#[cfg(windows)]
#[test]
fn without_git_bash_the_codex_shuttle_skips_loudly() {
    use std::os::windows::process::CommandExt;
    let project = tracked_project();
    let empty = tempfile::tempdir().unwrap();
    let system32 =
        PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot")).join("System32");
    let shuttle = codex_plugin().join("hooks").join("run-sh.cmd");
    let mut cmd = Command::new(system32.join("cmd.exe"));
    cmd.args(["/d", "/c"])
        .raw_arg(format!("\"call \"{}\" event-sink.sh\"", shuttle.display()))
        .current_dir(project.path())
        .env("PATH", &system32)
        .env("OCULPM_GIT_BASH", empty.path().join("nope.exe"))
        .env("ProgramFiles", empty.path())
        .env("ProgramW6432", empty.path())
        .env("LOCALAPPDATA", empty.path());
    let out = spawn_with_stdin(cmd, &payload("SessionStart", "nb", project.path()));
    assert_eq!(out.status.code(), Some(0), "{}", describe(&out));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("Git Bash not found"),
        "{}",
        describe(&out)
    );
    assert!(inbox_lines(project.path()).is_empty());
}

/// Windows 전용 파일 판 싱크(`event-sink.sh`)가 인라인 한 줄과 **같은 줄**을 쌓는다.
/// 세 OS 에서 돈다 — 인라인은 `CLAUDE_PROJECT_DIR` 로, 파일 판은 payload 의 `cwd`
/// 로(Codex 는 그 변수를 안 준다) 루트를 찾는다.
#[test]
fn the_windows_event_sink_writes_the_same_line_as_the_inline_one() {
    let inline_root = tracked_project();
    let file_root = tracked_project();
    let hooks = read_json(&claude_plugin().join("hooks/hooks.json"));
    let inline = hooks["hooks"]["SessionStart"][0]["hooks"][0]["command"]
        .as_str()
        .unwrap();

    let mut cmd = Command::new(hook_shell());
    cmd.arg("-c")
        .arg(inline)
        .current_dir(inline_root.path())
        .env("CLAUDE_PROJECT_DIR", inline_root.path());
    let body = |root: &Path| payload("SessionStart", "sink", root);
    assert_eq!(
        spawn_with_stdin(cmd, &body(inline_root.path()))
            .status
            .code(),
        Some(0)
    );

    let mut cmd = Command::new(hook_shell());
    cmd.arg(codex_plugin().join("hooks").join("event-sink.sh"))
        .current_dir(std::env::temp_dir())
        .env_remove("CLAUDE_PROJECT_DIR");
    let out = spawn_with_stdin(cmd, &format!("{}\r\n", body(file_root.path())));
    assert_eq!(out.status.code(), Some(0), "{}", describe(&out));

    let strip = |mut v: Value| {
        v.as_object_mut().unwrap().remove("oculpm_ts");
        v.as_object_mut().unwrap().remove("cwd");
        v.as_object_mut().unwrap().remove("transcript_path");
        v
    };
    let a = inbox_lines(inline_root.path());
    let b = inbox_lines(file_root.path());
    assert_eq!(a.len(), 1);
    assert_eq!(b.len(), 1, "cwd 로 루트를 찾아 한 줄 — CR 은 떼고");
    assert!(b[0]["oculpm_ts"].is_string());
    assert_eq!(strip(a[0].clone()), strip(b[0].clone()));
}

/// Codex 판 `hooks.json` 의 모든 훅에 Windows 변형이 있고, 그 변형은 **같은 sh
/// 파일**을 부른다. 셔틀은 ASCII 만(cmd 는 OEM 코드 페이지로 읽는다 — CJK 에서
/// 멀티바이트가 다음 글자를 삼킨다), 레이블 없음(LF 배치 파일에서 오동작).
#[test]
fn every_codex_hook_has_a_windows_variant_calling_the_same_script() {
    let hooks = read_json(&codex_plugin().join("hooks/hooks.json"));
    let mut seen = 0;
    for groups in hooks["hooks"].as_object().unwrap().values() {
        for hook in groups[0]["hooks"].as_array().unwrap() {
            let command = hook["command"].as_str().unwrap();
            let windows = hook["commandWindows"]
                .as_str()
                .unwrap_or_else(|| panic!("commandWindows 없음: {command}"));
            let script = command
                .strip_prefix("\"${CLAUDE_PLUGIN_ROOT}/hooks/")
                .and_then(|s| s.strip_suffix('"'))
                .unwrap_or("event-sink.sh");
            assert_eq!(
                windows,
                format!(r#"call "%CLAUDE_PLUGIN_ROOT%\hooks\run-sh.cmd" {script}"#),
                "{command}"
            );
            assert!(
                codex_plugin().join("hooks").join(script).is_file(),
                "{script}"
            );
            seen += 1;
        }
    }
    assert_eq!(
        seen, 7,
        "SessionStart 3 · Stop 2 · SessionEnd 1 · SubagentStart 1"
    );
    let shuttle = std::fs::read(codex_plugin().join("hooks/run-sh.cmd")).unwrap();
    assert!(shuttle.is_ascii(), "run-sh.cmd 는 ASCII 만");
    let text = String::from_utf8(shuttle).unwrap();
    assert!(
        !text.lines().any(|l| l.trim_start().starts_with(':')),
        "레이블 금지"
    );
}

/// **두 플러그인의 훅 묶음은 같은 파일이다** (플랜 `v3-release`
/// {#codex-hook-delivery} — `plugin_manifest.rs` 에서 옮겨 왔다). Codex 는 플러그인
/// 루트의 `hooks/hooks.json` 을 관례로 읽고 그 훅이 실제로 돈다(0.153.4 실측). 갈라지면
/// Codex 사용자만 조용히 옛 판을 쓴다. **예외 하나** — Codex 판 `hooks.json` 은
/// Windows 변형(`commandWindows`)을 더 싣는다. 그것을 걷어내면 같아야 한다.
#[test]
fn the_codex_plugin_ships_the_same_hook_bundle_as_the_claude_one() {
    let (claude, codex) = (claude_plugin(), codex_plugin());
    let mut codex_hooks = read_json(&codex.join("hooks/hooks.json"));
    for groups in codex_hooks["hooks"].as_object_mut().unwrap().values_mut() {
        for group in groups.as_array_mut().unwrap() {
            for hook in group["hooks"].as_array_mut().unwrap() {
                hook.as_object_mut().unwrap().remove("commandWindows");
            }
        }
    }
    assert_eq!(
        codex_hooks,
        read_json(&claude.join("hooks/hooks.json")),
        "hooks.json 이 commandWindows 말고도 갈라졌다"
    );

    for rel in [
        "hooks/session-marker.sh",
        "hooks/session-end.sh",
        "hooks/delivery-gate.sh",
        "hooks/plan-context.sh",
        "bin/oculpm-mcp",
    ] {
        let mine = std::fs::read(codex.join(rel)).unwrap_or_else(|e| {
            panic!("oculpm-codex 에 {rel} 이 없다 ({e}) — Codex 훅 배포가 끊긴다")
        });
        let theirs = std::fs::read(claude.join(rel)).expect("claude 판");
        assert_eq!(mine, theirs, "{rel} 이 두 플러그인 사이에서 갈라졌다");
    }
    #[cfg(unix)]
    for rel in [
        "hooks/session-marker.sh",
        "hooks/session-end.sh",
        "hooks/delivery-gate.sh",
        "hooks/plan-context.sh",
        "hooks/event-sink.sh",
        "bin/oculpm-mcp",
    ] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(codex.join(rel))
            .unwrap()
            .permissions()
            .mode();
        assert!(
            mode & 0o111 != 0,
            "{rel} 실행 비트 유실 — 설치는 되고 훅만 죽는다"
        );
    }
}

// ─── 셔틀(`bin/oculpm-mcp`)의 설치 위치 (#integ-plugin-bin) ──────────────────

/// 셔틀을 임시 플러그인 폴더에 복사한다 — 리포 안에서 돌리면 `target/debug` 개발
/// 빌드 후보가 먼저 잡혀 설치 위치 탐색을 못 잰다.
#[cfg(not(target_os = "macos"))]
fn isolated_shuttle(dir: &Path) -> PathBuf {
    let bin = dir.join("plugin").join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let shuttle = bin.join("oculpm-mcp");
    std::fs::copy(claude_plugin().join("bin/oculpm-mcp"), &shuttle).unwrap();
    shuttle
}

/// 셔틀을 이 OS 의 훅 셸로 돌려 `--version` 을 받는다. `vars` 로 설치 위치 변수를 덮는다.
#[cfg(not(target_os = "macos"))]
fn shuttle_version(shuttle: &Path, vars: &[(&str, &Path)]) -> Output {
    let mut cmd = Command::new(hook_shell());
    cmd.arg(shuttle)
        .arg("--version")
        .env_remove("OCULPM_MCP_BIN");
    for var in [
        "XDG_DATA_HOME",
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramW6432",
    ] {
        cmd.env_remove(var);
    }
    for (k, v) in vars {
        cmd.env(k, v);
    }
    spawn_with_stdin(cmd, "")
}

#[cfg(not(target_os = "macos"))]
fn place_sidecar(at: &Path) {
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::copy(env!("CARGO_BIN_EXE_oculpm-mcp"), at).unwrap();
}

#[cfg(not(target_os = "macos"))]
fn assert_found(out: &Output, case: &str) {
    assert_eq!(out.status.code(), Some(0), "{case}: {}", describe(out));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.starts_with("oculpm-mcp "), "{case}: {stdout}");
}

/// Linux — AppImage 안정 사본(`$XDG_DATA_HOME` 또는 `~/.local/share` 아래
/// `ocul-pm/bin`). deb 의 `/usr/bin` 은 러너에서 못 깐다(루트 권한) — 후보 목록만 본다.
#[cfg(target_os = "linux")]
#[test]
fn the_shuttle_finds_the_linux_install_locations() {
    let tmp = tempfile::tempdir().unwrap();
    let shuttle = isolated_shuttle(tmp.path());

    let xdg = tmp.path().join("xdg");
    place_sidecar(&xdg.join("ocul-pm/bin/oculpm-mcp"));
    assert_found(
        &shuttle_version(&shuttle, &[("XDG_DATA_HOME", &xdg)]),
        "XDG_DATA_HOME",
    );

    let home = tmp.path().join("home");
    place_sidecar(&home.join(".local/share/ocul-pm/bin/oculpm-mcp"));
    assert_found(
        &shuttle_version(&shuttle, &[("HOME", &home)]),
        "~/.local/share",
    );

    let text = std::fs::read_to_string(&shuttle).unwrap();
    assert!(text.contains("\"/usr/bin/oculpm-mcp\""), "deb 설치 위치");
}

/// Windows — NSIS 사용자 설치(`%LOCALAPPDATA%\Ocul-PM`, 다중 사용자 모드의
/// `%LOCALAPPDATA%\Programs\Ocul-PM`)와 시스템 설치(`%ProgramFiles%\Ocul-PM`).
/// 셔틀은 Git Bash 가 돌린다 (훅과 같은 셸).
#[cfg(windows)]
#[test]
fn the_shuttle_finds_the_windows_install_locations() {
    let tmp = tempfile::tempdir().unwrap();
    let shuttle = isolated_shuttle(tmp.path());
    for (case, var, rel) in [
        ("per-user", "LOCALAPPDATA", "Ocul-PM/oculpm-mcp.exe"),
        (
            "multi-user",
            "LOCALAPPDATA",
            "Programs/Ocul-PM/oculpm-mcp.exe",
        ),
        ("per-machine", "ProgramFiles", "Ocul-PM/oculpm-mcp.exe"),
    ] {
        let base = tmp.path().join(case);
        place_sidecar(&base.join(rel));
        assert_found(&shuttle_version(&shuttle, &[(var, &base)]), case);
    }
}

/// 못 찾으면 stdout 은 비우고(MCP 프로토콜 전용) stderr 로만 말한다.
/// macOS 는 개발 기기에 설치본(`/Applications`)이 있을 수 있어 제외한다.
#[cfg(not(target_os = "macos"))]
#[test]
fn the_shuttle_speaks_only_on_stderr_when_nothing_is_found() {
    let tmp = tempfile::tempdir().unwrap();
    let shuttle = isolated_shuttle(tmp.path());
    let home = tmp.path().join("empty-home");
    std::fs::create_dir_all(&home).unwrap();
    let out = shuttle_version(&shuttle, &[("HOME", &home), ("LOCALAPPDATA", &home)]);
    assert_eq!(out.status.code(), Some(1), "{}", describe(&out));
    assert!(out.stdout.is_empty(), "stdout 은 MCP 프로토콜 전용");
    assert!(String::from_utf8_lossy(&out.stderr).contains("OCULPM_MCP_BIN"));
}

// ─── 사이드카 끝단 (#integ-sidecar) ─────────────────────────────────────────

/// **사이드카 바이너리 자체**가 이 OS 에서 `--root` 로 떠서 일지를 쓴다 — 다른 앱
/// 설정에 적히는 것은 이 실행 파일이다. Windows 에서는 루트가 verbatim(`\\?\`)
/// 표기로 새지 않는지도 본다 (`canonicalize` 가 그 표기를 돌려준다).
#[test]
fn the_sidecar_binary_writes_a_journal_from_root_arg() {
    let project = tempfile::tempdir().unwrap();
    let root = project.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_oculpm-mcp"))
        .arg("--root")
        .arg(root)
        .current_dir(root)
        .env_remove("OCULPM_ROOT")
        .env_remove("OCULPM_ACP_HOST")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("oculpm-mcp 를 띄우지 못했다");
    let mut stdin = child.stdin.take().unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut call = |id: u64, method: &str, params: Value| -> Value {
        let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
        let mut resp = String::new();
        out.read_line(&mut resp).unwrap();
        serde_json::from_str(&resp).unwrap_or_else(|e| panic!("응답 {resp:?}: {e}"))
    };
    let init = call(
        1,
        "initialize",
        json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "oculpm-mcp");
    let resp = call(
        2,
        "tools/call",
        json!({"name": "journal_write", "arguments": {
            "type": "chore", "slug": "xplat", "title": "크로스플랫폼 끝단",
            "body_markdown": "## 한 일\n\n사이드카가 이 OS 에서 일지를 썼다.\n"
        }}),
    );
    drop(stdin);
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut stderr).unwrap();
    let _ = child.wait();
    assert!(
        !stderr.contains(r"\\?\"),
        "루트가 verbatim 표기로 샜다: {stderr}"
    );
    let result = &resp["result"];
    assert_ne!(result["isError"], Value::Bool(true), "{resp}");
    let rel = result["structuredContent"]["path"].as_str().expect("path");
    let journal = root.join(".oculpm").join("journal");
    let written: Vec<_> = walk(&journal);
    assert_eq!(
        written.len(),
        1,
        "일지 한 편: {written:?} (응답 경로 {rel})"
    );
    assert!(std::fs::read_to_string(&written[0])
        .unwrap()
        .contains("크로스플랫폼 끝단"));
    assert!(
        !resp.to_string().contains(r"\\\\?\\"),
        "verbatim 경로가 응답에 샜다: {resp}"
    );
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}

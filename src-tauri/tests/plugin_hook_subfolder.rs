//! 저장소의 **하위 폴더**에서 띄운 claude 도 같은 프로젝트다 (계획 `love-round-20261123` #l2-agent-context).
//!
//! `repo/packages/web` 에서 claude 를 띄우면 `CLAUDE_PROJECT_DIR` 이 그 하위 폴더다. 예전엔 모든 훅이
//! `[ -d "$ROOT/.oculpm" ] || exit 0` 으로 바로 끝나 기다림 · 일지 없이 끝난 대화 · 시작 컨텍스트가 다
//! 사라졌고, MCP 는 `--root` 가 하위 폴더라 「남의 프로젝트」 검사에 걸려 서지 않았다. 이제 훅은 위로
//! 올라가 가장 가까운 `.oculpm` 을 찾고($HOME 위로는 안 간다), MCP 와 PreToolUse 는 `shim::tracked_root` 로
//! 올라간다. 이 OS 의 훅 셸(macOS·Linux `sh`, Windows Git Bash — 경로는 그 OS 의 표기 그대로, Windows 면
//! 역슬래시)로 실제로 돌린다.
//!
//! 통합 테스트는 바이너리 밖에서 셸을 띄우는 자리라 `proc::std_cmd` 창구 규칙 밖이다.
#![allow(clippy::disallowed_methods)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde_json::{json, Value};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn claude_plugin() -> PathBuf {
    repo().join("plugin").join("oculpm")
}

fn hook_shell() -> PathBuf {
    #[cfg(windows)]
    {
        let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432"]
            .iter()
            .filter_map(std::env::var_os)
            .map(|p| PathBuf::from(p).join("Git"))
            .collect();
        if let Ok(out) = Command::new("git").arg("--exec-path").output() {
            let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
            roots.extend(exec.ancestors().nth(3).map(Path::to_path_buf));
        }
        roots
            .into_iter()
            .map(|r| r.join("bin").join("bash.exe"))
            .find(|p| p.is_file())
            .expect("Git Bash(bin\\bash.exe) 를 못 찾았다")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/bin/sh")
    }
}

fn spawn_with_stdin(mut cmd: Command, stdin: &str) -> Output {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("자식을 띄우지 못했다");
    let _ = child
        .stdin
        .take()
        .expect("stdin")
        .write_all(stdin.as_bytes());
    child.wait_with_output().expect("종료 대기")
}

/// 추적 중인 저장소 + 그 안의 `packages/web` (claude 를 띄운 자리).
fn monorepo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/planner")).unwrap();
    std::fs::write(
        root.join(".oculpm/planner/p.md"),
        "---\nstatus: active\n---\n# 플랜\n\n**확인 명령:** cargo test\n\n- [ ] 하위 폴더에서도 {#sub}\n",
    )
    .unwrap();
    let sub = root.join("packages").join("web");
    std::fs::create_dir_all(&sub).unwrap();
    (dir, sub)
}

fn payload(event: &str, cwd: &Path) -> String {
    json!({ "session_id": "sub-1", "hook_event_name": event, "cwd": cwd.to_string_lossy() })
        .to_string()
}

/// 플러그인 훅 하나를 그 명령 그대로(셸 형) 하위 폴더에서 돌린다.
fn run_hook(command: &str, sub: &Path, stdin: &str, home: Option<&Path>) -> Output {
    let command = command.replace("${CLAUDE_PLUGIN_ROOT}", &claude_plugin().to_string_lossy());
    let mut cmd = Command::new(hook_shell());
    cmd.arg("-c")
        .arg(command)
        .current_dir(sub)
        .env("CLAUDE_PROJECT_DIR", sub)
        .env("CLAUDE_PLUGIN_ROOT", claude_plugin())
        .env("OCULPM_MCP_BIN", env!("CARGO_BIN_EXE_oculpm-mcp"));
    if let Some(h) = home {
        cmd.env("HOME", h);
    }
    spawn_with_stdin(cmd, stdin)
}

fn hooks() -> Value {
    let text = std::fs::read_to_string(claude_plugin().join("hooks/hooks.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn inbox(root: &Path) -> String {
    std::fs::read_to_string(root.join(".oculpm/hooks/claude-events.jsonl")).unwrap_or_default()
}

/// SessionStart 묶음 셋(인라인 싱크 · 시작 컨텍스트 · 세션 마커)이 하위 폴더에서도 저장소 루트에 닿는다.
#[test]
fn session_start_hooks_find_the_tracked_root_from_a_subfolder() {
    let (dir, sub) = monorepo();
    let root = dir.path();
    let h = hooks();
    let at = |i: usize| {
        h["hooks"]["SessionStart"][0]["hooks"][i]["command"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let start = payload("SessionStart", &sub);

    let out = run_hook(&at(0), &sub, &start, None);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        inbox(root).contains("\"sub-1\""),
        "인라인 싱크가 루트의 인박스에 한 줄: {:?}",
        inbox(root)
    );
    assert!(
        !sub.join(".oculpm").exists(),
        "하위 폴더에 .oculpm 을 새로 만들지 않는다"
    );

    let out = run_hook(&at(1), &sub, &start, None);
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "시작 컨텍스트 ({e}): {}",
            String::from_utf8_lossy(&out.stdout)
        )
    });
    let text = v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap_or_default();
    assert!(
        text.contains("[plan: p]") && text.contains("{#sub}"),
        "{text}"
    );

    let out = run_hook(&at(2), &sub, &start, None);
    assert_eq!(out.status.code(), Some(0));
    assert!(
        root.join(".oculpm/hooks/.session-start-sub-1").is_file(),
        "세션 마커는 루트에"
    );
}

/// $HOME 위로는 올라가지 않는다 — 홈 밑의 추적 안 된 폴더가 홈 바깥의 `.oculpm` 에 쓰지 않게.
#[test]
fn the_walk_stops_at_home() {
    let (dir, sub) = monorepo();
    let root = dir.path();
    let home = root.join("packages");
    let h = hooks();
    let sink = h["hooks"]["SessionStart"][0]["hooks"][0]["command"]
        .as_str()
        .unwrap();
    let ctx = h["hooks"]["SessionStart"][0]["hooks"][1]["command"]
        .as_str()
        .unwrap();
    let start = payload("SessionStart", &sub);
    assert_eq!(
        run_hook(sink, &sub, &start, Some(&home)).status.code(),
        Some(0)
    );
    assert_eq!(inbox(root), "", "홈 위의 인박스에 썼다");
    let out = run_hook(ctx, &sub, &start, Some(&home));
    assert!(
        out.stdout.iter().all(u8::is_ascii_whitespace),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
}

/// Codex 는 `CLAUDE_PROJECT_DIR` 을 안 준다 — 파일 판 싱크(`event-sink.sh`)는 payload 의 `cwd` 에서 올라간다.
#[test]
fn the_codex_file_sink_walks_up_from_the_payload_cwd() {
    let (dir, sub) = monorepo();
    let mut cmd = Command::new(hook_shell());
    cmd.arg(repo().join("plugin/oculpm-codex/hooks/event-sink.sh"))
        .current_dir(std::env::temp_dir())
        .env_remove("CLAUDE_PROJECT_DIR");
    let out = spawn_with_stdin(cmd, &payload("SessionStart", &sub));
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        inbox(dir.path()).contains("\"sub-1\""),
        "{:?}",
        inbox(dir.path())
    );
}

/// PreToolUse(재수정 경고)도 하위 폴더 세션에서 루트의 일지를 읽는다.
#[test]
fn the_pre_tool_use_hook_reads_the_root_journal_from_a_subfolder() {
    let (dir, sub) = monorepo();
    let root = dir.path();
    let day = ocul_pm_lib::clock::local_now()
        .strftime("%Y%m%d")
        .to_string();
    let bugs = root.join(".oculpm/journal").join(&day).join("Bugs");
    std::fs::create_dir_all(&bugs).unwrap();
    std::fs::write(
        bugs.join("0900_bug_x.md"),
        "---\nschema_version: 1\ntype: bug\nslug: \"x\"\nstatus: done\n\
         created_at: \"2026-11-02T10:00:00+09:00\"\nsession_id: \"20261102-001\"\n\
         agent:\n  id: \"claude-code\"\nlanguage: \"ko\"\nverified_by_user: false\n\
         files_touched:\n  - path: \"packages/web/a.ts\"\n    op: update\n---\n\
         [x] 웹: 이름이 겹쳤다\n\n## 검증\n- `pnpm test`: 993 passed\n",
    )
    .unwrap();
    let command = hooks()["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        .as_str()
        .unwrap()
        .to_string();
    let input = json!({
        "session_id": "sub-1",
        "hook_event_name": "PreToolUse",
        "cwd": sub.to_string_lossy(),
        "tool_name": "Edit",
        "tool_input": { "file_path": sub.join("a.ts").to_string_lossy() },
    })
    .to_string();
    let out = run_hook(&command, &sub, &input, None);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|e| panic!("경고 JSON ({e}): {}", String::from_utf8_lossy(&out.stdout)));
    let ctx = v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains("packages/web/a.ts") && ctx.contains("pnpm test"),
        "{ctx}"
    );
}

/// MCP 서버 — `--root ${CLAUDE_PROJECT_DIR}` 가 하위 폴더여도 서고, 루트를 쓴다 (예전엔 「남의 프로젝트」 검사에
/// 걸려 exit 2). 셸 없이 바로 띄운다 — Windows 의 PowerShell 에서 띄운 세션도 이 꼴이다.
#[test]
fn the_mcp_server_started_with_a_subfolder_root_serves_the_tracked_root() {
    let (dir, sub) = monorepo();
    let out = Command::new(env!("CARGO_BIN_EXE_oculpm-mcp"))
        .arg("--root")
        .arg(&sub)
        .current_dir(&sub)
        .env_remove("OCULPM_ROOT")
        .stdin(Stdio::null())
        .output()
        .expect("oculpm-mcp");
    let err = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "{err}");
    let root = dir.path().canonicalize().unwrap();
    let shown = err
        .lines()
        .find_map(|l| {
            l.split_once(" — root: ")
                .map(|(_, r)| r.trim_end_matches(" (stdio 대기)").to_string())
        })
        .unwrap_or_else(|| panic!("root 줄이 없다: {err}"));
    let shown = PathBuf::from(shown).canonicalize().unwrap();
    assert_eq!(shown, root, "{err}");
}

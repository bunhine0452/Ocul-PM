//! 시작 훅이 **플랜이 없어도 말한다** — 어떤 프로젝트여도 (플랜 `any-project-best-results-20261028`).
//!
//! `plugin_xplat.rs` 는 플랜·일지가 있는 프로젝트에서 훅 묶음 전체를 돌린다(그리고 래칫
//! 800줄을 넘어 한 줄도 더 못 받는다). 여기는 `plan-context.sh` 하나를 네 모양의 프로젝트에서
//! 돌려 추가 컨텍스트의 **문장**을 잰다: 빈 프로젝트의 「무엇부터」 한 줄, 매니페스트에서 감지한
//! 확인 명령 후보, 확인 명령이 있는 플랜에는 후보가 **없음**, 매니페스트가 없으면 「후보 없음」.
//! 감지 규칙 자체의 단위 테스트는 `oculpm::check_infer`.
//!
//! 통합 테스트는 바이너리 밖에서 셸을 띄우는 자리라 `proc::std_cmd` 창구 규칙(clippy.toml
//! disallowed-methods) 밖이다 — `plugin_xplat.rs`·`resume_context.rs` 와 같은 사유.
#![allow(clippy::disallowed_methods)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde_json::{json, Value};

fn script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .join("plugin/oculpm/hooks/plan-context.sh")
}

/// Claude Code 가 셸 형 훅을 돌리는 셸 — macOS·Linux `sh`, Windows Git Bash (`bin\bash.exe`:
/// `find`·`sort`·`grep` 이 System32 판으로 풀리지 않는 쪽).
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

fn run_hook(root: &Path) -> Output {
    let payload = json!({
        "session_id": "no-plan-1",
        "hook_event_name": "SessionStart",
        "cwd": root.to_string_lossy(),
    })
    .to_string();
    let mut child = Command::new(hook_shell())
        .arg(script())
        .current_dir(root)
        .env("CLAUDE_PROJECT_DIR", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("훅을 띄우지 못했다");
    let _ = child
        .stdin
        .take()
        .expect("stdin")
        .write_all(payload.as_bytes());
    child.wait_with_output().expect("종료 대기")
}

/// 훅의 additionalContext 문장. 출력이 비면 빈 문자열(훅은 「실을 게 없으면 침묵」 계약).
fn context(root: &Path) -> String {
    let out = run_hook(root);
    assert_eq!(
        out.status.code(),
        Some(0),
        "훅은 항상 exit 0: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    if out.stdout.iter().all(u8::is_ascii_whitespace) {
        return String::new();
    }
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "JSON 이 아니다 ({e}): {}",
            String::from_utf8_lossy(&out.stdout)
        )
    });
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join(".oculpm/planner")).unwrap();
    dir
}

fn write(root: &Path, rel: &str, body: &str) {
    std::fs::write(root.join(rel), body).unwrap();
}

const EMPTY_LINE: &str = "이 프로젝트에는 아직 활성 플랜 항목도 일지도 없다";
const CANDIDATE: &str = "확인 명령 후보 (매니페스트에서 감지";

#[test]
fn an_empty_project_gets_the_where_to_start_line_and_manifest_candidates() {
    let p = project();
    write(
        p.path(),
        "package.json",
        r#"{"scripts":{"test":"vitest run"}}"#,
    );
    write(p.path(), "pnpm-lock.yaml", "");
    write(p.path(), "Cargo.toml", "[package]\nname = \"x\"\n");
    let text = context(p.path());
    assert!(text.contains(EMPTY_LINE), "{text}");
    assert!(
        text.contains("plan_create(done_when·check)") && text.contains("journal_write"),
        "{text}"
    );
    assert!(
        text.contains(&format!("{CANDIDATE} — 플랜에 **확인 명령:** 줄이 없다. plan_create 의 check 나 플랜 본문에 적어라): pnpm test · cargo test")),
        "{text}"
    );
    // 안내만 실은 세션은 「이어받은」 것이 아니다 — 전달 원장을 쓰지 않는다.
    assert!(
        !p.path()
            .join(".oculpm/hooks/resume-delivered.jsonl")
            .exists(),
        "빈 프로젝트에서 전달 원장이 생겼다"
    );
}

#[test]
fn an_empty_project_without_manifests_says_no_candidate() {
    let p = project();
    let text = context(p.path());
    assert!(text.contains(EMPTY_LINE), "{text}");
    assert!(text.contains("확인 명령 후보 없음"), "{text}");
    assert!(!text.contains(CANDIDATE), "{text}");
}

#[test]
fn an_open_plan_without_a_check_line_gets_candidates_but_not_the_empty_line() {
    let p = project();
    write(
        p.path(),
        ".oculpm/planner/r.md",
        "---\nstatus: active\n---\n# 플랜\n\n**완료 조건:** 돈다\n\n- [ ] 첫 항목 {#first}\n",
    );
    write(p.path(), "go.mod", "module x\n");
    let text = context(p.path());
    assert!(
        text.contains("[plan: r]") && text.contains("첫 항목"),
        "{text}"
    );
    assert!(
        !text.contains(EMPTY_LINE),
        "플랜 항목이 있는데 빈 프로젝트라 했다: {text}"
    );
    assert!(
        text.contains(CANDIDATE) && text.contains("go test ./..."),
        "{text}"
    );
    // 플랜 절 → 후보 → (일지 절) 순서: 후보는 플랜 절 뒤에 선다.
    assert!(
        text.find("[plan: r]").unwrap() < text.find(CANDIDATE).unwrap(),
        "{text}"
    );
}

#[test]
fn a_plan_that_already_has_a_check_line_gets_no_candidate() {
    let p = project();
    write(
        p.path(),
        ".oculpm/planner/s.md",
        "---\nstatus: active\n---\n# 플랜\n\n**완료 조건:** 돈다\n**확인 명령:** cargo test --lib\n\n- [ ] 첫 항목 {#first}\n",
    );
    write(p.path(), "Cargo.toml", "[package]\nname = \"x\"\n");
    let text = context(p.path());
    assert!(text.contains("**확인 명령:** cargo test --lib"), "{text}");
    assert!(
        !text.contains(CANDIDATE) && !text.contains("확인 명령 후보 없음"),
        "{text}"
    );
    assert!(!text.contains(EMPTY_LINE), "{text}");
}

//! 시작 훅이 **플랜이 없어도 말한다** — 어떤 프로젝트여도 (플랜 `any-project-best-results-20261028`).
//!
//! `plugin_xplat.rs` 는 플랜·일지가 있는 프로젝트에서 훅 묶음 전체를 돌린다(그리고 래칫
//! 800줄을 넘어 한 줄도 더 못 받는다). 여기는 `plan-context.sh` 하나를 네 모양의 프로젝트에서
//! 돌려 추가 컨텍스트의 **문장**을 잰다: 빈 프로젝트의 「무엇부터」 한 줄, 매니페스트에서 감지한
//! 확인 명령 후보, 확인 명령이 있는 플랜에는 후보가 **없음**, 매니페스트가 없으면 「후보 없음」.
//! 감지 규칙 자체의 단위 테스트는 `oculpm::check_infer`. 플랜이 있을 때의 「마지막 판정」 줄
//! (plan-log 메모의 `판정 ✓|✗` · `verdict ✓|✗` 접두 — 템플릿 v20 §5 와 앱 계획 화면의 공유 형식)도 여기서 잰다.
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
    assert!(
        !text.contains(VERDICT),
        "판정 행이 없는데 판정을 실었다: {text}"
    );
}

/// 활성 플랜이 넷이면 **최근 갱신 셋**만 실린다 (`updated:` 내림차순) — 24줄 상한에 뒤 플랜이
/// 영영 밀리던 것(simplify-round {#hook-top3}). 빠진 수는 마지막 줄이 말한다.
#[test]
fn only_the_three_most_recently_updated_plans_are_shipped() {
    let p = project();
    for (name, updated) in [
        ("a-old", "2026-09-01"),
        ("b-mid", "2026-10-10"),
        ("c-new", "2026-10-27"),
        ("d-newest", "2026-10-28"),
    ] {
        write(
            p.path(),
            &format!(".oculpm/planner/{name}.md"),
            &format!("---\nstatus: active\nupdated: {updated}\n---\n# {name}\n\n**확인 명령:** true\n\n- [ ] 항목 {{#i-{name}}}\n"),
        );
    }
    let text = context(p.path());
    for shipped in ["[plan: d-newest]", "[plan: c-new]", "[plan: b-mid]"] {
        assert!(text.contains(shipped), "{shipped} 가 빠졋다: {text}");
    }
    assert!(
        !text.contains("[plan: a-old]"),
        "가장 오래된 플랜은 빠져야 한다: {text}"
    );
    assert!(text.contains("활성 플랜 4개 중 최근 갱신 3개만"), "{text}");
    assert!(
        text.find("[plan: d-newest]").unwrap() < text.find("[plan: c-new]").unwrap(),
        "최근 갱신이 먼저: {text}"
    );
}

const VERDICT: &str = "마지막 판정:";

fn plan_with_log(items: usize, rows: &[&str]) -> String {
    let mut md = String::from(
        "---\nstatus: active\nupdated: 2026-10-28\n---\n# 플랜\n\n**완료 조건:** 돈다\n**확인 명령:** cargo test\n\n",
    );
    for i in 1..=items {
        md.push_str(&format!("- [ ] 항목{i} {{#i{i}}}\n"));
    }
    md.push_str("\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n");
    for r in rows {
        md.push_str(r);
        md.push('\n');
    }
    md.push_str("<!-- oculpm:plan-log end -->\n");
    md
}

/// 「마지막 판정」 — 접두가 `판정 ✓|✗` 인 **가장 최근** 행 하나(시각 최대값)만, 확인 명령 다음에.
/// 「판정:」으로 시작하는 평범한 메모는 판정이 아니다. 판정 줄을 실으면 항목을 하나 덜 싣는다
/// (플랜당 줄 예산 그대로). 셀 안의 `\|` 는 글자 `|` 로 돌아온다.
#[test]
fn the_most_recent_verdict_row_is_shipped_in_place_of_one_item() {
    let p = project();
    let md = plan_with_log(
        8,
        &[
            "| 2026-10-28T09:00:00+09:00 | #i1 | claude-code | ☐→x |  | 판정 ✗ 2 failed |",
            "| 2026-10-28T14:12:00+09:00 | #i1 | claude-code | ☐→x |  | 판정 ✓ 3 passed \\| 0 failed |",
            "| 2026-10-28T15:00:00+09:00 | #i2 | claude-code | ☐→~ |  | 판정: 테스트 경합 — 접두가 아니다 |",
            "| 2026-10-28T11:00:00+09:00 | #i2 | claude-code | ☐→~ |  | 판정 ✗ 늦게 붙은 옛 행 |",
        ],
    );
    write(p.path(), ".oculpm/planner/v.md", &md);
    let text = context(p.path());
    let line = "마지막 판정: ✓ 3 passed | 0 failed · 10-28 14:12";
    assert!(text.contains(line), "{text}");
    assert_eq!(text.matches(VERDICT).count(), 1, "{text}");
    assert!(
        !text.contains("2 failed") && !text.contains("경합") && !text.contains("옛 행"),
        "{text}"
    );
    let check = text
        .find("**확인 명령:** cargo test")
        .expect("확인 명령 줄");
    let verdict = text.find(line).unwrap();
    assert!(
        check < verdict && verdict < text.find("항목1").unwrap(),
        "{text}"
    );
    assert!(
        text.contains("항목7") && !text.contains("항목8"),
        "판정 줄만큼 항목을 덜 실어야 한다: {text}"
    );
}

/// 항목이 전부 닫힌 플랜은 「판정 후 닫기」 줄 끝에 판정을 붙인다 — en 접두(`verdict ✗`)도 읽는다.
#[test]
fn a_closed_plan_line_carries_its_verdict_in_either_language() {
    let p = project();
    write(
        p.path(),
        ".oculpm/planner/w.md",
        "---\nstatus: active\n---\n**Done when:** both green\n\n- [x] only {#only}\n\n<!-- oculpm:plan-log begin v1 -->\n| 2026-10-27T08:05:00+09:00 | #only | codex | ~→x |  | verdict ✗ 1 failed |\n<!-- oculpm:plan-log end -->\n",
    );
    let text = context(p.path());
    assert!(
        text.contains("[plan: w] 항목 전부 닫힘 — 완료 조건이 참인지 판정 후 닫기: **Done when:** both green · 마지막 판정: ✗ 1 failed · 10-27 08:05"),
        "{text}"
    );
}

/// 긴 판정은 160바이트 언저리에서 자르되 UTF-8 글자 중간에서 끊지 않는다 — 끊으면 additionalContext
/// JSON 이 깨진 UTF-8 이 되어(`context()` 의 serde 파싱) 컨텍스트가 통째로 사라진다.
#[test]
fn a_long_verdict_is_clipped_on_a_character_boundary() {
    let p = project();
    // `✗ ab` 6바이트 + 한글 3바이트씩 — 160바이트째가 글자 가운데에 떨어지게 둔다.
    let long = format!("판정 ✗ ab{}", "가나다라마바사아자차카타파하".repeat(8));
    let row = format!("| 2026-10-28T10:00:00+09:00 | #i1 | claude-code | ☐→~ |  | {long} |");
    write(p.path(), ".oculpm/planner/v.md", &plan_with_log(1, &[&row]));
    let text = context(p.path());
    let line = text
        .lines()
        .find(|l| l.starts_with(VERDICT))
        .unwrap_or_else(|| panic!("판정 줄이 없다: {text}"));
    assert!(
        line.contains("…") && line.ends_with("· 10-28 10:00"),
        "{line}"
    );
    assert!(line.len() < 240, "{} bytes: {line}", line.len());
}

/// 긴 완료 조건도 글자 경계에서 자른다 — 예전엔 바이트 단위 `cut` 이라 240바이트째의 한글을
/// 가운데서 잘랐고, 깨진 UTF-8 이 additionalContext 를 통째로 날렸다(`context()` 가 파싱한다).
#[test]
fn a_long_done_condition_is_clipped_on_a_character_boundary() {
    let p = project();
    // `**완료 조건:** ` 이 20바이트 — 그 뒤 한글 3바이트씩이라 240바이트째가 글자 가운데다.
    let goal = "가나다라마바사아자차카타파하".repeat(10);
    let md = format!(
        "---\nstatus: active\n---\n# 플랜\n\n**완료 조건:** {goal}\n\n- [ ] 첫 항목 {{#first}}\n"
    );
    write(p.path(), ".oculpm/planner/g.md", &md);
    let text = context(p.path());
    let line = text
        .lines()
        .find(|l| l.starts_with("**완료 조건:**"))
        .unwrap_or_else(|| panic!("완료 조건 줄이 없다: {text}"));
    assert!(line.ends_with('…'), "{line}");
    assert!(
        line.len() <= 240 + '…'.len_utf8(),
        "{} bytes: {line}",
        line.len()
    );
}

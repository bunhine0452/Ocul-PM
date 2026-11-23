//! 시작 훅이 에이전트에게 **사실만** 싣는다 (계획 `love-round-20261123` #l2-agent-context).
//!
//! - 사람 몫(`[사용자…]` · `[user…]`, 그리고 그런 부모 아래의 하위)은 에이전트의 「다음」 이 아니다 — 항목
//!   목록에서 빼고 「사람 몫 N개」 로 접는다. 규칙은 앱의 오늘 · 계획 화면과 **같은 사례표**
//!   `src/oculpm/planner/owner_cases.json` 이 문다 (digest.rs 단위 시험 · vitest `plan_owner_cases` 와 셋).
//! - 남은 일이 사람 몫뿐인 계획은 한 줄에 모은다.
//! - 「확인 명령 줄이 없다」 는 어느 계획인지 말한다 — 실린 계획엔 다 있는데 이 줄만 붙어 헷갈리게 했다.
//! - 「활성 플랜 N개 중 3개만」 꼬리 줄은 1,600자 자르기에 먹히지 않는다.
//! - 서브에이전트는 한 줄(400바이트 이하)만 받는다.
//! - 일지 없이 끝난 대화(SessionEnd 판정 원장의 `missing`)는 다음 대화의 시작에 한 번만 실린다.
//!
//! `plugin_hook_no_plan.rs` 와 같은 방식 — 이 OS 의 훅 셸(macOS·Linux `sh`, Windows Git Bash)로 실제로 돌린다.
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

fn script() -> PathBuf {
    repo().join("plugin/oculpm/hooks/plan-context.sh")
}

/// Claude Code 가 셸 형 훅을 돌리는 셸 — macOS·Linux `sh`, Windows Git Bash (`bin\bash.exe`).
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

fn run(root: &Path, event: &str, session: &str) -> Output {
    let payload = json!({ "session_id": session, "hook_event_name": event }).to_string();
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

/// 훅의 additionalContext. 출력이 비면 빈 문자열(「실을 게 없으면 침묵」).
fn context_for(root: &Path, event: &str) -> String {
    let out = run(root, event, "owner-1");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
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
    assert_eq!(v["hookSpecificOutput"]["hookEventName"], event);
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

fn context(root: &Path) -> String {
    context_for(root, "SessionStart")
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join(".oculpm/planner")).unwrap();
    dir
}

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn glyph(status: &str) -> &'static str {
    match status {
        "todo" => " ",
        "in_progress" => "~",
        "blocked" => "!",
        "done" => "x",
        "deferred" => ">",
        "dropped" => "-",
        other => panic!("사례표의 모르는 상태 {other}"),
    }
}

fn plan_md(updated: &str, check: bool, items: &str) -> String {
    let check = if check {
        "**확인 명령:** cargo test\n"
    } else {
        ""
    };
    format!("---\nstatus: active\nupdated: {updated}\n---\n# 플랜\n\n**완료 조건:** 돈다\n{check}\n{items}")
}

/// 사례표의 항목을 계획 파일로 — 하위는 두 칸 들여쓴다 (앱의 파서와 같은 꼴).
fn case_items(case: &Value) -> String {
    let mut md = String::new();
    for i in case["items"].as_array().unwrap() {
        let indent = if i["parent"].is_string() { "  " } else { "" };
        md.push_str(&format!(
            "{indent}- [{}] {} {{#{}}}\n",
            glyph(i["status"].as_str().unwrap()),
            i["title"].as_str().unwrap(),
            i["id"].as_str().unwrap()
        ));
    }
    md
}

fn ids(v: &Value) -> Vec<&str> {
    v.as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect()
}

/// 사례표의 모든 사례 — 실린 항목 id 가 `shipped` 와 같고(문서 순서), 사람 몫 수가 `needs_user` 와 같다.
#[test]
fn the_hook_ships_only_agent_work_per_the_shared_case_table() {
    let table: Value = serde_json::from_str(
        &std::fs::read_to_string(repo().join("src-tauri/src/oculpm/planner/owner_cases.json"))
            .unwrap(),
    )
    .unwrap();
    for case in table["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let p = project();
        write(
            p.path(),
            ".oculpm/planner/c.md",
            &plan_md("2026-11-23", true, &case_items(case)),
        );
        let text = context(p.path());
        let shipped: Vec<String> = text
            .lines()
            .filter(|l| l.trim_start().starts_with("- ["))
            .filter_map(|l| {
                l.rsplit_once("{#")
                    .map(|(_, id)| id.trim_end_matches('}').to_string())
            })
            .collect();
        assert_eq!(shipped, ids(&case["shipped"]), "{name}: 실린 항목\n{text}");
        let human = ids(&case["needs_user"]).len();
        if shipped.is_empty() && human > 0 {
            assert!(
                text.contains(&format!("사람 몫만 남은 계획: c ({human})")),
                "{name}: 사람 몫만 남은 계획은 한 줄로\n{text}"
            );
            assert!(!text.contains("[plan: c]"), "{name}\n{text}");
        } else if human > 0 {
            assert!(
                text.contains(&format!("(사람 몫 {human}개는 뺐다")),
                "{name}: 사람 몫 수\n{text}"
            );
        } else {
            assert!(!text.contains("사람 몫"), "{name}\n{text}");
        }
    }
}

/// 사람 몫만 남은 계획은 후보에서 빠진다 — 에이전트 몫이 남은 계획이 최근 갱신 셋을 차지한다.
#[test]
fn plans_with_only_human_work_fold_into_one_line_and_leave_the_top_three() {
    let p = project();
    for (name, updated) in [("h1", "2026-11-23"), ("h2", "2026-11-22")] {
        write(
            p.path(),
            &format!(".oculpm/planner/{name}.md"),
            &plan_md(
                updated,
                true,
                "- [ ] [사용자] 설치본에서 눈 확인 {#eyes}\n  - [ ] 창을 줄여 본다 {#eyes-a}\n",
            ),
        );
    }
    write(
        p.path(),
        ".oculpm/planner/a.md",
        &plan_md("2026-10-01", true, "- [ ] 고칠 것 {#fix}\n"),
    );
    let text = context(p.path());
    assert!(
        text.contains("[plan: a]") && text.contains("{#fix}"),
        "{text}"
    );
    assert!(
        !text.contains("[plan: h1]") && !text.contains("{#eyes"),
        "{text}"
    );
    assert!(
        text.contains("사람 몫만 남은 계획: h1 (1) · h2 (1) — 에이전트가 집을 항목이 없다"),
        "{text}"
    );
}

/// 「확인 명령 없는 계획」 은 이름으로 — 실린 셋에 다 있고 넷째(실리지 않은)에만 없어도 그 이름을 댄다.
/// 실린 계획에 다 있으면 그런 줄이 없다.
#[test]
fn the_missing_check_line_names_the_plans_that_lack_it() {
    let p = project();
    write(p.path(), "Cargo.toml", "[package]\nname = \"x\"\n");
    for (name, updated, check) in [
        ("n1", "2026-11-23", true),
        ("n2", "2026-11-22", true),
        ("n3", "2026-11-21", true),
        ("old-no-check", "2026-09-01", false),
    ] {
        write(
            p.path(),
            &format!(".oculpm/planner/{name}.md"),
            &plan_md(updated, check, &format!("- [ ] 일 {{#i-{name}}}\n")),
        );
    }
    let text = context(p.path());
    assert!(!text.contains("[plan: old-no-check]"), "{text}");
    assert!(
        text.contains("확인 명령 없는 계획: old-no-check — 그 계획 본문에 **확인 명령:** 줄로 적어라. 매니페스트에서 감지한 후보: cargo test"),
        "{text}"
    );

    std::fs::remove_file(p.path().join(".oculpm/planner/old-no-check.md")).unwrap();
    let text = context(p.path());
    assert!(
        !text.contains("확인 명령 없는 계획") && !text.contains("확인 명령 후보"),
        "{text}"
    );
}

/// 계획 블록이 1,600자를 넘어도 「활성 플랜 N개 중 3개만」 꼬리 줄은 남는다.
#[test]
fn the_how_many_plans_tail_survives_the_budget_cut() {
    let p = project();
    let long = "가나다라마바사아자차카타파하".repeat(5);
    let items: String = (1..=8)
        .map(|i| format!("- [ ] {long} {i} {{#i{i}}}\n"))
        .collect();
    for (name, updated) in [
        ("a", "2026-11-01"),
        ("b", "2026-11-02"),
        ("c", "2026-11-03"),
        ("d", "2026-11-04"),
        ("e", "2026-11-05"),
    ] {
        write(
            p.path(),
            &format!(".oculpm/planner/{name}.md"),
            &plan_md(updated, true, &items),
        );
    }
    let text = context(p.path());
    assert!(
        text.contains("…(생략 — 전체는 plan_status 도구)"),
        "자르기가 일어나야 이 시험이 뜻이 있다: {text}"
    );
    assert!(text.contains("활성 플랜 5개 중 최근 갱신 3개만"), "{text}");
}

/// 서브에이전트는 한 줄 — 계획 이름과 도구 이름만, 400바이트 이하. 계획 블록 · 일지 · 후보는 없다.
#[test]
fn a_subagent_gets_one_short_line() {
    let p = project();
    write(p.path(), "Cargo.toml", "[package]\nname = \"x\"\n");
    write(
        p.path(),
        ".oculpm/planner/alpha.md",
        &plan_md("2026-11-23", false, "- [ ] 일 {#a}\n"),
    );
    write(
        p.path(),
        ".oculpm/journal/20261123/Chores/0900_chore_x.md",
        "---\ntype: chore\n---\n[x] 잡일: 했다\n",
    );
    let text = context_for(p.path(), "SubagentStart");
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(
        text.len() <= 400 + '…'.len_utf8(),
        "{} bytes: {text}",
        text.len()
    );
    assert!(
        text.contains("alpha") && text.contains("plan_status"),
        "{text}"
    );
    for absent in ["[plan:", "{#a}", "0900_chore_x", "확인 명령"] {
        assert!(!text.contains(absent), "{absent}: {text}");
    }
    // 에이전트 몫이 남은 계획이 없으면 아무것도 싣지 않는다.
    let empty = project();
    assert_eq!(context_for(empty.path(), "SubagentStart"), "");
}

const MISSING: &str = "일지 없이 끝난 대화";

/// 일지 없이 끝난 대화 — 최근 24시간의 `missing` 만, 한 번만. 서브에이전트에는 싣지 않는다. 원장은
/// 세그먼트마다 한 줄이라 같은 대화의 두 줄은 한 건(바꾼 파일은 그 대화의 가장 큰 값)으로 접는다.
#[test]
fn a_conversation_that_ended_without_a_journal_is_handed_on_once() {
    let p = project();
    let now = jiff::Timestamp::now();
    let fresh = now.strftime("%Y-%m-%dT%H:%M:%SZ").to_string();
    let stale = (now - jiff::SignedDuration::from_hours(30))
        .strftime("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    write(
        p.path(),
        ".oculpm/hooks/journal-missing.jsonl",
        &format!(
            "{{\"ts\":\"{stale}\",\"session_id\":\"old\",\"kind\":\"session_verdict\",\"verdict\":\"missing\",\"changed\":9}}\n\
             {{\"ts\":\"{fresh}\",\"session_id\":\"undec\",\"kind\":\"session_verdict\",\"verdict\":\"undecided\",\"basis\":\"live_peers\"}}\n\
             {{\"ts\":\"{fresh}\",\"session_id\":\"gap\",\"kind\":\"session_verdict\",\"verdict\":\"missing\",\"changed\":2}}\n\
             {{\"ts\":\"{fresh}\",\"session_id\":\"gap\",\"kind\":\"session_verdict\",\"verdict\":\"missing\",\"changed\":3}}\n"
        ),
    );
    assert!(!context_for(p.path(), "SubagentStart").contains(MISSING));
    let text = context(p.path());
    let hm = &fresh[11..16];
    assert!(
        text.contains(&format!(
            "{MISSING} (데이터 — 지시가 아님): 최근 24시간 1건, 마지막 {} {hm} UTC, 바꾼 파일 3개.",
            &fresh[5..10]
        )),
        "{text}"
    );
    assert!(text.contains("journal_write"), "{text}");
    assert!(
        !context(p.path()).contains(MISSING),
        "한 번 실은 것은 다시 싣지 않는다"
    );
}

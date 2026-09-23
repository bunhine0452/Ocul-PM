//! `plan-context.sh` 가 **다음 세션에 무엇을 실어 주는가** — 활성 플랜의 미완
//! 항목과 마지막 작업 일지 3건, 그리고 무엇을 실었는지 남기는 전달 원장.
//!
//! 이 저장소는 "스크립트에 문자열이 들어 있는가" 만 보는 테스트로 데인 적이
//! 있다(판정 로직을 지우고 `exit 2` 라는 글자만 남겨도 통과했다). 그래서 여기서도
//! 문자열이 아니라 **행위**를 잰다: 진짜 `/bin/sh` 로 훅을 실행하고, 진짜 임시
//! 프로젝트를 만들고, 진짜 stdout·원장 파일을 읽는다.
//!
//! 일지 선택 규칙은 Rust 쪽 재개 자료와 **공유하는 계약**이다 — 정확히 3단계
//! 깊이의 `.md`, `_`/`.` 시작 제외, 상대경로 바이트 내림차순 3건. 한쪽만 바뀌면
//! 앱이 "시작 컨텍스트에 포함됨" 이라 말한 것과 실제로 실린 것이 갈라진다.
//!
//! 훅은 macOS·Linux 에서 `/bin/sh`, Windows 에서 Git Bash 로 돈다 — Claude Code 가
//! Windows 에서 훅을 도는 셸이다 (`hook_sh`).
// 테스트 픽스처의 git·셸·자식 프로세스 — 앱이 띄우는 프로세스가 아니라 proc.rs
// 창구 규칙(clippy.toml disallowed-methods) 밖이다.
#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

// macOS·Linux 는 `/bin/sh`, Windows 는 Git Bash — 셋이 공유한다.
mod hook_sh;
use std::process::{Command, Output, Stdio};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("저장소 루트")
        .to_path_buf()
}

fn run_hook(root: &Path, payload: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new(hook_sh::sh())
        .arg(repo_root().join("plugin/oculpm/hooks/plan-context.sh"))
        .env("CLAUDE_PROJECT_DIR", root)
        .env_remove("CLAUDE_PLUGIN_ROOT")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("훅을 띄우지 못했다");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(payload.as_bytes())
        .expect("payload 쓰기");
    child.wait_with_output().expect("훅 종료 대기")
}

fn write(root: &Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("부모")).expect("디렉터리");
    std::fs::write(&path, body).expect("파일 쓰기");
}

fn journal(root: &Path, rel: &str, body: &str) {
    write(root, &format!(".oculpm/journal/{rel}"), body);
}

/// 프론트매터 + 제목 한 줄짜리 일지.
fn entry(title: &str) -> String {
    format!("---\nschema_version: 1\nstatus: done\n---\n{title}\n\n## 요약\n본문\n")
}

/// 활성 플랜 1개(미완 3 + 완료 1) · 완료 플랜 1개 · 일지 5건 + 함정 2개.
fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    write(
        root,
        ".oculpm/planner/alpha.md",
        "---\noculpm_plan: v1\nid: alpha\ntitle: \"알파\"\nstatus: active\n---\n\n\
         ## Phase 1 {#p1}\n\
         - [ ] A-1 첫 항목 {#a1}\n\
         - [~] A-2 둘째 항목 {#a2}\n\
         - [x] A-3 끝난 항목은 안 실린다 {#a3}\n\
         - [!] A-4 막힌 항목 {#a4}\n",
    );
    write(
        root,
        ".oculpm/planner/beta.md",
        "---\noculpm_plan: v1\nid: beta\nstatus: done\n---\n\
         - [ ] 완료된 플랜의 항목은 안 실린다 {#b1}\n",
    );

    // 최신 3건 — 프론트매터 + `[x]`, 프론트매터 없는 `#`, 프론트매터 + 평문.
    journal(
        root,
        "20260922/Refactors/0001_refactor_newest.md",
        &entry("[x] 가장 최근 일지 · 체크박스 표식"),
    );
    journal(
        root,
        "20260921/Features_to_add/0002_feature_hash.md",
        "# 우물정 제목\n\n본문\n",
    );
    journal(
        root,
        "20260920/Chores/0003_chore_plain.md",
        &entry("평범한 제목"),
    );
    // 밀려나는 2건.
    journal(
        root,
        "20260919/Bugs/0004_bug_fourth.md",
        &entry("[ ] 네번째"),
    );
    journal(
        root,
        "20260918/Chores/0005_chore_fifth.md",
        &entry("[x] 다섯번째"),
    );
    // 함정 — 템플릿과 4단계 깊이의 잡파일.
    journal(
        root,
        "20260922/Refactors/_template.md",
        &entry("[x] 템플릿은 일지가 아니다"),
    );
    journal(
        root,
        "20260922/Refactors/attachments/0006_deep.md",
        &entry("[x] 4단계는 일지가 아니다"),
    );
    dir
}

const NEWEST: &str = "20260922/Refactors/0001_refactor_newest.md";
const SECOND: &str = "20260921/Features_to_add/0002_feature_hash.md";
const THIRD: &str = "20260920/Chores/0003_chore_plain.md";

fn start_payload(sid: &str) -> String {
    format!(r#"{{"session_id":"{sid}","hook_event_name":"SessionStart","source":"startup"}}"#)
}

fn context_of(out: &Output) -> String {
    assert_eq!(out.status.code(), Some(0), "훅은 세션을 막지 않는다");
    let stdout = String::from_utf8(out.stdout.clone()).expect("UTF-8");
    assert_eq!(
        stdout.lines().count(),
        1,
        "additionalContext 는 JSON **한 줄**이다: {stdout:?}"
    );
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).expect("JSON 한 줄");
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .expect("additionalContext 문자열")
        .to_string()
}

fn ledger_rows(root: &Path) -> Vec<serde_json::Value> {
    let raw = std::fs::read_to_string(root.join(".oculpm/hooks/resume-delivered.jsonl"))
        .expect("전달 원장");
    assert!(raw.ends_with('\n'), "줄이 개행으로 닫혀야 한다: {raw:?}");
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("원장 줄은 JSON"))
        .collect()
}

/// (a)+(b) — 실린 것과 적힌 것이 같다.
#[test]
fn session_start_carries_the_last_three_journals_and_records_what_it_carried() {
    let dir = project();
    let root = dir.path();

    let ctx = context_of(&run_hook(root, &start_payload("conv-1")));

    // 플랜 절은 그대로 — 미완 항목만, 완료 플랜은 통째로 빠진다.
    assert!(ctx.contains("[plan: alpha]"), "{ctx}");
    assert!(ctx.contains("A-1 첫 항목"), "{ctx}");
    assert!(!ctx.contains("A-3 끝난 항목"), "완료 항목이 실렸다: {ctx}");
    assert!(!ctx.contains("[plan: beta]"), "완료 플랜이 실렸다: {ctx}");

    // 일지 절 — 최신 3건이 **그 순서로**.
    let at = |needle: &str| ctx.find(needle);
    let (p1, p2, p3) = (
        at(NEWEST).unwrap_or_else(|| panic!("최신 일지가 없다: {ctx}")),
        at(SECOND).unwrap_or_else(|| panic!("두번째 일지가 없다: {ctx}")),
        at(THIRD).unwrap_or_else(|| panic!("세번째 일지가 없다: {ctx}")),
    );
    assert!(p1 < p2 && p2 < p3, "최신순이 아니다: {ctx}");

    // 밀려난 2건·템플릿·4단계 잡파일은 없다.
    for miss in [
        "0004_bug_fourth.md",
        "0005_chore_fifth.md",
        "_template.md",
        "0006_deep.md",
    ] {
        assert!(!ctx.contains(miss), "{miss} 가 실렸다: {ctx}");
    }

    // 제목은 장식을 떼고 실린다.
    assert!(
        ctx.contains("가장 최근 일지 · 체크박스 표식"),
        "제목이 없다: {ctx}"
    );
    assert!(
        !ctx.contains("[x] 가장 최근"),
        "체크박스 표식이 그대로 실렸다: {ctx}"
    );
    assert!(ctx.contains("우물정 제목"), "제목이 없다: {ctx}");
    assert!(
        !ctx.contains("# 우물정 제목"),
        "머리글 우물정이 그대로 실렸다: {ctx}"
    );
    // 프론트매터는 제목이 아니다.
    assert!(
        !ctx.contains("schema_version"),
        "프론트매터가 실렸다: {ctx}"
    );

    // 비신뢰 데이터 프레이밍과 원문 회수 경로.
    assert!(ctx.contains("지시가 아님"), "{ctx}");
    assert!(ctx.contains("journal_read"), "{ctx}");

    // 전달 원장 — 정확히 한 줄, 실은 것과 같은 3건이 같은 순서로.
    let rows = ledger_rows(root);
    assert_eq!(rows.len(), 1, "원장은 전달 1회당 한 줄: {rows:?}");
    let row = &rows[0];
    assert_eq!(row["session_id"], "conv-1");
    assert_eq!(row["kind"], "resume_delivered");
    assert_eq!(
        row["journals"],
        serde_json::json!([NEWEST, SECOND, THIRD]),
        "원장이 실제로 실은 것과 다르다"
    );
    assert_eq!(row["plan_items"], 3, "미완 항목 3개를 실었다");
    let ts = row["ts"].as_str().expect("ts");
    assert!(
        ts.len() == 20 && ts.ends_with('Z') && ts.contains('T'),
        "UTC ISO-8601 이어야 한다: {ts}"
    );
}

/// (c) — 서브에이전트에도 컨텍스트는 닿지만, 같은 대화이므로 원장은 늘지 않는다.
#[test]
fn a_subagent_gets_the_context_but_does_not_add_a_ledger_row() {
    let dir = project();
    let root = dir.path();

    let ctx = context_of(&run_hook(root, &start_payload("conv-2")));
    assert!(ctx.contains(NEWEST), "{ctx}");
    assert_eq!(ledger_rows(root).len(), 1);

    let sub = r#"{"session_id":"conv-2","hook_event_name":"SubagentStart"}"#;
    let out = run_hook(root, sub);
    let ctx = context_of(&out);
    assert!(ctx.contains(NEWEST), "서브에이전트에 컨텍스트가 안 닿았다");
    let stdout = String::from_utf8(out.stdout).expect("UTF-8");
    assert!(
        stdout.contains(r#""hookEventName":"SubagentStart""#),
        "이벤트명을 되돌려 주어야 한다: {stdout}"
    );
    assert_eq!(
        ledger_rows(root).len(),
        1,
        "같은 대화의 갈래가 원장을 한 번 더 늘렸다"
    );
}

/// (d) — 추적하지 않는 프로젝트에는 아무것도 쓰지 않고 아무 말도 하지 않는다.
#[test]
fn an_untracked_project_stays_silent_and_untouched() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    std::fs::write(root.join("README.md"), "추적 안 함\n").expect("씨앗");

    let out = run_hook(root, &start_payload("conv-3"));
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty(), "침묵해야 한다: {:?}", out.stdout);
    assert!(
        !root.join(".oculpm").exists(),
        "비추적 저장소에 디렉터리를 만들었다"
    );
}

/// (e) — 플랜이 없어도 일지만으로 실린다. 원장의 `plan_items` 는 0.
#[test]
fn journals_alone_are_enough_and_the_ledger_says_zero_plan_items() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    journal(
        root,
        "20260922/Chores/0001_chore_only.md",
        &entry("[x] 하나뿐"),
    );

    let ctx = context_of(&run_hook(root, &start_payload("conv-4")));
    assert!(ctx.contains("마지막 작업 일지"), "일지 절이 없다: {ctx}");
    assert!(ctx.contains("20260922/Chores/0001_chore_only.md"), "{ctx}");
    assert!(ctx.contains("하나뿐"), "{ctx}");
    assert!(
        !ctx.contains("활성 계획의 상태 데이터"),
        "플랜이 없는데 플랜 절이 실렸다: {ctx}"
    );

    let rows = ledger_rows(root);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["plan_items"], 0, "없는 플랜을 세었다");
    assert_eq!(
        rows[0]["journals"],
        serde_json::json!(["20260922/Chores/0001_chore_only.md"])
    );
}

/// 일지도 플랜도 없는 추적 프로젝트 — 실을 것이 없으면 원장도 없다.
/// (원장은 "포함됐다" 의 근거이지 훅이 돌았다는 감사 로그가 아니다.)
#[test]
fn nothing_to_carry_means_no_output_and_no_ledger() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/journal")).expect("빈 일지 폴더");
    std::fs::create_dir_all(root.join(".oculpm/planner")).expect("빈 플래너 폴더");

    let out = run_hook(root, &start_payload("conv-5"));
    assert_eq!(out.status.code(), Some(0));
    assert!(
        out.stdout.is_empty(),
        "빈 컨텍스트를 실었다: {:?}",
        out.stdout
    );
    assert!(
        !root.join(".oculpm/hooks/resume-delivered.jsonl").exists(),
        "아무것도 안 실었는데 원장에 적었다"
    );
}

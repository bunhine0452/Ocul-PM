//! 인자를 한 번에 맞게 (love-round-20261123 #mcp-arg-forgiveness) — 실측 실패 9건의 모양 그대로.
//!
//! 이 저장소 세션의 `journal_write` 실패 9건은 전부 필수 인자 누락이었고, 실패 호출의 키는 모두 `body`
//! 였다. 그중 4건은 slug 도 없었다. 예전에는 `'slug' is required` → slug 를 더해 다시 → `'body_markdown'
//! is required` 로 왕복이 두 번이었다.

use serde_json::json;
use tempfile::TempDir;

use crate::oculpm::mcp::tools::call_tool;

fn tracked() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    dir
}

const BODY: &str = "## 해결 방법\n고쳤다\n\n## 검증\ncargo test — 12 passed";

/// 실패 사례 그대로 — `body` + slug 없음. 이제 한 번에 기록되고, 무엇을 어떻게 받았는지 응답이 말한다.
#[test]
fn body_without_slug_is_recorded_and_the_response_says_how() {
    let dir = tracked();
    let out = call_tool(
        dir.path(),
        "journal_write",
        &json!({
            "type": "bug", "title": "MCP: body 로 보낸 일지",
            "body": BODY,
            "files_touched": [{ "path": "src-tauri/src/oculpm/mcp/tools/plan_ops.rs", "op": "update" }]
        }),
    )
    .unwrap();
    let path = out["path"].as_str().unwrap();
    assert!(
        path.ends_with("_bug_plan-ops.md"),
        "건드린 첫 파일 이름으로: {path}"
    );
    let md = std::fs::read_to_string(dir.path().join(path)).unwrap();
    assert!(md.contains("고쳤다"), "body 가 본문이 됐다: {md}");
    let received = out["received"].to_string();
    assert!(
        received.contains("`body` 를 `body_markdown` 으로 받았어요"),
        "{received}"
    );
    assert!(received.contains("`slug` 가 없어"), "{received}");
    assert_eq!(out["slug"], "plan-ops");
}

/// 빠진 필수 인자는 전부 한 문장으로 — 인자마다 스키마의 설명 한 토막과 함께. slug 는 이제 필수가 아니다.
#[test]
fn every_missing_required_argument_is_named_at_once() {
    let dir = tracked();
    let err = call_tool(dir.path(), "journal_write", &json!({ "slug": "x" })).unwrap_err();
    assert!(
        err.starts_with("journal_write: 필수 인자 3개가 없어요"),
        "{err}"
    );
    for k in ["`type`", "`title`", "`body_markdown` (본문"] {
        assert!(err.contains(k), "{k}: {err}");
    }
    assert!(!err.contains("`slug`"), "{err}");
    assert!(
        !dir.path().join(".oculpm/journal").exists(),
        "거절된 호출은 아무것도 안 쓴다"
    );
}

/// 모르는 키는 거절하지 않고 버렸다고 알린다 — 조용히 버리면 에이전트는 틀린 이름을 계속 쓴다.
/// 정식 이름과 동의어를 둘 다 주면 정식 이름이 이기고, 남은 동의어가 모르는 키로 짚인다.
#[test]
fn unknown_keys_are_reported_not_silently_dropped() {
    let dir = tracked();
    let out = call_tool(
        dir.path(),
        "journal_write",
        &json!({
            "type": "chore", "slug": "warn-unknown", "title": "MCP: 모르는 키",
            "body_markdown": BODY, "body": "버려질 글", "severity": "high"
        }),
    )
    .unwrap();
    let warnings = out["warnings"].to_string();
    assert!(
        warnings.contains("`body`") && warnings.contains("`severity`"),
        "{warnings}"
    );
    assert!(
        out.get("received").is_none(),
        "정식 이름을 줬으면 받은 동의어가 없다: {out}"
    );
    let md = std::fs::read_to_string(dir.path().join(out["path"].as_str().unwrap())).unwrap();
    assert!(!md.contains("버려질 글"));
}

/// 영어 프로젝트에는 영어로 — 거절 문구의 언어는 프로젝트 규칙 언어를 따른다 (`title.rs` 와 같다).
#[test]
fn english_projects_get_english_refusals() {
    let dir = tracked();
    std::fs::write(
        dir.path().join(".oculpm/config.toml"),
        "[agents]\ntemplate_language = \"en\"\n",
    )
    .unwrap();
    let err = call_tool(dir.path(), "journal_write", &json!({ "type": "bug" })).unwrap_err();
    assert!(
        err.starts_with("journal_write: missing 2 required argument(s)"),
        "{err}"
    );
}

/// plan_status 의 `st` 글리프를 그대로 넘겨도 된다 — 「invalid status 'x'」 왕복이 사라진다.
#[test]
fn plan_status_glyphs_are_accepted_as_statuses() {
    use crate::oculpm::mcp::tools::parse_item_status;
    use crate::oculpm::planner::parse::ItemStatus;
    for (raw, want) in [
        ("x", ItemStatus::Done),
        ("[x]", ItemStatus::Done),
        (" ", ItemStatus::Todo),
        ("[ ]", ItemStatus::Todo),
        ("~", ItemStatus::InProgress),
        ("!", ItemStatus::Blocked),
        (">", ItemStatus::Deferred),
        ("-", ItemStatus::Dropped),
        ("in-progress", ItemStatus::InProgress),
        ("done", ItemStatus::Done),
    ] {
        assert_eq!(parse_item_status(raw), Ok(want), "{raw:?}");
    }
    assert!(parse_item_status("").is_err());
    assert!(parse_item_status("finished").is_err());
}

/// project_init 의 거절은 한 언어 한 문장이다 — 「…explicitly confirms starting 있습니다 —」 처럼 영어
/// 문장 끝에 한국어 어미가 붙은 깨진 문장을 에이전트가 사람에게 그대로 옮겼다.
#[test]
fn project_init_refusal_reads_as_one_language() {
    let dir = TempDir::new().unwrap();
    let err = call_tool(dir.path(), "project_init", &json!({})).unwrap_err();
    assert!(err.contains("confirm=true"), "{err}");
    let allowed = ["project_init", "confirm", "true"];
    let latin_words: Vec<&str> = err
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| w.chars().any(|c| c.is_ascii_alphabetic()))
        .filter(|w| !allowed.contains(w))
        .collect();
    assert!(
        latin_words.is_empty(),
        "영어 낱말이 섞였다 {latin_words:?}: {err}"
    );
}

/// 읽기 전용 도구는 `readOnlyHint` 를 단다 — 클라이언트가 허락 없이 부를 수 있는 것을 안다.
#[test]
fn read_only_tools_are_annotated() {
    let defs = crate::oculpm::mcp::tools::tool_definitions();
    for t in defs.as_array().unwrap() {
        let ro = t["annotations"]["readOnlyHint"] == true;
        let want = matches!(
            t["name"].as_str().unwrap(),
            "journal_search" | "journal_read" | "plan_status"
        );
        assert_eq!(ro, want, "{}", t["name"]);
    }
}

//! `journal_write` 의 제목 규격 — 「영역: 무엇을 했다」, 40자 안, 줄표로 잇지 않는다 (사용자 결정 2026-10-30).
//! 안내만으로는 일지 934건 중 47% 가 40자를 넘었다. 그래서 도구가 거절하고, 거절 문구가 고칠 말이다.

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::mcp::tools::*;
use serde_json::{json, Value};
use tempfile::TempDir;

fn tracked() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    dir
}

fn write(root: &std::path::Path, extra: Value) -> Result<Value, String> {
    let mut args = json!({
        "type": "chore",
        "slug": "title-rule",
        "body_markdown": "## 검증\n\ncargo test → ok",
    });
    for (k, v) in extra.as_object().unwrap() {
        args[k] = v.clone();
    }
    call_tool(root, "journal_write", &args)
}

fn first_line_and_tags(root: &std::path::Path, out: &Value) -> (String, Vec<String>) {
    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    let (fm, body) = parse_frontmatter_and_body(&raw);
    (
        body.lines().next().unwrap_or("").to_string(),
        fm.parsed.unwrap().tags,
    )
}

#[test]
fn an_area_prefixed_title_is_kept_and_the_area_leads_the_tags() {
    let dir = tracked();
    let out = write(
        dir.path(),
        json!({ "title": "터미널: Claude 상태를 안다", "tags": ["osc"] }),
    )
    .unwrap();
    let (line, tags) = first_line_and_tags(dir.path(), &out);
    assert_eq!(line, "[x] 터미널: Claude 상태를 안다");
    assert_eq!(
        tags.first().map(String::as_str),
        Some("터미널"),
        "영역이 첫 태그: {tags:?}"
    );
}

#[test]
fn the_area_argument_composes_the_title() {
    let dir = tracked();
    let out = write(
        dir.path(),
        json!({ "title": "리눅스 스모크 창 이름 고침", "area": "CI" }),
    )
    .unwrap();
    let (line, tags) = first_line_and_tags(dir.path(), &out);
    assert_eq!(line, "[x] CI: 리눅스 스모크 창 이름 고침");
    assert_eq!(tags.first().map(String::as_str), Some("ci"));
}

#[test]
fn titles_that_break_the_rule_are_refused_with_the_fix() {
    let dir = tracked();
    let no_area = write(dir.path(), json!({ "title": "캐시 무효화 고침" })).unwrap_err();
    assert!(
        no_area.contains("영역이 없어요") && no_area.contains("영역: 무엇을 했다"),
        "{no_area}"
    );

    let dashed = write(
        dir.path(),
        json!({ "title": "오늘: 수 표기 고침 — 영어 복수형" }),
    )
    .unwrap_err();
    assert!(dashed.contains("줄표"), "{dashed}");

    let long = "일지: 아주 긴 제목이라서 목록 한 줄에 들어가지 않고 오늘 화면에서도 잘려 보이는 것";
    let too_long = write(dir.path(), json!({ "title": long })).unwrap_err();
    assert!(too_long.contains("40자"), "{too_long}");

    let wide_area = write(
        dir.path(),
        json!({ "title": "x", "area": "열세글자가넘는아주긴영역이름" }),
    )
    .unwrap_err();
    assert!(wide_area.contains("1~12자"), "{wide_area}");

    let mismatch = write(
        dir.path(),
        json!({ "title": "오늘: 수 표기 고침", "area": "일지" }),
    )
    .unwrap_err();
    assert!(mismatch.contains("달라요"), "{mismatch}");

    assert!(
        std::fs::read_dir(dir.path().join(".oculpm/journal")).map_or(true, |d| d.count() == 0),
        "거절된 호출은 파일을 남기지 않는다"
    );
}

#[test]
fn a_refusal_names_the_areas_this_project_already_uses() {
    let dir = tracked();
    for (slug, title) in [("a", "터미널: 하나"), ("b", "터미널: 둘"), ("c", "MCP: 셋")] {
        write(dir.path(), json!({ "slug": slug, "title": title })).unwrap();
    }
    let err = write(
        dir.path(),
        json!({ "slug": "d", "title": "영역 없는 제목" }),
    )
    .unwrap_err();
    assert!(
        err.contains("이미 쓰는 영역: 터미널, MCP"),
        "많이 쓴 순: {err}"
    );
}

#[test]
fn an_english_project_is_refused_in_english() {
    let dir = tracked();
    std::fs::write(
        dir.path().join(".oculpm/config.toml"),
        "[agents]\ntemplate_language = \"en\"\n",
    )
    .unwrap();
    let err = write(dir.path(), json!({ "title": "fix the cache" })).unwrap_err();
    assert!(
        err.contains("has no area") && err.contains("area: what changed"),
        "{err}"
    );
}

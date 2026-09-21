//! `journal_write` 의 태그 — 무엇을 고치고 무엇을 알려만 주는가
//! ({#tag-normalize}).

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// 태그가 달린 일지 하나를 심는다. 사전의 재료다.
fn seed_tagged(root: &std::path::Path, workday: &str, hhmm: &str, slug: &str, tags: &[&str]) {
    let dir = root.join(".oculpm/journal").join(workday).join("Bugs");
    std::fs::create_dir_all(&dir).unwrap();
    let tag_lines: String = tags.iter().map(|t| format!("\n  - \"{t}\"")).collect();
    std::fs::write(
        dir.join(format!("{hhmm}_bug_{slug}.md")),
        format!(
            "---\nschema_version: 1\ntype: bug\nslug: \"{slug}\"\nstatus: done\n\
             created_at: \"{y}-{m}-{d}T{h}:{mi}:00+09:00\"\nsession_id: \"manual-{workday}-000000\"\n\
             agent:\n  id: \"claude-code\"\nlanguage: ko\nverified_by_user: false\n\
             files_touched: []\nrelated: []\ntags:{tag_lines}\n---\n[x] {slug}\n",
            y = &workday[0..4],
            m = &workday[4..6],
            d = &workday[6..8],
            h = &hhmm[0..2],
            mi = &hhmm[2..4],
        ),
    )
    .unwrap();
}

fn write_with_tags(root: &std::path::Path, tags: serde_json::Value) -> serde_json::Value {
    call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "bug",
            "slug": "tag-round",
            "title": "태그 라운드",
            "body_markdown": "## 발생 원인\n\n어휘가 갈라졌다.\n\n## 해결 방법\n\n정규화.\n\n## 검증\n\ncargo test",
            "tags": tags,
        }),
    )
    .unwrap()
}

fn tags_on_disk(root: &std::path::Path, out: &serde_json::Value) -> Vec<String> {
    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    parse_frontmatter_and_body(&raw).0.parsed.unwrap().tags
}

/// 표기 차이는 기계가 정한다 — 대소문자·공백·밑줄·구두점·중복.
#[test]
fn journal_write_normalizes_the_spelling_of_tags() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    let out = write_with_tags(
        root,
        serde_json::json!(["Bug Fix", "bug_fix", "  #API!  ", "일지 규모", "!!!"]),
    );
    assert_eq!(
        tags_on_disk(root, &out),
        vec!["bug-fix", "api", "일지-규모", "mcp-tool"],
        "정규화 + 중복 제거 + 빈 태그 버리기, 출처 표식은 마지막"
    );
    assert_eq!(
        out["tag_hints"].as_array().unwrap().len(),
        0,
        "사전이 비었다"
    );
}

/// 유사 태그는 **치환하지 않는다** — 응답으로만 알린다.
#[test]
fn similar_tags_are_reported_not_substituted() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    // 빈도 3 — 사전에 오르는 최소치 (`DICTIONARY_MIN_COUNT`).
    seed_tagged(root, "20260901", "0900", "a", &["bug", "mcp-tool"]);
    seed_tagged(root, "20260902", "0900", "b", &["Bug", "mcp-tool"]);
    seed_tagged(root, "20260903", "0900", "c", &["bug", "terminal"]);

    let out = write_with_tags(root, serde_json::json!(["bugs"]));
    assert!(
        tags_on_disk(root, &out).contains(&"bugs".to_string()),
        "준 말이 그대로 적혀야 한다 — 몰래 고치지 않는다"
    );
    let hints = out["tag_hints"].as_array().unwrap();
    assert_eq!(hints.len(), 1, "{hints:?}");
    assert_eq!(hints[0]["given"], "bugs");
    assert_eq!(hints[0]["suggest"], "bug");
    assert_eq!(hints[0]["reason"], "plural");
}

/// 이미 이 프로젝트의 말이면 힌트도 없다 (그게 정상적인 호출이다).
#[test]
fn a_word_the_project_already_uses_draws_no_hint() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    seed_tagged(root, "20260901", "0900", "a", &["terminal"]);
    seed_tagged(root, "20260902", "0900", "b", &["terminal"]);
    seed_tagged(root, "20260903", "0900", "c", &["terminal"]);

    let out = write_with_tags(root, serde_json::json!(["Terminal"]));
    assert_eq!(out["tag_hints"].as_array().unwrap().len(), 0);
    assert!(tags_on_disk(root, &out).contains(&"terminal".to_string()));
}

/// 태그를 안 주면 사전도 안 짓는다 (자동 기록에서 흔한 길이다).
#[test]
fn no_tags_means_no_dictionary_work() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    seed_tagged(root, "20260901", "0900", "a", &["bug"]);

    let out = write_with_tags(root, serde_json::json!([]));
    assert_eq!(tags_on_disk(root, &out), vec!["mcp-tool"]);
    assert_eq!(out["tag_hints"].as_array().unwrap().len(), 0);
}

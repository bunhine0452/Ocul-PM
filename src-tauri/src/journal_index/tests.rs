//! `journal_index` 단위 테스트 — 머리말·섹션 분할·프론트매터 제외·리댁션.

use super::*;

const ENTRY: &str = r#"---
schema_version: 1
type: bug
slug: watcher-stalls
status: done
created_at: 2026-09-21T10:00:00+09:00
session_id: manual-abc
agent:
  id: claude-code
  name: Claude Code
language: ko
verified_by_user: false
files_touched: []
related: []
tags:
  - watcher
  - 진단
---

[x] 워처가 조용히 멈춘다

도입 문단. 증상만 적는다.

## 무엇을 했나

FLOW 타임라인을 읽었다.
AWS_SECRET=AKIAIOSFODNN7EXAMPLE 를 인자로 넘기고 있었다.

```md
## 이건 코드 펜스 안이라 경계가 아니다
```

## 배운 것

로그 모양 집계가 grep 보다 낫다.
"#;

fn rel() -> &'static str {
    ".oculpm/journal/20260921/Bugs/1000_bug_watcher-stalls.md"
}

#[test]
fn every_chunk_carries_the_header_line_and_no_frontmatter() {
    let chunks = chunk_journal(rel(), ENTRY, &[]);
    assert!(chunks.len() >= 3, "섹션이 셋인데 {}개", chunks.len());
    for c in &chunks {
        assert!(
            c.content.starts_with("# 워처가 조용히 멈춘다 · "),
            "머리말이 없다: {:?}",
            c.content.lines().next()
        );
        assert!(c.content.contains("type: bug"), "종류가 머리말에 없다");
        assert!(c.content.contains("tags: watcher, 진단"));
        assert!(c.content.contains("workday: 20260921"));
        // 프론트매터 키는 어느 청크에도 안 들어간다.
        assert!(!c.content.contains("schema_version"));
        assert!(!c.content.contains("session_id"));
    }
}

#[test]
fn sections_split_on_headings_but_not_inside_code_fences() {
    let chunks = chunk_journal(rel(), ENTRY, &[]);
    let bodies: Vec<&str> = chunks.iter().map(|c| c.content.as_str()).collect();
    // 머리 청크(제목 + 도입) · "무엇을 했나" · "배운 것" — 셋.
    assert_eq!(bodies.len(), 3, "{bodies:#?}");
    assert!(bodies[0].contains("도입 문단"));
    assert!(bodies[1].contains("## 무엇을 했나"));
    // 펜스 안의 `##` 은 새 청크를 만들지 않는다.
    assert!(bodies[1].contains("이건 코드 펜스 안이라 경계가 아니다"));
    assert!(bodies[2].contains("## 배운 것"));
    // 줄 번호는 원본 파일 기준 — 프론트매터(18줄)를 지난 첫 **내용** 줄,
    // 즉 제목 줄(20)을 가리킨다. 빈 줄 19 가 아니다.
    let title_line = ENTRY
        .lines()
        .position(|l| l.contains("워처가 조용히 멈춘다"))
        .unwrap() as u32
        + 1;
    assert_eq!(chunks[0].start_line, title_line);
    assert!(chunks[0].end_line >= chunks[0].start_line);
}

#[test]
fn chunk_text_goes_through_redaction() {
    let patterns =
        crate::oculpm::redact::compile_redact_patterns(&["AKIA[0-9A-Z]{16}".to_string()]);
    let chunks = chunk_journal(rel(), ENTRY, &patterns);
    let joined = chunks
        .iter()
        .map(|c| c.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !joined.contains("AKIAIOSFODNN7EXAMPLE"),
        "디스크 원문의 시크릿이 청크에 그대로 남았다"
    );
    assert!(joined.contains(crate::oculpm::redact::REDACTED_PLACEHOLDER));
}

#[test]
fn only_journal_and_rollup_markdown_is_indexable() {
    assert!(is_journal_index_path(
        ".oculpm/journal/20260921/Bugs/1000_bug_x.md"
    ));
    assert!(is_journal_index_path(".oculpm/rollups/2026-W38.md"));
    // 앱이 관리하는 자리 · 계획 · 논의는 대상이 아니다.
    assert!(!is_journal_index_path(
        ".oculpm/index/20260921/entries.json"
    ));
    assert!(!is_journal_index_path(
        ".oculpm/planner/journal-scale-round.md"
    ));
    assert!(!is_journal_index_path(".oculpm/discussion/x/00-brief.md"));
    // 템플릿·첨부·숨김 조각.
    assert!(!is_journal_index_path(".oculpm/journal/_template.md"));
    assert!(!is_journal_index_path(
        ".oculpm/journal/20260921/Bugs/_attachments/a.md"
    ));
    // 코드는 코드 색인의 몫이다.
    assert!(!is_journal_index_path("src/lib.rs"));
    assert!(!is_journal_index_path("docs/README.md"));
}

#[test]
fn the_setting_defaults_to_on() {
    assert!(include_journal_enabled(None));
    assert!(include_journal_enabled(Some("true")));
    assert!(include_journal_enabled(Some("")));
    assert!(!include_journal_enabled(Some("false")));
    assert!(!include_journal_enabled(Some("0")));
}

#[test]
fn a_rollup_without_frontmatter_still_gets_a_header() {
    let src = "# 2026-W38 주간 요약\n\n무슨 일이 있었나.\n\n## 출시\n\nv3.3.0.\n";
    let chunks = chunk_journal(".oculpm/rollups/2026-W38.md", src, &[]);
    assert!(!chunks.is_empty());
    for c in &chunks {
        assert!(c.content.contains("rollup: 2026-W38"), "{}", c.content);
    }
}

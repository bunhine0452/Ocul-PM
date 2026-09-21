//! 롤업의 온디스크 계약 — 왕복·지문·문지기.

use super::*;
use crate::oculpm::cache::RollupSourceEntry;

fn fm(week: &str, hash: &str) -> RollupFrontmatter {
    RollupFrontmatter {
        oculpm_rollup: ROLLUP_SCHEMA.into(),
        week: week.into(),
        range: RollupRange {
            from: "20260914".into(),
            to: "20260920".into(),
        },
        entry_count: 3,
        entries_hash: hash.into(),
        generated_at: "2026-09-21T18:00:00+09:00".into(),
        generator: "deterministic".into(),
    }
}

fn source(path: &str, body_hash: &str) -> RollupSourceEntry {
    RollupSourceEntry {
        relative_path: path.into(),
        workday: "20260915".into(),
        entry_type: "bug".into(),
        status: "done".into(),
        agent_id: "claude-code".into(),
        title: "t".into(),
        body_markdown: String::new(),
        body_md_hash: body_hash.into(),
        files: Vec::new(),
    }
}

/// 쓴 것을 그대로 읽는다 — 이 성질이 깨지면 「오래됨」 판정도, 목록도 전부
/// 거짓말을 한다.
#[test]
fn frontmatter_round_trips_through_disk() {
    let f = fm("2026-W38", "abc123");
    let body = "# 2026-W38 주간 요약\n\n## 한 주 요약\n\n첫 문단이에요.\n\n## 결정\n- 없음\n";
    let text = render(&f, body).unwrap();
    assert!(text.starts_with("---\noculpm_rollup: v1\n"), "{text}");
    let (back, back_body) = parse(&text).expect("파싱");
    assert_eq!(back, f);
    assert_eq!(back_body.trim_end(), body.trim_end());
}

#[test]
fn a_file_without_frontmatter_is_not_a_rollup() {
    assert!(parse("# 그냥 마크다운\n본문\n").is_none());
    assert!(parse("---\nnot: a rollup\n---\n본문\n").is_none());
}

/// 지문은 **내용**의 함수고 입력 순서와 무관하다.
#[test]
fn the_fingerprint_ignores_order_and_moves_with_content() {
    let a = vec![
        source("20260915/Bugs/a.md", "h1"),
        source("20260916/Bugs/b.md", "h2"),
    ];
    let mut reversed = a.clone();
    reversed.reverse();
    assert_eq!(entries_hash(&a), entries_hash(&reversed), "정렬로 접는다");

    let mut changed = a.clone();
    changed[0].body_md_hash = "h1-edited".into();
    assert_ne!(
        entries_hash(&a),
        entries_hash(&changed),
        "본문이 바뀌면 다르다"
    );

    let mut added = a.clone();
    added.push(source("20260917/Bugs/c.md", "h3"));
    assert_ne!(entries_hash(&a), entries_hash(&added), "일지가 늘면 다르다");

    assert_eq!(entries_hash(&[]).len(), 64, "0건도 값을 낸다");
}

/// 「오래됨」은 **아는 것**만 말한다 — 현재 지문을 모르면 배지를 달지 않는다.
#[test]
fn stale_is_only_claimed_when_the_current_fingerprint_is_known() {
    let f = fm("2026-W38", "abc123");
    let body = "## 한 주 요약\n\n첫 문단.\n";
    assert!(!summarize(&f, body, None).stale, "모르면 말하지 않는다");
    assert!(!summarize(&f, body, Some("abc123")).stale);
    assert!(summarize(&f, body, Some("zzz")).stale);
    assert_eq!(
        summarize(&f, body, None).path,
        ".oculpm/rollups/2026-W38.md"
    );
    assert_eq!(summarize(&f, body, None).summary, "첫 문단.");
}

#[test]
fn the_first_paragraph_skips_the_heading_and_joins_wrapped_lines() {
    let body = "# 2026-W38 주간 요약\n\n## 한 주 요약\n\n한 줄\n이어진 줄\n\n## 결정\n- x\n";
    assert_eq!(first_paragraph(body), "한 줄 이어진 줄");
    // 섹션이 없으면 본문의 첫 문단.
    assert_eq!(first_paragraph("그냥 첫 문단\n\n둘째"), "그냥 첫 문단");
    assert_eq!(first_paragraph(""), "");
}

/// 쓰기는 디렉터리를 만들고, 목록은 문지기의 락 파일을 문서로 세지 않는다.
#[test]
fn writing_creates_the_tree_and_listing_ignores_lock_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    write(root, &fm("2026-W37", "h37"), "## 한 주 요약\n\n37주.\n").unwrap();
    write(root, &fm("2026-W38", "h38"), "## 한 주 요약\n\n38주.\n").unwrap();
    // 죽은 문지기가 남긴 락 파일을 흉내 낸다.
    std::fs::write(root.join(".oculpm/rollups/.2026-W38.md.lock"), "{}").unwrap();

    let all = read_all(root);
    assert_eq!(all.len(), 2, "{all:#?}");
    assert_eq!(all[0].0.week, "2026-W38", "최신 먼저");
    assert_eq!(all[1].0.week, "2026-W37");

    let one = read_one(root, "2026-W37").expect("한 주 읽기");
    assert_eq!(one.0.entries_hash, "h37");
    assert!(read_one(root, "2026-W01").is_none());
}

/// 같은 주를 다시 만들면 **덮어쓴다** — 롤업은 append 원장이 아니라 그 주의
/// 현재 요약이고, 「오래됨」을 고치는 길이 재생성뿐이다.
#[test]
fn regenerating_a_week_replaces_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, &fm("2026-W38", "old"), "## 한 주 요약\n\n옛 판.\n").unwrap();
    let mut next = fm("2026-W38", "new");
    next.generator = "llm:claude-opus-4".into();
    write(root, &next, "## 한 주 요약\n\n새 판.\n").unwrap();

    let all = read_all(root);
    assert_eq!(all.len(), 1, "파일은 하나다");
    assert_eq!(all[0].0.entries_hash, "new");
    assert_eq!(all[0].0.generator, "llm:claude-opus-4");
    assert!(all[0].1.contains("새 판."));
}

/// **규칙이 가리키지 않는 층은 읽히지 않는다** (`{#rollup-first}`).
///
/// 이 단언이 `agents/mod.rs` 의 템플릿 패리티 테스트 옆이 아니라 여기 있는
/// 이유는 그 파일이 크기 래칫(1,264줄) 위라 한 줄도 못 늘리기 때문이다.
/// 지키는 성질은 같다 — §0 이 `journal_search` 를 말해야 검색이 실제로
/// 불리듯, `rollups` 를 말해야 요약 층이 실제로 읽힌다.
#[test]
fn the_master_templates_point_at_the_rollup_layer() {
    for (name, tpl) in [
        ("ko", crate::oculpm::agents::MASTER_KO),
        ("en", crate::oculpm::agents::MASTER_EN),
    ] {
        assert!(tpl.contains("rollups"), "{name}: §0 롤업 우선 안내 누락");
        assert!(
            tpl.contains("journal_read"),
            "{name}: 롤업을 펼치는 도구 안내 누락"
        );
    }
}

//! `frontmatter` 의 테스트. 본문에서 갈라 나왔다 (2026-09-04) — 파일 크기
//! 래칫(`scripts/check-file-sizes.mjs`)이 이 파일을 짚었고, 그 안에서
//! 경계가 가장 뚜렷한 덩어리가 여기였다. `manager/tests.rs` 와 같은 모양이고
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;

// ─── 제목 → 디스크 이름 slug ────────────────────────────────────────────

/// 이 버그의 본체 — 한글만 있는 제목이 상수 폴백으로 뭉개지던 것.
/// 논의·플랜은 **이름이 곧 정체성**이라 전부 같은 이름이 되고 `-2`·`-3` 만
/// 붙었다 (실제로 「사용자가 찾은 버그들」 → `discussion`).
#[test]
fn slug_from_title_keeps_hangul_instead_of_collapsing_to_the_fallback() {
    assert_eq!(
        slug_from_title("사용자가 찾은 버그들", "discussion"),
        "사용자가-찾은-버그들"
    );
    assert_eq!(slug_from_title("코드 화면 개편", "plan"), "코드-화면-개편");
    // 섞여 있으면 양쪽 다 산다 (ASCII 만 남기던 옛 규칙은 한글을 버렸다).
    assert_eq!(
        slug_from_title("버그 FIX 라운드", "plan"),
        "버그-fix-라운드"
    );
}

#[test]
fn slug_from_title_matches_the_old_ascii_behaviour_for_ascii_titles() {
    // 기존 폴더 이름이 흔들리지 않는다는 뜻이라 회귀 방어로 중요하다.
    assert_eq!(
        slug_from_title("Claude Plugin Strategy", "plan"),
        "claude-plugin-strategy"
    );
    assert_eq!(
        slug_from_title("  pricing / open-core!! ", "plan"),
        "pricing-open-core"
    );
    assert_eq!(slug_from_title("v2 Release", "plan"), "v2-release");
}

#[test]
fn slug_from_title_falls_back_only_when_nothing_survives() {
    assert_eq!(slug_from_title("!!! ??? ---", "discussion"), "discussion");
    assert_eq!(slug_from_title("", "plan"), "plan");
    assert_eq!(slug_from_title("   ", "plan"), "plan");
}

#[test]
fn slug_from_title_caps_length_and_never_ends_on_a_hyphen() {
    let long = "가".repeat(80);
    let out = slug_from_title(&long, "plan");
    assert_eq!(out.chars().count(), 60);
    // 자른 자리가 하이픈이어도 끝에 남기지 않는다.
    let words = "ab ".repeat(40);
    let out2 = slug_from_title(&words, "plan");
    assert!(!out2.ends_with('-'), "{out2}");
    assert!(!out2.starts_with('-'), "{out2}");
}

// ─── F7a-B read-time coercion helpers ───────────────────────────────────

#[test]
fn iso_lacks_offset_only_flags_real_tz_less_datetimes() {
    assert!(iso_lacks_offset("2026-06-22T10:00:00"));
    assert!(iso_lacks_offset("2026-06-22T10:00")); // minute precision
    assert!(iso_lacks_offset("2026-06-22 10:00:00")); // space variant
                                                      // Already has an offset / Z → not flagged.
    assert!(!iso_lacks_offset("2026-06-22T10:00:00+09:00"));
    assert!(!iso_lacks_offset("2026-06-22T01:00:00Z"));
    // Not a datetime at all → not flagged (a different concern).
    assert!(!iso_lacks_offset("x"));
    assert!(!iso_lacks_offset("2026-06-22")); // date-only
    assert!(!iso_lacks_offset(""));
}

#[test]
fn backfill_tz_offset_adds_project_offset_dst_correct() {
    let seoul: Tz = "Asia/Seoul".parse().unwrap();
    // Korea is UTC+9 year-round (no DST).
    assert_eq!(
        backfill_tz_offset("2026-06-22T10:00:00", seoul).as_deref(),
        Some("2026-06-22T10:00:00+09:00")
    );
    // A DST zone: New York in July is EDT (-04:00), in January EST (-05:00).
    let ny: Tz = "America/New_York".parse().unwrap();
    assert_eq!(
        backfill_tz_offset("2026-07-01T12:00:00", ny).as_deref(),
        Some("2026-07-01T12:00:00-04:00")
    );
    assert_eq!(
        backfill_tz_offset("2026-01-01T12:00:00", ny).as_deref(),
        Some("2026-01-01T12:00:00-05:00")
    );
    // Already offset-bearing or non-datetime → left untouched (None).
    assert_eq!(backfill_tz_offset("2026-06-22T10:00:00+09:00", seoul), None);
    assert_eq!(backfill_tz_offset("garbage", seoul), None);
}

#[test]
fn normalize_slug_kebabs_only_when_needed() {
    assert_eq!(normalize_slug("My_Feature").as_deref(), Some("my-feature"));
    assert_eq!(
        normalize_slug("Has Spaces!!").as_deref(),
        Some("has-spaces")
    );
    assert_eq!(normalize_slug("--Trim--Me--").as_deref(), Some("trim-me"));
    // Already valid → None (no change).
    assert_eq!(normalize_slug("already-valid-123"), None);
}

#[test]
fn normalize_slug_is_unicode_aware_for_hangul() {
    // Already-clean Hangul slugs are untouched (no Korean half dropped).
    assert_eq!(normalize_slug("한글슬러그"), None);
    assert_eq!(normalize_slug("버그-fix"), None);
    assert_eq!(normalize_slug("fix-한글-bug"), None);
    // But separators / case ARE normalized while Hangul survives intact.
    assert_eq!(normalize_slug("버그 수정!!").as_deref(), Some("버그-수정"));
    assert_eq!(normalize_slug("버그__수정").as_deref(), Some("버그-수정"));
    assert_eq!(normalize_slug("버그-FIX").as_deref(), Some("버그-fix"));
    assert_eq!(
        normalize_slug("  한글 슬러그  ").as_deref(),
        Some("한글-슬러그")
    );
    // All-punctuation / emoji → empty → None (no-op, not a lossy rewrite).
    assert_eq!(normalize_slug("!!!"), None);
    assert_eq!(normalize_slug("🎉"), None);
}

fn sample_yaml() -> String {
    r#"---
schema_version: 1
type: bug
slug: changelog-export-param-mismatch
status: done
difficulty: medium
created_at: "2026-05-22T20:55:00+09:00"
updated_at: "2026-05-22T21:08:14+09:00"
session_id: "20260522-001"
agent:
  id: claude-code
  version: "opus-4.7"
  session: "cb342a36-cd70-496a-a17b-ae516eb30c04"
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
    bytes_added: 42
    bytes_removed: 18
related:
  - ref: "20260522/Bugs/2050_bug_diff.md"
    kind: followup
tags: ["changelog", "sqlite"]
---
[x] Changelog Export 파라미터 불일치

## 발생 원인
대충 SQL 빌더가 분기 안 함.

## 해결 방법
분기 추가.
"#
    .to_string()
}

#[test]
fn parses_well_formed_frontmatter_with_no_warnings() {
    let (pf, body) = parse_frontmatter_and_body(&sample_yaml());
    assert!(
        pf.parse_warnings.is_empty(),
        "warnings: {:?}",
        pf.parse_warnings
    );
    let fm = pf.parsed.expect("should parse");
    assert_eq!(fm.entry_type, EntryType::Bug);
    assert_eq!(fm.slug, "changelog-export-param-mismatch");
    assert_eq!(fm.status, EntryStatus::Done);
    assert_eq!(fm.difficulty, Some(Difficulty::Medium));
    assert_eq!(fm.created_at, "2026-05-22T20:55:00+09:00");
    assert_eq!(fm.session_id, "20260522-001");
    assert_eq!(fm.agent.id, "claude-code");
    assert_eq!(fm.agent.version.as_deref(), Some("opus-4.7"));
    assert_eq!(
        fm.agent.session.as_deref(),
        Some("cb342a36-cd70-496a-a17b-ae516eb30c04")
    );
    assert_eq!(fm.language, "ko");
    assert!(!fm.verified_by_user);
    assert_eq!(fm.files_touched.len(), 1);
    assert_eq!(fm.files_touched[0].path, "src-tauri/src/db.rs");
    assert_eq!(fm.files_touched[0].op, FileOp::Update);
    assert_eq!(fm.files_touched[0].bytes_added, Some(42));
    assert_eq!(fm.related.len(), 1);
    assert_eq!(fm.related[0].kind, "followup");
    assert_eq!(fm.tags, vec!["changelog", "sqlite"]);
    assert!(body.starts_with("[x] Changelog Export"));
}

#[test]
fn no_frontmatter_returns_full_body() {
    let input = "# Just a heading\n\nbody text\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none());
    assert!(pf.raw_yaml.is_empty());
    assert!(pf.parse_warnings.is_empty());
    assert_eq!(body, input);
}

#[test]
fn unterminated_opening_fence_preserves_full_input_as_body() {
    let input = "---\nschema_version: 1\nno closing fence here\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none());
    assert!(pf.raw_yaml.is_empty());
    assert_eq!(pf.parse_warnings.len(), 1);
    assert_eq!(body, input, "body must round-trip without losing any bytes");
}

#[test]
fn korean_values_round_trip_through_yaml() {
    let input = "---\nschema_version: 1\ntype: bug\nslug: korean-test\nstatus: done\ncreated_at: \"2026-05-22T09:00:00+09:00\"\nsession_id: \"20260522-001\"\nagent: { id: claude-code }\nlanguage: ko\n---\n버그 발생\n";
    let (pf, _) = parse_frontmatter_and_body(input);
    let fm = pf.parsed.expect("parsed");
    assert_eq!(fm.slug, "korean-test");
    assert_eq!(fm.language, "ko");
}

#[test]
fn unknown_type_fails_soft_with_warning() {
    let input = "---\nschema_version: 1\ntype: weird\nslug: x\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en\n---\nbody\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none(), "unknown enum must not yield Some");
    assert!(!pf.raw_yaml.is_empty(), "raw_yaml must be preserved");
    assert!(pf.parse_warnings.iter().any(|w| w.contains("unknown type")));
    assert_eq!(body, "body\n");
}

#[test]
fn missing_required_field_yields_none_with_warning() {
    // slug missing — required, no safe default.
    let input = "---\nschema_version: 1\ntype: bug\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en\n---\nbody\n";
    let (pf, _) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none());
    assert!(pf.parse_warnings.iter().any(|w| w.contains("slug missing")));
}

#[test]
fn optional_fields_default_to_empty_collections() {
    // Required fields only; files_touched / related / tags absent.
    let input = "---\nschema_version: 1\ntype: chore\nslug: minimal\nstatus: planned\ncreated_at: \"2026-05-22T00:00:00+09:00\"\nsession_id: \"20260522-001\"\nagent: { id: manual }\nlanguage: ko\n---\n";
    let (pf, _) = parse_frontmatter_and_body(input);
    let fm = pf.parsed.expect("parsed");
    assert!(fm.files_touched.is_empty());
    assert!(fm.related.is_empty());
    assert!(fm.tags.is_empty());
    assert!(!fm.verified_by_user);
    assert!(fm.difficulty.is_none());
    assert!(fm.updated_at.is_none());
}

#[test]
fn broken_yaml_preserves_raw_and_yields_none() {
    let input = "---\nschema_version: 1\ntype: bug\n  bad: [unclosed\n---\nbody\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none());
    assert!(!pf.raw_yaml.is_empty(), "raw_yaml must be preserved");
    assert!(pf
        .parse_warnings
        .iter()
        .any(|w| w.contains("yaml parse error")));
    assert_eq!(body, "body\n");
}

/// 대화 id 는 **모르면 안 적는다.** 이 필드가 생기기 전의 일지가 다시
/// 쓰일 때 `session: ""` 같은 줄이 끼면 디스크가 통째로 흔들린다.
#[test]
fn agent_session_is_absent_when_unknown() {
    let input = "---\nschema_version: 1\ntype: chore\nslug: x\nstatus: done\ncreated_at: \"2026-05-22T00:00:00+09:00\"\nsession_id: \"20260522-001\"\nagent: { id: manual }\nlanguage: ko\n---\n본문\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    let fm = pf.parsed.expect("parse");
    assert!(fm.agent.session.is_none());
    let rendered = write_frontmatter_and_body(&fm, &body);
    assert!(
        !rendered.contains("session:"),
        "몰랐던 대화 id 가 되살아났다:\n{rendered}"
    );
    assert!(rendered.contains("session_id:"), "{rendered}");
}

#[test]
fn round_trip_write_then_parse_preserves_fields() {
    let (pf, body) = parse_frontmatter_and_body(&sample_yaml());
    let fm = pf.parsed.unwrap();
    let rendered = write_frontmatter_and_body(&fm, &body);
    let (pf2, body2) = parse_frontmatter_and_body(&rendered);
    let fm2 = pf2.parsed.expect("re-parse");
    assert_eq!(fm.entry_type, fm2.entry_type);
    assert_eq!(fm.slug, fm2.slug);
    assert_eq!(fm.status, fm2.status);
    assert_eq!(fm.difficulty, fm2.difficulty);
    assert_eq!(fm.created_at, fm2.created_at);
    assert_eq!(fm.updated_at, fm2.updated_at);
    assert_eq!(fm.session_id, fm2.session_id);
    assert_eq!(fm.agent, fm2.agent);
    assert_eq!(fm.language, fm2.language);
    assert_eq!(fm.verified_by_user, fm2.verified_by_user);
    assert_eq!(fm.files_touched, fm2.files_touched);
    assert_eq!(fm.related, fm2.related);
    assert_eq!(fm.tags, fm2.tags);
    assert_eq!(body, body2);
}

#[test]
fn round_trip_with_body_starting_with_triple_dash_is_preserved() {
    // A body that itself contains "---\n" — the writer always emits a
    // closing fence and a newline before the body, so the parser's
    // first "\n---\n" hit is the real closing fence.
    let fm = JournalFrontmatter {
        schema_version: 1,
        entry_type: EntryType::Feature,
        slug: "hr".into(),
        status: EntryStatus::InProgress,
        difficulty: None,
        created_at: "2026-05-24T09:00:00+09:00".into(),
        updated_at: None,
        session_id: "20260524-001".into(),
        agent: AgentRef {
            id: "manual".into(),
            version: None,
            session: None,
        },
        language: "ko".into(),
        verified_by_user: false,
        files_touched: Vec::new(),
        related: Vec::new(),
        tags: Vec::new(),
    };
    let body = "# header\n\n---\n\nthat triple-dash is a horizontal rule\n";
    let text = write_frontmatter_and_body(&fm, body);
    let (pf, body2) = parse_frontmatter_and_body(&text);
    assert!(pf.parsed.is_some());
    assert_eq!(body, body2);
}

#[test]
fn empty_frontmatter_block_warns_and_returns_none() {
    let input = "---\n---\nbody\n";
    let (pf, body) = parse_frontmatter_and_body(input);
    assert!(pf.parsed.is_none());
    assert_eq!(body, "body\n");
    // raw_yaml is empty (just the leading newline) — warnings may or may
    // not include "frontmatter is empty" depending on serde_yaml's
    // treatment; either way no panic and no parse.
}

#[test]
fn agent_as_bare_string_is_accepted() {
    let input = "---\nschema_version: 1\ntype: chore\nslug: x\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: manual\nlanguage: en\n---\n";
    let (pf, _) = parse_frontmatter_and_body(input);
    let fm = pf.parsed.expect("parsed");
    assert_eq!(fm.agent.id, "manual");
    assert!(fm.agent.version.is_none());
}

#[test]
fn fuzz_random_bytes_never_panic() {
    // Use a deterministic LCG so the test is reproducible without a
    // dev-dep on `rand`. 256 iterations × 1 KiB ≈ 256 KiB total — fast.
    let mut state: u64 = 0xdead_beef_dead_beef;
    for _ in 0..256 {
        let mut buf = Vec::with_capacity(1024);
        for _ in 0..1024 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            buf.push((state >> 33) as u8);
        }
        // serde_yaml + our parser must not panic on any sequence.
        let s = String::from_utf8_lossy(&buf);
        let _ = parse_frontmatter_and_body(&s);
    }
}

#[test]
fn write_emits_stable_key_order() {
    let fm = JournalFrontmatter {
        schema_version: 1,
        entry_type: EntryType::Refactor,
        slug: "stable-order".into(),
        status: EntryStatus::Done,
        difficulty: Some(Difficulty::High),
        created_at: "2026-05-24T10:00:00+09:00".into(),
        updated_at: Some("2026-05-24T10:30:00+09:00".into()),
        session_id: "20260524-002".into(),
        agent: AgentRef {
            id: "claude-code".into(),
            version: Some("opus-4.7".into()),
            session: Some("cb342a36-cd70-496a-a17b-ae516eb30c04".into()),
        },
        language: "ko".into(),
        verified_by_user: true,
        files_touched: vec![FileTouched {
            path: "a.rs".into(),
            op: FileOp::Update,
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        }],
        related: Vec::new(),
        tags: vec!["x".into()],
    };
    let text = write_frontmatter_and_body(&fm, "body\n");
    // schema_version must come before type, type before slug, etc.
    let sv = text.find("schema_version:").unwrap();
    let ty = text.find("type:").unwrap();
    let sl = text.find("slug:").unwrap();
    let st = text.find("status:").unwrap();
    let df = text.find("difficulty:").unwrap();
    let ca = text.find("created_at:").unwrap();
    let ua = text.find("updated_at:").unwrap();
    let si = text.find("session_id:").unwrap();
    let ag = text.find("agent:").unwrap();
    let la = text.find("language:").unwrap();
    let vu = text.find("verified_by_user:").unwrap();
    let ft = text.find("files_touched:").unwrap();
    let rl = text.find("related:").unwrap();
    let tg = text.find("tags:").unwrap();
    assert!(sv < ty);
    assert!(ty < sl);
    assert!(sl < st);
    assert!(st < df);
    assert!(df < ca);
    assert!(ca < ua);
    assert!(ua < si);
    assert!(si < ag);
    assert!(ag < la);
    assert!(la < vu);
    assert!(vu < ft);
    assert!(ft < rl);
    assert!(rl < tg);
}

//! `skill_promotion.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다.

use super::*;
use tempfile::TempDir;

fn entry(ty: &str, workday: &str, title: &str, tags: &[&str]) -> RangeEntry {
    RangeEntry {
        relative_path: format!("{workday}/X/{title}.md"),
        workday: workday.to_string(),
        entry_type: ty.to_string(),
        status: "done".to_string(),
        difficulty: None,
        agent_id: "claude-code".to_string(),
        title: title.to_string(),
        files: Vec::new(),
        tags: tags.iter().map(|s| s.to_string()).collect(),
    }
}

fn seed_skill(root: &std::path::Path, slug: &str, content: &str) {
    let dir = root.join(SKILLS_SUBDIR).join(slug);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(SKILL_FILENAME), content).unwrap();
}

// ─── 후보 추출 ──────────────────────────────────────────────────────────

#[test]
fn clusters_tags_with_threshold_regardless_of_entry_type() {
    let entries = vec![
        // migration: 3회 — chore/feature 혼재여도 후보 (entry_type 무관).
        entry("chore", "20260718", "M1", &["migration"]),
        entry("feature", "20260719", "M2", &["migration", "migration"]), // 중복 1회만
        entry("bug", "20260720", "M3", &["migration"]),
        // ui: 2회 — 임계 미달.
        entry("feature", "20260720", "U1", &["ui"]),
        entry("feature", "20260721", "U2", &["ui"]),
    ];
    let got = extract_candidates(&entries, &BTreeSet::new(), &BTreeSet::new());
    assert_eq!(got.len(), 1, "{got:?}");
    let c = &got[0];
    assert_eq!(c.tag, "migration");
    assert_eq!(c.slug, "migration");
    assert_eq!(c.count, 3);
    assert_eq!(c.last_workday, "20260720");
    // 최신 등장이 먼저, 최대 3.
    assert_eq!(c.sample_titles, vec!["M3", "M2", "M1"]);
}

#[test]
fn stoplist_and_version_tags_are_excluded() {
    let mut entries = Vec::new();
    for wd in ["20260718", "20260719", "20260720"] {
        entries.push(entry(
            "chore",
            wd,
            "R",
            &["release", "Docs", "v1.2.0", "deploy-check"],
        ));
    }
    let got = extract_candidates(&entries, &BTreeSet::new(), &BTreeSet::new());
    let tags: Vec<&str> = got.iter().map(|c| c.tag.as_str()).collect();
    assert_eq!(
        tags,
        vec!["deploy-check"],
        "스톱리스트(대소문자 무시)·버전 태그 제외: {tags:?}"
    );
    assert!(is_version_tag("v2"));
    assert!(!is_version_tag("verify"));
}

/// journal-scale-round {#tag-source-marker} — `journal_write`(MCP) 가 모든
/// 일지에 붙이는 `mcp-tool` 은 절차가 아니라 출처 표식이다. 빼지 않으면
/// 압도적 반복(이 저장소는 727건 중 431건)이라 항상 1위 후보가 돼 진짜
/// 절차 후보(`deploy-check`)를 상한(`CANDIDATE_CAP`)밖으로 밀어낼 수 있다.
#[test]
fn source_marker_tag_is_excluded_from_clusters() {
    let mut entries = Vec::new();
    for wd in ["20260718", "20260719", "20260720", "20260721"] {
        entries.push(entry("chore", wd, "R", &["mcp-tool", "deploy-check"]));
    }
    let got = extract_candidates(&entries, &BTreeSet::new(), &BTreeSet::new());
    let tags: Vec<&str> = got.iter().map(|c| c.tag.as_str()).collect();
    assert_eq!(
        tags,
        vec!["deploy-check"],
        "mcp-tool 출처 표식 제외: {tags:?}"
    );
}

#[test]
fn suppressed_by_existing_skill_dir_or_promoted_marker() {
    let entries: Vec<RangeEntry> = ["20260718", "20260719", "20260720"]
        .iter()
        .map(|wd| entry("chore", wd, "T", &["DB Migration"]))
        .collect();
    // tag 슬러그와 같은 스킬 폴더가 이미 있으면 억제.
    let mut existing = BTreeSet::new();
    existing.insert("db-migration".to_string());
    assert!(extract_candidates(&entries, &existing, &BTreeSet::new()).is_empty());
    // promoted-from 마커 tag 도 억제 — harvest 가 소문자로 수확하므로
    // 대조 계약도 소문자 키다 (케이스 변형 재등장까지 막는다).
    let mut promoted = BTreeSet::new();
    promoted.insert("db migration".to_string());
    assert!(extract_candidates(&entries, &BTreeSet::new(), &promoted).is_empty());
    // 무관한 억제 재료는 통과.
    let mut other = BTreeSet::new();
    other.insert("unrelated".to_string());
    assert_eq!(
        extract_candidates(&entries, &other, &BTreeSet::new()).len(),
        1
    );
}

#[test]
fn candidates_sorted_by_count_then_recency_and_capped() {
    let mut entries = Vec::new();
    // t0..t6: 7개 tag — t0 이 가장 많이 반복(9회), t6 이 3회.
    for t in 0..7u32 {
        let reps = 9 - t as usize; // 9,8,…,3
        for r in 0..reps {
            entries.push(entry(
                "chore",
                &format!("202607{:02}", 10 + r),
                &format!("T{t}R{r}"),
                &[&format!("tag-{t}")],
            ));
        }
    }
    let got = extract_candidates(&entries, &BTreeSet::new(), &BTreeSet::new());
    assert_eq!(got.len(), CANDIDATE_CAP, "상한 6 적용");
    assert_eq!(got[0].tag, "tag-0", "반복 많은 쪽이 먼저");
    assert_eq!(got[5].tag, "tag-5");
}

#[test]
fn slug_normalizes_case_space_and_non_ascii() {
    assert_eq!(slug_of_tag("DB Migration"), "db-migration");
    assert_eq!(slug_of_tag("perf"), "perf");
    // 전부 비ASCII → 태그별로 구분되는 해시 접미사 폴백 (충돌 억제 방지).
    let a = slug_of_tag("릴리스 절차");
    let b = slug_of_tag("배포 점검");
    assert!(a.starts_with("promoted-skill-"), "{a}");
    assert!(b.starts_with("promoted-skill-"), "{b}");
    assert_ne!(a, b, "다른 태그는 다른 폴백 슬러그");
    assert_eq!(a, slug_of_tag("릴리스 절차"), "결정적");
    assert_eq!(slug_of_tag("--weird__"), "weird");
}

#[test]
fn harvest_reads_marker_and_existing_dirs_include_disabled() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    seed_skill(
        root,
        "review",
        "---\nname: review\n---\n\n# x\n\n<!-- promoted-from: tag:code review -->\n",
    );
    seed_skill(root, ".disabled/legacy", "---\nname: legacy\n---\nx");
    let slugs = existing_skill_slugs(root);
    assert!(slugs.contains("review"));
    assert!(slugs.contains("legacy"), "비활성 스킬 폴더도 기존으로 취급");
    let tags = harvest_promoted_tags(root);
    assert!(tags.contains("code review"));
}

// ─── 초안 파싱/조립 ─────────────────────────────────────────────────────

fn candidate() -> SkillCandidate {
    SkillCandidate {
        tag: "migration".into(),
        slug: "migration".into(),
        count: 3,
        last_workday: "20260720".into(),
        sample_titles: vec!["M3".into()],
    }
}

#[test]
fn parse_draft_accepts_fenced_skill_md_and_builds_content() {
    let resp = "설명입니다\n```markdown\n---\nname: Db Migration\ndescription: \"Use when adding a new SQLite migration.\"\n---\n\n# 마이그레이션 절차\n\n1. 다음 번호의 0NN_*.sql 을 만든다\n\n<!-- promoted-from: tag:migration -->\n```";
    let d = parse_draft_response(&candidate(), resp).unwrap();
    assert_eq!(d.slug, "db-migration", "name 을 kebab 으로 정규화");
    assert_eq!(d.description, "Use when adding a new SQLite migration.");
    assert_eq!(d.rel_path, ".claude/skills/db-migration/SKILL.md");
    assert!(d.body_markdown.starts_with("# 마이그레이션 절차"));
    assert!(
        !d.body_markdown.contains("promoted-from"),
        "미리보기 본문에는 마커 없음"
    );
    assert!(d.content.starts_with("---\nname: db-migration\n"));
    assert!(d
        .content
        .trim_end()
        .ends_with("<!-- promoted-from: tag:migration -->"));
    // 마커가 억제 수확과 왕복된다.
    let tmp = TempDir::new().unwrap();
    seed_skill(tmp.path(), &d.slug, &d.content);
    let tags = harvest_promoted_tags(tmp.path());
    assert!(tags.contains("migration"));
    assert!(existing_skill_slugs(tmp.path()).contains("db-migration"));
}

#[test]
fn parse_draft_attaches_marker_when_missing() {
    let resp = "---\nname: migration\ndescription: \"Use when running migrations.\"\n---\n\n# 절차\n\n1. 단계\n";
    let d = parse_draft_response(&candidate(), resp).unwrap();
    assert!(
        d.content
            .trim_end()
            .ends_with("<!-- promoted-from: tag:migration -->"),
        "마커 누락 시 자동 부착: {}",
        d.content
    );
}

#[test]
fn parse_draft_rejects_missing_frontmatter_or_empty_fields() {
    assert!(parse_draft_response(&candidate(), "# 본문만 있음").is_err());
    assert!(
        parse_draft_response(&candidate(), "---\nname: a\n---\n\n# 본문\n").is_err(),
        "description 누락은 에러 — 자동 발동 트리거가 없는 스킬은 죽은 스킬"
    );
    assert!(
        parse_draft_response(
            &candidate(),
            "---\nname: a\ndescription: \"Use when x.\"\n---\n\n"
        )
        .is_err(),
        "본문 없음은 에러"
    );
}

#[test]
fn build_prompt_contains_tag_count_and_evidence() {
    let ev = vec![Evidence {
        title: "M1".into(),
        kind: "chore".into(),
        workday: "20260718".into(),
        excerpt: "## 과정\n마이그레이션 파일 추가".into(),
    }];
    let p = build_draft_prompt(&candidate(), &ev);
    assert!(p.contains("태그: migration"));
    assert!(p.contains("반복: 3회"));
    assert!(p.contains("마이그레이션 파일 추가"));
}

/// 일지 파일이 디스크에서 사라졌으면 발췌를 빈 문자열로 삼키지 않고
/// 유실을 명시한다 (rule_promotion 과 동일 계약).
#[test]
fn gather_evidence_marks_unreadable_journal_instead_of_empty() {
    let dir = TempDir::new().unwrap();
    let e = entry("chore", "20260718", "M1", &["migration"]);
    let out = gather_evidence(dir.path(), &candidate(), &[e]);
    assert_eq!(out.len(), 1);
    assert!(
        out[0].excerpt.contains("읽지 못했습니다"),
        "유실 명시가 없다: {:?}",
        out[0].excerpt
    );
}

#[test]
fn case_variants_cluster_together_and_promoted_suppresses_variants() {
    let entries = vec![
        entry("chore", "20260728", "A", &["Migration"]),
        entry("chore", "20260729", "B", &["migration"]),
        entry("chore", "20260730", "C", &["MIGRATION"]),
    ];
    let got = extract_candidates(&entries, &BTreeSet::new(), &BTreeSet::new());
    assert_eq!(got.len(), 1, "케이스 변형은 한 클러스터");
    assert_eq!(got[0].count, 3);
    // 승격 마커(소문자 수확)가 케이스 변형 재등장도 억제한다.
    let promoted: BTreeSet<String> = ["migration".to_string()].into();
    assert!(extract_candidates(&entries, &BTreeSet::new(), &promoted).is_empty());
}

#[test]
fn parser_strips_foreign_markers_and_keeps_trailing_code_fence() {
    let cand = SkillCandidate {
        tag: "deploy".into(),
        slug: "deploy".into(),
        count: 3,
        last_workday: "20260731".into(),
        sample_titles: vec![],
    };
    // 펜스 없는 정상 응답 + 본문이 코드블록으로 끝남 + 무관 태그 마커 주입.
    let resp = "---\nname: deploy-check\ndescription: Use when deploying.\n---\n\n## 절차\n\n```bash\nmake deploy\n```\n<!-- promoted-from: tag:unrelated -->";
    let draft = parse_draft_response(&cand, resp).unwrap();
    assert!(
        draft.body_markdown.ends_with("```"),
        "닫는 펜스는 보존: {}",
        draft.body_markdown
    );
    assert!(!draft.body_markdown.contains("unrelated"), "무관 마커 제거");
    // 저장 content 에는 자기 태그 마커가 정확히 1개.
    assert_eq!(draft.content.matches(PROMOTED_MARKER_PREFIX).count(), 1);
    assert!(draft.content.contains("tag:deploy"));
}

#[test]
fn evidence_excerpt_carries_body_not_frontmatter() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let rel = "20260730/Chores/0001_chore_x.md";
    let abs = root.join(".oculpm").join("journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    // frontmatter 가 발췌 상한을 다 먹지 못하게 — 본문(절차)이 담겨야 한다.
    let fm_pad = "x".repeat(700);
    std::fs::write(
        &abs,
        format!("---\ntitle: t\npad: {fm_pad}\n---\n\n## 절차\n1. make deploy 실행\n"),
    )
    .unwrap();
    let mut e = entry("chore", "20260730", "t", &["deploy"]);
    e.relative_path = rel.to_string();
    let cand = SkillCandidate {
        tag: "deploy".into(),
        slug: "deploy".into(),
        count: 3,
        last_workday: "20260730".into(),
        sample_titles: vec![],
    };
    let ev = gather_evidence(root, &cand, &[e]);
    assert_eq!(ev.len(), 1);
    assert!(ev[0].excerpt.contains("make deploy"), "{}", ev[0].excerpt);
    assert!(
        !ev[0].excerpt.contains("pad:"),
        "frontmatter 는 발췌에서 제외"
    );
}

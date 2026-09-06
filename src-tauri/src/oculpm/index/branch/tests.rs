//! `branch.rs` 의 단위 테스트 — git 도 DB 도 없이 도는 것만.
//!
//! `index/mod.rs` + `index/tests.rs` 와 같은 갈래다. 파싱과 귀속 판정은 순수
//! 함수라 여기서 전부 못 박히고, git 을 부르는 얇은 층만 밖에 남는다.

use super::*;

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn row(rel: &str, workday: &str, files: &[&str]) -> RangeEntry {
    RangeEntry {
        relative_path: rel.to_string(),
        workday: workday.to_string(),
        entry_type: "feature".to_string(),
        status: "done".to_string(),
        difficulty: None,
        agent_id: "claude-code".to_string(),
        title: "t".to_string(),
        files: files.iter().map(|s| s.to_string()).collect(),
        tags: Vec::new(),
    }
}

#[test]
fn parses_for_each_ref_and_marks_current() {
    let text = "feat/x\x1fabc123def\x1f1788665203\x1f*\x1fsubject one\n\
                main\x1fdef456abc\x1f1788600000\x1f \x1fsubject two\n\
                broken-line\n";
    let refs = parse_branch_refs(text);
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0].name, "feat/x");
    assert!(refs[0].is_current);
    assert_eq!(refs[0].short_sha, "abc123d");
    assert!(!refs[1].is_current);
}

#[test]
fn parses_log_with_name_status_and_counts_journals() {
    let text = "\x1esha1\x1fKim\x1f1788665203\x1f20260906\x1fsubject\x1f\n\
                M\tsrc/a.rs\n\
                A\t.oculpm/journal/20260906/Features/x.md\n\
                \x1esha2\x1fKim\x1f1788600000\x1f20260905\x1fother\x1f\n\
                R100\told.rs\tnew.rs\n";
    let (commits, files) = parse_log_name_status(text);
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].file_count, 2);
    assert_eq!(commits[0].journal_count, 1);
    assert_eq!(commits[0].workday, "20260906");
    // 이름 바꿈은 새 경로로 잡힌다 — 옛 경로는 목록에 없다.
    assert!(files.contains_key("new.rs"));
    assert!(!files.contains_key("old.rs"));
}

#[test]
fn porcelain_takes_the_new_path_of_a_rename() {
    let out = parse_porcelain(" M src/a.rs\n?? notes.md\nR  old.rs -> new.rs\n");
    assert!(out.contains("src/a.rs"));
    assert!(out.contains("notes.md"));
    assert!(out.contains("new.rs"));
    assert!(!out.contains("old.rs"));
}

#[test]
fn journal_rel_paths_strips_the_prefix() {
    let changed = set(&[
        ".oculpm/journal/20260906/Features/x.md",
        ".oculpm/planner/v3-surface.md",
        "src/a.rs",
    ]);
    let rels = journal_rel_paths(&changed);
    assert_eq!(rels.len(), 1);
    assert!(rels.contains("20260906/Features/x.md"));
}

#[test]
fn window_covers_commits_and_direct_entries_with_a_days_padding() {
    let (since, until) = workday_window(
        &["20260905".to_string()],
        &set(&["20260901/Bugs/a.md"]),
        "20260906",
        false,
    );
    assert_eq!(since, "20260831");
    assert_eq!(until, "20260906");
}

#[test]
fn window_falls_back_to_today_when_there_is_nothing() {
    let (since, until) = workday_window(&[], &BTreeSet::new(), "20260906", false);
    assert_eq!(since, "20260905");
    assert_eq!(until, "20260907");
}

#[test]
fn attribution_prefers_the_entry_file_over_file_overlap() {
    let rows = vec![
        row("20260906/Features/x.md", "20260906", &["src/a.rs"]),
        row("20260906/Bugs/y.md", "20260906", &["src/b.rs"]),
        row("20260906/Chores/z.md", "20260906", &["docs/unrelated.md"]),
    ];
    let direct = set(&["20260906/Features/x.md"]);
    let changed = set(&["src/a.rs", "src/b.rs"]);
    let out = attribute_entries(&rows, &direct, &changed);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].link, BranchLink::Entry);
    assert_eq!(out[0].matched_files, 1);
    assert_eq!(out[1].link, BranchLink::Files);
    // 겹치는 파일도 없고 파일도 없는 일지는 브랜치에 붙지 않는다.
    assert!(out
        .iter()
        .all(|e| e.relative_path != "20260906/Chores/z.md"));
}

#[test]
fn plan_links_match_by_suffix_and_dedupe() {
    let rows = vec![
        (
            ".oculpm/journal/20260906/Features/x.md".to_string(),
            "v3-surface".to_string(),
            "기둥 2".to_string(),
            "branch-index".to_string(),
            "인덱스에 브랜치 축".to_string(),
            "done".to_string(),
        ),
        // 같은 항목의 두 번째 갱신 — 한 번만 나온다.
        (
            "20260906/Features/x.md".to_string(),
            "v3-surface".to_string(),
            "기둥 2".to_string(),
            "branch-index".to_string(),
            "인덱스에 브랜치 축".to_string(),
            "done".to_string(),
        ),
        // 이 브랜치에 없는 일지 — 버린다.
        (
            "20260101/Bugs/other.md".to_string(),
            "old".to_string(),
            "옛 플랜".to_string(),
            "z".to_string(),
            "무관".to_string(),
            "todo".to_string(),
        ),
    ];
    let items = join_plan_links(&rows, &["20260906/Features/x.md".to_string()]);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].item_id, "branch-index");
    assert_eq!(items[0].journal_ref, "20260906/Features/x.md");
}

#[test]
fn files_drop_the_ledger_and_sort_by_weight() {
    let g = BranchGit {
        commit_files: [
            ("src/a.rs".to_string(), 3u32),
            (".oculpm/journal/x.md".to_string(), 1),
        ]
        .into_iter()
        .collect(),
        dirty_files: set(&["src/b.rs"]),
        ..Default::default()
    };
    let recorded = set(&["src/a.rs"]);
    let files = build_files(&g, &recorded);
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "src/a.rs");
    assert_eq!(files[0].commits, 3);
    assert!(files[0].recorded);
    assert_eq!(files[1].path, "src/b.rs");
    assert!(files[1].uncommitted);
    assert!(!files[1].recorded);
}

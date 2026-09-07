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
    let (commits, files) = parse_log_name_status(text, &noop_rebase);
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
    let out = parse_porcelain(
        " M src/a.rs\n?? notes.md\nR  old.rs -> new.rs\n",
        &noop_rebase,
    );
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

/// 저장소 루트 == 프로젝트 루트인 흔한 경우 — 경로가 그대로다.
fn noop_rebase(p: &str) -> Option<String> {
    Some(p.to_string())
}

/// `RepoNesting` 을 손으로 세워 되맞춤 closure 를 만든다. 진짜 git 저장소가
/// 필요 없다 — 파서가 무엇을 받는지만 물으면 되기 때문이다.
fn rebase_for(nest: (RepoNesting, Option<&str>)) -> impl Fn(&str) -> Option<String> {
    let nest = (nest.0, nest.1.map(str::to_string));
    move |raw: &str| crate::git::nesting::rebase(&nest, raw)
}

const ONE_COMMIT: &str = "\x1esha1\x1fKim\x1f1788665203\x1f20260906\x1fsubject\x1f\n\
                          M\tsrc/a.rs\n";

#[test]
fn repo_below_the_project_root_gets_the_prefix_added() {
    // `.oculpm/` 이 저장소 **위**에 있는 배치: 프로젝트 루트 `/p`, 저장소 `/p/app`.
    // git 이 주는 `src/a.rs` 는 프로젝트 기준으로 `app/src/a.rs` 다. 되맞추지
    // 않으면 `Files` 귀속이 조용히 0건이 된다 ({#branch-axis-limits}).
    let rebase = rebase_for((RepoNesting::RepoBelowRoot, Some("app")));
    let (_commits, files) = parse_log_name_status(ONE_COMMIT, &rebase);
    assert!(files.contains_key("app/src/a.rs"), "되맞춘 경로: {files:?}");
    assert!(!files.contains_key("src/a.rs"));

    let dirty = parse_porcelain(" M src/a.rs\n", &rebase);
    assert!(dirty.contains("app/src/a.rs"));
}

#[test]
fn project_root_inside_a_bigger_repo_gets_the_prefix_stripped() {
    // 반대 방향 — 흔한 모노레포: 저장소 `/mono`, 프로젝트 `/mono/apps/web`.
    // git 은 `apps/web/src/a.rs` 를 주는데 일지는 `src/a.rs` 로 적는다. 3차까지
    // 이 방향은 아예 손대지 않고 지나갔다 ({#rebase-other-direction}).
    let rebase = rebase_for((RepoNesting::RootInsideRepo, Some("apps/web")));
    let text = "\x1esha1\x1fKim\x1f1788665203\x1f20260906\x1fsubject\x1f\n\
                M\tapps/web/src/a.rs\nM\tapps/api/main.go\n";
    let (commits, files) = parse_log_name_status(text, &rebase);
    assert!(files.contains_key("src/a.rs"), "떼어 낸 경로: {files:?}");
    assert!(!files.contains_key("apps/web/src/a.rs"));
    // 프로젝트 **밖** 파일은 목록에서도 파일 수에서도 빠진다 — 남의 저장소
    // 분량으로 기록률의 분모가 부풀면 그 숫자가 거짓이 된다.
    assert!(!files.contains_key("apps/api/main.go"));
    assert_eq!(commits[0].file_count, 1);

    let dirty = parse_porcelain(" M apps/web/src/b.rs\n M apps/api/x.go\n", &rebase);
    assert_eq!(dirty, set(&["src/b.rs"]));
}

#[test]
fn journal_evidence_survives_the_strip_direction() {
    // 이 방향에서는 `.oculpm/` 이 저장소 **안**에 있어 `Entry` 근거가 살아
    // 있다. 되맞춤이 빠지면 그 근거까지 함께 죽었다.
    let rebase = rebase_for((RepoNesting::RootInsideRepo, Some("apps/web")));
    let text = "\x1esha1\x1fKim\x1f1788665203\x1f20260906\x1fsubject\x1f\n\
                A\tapps/web/.oculpm/journal/20260906/Features/x.md\n";
    let (commits, files) = parse_log_name_status(text, &rebase);
    assert_eq!(commits[0].journal_count, 1);
    assert_eq!(
        journal_rel_paths(&files.keys().cloned().collect()),
        set(&["20260906/Features/x.md"])
    );
}

//! `journal_search` · `journal_read` — 무엇을 찾고 어디를 짚는지.

use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// 규격대로 생긴 일지 1건을 디스크에 놓는다 (journal_write 를 거치지 않고
/// 직접 — 과거 workday 와 깨진 frontmatter 까지 만들 수 있어야 한다).
fn seed_entry(root: &Path, workday: &str, folder: &str, file: &str, md: &str) {
    let dir = root
        .join(".oculpm")
        .join("journal")
        .join(workday)
        .join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(file), md).unwrap();
}

fn entry_md(
    entry_type: &str,
    slug: &str,
    status: &str,
    title: &str,
    body: &str,
    files: &[&str],
    tags: &[&str],
) -> String {
    let files_yaml = files
        .iter()
        .map(|p| format!("  - path: \"{p}\"\n    op: update\n"))
        .collect::<String>();
    let tags_yaml = tags.join(", ");
    format!(
        "---\nschema_version: 1\ntype: {entry_type}\nslug: {slug}\nstatus: {status}\n\
         created_at: \"2026-07-01T10:00:00+09:00\"\nsession_id: \"manual-1\"\n\
         agent:\n  id: claude-code\n  version: opus\nlanguage: ko\n\
         verified_by_user: false\nfiles_touched:\n{files_yaml}related: []\n\
         tags: [{tags_yaml}]\n---\n\n[x] {title}\n\n{body}\n"
    )
}

fn seed_corpus(root: &Path) {
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    seed_entry(
        root,
        "20260701",
        "Bugs",
        "0900_bug_cache-invalidation.md",
        &entry_md(
            "bug",
            "cache-invalidation",
            "done",
            "캐시 무효화가 안 되던 것",
            "## 발생 원인\n\n키를 정규화하지 않았다.\n\n## 해결 방법\n\n정규화 후 조회.",
            &["src/oculpm/cache.rs"],
            &["cache", "sqlite"],
        ),
    );
    seed_entry(
        root,
        "20260815",
        "Features_to_add",
        "1400_feature_watcher-events.md",
        &entry_md(
            "feature",
            "watcher-events",
            "done",
            "워처 이벤트 추가",
            "## 추가 기능\n\n파일 변경을 프런트에 알린다.",
            &["src/oculpm/watcher.rs", "src/lib.rs"],
            &["watcher"],
        ),
    );
    seed_entry(
        root,
        "20260820",
        "Chores",
        "1100_chore_docs-tidy.md",
        &entry_md(
            "chore",
            "docs-tidy",
            "in_progress",
            "문서 정리",
            "README 를 손봤다.",
            &[],
            &["docs"],
        ),
    );
}

fn hit_paths(out: &Value) -> Vec<String> {
    out["hits_tsv"]
        .as_str()
        .unwrap()
        .lines()
        .skip(1) // 헤더
        .map(|l| l.split('\t').next().unwrap().to_string())
        .collect()
}

#[test]
fn journal_search_finds_by_body_and_reports_where_it_matched() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_corpus(root);

    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "query": "정규화" }),
    )
    .unwrap();
    assert_eq!(out["total_matched"], 1);
    assert_eq!(
        hit_paths(&out),
        vec!["20260701/Bugs/0900_bug_cache-invalidation.md"]
    );
    let why = out["hits_tsv"].as_str().unwrap().lines().nth(1).unwrap();
    assert!(
        why.contains("정규화"),
        "본문 매치는 발췌를 실어야 한다: {why}"
    );
    // 발췌는 TSV 한 칸이므로 탭·줄바꿈이 없어야 한다.
    assert_eq!(why.split('\t').count(), 6, "열 수가 어긋났다: {why}");
}

#[test]
fn journal_search_by_touched_file_is_the_precise_filter() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_corpus(root);

    // 파일명만으로도 잡힌다 (에이전트가 전체 경로를 모를 때).
    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "file": "watcher.rs" }),
    )
    .unwrap();
    assert_eq!(
        hit_paths(&out),
        vec!["20260815/Features_to_add/1400_feature_watcher-events.md"]
    );
    assert!(
        out["hits_tsv"]
            .as_str()
            .unwrap()
            .contains("file:src/oculpm/watcher.rs"),
        "어느 파일로 걸렸는지 밝혀야 한다"
    );

    // 건드린 파일이 없는 일지는 file 필터에 걸리지 않는다.
    let none = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "file": "README" }),
    )
    .unwrap();
    assert_eq!(none["total_matched"], 0);
    assert!(
        none["note"].is_string(),
        "빈 결과는 다음 수를 알려줘야 한다"
    );
}

#[test]
fn journal_search_filters_compose_and_return_newest_first() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_corpus(root);

    // 필터 없이 = 전부, 최신순.
    let all = call_tool(root, "journal_search", &serde_json::json!({})).unwrap();
    assert_eq!(all["total_matched"], 3);
    assert_eq!(
        hit_paths(&all),
        vec![
            "20260820/Chores/1100_chore_docs-tidy.md",
            "20260815/Features_to_add/1400_feature_watcher-events.md",
            "20260701/Bugs/0900_bug_cache-invalidation.md",
        ]
    );

    // 종류 + 기간 + 상태 + 태그가 AND 로 겹친다.
    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "types": ["feature", "chore"], "since": "20260810" }),
    )
    .unwrap();
    assert_eq!(out["total_matched"], 2);

    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "status": ["in_progress"] }),
    )
    .unwrap();
    assert_eq!(
        hit_paths(&out),
        vec!["20260820/Chores/1100_chore_docs-tidy.md"]
    );

    // tags 는 AND — 둘 다 가진 일지만.
    let both = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "tags": ["cache", "sqlite"] }),
    )
    .unwrap();
    assert_eq!(both["total_matched"], 1);
    let neither = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "tags": ["cache", "watcher"] }),
    )
    .unwrap();
    assert_eq!(neither["total_matched"], 0);
}

/// 부분 일치는 짧은 ASCII 질의에서 우연히 걸린다 (실측: "IME" 가 본문의
/// `mtime`·`time` 에). 최신순으로만 자르면 그 소음이 진짜 히트를 limit
/// 밖으로 밀어낸다 — 매치 강도가 recency 를 이겨야 한다.
#[test]
fn journal_search_ranks_strong_matches_above_incidental_body_hits() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    // 최신 — 본문에 `mtime` 이 있어 "ime" 에 우연히 걸린다.
    seed_entry(
        root,
        "20260820",
        "Chores",
        "1000_chore_noise.md",
        &entry_md(
            "chore",
            "noise",
            "done",
            "캐시 정리",
            "mtime 을 비교한다.",
            &[],
            &[],
        ),
    );
    // 그보다 오래됐지만 제목에 그 말이 있다.
    seed_entry(
        root,
        "20260610",
        "Bugs",
        "0900_bug_terminal-ime.md",
        &entry_md(
            "bug",
            "terminal-ime",
            "done",
            "터미널 IME 입력 깨짐",
            "본문.",
            &[],
            &[],
        ),
    );
    // 그보다도 오래됐고 태그로 걸린다.
    seed_entry(
        root,
        "20260601",
        "Bugs",
        "0900_bug_tagged.md",
        &entry_md(
            "bug",
            "tagged",
            "done",
            "무관한 제목",
            "본문.",
            &[],
            &["ime"],
        ),
    );

    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "query": "ime" }),
    )
    .unwrap();
    assert_eq!(out["total_matched"], 3, "셋 다 부분 일치로 걸린다");
    assert_eq!(
        hit_paths(&out),
        vec![
            "20260610/Bugs/0900_bug_terminal-ime.md", // 제목
            "20260601/Bugs/0900_bug_tagged.md",       // 태그
            "20260820/Chores/1000_chore_noise.md",    // 본문(우연) — 최신인데도 꼴찌
        ],
        "매치 강도가 recency 를 이겨야 한다"
    );

    // limit 이 1이면 살아남는 것은 최신이 아니라 가장 강한 매치다.
    let top = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "query": "ime", "limit": 1 }),
    )
    .unwrap();
    assert_eq!(
        hit_paths(&top),
        vec!["20260610/Bugs/0900_bug_terminal-ime.md"]
    );
    assert_eq!(
        top["total_matched"], 3,
        "잘라도 몇 건인지는 정확히 알려준다"
    );
}

#[test]
fn journal_search_caps_hits_but_counts_them_all() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    for i in 0..8 {
        seed_entry(
            root,
            "20260801",
            "Bugs",
            &format!("09{i:02}_bug_many-{i}.md"),
            &entry_md(
                "bug",
                &format!("many-{i}"),
                "done",
                "반복 버그",
                "본문",
                &[],
                &[],
            ),
        );
    }
    let out = call_tool(root, "journal_search", &serde_json::json!({ "limit": 3 })).unwrap();
    assert_eq!(out["returned"], 3, "실린 것은 limit 까지");
    assert_eq!(
        out["total_matched"], 8,
        "센 것은 전부 — 더 있다는 걸 알아야 한다"
    );
    assert_eq!(out["more"], true);
}

/// frontmatter 가 깨진 일지도 검색에 잡혀야 한다 — 오히려 그런 것이 잊힌다.
#[test]
fn journal_search_still_finds_entries_with_broken_frontmatter() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    seed_entry(
        root,
        "20260805",
        "Bugs",
        "0800_bug_broken.md",
        "---\nthis: is: not: yaml:\n---\n\n[x] 망가진 일지\n\n터미널 IME 문제.\n",
    );
    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "query": "IME" }),
    )
    .unwrap();
    assert_eq!(out["total_matched"], 1);
    // 파일명 토큰이 종류를 메운다.
    assert!(out["hits_tsv"].as_str().unwrap().contains("\tbug\t"));
}

#[test]
fn journal_read_returns_body_and_rejects_escapes() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_corpus(root);

    // journal_search 가 주는 형태 그대로.
    let out = call_tool(
        root,
        "journal_read",
        &serde_json::json!({ "path": "20260701/Bugs/0900_bug_cache-invalidation.md" }),
    )
    .unwrap();
    assert_eq!(out["title"], "캐시 무효화가 안 되던 것");
    assert_eq!(out["type"], "bug");
    assert_eq!(out["status"], "done");
    assert!(out["body_markdown"]
        .as_str()
        .unwrap()
        .contains("키를 정규화하지"));
    assert_eq!(out["files_touched"][0], "src/oculpm/cache.rs");

    // `.oculpm/journal/` 접두사가 붙어 있어도 같은 결과.
    let same = call_tool(
        root,
        "journal_read",
        &serde_json::json!({ "path": ".oculpm/journal/20260701/Bugs/0900_bug_cache-invalidation.md" }),
    )
    .unwrap();
    assert_eq!(same["title"], out["title"]);

    // 경로 탈출은 거부 — 이 문자열은 에이전트가 준 값이다.
    for bad in ["../../../etc/passwd", "../../config.toml", "/etc/hosts", ""] {
        assert!(
            call_tool(root, "journal_read", &serde_json::json!({ "path": bad })).is_err(),
            "탈출 경로를 받아들였다: {bad}"
        );
    }
    // 없는 일지는 조용히 빈 값이 아니라 오류.
    assert!(call_tool(
        root,
        "journal_read",
        &serde_json::json!({ "path": "20260701/Bugs/nope.md" })
    )
    .is_err());
}

#[test]
fn journal_search_masks_secrets_in_snippets() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    // 전체 설정을 쓴다 — `OculpmConfig::load` 는 부분 TOML 을 거부하고
    // 조용히 기본값으로 폴백하므로, 반쪽 파일로는 이 테스트가 패턴 없이
    // 통과해 버린다 (실제로 그렇게 한 번 새 나갔다).
    std::fs::write(
        root.join(".oculpm/config.toml"),
        "schema_version = 1\n[workday]\ntimezone = \"Asia/Seoul\"\nday_starts_at = \"00:00\"\n[session]\ninactivity_timeout_minutes = 30\nauto_close_on_workday_boundary = true\nauto_close_on_app_quit = true\ncrash_recovery_grace_minutes = 5\n[git]\njournal_committed = true\nforbid_journal_for_paths = []\nauto_redact_patterns = [\"sk-[A-Za-z0-9]+\"]\n[watcher]\nignore = []\nrespect_gitignore = true\ndebounce_ms = 500\nbatch_max_events = 200\n[agents]\nactive = []\nauto_detect_on_open = false\nauto_sync_adapters = false\n",
    )
    .unwrap();
    seed_entry(
        root,
        "20260810",
        "Chores",
        "1200_chore_leak.md",
        &entry_md(
            "chore",
            "leak",
            "done",
            "설정 정리",
            "예전 키 sk-ABCDEFGH12345 를 지웠다.",
            &[],
            &[],
        ),
    );
    let out = call_tool(
        root,
        "journal_search",
        &serde_json::json!({ "query": "예전 키" }),
    )
    .unwrap();
    let tsv = out["hits_tsv"].as_str().unwrap();
    assert!(
        !tsv.contains("sk-ABCDEFGH12345"),
        "발췌로 시크릿이 샜다: {tsv}"
    );

    let read = call_tool(
        root,
        "journal_read",
        &serde_json::json!({ "path": "20260810/Chores/1200_chore_leak.md" }),
    )
    .unwrap();
    assert!(!read["body_markdown"]
        .as_str()
        .unwrap()
        .contains("sk-ABCDEFGH12345"));
}

#[test]
fn path_prefilter_helpers_read_the_naming_convention() {
    assert_eq!(
        workday_of_rel("20260821/Bugs/1842_bug_a.md"),
        Some("20260821")
    );
    assert_eq!(workday_of_rel("notaday/Bugs/a.md"), None);
    assert_eq!(
        type_token_of_rel("20260821/Bugs/1842_bug_a.md"),
        Some("bug")
    );
    assert_eq!(
        type_token_of_rel("20260821/Features_to_add/1000_feature_a.md"),
        Some("feature")
    );
    // 규약을 안 지킨 이름은 None → 호출자가 파일을 읽어 판정한다.
    assert_eq!(type_token_of_rel("20260821/Bugs/freeform.md"), None);

    assert_eq!(normalize_entry_rel(".oculpm/journal/x/y.md"), "x/y.md");
    assert_eq!(normalize_entry_rel("journal/x/y.md"), "x/y.md");
    assert_eq!(normalize_entry_rel("  x/y.md  "), "x/y.md");
    assert!(is_safe_entry_rel("20260821/Bugs/a.md"));
    assert!(!is_safe_entry_rel("../a.md"));
    assert!(!is_safe_entry_rel("a.txt"));
    assert!(!is_safe_entry_rel("20260821/.hidden/a.md"));
}

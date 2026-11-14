//! `journal_search` 의 「남은 파일」 칸과 뒤로 보내기 ({#search-alive}).
//!
//! 판정은 `journal_search::alive` — 여기서는 도구의 응답이 그것을 어떻게 싣는지와,
//! 캐시 경로와 디스크 경로가 같은 답을 내는지를 문다.

use super::search::{cache_of, hit_paths, seed_entry};
use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// `(경로, op)` 로 파일 칸을 적는 일지 — `search.rs` 의 `entry_md` 는 op 가 늘 update 다.
fn entry(slug: &str, title: &str, files: &[(&str, &str)]) -> String {
    let files_yaml = if files.is_empty() {
        "files_touched: []\n".to_string()
    } else {
        let rows: String = files
            .iter()
            .map(|(p, op)| format!("  - path: \"{p}\"\n    op: {op}\n"))
            .collect();
        format!("files_touched:\n{rows}")
    };
    format!(
        "---\nschema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\n\
         created_at: \"2026-07-01T10:00:00+09:00\"\nsession_id: \"manual-1\"\n\
         agent:\n  id: claude-code\n  version: opus\nlanguage: ko\n\
         verified_by_user: false\n{files_yaml}related: []\ntags: []\n---\n\n[x] {title}\n\n본문.\n"
    )
}

/// 프로젝트에 실제 파일을 놓는다 — 「남아 있다」의 유일한 근거다.
fn keep(root: &Path, rel: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, "x").unwrap();
}

/// 헤더를 뺀 줄들의 `files` 칸.
fn files_cells(out: &Value) -> Vec<String> {
    out["hits_tsv"]
        .as_str()
        .unwrap()
        .lines()
        .skip(1)
        .map(|l| l.split('\t').nth(4).unwrap().to_string())
        .collect()
}

/// 셋 다 제목에 「워처」가 걸린다. 최신순이면 gone → none → kept 이다.
fn seed_mixed(root: &Path) {
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    keep(root, "src/watcher.rs");
    seed_entry(
        root,
        "20260701",
        "Bugs",
        "0900_bug_kept.md",
        &entry(
            "kept",
            "워처 고침",
            &[("src/watcher.rs", "update"), ("src/old.rs", "update")],
        ),
    );
    seed_entry(
        root,
        "20260801",
        "Bugs",
        "0900_bug_none.md",
        &entry("none", "워처 문서", &[]),
    );
    seed_entry(
        root,
        "20260901",
        "Bugs",
        "0900_bug_gone.md",
        &entry("gone", "워처 옛 화면", &[("src/pty_host.rs", "update")]),
    );
}

#[test]
fn entries_whose_files_are_all_gone_go_last_and_say_so() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_mixed(root);

    let out = journal_search_with(root, &serde_json::json!({ "query": "워처" }), None).unwrap();
    assert_eq!(
        hit_paths(&out),
        vec![
            "20260801/Bugs/0900_bug_none.md",
            "20260701/Bugs/0900_bug_kept.md",
            "20260901/Bugs/0900_bug_gone.md",
        ],
        "가장 최근 일지라도 건드린 파일이 하나도 없으면 뒤로 간다"
    );
    assert_eq!(files_cells(&out), vec!["-", "1/2", "0/1"]);
    assert_eq!(out["gone_last"], 1);
    assert!(out["note"].as_str().unwrap().contains("1건"));
    assert!(out["hits_tsv"]
        .as_str()
        .unwrap()
        .starts_with("path\tdate\ttype\tst\tfiles\ttitle\twhy"));
}

#[test]
fn when_every_hit_is_gone_the_order_is_left_alone() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    for (day, slug) in [("20260701", "a"), ("20260801", "b")] {
        seed_entry(
            root,
            day,
            "Bugs",
            &format!("0900_bug_{slug}.md"),
            &entry(slug, "터미널 호스트", &[("src/pty_host.rs", "update")]),
        );
    }
    let out = journal_search_with(root, &serde_json::json!({ "query": "호스트" }), None).unwrap();
    assert_eq!(
        hit_paths(&out),
        vec!["20260801/Bugs/0900_bug_b.md", "20260701/Bugs/0900_bug_a.md"]
    );
    assert_eq!(files_cells(&out), vec!["0/1", "0/1"]);
    assert!(
        out.get("gone_last").is_none(),
        "걷어낸 것을 찾는 중이면 뒤로 보낼 것이 없다"
    );
}

/// 「걷어냈다」는 일지는 그 파일이 없는 것이 정상이다 — 결정의 기록을 낡았다고 하지 않는다.
#[test]
fn deleted_and_renamed_files_are_not_counted_as_missing() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    keep(root, "src/lib.rs");
    seed_entry(
        root,
        "20260701",
        "Bugs",
        "0900_bug_removal.md",
        &entry(
            "removal",
            "트레이 걷음",
            &[("src/tray.rs", "delete"), ("src/lib.rs", "update")],
        ),
    );
    seed_entry(
        root,
        "20260702",
        "Bugs",
        "0900_bug_only-delete.md",
        &entry(
            "only-delete",
            "트레이 남은 파일 지움",
            &[("src/tray_menu.rs", "delete"), ("src/a.rs", "rename")],
        ),
    );
    let out = journal_search_with(root, &serde_json::json!({ "query": "트레이" }), None).unwrap();
    assert_eq!(files_cells(&out), vec!["-", "1/1"]);
    assert!(out.get("gone_last").is_none());
}

/// 윈도우에서 쓴 일지의 `\` 경로, 프로젝트 밖 · 기록 폴더 안의 경로.
#[test]
fn backslash_paths_count_and_paths_outside_the_project_do_not() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    keep(root, "src/win.rs");
    seed_entry(
        root,
        "20260701",
        "Bugs",
        "0900_bug_win.md",
        &entry(
            "win",
            "윈도우 경로",
            &[
                ("src\\\\win.rs", "update"),
                ("../elsewhere.rs", "update"),
                (".oculpm/planner/p.md", "update"),
            ],
        ),
    );
    let out = journal_search_with(root, &serde_json::json!({ "query": "윈도우" }), None).unwrap();
    assert_eq!(files_cells(&out), vec!["1/1"]);
}

/// 앱이 켜져 있든 아니든 같은 순서 · 같은 칸.
#[tokio::test]
async fn the_cache_path_gives_the_same_files_column_and_order() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed_mixed(root);
    keep(root, "src/lib.rs");
    seed_entry(
        root,
        "20260702",
        "Bugs",
        "0900_bug_removal.md",
        &entry(
            "removal",
            "워처 옛 파일 걷음",
            &[("src/old_watcher.rs", "delete"), ("src/lib.rs", "update")],
        ),
    );
    let (_db, handle) = cache_of(root).await;
    for args in [
        serde_json::json!({ "query": "워처" }),
        serde_json::json!({}),
        serde_json::json!({ "query": "워처", "limit": 2 }),
    ] {
        let disk = journal_search_with(root, &args, None).unwrap();
        let cached = journal_search_with(root, &args, Some(&handle)).unwrap();
        assert_eq!(cached["source"], "cache");
        assert_eq!(cached["hits_tsv"], disk["hits_tsv"], "{args}");
        assert_eq!(cached["gone_last"], disk["gone_last"], "{args}");
        assert_eq!(cached["note"], disk["note"], "{args}");
    }
}

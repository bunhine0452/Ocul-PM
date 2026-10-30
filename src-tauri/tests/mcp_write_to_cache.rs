//! 약속 1·6 (docs/PROMISE.md) 의 경계 테스트 — **MCP 로 쓴 일지가 디스크를 거쳐
//! 앱 캐시 질의에 선다.**
//!
//! 지금까지의 테스트는 두 조각을 따로 봤다: `journal_create_two_process` 는
//! MCP `journal_write` 가 파일을 규격대로 쓰는지, `journal_page_limit` 는 손으로
//! 쓴 파일이 `JournalCache` 에 들어가는지. 그 사이 — **MCP 가 쓴 바로 그 파일을
//! 캐시가 읽어 같은 slug·제목·태그로 돌려주는가** — 를 묶어 본 테스트는 없었다.
//! 외부 리뷰가 찾은 결함(v3.2.0 · v3.8.0 · v3.9.0)은 전부 이런 경계에서 났다.
//!
//! 한 프로세스 안에서 `call_tool` → `reindex_full` → `list_entries` 를 잇는다.
//! 워처는 끼지 않는다 (그건 `watcher_backpressure` 가 본다) — 여기서 묻는 것은
//! "MCP 가 만든 파일의 모양을 캐시 파서가 그대로 받아들이는가" 하나다.

use std::path::{Path, PathBuf};

use ocul_pm_lib::db::Db;
use ocul_pm_lib::oculpm::cache::{EntryFilters, JournalCache};
use ocul_pm_lib::oculpm::mcp::tools::call_tool;
use ocul_pm_lib::oculpm::spec::EntryType;
use serde_json::json;

/// `.oculpm/` 만 있으면 MCP 는 이 자리를 추적 프로젝트로 읽는다 (설정은 기본값).
fn fresh_project() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    (dir, root)
}

fn journal_root(root: &Path) -> PathBuf {
    root.join(".oculpm").join("journal")
}

#[tokio::test]
async fn an_mcp_written_entry_reaches_the_cache_query_unchanged() {
    let (_dir, root) = fresh_project();

    // 1. MCP 가 쓴다 — 에이전트가 실제로 보내는 인자 모양 그대로.
    let out = call_tool(
        &root,
        "journal_write",
        &json!({
            "type": "feature",
            "slug": "promise-boundary-write",
            "title": "캐시: 경계 테스트가 쓴 일지",
            "body_markdown": "## 추가 기능\nMCP → 디스크 → 캐시.\n\n## 검증\n이 테스트.\n",
            "tags": ["polish", "boundary"],
            "files_touched": [{"path": "src/a.rs", "op": "update"}],
            "agent_id": "claude-code-term-34061",
            "agent_version": "claude-opus-5[1m]"
        }),
    )
    .expect("journal_write ok");
    let rel = out["path"].as_str().expect("response.path").to_string();
    assert!(
        rel.starts_with(".oculpm/journal/"),
        "응답 path 는 프로젝트 루트 기준 상대경로여야 한다 (plan_update 의 journal_path 가 그대로 받는다): {rel}"
    );
    assert!(
        root.join(&rel).is_file(),
        "응답이 가리키는 파일이 디스크에 있어야 한다"
    );

    // 2. 캐시가 디스크를 읽는다 — 앱이 프로젝트를 열 때 도는 것과 같은 전체 재색인.
    let db = Db::open(root.join("test.db")).await.expect("open db");
    let cache = JournalCache::new(&db);
    let report = cache
        .reindex_full(1, &journal_root(&root))
        .await
        .expect("reindex_full");
    assert_eq!(
        report.parse_errors, 0,
        "MCP 가 쓴 frontmatter 를 캐시 파서가 거부하면 일지는 화면에서 사라진다"
    );
    assert_eq!(report.inserted, 1);

    // 3. 질의 — 화면이 쓰는 그 함수. 같은 slug · 제목 · 종류 · 에이전트가 나와야 한다.
    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .expect("list_entries");
    assert_eq!(rows.len(), 1, "일지 한 건이 캐시 질의에 서야 한다");
    let row = &rows[0];
    assert_eq!(row.slug, "promise-boundary-write");
    assert_eq!(row.title, "캐시: 경계 테스트가 쓴 일지");
    assert_eq!(row.entry_type, EntryType::Feature);
    // 캐시 표면은 표준형(`model_names`), 디스크는 에이전트가 적은 그대로.
    assert_eq!(row.agent_id, "claude-code");
    assert_eq!(row.agent_version.as_deref(), Some("Opus 5 (1M)"));
    let on_disk = std::fs::read_to_string(root.join(&rel)).unwrap();
    assert!(on_disk.contains("claude-code-term-34061") && on_disk.contains("claude-opus-5[1m]"));
    assert!(
        rel.ends_with(&row.relative_path),
        "캐시의 relative_path({})는 MCP 응답 path({rel})의 꼬리여야 한다",
        row.relative_path
    );
}

#[tokio::test]
async fn a_second_write_is_one_more_row_not_a_rewrite() {
    let (_dir, root) = fresh_project();
    for i in 0..2 {
        call_tool(
            &root,
            "journal_write",
            &json!({
                "type": "chore",
                "slug": format!("boundary-{i}"),
                "title": format!("일지: {i}번째"),
                "body_markdown": "## 변경 요약\n둘째 줄.\n\n## 검증\n테스트.\n"
            }),
        )
        .expect("journal_write ok");
    }

    let db = Db::open(root.join("test.db")).await.expect("open db");
    let cache = JournalCache::new(&db);
    cache
        .reindex_full(1, &journal_root(&root))
        .await
        .expect("reindex_full");
    let n = cache.count_entries(1).await.expect("count");
    assert_eq!(n, 2, "같은 분에 쓴 두 일지가 서로를 덮어쓰면 안 된다");
}

//! 일지 목록의 상한 (`{#journal-timeline-limit}`).
//!
//! 타임라인의 전체 기간 조회에는 상한이 없었다. 검색창 한 글자 또는 범위 칩
//! 한 번이면 14일 창과 날짜 접기가 **동시에** 풀리고, 그 뒤로 전 이력(이
//! 저장소 기준 537건)이 통째로 넘어와 가상화 없는 화면이 그만큼의 카드를
//! 마운트했다.
//!
//! 여기서 무는 것은 그 상한의 계약 둘이다: 실제로 자르는가, 그리고 **몇 건
//! 중 몇 건인지** 말할 수 있는가 (`total` 은 상한을 걸기 **전** 건수여야 하고,
//! 목록과 **같은 조건**을 봐야 한다).

use std::path::Path;

use ocul_pm_lib::db::Db;
use ocul_pm_lib::oculpm::cache::{EntryFilters, EntryPage, JournalCache};

fn write_entry(journal_root: &Path, rel: &str, created_at: &str, title: &str) {
    let abs = journal_root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let frontmatter = format!(
        "schema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ndifficulty: medium\n\
         created_at: \"{created_at}\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\n\
         language: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\ntags: [\"alpha\"]",
        slug = rel
            .rsplit('/')
            .next()
            .unwrap()
            .trim_end_matches(".md")
            .replace('_', "-"),
    );
    std::fs::write(
        abs,
        format!("---\n{frontmatter}\n---\n[x] {title}\n\n## body\n"),
    )
    .unwrap();
}

/// 같은 워크데이에 5건. `created_at` 이 서로 달라 정렬이 결정적이다.
async fn seeded() -> (Db, tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("test.db")).await.expect("open db");
    let journal_root = dir.path().join("journal");
    for i in 0..5 {
        write_entry(
            &journal_root,
            &format!("20260524/Bugs/09{i}0_bug_a{i}.md"),
            &format!("2026-05-24T09:{i}0:00+09:00"),
            &format!("Title {i}"),
        );
    }
    JournalCache::new(&db)
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    (db, dir, journal_root)
}

#[tokio::test]
async fn a_page_caps_the_rows_and_still_reports_the_full_count() {
    let (db, _dir, _root) = seeded().await;
    let cache = JournalCache::new(&db);
    let filters = EntryFilters::default();

    let (first, total) = cache
        .list_entries_page(
            1,
            None,
            &filters,
            EntryPage {
                limit: 2,
                offset: 0,
            },
        )
        .await
        .unwrap();
    assert_eq!(total, 5, "total 은 상한을 걸기 전 전체 건수여야 한다");
    assert_eq!(first.len(), 2, "limit 이 실제로 잘라야 한다");

    let (second, _) = cache
        .list_entries_page(
            1,
            None,
            &filters,
            EntryPage {
                limit: 2,
                offset: 2,
            },
        )
        .await
        .unwrap();

    // 이어붙인 두 쪽은 상한 없는 목록의 앞부분과 **같은 순서로** 같아야 한다 —
    // 겹치지도, 빠지지도 않는다.
    let all = cache.list_entries(1, None, &filters).await.unwrap();
    let paged: Vec<&str> = first
        .iter()
        .chain(second.iter())
        .map(|e| e.relative_path.as_str())
        .collect();
    let expected: Vec<&str> = all
        .iter()
        .take(4)
        .map(|e| e.relative_path.as_str())
        .collect();
    assert_eq!(paged, expected);
}

/// 개수와 목록이 **같은 조건**을 본다 — 아니면 "5건 중 2건"이 거짓말이 된다.
#[tokio::test]
async fn the_total_honours_the_same_filters_as_the_rows() {
    let (db, _dir, _root) = seeded().await;
    let cache = JournalCache::new(&db);

    let filters = EntryFilters {
        search: Some("Title 3".into()),
        ..Default::default()
    };
    let (rows, total) = cache
        .list_entries_page(
            1,
            None,
            &filters,
            EntryPage {
                limit: 50,
                offset: 0,
            },
        )
        .await
        .unwrap();
    assert_eq!(total, 1);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "Title 3");
}

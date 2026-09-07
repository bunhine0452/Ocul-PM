//! 고유 파일 수 — `COUNT(DISTINCT file_path)` (v3-release `{#distinct-files-backend}`).
//!
//! `tests.rs` 옆에 따로 둔 이유는 `agent_session_tests.rs` 와 같다: 저쪽은 파일
//! 크기 래칫에 "더 늘리지만 마라"로 묶여 있어 새 주제를 얹을 자리가 없다.
//! 이름이 `..._tests.rs` 인 것도 같은 이유 — 유출 원장 스캐너가 파일명 꼬리로
//! 테스트를 가른다.

use super::*;
use crate::db::Db;
use std::fs;
use tempfile::tempdir;

async fn fresh_db() -> (Db, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let db = Db::open(db_path).await.expect("open db");
    (db, dir)
}

fn write_entry(root: &Path, rel: &str, frontmatter: &str, body: &str) {
    let abs = root.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    fs::write(&abs, format!("---\n{frontmatter}\n---\n{body}")).unwrap();
}

/// 고유 파일 수는 겹침을 한 번만 센다 (v3-release `{#distinct-files-backend}`).
///
/// 프런트가 엔트리 상세를 걷어 합집합을 만들던 것을 SQL 로 옮긴 자리다. 옛
/// 셈(`Σ files_count`)과 갈라지는 지점을 못 박는다: 세 일지가 파일 4개를 6번
/// 만지면 「변경된 파일」은 4 이지 6 이 아니다.
#[tokio::test]
async fn distinct_file_count_dedupes_overlapping_entries() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");

    let fm = |slug: &str, paths: &[&str]| {
        let files = paths
            .iter()
            .map(|p| format!("  - path: \"{p}\"\n    op: update"))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "schema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n{files}\ntags: []"
        )
    };
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &fm("a", &["src/x.rs", "src/y.rs"]),
        "[x] A\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/0930_bug_b.md",
        &fm("b", &["src/y.rs", "src/z.rs", "src/w.rs"]),
        "[x] B\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/0935_bug_c.md",
        &fm("c", &["src/x.rs"]),
        "[x] C\n",
    );
    // 다른 날은 섞이지 않는다.
    write_entry(
        &journal_root,
        "20260525/Bugs/0925_bug_d.md",
        &fm("d", &["src/other.rs"]),
        "[x] D\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    // 터치 6회, 고유 4개.
    let touches: u32 = cache
        .list_entries(1, Some("20260524"), &EntryFilters::default())
        .await
        .unwrap()
        .iter()
        .map(|e| e.files_count)
        .sum();
    assert_eq!(touches, 6);
    assert_eq!(
        cache.count_files_for_workday(1, "20260524").await.unwrap(),
        4
    );
    // `files_for_workday` 와 같은 자료를 세는지 — 둘이 갈라지면 하나는 거짓말이다.
    assert_eq!(
        cache.files_for_workday(1, "20260524").await.unwrap().len(),
        4
    );
    assert_eq!(
        cache.count_files_for_workday(1, "20260525").await.unwrap(),
        1
    );
    // 엔트리가 없는 날은 0 (오류가 아니다).
    assert_eq!(
        cache.count_files_for_workday(1, "20260526").await.unwrap(),
        0
    );
    // 다른 프로젝트로는 새지 않는다.
    assert_eq!(
        cache.count_files_for_workday(2, "20260524").await.unwrap(),
        0
    );
}

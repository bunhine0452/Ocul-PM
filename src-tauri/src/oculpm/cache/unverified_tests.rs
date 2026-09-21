//! review-queue round `{#review-queue}` — `EntryFilters::unverified_only`.
//!
//! `tests.rs` 옆에 따로 둔 이유는 `agent_session_tests.rs` · `distinct_files_tests.rs`
//! 와 같다: 저쪽은 파일 크기 래칫에 "더 늘리지만 마라"로 묶여 있어 새 주제를
//! 얹을 자리가 없다. 이름이 `..._tests.rs` 인 것도 같은 이유 — 유출 원장
//! 스캐너가 파일명 꼬리로 테스트를 가른다.

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

fn write_entry(root: &Path, rel: &str, frontmatter: &str, body: &str) -> PathBuf {
    let abs = root.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    fs::write(&abs, format!("---\n{frontmatter}\n---\n{body}")).unwrap();
    abs
}

fn standard_frontmatter(slug: &str) -> String {
    format!(
        "schema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ndifficulty: medium\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\ntags: [\"alpha\", \"beta\"]"
    )
}

/// `unverified_only` 는 `verified_only` 의 정반대다 — 한 번도 확인되지 않은
/// 행과, 확인 뒤 본문이 바뀌어 다시 검토가 필요한(`verified_stale`) 행 둘 다
/// 대기열에 남아야 한다.
#[tokio::test]
async fn list_entries_unverified_only_includes_stale_verified() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    // 해시가 실려야 재투영이 `verified_stale` 를 계산한다 — 없으면 「옛 일지」
    // 취급으로 늘 거짓이다 (`verified_stale` 의 문서 주석).
    let original_body = "[x] V\n";
    let verified_fm = standard_frontmatter("v").replace(
        "language: ko",
        &format!(
            "language: ko\nverified_by_user: true\nverified_hash: \"{}\"",
            verified_body_hash(original_body)
        ),
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_v.md",
        &verified_fm,
        original_body,
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1030_bug_u.md",
        &standard_frontmatter("u"),
        "[x] U\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    // 확인된 일지의 본문을 확인 뒤 바꿔 `verified_stale` 를 세운다 — 재투영이
    // `verified_hash` 와 지금 본문 해시를 비교해 다시 계산한다.
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_v.md",
        &verified_fm,
        "[x] V 본문이 바뀌었다\n",
    );
    cache
        .apply_path_change(
            1,
            &journal_root,
            "20260524/Bugs/0925_bug_v.md",
            PathChangeKind::Modified,
        )
        .await
        .unwrap();

    let rows = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                unverified_only: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    // 한 번도 확인되지 않은 "u" 와, 확인 뒤 바뀌어 다시 검토가 필요한 "v" 둘 다
    // 대기열에 남아야 한다 — `verified_only` 의 정반대.
    let mut slugs: Vec<_> = rows.iter().map(|r| r.slug.as_str()).collect();
    slugs.sort();
    assert_eq!(slugs, vec!["u", "v"]);
}

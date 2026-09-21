//! review-queue round `{#review-queue}` — `set_journal_verified_bulk`.
//!
//! `tests.rs` 옆에 따로 둔 이유는 `tests_verified.rs` 와 같다: 저쪽은 파일
//! 크기 래칫에 "더 늘리지만 마라"로 묶여 있어 새 주제를 얹을 자리가 없다.

use super::*;
use crate::db::Db;

async fn fresh_manager_and_db() -> (OculpmManager, Db, tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db"))
        .await
        .expect("open db");
    let manager = OculpmManager::new();
    let project_root = dir.path().join("project");
    std::fs::create_dir_all(&project_root).unwrap();
    manager.init_project(7, &project_root, "ko").await.unwrap();
    (manager, db, dir, project_root)
}

/// 에이전트가 쓴 것처럼 디스크에 직접 놓는다 (`tests_verified.rs` 와 같은
/// 모양 — 수동 작성 경로는 `verified_by_user: true` 기본값이 끼어든다).
fn put_agent_entry(project_root: &Path, rel: &str, slug: &str, body: &str) {
    let abs = project_root.join(".oculpm/journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let content = format!(
        "---\nschema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\n---\n{body}"
    );
    std::fs::write(&abs, content).unwrap();
}

/// review-queue round — `set_journal_verified_bulk` reuses the single-entry
/// path per path: good paths update, a broken one lands in `skipped` with a
/// reason, and the batch does not abort on the first failure.
#[tokio::test]
async fn set_journal_verified_bulk_updates_good_paths_and_reports_skips() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let rel_a = "20260524/Bugs/0000_bug_a.md";
    let rel_b = "20260524/Bugs/0001_bug_b.md";
    put_agent_entry(&project_root, rel_a, "bulk-a", "[x] agent did A\n");
    put_agent_entry(&project_root, rel_b, "bulk-b", "[x] agent did B\n");
    manager.reindex_journal_cache(&db, 7).await.unwrap();

    let broken_rel = "20260524/Bugs/0002_bug_broken.md";
    let abs = project_root.join(".oculpm/journal").join(broken_rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(
        &abs,
        "---\nschema_version: 1\ntype: bug\n  bad: [unclosed\n---\n[x] body\n",
    )
    .unwrap();

    let report = manager
        .set_journal_verified_bulk(
            &db,
            7,
            vec![rel_a.to_string(), rel_b.to_string(), broken_rel.to_string()],
            true,
        )
        .await
        .unwrap();

    assert_eq!(report.updated, 2);
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.skipped[0].path, broken_rel);
    assert!(
        report.skipped[0].reason.contains("broken frontmatter"),
        "got: {}",
        report.skipped[0].reason
    );

    let fresh_a = manager
        .get_journal_entry(&db, 7, rel_a.to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(fresh_a.frontmatter.verified_by_user);
    let fresh_b = manager
        .get_journal_entry(&db, 7, rel_b.to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(fresh_b.frontmatter.verified_by_user);
}

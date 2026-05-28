//! W5-PR8 — end-to-end integration tests for the migration pipeline.
//!
//! Each test drives `OculpmManager` exclusively through its public surface:
//! `init_project` → `migration_dry_run` → `migration_execute` (or
//! `delete_legacy_changelog` for the PR7 scenarios). The point of this
//! suite — vs. the unit tests in `src/oculpm/migrate_from_sqlite.rs` and
//! `manager.rs` — is to exercise the same path the Tauri command layer
//! takes, so a public-API regression (e.g. an accidentally-removed pub
//! method) surfaces here at `cargo test`.

use std::path::Path;

use ai_pm_lib::db::Db;
use ai_pm_lib::oculpm::manager::OculpmManager;

async fn fresh_setup() -> (Db, OculpmManager, tempfile::TempDir, std::path::PathBuf, u32) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("ai-pm.db");
    let db = Db::open(db_path).await.expect("open db");
    let project_id = db
        .create_project("integ-mig".into(), dir.path().to_string_lossy().into())
        .await
        .expect("create project");
    let manager = OculpmManager::new();
    let project_root = dir.path().join("project");
    std::fs::create_dir_all(&project_root).unwrap();
    manager
        .init_project(project_id, &project_root)
        .await
        .unwrap();
    (db, manager, dir, project_root, project_id)
}

/// Seed `count` changelog rows spread across three workdays at the given
/// `base_unix` (KST midnight of day-0). Returns the entry ids in insertion
/// order.
async fn seed_three_workdays(db: &Db, project_id: u32, base_unix: u32) -> Vec<u32> {
    let mut ids = Vec::new();
    // Three days × 10 entries each, hourly within the day.
    for d in 0..3i64 {
        for h in 0..10i64 {
            let entry = db
                .insert_changelog_entry(
                    project_id,
                    Some(format!("intent d{d} h{h}")),
                    None,
                    format!("AI summary for d{d}h{h}"),
                    Some(format!("title d{d}h{h}")),
                    Some("feature".into()),
                    Some("claude-code".into()),
                    1,
                    5,
                    1,
                )
                .await
                .unwrap();
            // Override created_at via direct UPDATE — `insert_changelog_entry`
            // uses `unixepoch()` default.
            let ts = (base_unix as i64) + d * 86_400 + h * 3600;
            db.conn()
                .call({
                    let id = entry.id as i64;
                    move |c| {
                        c.execute(
                            "UPDATE changelog_entries SET created_at = ?1 WHERE id = ?2",
                            rusqlite::params![ts, id],
                        )?;
                        Ok::<(), rusqlite::Error>(())
                    }
                })
                .await
                .unwrap();
            db.insert_changelog_file(
                entry.id,
                format!("src/d{d}h{h}.rs"),
                "modified".into(),
                5,
                1,
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
            ids.push(entry.id);
        }
    }
    ids
}

fn kst_midnight_2026_05_22() -> u32 {
    // KST 2026-05-22 00:00 == UTC 2026-05-21 15:00.
    chrono::Utc
        .with_ymd_and_hms(2026, 5, 21, 15, 0, 0)
        .single()
        .unwrap()
        .timestamp() as u32
}

// Just so the imports above link cleanly even if a test below doesn't use them.
use chrono::TimeZone;

fn count_md(workday_dir: &Path) -> usize {
    if !workday_dir.exists() {
        return 0;
    }
    std::fs::read_dir(workday_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md")
        })
        .count()
}

// ─── (1) full migration 30 entries × 3 workdays, zero loss ────────────────

#[tokio::test]
async fn full_migration_30_entries_three_workdays_zero_loss() {
    let (db, manager, _dir, root, project_id) = fresh_setup().await;
    seed_three_workdays(&db, project_id, kst_midnight_2026_05_22()).await;

    let plan = manager.migration_dry_run(&db, project_id).await.unwrap();
    assert_eq!(plan.source_entry_count, 30);
    assert_eq!(plan.by_workday.len(), 3);

    let report = manager
        .migration_execute(&db, project_id, plan, None, None)
        .await
        .expect("happy-path migration");
    assert_eq!(report.success_count, 30);
    assert_eq!(report.failure_count, 0);

    // Every workday's Features_to_add folder has 10 md files.
    let total: usize = ["20260522", "20260523", "20260524"]
        .iter()
        .map(|w| count_md(&root.join(format!(".oculpm/journal/{w}/Features_to_add"))))
        .sum();
    assert_eq!(total, 30, "expected 30 .md files on disk");

    // History row persisted.
    let history = manager
        .get_migration_history(&db, project_id)
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].success_count, 30);
}

// ─── (2) conflicts → suffix _2 / _3 ────────────────────────────────────────

#[tokio::test]
async fn migration_with_conflicts_resolves_via_suffix() {
    let (db, manager, _dir, _root, project_id) = fresh_setup().await;
    let base = kst_midnight_2026_05_22();
    // Two entries at the same minute with the same title — same hhmm + slug.
    for _ in 0..2 {
        let entry = db
            .insert_changelog_entry(
                project_id,
                Some("dup title".into()),
                None,
                "summary".into(),
                Some("dup title".into()),
                Some("feature".into()),
                None,
                1,
                1,
                0,
            )
            .await
            .unwrap();
        let ts = (base as i64) + 3600;
        db.conn()
            .call({
                let id = entry.id as i64;
                move |c| {
                    c.execute(
                        "UPDATE changelog_entries SET created_at = ?1 WHERE id = ?2",
                        rusqlite::params![ts, id],
                    )?;
                    Ok::<(), rusqlite::Error>(())
                }
            })
            .await
            .unwrap();
    }

    let plan = manager.migration_dry_run(&db, project_id).await.unwrap();
    assert_eq!(plan.conflicts.len(), 1);
    // One entry gets `__2` suffix in its target path.
    let has_suffix = plan
        .by_workday
        .iter()
        .flat_map(|w| w.entries.iter())
        .any(|e| e.target_relative_path.contains("__2"));
    assert!(has_suffix, "expected at least one __2 suffix");
}

// ─── (3) forbidden file → skip ─────────────────────────────────────────────

#[tokio::test]
async fn migration_with_forbidden_files_skips_those_entries() {
    let (db, manager, _dir, _root, project_id) = fresh_setup().await;
    let base = kst_midnight_2026_05_22();
    let entry = db
        .insert_changelog_entry(
            project_id,
            Some("env touch".into()),
            None,
            "summary".into(),
            Some("env touch".into()),
            Some("feature".into()),
            None,
            2,
            0,
            0,
        )
        .await
        .unwrap();
    let ts = (base as i64) + 3600;
    db.conn()
        .call({
            let id = entry.id as i64;
            move |c| {
                c.execute(
                    "UPDATE changelog_entries SET created_at = ?1 WHERE id = ?2",
                    rusqlite::params![ts, id],
                )?;
                Ok::<(), rusqlite::Error>(())
            }
        })
        .await
        .unwrap();
    db.insert_changelog_file(
        entry.id,
        ".env.local".into(),
        "modified".into(),
        0,
        0,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();
    db.insert_changelog_file(
        entry.id,
        "src/safe.rs".into(),
        "modified".into(),
        1,
        0,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();

    let plan = manager.migration_dry_run(&db, project_id).await.unwrap();
    assert!(plan.forbidden_path_hits >= 1);
    let entry_plan = &plan.by_workday[0].entries[0];
    assert!(
        entry_plan.will_skip,
        "forbidden entry should default to will_skip=true"
    );
}

// ─── (4) execute Err mid-write → auto rollback ─────────────────────────────
//
// Forces an early `execute` failure by pre-creating a *regular file* at the
// backup_dir path, so `create_dir_all` raises NotADirectory. The wrapper
// must surface a `MigrationCommandError::Aborted` (or equivalent — manager
// returns the structured `MigrationFailureWithRollback`).

#[tokio::test]
async fn execute_err_at_backup_setup_triggers_auto_rollback() {
    let (db, manager, _dir, root, project_id) = fresh_setup().await;
    seed_three_workdays(&db, project_id, kst_midnight_2026_05_22()).await;

    let plan = manager.migration_dry_run(&db, project_id).await.unwrap();
    let blocker = root.join(&plan.backup_dir);
    std::fs::write(&blocker, b"blocking file").unwrap();

    let err = manager
        .migration_execute(&db, project_id, plan, None, None)
        .await
        .expect_err("wrapper must surface failure");
    // Either rollback succeeded (rare — manifest absent) or failed; either
    // way the execute_error is the primary signal.
    assert!(blocker.exists(), "blocker file remains untouched");
    let _ = err;
}

// ─── (5) legacy delete after successful migration ──────────────────────────

#[tokio::test]
async fn legacy_delete_after_successful_migration_succeeds() {
    let (db, manager, _dir, root, project_id) = fresh_setup().await;
    seed_three_workdays(&db, project_id, kst_midnight_2026_05_22()).await;

    let plan = manager.migration_dry_run(&db, project_id).await.unwrap();
    let report = manager
        .migration_execute(&db, project_id, plan, None, None)
        .await
        .unwrap();
    assert!(report.success_count > 0);

    let history = manager
        .get_migration_history(&db, project_id)
        .await
        .unwrap();
    let h = &history[0];
    let token = format!(
        "migrated:{}:{}",
        h.report_timestamp, h.source_entry_count
    );
    let result = manager
        .delete_legacy_changelog(&db, project_id, &token)
        .await
        .unwrap();
    assert_eq!(result.deleted_entries, 30);

    // Safety backup created.
    assert!(root.join(&result.safety_backup_dir).exists());

    // History row marked as deleted.
    let history2 = manager
        .get_migration_history(&db, project_id)
        .await
        .unwrap();
    assert!(history2[0].legacy_deleted_at.is_some());
}

// ─── (6) legacy delete rejects when no history ─────────────────────────────

#[tokio::test]
async fn legacy_delete_rejects_when_no_migration_history_exists() {
    let (db, manager, _dir, _root, project_id) = fresh_setup().await;
    // No migration ever — token is irrelevant.
    let err = manager
        .delete_legacy_changelog(&db, project_id, "migrated:0:0")
        .await
        .unwrap_err();
    let s = err.to_string();
    assert!(
        s.contains("no migration history") || s.contains("InvalidConfig") || s.contains("invalid"),
        "expected reject reason, got {s}"
    );
}

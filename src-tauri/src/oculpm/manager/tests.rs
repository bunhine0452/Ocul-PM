use super::*;
use tempfile::tempdir;

/// Case 1 — fresh project: init creates `.oculpm/`, config.toml,
/// .schema-version, and acquires the lock.
#[tokio::test]
async fn init_creates_files_and_acquires_lock() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(report.wrote_config, "config.toml must be created on fresh init");
    assert!(matches!(report.lock_state, LockStateView::Healthy));

    let p = dir.path();
    assert!(p.join(".oculpm").exists());
    assert!(p.join(".oculpm/config.toml").exists());
    assert!(p.join(".oculpm/.schema-version").exists());
    assert!(p.join(".oculpm/.lock").exists());

    let schema = std::fs::read_to_string(p.join(".oculpm/.schema-version")).unwrap();
    assert_eq!(schema.trim(), "1");
}

/// Case 2 — calling init twice is a no-op for the second call.
#[tokio::test]
async fn init_is_idempotent() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    let r1 = manager.init_project(1, dir.path(), "ko").await.unwrap();
    let r2 = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(r1.wrote_config);
    assert!(!r2.wrote_config, "second init must not rewrite config.toml");
    assert_eq!(r2.created_dirs, Vec::<String>::new());
}

/// Case 3 — get_status reflects current workday + healthy lock.
#[tokio::test]
async fn get_status_after_init() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    // Before init.
    let s0 = manager.get_status(1).await;
    assert!(!s0.initialized);
    assert!(matches!(s0.lock_state, LockStateView::Uninitialized));

    manager.init_project(1, dir.path(), "ko").await.unwrap();

    let s1 = manager.get_status(1).await;
    assert!(s1.initialized);
    assert!(s1.config_valid);
    assert!(matches!(s1.lock_state, LockStateView::Healthy));
    assert_eq!(s1.current_workday.len(), 8, "workday is YYYYMMDD");
    assert!(matches!(s1.watcher_state, WatcherStateView::Stopped));
}

/// Case 5 — on_project_closed releases the lock and forgets the project.
#[tokio::test]
async fn on_project_closed_releases_lock() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(dir.path().join(".oculpm/.lock").exists());

    manager.on_project_closed(1).await.unwrap();

    assert!(
        !dir.path().join(".oculpm/.lock").exists(),
        "LockGuard::drop must remove the lock file synchronously"
    );

    // Forgotten from the in-memory map.
    let status = manager.get_status(1).await;
    assert!(!status.initialized);

    // Idempotent — closing again is a no-op.
    manager.on_project_closed(1).await.unwrap();
}

/// Case 6 — shutdown_all_blocking releases every project's lock.
#[tokio::test]
async fn shutdown_all_releases_every_lock() {
    let dir1 = tempdir().unwrap();
    let dir2 = tempdir().unwrap();
    let manager = OculpmManager::new();

    manager.init_project(1, dir1.path(), "ko").await.unwrap();
    manager.init_project(2, dir2.path(), "ko").await.unwrap();
    assert!(dir1.path().join(".oculpm/.lock").exists());
    assert!(dir2.path().join(".oculpm/.lock").exists());

    manager.shutdown_all_blocking();

    assert!(!dir1.path().join(".oculpm/.lock").exists());
    assert!(!dir2.path().join(".oculpm/.lock").exists());

    // Map is empty.
    let s1 = manager.get_status(1).await;
    let s2 = manager.get_status(2).await;
    assert!(!s1.initialized);
    assert!(!s2.initialized);
}

/// F7a-B Unit B — "원본 고치기": the tz-offset coercion is written into the
/// on-disk frontmatter exactly once, and re-running errors (nothing left to
/// coerce). The body is preserved.
#[tokio::test]
async fn coerce_timestamps_writes_offset_to_disk_once() {
    let dir = tempdir().unwrap();
    let db = crate::db::Db::open(dir.path().join("test.db")).await.unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    // A journal entry whose created_at lacks a tz offset.
    let rel = "20260524/Bugs/0925_bug_notz.md";
    let abs = dir.path().join(".oculpm/journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let content = "---\nschema_version: 1\ntype: bug\nslug: notz\nstatus: done\n\
                   created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
                   agent: { id: claude-code }\nlanguage: ko\n---\n[x] body line\n";
    std::fs::write(&abs, content).unwrap();

    let updated = manager
        .coerce_journal_entry_timestamps_on_disk(&db, 1, rel.to_string())
        .await
        .unwrap();
    // Returned (re-projected) entry carries the +09:00 offset…
    assert_eq!(updated.frontmatter.created_at, "2026-05-24T09:25:13+09:00");
    // …and so does the on-disk source file now (SSOT was rewritten once).
    let on_disk = std::fs::read_to_string(&abs).unwrap();
    assert!(
        on_disk.contains("2026-05-24T09:25:13+09:00"),
        "disk not coerced: {on_disk}"
    );
    // Body preserved.
    assert!(on_disk.contains("[x] body line"), "body lost: {on_disk}");

    // Re-running has nothing to coerce → error (idempotent guard).
    let again = manager
        .coerce_journal_entry_timestamps_on_disk(&db, 1, rel.to_string())
        .await;
    assert!(again.is_err(), "second coerce should error (already offset)");
}

/// N4 — the plan-write lock is one shared instance per project (so all
/// writers contend on it), distinct across projects, and actually excludes.
#[tokio::test]
async fn plan_write_lock_is_shared_per_project() {
    let manager = OculpmManager::new();
    let a1 = manager.plan_write_lock(1).await;
    let a2 = manager.plan_write_lock(1).await;
    let b = manager.plan_write_lock(2).await;
    assert!(std::sync::Arc::ptr_eq(&a1, &a2), "same project shares one lock");
    assert!(!std::sync::Arc::ptr_eq(&a1, &b), "different projects differ");
    // Held lock blocks the shared handle (real mutual exclusion).
    let _g = a1.lock().await;
    assert!(a2.try_lock().is_err(), "held lock must block the shared handle");
}

// ─── W1-PR8 — `.gitignore` managed block ───────────────────────────────

/// PR8 case 1 — no `.gitignore` → init creates one containing only our
/// managed block + `wrote_gitignore = true`.
#[tokio::test]
async fn init_creates_gitignore_when_missing() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(report.wrote_gitignore);

    let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(gi.contains("# oculpm:begin v1"));
    assert!(gi.contains(".oculpm/index/"));
    assert!(gi.contains(".oculpm/.lock"));
    assert!(gi.contains(".oculpm/.schema-version"));
    assert!(gi.contains(".oculpm/oculpm.log"));
    assert!(gi.contains(".oculpm.backup-*/"));
    assert!(gi.contains("# oculpm:end"));
    // Block-only file must not start with a blank line.
    assert!(gi.starts_with("# oculpm:begin v1"));
}

/// 락을 남이 쥐고 있어 read-only 로 시작한 프로젝트도, 그 인스턴스가
/// 사라지면 **다음 `watcher_start` 에서 회수**해 감시를 시작해야 한다.
///
/// 예전에는 락을 `init_project` 에서 한 번만 잡았다 — 그래서 앱을 두 개
/// 띄운 뒤 하나를 꺼도, 남은 쪽은 프로세스가 끝날 때까지 모든 프로젝트의
/// 실시간 갱신을 잃은 채였다 (도그푸딩 2026-08-23).
#[tokio::test]
async fn watcher_start_reclaims_a_lock_that_was_held_at_init() {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    // 살아 있는 pid(= 이 테스트 프로세스) + 방금 찍은 하트비트 →
    // `LockGuard::acquire` 가 Held 를 돌려주는 조건.
    let lock_path = dir.path().join(".oculpm/.lock");
    let now = chrono::Utc::now().to_rfc3339();
    std::fs::write(
        &lock_path,
        format!(
            r#"{{"schema_version":1,"pid":{},"hostname":"test","started_at":"{now}","heartbeat_at":"{now}"}}"#,
            std::process::id()
        ),
    )
    .unwrap();

    let manager = OculpmManager::new();
    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(
        matches!(report.lock_state, LockStateView::HeldByOther),
        "남이 쥔 락은 read-only 로 시작해야 한다"
    );

    // 저쪽이 아직 살아 있는 동안에는 켜지지 않는다 (계약 유지).
    assert!(manager.watcher_start(1, None).await.is_err());

    // 저쪽 인스턴스가 끝났다 → 다음 시도에서 회수하고 감시가 시작된다.
    std::fs::remove_file(&lock_path).unwrap();
    manager.watcher_start(1, None).await.unwrap();

    let health = manager.watcher_health().await;
    let me = health.iter().find(|h| h.project_id == 1).unwrap();
    assert!(me.has_lock, "회수한 락을 들고 있어야 한다");
    assert!(me.events_seen.is_some(), "살아 있는 워처가 붙어 있어야 한다");
}

/// 앱이 새로 뜰 때의 경로 — 살아 있는 소유자에게서 락을 **가져와** 감시를
/// 시작한다. 양보 정책은 같은 상황에서 물러난다 (그래야 재시도가 서로를
/// 무한히 쫓아내지 않는다).
#[tokio::test]
async fn take_over_policy_starts_watching_despite_a_live_holder() {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    let lock_path = dir.path().join(".oculpm/.lock");
    let now = chrono::Utc::now().to_rfc3339();
    std::fs::write(
        &lock_path,
        format!(
            r#"{{"schema_version":1,"pid":{},"hostname":"test","started_at":"{now}","heartbeat_at":"{now}"}}"#,
            std::process::id()
        ),
    )
    .unwrap();

    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    // 양보 정책은 물러난다.
    assert!(manager.watcher_start(1, None).await.is_err());

    // 가져오기 정책은 감시를 시작한다.
    manager
        .watcher_start_with(1, None, AcquirePolicy::TakeOver)
        .await
        .unwrap();
    let health = manager.watcher_health().await;
    assert!(health[0].has_lock);
    assert!(health[0].events_seen.is_some());
}

/// 인계당한 락이 없으면 놓을 것도 없다 (감독관이 매 틱 부르는 경로라
/// 조용한 no-op 이어야 한다).
#[tokio::test]
async fn yield_evicted_locks_is_a_noop_while_we_still_own_them() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();
    manager.watcher_start(1, None).await.unwrap();

    assert!(manager.yield_evicted_locks().await.is_empty());
    assert!(manager.watcher_health().await[0].events_seen.is_some());
}

/// 살아 있는 워처에 대한 재호출은 종전대로 no-op 이고, `watcher_health` 는
/// 그 사실을 감독관에게 그대로 알려 준다.
#[tokio::test]
async fn watcher_start_is_a_noop_while_the_watcher_is_alive() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    manager.watcher_start(1, None).await.unwrap();
    manager.watcher_start(1, None).await.unwrap();

    let health = manager.watcher_health().await;
    assert_eq!(health.len(), 1);
    assert!(health[0].has_lock);
    assert!(health[0].events_seen.is_some());
}

/// 응답 없는 워처는 **기다리지 않고** 끊는다 — 끊고 나면 감독관이 보는
/// 상태는 "워처 없음" 이고, 다음 `watcher_start` 가 새로 무장한다.
#[tokio::test]
async fn dropping_an_unresponsive_watcher_clears_it_for_rearming() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();
    manager.watcher_start(1, None).await.unwrap();

    manager.watcher_drop_unresponsive(1).await;
    assert!(
        manager.watcher_health().await[0].events_seen.is_none(),
        "끊긴 워처는 감독관에게 '없음' 으로 보여야 한다"
    );

    manager.watcher_start(1, None).await.unwrap();
    assert!(manager.watcher_health().await[0].events_seen.is_some());
}

/// PR8 case 2 — pre-existing `.gitignore` → our block is appended with
/// exactly one blank-line separator, user content is preserved.
#[tokio::test]
async fn init_appends_block_to_existing_gitignore() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    std::fs::write(
        dir.path().join(".gitignore"),
        "node_modules/\ndist/\n",
    )
    .unwrap();

    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(report.wrote_gitignore);

    let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(gi.starts_with("node_modules/\ndist/\n"));
    assert!(gi.contains("dist/\n\n# oculpm:begin v1"));
    assert!(gi.contains(".oculpm/index/"));
}

/// PR8 case 3 — second init on the same project is a fast-path no-op, so
/// `wrote_gitignore = false` and the file is byte-identical.
#[tokio::test]
async fn init_is_idempotent_for_gitignore() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    let r1 = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(r1.wrote_gitignore);
    let snapshot = std::fs::read(dir.path().join(".gitignore")).unwrap();

    let r2 = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(!r2.wrote_gitignore);
    let after = std::fs::read(dir.path().join(".gitignore")).unwrap();
    assert_eq!(snapshot, after, ".gitignore must not be rewritten on idempotent init");
}

/// PR8 case 4 — pre-existing orphan `# oculpm:begin v1` (no end marker)
/// → init returns `ManagedBlockMismatch` and drops the lock so a retry is
/// possible after the user fixes the file.
#[tokio::test]
async fn init_errors_on_orphan_managed_block_and_releases_lock() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    std::fs::write(
        dir.path().join(".gitignore"),
        "# oculpm:begin v1\n.oculpm/index/\n",
    )
    .unwrap();

    let err = manager.init_project(1, dir.path(), "ko").await.unwrap_err();
    assert!(matches!(err, OculpmError::ManagedBlockMismatch { .. }));

    // Lock file must not survive a failed init.
    assert!(
        !dir.path().join(".oculpm/.lock").exists(),
        "LockGuard must be dropped when init fails after the lock was acquired"
    );

    // Project is not registered, so the manager's view stays uninitialised.
    assert!(!manager.get_status(1).await.initialized);
}

/// A0a case 6 — a block containing an entry this build doesn't know
/// (added by a newer app version) must survive re-init via union merge,
/// not get stripped back to the canonical body.
#[tokio::test]
async fn init_preserves_unknown_lines_in_gitignore_block() {
    let dir = tempdir().unwrap();
    std::fs::write(
        dir.path().join(".gitignore"),
        "# oculpm:begin v1\n.oculpm/index/\n.oculpm/some-future-dir/\n# oculpm:end\n",
    )
    .unwrap();

    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(gi.contains(".oculpm/some-future-dir/"), "unknown line must survive: {gi}");
    assert!(gi.contains(".oculpm/hooks/"), "canonical lines must be (re)added: {gi}");
    assert_eq!(gi.matches("some-future-dir").count(), 1, "no duplication: {gi}");
}

/// A0a invariant — the union merge appends unknown lines after the
/// canonical set, which silently breaks order-sensitive `!` negation
/// patterns (gitignore: last match wins). Lock the canonical body to
/// order-independent patterns; redesign `merged_gitignore_body` before
/// ever adding a negation.
#[test]
fn gitignore_canonical_body_stays_order_independent() {
    assert!(
        GITIGNORE_BLOCK_BODY.lines().all(|l| !l.trim_start().starts_with('!')),
        "negation pattern in GITIGNORE_BLOCK_BODY — union merge reorders lines"
    );
}

/// A0a — verbatim preservation: a backslash-quoted trailing space is
/// significant to gitignore and must survive the merge untrimmed.
#[test]
fn merged_gitignore_body_keeps_lines_verbatim() {
    let merged = merged_gitignore_body(Some("custom\\ \n.oculpm/index/\n"));
    assert!(merged.contains("custom\\ \n"), "escaped trailing space lost: {merged:?}");
    assert_eq!(merged.matches(".oculpm/index/").count(), 1, "no duplication");
}

/// A0a case 7 — a block stamped with a newer version marker is left
/// byte-identical (downgrade guard end-to-end through init).
#[tokio::test]
async fn init_leaves_newer_version_gitignore_block_untouched() {
    let dir = tempdir().unwrap();
    let newer = "# oculpm:begin v99\n.oculpm/future-secret/\n# oculpm:end\n";
    std::fs::write(dir.path().join(".gitignore"), newer).unwrap();

    let manager = OculpmManager::new();
    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(!report.wrote_gitignore, "newer block must not count as written");
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".gitignore")).unwrap(),
        newer,
        "newer-versioned block must be byte-identical after init"
    );
}

/// PR8 case 5 — CRLF in the pre-existing `.gitignore` is preserved.
#[tokio::test]
async fn init_preserves_crlf_in_gitignore() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();

    std::fs::write(
        dir.path().join(".gitignore"),
        "node_modules/\r\ndist/\r\n",
    )
    .unwrap();

    let report = manager.init_project(1, dir.path(), "ko").await.unwrap();
    assert!(report.wrote_gitignore);

    let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(gi.contains("\r\n# oculpm:begin v1\r\n"));
    assert!(gi.contains(".oculpm/index/\r\n"));
    assert!(gi.contains("\r\n# oculpm:end\r\n"));
    assert!(!gi.contains(".oculpm/index/\n.oculpm/.lock\n"));
}

/// Case 4 — set_config persists to disk + updates the in-memory resolver.
#[tokio::test]
async fn set_config_persists_and_updates_resolver() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    // Mutate + save.
    let mut updated = manager.get_config(1).await.unwrap();
    updated.session.inactivity_timeout_minutes = 60;
    updated.workday.day_starts_at = "03:00".into();
    manager.set_config(1, updated).await.unwrap();

    // In-memory readback.
    let got = manager.get_config(1).await.unwrap();
    assert_eq!(got.session.inactivity_timeout_minutes, 60);
    assert_eq!(got.workday.day_starts_at, "03:00");

    // Disk readback.
    let disk = OculpmConfig::load(&dir.path().join(".oculpm/config.toml")).unwrap();
    assert_eq!(disk.session.inactivity_timeout_minutes, 60);
    assert_eq!(disk.workday.day_starts_at, "03:00");

    // set_config rejects invalid config without persisting.
    let mut bad = OculpmConfig::default_for_new_project();
    bad.workday.timezone = "Bogus/Tz".into();
    let err = manager.set_config(1, bad).await.unwrap_err();
    assert!(matches!(err, OculpmError::InvalidTimezone(_)));
    // Disk untouched.
    let disk2 = OculpmConfig::load(&dir.path().join(".oculpm/config.toml")).unwrap();
    assert_eq!(disk2.workday.day_starts_at, "03:00");
}

// ─── W2-PR4 — Crash recovery ───────────────────────────────────────────

use crate::oculpm::spec::{EndedReason, FileChangeEvent, FileOp, Session};

fn make_writer(root: &Path) -> IndexWriter {
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    IndexWriter::new(root.to_path_buf(), resolver)
}

fn make_zombie_session(id: &str, started_at: &str) -> Session {
    Session {
        id: id.to_string(),
        started_at: started_at.to_string(),
        ended_at: None,
        ended_reason: None,
        active_window_ms: 0,
        file_event_count: 0,
        files_unique: 0,
        git_head_at_start: None,
        git_head_at_end: None,
        agent_label_guess: None,
        linked_journal_entries: Vec::new(),
    }
}

fn make_event(session_id: &str, ts: &str, path: &str) -> FileChangeEvent {
    FileChangeEvent {
        ts: ts.to_string(),
        session_id: session_id.to_string(),
        op: FileOp::Update,
        path: path.to_string(),
        hash_before: None,
        hash_after: Some("blake3:abc".into()),
        bytes: 100,
    }
}

/// PR4 test 1 — two zombie sessions (yesterday + today), both recovered.
#[tokio::test]
async fn recover_two_zombie_sessions() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    // Yesterday
    writer
        .upsert_session(&make_zombie_session(
            "20260522-001",
            "2026-05-22T09:00:00Z",
        ))
        .await
        .unwrap();
    writer
        .append_file_change(&make_event(
            "20260522-001",
            "2026-05-22T10:30:00Z",
            "src/a.rs",
        ))
        .await
        .unwrap();

    // Today
    writer
        .upsert_session(&make_zombie_session(
            "20260523-001",
            "2026-05-23T14:00:00Z",
        ))
        .await
        .unwrap();
    writer
        .append_file_change(&make_event(
            "20260523-001",
            "2026-05-23T15:45:00Z",
            "src/b.rs",
        ))
        .await
        .unwrap();

    let count = OculpmManager::recover_zombie_sessions(&writer, 3)
        .await
        .unwrap();
    assert_eq!(count, 2, "both zombie sessions must be recovered");

    // Verify yesterday's session.
    let sessions_y = writer.list_sessions("20260522").await.unwrap();
    let s1 = &sessions_y[0];
    assert_eq!(s1.ended_at.as_deref(), Some("2026-05-22T10:30:00Z"));
    assert!(matches!(
        s1.ended_reason,
        Some(EndedReason::CrashRecovered)
    ));

    // Verify today's session.
    let sessions_t = writer.list_sessions("20260523").await.unwrap();
    let s2 = &sessions_t[0];
    assert_eq!(s2.ended_at.as_deref(), Some("2026-05-23T15:45:00Z"));
    assert!(matches!(
        s2.ended_reason,
        Some(EndedReason::CrashRecovered)
    ));
}

/// PR4 test 2 — 3-day limit: zombie in a 4-day-old workday is NOT recovered.
#[tokio::test]
async fn recover_respects_three_day_limit() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    // 4 workdays: 20260520, 21, 22, 23.
    for (wd, sid) in &[
        ("20260520", "20260520-001"),
        ("20260521", "20260521-001"),
        ("20260522", "20260522-001"),
        ("20260523", "20260523-001"),
    ] {
        writer
            .upsert_session(&make_zombie_session(
                sid,
                &format!("{}-{}T09:00:00Z", &wd[..4], &wd[4..6]),
            ))
            .await
            .unwrap();
    }

    let count = OculpmManager::recover_zombie_sessions(&writer, 3)
        .await
        .unwrap();
    // Only 3 most recent: 20260523, 20260522, 20260521.
    assert_eq!(count, 3, "only the 3 most recent workdays are scanned");

    // The 4th-oldest (20260520) should still be a zombie.
    let old = writer.list_sessions("20260520").await.unwrap();
    assert!(
        old[0].ended_at.is_none(),
        "4-day-old zombie must NOT be recovered"
    );
}

/// PR4 test 3 — last_event_ts fallback: session with zero events gets
/// `ended_at = started_at`.
#[tokio::test]
async fn recover_fallback_to_started_at_when_no_events() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    writer
        .upsert_session(&make_zombie_session(
            "20260523-001",
            "2026-05-23T14:00:00Z",
        ))
        .await
        .unwrap();
    // No events appended.

    let count = OculpmManager::recover_zombie_sessions(&writer, 3)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let sessions = writer.list_sessions("20260523").await.unwrap();
    assert_eq!(
        sessions[0].ended_at.as_deref(),
        Some("2026-05-23T14:00:00Z"),
        "ended_at must fall back to started_at"
    );
    assert!(matches!(
        sessions[0].ended_reason,
        Some(EndedReason::CrashRecovered)
    ));
}

/// PR4 test 4 — finalize then list: after recovery, list_sessions returns
/// the updated ended_reason.
#[tokio::test]
async fn recover_then_list_shows_updated_reason() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    writer
        .upsert_session(&make_zombie_session(
            "20260523-001",
            "2026-05-23T09:00:00Z",
        ))
        .await
        .unwrap();
    // Also add a normal (already ended) session to confirm it's untouched.
    let mut ended = make_zombie_session("20260523-002", "2026-05-23T12:00:00Z");
    ended.ended_at = Some("2026-05-23T13:00:00Z".into());
    ended.ended_reason = Some(EndedReason::InactivityTimeout);
    writer.upsert_session(&ended).await.unwrap();

    OculpmManager::recover_zombie_sessions(&writer, 3)
        .await
        .unwrap();

    let sessions = writer.list_sessions("20260523").await.unwrap();
    // Session 001 should be crash_recovered.
    assert!(matches!(
        sessions[0].ended_reason,
        Some(EndedReason::CrashRecovered)
    ));
    // Session 002 should be untouched (InactivityTimeout).
    assert!(matches!(
        sessions[1].ended_reason,
        Some(EndedReason::InactivityTimeout)
    ));
    assert_eq!(
        sessions[1].ended_at.as_deref(),
        Some("2026-05-23T13:00:00Z"),
        "already-ended session must not be modified"
    );
}

/// PR4 test 5 — race-free: recovery function is a standalone await-able
/// call that completes before returning, so no concurrent watcher can
/// interleave. We verify this by asserting the return type is a plain
/// Result (not a JoinHandle) and that the sessions.json is fully flushed.
#[tokio::test]
async fn recover_is_synchronous_and_flushed() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    writer
        .upsert_session(&make_zombie_session(
            "20260523-001",
            "2026-05-23T14:00:00Z",
        ))
        .await
        .unwrap();

    // `recover_zombie_sessions` is .await-ed directly — when it returns,
    // all disk I/O must be complete.
    let count = OculpmManager::recover_zombie_sessions(&writer, 3)
        .await
        .unwrap();
    assert_eq!(count, 1);

    // Verify disk flush: read the raw sessions.json and confirm ended_at
    // is populated — no deferred write.
    let sessions_path = dir
        .path()
        .join(".oculpm/index/20260523/sessions.json");
    let raw = std::fs::read_to_string(&sessions_path).unwrap();
    assert!(raw.contains("crash_recovered"));
    assert!(raw.contains("2026-05-23T14:00:00Z"));
}

/// PR4 test 6 — list_workdays returns dirs in descending order and ignores
/// non-YYYYMMDD directory names.
#[tokio::test]
async fn list_workdays_order_and_filtering() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());

    // Create workday dirs + a non-workday dir.
    for wd in &["20260521", "20260523", "20260520", "20260522"] {
        writer.ensure_workday_dirs(wd).await.unwrap();
    }
    // Create a non-YYYYMMDD dir that should be ignored.
    std::fs::create_dir_all(
        dir.path().join(".oculpm/index/not-a-workday"),
    )
    .unwrap();

    let workdays = writer.list_workdays().await.unwrap();
    assert_eq!(
        workdays,
        vec!["20260523", "20260522", "20260521", "20260520"],
        "must be sorted descending, non-YYYYMMDD excluded"
    );
}

// ─── W3-PR3: journal/manual-entry/verified/reindex ──────────────────

mod journal_w3_pr3 {
    use super::*;
    use crate::db::Db;
    use crate::oculpm::spec::{Difficulty, EntryStatus, EntryType, FileTouched, ManualEntryDraft};

    async fn fresh_manager_and_db() -> (
        OculpmManager,
        Db,
        tempfile::TempDir, // project root + db dir
        std::path::PathBuf,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ocul-pm.db");
        let db = Db::open(db_path).await.expect("open db");
        let manager = OculpmManager::new();
        let project_root = dir.path().join("project");
        std::fs::create_dir_all(&project_root).unwrap();
        manager.init_project(7, &project_root, "ko").await.unwrap();
        (manager, db, dir, project_root)
    }

    /// 일지 상대경로는 `.oculpm/journal/` 밖으로 못 나간다 — 모바일 브리지가 이
    /// 인자를 페어링된 기기에 그대로 노출하므로(2026-08-30 감사) 절대경로·`..` 는
    /// 읽기·쓰기 경로 모두에서 거부돼야 한다.
    #[tokio::test]
    async fn journal_paths_cannot_escape_the_journal_root() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let outside = project_root.join(".oculpm/planner/victim.md");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(&outside, "---\noculpm_plan: v1\n---\n").unwrap();

        for bad in ["../planner/victim.md", "/etc/passwd", "", "20260524/../../planner/victim.md"] {
            let read = manager.get_journal_entry(&db, 7, bad.to_string()).await;
            assert!(matches!(read, Err(OculpmError::InvalidPath(_))), "read {bad:?}: {read:?}");
            let verify = manager.set_journal_verified(&db, 7, bad.to_string(), true).await;
            assert!(matches!(verify, Err(OculpmError::InvalidPath(_))), "verify {bad:?}");
            let body = manager
                .update_journal_entry_body(&db, 7, bad.to_string(), "pwned".to_string())
                .await;
            assert!(matches!(body, Err(OculpmError::InvalidPath(_))), "body {bad:?}");
            let abs = manager.resolve_journal_absolute(7, bad).await;
            assert!(matches!(abs, Err(OculpmError::InvalidPath(_))), "resolve {bad:?}");
        }
        assert_eq!(
            std::fs::read_to_string(&outside).unwrap(),
            "---\noculpm_plan: v1\n---\n",
            "journal 밖 파일은 손대지 않는다"
        );

        // 정상 경로는 그대로 통과한다.
        let ok = manager
            .resolve_journal_absolute(7, "20260524/Bugs/0925_bug_a.md")
            .await
            .unwrap();
        assert!(ok.starts_with(project_root.join(".oculpm/journal")));
    }

    fn minimal_draft(slug: &str) -> ManualEntryDraft {
        ManualEntryDraft {
            entry_type: EntryType::Bug,
            slug: slug.to_string(),
            title: "Manual entry title".to_string(),
            difficulty: Some(Difficulty::Medium),
            body_markdown: "Body text\n".to_string(),
            session_id: None,
            files_touched: vec![FileTouched {
                path: "src/a.rs".to_string(),
                op: crate::oculpm::spec::FileOp::Update,
                bytes_added: None,
                bytes_removed: None,
                rename_from: None,
            }],
            status: Some(EntryStatus::Done),
            tags: vec!["alpha".into()],
            agent: None,
            verified_by_user: None,
        }
    }

    /// PR-CI1 — 자동 초안의 실측 귀속 오버라이드: agent/verified_by_user 를
    /// draft 가 넘기면 그대로 frontmatter 에 쓰인다.
    #[tokio::test]
    async fn create_manual_entry_honours_agent_override() {
        let (manager, db, _dir, _project_root) = fresh_manager_and_db().await;
        let mut draft = minimal_draft("auto-draft-slug");
        draft.agent = Some(crate::oculpm::spec::AgentRef {
            id: "claude-code".to_string(),
            version: Some("claude-haiku-4-5-20251001".to_string()),
        });
        draft.verified_by_user = Some(false);
        let entry = manager
            .create_manual_journal_entry(&db, 7, draft)
            .await
            .expect("created");
        assert_eq!(entry.frontmatter.agent.id, "claude-code");
        assert_eq!(
            entry.frontmatter.agent.version.as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
        assert!(!entry.frontmatter.verified_by_user);
    }

    #[tokio::test]
    async fn create_manual_entry_writes_file_and_caches_with_agent_manual() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let entry = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("my-slug"))
            .await
            .expect("created");

        assert_eq!(entry.frontmatter.agent.id, "manual");
        assert_eq!(entry.frontmatter.entry_type, EntryType::Bug);
        assert_eq!(entry.frontmatter.slug, "my-slug");
        assert_eq!(entry.frontmatter.tags, vec!["alpha".to_string()]);
        assert!(entry.frontmatter.verified_by_user);
        assert_eq!(entry.frontmatter.files_touched.len(), 1);

        // File exists on disk under journal/<workday>/Bugs/.
        let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
        assert!(abs.exists(), "file written to {}", abs.display());

        // Listed via cache too.
        let rows = manager
            .list_journal_entries(&db, 7, None, EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slug, "my-slug");
    }

    #[tokio::test]
    async fn create_manual_entry_masks_secret_in_body_at_write() {
        // R1: a user pastes a key into the modal. The on-disk markdown and
        // the returned entry must both carry [REDACTED], never the plaintext
        // — so committing `.oculpm/` can't leak it and the cache (→ AI) stays
        // clean. Uses the project's default `auto_redact_patterns`.
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let mut draft = minimal_draft("leaky");
        draft.body_markdown =
            "deploy key AKIAABCDEFGHIJKLMNOP do not share\n".to_string();
        let entry = manager
            .create_manual_journal_entry(&db, 7, draft)
            .await
            .expect("created");

        assert!(
            entry.body_markdown.contains("[REDACTED]"),
            "returned body should be masked: {}",
            entry.body_markdown
        );
        assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));

        let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
        let on_disk = std::fs::read_to_string(&abs).unwrap();
        assert!(on_disk.contains("[REDACTED]"), "disk should be masked: {on_disk}");
        assert!(
            !on_disk.contains("AKIAABCDEFGHIJKLMNOP"),
            "plaintext key must never reach disk"
        );
    }

    #[tokio::test]
    async fn update_journal_entry_body_masks_secret_on_disk_and_cache() {
        // R1: editing a body via the in-app editor is a WE-authored write, so
        // it masks at-write — disk, the returned entry, AND the cache row all
        // carry [REDACTED], never the plaintext.
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let entry = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("editme"))
            .await
            .expect("created");
        let updated = manager
            .update_journal_entry_body(
                &db,
                7,
                entry.relative_path.clone(),
                "edited body with ghp_abcdefghijklmnopqrstuvwxyz0123456789 token\n".to_string(),
            )
            .await
            .expect("updated");

        assert!(updated.body_markdown.contains("[REDACTED]"));
        assert!(!updated
            .body_markdown
            .contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));

        let abs = project_root.join(".oculpm/journal").join(&entry.relative_path);
        let on_disk = std::fs::read_to_string(&abs).unwrap();
        assert!(on_disk.contains("[REDACTED]"));
        assert!(!on_disk.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
    }

    #[tokio::test]
    async fn set_journal_verified_keeps_agent_secret_masked_in_cache() {
        // R1 regression: a frontmatter-only edit must NOT re-pollute the cache
        // with an agent body's plaintext secret. The agent's on-disk body is
        // preserved (SSOT); the cache row stays masked (→ AI context clean).
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let rel = "20260524/Bugs/0925_bug_agent.md";
        let abs = project_root.join(".oculpm/journal").join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        // Agent-authored entry on disk with a secret in the body (NOT via the
        // masking manual-create path).
        let content = "---\nschema_version: 1\ntype: bug\nslug: agent-bug\nstatus: planned\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: { id: claude-code }\nlanguage: ko\n---\n[ ] agent did a thing\n\nleaked AKIAABCDEFGHIJKLMNOP oops\n";
        std::fs::write(&abs, content).unwrap();

        // Index (masks on projection).
        manager.reindex_journal_cache(&db, 7).await.unwrap();
        let cached = manager
            .get_journal_entry(&db, 7, rel.to_string())
            .await
            .unwrap()
            .expect("indexed");
        assert!(
            cached.body_markdown.contains("[REDACTED]"),
            "indexed body should be masked"
        );

        // Toggle verified — must NOT re-pollute the cache.
        manager
            .set_journal_verified(&db, 7, rel.to_string(), true)
            .await
            .unwrap();
        let after = manager
            .get_journal_entry(&db, 7, rel.to_string())
            .await
            .unwrap()
            .expect("still present");
        assert!(after.frontmatter.verified_by_user, "verified flag set");
        assert!(
            after.body_markdown.contains("[REDACTED]"),
            "cache must stay masked after a frontmatter-only edit"
        );
        assert!(
            !after.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"),
            "no plaintext re-pollution into the cache"
        );

        // Disk SSOT preserved — the agent's original body is untouched.
        let on_disk = std::fs::read_to_string(&abs).unwrap();
        assert!(
            on_disk.contains("AKIAABCDEFGHIJKLMNOP"),
            "agent's on-disk body is preserved (we never rewrite it)"
        );
    }

    #[tokio::test]
    async fn backfill_from_git_creates_typed_entries_and_is_idempotent() {
        // F5: a repo with git history but empty journal gets one entry per
        // commit, typed from the conventional-commit prefix, tagged
        // `git-backfill`, and a re-run adds nothing (idempotent).
        fn git(root: &std::path::Path, args: &[&str]) -> bool {
            std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .ok()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        if !git(&project_root, &["init", "-q"]) {
            return; // git unavailable → skip cleanly
        }
        git(&project_root, &["config", "user.email", "t@t.dev"]);
        git(&project_root, &["config", "user.name", "t"]);
        std::fs::write(project_root.join("a.rs"), "fn a() {}\n").unwrap();
        git(&project_root, &["add", "."]);
        git(&project_root, &["commit", "-qm", "feat: add a"]);
        std::fs::write(project_root.join("a.rs"), "fn a() { /* fixed */ }\n").unwrap();
        git(&project_root, &["add", "."]);
        git(&project_root, &["commit", "-qm", "fix: patch a"]);

        let report = manager.backfill_from_git(&db, 7, 50).await.expect("backfill");
        assert_eq!(report.created, 2, "two commits → two entries");
        assert_eq!(report.skipped, 0);

        let rows = manager
            .list_journal_entries(&db, 7, None, EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.entry_type == EntryType::Feature), "feat → Feature");
        assert!(rows.iter().any(|r| r.entry_type == EntryType::Bug), "fix → Bug");
        assert!(rows.iter().all(|r| r.tags.contains(&"git-backfill".to_string())));

        // Idempotent re-run — nothing new.
        let report2 = manager.backfill_from_git(&db, 7, 50).await.expect("backfill 2");
        assert_eq!(report2.created, 0, "re-run creates nothing");
        assert_eq!(report2.skipped, 2);
    }

    #[tokio::test]
    async fn create_manual_entry_rejects_invalid_slug() {
        let (manager, db, _dir, _root) = fresh_manager_and_db().await;
        // Uppercase + space → fails kebab-case ASCII rule.
        let res = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("Bad Slug!"))
            .await;
        assert!(res.is_err());
        let res2 = manager
            .create_manual_journal_entry(&db, 7, minimal_draft(""))
            .await;
        assert!(res2.is_err());
        let too_long = "a".repeat(61);
        let res3 = manager
            .create_manual_journal_entry(&db, 7, minimal_draft(&too_long))
            .await;
        assert!(res3.is_err());
    }

    /// 파일명에 `HHMM` 이 들어가므로 **두 번만 쓰면 분 경계에서 깨진다**
    /// (22:20:59 → 22:21:00 이면 애초에 충돌하지 않아 접미사도 없다).
    /// 실제로 그 시각에 한 번 실패했다. 세 번 쓰면 마이크로초 단위 테스트가
    /// 분 경계를 두 번 넘을 수는 없으므로 **적어도 둘은 같은 분**이고,
    /// 충돌 경로가 반드시 실행된다.
    #[tokio::test]
    async fn create_manual_entry_handles_filename_collision_with_suffix() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let a = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("collide"))
            .await
            .expect("first");
        let b = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("collide"))
            .await
            .expect("second");
        let c = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("collide"))
            .await
            .expect("third");

        let paths = [&a.relative_path, &b.relative_path, &c.relative_path];
        let unique: std::collections::HashSet<_> = paths.iter().collect();
        assert_eq!(unique.len(), 3, "must not overwrite: {paths:?}");
        assert!(
            paths.iter().any(|p| p.contains("__2")),
            "같은 분에 쓴 두 건 중 뒤쪽은 __2 접미사를 가져야 한다: {paths:?}"
        );
        // Both files on disk.
        let r = project_root.join(".oculpm/journal");
        assert!(r.join(&c.relative_path).exists());
        assert!(r.join(&a.relative_path).exists());
        assert!(r.join(&b.relative_path).exists());
    }

    #[tokio::test]
    async fn set_journal_verified_flips_frontmatter_and_cache() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        // verified=true by default for manual drafts → flip to false.
        let entry = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("verify-me"))
            .await
            .unwrap();
        assert!(entry.frontmatter.verified_by_user);

        manager
            .set_journal_verified(&db, 7, entry.relative_path.clone(), false)
            .await
            .unwrap();
        let raw =
            std::fs::read_to_string(project_root.join(".oculpm/journal").join(&entry.relative_path))
                .unwrap();
        assert!(raw.contains("verified_by_user: false"));

        let fresh = manager
            .get_journal_entry(&db, 7, entry.relative_path.clone())
            .await
            .unwrap()
            .unwrap();
        assert!(!fresh.frontmatter.verified_by_user, "cache reflects new flag");

        // Round-trip back to true.
        manager
            .set_journal_verified(&db, 7, entry.relative_path.clone(), true)
            .await
            .unwrap();
        let fresh2 = manager
            .get_journal_entry(&db, 7, entry.relative_path)
            .await
            .unwrap()
            .unwrap();
        assert!(fresh2.frontmatter.verified_by_user);
    }

    #[tokio::test]
    async fn set_journal_verified_rejects_broken_frontmatter() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        // Write a deliberately broken entry directly to disk.
        let rel = "20260524/Bugs/0000_bug_broken.md";
        let abs = project_root.join(".oculpm/journal").join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(
            &abs,
            "---\nschema_version: 1\ntype: bug\n  bad: [unclosed\n---\n[x] body\n",
        )
        .unwrap();
        // Get the entry through the manager so the on-demand cache path
        // runs (parse_ok=0 → row exists as chore).
        manager
            .get_journal_entry(&db, 7, rel.to_string())
            .await
            .unwrap();

        let res = manager
            .set_journal_verified(&db, 7, rel.to_string(), true)
            .await;
        assert!(res.is_err());
        let msg = res.unwrap_err().to_string();
        assert!(msg.contains("broken frontmatter"), "got: {msg}");
    }

    #[tokio::test]
    async fn reindex_journal_cache_returns_spec_report_shape() {
        let (manager, db, _dir, _root) = fresh_manager_and_db().await;
        manager
            .create_manual_journal_entry(&db, 7, minimal_draft("a"))
            .await
            .unwrap();
        manager
            .create_manual_journal_entry(&db, 7, minimal_draft("b"))
            .await
            .unwrap();
        // Wipe cache, then ask manager to reindex.
        db.conn()
            .call(|c| -> rusqlite::Result<()> {
                c.execute("DELETE FROM oculpm_journal WHERE project_id = 7", [])?;
                Ok(())
            })
            .await
            .unwrap();
        let report = manager.reindex_journal_cache(&db, 7).await.unwrap();
        assert_eq!(report.project_id, 7);
        assert_eq!(report.inserted, 2);
        assert!(!report.completed_at.is_empty());
        // Sanity: list works after reindex.
        let rows = manager
            .list_journal_entries(&db, 7, None, EntryFilters::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn get_journal_entry_falls_back_to_disk_on_cache_miss() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        // Hand-write an entry to disk that the cache hasn't seen.
        let rel = "20260524/Bugs/0900_bug_handwritten.md";
        let abs = project_root.join(".oculpm/journal").join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        let fm = "schema_version: 1\ntype: bug\nslug: handwritten\nstatus: planned\ncreated_at: \"2026-05-24T09:00:00+09:00\"\nsession_id: \"20260524-001\"\nagent: { id: claude-code }\nlanguage: ko";
        std::fs::write(&abs, format!("---\n{fm}\n---\n[ ] Hand title\n")).unwrap();

        // Cache is empty; manager must on-demand parse + upsert.
        let entry = manager
            .get_journal_entry(&db, 7, rel.to_string())
            .await
            .unwrap()
            .expect("fall-back path");
        assert_eq!(entry.frontmatter.slug, "handwritten");
        // Second call now hits the cache.
        let entry2 = manager
            .get_journal_entry(&db, 7, rel.to_string())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(entry2.title, entry.title);
    }

    #[tokio::test]
    async fn list_journal_entries_returns_empty_for_uninitialised_project() {
        // No init for project_id=99 — manager has no entry, so cache
        // returns empty Vec (NotInitialized would break Today UX).
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ocul-pm.db");
        let db = Db::open(db_path).await.unwrap();
        let manager = OculpmManager::new();
        // list_journal_entries doesn't touch manager state (only cache),
        // so it shouldn't error for an unknown project.
        let rows = manager
            .list_journal_entries(&db, 99, None, EntryFilters::default())
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn create_manual_entry_with_explicit_session_id_keeps_it() {
        let (manager, db, _dir, _root) = fresh_manager_and_db().await;
        let mut draft = minimal_draft("explicit-sid");
        draft.session_id = Some("20260524-042".to_string());
        let entry = manager
            .create_manual_journal_entry(&db, 7, draft)
            .await
            .unwrap();
        assert_eq!(entry.frontmatter.session_id, "20260524-042");
    }

    #[tokio::test]
    async fn create_manual_entry_planned_status_uses_unchecked_marker() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let mut draft = minimal_draft("planned-x");
        draft.status = Some(EntryStatus::Planned);
        let entry = manager
            .create_manual_journal_entry(&db, 7, draft)
            .await
            .unwrap();
        let raw =
            std::fs::read_to_string(project_root.join(".oculpm/journal").join(&entry.relative_path))
                .unwrap();
        // Body starts with "[ ] Manual entry title"
        assert!(raw.contains("[ ] Manual entry title"), "raw: {raw}");
        assert_eq!(entry.checkbox, Some(false));
    }

    // ─── W4-PR3 — forbidden files_touched reject ──────────────────────

    #[tokio::test]
    async fn create_manual_entry_rejects_forbidden_files_touched() {
        let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
        let mut draft = minimal_draft("with-secret");
        draft.files_touched = vec![
            crate::oculpm::spec::FileTouched {
                path: "src/a.rs".to_string(),
                op: crate::oculpm::spec::FileOp::Update,
                bytes_added: None,
                bytes_removed: None,
                rename_from: None,
            },
            // `.env.local` is in default `forbid_journal_for_paths`
            // (`.env.*` + `**/.env.*`).
            crate::oculpm::spec::FileTouched {
                path: "src/.env.local".to_string(),
                op: crate::oculpm::spec::FileOp::Update,
                bytes_added: None,
                bytes_removed: None,
                rename_from: None,
            },
        ];
        let res = manager.create_manual_journal_entry(&db, 7, draft).await;
        match res {
            Err(OculpmError::ForbiddenJournalPath { paths }) => {
                assert_eq!(paths, vec!["src/.env.local".to_string()]);
            }
            other => panic!("expected ForbiddenJournalPath, got {other:?}"),
        }

        // No journal file should have been written.
        let journal_root = project_root.join(".oculpm/journal");
        if journal_root.exists() {
            let any_md = walkdir::WalkDir::new(&journal_root)
                .into_iter()
                .flatten()
                .any(|e| e.path().extension().is_some_and(|ext| ext == "md"));
            assert!(!any_md, "no .md should have been written on rejection");
        }
    }

    #[tokio::test]
    async fn create_manual_entry_accepts_when_no_forbidden_paths() {
        let (manager, db, _dir, _root) = fresh_manager_and_db().await;
        // Sanity: a regular draft still succeeds (guards against false
        // positives in the new forbid check).
        let entry = manager
            .create_manual_journal_entry(&db, 7, minimal_draft("clean-path"))
            .await
            .expect("clean draft must succeed");
        assert_eq!(entry.frontmatter.slug, "clean-path");
    }
}

// ─── W4-PR4 — agent drift detection ────────────────────────────────────

mod agent_drift_w4_pr4 {
    use super::*;

    /// Switch the active agent set on the in-memory project entry without
    /// running through `set_config` (which would validate + persist to
    /// disk). Tests only need the in-memory mutation.
    async fn activate(manager: &OculpmManager, project_id: u32, ids: &[&str]) {
        let mut projects = manager.projects.write().await;
        let entry = projects.get_mut(&project_id).unwrap();
        entry.config.agents.active = ids.iter().map(|s| s.to_string()).collect();
    }

    async fn fresh_with_active(active: &[&str]) -> (OculpmManager, Db, tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ocul-pm.db");
        let db = Db::open(db_path).await.expect("open db");
        let manager = OculpmManager::new();
        let project_root = dir.path().join("project");
        std::fs::create_dir_all(&project_root).unwrap();
        manager.init_project(7, &project_root, "ko").await.unwrap();
        activate(&manager, 7, active).await;
        (manager, db, dir, project_root)
    }

    /// (1) External edit of an Overwrite-mode adapter (`cursor`) ⇒
    /// `check_agent_drift` reports drift.
    #[tokio::test]
    async fn cursor_external_edit_is_detected_as_drift() {
        let (manager, db, _dir, root) = fresh_with_active(&["cursor"]).await;
        let report = manager.sync_agents(&db, 7).await.unwrap();
        // Sanity: cursor was actually written + baseline hash recorded.
        let cursor = report.results.iter().find(|r| r.id == "cursor").unwrap();
        assert!(cursor.last_hash.is_some());

        // User / external tool edits the file.
        let cursor_path = root.join(".cursor/rules/ocul-pm.mdc");
        let mut content = std::fs::read_to_string(&cursor_path).unwrap();
        content.push_str("\n# manual edit by user\n");
        std::fs::write(&cursor_path, &content).unwrap();

        let drift = manager
            .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
            .await
            .unwrap();
        let (agent_id, expected, actual) = drift.expect("expected drift after external edit");
        assert_eq!(agent_id, "cursor");
        assert_ne!(expected, actual);
        assert_eq!(expected, cursor.last_hash.clone().unwrap());
    }

    /// (2) Edits OUTSIDE the managed block (Claude Code adapter) ⇒
    /// `check_agent_drift` reports no drift (block hash unchanged).
    #[tokio::test]
    async fn claude_code_outside_block_edit_is_not_drift() {
        let (manager, db, _dir, root) = fresh_with_active(&["claude-code"]).await;
        // Pre-seed user content so the file has both pre/post-block regions.
        let path = root.join(".claude/CLAUDE.md");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "# user header\n\n").unwrap();
        manager.sync_agents(&db, 7).await.unwrap();

        // Append user text AFTER the end marker — the block hash must stay.
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("\n## My personal notes (outside block)\n");
        std::fs::write(&path, &text).unwrap();

        let drift = manager
            .check_agent_drift(&db, 7, ".claude/CLAUDE.md")
            .await
            .unwrap();
        assert!(drift.is_none(), "outside-block edit must not be drift, got {drift:?}");
    }

    /// (3) Edit INSIDE the managed block ⇒ drift detected.
    #[tokio::test]
    async fn claude_code_inside_block_edit_is_drift() {
        let (manager, db, _dir, root) = fresh_with_active(&["claude-code"]).await;
        manager.sync_agents(&db, 7).await.unwrap();

        // Insert one extra line between the begin/end markers.
        let path = root.join(".claude/CLAUDE.md");
        let text = std::fs::read_to_string(&path).unwrap();
        let begin = text.find("<!-- oculpm:begin v1 -->").unwrap();
        let end = text.find("<!-- oculpm:end -->").unwrap();
        // Inject a line right after the begin marker line.
        let begin_line_end = text[begin..].find('\n').map(|n| begin + n + 1).unwrap();
        assert!(begin_line_end < end);
        let mutated = format!(
            "{}# adversarial edit inside block\n{}",
            &text[..begin_line_end],
            &text[begin_line_end..]
        );
        std::fs::write(&path, mutated).unwrap();

        let drift = manager
            .check_agent_drift(&db, 7, ".claude/CLAUDE.md")
            .await
            .unwrap();
        let (agent_id, expected, actual) = drift.expect("inside-block edit must be drift");
        assert_eq!(agent_id, "claude-code");
        assert_ne!(expected, actual);
    }

    /// Re-syncing after drift writes a fresh baseline → next check passes.
    #[tokio::test]
    async fn resync_after_drift_clears_the_alert() {
        let (manager, db, _dir, root) = fresh_with_active(&["cursor"]).await;
        manager.sync_agents(&db, 7).await.unwrap();

        // Drift the file.
        let cursor_path = root.join(".cursor/rules/ocul-pm.mdc");
        std::fs::write(&cursor_path, "drifted\n").unwrap();
        assert!(manager
            .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
            .await
            .unwrap()
            .is_some());

        // User clicks 동기화 → sync_agents rewrites + reseeds the hash.
        manager.sync_agents(&db, 7).await.unwrap();
        let drift = manager
            .check_agent_drift(&db, 7, ".cursor/rules/ocul-pm.mdc")
            .await
            .unwrap();
        assert!(drift.is_none(), "after resync no drift expected, got {drift:?}");
    }
}

// ─── W4-PR5 — compare_layers (index vs journal) ────────────────────────

mod compare_layers_w4_pr5 {
    use super::*;
    use crate::oculpm::spec::{
        Difficulty, EntryStatus, EntryType, FileChangeEvent, FileOp, FileTouched,
        ManualEntryDraft, Severity,
    };

    const SESSION_ID: &str = "20260524-001";
    const WORKDAY: &str = "20260524";

    async fn fresh() -> (OculpmManager, Db, tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ocul-pm.db");
        let db = Db::open(db_path).await.expect("open db");
        let manager = OculpmManager::new();
        let project_root = dir.path().join("project");
        std::fs::create_dir_all(&project_root).unwrap();
        manager.init_project(7, &project_root, "ko").await.unwrap();
        (manager, db, dir, project_root)
    }

    async fn writer(manager: &OculpmManager) -> std::sync::Arc<IndexWriter> {
        manager.projects.read().await.get(&7).unwrap().index_writer.clone()
    }

    async fn append_index_events(manager: &OculpmManager, paths: &[&str]) {
        let writer = writer(manager).await;
        for p in paths {
            let ev = FileChangeEvent {
                ts: "2026-05-24T10:00:00+00:00".to_string(),
                session_id: SESSION_ID.to_string(),
                op: FileOp::Update,
                path: (*p).to_string(),
                hash_before: None,
                hash_after: None,
                bytes: 10,
            };
            writer.append_file_change(&ev).await.expect("append");
        }
    }

    fn draft_with_files(slug: &str, paths: &[&str]) -> ManualEntryDraft {
        ManualEntryDraft {
            entry_type: EntryType::Bug,
            slug: slug.to_string(),
            title: "compare-layers seed".to_string(),
            difficulty: Some(Difficulty::Medium),
            body_markdown: String::new(),
            session_id: Some(SESSION_ID.to_string()),
            files_touched: paths
                .iter()
                .map(|p| FileTouched {
                    path: (*p).to_string(),
                    op: FileOp::Update,
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: None,
                })
                .collect(),
            status: Some(EntryStatus::Done),
            tags: Vec::new(),
            agent: None,
            verified_by_user: None,
        }
    }

    async fn seed_journal(manager: &OculpmManager, db: &Db, slug: &str, paths: &[&str]) {
        manager
            .create_manual_journal_entry(db, 7, draft_with_files(slug, paths))
            .await
            .expect("seed journal");
    }

    /// The workday `create_manual_journal_entry` will stamp — it uses
    /// `Utc::now()`, so a fixture that wants its journal entry and its
    /// watcher session to share a workday must derive the session id from
    /// this rather than hard-coding one.
    async fn today_workday(manager: &OculpmManager) -> String {
        let resolver = manager.projects.read().await.get(&7).unwrap().resolver.clone();
        resolver.workday_of(chrono::Utc::now())
    }

    async fn append_index_events_for(
        manager: &OculpmManager,
        session_id: &str,
        paths: &[&str],
    ) {
        let writer = writer(manager).await;
        for p in paths {
            let ev = FileChangeEvent {
                ts: "2026-05-24T10:00:00+00:00".to_string(),
                session_id: session_id.to_string(),
                op: FileOp::Update,
                path: (*p).to_string(),
                hash_before: None,
                hash_after: None,
                bytes: 10,
            };
            writer.append_file_change(&ev).await.expect("append");
        }
    }

    async fn seed_journal_with_session(
        manager: &OculpmManager,
        db: &Db,
        slug: &str,
        session_id: &str,
        paths: &[&str],
    ) {
        let mut draft = draft_with_files(slug, paths);
        draft.session_id = Some(session_id.to_string());
        manager
            .create_manual_journal_entry(db, 7, draft)
            .await
            .expect("seed journal");
    }

    /// Record a real watcher session in `sessions.json` so timestamp-based
    /// attribution has something to resolve against.
    async fn seed_session(manager: &OculpmManager, id: &str, started_at: &str) {
        let writer = writer(manager).await;
        writer
            .upsert_session(&crate::oculpm::spec::Session {
                id: id.to_string(),
                started_at: started_at.to_string(),
                ended_at: None,
                ended_reason: None,
                active_window_ms: 0,
                file_event_count: 0,
                files_unique: 0,
                git_head_at_start: None,
                git_head_at_end: None,
                agent_label_guess: None,
                linked_journal_entries: Vec::new(),
            })
            .await
            .expect("seed session");
    }

    /// Dogfooding regression (2026-08-20) — the audit's headline bug.
    ///
    /// Agents mint their own `session_id` (`manual-<workday>-<hhmmss>`),
    /// which never equals the watcher's `<workday>-NNN`. The session-exact
    /// join therefore saw an empty journal set and reported *every* changed
    /// file as 미기록. `unrecorded` must judge by workday coverage instead
    /// and report exactly the one file no entry mentions.
    ///
    /// Note: no `sessions.json` record here, so timestamp attribution has
    /// nothing to resolve against — this pins the workday-coverage arm on
    /// its own. `foreign_session_id_is_resolved_by_timestamp` covers the
    /// case where a session record exists.
    #[tokio::test]
    async fn foreign_session_id_does_not_fake_unrecorded_files() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let watcher_session = format!("{workday}-002");

        let index = ["src/a.rs", "src/b.rs", "src/c.rs", "src/d.rs"];
        append_index_events_for(&manager, &watcher_session, &index).await;

        // Two entries, both stamped with the agent's own dialect, together
        // covering 3 of the 4 changed files. `src/d.rs` is the real miss.
        seed_journal_with_session(
            &manager,
            &db,
            "agent-dialect-one",
            &format!("manual-{workday}-205400"),
            &["src/a.rs", "src/b.rs"],
        )
        .await;
        seed_journal_with_session(
            &manager,
            &db,
            "agent-dialect-two",
            &format!("manual-{workday}-205500"),
            &["src/c.rs"],
        )
        .await;

        let cmp = manager
            .compare_layers(&db, 7, &watcher_session)
            .await
            .unwrap();

        // Session-exact view still reports the dialect mismatch verbatim —
        // that field's contract is unchanged.
        assert_eq!(cmp.only_in_index.len(), 4);
        assert!(cmp.journal_files.is_empty());

        // The honest view: only the genuinely unjournaled file.
        assert_eq!(cmp.unrecorded, vec!["src/d.rs".to_string()]);
        // 3 of 4 covered = 0.75 → Warning (not Critical).
        assert_eq!(cmp.unrecorded_severity, Severity::Warning);
    }

    /// The follow-up fix: with a real session record on disk, a
    /// foreign-dialect entry is attributed by its `created_at`, so the
    /// session-exact numbers (`matched` / `journal_files` / `jaccard_index`)
    /// come back to life instead of reading as a total mismatch.
    #[tokio::test]
    async fn foreign_session_id_is_resolved_by_timestamp() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let watcher_session = format!("{workday}-002");

        // Session opened well before the entry is written — the entry
        // trails it, exactly as a real journal write does.
        seed_session(
            &manager,
            &watcher_session,
            &chrono::Utc::now()
                .checked_sub_signed(chrono::Duration::hours(1))
                .unwrap()
                .fixed_offset()
                .to_rfc3339(),
        )
        .await;

        let index = ["src/a.rs", "src/b.rs", "src/c.rs"];
        append_index_events_for(&manager, &watcher_session, &index).await;
        seed_journal_with_session(
            &manager,
            &db,
            "resolved-by-time",
            &format!("manual-{workday}-205400"),
            &index,
        )
        .await;

        let cmp = manager
            .compare_layers(&db, 7, &watcher_session)
            .await
            .unwrap();

        // Before the fix these were 0 / empty / 0.0 respectively.
        assert_eq!(cmp.matched.len(), 3, "{:?}", cmp.matched);
        assert_eq!(cmp.journal_files.len(), 3);
        assert!(cmp.only_in_index.is_empty(), "{:?}", cmp.only_in_index);
        assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
        assert!(cmp.unrecorded.is_empty());
    }

    /// A synthetic id must never steal an entry that truthfully names a
    /// *different* watcher session — arm 2 only ever adds, never reassigns.
    #[tokio::test]
    async fn truthful_session_ids_are_not_reattributed_by_time() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let older = format!("{workday}-001");
        let newer = format!("{workday}-002");
        let now = chrono::Utc::now();

        seed_session(
            &manager,
            &older,
            &now.checked_sub_signed(chrono::Duration::hours(3))
                .unwrap()
                .fixed_offset()
                .to_rfc3339(),
        )
        .await;
        seed_session(
            &manager,
            &newer,
            &now.checked_sub_signed(chrono::Duration::hours(1))
                .unwrap()
                .fixed_offset()
                .to_rfc3339(),
        )
        .await;

        append_index_events_for(&manager, &newer, &["src/only_newer.rs"]).await;
        // Entry is written NOW (so time-resolution would point at `newer`)
        // but it explicitly names `older`. The explicit claim wins.
        seed_journal_with_session(&manager, &db, "explicit", &older, &["src/claimed.rs"]).await;

        let cmp = manager.compare_layers(&db, 7, &newer).await.unwrap();
        assert!(
            !cmp.journal_files.contains(&"src/claimed.rs".to_string()),
            "entry naming {older} must not be attributed to {newer}: {:?}",
            cmp.journal_files
        );

        let older_cmp = manager.compare_layers(&db, 7, &older).await.unwrap();
        assert_eq!(older_cmp.journal_files, vec!["src/claimed.rs".to_string()]);
    }

    /// `linked_journal_entries` was written as `Vec::new()` everywhere and
    /// read by nobody — a permanently empty field in a documented on-disk
    /// shape. It is now derived on read from the same attribution, so a
    /// foreign-dialect entry still lands on its session.
    #[tokio::test]
    async fn list_sessions_derives_journal_links() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let now = chrono::Utc::now();
        let early = format!("{workday}-001");
        let late = format!("{workday}-002");

        seed_session(
            &manager,
            &early,
            &(now - chrono::Duration::hours(3)).fixed_offset().to_rfc3339(),
        )
        .await;
        seed_session(
            &manager,
            &late,
            &(now - chrono::Duration::hours(1)).fixed_offset().to_rfc3339(),
        )
        .await;

        // Written now → resolves to the later session.
        seed_journal_with_session(
            &manager,
            &db,
            "linked-by-time",
            &format!("manual-{workday}-235959"),
            &["src/a.rs"],
        )
        .await;
        // Explicitly claims the earlier one.
        seed_journal_with_session(&manager, &db, "linked-explicit", &early, &["src/b.rs"]).await;

        let sessions = manager
            .list_sessions(&db, 7, Some(workday.clone()))
            .await
            .unwrap();

        let by_id = |id: &str| -> Vec<String> {
            sessions
                .iter()
                .find(|s| s.id == id)
                .expect("session present")
                .linked_journal_entries
                .clone()
        };
        let late_links = by_id(&late);
        assert_eq!(late_links.len(), 1, "{late_links:?}");
        assert!(late_links[0].contains("linked-by-time"), "{late_links:?}");

        let early_links = by_id(&early);
        assert_eq!(early_links.len(), 1, "{early_links:?}");
        assert!(early_links[0].contains("linked-explicit"), "{early_links:?}");
    }

    /// Full coverage across foreign-dialect entries → nothing to report,
    /// which is what makes the card stay hidden on an honest day.
    #[tokio::test]
    async fn fully_journaled_session_reports_nothing_unrecorded() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let watcher_session = format!("{workday}-003");

        let index = ["src/a.rs", "src/b.rs"];
        append_index_events_for(&manager, &watcher_session, &index).await;
        seed_journal_with_session(
            &manager,
            &db,
            "covered",
            &format!("manual-{workday}-210000"),
            &index,
        )
        .await;

        let cmp = manager
            .compare_layers(&db, 7, &watcher_session)
            .await
            .unwrap();
        assert!(cmp.unrecorded.is_empty(), "{:?}", cmp.unrecorded);
        assert_eq!(cmp.unrecorded_severity, Severity::Ok);
    }

    /// Noise classes fixed alongside the session-id bug must never reach
    /// `unrecorded` — no journal could ever list them.
    #[tokio::test]
    async fn noise_paths_never_count_as_unrecorded() {
        let (manager, db, _dir, _root) = fresh().await;
        let workday = today_workday(&manager).await;
        let watcher_session = format!("{workday}-004");

        append_index_events_for(
            &manager,
            &watcher_session,
            &[
                "src/real.rs",
                // macOS sandbox atomic-write temp.
                "landing/shots/03-diff.jpg.sb-0aaecef3-EzZZ48",
                // Nested `.oculpm/` — another project's bookkeeping.
                "docs/acp-panel/spike/.oculpm/hooks/claude-events.jsonl",
                "docs/acp-panel/spike/.oculpm",
                // Nested agent state.
                "packages/web/.claude/settings.json",
            ],
        )
        .await;
        seed_journal_with_session(
            &manager,
            &db,
            "only-real",
            &format!("manual-{workday}-211500"),
            &["src/real.rs"],
        )
        .await;

        let cmp = manager
            .compare_layers(&db, 7, &watcher_session)
            .await
            .unwrap();
        assert!(cmp.unrecorded.is_empty(), "{:?}", cmp.unrecorded);
        assert_eq!(cmp.index_files, vec!["src/real.rs".to_string()]);
    }

    /// Both empty → trivially `Ok` with jaccard 1.0 (treated as "no
    /// activity nothing to disagree on" by the severity bucketer).
    #[tokio::test]
    async fn empty_session_is_ok() {
        let (manager, db, _dir, _root) = fresh().await;
        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(cmp.session_id, SESSION_ID);
        assert_eq!(cmp.workday, WORKDAY);
        assert!(cmp.index_files.is_empty());
        assert!(cmp.journal_files.is_empty());
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
        assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
    }

    /// 10 / 10 perfect overlap → `Ok`, jaccard 1.0.
    #[tokio::test]
    async fn perfect_overlap_is_ok() {
        let (manager, db, _dir, _root) = fresh().await;
        let files: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
        let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
        append_index_events(&manager, &refs).await;
        seed_journal(&manager, &db, "perfect", &refs).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(cmp.matched.len(), 10);
        assert!(cmp.only_in_index.is_empty());
        assert!(cmp.only_in_journal.is_empty());
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
        assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
    }

    /// 10 / 9 (9 matched, 1 missing narrative) → jaccard 9/10 = 0.9 → `Ok`.
    #[tokio::test]
    async fn near_perfect_is_ok() {
        let (manager, db, _dir, _root) = fresh().await;
        let index: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
        let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
        append_index_events(&manager, &index_refs).await;
        // Journal records 9 of the 10 — file_9 missing.
        let journal_refs: Vec<&str> = index_refs[..9].to_vec();
        seed_journal(&manager, &db, "near", &journal_refs).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(cmp.matched.len(), 9);
        assert_eq!(cmp.only_in_index, vec!["src/file_9.rs".to_string()]);
        assert!(cmp.only_in_journal.is_empty());
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
        assert!((cmp.jaccard_index - 0.9).abs() < 0.01);
    }

    /// 8 / 8 with 6 matched + 2 hallucinated → jaccard 6 / (8 + 8 - 6) = 0.6
    /// → `Warning`.
    #[tokio::test]
    async fn moderate_mismatch_is_warning() {
        let (manager, db, _dir, _root) = fresh().await;
        let index: Vec<String> = (0..8).map(|i| format!("src/file_{i}.rs")).collect();
        let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
        append_index_events(&manager, &index_refs).await;
        // Journal: 6 matching + 2 hallucinated.
        let journal: Vec<String> = (0..6)
            .map(|i| format!("src/file_{i}.rs"))
            .chain(["src/hallucinated_a.rs".to_string(), "src/hallucinated_b.rs".to_string()])
            .collect();
        let journal_refs: Vec<&str> = journal.iter().map(|s| s.as_str()).collect();
        seed_journal(&manager, &db, "moderate", &journal_refs).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(cmp.matched.len(), 6);
        assert_eq!(cmp.only_in_index.len(), 2);
        assert_eq!(cmp.only_in_journal.len(), 2);
        assert_eq!(cmp.mismatch_severity, Severity::Warning);
        assert!(
            (cmp.jaccard_index - 0.6).abs() < 0.05,
            "jaccard {} not near 0.6",
            cmp.jaccard_index
        );
    }

    /// 10 / 5 with 4 matched + 1 hallucinated → jaccard 4/11 ≈ 0.36 →
    /// `Critical`.
    #[tokio::test]
    async fn heavy_mismatch_is_critical() {
        let (manager, db, _dir, _root) = fresh().await;
        let index: Vec<String> = (0..10).map(|i| format!("src/file_{i}.rs")).collect();
        let index_refs: Vec<&str> = index.iter().map(|s| s.as_str()).collect();
        append_index_events(&manager, &index_refs).await;
        // Journal: 4 matched + 1 hallucinated.
        let journal: Vec<String> = (0..4)
            .map(|i| format!("src/file_{i}.rs"))
            .chain(["src/hallucinated.rs".to_string()])
            .collect();
        let journal_refs: Vec<&str> = journal.iter().map(|s| s.as_str()).collect();
        seed_journal(&manager, &db, "heavy", &journal_refs).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(cmp.matched.len(), 4);
        assert_eq!(cmp.only_in_index.len(), 6);
        assert_eq!(cmp.only_in_journal, vec!["src/hallucinated.rs".to_string()]);
        assert_eq!(cmp.mismatch_severity, Severity::Critical);
    }

    /// Forbidden paths in EITHER set must be stripped before the
    /// comparison so they don't tank the jaccard. Without this, the index
    /// (which already masks forbidden paths via watcher) and the journal
    /// (which lists them verbatim) would always disagree.
    #[tokio::test]
    async fn forbidden_paths_are_excluded_from_both_sides() {
        let (manager, db, _dir, _root) = fresh().await;
        // Index has 3 real paths + 1 masked redacted entry (the watcher
        // would produce these for `.env` writes).
        let writer = writer(&manager).await;
        for p in &["src/a.rs", "src/b.rs", "src/c.rs", "**redacted/sensitive**:abcd1234"] {
            let ev = FileChangeEvent {
                ts: "2026-05-24T10:00:00+00:00".to_string(),
                session_id: SESSION_ID.to_string(),
                op: FileOp::Update,
                path: (*p).to_string(),
                hash_before: None,
                hash_after: None,
                bytes: 10,
            };
            writer.append_file_change(&ev).await.unwrap();
        }
        // Journal: same 3 real paths only (no forbidden — they'd be
        // reject by create_manual_journal_entry per W4-PR3 anyway).
        seed_journal(&manager, &db, "stripped", &["src/a.rs", "src/b.rs", "src/c.rs"]).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        // Redacted path is stripped from index_files → exact match.
        assert_eq!(cmp.index_files.len(), 3);
        assert_eq!(cmp.matched.len(), 3);
        assert!(cmp.only_in_index.is_empty());
        assert!(cmp.only_in_journal.is_empty());
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
    }

    /// W4 dogfooding (2026-05-27) — atomic-write tmps, editor noise, and
    /// agent-state peers must be stripped from the index side of the
    /// comparison so they don't manufacture fake `journal 누락` rows.
    /// Without this, the user's storygame session showed 18/3 with
    /// jaccard 17% even though all 3 real files were correctly journaled.
    #[tokio::test]
    async fn noise_paths_are_excluded_from_index_side() {
        let (manager, db, _dir, _root) = fresh().await;
        // Simulate a session that wrote one real file via 4 atomic-write
        // bursts (one rename target + 3 random-suffix tmp files), plus a
        // few `.claude/` state writes the agent did in the background.
        append_index_events(
            &manager,
            &[
                "game.js",
                "game.js.tmp.5C0aH-rJ",
                "game.js.tmp.iy3-fa9",
                "game.js.tmp.AbcDef1",
                ".claude/settings.json",
                ".claude/settings.local.json",
                "src/main.rs.swp",
                ".DS_Store",
            ],
        )
        .await;
        // Journal: the LLM correctly logs only the real file.
        seed_journal(&manager, &db, "noise", &["game.js"]).await;

        let cmp = manager.compare_layers(&db, 7, SESSION_ID).await.unwrap();
        assert_eq!(
            cmp.index_files,
            vec!["game.js".to_string()],
            "noise must be stripped from the index side",
        );
        assert_eq!(cmp.matched.len(), 1);
        assert!(cmp.only_in_index.is_empty(), "{:?}", cmp.only_in_index);
        assert!(cmp.only_in_journal.is_empty());
        assert_eq!(cmp.mismatch_severity, Severity::Ok);
        assert!((cmp.jaccard_index - 1.0).abs() < f32::EPSILON);
    }
}


#[tokio::test]
async fn init_seeds_template_language_and_never_overrides_an_existing_config() {
    // 영어 사용자에게 한국어 기록 규칙을 심지 않기 위한 것 —
    // `master_en.md.tpl` 은 예전부터 있었지만 이 배선이 없어 **도달 불가**였다.
    let dir = tempfile::tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "en").await.unwrap();
    let cfg = OculpmConfig::load(&dir.path().join(".oculpm").join("config.toml")).unwrap();
    assert_eq!(cfg.agents.template_language, "en");
    // 이 값이 곧 마스터 선택이다 (agents::embedded_master). `_template.md`
    // 자체는 sync 시점에 시드되므로 여기서는 config 계약만 못박는다.
    assert_eq!(
        crate::oculpm::agents::embedded_master(&cfg.agents.template_language),
        crate::oculpm::agents::MASTER_EN
    );

    // 이미 config 가 있으면 무시된다 — 사용자가 고른 값을 덮지 않는다.
    let manager2 = OculpmManager::new();
    manager2.init_project(2, dir.path(), "ko").await.unwrap();
    let after = OculpmConfig::load(&dir.path().join(".oculpm").join("config.toml")).unwrap();
    assert_eq!(after.agents.template_language, "en", "기존 설정을 덮지 않는다");
}

//! `index` 의 테스트. 본문에서 갈라 나왔다 (2026-09-04) — 파일 크기
//! 래칫이 이 파일을 짚었고, 경계가 가장 뚜렷한 덩어리가 여기였다.
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use crate::oculpm::spec::{EndedReason, FileOp};
use std::sync::Arc;
use tempfile::tempdir;

fn make_writer(root: &Path) -> IndexWriter {
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    IndexWriter::new(root.to_path_buf(), resolver)
}

fn make_event(session_id: &str, seq: u32, path: &str) -> FileChangeEvent {
    FileChangeEvent {
        ts: format!("2026-05-22T20:55:{:02}.000+09:00", seq % 60),
        session_id: session_id.to_string(),
        op: FileOp::Update,
        path: path.to_string(),
        hash_before: Some("blake3:before".into()),
        hash_after: Some("blake3:after".into()),
        bytes: 1024 + seq,
    }
}

fn make_session(id: &str, started_at: &str) -> Session {
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
        agent_sessions: Vec::new(),
        linked_journal_entries: Vec::new(),
    }
}

/// Case 1 — append 100 events, read them back in order, payload byte-equal.
#[tokio::test]
async fn append_and_read_roundtrip_preserves_order() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    let sid = "20260522-001";
    for i in 0..100 {
        writer
            .append_file_change(&make_event(sid, i, &format!("src/file_{i}.rs")))
            .await
            .unwrap();
    }
    let events = writer.read_file_changes("20260522", None).await.unwrap();
    assert_eq!(events.len(), 100);
    for (i, ev) in events.iter().enumerate() {
        assert_eq!(ev.path, format!("src/file_{i}.rs"));
        assert_eq!(ev.bytes, 1024 + i as u32);
    }
}

/// Case 2 — corrupted last line is dropped + backed up; main file truncated.
#[tokio::test]
async fn corrupted_tail_is_backed_up_and_truncated() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    let sid = "20260522-001";
    writer
        .append_file_change(&make_event(sid, 0, "ok1.rs"))
        .await
        .unwrap();
    writer
        .append_file_change(&make_event(sid, 1, "ok2.rs"))
        .await
        .unwrap();

    // Append a half-written JSON line (no trailing '\n').
    let path = writer.file_changes_path("20260522");
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        f.write_all(b"{\"ts\":\"x\",\"session_id\"").unwrap();
    }

    let events = writer.read_file_changes("20260522", None).await.unwrap();
    assert_eq!(events.len(), 2, "corrupted tail must be dropped");
    assert_eq!(events[0].path, "ok1.rs");
    assert_eq!(events[1].path, "ok2.rs");

    // Main file shrunk to just the two valid lines.
    let after = std::fs::read_to_string(&path).unwrap();
    assert_eq!(after.lines().count(), 2);

    // Backup exists with original (longer) content.
    let dir_path = path.parent().unwrap();
    let backups: Vec<_> = std::fs::read_dir(dir_path)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".corrupted-tail-"))
        .collect();
    assert_eq!(backups.len(), 1, "exactly one backup must be created");
    let backup_bytes = std::fs::read(backups[0].path()).unwrap();
    assert!(
        backup_bytes.len() > after.len(),
        "backup must retain the full pre-truncation bytes"
    );
}

/// Case 3 — 10 tasks × 100 lines concurrent append: all 1000 lines land
/// without interleaving (relies on POSIX O_APPEND single-write atomicity).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_append_does_not_lose_lines() {
    let dir = tempdir().unwrap();
    let writer = Arc::new(make_writer(dir.path()));
    let sid = "20260522-001";

    let mut handles = Vec::new();
    for task_id in 0..10u32 {
        let w = writer.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..100u32 {
                let ev = make_event(sid, task_id * 100 + i, &format!("task{task_id}/file{i}.rs"));
                w.append_file_change(&ev).await.unwrap();
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }

    let events = writer.read_file_changes("20260522", None).await.unwrap();
    assert_eq!(events.len(), 1000, "all concurrent appends must persist");
}

/// Case 4 — merkle_root is deterministic for the same input; changes when
/// any file changes.
#[tokio::test]
async fn snapshot_merkle_root_is_deterministic() {
    let dir = tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), b"alpha").unwrap();
    std::fs::write(dir.path().join("b.txt"), b"bravo").unwrap();
    std::fs::write(dir.path().join("c.txt"), b"charlie").unwrap();
    let writer = make_writer(dir.path());

    let s1 = writer
        .capture_snapshot("20260522", SnapshotKind::Open)
        .await
        .unwrap();
    let s2 = writer
        .capture_snapshot("20260522", SnapshotKind::Open)
        .await
        .unwrap();
    assert_eq!(s1.tree_summary.merkle_root, s2.tree_summary.merkle_root);
    assert_eq!(s1.tree_summary.total_tracked_files, 3);
    assert!(s1.tree_summary.merkle_root.starts_with("blake3:"));

    // Disk file persisted.
    assert!(dir
        .path()
        .join(".oculpm/index/20260522/snapshot_open.json")
        .exists());

    // Change a file → merkle changes.
    std::fs::write(dir.path().join("a.txt"), b"alpha-mutated").unwrap();
    let s3 = writer
        .capture_snapshot("20260522", SnapshotKind::Close)
        .await
        .unwrap();
    assert_ne!(s1.tree_summary.merkle_root, s3.tree_summary.merkle_root);
    assert!(dir
        .path()
        .join(".oculpm/index/20260522/snapshot_close.json")
        .exists());
}

/// Case 5 — sessions arrive in started_at-descending order; on-disk file
/// stores them ASC.
#[tokio::test]
async fn upsert_session_sorts_by_started_at_asc() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    // Insert in non-monotonic order.
    writer
        .upsert_session(&make_session("20260522-002", "2026-05-22T11:00:00+09:00"))
        .await
        .unwrap();
    writer
        .upsert_session(&make_session("20260522-001", "2026-05-22T09:00:00+09:00"))
        .await
        .unwrap();
    writer
        .upsert_session(&make_session("20260522-003", "2026-05-22T13:00:00+09:00"))
        .await
        .unwrap();

    let sessions = writer.list_sessions("20260522").await.unwrap();
    let ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec!["20260522-001", "20260522-002", "20260522-003"]);
}

/// Case 6 — finalizing an already-ended session is idempotent: returns the
/// existing record without overwriting ended_reason/ended_at.
#[tokio::test]
async fn finalize_session_is_idempotent_on_ended_session() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    writer
        .upsert_session(&make_session("20260522-001", "2026-05-22T09:00:00+09:00"))
        .await
        .unwrap();

    let first = writer
        .finalize_session(
            "20260522-001",
            SessionEnd {
                ended_at: "2026-05-22T10:00:00+09:00".into(),
                ended_reason: EndedReason::InactivityTimeout,
            },
        )
        .await
        .unwrap();
    assert_eq!(first.ended_at.as_deref(), Some("2026-05-22T10:00:00+09:00"));
    assert!(matches!(
        first.ended_reason,
        Some(EndedReason::InactivityTimeout)
    ));

    // Second call with a different reason — must NOT overwrite.
    let second = writer
        .finalize_session(
            "20260522-001",
            SessionEnd {
                ended_at: "2026-05-22T12:34:56+09:00".into(),
                ended_reason: EndedReason::AppQuit,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        second.ended_at.as_deref(),
        Some("2026-05-22T10:00:00+09:00")
    );
    assert!(matches!(
        second.ended_reason,
        Some(EndedReason::InactivityTimeout)
    ));

    // Missing session → explicit SessionNotFound.
    let err = writer
        .finalize_session(
            "20260522-999",
            SessionEnd {
                ended_at: "2026-05-22T13:00:00+09:00".into(),
                ended_reason: EndedReason::Manual,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, OculpmError::SessionNotFound { .. }));
}

/// Case 7 — `since` filter returns only events strictly greater than the
/// supplied timestamp.
#[tokio::test]
async fn read_file_changes_since_filter() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    let sid = "20260522-001";

    let make_ts = |sec: u32| -> FileChangeEvent {
        FileChangeEvent {
            ts: format!("2026-05-22T20:55:{:02}.000+09:00", sec),
            session_id: sid.into(),
            op: FileOp::Update,
            path: format!("f{sec}.rs"),
            hash_before: None,
            hash_after: None,
            bytes: 10,
        }
    };
    for sec in [1, 5, 10, 15, 20] {
        writer.append_file_change(&make_ts(sec)).await.unwrap();
    }

    let after_10 = writer
        .read_file_changes("20260522", Some("2026-05-22T20:55:10.000+09:00"))
        .await
        .unwrap();
    let paths: Vec<_> = after_10.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, vec!["f15.rs", "f20.rs"], "strictly greater than");
}

/// Bonus — invalid session_id format is rejected without touching disk.
#[tokio::test]
async fn invalid_session_id_is_rejected() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path());
    let bad = make_session("bogus", "2026-05-22T09:00:00+09:00");
    let err = writer.upsert_session(&bad).await.unwrap_err();
    assert!(matches!(err, OculpmError::InvalidSessionId(_)));
    // No directory created.
    assert!(!dir.path().join(".oculpm/index").exists());
}

// ─── W2-PR5 — integrity_warning emit path ──────────────────────────────

/// PR5 test — corrupted ndjson triggers the integrity_warning emit path
/// without panic when `emit_ctx` is `None`. The `emit_integrity_warning`
/// helper is called but safely no-ops.
#[tokio::test]
async fn integrity_warning_emit_path_safe_without_app_handle() {
    let dir = tempdir().unwrap();
    let writer = make_writer(dir.path()); // emit_ctx = None
    let sid = "20260522-001";

    writer
        .append_file_change(&make_event(sid, 0, "ok.rs"))
        .await
        .unwrap();

    // Inject a corrupted line.
    let path = writer.file_changes_path("20260522");
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        f.write_all(b"NOT-JSON\n").unwrap();
    }

    // This must not panic even though emit_integrity_warning is called.
    let events = writer.read_file_changes("20260522", None).await.unwrap();
    assert_eq!(events.len(), 1, "only valid event survives");
    assert_eq!(events[0].path, "ok.rs");

    // Backup file created as evidence of corruption recovery.
    let dir_path = path.parent().unwrap();
    let backups: Vec<_> = std::fs::read_dir(dir_path)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".corrupted-tail-"))
        .collect();
    assert_eq!(backups.len(), 1, "corruption backup must exist");
}

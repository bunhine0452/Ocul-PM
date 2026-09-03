//! `session` 의 테스트. 본문에서 갈라 나왔다 (2026-09-04) — 파일 크기
//! 래칫(`scripts/check-file-sizes.mjs`)이 이 파일을 짚었고, 그 안에서
//! 경계가 가장 뚜렷한 덩어리가 여기였다. `manager/tests.rs` 와 같은 모양이고
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use crate::oculpm::spec::{
    AgentsConfig, FileOp, GitConfig, OculpmConfig, SessionConfig, WatcherConfig, WorkdayConfig,
};
use tempfile::tempdir;

fn fast_config() -> SessionConfig {
    SessionConfig {
        inactivity_timeout_minutes: 1, // 60s — but tests use force-fire / very short waits
        // Disable resume so the existing case-3 test (which asserts
        // sessions[0] and sessions[1] are distinct after InactivityFired)
        // keeps its semantics. Resume behavior is exercised by the
        // dedicated tests below.
        session_resume_grace_minutes: 0,
    }
}

fn build_writer(root: &std::path::Path) -> Arc<IndexWriter> {
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    Arc::new(IndexWriter::new(root.to_path_buf(), resolver))
}

fn make_event(path: &str) -> FileChangeEvent {
    FileChangeEvent {
        ts: Utc::now().to_rfc3339(),
        session_id: "ignored-by-actor".into(),
        op: FileOp::Update,
        path: path.into(),
        hash_before: None,
        hash_after: None,
        bytes: 100,
    }
}

/// Helper: read the only session in today's workday.
async fn read_only_session(writer: &IndexWriter, workday: &str) -> Session {
    let sessions = writer.list_sessions(workday).await.unwrap();
    assert_eq!(
        sessions.len(),
        1,
        "expected one session, got {:?}",
        sessions
    );
    sessions.into_iter().next().unwrap()
}

fn today_workday() -> String {
    WorkdayResolver::new("UTC", "00:00")
        .unwrap()
        .workday_of(Utc::now())
}

/// Case 1 — Idle → Active on first activity. session_id format,
/// snapshot_open captured, file_event_count = 1, files_unique = 1.
#[tokio::test]
async fn idle_to_active_on_first_activity() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    // Round-trip through Shutdown so the activity command is processed.
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let session = read_only_session(&writer, &workday).await;
    assert!(session.id.starts_with(&workday));
    assert!(session.id.ends_with("-001"));
    assert_eq!(session.file_event_count, 1);
    assert_eq!(session.files_unique, 1);
    assert!(writer.snapshot_exists(&workday, SnapshotKind::Open));
    // Shutdown finalized with app_quit.
    assert_eq!(
        session.ended_reason.unwrap() as u8,
        EndedReason::AppQuit as u8
    );
}

/// PR-CI0 — hook SessionStart from Idle opens exactly one session with a
/// measured agent label; hook SessionEnd closes it with AgentExit.
#[tokio::test]
async fn hook_signals_open_label_and_close_precisely() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.hook_agent_active("claude-code", "conv-a").unwrap();
    // A turn Stop while Active must NOT split into a second session.
    actor.hook_agent_active("claude-code", "conv-a").unwrap();
    actor.hook_agent_ended("conv-a").unwrap();
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let session = read_only_session(&writer, &workday).await;
    assert_eq!(session.agent_label_guess.as_deref(), Some("claude-code"));
    // 같은 대화가 매 턴 신호를 보내도 참여자는 하나다.
    assert_eq!(session.agent_sessions, vec!["conv-a".to_string()]);
    assert_eq!(
        session.ended_reason.unwrap() as u8,
        EndedReason::AgentExit as u8
    );
    assert!(session.ended_at.is_some());
}

/// 터미널 분할 회귀 — 동시에 도는 대화 N개가 **전부** 기록에 남는다.
///
/// 예전에는 훅이 대화마다 다른 `session_id` 를 들고 왔는데도 액터에는 상수
/// 라벨만 넘어가, 4분할한 CLI 가 세션 하나·에이전트 하나로 보였다. 여기서
/// 지키는 것은 둘이다: 작업 세션은 여전히 **하나**이고(파일 활동의 그릇은
/// 쪼개지 않는다), 참여한 대화는 **넷 다** 남는다.
#[tokio::test]
async fn parallel_agent_conversations_are_all_recorded() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    // 4분할 터미널: 대화 넷이 서로 겹쳐 돈다.
    for conv in ["conv-1", "conv-2", "conv-3", "conv-4"] {
        actor.hook_agent_active("claude-code", conv).unwrap();
    }
    // 셋이 먼저 끝나도 마지막 하나가 살아 있으면 세션은 닫히지 않는다
    // (열린-집합 판정은 watcher 쪽이고, 여기서는 참여 기록만 본다).
    actor.hook_agent_active("claude-code", "conv-2").unwrap();
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let sessions = writer.list_sessions(&workday).await.unwrap();
    assert_eq!(sessions.len(), 1, "작업 세션은 하나로 남아야 한다");
    assert_eq!(
        sessions[0].agent_sessions,
        vec![
            "conv-1".to_string(),
            "conv-2".to_string(),
            "conv-3".to_string(),
            "conv-4".to_string()
        ],
        "동시에 돈 대화가 전부 남아야 한다"
    );
}

/// 빈 대화 id 는 참여자가 아니다 — 셸 통합(OSC 133)처럼 어느 대화인지
/// 모르는 신호가 "대화 1개"라는 거짓말이 되면 안 된다.
#[tokio::test]
async fn blank_conversation_id_is_not_a_participant() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.hook_agent_active("cursor", "").unwrap();
    actor.hook_agent_active("cursor", "   ").unwrap();
    actor.shutdown().await.unwrap();

    let session = read_only_session(&writer, &today_workday()).await;
    assert_eq!(session.agent_label_guess.as_deref(), Some("cursor"));
    assert!(session.agent_sessions.is_empty());
}

/// PR-CI0 — hook activity on an already file-active session labels it in
/// place (no new session), and a hook end after heuristic-Idle is a no-op.
#[tokio::test]
async fn hook_labels_existing_session_and_end_is_noop_when_idle() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor.hook_agent_active("claude-code", "conv-x").unwrap();
    actor
        .cmd_tx
        .send(SessionCmd::InactivityFired)
        .map_err(|_| OculpmError::ActorClosed)
        .unwrap();
    // Late hook end after the heuristic already closed — must not panic
    // or resurrect a session.
    actor.hook_agent_ended("conv-x").unwrap();
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let session = read_only_session(&writer, &workday).await;
    assert_eq!(session.agent_label_guess.as_deref(), Some("claude-code"));
    assert_eq!(session.agent_sessions, vec!["conv-x".to_string()]);
    assert_eq!(
        session.ended_reason.unwrap() as u8,
        EndedReason::InactivityTimeout as u8
    );
}

/// Case 2 — inactivity timer fires → Idle, ended_reason = InactivityTimeout.
/// Uses InactivityFired direct injection to keep the test fast and
/// deterministic (real timer uses 60s minimum from SessionConfig).
#[tokio::test]
async fn inactivity_fired_finalizes_with_timeout_reason() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    // Inject InactivityFired directly to bypass the wall clock.
    actor
        .cmd_tx
        .send(SessionCmd::InactivityFired)
        .map_err(|_| OculpmError::ActorClosed)
        .unwrap();
    actor.shutdown().await.unwrap();

    let session = read_only_session(&writer, &today_workday()).await;
    assert!(matches!(
        session.ended_reason,
        Some(EndedReason::InactivityTimeout)
    ));
    assert!(session.ended_at.is_some(), "ended_at must be set");
}

/// Case 3 — activity AFTER InactivityFired starts a brand-new session.
/// Verifies the Active→Idle→Active round trip + monotonic session IDs.
#[tokio::test]
async fn second_activity_after_idle_starts_new_session() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor
        .cmd_tx
        .send(SessionCmd::InactivityFired)
        .map_err(|_| OculpmError::ActorClosed)
        .unwrap();
    actor.note_activity(make_event("src/b.rs")).unwrap();
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let sessions = writer.list_sessions(&workday).await.unwrap();
    assert_eq!(sessions.len(), 2);
    assert!(sessions[0].id.ends_with("-001"));
    assert!(sessions[1].id.ends_with("-002"));
    // First session finalized via InactivityTimeout, second via AppQuit.
    assert!(matches!(
        sessions[0].ended_reason,
        Some(EndedReason::InactivityTimeout)
    ));
    assert!(matches!(
        sessions[1].ended_reason,
        Some(EndedReason::AppQuit)
    ));
}

/// Case 4 — workday boundary effects: finalize with workday_boundary,
/// snapshot_close for today's workday written, snapshot_open ensured.
/// (We can't easily simulate "boundary moves us to tomorrow" without a
/// clock mock, so we verify the effects that DON'T require advancing the
/// resolver: finalize reason + snapshot_close existence.)
#[tokio::test]
async fn boundary_fired_finalizes_and_captures_snapshot_close() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor.force_boundary_fired().unwrap();
    actor.shutdown().await.unwrap();

    let workday = today_workday();
    let session = read_only_session(&writer, &workday).await;
    assert!(matches!(
        session.ended_reason,
        Some(EndedReason::WorkdayBoundary)
    ));
    assert!(
        writer.snapshot_exists(&workday, SnapshotKind::Close),
        "snapshot_close must be captured on boundary"
    );
    // snapshot_open was captured at session start; still exists.
    assert!(writer.snapshot_exists(&workday, SnapshotKind::Open));
}

/// Case 5 — Shutdown on Active finalizes with `app_quit` and resolves
/// the oneshot. Idle Shutdown is a no-op apart from closing the actor.
#[tokio::test]
async fn shutdown_finalizes_with_app_quit() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor.shutdown().await.unwrap();

    let session = read_only_session(&writer, &today_workday()).await;
    assert!(matches!(session.ended_reason, Some(EndedReason::AppQuit)));

    // Subsequent commands return ActorClosed.
    let res = actor.note_activity(make_event("late.rs"));
    assert!(matches!(res, Err(OculpmError::ActorClosed)));
}

/// Case 6 — ManualEnd with matching session_id finalizes; mismatched
/// session_id is ignored without state change.
#[tokio::test]
async fn manual_end_matches_session_id_strictly() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.note_activity(make_event("src/a.rs")).unwrap();

    // First read the in-flight session id from disk (the actor has
    // upserted it during start_session).
    // We force the actor to flush by sending a Shutdown later, but here
    // the upsert happens synchronously during start_session.
    let workday = today_workday();
    // Wait briefly for the activity command to process.
    tokio::time::sleep(Duration::from_millis(50)).await;
    let active_id = {
        let sessions = writer.list_sessions(&workday).await.unwrap();
        sessions
            .into_iter()
            .find(|s| s.ended_at.is_none())
            .expect("an open session must exist")
            .id
    };

    // Mismatch → ignored.
    actor.manual_end("WRONG-ID".into()).unwrap();
    // Match → finalize.
    actor.manual_end(active_id.clone()).unwrap();
    actor.shutdown().await.unwrap();

    let sessions = writer.list_sessions(&workday).await.unwrap();
    let our = sessions.iter().find(|s| s.id == active_id).unwrap();
    assert!(matches!(our.ended_reason, Some(EndedReason::Manual)));
}

/// Bonus — a fresh actor whose Shutdown arrives on Idle state leaves no
/// session on disk and resolves cleanly.
#[tokio::test]
async fn shutdown_on_idle_is_clean_noop() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    actor.shutdown().await.unwrap();
    let sessions = writer.list_sessions(&today_workday()).await.unwrap();
    assert!(sessions.is_empty());
}

// Helper accessor for tests that need to inject internal commands. Keeps
// the `cmd_tx` field private from the public API while letting unit tests
// simulate InactivityFired without 60-second waits.
impl SessionActor {
    fn cmd_tx_clone(&self) -> mpsc::UnboundedSender<SessionCmd> {
        self.cmd_tx.clone()
    }
}

// Silence unused-config warning when running tests — these structs are
// referenced by the doc comments and serve as future test scaffolding.
#[allow(dead_code)]
fn _full_config_sample() -> OculpmConfig {
    OculpmConfig {
        schema_version: 1,
        workday: WorkdayConfig {
            timezone: "UTC".into(),
            day_starts_at: "00:00".into(),
        },
        session: fast_config(),
        git: GitConfig {
            forbid_journal_for_paths: vec![],
            auto_redact_patterns: vec![],
        },
        watcher: WatcherConfig {
            ignore: vec![],
            respect_gitignore: true,
            debounce_ms: 500,
            responsiveness: None,
        },
        agents: AgentsConfig {
            active: vec![],
            auto_reconcile: false,
            auto_journal_draft: false,
            rules_translate: vec![],
            template_language: "ko".into(),
        },
        automation: Default::default(),
    }
}

// ─── W2-PR5 — real-timer inactivity tests ──────────────────────────────
// Uses `tokio::time::pause()` + `advance()` to test the actual
// `spawn_inactivity_timer` without waiting 60 real seconds.

/// PR5 real-timer test 1 — after activity, advancing time past the
/// inactivity timeout causes the timer to fire and finalize the session.
#[tokio::test(start_paused = true)]
async fn real_timer_fires_after_inactivity_timeout() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    // Trigger Idle→Active transition.
    actor.note_activity(make_event("src/a.rs")).unwrap();
    // Let the actor process the command.
    tokio::task::yield_now().await;

    // fast_config has inactivity_timeout_minutes = 1 → 60s.
    // Advance past the timeout.
    tokio::time::advance(Duration::from_secs(61)).await;
    // Yield to let the timer task fire and the actor process InactivityFired.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    actor.shutdown().await.unwrap();

    let session = read_only_session(&writer, &today_workday()).await;
    assert!(
        matches!(session.ended_reason, Some(EndedReason::InactivityTimeout)),
        "session must be ended by real timer, got: {:?}",
        session.ended_reason
    );
}

/// W4 dogfooding fix — activity AFTER InactivityFired within the resume
/// grace window REOPENS the previous session instead of creating a new
/// one. The opposite-direction test (`second_activity_after_idle_starts_new_session`)
/// passes `session_resume_grace_minutes = 0` via `fast_config`.
#[tokio::test]
async fn resume_within_grace_reopens_prior_session() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let mut cfg = fast_config();
    cfg.session_resume_grace_minutes = 15;
    let actor = SessionActor::spawn(1, resolver, writer.clone(), cfg, None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor
        .cmd_tx
        .send(SessionCmd::InactivityFired)
        .map_err(|_| OculpmError::ActorClosed)
        .unwrap();
    // Yield so InactivityFired is processed before the next activity.
    tokio::time::sleep(Duration::from_millis(50)).await;
    actor.note_activity(make_event("src/b.rs")).unwrap();
    actor.shutdown().await.unwrap();

    let sessions = writer.list_sessions(&today_workday()).await.unwrap();
    assert_eq!(
        sessions.len(),
        1,
        "expected resume to keep a single session, got {sessions:?}"
    );
    let s = &sessions[0];
    assert_eq!(
        s.file_event_count, 2,
        "both activities must be on the same session"
    );
    // Final close came from shutdown.
    assert!(matches!(s.ended_reason, Some(EndedReason::AppQuit)));
}

/// W4 dogfooding fix — grace=0 must keep the old "second activity starts
/// new session" behavior so existing case 3 doesn't regress. Belt-and-
/// suspenders re-assertion of `second_activity_after_idle_starts_new_session`
/// from the resume-config angle.
#[tokio::test]
async fn resume_disabled_when_grace_zero() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let mut cfg = fast_config();
    cfg.session_resume_grace_minutes = 0;
    let actor = SessionActor::spawn(1, resolver, writer.clone(), cfg, None);

    actor.note_activity(make_event("src/a.rs")).unwrap();
    actor
        .cmd_tx
        .send(SessionCmd::InactivityFired)
        .map_err(|_| OculpmError::ActorClosed)
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    actor.note_activity(make_event("src/b.rs")).unwrap();
    actor.shutdown().await.unwrap();

    let sessions = writer.list_sessions(&today_workday()).await.unwrap();
    assert_eq!(sessions.len(), 2);
}

/// PR5 real-timer test 2 — activity resets the inactivity timer.
/// After first activity, advance 50s (< 60s), send another activity,
/// then advance 50s again (total 100s from first, but only 50s from last
/// activity). Session must still be active.
#[tokio::test(start_paused = true)]
async fn real_timer_reset_on_new_activity() {
    let dir = tempdir().unwrap();
    let writer = build_writer(dir.path());
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), fast_config(), None);

    // First activity → starts session + spawns inactivity timer.
    actor.note_activity(make_event("src/a.rs")).unwrap();
    tokio::task::yield_now().await;

    // Advance 50s — within the 60s window.
    tokio::time::advance(Duration::from_secs(50)).await;
    tokio::task::yield_now().await;

    // Second activity → must reset the timer.
    actor.note_activity(make_event("src/b.rs")).unwrap();
    tokio::task::yield_now().await;

    // Advance another 50s (100s total, but only 50s since last activity).
    tokio::time::advance(Duration::from_secs(50)).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // Session should still be alive — shutdown and check.
    actor.shutdown().await.unwrap();

    let session = read_only_session(&writer, &today_workday()).await;
    assert!(
        matches!(session.ended_reason, Some(EndedReason::AppQuit)),
        "session must still be active (ended by shutdown, not timer), got: {:?}",
        session.ended_reason
    );
    assert_eq!(
        session.file_event_count, 2,
        "both activities must be recorded"
    );
}

// ─── Session attribution by timestamp (dogfooding 2026-08-20) ───────────

fn sess(id: &str, started: &str, ended: Option<&str>) -> Session {
    Session {
        id: id.to_string(),
        started_at: started.to_string(),
        ended_at: ended.map(str::to_string),
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

/// The real 2026-08-20 timeline that exposed the bug.
fn aug20() -> Vec<Session> {
    vec![
        sess(
            "20260820-002",
            "2026-08-20T20:40:22+09:00",
            Some("2026-08-20T20:53:50+09:00"),
        ),
        sess(
            "20260820-003",
            "2026-08-20T21:37:52+09:00",
            Some("2026-08-20T21:37:52+09:00"),
        ),
        sess(
            "20260820-004",
            "2026-08-20T21:45:08+09:00",
            Some("2026-08-20T22:03:18+09:00"),
        ),
        sess("20260820-005", "2026-08-20T22:10:51+09:00", None),
    ]
}

#[test]
fn entry_written_after_its_session_closed_still_belongs_to_it() {
    let s = aug20();
    // Session -002 closed at 20:53:50; its three entries were written at
    // 20:54/20:55/20:56. A containment test would drop all three.
    for ts in [
        "2026-08-20T20:54:00+09:00",
        "2026-08-20T20:55:00+09:00",
        "2026-08-20T20:56:00+09:00",
    ] {
        assert_eq!(
            resolve_session_for_timestamp(&s, ts).as_deref(),
            Some("20260820-002"),
            "ts {ts}"
        );
    }
}

#[test]
fn entry_resolves_to_the_session_that_did_the_work() {
    let s = aug20();
    // 22:02 — inside -004's window (21:45..22:03). Its files really are
    // -004's (Today ring / line churn).
    assert_eq!(
        resolve_session_for_timestamp(&s, "2026-08-20T22:02:00+09:00").as_deref(),
        Some("20260820-004")
    );
    // 23:37 — after -005 opened and never closed.
    assert_eq!(
        resolve_session_for_timestamp(&s, "2026-08-20T23:37:00+09:00").as_deref(),
        Some("20260820-005")
    );
}

#[test]
fn entry_before_the_first_session_has_no_owner() {
    let s = aug20();
    assert_eq!(
        resolve_session_for_timestamp(&s, "2026-08-20T09:00:00+09:00"),
        None
    );
    assert_eq!(
        resolve_session_for_timestamp(&[], "2026-08-20T22:00:00+09:00"),
        None
    );
}

#[test]
fn resolution_compares_instants_not_strings_across_offsets() {
    let s = aug20();
    // 13:54 UTC == 22:54 KST — must land on -005, not on -002 (which a
    // lexicographic string compare would pick, "13:54" < "20:40").
    assert_eq!(
        resolve_session_for_timestamp(&s, "2026-08-20T13:54:00+00:00").as_deref(),
        Some("20260820-005")
    );
}

#[test]
fn unsorted_input_still_resolves_correctly() {
    let mut s = aug20();
    s.reverse();
    assert_eq!(
        resolve_session_for_timestamp(&s, "2026-08-20T22:02:00+09:00").as_deref(),
        Some("20260820-004")
    );
}

#[test]
fn watcher_ids_are_distinguished_from_synthetic_ones() {
    assert!(is_watcher_session_id("20260820-002"));
    assert!(is_watcher_session_id("20260820-1"));
    // The dialects that broke the join.
    assert!(!is_watcher_session_id("manual-20260820-205400"));
    assert!(!is_watcher_session_id("mcp-20260820-205400"));
    // Synthetic index-writer form (`<workday>-mNN`) is not a real session.
    assert!(!is_watcher_session_id("20260820-m01"));
    assert!(!is_watcher_session_id("20260820"));
    assert!(!is_watcher_session_id(""));
}

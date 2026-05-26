//! Session state machine actor — W2-PR2.
//!
//! Owns a single mpsc-driven tokio task per project that tracks the current
//! session lifecycle. Driven by file activity from the watcher (W2-PR3),
//! inactivity / workday-boundary timers, and Manual / Shutdown commands.
//!
//! Effects (`oculpm:session_started/ended` emit, `snapshot_{open,close}`
//! capture, `sessions.json` upsert) are routed through `IndexWriter` and the
//! optional `tauri::AppHandle`. The handle is `Option` so unit tests can
//! construct the actor without a Tauri runtime.
//!
//! Crash recovery is **not** here — it lives in W2-PR4 (`OculpmManager`)
//! which scans `sessions.json` for `ended_at == null` before this actor boots.
//!
//! See `docs/major_update/oculpm/W2/PR2-session-actor.md` for the full state
//! transition table.

#![allow(dead_code)] // Consumed by W2-PR3 (Watcher) + W2-PR6 (commands) + W2-PR7 (manager bootstrap).

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::oculpm::error::OculpmError;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::spec::{
    EndedReason, FileChangeEvent, OculpmSessionEnded, OculpmSessionStarted, Session, SessionConfig,
    SessionEnd, SnapshotKind,
};

/// Min interval between two `sessions.json` rewrites for live activity. Other
/// transitions (start / end / boundary) always flush synchronously.
const UPSERT_DEBOUNCE: Duration = Duration::from_secs(5);

/// How often the actor wakes itself to perform debounced upserts.
const FLUSH_TICK: Duration = Duration::from_millis(250);

// ─────────────────────────────────────────────────────────────────────────────
// Public command surface
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum SessionCmd {
    NoteActivity(FileChangeEvent),
    ManualStart,
    ManualEnd(String /* session_id */),
    InactivityFired,
    BoundaryFired,
    Shutdown(oneshot::Sender<()>),
    /// Query: returns the current session if Active, else None.
    GetCurrentSession(oneshot::Sender<Option<Session>>),
}

/// Handle to a running `SessionActor`. Cheap to clone via the inner sender —
/// `SessionCmd` is delivered via an unbounded mpsc so the watcher never blocks.
#[derive(Clone)]
pub struct SessionActor {
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    project_id: u32,
}

impl SessionActor {
    /// Spawn the actor task. The actor stays alive until `shutdown` is called
    /// or every `SessionActor` clone is dropped.
    pub fn spawn(
        project_id: u32,
        resolver: WorkdayResolver,
        index_writer: Arc<IndexWriter>,
        config: SessionConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let inner = ActorInner {
            project_id,
            resolver,
            index_writer,
            config,
            app_handle,
            cmd_tx: cmd_tx.clone(),
            state: SessionState::Idle,
        };
        tokio::spawn(inner.run(cmd_rx));
        Self { cmd_tx, project_id }
    }

    pub fn project_id(&self) -> u32 {
        self.project_id
    }

    pub fn note_activity(&self, ev: FileChangeEvent) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::NoteActivity(ev))
            .map_err(|_| OculpmError::ActorClosed)
    }

    pub fn manual_start(&self) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::ManualStart)
            .map_err(|_| OculpmError::ActorClosed)
    }

    pub fn manual_end(&self, session_id: String) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::ManualEnd(session_id))
            .map_err(|_| OculpmError::ActorClosed)
    }

    /// Drive the actor to finalize any open session and exit. Resolves once
    /// the actor has processed every queued command before this call.
    pub async fn shutdown(&self) -> Result<(), OculpmError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCmd::Shutdown(tx))
            .map_err(|_| OculpmError::ActorClosed)?;
        rx.await.map_err(|_| OculpmError::ActorClosed)
    }

    /// Force-fires the workday boundary handler. Exposed for W2-PR4 crash
    /// recovery and unit tests that exercise boundary-time effects without
    /// waiting for the wall clock.
    pub fn force_boundary_fired(&self) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::BoundaryFired)
            .map_err(|_| OculpmError::ActorClosed)
    }

    /// Query the current session snapshot. Returns `None` if Idle or Closing.
    pub async fn get_current_session(&self) -> Result<Option<Session>, OculpmError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCmd::GetCurrentSession(tx))
            .map_err(|_| OculpmError::ActorClosed)?;
        rx.await.map_err(|_| OculpmError::ActorClosed)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

struct ActiveSession {
    session: Session,
    active_start: DateTime<Utc>,
    last_activity: DateTime<Utc>,
    last_upsert: DateTime<Utc>,
    files_unique: HashSet<String>,
    inactivity_handle: JoinHandle<()>,
    boundary_handle: JoinHandle<()>,
    dirty: bool,
}

enum SessionState {
    Idle,
    /// Boxed so the enum size stays balanced — `Active` carries ~300 bytes
    /// of timer/state data while `Idle`/`Closing` carry none.
    Active(Box<ActiveSession>),
    Closing,
}

struct ActorInner {
    project_id: u32,
    resolver: WorkdayResolver,
    index_writer: Arc<IndexWriter>,
    config: SessionConfig,
    app_handle: Option<tauri::AppHandle>,
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    state: SessionState,
}

impl ActorInner {
    async fn run(mut self, mut cmd_rx: mpsc::UnboundedReceiver<SessionCmd>) {
        let mut tick = tokio::time::interval(FLUSH_TICK);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SessionCmd::Shutdown(tx)) => {
                            self.handle_shutdown().await;
                            let _ = tx.send(());
                            break;
                        }
                        Some(c) => {
                            if matches!(self.state, SessionState::Closing) {
                                // Still respond to queries during Closing to
                                // avoid oneshot deadlocks.
                                if let SessionCmd::GetCurrentSession(tx) = c {
                                    let _ = tx.send(None);
                                }
                                continue;
                            }
                            self.handle(c).await;
                        }
                        None => break, // all senders dropped
                    }
                }
                _ = tick.tick() => {
                    if !matches!(self.state, SessionState::Closing) {
                        self.maybe_flush().await;
                    }
                }
            }
        }
        // Belt-and-suspenders: abort any live timer tasks so they don't
        // outlive the actor. Drop(JoinHandle) detaches, it does NOT abort.
        if let SessionState::Active(active) =
            std::mem::replace(&mut self.state, SessionState::Closing)
        {
            active.inactivity_handle.abort();
            active.boundary_handle.abort();
        }
    }

    async fn handle(&mut self, cmd: SessionCmd) {
        match cmd {
            SessionCmd::NoteActivity(ev) => self.on_activity(ev).await,
            SessionCmd::ManualStart => self.on_manual_start().await,
            SessionCmd::ManualEnd(id) => self.on_manual_end(id).await,
            SessionCmd::InactivityFired => self.on_inactivity_fired().await,
            SessionCmd::BoundaryFired => self.on_boundary_fired().await,
            SessionCmd::Shutdown(_) => unreachable!("Shutdown handled in run loop"),
            SessionCmd::GetCurrentSession(tx) => {
                let session = match &self.state {
                    SessionState::Active(active) => Some(active.session.clone()),
                    _ => None,
                };
                let _ = tx.send(session);
            }
        }
    }

    // ─── Command handlers ───────────────────────────────────────────────────

    async fn on_activity(&mut self, ev: FileChangeEvent) {
        match &mut self.state {
            SessionState::Idle => {
                // Idle → Active. Try to RESUME a recently-finalized session
                // first (W4 dogfooding fix — external agent re-entry was
                // splitting one logical work unit into N sessions). Falls
                // through to start_session on no candidate.
                match self.try_resume_session(ev.clone()).await {
                    ResumeOutcome::Resumed => {}
                    ResumeOutcome::NoCandidate => {
                        if let Err(e) = self.start_session(Some(ev)).await {
                            tracing::error!(target: "oculpm::session", error = ?e, "failed to start session on activity");
                        }
                    }
                }
            }
            SessionState::Active(active) => {
                // Stamp the event with the active session's id + a fresh ts,
                // then append to ndjson. The watcher leaves these fields as
                // placeholders since it doesn't know the live session id.
                let mut stamped = ev;
                stamped.session_id = active.session.id.clone();
                stamped.ts = Utc::now()
                    .with_timezone(&self.resolver.tz)
                    .to_rfc3339_opts(SecondsFormat::Secs, false);
                if let Err(e) = self.index_writer.append_file_change(&stamped).await {
                    tracing::warn!(target: "oculpm::session", error = ?e, "ndjson append failed");
                }

                active.last_activity = Utc::now();
                active.session.file_event_count =
                    active.session.file_event_count.saturating_add(1);
                active.files_unique.insert(stamped.path.clone());
                active.session.files_unique = active.files_unique.len() as u32;
                active.dirty = true;

                // Reset the inactivity timer: abort current, spawn new.
                let timeout = inactivity_timeout(&self.config);
                let new_handle = spawn_inactivity_timer(self.cmd_tx.clone(), timeout);
                let old = std::mem::replace(&mut active.inactivity_handle, new_handle);
                old.abort();

                // Debounced upsert: only persist if the last write is older
                // than UPSERT_DEBOUNCE. Other paths flush eagerly.
                if active
                    .last_upsert
                    .signed_duration_since(active.last_activity)
                    .num_milliseconds()
                    .abs()
                    >= UPSERT_DEBOUNCE.as_millis() as i64
                {
                    let to_save = active.session.clone();
                    active.last_upsert = active.last_activity;
                    active.dirty = false;
                    let writer = self.index_writer.clone();
                    if let Err(e) = writer.upsert_session(&to_save).await {
                        tracing::warn!(target: "oculpm::session", error = ?e, "debounced upsert failed");
                    }
                }
            }
            SessionState::Closing => {}
        }
    }

    async fn on_manual_start(&mut self) {
        if matches!(self.state, SessionState::Idle) {
            if let Err(e) = self.start_session(None).await {
                tracing::error!(target: "oculpm::session", error = ?e, "manual start failed");
            }
        }
    }

    async fn on_manual_end(&mut self, session_id: String) {
        if let SessionState::Active(active) = &self.state {
            if active.session.id != session_id {
                tracing::warn!(
                    target: "oculpm::session",
                    requested = %session_id,
                    active = %active.session.id,
                    "manual_end called with mismatched session_id — ignoring"
                );
                return;
            }
            self.finalize_active(EndedReason::Manual, EndedAt::Now).await;
        }
    }

    async fn on_inactivity_fired(&mut self) {
        if matches!(self.state, SessionState::Active(_)) {
            // ended_at is the moment of last activity, not the firing time.
            self.finalize_active(EndedReason::InactivityTimeout, EndedAt::LastActivity)
                .await;
        }
    }

    async fn on_boundary_fired(&mut self) {
        let old_workday = match &self.state {
            SessionState::Active(active) => workday_from_id(&active.session.id),
            _ => None,
        };
        if matches!(self.state, SessionState::Active(_)) {
            self.finalize_active(EndedReason::WorkdayBoundary, EndedAt::Now)
                .await;
        }
        // Capture snapshot_close for the workday that just ended (only if
        // there was an active session — otherwise boundary firing is a no-op).
        if let Some(old_wd) = old_workday {
            if !self.index_writer.snapshot_exists(&old_wd, SnapshotKind::Close) {
                if let Err(e) = self
                    .index_writer
                    .capture_snapshot(&old_wd, SnapshotKind::Close)
                    .await
                {
                    tracing::warn!(target: "oculpm::session", error = ?e, "snapshot_close failed");
                }
            }
        }
        // Prepare today's workday directory + snapshot_open. The next
        // NoteActivity will start a new session under the new workday.
        let new_workday = self.resolver.workday_of(Utc::now());
        if let Err(e) = self.index_writer.ensure_workday_dirs(&new_workday).await {
            tracing::warn!(target: "oculpm::session", error = ?e, "ensure_workday_dirs failed");
        }
        if !self
            .index_writer
            .snapshot_exists(&new_workday, SnapshotKind::Open)
        {
            if let Err(e) = self
                .index_writer
                .capture_snapshot(&new_workday, SnapshotKind::Open)
                .await
            {
                tracing::warn!(target: "oculpm::session", error = ?e, "snapshot_open failed");
            }
        }
    }

    async fn handle_shutdown(&mut self) {
        if matches!(self.state, SessionState::Active(_)) {
            self.finalize_active(EndedReason::AppQuit, EndedAt::Now).await;
        }
        self.state = SessionState::Closing;
    }

    // ─── Session lifecycle ──────────────────────────────────────────────────

    /// Look at today's workday sessions and decide whether the new activity
    /// should reopen the most-recent InactivityTimeout-closed session instead
    /// of starting a fresh one. Caller is responsible for the Idle precondition
    /// — we don't double-check `self.state`.
    ///
    /// Conditions for resume:
    ///  - `config.session_resume_grace_minutes > 0`
    ///  - There's a session in today's workday with `ended_at = Some(_)` and
    ///    `ended_reason == InactivityTimeout`
    ///  - That session's `ended_at` is within `grace_minutes` of "now"
    ///  - That session is the chronologically last session in the workday
    ///    (we never reach back past a more recent session, even if that
    ///    newer one ended for a different reason)
    async fn try_resume_session(&mut self, ev: FileChangeEvent) -> ResumeOutcome {
        if self.config.session_resume_grace_minutes == 0 {
            return ResumeOutcome::NoCandidate;
        }
        let now = Utc::now();
        let workday = self.resolver.workday_of(now);

        let sessions = match self.index_writer.list_sessions(&workday).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(target: "oculpm::session", error = ?e, "list_sessions failed in resume check");
                return ResumeOutcome::NoCandidate;
            }
        };
        let last = match sessions.into_iter().last() {
            Some(s) => s,
            None => return ResumeOutcome::NoCandidate,
        };
        let ended_at_str = match &last.ended_at {
            Some(s) => s.clone(),
            None => return ResumeOutcome::NoCandidate, // still-open session shouldn't happen in Idle
        };
        if !matches!(last.ended_reason, Some(EndedReason::InactivityTimeout)) {
            return ResumeOutcome::NoCandidate;
        }
        let ended_at = match DateTime::parse_from_rfc3339(&ended_at_str) {
            Ok(t) => t.with_timezone(&Utc),
            Err(_) => return ResumeOutcome::NoCandidate,
        };
        let grace =
            chrono::Duration::minutes(i64::from(self.config.session_resume_grace_minutes));
        if (now - ended_at) > grace {
            return ResumeOutcome::NoCandidate;
        }

        // Unfinalize on disk so list_sessions / TodayScreen pick it back up as
        // "ongoing" within this same call cycle.
        let resumed = match self.index_writer.unfinalize_session(&last.id).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(target: "oculpm::session", error = ?e, "unfinalize_session failed");
                return ResumeOutcome::NoCandidate;
            }
        };

        // Append the triggering event under the resumed session id.
        let stamped = FileChangeEvent {
            ts: now
                .with_timezone(&self.resolver.tz)
                .to_rfc3339_opts(SecondsFormat::Secs, false),
            session_id: resumed.id.clone(),
            ..ev
        };
        if let Err(e) = self.index_writer.append_file_change(&stamped).await {
            tracing::warn!(target: "oculpm::session", error = ?e, "resume ndjson append failed");
        }

        // Rebuild the unique-files set from existing ndjson so files_unique
        // stays consistent across resume. Cheap (one pass on this workday's
        // file_changes.ndjson). Errors fall back to seeding with just the
        // new event — the counter will be approximate but the session won't
        // be split.
        let mut files_unique: HashSet<String> = HashSet::new();
        match self
            .index_writer
            .read_file_changes(&workday, Some(&resumed.id))
            .await
        {
            Ok(events) => {
                for e in events {
                    files_unique.insert(e.path);
                }
            }
            Err(e) => {
                tracing::warn!(target: "oculpm::session", error = ?e, "read_file_changes failed during resume");
            }
        }
        files_unique.insert(stamped.path.clone());

        let mut session = resumed;
        session.file_event_count = session.file_event_count.saturating_add(1);
        session.files_unique = files_unique.len() as u32;
        // git_head_at_start kept; end stays None until next finalize.
        if let Err(e) = self.index_writer.upsert_session(&session).await {
            tracing::warn!(target: "oculpm::session", error = ?e, "resume upsert failed");
        }

        // Emit started so the UI re-renders the session as ongoing. We
        // intentionally reuse OculpmSessionStarted rather than introducing a
        // new "resumed" event — TodayScreen / SessionCard already debounce
        // identical session_ids and resume looks identical from their POV.
        self.emit_started(&session);

        let inactivity = spawn_inactivity_timer(
            self.cmd_tx.clone(),
            inactivity_timeout(&self.config),
        );
        let boundary_at = self.resolver.next_boundary(now);
        let boundary = spawn_boundary_timer(self.cmd_tx.clone(), boundary_at);

        self.state = SessionState::Active(Box::new(ActiveSession {
            session,
            active_start: ended_at, // preserve the original window start; next finalize re-measures
            last_activity: now,
            last_upsert: now,
            files_unique,
            inactivity_handle: inactivity,
            boundary_handle: boundary,
            dirty: false,
        }));
        ResumeOutcome::Resumed
    }

    async fn start_session(
        &mut self,
        first_event: Option<FileChangeEvent>,
    ) -> Result<(), OculpmError> {
        let now = Utc::now();
        let workday = self.resolver.workday_of(now);

        self.index_writer.ensure_workday_dirs(&workday).await?;
        if !self
            .index_writer
            .snapshot_exists(&workday, SnapshotKind::Open)
        {
            self.index_writer
                .capture_snapshot(&workday, SnapshotKind::Open)
                .await?;
        }

        let id = self.next_session_id(&workday).await?;
        let started_at = now
            .with_timezone(&self.resolver.tz)
            .to_rfc3339_opts(SecondsFormat::Secs, false);
        let mut files_unique: HashSet<String> = HashSet::new();
        let mut file_event_count: u32 = 0;
        if let Some(ref ev) = first_event {
            files_unique.insert(ev.path.clone());
            file_event_count = 1;
        }

        let session = Session {
            id: id.clone(),
            started_at: started_at.clone(),
            ended_at: None,
            ended_reason: None,
            active_window_ms: 0,
            file_event_count,
            files_unique: files_unique.len() as u32,
            git_head_at_start: self.index_writer.current_git_head(),
            git_head_at_end: None,
            agent_label_guess: None,
            linked_journal_entries: Vec::new(),
        };

        self.index_writer.upsert_session(&session).await?;

        // Append the activity that triggered Idle→Active to ndjson. ManualStart
        // (no first_event) leaves ndjson empty until the next NoteActivity.
        if let Some(mut ev) = first_event {
            ev.session_id = id;
            ev.ts = started_at;
            if let Err(e) = self.index_writer.append_file_change(&ev).await {
                tracing::warn!(target: "oculpm::session", error = ?e, "first ndjson append failed");
            }
        }

        self.emit_started(&session);

        let inactivity = spawn_inactivity_timer(
            self.cmd_tx.clone(),
            inactivity_timeout(&self.config),
        );
        let boundary_at = self.resolver.next_boundary(now);
        let boundary = spawn_boundary_timer(self.cmd_tx.clone(), boundary_at);

        self.state = SessionState::Active(Box::new(ActiveSession {
            session,
            active_start: now,
            last_activity: now,
            last_upsert: now,
            files_unique,
            inactivity_handle: inactivity,
            boundary_handle: boundary,
            dirty: false,
        }));
        Ok(())
    }

    async fn finalize_active(&mut self, reason: EndedReason, ended_at: EndedAt) {
        // Take ownership of the Active state so we can move its fields out.
        let prev = std::mem::replace(&mut self.state, SessionState::Idle);
        let active = match prev {
            SessionState::Active(a) => *a,
            other => {
                self.state = other;
                return;
            }
        };
        active.inactivity_handle.abort();
        active.boundary_handle.abort();
        let mut session = active.session;
        let active_start = active.active_start;
        let last_activity = active.last_activity;

        let end_instant = match ended_at {
            EndedAt::Now => Utc::now(),
            EndedAt::LastActivity => last_activity,
        };
        let end_str = end_instant
            .with_timezone(&self.resolver.tz)
            .to_rfc3339_opts(SecondsFormat::Secs, false);

        // Active window: simple wall-clock span. Refining to exclude idle
        // gaps lives in a later perf pass (see PR2 doc §6 #2).
        let window_ms = (end_instant - active_start)
            .num_milliseconds()
            .max(0)
            .min(u32::MAX as i64) as u32;
        session.active_window_ms = window_ms;
        session.git_head_at_end = self.index_writer.current_git_head();

        // Persist final state, then call finalize_session for the
        // ended_at/ended_reason fields (which finalize_session writes back).
        if let Err(e) = self.index_writer.upsert_session(&session).await {
            tracing::warn!(target: "oculpm::session", error = ?e, "pre-finalize upsert failed");
        }
        let finalized = match self
            .index_writer
            .finalize_session(
                &session.id,
                SessionEnd {
                    ended_at: end_str,
                    ended_reason: reason,
                },
            )
            .await
        {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(target: "oculpm::session", error = ?e, "finalize_session failed");
                session
            }
        };
        self.emit_ended(&finalized);
    }

    async fn maybe_flush(&mut self) {
        if let SessionState::Active(active) = &mut self.state {
            if !active.dirty {
                return;
            }
            let now = Utc::now();
            if now.signed_duration_since(active.last_upsert).to_std().unwrap_or(Duration::ZERO)
                < UPSERT_DEBOUNCE
            {
                return;
            }
            let to_save = active.session.clone();
            active.last_upsert = active.last_activity;
            active.dirty = false;
            let writer = self.index_writer.clone();
            if let Err(e) = writer.upsert_session(&to_save).await {
                tracing::warn!(target: "oculpm::session", error = ?e, "tick flush failed");
            }
        }
    }

    async fn next_session_id(&self, workday: &str) -> Result<String, OculpmError> {
        let existing = self.index_writer.list_sessions(workday).await?;
        let max_nnn = existing
            .iter()
            .filter_map(|s| s.id.split('-').nth(1).and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0);
        Ok(format!("{}-{:03}", workday, max_nnn + 1))
    }

    fn emit_started(&self, session: &Session) {
        tracing::info!(
            target: "oculpm::session",
            project_id = self.project_id,
            session_id = %session.id,
            started_at = %session.started_at,
            "[FLOW] session started (emit OculpmSessionStarted)"
        );
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmSessionStarted {
                project_id: self.project_id,
                session: session.clone(),
            }
            .emit(handle);
        }
    }

    fn emit_ended(&self, session: &Session) {
        tracing::info!(
            target: "oculpm::session",
            project_id = self.project_id,
            session_id = %session.id,
            ended_reason = ?session.ended_reason,
            "[FLOW] session ended (emit OculpmSessionEnded)"
        );
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmSessionEnded {
                project_id: self.project_id,
                session: session.clone(),
            }
            .emit(handle);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

enum EndedAt {
    Now,
    LastActivity,
}

enum ResumeOutcome {
    Resumed,
    NoCandidate,
}

fn inactivity_timeout(cfg: &SessionConfig) -> Duration {
    Duration::from_secs(u64::from(cfg.inactivity_timeout_minutes).saturating_mul(60))
}

fn spawn_inactivity_timer(
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    timeout: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        tokio::time::sleep(timeout).await;
        let _ = cmd_tx.send(SessionCmd::InactivityFired);
    })
}

fn spawn_boundary_timer(
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    fires_at: DateTime<Utc>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Wall-clock-jump safe: recompute and re-sleep if the clock moved
        // backwards or the boundary slid forward (DST / NTP adjustment).
        loop {
            let now = Utc::now();
            if now >= fires_at {
                break;
            }
            let delta = (fires_at - now).to_std().unwrap_or(Duration::ZERO);
            if delta.is_zero() {
                break;
            }
            tokio::time::sleep(delta).await;
        }
        let _ = cmd_tx.send(SessionCmd::BoundaryFired);
    })
}

fn workday_from_id(session_id: &str) -> Option<String> {
    if session_id.len() >= 8
        && session_id.as_bytes()[..8].iter().all(|b| b.is_ascii_digit())
    {
        Some(session_id[..8].to_string())
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W2/PR2-session-actor.md` §5.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::{
        AgentsConfig, FileOp, GitConfig, OculpmConfig, SessionConfig, WatcherConfig, WorkdayConfig,
    };
    use tempfile::tempdir;

    fn fast_config() -> SessionConfig {
        SessionConfig {
            inactivity_timeout_minutes: 1, // 60s — but tests use force-fire / very short waits
            auto_close_on_workday_boundary: true,
            auto_close_on_app_quit: true,
            crash_recovery_grace_minutes: 5,
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
        assert_eq!(sessions.len(), 1, "expected one session, got {:?}", sessions);
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
        assert_eq!(session.ended_reason.unwrap() as u8, EndedReason::AppQuit as u8);
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
                journal_committed: false,
                forbid_journal_for_paths: vec![],
                auto_redact_patterns: vec![],
            },
            watcher: WatcherConfig {
                ignore: vec![],
                respect_gitignore: true,
                debounce_ms: 500,
                batch_max_events: 200,
            },
            agents: AgentsConfig {
                active: vec![],
                auto_detect_on_open: true,
                auto_sync_adapters: true,
            },
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
        assert_eq!(s.file_event_count, 2, "both activities must be on the same session");
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
}

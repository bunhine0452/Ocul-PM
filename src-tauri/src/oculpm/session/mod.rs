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

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::oculpm::error::OculpmError;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::session_id::SessionId;
use crate::oculpm::spec::{
    EndedReason, FileChangeEvent, OculpmSessionEnded, OculpmSessionStarted, OculpmWorkdayChanged,
    Session, SessionConfig, SessionEnd, SnapshotKind,
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
    /// PR-CI0 — external agent hook signal (claude_hooks bridge): the agent
    /// is alive (SessionStart / turn Stop). Ensures a session exists, labels
    /// it, and refreshes the inactivity window — no file event required.
    HookAgentActive {
        agent_label: String,
        /// 훅이 준 **에이전트 대화 id**. 라벨(`claude-code`)은 상수라 몇 개가
        /// 붙어 있는지 말하지 못한다 — 이 값이 그걸 말한다. 모를 수 있어
        /// (구버전 훅·필드 누락) 빈 문자열이 오면 조용히 버린다.
        agent_session: String,
    },
    /// PR-CI0 — the last open hooked agent session reported SessionEnd →
    /// finalize now with the precise `AgentExit` reason.
    HookAgentEnded {
        /// 방금 끝난 대화의 id. 끝나는 길이라도 **참여 기록은 남긴다** —
        /// 앱이 중간에 재시작해 SessionStart 를 못 본 대화가 여기서 처음
        /// 이름을 얻는 경우가 있다.
        agent_session: String,
    },
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

    /// PR-CI0 — hook bridge: agent alive signal (SessionStart / Stop).
    pub fn hook_agent_active(
        &self,
        agent_label: &str,
        agent_session: &str,
    ) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::HookAgentActive {
                agent_label: agent_label.to_string(),
                agent_session: agent_session.to_string(),
            })
            .map_err(|_| OculpmError::ActorClosed)
    }

    /// PR-CI0 — hook bridge: last agent session ended → finalize now.
    pub fn hook_agent_ended(&self, agent_session: &str) -> Result<(), OculpmError> {
        self.cmd_tx
            .send(SessionCmd::HookAgentEnded {
                agent_session: agent_session.to_string(),
            })
            .map_err(|_| OculpmError::ActorClosed)
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
    /// 이 작업 세션에 붙어 있던 에이전트 대화 id 들. `BTreeSet` 이라 삽입만
    /// 하면 정렬·중복 제거가 공짜다 — 훅은 대화마다 매 턴 신호를 보낸다.
    agent_sessions: BTreeSet<String>,
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
            SessionCmd::HookAgentActive {
                agent_label,
                agent_session,
            } => self.on_hook_agent_active(agent_label, agent_session).await,
            SessionCmd::HookAgentEnded { agent_session } => {
                self.on_hook_agent_ended(agent_session).await
            }
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
                active.session.file_event_count = active.session.file_event_count.saturating_add(1);
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
            self.finalize_active(EndedReason::Manual, EndedAt::Now)
                .await;
        }
    }

    async fn on_inactivity_fired(&mut self) {
        if matches!(self.state, SessionState::Active(_)) {
            // ended_at is the moment of last activity, not the firing time.
            self.finalize_active(EndedReason::InactivityTimeout, EndedAt::LastActivity)
                .await;
        }
    }

    /// PR-CI0 — hook alive signal. Unlike `on_activity` there is no file
    /// event to append; this only guarantees an Active session, stamps the
    /// precise agent label (measured, not frontmatter self-report), and
    /// resets the inactivity window so a thinking-but-not-writing agent
    /// doesn't get heuristically closed mid-run.
    async fn on_hook_agent_active(&mut self, agent_label: String, agent_session: String) {
        match &mut self.state {
            SessionState::Idle => {
                if let Err(e) = self.start_session(None).await {
                    tracing::error!(target: "oculpm::session", error = ?e, "hook start failed");
                    return;
                }
                if let SessionState::Active(active) = &mut self.state {
                    active.session.agent_label_guess = Some(agent_label);
                    record_agent_session(active, &agent_session);
                    // Persist the label right away — start_session upserted
                    // without it and the debounce window would leave a
                    // label-less row if the agent session is short.
                    let to_save = active.session.clone();
                    active.last_upsert = Utc::now();
                    active.dirty = false;
                    if let Err(e) = self.index_writer.upsert_session(&to_save).await {
                        tracing::warn!(target: "oculpm::session", error = ?e, "hook label upsert failed");
                    }
                }
            }
            SessionState::Active(active) => {
                if active.session.agent_label_guess.is_none() {
                    active.session.agent_label_guess = Some(agent_label);
                }
                record_agent_session(active, &agent_session);
                active.last_activity = Utc::now();
                active.dirty = true;
                let timeout = inactivity_timeout(&self.config);
                let new_handle = spawn_inactivity_timer(self.cmd_tx.clone(), timeout);
                let old = std::mem::replace(&mut active.inactivity_handle, new_handle);
                old.abort();
            }
            SessionState::Closing => {}
        }
    }

    /// PR-CI0 — precise close from the agent's own SessionEnd. Idle is a
    /// no-op (the heuristic may have closed first — that's fine, the hook
    /// just makes it exact when it can).
    async fn on_hook_agent_ended(&mut self, agent_session: String) {
        // 끝나는 길이라도 참여는 참여다 — finalize 가 이 세션을 디스크로
        // 내보내기 **전에** 적어야 기록에 남는다.
        if let SessionState::Active(active) = &mut self.state {
            record_agent_session(active, &agent_session);
        }
        if matches!(self.state, SessionState::Active(_)) {
            self.finalize_active(EndedReason::AgentExit, EndedAt::Now)
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
            if !self
                .index_writer
                .snapshot_exists(&old_wd, SnapshotKind::Close)
            {
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
        // 활성 세션 중에 날이 넘어간 경우 — 화면이 60초 폴링 없이 즉시 안다
        // (Phase 4 #events-over-polling). 유휴 상태의 넘김은 감독관이 낸다.
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmWorkdayChanged {
                project_id: self.project_id,
                workday: new_workday.clone(),
            }
            .emit(handle);
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
            self.finalize_active(EndedReason::AppQuit, EndedAt::Now)
                .await;
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
        let grace = chrono::Duration::minutes(i64::from(self.config.session_resume_grace_minutes));
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
        let agent_sessions_seed: BTreeSet<String> =
            session.agent_sessions.iter().cloned().collect();
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

        let inactivity =
            spawn_inactivity_timer(self.cmd_tx.clone(), inactivity_timeout(&self.config));
        let boundary_at = self.resolver.next_boundary(now);
        let boundary = spawn_boundary_timer(self.cmd_tx.clone(), boundary_at);

        self.state = SessionState::Active(Box::new(ActiveSession {
            session,
            active_start: ended_at, // preserve the original window start; next finalize re-measures
            last_activity: now,
            last_upsert: now,
            files_unique,
            // 이어 붙이는 세션이므로 참여자 목록도 이어받는다 — 비우면 재개
            // 직후의 훅 신호만 남아 앞쪽 대화들이 기록에서 사라진다.
            agent_sessions: agent_sessions_seed,
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
            agent_sessions: Vec::new(),
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

        let inactivity =
            spawn_inactivity_timer(self.cmd_tx.clone(), inactivity_timeout(&self.config));
        let boundary_at = self.resolver.next_boundary(now);
        let boundary = spawn_boundary_timer(self.cmd_tx.clone(), boundary_at);

        self.state = SessionState::Active(Box::new(ActiveSession {
            session,
            active_start: now,
            last_activity: now,
            last_upsert: now,
            files_unique,
            agent_sessions: BTreeSet::new(),
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
            if now
                .signed_duration_since(active.last_upsert)
                .to_std()
                .unwrap_or(Duration::ZERO)
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
            .filter_map(|s| SessionId::new(s.id.as_str()).watcher_counter())
            .max()
            .unwrap_or(0);
        Ok(SessionId::watcher(workday, max_nnn + 1).into_string())
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

/// 이 작업 세션에 에이전트 대화 하나를 등록한다.
///
/// 훅은 대화마다 **매 턴** 신호를 보내므로 대부분의 호출은 아무것도 바꾸지
/// 않는다. 그래서 집합이 실제로 커졌을 때만 `dirty` 를 세우고 세션 레코드의
/// 벡터를 다시 만든다 — 매 턴 upsert 를 유발하면 디바운스가 무의미해진다.
///
/// 빈 id 는 버린다. 훅 payload 에 `session_id` 가 없을 수 있고(구버전·필드
/// 누락), 빈 문자열을 참여자로 세면 "대화 1개"라는 거짓말이 된다.
fn record_agent_session(active: &mut ActiveSession, agent_session: &str) {
    let id = agent_session.trim();
    if id.is_empty() || !active.agent_sessions.insert(id.to_string()) {
        return;
    }
    active.session.agent_sessions = active.agent_sessions.iter().cloned().collect();
    active.dirty = true;
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
    SessionId::new(session_id).workday().map(str::to_string)
}

// ─────────────────────────────────────────────────────────────────────────────
// Session attribution by timestamp
// ─────────────────────────────────────────────────────────────────────────────

/// True when `session_id` follows the watcher's own `YYYYMMDD-NNN` scheme.
///
/// Anything else — `manual-20260820-205400` (agent writing the file directly
/// per AGENTS.md §2), `mcp-20260820-205400` (the out-of-process MCP tool with
/// no app running) — is a *synthetic* id that can never join against a real
/// session and must be resolved by timestamp instead.
pub fn is_watcher_session_id(session_id: &str) -> bool {
    SessionId::new(session_id).is_watcher()
}

/// Which watcher session a journal entry written at `ts` belongs to.
///
/// Returns the id of the **last session that had started by `ts`**, not the
/// session whose `[started_at, ended_at]` window strictly contains it. A
/// journal entry is written *after* the work it describes, so it routinely
/// lands past its session's end: on 2026-08-20 session `-002` closed at
/// 20:53:50 on an inactivity timeout and its three entries were written at
/// 20:54, 20:55 and 20:56. A containment test drops all three; "last session
/// started at or before" keeps them with the work they actually describe.
///
/// `sessions` must be sorted by `started_at` ASC — [`IndexWriter::list_sessions`]
/// guarantees this. Returns `None` when no session had started yet (an entry
/// written before the day's first agent activity, e.g. hand-authored notes).
pub fn resolve_session_for_timestamp(sessions: &[Session], ts: &str) -> Option<String> {
    let ts = DateTime::parse_from_rfc3339(ts).ok()?;
    sessions
        .iter()
        .filter(|s| {
            DateTime::parse_from_rfc3339(&s.started_at)
                .map(|started| started <= ts)
                .unwrap_or(false)
        })
        // `sessions` is sorted, but re-select by max so a caller passing an
        // unsorted slice still gets the right answer rather than a silent
        // mis-attribution.
        .max_by_key(|s| {
            DateTime::parse_from_rfc3339(&s.started_at)
                .map(|d| d.timestamp_millis())
                .unwrap_or(i64::MIN)
        })
        .map(|s| s.id.clone())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W2/PR2-session-actor.md` §5.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

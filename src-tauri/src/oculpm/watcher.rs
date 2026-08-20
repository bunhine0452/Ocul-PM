//! Filesystem watcher — W2-PR3.
//!
//! Wraps `notify-debouncer-full` and routes each batch through:
//!   1. self-suppress (our own `.oculpm/index/`, `.lock`, log, `*.tmp`),
//!   2. `.oculpm/agents/**` / `.oculpm/journal/**` → tauri event emit only,
//!   3. `watcher.ignore` glob + project `.gitignore`,
//!   4. classify into `FileOp` + blake3 hash (≤ 8 MB),
//!   5. `git.forbid_journal_for_paths` masking,
//!   6. `SessionActor::note_activity` (which stamps session_id + ts and
//!      writes the ndjson line),
//!   7. `oculpm:file_changed` emit.
//!
//! Threading model: `notify-debouncer-full` runs its own OS-watch thread;
//! we bridge its callback to a tokio `mpsc` channel and drain the channel in
//! a single tokio task. `stop` drops the debouncer (kills the OS thread) and
//! awaits the task (drains pending events).
//!
//! See `docs/major_update/oculpm/W2/PR3-watcher-notify.md`.

#![allow(dead_code)] // Consumed by W2-PR6 (commands) + W2 manager bootstrap.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap,
};
use regex::Regex;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::db::Db;
use crate::embedding::Embedder;
use crate::oculpm::agents;
use crate::oculpm::cache::{JournalCache, PathChangeKind, UpsertOutcome};
use crate::oculpm::claude_hooks::{self, HookSignal};
use crate::oculpm::error::OculpmError;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::redact::{self, build_forbidden_matcher};
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{
    FileChangeEvent, FileOp, IntegrityWarning, OculpmAgentDrift, OculpmAgentsTemplateChanged,
    OculpmConfig, OculpmFileChanged, OculpmIntegrityWarning, OculpmJournalAdded,
    OculpmJournalPathChanged, OculpmJournalUpdated, Session, WatcherStateView, WatcherStatus,
};

/// Files ≤ this byte cap get a blake3 hash; larger files leave `hash_after`
/// as `None` (consumers infer "large-file-hash-skipped" from the absence).
const HASH_BYTE_CAP: u64 = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────────

/// Active filesystem watcher for one project. Dropping or calling `stop`
/// halts the debouncer thread and ends the event-processing task.
pub struct ProjectWatcher {
    project_id: u32,
    /// `Option` so `stop` can `take()` and drop ahead of awaiting the task.
    debouncer: Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>,
    join_handle: JoinHandle<()>,
    stats: Arc<RwLock<WatcherStatsInner>>,
    debounce_ms: u32,
}

#[derive(Debug, Default)]
struct WatcherStatsInner {
    events_seen_total: u32,
    events_ignored_total: u32,
    last_event_at: Option<DateTime<Utc>>,
}

impl ProjectWatcher {
    /// Build the matchers, spawn the debouncer thread, and start the
    /// processing task. Returns once notify is registered and the receive
    /// loop is running.
    pub async fn start(
        project_id: u32,
        root: PathBuf,
        session: SessionActor,
        index_writer: Arc<IndexWriter>,
        config: OculpmConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<Self, OculpmError> {
        // Canonicalize so notify-reported paths (macOS resolves `/tmp` →
        // `/private/tmp`) compare cleanly against the stored root.
        let root = root.canonicalize().unwrap_or(root);

        let user_ignore = build_gitignore_from_lines(&root, &config.watcher.ignore);
        let project_gitignore = if config.watcher.respect_gitignore {
            load_project_gitignore(&root)
        } else {
            None
        };
        // Forbidden-path matcher delegated to `oculpm::redact` (W4-PR3) so the
        // watcher and `manager::create_manual_journal_entry` see the same
        // glob semantics — see `oculpm::redact::is_forbidden_path`.
        let forbidden = build_forbidden_matcher(&root, &config.git.forbid_journal_for_paths);
        // R1 — compile the project's secret patterns once; the journal cache
        // projection masks agent-authored bodies on read and the diff capture
        // masks patch content, so neither a pasted key reaches the cache (→ AI
        // context) nor the persisted sidecar.
        let redact_patterns = redact::compile_redact_patterns(&config.git.auto_redact_patterns);
        // Config tz already validated by `OculpmConfig::validate` on load; fall
        // back to UTC if somehow unparseable rather than failing watcher start.
        let tz: Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);

        let stats = Arc::new(RwLock::new(WatcherStatsInner::default()));
        let inner = WatcherInner {
            project_id,
            root: root.clone(),
            session,
            index_writer,
            app_handle,
            user_ignore,
            project_gitignore,
            forbidden,
            redact_patterns,
            tz,
            auto_reconcile: config.agents.auto_reconcile,
            reconcile_lock: Arc::new(tokio::sync::Mutex::new(())),
            hook_inbox_offset: Arc::new(tokio::sync::Mutex::new(None)),
            hook_open_sessions: Arc::new(tokio::sync::Mutex::new(BTreeSet::new())),
            auto_journal_draft: config.agents.auto_journal_draft,
            draft_lock: Arc::new(tokio::sync::Mutex::new(())),
            stats: stats.clone(),
        };

        // PR-CI0 — 앱이 꺼진 동안 큐잉된 훅 이벤트를 즉시 소비한다. 인박스는
        // append 가 있어야만 fs 이벤트가 오므로, 시작 시 1회 능동 소비가
        // 없으면 "앱 켜기 전에 끝난 Claude 세션" 이 다음 append 까지 미처리로
        // 남는다.
        inner.consume_hooks_inbox().await;

        // Bridge std/sync notify worker → tokio task.
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<DebounceEventResult>();
        let debounce_ms = config.watcher.debounce_ms;
        let mut debouncer = new_debouncer(
            Duration::from_millis(u64::from(debounce_ms)),
            None,
            move |result: DebounceEventResult| {
                // UnboundedSender::send is sync and can be called outside a
                // tokio runtime — perfect for the debouncer's worker thread.
                let _ = event_tx.send(result);
            },
        )
        .map_err(|e| OculpmError::Io {
            path: root.clone(),
            source: std::io::Error::other(format!("notify init: {e}")),
        })?;

        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| OculpmError::Io {
                path: root.clone(),
                source: std::io::Error::other(format!("notify watch: {e}")),
            })?;

        let join_handle = tokio::spawn(async move {
            while let Some(result) = event_rx.recv().await {
                match result {
                    Ok(events) => {
                        for ev in events {
                            inner.handle_event(ev).await;
                        }
                    }
                    Err(errs) => {
                        tracing::warn!(target: "oculpm::watcher", ?errs, "[FLOW] debouncer reported errors");
                    }
                }
            }
            tracing::info!(target: "oculpm::watcher", "[FLOW] watcher receive loop exited (stop() called)");
        });

        tracing::info!(
            target: "oculpm::watcher",
            project_id,
            root = %root.display(),
            debounce_ms,
            respect_gitignore = config.watcher.respect_gitignore,
            "[FLOW] watcher armed — listening for fs events"
        );

        Ok(Self {
            project_id,
            debouncer: Some(debouncer),
            join_handle,
            stats,
            debounce_ms,
        })
    }

    /// Halt the OS watcher + drain pending events. Idempotent — calling
    /// `stop` twice is a no-op the second time.
    pub async fn stop(mut self) -> Result<(), OculpmError> {
        // Drop the debouncer first → its internal worker thread exits → the
        // event_tx captured in the callback drops → recv returns None → the
        // tokio task finishes after draining any buffered events.
        self.debouncer.take();
        self.join_handle
            .await
            .map_err(|_| OculpmError::ActorClosed)?;
        Ok(())
    }

    pub fn project_id(&self) -> u32 {
        self.project_id
    }

    pub fn status(&self) -> WatcherStatus {
        let stats = self.stats.read().unwrap();
        WatcherStatus {
            state: if self.debouncer.is_some() {
                WatcherStateView::Running
            } else {
                WatcherStateView::Stopped
            },
            events_seen_total: stats.events_seen_total,
            events_ignored_total: stats.events_ignored_total,
            last_event_at: stats.last_event_at.map(|t| t.to_rfc3339()),
            debounce_ms: self.debounce_ms,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner: event processing
// ─────────────────────────────────────────────────────────────────────────────

struct WatcherInner {
    project_id: u32,
    root: PathBuf,
    session: SessionActor,
    index_writer: Arc<IndexWriter>,
    app_handle: Option<tauri::AppHandle>,
    user_ignore: Gitignore,
    project_gitignore: Option<Gitignore>,
    forbidden: Gitignore,
    /// Compiled `auto_redact_patterns`. Empty → masking is a no-op. Used to
    /// build a redacting [`JournalCache`] for journal upserts and threaded into
    /// per-entry diff capture (dev-report §2 / R1).
    redact_patterns: Vec<Regex>,
    /// Project timezone (from `config.workday.timezone`). Threaded into the
    /// redacting [`JournalCache`] so read-time `created_at` offset backfill
    /// (F7a-B) interprets tz-less agent timestamps as project-local.
    tz: Tz,
    /// F1 — opt-in: when on, a newly-inserted journal entry triggers a
    /// background LLM reconciliation of every active plan. Mirrors
    /// `config.agents.auto_reconcile`.
    auto_reconcile: bool,
    /// Bounds F1 to ONE in-flight reconcile per project (try-lock at spawn;
    /// overlapping inserts are dropped). Distinct from the shared
    /// `plan_write_lock` (N4), which serialises the actual plan-file writes
    /// against the in-app writers.
    reconcile_lock: Arc<tokio::sync::Mutex<()>>,
    /// PR-CI0 — Claude Code 훅 인박스의 소비 오프셋. `None` = 아직 DB 에서
    /// 로드 전 (lazy). 값은 소비할 때마다 DB(`claude_hooks_inbox`)에 영속 —
    /// 앱 재시작 후 큐잉된 이벤트를 정확히 이어서 소비한다. 테스트처럼
    /// `app_handle` 이 없으면 메모리 전용.
    hook_inbox_offset: Arc<tokio::sync::Mutex<Option<u64>>>,
    /// PR-CI0 — 현재 열려 있는 Claude 세션 id 집합. 여러 터미널 동시 세션에서
    /// 마지막 SessionEnd 에만 종료 신호를 내기 위함 (claude_hooks::apply_event).
    hook_open_sessions: Arc<tokio::sync::Mutex<BTreeSet<String>>>,
    /// PR-CI1 — opt-in: 훅 세션 종료(AgentExit) 시 transcript 를 LLM 으로
    /// 요약해 일지 초안 1건을 자동 작성. `config.agents.auto_journal_draft`.
    auto_journal_draft: bool,
    /// PR-CI1 — 일지 초안 단일 인플라이트 (reconcile_lock 동형).
    draft_lock: Arc<tokio::sync::Mutex<()>>,
    stats: Arc<RwLock<WatcherStatsInner>>,
}

impl WatcherInner {
    async fn handle_event(&self, ev: DebouncedEvent) {
        // notify emits one event per path-change; for renames the debouncer
        // batches Modify(Name(From)) + Modify(Name(To)) but we process them
        // one path at a time and let "file exists?" decide Create vs Delete.
        let path = match ev.event.paths.first() {
            Some(p) => p.clone(),
            None => return,
        };

        self.bump_seen();

        let rel_str = match path.strip_prefix(&self.root) {
            Ok(p) => p.to_string_lossy().to_string(),
            // Outside our watched root — ignore quietly.
            Err(_) => {
                self.bump_ignored();
                return;
            }
        };

        // 1. Self-suppress.
        if is_self_suppressed(&rel_str) {
            self.bump_ignored();
            return;
        }

        // 1.5 PR-CI0 — Claude Code 훅 인박스 (D1). 훅 커맨드의 `cat` append 가
        //     이 경로로 들어온다. 코드 변경 파이프라인(ndjson/일지/인덱싱)에는
        //     절대 넣지 않고, 인박스 소비(→ SessionActor 정밀 신호)만 한다.
        if rel_str.starts_with(".oculpm/hooks/") {
            self.consume_hooks_inbox().await;
            return;
        }

        // 2. .oculpm/agents/** — emit + cascading re-sync of every active
        //    adapter. The cascade is what makes `_template.md` (master) the
        //    single source of truth: users edit one file and Cursor / Claude
        //    Code / etc. all get the new rules in one debounce window.
        //    Adapter writes themselves land outside `.oculpm/agents/` so
        //    there's no feedback loop. Idempotency in `sync_active` covers
        //    the spurious self-event when we wrote the master ourselves.
        if rel_str.starts_with(".oculpm/agents/") {
            self.emit_agents_template_changed(&rel_str);
            self.cascade_agents_resync().await;
            return;
        }

        // 3. .oculpm/journal/** — emit Tauri event AND invalidate the SQLite
        //    cache so list/get queries see the change without waiting for a
        //    manual reindex. Before this wire-up, the watcher only emitted
        //    the event and the frontend's refetch hit a stale cache (file
        //    deletes never disappeared from Today UI). See dogfooding F-2.
        if rel_str.starts_with(".oculpm/journal/") {
            let op = classify_journal_op(&ev.event.kind);
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %rel_str,
                ?op,
                "[FLOW] journal fs event detected"
            );
            self.emit_journal_path_changed(&rel_str, op);
            self.apply_journal_cache_invalidation(&rel_str, op).await;
            return;
        }

        // 3.5 .oculpm/planner/** — AI-maintained Plan SSOT (Planner Upgrade).
        //     The projection rebuilds from the file on read (plan_* commands
        //     reproject), so we short-circuit here to keep plan edits out of
        //     the code-change ndjson pipeline. The live-push event for the
        //     Planner UI lands in PR-PLN 3.
        if rel_str.starts_with(".oculpm/planner/") {
            tracing::debug!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %rel_str,
                "[FLOW] planner fs event (handled by projection on read)"
            );
            return;
        }

        // 3.6 .oculpm/discussion/** — problem-solving (Discussion) SSOT.
        //     Like planner, the projection rebuilds from disk on read
        //     (discussion_* commands reproject), so short-circuit here to keep
        //     discussion edits out of the code-change ndjson pipeline. The
        //     live-push event for the UI lands in PR-DISC 3.
        if rel_str.starts_with(".oculpm/discussion/") {
            tracing::debug!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %rel_str,
                "[FLOW] discussion fs event (handled by projection on read)"
            );
            return;
        }

        // 4. config.toml — restart deferred to W4.
        if rel_str == ".oculpm/config.toml" {
            tracing::info!(
                target: "oculpm::watcher",
                "config.toml changed — watcher restart deferred to W4"
            );
            return;
        }

        // 4.5 (W4-PR4) — adapter marker files: a change is either ours (last
        // sync) or someone-else's (drift). We route to the manager which
        // compares the disk hash against the row in `oculpm_agent_state`;
        // self-writes match and produce no emit, external writes don't and
        // produce `OculpmAgentDrift`. Adapter files never enter the ndjson
        // pipeline (they're our infrastructure, not user code), so we return
        // before the ignore filter — even a user who gitignores `.cursor/`
        // still gets drift notifications.
        if agents::lookup_adapter_by_path(&rel_str).is_some() {
            self.check_and_emit_agent_drift(&rel_str).await;
            return;
        }

        // 4.6 W4 dogfooding (2026-05-27) — agent internal state files
        // (`.claude/settings.json`, `.cursor/history/*`, …) leaked into ndjson
        // and polluted `compare_layers` with dozens of fake "누락" rows. The
        // adapter file itself was already routed at step 4.5, so anything
        // *still* under a known agent dir at this point is the agent's own
        // bookkeeping — not user code, never journaled, never compared.
        if is_agent_state_path(&rel_str) {
            self.bump_ignored();
            return;
        }

        // 5. Skip directories — we only track files.
        if path.is_dir() {
            self.bump_ignored();
            return;
        }

        // 6. ignore / gitignore filters.
        if !self.should_track(&path) {
            self.bump_ignored();
            return;
        }

        // 7. Classify + hash.
        let mut change = match self.classify(&path, &ev.event.kind).await {
            Some(c) => c,
            None => {
                self.bump_ignored();
                return;
            }
        };

        // 7.5 — Incremental auto-index (PR-5). Keep the code-search index
        // (chunks / embeddings / symbols) current without a manual rebuild.
        // Forbidden paths are skipped here (they're never indexed), and the
        // work is fire-and-forget so the embedding model never stalls the
        // watcher loop. Uses the real relative path before step-8 masking.
        if !self.is_forbidden(&path) {
            self.schedule_incremental_index(change.path.clone(), change.op, change.hash_after.clone());
        }

        // 8. Forbidden-path masking.
        if self.is_forbidden(&path) {
            change.path = format!("**redacted/sensitive**:{}", short_hash_of(&change.path));
            change.hash_before = None;
            change.hash_after = None;
        }

        // 9. Route to session actor (which stamps session_id + ts and writes
        //    the ndjson line). Watcher leaves those fields empty.
        if let Err(e) = self.session.note_activity(change.clone()) {
            tracing::warn!(target: "oculpm::watcher", error = ?e, "session note_activity failed");
            return;
        }

        // 10. Emit file_changed.
        self.emit_file_changed(&change);
        self.touch_last_event_at();
    }

    /// PR-CI0 — 인박스(`.oculpm/hooks/claude-events.jsonl`)를 오프셋부터
    /// 소비한다. 완전한 라인만 파싱(부분 append 허용), 소비 오프셋은 DB 에
    /// 영속. 이벤트는 열린-세션 집합을 거쳐 SessionActor 정밀 신호가 된다.
    /// 우리 쪽 쓰기는 DB 뿐이라 fs 피드백 루프가 없다.
    async fn consume_hooks_inbox(&self) {
        let path = self.root.join(claude_hooks::INBOX_REL);
        let root_key = self.root.to_string_lossy().to_string();

        let mut offset_guard = self.hook_inbox_offset.lock().await;
        if offset_guard.is_none() {
            // Lazy init: 앱 재시작 후에도 소비 지점을 이어간다.
            let stored: u64 = match &self.app_handle {
                Some(handle) => {
                    use tauri::Manager;
                    let db = handle.state::<Db>();
                    db.claude_hooks_offset_get(root_key.clone())
                        .await
                        .ok()
                        .flatten()
                        .and_then(|v| u64::try_from(v).ok())
                        .unwrap_or(0)
                }
                None => 0,
            };
            *offset_guard = Some(stored);
        }
        let mut offset = offset_guard.unwrap_or(0);

        let bytes = match tokio::fs::read(&path).await {
            Ok(b) => b,
            Err(_) => return, // 인박스 없음 (훅 미설치 또는 아직 이벤트 0)
        };
        if (bytes.len() as u64) < offset {
            // 파일이 줄었다 — 사용자가 지웠거나 재생성. 처음부터 다시.
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                "hooks inbox shrank — resetting consume offset"
            );
            offset = 0;
        }
        if (bytes.len() as u64) == offset {
            *offset_guard = Some(offset);
            return;
        }

        let (events, consumed) = claude_hooks::parse_inbox_slice(&bytes[offset as usize..]);
        let new_offset = offset + consumed;
        *offset_guard = Some(new_offset);
        drop(offset_guard);

        if let Some(handle) = &self.app_handle {
            use tauri::Manager;
            let db = handle.state::<Db>();
            if let Err(e) = db
                .claude_hooks_offset_set(root_key, new_offset as i64)
                .await
            {
                tracing::warn!(target: "oculpm::watcher", error = %e, "hooks inbox offset persist failed");
            }
        }

        if events.is_empty() {
            return;
        }
        // PR-CI1 — AgentEnded 시 초안 생성에 넘길 (finalize 직전) 세션 스냅샷.
        let mut pending_draft: Option<(Session, Option<String>, String)> = None;
        let mut open = self.hook_open_sessions.lock().await;
        for ev in &events {
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                event = %ev.hook_event_name,
                claude_session = %ev.session_id,
                "[FLOW] claude hook event"
            );
            match claude_hooks::apply_event(&mut open, ev) {
                HookSignal::AgentActive => {
                    if let Err(e) = self
                        .session
                        .hook_agent_active(claude_hooks::HOOK_AGENT_LABEL)
                    {
                        tracing::warn!(target: "oculpm::watcher", error = ?e, "hook_agent_active send failed");
                    }
                }
                HookSignal::AgentEnded => {
                    // PR-CI1 — finalize 명령보다 먼저 질의해 세션 id/시작 시각을
                    // 확보한다 (actor 는 mpsc 순서대로 처리하므로 이 질의는
                    // 아직 Active 상태를 본다). 옵인 off / 헤드리스면 스킵.
                    if self.auto_journal_draft && self.app_handle.is_some() {
                        if let Ok(Some(sess)) = self.session.get_current_session().await {
                            pending_draft =
                                Some((sess, ev.transcript_path.clone(), ev.session_id.clone()));
                        }
                    }
                    if let Err(e) = self.session.hook_agent_ended() {
                        tracing::warn!(target: "oculpm::watcher", error = ?e, "hook_agent_ended send failed");
                    }
                }
                HookSignal::None => {}
            }
        }
        drop(open);
        if let Some((sess, transcript_path, claude_session_id)) = pending_draft {
            self.spawn_journal_draft(sess, transcript_path, claude_session_id);
        }
    }

    /// PR-CI1 — fire-and-forget 일지 자동 초안. 옵인·과금은 호출부에서 걸렀고,
    /// 여기서는 단일 인플라이트(try_lock)만 보장한다. 실패는 로그로 삼킨다 —
    /// 초안 실패가 watcher 를 멈추면 안 된다 (reconcile 동형).
    fn spawn_journal_draft(
        &self,
        session: Session,
        transcript_path: Option<String>,
        claude_session_id: String,
    ) {
        let Some(handle) = self.app_handle.clone() else {
            return;
        };
        let Ok(guard) = self.draft_lock.clone().try_lock_owned() else {
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                "journal draft already in flight — skipped"
            );
            return;
        };
        let project_id = self.project_id;
        let root = self.root.clone();
        let index_writer = self.index_writer.clone();
        let redact = self.redact_patterns.clone();
        tauri::async_runtime::spawn(async move {
            let _guard = guard;
            match crate::oculpm::journal_draft::draft_for_session(
                handle,
                project_id,
                root,
                index_writer,
                redact,
                session,
                transcript_path,
                claude_session_id,
            )
            .await
            {
                Ok(outcome) => {
                    tracing::info!(
                        target: "oculpm::watcher",
                        project_id,
                        ?outcome,
                        "[FLOW] journal draft outcome"
                    );
                }
                Err(e) => {
                    tracing::warn!(target: "oculpm::watcher", project_id, error = %e, "journal draft failed");
                }
            }
        });
    }

    fn should_track(&self, abs_path: &Path) -> bool {
        if self
            .user_ignore
            .matched_path_or_any_parents(abs_path, false)
            .is_ignore()
        {
            return false;
        }
        if let Some(gi) = &self.project_gitignore {
            if gi.matched_path_or_any_parents(abs_path, false).is_ignore() {
                return false;
            }
        }
        true
    }

    fn is_forbidden(&self, abs_path: &Path) -> bool {
        redact::is_forbidden_path(&self.forbidden, &abs_path.to_string_lossy())
    }

    async fn classify(&self, abs_path: &Path, kind: &EventKind) -> Option<FileChangeEvent> {
        use notify::event::ModifyKind;

        let exists = abs_path.is_file();
        let op = match kind {
            EventKind::Create(_) => FileOp::Create,
            EventKind::Remove(_) => FileOp::Delete,
            EventKind::Modify(ModifyKind::Name(_)) => {
                // Rename: split into Delete + Create across the batch — here
                // we just look at the path that this event references.
                if exists {
                    FileOp::Create
                } else {
                    FileOp::Delete
                }
            }
            EventKind::Modify(_) => FileOp::Update,
            // Access / Other / Any — ignored.
            _ => return None,
        };

        let rel = abs_path.strip_prefix(&self.root).ok()?;
        let rel_str = rel.to_string_lossy().to_string();

        let mut bytes_u: u32 = 0;
        let mut hash_after: Option<String> = None;
        if exists && !matches!(op, FileOp::Delete) {
            if let Ok(meta) = std::fs::metadata(abs_path) {
                let len = meta.len();
                bytes_u = u32::try_from(len).unwrap_or(u32::MAX);
                if len <= HASH_BYTE_CAP {
                    if let Ok(bytes) = std::fs::read(abs_path) {
                        hash_after = Some(format!("blake3:{}", blake3::hash(&bytes).to_hex()));
                    }
                }
                // Larger than cap → hash_after stays None. Consumers infer
                // "large-file-hash-skipped" from `bytes > HASH_BYTE_CAP && hash_after.is_none()`.
            }
        }

        Some(FileChangeEvent {
            ts: String::new(),         // stamped by SessionActor on append
            session_id: String::new(), // stamped by SessionActor on append
            op,
            path: rel_str,
            hash_before: None, // pre-event hash tracking is a W6 feature
            hash_after,
            bytes: bytes_u,
        })
    }

    // ─── Stats + emit helpers ───────────────────────────────────────────────

    fn bump_seen(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.events_seen_total = s.events_seen_total.saturating_add(1);
        }
    }

    fn bump_ignored(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.events_ignored_total = s.events_ignored_total.saturating_add(1);
        }
    }

    fn touch_last_event_at(&self) {
        if let Ok(mut s) = self.stats.write() {
            s.last_event_at = Some(Utc::now());
        }
    }

    fn emit_file_changed(&self, event: &FileChangeEvent) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmFileChanged {
                project_id: self.project_id,
                event: event.clone(),
            }
            .emit(handle);
        }
    }

    /// PR-5 — fire-and-forget incremental reindex of one changed code file so
    /// semantic / symbol / text search stays fresh without a manual rebuild.
    ///
    /// Guard rails:
    ///   - gated behind the `auto_index` setting (default on when unset),
    ///   - only runs for projects that *already* have an index — we keep an
    ///     existing index current, we never trigger a first-time model
    ///     download + full embed storm (that stays the explicit "인덱스 재구축"),
    ///   - skips non-indexable paths (lock files, binaries, oversized) via the
    ///     same per-file filter the full sweep uses,
    ///   - runs on a background task so the embedding model never stalls the
    ///     watcher's debounce loop.
    fn schedule_incremental_index(&self, rel_path: String, op: FileOp, hash_after: Option<String>) {
        let Some(handle) = self.app_handle.clone() else {
            return;
        };
        let project_id = self.project_id;
        let root = self.root.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let db = handle.state::<Db>();

            // Respect the user toggle (treat unset / anything-but-off as on).
            let auto = db.settings_get("auto_index".to_string()).await.ok().flatten();
            if matches!(auto.as_deref(), Some("false") | Some("0")) {
                return;
            }
            // Only keep an existing index fresh — bootstrapping stays manual.
            if !matches!(db.count_files(project_id).await, Ok(n) if n > 0) {
                return;
            }

            // Skip when the content hasn't actually changed. The watcher already
            // hashed the file (`hash_after`), so comparing against the indexed
            // hash lets us avoid a redundant re-read + re-embed — which on macOS
            // is what re-triggers the "access files from another app" permission
            // prompt on every editor save (dogfooding 2026-06-15). Only Create/
            // Update carry a hash; Delete always proceeds.
            if !matches!(op, FileOp::Delete) {
                if let Some(h) = hash_after.as_deref() {
                    let new_hash = h.strip_prefix("blake3:").unwrap_or(h);
                    if let Ok(Some((_, stored))) =
                        db.get_file_hash(project_id, rel_path.clone()).await
                    {
                        if stored == new_hash {
                            return;
                        }
                    }
                }
            }

            match op {
                FileOp::Delete => match db.delete_file_by_path(project_id, rel_path.clone()).await {
                    Ok(()) => tracing::debug!(
                        target: "oculpm::watcher", project_id, path = %rel_path,
                        "auto-index: removed deleted file"
                    ),
                    Err(e) => tracing::warn!(
                        target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                        "auto-index: delete failed"
                    ),
                },
                _ => {
                    let settings_map: std::collections::HashMap<String, String> =
                        match db.settings_get_all().await {
                            Ok(v) => v.into_iter().collect(),
                            Err(_) => return,
                        };
                    let cfg = crate::indexer::config_from_settings(|k| settings_map.get(k).cloned());
                    let abs = root.join(&rel_path);
                    if !crate::indexer::is_indexable_path(&abs, &cfg) {
                        return;
                    }
                    let embedder = handle.state::<Embedder>();
                    match crate::commands::diff::reindex_single_file(
                        &db, &embedder, project_id, &root, &cfg, &rel_path,
                    )
                    .await
                    {
                        Ok((emb, _ast)) => tracing::debug!(
                            target: "oculpm::watcher", project_id, path = %rel_path,
                            embeddings = emb, "auto-index: reindexed"
                        ),
                        Err(reason) => tracing::warn!(
                            target: "oculpm::watcher", project_id, path = %rel_path,
                            ?reason, "auto-index: reindex skipped"
                        ),
                    }
                }
            }
        });
    }

    fn emit_agents_template_changed(&self, relative_path: &str) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmAgentsTemplateChanged {
                project_id: self.project_id,
                relative_path: relative_path.to_string(),
            }
            .emit(handle);
        }
    }

    fn emit_journal_path_changed(&self, relative_path: &str, op: FileOp) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmJournalPathChanged {
                project_id: self.project_id,
                relative_path: relative_path.to_string(),
                op,
            }
            .emit(handle);
        }
    }

    /// Trigger a full agent-adapter re-sync (PR4 master-edit cascade). Same
    /// gating as `apply_journal_cache_invalidation` — `app_handle: None`
    /// makes this a no-op so existing unit tests stay self-contained.
    /// Failures are logged but never escalated; the next `sync_agents` call
    /// (Settings save / next agents edit) will retry.
    async fn cascade_agents_resync(&self) {
        let Some(handle) = &self.app_handle else { return };
        use tauri::Manager;
        let manager: tauri::State<'_, OculpmManager> = handle.state::<OculpmManager>();
        let db: tauri::State<'_, Db> = handle.state::<Db>();
        if let Err(e) = manager.sync_agents(&db, self.project_id).await {
            tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                error = %e,
                "agents cascade resync failed"
            );
        }
    }

    /// W4-PR4 — compare the current adapter file hash to `oculpm_agent_state`
    /// and emit `OculpmAgentDrift` on mismatch. Gated on `app_handle: None`
    /// so the unit tests that build a self-contained watcher (no DB / event
    /// bus) skip the check — see `setup_with_config`. Errors are logged but
    /// never escalated; the next sync will recompute the row.
    async fn check_and_emit_agent_drift(&self, relative_path: &str) {
        let Some(handle) = &self.app_handle else { return };
        use tauri::Manager;
        let manager: tauri::State<'_, OculpmManager> = handle.state::<OculpmManager>();
        let db: tauri::State<'_, Db> = handle.state::<Db>();
        match manager
            .check_agent_drift(&db, self.project_id, relative_path)
            .await
        {
            Ok(Some((agent_id, expected_hash, actual_hash))) => {
                self.emit_agent_drift(&agent_id, &expected_hash, &actual_hash);
                tracing::info!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    agent_id = %agent_id,
                    "agent adapter drift detected"
                );
            }
            Ok(None) => {
                // Matched our last write (or no prior baseline yet) — nothing
                // to notify. Logged at trace so high-frequency saves don't
                // flood the log.
                tracing::trace!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %relative_path,
                    "adapter change matched expected hash; no drift"
                );
            }
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %relative_path,
                    error = %e,
                    "drift check failed"
                );
            }
        }
    }

    fn emit_agent_drift(&self, agent_id: &str, expected_hash: &str, actual_hash: &str) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmAgentDrift {
                project_id: self.project_id,
                agent_id: agent_id.to_string(),
                expected_hash: expected_hash.to_string(),
                actual_hash: actual_hash.to_string(),
            }
            .emit(handle);
        }
    }

    /// Mirror a `.oculpm/journal/**` change into the SQLite cache so the next
    /// `oculpm_list_journal_entries` reflects it. Gated on `app_handle` (the
    /// only path to the process-wide `Db` state) so unit tests that pass
    /// `app_handle: None` stay self-contained — see `setup_with_config`.
    ///
    /// `full_rel_str` is relative to the project root and starts with
    /// `.oculpm/journal/`; we strip that prefix to get the cache-key form
    /// (`<workday>/<Category>/<file>.md`).
    async fn apply_journal_cache_invalidation(&self, full_rel_str: &str, op: FileOp) {
        let Some(handle) = &self.app_handle else { return };
        let Some(entry_rel) = full_rel_str.strip_prefix(".oculpm/journal/") else { return };
        if !is_journal_entry_path(entry_rel) {
            return;
        }
        use tauri::Manager;

        // Resolve PathChangeKind from FS reality, not from the event op alone.
        // See `resolve_path_change_kind` for the rationale + macOS quirks.
        let journal_root = self.root.join(".oculpm").join("journal");
        let abs = journal_root.join(entry_rel);
        let exists = abs.is_file();
        let kind = resolve_path_change_kind(op, exists);

        let db_state: tauri::State<'_, Db> = handle.state::<Db>();
        // R1 — build the cache with redaction so an agent-authored body carrying
        // a secret is masked on projection (disk SSOT untouched); the count lets
        // us warn the user.
        let cache =
            JournalCache::with_redaction(&db_state, self.redact_patterns.clone()).with_tz(self.tz);
        match cache
            .apply_path_change(self.project_id, &journal_root, entry_rel, kind)
            .await
        {
            Ok((outcome, redacted_spans)) => {
                tracing::info!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    ?kind,
                    raw_op = ?op,
                    outcome = ?outcome,
                    redacted_spans,
                    "[FLOW] journal cache invalidated"
                );
                // W4 dogfooding follow-up (2026-05-26) — emit the high-level
                // OculpmJournalAdded / OculpmJournalUpdated events so the
                // frontend's toast + optimistic UI add (TimelineView,
                // WorkspaceContext) actually fire when an external LLM writes
                // a journal entry. Previously only the low-level
                // OculpmJournalPathChanged event was emitted, so the user
                // never saw "새 기록" toasts.
                let inserted = matches!(outcome, Some(UpsertOutcome::Inserted));
                let content_changed = matches!(
                    outcome,
                    Some(UpsertOutcome::Inserted | UpsertOutcome::Updated)
                );
                self.emit_journal_outcome(&cache, entry_rel, outcome).await;
                // R1 — the entry carried secret(s); we masked them in the cache
                // (disk untouched) and warn so the user can scrub the on-disk
                // markdown before committing `.oculpm/`. Gated on an actual
                // content write so an unchanged re-scan doesn't spam toasts.
                if content_changed && redacted_spans > 0 {
                    self.emit_integrity_warning(
                        "secret_redacted",
                        entry_rel,
                        &format!(
                            "작업 일지에서 비밀로 보이는 값 {redacted_spans}건을 캐시에서 가렸습니다. 디스크 원본도 확인하세요."
                        ),
                    );
                }
                // Persist per-file diffs for a brand-new entry so the 작업 일지
                // can re-open "그 시점의 변경" at any later time, even after the
                // file is committed (see oculpm::entry_diffs). Capture only on
                // first insert; best-effort, never blocks the cache path.
                if inserted {
                    self.capture_entry_diffs(&cache, entry_rel).await;
                    // F1 — opt-in: reconcile the active plan against this brand-new
                    // entry via a background LLM call. Spawned (never awaited) so a
                    // slow network call can't stall the watcher event loop; loop-safe
                    // because it writes only to planner/*.md (not a journal path).
                    if self.auto_reconcile {
                        self.spawn_reconcile(entry_rel);
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    ?kind,
                    raw_op = ?op,
                    error = %e,
                    "[FLOW] journal cache invalidation failed (event still emitted)"
                );
            }
        }
    }

    /// Capture + persist per-file diffs for a freshly-inserted entry. Loads the
    /// entry's `files_touched` from the cache, then offloads the (blocking) git
    /// diff + sidecar write to a blocking thread. Best-effort: any failure is
    /// logged, never propagated — a missing diff just renders as "기록된 변경
    /// 없음" in the UI. See `oculpm::entry_diffs`.
    async fn capture_entry_diffs(&self, cache: &JournalCache<'_>, entry_rel: &str) {
        let touched = match cache.get_entry(self.project_id, entry_rel).await {
            Ok(Some(entry)) => entry.frontmatter.files_touched,
            Ok(None) => return,
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    error = %e,
                    "entry-diff capture: get_entry failed"
                );
                return;
            }
        };
        if touched.is_empty() {
            return;
        }
        // PR-R3 snapshot fallback: pre-fetch last-indexed baselines so the
        // blocking capture can diff snapshot↔disk when `git diff` is empty
        // (committed / non-git). `app_handle: None` (unit tests) → no Db, empty
        // map → git-only behaviour (unchanged).
        let mut snapshots: std::collections::HashMap<String, Vec<u8>> =
            std::collections::HashMap::new();
        if let Some(handle) = &self.app_handle {
            use tauri::Manager;
            let db: tauri::State<'_, Db> = handle.state::<Db>();
            for f in &touched {
                if let Ok(Some(snap)) =
                    db.get_file_snapshot(self.project_id, f.path.clone()).await
                {
                    snapshots.insert(f.path.clone(), snap.content);
                }
            }
        }
        let root = self.root.clone();
        let entry_rel_owned = entry_rel.to_string();
        let redact = self.redact_patterns.clone();
        let res = tokio::task::spawn_blocking(move || {
            crate::oculpm::entry_diffs::capture_entry_diffs(
                &root,
                &entry_rel_owned,
                &touched,
                &snapshots,
                &redact,
            )
        })
        .await;
        match res {
            Ok(Ok(redacted_spans)) => {
                // R1 — masked a secret in the captured diff hunk(s); warn so the
                // user can scrub the source before committing.
                if redacted_spans > 0 {
                    self.emit_integrity_warning(
                        "secret_redacted",
                        entry_rel,
                        &format!("변경 diff에서 비밀로 보이는 값 {redacted_spans}건을 가렸습니다."),
                    );
                }
                // Count the captured patch into the cache so Today's 「라인 변화」
                // ring reflects this entry immediately — without waiting for the
                // next project-open backfill sweep.
                self.store_line_counts(cache, entry_rel).await;
            }
            Ok(Err(e)) => tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                error = %e,
                "entry-diff capture: sidecar write failed"
            ),
            Err(e) => tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                error = %e,
                "entry-diff capture: blocking task panicked"
            ),
        }
    }

    /// Derive per-file line churn from the entry's freshly-written diff sidecar
    /// and store it in the cache. Best-effort — a missing sidecar just leaves
    /// the columns NULL for the backfill sweep to retry.
    async fn store_line_counts(&self, cache: &JournalCache<'_>, entry_rel: &str) {
        let root = self.root.clone();
        let rel = entry_rel.to_string();
        let counts = match tokio::task::spawn_blocking(move || {
            crate::oculpm::entry_diffs::line_counts(&root, &rel)
        })
        .await
        {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    error = %e,
                    "line-count capture: blocking read panicked"
                );
                return;
            }
        };
        if let Err(e) = cache.set_line_counts(self.project_id, entry_rel, counts).await {
            tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                error = %e,
                "line-count capture: cache update failed"
            );
        }
    }

    /// F1 — spawn a background reconciliation of every active plan against a
    /// freshly-inserted journal entry. Fire-and-forget: a slow LLM call must
    /// not block the watcher loop. `reconcile_lock` bounds it to ONE in-flight
    /// reconcile per project; the shared `plan_write_lock` (N4) serialises each
    /// plan write against the in-app plan writers. No-op without an app handle
    /// (unit tests have no Db/keychain).
    fn spawn_reconcile(&self, entry_rel: &str) {
        let Some(handle) = self.app_handle.clone() else {
            return;
        };
        // Bound to ONE in-flight reconcile per project: if one is already
        // running, drop this entry rather than queue an unbounded backlog of
        // billable LLM calls during a write burst. Best-effort — the user's
        // manual "AI 갱신" reconciles against recent entries to cover any gaps.
        let Ok(guard) = self.reconcile_lock.clone().try_lock_owned() else {
            tracing::debug!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                "[FLOW] auto-reconcile skipped (another reconcile in flight)"
            );
            return;
        };
        let project_id = self.project_id;
        let root = self.root.clone();
        let entry_rel = entry_rel.to_string();
        let redact = self.redact_patterns.clone();
        let tz = self.tz;
        tokio::spawn(async move {
            use tauri::Manager;
            // Hold the guard for the whole reconcile so a concurrent insert
            // skips (above) instead of racing this plan write.
            let _guard = guard;
            let db = handle.state::<Db>();
            // N4 — the shared per-project plan-write lock, so reconcile's write
            // serializes against in-app plan writers (not just other reconciles).
            let plan_lock = handle.state::<OculpmManager>().plan_write_lock(project_id).await;
            match crate::oculpm::reconcile::reconcile_entry(
                &db, project_id, &root, &entry_rel, redact, tz, plan_lock,
            )
            .await
            {
                Ok(outcome) => {
                    // Surface each plan that actually changed to the UI (one
                    // toast per changed plan; no-op/skipped plans stay silent).
                    if let crate::oculpm::reconcile::ReconcileOutcome::Ran(results) = &outcome {
                        use tauri_specta::Event;
                        for r in results {
                            if r.applied > 0 {
                                let _ = crate::oculpm::spec::OculpmPlanReconciled {
                                    project_id,
                                    plan_id: r.plan_id.clone(),
                                    applied: r.applied as u32,
                                }
                                .emit(&handle);
                            }
                        }
                    }
                    tracing::info!(
                        target: "oculpm::watcher",
                        project_id,
                        path = %entry_rel,
                        ?outcome,
                        "[FLOW] auto-reconcile finished"
                    );
                }
                Err(e) => tracing::warn!(
                    target: "oculpm::watcher",
                    project_id,
                    path = %entry_rel,
                    error = %e,
                    "[FLOW] auto-reconcile failed (swallowed)"
                ),
            }
        });
    }

    /// Emit an `OculpmIntegrityWarning` toast (e.g. "비밀 N건 마스킹됨"). No-op
    /// when running without an app handle (unit tests). Mirrors the index
    /// actor's integrity-warning path.
    fn emit_integrity_warning(&self, kind: &str, path: &str, message: &str) {
        let Some(handle) = &self.app_handle else {
            return;
        };
        use tauri_specta::Event;
        let _ = OculpmIntegrityWarning {
            project_id: self.project_id,
            warning: IntegrityWarning {
                kind: kind.to_string(),
                path: path.to_string(),
                message: message.to_string(),
            },
        }
        .emit(handle);
    }

    /// Map a cache outcome to the matching high-level Tauri event. Inserted
    /// → JournalAdded (toast + optimistic add). Updated → JournalUpdated
    /// (silent re-render). MtimeOnly / SkippedUnchanged → no emit (the
    /// low-level JournalPathChanged already fired). Removed → handled by
    /// `apply_path_change` returning `None` (the path-changed event is
    /// enough to drop the row from UI).
    async fn emit_journal_outcome(
        &self,
        cache: &JournalCache<'_>,
        entry_rel: &str,
        outcome: Option<UpsertOutcome>,
    ) {
        let Some(handle) = &self.app_handle else { return };
        let Some(outcome) = outcome else { return };
        let should_emit_added = matches!(outcome, UpsertOutcome::Inserted);
        let should_emit_updated = matches!(outcome, UpsertOutcome::Updated);
        if !should_emit_added && !should_emit_updated {
            tracing::debug!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                outcome = ?outcome,
                "outcome not emit-worthy (mtime-only / unchanged)"
            );
            return;
        }

        let summary = match cache.get_summary_by_path(self.project_id, entry_rel).await {
            Ok(Some(s)) => s,
            Ok(None) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    "summary lookup returned None despite Inserted/Updated outcome — race?"
                );
                return;
            }
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id = self.project_id,
                    path = %entry_rel,
                    error = %e,
                    "summary lookup failed; skipping journal-added/updated emit"
                );
                return;
            }
        };

        use tauri_specta::Event;
        if should_emit_added {
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                title = %summary.title,
                "[FLOW] emitting OculpmJournalAdded"
            );
            let _ = OculpmJournalAdded {
                project_id: self.project_id,
                summary,
            }
            .emit(handle);
        } else {
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                title = %summary.title,
                "[FLOW] emitting OculpmJournalUpdated"
            );
            let _ = OculpmJournalUpdated {
                project_id: self.project_id,
                summary,
            }
            .emit(handle);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Paths the watcher must never report — either our own writes that would
/// boomerang, or universal editor/OS noise that no journal will ever record.
///
/// W4 dogfooding (2026-05-27) — pre-fix, `LayerComparison` flagged things
/// like `game.js.tmp.5C0aH-rJ` (npm `write-file-atomic` random-suffix tmp)
/// and `.DS_Store` as `journal 누락`, tanking jaccard. Real-world atomic
/// writes use `<dest>.tmp.<rand>` or `<dest>.<rand>.tmp`, so an exact
/// `.tmp` ending isn't enough — we also catch `.tmp.` infix.
fn is_self_suppressed(rel_str: &str) -> bool {
    if rel_str.starts_with(".oculpm/index/")
        || rel_str == ".oculpm/.lock"
        || rel_str == ".oculpm/oculpm.log"
    {
        return true;
    }
    // Atomic-write temp files.
    if rel_str.ends_with(".tmp") || rel_str.contains(".tmp.") {
        return true;
    }
    // Vim swap / backup.
    if rel_str.ends_with(".swp") || rel_str.ends_with(".swo") || rel_str.ends_with('~') {
        return true;
    }
    let basename = rel_str.rsplit('/').next().unwrap_or(rel_str);
    // macOS / Windows metadata.
    if basename == ".DS_Store" || basename == "Thumbs.db" || basename.starts_with("._") {
        return true;
    }
    // Dogfooding (2026-06-07) — transient tool/cache files leaked into the 변경
    // diff list. Tools write scratch files whose basename carries a `!`
    // (lockfile/backup conventions, JetBrains `___…`, etc.); these blink in and
    // out and are never journaled. A real source file almost never has `!` in
    // its name, so suppress any basename containing one.
    if basename.contains('!') {
        return true;
    }
    false
}

/// True when `rel_str` lives inside a known LLM-agent state directory but is
/// NOT the adapter file itself (those return earlier via
/// `agents::lookup_adapter_by_path`). The agent dir list is intentionally
/// hard-coded rather than derived from `known_adapters()` because adapters
/// also write peer files outside their declared adapter_path
/// (`.claude/settings.json`, `.cursor/history/*`, `.agent/sessions.json`)
/// — those are agent internal state, not user code.
fn is_agent_state_path(rel_str: &str) -> bool {
    const AGENT_STATE_DIRS: &[&str] = &[
        ".claude/",
        ".cursor/",
        ".gemini/",
        ".codeium/",
        ".aider/",
        ".windsurf/",
        ".copilot/",
        ".continue/",
        ".agent/",
        ".qodo/",
        ".antigravity/",
    ];
    AGENT_STATE_DIRS.iter().any(|d| rel_str.starts_with(d))
}

/// Map a notify [`FileOp`] + disk-existence into a [`PathChangeKind`] that
/// the cache layer can act on. We trust the filesystem over the event:
///
/// - **macOS FSEvents** frequently collapses removes into `EventKind::Modify(Any)`
///   (especially when the deleted file's parent dir mutates in the same
///   debounce window). Trusting `op` alone leaves stale cache rows when the
///   user deletes a journal file from Finder.
/// - A race where Create fires for a path that was immediately deleted
///   (`exists == false`) also resolves to `Removed` — the cache delete is
///   idempotent so a no-op is the worst case.
///
/// When the file does exist, `Create` keeps its semantics and everything
/// else (Update / Delete-but-still-there / Rename / Correct) becomes
/// `Modified` so the cache re-reads the new content.
fn resolve_path_change_kind(op: FileOp, exists: bool) -> PathChangeKind {
    if !exists {
        return PathChangeKind::Removed;
    }
    match op {
        FileOp::Create => PathChangeKind::Created,
        _ => PathChangeKind::Modified,
    }
}

/// True when `entry_rel` (relative to `.oculpm/journal/`) names a real
/// journal entry — matches the skip rules in `cache::walk_journal` so the
/// watcher never tries to insert `_template.md`, `_attachments/`, or hidden
/// files into the SQLite cache.
fn is_journal_entry_path(entry_rel: &str) -> bool {
    if !entry_rel.ends_with(".md") {
        return false;
    }
    if entry_rel.starts_with('_') {
        return false;
    }
    if entry_rel.contains("/_attachments/") {
        return false;
    }
    if entry_rel.split('/').any(|seg| seg.starts_with('.')) {
        return false;
    }
    true
}

fn classify_journal_op(kind: &EventKind) -> FileOp {
    match kind {
        EventKind::Create(_) => FileOp::Create,
        EventKind::Remove(_) => FileOp::Delete,
        _ => FileOp::Update,
    }
}

fn build_gitignore_from_lines(root: &Path, lines: &[String]) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    for line in lines {
        let _ = builder.add_line(None, line);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn load_project_gitignore(root: &Path) -> Option<Gitignore> {
    let gi_path = root.join(".gitignore");
    if !gi_path.exists() {
        return None;
    }
    let (gi, _err) = Gitignore::new(&gi_path);
    Some(gi)
}

fn short_hash_of(input: &str) -> String {
    let full = blake3::hash(input.as_bytes()).to_hex().to_string();
    full[..8].to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W2/PR3-watcher-notify.md` §7.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::paths::WorkdayResolver;
    use crate::oculpm::spec::OculpmConfig;
    use tempfile::TempDir;
    use tokio::time::sleep;

    /// Most tests use a 150ms debounce + 350ms wait to keep wall-clock short.
    fn fast_config() -> OculpmConfig {
        let mut cfg = OculpmConfig::default_for_new_project();
        cfg.watcher.debounce_ms = 150;
        // Make sure node_modules / .git are in the default ignore set.
        cfg
    }

    fn today_workday(resolver: &WorkdayResolver) -> String {
        resolver.workday_of(Utc::now())
    }

    struct Setup {
        dir: TempDir,
        resolver: WorkdayResolver,
        writer: Arc<IndexWriter>,
        actor: SessionActor,
        watcher: ProjectWatcher,
    }

    async fn setup_with_config(cfg: OculpmConfig) -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        let writer = Arc::new(IndexWriter::new(
            dir.path().to_path_buf(),
            resolver.clone(),
        ));
        let actor = SessionActor::spawn(
            1,
            resolver.clone(),
            writer.clone(),
            cfg.session.clone(),
            None,
        );
        let watcher = ProjectWatcher::start(
            1,
            dir.path().to_path_buf(),
            actor.clone(),
            writer.clone(),
            cfg,
            None,
        )
        .await
        .unwrap();

        // Give notify a moment to install the FSEvents subscription on macOS.
        sleep(Duration::from_millis(150)).await;

        Setup {
            dir,
            resolver,
            writer,
            actor,
            watcher,
        }
    }

    async fn setup() -> Setup {
        setup_with_config(fast_config()).await
    }

    async fn settle() {
        sleep(Duration::from_millis(450)).await;
    }

    /// Case 1 — five distinct files modified → five ndjson events emitted.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn five_file_modifications_produce_five_ndjson_events() {
        let s = setup().await;
        for i in 0..5 {
            std::fs::write(
                s.dir.path().join(format!("file_{i}.rs")),
                format!("content-{i}"),
            )
            .unwrap();
        }
        settle().await;
        // Stop the watcher cleanly before reading (drains queued events).
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let paths: std::collections::HashSet<_> =
            events.iter().map(|e| e.path.as_str()).collect();
        for i in 0..5 {
            assert!(
                paths.contains(format!("file_{i}.rs").as_str()),
                "missing file_{i}.rs in {paths:?}"
            );
        }
    }

    /// Case 2 — node_modules is gitignored by default; events there must not
    /// produce ndjson rows.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn gitignored_paths_are_ignored() {
        // We need a project .gitignore that excludes node_modules. Build the
        // config first so respect_gitignore=true picks it up at watcher start.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules")).unwrap();

        let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
        let writer = Arc::new(IndexWriter::new(
            dir.path().to_path_buf(),
            resolver.clone(),
        ));
        let cfg = fast_config();
        let actor = SessionActor::spawn(
            1,
            resolver.clone(),
            writer.clone(),
            cfg.session.clone(),
            None,
        );
        let watcher = ProjectWatcher::start(
            1,
            dir.path().to_path_buf(),
            actor.clone(),
            writer.clone(),
            cfg,
            None,
        )
        .await
        .unwrap();
        sleep(Duration::from_millis(150)).await;

        std::fs::write(dir.path().join("node_modules/foo.js"), "data").unwrap();
        settle().await;
        watcher.stop().await.unwrap();
        actor.shutdown().await.unwrap();

        let events = writer
            .read_file_changes(&today_workday(&resolver), None)
            .await
            .unwrap();
        let in_node_modules: Vec<_> = events
            .iter()
            .filter(|e| e.path.starts_with("node_modules/"))
            .collect();
        assert!(
            in_node_modules.is_empty(),
            "node_modules events leaked: {in_node_modules:?}"
        );
    }

    /// Case 3 — `.env` is in `forbid_journal_for_paths` by default; the path
    /// is masked + hash fields are nulled.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn forbidden_paths_are_masked() {
        let mut cfg = fast_config();
        cfg.git.forbid_journal_for_paths = vec![".env".into(), ".env.*".into()];
        let s = setup_with_config(cfg).await;
        std::fs::write(s.dir.path().join(".env"), "API_KEY=secret").unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let env_event = events
            .iter()
            .find(|e| e.path.starts_with("**redacted/sensitive**:"))
            .expect("a redacted entry must exist for .env");
        assert!(env_event.hash_after.is_none(), "hash must be nulled");
        // No raw `.env` should appear.
        assert!(events.iter().all(|e| e.path != ".env"));
    }

    /// Case 4 — five rapid writes to the same file → debouncer collapses to
    /// one ndjson event (path appears once).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rapid_writes_to_same_file_debounced_to_one() {
        let s = setup().await;
        let target = s.dir.path().join("hot.rs");
        for i in 0..5 {
            std::fs::write(&target, format!("v{i}")).unwrap();
            sleep(Duration::from_millis(20)).await;
        }
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let hot: Vec<_> = events.iter().filter(|e| e.path == "hot.rs").collect();
        assert_eq!(hot.len(), 1, "expected debouncer to coalesce; got {hot:?}");
    }

    /// Case 5 — the session actor's own writes to `.oculpm/index/` must not
    /// boomerang back into ndjson via the watcher. After a single user-file
    /// write we expect exactly one event for that file (no `.oculpm/`-derived
    /// extras).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn self_writes_are_suppressed() {
        let s = setup().await;
        std::fs::write(s.dir.path().join("user.rs"), "content").unwrap();
        settle().await;
        // Let any spurious .oculpm/ events have a second chance.
        sleep(Duration::from_millis(300)).await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        // No event should reference a .oculpm/ path — the watcher must have
        // self-suppressed our own ndjson + sessions.json writes.
        for ev in &events {
            assert!(
                !ev.path.starts_with(".oculpm/"),
                "self-write leaked: {}",
                ev.path
            );
        }
        assert!(
            events.iter().any(|e| e.path == "user.rs"),
            "user.rs event must be present"
        );
    }

    /// Case 6 — a 9 MB file exceeds `HASH_BYTE_CAP` (8 MB) so `hash_after`
    /// stays `None`; `bytes` still reflects the size.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn large_files_skip_hashing() {
        let s = setup().await;
        let payload = vec![0u8; 9 * 1024 * 1024];
        std::fs::write(s.dir.path().join("big.bin"), &payload).unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let big = events
            .iter()
            .find(|e| e.path == "big.bin")
            .expect("big.bin event must exist");
        assert!(big.hash_after.is_none(), "large file must skip hashing");
        assert!(big.bytes >= 9 * 1024 * 1024, "bytes must reflect size");
    }

    /// Bonus — `status()` reflects running state + accumulated counters.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn status_reports_running_with_counters() {
        let s = setup().await;
        std::fs::write(s.dir.path().join("a.rs"), "data").unwrap();
        settle().await;
        let st = s.watcher.status();
        assert!(matches!(st.state, WatcherStateView::Running));
        assert!(st.events_seen_total >= 1);
        assert!(st.last_event_at.is_some());

        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();
    }

    // ─── W2-PR5 — Tauri event emit paths ───────────────────────────────────

    /// PR5 test 1 — `.oculpm/agents/_template.md` change triggers the
    /// agents_template_changed emit path (no panic with `app_handle: None`,
    /// not routed to session ndjson).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agents_template_change_emits_without_panic() {
        let s = setup().await;
        std::fs::create_dir_all(s.dir.path().join(".oculpm/agents")).unwrap();
        std::fs::write(
            s.dir.path().join(".oculpm/agents/_template.md"),
            "# template\n",
        )
        .unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        // agents/ changes must NOT appear in ndjson.
        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let agents_events: Vec<_> = events
            .iter()
            .filter(|e| e.path.contains("agents"))
            .collect();
        assert!(
            agents_events.is_empty(),
            "agents/ events must be emit-only, not in ndjson: {agents_events:?}"
        );
    }

    /// PR5 test 2 — `.oculpm/journal/<workday>/Bugs/foo.md` change triggers
    /// the journal_path_changed emit path (no panic, not routed to ndjson).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn journal_change_emits_without_panic() {
        let s = setup().await;
        let journal_dir = s.dir.path().join(".oculpm/journal/20260523/Bugs");
        std::fs::create_dir_all(&journal_dir).unwrap();
        std::fs::write(journal_dir.join("foo.md"), "# Bug report\n").unwrap();
        settle().await;
        s.watcher.stop().await.unwrap();
        s.actor.shutdown().await.unwrap();

        let events = s
            .writer
            .read_file_changes(&today_workday(&s.resolver), None)
            .await
            .unwrap();
        let journal_events: Vec<_> = events
            .iter()
            .filter(|e| e.path.contains("journal"))
            .collect();
        assert!(
            journal_events.is_empty(),
            "journal/ events must be emit-only, not in ndjson: {journal_events:?}"
        );
    }

    // ─── F-2 fix — kind resolution + path filtering ────────────────────────

    #[test]
    fn resolve_path_change_kind_uses_filesystem_truth() {
        // The macOS FSEvents quirk: a Modify(Any) on a deleted file must
        // still drop the cache row. Same for Create races and explicit Delete.
        assert_eq!(
            resolve_path_change_kind(FileOp::Delete, false),
            PathChangeKind::Removed
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Update, false),
            PathChangeKind::Removed,
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Create, false),
            PathChangeKind::Removed,
        );
        // File exists → Create stays Created, everything else collapses to
        // Modified so the cache re-reads. A "Delete but the file still
        // exists" event (rare race) re-syncs as Modified, which is safe.
        assert_eq!(
            resolve_path_change_kind(FileOp::Create, true),
            PathChangeKind::Created
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Update, true),
            PathChangeKind::Modified
        );
        assert_eq!(
            resolve_path_change_kind(FileOp::Delete, true),
            PathChangeKind::Modified,
        );
    }

    /// W4 dogfooding (2026-05-27) — atomic write tmp filenames and editor
    /// noise must never reach the ndjson, regardless of project config. This
    /// is what was tanking jaccard from ~3/3 to 3/18 in the LayerComparison
    /// modal — `game.js.tmp.5C0aH-rJ` and `.DS_Store` were rotting the index.
    #[test]
    fn is_self_suppressed_catches_atomic_write_tmps_and_editor_noise() {
        // Originals (already covered).
        assert!(is_self_suppressed(".oculpm/index/foo.ndjson"));
        assert!(is_self_suppressed(".oculpm/.lock"));
        assert!(is_self_suppressed(".oculpm/oculpm.log"));
        assert!(is_self_suppressed("scratch.tmp"));

        // npm `write-file-atomic` / similar — `<dest>.tmp.<rand>`.
        assert!(is_self_suppressed("game.js.tmp.5C0aH-rJ"));
        assert!(is_self_suppressed("src/lib.rs.tmp.abc123"));
        assert!(is_self_suppressed("nested/dir/game.js.tmp.xyz"));

        // Vim swap + backup.
        assert!(is_self_suppressed("src/main.rs.swp"));
        assert!(is_self_suppressed("src/main.rs.swo"));
        assert!(is_self_suppressed("README.md~"));

        // OS metadata.
        assert!(is_self_suppressed(".DS_Store"));
        assert!(is_self_suppressed("nested/.DS_Store"));
        assert!(is_self_suppressed("Thumbs.db"));
        assert!(is_self_suppressed("nested/._foo.txt"));

        // Dogfooding (2026-06-07) — `!`-bearing transient/cache files.
        assert!(is_self_suppressed("!scratch"));
        assert!(is_self_suppressed("cache/data!cadb26c2"));
        assert!(is_self_suppressed("nested/dir/foo.bak!"));

        // Legit files must still pass through.
        assert!(!is_self_suppressed("game.js"));
        assert!(!is_self_suppressed("src/lib.rs"));
        assert!(!is_self_suppressed("docs/architecture.md"));
        // Adapter files live under agent dirs but pass self-suppress (the
        // agent-state filter is a separate gate, applied after the
        // adapter-lookup return).
        assert!(!is_self_suppressed(".claude/CLAUDE.md"));
    }

    /// W4 dogfooding (2026-05-27) — `.claude/settings.json` and friends
    /// were polluting the index because step 4.5 only matched the *exact*
    /// adapter path (`.claude/CLAUDE.md`) and let peer files through.
    #[test]
    fn is_agent_state_path_catches_peer_files_not_adapter_files() {
        // Claude Code peers.
        assert!(is_agent_state_path(".claude/settings.json"));
        assert!(is_agent_state_path(".claude/settings.local.json"));
        assert!(is_agent_state_path(".claude/projects/some-snapshot.json"));
        // Cursor / Gemini / Antigravity peers.
        assert!(is_agent_state_path(".cursor/history.json"));
        assert!(is_agent_state_path(".gemini/cache/foo"));
        assert!(is_agent_state_path(".agent/sessions/abc.json"));
        // The adapter file itself technically matches this prefix, but the
        // watcher returns earlier via `lookup_adapter_by_path` so we never
        // reach this filter for `.claude/CLAUDE.md` — matching it here is
        // safe but unused. Document the prefix match explicitly.
        assert!(is_agent_state_path(".claude/CLAUDE.md"));
        // User code untouched.
        assert!(!is_agent_state_path("src/main.rs"));
        assert!(!is_agent_state_path("game.js"));
        assert!(!is_agent_state_path("AGENTS.md")); // root adapter, not a state dir
    }

    #[test]
    fn is_journal_entry_path_matches_walk_journal_skip_rules() {
        // Real entries — must pass.
        assert!(is_journal_entry_path("20260524/Bugs/0925_bug_a.md"));
        assert!(is_journal_entry_path("20260524/Features_to_add/1000_feature.md"));

        // Skipped by cache::walk_journal — must fail.
        assert!(!is_journal_entry_path("_template.md"));
        assert!(!is_journal_entry_path("20260524/_attachments/note.md"));
        assert!(!is_journal_entry_path("20260524/Bugs/.draft.md"));
        assert!(!is_journal_entry_path("20260524/Bugs/0925_bug_a.txt"));
        assert!(!is_journal_entry_path("20260524/Bugs/"));
    }
}

//! Filesystem watcher — W2-PR3.
//!
//! Wraps `notify-debouncer-full` and routes each batch through:
//!   1. self-suppress (our own `.oculpm/index/`, `.lock`, log, `*.tmp`),
//!   2. `.oculpm/agents/**` / `.oculpm/journal/**` → tauri event emit only,
//!      (**emit 판정과 자동화 트리거 판정은 다르다** — 일지·플랜·정의·색인은
//!      화면 갱신을 위해 계속 emit 되지만 자동화의 **원인에서는 제외**된다:
//!      `automation::settle::is_excluded_cause`, 증폭 루프 가드 R1),
//!   3. `watcher.ignore` glob + project `.gitignore` (**같은 판정을
//!      `watcher_queue::PreFilter` 가 채널 앞에서 먼저 한다** — 여기 남은 것은
//!      두 번째 그물이다),
//!   4. classify into `FileOp` + blake3 hash (≤ 8 MB),
//!   5. `git.forbid_journal_for_paths` masking,
//!   6. `SessionActor::note_activity` (which stamps session_id + ts and
//!      writes the ndjson line),
//!   7. `oculpm:file_changed` emit.
//!
//! Threading model: `notify-debouncer-full` runs its own OS-watch thread; we
//! bridge its callback to the **유계 링**(`watcher_queue`, drop-oldest + 재동기화
//! 신호) and drain it in a single tokio task. `stop` drops the debouncer (kills
//! the OS thread) and awaits the task (drains pending events).
//!
//! 모듈 지도 (책임별 — 공개 경로는 전부 이 파일이 `pub use` 로 되돌려 준다):
//!
//! - 이 파일 — 공개 표면. [`ProjectWatcher`] 의 시작(디바운서·사전 필터 배선)·
//!   정지·상태.
//! - `handle` — 소비 루프가 부르는 처리기 `WatcherInner` 와 위 1~7 단계 파이프라인,
//!   버림 만회(`resync_after_drops`).
//! - `hooks` — Claude Code 훅 인박스 소비 + 일지 자동 초안.
//! - `journal` — `.oculpm/journal/**` 캐시 무효화·변경 diff 캡처·플랜 화해.
//! - `adapters` — 어댑터 파일 캐스케이드 재동기화 + 드리프트 감지.
//! - `emit` — Tauri 이벤트 방출 헬퍼.
//! - `classify` — 경로·이벤트 종류를 가르는 순수 술어.
//! - `repeat` — 윈도우가 같은 쓰기를 두 번 알리는 것을 걷는 기억 (윈도우만 켠다).
//!
//! See `docs/major_update/oculpm/W2/PR3-watcher-notify.md`.

mod adapters;
mod classify;
mod emit;
mod handle;
mod hooks;
mod journal;
mod repeat;
#[cfg(test)]
mod tests;

pub(crate) use classify::{is_rules_path, is_self_suppressed};

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use tokio::task::JoinHandle;

use crate::oculpm::error::OculpmError;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::redact::{self, build_forbidden_matcher};
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{OculpmConfig, WatcherSchedStats, WatcherStateView, WatcherStatus};
use crate::oculpm::{watcher_queue, watcher_tasks};

use handle::WatcherInner;

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
    /// 큐 계수기 — 버림(`dropped_total`)을 진단에 싣기 위해 소비자를 소비
    /// 루프에 넘기기 전에 떼어 둔 손잡이.
    queue_metrics: watcher_queue::QueueMetrics,
    /// 곁일 종료 손잡이 — 드롭만으로도 색인·히스토리 태스크가 끊긴다.
    tasks_shutdown: watcher_tasks::WatcherTasksShutdown,
    /// 무장한 시각 — 스케줄링 계수기 전부의 기준점 (`{#scheduling-telemetry}`).
    started_at: DateTime<Utc>,
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

        let user_ignore = watcher_queue::build_gitignore_from_lines(&root, &config.watcher.ignore);
        let project_gitignore = if config.watcher.respect_gitignore {
            watcher_queue::load_project_gitignore(&root)
        } else {
            None
        };
        // 같은 매처를 **채널 앞**에도 세운다 (`{#watcher-prefilter}`) — `target/`
        // 55,663 파일이 큐를 한 바퀴 돌지 않게. 판정 규칙은 `PreFilter` 참고.
        let prefilter = watcher_queue::PreFilter::new(
            root.clone(),
            user_ignore.clone(),
            project_gitignore.clone(),
        );
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
        // 곁일(증분 색인·히스토리)의 동시 상한 + 수명. 워처가 내려가면 함께 끊긴다.
        let (tasks, tasks_shutdown) = watcher_tasks::gate();
        let inner = WatcherInner {
            project_id,
            root: root.clone(),
            session,
            index_writer,
            app_handle,
            tasks,
            user_ignore,
            project_gitignore,
            forbidden,
            redact_patterns,
            tz,
            hook_inbox_offset: Arc::new(tokio::sync::Mutex::new(None)),
            hook_open_sessions: Arc::new(tokio::sync::Mutex::new(BTreeSet::new())),
            auto_journal_draft: config.agents.auto_journal_draft,
            draft_lock: Arc::new(tokio::sync::Mutex::new(())),
            stats: stats.clone(),
            root_gone_logged: std::sync::atomic::AtomicBool::new(false),
            repeats: repeat::RepeatFilter::default(),
        };

        // PR-CI0 — 앱이 꺼진 동안 큐잉된 훅 이벤트를 즉시 소비한다. 인박스는
        // append 가 있어야만 fs 이벤트가 오므로, 시작 시 1회 능동 소비가
        // 없으면 "앱 켜기 전에 끝난 Claude 세션" 이 다음 append 까지 미처리로
        // 남는다.
        inner.consume_hooks_inbox().await;

        // Bridge std/sync notify worker → tokio task. 유계 링이라 콜백은 절대
        // 블록하지 않고, 넘치면 가장 오래된 것을 버린 뒤 재동기화 신호를 켠다
        // (`watcher_queue` 의 용량 근거 주석 참고).
        let (event_tx, event_rx) =
            watcher_queue::channel_with_filter(watcher_queue::DEFAULT_CAPACITY, Some(prefilter));
        let queue_metrics = event_rx.metrics();
        // Phase 2 — 티어가 있으면 티어가, 없으면 기존 숫자가 창을 정한다. 어느
        // 쪽이든 `balanced`(1s)로 잘린다: 긴 디바운스는 OS 워처가 이벤트를 들고
        // 있게 만들어 메모리·유실 위험이다. 긴 기다림은 러너 쪽 정착 타이머의 몫.
        let debounce_ms = crate::oculpm::automation::tiers::os_debounce_ms(&config.watcher);
        let mut debouncer = new_debouncer(
            Duration::from_millis(u64::from(debounce_ms)),
            None,
            move |result: DebounceEventResult| {
                // 동기·논블로킹이라 tokio 밖(디바운서 워커 스레드)에서 안전하다.
                match result {
                    Ok(events) => {
                        let n = events.len();
                        let dropped = event_tx.push_batch(events);
                        if dropped > 0 {
                            tracing::warn!(
                                target: "oculpm::watcher", project_id, batch = n, dropped,
                                "[FLOW] 워처 큐가 가득 차 가장 오래된 이벤트를 버렸다 — 정착 후 재동기화한다"
                            );
                        }
                    }
                    Err(errs) => tracing::warn!(
                        target: "oculpm::watcher", ?errs, "[FLOW] debouncer reported errors"
                    ),
                }
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

        // 소비 루프 본체는 `watcher_queue::drain_loop` 에 있다 — 패닉 격리,
        // 정착 감지, 재동기화 호출까지 한자리에 모아 두었다.
        let join_handle = tokio::spawn(watcher_queue::drain_loop(project_id, event_rx, inner));

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
            queue_metrics,
            tasks_shutdown,
            started_at: Utc::now(),
        })
    }

    /// Halt the OS watcher + drain pending events. Idempotent — calling
    /// `stop` twice is a no-op the second time.
    pub async fn stop(mut self) -> Result<(), OculpmError> {
        // Drop the debouncer first → its internal worker thread exits → the
        // event_tx captured in the callback drops → recv returns None → the
        // tokio task finishes after draining any buffered events.
        // 곁일도 함께 끊는다 — 예전엔 detached 라 닫힌 프로젝트를 계속 두드렸다.
        self.tasks_shutdown.shutdown();
        self.debouncer.take();
        self.join_handle
            .await
            .map_err(|_| OculpmError::ActorClosed)?;
        Ok(())
    }

    pub fn project_id(&self) -> u32 {
        self.project_id
    }

    /// 이 워처가 **아직 이벤트를 처리할 수 있는가**.
    ///
    /// `debouncer` 가 `Some` 인 것만으로는 부족하다 — 처리 태스크가 죽어도
    /// 그 필드는 그대로 남는다. 그 상태를 "돌고 있음" 으로 읽는 바람에
    /// `watcher_start` 가 no-op 을 돌려주고, 실시간 갱신이 앱 재시작까지
    /// 돌아오지 않았다 (도그푸딩 2026-08-23).
    pub fn is_alive(&self) -> bool {
        self.debouncer.is_some() && !self.join_handle.is_finished()
    }

    /// 지금까지 이 워처의 처리 루프에 **도달한** 이벤트 수 (필터 이전).
    /// 감독관의 생존 프로브가 이 값의 증가를 본다.
    pub fn events_seen(&self) -> u32 {
        self.stats.read().map(|s| s.events_seen_total).unwrap_or(0)
    }

    /// 응답 없는 워처를 **기다리지 않고** 끊는다.
    ///
    /// `stop()` 은 처리 태스크의 종료를 `await` 하므로, 그 태스크가 어딘가에서
    /// 멈춰 있으면 영원히 돌아오지 않는다 — 되살리려는 감독관이 거기서 함께
    /// 멈추면 안 된다.
    pub fn abort(mut self) {
        self.tasks_shutdown.shutdown();
        self.debouncer.take();
        self.join_handle.abort();
    }

    pub fn status(&self) -> WatcherStatus {
        let stats = self.stats.read().unwrap();
        let sched = self.sched_stats();
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
            dropped_total: sched.dropped_total,
            sched,
        }
    }

    /// 스케줄링 계측 한 벌 — 큐의 원자 계수기를 한 순간에 읽는다
    /// (`{#scheduling-telemetry}`). u32 로 포화시킨다: 49일치 ms 누계다.
    pub fn sched_stats(&self) -> WatcherSchedStats {
        let m = &self.queue_metrics;
        let sat = |v: u64| u32::try_from(v).unwrap_or(u32::MAX);
        WatcherSchedStats {
            started_at: Some(self.started_at.to_rfc3339()),
            events_total: sat(m.events_total()),
            dropped_total: sat(m.dropped_total()),
            queue_depth: sat(m.queue_depth() as u64),
            queue_high_water: sat(m.queue_high_water() as u64),
            handle_ms_total: sat(m.handle_ms_total()),
            handle_max_ms: sat(m.handle_max_ms()),
        }
    }
}

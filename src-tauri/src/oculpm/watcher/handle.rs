//! 이벤트 처리기 — 소비 루프(`watcher_queue::drain_loop`)가 부르는 `WatcherInner`.
//!
//! 이벤트 하나가 지나는 1~10 단계 파이프라인(`handle_event`)과, 큐가 넘쳐 버린
//! 창을 디스크에서 다시 읽어 갚는 `resync_after_drops` 가 여기 산다.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use chrono::Utc;
use chrono_tz::Tz;
use ignore::gitignore::Gitignore;
use notify::EventKind;
use notify_debouncer_full::DebouncedEvent;
use regex::Regex;

use crate::db::Db;
use crate::oculpm::agents;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::redact;
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{FileChangeEvent, FileOp, OculpmDataArea};
use crate::oculpm::watcher_queue::WatcherSink;
use crate::oculpm::watcher_tasks::{self, WatcherTasks};

use super::classify::{
    a2a_change_kind, classify_journal_op, data_area_for_path, is_agent_state_path, is_agents_noise,
    is_directory_event, short_hash_of,
};
use super::{is_rules_path, is_self_suppressed, WatcherStatsInner};

/// Files ≤ this byte cap get a blake3 hash; larger files leave `hash_after`
/// as `None` (consumers infer "large-file-hash-skipped" from the absence).
const HASH_BYTE_CAP: u64 = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Inner: event processing
// ─────────────────────────────────────────────────────────────────────────────

pub(super) struct WatcherInner {
    pub(super) project_id: u32,
    pub(super) root: PathBuf,
    pub(super) session: SessionActor,
    pub(super) index_writer: Arc<IndexWriter>,
    pub(super) app_handle: Option<tauri::AppHandle>,
    /// 곁일 게이트 — 증분 색인·히스토리 캡처의 동시 상한과 수명 (watcher_tasks).
    pub(super) tasks: WatcherTasks,
    pub(super) user_ignore: Gitignore,
    pub(super) project_gitignore: Option<Gitignore>,
    pub(super) forbidden: Gitignore,
    /// Compiled `auto_redact_patterns`. Empty → masking is a no-op. Used to
    /// build a redacting [`JournalCache`] for journal upserts and threaded into
    /// per-entry diff capture (dev-report §2 / R1).
    pub(super) redact_patterns: Vec<Regex>,
    /// Project timezone (from `config.workday.timezone`). Threaded into the
    /// redacting [`JournalCache`] so read-time `created_at` offset backfill
    /// (F7a-B) interprets tz-less agent timestamps as project-local.
    pub(super) tz: Tz,
    /// PR-CI0 — Claude Code 훅 인박스의 소비 오프셋. `None` = 아직 DB 에서
    /// 로드 전 (lazy). 값은 소비할 때마다 DB(`claude_hooks_inbox`)에 영속 —
    /// 앱 재시작 후 큐잉된 이벤트를 정확히 이어서 소비한다. 테스트처럼
    /// `app_handle` 이 없으면 메모리 전용.
    pub(super) hook_inbox_offset: Arc<tokio::sync::Mutex<Option<u64>>>,
    /// PR-CI0 — 현재 열려 있는 Claude 세션 id 집합. 여러 터미널 동시 세션에서
    /// 마지막 SessionEnd 에만 종료 신호를 내기 위함 (claude_hooks::apply_event).
    pub(super) hook_open_sessions: Arc<tokio::sync::Mutex<BTreeSet<String>>>,
    /// PR-CI1 — opt-in: 훅 세션 종료(AgentExit) 시 transcript 를 LLM 으로
    /// 요약해 일지 초안 1건을 자동 작성. `config.agents.auto_journal_draft`.
    pub(super) auto_journal_draft: bool,
    /// PR-CI1 — 일지 초안 단일 인플라이트 (reconcile_lock 동형).
    pub(super) draft_lock: Arc<tokio::sync::Mutex<()>>,
    pub(super) stats: Arc<RwLock<WatcherStatsInner>>,
}

/// 큐가 넘쳐 이벤트를 버렸을 때, 소비자가 정착한 뒤 만회하는 쪽.
impl WatcherSink for WatcherInner {
    async fn handle_event(&self, ev: DebouncedEvent) {
        WatcherInner::handle_event(self, ev).await
    }

    async fn resync_after_drops(&self, dropped: u64) {
        WatcherInner::resync_after_drops(self, dropped).await
    }
}

impl WatcherInner {
    /// 버린 이벤트는 되살릴 수 없으므로 **디스크를 다시 읽는 쪽**으로 갚는다.
    ///
    /// 새 경로를 만들지 않고 이미 있는 것을 부른다:
    /// `reindex_journal_cache_incremental` 는 mtime 키라 안 바뀐 행은 파싱조차
    /// 하지 않고, 디스크에서 사라진 행은 지운다 — 정확히 "놓친 창을 만회한다"
    /// 의 의미다. 그다음 화면들이 다시 조회하도록 기존 신호를 낸다.
    ///
    /// **코드 검색 색인은 여기서 다시 돌리지 않는다.** 전체 재색인은 워커를
    /// 6.4 초 통째로 점유하므로(perf-baseline §1 M2) 버림을 갚는 값보다 비싸고,
    /// 백프레셔를 걸어 놓고 그보다 큰 폭풍을 부르는 꼴이 된다. 대신 무결성
    /// 경고로 남겨 사용자가 「인덱스 재구축」을 고를 수 있게 한다.
    async fn resync_after_drops(&self, dropped: u64) {
        tracing::warn!(
            target: "oculpm::watcher",
            project_id = self.project_id,
            dropped,
            "[FLOW] 큐 오버플로 만회 — 디스크에서 다시 읽는다"
        );
        let Some(handle) = &self.app_handle else {
            return;
        };
        use tauri::Manager;
        // `state` 는 미등록이면 패닉한다 — 만회 경로가 앱을 죽이면 안 되므로
        // `try_state` 로 묻는다 (목 앱으로 도는 테스트가 실재한다).
        let (Some(manager), Some(db)) = (
            handle.try_state::<OculpmManager>(),
            handle.try_state::<Db>(),
        ) else {
            return;
        };
        match manager
            .reindex_journal_cache_incremental(&db, self.project_id)
            .await
        {
            Ok(r) => tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                inserted = r.inserted,
                updated = r.updated,
                deleted = r.deleted,
                skipped = r.skipped,
                "[FLOW] 큐 오버플로 만회 — 일지 캐시 증분 재색인 완료"
            ),
            Err(e) => tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                error = %e,
                "[FLOW] 큐 오버플로 만회 — 일지 캐시 재색인 실패"
            ),
        }
        // 어느 영역의 이벤트가 사라졌는지 알 수 없으므로 전부 두드린다. 각
        // 화면의 재조회는 250ms 로 병합되므로 이 한 묶음이 폭풍이 되지 않는다.
        self.emit_journal_path_changed(".oculpm/journal/", FileOp::Update);
        for area in [
            OculpmDataArea::Planner,
            OculpmDataArea::Discussion,
            OculpmDataArea::Rules,
            OculpmDataArea::Automation,
        ] {
            self.emit_data_changed(area, "", FileOp::Update);
        }
        self.emit_integrity_warning(
            "watcher_overflow",
            ".",
            &format!(
                "파일 변경 알림 {dropped}건이 큐 용량을 넘겨 버려졌습니다. 일지·계획은 디스크에서 다시 읽었지만, 코드 검색 색인은 「인덱스 재구축」이 필요할 수 있습니다."
            ),
        );
    }

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

        // 1.6 A2A 원장 (`docs/a2a/00-master-plan.md` §4~§6). **아래 2번보다
        //     먼저 걸러야 한다** — `.oculpm/agents/` 로 시작하므로 순서가 뒤집히면
        //     카드 한 장 쓸 때마다 모든 어댑터의 AGENTS.md 재동기화가 돈다.
        //     하트비트까지 그 길을 타면 증폭 루프가 된다 (osaurus R1 과 같은 부류).
        //     우편함·태스크 원장도 같은 이유로 여기서 끊고 이벤트만 낸다.
        if let Some(kind) = a2a_change_kind(&rel_str) {
            self.emit_a2a_changed(kind);
            return;
        }
        if is_agents_noise(&rel_str) {
            self.bump_ignored();
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
            self.cascade_agents_resync().await;
            return;
        }

        // 3. .oculpm/journal/** — invalidate the SQLite cache so list/get
        //    queries see the change without waiting for a manual reindex,
        //    THEN emit the Tauri event. Before this wire-up, the watcher only
        //    emitted the event and the frontend's refetch hit a stale cache
        //    (file deletes never disappeared from Today UI). See dogfooding
        //    F-2, and the emit-ordering note below.
        if rel_str.starts_with(".oculpm/journal/") {
            let op = classify_journal_op(&ev.event.kind);
            tracing::info!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %rel_str,
                ?op,
                "[FLOW] journal fs event detected"
            );
            self.apply_journal_cache_invalidation(&rel_str, op).await;
            // 캐시를 갱신한 **뒤에** 알린다. 이 순서가 뒤집혀 있던 동안 프런트의
            // (디바운스된) 재조회가 아직 옛 행이 남은 SQLite 를 읽고 그대로 굳었다
            // — 특히 삭제는 `apply_path_change` 가 outcome `None` 을 돌려줘
            // journal-added/updated 가 안 나가므로 이 이벤트가 유일한 신호였고,
            // 레이스에 지면 사용자가 직접 새로고침할 때까지 지워진 일지가 계속
            // 보였다 (도그푸딩 2026-08-21).
            self.emit_journal_path_changed(&rel_str, op);
            return;
        }

        // 3.5 .oculpm/planner/** (계획 SSOT) · .oculpm/discussion/** (논의 SSOT).
        //     둘 다 읽을 때 파일에서 다시 투영하므로(plan_* / discussion_* 커맨드)
        //     코드 변경 ndjson 파이프라인에는 넣지 않는다. 대신 "다시 읽어라"
        //     신호만 내보낸다 — 이게 없던 동안 두 화면은 마운트 때 읽은 내용에
        //     그대로 머물러서, 에이전트가 계획을 고쳐도 사용자가 직접
        //     새로고침해야 보였다 (도그푸딩 2026-08-21).
        if let Some(area) = data_area_for_path(&rel_str) {
            let op = classify_journal_op(&ev.event.kind);
            tracing::debug!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %rel_str,
                ?area,
                ?op,
                "[FLOW] oculpm data fs event (projection on read + live refresh)"
            );
            // 정의가 바뀌었으면 워처 자동화 규칙을 다시 읽게 한다 (파일이 SSOT).
            // 이 경로 자체는 자동화의 **원인이 아니다** — 규칙만 갱신한다.
            if area == OculpmDataArea::Automation {
                if let Some(handle) = &self.app_handle {
                    crate::oculpm::automation::watchers::invalidate_rules(handle, self.project_id);
                }
            }
            self.emit_data_changed(area, &rel_str, op);
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
        // 4.7 규칙 파일 (Phase 4 #events-over-polling). `.claude/rules/**` 와
        //     `.cursor/rules/**` 는 아래 4.6 이 에이전트 내부 상태로 버리던
        //     경로라 어떤 신호도 안 나갔다 — 규칙 허브는 마운트 때 읽은 목록에
        //     머물렀다. 루트 CLAUDE.md 슬롯은 신호만 내고 코드 파이프라인으로
        //     계속 흘려보낸다 (사용자 파일이기도 하다 — 정직성 감사가 본다).
        if is_rules_path(&rel_str) {
            let op = classify_journal_op(&ev.event.kind);
            self.emit_data_changed(OculpmDataArea::Rules, &rel_str, op);
            if rel_str.starts_with(".claude/") || rel_str.starts_with(".cursor/") {
                return;
            }
        }

        if is_agent_state_path(&rel_str) {
            self.bump_ignored();
            return;
        }

        // 5. Skip directories — we only track files.
        //
        // `is_dir()` answers about the path *now*, so it returns false for a
        // directory that was just deleted and the folder event sailed through
        // as a phantom file (dogfooding 2026-08-20: `docs/acp-panel/spike/.oculpm`
        // landed in the ndjson and then in 정직성 감사). notify carries the
        // answer in the event itself — `RemoveKind::Folder`, which the macOS
        // FSEvents backend sets from `kFSEventStreamEventFlagItemIsDir` — so
        // trust the event when the filesystem can no longer be asked.
        //
        // Deleting a directory also emits a Remove per file inside it, so
        // dropping the folder event loses no per-file history.
        if path.is_dir() || is_directory_event(&ev.event.kind) {
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
            self.schedule_incremental_index(
                change.path.clone(),
                change.op,
                change.hash_after.clone(),
            );
        }

        // 7.55 B5 — 로컬 히스토리 한 판 (06-local-history.md). 캡처 지점이
        // **여기 한 곳**인 이유가 이 설계의 핵심이다: `should_track` 를 이미
        // 통과했고, 디렉터리가 아니고, 해시가 이미 있고(중복 캡처를 공짜로
        // 거른다), 무엇보다 **사람이 쓰든 에이전트가 쓰든 여기를 지난다**.
        // `code_write` 에는 걸지 않는다 — 이중 캡처가 된다.
        if !self.is_forbidden(&path) {
            self.schedule_history_capture(&change);
        }

        // 7.6 Phase 2 — 워처 자동화의 정착 타이머에 이벤트를 흘린다. 실제
        // 상대 경로를 쓴다(8단계 마스킹 **전**). forbidden 경로는 원인이 되지
        // 않는다: 우리가 내용을 보지 않기로 한 파일이 배경 LLM 호출을 부르면
        // 안 된다. 원인 제외(일지·플랜·정의·색인)는 위 2~3.5 단계에서 이미
        // 돌아갔고, 트래커도 한 번 더 막는다.
        if let Some(handle) = &self.app_handle {
            if !self.is_forbidden(&path) {
                crate::oculpm::automation::watchers::note_event(
                    handle,
                    self.project_id,
                    &change.path,
                    Utc::now(),
                );
            }
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

        // metadata + read + blake3 는 **런타임 워커 밖**에서 돈다
        // (`watcher_tasks::stat_and_hash`). 상한을 넘으면 hash 는 None —
        // 소비자는 `bytes > HASH_BYTE_CAP && hash_after.is_none()` 으로
        // "큰 파일이라 해시를 건너뜀" 을 읽는다.
        let (bytes_u, hash_after) = if exists && !matches!(op, FileOp::Delete) {
            watcher_tasks::stat_and_hash(abs_path.to_path_buf(), HASH_BYTE_CAP).await
        } else {
            (0, None)
        };

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

    // ─── Stats ─────────────────────────────────────────────────────────────

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

    /// B5 — 로컬 히스토리 캡처 (fire-and-forget). 본체는 `watcher_tasks` —
    /// 여기서는 게이트(동시 상한 + 워처 수명)를 얹어 넘길 뿐이다.
    fn schedule_history_capture(&self, change: &FileChangeEvent) {
        if let Some(handle) = &self.app_handle {
            watcher_tasks::schedule_history_capture(
                &self.tasks,
                handle,
                self.project_id,
                &self.root,
                change,
            );
        }
    }

    /// PR-5 — 바뀐 코드 파일 하나의 증분 재색인 (fire-and-forget). 본체는
    /// `watcher_tasks`; 가드레일과 근거 주석도 그쪽에 있다.
    fn schedule_incremental_index(&self, rel_path: String, op: FileOp, hash_after: Option<String>) {
        if let Some(handle) = &self.app_handle {
            watcher_tasks::schedule_incremental_index(
                &self.tasks,
                handle,
                self.project_id,
                &self.root,
                rel_path,
                op,
                hash_after,
            );
        }
    }
}

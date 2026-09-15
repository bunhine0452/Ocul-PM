//! `.oculpm/journal/**` 반응 — SQLite 캐시 무효화(디스크가 SSOT), 새 일지의
//! 변경 diff 사이드카 캡처와 라인 수 집계, 플랜 화해 잡 발동, 그리고 프런트가
//! 토스트·낙관적 갱신에 쓰는 JournalAdded / JournalUpdated 방출.

use chrono::Utc;

use crate::db::Db;
use crate::oculpm::cache::{JournalCache, UpsertOutcome};
use crate::oculpm::spec::{FileOp, OculpmJournalAdded, OculpmJournalUpdated};

use super::classify::{is_journal_entry_path, resolve_path_change_kind};
use super::handle::WatcherInner;

impl WatcherInner {
    /// Mirror a `.oculpm/journal/**` change into the SQLite cache so the next
    /// `oculpm_list_journal_entries` reflects it. Gated on `app_handle` (the
    /// only path to the process-wide `Db` state) so unit tests that pass
    /// `app_handle: None` stay self-contained — see `setup_with_config`.
    ///
    /// `full_rel_str` is relative to the project root and starts with
    /// `.oculpm/journal/`; we strip that prefix to get the cache-key form
    /// (`<workday>/<Category>/<file>.md`).
    pub(super) async fn apply_journal_cache_invalidation(&self, full_rel_str: &str, op: FileOp) {
        let Some(handle) = &self.app_handle else {
            return;
        };
        let Some(entry_rel) = full_rel_str.strip_prefix(".oculpm/journal/") else {
            return;
        };
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
                    // F1 → Phase 2 `#reconcile-absorb`: 새 일지 1건이 플랜 화해를
                    // 깨운다. 이제 **잡 러너를 통과**하므로 예산·동시 1건·취소·
                    // 원장이 스케줄과 같은 규약을 쓴다. 켜졌는지 여부는 허브가
                    // 그때의 config 로 판정한다 — 워처 시작 시점의 스냅샷이 아니라.
                    self.spawn_plan_reconcile(entry_rel);
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
                if let Ok(Some(snap)) = db.get_file_snapshot(self.project_id, f.path.clone()).await
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
        if let Err(e) = cache
            .set_line_counts(self.project_id, entry_rel, counts)
            .await
        {
            tracing::warn!(
                target: "oculpm::watcher",
                project_id = self.project_id,
                path = %entry_rel,
                error = %e,
                "line-count capture: cache update failed"
            );
        }
    }

    /// Phase 2 `#reconcile-absorb` — 새 일지 1건을 플랜 화해 잡으로 넘긴다.
    ///
    /// 예전에는 여기서 `reconcile_entry` 를 직접 spawn 하고, 옵인 플래그와
    /// 단일 인플라이트 가드를 **워처가** 들고 있었다. 이제 둘 다 허브·러너의
    /// 것이다 (`automation::watchers::on_journal_inserted`):
    ///
    /// - 발동 여부: 켜진 `output: plan` 워처 정의 **또는** 레거시
    ///   `agents.auto_reconcile` — 워처 시작 시점이 아니라 **그때의 config**.
    /// - 동시 1건 · 예산 · 취소 · 원장: 러너 규약 하나.
    /// - 플랜 편집(CAS · `plan_write_lock`): `reconcile.rs` 그대로.
    ///
    /// fire-and-forget 인 것은 그대로다 — 느린 LLM 왕복이 워처 루프를 막으면
    /// 안 된다. 앱 핸들이 없으면(단위 테스트) no-op.
    fn spawn_plan_reconcile(&self, entry_rel: &str) {
        let Some(handle) = self.app_handle.clone() else {
            return;
        };
        let project_id = self.project_id;
        let entry_rel = entry_rel.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::oculpm::automation::watchers::on_journal_inserted(
                &handle,
                project_id,
                &entry_rel,
                Utc::now(),
            )
            .await
            {
                tracing::warn!(
                    target: "oculpm::watcher",
                    project_id,
                    path = %entry_rel,
                    error = %e,
                    "[FLOW] plan reconcile enqueue failed (swallowed)"
                );
            }
        });
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
        let Some(handle) = &self.app_handle else {
            return;
        };
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

//! 어댑터 파일(AGENTS.md · CLAUDE.md · `.cursor/rules/*.mdc` …) 반응 —
//! `.oculpm/agents/_template.md` 편집이 모든 활성 어댑터로 번지는 캐스케이드
//! 재동기화(PR4)와, 어댑터 파일을 남이 고쳤을 때의 드리프트 감지(W4-PR4).

use crate::db::Db;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::OculpmAgentDrift;

use super::handle::WatcherInner;

impl WatcherInner {
    /// Trigger a full agent-adapter re-sync (PR4 master-edit cascade). Same
    /// gating as `apply_journal_cache_invalidation` — `app_handle: None`
    /// makes this a no-op so existing unit tests stay self-contained.
    /// Failures are logged but never escalated; the next `sync_agents` call
    /// (Settings save / next agents edit) will retry.
    pub(super) async fn cascade_agents_resync(&self) {
        let Some(handle) = &self.app_handle else {
            return;
        };
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
    pub(super) async fn check_and_emit_agent_drift(&self, relative_path: &str) {
        let Some(handle) = &self.app_handle else {
            return;
        };
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
}

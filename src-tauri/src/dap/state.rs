//! Tauri 관리 상태 — 프로젝트당 세션 하나 + 세션보다 오래 사는 중단점 저장소.
//!
//! **프로젝트당 하나** 인 이유는 설계 SSOT #lifecycle 에 있다: 여러 세션을 동시에
//! 두면 "지금 어느 세션의 스택인가" 가 UI 전체에 스며든다. 필요해지면 그때.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::session::{BreakpointStore, DapSession};

#[derive(Default)]
pub struct DapState {
    sessions: Mutex<HashMap<u32, Arc<DapSession>>>,
    /// 중단점은 세션이 없어도 살아 있다 — 찍어 두고 나중에 띄울 수 있어야 한다.
    breakpoints: Mutex<HashMap<u32, BreakpointStore>>,
}

impl DapState {
    pub async fn session(&self, project_id: u32) -> Option<Arc<DapSession>> {
        self.sessions.lock().await.get(&project_id).cloned()
    }

    /// 새 세션을 등록한다. 이미 있으면 **먼저 정리한다** — 두 세션이 같은
    /// 프로그램에 붙어 있는 상태를 만들지 않는다.
    pub async fn put(&self, project_id: u32, session: Arc<DapSession>) {
        if let Some(old) = self.sessions.lock().await.insert(project_id, session) {
            old.stop().await;
        }
    }

    pub async fn take(&self, project_id: u32) -> Option<Arc<DapSession>> {
        self.sessions.lock().await.remove(&project_id)
    }

    /// 프로젝트를 닫거나 앱이 끝날 때.
    pub async fn stop_project(&self, project_id: u32) {
        if let Some(session) = self.take(project_id).await {
            session.stop().await;
        }
    }

    // ── 중단점 ──────────────────────────────────────────────────────────────

    pub async fn toggle_breakpoint(&self, project_id: u32, path: &str, line: u32) -> Vec<u32> {
        let mut map = self.breakpoints.lock().await;
        map.entry(project_id).or_default().toggle(path, line)
    }

    pub async fn breakpoint_lines(&self, project_id: u32, path: &str) -> Vec<u32> {
        let map = self.breakpoints.lock().await;
        map.get(&project_id)
            .map(|s| s.lines_for(path))
            .unwrap_or_default()
    }

    pub async fn all_breakpoints(&self, project_id: u32) -> Vec<(String, Vec<u32>)> {
        let map = self.breakpoints.lock().await;
        map.get(&project_id)
            .map(BreakpointStore::files)
            .unwrap_or_default()
    }

    pub async fn clear_breakpoints(&self, project_id: u32) {
        if let Some(store) = self.breakpoints.lock().await.get_mut(&project_id) {
            store.clear();
        }
    }

    /// 파일이 옮겨졌다 — 찍어 둔 자리가 따라간다 (탭·버퍼와 같은 정합 규칙).
    pub async fn rename_breakpoint_path(
        &self,
        project_id: u32,
        from: &str,
        to: &str,
        is_dir: bool,
    ) {
        if let Some(store) = self.breakpoints.lock().await.get_mut(&project_id) {
            store.rename_path(from, to, is_dir);
        }
    }
}

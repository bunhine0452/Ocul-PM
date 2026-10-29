//! Claude Code 훅 인박스 (PR-CI0) — `.oculpm/hooks/claude-events.jsonl` 을
//! 오프셋부터 소비해 SessionActor 정밀 신호로 바꾼다. (세션 종료 시의 옵인 일지
//! 자동 초안 PR-CI1 은 4.0 에서 앱 안 LLM 호출과 함께 걷었다.)

use crate::db::Db;
use crate::oculpm::claude_hooks::{self, HookSignal};
use crate::oculpm::claude_waiting;

use super::handle::WatcherInner;

impl WatcherInner {
    /// PR-CI0 — 인박스(`.oculpm/hooks/claude-events.jsonl`)를 오프셋부터
    /// 소비한다. 완전한 라인만 파싱(부분 append 허용), 소비 오프셋은 DB 에
    /// 영속. 이벤트는 열린-세션 집합을 거쳐 SessionActor 정밀 신호가 된다.
    /// 우리 쪽 쓰기는 DB 뿐이라 fs 피드백 루프가 없다.
    pub(super) async fn consume_hooks_inbox(&self) {
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
        let new_offset = claude_hooks::compact_inbox(&path, &bytes, offset + consumed).await;
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
        // 바깥 터미널의 Claude 가 사람을 기다린다 (Notification 훅, #notify-hook).
        if let Some(handle) = &self.app_handle {
            use tauri::Manager;
            if let Some(state) = handle.try_state::<claude_waiting::ClaudeWaitingState>() {
                let now = chrono::Utc::now().to_rfc3339();
                // 이벤트를 **모두** 반영한다 — 첫 변화에서 멈추면(`any`) 뒤의 해제가 빠진다.
                let changed = state.0.lock().is_ok_and(|mut all| {
                    let table = all.entry(self.project_id).or_default();
                    let mut changed = false;
                    for ev in &events {
                        changed |= claude_waiting::apply_waiting(table, ev, &now);
                    }
                    changed
                });
                if changed {
                    use tauri_specta::Event;
                    let _ = claude_waiting::ClaudeWaitingChanged {
                        project_id: self.project_id,
                    }
                    .emit(handle);
                }
            }
        }
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
                        .hook_agent_active(claude_hooks::HOOK_AGENT_LABEL, &ev.session_id)
                    {
                        tracing::warn!(target: "oculpm::watcher", error = ?e, "hook_agent_active send failed");
                    }
                }
                HookSignal::AgentEnded => {
                    if let Err(e) = self.session.hook_agent_ended(&ev.session_id) {
                        tracing::warn!(target: "oculpm::watcher", error = ?e, "hook_agent_ended send failed");
                    }
                }
                HookSignal::None => {}
            }
        }
        drop(open);
    }
}

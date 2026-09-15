//! Claude Code 훅 인박스 (PR-CI0) — `.oculpm/hooks/claude-events.jsonl` 을
//! 오프셋부터 소비해 SessionActor 정밀 신호로 바꾸고, 세션 종료 시 옵인
//! 일지 자동 초안(PR-CI1)을 fire-and-forget 으로 띄운다.

use crate::db::Db;
use crate::oculpm::claude_hooks::{self, HookSignal};
use crate::oculpm::spec::Session;

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
                        .hook_agent_active(claude_hooks::HOOK_AGENT_LABEL, &ev.session_id)
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
                    if let Err(e) = self.session.hook_agent_ended(&ev.session_id) {
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
}

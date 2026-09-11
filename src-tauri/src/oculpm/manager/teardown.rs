//! 프로젝트를 **놓는** 쪽 — 삭제(`forget_project`)와 앱 종료
//! (`shutdown_all_blocking`). 감사 라운드 2026-09-11 A1·A4 에서 생명주기
//! 파일이 800줄을 넘어 여기로 갈랐다.

use super::*;

/// `forget_project` · 종료가 세션 마감을 기다리는 상한.
const FORGET_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

impl OculpmManager {
    /// 프로젝트가 **워크스페이스에서 지워졌다** — 워처를 끊고, 세션을 `Manual`
    /// 로 마감하고, 락을 놓고, 엔트리를 잊는다 (감사 라운드 2026-09-11 A1).
    ///
    /// `on_project_closed` 와 다른 점은 세션 액터의 `shutdown` 을 **기다린다**는
    /// 것이다. 엔트리를 그냥 떨어뜨리면 sender 만 끊겨 세션은 디스크에 열린 채
    /// 남고, 다음 기동이 `crash_recovered` 로 마감한다 — 지운 프로젝트의
    /// 원장이 크래시를 말하면 안 된다.
    ///
    /// 왜 필요한가: `delete_project` 가 DB 행만 지우던 동안 매니저는 그
    /// 프로젝트를 계속 들고 있었다. 워처는 사라진 프로젝트를 감시하고,
    /// 자동화 허브는 `current_workdays()` 에서 그 id 를 받아 5초마다
    /// `Query returned no rows` 를 남겼다 (이틀간 9,820줄). `.oculpm 도 삭제`
    /// 를 고른 경우 살아 있는 세션 액터가 지운 `.oculpm/index/` 를 되살릴
    /// 수도 있었다. 순서가 중요하다 — **이 함수가 먼저**, 파일 삭제는 그 뒤.
    ///
    /// 세션 마감은 최대 [`FORGET_SESSION_TIMEOUT`] 만 기다린다. 액터가 그 안에
    /// 답하지 않아도 엔트리는 떨어뜨린다 — 지우는 쪽이 멈추는 것보다
    /// crash_recovered 한 줄이 낫다.
    pub async fn forget_project(&self, project_id: u32) {
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;

        let taken = {
            let mut projects = self.projects.write().await;
            projects.remove(&project_id)
        };
        let Some(mut entry) = taken else {
            return;
        };
        if let Some(watcher) = entry.watcher.take() {
            watcher.abort();
        }
        if let Some(session) = entry.session.take() {
            let closed = tokio::time::timeout(FORGET_SESSION_TIMEOUT, session.shutdown()).await;
            if closed.is_err() {
                tracing::warn!(
                    target: "oculpm::manager",
                    project_id,
                    "forget_project: 세션 액터가 제때 답하지 않았다 — 다음 기동의 crash 복구에 맡긴다"
                );
            }
        }
        tracing::info!(
            target: "oculpm::manager",
            project_id,
            "[FLOW] 지운 프로젝트를 매니저에서 잊었다 — 워처 중단 · 세션 마감 · 락 해제"
        );
        // `entry` 가 여기서 떨어지며 `LockGuard::drop` 이 락 파일을 지운다.
    }

    /// Sync best-effort shutdown for `RunEvent::ExitRequested` — drops every
    /// `ProjectEntry`, which fires `LockGuard::drop` synchronously and removes
    /// the on-disk lock file.
    ///
    /// We use `try_write` with a short retry loop because we cannot `await`
    /// from inside Tauri's run-event callback. If every retry contends (which
    /// would mean some other tokio task is mid-mutation at shutdown), the
    /// `OculpmManager` will still get dropped when Tauri's `State` container
    /// tears down — `LockGuard::drop` covers us via RAII as a last resort.
    ///
    /// 세션도 여기서 닫는다 (감사 라운드 2026-09-11 A4). 예전엔 엔트리만
    /// 떨어뜨려 세션 액터의 sender 가 끊기고, 디스크의 세션은 열린 채 남아
    /// **다음 기동이 `crash_recovered` 로 마감**했다 — 정상 종료 13번이
    /// 전부 크래시로 적혔다. 이제 `AppQuit` 으로 마감을 시도하고, 전체
    /// [`FORGET_SESSION_TIMEOUT`] 안에 못 끝난 것만 다음 기동의 복구에 맡긴다.
    pub fn shutdown_all_blocking(&self) {
        for attempt in 0..10 {
            if let Ok(mut projects) = self.projects.try_write() {
                let count = projects.len();
                let entries: Vec<ProjectEntry> = projects.drain().map(|(_, e)| e).collect();
                drop(projects);
                // 세션을 먼저 닫고, 돌아오면서 엔트리를 떨어뜨린다 (LockGuard::drop — 락 파일 제거).
                Self::finalize_sessions_blocking(entries);
                if count > 0 {
                    tracing::info!(
                        target: "oculpm::manager",
                        project_count = count,
                        "released project locks on shutdown"
                    );
                }
                return;
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        tracing::warn!(
            target: "oculpm::manager",
            "shutdown_all_blocking: projects map locked after 10 retries — relying on Drop"
        );
    }

    /// 열린 세션 액터 전부에 `Shutdown`(→ `AppQuit` 마감)을 보내고 한 상한
    /// 안에서 기다린다. 런타임 밖(tao 의 run-event 콜백)에서 불리므로
    /// `block_on` 이 안전하다 — 비동기 커맨드 안에서는 부르지 말 것.
    fn finalize_sessions_blocking(mut entries: Vec<ProjectEntry>) {
        let sessions: Vec<SessionActor> = entries
            .iter_mut()
            .filter_map(|e| e.session.take())
            .collect();
        if sessions.is_empty() {
            return;
        }
        // 이미 런타임 위라면(테스트) 기다리지 않는다 — 여기서 `block_on` 은 패닉.
        // 핸들을 태스크에 넘겨 마감이 끝날 때까지 살려 둔다.
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            for s in sessions {
                rt.spawn(async move {
                    let _ = s.shutdown().await;
                });
            }
            return;
        }
        let closed = tauri::async_runtime::block_on(async {
            tokio::time::timeout(FORGET_SESSION_TIMEOUT, async {
                for s in sessions {
                    let _ = s.shutdown().await;
                }
            })
            .await
        });
        if closed.is_err() {
            tracing::warn!(
                target: "oculpm::manager",
                "shutdown: 세션 마감이 제때 끝나지 않았다 — 남은 것은 다음 기동의 crash 복구가 닫는다"
            );
        }
    }
}

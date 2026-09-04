//! `watcher_start_with` 의 **3단계** — 맵 락을 다시 잡고 설치하는 자리.
//!
//! 기동은 맵 락을 놓고 느린 일(락 파일 획득 = `ps` fork · OS 워치 등록)을 한 뒤
//! 돌아온다. 그 왕복 사이에 상태가 변했을 수 있고, 그때 무엇을 살리고 무엇을
//! 버릴지는 이 파일 하나가 정한다 — 미묘한 판단이라 `lifecycle.rs` 에서 떼어
//! 냈다.

use super::*;

impl OculpmManager {
    /// `watcher_start_with` 3단계 — 맵 락을 다시 잡고 **떠날 때와 같은 세대일
    /// 때만** 설치한다.
    ///
    /// 세대가 달라졌다는 건 그사이 누가 "그만"(`watcher_stop` ·
    /// `yield_evicted_locks` · `watcher_drop_unresponsive`)이라고 했다는 뜻이다.
    /// 그러면 방금 세운 워처를 **버린다** — 조용히 덮어쓰면 사용자가 끈 감시가
    /// 되살아나고, 지금보다 나쁘다. 나중 의도가 이긴다.
    ///
    /// 락 가드는 세대와 무관하게 살린다: 엔트리가 아직 있고 주인이 비어 있으면
    /// 우리가 그 주인이다 (= 감시만 접힌 `init_project` 직후와 같은 상태).
    ///
    /// 반환값: `Ok(true)` 설치함 · `Ok(false)` 세대가 달라져 버림 ·
    /// `Err(NotInitialized)` 엔트리가 사라짐. `payload` 가 `None` 이면 락만
    /// 넘기는 호출이라 `Ok(false)`.
    pub(super) async fn commit_watcher_start(
        &self,
        project_id: u32,
        epoch: u64,
        lock: Option<LockGuard>,
        payload: Option<(SessionActor, ProjectWatcher, bool)>,
    ) -> Result<bool, OculpmError> {
        // 버릴 것은 맵 락 **밖으로** 들고 나온다 — `shutdown()` 은 `await` 다.
        let mut orphan: Option<(ProjectWatcher, Option<SessionActor>)> = None;
        let verdict = {
            let mut projects = self.projects.write().await;
            match projects.get_mut(&project_id) {
                None => {
                    // 프로젝트가 닫혔다. 락 가드는 여기서 떨어지며 파일을 지우는데,
                    // 그게 안전한 이유는 `lifecycle_lock` 이 그사이 같은 경로의 다른
                    // 가드가 생기는 것을 막았기 때문이다.
                    if let Some((s, w, reused)) = payload {
                        orphan = Some((w, (!reused).then_some(s)));
                    }
                    Err(OculpmError::NotInitialized(project_id))
                }
                Some(entry) => {
                    if let Some(g) = lock {
                        if entry.lock.is_none() {
                            entry.lock = Some(g);
                        } else {
                            // 도달 불가 — `lifecycle_lock` 이 막는다. 그래도 여기
                            // 왔다면 그냥 떨어뜨리면 안 된다: 같은 프로세스라 pid 가
                            // 같아서 `LockGuard::drop` 이 **엔트리 것**의 락 파일을
                            // 지운다. 시끄럽게 남기고 하트비트만 새게 둔다.
                            tracing::error!(
                                target: "oculpm::manager",
                                project_id,
                                "락 가드가 둘이다 — 생명주기 직렬화가 깨졌다"
                            );
                            std::mem::forget(g);
                        }
                    }
                    match payload {
                        None => Ok(false),
                        Some((s, w, reused)) => {
                            if entry.watcher_epoch == epoch {
                                entry.session = Some(s);
                                entry.watcher = Some(w);
                                Ok(true)
                            } else {
                                orphan = Some((w, (!reused).then_some(s)));
                                Ok(false)
                            }
                        }
                    }
                }
            }
        };

        if let Some((watcher, session)) = orphan {
            tracing::warn!(
                target: "oculpm::manager",
                project_id,
                "[FLOW] 기동 도중 세대가 바뀌었다 — 방금 세운 워처를 버린다 (덮어쓰지 않는다)"
            );
            watcher.abort();
            if let Some(s) = session {
                let _ = s.shutdown().await;
            }
        }
        verdict
    }
}

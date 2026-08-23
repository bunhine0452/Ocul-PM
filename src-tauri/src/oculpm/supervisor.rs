//! 감시 감독관 — "실시간 갱신이 조용히 죽는" 것을 막는 상주 태스크 (2026-08-23).
//!
//! # 왜 필요한가
//!
//! 이 앱의 약속은 "외부 에이전트가 한 일이 **바로** 보인다" 이고, 그걸 만드는
//! 건 프로젝트별 fs 워처 하나뿐이다. 그런데 그 워처는 **소리 없이** 멈출 수
//! 있었고, 멈춘 걸 아무도 몰랐다. 도그푸딩(2026-08-23)에서 실제로 겪은 두 가지:
//!
//! 1. **읽기 전용으로 시작** — 앱을 두 개 띄우면(설치본 + 개발 빌드) 나중에 뜬
//!    쪽이 `.oculpm/.lock` 을 못 잡고 **모든 프로젝트**의 감시를 포기한다.
//!    락은 `init_project` 에서 한 번만 잡으므로, 저쪽이 진작 끝나도 이 프로세스는
//!    영영 읽기 전용이었다. 남는 신호는 로그 한 줄뿐.
//! 2. **처리 루프의 죽음** — 이벤트 하나가 패닉하면 태스크가 끝나는데,
//!    `debouncer` 는 그대로 남아 상태는 "Running", `watcher_start` 는 "이미 돌고
//!    있음" no-op. 앱을 다시 켜는 것 말고는 되살릴 방법이 없었다.
//!
//! 두 경우 모두 사용자에게는 똑같이 보인다: **AI 가 일지를 써도 화면이 그대로**.
//! 웹뷰를 새로고침하면 화면이 다시 조회해 최신이 보이니 "새로고침해야 보인다"
//! 는 증상이 되고, 정작 워처는 계속 죽어 있다.
//!
//! # 어떻게 판정하는가
//!
//! 태스크 생존(`is_alive`)만으로는 부족하다 — 태스크는 살아 있는데 이벤트가
//! 안 들어오는 경우(fs 이벤트 소스가 끊김)를 못 잡는다. 그래서 **프로브**를
//! 쓴다: `.oculpm/index/` 아래 파일 하나를 매 틱 건드린다. 이 경로는 워처의
//! self-suppress 대상이라 부수효과가 전혀 없지만, 억제 판정 **전에**
//! `events_seen_total` 이 올라가므로 "처리 루프가 이벤트를 받고 있다" 는 사실
//! 자체를 증명한다.
//!
//! 판정은 틱 사이 비교로 한다 — 지난 틱에 프로브를 썼는데 이번 틱에도 카운터가
//! 그대로면 그 워처는 귀가 먹은 것이다. 잠들어 있는 프로젝트도 프로브 덕분에
//! 매 틱 카운터가 올라가므로 "조용함" 과 "먹통" 이 구분된다.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::oculpm::manager::OculpmManager;

/// 점검 주기. 죽은 워처는 최대 두 틱(≈2분) 안에 되살아난다 — 사람이 알아채기
/// 전에 복구되면서, 잠든 노트북에서 초당 깨어날 이유는 없는 간격.
const TICK: Duration = Duration::from_secs(60);

/// 프로브 파일 (프로젝트 상대). `.oculpm/index/**` 는 앱 관리 영역이자 워처의
/// self-suppress 대상이라, 여기 쓰는 건 파이프라인에 아무 자국도 남기지 않는다.
const PROBE_REL: &str = ".oculpm/index/.watchdog";

/// 상주 감독관을 띄운다 (앱 시작 시 1회, `start_background_watchers` 뒤).
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let evicted = handle.state::<OculpmManager>().lock_evicted_signal();
        // project_id → 직전 틱에 프로브를 쓰기 **전에** 읽은 이벤트 카운터.
        let mut probed: HashMap<u32, u32> = HashMap::new();
        // 이미 실패를 알린 프로젝트 — 다른 인스턴스가 락을 쥐고 있는 동안
        // 매분 같은 경고를 11줄씩 쌓지 않기 위해서다 (한 번만 크게 남긴다).
        let mut warned: HashSet<u32> = HashSet::new();
        loop {
            // 정기 점검을 기다리되, 락을 인계당하면 **즉시** 깨어난다 —
            // 다음 틱까지 기다리면 그동안 두 인스턴스가 같은 프로젝트를 함께
            // 감시하고 세션 활동이 이중으로 기록된다.
            tokio::select! {
                _ = tokio::time::sleep(TICK) => {}
                _ = evicted.notified() => {}
            }
            tick(&handle, &mut probed, &mut warned).await;
        }
    });
}

/// 한 번의 점검 — 추적 중인 모든 프로젝트를 훑는다.
async fn tick(app: &AppHandle, probed: &mut HashMap<u32, u32>, warned: &mut HashSet<u32>) {
    let manager = app.state::<OculpmManager>();

    // 인계당한 락부터 놓는다 — 되살리기보다 먼저다. 순서가 뒤집히면 이미
    // 남의 것이 된 프로젝트를 열심히 재무장하게 된다.
    for project_id in manager.yield_evicted_locks().await {
        probed.remove(&project_id);
        use tauri_specta::Event;
        let _ = crate::oculpm::spec::OculpmWatchYielded { project_id }.emit(app);
    }

    let health = manager.watcher_health().await;
    let live: Vec<u32> = health.iter().map(|h| h.project_id).collect();
    probed.retain(|id, _| live.contains(id));
    warned.retain(|id| live.contains(id));

    for h in health {
        // 폴더가 사라졌으면 되살릴 것도 없다 (사용자가 옮겼거나 지웠을 뿐).
        if !h.root.is_dir() {
            probed.remove(&h.project_id);
            continue;
        }

        if is_deaf(h.events_seen, probed.get(&h.project_id).copied()) {
            if h.events_seen.is_some() {
                manager.watcher_drop_unresponsive(h.project_id).await;
            }
            // `watcher_start` 가 락 재시도 + 재무장을 함께 한다. 실패(저쪽
            // 인스턴스가 아직 살아 있음)는 다음 틱에 다시 시도한다 — 이게
            // 예전에 없던 바로 그 재시도다.
            match manager.watcher_start(h.project_id, Some(app.clone())).await {
                Ok(()) => {
                    warned.remove(&h.project_id);
                    tracing::info!(
                        target: "oculpm::supervisor",
                        project_id = h.project_id,
                        had_lock = h.has_lock,
                        "[FLOW] 멈춘 감시를 되살렸다 — 실시간 갱신 복구"
                    );
                }
                // 첫 실패만 크게 남긴다 — 다른 인스턴스가 락을 쥐고 있는 동안
                // 매분 같은 줄을 프로젝트 수만큼 쌓으면 로그가 못 읽게 된다.
                Err(e) if warned.insert(h.project_id) => tracing::warn!(
                    target: "oculpm::supervisor",
                    project_id = h.project_id, error = %e,
                    "[FLOW] 감시 재무장 실패 — 매 틱 다시 시도한다 (해소될 때까지 이 줄은 다시 남기지 않는다)"
                ),
                Err(e) => tracing::debug!(
                    target: "oculpm::supervisor",
                    project_id = h.project_id, error = %e,
                    "[FLOW] 감시 재무장 여전히 실패"
                ),
            }
            probed.remove(&h.project_id);
            continue;
        }

        // 살아 있다 — 다음 틱이 확인할 프로브를 심는다. 기준값은 **쓰기 전에**
        // 읽은 카운터라야 이번 프로브의 효과를 다음 틱이 볼 수 있다.
        if let Some(seen) = h.events_seen {
            if write_probe(&h.root) {
                probed.insert(h.project_id, seen);
            } else {
                probed.remove(&h.project_id);
            }
        }
    }
}

/// 이 관측이 "귀가 먹었다" 인가 (순수 함수).
///
/// - `events_seen: None` — 워처가 없거나 처리 태스크가 죽었다. 바로 재무장.
/// - 지난 틱에 심은 프로브가 카운터를 못 움직였다 — 이벤트가 처리 루프에
///   닿지 않는다. 억제되는 경로라도 카운터는 **억제 판정 전에** 올라가므로,
///   변화가 없다는 건 "조용함" 이 아니라 "먹통" 이다.
/// - 첫 관측(`probed_before: None`)은 판정하지 않는다 — 비교 기준부터 심는다.
fn is_deaf(events_seen: Option<u32>, probed_before: Option<u32>) -> bool {
    match (events_seen, probed_before) {
        (None, _) => true,
        (Some(now), Some(before)) => now == before,
        (Some(_), None) => false,
    }
}

/// 프로브 한 번. 실제로 썼으면 `true`.
///
/// 실패(권한·디스크)는 삼키되 **판정 근거로 삼지 않는다** — 프로브를 못 쓴
/// 틱에 카운터가 멈춘 건 워처 탓이 아니고, 그걸 먹통으로 읽으면 멀쩡한 워처를
/// 2분마다 되살리는 헛수고가 된다.
fn write_probe(root: &Path) -> bool {
    let path = root.join(PROBE_REL);
    // `.oculpm/index/` 는 앱 관리 영역이다 — 아직 없다면(인덱스를 한 번도 쓴
    // 적 없는 새 프로젝트) 여기서 만들어도 남의 것을 건드리는 게 아니다.
    if let Some(dir) = path.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return false;
        }
    }
    // 내용은 아무래도 좋다 — fs 이벤트가 나기만 하면 된다. 타임스탬프를 넣어
    // 두면 같은 바이트 쓰기를 합치는 파일시스템에서도 확실히 이벤트가 난다.
    let stamp = chrono::Utc::now().to_rfc3339();
    std::fs::write(&path, stamp.as_bytes()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn probe_writes_into_the_app_managed_index_dir() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm/index")).unwrap();

        assert!(write_probe(dir.path()));

        let probe = dir.path().join(PROBE_REL);
        assert!(probe.is_file(), "프로브 파일이 만들어져야 한다");
        // 두 번째 쓰기도 조용히 성공해야 한다 (매 틱 덮어쓴다).
        assert!(write_probe(dir.path()));
        assert!(probe.is_file());
    }

    /// 인덱스를 한 번도 쓴 적 없는 새 프로젝트에서도 프로브가 자리를 잡아야
    /// 한다 — 아니면 그 프로젝트는 영원히 "판정 불가" 로 남는다.
    #[test]
    fn probe_creates_the_index_dir_on_a_fresh_project() {
        let dir = TempDir::new().unwrap();
        assert!(write_probe(dir.path()));
        assert!(dir.path().join(PROBE_REL).is_file());
    }

    /// 쓸 수 없으면 정직하게 실패를 알린다 (호출측이 판정을 건너뛴다).
    #[test]
    fn probe_reports_failure_when_the_path_is_unusable() {
        let dir = TempDir::new().unwrap();
        // `.oculpm/index` 자리에 **파일**을 놔 두면 디렉터리를 만들 수 없다.
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        std::fs::write(dir.path().join(".oculpm/index"), b"not a dir").unwrap();
        assert!(!write_probe(dir.path()));
    }

    /// 프로브 경로는 반드시 워처의 self-suppress 대상이어야 한다 — 아니면
    /// 감독관이 매분 세션 활동·인덱싱을 만들어 낸다.
    #[test]
    fn probe_path_is_self_suppressed_by_the_watcher() {
        assert!(crate::oculpm::watcher::is_self_suppressed(PROBE_REL));
    }

    #[test]
    fn missing_or_dead_watcher_is_deaf_immediately() {
        // 워처가 없다 / 태스크가 죽었다 — 프로브 이력과 무관하게 재무장.
        assert!(is_deaf(None, None));
        assert!(is_deaf(None, Some(42)));
    }

    #[test]
    fn first_observation_plants_a_baseline_instead_of_judging() {
        // 기준 없이 판정하면 앱 시작 직후 멀쩡한 워처를 전부 되살린다.
        assert!(!is_deaf(Some(0), None));
    }

    #[test]
    fn counter_that_moved_since_the_last_probe_is_alive() {
        assert!(!is_deaf(Some(7), Some(6)));
    }

    #[test]
    fn counter_frozen_across_a_probe_is_deaf() {
        // 지난 틱에 프로브를 썼는데 카운터가 그대로 = 처리 루프가 못 받는다.
        // "조용한 프로젝트" 는 여기 걸리지 않는다 — 프로브 자체가 이벤트다.
        assert!(is_deaf(Some(6), Some(6)));
    }
}

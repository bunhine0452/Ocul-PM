//! `teardown.rs` 의 테스트 (감사 라운드 2026-09-11 A1·A4).

use super::*;
use tempfile::tempdir;

/// 감사 라운드 2026-09-11 A1 — 지운 프로젝트는 매니저가 **통째로** 잊는다:
/// 워처가 끊기고, 락 파일이 사라지고, `current_workdays()`(자동화 허브가
/// 도는 목록)에서 빠진다. 예전엔 DB 행만 지워져 허브가 5초마다 그 id 를
/// 두드렸다.
#[tokio::test]
async fn forget_project_drops_watcher_lock_and_workday_listing() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();
    manager.watcher_start(1, None).await.unwrap();
    assert_eq!(manager.current_workdays().await.len(), 1);

    manager.forget_project(1).await;

    assert!(
        manager.watcher_health().await.is_empty(),
        "워처가 감독관 목록에서 빠져야 한다"
    );
    assert!(
        manager.current_workdays().await.is_empty(),
        "자동화 허브가 도는 목록에서 빠져야 한다"
    );
    assert!(
        !dir.path().join(".oculpm/.lock").exists(),
        "락 파일이 지워져야 한다"
    );
    assert!(!manager.get_status(1).await.initialized);

    // 두 번 잊어도 조용하다.
    manager.forget_project(1).await;
}

/// 감사 라운드 2026-09-11 A4 — 워처(=세션 액터)가 살아 있는 채로 종료해도
/// 런타임 안에서 패닉하지 않고 락을 놓는다. 실제 앱 종료(런타임 밖)는
/// `AppQuit` 마감을 1초까지 기다리고, 여기(런타임 안)서는 명령만 넣는다.
#[tokio::test]
async fn shutdown_all_with_live_watchers_releases_locks_without_panicking() {
    let dir = tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();
    manager.watcher_start(1, None).await.unwrap();

    manager.shutdown_all_blocking();

    assert!(!dir.path().join(".oculpm/.lock").exists());
    assert!(manager.watcher_health().await.is_empty());
}

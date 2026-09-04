//! `OculpmManager` 의 **락 스코프** 통합 — 전역 프로젝트 맵의 write 락을
//! IO 너머로 잡지 않게 바꾼 뒤(`{#manager-write-lock}`), 그 대가로 생긴 새 위험을
//! 문다.
//!
//! `watcher_start_with` 는 이제 셋으로 나뉜다: 맵 락 안에서 스냅샷 → 맵 락 **밖**
//! 에서 느린 일(락 파일 획득 = `ps` fork · OS 워치 등록) → 맵 락 재획득 + 세대 CAS.
//! 1↔3 사이에 상태가 변할 수 있다는 것이 이 수정이 만들 수 있는 새 버그이고,
//! 여기 있는 테스트는 전부 그 틈을 겨눈다.
//!
//! 무엇을 **재지 않는지**도 분명히 해 둔다: 이 파일은 "빨라졌다" 를 주장하지
//! 않는다. 락을 짧게 잡는다는 것은 구조의 성질이고, 여기서는 그 구조가
//! **상태를 망가뜨리지 않는지**만 본다.

use std::path::Path;
use std::sync::Arc;

use ocul_pm_lib::oculpm::lock::AcquirePolicy;
use ocul_pm_lib::oculpm::manager::OculpmManager;
use ocul_pm_lib::oculpm::spec::{LockStateView, WatcherStateView};

fn lock_file(root: &Path) -> std::path::PathBuf {
    root.join(".oculpm").join(".lock")
}

/// 살아 있는 **남의** pid 가 쥔 락 파일을 손으로 깔아 둔다. 이걸 깔아야
/// `watcher_start_with` 의 느린 가지(= `ps` fork 두 번 + 락 파일 재작성)가
/// 실제로 돈다 — 그 가지가 이번 수정으로 맵 락 **밖**으로 나간 자리다.
fn plant_foreign_lock(root: &Path, pid: u32) {
    let dir = root.join(".oculpm");
    std::fs::create_dir_all(&dir).unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let body = serde_json::json!({
        "schema_version": 1,
        "pid": pid,
        "hostname": "test-host",
        "started_at": now,
        "heartbeat_at": now,
    });
    std::fs::write(dir.join(".lock"), serde_json::to_vec_pretty(&body).unwrap()).unwrap();
}

fn lock_pid(root: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(lock_file(root)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("pid")?.as_u64().map(|p| p as u32)
}

/// 감시를 켜면 상태가 Running 이 되고 쓰기 주인 자리를 유지한다.
/// (3단계로 쪼갠 뒤에도 설치 자체가 되는가 — 가장 기본선.)
#[tokio::test(flavor = "multi_thread")]
async fn start_installs_watcher_and_keeps_the_lock() {
    let dir = tempfile::tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(1, dir.path(), "ko").await.unwrap();

    manager.watcher_start(1, None).await.unwrap();
    assert!(matches!(
        manager.watcher_status(1).await.state,
        WatcherStateView::Running
    ));
    assert!(lock_file(dir.path()).exists(), "락 파일이 남아 있어야 한다");

    manager.watcher_stop(1).await.unwrap();
    assert!(matches!(
        manager.watcher_status(1).await.state,
        WatcherStateView::Stopped
    ));
    // 감시를 껐다고 쓰기 주인 자리까지 내주지는 않는다 (예전 동작 그대로).
    assert!(lock_file(dir.path()).exists());
}

/// 켜기↔끄기를 반복해도 워처는 하나뿐이고 락 파일은 그대로다.
///
/// 3단계 커밋이 락 가드를 흘리면(획득해 놓고 엔트리에 못 꽂거나, 반대로 남의
/// 것을 지우면) 여기서 파일이 사라진다.
#[tokio::test(flavor = "multi_thread")]
async fn start_stop_cycles_never_drop_the_lock_file() {
    let dir = tempfile::tempdir().unwrap();
    let manager = OculpmManager::new();
    manager.init_project(7, dir.path(), "ko").await.unwrap();

    for i in 0..12 {
        manager.watcher_start(7, None).await.unwrap();
        assert!(
            lock_file(dir.path()).exists(),
            "{i}번째 켜기 뒤 락 파일이 사라졌다"
        );
        manager.watcher_stop(7).await.unwrap();
        assert!(
            lock_file(dir.path()).exists(),
            "{i}번째 끄기 뒤 락 파일이 사라졌다"
        );
    }
}

/// 같은 프로젝트에 기동 요청이 겹쳐 와도 워처는 **하나만** 선다.
///
/// 맵 락을 놓고 일하기 때문에 예전처럼 맵 락이 저절로 직렬화해 주지 않는다 —
/// 프로젝트 단위 `lifecycle_lock` 이 그 일을 대신하는지를 본다. 둘이 서면
/// 하나는 엔트리 밖의 고아가 되어 같은 파일 변경을 두 번 기록한다.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_starts_on_one_project_settle_to_one_watcher() {
    let dir = tempfile::tempdir().unwrap();
    let manager = Arc::new(OculpmManager::new());
    manager.init_project(3, dir.path(), "ko").await.unwrap();

    let mut tasks = Vec::new();
    for _ in 0..6 {
        let m = manager.clone();
        tasks.push(tokio::spawn(async move { m.watcher_start(3, None).await }));
    }
    for t in tasks {
        t.await.unwrap().expect("동시 기동은 전부 성공해야 한다");
    }

    assert!(matches!(
        manager.watcher_status(3).await.state,
        WatcherStateView::Running
    ));
    // 설치된 워처는 **살아 있어야** 한다 — 버린 워처를 꽂아 두면 여기서 None.
    let health = manager.watcher_health().await;
    let mine = health.iter().find(|h| h.project_id == 3).unwrap();
    assert!(
        mine.events_seen.is_some(),
        "설치된 워처의 처리 태스크가 죽어 있다 (버린 것을 꽂았다)"
    );

    // 한 번만 꺼도 조용해져야 한다. 워처가 둘이었다면 하나가 남는다.
    manager.watcher_stop(3).await.unwrap();
    assert!(matches!(
        manager.watcher_status(3).await.state,
        WatcherStateView::Stopped
    ));
}

/// 서로 다른 프로젝트의 기동은 서로를 막지 않는다 — 최소한 **교착하지 않고
/// 전부 성공한다**.
///
/// 정직하게: 이 테스트는 "빨라졌다" 를 재지 않는다. 예전 코드에서도 이건
/// 통과했고(직렬로 느리게), 여기서 보는 것은 락 순서를 `lifecycle_lock` →
/// `projects` 로 뒤집은 뒤에도 교착이 없다는 것뿐이다.
#[tokio::test(flavor = "multi_thread")]
async fn starts_on_many_projects_all_succeed() {
    let dirs: Vec<_> = (0..6).map(|_| tempfile::tempdir().unwrap()).collect();
    let manager = Arc::new(OculpmManager::new());
    for (i, d) in dirs.iter().enumerate() {
        manager
            .init_project(i as u32 + 1, d.path(), "ko")
            .await
            .unwrap();
    }

    let mut tasks = Vec::new();
    for i in 0..dirs.len() {
        let m = manager.clone();
        tasks.push(tokio::spawn(async move {
            m.watcher_start(i as u32 + 1, None).await
        }));
    }
    for t in tasks {
        t.await.unwrap().unwrap();
    }
    for i in 0..dirs.len() {
        assert!(matches!(
            manager.watcher_status(i as u32 + 1).await.state,
            WatcherStateView::Running
        ));
    }
}

/// **가장 위험한 자리** — 프로젝트를 닫는 것과 감시를 켜는 것이 겹칠 때.
///
/// 켜기가 맵 락 밖에서 락 파일을 새로 잡는 동안 닫기가 엔트리를 지우면, 한
/// 프로세스 안에 같은 경로의 `LockGuard` 가 둘 생긴다. `LockGuard::drop` 은
/// **디스크의 pid 가 내 pid 면** 파일을 지우므로, 같은 프로세스의 두 가드는
/// 서로의 파일을 지운다 — 남는 것은 주인 없는 락이거나, 주인은 있는데 파일이
/// 없는 상태다.
///
/// 어느 순서로 끝나든 **닫힌 프로젝트의 락 파일은 남아 있으면 안 된다**.
/// 그것이 여기서 보는 유일한 불변식이고, 순서에 의존하지 않는다.
#[tokio::test(flavor = "multi_thread")]
async fn close_racing_start_leaves_no_orphan_lock_file() {
    for round in 0..24 {
        let dir = tempfile::tempdir().unwrap();
        let manager = Arc::new(OculpmManager::new());
        manager.init_project(9, dir.path(), "ko").await.unwrap();

        let starter = {
            let m = manager.clone();
            tokio::spawn(async move { m.watcher_start(9, None).await })
        };
        // 라운드마다 끼어드는 시점을 조금씩 옮긴다 — 한 지점만 찔러서는
        // 3단계 중 어디서 겹치는지 다 훑지 못한다.
        for _ in 0..(round % 5) {
            tokio::task::yield_now().await;
        }
        manager.on_project_closed(9).await.unwrap();
        // 켜기는 성공(먼저 끝남)했거나 NotInitialized(엔트리가 사라짐)다.
        // 어느 쪽이든 오류로 취급하지 않는다 — 패닉만 아니면 된다.
        let _ = starter.await.unwrap();

        assert!(
            !manager.get_status(9).await.initialized,
            "round {round}: 닫힌 프로젝트가 살아 있다"
        );
        assert!(
            !lock_file(dir.path()).exists(),
            "round {round}: 닫힌 프로젝트의 락 파일이 고아로 남았다"
        );
    }
}

/// 읽기 전용으로 뜬 프로젝트가 `TakeOver` 로 주인 자리를 되찾는다 — **락 획득이
/// 맵 락 밖으로 나간 뒤에도** 그 결과가 엔트리에 제대로 꽂히는가.
///
/// 이 경로가 이번 수정에서 가장 크게 움직인 자리다: 예전엔 `LockGuard::acquire_with`
/// (남의 pid 를 확인하느라 `ps` 를 두 번 fork 한다)가 전역 write 락 안에서 돌았고,
/// 이제는 밖에서 돌고 3단계 CAS 로 설치된다.
#[tokio::test(flavor = "multi_thread")]
async fn takeover_from_a_live_foreign_holder_installs_lock_and_watcher() {
    let dir = tempfile::tempdir().unwrap();
    // 살아 있는 남의 프로세스. `sleep` 이 도는 동안 그 pid 는 확실히 살아 있다.
    let mut victim = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("sleep 을 띄우지 못했다");
    plant_foreign_lock(dir.path(), victim.id());

    let manager = OculpmManager::new();
    let report = manager.init_project(21, dir.path(), "ko").await.unwrap();
    assert!(
        matches!(report.lock_state, LockStateView::HeldByOther),
        "살아 있는 남의 락 앞에서 init 은 양보해야 한다"
    );
    assert_eq!(lock_pid(dir.path()), Some(victim.id()));

    manager
        .watcher_start_with(21, None, AcquirePolicy::TakeOver)
        .await
        .unwrap();

    assert_eq!(
        lock_pid(dir.path()),
        Some(std::process::id()),
        "가져오기 뒤 락 파일의 주인은 이 프로세스여야 한다"
    );
    assert!(matches!(
        manager.watcher_status(21).await.state,
        WatcherStateView::Running
    ));
    let health = manager.watcher_health().await;
    let mine = health.iter().find(|h| h.project_id == 21).unwrap();
    assert!(mine.has_lock, "가드가 엔트리에 꽂히지 않았다");

    let _ = victim.kill();
    let _ = victim.wait();
}

/// 켜기 도중에 도착한 "그만" 이 조용히 덮이지 않는다.
///
/// 정직하게: 두 태스크의 실제 겹침은 스케줄러가 정하므로 **이 테스트가 매번
/// 그 틈을 찌른다고 보장하지 않는다**. 그래서 순서에 의존하지 않는 불변식만
/// 단언한다 — 끝난 뒤 상태가 Running 이라면 그 워처는 반드시 **살아 있어야**
/// 하고(버린 워처를 꽂지 않았다), 마지막에 조용히 한 번 더 끄면 반드시
/// Stopped 여야 한다(고아 워처가 남지 않았다).
#[tokio::test(flavor = "multi_thread")]
async fn stop_racing_start_never_installs_a_discarded_watcher() {
    let dir = tempfile::tempdir().unwrap();
    let manager = Arc::new(OculpmManager::new());
    manager.init_project(11, dir.path(), "ko").await.unwrap();

    for round in 0..24 {
        let starter = {
            let m = manager.clone();
            tokio::spawn(async move { m.watcher_start(11, None).await })
        };
        for _ in 0..(round % 5) {
            tokio::task::yield_now().await;
        }
        manager.watcher_stop(11).await.unwrap();
        starter.await.unwrap().unwrap();

        if matches!(
            manager.watcher_status(11).await.state,
            WatcherStateView::Running
        ) {
            let health = manager.watcher_health().await;
            let mine = health.iter().find(|h| h.project_id == 11).unwrap();
            assert!(
                mine.events_seen.is_some(),
                "round {round}: Running 인데 처리 태스크가 죽어 있다 — 버린 워처를 꽂았다"
            );
        }
    }

    manager.watcher_stop(11).await.unwrap();
    assert!(
        matches!(
            manager.watcher_status(11).await.state,
            WatcherStateView::Stopped
        ),
        "폭풍이 지난 뒤 한 번 껐는데도 감시가 남아 있다"
    );
    assert!(lock_file(dir.path()).exists());
}

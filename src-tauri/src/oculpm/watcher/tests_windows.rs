//! 윈도우 전용 워처 테스트 — 감시 중인 프로젝트 폴더를 사용자가 치울 수 있는가
//! (크로스플랫폼 L-FS2 · 플랜 `cross-platform-port` #fs-watcher-flake).
//!
//! 윈도우는 폴더 **안**에 열린 핸들이 하나라도 있으면(`FILE_SHARE_DELETE` 로 열었어도)
//! 그 폴더를 옮기지 못하고, 어떤 프로세스의 현재 디렉터리인 폴더도 옮기지 못한다.
//! 워처가 루트를 감시하는 핸들(ReadDirectoryChangesW)은 루트 **자신**에 걸려 있고
//! `FILE_SHARE_DELETE` 라 막지 않는다 — 여기서 그것을 사용자가 하는 그대로 확인한다.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::time::sleep;

use super::tests::{fast_config, settle, wait_for_open_session};
use super::ProjectWatcher;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::session::SessionActor;

/// 탐색기의 「삭제」 — 셸의 `IFileOperation` 으로 휴지통에 보낸다. `trash` 는 부르는
/// 스레드를 STA 로 초기화하므로 새 스레드에서 (`commands/code/mutate.rs` 와 같은 이유).
/// 「폴더 사용 중 — 다시 시도」 만큼만 물러선다: 1초 넘게 막히면 그대로 실패한다.
fn recycle_like_the_user(path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let p = path.to_path_buf();
        let sent = std::thread::spawn(move || trash::delete(&p).map_err(|e| e.to_string()))
            .join()
            .map_err(|_| "휴지통 호출이 패닉했다".to_string())?;
        if sent.is_ok() || Instant::now() >= deadline {
            return sent;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// 휴지통 비우기 — 이름에 `tag` 가 든 항목만. 비운 개수를 돌려준다.
fn empty_from_recycle_bin(tag: &str) -> Result<usize, String> {
    let tag = tag.to_string();
    std::thread::spawn(move || {
        let ours: Vec<_> = trash::os_limited::list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|item| item.name.to_string_lossy().contains(&tag))
            .collect();
        let n = ours.len();
        trash::os_limited::purge_all(ours).map_err(|e| e.to_string())?;
        Ok(n)
    })
    .join()
    .map_err(|_| "휴지통 비우기가 패닉했다".to_string())?
}

/// 감시 중인(세션까지 열린) 프로젝트를 휴지통으로 보내고, **감시가 살아 있는 채로**
/// 휴지통을 비울 수 있다. 워처·액터를 내려도 원래 자리에 아무것도 되살아나지 않는다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_watched_project_can_be_recycled_and_emptied_while_watching() {
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join(format!("oculpm-watched-{tag}"));
    std::fs::create_dir_all(root.join("src")).unwrap();
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let writer = Arc::new(IndexWriter::new(root.clone(), resolver.clone()));
    let cfg = fast_config();
    let actor = SessionActor::spawn(1, resolver, writer.clone(), cfg.session.clone(), None);
    let watcher = ProjectWatcher::start(1, root.clone(), actor.clone(), writer, cfg, None)
        .await
        .unwrap();
    sleep(Duration::from_millis(150)).await;

    std::fs::write(root.join("src/a.rs"), "fn a() {}").unwrap();
    settle().await;
    wait_for_open_session(&actor).await;
    assert!(
        root.join(".oculpm/index").is_dir(),
        "대조군: 세션이 색인을 썼다"
    );

    let target = root.clone();
    let sent = tokio::task::spawn_blocking(move || recycle_like_the_user(&target))
        .await
        .unwrap();
    assert_eq!(
        sent,
        Ok(()),
        "감시 중인 프로젝트를 휴지통으로 보내지 못했다"
    );
    assert!(!root.exists());
    settle().await;

    let emptied = tokio::task::spawn_blocking(move || empty_from_recycle_bin(&tag))
        .await
        .unwrap();
    assert_eq!(
        emptied,
        Ok(1),
        "감시가 살아 있는 동안 휴지통을 비우지 못했다"
    );

    watcher.stop().await.unwrap();
    actor.shutdown().await.unwrap();
    sleep(Duration::from_millis(200)).await;
    assert!(!root.exists(), "지운 루트가 되살아났다");
}

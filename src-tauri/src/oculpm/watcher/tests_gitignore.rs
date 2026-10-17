//! 워처가 도는 동안 바뀐 루트 `.gitignore` (`tests.rs` 가 800줄 래칫 위라 옆으로 나왔다).

use super::tests::{settle, setup, today_workday};

/// 워처가 켜진 **뒤에** 생긴 `.gitignore` 도 먹어야 한다. 예전엔 기동 때 한 번
/// 읽고 끝이라 앱을 다시 켤 때까지 무시 규칙이 안 걸렸다 (2026-10-18 실측: 그 사이
/// `.work/` 아래 119개 파일이 색인에 들어갔다).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_gitignore_created_after_start_takes_effect() {
    let s = setup().await;
    std::fs::create_dir_all(s.dir.path().join(".work")).unwrap();
    std::fs::write(s.dir.path().join(".gitignore"), ".work/\n").unwrap();
    settle().await;

    std::fs::write(s.dir.path().join(".work/scratch.txt"), "data").unwrap();
    std::fs::write(s.dir.path().join("kept.rs"), "fn k() {}").unwrap();
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let leaked: Vec<_> = events
        .iter()
        .filter(|e| e.path.starts_with(".work/"))
        .collect();
    assert!(leaked.is_empty(), "ignored events leaked: {leaked:?}");
    assert!(
        events.iter().any(|e| e.path == "kept.rs"),
        "tracked file must still be recorded: {events:?}"
    );
}

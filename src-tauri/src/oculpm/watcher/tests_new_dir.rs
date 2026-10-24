//! 리눅스 inotify 의 새 폴더 경합 (`new_dir`) — `tests.rs` 가 800줄 래칫 위라 옆으로 나왔다.

use std::time::Duration;

use tokio::time::sleep;

use super::tests::{settle, setup, today_workday};

/// 새 폴더 두 단계를 만들고 **곧바로** 그 안에 파일을 게시해도(사이드카 일지 쓰기와
/// 같은 모양: create_dir_all → 임시 파일 → 링크 → 임시 삭제) 전부 잡힌다. 리눅스는
/// 새 폴더에 감시가 걸리기 전에 생긴 파일의 이벤트가 없어 `new_dir` 따라잡기가 없으면
/// 대부분을 놓친다 (2026-10-24, 컨테이너 실측 70~87%).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn files_published_into_brand_new_nested_dirs_are_all_seen() {
    let s = setup().await;
    let n = 20;
    for i in 0..n {
        let dir = s.dir.path().join(format!("pkg{i}/src"));
        std::fs::create_dir_all(&dir).unwrap();
        let tmp = dir.join(".tmp-publish");
        std::fs::write(&tmp, format!("pub fn f{i}() {{}}")).unwrap();
        std::fs::hard_link(&tmp, dir.join("lib.rs")).unwrap();
        std::fs::remove_file(&tmp).unwrap();
        sleep(Duration::from_millis(20)).await;
    }
    settle().await;
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let paths: std::collections::HashSet<_> = events.iter().map(|e| e.path.as_str()).collect();
    let missed: Vec<String> = (0..n)
        .map(|i| format!("pkg{i}/src/lib.rs"))
        .filter(|p| !paths.contains(p.as_str()))
        .collect();
    assert!(
        missed.is_empty(),
        "새 폴더 안 파일을 놓쳤다 {}/{n}: {missed:?}",
        missed.len()
    );
}

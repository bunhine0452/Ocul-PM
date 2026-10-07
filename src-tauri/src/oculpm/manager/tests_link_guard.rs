//! `.oculpm/` 링크 가드의 테스트 (보안 피드백 라운드 2026-10-07).

use super::*;
use tempfile::tempdir;

/// 저장소에 실려 온 `.oculpm/` 안의 링크 — init 은 아무것도 쓰기 전에 거부한다.
/// 링크 밖(대상 폴더)에는 한 글자도 생기지 않고, 락도 잡지 않는다.
#[tokio::test]
async fn init_refuses_a_symlink_inside_oculpm() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("proj");
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let outside = dir.path().join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    if !crate::test_links::dir(&outside, &root.join(".oculpm/journal")) {
        return;
    }

    let manager = OculpmManager::new();
    let err = manager.init_project(1, &root, "ko").await.unwrap_err();
    assert!(
        matches!(&err, OculpmError::SymlinkInOculpm(rel) if rel == "journal"),
        "{err:?}"
    );
    assert!(!root.join(".oculpm/.lock").exists(), "락을 잡지 않는다");
    assert!(
        !root.join(".oculpm/config.toml").exists(),
        "설정도 쓰지 않는다"
    );
    assert_eq!(
        std::fs::read_dir(&outside).unwrap().count(),
        0,
        "밖은 그대로"
    );
}

/// 폭발 반경 가드 — 파일시스템 루트에는 아무것도 깔지 않는다 (홈도 같은 판정).
#[cfg(unix)]
#[tokio::test]
async fn init_refuses_the_filesystem_root() {
    let manager = OculpmManager::new();
    let err = manager
        .init_project(1, std::path::Path::new("/"), "ko")
        .await
        .unwrap_err();
    assert!(matches!(err, OculpmError::UnsafeProjectRoot(_)), "{err:?}");
}

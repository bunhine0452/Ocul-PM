//! 「저장소가 아니다」 와 「git 이 없다」 를 가른다 (love-round #diff-non-git, 11-23). 변경 화면은 둘 다
//! 「이 브랜치엔 아직 변경이 없어요」 라고 했다 — 볼 수 없는 것을 「없음」 으로 말했다.

use super::*;

#[test]
fn a_plain_folder_is_not_a_repo_but_git_is_there() {
    let dir = tempfile::tempdir().unwrap();
    let s = status(dir.path());
    assert!(!s.is_git_repo);
    assert!(
        !s.git_missing,
        "git 이 깔린 기계에서 「git 없음」 이라고 했다"
    );
    assert!(uncommitted_changes(dir.path()).is_empty());
}

#[test]
fn a_vanished_folder_is_not_called_git_missing() {
    let dir = tempfile::tempdir().unwrap();
    let gone = dir.path().join("moved-away");
    let s = status(&gone);
    assert!(!s.is_git_repo);
    assert!(!s.git_missing, "사라진 폴더를 「git 없음」 이라고 했다");
}

#[test]
fn a_repo_is_a_repo() {
    let dir = tempfile::tempdir().unwrap();
    let ok = safe::cmd(dir.path(), &["init", "-q"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        return;
    }
    let s = status(dir.path());
    assert!(s.is_git_repo);
    assert!(!s.git_missing);
}

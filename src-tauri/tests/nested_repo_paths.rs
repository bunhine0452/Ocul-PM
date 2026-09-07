//! 프로젝트 루트가 **더 큰 저장소 안**일 때의 경로 되맞춤 — 진짜 git 으로
//! ({#rebase-other-direction}).
//!
//! 단위 테스트(`git::nesting::tests`)는 관계를 손으로 세워 놓고 문자열만 묻는다.
//! 여기서 굳이 진짜 저장소를 만드는 이유는 **실경로**다: `rev-parse
//! --show-toplevel` 은 macOS 에서 `/private/var/...` 를 주는데 프로젝트 루트는
//! `/var/...` 그대로라, 펴지 않고 비교하면 두 경로가 남남이 되어 되맞춤이
//! 조용히 통째로 건너뛰어진다. 그 함정은 픽스처가 진짜여야만 잡힌다.

use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 모노레포 픽스처: 저장소 루트 아래 `apps/web`(프로젝트)와 `apps/api`(남).
/// git 이 없으면 `None` — CI 밖 환경에서 테스트가 거짓으로 붉어지지 않게.
fn monorepo() -> Option<(tempfile::TempDir, std::path::PathBuf)> {
    let dir = tempfile::TempDir::new().ok()?;
    let repo = dir.path();
    let project = repo.join("apps/web");
    std::fs::create_dir_all(project.join("src")).ok()?;
    std::fs::create_dir_all(repo.join("apps/api")).ok()?;
    if !git(repo, &["init", "-q"]) {
        return None;
    }
    git(repo, &["config", "user.email", "t@t.dev"]);
    git(repo, &["config", "user.name", "t"]);
    std::fs::write(project.join("src/a.ts"), "1\n").ok()?;
    std::fs::write(repo.join("apps/api/main.go"), "1\n").ok()?;
    git(repo, &["add", "."]);
    git(repo, &["commit", "-qm", "base"]);
    Some((dir, project))
}

#[test]
fn uncommitted_changes_are_project_relative_and_drop_the_neighbours() {
    let Some((dir, project)) = monorepo() else {
        return;
    };
    std::fs::write(project.join("src/a.ts"), "2\n").unwrap();
    std::fs::write(dir.path().join("apps/api/main.go"), "2\n").unwrap();

    let changes = ocul_pm_lib::git::uncommitted_changes(&project);
    let paths: Vec<&str> = changes.iter().map(|c| c.path.as_str()).collect();
    assert!(
        paths.contains(&"src/a.ts"),
        "저장소 접두사(apps/web/)를 떼야 한다: {paths:?}"
    );
    // 프로젝트 밖 파일은 목록에서 빠진다 — 화면이 열 수도 없는 경로고,
    // 기록률의 분모가 남의 저장소 분량으로 부푼다.
    assert!(
        !paths.iter().any(|p| p.contains("main.go")),
        "프로젝트 밖 파일이 실렸다: {paths:?}"
    );
}

#[test]
fn last_commit_changes_are_project_relative_too() {
    // 세 소비자가 **같은 문**을 지나는지 확인하는 자리. `changes_in_range` 는
    // `uncommitted_changes` 와 다른 경로로 git 을 부르므로 따로 묻는다.
    let Some((dir, project)) = monorepo() else {
        return;
    };
    std::fs::write(project.join("src/a.ts"), "2\n").unwrap();
    std::fs::write(dir.path().join("apps/api/main.go"), "2\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-qm", "second"]);

    let last = ocul_pm_lib::git::last_commit_changes(&project).expect("커밋이 있는데 None");
    let paths: Vec<&str> = last.changes.iter().map(|c| c.path.as_str()).collect();
    assert_eq!(paths, vec!["src/a.ts"], "{paths:?}");
}

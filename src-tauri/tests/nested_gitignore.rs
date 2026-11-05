//! 모든 층의 `.gitignore` (2026-11-05) — 프로젝트 폴더 아래에 저장소가 따로 있으면
//! (`project/naeri/.git`) 그 저장소의 규칙도 워처 · 사전 필터 · 기동 정리가 따른다.
//! 루트 것만 읽던 때는 설치본의 한 저장소에서 기준선 스냅샷 983장 중 976장이 그 저장소의
//! `.gitignore` 가 거르는 파일이었다.

use ocul_pm_lib::oculpm::watcher_queue::ProjectGitignore;

fn write(root: &std::path::Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[test]
fn a_nested_repos_gitignore_applies_below_it_only() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "naeri/.gitignore", ".llm-cache/\n*.tsbuildinfo\n");
    let gi = ProjectGitignore::load(root, true);

    assert!(gi.is_ignored(&root.join("naeri/.llm-cache/24/abc.sse")));
    assert!(gi.is_ignored(&root.join("naeri/tsconfig.tsbuildinfo")));
    assert!(!gi.is_ignored(&root.join("naeri/src/main.ts")));
    // 형제 폴더에는 먹지 않는다.
    assert!(!gi.is_ignored(&root.join("tools/.llm-cache/x.sse")));
    // 루트 밖 경로는 판정하지 않는다.
    assert!(!gi.is_ignored(std::path::Path::new("/elsewhere/.llm-cache/x")));
}

#[test]
fn the_deeper_rule_wins_like_git() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, ".gitignore", "*.log\n");
    write(root, "app/.gitignore", "!keep.log\n");
    let gi = ProjectGitignore::load(root, true);

    assert!(gi.is_ignored(&root.join("app/other.log")));
    assert!(!gi.is_ignored(&root.join("app/keep.log")));
    assert!(gi.is_ignored(&root.join("top.log")));
}

#[test]
fn a_new_nested_gitignore_takes_effect_after_invalidate() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("naeri")).unwrap();
    let gi = ProjectGitignore::load(root, true);
    let cached = root.join("naeri/.llm-cache/a.sse");
    assert!(!gi.is_ignored(&cached));

    write(root, "naeri/.gitignore", ".llm-cache/\n");
    // 폴더마다 읽어 둔 「없음」이 남아 있다 — 워처가 `.gitignore` 이벤트에서 잊게 한다.
    assert!(!gi.is_ignored(&cached));
    gi.invalidate(&root.join("naeri"));
    assert!(gi.is_ignored(&cached));
}

#[test]
fn respect_gitignore_off_ignores_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, ".gitignore", "*\n");
    write(root, "naeri/.gitignore", "*\n");
    let gi = ProjectGitignore::load(root, false);
    assert!(!gi.is_ignored(&root.join("naeri/a.ts")));
    assert!(!gi.is_ignored(&root.join("a.ts")));
}

//! 프로젝트 안의 **연결된 git worktree** 사본은 보지 않는다 (2026-10-24 `{#idx-nested-worktree}`).
//!
//! 병렬 에이전트를 돌리는 사람은 저장소 안에 worktree 를 만든다 (`wt/<이름>` …).
//! 숨김 폴더가 아니면 저장소 전체가 사본마다 한 벌씩 잡혔다 — 코드 색인 시절 실측
//! (청크 18.3% 가 worktree 사본) · 로컬 히스토리 302MB 중 236MB 가 그 사본의 판이었다.
//! 4.0 에서 색인을 걷은 뒤에도 로컬 히스토리 캡처(`watcher_tasks`)와 diff 기준선
//! 스냅샷([`super`])이 같은 판정을 쓴다.
//!
//! 판정: 폴더의 `.git` 이 **파일**이고 그 `gitdir:` 이 `…/worktrees/<이름>` 이다.
//! 서브모듈(`…/modules/<이름>`)은 상위 저장소의 일부라 그대로 본다. 루트 자신은
//! 보지 않는다 — worktree 를 프로젝트로 연 사람의 파일은 그대로 본다.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// `.git` 파일이 이보다 크면 worktree 표식이 아니다 (한 줄짜리다).
const DOT_GIT_FILE_MAX: u64 = 4096;

/// `dir` 이 연결된 worktree 의 뿌리인가. 대부분의 폴더는 stat 하나로 끝난다.
pub(crate) fn is_linked_worktree(dir: &Path) -> bool {
    let dot_git = dir.join(".git");
    let Ok(meta) = std::fs::symlink_metadata(&dot_git) else {
        return false;
    };
    if !meta.is_file() || meta.len() > DOT_GIT_FILE_MAX {
        return false;
    }
    let Ok(text) = std::fs::read_to_string(&dot_git) else {
        return false;
    };
    text.lines()
        .find_map(|l| l.strip_prefix("gitdir:"))
        .is_some_and(|gitdir| {
            let gitdir = gitdir.trim().replace('\\', "/");
            gitdir.trim_end_matches('/').rsplit('/').nth(1) == Some("worktrees")
        })
}

/// 루트 아래 상대 경로가 연결된 worktree 안에 있는가 — 폴더 판정을 기억해 두므로
/// 같은 폴더를 두 번 stat 하지 않는다.
pub(crate) struct WorktreeProbe<'a> {
    root: &'a Path,
    memo: HashMap<PathBuf, bool>,
}

impl<'a> WorktreeProbe<'a> {
    pub(crate) fn new(root: &'a Path) -> Self {
        Self {
            root,
            memo: HashMap::new(),
        }
    }

    /// `rel` 의 조상 폴더(루트 제외, 파일 자신 제외) 중 하나라도 worktree 면 true.
    pub(crate) fn contains(&mut self, rel: &Path) -> bool {
        let Some(parent) = rel.parent() else {
            return false;
        };
        let mut dir = PathBuf::new();
        for c in parent.components() {
            let Component::Normal(name) = c else {
                return false;
            };
            dir.push(name);
            let root = self.root;
            let hit = *self
                .memo
                .entry(dir.clone())
                .or_insert_with(|| is_linked_worktree(&root.join(&dir)));
            if hit {
                return true;
            }
        }
        false
    }
}

/// 한 번만 묻는 자리(워처 이벤트 하나)용.
pub(crate) fn under_linked_worktree(root: &Path, rel: &Path) -> bool {
    WorktreeProbe::new(root).contains(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn a_linked_worktree_is_found_but_a_submodule_and_a_nested_repo_are_not() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "wt/feat/.git",
            "gitdir: /home/u/proj/.git/worktrees/feat\n",
        );
        write(root, "wt/feat/src/a.ts", "1\n");
        write(
            root,
            "win/.git",
            "gitdir: C:\\Users\\u\\proj\\.git\\worktrees\\win\n",
        );
        write(root, "win/b.ts", "1\n");
        write(
            root,
            "libs/sub/.git",
            "gitdir: ../../.git/modules/libs/sub\n",
        );
        write(root, "libs/sub/c.ts", "1\n");
        write(root, "vendored/.git/HEAD", "ref: refs/heads/main\n");
        write(root, "vendored/d.ts", "1\n");
        write(root, "src/e.ts", "1\n");

        assert!(is_linked_worktree(&root.join("wt/feat")));
        assert!(is_linked_worktree(&root.join("win")));
        assert!(!is_linked_worktree(&root.join("libs/sub")));
        assert!(!is_linked_worktree(&root.join("vendored")));
        assert!(!is_linked_worktree(&root.join("src")));

        let mut probe = WorktreeProbe::new(root);
        assert!(probe.contains(Path::new("wt/feat/src/a.ts")));
        assert!(probe.contains(Path::new("win/b.ts")));
        // worktree 의 `.git` 파일 자신도 그 안이다.
        assert!(probe.contains(Path::new("wt/feat/.git")));
        assert!(!probe.contains(Path::new("libs/sub/c.ts")));
        assert!(!probe.contains(Path::new("vendored/d.ts")));
        assert!(!probe.contains(Path::new("src/e.ts")));
        assert!(!probe.contains(Path::new("top.ts")));
        // 지워진 worktree 아래 경로 — 물을 폴더가 없으니 false.
        assert!(!probe.contains(Path::new("wt/gone/x.ts")));
    }

    #[test]
    fn the_root_itself_being_a_worktree_does_not_hide_its_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("agent-1");
        write(&root, ".git", "gitdir: /r/.git/worktrees/agent-1\n");
        write(&root, "src/a.rs", "fn a() {}\n");
        assert!(!under_linked_worktree(&root, Path::new("src/a.rs")));
        assert!(!under_linked_worktree(&root, Path::new("a.rs")));
    }
}

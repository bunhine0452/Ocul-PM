//! 프로젝트 루트와 git 저장소 루트의 **상하 관계**, 그리고 그 관계를 따라
//! 경로를 되맞추는 일 (플랜 `v3-release` {#rebase-other-direction}
//! {#branch-nested-signal}).
//!
//! ## 왜 별도 모듈인가
//!
//! `git.rs` 안에 있던 `root_relative` 는 **한 방향만** 다뤘다: 저장소가
//! 프로젝트 루트 아래일 때(`repo.strip_prefix(root)`). 반대 방향 — 프로젝트
//! 루트가 더 큰 저장소에 중첩된 흔한 모노레포 — 은 손대지 않고 지나갔고,
//! 그러면 git 이 주는 `apps/web/src/a.ts` 가 프로젝트 기준 `src/a.ts` 와
//! 어긋나 파일 겹침 판정이 조용히 0건이 된다.
//!
//! 양방향으로 고치면서 **관계 자체**가 값이 됐다 (`RepoNesting`). 화면이
//! "근거가 왜 약한가"를 말하려면 그 값을 알아야 하기 때문이다. 관계와
//! 되맞춤은 같은 사실의 두 얼굴이라 한자리에 둔다.
//!
//! ## 방향마다 무엇이 달라지는가
//!
//! | 배치 | 되맞춤 | 잃는 것 |
//! |---|---|---|
//! | 같은 자리 | 없음 | 없음 |
//! | 저장소가 루트 **아래** | 접두사를 **붙인다** | `.oculpm/` 이 그 저장소 밖이라 「일지 파일 자체」 근거가 구조적으로 불가능 |
//! | 루트가 저장소 **안** | 접두사를 **뗀다** | 저장소가 함께 바꾼 **프로젝트 밖** 파일 (목록에서 빼는 것이 맞다) |

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 프로젝트 루트와 저장소 루트의 상하 관계. 되맞춤의 방향이자, 화면이 근거의
/// 한계를 말할 때 쓰는 신호다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RepoNesting {
    /// 두 루트가 같다 — 흔한 경우. 되맞출 것이 없다.
    #[default]
    Same,
    /// 저장소가 프로젝트 루트 **아래**다 (`repo = root/<sub>`).
    RepoBelowRoot,
    /// 프로젝트 루트가 더 큰 저장소 **안**에 있다 (`root = repo/<sub>`).
    RootInsideRepo,
    /// 어느 쪽도 상대의 조상이 아니다 — 되맞출 근거가 없다.
    Disjoint,
}

/// 두 루트의 관계와 그 사이 상대 경로 (같거나 겹치지 않으면 `None`).
///
/// 심링크 루트에 지지 않게 양쪽을 실경로로 편 뒤 비교한다 — `repo` 는
/// `rev-parse --show-toplevel` 이라 macOS 에서 `/private/var/...` 로 이미
/// 펴져 있는데 DB 가 준 프로젝트 루트는 `/var/...` 그대로다. 펴지 않으면
/// 그 흔한 배치에서 두 경로가 남남이 된다.
pub fn repo_nesting(root: &Path, repo: &Path) -> (RepoNesting, Option<String>) {
    let real = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p));
    let (root, repo) = (real(root), real(repo));
    let sub = |p: &Path| p.to_string_lossy().replace('\\', "/");
    if let Ok(p) = repo.strip_prefix(&root) {
        let s = sub(p);
        if s.is_empty() {
            return (RepoNesting::Same, None);
        }
        return (RepoNesting::RepoBelowRoot, Some(s));
    }
    match root.strip_prefix(&repo) {
        Ok(p) => (RepoNesting::RootInsideRepo, Some(sub(p))),
        Err(_) => (RepoNesting::Disjoint, None),
    }
}

/// 저장소 기준 경로를 프로젝트 루트 기준으로 되맞춘다 — **양방향**.
///
/// `None` = 이 파일은 프로젝트 **밖**이다. 더 큰 저장소가 형제 디렉터리를 함께
/// 바꿨을 때인데, 프로젝트 화면이 그 파일을 목록에 넣으면 열 수도 없는 경로를
/// 보여 주게 되고 기록률의 분모도 남의 것으로 부푼다. 빼는 것이 맞다.
pub fn root_relative(root: &Path, repo: &Path, repo_rel: &str) -> Option<String> {
    rebase(&repo_nesting(root, repo), repo_rel)
}

/// [`repo_nesting`] 을 한 번만 재고 여러 경로를 되맞출 때 쓰는 자리. 파일마다
/// `canonicalize` 를 두 번씩 부르지 않는다 (커밋 300개면 수천 번이 된다).
pub fn rebase(nesting: &(RepoNesting, Option<String>), repo_rel: &str) -> Option<String> {
    match nesting {
        (RepoNesting::RepoBelowRoot, Some(sub)) => Some(format!("{sub}/{repo_rel}")),
        (RepoNesting::RootInsideRepo, Some(sub)) => Path::new(repo_rel)
            .strip_prefix(sub)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/")),
        _ => Some(repo_rel.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 실경로로 펴는 단계가 있어 임시 디렉터리로 진짜 트리를 만든다 —
    /// 존재하지 않는 경로면 `canonicalize` 가 실패하고 원본을 그대로 쓴다.
    fn tree(parts: &[&str]) -> (tempfile::TempDir, Vec<PathBuf>) {
        let dir = tempfile::TempDir::new().unwrap();
        let made = parts
            .iter()
            .map(|p| {
                let full = dir.path().join(p);
                std::fs::create_dir_all(&full).unwrap();
                full
            })
            .collect();
        (dir, made)
    }

    #[test]
    fn same_root_passes_the_path_through() {
        let (dir, _) = tree(&[]);
        let root = dir.path();
        assert_eq!(repo_nesting(root, root), (RepoNesting::Same, None));
        assert_eq!(
            root_relative(root, root, "src/a.rs").as_deref(),
            Some("src/a.rs")
        );
    }

    #[test]
    fn repo_below_root_gets_the_prefix_added() {
        // `.oculpm/` 이 저장소 **위**: 프로젝트 `/p`, 저장소 `/p/app`.
        let (dir, made) = tree(&["app"]);
        let (root, repo) = (dir.path(), made[0].as_path());
        assert_eq!(
            repo_nesting(root, repo),
            (RepoNesting::RepoBelowRoot, Some("app".to_string()))
        );
        assert_eq!(
            root_relative(root, repo, "src/a.rs").as_deref(),
            Some("app/src/a.rs")
        );
    }

    #[test]
    fn root_inside_repo_gets_the_prefix_stripped() {
        // 흔한 모노레포: 저장소 `/mono`, 프로젝트 `/mono/apps/web`.
        let (dir, made) = tree(&["apps/web"]);
        let (repo, root) = (dir.path(), made[0].as_path());
        assert_eq!(
            repo_nesting(root, repo),
            (RepoNesting::RootInsideRepo, Some("apps/web".to_string()))
        );
        assert_eq!(
            root_relative(root, repo, "apps/web/src/a.ts").as_deref(),
            Some("src/a.ts")
        );
    }

    #[test]
    fn files_outside_the_project_are_dropped() {
        // 같은 저장소의 형제 디렉터리 — 프로젝트 화면에서는 열 수도 없는
        // 경로다. 목록에 넣지 않는다 (기록률의 분모도 남의 것으로 부푼다).
        let (dir, made) = tree(&["apps/web", "apps/api"]);
        let (repo, root) = (dir.path(), made[0].as_path());
        assert_eq!(root_relative(root, repo, "apps/api/main.go"), None);
        assert_eq!(root_relative(root, repo, "README.md"), None);
    }

    #[test]
    fn disjoint_roots_pass_through_untouched() {
        // 되맞출 근거가 없다 — 조용히 틀린 접두사를 붙이는 것보다 낫다.
        let (_dir, made) = tree(&["a", "b"]);
        let (root, repo) = (made[0].as_path(), made[1].as_path());
        assert_eq!(repo_nesting(root, repo), (RepoNesting::Disjoint, None));
        assert_eq!(
            root_relative(root, repo, "src/a.rs").as_deref(),
            Some("src/a.rs")
        );
    }

    #[test]
    fn nesting_is_measured_once_and_reused() {
        let (dir, made) = tree(&["apps/web"]);
        let n = repo_nesting(made[0].as_path(), dir.path());
        assert_eq!(rebase(&n, "apps/web/a").as_deref(), Some("a"));
        assert_eq!(rebase(&n, "apps/api/a"), None);
    }
}

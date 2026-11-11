//! HEAD 를 **git 을 띄우지 않고** 읽는다 — Windows 성능 라운드 (2026-11-11).
//!
//! 윈도우에서 프로세스 하나가 10~30 ms 라, 「HEAD 가 바뀌었나」 를 묻자고 git 을 띄우면
//! 캐시가 의미가 없다. `.git/HEAD` 와 그 가지의 ref 파일(없으면 `packed-refs`)은 git 이
//! 잠금 파일을 이름 바꾸기로 갈아 끼우는 평문이라, 읽기만으로 HEAD 커밋 oid 를 안다.
//!
//! 그 oid 를 열쇠로 기억하는 것들:
//! - HEAD 트리의 경로 집합 ([`in_head`]) — 저장마다 띄우던 `git cat-file -e HEAD:<경로>`
//!   대신. HEAD 가 바뀔 때(커밋·체크아웃) 한 번 `ls-tree -r` 로 다시 받는다.
//! - 직전 커밋의 변경 목록 (`changes::last_commit_changes`).
//!
//! **모르면 물러난다.** reftable 저장소, 심볼릭 ref 의 사슬, 읽을 수 없는 파일 — 그때는
//! `None` 을 돌려 호출부가 예전처럼 git 에 묻는다. 틀린 캐시보다 git 한 번이 낫다.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

/// `.git` 이 가리키는 두 자리 — 워크트리·서브모듈이면 둘이 다르다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GitDirs {
    /// HEAD · `config.worktree` 가 사는 곳 (`.git` 폴더, 또는 `gitdir:` 가 가리키는 곳).
    pub git_dir: PathBuf,
    /// refs · `packed-refs` · `config` 가 사는 곳 (`commondir` 파일이 있으면 그쪽).
    pub common_dir: PathBuf,
}

/// `dir` 에서 위로 올라가며 처음 만나는 `.git`(폴더든 파일이든) — git 의 저장소 찾기와
/// 같은 순서다. 같은 `.git` 을 만나는 두 폴더는 git 에게도 같은 저장소다.
pub(crate) fn dot_git_for(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().map(|a| a.join(".git")).find(|g| g.exists())
}

/// `.git` → [`GitDirs`]. 파일이면 `gitdir: <경로>` 를 따라가고 `commondir` 를 읽는다.
pub(crate) fn git_dirs(dot_git: &Path) -> Option<GitDirs> {
    let git_dir = if dot_git.is_dir() {
        dot_git.to_path_buf()
    } else {
        let text = std::fs::read_to_string(dot_git).ok()?;
        let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
        let target = Path::new(target);
        if target.is_absolute() {
            target.to_path_buf()
        } else {
            dot_git.parent()?.join(target)
        }
    };
    let common_dir = match std::fs::read_to_string(git_dir.join("commondir")) {
        Ok(text) => {
            let c = Path::new(text.trim());
            if c.is_absolute() {
                c.to_path_buf()
            } else {
                git_dir.join(c)
            }
        }
        Err(_) => git_dir.clone(),
    };
    Some(GitDirs {
        git_dir,
        common_dir,
    })
}

/// HEAD 의 모양.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Head {
    /// 가지 위 — `oid` 가 `None` 이면 아직 커밋이 없는 가지(unborn).
    Branch { name: String, oid: Option<String> },
    /// 떨어진 HEAD — 커밋 oid 그대로.
    Detached(String),
}

impl Head {
    /// 캐시 열쇠 — 커밋이 같으면 같은 글자.
    pub(crate) fn key(&self) -> String {
        match self {
            Head::Branch { oid: Some(o), .. } | Head::Detached(o) => o.clone(),
            Head::Branch { name, oid: None } => format!("unborn:{name}"),
        }
    }
}

fn is_oid(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// HEAD 를 파일에서 읽는다. 모르는 모양이면 `None` — 호출부는 git 에 묻는다.
pub(crate) fn read_head(dirs: &GitDirs) -> Option<Head> {
    // reftable 저장소는 HEAD 에 자리표시(`refs/heads/.invalid`)만 둔다.
    if dirs.common_dir.join("reftable").exists() {
        return None;
    }
    let text = std::fs::read_to_string(dirs.git_dir.join("HEAD")).ok()?;
    let text = text.trim();
    let Some(refname) = text.strip_prefix("ref:").map(str::trim) else {
        return is_oid(text).then(|| Head::Detached(text.to_string()));
    };
    let name = refname.strip_prefix("refs/heads/")?;
    if name.is_empty() || name == ".invalid" || refname.contains("..") {
        return None;
    }
    let oid = match std::fs::read_to_string(dirs.common_dir.join(refname)) {
        Ok(loose) => {
            let loose = loose.trim();
            // 심볼릭 ref 의 사슬 — 따라가지 않는다.
            if !is_oid(loose) {
                return None;
            }
            Some(loose.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            packed_ref(&dirs.common_dir, refname)?
        }
        Err(_) => return None,
    };
    Some(Head::Branch {
        name: name.to_string(),
        oid,
    })
}

/// `packed-refs` 에서 `refname` 의 oid. 파일이 없거나 그 줄이 없으면 `Some(None)`
/// (= unborn), 읽지 못하면 `None`.
fn packed_ref(common_dir: &Path, refname: &str) -> Option<Option<String>> {
    let text = match std::fs::read_to_string(common_dir.join("packed-refs")) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(None),
        Err(_) => return None,
    };
    for line in text.lines() {
        if let Some((oid, name)) = line.split_once(' ') {
            if name == refname && is_oid(oid) {
                return Some(Some(oid.to_string()));
            }
        }
    }
    Some(None)
}

/// 작업 트리 루트 `repo` 의 HEAD.
pub(crate) fn head_of(repo: &Path) -> Option<Head> {
    read_head(&git_dirs(&repo.join(".git"))?)
}

/// HEAD 트리 경로 집합 캐시 — 저장소 → (HEAD 열쇠, 집합). 집합 `None` = unborn.
type TreeSet = Arc<Option<HashSet<String>>>;
static TREES: LazyLock<Mutex<HashMap<PathBuf, (String, TreeSet)>>> =
    LazyLock::new(Default::default);

/// `repo` 의 HEAD 트리 경로 집합 — HEAD 커밋이 그대로면 git 을 띄우지 않는다.
/// HEAD 를 파일로 못 읽으면 `None` (호출부가 예전 방식으로).
pub(crate) fn head_tree(repo: &Path) -> Option<TreeSet> {
    let key = head_of(repo)?.key();
    if let Ok(c) = TREES.lock() {
        if let Some((k, set)) = c.get(repo) {
            if *k == key {
                return Some(set.clone());
            }
        }
    }
    let set: TreeSet = Arc::new(if key.starts_with("unborn:") {
        None
    } else {
        super::nesting::head_tree_paths(repo)
    });
    if let Ok(mut c) = TREES.lock() {
        c.insert(repo.to_path_buf(), (key, set.clone()));
    }
    Some(set)
}

/// `repo` 상대 경로 `rel` 이 HEAD 에 있는가 — 모르면 `None`.
pub(crate) fn in_head(repo: &Path, rel: &str) -> Option<bool> {
    let set = head_tree(repo)?;
    Some(set.as_ref().as_ref().is_some_and(|s| s.contains(rel)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    const A: &str = "0123456789abcdef0123456789abcdef01234567";
    const B: &str = "89abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn reads_loose_packed_unborn_and_detached() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join(".git");
        let dirs = git_dirs(&{
            std::fs::create_dir_all(&g).unwrap();
            g.clone()
        })
        .unwrap();
        write(&g.join("HEAD"), "ref: refs/heads/main\n");
        assert_eq!(
            read_head(&dirs),
            Some(Head::Branch {
                name: "main".into(),
                oid: None
            }),
            "가지 파일도 packed-refs 도 없으면 unborn"
        );
        write(
            &g.join("packed-refs"),
            &format!("# pack-refs\n{B} refs/heads/main\n"),
        );
        assert_eq!(read_head(&dirs).unwrap().key(), B);
        write(&g.join("refs/heads/main"), &format!("{A}\n"));
        assert_eq!(read_head(&dirs).unwrap().key(), A, "느슨한 ref 가 이긴다");
        write(&g.join("HEAD"), &format!("{B}\n"));
        assert_eq!(read_head(&dirs), Some(Head::Detached(B.into())));
        std::fs::create_dir_all(g.join("reftable")).unwrap();
        assert_eq!(read_head(&dirs), None, "reftable 은 git 에 맡긴다");
    }

    #[test]
    fn follows_a_worktree_gitdir_file_and_commondir() {
        let t = tempfile::tempdir().unwrap();
        let main = t.path().join("main/.git");
        let wt_git = main.join("worktrees/wt");
        write(&wt_git.join("commondir"), "../..\n");
        write(&wt_git.join("HEAD"), "ref: refs/heads/lane\n");
        write(&main.join("refs/heads/lane"), &format!("{A}\n"));
        let wt = t.path().join("wt");
        write(&wt.join(".git"), &format!("gitdir: {}\n", wt_git.display()));
        let dirs = git_dirs(&wt.join(".git")).unwrap();
        assert_eq!(dirs.git_dir, wt_git);
        assert_eq!(head_of(&wt).map(|h| h.key()).as_deref(), Some(A));
    }
}

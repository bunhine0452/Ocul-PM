//! 저장소 해석과 git 프로세스 실행 — 나머지 모듈이 전부 딛고 서는 바닥.
//! `primary_repo`/`repo_root_for` 는 `.oculpm/` 루트가 저장소 위·아래 어디에
//! 있든 실제 작업 트리를 찾고(30초 캐시), `run_git` 은 그 트리에서 git 을 띄운다.
//! 어디서 git 을 부르는지 한 자리에 모아 두는 것이 이 모듈이 따로인 이유다.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

/// Git's well-known empty-tree object. `git diff <empty-tree> HEAD` renders the
/// whole tree as additions — used as the baseline when HEAD is a root commit
/// (no `HEAD~1` parent).
pub(crate) const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// git 이 경로를 내놓을 때 비ASCII 를 8진수로 이스케이프하지 않게 하는 설정.
/// 기본값(`core.quotepath=on`)이면 `한글.md` 가 `"\355\225\234\352\270\200.md"`
/// 로 나와 `--name-status`·`--porcelain`·`diff --git` 머리글의 경로가 전부
/// 실제 파일명과 어긋난다 — 백필 일지의 `files_touched`, 브랜치 화면의 파일
/// 귀속, 일지 diff 캡처가 한국어 파일명에서 조용히 빠졌다. 세 `run_git` 이
/// 같은 값을 쓴다.
pub(crate) const QUOTEPATH_OFF: [&str; 2] = ["-c", "core.quotepath=off"];

/// git 이 C-quote 로 감싼 경로(`"a b.md"`, 공백·따옴표·제어문자가 있을 때는
/// `quotepath=off` 여도 감싼다)의 겉따옴표와 흔한 이스케이프를 풀어 준다.
/// 8진수 이스케이프(`\355`)도 처리해 `quotepath` 를 못 끈 출력에도 안전하다.
pub(crate) fn unquote_git_path(raw: &str) -> String {
    let raw = raw.trim();
    let Some(inner) = raw.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return raw.to_string();
    };
    let bytes = inner.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b != b'\\' || i + 1 >= bytes.len() {
            out.push(b);
            i += 1;
            continue;
        }
        let esc = bytes[i + 1];
        match esc {
            b'0'..=b'7' => {
                // 최대 세 자리 8진수.
                let mut val: u32 = 0;
                let mut n = 0;
                while n < 3 && i + 1 + n < bytes.len() && (b'0'..=b'7').contains(&bytes[i + 1 + n])
                {
                    val = val * 8 + u32::from(bytes[i + 1 + n] - b'0');
                    n += 1;
                }
                out.push(val as u8);
                i += 1 + n;
            }
            b'n' => {
                out.push(b'\n');
                i += 2;
            }
            b't' => {
                out.push(b'\t');
                i += 2;
            }
            _ => {
                // `\\`, `\"` 등 — 이스케이프된 글자 그대로.
                out.push(esc);
                i += 2;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(super) fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = crate::proc::std_cmd("git");
    cmd.arg("-C").arg(root);
    cmd.args(QUOTEPATH_OFF);
    cmd.args(args);
    let out = cmd
        .output()
        .map_err(|e| format!("Failed to run git ({}): {}", args.join(" "), e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// Now only referenced from tests — project queries go through `primary_repo`
// (nested-aware). Kept as a focused predicate for the test fixtures.
#[cfg(test)]
pub(super) fn is_repo(root: &Path) -> bool {
    crate::proc::std_cmd("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Resolve the git work-tree root that contains `path` (a file or directory).
/// Walks up from the nearest existing ancestor via `rev-parse --show-toplevel`,
/// so it finds the repo even when it sits *below* the Ocul-PM project root — the
/// `.oculpm/` folder can be opened on a parent of the actual git repo. Returns
/// `None` when `path` is not inside any repo.
pub fn repo_root_for(path: &Path) -> Option<PathBuf> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    // `git -C` needs an existing directory — climb to the nearest one.
    let mut anchor = path;
    let dir = loop {
        if anchor.is_dir() {
            break anchor;
        }
        if anchor.exists() {
            // a file → use its parent
            break anchor.parent()?;
        }
        anchor = anchor.parent()?;
    };

    // 디렉터리 → 저장소 루트를 짧게 기억한다 (완성도 라운드 Phase 3). 일지 하나의
    // diff 캡처가 파일마다 `rev-parse --show-toplevel` 을 새로 띄웠다 — 같은
    // 디렉터리에 같은 답을 파일 수만큼. `primary_repo` 와 같은 30초 TTL:
    // 나중에 `git init` 한 폴더가 영원히 "저장소 아님" 으로 남지 않게.
    const TTL: Duration = Duration::from_secs(30);
    static CACHE: LazyLock<Mutex<HashMap<PathBuf, (Instant, Option<PathBuf>)>>> =
        LazyLock::new(Default::default);
    let now = Instant::now();
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, repo)) = cache.get(dir) {
            if now.duration_since(*at) < TTL {
                return repo.clone();
            }
        }
    }
    let repo = run_git(dir, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|out| out.trim().to_string())
        .filter(|top| !top.is_empty())
        .map(PathBuf::from);
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(dir.to_path_buf(), (now, repo.clone()));
    }
    repo
}

/// The path of `abs` relative to its repo `repo`, as a git pathspec. Resilient
/// to symlinked roots (e.g. macOS `/var` → `/private/var`, which `rev-parse
/// --show-toplevel` canonicalizes but `root.join(path)` does not) and to deleted
/// files (canonicalizes the parent dir, re-attaches the file name).
pub(super) fn repo_relative(repo: &Path, abs: &Path) -> Option<String> {
    if let Ok(real) = std::fs::canonicalize(abs) {
        if let Ok(rel) = real.strip_prefix(repo) {
            return Some(rel.to_string_lossy().to_string());
        }
    }
    if let (Some(parent), Some(name)) = (abs.parent(), abs.file_name()) {
        if let Ok(preal) = std::fs::canonicalize(parent) {
            if let Ok(rel) = preal.strip_prefix(repo) {
                return Some(rel.join(name).to_string_lossy().to_string());
            }
        }
    }
    abs.strip_prefix(repo)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Find the git work-tree root(s) relevant to a project at `root`. The common
/// case (root is, or is inside, one repo) returns a single root. When the
/// `.oculpm/` folder sits above the actual repo(s), it discovers repo roots a
/// few levels down — so the 변경 diff 화면 stays git-backed (persistent across
/// restarts/updates) instead of falling back to the volatile watcher buffer.
pub(super) fn discover_repos(root: &Path) -> Vec<PathBuf> {
    if let Some(r) = repo_root_for(root) {
        return vec![r];
    }
    const SKIP: &[&str] = &[
        ".git",
        "node_modules",
        ".oculpm",
        "target",
        "dist",
        "build",
        ".next",
        ".venv",
        "venv",
        "__pycache__",
        ".turbo",
        ".cache",
    ];
    let mut repos = Vec::new();
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir() || !SKIP.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() && entry.path().join(".git").exists() {
            repos.push(entry.path().to_path_buf());
            if repos.len() >= 25 {
                break;
            }
        }
    }
    repos
}

/// The single git work-tree to use for project-level queries (log, status,
/// branch, remotes, tags). Returns `root` itself when it is — or sits inside —
/// a repo, otherwise the first repo discovered just below it. This is what lets
/// every git-backed view work when the `.oculpm/` folder is opened on a *parent*
/// of the actual repo (nested-repo case); previously only the diff path handled
/// it and log/status/branch reported "not a git repo". `None` = no repo found.
/// Contract: when the result isn't `root`, printed paths are repo- not root-
/// relative — re-base via [`nesting::root_relative`] ({#rebase-other-direction}).
pub fn primary_repo(root: &Path) -> Option<PathBuf> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    // 호출마다 `rev-parse --show-toplevel`(그리고 중첩 저장소면 디렉터리 걷기)을
    // 다시 돌리고 있었다 — Today 한 화면이 마운트마다 git 프로세스 ~15개를 띄운
    // 절반이 이 재해석이었다 (2026-08-30 감사). 저장소 루트는 사실상 안 바뀌므로
    // 짧게 기억한다. TTL 을 두는 이유: 나중에 `git init` 한 프로젝트가 영원히
    // "저장소 아님" 으로 남지 않게.
    const TTL: Duration = Duration::from_secs(30);
    static CACHE: LazyLock<Mutex<HashMap<PathBuf, (Instant, Option<PathBuf>)>>> =
        LazyLock::new(Default::default);

    let now = Instant::now();
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, repo)) = cache.get(root) {
            if now.duration_since(*at) < TTL {
                return repo.clone();
            }
        }
    }
    let repo = discover_repos(root).into_iter().next();
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(root.to_path_buf(), (now, repo.clone()));
    }
    repo
}

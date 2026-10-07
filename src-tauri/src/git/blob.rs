//! `<rev>:<path>` 객체 접근 — 크기(`blob_size`)·원시 바이트(`show_file_bytes`)·
//! HEAD 존재 여부(`path_in_head`). 패치가 아니라 **한 시점의 파일**을 묻는
//! 질의라 `diff` 와 가른다. 셋 다 파일이 든 저장소를 스스로 푼다(중첩 저장소).
//!
//! 셋 다 경로를 [`in_root`] 로 먼저 거른다. 저장소를 **경로에서** 풀기 때문에,
//! 거르지 않은 `root.join` 은 `../다른-저장소/파일`·절대경로·밖을 가리키는 링크를
//! 받으면 프로젝트 밖 저장소의 커밋된 내용을 꺼내 준다 (보안 피드백 3차, 2026-10-08 —
//! `code_head_content` 가 그 창구였고, 이미지 미리보기의 "이전" 쪽과 거터도 같았다).

use std::path::{Path, PathBuf};

use super::{repo_relative, repo_root_for, run_git};

/// Size in bytes of the blob at `<rev>:<path>` (`git cat-file -s`). `None`
/// when the path isn't in that rev, the rev doesn't exist (unborn HEAD, root
/// commit's `HEAD~1`), or the file isn't inside any repo. Nested-repo aware.
pub fn blob_size(root: &Path, file_path: &str, rev: &str) -> Option<u64> {
    let abs = in_root(root, file_path)?;
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs)?;
    let out = run_git(&repo, &["cat-file", "-s", &format!("{rev}:{rel}")]).ok()?;
    out.trim().parse().ok()
}

/// Raw bytes of `<rev>:<path>` via `git show` — binary-safe, unlike `run_git`
/// which funnels stdout through a lossy UTF-8 conversion. Powers the 변경 diff
/// 화면's image "이전" preview. `None` when the blob doesn't exist at that rev
/// or exceeds `max_bytes` (the caller renders a size-only card instead).
pub fn show_file_bytes(
    root: &Path,
    file_path: &str,
    rev: &str,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    let abs = in_root(root, file_path)?;
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs)?;
    let out = crate::proc::std_cmd("git")
        .arg("-C")
        .arg(&repo)
        .args(["show", &format!("{rev}:{rel}")])
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.len() > max_bytes {
        return None;
    }
    Some(out.stdout)
}

/// Whether `file_path` exists in the repo's `HEAD` commit.
///   - `None`        — the path isn't inside any git repo.
///   - `Some(true)`  — tracked and present in `HEAD`.
///   - `Some(false)` — inside a repo but NOT in `HEAD`: an untracked/newly
///     created file, a staged-but-never-committed add, or an unborn-HEAD repo.
///
/// Lets the entry-diff capture tell "tracked file with an empty `git diff HEAD`"
/// (a genuine no-op) apart from "brand-new file git diff can't see" (untracked),
/// so only the latter is synthesised as a create diff. Resolves the repo that
/// actually contains the file (it may sit below the Ocul-PM project root).
pub fn path_in_head(root: &Path, file_path: &str) -> Option<bool> {
    let abs = in_root(root, file_path)?;
    let repo = repo_root_for(&abs)?;
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());
    // `cat-file -e HEAD:<rel>` exits 0 iff the blob exists in HEAD; any failure
    // (missing path, or unborn HEAD in a fresh repo) means "not in HEAD".
    Some(run_git(&repo, &["cat-file", "-e", &format!("HEAD:{rel}")]).is_ok())
}

/// `root` 안에 머무는 경로만 절대경로로 — 루트 밖이면 `None`("그 저장소에 없다" 와
/// 같은 답). 판정은 [`crate::path_guard::secure_join`]: 어휘(`..`·절대경로)와 링크를
/// 둘 다 본다. 아직 없는 꼬리(지운 파일의 HEAD 를 읽는 경우)도 지나간다.
pub(super) fn in_root(root: &Path, file_path: &str) -> Option<PathBuf> {
    crate::path_guard::secure_join(root, file_path).ok()
}

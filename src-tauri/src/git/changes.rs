//! 변경 파일 목록 — 변경 diff 화면의 **행**. 작업 트리의 미커밋 변경
//! (`uncommitted_changes`, `git status --porcelain`)과 트리가 깨끗할 때의
//! 직전 커밋(`last_commit_changes`). 둘 다 `GitChange` 행을 프로젝트 루트
//! 기준 경로로 내놓는다 — 중첩 저장소 되맞춤은 `nesting` 에 맡긴다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{discover_repos, nesting, primary_repo, run_git};

/// A single uncommitted change from `git status`. `op` is one of `"A"` / `"M"` /
/// `"D"` so it lines up directly with the frontend `ChangeOp` union used by the
/// 변경 diff 화면. Renames/copies report the *new* path as an add.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GitChange {
    pub path: String,
    pub op: String,
}

/// The most recent commit's metadata + the files it touched. Powers the 변경
/// diff 화면's "직전 커밋" baseline, shown when the working tree is clean so the
/// screen isn't empty after a coding agent commits its work.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LastCommitChanges {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub changes: Vec<GitChange>,
}

/// All uncommitted changes (staged + unstaged + untracked) as `GitChange`
/// rows. This is the **persistent** source for the 변경 diff 화면: unlike the
/// live file-watcher buffer it survives app restarts and project switches, and
/// reflects edits made while the app was closed. Non-git projects / git
/// failures yield an empty Vec so the caller can fall back to the watcher.
pub fn uncommitted_changes(root: &Path) -> Vec<GitChange> {
    // Discover the repo(s) for this project. Nested repos (git below the .oculpm
    // root) are found and reported with paths relative to `root`, so the change
    // list is git-backed (survives restarts/updates) for those layouts too.
    let mut changes = Vec::new();
    for repo in discover_repos(root) {
        let nesting = nesting::repo_nesting(root, &repo); // 저장소당 한 번만
        let out = match run_git(
            &repo,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        ) {
            Ok(o) => o,
            Err(_) => continue,
        };

        let mut tokens = out.split('\0');
        while let Some(entry) = tokens.next() {
            // `-z` entries are `XY<space>PATH`. A rename/copy (X in {R,C}) is
            // followed by a separate NUL-terminated token holding the original
            // path — consume it so it isn't parsed as its own entry.
            if entry.len() < 4 {
                continue;
            }
            let bytes = entry.as_bytes();
            let x = bytes[0] as char;
            let y = bytes[1] as char;
            let raw = &entry[3..];
            if x == 'R' || x == 'C' {
                let _ = tokens.next();
            }
            // `None` = 저장소가 함께 바꾼 **프로젝트 밖** 파일 (여기서 뺀다).
            if let Some(path) = nesting::rebase(&nesting, raw) {
                changes.push(GitChange {
                    path,
                    op: porcelain_op(x, y).to_string(),
                });
            }
        }
    }
    changes
}

/// Files changed by the most recent commit (`HEAD~1..HEAD`, or against the empty
/// tree for a root commit), with the commit's sha/subject. `None` for non-git
/// projects and repos with no commits yet (unborn HEAD).
///
/// git **한 번** — `show --name-status` 가 머리(sha·제목)와 첫 부모 대비 변경 목록을 함께
/// 준다 (뿌리 커밋은 빈 트리 대비). 예전엔 `log -1` · `rev-parse HEAD~1` · `diff
/// --name-status` 셋을 차례로 띄웠다. 결과는 HEAD 커밋 oid 를 열쇠로 기억한다 — 변경
/// 화면은 파일이 바뀔 때마다 다시 읽지만 HEAD 는 커밋할 때만 바뀐다 (Windows 성능 라운드
/// 2026-11-11). `-m --first-parent` 는 합류 커밋에서 `diff HEAD~1 HEAD` 와 같은 쪽(첫
/// 부모)을 보게 한다.
pub fn last_commit_changes(root: &Path) -> Option<LastCommitChanges> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    type Memo = HashMap<(std::path::PathBuf, std::path::PathBuf), (String, LastCommitChanges)>;
    static MEMO: LazyLock<Mutex<Memo>> = LazyLock::new(Default::default);

    let repo = primary_repo(root)?;
    let key = (root.to_path_buf(), repo.clone());
    let head = super::head::head_of(&repo).map(|h| h.key());
    if let Some(h) = &head {
        if h.starts_with("unborn:") {
            return None;
        }
        if let Some((seen, hit)) = MEMO.lock().ok().and_then(|m| m.get(&key).cloned()) {
            if seen == *h {
                return Some(hit);
            }
        }
    }
    let out = run_git(
        &repo,
        &[
            "show",
            "-z",
            "--no-color",
            "--name-status",
            "-m",
            "--first-parent",
            "--format=%H\x1f%s",
            "HEAD",
        ],
    )
    .ok()?;
    let found = parse_show_name_status(root, &repo, &out)?;
    // 열쇠는 실제로 보여 준 커밋의 sha — 그 사이 HEAD 가 움직였어도 어긋나지 않는다.
    if head.is_some() {
        if let Ok(mut m) = MEMO.lock() {
            m.insert(key, (found.sha.clone(), found.clone()));
        }
    }
    Some(found)
}

/// `show -z --name-status --format=%H\x1f%s` 출력 → [`LastCommitChanges`]. 모양은
/// `<sha>\x1f<제목>\0\n<상태>\0<경로>\0…` (이름 바꾸기·복사는 경로가 둘).
fn parse_show_name_status(root: &Path, repo: &Path, out: &str) -> Option<LastCommitChanges> {
    let (meta, rest) = out.split_once('\0').unwrap_or((out, ""));
    let (sha, subject) = meta.trim_end_matches('\n').split_once('\x1f')?;
    let sha = sha.trim().to_string();
    if sha.is_empty() {
        return None;
    }
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    Some(LastCommitChanges {
        short_sha: sha.chars().take(7).collect(),
        sha,
        subject: subject.to_string(),
        changes: name_status_rows(root, repo, rest),
    })
}

/// `--name-status -z` 토큰 → `GitChange` 행 (프로젝트 루트 기준, 중첩 저장소 되맞춤).
/// 변경 diff 화면이 기대하는 op (`A`/`M`/`D`; rename/copy → add).
fn name_status_rows(root: &Path, repo: &Path, out: &str) -> Vec<GitChange> {
    let mut changes = Vec::new();
    let nesting = nesting::repo_nesting(root, repo);
    let mut tokens = out.split('\0').filter(|t| !t.is_empty());
    while let Some(status) = tokens.next() {
        let code = status.chars().next().unwrap_or('M');
        // With `-z`, status and path(s) are separate NUL tokens. A rename/copy
        // (R/C) carries two path tokens (old, new); we report the new path.
        let raw = if code == 'R' || code == 'C' {
            let _old = tokens.next();
            tokens.next()
        } else {
            tokens.next()
        };
        let Some(raw) = raw else { break };
        let op = match code {
            'A' | 'R' | 'C' => "A",
            'D' => "D",
            _ => "M",
        };
        if let Some(path) = nesting::rebase(&nesting, raw) {
            changes.push(GitChange {
                path,
                op: op.to_string(),
            });
        }
    }
    changes
}

/// Map a `git status --porcelain` XY status pair to the `"A"`/`"M"`/`"D"` op the
/// UI understands. Untracked (`??`), additions and rename/copy targets are
/// adds; any deletion is a delete; everything else is a modification.
pub(super) fn porcelain_op(x: char, y: char) -> &'static str {
    if x == '?' {
        return "A";
    }
    if x == 'D' || y == 'D' {
        return "D";
    }
    if x == 'A' || x == 'R' || x == 'C' {
        return "A";
    }
    "M"
}

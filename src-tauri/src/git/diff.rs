//! 패치 생성과 자르기 — 파일 하나(`diff_patch`)·여러 파일 한 번에
//! (`diff_patches`)·스냅샷 두 장(`render_unified_diff`)·커밋 뒤 복원
//! (`diff_at_nearest_commit`). 결과는 전부 unified diff 문자열이고 같은
//! 바이트 예산(`truncate_patch`)으로 자르므로 한자리에 둔다.

use std::path::{Path, PathBuf};

use super::{repo_relative, repo_root_for, run_git};

/// Unified-diff for a single tracked path. `from`/`to` are commit-ish refs;
/// defaulting both to `None` returns the working tree vs `HEAD` diff. Output
/// is truncated (suffix marker appended) once it exceeds `max_bytes`.
///
/// Lite-W6 PR4 retired this helper alongside the changelog commands. PR6
/// resurrects it for LocalDiffView (the *git path* of `compute_diff`).
pub fn diff_patch(
    root: &Path,
    file_path: &str,
    from: Option<&str>,
    to: Option<&str>,
    max_bytes: usize,
) -> Result<String, String> {
    // Resolve the repo that actually contains the file — it may be nested below
    // `root` (the .oculpm folder can sit above the git repo). Run git there with
    // the path made relative to that repo.
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs).ok_or_else(|| "Not a git repository.".to_string())?;
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());

    let mut args = vec!["diff", "--unified=3"];
    match (from, to) {
        (Some(f), Some(t)) => {
            args.push(f);
            args.push(t);
        }
        (Some(f), None) => {
            args.push(f);
        }
        _ => {
            args.push("HEAD");
        }
    }
    args.push("--");
    args.push(&rel);

    let text = run_git(&repo, &args)?;

    Ok(truncate_patch(text, max_bytes))
}

/// 여러 파일의 working-tree-vs-HEAD 패치를 **git 한 번**으로 (완성도 라운드
/// Phase 3). 일지 하나의 diff 캡처가 `files_touched` 마다 `diff_patch` 를 돌려
/// 파일 수 × 2 개의 git 프로세스를 띄웠다 — 이 함수는 파일들을 저장소별로 묶어
/// 저장소당 한 번 `git diff HEAD -- a b c` 를 돌리고 `diff --git` 머리글로
/// 다시 가른다. 결과 키는 호출자가 준 `file_path` 그대로. 패치가 비었거나 git
/// 이 없으면 그 파일은 빠진다 — 호출자가 다음 단계(스냅샷·히스토리)로 넘긴다.
pub fn diff_patches(
    root: &Path,
    file_paths: &[String],
    max_bytes: usize,
) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    let mut out: HashMap<String, String> = HashMap::new();
    if file_paths.is_empty() {
        return out;
    }
    // 저장소별로 묶는다 — `.oculpm` 루트 아래 중첩 저장소가 여럿일 수 있다.
    let mut by_repo: HashMap<PathBuf, Vec<(String, String)>> = HashMap::new();
    for file_path in file_paths {
        let abs = root.join(file_path);
        let Some(repo) = repo_root_for(&abs) else {
            continue;
        };
        let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.clone());
        by_repo
            .entry(repo)
            .or_default()
            .push((rel, file_path.clone()));
    }
    for (repo, files) in by_repo {
        let mut args: Vec<&str> = vec!["diff", "--unified=3", "HEAD", "--"];
        args.extend(files.iter().map(|(rel, _)| rel.as_str()));
        let Ok(text) = run_git(&repo, &args) else {
            continue;
        };
        let by_rel: HashMap<&str, &str> = files
            .iter()
            .map(|(rel, orig)| (rel.as_str(), orig.as_str()))
            .collect();
        for (rel, patch) in split_multi_diff(&text) {
            let Some(orig) = by_rel.get(rel.as_str()) else {
                continue;
            };
            if patch.trim().is_empty() {
                continue;
            }
            out.insert((*orig).to_string(), truncate_patch(patch, max_bytes));
        }
    }
    out
}

/// `git diff -- a b c` 의 출력을 파일별 패치로 가른다 — `diff --git a/<x> b/<y>`
/// 머리글이 경계다. 키는 `b/` 쪽 경로(이름이 바뀐 파일은 새 이름). 각 조각은
/// 자기 머리글부터 다음 머리글 직전까지 — 그대로 `diff_patch` 가 주던 모양이다.
pub(crate) fn split_multi_diff(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    for line in text.split_inclusive('\n') {
        if let Some(rest) = line.strip_prefix("diff --git a/") {
            if let Some(done) = current.take() {
                out.push(done);
            }
            // `a/<x> b/<y>` — 공백이 든 경로는 git 이 따옴표를 붙이지만, 여기선
            // `b/` 뒤를 그대로 쓴다 (이 앱이 다루는 경로엔 따옴표가 없다).
            let path = rest
                .rsplit_once(" b/")
                .map(|(_, b)| b.trim_end_matches(['\n', '\r', '"']).to_string())
                .unwrap_or_else(|| rest.trim_end().to_string());
            current = Some((path, line.to_string()));
        } else if let Some((_, buf)) = current.as_mut() {
            buf.push_str(line);
        }
    }
    if let Some(done) = current.take() {
        out.push(done);
    }
    out
}

// 스냅샷 diff 렌더 — `commands::diff` 에서 옮겨 왔다 (Phase 4: `oculpm/entry_diffs`
// 가 커맨드 계층을 역참조하던 것을 끊는다). `truncate_at_char_boundary` 와 한 집.
/// Format a unified-diff so the frontend's `classifyDiffLines` (which already
/// understands `git diff` output) can render snapshot diffs without changes.
/// The header mirrors `git diff --no-prefix` style with `a/` `b/` prefixes
/// to keep line classification consistent.
pub fn render_unified_diff(path: &str, prev: &str, next: &str, max_bytes: usize) -> String {
    use similar::TextDiff;

    let diff = TextDiff::from_lines(prev, next);
    let body = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();

    let header = format!("diff --git a/{path} b/{path}\n");
    let text = format!("{header}{body}");

    if text.len() > max_bytes {
        format!(
            "{}\n\n... (truncated, {} bytes total)",
            crate::git::truncate_at_char_boundary(&text, max_bytes),
            text.len()
        )
    } else {
        text
    }
}

/// Reconstruct the diff a journal entry described *after* the work was already
/// committed — the last-resort fallback when there's no working-tree diff
/// (`git diff HEAD` empty) and no snapshot baseline. Finds the commit that
/// touched `file_path` nearest in time to `around_unix` (the entry's
/// timestamp) and returns that commit's unified diff for the file.
///
/// Heuristic, so it can mis-attribute when a file is touched by many commits
/// near the same time — but a best-effort "그 시점의 변경" beats "기록 없음".
/// Among candidates ordered by time-distance it returns the first whose
/// `git show` is non-empty (skipping merges / no-op touches), trying a few.
/// When `around_unix` is `None` (the entry's filename carries no parseable
/// HH:MM, e.g. an externally-authored journal), it falls back to the newest
/// commit that touched the path. Returns an empty string when the path has no
/// history or nothing yields a patch.
pub fn diff_at_nearest_commit(
    root: &Path,
    file_path: &str,
    around_unix: Option<i64>,
    max_bytes: usize,
) -> Result<String, String> {
    // Resolve the repo containing the file (may be nested below `root`).
    let abs = root.join(file_path);
    let Some(repo) = repo_root_for(&abs) else {
        return Ok(String::new());
    };
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());

    // "<hash> <author-unixtime>" per commit touching the path (newest first).
    let listing = run_git(
        &repo,
        &["log", "--format=%H %at", "--max-count=200", "--", &rel],
    )?;
    let mut candidates: Vec<(String, i64)> = listing
        .lines()
        .filter_map(|l| {
            let (h, t) = l.split_once(' ')?;
            Some((h.to_string(), t.trim().parse().ok()?))
        })
        .collect();
    if candidates.is_empty() {
        return Ok(String::new());
    }
    // With a timestamp, pick the commit nearest the entry; without one, keep
    // git-log order (newest first) so the most recent change wins.
    if let Some(t) = around_unix {
        candidates.sort_by_key(|(_, ts)| (ts - t).abs());
    }

    for (hash, _) in candidates.into_iter().take(5) {
        // `--format=` drops the commit header, leaving just the patch; `show`
        // (unlike `diff <h>^ <h>`) also handles the root commit (full-file add).
        let patch = run_git(
            &repo,
            &["show", "--format=", "--unified=3", &hash, "--", &rel],
        )
        .unwrap_or_default();
        if !patch.trim().is_empty() {
            return Ok(truncate_patch(patch, max_bytes));
        }
    }
    Ok(String::new())
}

/// Cap a unified-diff blob at `max_bytes`, appending a truncation marker. Keeps
/// a runaway generated file from bloating callers (sidecars, IPC payloads).
fn truncate_patch(text: String, max_bytes: usize) -> String {
    if text.len() > max_bytes {
        format!(
            "{}\n\n... (truncated, {} bytes total)",
            truncate_at_char_boundary(&text, max_bytes),
            text.len()
        )
    } else {
        text
    }
}

/// Longest prefix of `text` that fits in `max_bytes` *bytes* without splitting
/// a UTF-8 char. The old `chars().take(max_bytes)` counted characters, so a
/// multibyte (한글) patch blew the budget by up to 4× before truncating.
pub(crate) fn truncate_at_char_boundary(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

//! 패치 생성과 자르기 — 파일 하나(`diff_patch`)·여러 파일 한 번에
//! (`diff_patches`)·스냅샷 두 장(`render_unified_diff`)·커밋 뒤 복원
//! (`diff_at_nearest_commit`). 결과는 전부 unified diff 문자열이고 같은
//! 바이트 예산(`truncate_patch`)으로 자르므로 한자리에 둔다.

use std::path::{Path, PathBuf};

use super::{repo_relative, repo_root_for, run_git};

/// 바이트 예산에서 잘린 자리 — 보인 바이트 · 원래 바이트.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PatchCut {
    pub shown: usize,
    pub total: usize,
}

/// 바이트 예산으로 자른 패치 (11-15 #diff-receipt). 자른 자리는 줄 끝이고, 잘렸으면 `cut` 이
/// 보인 것 · 원래 크기를 말한다. 변경 화면은 그 둘로 끝에 「64 KB / 212 KB 만 보여요」 를 단다 —
/// 예전엔 영어 문장(`... (truncated, N bytes total)`)을 줄 중간에서 자른 본문 끝에 붙여, 그 문장이
/// 코드 줄처럼 번호를 달고 그려졌다. 문장이 붙은 꼴([`CappedPatch::with_marker`])은 저장되는
/// 일지 사이드카만 쓴다 — 이미 저장된 사이드카가 그 꼴이라 읽는 쪽(`diffParse.splitLegacyCut`)이
/// 같은 영수증 줄로 바꾼다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CappedPatch {
    pub text: String,
    pub cut: Option<PatchCut>,
}

impl CappedPatch {
    /// `max_bytes` 안으로 — 넘으면 마지막 줄바꿈까지만 남긴다(줄 중간에서 끊지 않는다). 한 줄이
    /// 예산보다 길면 그 줄을 글자 경계에서 자른다 — 빈 패치보다 낫다.
    ///
    /// git 출력은 늘 짧은 머리줄(`diff --git` · `---` · `+++` · `@@`)로 시작해서, 예산보다 긴 한 줄(압축 JS ·
    /// 한 줄 JSON · 소스맵)이 그 뒤에 오면 줄 끝까지만 남긴 글이 덩이 머리로 끝나 내용 줄이 0 이었다(11-15
    /// 검수 — 화면에 덩이 머리 하나와 「0.1 KB / 195 KB 만 보여요」 만 남았다). 그때는 잘린 다음 줄을 예산까지
    /// 글자 경계에서 넣고 줄바꿈을 붙인다 — 보인 바이트는 그 길이다.
    pub fn cap(text: String, max_bytes: usize) -> Self {
        if text.len() <= max_bytes {
            return Self { text, cut: None };
        }
        let total = text.len();
        let head = truncate_at_char_boundary(&text, max_bytes);
        let mut kept = head.rfind('\n').map_or(head, |i| &head[..=i]).to_string();
        if ends_with_hunk_header(&kept) {
            // 줄바꿈 한 자리를 남긴다. 남긴 글이 예산 안의 마지막 줄바꿈이라 이 조각에는 줄바꿈이 없다.
            let room = max_bytes.saturating_sub(kept.len() + 1);
            let part = truncate_at_char_boundary(&text[kept.len()..], room);
            if !part.is_empty() {
                kept.push_str(part);
                kept.push('\n');
            }
        }
        let shown = kept.len();
        Self {
            text: kept,
            cut: Some(PatchCut { shown, total }),
        }
    }

    /// 일지 사이드카의 옛 꼴 — 잘렸으면 끝에 표지 문장을 붙인다.
    pub fn with_marker(self) -> String {
        match self.cut {
            Some(cut) => format!(
                "{}\n\n... (truncated, {} bytes total)",
                self.text.trim_end_matches('\n'),
                cut.total
            ),
            None => self.text,
        }
    }
}

/// 줄 끝까지 남긴 글의 마지막 줄이 덩이 머리(`@@ … @@`)인가 — 그 덩이에 내용 줄이 하나도 없다.
/// 줄바꿈으로 끝나지 않으면(첫 줄부터 예산보다 길어 글자 경계에서 잘랐으면) 아니다.
fn ends_with_hunk_header(kept: &str) -> bool {
    let Some(body) = kept.strip_suffix('\n') else {
        return false;
    };
    body.rsplit('\n')
        .next()
        .is_some_and(|last| last.starts_with("@@"))
}

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
    diff_patch_capped(root, file_path, from, to, max_bytes, false).map(CappedPatch::with_marker)
}

/// [`diff_patch`] 의 변경 화면 판 — 자른 자리를 문장 대신 [`PatchCut`] 으로 돌려주고,
/// `ignore_whitespace` 면 공백만 바뀐 줄을 빼고 비교한다(`git diff -w`, 포매터가 낸 소음).
/// 같은 git 실행 자리에 인자 하나가 더 붙을 뿐이다.
pub fn diff_patch_capped(
    root: &Path,
    file_path: &str,
    from: Option<&str>,
    to: Option<&str>,
    max_bytes: usize,
    ignore_whitespace: bool,
) -> Result<CappedPatch, String> {
    // Resolve the repo that actually contains the file — it may be nested below
    // `root` (the .oculpm folder can sit above the git repo). Run git there with
    // the path made relative to that repo.
    let abs = root.join(file_path);
    let repo = repo_root_for(&abs).ok_or_else(|| "Not a git repository.".to_string())?;
    let rel = repo_relative(&repo, &abs).unwrap_or_else(|| file_path.to_string());

    let mut args = vec!["diff", "--unified=3"];
    if ignore_whitespace {
        args.push("-w");
    }
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

    Ok(CappedPatch::cap(text, max_bytes))
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
        // 공백·따옴표가 든 경로는 git 이 머리글을 `diff --git "a/x y" "b/x y"` 로
        // 감싼다 (`quotepath=off` 여도). 예전엔 `a/` 접두만 봐서 그런 파일의
        // 패치가 앞 파일 조각에 붙거나 통째로 빠졌다 — 한국어 파일명이 흔한
        // 저장소에서 일지 diff 가 조용히 사라지던 원인.
        let header = line
            .strip_prefix("diff --git a/")
            .or_else(|| line.strip_prefix("diff --git \"a/"));
        if let Some(rest) = header {
            if let Some(done) = current.take() {
                out.push(done);
            }
            let path = rest
                .rsplit_once(" b/")
                .or_else(|| rest.rsplit_once(" \"b/"))
                .map(|(_, b)| b.trim_end_matches(['\n', '\r']).to_string())
                .unwrap_or_else(|| rest.trim_end().to_string());
            // 닫는 따옴표가 남아 있으면 C-quote 다 — 여는 쪽을 되살려 풀어 준다.
            let path = if path.ends_with('"') {
                super::repo::unquote_git_path(&format!("\"{path}"))
            } else {
                path
            };
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
    render_unified_diff_capped(path, prev, next, max_bytes).with_marker()
}

/// [`render_unified_diff`] 의 변경 화면 판 — 자른 자리를 문장 대신 [`PatchCut`] 으로.
pub fn render_unified_diff_capped(
    path: &str,
    prev: &str,
    next: &str,
    max_bytes: usize,
) -> CappedPatch {
    use similar::TextDiff;

    let diff = TextDiff::from_lines(prev, next);
    let body = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();

    let header = format!("diff --git a/{path} b/{path}\n");
    CappedPatch::cap(format!("{header}{body}"), max_bytes)
}

/// 기준본이 없는 새 파일을 통째로 더한 줄로 (11-15 #diff-receipt) — 앞에서 읽은 `head` 와 파일
/// 전체 크기 `total`. 예전엔 프런트가 파일을 크기 제한 없이 통째로 읽어(10MB 로그면 웹뷰가
/// 멈췄다) 줄마다 `+` 를 붙였고, 끝 줄바꿈 뒤의 빈 조각까지 `+` 줄 하나로 세웠다. 이제 자른
/// 자리는 줄 끝이고, 끝에 줄바꿈이 없으면 git 처럼 표식 줄을 단다.
///
/// 자른 자리와 보인 바이트는 **원래 바이트**에서 잰다 — lossy 로 바꾼 글자로 재면 UTF-8 이 아닌 파일
/// (EUC-KR · Latin-1 로그)은 잘못된 바이트마다 U+FFFD(3바이트)로 부풀어, 100KB 파일이 「117 KB / 100 KB
/// 만 보여요」 가 됐다. 화면에 보일 글만 lossy 로 만든다.
pub fn new_file_patch(path: &str, head: &[u8], total: usize) -> CappedPatch {
    let partial = head.len() < total;
    let kept: &[u8] = if partial {
        head.iter()
            .rposition(|&b| b == b'\n')
            .map_or(head, |i| &head[..=i])
    } else {
        head
    };
    let text = String::from_utf8_lossy(kept);
    let body: &str = &text;
    let mut lines: Vec<&str> = body.split('\n').collect();
    let ends_with_newline = body.ends_with('\n');
    if ends_with_newline || body.is_empty() {
        lines.pop();
    }
    let mut out = format!("diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n");
    if !lines.is_empty() {
        out.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
        for line in &lines {
            out.push('+');
            out.push_str(line);
            out.push('\n');
        }
        if !ends_with_newline && !partial {
            out.push_str("\\ No newline at end of file\n");
        }
    }
    CappedPatch {
        text: out,
        cut: partial.then_some(PatchCut {
            shown: kept.len(),
            total,
        }),
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

/// [`diff_at_nearest_commit`] 를 **여러 파일 한 번에** — 일지 하나의 diff 캡처가 1단계
/// (작업 트리)를 빗나간 파일마다 `log` 한 번 + `show` 최대 다섯 번을 띄우던 것을
/// (Windows 성능 라운드 2026-11-11) 저장소당 `log` 한 번, 고른 커밋당 `show` 한 번으로.
///
/// 파일마다의 답은 한 파일씩 물을 때와 같다: 후보는 그 파일을 건드린 커밋(최신 200개)을
/// 일지 시각과의 거리로 줄 세운 것이고, 앞에서부터 다섯 개 중 처음으로 패치가 비지 않은
/// 커밋을 쓴다. 차례(round) k 마다 아직 못 정한 파일의 k 번째 후보를 커밋별로 묶어
/// `show <커밋> -- 파일들` 한 번으로 묻는다. `--no-renames` 는 한 파일 pathspec 에서
/// 이름 바꾸기 짝이 생길 수 없던 것과 같은 출력을 여러 파일에서도 내게 한다.
///
/// 다른 점 하나: 합류 커밋은 후보가 아니다 (`log --name-only` 가 합류에 파일을 싣지
/// 않는다). 한 파일씩일 때도 합류의 `show` 는 대개 빈 결합 diff 라 건너뛰어졌다.
pub fn diffs_at_nearest_commits(
    root: &Path,
    file_paths: &[String],
    around_unix: Option<i64>,
    max_bytes: usize,
) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    const MAX_CANDIDATES: usize = 200; // `--max-count=200` 의 파일별 몫
    const MAX_TRIES: usize = 5;
    let mut out: HashMap<String, String> = HashMap::new();
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
        let mut args: Vec<&str> = vec![
            "log",
            "--no-renames",
            "-z",
            "--format=%x1e%H %at",
            "--name-only",
            "--",
        ];
        args.extend(files.iter().map(|(rel, _)| rel.as_str()));
        let Ok(listing) = run_git(&repo, &args) else {
            continue;
        };
        let touched = parse_name_log(&listing);
        // 파일별 후보 — 로그 차례(최신 먼저)를 지키고, 시각이 있으면 거리로 (안정) 정렬.
        let mut pending: Vec<(&str, &str, Vec<String>)> = files
            .iter()
            .filter_map(|(rel, orig)| {
                let mut c: Vec<(String, i64)> = touched
                    .iter()
                    .filter(|(_, _, names)| names.iter().any(|n| n == rel))
                    .take(MAX_CANDIDATES)
                    .map(|(h, t, _)| (h.clone(), *t))
                    .collect();
                if c.is_empty() {
                    return None;
                }
                if let Some(t) = around_unix {
                    c.sort_by_key(|(_, ts)| (ts - t).abs());
                }
                Some((
                    rel.as_str(),
                    orig.as_str(),
                    c.into_iter().take(MAX_TRIES).map(|(h, _)| h).collect(),
                ))
            })
            .collect();
        for round in 0..MAX_TRIES {
            let mut by_hash: HashMap<&str, Vec<usize>> = HashMap::new();
            for (i, (_, _, cands)) in pending.iter().enumerate() {
                if let Some(h) = cands.get(round) {
                    by_hash.entry(h.as_str()).or_default().push(i);
                }
            }
            if by_hash.is_empty() {
                break;
            }
            let mut resolved: Vec<usize> = Vec::new();
            for (hash, idxs) in by_hash {
                let mut args: Vec<&str> = vec![
                    "show",
                    "--no-renames",
                    "--format=",
                    "--unified=3",
                    hash,
                    "--",
                ];
                args.extend(idxs.iter().map(|&i| pending[i].0));
                let text = run_git(&repo, &args).unwrap_or_default();
                let patches: HashMap<String, String> =
                    split_multi_diff(&text).into_iter().collect();
                for i in idxs {
                    let (rel, orig, _) = &pending[i];
                    if let Some(p) = patches.get(*rel).filter(|p| !p.trim().is_empty()) {
                        out.insert((*orig).to_string(), truncate_patch(p.clone(), max_bytes));
                        resolved.push(i);
                    }
                }
            }
            resolved.sort_unstable();
            for i in resolved.into_iter().rev() {
                pending.swap_remove(i);
            }
        }
    }
    out
}

/// `log -z --format=%x1e%H %at --name-only` → (커밋, 작성 시각, 파일들) 의 로그 차례 목록.
/// 머리글 토큰은 `\x1e` 로 시작하고, 그 뒤 첫 파일 이름 앞에만 `\n` 이 하나 붙는다.
fn parse_name_log(listing: &str) -> Vec<(String, i64, Vec<String>)> {
    let mut out: Vec<(String, i64, Vec<String>)> = Vec::new();
    let mut after_header = false;
    for token in listing.split('\0') {
        let token = if after_header {
            token.strip_prefix('\n').unwrap_or(token)
        } else {
            token
        };
        after_header = false;
        if let Some(head) = token.strip_prefix('\x1e') {
            let Some((h, t)) = head.split_once(' ') else {
                continue;
            };
            out.push((h.to_string(), t.trim().parse().unwrap_or(0), Vec::new()));
            after_header = true;
        } else if !token.is_empty() {
            if let Some(last) = out.last_mut() {
                last.2.push(token.to_string());
            }
        }
    }
    out
}

/// Cap a unified-diff blob at `max_bytes`, appending a truncation marker. Keeps
/// a runaway generated file from bloating callers (sidecars, IPC payloads).
fn truncate_patch(text: String, max_bytes: usize) -> String {
    CappedPatch::cap(text, max_bytes).with_marker()
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

// git 을 띄우는 시험(공백 무시)은 `git/tests.rs` 에 있다 — 픽스처 저장소를 만드는 자리는 그 파일 하나다.
#[cfg(test)]
mod tests {
    use super::*;

    /// 70KB 패치는 줄 끝에서 64KB 안으로 잘리고, 잘린 자리는 문장이 아니라 숫자로 남는다.
    #[test]
    fn a_long_patch_is_cut_at_a_line_end_without_a_sentence() {
        let text: String = (0..3_000)
            .map(|i| format!("+line {i:05} padding padding\n"))
            .collect();
        assert!(text.len() > 70_000);
        let capped = CappedPatch::cap(text.clone(), 64 * 1024);
        let cut = capped.cut.expect("cut");
        assert!(cut.shown <= 64 * 1024);
        assert_eq!(cut.total, text.len());
        assert_eq!(capped.text.len(), cut.shown);
        assert!(capped.text.ends_with('\n'), "줄 중간에서 잘렸다");
        assert!(!capped.text.contains("truncated"));
        // 사이드카의 옛 꼴은 표지 문장을 그대로 단다 — 읽는 쪽이 같은 영수증 줄로 바꾼다.
        assert!(capped
            .with_marker()
            .ends_with(&format!("\n\n... (truncated, {} bytes total)", text.len())));
        let small = CappedPatch::cap("+a\n".into(), 64);
        assert_eq!(small.cut, None);
    }

    /// 덩이의 내용 줄 수 — `+++` · `---` 머리줄은 빼고 센다.
    fn content_lines(patch: &str) -> usize {
        patch
            .lines()
            .filter(|l| {
                (l.starts_with('+') && !l.starts_with("+++"))
                    || (l.starts_with('-') && !l.starts_with("---"))
            })
            .count()
    }

    /// 압축 파일 (11-15 검수) — 머리줄 뒤에 예산보다 긴 한 줄이 오면 줄 끝까지만 남긴 글은 `@@` 로 끝나 내용
    /// 줄이 0 이었다. 그 줄의 앞을 예산 안에서 보여 주고, 보인 바이트는 그 길이다.
    #[test]
    fn a_line_longer_than_the_budget_after_the_headers_still_shows_its_start() {
        let head = "diff --git a/app.min.js b/app.min.js\nindex 1111111..2222222 100644\n--- a/app.min.js\n+++ b/app.min.js\n@@ -1 +1 @@\n";
        let text = format!("{head}-{}\n+{}\n", "a".repeat(100_000), "b".repeat(100_000));
        let budget = 64 * 1024;
        let capped = CappedPatch::cap(text.clone(), budget);
        let cut = capped.cut.expect("cut");
        assert_eq!(cut.total, text.len());
        assert_eq!(capped.text.len(), cut.shown);
        assert!(cut.shown <= budget, "{}", cut.shown);
        assert!(
            cut.shown > head.len() + 60_000,
            "앞 64KB 를 보여야 한다: {}",
            cut.shown
        );
        assert!(capped.text.starts_with(head));
        assert!(capped.text.ends_with("aaaa\n"), "줄바꿈으로 끝난다");
        assert_eq!(content_lines(&capped.text), 1);
        // 사이드카의 옛 꼴도 같은 몸통 — 표지 문장만 붙는다.
        assert!(content_lines(&capped.clone().with_marker()) >= 1);

        // 한글 한 줄 — 글자 경계에서 자른다(문자열이 깨지지 않는다).
        let ko = format!("{head}+{}\n", "가".repeat(40_000));
        let capped = CappedPatch::cap(ko, budget);
        assert!(capped.cut.expect("cut").shown <= budget);
        assert!(capped.text.ends_with("가\n"));
        assert_eq!(content_lines(&capped.text), 1);
    }

    /// 내용 줄이 이미 선 덩이는 그대로 줄 끝에서 — 다음 덩이 머리로 끝날 때만 그 덩이의 줄을 잇는다.
    #[test]
    fn only_an_empty_hunk_at_the_cut_borrows_the_next_line() {
        let text = format!("@@ -1,2 +1,2 @@\n-x\n+{}\n", "y".repeat(5_000));
        let capped = CappedPatch::cap(text, 1_024);
        assert_eq!(capped.text, "@@ -1,2 +1,2 @@\n-x\n");
        let text = format!("@@ -1 +1 @@\n-x\n+y\n@@ -9 +9 @@\n+{}\n", "z".repeat(5_000));
        let capped = CappedPatch::cap(text, 1_024);
        assert!(capped
            .text
            .starts_with("@@ -1 +1 @@\n-x\n+y\n@@ -9 +9 @@\n+zzz"));
        assert!(capped.text.len() <= 1_024 && capped.text.ends_with("z\n"));
        // 첫 줄부터 예산보다 길면 예전처럼 글자 경계에서 자른 그 줄 하나(줄바꿈을 지어내지 않는다).
        let capped = CappedPatch::cap("w".repeat(5_000), 1_024);
        assert_eq!(capped.text.len(), 1_024);
        assert!(!capped.text.ends_with('\n'));
    }

    /// 새 파일은 앞부분만 더한 줄로 — 끝 줄바꿈 뒤 빈 조각은 줄이 아니고, 줄바꿈이 없으면 표식.
    #[test]
    fn a_new_file_patch_counts_real_lines() {
        let p = new_file_patch("a.txt", b"one\ntwo\n", 8);
        assert_eq!(
            p.text,
            "diff --git a/a.txt b/a.txt\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n"
        );
        assert_eq!(p.cut, None);
        let p = new_file_patch("a.txt", b"one\ntwo", 7);
        assert!(
            p.text.ends_with("+two\n\\ No newline at end of file\n"),
            "{}",
            p.text
        );
        // 큰 파일 — 읽은 앞부분의 마지막 줄 끝까지만, 숫자는 파일 크기.
        let p = new_file_patch("big.log", b"one\ntwo\nthr", 10_000_000);
        assert!(p.text.ends_with("+one\n+two\n"), "{}", p.text);
        assert_eq!(
            p.cut,
            Some(PatchCut {
                shown: 8,
                total: 10_000_000
            })
        );
        let empty = new_file_patch("e.txt", b"", 0);
        assert!(!empty.text.contains("@@"));
    }

    /// UTF-8 이 아닌 큰 새 파일 — 보인 바이트는 원래 바이트로 센다(lossy 의 U+FFFD 로 부풀지 않는다).
    #[test]
    fn a_non_utf8_new_file_counts_shown_bytes_from_the_raw_bytes() {
        // EUC-KR 「가나」 + 줄바꿈 한 줄 = 5바이트. 앞 64KB 를 읽었다고 치고 파일은 100KB.
        let head: Vec<u8> = [0xB0u8, 0xA1, 0xB3, 0xAA, b'\n']
            .iter()
            .copied()
            .cycle()
            .take(64 * 1024)
            .collect();
        let p = new_file_patch("euc.log", &head, 100 * 1024);
        let cut = p.cut.expect("cut");
        let last_newline = head.iter().rposition(|&b| b == b'\n').unwrap();
        assert_eq!(cut.shown, last_newline + 1);
        assert!(cut.shown <= head.len() && cut.shown < cut.total);
        assert!(p.text.contains('\u{FFFD}'), "보이는 글은 lossy 로");
    }
}

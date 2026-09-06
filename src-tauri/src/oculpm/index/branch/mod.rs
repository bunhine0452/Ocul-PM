//! 브랜치 축 — 로컬 git 히스토리 위에서 `.oculpm` 기록을 다시 읽는다
//! (플랜 `v3-surface` {#branch-index}).
//!
//! 이 저장소의 기록 축은 **날짜 + 타입 폴더**다. 브랜치는 어디에도 축이 아니고
//! 스냅샷에 값으로만 잡힌다 (`spec.rs` 의 `SnapshotGit.branch`). 그래서 브랜치
//! 귀속을 **저장하지 않는다** — 디스크 SSOT(마크다운)의 형식도 SQLite 스키마도
//! 그대로 두고 질의 시점에 파생한다:
//!
//! 1. `git log <base>..<branch> --name-status` 로 이 브랜치가 바꾼 파일과 날짜
//!    창을 읽고,
//! 2. 그 창 안의 일지를 이미 있는 캐시(`JournalCache::range_entries`)에서 꺼내
//! 3. 두 가지 근거로 귀속한다 — 일지 파일 **자체**가 이 브랜치의 변경 목록에
//!    있거나(`BranchLink::Entry`, 이견의 여지가 없다), 일지가 적은 파일이
//!    브랜치가 바꾼 파일과 겹치거나(`BranchLink::Files`).
//!
//! 마이그레이션을 만들지 않은 이유가 여기 있다. 캐시에 `branch` 컬럼을 더해도
//! 그 값은 리베이스·체리픽·머지 한 번에 거짓이 된다 — 브랜치는 움직이는
//! 좌표라 **파생이 정본**이다. 네트워크도, 새 파일 형식도 없다: `git.rs` 가
//! 이미 읽는 로컬 히스토리뿐이다.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::Db;
use crate::oculpm::cache::{JournalCache, RangeEntry};
use crate::oculpm::paths::workday_of_rel;

/// 커밋 상한. 화면 하나가 읽는 양이라 넉넉하되 무한하지 않다 — `main` 처럼
/// 기준이 없는 브랜치는 이 수만큼만 거슬러 올라간다.
const COMMIT_CAP: u32 = 300;

/// 기준 브랜치 후보 — 먼저 있는 것을 쓴다. 사용자가 고르면 그 값이 이긴다.
const BASE_CANDIDATES: &[&str] = &["main", "master", "develop", "dev"];

// ─────────────────────────────────────────────────────────────────────────────
// 와이어 DTO
// ─────────────────────────────────────────────────────────────────────────────

/// 로컬 브랜치 하나. `for-each-ref` 한 번으로 전부 읽는다 — 브랜치마다 git 을
/// 다시 부르지 않는다 (Today 화면이 마운트마다 git 프로세스 15개를 띄우던
/// 2026-08-30 감사의 교훈).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchRef {
    pub name: String,
    pub is_current: bool,
    pub tip_sha: String,
    pub short_sha: String,
    /// 팁 커밋의 커미터 시각 (unix seconds).
    pub tip_timestamp: i32,
    pub subject: String,
}

/// 일지가 이 브랜치에 붙은 **이유**. 파생 판정이라 근거를 함께 싣는다 —
/// 화면이 "왜 이게 여기 있나"를 말할 수 있어야 원장에 대한 거짓말이 안 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BranchLink {
    /// 일지 파일 자체가 이 브랜치의 커밋(또는 작업 트리)에 있다.
    Entry,
    /// 일지가 적은 파일이 이 브랜치가 바꾼 파일과 겹치고 날짜도 창 안이다.
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    /// author date, unix seconds.
    pub timestamp: i32,
    /// 로컬 시각 기준 `YYYYMMDD` — 일지 폴더 이름과 같은 모양.
    pub workday: String,
    pub file_count: u32,
    /// 이 커밋이 함께 실은 일지 파일 수 (`.oculpm/journal/**.md`).
    pub journal_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchEntry {
    /// `.oculpm/journal/` 아래 상대 경로 — 일지 화면이 여는 열쇠.
    pub relative_path: String,
    pub workday: String,
    pub entry_type: String,
    pub status: String,
    pub agent_id: String,
    pub title: String,
    pub link: BranchLink,
    /// 이 일지가 적은 파일 중 브랜치가 실제로 바꾼 것의 수.
    pub matched_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchPlanItem {
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
    pub item_title: String,
    pub status: String,
    /// 이 항목을 브랜치로 끌고 온 일지 (plan-log 의 `journal_ref`).
    pub journal_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchFile {
    pub path: String,
    /// 이 파일을 건드린 브랜치 커밋 수. 작업 트리에만 있으면 0.
    pub commits: u32,
    /// 아직 커밋되지 않은 변경인가.
    pub uncommitted: bool,
    /// 이 브랜치에 붙은 일지 중 이 파일을 적은 것이 있는가.
    pub recorded: bool,
}

/// 브랜치 하나의 이야기 — 커밋·일지·플랜 항목·파일을 한 좌표로 묶은 것.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchStory {
    pub branch: String,
    /// 비교 기준. 기준이 될 브랜치를 못 찾으면 `None` — 그때는 최근 커밋만 본다.
    pub base: Option<String>,
    pub merge_base: Option<String>,
    pub is_current: bool,
    /// 일지를 찾은 날짜 창 (`YYYYMMDD`, 양끝 포함).
    pub since_workday: String,
    pub until_workday: String,
    pub commits: Vec<BranchCommit>,
    pub entries: Vec<BranchEntry>,
    pub plan_items: Vec<BranchPlanItem>,
    /// 바뀐 파일 — `.oculpm/` 아래(원장 자신)는 뺀다.
    pub files: Vec<BranchFile>,
    /// 바뀐 파일 중 일지가 적은 것의 수. `files.len()` 과의 비가 곧 기록률이다.
    pub recorded_files: u32,
    pub uncommitted_files: u32,
    /// 브랜치가 실어 온 일지 파일 수 (커밋 + 작업 트리).
    pub journal_files: u32,
    /// 커밋 상한에 걸렸는가 — 걸렸으면 아래 숫자들이 "전부"가 아니다.
    pub truncated: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// git 읽기
// ─────────────────────────────────────────────────────────────────────────────

fn run_git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git ({}): {e}", args.join(" ")))?;
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

/// 로컬 브랜치 목록 (최근 커밋 순). 원격은 읽지 않는다 — 이 축은 로컬 git 만
/// 재료로 쓴다.
pub fn list_branches(project_root: &Path, limit: u32) -> Result<Vec<BranchRef>, String> {
    let Some(repo) = crate::git::primary_repo(project_root) else {
        return Err("Not a git repository.".to_string());
    };
    let count = format!("--count={}", limit.clamp(1, 200));
    let text = run_git(
        &repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "refs/heads",
            &count,
            "--format=%(refname:short)%1f%(objectname)%1f%(committerdate:unix)%1f%(HEAD)%1f%(contents:subject)",
        ],
    )?;
    Ok(parse_branch_refs(&text))
}

/// `for-each-ref` 한 줄 = 브랜치 하나. 필드가 모자란 줄은 조용히 버린다 —
/// 목록 하나 때문에 화면 전체가 오류가 되면 안 된다.
fn parse_branch_refs(text: &str) -> Vec<BranchRef> {
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
        if parts.len() < 5 || parts[0].is_empty() {
            continue;
        }
        let tip_sha = parts[1].to_string();
        out.push(BranchRef {
            name: parts[0].to_string(),
            is_current: parts[3].trim() == "*",
            short_sha: tip_sha.chars().take(7).collect(),
            tip_sha,
            tip_timestamp: parts[2].trim().parse().unwrap_or(0),
            subject: parts[4].to_string(),
        });
    }
    out
}

/// 이 브랜치의 기준. 후보 중 **존재하고 자기 자신이 아닌** 첫 번째.
fn pick_base(repo: &Path, branch: &str) -> Option<String> {
    for cand in BASE_CANDIDATES {
        if *cand == branch {
            continue;
        }
        if run_git(
            repo,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{cand}"),
            ],
        )
        .is_ok()
        {
            return Some((*cand).to_string());
        }
    }
    None
}

/// git 쪽 재료 — 커밋·바뀐 파일·창. 순수 파생부(`attribute`)와 나눠 둔 이유는
/// 그쪽을 git 없이 테스트하기 위해서다.
#[derive(Debug, Clone, Default)]
pub struct BranchGit {
    pub base: Option<String>,
    pub merge_base: Option<String>,
    pub commits: Vec<BranchCommit>,
    /// 커밋이 건드린 파일 → 그 커밋 수.
    pub commit_files: BTreeMap<String, u32>,
    /// 작업 트리에만 있는 변경 (현재 브랜치일 때만 채워진다).
    pub dirty_files: BTreeSet<String>,
    pub truncated: bool,
}

impl BranchGit {
    /// 커밋 + 작업 트리를 합친 변경 경로 전부.
    pub fn changed_paths(&self) -> BTreeSet<String> {
        let mut all: BTreeSet<String> = self.commit_files.keys().cloned().collect();
        all.extend(self.dirty_files.iter().cloned());
        all
    }
}

/// `git log <range> --name-status` 한 번 + 필요하면 `status --porcelain` 한 번.
pub fn read_branch_git(
    project_root: &Path,
    branch: &str,
    base: Option<&str>,
    is_current: bool,
) -> Result<BranchGit, String> {
    let Some(repo) = crate::git::primary_repo(project_root) else {
        return Err("Not a git repository.".to_string());
    };
    let base = match base {
        Some(b) if !b.is_empty() && b != branch => Some(b.to_string()),
        Some(_) => None,
        None => pick_base(&repo, branch),
    };
    let merge_base = base.as_ref().and_then(|b| {
        run_git(&repo, &["merge-base", b, branch])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });

    // 기준이 있으면 `base..branch`, 없으면 브랜치 자체를 상한까지.
    let range = match &merge_base {
        Some(mb) => format!("{mb}..{branch}"),
        None => branch.to_string(),
    };
    let cap = format!("-n{COMMIT_CAP}");
    let text = run_git(
        &repo,
        &[
            "log",
            "--no-color",
            "--no-merges",
            "-M",
            &cap,
            "--name-status",
            "--date=format-local:%Y%m%d",
            "--pretty=format:\x1e%H\x1f%an\x1f%at\x1f%ad\x1f%s\x1f",
            &range,
        ],
    )?;
    let (commits, commit_files) = parse_log_name_status(&text);

    let dirty_files = if is_current {
        run_git(&repo, &["status", "--porcelain"])
            .map(|s| parse_porcelain(&s))
            .unwrap_or_default()
    } else {
        BTreeSet::new()
    };

    let truncated = commits.len() as u32 >= COMMIT_CAP;
    Ok(BranchGit {
        base,
        merge_base,
        commits,
        commit_files,
        dirty_files,
        truncated,
    })
}

/// `--name-status` 블록이 붙은 로그를 커밋 목록 + 파일→커밋수 로 접는다.
/// 이름 바꾼 파일은 **새 경로**로 잡는다 (`git.rs::parse_name_status` 와 같은 규칙).
fn parse_log_name_status(text: &str) -> (Vec<BranchCommit>, BTreeMap<String, u32>) {
    let mut commits = Vec::new();
    let mut files: BTreeMap<String, u32> = BTreeMap::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim_start_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(6, '\x1f');
        let sha = parts.next().unwrap_or("").to_string();
        if sha.is_empty() {
            continue;
        }
        let author_name = parts.next().unwrap_or("").to_string();
        let timestamp = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let workday = parts.next().unwrap_or("").trim().to_string();
        let subject = parts.next().unwrap_or("").to_string();
        let block = parts.next().unwrap_or("");

        let mut file_count = 0u32;
        let mut journal_count = 0u32;
        for line in block.lines() {
            let Some(path) = name_status_path(line) else {
                continue;
            };
            file_count += 1;
            if is_journal_path(&path) {
                journal_count += 1;
            }
            *files.entry(path).or_insert(0) += 1;
        }
        commits.push(BranchCommit {
            short_sha: sha.chars().take(7).collect(),
            sha,
            subject,
            author_name,
            timestamp,
            workday,
            file_count,
            journal_count,
        });
    }
    (commits, files)
}

/// `M\tpath` / `R100\told\tnew` 한 줄에서 **결과 경로**를 뽑는다.
fn name_status_path(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let mut cols = line.split('\t');
    let code = cols.next().unwrap_or("");
    let status = code.chars().next()?;
    let p1 = cols.next().unwrap_or("");
    let p2 = cols.next();
    let picked = if matches!(status, 'R' | 'C') {
        p2.or(Some(p1))
    } else {
        Some(p1)
    };
    picked.filter(|p| !p.is_empty()).map(str::to_string)
}

/// `git status --porcelain` → 경로 집합. 이름 바꿈(`old -> new`)은 새 경로로.
fn parse_porcelain(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let path = line[3..].trim();
        let path = path.rsplit(" -> ").next().unwrap_or(path);
        if !path.is_empty() {
            out.insert(path.to_string());
        }
    }
    out
}

fn is_journal_path(path: &str) -> bool {
    path.starts_with(".oculpm/journal/") && path.ends_with(".md")
}

// ─────────────────────────────────────────────────────────────────────────────
// 파생 (순수) — git 도 DB 도 없이 테스트된다
// ─────────────────────────────────────────────────────────────────────────────

/// 브랜치가 실어 온 일지 파일 경로들을 캐시의 `relative_path` 로 되돌린다.
/// (`.oculpm/journal/20260906/Features/x.md` → `20260906/Features/x.md`)
pub fn journal_rel_paths(changed: &BTreeSet<String>) -> BTreeSet<String> {
    changed
        .iter()
        .filter(|p| is_journal_path(p))
        .filter_map(|p| p.strip_prefix(".oculpm/journal/"))
        .map(str::to_string)
        .collect()
}

/// 일지 창 — 커밋 날짜와 직접 링크된 일지의 워크데이를 모두 덮고 하루씩 넓힌다.
///
/// 하루를 넓히는 이유: git 의 로컬 날짜와 이 앱의 워크데이는 **경계가 다르다**
/// (`WorkdayResolver` 는 `day_starts_at` 컷오프를 쓴다). 창은 겹침 판정의 거친
/// 울타리일 뿐이고 진짜 판정은 파일 교집합이 하므로, 넓게 잡는 쪽이 안전하다.
pub fn workday_window(
    commit_workdays: &[String],
    direct_rels: &BTreeSet<String>,
    today: &str,
    include_today: bool,
) -> (String, String) {
    let mut days: BTreeSet<&str> = BTreeSet::new();
    for w in commit_workdays {
        if w.len() == 8 {
            days.insert(w.as_str());
        }
    }
    for rel in direct_rels {
        if let Some(w) = workday_of_rel(rel) {
            days.insert(w);
        }
    }
    if include_today || days.is_empty() {
        days.insert(today);
    }
    let first = days.iter().next().copied().unwrap_or(today);
    let last = days.iter().next_back().copied().unwrap_or(today);
    (shift_workday(first, -1), shift_workday(last, 1))
}

/// `YYYYMMDD` 를 하루 단위로 민다. 못 읽으면 원문 그대로 — 창이 조금 좁을 뿐
/// 오류로 만들 일은 아니다.
fn shift_workday(day: &str, delta: i64) -> String {
    chrono::NaiveDate::parse_from_str(day, "%Y%m%d")
        .ok()
        .and_then(|d| d.checked_add_signed(chrono::Duration::days(delta)))
        .map(|d| d.format("%Y%m%d").to_string())
        .unwrap_or_else(|| day.to_string())
}

/// 창 안의 일지들을 브랜치에 귀속시킨다.
///
/// - `direct_rels` 에 있으면 `Entry` — 파일 자체가 이 브랜치에 있다.
/// - 아니면 적은 파일이 `changed` 와 겹칠 때만 `Files`.
/// - 둘 다 아니면 버린다. 같은 날 다른 브랜치에서 돈 작업을 끌어오지 않는다.
///
/// 정렬은 최신 워크데이 우선, 같은 날은 경로순 (캐시의 정렬을 보존).
pub fn attribute_entries(
    rows: &[RangeEntry],
    direct_rels: &BTreeSet<String>,
    changed: &BTreeSet<String>,
) -> Vec<BranchEntry> {
    let mut out = Vec::new();
    for r in rows {
        let matched = r.files.iter().filter(|f| changed.contains(*f)).count() as u32;
        let link = if direct_rels.contains(&r.relative_path) {
            BranchLink::Entry
        } else if matched > 0 {
            BranchLink::Files
        } else {
            continue;
        };
        out.push(BranchEntry {
            relative_path: r.relative_path.clone(),
            workday: r.workday.clone(),
            entry_type: r.entry_type.clone(),
            status: r.status.clone(),
            agent_id: r.agent_id.clone(),
            title: r.title.clone(),
            link,
            matched_files: matched,
        });
    }
    out
}

/// 브랜치에 붙은 일지들이 **실제로 적은** 경로 (브랜치가 바꾼 것과의 교집합).
/// 기록률의 분자다 — 일지가 적었지만 이 브랜치가 안 건드린 파일은 세지 않는다.
pub fn recorded_paths(
    rows: &[RangeEntry],
    entries: &[BranchEntry],
    changed: &BTreeSet<String>,
) -> BTreeSet<String> {
    let attributed: BTreeSet<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
    let mut out = BTreeSet::new();
    for r in rows {
        if !attributed.contains(r.relative_path.as_str()) {
            continue;
        }
        for f in &r.files {
            if changed.contains(f) {
                out.insert(f.clone());
            }
        }
    }
    out
}

/// 바뀐 파일 목록 — 원장(`.oculpm/`) 자신은 뺀다. 일지가 일지를 세는 건
/// 순환이고, 기록률이 늘 100% 로 보이게 만든다.
pub fn build_files(g: &BranchGit, recorded: &BTreeSet<String>) -> Vec<BranchFile> {
    let mut out: Vec<BranchFile> = Vec::new();
    for path in g.changed_paths() {
        if path.starts_with(".oculpm/") {
            continue;
        }
        let commits = g.commit_files.get(&path).copied().unwrap_or(0);
        out.push(BranchFile {
            uncommitted: g.dirty_files.contains(&path),
            recorded: recorded.contains(&path),
            commits,
            path,
        });
    }
    // 많이 건드린 것부터 — 브랜치의 무게 중심이 위로 온다.
    out.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.path.cmp(&b.path)));
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시 읽기 (플랜 연결)
// ─────────────────────────────────────────────────────────────────────────────

/// 일지들에 걸린 플랜 항목 — plan-log 의 `journal_ref` 가 유일한 연결선이다.
/// 추측으로 잇지 않는다: 일지가 플랜을 갱신했다고 **기록된** 것만 여기 온다.
///
/// `group_changes` 는 경로마다 `LIKE '%' || ?` 를 한 번씩 돈다. 여기서는 그럴
/// 수 없다 — 브랜치 하나에 붙는 일지가 수백 건이면 그만큼의 전체 스캔이 된다.
/// 원장을 **한 번** 읽고 접합은 Rust 에서 한다.
pub async fn plan_items_for_entries(
    db: &Db,
    project_id: u32,
    entry_paths: Vec<String>,
) -> Result<Vec<BranchPlanItem>, String> {
    if entry_paths.is_empty() {
        return Ok(Vec::new());
    }
    let pid = project_id as i64;
    type LinkRow = (String, String, String, String, String, String);
    let rows: Vec<LinkRow> = db
        .conn()
        .call(move |c| -> rusqlite::Result<Vec<LinkRow>> {
            let mut stmt = c.prepare(
                "SELECT DISTINCT u.journal_ref, p.plan_id, p.title, pi.item_id, pi.title, pi.status
                 FROM oculpm_plan_item_updates u
                 JOIN oculpm_plans p
                   ON p.project_id = u.project_id AND p.plan_id = u.plan_id
                 JOIN oculpm_plan_items pi
                   ON pi.project_id = u.project_id AND pi.plan_id = u.plan_id
                  AND pi.item_id = u.item_id
                 WHERE u.project_id = ?1 AND u.journal_ref IS NOT NULL AND u.journal_ref <> ''",
            )?;
            let collected: rusqlite::Result<Vec<LinkRow>> = stmt
                .query_map(params![pid], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                })?
                .collect();
            collected
        })
        .await
        .map_err(|e| e.to_string())?;

    Ok(join_plan_links(&rows, &entry_paths))
}

/// 원장 행과 일지 경로를 잇는다 (순수). `journal_ref` 방언이 여럿이라
/// (`.oculpm/journal/<rel>` · `<rel>`) **접미사**로 맞춘다 — SQL 의
/// `LIKE '%' || ?` 와 같은 판정이다.
fn join_plan_links(
    rows: &[(String, String, String, String, String, String)],
    entry_paths: &[String],
) -> Vec<BranchPlanItem> {
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    let mut out: Vec<BranchPlanItem> = Vec::new();
    for (jref, plan_id, plan_title, item_id, item_title, status) in rows {
        let Some(rel) = entry_paths.iter().find(|p| jref.ends_with(p.as_str())) else {
            continue;
        };
        if !seen.insert((plan_id.clone(), item_id.clone())) {
            continue;
        }
        out.push(BranchPlanItem {
            plan_id: plan_id.clone(),
            plan_title: plan_title.clone(),
            item_id: item_id.clone(),
            item_title: item_title.clone(),
            status: status.clone(),
            journal_ref: rel.clone(),
        });
    }
    // 플랜별로 모아 읽히게 — 행 순서는 SQLite 가 정하므로 여기서 고정한다.
    out.sort_by(|a, b| {
        a.plan_title
            .cmp(&b.plan_title)
            .then_with(|| a.item_title.cmp(&b.item_title))
    });
    out
}

/// 창 안의 일지를 캐시에서. 이미 있는 조회를 그대로 쓴다 — 브랜치 축은 새
/// 저장소를 만들지 않는다.
pub async fn entries_in_window(
    db: &Db,
    project_id: u32,
    since: &str,
    until: &str,
) -> Result<Vec<RangeEntry>, String> {
    JournalCache::new(db)
        .range_entries(project_id, since, until)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;

//! 동료의 일지 (11-02) — 그날 일지 중 **다른 사람이 git 으로 더한 것**.
//!
//! `.oculpm/` 을 저장소에 올리는 팀이면 `git pull` 한 동료의 일지가 오늘 화면에 그대로 선다. 그런데
//! 그 줄이 누구의 일인지가 없었다 — 일지의 `agent` 는 에이전트지 사람이 아니다. 일지 파일을 **더한
//! 커밋의 작성자**가 그 사람이다. 이 기계의 `user.email` 과 다르면 동료다. 커밋 전 일지는 늘 내 것.
//! git 은 읽기만(`config` · `log`) · 네트워크 0.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use super::race::run;

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct TeamJournal {
    /// 일지 루트 기준 (`20261102/Bugs/…md`) — `JournalEntrySummary.relative_path` 와 같은 꼴.
    pub path: String,
    /// 그 일지를 더한 커밋의 작성자 이름.
    pub author: String,
}

/// `git log --diff-filter=A --name-only --format=@@<이름>\t<메일>` 출력 → 경로 → (이름, 메일).
/// 한 파일이 여러 번 더해졌으면(지웠다 다시) 가장 최근 것 — log 는 최신이 먼저다.
fn parse_log(out: &str) -> BTreeMap<String, (String, String)> {
    let mut map = BTreeMap::new();
    let mut who: Option<(String, String)> = None;
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("@@") {
            let (name, mail) = head.split_once('\t').unwrap_or((head, ""));
            who = Some((name.to_string(), mail.to_lowercase()));
        } else if let (Some(rel), Some(w)) = (line.strip_prefix(".oculpm/journal/"), &who) {
            if rel.ends_with(".md") {
                map.entry(rel.to_string()).or_insert_with(|| w.clone());
            }
        }
    }
    map
}

/// `workday`(`YYYYMMDD`) 의 일지 중 동료가 더한 것. 기록을 git 에 안 올리거나 메일을 모르면 빈 목록.
///
/// Today 가 열릴 때마다 불린다. 두 답을 기억한다 (Windows 성능 라운드 2026-11-11):
/// - `user.email` — 설정 파일들의 수정 시각이 그대로면 ([`my_email`]).
/// - `log` 의 결과 — HEAD 커밋이 그대로면. 그 일지를 더한 커밋은 HEAD 의 역사에만 있고,
///   역사는 HEAD 가 바뀌어야 바뀐다.
///
/// `log` 에 `--since` 를 붙이지는 않았다 — 일지 폴더의 날짜가 그 일지를 더한 커밋의 날짜를
/// 묶어 두지 않는다 (나중에 커밋하는 건 막을 수 없고, 리베이스·시계 어긋남이면 앞설 수도
/// 있다). 그래서 역사 전체를 걷는 비용은 HEAD 당 한 번으로 줄이는 데서 멈춘다.
pub fn teammates(root: &Path, workday: &str) -> Vec<TeamJournal> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    type Memo = HashMap<(std::path::PathBuf, String), (String, Vec<TeamJournal>)>;
    static MEMO: LazyLock<Mutex<Memo>> = LazyLock::new(Default::default);

    if workday.len() != 8 || !workday.bytes().all(|b| b.is_ascii_digit()) {
        return Vec::new();
    }
    let me = my_email(root);
    if me.is_empty() {
        return Vec::new();
    }
    let head = super::head::dot_git_for(root)
        .and_then(|g| super::head::git_dirs(&g))
        .and_then(|d| super::head::read_head(&d))
        .map(|h| format!("{}\0{me}", h.key()));
    let key = (root.to_path_buf(), workday.to_string());
    if let Some(h) = &head {
        if let Some((seen, hit)) = MEMO.lock().ok().and_then(|m| m.get(&key).cloned()) {
            if seen == *h {
                return hit;
            }
        }
    }
    let dir = format!(".oculpm/journal/{workday}");
    let Ok(out) = run(
        root,
        // `log` 가 맨 앞이어야 `safe::cmd` 가 외부 diff 를 끈다. 경로 8진수 끄기도 거기서 붙는다.
        &[
            "log",
            "--diff-filter=A",
            "--name-only",
            "--format=@@%an\t%ae",
            "--",
            &dir,
        ],
    ) else {
        return Vec::new();
    };
    let found: Vec<TeamJournal> = parse_log(&out)
        .into_iter()
        .filter(|(_, (_, mail))| !mail.is_empty() && *mail != me)
        .map(|(path, (author, _))| TeamJournal { path, author })
        .collect();
    if let (Some(h), Ok(mut m)) = (head, MEMO.lock()) {
        m.insert(key, (h, found.clone()));
    }
    found
}

/// 이 기계의 `user.email` (소문자). 저장소 설정 · 사용자 전역 설정 파일의 수정 시각이
/// 그대로이고 5분이 안 지났으면 지난 답을 쓴다 — 5분은 `include.path` 처럼 시각을 못 보는
/// 파일 몫이다.
fn my_email(root: &Path) -> String {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant, SystemTime};
    type Stamp = Vec<Option<SystemTime>>;
    static MEMO: LazyLock<Mutex<HashMap<std::path::PathBuf, (Instant, Stamp, String)>>> =
        LazyLock::new(Default::default);
    const TTL: Duration = Duration::from_secs(300);
    let mtime = |p: std::path::PathBuf| std::fs::metadata(p).ok()?.modified().ok();
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(std::path::PathBuf::from);
    let xdg = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".config")));
    let stamp: Stamp = vec![
        super::head::dot_git_for(root)
            .and_then(|g| super::head::git_dirs(&g))
            .and_then(|d| mtime(d.common_dir.join("config"))),
        home.as_ref().and_then(|h| mtime(h.join(".gitconfig"))),
        xdg.and_then(|x| mtime(x.join("git").join("config"))),
    ];
    let now = Instant::now();
    if let Some((at, seen, me)) = MEMO.lock().ok().and_then(|m| m.get(root).cloned()) {
        if now.duration_since(at) < TTL && seen == stamp {
            return me;
        }
    }
    let me = run(root, &["config", "user.email"])
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if let Ok(mut m) = MEMO.lock() {
        m.insert(root.to_path_buf(), (now, stamp, me.clone()));
    }
    me
}

#[cfg(test)]
#[path = "authors_tests.rs"]
mod tests;

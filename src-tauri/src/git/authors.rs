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
pub fn teammates(root: &Path, workday: &str) -> Vec<TeamJournal> {
    if workday.len() != 8 || !workday.bytes().all(|b| b.is_ascii_digit()) {
        return Vec::new();
    }
    let me = run(root, &["config", "user.email"])
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if me.is_empty() {
        return Vec::new();
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
    parse_log(&out)
        .into_iter()
        .filter(|(_, (_, mail))| !mail.is_empty() && *mail != me)
        .map(|(path, (author, _))| TeamJournal { path, author })
        .collect()
}

#[cfg(test)]
#[path = "authors_tests.rs"]
mod tests;

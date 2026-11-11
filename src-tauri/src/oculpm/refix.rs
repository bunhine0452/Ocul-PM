//! 「재수정 경고」 (11-02) — 최근 버그를 고친 파일을 다시 고치기 **직전**, 에이전트에게 그 버그와
//! 그때의 확인 명령을 들려준다.
//!
//! 버그 일지의 47% 가 7일 안에 같은 파일을 다시 고쳤다(10-27 실측, `docs/PROMISE.md`). 같은 자리를
//! 다시 깨뜨리는 가장 흔한 길은 지난번에 무엇이 깨졌고 무엇으로 확인했는지를 모르는 것이다.
//! 플러그인 PreToolUse 훅이 `oculpm-mcp hook pre-tool-use` (`mcp::hook`)로 이 모듈을 부르고,
//! `.oculpm/journal/` 을 **디스크에서** 읽어 답한다 — 앱이 꺼져 있어도 · LLM 0 · 네트워크 0.
//! 막지 않는다: 짚기만 한다(`additionalContext`). 한 대화에서 같은 파일은 한 번만.
//!
//! ```text
//! oculpm-mcp refix --root <dir> --file <path> [--conversation <id>] [--days 7]
//!   stdout  PreToolUse 훅 JSON (경고가 있을 때만) · exit 0 (실패도 무해)
//! ```

use std::path::{Component, Path, PathBuf};

use chrono::{Local, NaiveDate};

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::spec::EntryType;

/// 경고 한 건 — 그 파일을 고친 최근 버그 일지.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    /// `.oculpm/journal/` 기준.
    pub journal: String,
    pub title: String,
    pub day: NaiveDate,
    /// 그 일지 검증 칸의 첫 `코드` — 그때 돌린 확인 명령.
    pub check: Option<String>,
}

const SHOWN: usize = 3;

/// 훅이 준 경로(절대 · 상대 · Windows 역슬래시) → 프로젝트 기준 `a/b.ts`. 프로젝트 밖이면 `None`.
pub fn project_rel(root: &Path, file: &str) -> Option<String> {
    let file = file.replace('\\', "/");
    let p = PathBuf::from(&file);
    let rel = if p.is_absolute() {
        let canon_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        // 새 파일(Write)은 아직 없다 — 있는 부모까지만 정규화한다.
        let canon = match (
            p.parent().and_then(|d| std::fs::canonicalize(d).ok()),
            p.file_name(),
        ) {
            (Some(d), Some(n)) => d.join(n),
            _ => p.clone(),
        };
        canon
            .strip_prefix(&canon_root)
            .or_else(|_| p.strip_prefix(root))
            .ok()?
            .to_path_buf()
    } else {
        p
    };
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let s = rel.to_string_lossy().replace('\\', "/");
    (!s.is_empty() && !s.starts_with(".oculpm/")).then_some(s)
}

/// 최근 `days` 일(오늘 포함)의 버그 일지 중 `rel` 을 고친 것, 최신 먼저 `SHOWN` 개.
pub fn find(root: &Path, rel: &str, today: NaiveDate, days: i64) -> Vec<Hit> {
    let journal = root.join(".oculpm").join("journal");
    let Ok(read) = std::fs::read_dir(&journal) else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    for day_dir in read.flatten() {
        let name = day_dir.file_name().to_string_lossy().to_string();
        let Ok(day) = NaiveDate::parse_from_str(&name, "%Y%m%d") else {
            continue;
        };
        let age = (today - day).num_days();
        if !(0..days).contains(&age) {
            continue;
        }
        for md in markdown_files(&day_dir.path()) {
            let Ok(text) = std::fs::read_to_string(&md) else {
                continue;
            };
            let (fm, body) = parse_frontmatter_and_body(&text);
            let Some(fm) = fm.parsed else { continue };
            if fm.entry_type != EntryType::Bug || !fm.files_touched.iter().any(|f| f.path == rel) {
                continue;
            }
            let journal_rel = md
                .strip_prefix(&journal)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            hits.push(Hit {
                journal: journal_rel,
                title: title_of(&body).unwrap_or_else(|| fm.slug.clone()),
                day,
                check: check_of(&body),
            });
        }
    }
    hits.sort_by(|a, b| b.journal.cmp(&a.journal));
    hits.truncate(SHOWN);
    hits
}

fn markdown_files(day: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for kind in std::fs::read_dir(day).into_iter().flatten().flatten() {
        let p = kind.path();
        if p.is_dir() && !kind.file_type().is_ok_and(|t| t.is_symlink()) {
            for f in std::fs::read_dir(&p).into_iter().flatten().flatten() {
                let fp = f.path();
                if fp.extension().is_some_and(|e| e == "md") {
                    out.push(fp);
                }
            }
        }
    }
    out
}

/// 본문 첫 줄 — `[x] 영역: 무엇을 했다` (체크박스 · `# ` 는 뗀다).
fn title_of(body: &str) -> Option<String> {
    let line = body.lines().map(str::trim).find(|l| !l.is_empty())?;
    let t = ["[x] ", "[X] ", "[ ] ", "# "]
        .iter()
        .find_map(|p| line.strip_prefix(p))
        .unwrap_or(line)
        .trim();
    (!t.is_empty() && !t.starts_with("## ")).then(|| t.to_string())
}

/// 검증 칸(`## 검증` · `## Verification`)의 첫 인라인 코드.
fn check_of(body: &str) -> Option<String> {
    let mut inside = false;
    for line in body.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            let h = h.trim().to_lowercase();
            inside = h.starts_with("검증") || h.starts_with("verification");
            continue;
        }
        if !inside {
            continue;
        }
        let mut parts = line.split('`');
        parts.next();
        if let Some(code) = parts.next().filter(|c| !c.trim().is_empty()) {
            return Some(code.trim().to_string());
        }
    }
    None
}

/// 에이전트에게 들려줄 전문.
pub fn message(rel: &str, hits: &[Hit]) -> String {
    let mut s = format!(
        "oculpm 재수정 경고: {rel} 은 최근 버그 수정에서 고친 파일입니다. 같은 자리를 다시 깨뜨리지 않게 먼저 보세요."
    );
    for h in hits {
        s.push_str(&format!(
            "\n- {} {} (.oculpm/journal/{})",
            h.day.format("%m-%d"),
            h.title,
            h.journal
        ));
        if let Some(c) = &h.check {
            s.push_str(&format!(" — 그때 확인 명령: `{c}`"));
        }
    }
    s.push_str("\n고친 뒤 위 확인 명령을 다시 돌려 그 버그가 돌아오지 않았는지 보세요. 관련 없는 수정이면 이 안내는 무시해도 됩니다.");
    s
}

/// 훅이 stdout 으로 내는 JSON — Claude Code PreToolUse 의 `additionalContext`.
pub fn hook_json(msg: &str) -> String {
    serde_json::json!({
        "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": msg }
    })
    .to_string()
}

/// 한 대화에서 같은 파일은 한 번만 — `.oculpm/hooks/.refix-<대화>` 에 경고한 파일을 적어 둔다.
fn first_time(root: &Path, conversation: &str, rel: &str) -> bool {
    let safe = conversation
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if conversation.is_empty() || !safe {
        return true;
    }
    let dir = root.join(".oculpm").join("hooks");
    if dir.is_symlink() || std::fs::create_dir_all(&dir).is_err() {
        return true;
    }
    let marker = dir.join(format!(".refix-{conversation}"));
    if marker.is_symlink() {
        return true;
    }
    let seen = std::fs::read_to_string(&marker).unwrap_or_default();
    if seen.lines().any(|l| l == rel) {
        return false;
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&marker)
    {
        let _ = writeln!(f, "{rel}");
    }
    true
}

pub fn run(args: &[String]) -> i32 {
    let (mut root, mut file, mut conversation, mut days) = (None, None, String::new(), 7i64);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--file" => file = it.next().cloned(),
            "--conversation" => conversation = it.next().cloned().unwrap_or_default(),
            "--days" => days = it.next().and_then(|d| d.parse().ok()).unwrap_or(7),
            _ => return 0,
        }
    }
    let (Some(root), Some(file)) = (root, file) else {
        return 0;
    };
    if let Some(json) = warning(&root, &file, &conversation, days) {
        println!("{json}");
    }
    0
}

/// 판단 한 자리 — `refix` 서브커맨드와 PreToolUse 훅(`oculpm-mcp hook pre-tool-use`,
/// `mcp::hook`)이 같이 부른다. 경고할 것이 있으면 훅 JSON, 없으면 `None`.
pub fn warning(root: &Path, file: &str, conversation: &str, days: i64) -> Option<String> {
    if !root.join(".oculpm").is_dir() {
        return None;
    }
    let rel = project_rel(root, file)?;
    let hits = find(root, &rel, Local::now().date_naive(), days);
    if hits.is_empty() || !first_time(root, conversation.trim(), &rel) {
        return None;
    }
    Some(hook_json(&message(&rel, &hits)))
}

#[cfg(test)]
#[path = "refix_tests.rs"]
mod tests;

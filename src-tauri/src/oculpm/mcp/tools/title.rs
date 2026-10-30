//! 일지 제목 규격 — 「영역: 무엇을 했다」 (사용자 결정 2026-10-30).
//!
//! 이 저장소의 일지 934건 중 47% 가 「40자 안」 안내를 넘었고, 절반이 줄표(—)로 두 문장을 이어 붙였다.
//! 안내만으로는 지켜지지 않아 `journal_write` 가 **거절**한다. 거절 문구는 그대로 고쳐 다시 부를 수 있게
//! 무엇이 틀렸는지와 예시, 이 프로젝트가 이미 쓰는 영역을 함께 돌려준다.
//!
//! - 영역은 제목 앞 `영역: ` 으로 쓰거나 `area` 인자로 준다(둘 다 주면 같아야 한다). 1~12자, 콜론 없음.
//! - 제목 전체 40자 안, 줄표(— –)로 잇지 않는다 — 자세한 것은 본문에.
//! - 영역은 태그로도 남는다(호출 쪽이 붙인다) — 영역별로 모아 보는 길이 태그 필터다.

use std::path::Path;

use serde_json::Value;

/// 제목 전체 글자 수 상한 (영역 포함).
pub const TITLE_MAX: usize = 40;
/// 영역 글자 수 상한.
pub const AREA_MAX: usize = 12;
/// 거절 문구에 싣는 기존 영역 수.
const KNOWN_AREAS_SHOWN: usize = 8;

/// 규격에 맞춘 제목과 그 영역.
#[derive(Debug, PartialEq, Eq)]
pub struct CheckedTitle {
    pub title: String,
    pub area: String,
}

/// `title`(+ 선택 `area`) 인자를 규격대로 맞추거나, 고칠 말을 담은 오류를 돌려준다.
/// `en` 은 프로젝트의 규칙 언어(`agents.template_language == "en"`) — 거절 문구의 언어다.
pub fn checked_title(root: &Path, args: &Value, en: bool) -> Result<CheckedTitle, String> {
    let raw = args
        .get("title")
        .and_then(Value::as_str)
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
        .ok_or("'title' is required")?;
    let area_arg = args
        .get("area")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let (area, rest) = match (split_area(&raw), area_arg) {
        (Some((a, _)), Some(given)) if a != given => {
            return Err(reject(
                root,
                en,
                &if en {
                    format!("the title's area 「{a}」 and the `area` argument 「{given}」 differ — use one area")
                } else {
                    format!(
                        "제목의 영역 「{a}」 와 `area` 인자 「{given}」 가 달라요 — 영역은 하나만"
                    )
                },
            ));
        }
        (Some((a, r)), _) => (a.to_string(), r.to_string()),
        (None, Some(given)) => (given.to_string(), raw.clone()),
        (None, None) => {
            return Err(reject(
                root,
                en,
                &if en {
                    format!("「{raw}」 has no area — write `area: what changed`")
                } else {
                    format!("「{raw}」 에 영역이 없어요 — `영역: 무엇을 했다` 로")
                },
            ));
        }
    };

    let area_len = area.chars().count();
    if area_len > AREA_MAX || area.contains(':') {
        return Err(reject(
            root,
            en,
            &if en {
                format!("area 「{area}」 must be 1–{AREA_MAX} characters without a colon")
            } else {
                format!("영역 「{area}」 은 1~{AREA_MAX}자, 콜론 없이")
            },
        ));
    }
    if rest.is_empty() {
        return Err(reject(
            root,
            en,
            if en {
                "nothing after the area — say what changed"
            } else {
                "영역 뒤에 한 일이 없어요"
            },
        ));
    }
    if rest.contains('—') || rest.contains('–') {
        return Err(reject(
            root,
            en,
            if en {
                "don't join two phrases with a dash (— –) — one sentence, details go in the body"
            } else {
                "줄표(— –)로 두 문장을 잇지 말 것 — 한 문장으로, 자세한 것은 본문에"
            },
        ));
    }
    let title = format!("{area}: {rest}");
    let n = title.chars().count();
    if n > TITLE_MAX {
        return Err(reject(
            root,
            en,
            &if en {
                format!("{n} characters — keep the whole title within {TITLE_MAX}; details go in the body")
            } else {
                format!("{n}자예요 — 제목 전체를 {TITLE_MAX}자 안으로, 자세한 것은 본문에")
            },
        ));
    }
    Ok(CheckedTitle { title, area })
}

/// 영역을 첫 태그로 — 태그 필터가 곧 영역별 보기다. 이미 있으면 그대로.
pub fn lead_with_area_tag(tags: &mut Vec<String>, area: &str) {
    let tag = crate::oculpm::tags::normalize_tag(area);
    if !tag.is_empty() && !tags.contains(&tag) {
        tags.insert(0, tag);
    }
}

/// `영역: 나머지` 로 갈린다면 (영역, 나머지). 영역 자리에 콜론이 여럿이면 첫 것.
fn split_area(title: &str) -> Option<(&str, &str)> {
    let (a, r) = title.split_once(": ")?;
    let a = a.trim();
    (!a.is_empty() && a.chars().count() <= AREA_MAX).then(|| (a, r.trim()))
}

fn reject(root: &Path, en: bool, why: &str) -> String {
    let known = known_areas(root);
    let (head, example, reuse) = if en {
        (
            "journal title rejected",
            "Format: `area: what changed`, within 40 characters (e.g. `terminal: show Claude's status`, `CI: fix the Linux smoke window name`)",
            "Areas this project already uses",
        )
    } else {
        (
            "일지 제목을 받지 않았어요",
            "형식: `영역: 무엇을 했다`, 40자 안 (예: `터미널: Claude 상태를 안다`, `CI: 리눅스 스모크 창 이름 고침`)",
            "이 프로젝트가 이미 쓰는 영역",
        )
    };
    let mut out = format!("{head} — {why}. {example}.");
    if !known.is_empty() {
        out.push_str(&format!(" {reuse}: {}.", known.join(", ")));
    }
    out
}

/// 이미 쓴 일지 제목들의 영역을 많이 쓴 순으로. 거절할 때만 읽는다 (디스크, 최근 300건).
fn known_areas(root: &Path) -> Vec<String> {
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    let Ok(days) = std::fs::read_dir(root.join(".oculpm").join("journal")) else {
        return Vec::new();
    };
    let mut days: Vec<_> = days.flatten().map(|d| d.path()).collect();
    days.sort();
    for day in days.iter().rev() {
        for folder in std::fs::read_dir(day).into_iter().flatten().flatten() {
            for f in std::fs::read_dir(folder.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                if f.path().extension().is_some_and(|e| e == "md") {
                    files.push(f.path());
                }
            }
        }
        if files.len() >= 300 {
            break;
        }
    }
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        let Some(first) = text
            .splitn(3, "---\n")
            .nth(2)
            .and_then(|b| b.lines().next())
        else {
            continue;
        };
        // 첫 줄은 `[x] 제목` — 글리프 칸(`[`, 글리프 하나, `]`)을 벗긴다.
        let title = first
            .strip_prefix('[')
            .and_then(|s| s.get(2..))
            .map_or(first, str::trim_start);
        if let Some((a, _)) = split_area(title) {
            *counts.entry(a.to_string()).or_default() += 1;
        }
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.into_iter()
        .take(KNOWN_AREAS_SHOWN)
        .map(|(a, _)| a)
        .collect()
}

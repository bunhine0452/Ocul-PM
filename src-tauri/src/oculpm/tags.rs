//! 프로젝트 **태그 어휘** — 정규화·사전·유사 판정 (플랜 `journal-scale-round`
//! {#tag-normalize} · {#tag-merge}).
//!
//! # 왜 있는가
//!
//! 이 저장소(2026-09-21)는 일지 727건에 태그 **806종**, 그중 **437종이 1회용**
//! 이다. 에이전트는 매 호출마다 새 어휘를 지어내고(`ime-bug`, `ime_bug`,
//! `IME-버그`, `ime-bugs`), 그래서 태그 필터는 "누르면 1건 나오는 버튼 437개"
//! 가 됐다. 태그가 많은 게 문제가 아니라 **같은 것을 다르게 부르는 것**이
//! 문제다.
//!
//! # 두 갈래로 고친다
//!
//! * **정규화**(`normalize_tag`)는 **강제**한다. 대소문자·공백·밑줄·구두점은
//!   의미를 담지 않는 표기 차이라 기계가 정해도 잃는 게 없다.
//! * **유사 태그**(`suggest_similar`)는 **제안만** 한다. `bug` 와 `bugs`,
//!   `i18n` 과 `i18n-ko` 가 같은 것인지 다른 것인지는 뜻의 문제고, 기계가
//!   틀리면 조용히 기록을 왜곡한다. `journal_write` 는 힌트를 응답에 실어
//!   에이전트가 **다음 호출에** 반영하게 하고, 사람은 「태그 정리」 시트에서
//!   눈으로 보고 병합한다.
//!
//! 출처 표식(`SOURCE_MARKER_TAGS` — 지금은 `mcp-tool`)은 어휘가 아니라 기록
//! 경로의 표식이라 사전·제안·통계 어디에도 끼지 않는다 ({#tag-source-marker}).

use std::collections::HashMap;

use serde::Serialize;
use specta::Type;

use crate::oculpm::spec::SOURCE_MARKER_TAGS;

/// 사전에 오르는 최소 빈도. 2회는 우연이 겹친 것일 수 있고, 3회부터는 "이
/// 프로젝트가 실제로 쓰는 말"이라고 볼 만하다.
pub const DICTIONARY_MIN_COUNT: u32 = 3;
/// 사전 크기 상한. 사전은 **매 `journal_write` 마다** 전부 훑는 대상이고,
/// 상한 없는 목록은 상한이 아니다. 빈도 내림차순으로 자르므로 잘리는 쪽은
/// 언제나 가장 덜 쓰는 말이다.
pub const DICTIONARY_MAX: usize = 300;
/// 편집거리 판정을 켜는 최소 길이. 짧은 말(`ui` ↔ `ux`, `ko` ↔ `en`)은 한 글자
/// 차이가 곧 **다른 뜻**이라 오탐만 낸다.
pub const TYPO_MIN_LEN: usize = 5;

/// `journal_write` 응답의 `tag_hints` 한 줄. 치환은 하지 않는다 — 에이전트가
/// 다음 호출에 반영할 재료다.
///
/// MCP 응답(JSON)에만 쓰이므로 `specta::Type` 은 없다 — 프런트는 이 값을 보지
/// 않는다 (커맨드가 아니라 도구의 응답이다).
#[derive(Debug, Clone, Serialize)]
pub struct TagHint {
    /// 에이전트가 **준 그대로**의 태그. 정규화 결과가 아니라 원문이라야
    /// 자기가 무엇을 보냈는지 알아본다.
    pub given: String,
    /// 이 프로젝트가 이미 쓰는 말.
    pub suggest: String,
    /// `plural` · `typo` · `prefix` — 왜 닮았다고 봤는가.
    pub reason: String,
}

/// 「태그 정리」 시트의 한 줄 ({#tag-merge}).
#[derive(Debug, Clone, Serialize, Type)]
pub struct TagStat {
    pub tag: String,
    pub count: u32,
    /// 이 태그가 붙은 가장 최근 일지의 workday (YYYYMMDD).
    pub last_workday: String,
    /// 사전의 어느 말로 모을 만한가. 근거를 못 대면 `None` 이다.
    pub suggest_into: Option<String>,
}

/// 병합 한 번의 결과. 실패한 파일은 **건너뛰고 이름을 댄다** — 한 건이 막혔다고
/// 나머지를 되돌리면 사용자는 아무것도 못 고친다.
#[derive(Debug, Clone, Serialize, Type)]
pub struct TagMergeReport {
    pub rewritten: u32,
    pub skipped: Vec<TagMergeSkip>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct TagMergeSkip {
    /// `.oculpm/journal/` 기준 상대경로.
    pub path: String,
    /// 기계가 읽는 사유 토큰 — 문장은 화면이 만든다 (영어 모드로 새지 않게).
    pub reason: String,
}

/// 표기 차이를 지운다. **뜻은 건드리지 않는다.**
///
/// 순서가 중요하다: 구두점을 먼저 털면 `c++` 의 꼬리가 사라지고 나서 공백
/// 치환이 할 일이 없다. 그래서 (1) 공백·밑줄 → 하이픈, (2) 소문자,
/// (3) 앞뒤 구두점 제거, (4) 연속 하이픈 접기 순이다.
///
/// 한글은 `to_lowercase()` 가 손대지 않으므로 그대로 남는다 — 「일지」와
/// 「일지」가 갈라질 일은 없고, 한글 태그를 로마자로 바꾸는 짓도 하지 않는다.
pub fn normalize_tag(raw: &str) -> String {
    let mapped: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_whitespace() || c == '_' {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .to_lowercase();

    // 앞뒤의 구두점 — 하이픈도 여기서 같이 털린다 (`-bug-` → `bug`).
    let trimmed = mapped.trim_matches(|c: char| c.is_ascii_punctuation());

    // 연속 하이픈 접기. `bug  fix` → `bug--fix` → `bug-fix`.
    let mut out = String::with_capacity(trimmed.len());
    let mut prev_dash = false;
    for c in trimmed.chars() {
        if c == '-' {
            if !prev_dash {
                out.push('-');
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    out
}

/// 출처 표식인가 — 사전·통계·병합 어디에도 끼지 않는다.
pub fn is_source_marker(tag: &str) -> bool {
    SOURCE_MARKER_TAGS.contains(&tag)
}

/// 빈도 표 → **카노니컬 사전**. 빈도 내림차순, 동점은 사전순(결정적).
///
/// 입력 키는 정규화 전이어도 된다 — 여기서 정규화하고 합산한다. 그래야
/// `Bug` 3건 + `bug` 2건이 "5건짜리 `bug`" 하나로 보인다.
pub fn build_dictionary(raw_counts: &HashMap<String, u32>) -> Vec<String> {
    let mut merged: HashMap<String, u32> = HashMap::new();
    for (tag, n) in raw_counts {
        let norm = normalize_tag(tag);
        if norm.is_empty() || is_source_marker(&norm) {
            continue;
        }
        *merged.entry(norm).or_insert(0) += *n;
    }
    let mut kept: Vec<(String, u32)> = merged
        .into_iter()
        .filter(|(_, n)| *n >= DICTIONARY_MIN_COUNT)
        .collect();
    kept.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    kept.truncate(DICTIONARY_MAX);
    kept.into_iter().map(|(t, _)| t).collect()
}

/// 이 태그를 사전의 어느 말로 모을 만한가 — `(카노니컬, 사유)`.
///
/// 사전에 **이미 있는** 말이면 `None` 이다 (모을 데가 없다). 판정 순서는
/// 확신이 큰 것부터: 단복수 → 오타 → 접두 분리. 접두는 가장 **긴** 접두부터
/// 본다 — 사전에 `i18n` 과 `i18n-ko` 가 다 있으면 `i18n-ko-overflow` 는
/// 가까운 쪽으로 모이는 게 맞다.
///
/// `tag` 는 **정규화된** 값이어야 한다.
pub fn suggest_similar(tag: &str, dictionary: &[String]) -> Option<(String, &'static str)> {
    if tag.is_empty() || is_source_marker(tag) {
        return None;
    }
    if dictionary.iter().any(|d| d == tag) {
        return None;
    }

    if let Some(hit) = dictionary.iter().find(|d| is_plural_pair(tag, d)) {
        return Some((hit.clone(), "plural"));
    }

    if tag.chars().count() >= TYPO_MIN_LEN {
        if let Some(hit) = dictionary
            .iter()
            .find(|d| d.chars().count() >= TYPO_MIN_LEN && within_one_edit(tag, d))
        {
            return Some((hit.clone(), "typo"));
        }
    }

    // 가장 긴 접두부터. `rmatch_indices` 가 오른쪽부터 주므로 그대로 쓴다.
    for (i, _) in tag.rmatch_indices('-') {
        let prefix = &tag[..i];
        if prefix.chars().count() < 2 {
            continue;
        }
        if let Some(hit) = dictionary.iter().find(|d| d.as_str() == prefix) {
            return Some((hit.clone(), "prefix"));
        }
    }

    None
}

/// 한쪽이 다른 쪽에 `s` 만 붙인 꼴인가 (`bug` ↔ `bugs`).
fn is_plural_pair(a: &str, b: &str) -> bool {
    let (short, long) = if a.len() < b.len() { (a, b) } else { (b, a) };
    short.len() + 1 == long.len() && long.ends_with('s') && long.starts_with(short)
}

/// 편집거리(삽입·삭제·치환) 1 이하인가. 글자 단위라 한글도 옳게 센다.
///
/// 전체 DP 를 돌리지 않는 이유는 상한이 1 이기 때문이다 — 길이 차가 2 이상이면
/// 볼 것도 없고, 그 밖에는 한 번 어긋난 뒤 나머지가 같은지만 보면 된다.
fn within_one_edit(a: &str, b: &str) -> bool {
    if a == b {
        return false; // "같다" 는 오타가 아니다 — 호출부가 이미 걸렀다.
    }
    let av: Vec<char> = a.chars().collect();
    let bv: Vec<char> = b.chars().collect();
    let (short, long) = if av.len() <= bv.len() {
        (&av, &bv)
    } else {
        (&bv, &av)
    };
    if long.len() - short.len() > 1 {
        return false;
    }

    let mut i = 0;
    let mut j = 0;
    let mut budget = 1;
    while i < short.len() && j < long.len() {
        if short[i] == long[j] {
            i += 1;
            j += 1;
            continue;
        }
        if budget == 0 {
            return false;
        }
        budget -= 1;
        if short.len() == long.len() {
            i += 1; // 치환
        }
        j += 1; // 삽입/삭제
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_erases_spelling_not_meaning() {
        assert_eq!(normalize_tag("  Bug Fix "), "bug-fix");
        assert_eq!(normalize_tag("bug_fix"), "bug-fix");
        assert_eq!(normalize_tag("BUG--FIX"), "bug-fix");
        assert_eq!(normalize_tag("#bug-fix!"), "bug-fix");
        assert_eq!(normalize_tag("-bug-"), "bug");
        // 한글은 그대로. 공백만 하이픈이 된다.
        assert_eq!(normalize_tag("일지 규모"), "일지-규모");
        assert_eq!(normalize_tag("터미널"), "터미널");
        // 구두점만인 태그는 사라진다 (호출부가 빈 값을 버린다).
        assert_eq!(normalize_tag("!!!"), "");
        assert_eq!(normalize_tag(""), "");
    }

    #[test]
    fn dictionary_keeps_only_words_the_project_actually_uses() {
        let counts: HashMap<String, u32> = [
            ("bug".to_string(), 2),
            ("Bug".to_string(), 2), // 합쳐서 4 — 문턱을 넘는다
            ("i18n".to_string(), 9),
            ("once".to_string(), 1),
            ("mcp-tool".to_string(), 700), // 출처 표식은 어휘가 아니다
        ]
        .into_iter()
        .collect();
        assert_eq!(build_dictionary(&counts), vec!["i18n", "bug"]);
    }

    #[test]
    fn dictionary_is_capped_and_deterministic() {
        let counts: HashMap<String, u32> = (0..DICTIONARY_MAX + 50)
            .map(|i| (format!("tag-{i:04}"), DICTIONARY_MIN_COUNT))
            .collect();
        let dict = build_dictionary(&counts);
        assert_eq!(dict.len(), DICTIONARY_MAX);
        // 동점이면 사전순 — 같은 입력에 같은 답.
        assert_eq!(dict[0], "tag-0000");
    }

    #[test]
    fn plural_and_typo_and_prefix_each_have_a_reason() {
        let dict = vec![
            "bug".to_string(),
            "i18n".to_string(),
            "terminal".to_string(),
        ];
        assert_eq!(
            suggest_similar("bugs", &dict),
            Some(("bug".to_string(), "plural"))
        );
        // 한 글자 빠진 것은 잡지만, 자리가 바뀐 것(`termianl`)은 편집거리 2 라
        // 안 잡는다 — Damerau 가 아니라 Levenshtein 이다.
        assert_eq!(
            suggest_similar("termnal", &dict),
            Some(("terminal".to_string(), "typo"))
        );
        assert_eq!(suggest_similar("termianl", &dict), None);
        assert_eq!(
            suggest_similar("i18n-ko", &dict),
            Some(("i18n".to_string(), "prefix"))
        );
    }

    #[test]
    fn a_word_already_in_the_dictionary_needs_no_suggestion() {
        let dict = vec!["bug".to_string()];
        assert_eq!(suggest_similar("bug", &dict), None);
        assert_eq!(suggest_similar("mcp-tool", &dict), None);
        assert_eq!(suggest_similar("", &dict), None);
    }

    #[test]
    fn short_words_are_not_typos_of_each_other() {
        // `ui` ↔ `ux` 는 한 글자 차이지만 다른 뜻이다 — TYPO_MIN_LEN 이 막는다.
        let dict = vec!["ui".to_string(), "acp".to_string()];
        assert_eq!(suggest_similar("ux", &dict), None);
        assert_eq!(suggest_similar("dap", &dict), None);
    }

    #[test]
    fn edit_distance_counts_characters_not_bytes() {
        let dict = vec!["일지-규모".to_string()];
        // 한 글자만 다르다 (규 → 유). 바이트로 세면 3 이 나와 놓친다.
        assert_eq!(
            suggest_similar("일지-유모", &dict),
            Some(("일지-규모".to_string(), "typo"))
        );
    }

    #[test]
    fn longest_prefix_wins() {
        let dict = vec!["i18n".to_string(), "i18n-ko".to_string()];
        assert_eq!(
            suggest_similar("i18n-ko-overflow", &dict),
            Some(("i18n-ko".to_string(), "prefix"))
        );
    }

    #[test]
    fn one_edit_boundaries() {
        assert!(within_one_edit("terminal", "termnal")); // 삭제
        assert!(within_one_edit("terminal", "terminals")); // 삽입
        assert!(within_one_edit("terminal", "termanal")); // 치환
        assert!(!within_one_edit("terminal", "termnl")); // 둘
        assert!(!within_one_edit("terminal", "terminal")); // 같음
    }
}

//! 결정적 롤업 생성기 — **LLM 없이도 항상 돌아가는 쪽** (`{#rollup-weekly}`).
//!
//! `commands/summary.rs` 의 `deterministic_markdown` 과 같은 규율이다: 키가
//! 없거나 호출이 실패하면 이것이 **최종 산출물**이라, "LLM 이 채워 줄 것"을
//! 전제로 빈칸을 남기지 않는다. 다섯 섹션 전부를 일지에서 직접 만든다.
//!
//! # 「결정」은 어떻게 고르는가
//!
//! 본문을 문장으로 잘라 결정 표지어가 든 문장만 남긴다. 요약이 아니라
//! **인용**이다 — 결정적 경로가 할 수 있는 정직한 일은 "이 주에 이런 문장이
//! 적혔다" 까지고, 그걸 새 문장으로 바꾸려는 순간 근거 없는 말이 섞인다.
//! LLM 경로는 같은 자리를 요약으로 채운다.
//!
//! 표지어는 한국어·영어 양쪽을 본다. 일지 언어는 프로젝트마다 다르고
//! (`frontmatter.language`), 한 저장소 안에서도 섞인다.

use std::collections::BTreeMap;

use crate::oculpm::cache::RollupSourceEntry;

/// 「결정」 섹션에 실을 인용 상한. 넘치면 잘라 내고 꼬리를 한 줄로 밝힌다.
const DECISION_CAP: usize = 10;
/// 인용 한 줄의 길이 상한 (문자 수). 롤업은 **읽히려고** 있는 층이다.
const QUOTE_CHARS: usize = 160;
/// 「한 주 요약」이 이름을 대는 파일 수.
const TOP_FILES: usize = 3;

/// 결정 표지어. 한국어는 어간까지만 잡아 활용형을 모두 덮는다
/// (`결정했다`/`결정한다`/`결정` → `결정`).
const DECISION_MARKERS: &[&str] = &[
    "결정",
    "기각",
    "대신",
    "채택",
    "택했",
    "포기하고",
    "decided",
    "decision",
    "instead of",
    "rejected",
    "chose",
];

/// 섹션 제목 — **온디스크 규격**이라 UI 언어를 따르지 않는다.
///
/// 일지의 `## 검증` 과 같은 성격이다: 파일은 저장소에 커밋돼 사람과 다른
/// 도구가 읽고, 프로젝트의 UI 언어 설정이 바뀌었다고 지난주 파일의 헤더가
/// 달라지면 그 파일을 파싱하던 모든 것이 깨진다.
pub const SECTION_SUMMARY: &str = "## 한 주 요약";
pub const SECTION_DECISIONS: &str = "## 결정";
pub const SECTION_FIXED: &str = "## 해결한 결함";
pub const SECTION_FEATURES: &str = "## 추가한 기능";
pub const SECTION_CARRIED: &str = "## 이월/미완";

/// 결정적 본문 한 판. frontmatter 는 호출자가 앞에 붙인다.
pub fn deterministic_body(
    week: &str,
    from: &str,
    to: &str,
    entries: &[RollupSourceEntry],
) -> String {
    let mut out = format!("# {week} 주간 요약\n\n{SECTION_SUMMARY}\n\n");
    out.push_str(&summary_paragraph(week, from, to, entries));
    out.push_str("\n\n");

    out.push_str(SECTION_DECISIONS);
    out.push('\n');
    let decisions = decision_quotes(entries);
    if decisions.is_empty() {
        out.push_str("- (본문에서 결정 문장을 찾지 못했어요)\n");
    } else {
        for line in decisions.iter().take(DECISION_CAP) {
            out.push_str(line);
            out.push('\n');
        }
        if decisions.len() > DECISION_CAP {
            out.push_str(&format!(
                "- … 외 {}개 (원본 일지에서 확인하세요)\n",
                decisions.len() - DECISION_CAP
            ));
        }
    }

    out.push_str(&titled_list(
        SECTION_FIXED,
        entries,
        &["bug", "error"],
        true,
        "- (해결한 결함 기록이 없어요)",
    ));
    out.push_str(&titled_list(
        SECTION_FEATURES,
        entries,
        &["feature"],
        false,
        "- (추가한 기능 기록이 없어요)",
    ));

    out.push('\n');
    out.push_str(SECTION_CARRIED);
    out.push('\n');
    let carried: Vec<&RollupSourceEntry> = entries.iter().filter(|e| e.status != "done").collect();
    if carried.is_empty() {
        out.push_str("- (이 주의 일지는 모두 done 이에요)\n");
    } else {
        for e in &carried {
            out.push_str(&format!(
                "- [{}] {} — `{}`\n",
                e.status,
                clamp(&e.title, QUOTE_CHARS),
                e.relative_path
            ));
        }
    }
    out
}

/// 「한 주 요약」 3~6 문장. 전부 **세어서 나오는 사실**이다.
fn summary_paragraph(week: &str, from: &str, to: &str, entries: &[RollupSourceEntry]) -> String {
    if entries.is_empty() {
        return format!("{week} 주({from}~{to})에는 작업 일지가 없어요.");
    }
    let mut sentences: Vec<String> = Vec::new();
    sentences.push(format!(
        "{week} 주({from}~{to})에 작업 일지 {}건을 남겼어요.",
        entries.len()
    ));

    let mut by_type: BTreeMap<&str, usize> = BTreeMap::new();
    for e in entries {
        *by_type.entry(e.entry_type.as_str()).or_insert(0) += 1;
    }
    let breakdown: Vec<String> = ["feature", "bug", "refactor", "error", "chore"]
        .iter()
        .filter_map(|ty| by_type.get(ty).map(|n| format!("{} {n}건", type_label(ty))))
        .collect();
    if !breakdown.is_empty() {
        sentences.push(format!("{}이에요.", breakdown.join(" · ")));
    }

    let done = entries.iter().filter(|e| e.status == "done").count();
    sentences.push(format!(
        "완료 {done}건, 아직 열려 있는 것 {}건이에요.",
        entries.len() - done
    ));

    let files = top_files(entries, TOP_FILES);
    if !files.is_empty() {
        let named: Vec<String> = files
            .iter()
            .map(|(path, n)| format!("`{path}`({n}건)"))
            .collect();
        sentences.push(format!("가장 자주 손댄 파일은 {}이에요.", named.join(", ")));
    }

    let mut agents: Vec<&str> = entries.iter().map(|e| e.agent_id.as_str()).collect();
    agents.sort_unstable();
    agents.dedup();
    if agents.len() > 1 {
        sentences.push(format!("기록한 에이전트는 {}예요.", agents.join(", ")));
    }

    let decisions = decision_quotes(entries).len();
    if decisions > 0 {
        sentences.push(format!(
            "본문에서 결정으로 읽히는 문장 {decisions}개를 아래에 모았어요."
        ));
    }
    sentences.join(" ")
}

fn type_label(ty: &str) -> &'static str {
    match ty {
        "feature" => "기능",
        "bug" => "버그",
        "refactor" => "리팩토링",
        "error" => "에러 사이클",
        _ => "잡일",
    }
}

/// entry 당 1회로 센 상위 파일. `commands/summary.rs::top_files` 와 같은 셈법.
fn top_files(entries: &[RollupSourceEntry], cap: usize) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for e in entries {
        let mut seen: Vec<&str> = Vec::new();
        for f in &e.files {
            if !seen.contains(&f.as_str()) {
                seen.push(f.as_str());
                *counts.entry(f.as_str()).or_insert(0) += 1;
            }
        }
    }
    let mut v: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(k, n)| (k.to_string(), n))
        .collect();
    // 건수 내림차순, 동률은 경로 오름차순 — 같은 입력이 같은 파일을 낸다.
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(cap);
    v
}

/// 종류로 거른 제목 목록. `with_path` 면 첫 번째 파일 경로를 같이 적는다.
fn titled_list(
    heading: &str,
    entries: &[RollupSourceEntry],
    types: &[&str],
    with_path: bool,
    empty_line: &str,
) -> String {
    let mut out = format!("\n{heading}\n");
    let picked: Vec<&RollupSourceEntry> = entries
        .iter()
        .filter(|e| types.contains(&e.entry_type.as_str()))
        .collect();
    if picked.is_empty() {
        out.push_str(empty_line);
        out.push('\n');
        return out;
    }
    for e in picked {
        let title = clamp(&e.title, QUOTE_CHARS);
        match (with_path, e.files.first()) {
            (true, Some(path)) => out.push_str(&format!("- {title} — `{path}`\n")),
            _ => out.push_str(&format!("- {title}\n")),
        }
    }
    out
}

/// 본문에서 고른 결정 문장 — `- 인용 _(일지 제목)_` 줄로.
fn decision_quotes(entries: &[RollupSourceEntry]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for e in entries {
        for sentence in sentences(&e.body_markdown) {
            let lower = sentence.to_lowercase();
            if !DECISION_MARKERS.iter().any(|m| lower.contains(m)) {
                continue;
            }
            let quote = clamp(&sentence, QUOTE_CHARS);
            if quote.chars().count() < 8 || seen.contains(&quote) {
                continue;
            }
            seen.push(quote.clone());
            out.push(format!("- {quote} _({})_", clamp(&e.title, 60)));
        }
    }
    out
}

/// 마크다운 본문을 문장으로. 줄 단위로 훑고 각 줄을 `.`·`!`·`?`·`。` 로 자른다.
///
/// `.` 은 **뒤가 공백이거나 줄 끝일 때만** 종결로 본다 — 그러지 않으면
/// `src/oculpm/watcher.rs` 가 세 조각으로 부서져 인용이 쓰레기가 된다.
/// 헤더(`#`)·코드펜스 안·표는 건너뛴다.
fn sentences(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_fence = false;
    for raw in body.lines() {
        let line = raw.trim();
        if line.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.is_empty() || line.starts_with('#') || line.starts_with('|') {
            continue;
        }
        let line = strip_markers(line);
        for piece in split_sentences(&line) {
            let piece = piece.trim();
            if !piece.is_empty() {
                out.push(piece.to_string());
            }
        }
    }
    out
}

/// 줄머리 장식(리스트 글머리·인용·체크박스)과 강조 표시를 걷어낸다.
fn strip_markers(line: &str) -> String {
    let mut s = line.trim_start_matches(['>', ' ']).trim_start();
    for bullet in ["- ", "* ", "+ "] {
        if let Some(rest) = s.strip_prefix(bullet) {
            s = rest.trim_start();
            break;
        }
    }
    for checkbox in ["[x] ", "[X] ", "[ ] ", "[~] "] {
        if let Some(rest) = s.strip_prefix(checkbox) {
            s = rest.trim_start();
            break;
        }
    }
    s.replace("**", "")
}

fn split_sentences(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut start = 0usize;
    for i in 0..chars.len() {
        let c = chars[i];
        let terminal = match c {
            '!' | '?' | '。' => true,
            // 마침표는 **뒤가 공백이거나 줄 끝일 때만** 종결이다 (`watcher.rs` 보호).
            '.' => chars.get(i + 1).is_none_or(|n| n.is_whitespace()),
            _ => false,
        };
        if terminal {
            out.push(chars[start..=i].iter().collect::<String>());
            start = i + 1;
        }
    }
    if start < chars.len() {
        out.push(chars[start..].iter().collect::<String>());
    }
    out
}

/// 문자 단위 말줄임 — 바이트로 자르면 한글이 깨진다.
fn clamp(text: &str, cap: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= cap {
        return text.to_string();
    }
    let head: String = text.chars().take(cap.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(ty: &str, status: &str, title: &str, body: &str, files: &[&str]) -> RollupSourceEntry {
        RollupSourceEntry {
            relative_path: format!("20260915/X/1200_{ty}_{title}.md"),
            workday: "20260915".into(),
            entry_type: ty.into(),
            status: status.into(),
            agent_id: "claude-code".into(),
            title: title.into(),
            body_markdown: body.into(),
            body_md_hash: "deadbeef".into(),
            files: files.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// 다섯 섹션은 **일지가 0건이어도** 전부 선다 — 빈 섹션이 없는 롤업과
    /// "그 주에 아무것도 없었다"는 다른 사실이고, 후자도 읽혀야 한다.
    #[test]
    fn every_section_is_present_even_for_an_empty_week() {
        let md = deterministic_body("2026-W38", "20260914", "20260920", &[]);
        for h in [
            SECTION_SUMMARY,
            SECTION_DECISIONS,
            SECTION_FIXED,
            SECTION_FEATURES,
            SECTION_CARRIED,
        ] {
            assert!(md.contains(h), "{h} 누락:\n{md}");
        }
        assert!(md.contains("작업 일지가 없어요"), "{md}");
    }

    #[test]
    fn sections_route_entries_by_type_and_status() {
        let entries = vec![
            entry(
                "bug",
                "done",
                "워처가 멈춤",
                "## 발생 원인\n큐가 넘쳤다.\n",
                &["src/w.rs"],
            ),
            entry(
                "feature",
                "done",
                "롤업 층",
                "새 층을 더했다.\n",
                &["src/r.rs"],
            ),
            entry("chore", "in_progress", "버전 올리기", "아직.\n", &[]),
        ];
        let md = deterministic_body("2026-W38", "20260914", "20260920", &entries);
        let fixed = md.find(SECTION_FIXED).unwrap();
        let features = md.find(SECTION_FEATURES).unwrap();
        let carried = md.find(SECTION_CARRIED).unwrap();
        assert!(md[fixed..features].contains("워처가 멈춤"));
        assert!(
            md[fixed..features].contains("`src/w.rs`"),
            "결함은 경로를 같이 적는다"
        );
        assert!(md[features..carried].contains("롤업 층"));
        // done 이 아닌 것만 이월로.
        assert!(md[carried..].contains("[in_progress] 버전 올리기"));
        assert!(!md[carried..].contains("롤업 층"));
    }

    /// 인용이지 요약이 아니다 — 표지어가 든 문장이 **그대로** 실린다.
    #[test]
    fn decisions_quote_the_sentence_that_carries_the_marker() {
        let entries = vec![entry(
            "refactor",
            "done",
            "경로 정리",
            "## 동기\n앞 문장은 평범하다. 새 디렉터리를 파는 대신 기존 트리에 붙이기로 결정했다. 뒤 문장도 평범하다.\n",
            &[],
        )];
        let md = deterministic_body("2026-W38", "20260914", "20260920", &entries);
        assert!(
            md.contains("새 디렉터리를 파는 대신 기존 트리에 붙이기로 결정했다."),
            "{md}"
        );
        assert!(
            !md.contains("앞 문장은 평범하다"),
            "표지어 없는 문장은 안 싣는다:\n{md}"
        );
    }

    /// 파일 경로의 마침표로 문장을 자르지 않는다 — 이 회귀가 인용을 쓰레기로
    /// 만드는 가장 빠른 길이다.
    #[test]
    fn a_dotted_path_does_not_split_a_sentence() {
        let parts = split_sentences("src/oculpm/watcher.rs 를 고치기로 결정했다. 다음.");
        assert_eq!(
            parts.first().map(String::as_str),
            Some("src/oculpm/watcher.rs 를 고치기로 결정했다.")
        );
        assert_eq!(parts.len(), 2, "{parts:?}");
    }

    #[test]
    fn code_fences_and_headers_are_not_quoted() {
        let entries = vec![entry(
            "chore",
            "done",
            "설정",
            "## 결정 사항\n```\nlet x = \"결정했다.\";\n```\n본문에서 결정했다.\n",
            &[],
        )];
        let md = deterministic_body("2026-W38", "20260914", "20260920", &entries);
        assert!(md.contains("- 본문에서 결정했다."), "{md}");
        assert!(
            !md.contains("let x"),
            "코드펜스 안은 인용하지 않는다:\n{md}"
        );
    }

    #[test]
    fn the_summary_counts_are_facts_not_prose() {
        let entries = vec![
            entry("bug", "done", "A", "", &["src/a.rs", "src/a.rs"]),
            entry("bug", "in_progress", "B", "", &["src/a.rs"]),
        ];
        let md = deterministic_body("2026-W38", "20260914", "20260920", &entries);
        assert!(md.contains("작업 일지 2건"), "{md}");
        assert!(md.contains("버그 2건"), "{md}");
        assert!(md.contains("완료 1건, 아직 열려 있는 것 1건"), "{md}");
        // entry 내 중복은 1회 — a.rs 는 2건.
        assert!(md.contains("`src/a.rs`(2건)"), "{md}");
    }

    #[test]
    fn long_quotes_are_clamped_on_character_boundaries() {
        let long = "결정했다 ".repeat(80);
        let entries = vec![entry("chore", "done", "긴 줄", &long, &[])];
        let md = deterministic_body("2026-W38", "20260914", "20260920", &entries);
        assert!(md.contains('…'), "{md}");
        // 잘려도 유효한 UTF-8 이고 한글이 깨지지 않는다.
        assert!(md.contains("결정했다"), "{md}");
    }
}

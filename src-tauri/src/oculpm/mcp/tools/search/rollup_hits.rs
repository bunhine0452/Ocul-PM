//! `journal_search` 의 **요약 층 히트** (journal-scale-round `{#rollup-first}`).
//!
//! # 왜 별도 배열인가
//!
//! 원본 히트(`hits_tsv`)와 섞지 않는다. 롤업은 일지가 아니다 — `type`·`status`
//! 가 없고, 한 줄이 그 주 수십 건을 대표한다. 같은 표에 실으면 랭킹이 사과와
//! 오렌지를 비교하게 되고, 무엇보다 **에이전트가 "먼저 이걸 읽어라"를 못
//! 알아본다**. 따로 실어야 "여기부터 읽고 필요하면 원본으로 내려가라"가 된다.
//!
//! # 점수
//!
//! `journal_search` 본문과 같은 규율 — 토큰이 **전부** 걸린 것만 남기고,
//! 걸린 횟수에 최신성을 조금 더한다. 랭킹 모듈(`journal_search::rank`)을 쓰지
//! 않는 이유는 그쪽이 `SearchRow`(제목·태그·슬러그·파일)를 전제하는데 롤업엔
//! 그 칸이 아예 없기 때문이다 — 빈 칸을 지어내 넣느니 작은 셈을 따로 둔다.

use std::path::Path;

use regex::Regex;
use serde_json::{json, Value};

use crate::oculpm::redact::redact_text;
use crate::oculpm::rollup;

/// 응답에 싣는 롤업 수. 「먼저 볼 것」이 열 줄이면 먼저가 아니다.
const ROLLUP_HIT_CAP: usize = 3;
/// 스니펫 길이 (문자).
const SNIPPET_CHARS: usize = 180;

/// 토큰이 전부 걸린 롤업 상위 [`ROLLUP_HIT_CAP`] 개. 토큰이 없으면 빈 배열
/// (필터만 있는 검색에 최신 롤업을 끼워 넣지 않는다 — 묻지 않은 답이다).
pub(crate) fn rollup_hits(root: &Path, tokens: &[String], patterns: &[Regex]) -> Vec<Value> {
    if tokens.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(u32, String, Value)> = Vec::new();
    // `read_all` 이 주 내림차순으로 준다 — 동점이면 그 순서가 곧 최신성이다.
    for (fm, body) in rollup::read_all(root) {
        let haystack = format!("{}\n{}", fm.week, body).to_lowercase();
        if !tokens.iter().all(|t| haystack.contains(t.as_str())) {
            continue;
        }
        let score: u32 = tokens
            .iter()
            .map(|t| haystack.matches(t.as_str()).count() as u32)
            .sum();
        let (snippet, _) = redact_text(&snippet_for(&body, tokens), patterns);
        scored.push((
            score,
            fm.week.clone(),
            json!({
                "week": fm.week,
                "path": crate::oculpm::paths::rollup_rel(&fm.week),
                "entry_count": fm.entry_count,
                "range": { "from": fm.range.from, "to": fm.range.to },
                "snippet": snippet,
            }),
        ));
    }
    // 점수 내림차순, 동점은 최신 주 먼저 — 결정적이다.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    scored
        .into_iter()
        .take(ROLLUP_HIT_CAP)
        .map(|(_, _, v)| v)
        .collect()
}

/// 토큰이 처음 걸린 줄을 중심으로 한 조각. 못 찾으면 「한 주 요약」 첫 문단.
fn snippet_for(body: &str, tokens: &[String]) -> String {
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let lower = line.to_lowercase();
        if tokens.iter().any(|t| lower.contains(t.as_str())) {
            return clamp(line, SNIPPET_CHARS);
        }
    }
    clamp(&rollup::first_paragraph(body), SNIPPET_CHARS)
}

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
    use crate::oculpm::rollup::{RollupFrontmatter, RollupRange, ROLLUP_SCHEMA};

    fn seed(root: &Path, week: &str, body: &str) {
        let fm = RollupFrontmatter {
            oculpm_rollup: ROLLUP_SCHEMA.into(),
            week: week.into(),
            range: RollupRange {
                from: "20260914".into(),
                to: "20260920".into(),
            },
            entry_count: 7,
            entries_hash: "h".into(),
            generated_at: "2026-09-21T10:00:00+09:00".into(),
            generator: "deterministic".into(),
        };
        rollup::write(root, &fm, body).unwrap();
    }

    #[test]
    fn all_tokens_must_land_and_the_best_match_leads() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        seed(
            root,
            "2026-W36",
            "## 한 주 요약\n\n워처를 한 번 고쳤어요.\n",
        );
        seed(
            root,
            "2026-W37",
            "## 한 주 요약\n\n워처 큐가 넘쳤어요. 워처 워처.\n",
        );
        seed(root, "2026-W38", "## 한 주 요약\n\n관계 없는 주.\n");

        let hits = rollup_hits(root, &["워처".to_string()], &[]);
        assert_eq!(hits.len(), 2, "{hits:#?}");
        assert_eq!(hits[0]["week"], "2026-W37", "많이 걸린 쪽이 먼저");
        assert_eq!(hits[0]["path"], ".oculpm/rollups/2026-W37.md");
        assert_eq!(hits[0]["entry_count"], 7);
        assert!(hits[0]["snippet"]
            .as_str()
            .unwrap()
            .contains("워처 큐가 넘쳤어요"));

        // AND — 한 토큰이라도 안 걸리면 빠진다.
        assert!(rollup_hits(root, &["워처".into(), "없는말".into()], &[]).is_empty());
        // 묻지 않으면 답하지 않는다.
        assert!(rollup_hits(root, &[], &[]).is_empty());
    }

    #[test]
    fn at_most_three_come_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for w in ["2026-W34", "2026-W35", "2026-W36", "2026-W37", "2026-W38"] {
            seed(root, w, "## 한 주 요약\n\n같은 말.\n");
        }
        let hits = rollup_hits(root, &["같은".to_string()], &[]);
        assert_eq!(hits.len(), ROLLUP_HIT_CAP);
        // 동점이면 최신 주부터.
        assert_eq!(hits[0]["week"], "2026-W38");
        assert_eq!(hits[2]["week"], "2026-W36");
    }

    /// 롤업이 하나도 없는 프로젝트에서도 조용히 빈 배열이다 — 이 층은
    /// 옵트인이고, 안 쓰는 사람에게 오류를 내면 안 된다.
    #[test]
    fn a_project_without_rollups_is_silent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(rollup_hits(dir.path(), &["무엇".to_string()], &[]).is_empty());
    }
}

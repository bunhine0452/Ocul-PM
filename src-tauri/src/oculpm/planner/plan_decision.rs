//! `## 결정` 섹션에 결정 블록 하나를 더한다 — MCP `plan_update` 의 `decision` 인자가 쓴다
//! (love-round-20261123 #mcp-plan-add-item).
//!
//! AGENTS.md §5 는 「큰 결정은 플랜의 `## 결정` 섹션에 `### Decision N — 제목 {#id}` 블록으로 잠근다」 고
//! 하면서 그것을 쓸 도구가 없었다 — 에이전트는 python 으로 플랜 파일을 직접 고쳤고(이 저장소 세션에서
//! Bash 쓰기 94건), 그때 CAS · 문지기 · `{#id}` 규격이 모두 빠졌다. 순수 수술 함수라 I/O 는 없다 —
//! 잠금 · 해시 대조 · 원자 쓰기는 부르는 쪽(`plan_update`)이 한다.

use crate::oculpm::planner::eol;
use crate::oculpm::planner::heading::{is_decisions_heading, split_phase_heading};
use crate::oculpm::planner::plan_edit::id_is_anchored;

/// 더할 결정 하나.
pub struct NewDecision<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    /// 영향받는 항목 id 들 (`#` 없이).
    pub affects: &'a [String],
    /// `YYYY-MM-DD`
    pub date: &'a str,
    pub agent: &'a str,
    /// 영어 프로젝트 — 섹션 이름과 메타 낱말(`Locked` · `Affects:`)이 영어다. 파서는 둘 다 읽는다.
    pub en: bool,
}

/// 결정 블록을 섹션 끝에 더한다 (섹션이 없으면 plan-log 앞에 만든다). 번호는 있는 결정 수 + 1.
pub fn add_decision(md: &str, d: &NewDecision) -> Result<String, String> {
    eol::keeping(md, |md| add_decision_lf(md, d))
}

fn heading_name(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("## ")?;
    Some(split_phase_heading(rest).0)
}

fn is_log_begin(line: &str) -> bool {
    line.trim_start().starts_with("<!-- oculpm:plan-log begin")
}

fn add_decision_lf(md: &str, d: &NewDecision) -> Result<String, String> {
    if id_is_anchored(md, d.id) {
        return Err(format!("id '{}' already exists in this plan", d.id));
    }
    let title = d.title.replace(['\n', '\r'], " ");
    let title = title.trim();
    if title.is_empty() {
        return Err("decision.title is empty".to_string());
    }
    let n = crate::oculpm::planner::parse::parse_plan(md, "x")
        .decisions
        .len()
        + 1;
    let mut block = vec![
        format!("### Decision {n} — {title} {{#{}}}", d.id),
        String::new(),
        if d.en {
            format!("Locked {} · {}", d.date, d.agent)
        } else {
            format!("잠금 {} · {}", d.date, d.agent)
        },
    ];
    let body = d.body.trim();
    if !body.is_empty() {
        block.push(String::new());
        block.extend(body.lines().map(escape_structural));
    }
    if !d.affects.is_empty() {
        let refs = d
            .affects
            .iter()
            .map(|a| format!("#{}", a.trim().trim_start_matches('#')))
            .collect::<Vec<_>>()
            .join(" ");
        block.push(String::new());
        block.push(if d.en {
            format!("Affects: {refs}")
        } else {
            format!("영향: {refs}")
        });
    }

    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let section = lines
        .iter()
        .position(|l| heading_name(l).is_some_and(|n| is_decisions_heading(&n)));
    match section {
        Some(si) => {
            let mut at = lines.len();
            for (j, line) in lines.iter().enumerate().skip(si + 1) {
                if line.trim_start().starts_with("## ") || is_log_begin(line) {
                    at = j;
                    break;
                }
            }
            while at > si + 1 && lines[at - 1].trim().is_empty() {
                at -= 1;
            }
            let mut ins = vec![String::new()];
            ins.extend(block);
            let follows = lines.get(at).is_some_and(|l| !l.trim().is_empty());
            if follows {
                ins.push(String::new());
            }
            lines.splice(at..at, ins);
        }
        None => {
            let pos = lines
                .iter()
                .position(|l| is_log_begin(l))
                .unwrap_or(lines.len());
            let mut ins = vec![
                String::new(),
                if d.en { "## Decisions" } else { "## 결정" }.to_string(),
                String::new(),
            ];
            ins.extend(block);
            ins.push(String::new());
            // plan-log 바로 앞 빈 줄이 이미 있으면 겹치지 않게.
            if pos > 0 && lines[pos - 1].trim().is_empty() {
                ins.remove(0);
            }
            lines.splice(pos..pos, ins);
        }
    }
    Ok(lines.join("\n"))
}

/// 결정 본문의 잠금 메타 줄이면 그 뒤 — `잠금 2026-…` (en `Locked 2026-…`). 파서(`parse::flush_decision`)가
/// 쓴다. 영어 낱말은 본문의 「Locked in …」 같은 글과 가르려고 날짜가 따라올 때만 메타로 본다.
pub(crate) fn locked_rest(line: &str) -> Option<&str> {
    line.strip_prefix("잠금").or_else(|| {
        line.strip_prefix("Locked ")
            .filter(|r| r.trim_start().starts_with(|c: char| c.is_ascii_digit()))
    })
}

/// 결정 본문의 영향 메타 줄이면 그 뒤 — `영향: #a #b` (en `Affects: …`).
pub(crate) fn affects_rest(line: &str) -> Option<&str> {
    line.strip_prefix("영향:")
        .or_else(|| line.strip_prefix("Affects:"))
}

/// 본문 줄이 헤딩·plan-log 경계로 읽히지 않게 — 그런 줄이 섞이면 결정 섹션이 끊겨 뒤의 글이 phase 가
/// 된다. 앞에 `\` 를 붙이면 파서는 글로 읽고, 마크다운은 `#` 을 그대로 보인다.
fn escape_structural(line: &str) -> String {
    let t = line.trim_start();
    if t.starts_with('#') || t.starts_with("<!-- oculpm:") {
        format!("\\{t}")
    } else {
        line.trim_end().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::planner::parse::parse_plan;

    const MD: &str = "---\noculpm_plan: v1\nid: p\ntitle: \"p\"\nstatus: active\n---\n\n## 단계 {#s}\n- [ ] 일 {#a}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";

    fn decision<'a>(id: &'a str, affects: &'a [String], en: bool) -> NewDecision<'a> {
        NewDecision {
            id,
            title: "결정 제목",
            body: "근거 한 줄\n## 이건 헤딩이 아니다",
            affects,
            date: "2026-11-23",
            agent: "claude-code",
            en,
        }
    }

    /// 섹션이 없으면 plan-log 앞에 만들고, 둘째는 그 섹션 끝에 붙는다 — 번호 · 잠금 · 영향을 파서가 읽는다.
    #[test]
    fn decisions_are_appended_and_read_back_by_the_parser() {
        let affects = vec!["a".to_string()];
        let one = add_decision(MD, &decision("d-one", &affects, false)).unwrap();
        let two = add_decision(&one, &decision("d-two", &[], false)).unwrap();
        let parsed = parse_plan(&two, "p");
        assert!(parsed.warnings.is_empty(), "{:?}\n{two}", parsed.warnings);
        assert_eq!(
            parsed.items.len(),
            1,
            "본문의 `## ` 줄이 phase 가 되면 안 된다:\n{two}"
        );
        let ds = &parsed.decisions;
        assert_eq!(ds.len(), 2, "{two}");
        assert_eq!(ds[0].decision_id, "d-one");
        assert_eq!(ds[0].title, "Decision 1 — 결정 제목");
        assert_eq!(ds[0].locked_at.as_deref(), Some("2026-11-23"));
        assert_eq!(ds[0].agent_id.as_deref(), Some("claude-code"));
        assert_eq!(ds[0].affects, vec!["a".to_string()]);
        assert!(ds[1].title.starts_with("Decision 2 — "), "{two}");
        assert!(two.find("## 결정").unwrap() < two.find("<!-- oculpm:plan-log begin").unwrap());
        assert_eq!(two.matches("## 결정").count(), 1, "섹션은 하나:\n{two}");
    }

    /// 영어 프로젝트는 영어 낱말로 쓰고, 파서는 그것도 메타로 읽는다.
    #[test]
    fn english_projects_get_english_meta_words() {
        let affects = vec!["#a".to_string()];
        let out = add_decision(MD, &decision("d-en", &affects, true)).unwrap();
        assert!(out.contains("## Decisions\n") && out.contains("Locked 2026-11-23 · claude-code"));
        let d = &parse_plan(&out, "p").decisions[0];
        assert_eq!(d.locked_at.as_deref(), Some("2026-11-23"));
        assert_eq!(d.affects, vec!["a".to_string()]);
    }

    /// 이미 쓰인 id(항목이든 결정이든)는 거절한다 — 파서가 같은 이름공간에서 `-2` 를 붙여 갈라진다.
    #[test]
    fn a_taken_id_is_refused() {
        assert!(add_decision(MD, &decision("a", &[], false)).is_err());
        let crlf = MD.replace('\n', "\r\n");
        let out = add_decision(&crlf, &decision("d", &[], false)).unwrap();
        assert!(
            !out.replace("\r\n", "").contains('\n'),
            "CRLF 문서는 CRLF 로"
        );
    }
}

//! 「마지막 판정」 — 플랜의 확인 명령을 **실제로 돌린** 결과 (4.0 `{#hook-last-verdict}`).
//!
//! 항목이 전부 닫혔다는 것과 완료 조건이 참이라는 것은 다른 주장이다. 둘째를 말하는 것은
//! 에이전트가 아니라 확인 명령의 결과 끝 줄이고, 그 줄은 plan-log 메모 열에 한 형식으로 남는다:
//!
//! ```text
//! 판정 ✓ 418 passed · exit 0
//! 판정 ✗ 2 failed, 418 passed
//! verdict ✓ …      (영어 템플릿)
//! ```
//!
//! 시작 훅(`plan-context.sh`)과 앱이 **같은 접두**를 읽는다 — 형식을 바꾸면 둘 다 바꾼다.

use serde::Serialize;

use super::parse::PlanItemUpdate;

/// 가장 최근 판정 한 줄.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct PlanVerdict {
    pub passed: bool,
    /// 판정 표시 뒤의 결과 끝 줄 (`2 failed, 418 passed`). 비어 있을 수 있다.
    pub summary: String,
    pub ts: String,
    pub agent_id: String,
    pub item_id: String,
}

/// 메모 한 칸이 판정이면 `(통과?, 결과 끝 줄)`. 접두는 `판정`·`verdict`(대소문자 무시),
/// 그 뒤 `:` 와 공백은 있어도 되고, 표시는 ✓✔ (통과) · ✗✘ (실패) 넷만 받는다 —
/// 「판정은 나중에」 같은 문장을 판정으로 오인하지 않으려고 표시를 필수로 둔다.
pub fn parse_note(note: &str) -> Option<(bool, String)> {
    let s = note.trim_start();
    let rest = if let Some(r) = s.strip_prefix("판정") {
        r
    } else {
        let head = s.get(..7)?;
        if !head.eq_ignore_ascii_case("verdict") {
            return None;
        }
        &s[7..]
    };
    let rest = rest.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
    let mut chars = rest.chars();
    let passed = match chars.next()? {
        '✓' | '✔' => true,
        '✗' | '✘' => false,
        _ => return None,
    };
    Some((passed, chars.as_str().trim().to_string()))
}

/// plan-log 행들 중 판정 형식을 가진 가장 최근 행. 시각 비교는 `last_update_map` 과 같은
/// 문자열 비교다 (한 플랜의 로그는 한 오프셋으로 쓰인다).
pub fn last_verdict(updates: &[PlanItemUpdate]) -> Option<PlanVerdict> {
    updates
        .iter()
        .filter_map(|u| {
            let (passed, summary) = parse_note(u.note.as_deref()?)?;
            Some(PlanVerdict {
                passed,
                summary,
                ts: u.ts.clone(),
                agent_id: u.agent_id.clone(),
                item_id: u.item_id.clone(),
            })
        })
        .max_by(|a, b| a.ts.cmp(&b.ts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(ts: &str, note: Option<&str>) -> PlanItemUpdate {
        PlanItemUpdate {
            ts: ts.into(),
            item_id: "x".into(),
            agent_id: "claude-code".into(),
            from_status: None,
            to_status: None,
            journal_ref: None,
            note: note.map(Into::into),
        }
    }

    #[test]
    fn reads_both_languages_and_marks() {
        assert_eq!(
            parse_note("판정 ✓ 418 passed · exit 0"),
            Some((true, "418 passed · exit 0".into()))
        );
        assert_eq!(
            parse_note("판정: ✗ 2 failed"),
            Some((false, "2 failed".into()))
        );
        assert_eq!(parse_note("Verdict ✔ ok"), Some((true, "ok".into())));
        assert_eq!(parse_note("verdict ✘"), Some((false, String::new())));
    }

    #[test]
    fn prose_is_not_a_verdict() {
        assert_eq!(parse_note("판정은 사용자가 내린다"), None);
        assert_eq!(parse_note("verdicts later"), None);
        assert_eq!(parse_note("cargo test ✓"), None);
        assert_eq!(parse_note(""), None);
        assert_eq!(parse_note("판"), None);
    }

    #[test]
    fn latest_verdict_wins_and_plain_rows_are_skipped() {
        let rows = vec![
            row("2026-10-28T13:40:00+09:00", Some("판정 ✓ 418 passed")),
            row("2026-10-28T14:12:00+09:00", Some("판정 ✗ 2 failed")),
            row("2026-10-28T14:30:00+09:00", Some("트레이 제거")),
            row("2026-10-28T14:31:00+09:00", None),
        ];
        let v = last_verdict(&rows).unwrap();
        assert!(!v.passed);
        assert_eq!(v.summary, "2 failed");
        assert_eq!(v.ts, "2026-10-28T14:12:00+09:00");
        assert_eq!(last_verdict(&rows[2..]), None);
    }
}

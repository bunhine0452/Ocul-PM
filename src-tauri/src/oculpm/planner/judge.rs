//! 「마지막 판정」 — 플랜의 확인 명령을 **실제로 돌린** 결과 (4.0 `{#hook-last-verdict}`).
//!
//! 항목이 전부 닫혔다는 것과 완료 조건이 참이라는 것은 다른 주장이다. 둘째를 말하는 것은
//! 에이전트가 아니라 확인 명령의 결과 끝 줄이고, 그 줄은 plan-log 메모 열에 한 형식으로 남는다:
//!
//! ```text
//! 판정 ✓ 418 passed · exit 0
//! 판정 ✗ 2 failed, 418 passed
//! verdict ✓ …      (영어 템플릿 — 소문자, 공백 하나, 콜론 없음)
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

/// 메모 한 칸이 판정이면 `(통과?, 결과 끝 줄)`. 형식은 시작 훅과 **글자 그대로** 같다:
/// `^(판정|verdict) (✓|✗)` — 공백 하나, 글리프 U+2713/U+2717, `verdict` 는 소문자만.
/// `판정:` 처럼 콜론이 붙은 옛 메모는 판정이 아니다 — 훅과 앱이 같은 줄을 다르게 읽으면
/// 화면과 시작 컨텍스트가 서로 다른 판정을 말한다.
pub fn parse_note(note: &str) -> Option<(bool, String)> {
    let s = note.trim();
    let rest = s
        .strip_prefix("판정 ")
        .or_else(|| s.strip_prefix("verdict "))?;
    let (passed, tail) = match rest.strip_prefix('✓') {
        Some(t) => (true, t),
        None => (false, rest.strip_prefix('✗')?),
    };
    if !(tail.is_empty() || tail.starts_with(' ')) {
        return None;
    }
    Some((passed, tail.trim().to_string()))
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
    fn reads_both_languages() {
        assert_eq!(
            parse_note("판정 ✓ 418 passed · exit 0"),
            Some((true, "418 passed · exit 0".into()))
        );
        assert_eq!(
            parse_note("판정 ✗ 2 failed"),
            Some((false, "2 failed".into()))
        );
        assert_eq!(parse_note("verdict ✓ ok"), Some((true, "ok".into())));
        assert_eq!(parse_note("verdict ✗"), Some((false, String::new())));
    }

    #[test]
    fn only_the_hook_format_counts() {
        // 시작 훅(plan-context.sh)의 정규식 `^(판정|verdict) (✓|✗)` 과 같은 경계.
        assert_eq!(parse_note("판정: ✗ 2 failed"), None);
        assert_eq!(parse_note("Verdict ✓ ok"), None);
        assert_eq!(parse_note("판정 ✔ ok"), None);
        assert_eq!(parse_note("판정  ✓ ok"), None);
        assert_eq!(parse_note("판정 ✓x"), None);
        assert_eq!(parse_note("판정은 사용자가 내린다"), None);
        assert_eq!(parse_note("cargo test ✓"), None);
        assert_eq!(parse_note(""), None);
    }

    #[test]
    fn latest_verdict_wins_and_plain_rows_are_skipped() {
        let rows = vec![
            row("2026-10-28T13:40:00+09:00", Some("판정 ✓ 418 passed")),
            row(
                "2026-10-28T14:20:00+09:00",
                Some("판정: ✓ 옛 형식은 판정이 아니다"),
            ),
            row("2026-10-28T14:12:00+09:00", Some("판정 ✗ 2 failed")),
            row("2026-10-28T14:30:00+09:00", Some("트레이 제거")),
            row("2026-10-28T14:31:00+09:00", None),
        ];
        let v = last_verdict(&rows).unwrap();
        assert!(!v.passed);
        assert_eq!(v.summary, "2 failed");
        assert_eq!(v.ts, "2026-10-28T14:12:00+09:00");
        assert_eq!(last_verdict(&rows[3..]), None);
    }
}

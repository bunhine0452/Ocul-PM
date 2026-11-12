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
    /// **이 OS 에서** 돌린 가장 최근 판정이 ✓ 였다면 그 시각 (`last_verdict` 가 채운다, 2026-11-13).
    /// 가장 최근 판정이 다른 OS 것일 때 오늘 화면이 「여기선 아직」을 가르는 재료다
    /// (`digest::DigestPlan::stale_baseline`). 선택 필드(TS `?:`).
    #[serde(default)]
    pub passed_here_at: Option<String>,
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

/// 이 바이너리가 도는 OS — 판정 줄 끝 표시와 같은 낱말 (2026-11-13, 플랜 `two-machines-20261113`).
pub const HERE: &str = if cfg!(target_os = "macos") {
    "mac"
} else if cfg!(windows) {
    "windows"
} else {
    "linux"
};

const OS_TAGS: [&str; 3] = ["mac", "windows", "linux"];

/// 결과 끝 줄이 어느 OS 에서 돌았는가 — 끝의 ` · mac` · ` · windows` · ` · linux`. 표시가 없으면(옛
/// 줄 · 손으로 쓴 줄) `None` 이고, 읽는 쪽은 그것을 「이 기기에서 돌린 것」으로 본다(옛 동작 그대로).
///
/// 같은 저장소를 두 OS 에서 번갈아 쓰면 맥에서 받은 ✓ 가 윈도우에서도 ✓ 로 선다 — 확인 명령은 거기서
/// 돈 적이 없는데. 표시는 접두(`^(판정|verdict) (✓|✗)`)를 건드리지 않으므로 시작 훅 · 확장의 읽기는 그대로다.
pub fn ran_on(summary: &str) -> Option<&'static str> {
    let s = summary.trim_end();
    OS_TAGS.into_iter().find(|tag| {
        s.strip_suffix(tag)
            .and_then(|head| head.strip_suffix("· "))
            .is_some_and(|head| head.is_empty() || head.ends_with(' '))
    })
}

/// 판정 메모에 돌린 OS 를 붙인다 — `plan_update` 가 적기 직전에. 판정이 아닌 메모와 이미 표시가 있는
/// 메모(CI 결과를 옮겨 적은 `· linux` 등)는 그대로 둔다.
pub fn stamp(note: &str, os: &str) -> String {
    match parse_note(note) {
        Some((_, summary)) if ran_on(&summary).is_none() => format!("{} · {os}", note.trim_end()),
        _ => note.to_string(),
    }
}

/// plan-log 행들 중 판정 형식을 가진 가장 최근 행. 시각 비교는 `last_update_map` 과 같은
/// 문자열 비교다 (한 플랜의 로그는 한 오프셋으로 쓰인다). `passed_here_at` 도 여기서 채운다.
pub fn last_verdict(updates: &[PlanItemUpdate]) -> Option<PlanVerdict> {
    let mut last = latest(updates)?;
    last.passed_here_at = last_verdict_on(updates, HERE)
        .filter(|v| v.passed)
        .map(|v| v.ts);
    Some(last)
}

fn latest(updates: &[PlanItemUpdate]) -> Option<PlanVerdict> {
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
                passed_here_at: None,
            })
        })
        .max_by(|a, b| a.ts.cmp(&b.ts))
}

/// `os` 에서 돌린 가장 최근 판정 — 표시 없는 줄도 여기 것으로 센다. 가장 최근 판정이 다른 OS 것일 때
/// 「그래도 이 기기에서 마지막으로 확인한 것은 언제인가」를 답한다 (`PlanVerdict::passed_here_at`).
pub fn last_verdict_on(updates: &[PlanItemUpdate], os: &str) -> Option<PlanVerdict> {
    let here: Vec<PlanItemUpdate> = updates
        .iter()
        .filter(|u| {
            u.note
                .as_deref()
                .and_then(parse_note)
                .is_some_and(|(_, summary)| ran_on(&summary).is_none_or(|tag| tag == os))
        })
        .cloned()
        .collect();
    latest(&here)
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
    fn the_os_mark_is_read_from_the_tail_only() {
        assert_eq!(ran_on("418 passed · exit 0 · mac"), Some("mac"));
        assert_eq!(ran_on("ok · windows "), Some("windows"));
        assert_eq!(ran_on("· linux"), Some("linux"), "끝 줄 없이 표시만");
        assert_eq!(ran_on("418 passed · exit 0"), None);
        assert_eq!(ran_on("mac"), None, "가운뎃점 없는 낱말은 끝 줄의 일부다");
        assert_eq!(ran_on("passed on·mac"), None);
        assert_eq!(ran_on("ok · mac · 3 warnings"), None, "끝이 아니다");
        assert_eq!(ran_on("ok · macos"), None);
    }

    #[test]
    fn stamping_marks_verdicts_once_and_leaves_other_notes() {
        assert_eq!(stamp("판정 ✓ 418 passed", "mac"), "판정 ✓ 418 passed · mac");
        assert_eq!(stamp("verdict ✗", "windows"), "verdict ✗ · windows");
        assert_eq!(
            stamp("판정 ✓ CI 초록 · linux", "mac"),
            "판정 ✓ CI 초록 · linux",
            "이미 적힌 표시는 적은 쪽이 안다"
        );
        assert_eq!(stamp("트레이 제거", "mac"), "트레이 제거");
        // 붙인 뒤에도 같은 접두 — 시작 훅과 앱이 그대로 읽는다.
        assert_eq!(
            parse_note(&stamp("판정 ✓ 418 passed", "mac")),
            Some((true, "418 passed · mac".into()))
        );
    }

    #[test]
    fn the_last_verdict_here_skips_other_machines() {
        let rows = vec![
            row("2026-11-12T10:00:00+09:00", Some("판정 ✓ 옛 줄")),
            row("2026-11-12T11:00:00+09:00", Some("판정 ✓ 12 passed · mac")),
            row(
                "2026-11-12T12:00:00+09:00",
                Some("판정 ✓ 12 passed · windows"),
            ),
        ];
        assert_eq!(last_verdict(&rows).unwrap().summary, "12 passed · windows");
        assert_eq!(
            last_verdict_on(&rows, "mac").unwrap().summary,
            "12 passed · mac"
        );
        assert_eq!(
            last_verdict_on(&rows, "linux").unwrap().summary,
            "옛 줄",
            "표시 없는 줄은 여기 것으로 센다"
        );
        assert_eq!(last_verdict_on(&rows[1..], "linux"), None);

        // 가장 최근 판정에는 「이 OS 에서 마지막으로 통과한 시각」이 함께 실린다 — 그 뒤 여기서 실패했으면 없다.
        let here_pass = format!("판정 ✓ ok · {HERE}");
        let here_fail = format!("판정 ✗ 1 failed · {HERE}");
        let other = if HERE == "mac" { "windows" } else { "mac" };
        let away = format!("판정 ✓ ok · {other}");
        let mut rows = vec![
            row("2026-11-12T09:00:00+09:00", Some(&here_pass)),
            row("2026-11-12T12:00:00+09:00", Some(&away)),
        ];
        let last = last_verdict(&rows).unwrap();
        assert_eq!(ran_on(&last.summary), Some(other));
        assert_eq!(
            last.passed_here_at.as_deref(),
            Some("2026-11-12T09:00:00+09:00")
        );
        rows.insert(1, row("2026-11-12T10:00:00+09:00", Some(&here_fail)));
        assert_eq!(last_verdict(&rows).unwrap().passed_here_at, None);
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

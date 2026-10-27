//! 검증 칸의 **증거 등급** — 일지 본문에서만 읽는다.
//!
//! 실측 2026-10-27: 사람이 「확인」을 누른 일지는 882건 중 8건(0.9%)인데, `## 검증`
//! 칸에 명령 증거(`cargo test` · `pnpm lint` · `exit 0` …)가 있는 일지는 733건(83%)
//! 이었다. 「확인됨」 하나만 있는 화면에서는 거의 전부가 미확인으로 보였다. 그래서
//! 둘을 가른다: **자기 검증(증거 있음)** 과 **사람 확인** 은 다른 사실이다.
//!
//! 기준은 `docs/launch/agent-report-card.py` 와 같다 — 한쪽만 고치면 성적표와 앱이
//! 다른 숫자를 말한다. 등급은 캐시 투영에서 계산해 `oculpm_journal.evidence`(042)에
//! 둔다. 디스크는 건드리지 않는다.

use std::sync::OnceLock;

use regex::Regex;

/// 검증 칸이 없다.
pub const NONE: u8 = 0;
/// 검증 칸은 있지만 명령 증거가 없거나, 스스로 「미검증」이라 적었다.
pub const SECTION: u8 = 1;
/// 검증 칸에 명령·게이트 증거가 있고 미검증 선언이 없다.
pub const COMMAND: u8 = 2;

fn header() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?m)^#{2,4}\s*(검증|Verification)\b").expect("regex"))
}

fn command_evidence() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"cargo (test|clippy|build|check|fmt)|pnpm (test|typecheck|lint|build|vitest|tauri build)|vitest|tsc --noEmit|\btsc\b|pytest|npm (run )?test|exit 0|통과|green|초록",
        )
        .expect("regex")
    })
}

fn self_unverified() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"실기기[^\n]{0,20}(미확인|확인 (대기|안|못|전)|미검증)|육안[^\n]{0,15}(대기|미확인|못|안 했|이월)|미검증|검증하지 (못|않)|확인하지 (못|않)|확인 못|not (yet )?verified|unverified|사용자 (육안 )?확인 대기|수동 확인 (필요|대기)",
        )
        .expect("regex")
    })
}

/// 검증 칸 본문만 — 다음 헤딩 앞까지. 원인 설명의 「확인하지 않아서」를 미검증으로
/// 오인하지 않게 칸 밖은 보지 않는다.
pub fn verification_section(body: &str) -> Option<&str> {
    let m = header().find(body)?;
    let rest = &body[m.end()..];
    let next = Regex::new(r"(?m)^#{1,4}\s").expect("regex");
    let end = next.find(rest).map(|n| n.start()).unwrap_or(rest.len());
    Some(&rest[..end])
}

/// 본문 하나의 증거 등급.
pub fn evidence_level(body: &str) -> u8 {
    let Some(section) = verification_section(body) else {
        return NONE;
    };
    if command_evidence().is_match(section) && !self_unverified().is_match(section) {
        COMMAND
    } else {
        SECTION
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grades_follow_the_report_card_heuristic() {
        assert_eq!(
            evidence_level("## 변경 요약\ncargo test 통과\n"),
            NONE,
            "칸 밖의 증거는 안 센다"
        );
        assert_eq!(evidence_level("## 검증\n눈으로 봤다.\n"), SECTION);
        assert_eq!(
            evidence_level("## 검증\n`cargo test` 전부 통과, `pnpm lint` exit 0.\n"),
            COMMAND
        );
        assert_eq!(
            evidence_level("## Verification\n`pnpm test` green.\n"),
            COMMAND
        );
        assert_eq!(
            evidence_level("## 검증\ncargo test 통과. 실기기 미확인 — 설치본에서 봐야 한다.\n"),
            SECTION,
            "스스로 미검증이라 적으면 명령이 있어도 증거 등급이 아니다"
        );
        assert_eq!(
            evidence_level("## 발생 원인\n확인하지 않아서 났다.\n\n## 검증\ncargo test 초록\n"),
            COMMAND,
            "원인 칸의 「확인하지 않아서」는 검증 칸이 아니다"
        );
    }

    #[test]
    fn the_section_stops_at_the_next_heading() {
        let body = "## 검증\n수동으로 봄\n\n## 다음\ncargo test 통과\n";
        assert_eq!(verification_section(body).unwrap().trim(), "수동으로 봄");
        assert_eq!(evidence_level(body), SECTION);
    }
}

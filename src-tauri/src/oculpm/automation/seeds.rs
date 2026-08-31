//! 씨앗 스케줄 3종 (`01-automation.md` §1.4).
//!
//! 빈 자동화 화면은 "무엇을 쓸 수 있는지" 를 가르쳐 주지 않는다. 대신 **비활성
//! 상태의 예시 셋**을 제안한다 — 「이걸로 시작」을 누르면 정의 파일이 생기고,
//! 켜는 것은 그다음 결정이다 (D4 — 자동화는 전부 옵인).
//!
//! 이것이 백로그 C1(스탠드업/PR 리포트)의 실현이다.
//!
//! # 지시문은 산출물 언어를 따른다
//!
//! 지시문은 (a) 디스크에 남는 사용자 콘텐츠이고 (b) 모델에게 그대로 간다.
//! UI 언어가 아니라 `content_language` 를 따르는 이유는 `journal_draft` 와 같다 —
//! 일지는 되돌릴 수 없다.

use crate::oculpm::automation::store::{AutomationDef, AutomationKind, AutomationOutput};
use crate::oculpm::content_lang::ContentLang;

/// 씨앗 하나를 정의로 편다. `today` 는 `YYYY-MM-DD` (호출부가 주입 — 여기서
/// 시계를 읽지 않는다).
fn seed(
    id: &str,
    title: &str,
    today: &str,
    output: AutomationOutput,
    instructions: &str,
) -> AutomationDef {
    let mut def = AutomationDef::new(id, AutomationKind::Schedule, title, today);
    // **비활성으로 만든다** — 만들자마자 과금되면 "이걸로 시작" 이 아니라 함정이다.
    def.enabled = false;
    def.output = output;
    def.instructions = instructions.trim().to_string();
    def
}

/// 프로젝트 첫 자동화 진입 시 제안할 셋. 순서는 고정(주간 → 아침 → 월간).
pub fn all(lang: ContentLang, today: &str) -> Vec<AutomationDef> {
    vec![
        weekly_summary(lang, today),
        morning_brief(lang, today),
        monthly_retro(lang, today),
    ]
}

/// 이미 만든 것을 뺀 나머지 — 목록이 비면 UI 는 제안 줄을 감춘다.
pub fn missing(lang: ContentLang, today: &str, existing_ids: &[String]) -> Vec<AutomationDef> {
    all(lang, today)
        .into_iter()
        .filter(|d| !existing_ids.iter().any(|e| e == &d.id))
        .collect()
}

pub fn by_id(lang: ContentLang, today: &str, id: &str) -> Option<AutomationDef> {
    all(lang, today).into_iter().find(|d| d.id == id)
}

fn weekly_summary(lang: ContentLang, today: &str) -> AutomationDef {
    let mut def = seed(
        "weekly-dev-summary",
        lang.pick("주간 개발 요약", "Weekly development summary"),
        today,
        AutomationOutput::Journal,
        // i18n-ignore-next-line -- 모델에게 가는 지시문 본문 (UI 문자열이 아니다).
        lang.pick(
            "이번 주 git 활동과 작업 일지를 훑고 커밋·브랜치·미결 항목을 요약해 주세요.\n\
             플래너의 활성 항목과 대조해 어긋난 것이 있으면 짚어 주세요.\n\
             이미 요약한 주는 건너뛰세요 — 이 자동화는 여러 번 돌 수 있습니다.",
            "Review this week's git activity and work journal, and summarise commits, \
             branches and open items.\nCompare them against the active planner items and \
             point out anything that has drifted.\nSkip weeks you have already summarised — \
             this automation can run more than once.",
        ),
    );
    def.frequency = Some("weekly".into());
    def.at = Some("17:00".into());
    def.weekday = Some("fri".into());
    def
}

fn morning_brief(lang: ContentLang, today: &str) -> AutomationDef {
    let mut def = seed(
        "morning-brief",
        lang.pick("아침 브리핑", "Morning brief"),
        today,
        // 산출물 없음 — 실행 기록의 메모로만 남는다 (일지를 매일 늘리지 않는다).
        AutomationOutput::None,
        // i18n-ignore-next-line -- 모델에게 가는 지시문 본문.
        lang.pick(
            "어제 작업 일지와 플래너의 활성 항목을 읽고 오늘 먼저 할 일 3가지를 \
             우선순위 순으로 꼽아 주세요.\n각 항목에 왜 지금인지 한 줄씩 붙이세요. \
             근거가 없는 것은 추측하지 말고 모른다고 쓰세요.",
            "Read yesterday's work journal and the active planner items, then pick the \
             three things to do first today, in priority order.\nAdd one line per item on \
             why now. Do not guess — say so when the record does not support a claim.",
        ),
    );
    def.frequency = Some("daily".into());
    def.at = Some("09:00".into());
    def
}

fn monthly_retro(lang: ContentLang, today: &str) -> AutomationDef {
    let mut def = seed(
        "monthly-retro",
        lang.pick("월간 회고", "Monthly retrospective"),
        today,
        AutomationOutput::Journal,
        // i18n-ignore-next-line -- 모델에게 가는 지시문 본문.
        lang.pick(
            "지난달의 작업 일지와 회고 신호(출시·저항·노력 핫스팟)를 읽고 다음 달의 \
             초점 3가지를 제안해 주세요.\n무엇이 잘 됐고 무엇이 반복해서 막혔는지 \
             각각 근거가 된 일지를 함께 적으세요.\n이미 회고한 달은 건너뛰세요.",
            "Read last month's work journal and retro signals (releases, friction, effort \
             hotspots) and propose three focuses for the coming month.\nSay what went well \
             and what kept getting stuck, citing the journal entries behind each.\nSkip \
             months you have already reviewed.",
        ),
    );
    def.frequency = Some("monthly".into());
    def.at = Some("09:00".into());
    def.day_of_month = Some(1);
    def
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::automation::frequency::ScheduleSpec;

    #[test]
    fn every_seed_is_off_and_parses_as_a_schedule() {
        for def in all(ContentLang::Korean, "2026-08-31") {
            assert!(!def.enabled, "{} 이 켜진 채로 생긴다", def.id);
            assert!(!def.instructions.is_empty(), "{} 에 지시문이 없다", def.id);
            assert_eq!(def.kind, AutomationKind::Schedule);
            ScheduleSpec::from_def(&def)
                .unwrap_or_else(|e| panic!("{} 의 빈도가 해석되지 않는다: {e}", def.id));
        }
    }

    #[test]
    fn seeds_round_trip_through_the_store_in_both_languages() {
        use crate::oculpm::automation::store::{parse_automation, render_automation};
        for lang in [ContentLang::Korean, ContentLang::English] {
            for def in all(lang, "2026-08-31") {
                let back =
                    parse_automation(&render_automation(&def), &def.id, AutomationKind::Schedule);
                assert_eq!(back.def, def, "{} 왕복 실패", def.id);
                assert!(back.warnings.is_empty(), "{:?}", back.warnings);
            }
        }
    }

    #[test]
    fn missing_drops_the_ones_already_created() {
        let existing = vec!["morning-brief".to_string()];
        let rest = missing(ContentLang::Korean, "2026-08-31", &existing);
        assert_eq!(rest.len(), 2);
        assert!(!rest.iter().any(|d| d.id == "morning-brief"));
        assert!(by_id(ContentLang::Korean, "2026-08-31", "morning-brief").is_some());
        assert!(by_id(ContentLang::Korean, "2026-08-31", "nope").is_none());
    }
}

//! 씨앗 자동화 5종 — 스케줄 3(`01-automation.md` §1.4) + 워처 2(§2.2).
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

use crate::oculpm::automation::conditions::{AutomationCondition, ConditionWhen};
use crate::oculpm::automation::store::{
    AutomationDef, AutomationKind, AutomationOutput, BUILTIN_PLAN_RECONCILE_ID,
};
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

/// 프로젝트 첫 자동화 진입 시 제안할 다섯. 순서는 고정
/// (주간 → 아침 → 월간 → 정착 초안 → 플랜 화해).
pub fn all(lang: ContentLang, today: &str) -> Vec<AutomationDef> {
    vec![
        weekly_summary(lang, today),
        morning_brief(lang, today),
        monthly_retro(lang, today),
        draft_on_settle(lang, today),
        plan_reconcile(lang, today),
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
    // 「이미 요약한 주는 건너뛰세요」는 지금까지 **부탁**이었다 ({#automation-step-if}).
    // 모델은 새 일지가 0건인 주에도 빈 요약을 만들어 냈고 원장에는 `ok` 가 남았다.
    // 이제 게이트가 코드에 있다.
    def.conditions = vec![AutomationCondition::new(
        ConditionWhen::JournalCountGte,
        Some(3),
    )];
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
    // 「오늘 먼저 할 일 3가지」는 플래너에 미완 항목이 있어야 성립한다.
    def.conditions = vec![AutomationCondition::new(
        ConditionWhen::PlanHasOpenItems,
        None,
    )];
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
    def.conditions = vec![AutomationCondition::new(
        ConditionWhen::JournalCountGte,
        Some(3),
    )];
    def.frequency = Some("monthly".into());
    def.at = Some("09:00".into());
    def.day_of_month = Some(1);
    def
}

// ─────────────────────────────────────────────────────────────────────────────
// 워처 씨앗 (Phase 2 §2.2)
// ─────────────────────────────────────────────────────────────────────────────

/// 워처 씨앗 하나. 스케줄과 달리 `watch`·`responsiveness` 를 채운다.
fn watcher_seed(
    id: &str,
    title: &str,
    today: &str,
    watch: &str,
    responsiveness: &str,
    output: AutomationOutput,
    instructions: &str,
) -> AutomationDef {
    let mut def = AutomationDef::new(id, AutomationKind::Watcher, title, today);
    def.enabled = false;
    def.output = output;
    def.watch = Some(watch.to_string());
    def.recursive = Some(true);
    def.responsiveness = Some(responsiveness.to_string());
    def.instructions = instructions.trim().to_string();
    def
}

/// 「손이 멎으면 일지 초안」 — 훅이 못 보는 작업(터미널 편집·다른 도구)을 메운다.
/// `deferred`(5분)인 이유: 한 문단 쓰다 잠깐 멈춘 것을 "끝났다" 로 읽으면 안 된다.
fn draft_on_settle(lang: ContentLang, today: &str) -> AutomationDef {
    watcher_seed(
        "draft-on-settle",
        lang.pick(
            "일지 초안 (손이 멎으면)",
            "Journal draft (when your hands stop)",
        ),
        today,
        ".", // 프로젝트 루트
        "deferred",
        AutomationOutput::Journal,
        // i18n-ignore-next-line -- 모델에게 가는 지시문 본문 (UI 문자열이 아니다).
        lang.pick(
            "아래 관측 사실(이 정착 창에서 바뀐 파일과 git 작업 트리 상태)을 읽고 방금 무슨 \
             작업을 했는지 일지 본문 하나로 정리해 주세요.\n\
             파일 목록에서 읽히지 않는 것은 추측하지 말고 모른다고 쓰세요.\n\
             이미 일지로 남은 작업은 다시 쓰지 마세요 — 이 자동화는 여러 번 돌 수 있습니다.",
            "Read the observed facts below (files changed in this settle window and the git \
             working-tree state) and write one journal body describing the work just done.\n\
             Do not guess anything the file list does not support — say so instead.\n\
             Do not rewrite work that is already journalled — this automation can run more \
             than once.",
        ),
    )
}

/// 「플랜 화해」 — 새 일지가 들어오면 활성 플랜의 글리프를 갱신한다.
///
/// `watch` 가 `.oculpm/journal/` 인 것은 **사람이 읽는 선언**이다. 실제 발동은
/// 정착 채널이 아니라 일지 삽입 신호로 온다 — 정착 채널은 일지를 원인에서
/// 제외하기 때문이다(증폭 루프 가드 R1). 지시문 본문은 **설명**이다: 화해 프롬프트는
/// `planner::ai` 가 소유하고, 사용자가 여기 쓴 글이 그 프롬프트를 대신하지 않는다.
/// 그 사실을 본문 스스로 밝히게 해 "썼는데 안 먹힌다" 를 만들지 않는다.
fn plan_reconcile(lang: ContentLang, today: &str) -> AutomationDef {
    watcher_seed(
        BUILTIN_PLAN_RECONCILE_ID,
        lang.pick("플랜 화해", "Plan reconciliation"),
        today,
        ".oculpm/journal/",
        "relaxed",
        AutomationOutput::Plan,
        // i18n-ignore-next-line -- 모델에게 가는 지시문 본문.
        lang.pick(
            "새 작업 일지와 활성 플랜을 대조해 글리프 갱신을 제안합니다.\n\
             (이 자동화의 프롬프트는 앱이 소유합니다 — 이 글은 설명입니다.)",
            "Compares each new work-journal entry against the active plans and proposes \
             glyph updates.\n\
             (The app owns this automation's prompt — this text is a note.)",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::automation::frequency::ScheduleSpec;

    #[test]
    fn every_seed_is_off_and_resolves_for_its_kind() {
        use crate::oculpm::automation::tiers::responsiveness_error;
        for def in all(ContentLang::Korean, "2026-08-31") {
            assert!(!def.enabled, "{} 이 켜진 채로 생긴다", def.id);
            assert!(!def.instructions.is_empty(), "{} 에 지시문이 없다", def.id);
            match def.kind {
                AutomationKind::Schedule => {
                    ScheduleSpec::from_def(&def)
                        .unwrap_or_else(|e| panic!("{} 의 빈도가 해석되지 않는다: {e}", def.id));
                }
                AutomationKind::Watcher => {
                    assert_eq!(
                        responsiveness_error(def.responsiveness.as_deref()),
                        None,
                        "{} 의 티어가 해석되지 않는다",
                        def.id
                    );
                }
            }
        }
    }

    /// 워처 씨앗 2종이 설계 §2.2 의 표 그대로다.
    #[test]
    fn watcher_seeds_match_the_design_table() {
        let seeds = all(ContentLang::Korean, "2026-08-31");
        let draft = seeds.iter().find(|d| d.id == "draft-on-settle").unwrap();
        assert_eq!(draft.kind, AutomationKind::Watcher);
        assert_eq!(draft.watch.as_deref(), Some("."), "프로젝트 루트");
        assert_eq!(draft.responsiveness.as_deref(), Some("deferred"));
        assert_eq!(draft.output, AutomationOutput::Journal);

        let plan = seeds
            .iter()
            .find(|d| d.id == BUILTIN_PLAN_RECONCILE_ID)
            .unwrap();
        assert_eq!(plan.kind, AutomationKind::Watcher);
        assert_eq!(plan.watch.as_deref(), Some(".oculpm/journal/"));
        assert_eq!(plan.responsiveness.as_deref(), Some("relaxed"));
        assert_eq!(plan.output, AutomationOutput::Plan);
    }

    #[test]
    fn seeds_round_trip_through_the_store_in_both_languages() {
        use crate::oculpm::automation::store::{parse_automation, render_automation};
        for lang in [ContentLang::Korean, ContentLang::English] {
            for def in all(lang, "2026-08-31") {
                let back = parse_automation(&render_automation(&def), &def.id, def.kind);
                assert_eq!(back.def, def, "{} 왕복 실패", def.id);
                assert!(back.warnings.is_empty(), "{:?}", back.warnings);
            }
        }
    }

    /// 씨앗의 「이미 처리한 것은 건너뛰세요」가 **코드의 게이트**로 옮겨졌다
    /// ({#automation-step-if}). 지시문에만 남아 있으면 모델이 안 지킬 때 빈
    /// 산출물이 성공으로 기록된다 — 이 라운드가 없앤 상태가 그것이다.
    #[test]
    fn the_summary_seeds_carry_a_real_gate_not_just_a_prompt() {
        let seeds = all(ContentLang::Korean, "2026-08-31");
        for id in ["weekly-dev-summary", "monthly-retro"] {
            let def = seeds.iter().find(|d| d.id == id).unwrap();
            assert_eq!(
                def.conditions,
                vec![AutomationCondition::new(
                    ConditionWhen::JournalCountGte,
                    Some(3)
                )],
                "{id} 의 조건이 사라졌다"
            );
        }
        let brief = seeds.iter().find(|d| d.id == "morning-brief").unwrap();
        assert_eq!(
            brief.conditions,
            vec![AutomationCondition::new(
                ConditionWhen::PlanHasOpenItems,
                None
            )]
        );
        // 초안·화해 씨앗은 조건이 없다 — 파일이 멎었다는 사실 자체가 신호다.
        for id in ["draft-on-settle", BUILTIN_PLAN_RECONCILE_ID] {
            let def = seeds.iter().find(|d| d.id == id).unwrap();
            assert!(def.conditions.is_empty(), "{id} 에 조건이 붙었다");
        }
    }

    #[test]
    fn missing_drops_the_ones_already_created() {
        let existing = vec!["morning-brief".to_string()];
        let rest = missing(ContentLang::Korean, "2026-08-31", &existing);
        assert_eq!(rest.len(), 4);
        assert!(!rest.iter().any(|d| d.id == "morning-brief"));
        assert!(by_id(ContentLang::Korean, "2026-08-31", "morning-brief").is_some());
        assert!(by_id(ContentLang::Korean, "2026-08-31", "nope").is_none());
    }
}

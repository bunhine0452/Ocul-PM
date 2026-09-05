//! `watchers` 의 테스트. 본문에서 갈라 나왔다 — 파일 크기 래칫이 이 파일을
//! 짚었고, 경계가 가장 뚜렷한 덩어리가 여기였다 (`runner/tests.rs` 선례).
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use crate::oculpm::automation::settle::normalize_watch;
use std::collections::BTreeSet;

fn config(schedules: bool, watchers: bool, auto_reconcile: bool) -> OculpmConfig {
    let mut c = OculpmConfig::default_for_new_project();
    c.automation.schedules = schedules;
    c.automation.watchers = watchers;
    c.agents.auto_reconcile = auto_reconcile;
    c
}

fn watcher_def(id: &str, output: AutomationOutput, enabled: bool) -> AutomationDef {
    let mut d = AutomationDef::new(id, AutomationKind::Watcher, id, "2026-08-31");
    d.enabled = enabled;
    d.output = output;
    d.instructions = "무엇을 할지".into();
    d
}

#[test]
fn the_global_switch_hides_every_definition() {
    let defs = vec![watcher_def("a", AutomationOutput::Journal, true)];
    assert!(settle_rules(&config(true, false, false), &defs).is_empty());
    assert_eq!(settle_rules(&config(false, true, false), &defs).len(), 1);
}

#[test]
fn paused_and_plan_definitions_stay_out_of_the_settle_channel() {
    let defs = vec![
        watcher_def("off", AutomationOutput::Journal, false),
        watcher_def("plan", AutomationOutput::Plan, true),
        watcher_def("on", AutomationOutput::Journal, true),
    ];
    let rules = settle_rules(&config(false, true, false), &defs);
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].automation_id, "on");
}

/// 정의가 있으면 정의가, 없으면 레거시 플래그가 플랜 화해를 깨운다.
#[test]
fn plan_rule_prefers_the_definition_and_falls_back_to_the_legacy_flag() {
    let mut def = watcher_def("plan-reconcile", AutomationOutput::Plan, true);
    def.responsiveness = Some("relaxed".into());
    let defs = vec![def];

    let from_def = plan_rule(&config(false, true, false), &defs).unwrap();
    assert_eq!(from_def.automation_id, "plan-reconcile");
    assert_eq!(from_def.tier, Some(Responsiveness::Relaxed));

    // 전역 스위치가 꺼져 있으면 정의는 안 보이지만 레거시 플래그는 산다.
    let legacy = plan_rule(&config(false, false, true), &defs).unwrap();
    assert_eq!(legacy.automation_id, BUILTIN_PLAN_RECONCILE_ID);
    assert_eq!(legacy.tier, None, "레거시 경로에는 최소 간격이 없다");

    assert!(plan_rule(&config(false, false, false), &defs).is_none());
}

/// 설계 §3 — **증폭 루프**: 러너가 쓴 일지는 어떤 창도 열지 못한다.
#[test]
fn hub_ignores_our_own_outputs_as_a_cause() {
    let hub = WatcherAutomationHub::new();
    let now = Utc::now();
    let rules = settle_rules(
        &config(false, true, false),
        &[watcher_def("draft", AutomationOutput::Journal, true)],
    );
    hub.set_rules(1, rules, now);

    for p in [
        ".oculpm/journal/20260831/Chores/1200_chore_draft-auto.md",
        ".oculpm/planner/x.md",
        ".oculpm/automation/watchers/draft.md",
        ".oculpm/index/journal/20260831.json",
    ] {
        hub.note_event(1, p, now);
    }
    assert!(hub.next_deadline().is_none(), "창이 하나도 열리면 안 된다");
    assert!(hub
        .take_settled(1, now + ChronoDuration::hours(1))
        .is_empty());

    // 대조군 — 사용자 코드는 창을 연다.
    hub.note_event(1, "src/lib.rs", now);
    assert!(hub.next_deadline().is_some());
}

#[test]
fn rules_are_refreshed_on_ttl_and_on_demand() {
    let hub = WatcherAutomationHub::new();
    let now = Utc::now();
    assert!(hub.needs_rules(1, now), "처음 보는 프로젝트는 읽어야 한다");
    hub.set_rules(1, Vec::new(), now);
    assert!(!hub.needs_rules(1, now));
    assert!(hub.needs_rules(1, now + RULES_TTL));
    hub.invalidate_rules(1);
    assert!(hub.needs_rules(1, now), "정의가 바뀌면 즉시 다시 읽는다");
}

#[test]
fn dropping_a_definition_drops_its_open_window() {
    let hub = WatcherAutomationHub::new();
    let now = Utc::now();
    let defs = vec![watcher_def("gone", AutomationOutput::Journal, true)];
    hub.set_rules(1, settle_rules(&config(false, true, false), &defs), now);
    hub.note_event(1, "src/a.rs", now);
    assert!(hub.next_deadline().is_some());

    hub.set_rules(1, Vec::new(), now); // 정의가 사라졌다
    assert!(hub.next_deadline().is_none());
    assert!(hub
        .take_settled(1, now + ChronoDuration::hours(1))
        .is_empty());
}

#[test]
fn plan_min_interval_applies_only_to_definition_backed_rules() {
    let hub = WatcherAutomationHub::new();
    let t0 = Utc::now();
    // 레거시 플래그 — 간격 없음 (기존 동작 보존).
    assert_eq!(hub.begin_plan_run(1, None, t0), PlanGate::Go);
    hub.end_plan_run(1);
    assert_eq!(
        hub.begin_plan_run(1, None, t0 + ChronoDuration::seconds(1)),
        PlanGate::Go
    );
    hub.end_plan_run(1);

    // 정의 기반 relaxed — 최소 간격 120s.
    assert_eq!(
        hub.begin_plan_run(2, Some(Responsiveness::Relaxed), t0),
        PlanGate::Go
    );
    hub.end_plan_run(2);
    assert_eq!(
        hub.begin_plan_run(
            2,
            Some(Responsiveness::Relaxed),
            t0 + ChronoDuration::seconds(60)
        ),
        PlanGate::Throttled
    );
    assert_eq!(
        hub.begin_plan_run(
            2,
            Some(Responsiveness::Relaxed),
            t0 + ChronoDuration::seconds(121)
        ),
        PlanGate::Go
    );
}

/// 잡이 패닉해도 인플라이트 플래그는 되돌아온다 (가드가 소유한다).
#[test]
fn the_in_flight_flag_is_restored_even_on_unwind() {
    let hub = WatcherAutomationHub::new();
    let t0 = Utc::now();
    assert_eq!(hub.begin_plan_run(1, None, t0), PlanGate::Go);
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = PlanRunGuard {
            hub: &hub,
            project_id: 1,
        };
        panic!("잡이 터졌다");
    }));
    assert!(caught.is_err());
    assert_eq!(
        hub.begin_plan_run(1, None, t0 + ChronoDuration::seconds(1)),
        PlanGate::Go,
        "플래그가 켜진 채 남으면 화해가 앱 재시작까지 죽는다"
    );
}

/// 화해가 돌고 있는 동안의 새 일지는 **조용히** 넘어간다 — git 백필 한 번이
/// 수백 건을 쏟아도 원장이 드롭 행으로 뒤덮이지 않게 (옛 `reconcile_lock`).
#[test]
fn a_second_journal_during_a_reconcile_is_silently_skipped() {
    let hub = WatcherAutomationHub::new();
    let t0 = Utc::now();
    assert_eq!(hub.begin_plan_run(1, None, t0), PlanGate::Go);
    assert_eq!(
        hub.begin_plan_run(1, None, t0 + ChronoDuration::seconds(1)),
        PlanGate::Busy
    );
    hub.end_plan_run(1);
    assert_eq!(
        hub.begin_plan_run(1, None, t0 + ChronoDuration::seconds(2)),
        PlanGate::Go
    );
}

#[test]
fn window_context_lists_paths_and_git_state() {
    let mut paths = BTreeSet::new();
    paths.insert("src/a.rs".to_string());
    paths.insert("src/b.rs".to_string());
    let window = SettleWindow {
        automation_id: "draft".into(),
        started_at: DateTime::parse_from_rfc3339("2026-08-31T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        last_event_at: DateTime::parse_from_rfc3339("2026-08-31T09:05:00Z")
            .unwrap()
            .with_timezone(&Utc),
        tier: Responsiveness::Deferred,
        paths,
        events: 2,
    };
    let ctx = window_context(&window, &["M src/a.rs".to_string()]);
    assert!(ctx.contains("src/a.rs"));
    assert!(ctx.contains("src/b.rs"));
    assert!(ctx.contains("deferred"));
    assert!(ctx.contains("M src/a.rs"));
    assert!(ctx.contains("2026-08-31T09:00:00+00:00"));
}

#[test]
fn normalize_watch_is_shared_with_the_settle_module() {
    assert_eq!(normalize_watch("./src/"), "src");
}

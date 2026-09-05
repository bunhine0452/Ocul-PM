//! `store` 의 테스트. 본문에서 갈라 나왔다 — 파일 크기 래칫이 이 파일을
//! 짚었고, 경계가 가장 뚜렷한 덩어리가 여기였다 (`runner/tests.rs` 선례).
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use tempfile::tempdir;

fn sample() -> AutomationDef {
    AutomationDef {
        id: "weekly-dev-summary".into(),
        kind: AutomationKind::Schedule,
        title: "주간 개발 요약: 금요일".into(),
        enabled: true,
        // 조건 없음 = 항상 실행. 라운드트립 테스트가 이 기본값을 문다.
        conditions: Vec::new(),
        created: "2026-08-31".into(),
        updated: "2026-08-31".into(),
        frequency: Some("weekly".into()),
        at: Some("17:00".into()),
        weekday: Some("fri".into()),
        day_of_month: None,
        month: None,
        day: None,
        every: None,
        cron: None,
        watch: None,
        recursive: None,
        responsiveness: None,
        output: AutomationOutput::Journal,
        instructions: "이번 주 git 활동을 훑고 커밋·브랜치·미결 항목을 요약해 주세요.".into(),
    }
}

#[test]
fn renders_and_parses_back_identically() {
    let def = sample();
    let md = render_automation(&def);
    let parsed = parse_automation(&md, "weekly-dev-summary", AutomationKind::Schedule);
    assert_eq!(parsed.warnings, Vec::<String>::new(), "{md}");
    assert_eq!(parsed.def, def);
}

#[test]
fn watcher_fields_round_trip() {
    let mut def = AutomationDef::new(
        "plan-reconcile",
        AutomationKind::Watcher,
        "플랜 화해",
        "2026-08-31",
    );
    def.watch = Some(".oculpm/journal/".into());
    def.recursive = Some(true);
    def.responsiveness = Some("relaxed".into());
    def.output = AutomationOutput::Plan;
    def.instructions = "새 일지와 활성 플랜을 대조해 글리프 갱신을 제안하세요.".into();
    let parsed = parse_automation(
        &render_automation(&def),
        "plan-reconcile",
        AutomationKind::Watcher,
    );
    assert_eq!(parsed.def, def);
    assert!(parsed.warnings.is_empty());
}

#[test]
fn broken_input_warns_instead_of_failing() {
    let p = parse_automation("본문만 있다", "orphan", AutomationKind::Schedule);
    assert_eq!(p.def.id, "orphan");
    assert_eq!(p.def.kind, AutomationKind::Schedule);
    assert!(!p.def.enabled, "모르는 정의는 켜지 않는다");
    assert!(p.warnings.iter().any(|w| w.contains(SCHEMA_MARKER)));

    let p = parse_automation(
        "---\noculpm_automation: v1\nid: other-name\nkind: watcher\noutput: nonsense\n---\n\n지시문",
        "real-name",
        AutomationKind::Schedule,
    );
    assert_eq!(p.def.id, "real-name", "파일명이 정본이다");
    assert_eq!(p.def.kind, AutomationKind::Schedule, "디렉터리가 정본이다");
    assert_eq!(p.def.output, AutomationOutput::None);
    assert_eq!(
        p.warnings.len(),
        4,
        "id·kind·title·output 네 경고: {:?}",
        p.warnings
    );
}

#[test]
fn id_normalization_blocks_path_escapes() {
    assert_eq!(
        normalize_id("Weekly Dev Summary").as_deref(),
        Some("weekly-dev-summary")
    );
    assert_eq!(
        normalize_id("../../etc/passwd").as_deref(),
        Some("etc-passwd")
    );
    assert_eq!(normalize_id("a//b").as_deref(), Some("a-b"));
    assert_eq!(normalize_id("..."), None);
    assert_eq!(normalize_id("  "), None);

    let root = Path::new("/tmp/project");
    let p = automation_path(root, AutomationKind::Schedule, "../../escape").unwrap();
    assert!(
        p.starts_with(root.join(".oculpm/automation/schedules")),
        "{p:?}"
    );
}

#[test]
fn write_is_idempotent_and_delete_reports_presence() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let def = sample();

    assert!(write_automation(root, &def).unwrap(), "첫 쓰기는 실제 쓰기");
    assert!(
        !write_automation(root, &def).unwrap(),
        "같은 바이트면 무기록"
    );

    let mut changed = def.clone();
    changed.enabled = false;
    assert!(write_automation(root, &changed).unwrap());

    assert!(delete_automation(root, AutomationKind::Schedule, &def.id).unwrap());
    assert!(!delete_automation(root, AutomationKind::Schedule, &def.id).unwrap());
}

/// 파일 SSOT — 정의를 지우면 목록에서 사라지고, 다시 쓰면 그대로 복구된다.
#[test]
fn definitions_are_recoverable_from_disk() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    assert!(list_automations(root, AutomationKind::Schedule)
        .unwrap()
        .is_empty());
    assert!(list_automation_ids(root).unwrap().is_empty());

    let def = sample();
    write_automation(root, &def).unwrap();
    let mut watcher = AutomationDef::new(
        "plan-reconcile",
        AutomationKind::Watcher,
        "플랜 화해",
        "2026-08-31",
    );
    watcher.instructions = "대조하세요".into();
    write_automation(root, &watcher).unwrap();

    assert_eq!(
        list_automation_ids(root).unwrap(),
        vec![
            "plan-reconcile".to_string(),
            "weekly-dev-summary".to_string()
        ]
    );

    delete_automation(root, AutomationKind::Schedule, &def.id).unwrap();
    assert_eq!(
        list_automation_ids(root).unwrap(),
        vec!["plan-reconcile".to_string()]
    );

    write_automation(root, &def).unwrap();
    let back = read_automation(root, AutomationKind::Schedule, &def.id)
        .unwrap()
        .expect("복구");
    assert_eq!(back.def, def);
}

/// 내장 자동화(레거시 플랜 화해)는 정의 파일이 없어도 이력이 살아남는다.
#[test]
fn builtin_ids_survive_orphan_pruning() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    assert_eq!(
        known_ids_for_prune(root).unwrap(),
        vec![BUILTIN_PLAN_RECONCILE_ID.to_string()]
    );

    write_automation(root, &sample()).unwrap();
    let ids = known_ids_for_prune(root).unwrap();
    assert!(ids.contains(&"weekly-dev-summary".to_string()));
    assert!(ids.contains(&BUILTIN_PLAN_RECONCILE_ID.to_string()));
    // 씨앗을 만들어도 중복되지 않는다 (이력이 한 줄기로 이어진다).
    let mut seed = AutomationDef::new(
        BUILTIN_PLAN_RECONCILE_ID,
        AutomationKind::Watcher,
        "플랜 화해",
        "2026-08-31",
    );
    seed.instructions = "대조".into();
    write_automation(root, &seed).unwrap();
    let ids = known_ids_for_prune(root).unwrap();
    assert_eq!(
        ids.iter()
            .filter(|i| i.as_str() == BUILTIN_PLAN_RECONCILE_ID)
            .count(),
        1
    );
}

#[test]
fn oversized_definition_is_refused_not_sent() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let path = automation_path(root, AutomationKind::Schedule, "huge").unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "x".repeat(MAX_DEFINITION_BYTES as usize + 1)).unwrap();

    let list = list_automations(root, AutomationKind::Schedule).unwrap();
    assert_eq!(list.len(), 1);
    assert!(!list[0].def.enabled);
    assert!(list[0].def.instructions.is_empty(), "본문을 싣지 않는다");
    assert!(list[0].warnings[0].contains("바이트"));
}

// ─── 실행 조건의 wire form ({#automation-step-if}) ───────────────────────────

/// 조건은 왕복한다 — 그리고 **조건을 쓰지 않는 정의의 파일은 안 바뀐다.**
/// 바뀌면 이 라운드 때문에 모든 자동화 파일에 의미 없는 diff 가 한 줄씩 생기고
/// 멱등 쓰기 계약이 깨진다 (같은-내용 재작성이 워처를 깨운다).
#[test]
fn conditions_round_trip_and_stay_invisible_when_unused() {
    use crate::oculpm::automation::conditions::{AutomationCondition, ConditionWhen};

    let plain = sample();
    assert!(plain.conditions.is_empty());
    let rendered = render_automation(&plain);
    assert!(
        !rendered.contains("conditions"),
        "조건을 안 쓰는 정의에 키가 생겼다:\n{rendered}"
    );

    let mut with = sample();
    with.conditions = vec![
        AutomationCondition::new(ConditionWhen::JournalCountGte, Some(3)),
        AutomationCondition::new(ConditionWhen::PlanHasOpenItems, None),
        AutomationCondition::new(ConditionWhen::GitDirty, None),
    ];
    let back = parse_automation(&render_automation(&with), &with.id, with.kind);
    assert_eq!(back.def, with);
    assert!(back.warnings.is_empty(), "{:?}", back.warnings);
}

/// `conditions:` 가 없는 옛 정의는 **동작이 그대로다** (조건 없음 = 항상 실행).
/// 스키마 하위호환의 심장이라 문장 하나가 아니라 단언으로 잠근다.
#[test]
fn a_definition_written_before_conditions_existed_still_parses_and_always_runs() {
    let legacy = "---\noculpm_automation: v1\nid: weekly\nkind: schedule\n\
                  title: \"주간\"\nenabled: true\nfrequency: weekly\noutput: journal\n\
                  ---\n\n요약하세요.\n";
    let parsed = parse_automation(legacy, "weekly", AutomationKind::Schedule);
    assert!(parsed.def.conditions.is_empty());
    assert!(parsed.def.enabled);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
}

/// 손으로 고치는 파일이라 축약형(`- git_dirty`)도 받는다.
#[test]
fn the_shorthand_form_is_accepted_for_conditions_without_a_threshold() {
    use crate::oculpm::automation::conditions::ConditionWhen;

    let md = "---\noculpm_automation: v1\nid: w\nkind: schedule\ntitle: \"w\"\n\
              output: none\nconditions:\n  - git_dirty\n  - when: journal_count_gte\n    n: 2\n\
              ---\n\n본문\n";
    let parsed = parse_automation(md, "w", AutomationKind::Schedule);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    let got: Vec<_> = parsed
        .def
        .conditions
        .iter()
        .map(|c| (c.when, c.n))
        .collect();
    assert_eq!(
        got,
        vec![
            (ConditionWhen::GitDirty, None),
            (ConditionWhen::JournalCountGte, Some(2)),
        ]
    );
}

/// 오타는 **버리지 않는다.** 버리면 게이트가 조용히 열리고, 원문을 잃으면
/// 사용자가 무엇을 쓰려 했는지 알 수 없다.
#[test]
fn an_unknown_condition_is_kept_verbatim_warned_about_and_round_trips() {
    use crate::oculpm::automation::conditions::ConditionWhen;

    let md = "---\noculpm_automation: v1\nid: w\nkind: schedule\ntitle: \"w\"\n\
              output: none\nconditions:\n  - when: jornal_count_gte\n    n: 3\n---\n\n본문\n";
    let parsed = parse_automation(md, "w", AutomationKind::Schedule);
    assert_eq!(parsed.def.conditions.len(), 1);
    assert_eq!(parsed.def.conditions[0].when, ConditionWhen::Unknown);
    assert_eq!(
        parsed.def.conditions[0].raw.as_deref(),
        Some("jornal_count_gte")
    );
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("jornal_count_gte")),
        "{:?}",
        parsed.warnings
    );

    // 저장 한 번이 오타를 지우지 않는다.
    let back = parse_automation(
        &render_automation(&parsed.def),
        "w",
        AutomationKind::Schedule,
    );
    assert_eq!(back.def.conditions, parsed.def.conditions);
}

/// 목록이 아닌 `conditions:` 는 fail-soft — 정의 전체를 잃지 않는다.
#[test]
fn a_malformed_conditions_key_warns_instead_of_killing_the_definition() {
    let md = "---\noculpm_automation: v1\nid: w\nkind: schedule\ntitle: \"w\"\n\
              output: none\nconditions: journal_count_gte\n---\n\n본문\n";
    let parsed = parse_automation(md, "w", AutomationKind::Schedule);
    assert!(parsed.def.conditions.is_empty());
    assert_eq!(parsed.def.title, "w", "정의는 살아 있어야 한다");
    assert!(
        parsed.warnings.iter().any(|w| w.contains("목록")),
        "{:?}",
        parsed.warnings
    );
}

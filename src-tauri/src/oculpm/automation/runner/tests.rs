//! `runner` 의 테스트. 본문에서 갈라 나왔다 (2026-09-04) — 파일 크기
//! 래칫이 이 파일을 짚었고, 경계가 가장 뚜렷한 덩어리가 여기였다.
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use std::sync::atomic::AtomicU32;
use tempfile::{tempdir, TempDir};

/// 네트워크 없는 백엔드. `delay` 로 "실행 중" 창을 만들어 동시성을 시험한다.
struct FakeBackend {
    calls: Arc<AtomicU32>,
    delay: std::time::Duration,
    fail: bool,
    /// 서버에 닿지도 못한 실패 — `fail` 보다 우선한다.
    offline: bool,
}

impl FakeBackend {
    fn new() -> Self {
        Self {
            calls: Arc::new(AtomicU32::new(0)),
            delay: std::time::Duration::ZERO,
            fail: false,
            offline: false,
        }
    }
}

#[async_trait]
impl ChatBackend for FakeBackend {
    fn has_credentials(&self, _t: &CoreTarget) -> bool {
        true
    }

    async fn chat(
        &self,
        _t: &CoreTarget,
        _m: Vec<Message>,
        _o: ChatOptions,
    ) -> Result<ChatResponse, ChatFailure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if !self.delay.is_zero() {
            tokio::time::sleep(self.delay).await;
        }
        if self.offline {
            return Err(ChatFailure {
                message: "http: error sending request".into(),
                offline: true,
            });
        }
        if self.fail {
            return Err(ChatFailure {
                message: "provider exploded".into(),
                offline: false,
            });
        }
        Ok(ChatResponse {
            content: "요약 본문".into(),
            model: "test-model".into(),
            provider: "test".into(),
        })
    }
}

async fn db(dir: &TempDir) -> Db {
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    // 실행 행의 project_id 는 projects 를 참조한다 (FK).
    let id = db
        .create_project("p".into(), dir.path().to_string_lossy().to_string())
        .await
        .unwrap();
    assert_eq!(id, 1);
    db
}

async fn set_core_model(db: &Db) {
    db.settings_set(core_model::CORE_PROVIDER_KEY.into(), "test".into())
        .await
        .unwrap();
    db.settings_set(core_model::CORE_MODEL_KEY.into(), "test-model".into())
        .await
        .unwrap();
}

fn job(output: AutomationOutput) -> Job {
    Job {
        project_id: 1,
        automation_id: "weekly-dev-summary".into(),
        kind: AutomationKind::Schedule,
        title: "주간 개발 요약".into(),
        output,
        instructions: "이번 주를 요약하세요.".into(),
        context: None,
        entry_ref: None,
        workday: "20260831".into(),
        now: DateTime::parse_from_rfc3339("2026-08-31T17:00:00+09:00").unwrap(),
        note: None,
        // 조건 없음 = 항상 실행 (옛 정의와 같은 동작). 조건이 실제로 갈리는지는
        // conditions 쪽 전용 테스트가 문다.
        conditions: Vec::new(),
    }
}

fn ctx<'a>(db: &'a Db, manager: &'a OculpmManager, root: &std::path::Path) -> JobContext<'a> {
    JobContext {
        db,
        manager,
        root: root.to_path_buf(),
        tz: chrono_tz::UTC,
        redact: Vec::new(),
        daily_run_budget: 20,
        budget_since: "2026-08-31T00:00:00+09:00".into(),
        // 자정 시작 — 이 픽스처의 workday 계산이 예전(자정 고정)과 같게 남는다.
        day_starts_at: "00:00".into(),
    }
}

/// 발동 출처가 세션 id 접두로 드러난다 (D8).
#[test]
fn session_ids_carry_the_source_prefix() {
    let mut j = job(AutomationOutput::None);
    assert_eq!(j.session_id().as_str(), "sched-20260831-170000");
    j.kind = AutomationKind::Watcher;
    assert_eq!(j.session_id().as_str(), "auto-20260831-170000");
    assert_eq!(
        j.session_id().kind(),
        crate::oculpm::session_id::SessionKind::Automation
    );
}

/// 오프라인은 실패가 아니라 **연기**다 — 원장에 `deferred` 로 남고,
/// 일일 예산에서도 세지 않는다 (과금이 없었으므로).
#[tokio::test]
async fn an_unreachable_network_defers_instead_of_failing() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();

    let mut backend = FakeBackend::new();
    backend.offline = true;
    let runner = AutomationRunner::new(Arc::new(backend));
    let ctx = ctx(&db, &manager, dir.path());

    let outcome = runner.run(&ctx, job(AutomationOutput::None)).await;
    assert!(
        matches!(outcome, JobOutcome::Deferred(_)),
        "expected Deferred, got {outcome:?}"
    );

    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs[0].status, RUN_DEFERRED);
    // 예산은 안 태운다 — 모델에 닿지도 못했다.
    let billable = db
        .automation_billable_runs_since(1, "2026-08-31T00:00:00+09:00".into())
        .await
        .unwrap();
    assert_eq!(billable, 0);
}

/// 응답이 **온** 실패(429·401 등)는 여전히 실패다 — 그것까지 연기하면
/// 자동화가 영원히 안 돈다.
#[tokio::test]
async fn a_provider_error_is_still_a_failure() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();

    let mut backend = FakeBackend::new();
    backend.fail = true;
    let runner = AutomationRunner::new(Arc::new(backend));
    let ctx = ctx(&db, &manager, dir.path());

    let outcome = runner.run(&ctx, job(AutomationOutput::None)).await;
    assert!(matches!(outcome, JobOutcome::Failed(_)), "{outcome:?}");
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs[0].status, RUN_FAILED);
}

/// 원장 시각은 UTC 로 적힌다 — 일일 예산의 `started_at >= ?` 사전식 비교와
/// History 의 `ORDER BY started_at DESC` 가 그 전제 위에 있다.
#[test]
fn ledger_timestamps_are_utc_so_string_ordering_is_chronological() {
    let j = job(AutomationOutput::None);
    assert_eq!(j.stamp(), "2026-08-31T08:00:00+00:00");
    assert!(j.stamp().as_str() < "2026-08-31T09:00:00+00:00");
}

/// 호출부 사연(따라잡기·수동)과 결말 사유가 한 메모로 합쳐진다.
#[test]
fn caller_note_and_outcome_reason_merge() {
    let mut j = job(AutomationOutput::None);
    assert_eq!(j.merged_note(Some("사유")), Some("사유".to_string()));
    j.note = Some("missed catch-up".into());
    assert_eq!(
        j.merged_note(Some("사유")),
        Some("missed catch-up · 사유".to_string())
    );
    assert_eq!(j.merged_note(None), Some("missed catch-up".to_string()));
}

#[test]
fn journal_slug_is_always_valid_kebab() {
    assert_eq!(
        journal_slug("weekly-dev-summary"),
        "weekly-dev-summary-auto"
    );
    let long = journal_slug(&"x".repeat(80));
    assert!(long.len() <= 60 && long.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    assert_eq!(journal_slug("..."), "automation-auto");
}

/// §3 — Core Model 미설정: 자동화 전부 스킵, **에러 아님**. 모델도 안 부른다.
#[tokio::test]
async fn skips_without_a_core_model_and_never_calls_the_model() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    let manager = OculpmManager::new();
    let backend = Arc::new(FakeBackend::new());
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);

    let outcome = runner
        .run(&ctx(&db, &manager, dir.path()), job(AutomationOutput::None))
        .await;
    assert_eq!(outcome, JobOutcome::Skipped("core model not configured"));
    assert_eq!(calls.load(Ordering::SeqCst), 0, "부르지 않는다 = 과금 없음");

    // 소실 없음 — 왜 안 돌았는지가 원장에 남는다.
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, RUN_SKIPPED);
    assert!(runs[0].note.as_deref().unwrap().contains("core model"));
}

/// §3 — 동시성: 잡 2개 동시 → 1건 실행 + 1건 드롭(사유 기록).
#[tokio::test]
async fn second_concurrent_job_is_dropped_with_a_reason() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();
    let mut backend = FakeBackend::new();
    // CI 러너 기준 비동기 대기 예산은 5s (dab12ce 선례) — 여기서는 두 잡이
    // 겹치기만 하면 되므로 짧게 잡는다.
    backend.delay = std::time::Duration::from_millis(150);
    let backend = Arc::new(backend);
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);

    let c = ctx(&db, &manager, dir.path());
    let (a, b) = tokio::join!(
        runner.run(&c, job(AutomationOutput::None)),
        runner.run(&c, job(AutomationOutput::None))
    );

    let (ran, dropped) = match (&a, &b) {
        (JobOutcome::Ran { .. }, JobOutcome::Dropped(_)) => (&a, &b),
        (JobOutcome::Dropped(_), JobOutcome::Ran { .. }) => (&b, &a),
        other => panic!("정확히 1건 실행 + 1건 드롭이어야 한다: {other:?}"),
    };
    assert!(matches!(ran, JobOutcome::Ran { .. }));
    assert_eq!(
        *dropped,
        JobOutcome::Dropped("another automation is running")
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "큐를 쌓지 않는다 = 과금 1회"
    );

    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs.len(), 2, "드롭도 원장에 남는다");
    let drop_row = runs
        .iter()
        .find(|r| r.status == RUN_DROPPED)
        .expect("드롭 행");
    assert!(
        drop_row.note.as_deref().unwrap().contains("실행 중"),
        "왜 버렸는지가 남아야 한다: {:?}",
        drop_row.note
    );
}

/// 모델이 실패해도 "이 자동화가 돌았다" 는 사실은 남는다 (강등하되 소실 없음).
#[tokio::test]
async fn a_failed_model_call_still_leaves_a_run_record() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();
    let mut backend = FakeBackend::new();
    backend.fail = true;
    let runner = AutomationRunner::new(Arc::new(backend));

    let outcome = runner
        .run(&ctx(&db, &manager, dir.path()), job(AutomationOutput::None))
        .await;
    assert_eq!(outcome, JobOutcome::Failed("provider exploded".into()));

    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, RUN_FAILED);
    assert!(runs[0].ended_at.is_some(), "행이 닫혀야 한다");

    let state = db.automation_state_list(1).await.unwrap();
    assert_eq!(state[0].last_status.as_deref(), Some(RUN_FAILED));
    assert!(state[0].last_error.is_some());
}

/// 플랜 산출물은 원인이 된 일지 없이는 성립하지 않는다 — **조용히 성공한
/// 척하지 않고** 사유를 남긴다. 모델도 부르지 않는다 (#reconcile-absorb).
#[tokio::test]
async fn plan_output_without_a_cause_entry_is_skipped_with_a_reason() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();
    let backend = Arc::new(FakeBackend::new());
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);

    let outcome = runner
        .run(&ctx(&db, &manager, dir.path()), job(AutomationOutput::Plan))
        .await;
    assert_eq!(
        outcome,
        JobOutcome::Skipped("plan output needs a journal entry as its cause")
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "일반 chat 을 부르지 않는다 — 화해는 자기 호출을 쓴다"
    );
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs[0].status, RUN_SKIPPED);
    assert!(runs[0].note.as_deref().unwrap().contains("일지"));
}

/// 플랜 산출물이 원인 일지를 들고 왔지만 캐시에 없으면 화해가 비킨다 —
/// 그 사유가 그대로 원장에 적힌다 (모델 호출 0회).
#[tokio::test]
async fn plan_output_records_the_reconcile_skip_reason() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();
    let backend = Arc::new(FakeBackend::new());
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);

    let mut j = job(AutomationOutput::Plan);
    j.entry_ref = Some("20260831/Chores/1200_chore_x.md".into());
    let outcome = runner.run(&ctx(&db, &manager, dir.path()), j).await;
    assert_eq!(outcome, JobOutcome::Skipped("entry missing from cache"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs[0].status, RUN_SKIPPED);
}

/// 화해 결과 요약은 "적용 0건" 과 "실패" 를 구분한다.
#[test]
fn reconcile_summary_separates_no_op_from_failure() {
    use crate::oculpm::reconcile::PlanReconcileResult;
    assert_eq!(summarize_reconcile(&[]), "화해할 활성 플랜이 없다");
    let note = summarize_reconcile(&[
        PlanReconcileResult {
            plan_id: "a".into(),
            applied: 2,
            error: None,
        },
        PlanReconcileResult {
            plan_id: "b".into(),
            applied: 0,
            error: Some("dead key".into()),
        },
    ]);
    assert!(note.contains("플랜 2건"));
    assert!(note.contains("글리프 2건"));
    assert!(note.contains("실패 b"));
}

/// 러너 **앞에서** 걸러진 발동도 같은 문으로 원장에 남는다 (정착 트리거의
/// 중복·최소 간격 가드가 부른다). 모델은 부르지 않는다.
#[tokio::test]
async fn a_preflight_skip_lands_in_the_ledger_with_its_reason() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    let manager = OculpmManager::new();
    let backend = Arc::new(FakeBackend::new());
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);

    let mut j = job(AutomationOutput::Journal);
    j.kind = AutomationKind::Watcher;
    runner
        .record_skip(
            &ctx(&db, &manager, dir.path()),
            &j,
            "이 구간에는 이미 일지가 있다 (에이전트 우선)",
        )
        .await;

    assert_eq!(calls.load(Ordering::SeqCst), 0, "과금 없음");
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, RUN_SKIPPED);
    assert!(runs[0].ended_at.is_some(), "행이 닫힌다");
    assert!(runs[0].note.as_deref().unwrap().contains("이미 일지"));
    // 발동 출처가 세션 id 접두로 드러난다 (D8).
    assert!(runs[0].session_id.starts_with("auto-"));
}

/// 예산 0 = 전면 정지. 모델을 부르지 않고 사유를 남긴다.
#[tokio::test]
async fn zero_budget_stops_everything_with_a_reason() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();
    let backend = Arc::new(FakeBackend::new());
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(backend);
    let mut c = ctx(&db, &manager, dir.path());
    c.daily_run_budget = 0;

    let outcome = runner.run(&c, job(AutomationOutput::None)).await;
    assert_eq!(outcome, JobOutcome::Skipped("daily run budget exhausted"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let runs = db.automation_runs_list(1, None, 10).await.unwrap();
    assert!(runs[0]
        .note
        .as_deref()
        .unwrap()
        .contains("daily_run_budget"));
}

/// 예산 소진 판정은 **과금된** 실행만 센다 — 드롭·스킵은 세지 않는다.
#[tokio::test]
async fn budget_counts_billable_runs_only() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    for status in [RUN_DROPPED, RUN_SKIPPED, RUN_OK] {
        let id = db
            .automation_run_start(
                1,
                "a".into(),
                "sched-20260831-170000".into(),
                "2026-08-31T10:00:00+09:00".into(),
                status.into(),
            )
            .await
            .unwrap();
        db.automation_run_finish(
            id,
            status.into(),
            "2026-08-31T10:00:01+09:00".into(),
            None,
            None,
        )
        .await
        .unwrap();
    }
    let n = db
        .automation_billable_runs_since(1, "2026-08-31T00:00:00+09:00".into())
        .await
        .unwrap();
    assert_eq!(n, 1, "ok 하나만 과금된 실행이다");
}

/// 고아 정리 — 정의 파일이 사라지면 상태·이력도 지운다.
#[tokio::test]
async fn orphan_state_is_pruned_against_the_on_disk_definitions() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    for id in ["kept", "gone"] {
        db.automation_state_upsert(
            1,
            AutomationState {
                automation_id: id.into(),
                next_run_at: Some("2026-09-05T17:00:00+09:00".into()),
                last_run_at: None,
                last_status: None,
                last_error: None,
            },
        )
        .await
        .unwrap();
        let run = db
            .automation_run_start(
                1,
                id.into(),
                "sched-20260831-170000".into(),
                "2026-08-31T17:00:00+09:00".into(),
                RUN_OK.into(),
            )
            .await
            .unwrap();
        db.automation_run_finish(
            run,
            RUN_OK.into(),
            "2026-08-31T17:00:10+09:00".into(),
            None,
            None,
        )
        .await
        .unwrap();
    }

    let removed = db
        .automation_prune_orphans(1, vec!["kept".to_string()])
        .await
        .unwrap();
    assert_eq!(removed, 1);
    let states = db.automation_state_list(1).await.unwrap();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0].automation_id, "kept");
    assert_eq!(db.automation_runs_list(1, None, 10).await.unwrap().len(), 1);

    // 상태는 파생이다 — 통째로 비워도 정의 파일에서 재생성된다.
    assert_eq!(db.automation_prune_orphans(1, Vec::new()).await.unwrap(), 1);
    assert!(db.automation_state_list(1).await.unwrap().is_empty());
    assert!(db
        .automation_runs_list(1, None, 10)
        .await
        .unwrap()
        .is_empty());
}

// ─── 실행 조건 ({#automation-step-if}) ───────────────────────────────────────

use crate::oculpm::automation::conditions::{AutomationCondition, ConditionWhen};

/// 원장 한 줄을 그대로 읽어 온다 — 「건너뛴 사실이 이력에 남는가」를
/// 화면 없이 단언하려면 이 경로가 필요하다.
async fn last_run(db: &Db) -> crate::db::automation::AutomationRun {
    db.automation_runs_list(1, Some("weekly-dev-summary".into()), 10)
        .await
        .unwrap()
        .into_iter()
        .next()
        .expect("원장에 행이 남아야 한다")
}

/// **이 라운드의 회귀 테스트.**
///
/// 원래 버그: 「일지 3건 이상일 때만 주간 요약」이 지시문 본문의 부탁이라
/// 새 일지가 0건인 주에도 모델이 불려 나가 빈 요약을 만들었고, 원장에는
/// `ok` 가 남고 일지가 한 건 늘었다. 세 가지를 한꺼번에 잠근다:
///
/// 1. 모델을 **부르지 않는다** (빈 요약도 과금도 없다),
/// 2. 결말이 `ok` 가 아니라 `skipped` 다,
/// 3. **왜** 건너뛰었는지가 원장 메모에 관측값과 함께 남는다.
#[tokio::test]
async fn an_unmet_condition_skips_the_step_and_says_why_instead_of_faking_success() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();

    let backend = FakeBackend::new();
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(Arc::new(backend));
    let ctx = ctx(&db, &manager, dir.path());

    let mut job = job(AutomationOutput::Journal);
    job.conditions = vec![AutomationCondition::new(
        ConditionWhen::JournalCountGte,
        Some(3),
    )];

    let outcome = runner.run(&ctx, job).await;
    assert!(
        matches!(outcome, JobOutcome::Skipped(_)),
        "조건이 안 맞으면 건너뛴다: {outcome:?}"
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "모델을 불렀다 — 빈 요약을 만들고 과금됐다는 뜻이다"
    );

    let run = last_run(&db).await;
    assert_eq!(run.status, RUN_SKIPPED, "성공이라 말하면 안 된다");
    assert_eq!(run.journal_path, None, "일지가 생겼다");
    let note = run.note.expect("건너뛴 사유가 남아야 한다");
    assert!(note.contains("조건 미충족"), "{note}");
    assert!(
        note.contains("0건"),
        "관측값이 없으면 왜인지 모른다: {note}"
    );
    assert!(
        note.contains("3건 이상"),
        "필요값이 없으면 고칠 수 없다: {note}"
    );
}

/// 조건이 맞으면 평소대로 돈다 — 게이트가 문을 잠그기만 하면 안 된다.
#[tokio::test]
async fn a_met_condition_lets_the_step_run() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();

    let backend = FakeBackend::new();
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(Arc::new(backend));
    let ctx = ctx(&db, &manager, dir.path());

    let mut gated = job(AutomationOutput::None);
    // `n: 0` 은 「0건 이상」이 아니다 — threshold() 가 1로 올린다.
    gated.conditions = vec![AutomationCondition::new(
        ConditionWhen::JournalCountGte,
        Some(0),
    )];
    let blocked = runner.run(&ctx, gated).await;
    assert!(matches!(blocked, JobOutcome::Skipped(_)), "{blocked:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    // 조건이 아예 없으면 예전처럼 돈다 (기존 정의의 동작 보존).
    let outcome = runner.run(&ctx, job(AutomationOutput::None)).await;
    assert!(matches!(outcome, JobOutcome::Ran { .. }), "{outcome:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(last_run(&db).await.status, RUN_OK);
}

/// 읽지 못한 조건은 **막는다**. 통과시키면 오타 하나가 게이트를 열고,
/// 있다고 믿는 게이트는 없는 것보다 나쁘다.
#[tokio::test]
async fn an_unreadable_condition_blocks_the_run_and_names_the_typo() {
    let dir = tempdir().unwrap();
    let db = db(&dir).await;
    set_core_model(&db).await;
    let manager = OculpmManager::new();

    let backend = FakeBackend::new();
    let calls = backend.calls.clone();
    let runner = AutomationRunner::new(Arc::new(backend));
    let ctx = ctx(&db, &manager, dir.path());

    let mut job = job(AutomationOutput::Journal);
    job.conditions = vec![AutomationCondition::unknown("jornal_count_gte")];

    assert!(matches!(
        runner.run(&ctx, job).await,
        JobOutcome::Skipped(_)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let note = last_run(&db).await.note.unwrap();
    assert!(note.contains("jornal_count_gte"), "{note}");
}

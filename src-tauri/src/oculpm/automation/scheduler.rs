//! 집행 루프 — 시계를 보고 잡을 넣는 상주 태스크.
//!
//! `supervisor.rs` 와 같은 결의 틱 루프다. 매 틱마다 열려 있는 프로젝트를 돌며
//! "지금 돌아야 할 스케줄" 을 찾아 [`runner`](super::runner) 에 넘긴다.
//!
//! # 발동 조건은 AND 다
//!
//! `config.toml [automation] schedules` (프로젝트 전역 스위치) **그리고** 정의
//! 파일의 `enabled`. 둘 중 하나라도 꺼져 있으면 돌지 않는다 — 전역 스위치
//! 하나로 프로젝트의 모든 자동화를 즉시 멈출 수 있어야 하기 때문이다 (D4).
//!
//! # 놓친 실행은 **최대 1회**만 따라잡는다
//!
//! 맥이 자고 있었거나 앱이 안 떠 있었으면 밀린 발동이 여럿 생긴다. 3일 꺼져
//! 있었다고 3번 도는 것은 폭주다. 그래서 밀린 것을 세지 않는다 —
//! [`ScheduleSpec::next_run_after`](super::frequency::ScheduleSpec::next_run_after)
//! 는 언제 물어도 **미래의 첫 시각 하나**만 내므로, 한 번 돌리고 다음 시각을
//! 지금 기준으로 다시 계산하면 밀린 나머지는 자연히 사라진다. 따라잡은 실행은
//! `note = "missed catch-up"` 으로 History 에서 구분된다.
//!
//! # 다음 시각을 **먼저** 밀고 나서 돌린다
//!
//! 실행이 실패해도 `next_run_at` 은 이미 미래다. 순서를 뒤집으면 실패하는
//! 자동화가 매 틱 재발동해 예산을 태운다.

use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use chrono_tz::Tz;
use tauri::{AppHandle, Manager};

use tauri_specta::Event;

use crate::commands::automation::AutomationRunChanged;
use crate::db::automation::AutomationState;
use crate::db::Db;
use crate::oculpm::automation::frequency::ScheduleSpec;
use crate::oculpm::automation::runner::{AutomationRunner, Job, JobContext, JobOutcome};
use crate::oculpm::automation::store::{self, AutomationDef, AutomationKind};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::OculpmConfig;

/// 틱 주기. 분 단위 스케줄(`minutes: 1`)도 한 틱 안에 잡히도록 30초.
/// 잠든 노트북에서 초당 깨어날 이유는 없다 (supervisor 의 60초와 같은 판단).
const TICK: Duration = Duration::from_secs(30);

/// 이 시간보다 더 늦게 발동하면 "따라잡기" 로 표시한다. 정상 발동은 한 틱
/// (30초) 안에 잡히므로 5분이면 여유롭게 구분된다.
const CATCH_UP_AFTER: chrono::Duration = chrono::Duration::minutes(5);

/// 상주 집행자를 띄운다 (앱 시작 시 1회, 감독관과 같은 자리).
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(TICK).await;
            if let Err(e) = tick(&handle, Utc::now()).await {
                tracing::warn!(target: "oculpm::automation", error = %e, "scheduler tick failed");
            }
        }
    });
}

/// 한 틱. 시각을 주입받는다 — 테스트가 "3일 뒤" 를 그냥 건네준다.
pub async fn tick(app: &AppHandle, now: DateTime<Utc>) -> Result<(), String> {
    let manager = app.state::<OculpmManager>();
    let projects = manager.current_workdays().await;
    for (project_id, workday) in projects {
        if let Err(e) = tick_project(app, project_id, &workday, now).await {
            tracing::warn!(
                target: "oculpm::automation",
                project_id,
                error = %e,
                "scheduler tick failed for project"
            );
        }
    }
    Ok(())
}

async fn tick_project(
    app: &AppHandle,
    project_id: u32,
    workday: &str,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let manager = app.state::<OculpmManager>();
    let db = app.state::<Db>();

    let config = manager
        .get_config(project_id)
        .await
        .map_err(|e| e.to_string())?;
    // 전역 스위치가 꺼져 있으면 정의를 읽지도 않는다 (D4 — 즉시 전면 정지).
    if !config.automation.schedules {
        return Ok(());
    }
    let root = std::path::PathBuf::from(
        db.get_project(project_id)
            .await
            .map_err(|e| e.to_string())?
            .root_path,
    );
    let tz: Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);

    let defs =
        store::list_automations(&root, AutomationKind::Schedule).map_err(|e| e.to_string())?;
    let states = db
        .automation_state_list(project_id)
        .await
        .map_err(|e| e.to_string())?;

    for parsed in defs {
        let def = parsed.def;
        let state = states.iter().find(|s| s.automation_id == def.id).cloned();
        if let Some(due) = due_now(&db, project_id, &def, state, tz, now).await? {
            run_due(app, project_id, workday, &config, &def, due, now).await;
        }
    }
    Ok(())
}

/// 이 정의가 지금 돌아야 하는가. `Some(scheduled_at)` = 돌 시각(과거).
///
/// 부수효과로 `next_run_at` 을 갱신한다 — 돌아야 하면 **미래로 먼저 밀고**,
/// 처음 보는 정의면 계산만 해서 적는다(이번 틱에는 돌지 않는다).
async fn due_now(
    db: &Db,
    project_id: u32,
    def: &AutomationDef,
    state: Option<AutomationState>,
    tz: Tz,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    let existing_next = state.as_ref().and_then(|s| s.next_run_at.clone());

    // 꺼진 정의는 상태를 건드리지 않는다 — 다시 켜면 그때 새로 계산한다.
    if !def.enabled {
        if existing_next.is_some() {
            write_next(db, project_id, def, state, None).await?;
        }
        return Ok(None);
    }

    let spec = match ScheduleSpec::from_def(def) {
        Ok(s) => s,
        Err(code) => {
            // 해석 못 하는 정의는 조용히 사라지지 않는다 — 사유를 상태에 적어
            // 자동화 탭이 그대로 보여 준다. 매 틱 다시 쓰지는 않는다.
            if state.as_ref().and_then(|s| s.last_error.as_deref()) != Some(code) {
                db.automation_state_upsert(
                    project_id,
                    AutomationState {
                        automation_id: def.id.clone(),
                        next_run_at: None,
                        last_run_at: state.as_ref().and_then(|s| s.last_run_at.clone()),
                        last_status: Some("failed".into()),
                        last_error: Some(code.to_string()),
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
            }
            return Ok(None);
        }
    };

    let Some(next_raw) = existing_next else {
        // 처음 보는 정의(또는 방금 켠 것) — 다음 시각만 적고 이번엔 넘어간다.
        // 켜자마자 과거 시각으로 즉시 도는 것은 사용자가 기대한 바가 아니다.
        let next = spec.next_run_after(tz, now);
        write_next(db, project_id, def, state, next).await?;
        return Ok(None);
    };
    let Ok(scheduled) = DateTime::parse_from_rfc3339(&next_raw) else {
        // 상태 행이 깨졌다 — 파생 캐시이므로 다시 계산한다.
        let next = spec.next_run_after(tz, now);
        write_next(db, project_id, def, state, next).await?;
        return Ok(None);
    };
    let scheduled = scheduled.with_timezone(&Utc);
    if scheduled > now {
        return Ok(None);
    }

    // 돌 차례다. **먼저** 다음 시각을 미래로 민다 — 실패해도 매 틱 재발동하지
    // 않게. 밀린 나머지는 `next_run_after(now)` 가 알아서 건너뛴다 (따라잡기 1회).
    let next = spec.next_run_after(tz, now);
    write_next(db, project_id, def, state, next).await?;
    Ok(Some(scheduled))
}

async fn write_next(
    db: &Db,
    project_id: u32,
    def: &AutomationDef,
    prev: Option<AutomationState>,
    next: Option<DateTime<Utc>>,
) -> Result<(), String> {
    let prev = prev.unwrap_or(AutomationState {
        automation_id: def.id.clone(),
        next_run_at: None,
        last_run_at: None,
        last_status: None,
        last_error: None,
    });
    db.automation_state_upsert(
        project_id,
        AutomationState {
            next_run_at: next.map(|d| d.to_rfc3339()),
            // 해석이 다시 성공했으면 옛 오류를 지운다.
            last_error: if next.is_some() {
                None
            } else {
                prev.last_error
            },
            ..prev
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
async fn run_due(
    app: &AppHandle,
    project_id: u32,
    workday: &str,
    config: &OculpmConfig,
    def: &AutomationDef,
    scheduled: DateTime<Utc>,
    now: DateTime<Utc>,
) {
    let tz: Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);
    let note = (now - scheduled > CATCH_UP_AFTER).then(|| "missed catch-up".to_string());
    let job = Job {
        project_id,
        automation_id: def.id.clone(),
        kind: def.kind,
        title: def.title.clone(),
        output: def.output,
        instructions: def.instructions.clone(),
        context: None,
        entry_ref: None,
        workday: workday.to_string(),
        now: now.with_timezone(&tz).fixed_offset(),
        note,
    };
    let outcome = run_job(app, config, workday, tz, job).await;
    tracing::info!(
        target: "oculpm::automation",
        project_id,
        automation_id = %def.id,
        ?outcome,
        "[FLOW] schedule fired"
    );
}

/// 잡 하나를 러너에 넘긴다. 「지금 실행」·정착 트리거도 **같은 문**을 쓴다 —
/// 예산·동시성·락 규약이 경로마다 갈라지지 않게.
pub async fn run_job(
    app: &AppHandle,
    config: &OculpmConfig,
    workday: &str,
    tz: Tz,
    job: Job,
) -> JobOutcome {
    let db = app.state::<Db>();
    let manager = app.state::<OculpmManager>();
    let runner = app.state::<AutomationRunner>();
    let root = match project_root(&db, job.project_id).await {
        Ok(r) => r,
        Err(e) => return JobOutcome::Failed(e),
    };
    let ctx = job_context(&db, &manager, root, config, workday, tz);

    // 시작/종료를 알린다 — 설정 자동화 탭과 닥터가 폴링 없이 「실행 중…」을
    // 켜고 끈다. 드롭된 발동도 시작→종료 한 쌍을 낸다: 아무 신호도 없으면
    // "눌렀는데 아무 일도 안 일어났다" 가 되고, 그것이 이 라운드가 없애려는
    // 바로 그 상태다.
    let (job_project_id, job_automation_id, job_kind) =
        (job.project_id, job.automation_id.clone(), job.kind);
    let changed = |running: bool, status: Option<String>| AutomationRunChanged {
        project_id: job_project_id,
        automation_id: job_automation_id.clone(),
        kind: job_kind.as_str().to_string(),
        running,
        status,
    };
    let _ = changed(true, None).emit(app);
    let outcome = runner.run(&ctx, job).await;
    let _ = changed(false, Some(outcome_status(&outcome).to_string())).emit(app);
    outcome
}

/// 이벤트에 싣는 결말 이름 — 「지금 실행」 커맨드의 `status` 문자열과 **같은
/// 어휘**다 (프런트가 한 벌의 i18n 키로 읽는다).
fn outcome_status(outcome: &JobOutcome) -> &'static str {
    match outcome {
        JobOutcome::Ran { .. } => "ran",
        JobOutcome::Dropped(_) => "dropped",
        JobOutcome::Skipped(_) => "skipped",
        JobOutcome::Failed(_) => "failed",
        JobOutcome::Cancelled => "cancelled",
    }
}

/// 러너 **앞에서** 걸러진 발동을 원장에 남긴다 (정착 트리거의 중복·최소 간격
/// 가드). 사유의 모양이 경로마다 갈라지면 History 를 읽을 수 없으므로 스킵도
/// 같은 문을 지난다.
pub async fn record_skip(
    app: &AppHandle,
    config: &OculpmConfig,
    workday: &str,
    tz: Tz,
    job: Job,
    reason: &str,
) {
    let db = app.state::<Db>();
    let manager = app.state::<OculpmManager>();
    let runner = app.state::<AutomationRunner>();
    let root = project_root(&db, job.project_id).await.unwrap_or_default();
    let ctx = job_context(&db, &manager, root, config, workday, tz);
    runner.record_skip(&ctx, &job, reason).await;
}

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    Ok(std::path::PathBuf::from(
        db.get_project(project_id)
            .await
            .map_err(|e| e.to_string())?
            .root_path,
    ))
}

fn job_context<'a>(
    db: &'a Db,
    manager: &'a OculpmManager,
    root: std::path::PathBuf,
    config: &OculpmConfig,
    workday: &str,
    tz: Tz,
) -> JobContext<'a> {
    JobContext {
        db,
        manager,
        root,
        tz,
        redact: crate::oculpm::redact::compile_redact_patterns(&config.git.auto_redact_patterns),
        daily_run_budget: config.automation.daily_run_budget,
        budget_since: workday_start(tz, workday, &config.workday.day_starts_at)
            .map(|d| d.to_rfc3339())
            .unwrap_or_default(),
    }
}

/// 일일 예산 창의 시작 — 그 워크데이가 시작한 순간(UTC).
///
/// 자정이 아니라 `workday.day_starts_at` 이다: 새벽 3시에 하루를 시작하는
/// 사용자에게 예산이 02:59 에 리셋되면 한밤중 작업이 두 날에 걸쳐 세어진다.
pub fn workday_start(tz: Tz, workday: &str, day_starts_at: &str) -> Option<DateTime<Utc>> {
    let date = chrono::NaiveDate::parse_from_str(workday, "%Y%m%d").ok()?;
    let (h, m) = day_starts_at.split_once(':')?;
    let naive = date.and_hms_opt(h.trim().parse().ok()?, m.trim().parse().ok()?, 0)?;
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(early, _) => Some(early.with_timezone(&Utc)),
        // 워크데이 시작 시각이 DST 구멍에 빠졌다 — 그 날 자정을 쓴다.
        chrono::LocalResult::None => tz
            .from_local_datetime(&date.and_hms_opt(0, 0, 0)?)
            .earliest()
            .map(|dt| dt.with_timezone(&Utc)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEOUL: Tz = chrono_tz::Asia::Seoul;

    #[test]
    fn workday_start_follows_day_starts_at_not_midnight() {
        let s = workday_start(SEOUL, "20260831", "03:00").unwrap();
        assert_eq!(
            s.with_timezone(&SEOUL).format("%Y-%m-%d %H:%M").to_string(),
            "2026-08-31 03:00"
        );
        let midnight = workday_start(SEOUL, "20260831", "00:00").unwrap();
        assert_eq!(
            midnight.with_timezone(&SEOUL).format("%H:%M").to_string(),
            "00:00"
        );
        assert!(workday_start(SEOUL, "not-a-day", "00:00").is_none());
        assert!(workday_start(SEOUL, "20260831", "nope").is_none());
    }

    /// 정상 발동과 따라잡기의 경계. 한 틱(30초) 늦은 것은 따라잡기가 아니다.
    #[test]
    fn only_a_long_delay_counts_as_catch_up() {
        let scheduled = DateTime::parse_from_rfc3339("2026-08-31T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let on_time = scheduled + chrono::Duration::seconds(20);
        let late = scheduled + chrono::Duration::days(3);
        assert!(on_time - scheduled <= CATCH_UP_AFTER);
        assert!(late - scheduled > CATCH_UP_AFTER);
    }
}

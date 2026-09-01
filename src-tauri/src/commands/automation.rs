//! 자동화 커맨드 — 정의 CRUD · 실행 기록 · 지금 실행 · 씨앗 제안.
//!
//! 정의는 온디스크가 SSOT 다 (D1). 그래서 목록/저장은 파일을 읽고 쓰고,
//! SQLite 는 런타임 상태(`next_run_at` · 마지막 실행)만 곁들인다 — 두 소스가
//! 어긋나면 **파일이 이긴다**.
//!
//! 오류는 전부 `AppError { code, detail }` 이고 `code` 는 프런트가 i18n 키로
//! 바꿀 snake_case 식별자다 (완성도 라운드 `#error-convention`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};

use crate::app_error::AppError;
use crate::db::automation::RUN_FAILED;
use crate::db::Db;
use crate::oculpm::automation::frequency::ScheduleSpec;
use crate::oculpm::automation::runner::{AutomationRunner, Job, JobOutcome};
use crate::oculpm::automation::settle::watch_error;
use crate::oculpm::automation::store::{AutomationDef, AutomationKind};
use crate::oculpm::automation::tiers::responsiveness_error;
use crate::oculpm::automation::{scheduler, seeds, store};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::OculpmConfig;

/// 정의 + 런타임 상태 한 벌. 카드 하나가 필요로 하는 전부다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AutomationSummary {
    pub def: AutomationDef,
    /// 파서 경고 (정의는 살아 있되 어긋난 것). 조용히 삼키지 않는다.
    pub warnings: Vec<String>,
    /// ISO8601 UTC. 스케줄만, 그리고 켜져 있을 때만.
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    /// 마지막 실행의 실패 사유 또는 빈도 해석 오류 코드.
    pub last_error: Option<String>,
    /// 빈도를 해석하지 못한 이유 (`automation_bad_time` 등). 프런트가 i18n 키로.
    pub spec_error: Option<String>,
}

/// 실행 이력 한 줄 (`automation_runs`).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AutomationRunDto {
    /// rowid 를 **문자열**로 넘긴다 — specta 는 정밀도 손실을 막으려 i64 를
    /// 거부하고, 프런트는 이 값을 목록 key 로만 쓴다 (산술 없음).
    pub id: String,
    pub automation_id: String,
    pub session_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    /// 산출 일지의 프로젝트 상대 경로 — 클릭하면 일지 화면으로 점프한다.
    pub journal_path: Option<String>,
    pub note: Option<String>,
}

/// 닥터 한 칸이 필요로 하는 자동화 상태 전부 (Phase 3 `#doctor-automation`).
///
/// 프런트가 `automation_list` + `automation_runs` 를 다시 접어 만들 수도 있지만,
/// **예산 창의 시작 시각**(워크데이 시작 = `day_starts_at`)은 러너가 쓰는 값과
/// 한 글자도 달라선 안 된다 — 두 벌로 계산하면 화면이 "12/20" 이라 말하는데
/// 실제로는 이미 소진된 상태가 생긴다. 그래서 여기서 한 번만 센다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AutomationOverview {
    /// 프로젝트 전역 스위치 (`config.toml [automation]`).
    pub schedules_on: bool,
    pub watchers_on: bool,
    /// 켜져 있고 스펙이 성립하는 정의 수 — 실제로 돌 수 있는 것만 센다.
    pub active_schedules: u32,
    pub active_watchers: u32,
    /// 활성 스케줄 중 가장 이른 다음 실행 (ISO8601 UTC).
    pub next_run_at: Option<String>,
    /// 활성 워처의 반응성 티어 (중복 제거, 정의 순).
    pub watcher_tiers: Vec<String>,
    /// 켜져 있는데 스펙이 깨져 못 도는 정의 수. 0 이 아니면 조용히 안 돈다.
    pub broken: u32,
    /// 오늘 워크데이에 **과금된** 실행 수 (드롭·스킵 제외) / 예산.
    pub used_today: u32,
    pub daily_run_budget: u32,
    /// 가장 최근 실패 1건. 없으면 `None`.
    pub last_failure: Option<AutomationRunDto>,
    /// 지금 러너가 돌리고 있는 자동화 id. 러너는 **프로세스 전역**이라 다른
    /// 프로젝트의 잡일 수도 있다 — 그래서 project_id 를 함께 싣는다.
    pub running_automation_id: Option<String>,
    pub running_project_id: Option<u32>,
}

/// 자동화 실행이 시작/종료됐다 — 설정 자동화 탭과 닥터가 폴링 없이 안다.
/// 러너가 전역 1건이므로 페이로드도 전역이다 (프로젝트 필터는 프런트 몫).
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct AutomationRunChanged {
    pub project_id: u32,
    pub automation_id: String,
    /// `schedule` | `watcher`.
    pub kind: String,
    /// true = 시작, false = 끝.
    pub running: bool,
    /// 끝났을 때의 결말 (`ran`/`dropped`/`skipped`/`failed`/`cancelled`).
    pub status: Option<String>,
}

/// 「지금 실행」의 결말. 프런트는 `status` 로 토스트 문구를 고른다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AutomationRunOutcome {
    /// `ran` | `dropped` | `skipped` | `failed` | `cancelled`
    pub status: String,
    /// 기계가 읽는 사유 코드/원문 (영어). UI 언어를 넣지 않는다.
    pub reason: Option<String>,
    pub journal_path: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통
// ─────────────────────────────────────────────────────────────────────────────

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, AppError> {
    Ok(PathBuf::from(
        db.get_project(project_id)
            .await
            .map_err(AppError::from)?
            .root_path,
    ))
}

async fn project_config(
    manager: &OculpmManager,
    project_id: u32,
) -> Result<OculpmConfig, AppError> {
    manager.get_config(project_id).await.map_err(AppError::from)
}

fn parse_kind(raw: &str) -> Result<AutomationKind, AppError> {
    AutomationKind::parse(raw).ok_or_else(|| AppError::new("automation_bad_kind", raw))
}

/// 정의가 **돌 수 있는가**. 못 하면 코드를 돌려준다 (경고이지 실패가 아니다).
/// 스케줄은 빈도를, 워처는 감시 경로와 티어를 본다 — 둘 다 조용히 안 도는
/// 자동화를 만들 수 있는 필드다.
fn spec_error(def: &AutomationDef) -> Option<String> {
    match def.kind {
        AutomationKind::Schedule => ScheduleSpec::from_def(def).err().map(str::to_string),
        AutomationKind::Watcher => watch_error(def.watch.as_deref())
            .or_else(|| responsiveness_error(def.responsiveness.as_deref()))
            .map(str::to_string),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────────────────────

/// 이 프로젝트의 모든 자동화 정의 + 상태. 스케줄 먼저, 그 안에서 id 순.
#[tauri::command]
#[specta::specta]
pub async fn automation_list(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<AutomationSummary>, AppError> {
    let root = project_root(&db, project_id).await?;
    let states = db
        .automation_state_list(project_id)
        .await
        .map_err(AppError::from)?;

    let mut out = Vec::new();
    for kind in AutomationKind::ALL {
        for parsed in store::list_automations(&root, kind).map_err(AppError::from)? {
            let state = states.iter().find(|s| s.automation_id == parsed.def.id);
            out.push(AutomationSummary {
                spec_error: spec_error(&parsed.def),
                next_run_at: state.and_then(|s| s.next_run_at.clone()),
                last_run_at: state.and_then(|s| s.last_run_at.clone()),
                last_status: state.and_then(|s| s.last_status.clone()),
                last_error: state.and_then(|s| s.last_error.clone()),
                def: parsed.def,
                warnings: parsed.warnings,
            });
        }
    }
    Ok(out)
}

/// 실행 이력, 시각 역순. `automation_id` 가 없으면 프로젝트 전체.
#[tauri::command]
#[specta::specta]
pub async fn automation_runs(
    db: State<'_, Db>,
    project_id: u32,
    automation_id: Option<String>,
    limit: u32,
) -> Result<Vec<AutomationRunDto>, AppError> {
    let rows = db
        .automation_runs_list(project_id, automation_id, limit)
        .await
        .map_err(AppError::from)?;
    Ok(rows
        .into_iter()
        .map(|r| AutomationRunDto {
            id: r.id.to_string(),
            automation_id: r.automation_id,
            session_id: r.session_id,
            started_at: r.started_at,
            ended_at: r.ended_at,
            status: r.status,
            journal_path: r.journal_path,
            note: r.note,
        })
        .collect())
}

/// 닥터·자동화 탭이 한 번에 읽는 요약. 정의는 파일, 예산은 원장, 실행 중
/// 여부는 러너에서 온다.
#[tauri::command]
#[specta::specta]
pub async fn automation_overview(
    app: AppHandle,
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<AutomationOverview, AppError> {
    let items = automation_list(db.clone(), project_id).await?;
    let counts = count_definitions(&items);
    let config = project_config(&manager, project_id).await?;

    // 예산 창은 러너와 **같은 함수**로 연다 (자정이 아니라 `day_starts_at`).
    let workday = manager
        .current_workday(project_id)
        .await
        .map_err(AppError::from)?;
    let tz: chrono_tz::Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);
    let since = scheduler::workday_start(tz, &workday, &config.workday.day_starts_at)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();
    let used_today = db
        .automation_billable_runs_since(project_id, since)
        .await
        .map_err(AppError::from)?;

    // 실패는 드물다 — 최근 100건 안에 없으면 "최근 실패 없음" 이 참에 가깝다.
    let last_failure = db
        .automation_runs_list(project_id, None, 100)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .find(|r| r.status == RUN_FAILED)
        .map(|r| AutomationRunDto {
            id: r.id.to_string(),
            automation_id: r.automation_id,
            session_id: r.session_id,
            started_at: r.started_at,
            ended_at: r.ended_at,
            status: r.status,
            journal_path: r.journal_path,
            note: r.note,
        });

    let running = app.state::<AutomationRunner>().running();
    Ok(AutomationOverview {
        schedules_on: config.automation.schedules,
        watchers_on: config.automation.watchers,
        active_schedules: counts.active_schedules,
        active_watchers: counts.active_watchers,
        next_run_at: counts.next_run_at,
        watcher_tiers: counts.watcher_tiers,
        broken: counts.broken,
        used_today,
        daily_run_budget: config.automation.daily_run_budget,
        last_failure,
        running_automation_id: running.as_ref().map(|(_, id)| id.clone()),
        running_project_id: running.map(|(pid, _)| pid),
    })
}

/// 정의 목록을 닥터 한 줄짜리 숫자로 접는다 — **순수**라 DB 없이 시험한다.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DefinitionCounts {
    pub active_schedules: u32,
    pub active_watchers: u32,
    pub next_run_at: Option<String>,
    pub watcher_tiers: Vec<String>,
    pub broken: u32,
}

/// 셈의 규칙: **켜져 있고 스펙이 성립하는 것만** 활성이다. 켜져 있는데 스펙이
/// 깨진 것은 `broken` 으로 따로 센다 — 활성에 넣으면 "3개 돌고 있다" 는데
/// 하나도 안 도는 화면이 된다.
pub fn count_definitions(items: &[AutomationSummary]) -> DefinitionCounts {
    let mut out = DefinitionCounts::default();
    for item in items {
        if !item.def.enabled {
            continue;
        }
        if item.spec_error.is_some() {
            out.broken += 1;
            continue;
        }
        match item.def.kind {
            AutomationKind::Schedule => {
                out.active_schedules += 1;
                if let Some(next) = item.next_run_at.as_ref() {
                    // ISO8601 UTC 는 사전식 비교가 시간순과 같다.
                    if out.next_run_at.as_ref().is_none_or(|cur| next < cur) {
                        out.next_run_at = Some(next.clone());
                    }
                }
            }
            AutomationKind::Watcher => {
                out.active_watchers += 1;
                let tier = item.def.responsiveness.as_deref().unwrap_or("balanced");
                if !out.watcher_tiers.iter().any(|t| t == tier) {
                    out.watcher_tiers.push(tier.to_string());
                }
            }
        }
    }
    out
}

/// 아직 만들지 않은 씨앗들. 빈 목록이면 UI 는 제안 줄을 감춘다.
#[tauri::command]
#[specta::specta]
pub async fn automation_seeds(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<AutomationDef>, AppError> {
    let root = project_root(&db, project_id).await?;
    let existing = store::list_automation_ids(&root).map_err(AppError::from)?;
    let lang = crate::oculpm::content_lang::current(&db).await;
    Ok(seeds::missing(lang, &today(), &existing))
}

/// 오늘(로컬 캘린더) — 정의의 `created`/`updated` 에 적는다.
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────────────────────

/// 정의를 저장한다 (없으면 생성). 반환값은 저장 후 다시 읽은 상태 —
/// **디스크가 정본**이라 UI 가 자기 입력이 아니라 저장 결과를 그린다.
#[tauri::command]
#[specta::specta]
pub async fn automation_save(
    db: State<'_, Db>,
    project_id: u32,
    def: AutomationDef,
) -> Result<AutomationSummary, AppError> {
    let root = project_root(&db, project_id).await?;
    let mut def = def;
    def.id = store::normalize_id(&def.id)
        .ok_or_else(|| AppError::new("automation_bad_id", def.id.clone()))?;
    if def.title.trim().is_empty() {
        return Err(AppError::code("automation_title_required"));
    }
    if def.instructions.trim().is_empty() {
        return Err(AppError::code("automation_instructions_required"));
    }
    // 켜려면 빈도가 해석돼야 한다 — 못 도는 자동화를 켠 것처럼 보이게 두지 않는다.
    if def.enabled {
        if let Some(code) = spec_error(&def) {
            return Err(AppError::code(code));
        }
    }
    def.updated = today();
    if def.created.trim().is_empty() {
        def.created = def.updated.clone();
    }
    store::write_automation(&root, &def).map_err(AppError::from)?;
    // 정의가 바뀌면 다음 시각을 다시 계산해야 한다 — 상태 행을 지워 집행 루프가
    // 새로 잡게 한다 (상태는 파생 캐시라 지워도 무해하다).
    clear_next_run(&db, project_id, &def.id).await?;
    summary_of(&db, project_id, &root, def.kind, &def.id).await
}

/// 정의를 지운다. 상태·이력도 함께 정리한다 (파일이 SSOT).
#[tauri::command]
#[specta::specta]
pub async fn automation_delete(
    db: State<'_, Db>,
    project_id: u32,
    kind: String,
    id: String,
) -> Result<bool, AppError> {
    let root = project_root(&db, project_id).await?;
    let removed =
        store::delete_automation(&root, parse_kind(&kind)?, &id).map_err(AppError::from)?;
    let known = store::known_ids_for_prune(&root).map_err(AppError::from)?;
    db.automation_prune_orphans(project_id, known)
        .await
        .map_err(AppError::from)?;
    Ok(removed)
}

/// 일시중지 / 재개. 파일의 `enabled` 한 글자만 바꾼다.
#[tauri::command]
#[specta::specta]
pub async fn automation_set_enabled(
    db: State<'_, Db>,
    project_id: u32,
    kind: String,
    id: String,
    enabled: bool,
) -> Result<AutomationSummary, AppError> {
    let root = project_root(&db, project_id).await?;
    let kind = parse_kind(&kind)?;
    let mut def = store::read_automation(&root, kind, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::new("automation_not_found", id.clone()))?
        .def;
    if enabled {
        if let Some(code) = spec_error(&def) {
            return Err(AppError::code(code));
        }
    }
    def.enabled = enabled;
    def.updated = today();
    store::write_automation(&root, &def).map_err(AppError::from)?;
    clear_next_run(&db, project_id, &def.id).await?;
    summary_of(&db, project_id, &root, kind, &def.id).await
}

/// 씨앗 하나를 정의로 만든다 (비활성). 이미 있으면 그대로 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn automation_create_seed(
    db: State<'_, Db>,
    project_id: u32,
    seed_id: String,
) -> Result<AutomationSummary, AppError> {
    let root = project_root(&db, project_id).await?;
    let lang = crate::oculpm::content_lang::current(&db).await;
    let def = seeds::by_id(lang, &today(), &seed_id)
        .ok_or_else(|| AppError::new("automation_unknown_seed", seed_id.clone()))?;
    store::write_automation(&root, &def).map_err(AppError::from)?;
    summary_of(&db, project_id, &root, def.kind, &def.id).await
}

/// 「지금 실행」 — 집행 루프와 **같은 문**을 쓴다 (예산·동시성·락 규약이
/// 두 경로에서 갈라지지 않게). 전역 스위치가 꺼져 있어도 수동 실행은 된다:
/// 사용자가 방금 누른 버튼이라 "조용히 아무 일도 안 일어남" 이 더 나쁘다.
#[tauri::command]
#[specta::specta]
pub async fn automation_run_now(
    app: AppHandle,
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    kind: String,
    id: String,
) -> Result<AutomationRunOutcome, AppError> {
    let root = project_root(&db, project_id).await?;
    let kind = parse_kind(&kind)?;
    let def = store::read_automation(&root, kind, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::new("automation_not_found", id.clone()))?
        .def;
    let config = project_config(&manager, project_id).await?;
    let workday = manager
        .current_workday(project_id)
        .await
        .map_err(AppError::from)?;
    let tz: chrono_tz::Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);
    let now = chrono::Utc::now().with_timezone(&tz).fixed_offset();

    let job = Job {
        project_id,
        automation_id: def.id.clone(),
        kind: def.kind,
        title: def.title.clone(),
        output: def.output,
        instructions: def.instructions.clone(),
        context: None,
        entry_ref: None,
        workday: workday.clone(),
        now,
        note: Some("manual run".into()),
    };
    let outcome = scheduler::run_job(&app, &config, &workday, tz, job).await;
    Ok(match outcome {
        JobOutcome::Ran { journal_path, .. } => AutomationRunOutcome {
            status: "ran".into(),
            reason: None,
            journal_path,
        },
        JobOutcome::Dropped(r) => AutomationRunOutcome {
            status: "dropped".into(),
            reason: Some(r.to_string()),
            journal_path: None,
        },
        JobOutcome::Skipped(r) => AutomationRunOutcome {
            status: "skipped".into(),
            reason: Some(r.to_string()),
            journal_path: None,
        },
        // 연기는 실패가 아니다 — 「지금 실행」에서도 같은 어휘로 말한다.
        JobOutcome::Deferred(e) => AutomationRunOutcome {
            status: "deferred".into(),
            reason: Some(e),
            journal_path: None,
        },
        JobOutcome::Failed(e) => AutomationRunOutcome {
            status: "failed".into(),
            reason: Some(e),
            journal_path: None,
        },
        JobOutcome::Cancelled => AutomationRunOutcome {
            status: "cancelled".into(),
            reason: None,
            journal_path: None,
        },
    })
}

/// 실행 중인 자동화 1건을 중단한다 (Phase 3 의 인라인 Stop 이 부를 문).
#[tauri::command]
#[specta::specta]
pub async fn automation_cancel(app: AppHandle) -> Result<(), AppError> {
    app.state::<AutomationRunner>().cancel();
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부
// ─────────────────────────────────────────────────────────────────────────────

/// 정의가 바뀌었으니 다음 시각을 무효화한다. 상태 행은 파생 캐시라 지워도
/// 무해하고, 집행 루프가 다음 틱에 새로 계산한다.
async fn clear_next_run(db: &Db, project_id: u32, id: &str) -> Result<(), AppError> {
    let states = db
        .automation_state_list(project_id)
        .await
        .map_err(AppError::from)?;
    if let Some(mut st) = states.into_iter().find(|s| s.automation_id == id) {
        st.next_run_at = None;
        st.last_error = None;
        db.automation_state_upsert(project_id, st)
            .await
            .map_err(AppError::from)?;
    }
    Ok(())
}

async fn summary_of(
    db: &Db,
    project_id: u32,
    root: &std::path::Path,
    kind: AutomationKind,
    id: &str,
) -> Result<AutomationSummary, AppError> {
    let parsed = store::read_automation(root, kind, id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::new("automation_not_found", id.to_string()))?;
    let state = db
        .automation_state_list(project_id)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .find(|s| s.automation_id == id);
    Ok(AutomationSummary {
        spec_error: spec_error(&parsed.def),
        next_run_at: state.as_ref().and_then(|s| s.next_run_at.clone()),
        last_run_at: state.as_ref().and_then(|s| s.last_run_at.clone()),
        last_status: state.as_ref().and_then(|s| s.last_status.clone()),
        last_error: state.and_then(|s| s.last_error),
        def: parsed.def,
        warnings: parsed.warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(
        id: &str,
        kind: AutomationKind,
        enabled: bool,
        next: Option<&str>,
        tier: Option<&str>,
        broken: bool,
    ) -> AutomationSummary {
        let mut def = AutomationDef::new(id, kind, id, "2026-09-01");
        def.enabled = enabled;
        def.responsiveness = tier.map(str::to_string);
        AutomationSummary {
            def,
            warnings: Vec::new(),
            next_run_at: next.map(str::to_string),
            last_run_at: None,
            last_status: None,
            last_error: None,
            spec_error: broken.then(|| "automation_bad_time".to_string()),
        }
    }

    #[test]
    fn counts_only_enabled_and_healthy_definitions() {
        let items = vec![
            summary(
                "a",
                AutomationKind::Schedule,
                true,
                Some("2026-09-02T00:00:00+00:00"),
                None,
                false,
            ),
            summary(
                "b",
                AutomationKind::Schedule,
                false,
                Some("2026-09-01T00:00:00+00:00"),
                None,
                false,
            ),
            summary(
                "c",
                AutomationKind::Watcher,
                true,
                None,
                Some("patient"),
                false,
            ),
            summary("d", AutomationKind::Watcher, true, None, None, false),
        ];
        let counts = count_definitions(&items);
        assert_eq!(counts.active_schedules, 1);
        assert_eq!(counts.active_watchers, 2);
        // 꺼진 정의의 더 이른 시각이 "다음 실행" 을 훔치지 않는다.
        assert_eq!(
            counts.next_run_at.as_deref(),
            Some("2026-09-02T00:00:00+00:00")
        );
        // 티어 미지정은 balanced 로 읽고, 중복은 접는다.
        assert_eq!(counts.watcher_tiers, vec!["patient", "balanced"]);
        assert_eq!(counts.broken, 0);
    }

    #[test]
    fn broken_definitions_are_counted_apart_not_as_active() {
        let items = vec![
            summary(
                "a",
                AutomationKind::Schedule,
                true,
                Some("2026-09-02T00:00:00+00:00"),
                None,
                true,
            ),
            summary("b", AutomationKind::Watcher, true, None, Some("fast"), true),
        ];
        let counts = count_definitions(&items);
        assert_eq!(counts.active_schedules, 0);
        assert_eq!(counts.active_watchers, 0);
        assert_eq!(counts.broken, 2);
        // 깨진 정의의 다음 시각은 화면에 나가지 않는다 — 그 시각에 안 돈다.
        assert_eq!(counts.next_run_at, None);
        assert!(counts.watcher_tiers.is_empty());
    }
}

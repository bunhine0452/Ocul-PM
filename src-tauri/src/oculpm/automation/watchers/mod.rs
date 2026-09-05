//! 워처 자동화의 런타임 — 현실에 반응하는 축 (Phase 2 §2.2·§2.3).
//!
//! ```text
//! fs 이벤트 ─(watcher.rs)→ note_event  ─┐
//!                                       ├→ SettleTracker (창 열기/연장)
//! 정의 파일 ─(틱마다 갱신)→ WatchRule ─┘
//!                                       ↓ 마지막 이벤트 + 티어 지연
//!                                     정착 → [일지 중복 가드] → scheduler::run_job
//!
//! 새 일지 삽입 ─(watcher.rs)→ on_journal_inserted → output=plan 잡 → reconcile.rs
//! ```
//!
//! # 왜 러너를 통과시키는가 (#reconcile-absorb)
//!
//! `auto_reconcile` 은 자기만의 트리거·락·인플라이트 가드를 들고 있었다. 이제
//! **집행은 잡 러너 하나**로 모인다 — 예산·동시성·취소·원장이 한 곳에서만
//! 결정되게. 플랜 편집 자체는 여전히 `reconcile.rs` 가 소유한다 (CAS 와
//! `plan_write_lock` 규약을 두 벌 들지 않는다).
//!
//! # 발동 조건
//!
//! | 채널 | 원인 | 가드 |
//! |---|---|---|
//! | 정착 | `.oculpm` 산출물 **밖**의 파일 변경 | 원인 제외 · 최소 간격 · 일지 중복 키 · 예산 |
//! | 일지 삽입 | 새 일지 1건 | 자동화가 쓴 일지 제외 · 예산 · 동시 1건 |
//!
//! 정착 채널은 일지·플랜·정의·색인을 **원인에서 제외**하므로(§2.4) 플랜 화해는
//! 정착이 아니라 일지 삽입 신호로 깨어난다 — 그래야 증폭 루프를 만들지 않고도
//! "새 일지 → 플랜 갱신" 이 성립한다.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use chrono_tz::Tz;
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::oculpm::automation::conditions::AutomationCondition;
use crate::oculpm::automation::draft_claim::{claim_skip_reason, DraftClaims, DraftPath};
use crate::oculpm::automation::runner::{Job, JobOutcome};
use crate::oculpm::automation::scheduler;
use crate::oculpm::automation::settle::{SettleTracker, SettleWindow, WatchRule};
use crate::oculpm::automation::store::{
    self, AutomationDef, AutomationKind, AutomationOutput, BUILTIN_PLAN_RECONCILE_ID,
};
use crate::oculpm::automation::tiers::{tier_of, Responsiveness};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::OculpmConfig;

/// 정의를 다시 읽는 주기. 파일이 SSOT 라 손으로 고쳐도 반영돼야 하지만,
/// 매 틱 디렉터리를 훑을 이유는 없다 — `.oculpm/automation/` 변경은 워처가
/// [`invalidate_rules`] 로 즉시 알려 준다.
const RULES_TTL: ChronoDuration = ChronoDuration::seconds(30);

/// 정착할 창이 없을 때의 최대 잠. 이 주기로 정의도 다시 읽는다.
const IDLE_TICK: Duration = Duration::from_secs(5);

/// 지시문에 붙이는 변경 파일 목록의 표시 상한 (프롬프트가 붓지 않게).
const MAX_CONTEXT_PATHS: usize = 40;
/// `git status` 로 붙이는 줄 수 상한.
const MAX_GIT_LINES: usize = 40;

// ─────────────────────────────────────────────────────────────────────────────
// 순수 파트 — 규칙 해석
// ─────────────────────────────────────────────────────────────────────────────

/// 새 일지가 들어왔을 때 플랜을 화해할 규칙. `None` = 아무도 안 시켰다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRule {
    pub automation_id: String,
    pub title: String,
    pub instructions: String,
    /// 정의에 적힌 실행 조건 ({#automation-step-if}). 레거시 플래그 경로는
    /// 비어 있다 — 파일이 없으니 조건을 적을 자리도 없다.
    pub conditions: Vec<AutomationCondition>,
    /// `None` = **레거시 `agents.auto_reconcile` 플래그**. 최소 간격을 걸지
    /// 않는다 — 기존 사용자의 동작을 바꾸지 않기 위해서다(Phase 0 의 "조용한
    /// 정지 금지" 와 같은 결). 정의 파일로 옮기면 그 티어의 간격이 적용된다.
    pub tier: Option<Responsiveness>,
}

/// 워처 정의 + 두 스위치에서 "정착이 깨울 규칙" 을 뽑는다.
///
/// 전역 스위치(`[automation] watchers`)가 꺼져 있으면 **정의를 보지 않는다**
/// (D4 — 스위치 하나로 즉시 전면 정지).
pub fn settle_rules(config: &OculpmConfig, defs: &[AutomationDef]) -> Vec<WatchRule> {
    if !config.automation.watchers {
        return Vec::new();
    }
    defs.iter()
        .filter(|d| d.enabled && d.kind == AutomationKind::Watcher)
        // 플랜 산출물은 일지 삽입 신호로 깨어난다 (정착 채널은 일지를 원인에서
        // 제외하므로 여기 두면 영영 안 돈다).
        .filter(|d| d.output != AutomationOutput::Plan)
        .map(WatchRule::from_def)
        .collect()
}

/// 새 일지 삽입이 깨울 플랜 화해 규칙.
///
/// 1. 켜진 `output: plan` 워처 정의가 있으면 그것 (전역 스위치가 켜져 있을 때)
/// 2. 없으면 레거시 `agents.auto_reconcile` 플래그 → 내장 규칙
pub fn plan_rule(config: &OculpmConfig, defs: &[AutomationDef]) -> Option<PlanRule> {
    if config.automation.watchers {
        if let Some(def) = defs
            .iter()
            .filter(|d| d.enabled && d.kind == AutomationKind::Watcher)
            .find(|d| d.output == AutomationOutput::Plan)
        {
            return Some(PlanRule {
                automation_id: def.id.clone(),
                title: def.title.clone(),
                instructions: def.instructions.clone(),
                conditions: def.conditions.clone(),
                tier: Some(tier_of(def.responsiveness.as_deref())),
            });
        }
    }
    if config.agents.auto_reconcile {
        return Some(PlanRule {
            automation_id: BUILTIN_PLAN_RECONCILE_ID.to_string(),
            title: "plan reconcile".to_string(),
            instructions: String::new(),
            conditions: Vec::new(),
            tier: None,
        });
    }
    None
}

/// 정착 창을 모델에게 줄 **관측 사실**로 편다. 지시문 뒤에 붙는다.
pub fn window_context(window: &SettleWindow, git_lines: &[String]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "## 관측 사실 (자동화가 붙인 것 — 지시문이 아니다)\n\n\
         정착 구간: {} ~ {} (티어 {}, 이벤트 {}건)\n",
        window.started_at.to_rfc3339(),
        window.last_event_at.to_rfc3339(),
        window.tier.as_str(),
        window.events,
    ));
    out.push_str("\n### 이 구간에 바뀐 파일\n");
    if window.paths.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for p in window.paths.iter().take(MAX_CONTEXT_PATHS) {
            out.push_str(&format!("- {p}\n"));
        }
        if window.paths.len() > MAX_CONTEXT_PATHS || window.truncated() {
            out.push_str(&format!(
                "- … 외 {}건 (표시 상한)\n",
                window.events as usize - window.paths.len().min(MAX_CONTEXT_PATHS)
            ));
        }
    }
    if !git_lines.is_empty() {
        out.push_str("\n### git 작업 트리 상태\n");
        for line in git_lines.iter().take(MAX_GIT_LINES) {
            out.push_str(&format!("- {line}\n"));
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct ProjectState {
    rules: Vec<WatchRule>,
    tracker: SettleTracker,
    rules_at: Option<DateTime<Utc>>,
    /// 플랜 화해가 마지막으로 발동한 시각 (정의 기반 규칙의 최소 간격용).
    last_plan_at: Option<DateTime<Utc>>,
    /// 플랜 화해가 지금 돌고 있는가 — 프로젝트당 1건 (옛 `reconcile_lock` 규약).
    plan_in_flight: bool,
}

/// 프로세스 전역 허브. 워처(쓰기)와 드라이버(읽기)가 공유하므로 짧은 동기
/// 임계 구역만 쓴다 — **await 를 물고 락을 잡지 않는다**.
#[derive(Default)]
pub struct WatcherAutomationHub {
    projects: Mutex<HashMap<u32, ProjectState>>,
    /// 두 초안 경로가 나눠 갖는 중복 키 등록소 (§2.3).
    pub claims: DraftClaims,
    wake: tokio::sync::Notify,
}

impl WatcherAutomationHub {
    pub fn new() -> Self {
        Self::default()
    }

    fn with<R>(&self, f: impl FnOnce(&mut HashMap<u32, ProjectState>) -> R) -> R {
        let mut guard = match self.projects.lock() {
            Ok(g) => g,
            // 오염된 락 때문에 감시가 멈추면 안 된다 — 안쪽 값을 그대로 쓴다.
            Err(poisoned) => poisoned.into_inner(),
        };
        f(&mut guard)
    }

    /// fs 이벤트 하나. **워처 루프에서 매 이벤트 불린다** — 값싸야 한다.
    /// 규칙이 없으면(스위치 off·워처 자동화 없음) 아무 일도 하지 않는다.
    pub fn note_event(&self, project_id: u32, rel_path: &str, now: DateTime<Utc>) {
        let opened = self.with(|map| {
            let Some(st) = map.get_mut(&project_id) else {
                return false;
            };
            if st.rules.is_empty() {
                return false;
            }
            st.tracker.note(&st.rules, rel_path, now) > 0
        });
        if opened {
            self.wake.notify_one();
        }
    }

    /// 정의가 바뀌었다 — 다음 틱에 다시 읽는다.
    pub fn invalidate_rules(&self, project_id: u32) {
        self.with(|map| {
            if let Some(st) = map.get_mut(&project_id) {
                st.rules_at = None;
            }
        });
        self.wake.notify_one();
    }

    /// 프로젝트가 닫혔다 — 열린 창과 이력을 버린다.
    pub fn forget_project(&self, project_id: u32) {
        self.with(|map| {
            map.remove(&project_id);
        });
    }

    fn needs_rules(&self, project_id: u32, now: DateTime<Utc>) -> bool {
        self.with(|map| match map.get(&project_id) {
            Some(st) => st.rules_at.map(|at| now - at >= RULES_TTL).unwrap_or(true),
            None => true,
        })
    }

    fn set_rules(&self, project_id: u32, rules: Vec<WatchRule>, now: DateTime<Utc>) {
        self.with(|map| {
            let st = map.entry(project_id).or_default();
            let known: BTreeSet<String> = rules.iter().map(|r| r.automation_id.clone()).collect();
            st.tracker.retain_known(&known);
            st.rules = rules;
            st.rules_at = Some(now);
        });
    }

    fn take_settled(&self, project_id: u32, now: DateTime<Utc>) -> Vec<(SettleWindow, bool, bool)> {
        self.with(|map| match map.get_mut(&project_id) {
            Some(st) => st
                .tracker
                .take_settled(now)
                .into_iter()
                .map(|s| (s.window, s.fire, s.report))
                .collect(),
            None => Vec::new(),
        })
    }

    fn next_deadline(&self) -> Option<DateTime<Utc>> {
        self.with(|map| {
            map.values()
                .filter_map(|st| st.tracker.next_deadline())
                .min()
        })
    }

    /// 플랜 화해를 지금 시작해도 되는가. `Go` 를 받았으면 반드시
    /// [`Self::end_plan_run`] 으로 닫는다.
    fn begin_plan_run(
        &self,
        project_id: u32,
        tier: Option<Responsiveness>,
        now: DateTime<Utc>,
    ) -> PlanGate {
        self.with(|map| {
            let st = map.entry(project_id).or_default();
            if st.plan_in_flight {
                return PlanGate::Busy;
            }
            if let Some(tier) = tier {
                if let Some(last) = st.last_plan_at {
                    let gap = ChronoDuration::milliseconds(tier.min_interval().as_millis() as i64);
                    if now - last < gap {
                        return PlanGate::Throttled;
                    }
                }
            }
            st.last_plan_at = Some(now);
            st.plan_in_flight = true;
            PlanGate::Go
        })
    }

    fn end_plan_run(&self, project_id: u32) {
        self.with(|map| {
            if let Some(st) = map.get_mut(&project_id) {
                st.plan_in_flight = false;
            }
        });
    }
}

/// `plan_in_flight` 를 반드시 되돌리는 가드. 잡이 패닉해도 플래그가 켜진 채
/// 남으면 그 프로젝트의 플랜 화해가 앱 재시작까지 조용히 죽는다 — 워처가
/// "돌고 있음" 으로 남아 실시간 갱신을 잃었던 2026-08-23 과 같은 모양의 실패다.
struct PlanRunGuard<'a> {
    hub: &'a WatcherAutomationHub,
    project_id: u32,
}

impl Drop for PlanRunGuard<'_> {
    fn drop(&mut self) {
        self.hub.end_plan_run(self.project_id);
    }
}

/// 플랜 화해 발동 판정.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanGate {
    Go,
    /// 이미 하나가 돌고 있다 — **조용히** 넘어간다 (옛 `reconcile_lock` 과 같은
    /// 판단: git 백필 한 번이 수백 건을 쏟아도 원장이 드롭 행으로 뒤덮이지 않게).
    Busy,
    /// 최소 간격 안이다 — 사유를 원장에 남긴다 (정의 기반 규칙만 해당).
    Throttled,
}

// ─────────────────────────────────────────────────────────────────────────────
// 워처가 부르는 문
// ─────────────────────────────────────────────────────────────────────────────

/// fs 이벤트를 허브에 흘린다. 허브가 없으면(테스트·헤드리스) 무해한 no-op.
pub fn note_event(app: &AppHandle, project_id: u32, rel_path: &str, now: DateTime<Utc>) {
    if let Some(hub) = app.try_state::<WatcherAutomationHub>() {
        hub.note_event(project_id, rel_path, now);
    }
}

/// `.oculpm/automation/**` 이 바뀌었다 — 정의를 다시 읽게 한다.
pub fn invalidate_rules(app: &AppHandle, project_id: u32) {
    if let Some(hub) = app.try_state::<WatcherAutomationHub>() {
        hub.invalidate_rules(project_id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 드라이버
// ─────────────────────────────────────────────────────────────────────────────

/// 상주 드라이버. 정착할 창이 있으면 그 시각까지, 없으면 [`IDLE_TICK`] 만큼 잔다
/// — 티어가 200ms 든 10분이든 폴링 주기가 아니라 **마감 시각**을 본다.
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let hub = handle.state::<WatcherAutomationHub>();
            let sleep = match hub.next_deadline() {
                Some(deadline) => (deadline - Utc::now())
                    .to_std()
                    .unwrap_or(Duration::ZERO)
                    .min(IDLE_TICK),
                None => IDLE_TICK,
            };
            // `Notify` 는 대기 시작 **전**의 알림도 한 건 기억한다 — 새 이벤트를
            // 놓치고 IDLE 만큼 자는 일이 없다.
            let _ = tokio::time::timeout(sleep, hub.wake.notified()).await;
            if let Err(e) = tick(&handle, Utc::now()).await {
                tracing::warn!(target: "oculpm::automation", error = %e, "watcher automation tick failed");
            }
        }
    });
}

/// 한 틱. 시각을 주입받는다.
pub async fn tick(app: &AppHandle, now: DateTime<Utc>) -> Result<(), String> {
    let projects = {
        let manager = app.state::<OculpmManager>();
        manager.current_workdays().await
    };
    for (project_id, workday) in projects {
        if let Err(e) = tick_project(app, project_id, &workday, now).await {
            tracing::warn!(
                target: "oculpm::automation",
                project_id,
                error = %e,
                "watcher automation tick failed for project"
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
    let hub = app.state::<WatcherAutomationHub>();
    let config = {
        let manager = app.state::<OculpmManager>();
        manager
            .get_config(project_id)
            .await
            .map_err(|e| e.to_string())?
    };
    let root = project_root(app, project_id).await?;

    if hub.needs_rules(project_id, now) {
        let defs = load_watcher_defs(&root);
        hub.set_rules(project_id, settle_rules(&config, &defs), now);
    }

    let settled = hub.take_settled(project_id, now);
    if settled.is_empty() {
        return Ok(());
    }
    let tz: Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);
    let defs = load_watcher_defs(&root);

    for (window, fire, report) in settled {
        let Some(def) = defs.iter().find(|d| d.id == window.automation_id) else {
            continue; // 정의가 방금 사라졌다 — 다음 갱신이 창도 지운다.
        };
        let mut job = build_job(project_id, def, workday, tz, now, None);
        if !fire {
            if report {
                job.note = Some("min interval".into());
                scheduler::record_skip(
                    app,
                    &config,
                    workday,
                    tz,
                    job,
                    "최소 간격(티어 지연 ×2) 안이라 재발동하지 않았다",
                )
                .await;
            }
            continue;
        }

        // 일지 산출물은 중복 가드를 통과해야 한다 (§2.3).
        let mut claimed: Option<(DateTime<Utc>, DateTime<Utc>)> = None;
        if def.output == AutomationOutput::Journal {
            match guard_journal_window(app, project_id, &root, workday, &window, now) {
                Ok(key) => claimed = Some(key),
                Err(reason) => {
                    scheduler::record_skip(app, &config, workday, tz, job, reason).await;
                    continue;
                }
            }
        }
        if def.output == AutomationOutput::Plan {
            // 정착 채널에는 원인 일지가 없다 — 조용히 성공한 척하지 않는다.
            scheduler::record_skip(
                app,
                &config,
                workday,
                tz,
                job,
                "플랜 산출물은 새 일지가 원인일 때만 돈다 (정착 채널에는 원인 일지가 없다)",
            )
            .await;
            continue;
        }

        let git_lines = git_status_lines(&root).await;
        job.context = Some(window_context(&window, &git_lines));
        let outcome = scheduler::run_job(app, &config, workday, tz, job).await;
        if let (Some(key), false) = (claimed, matches!(outcome, JobOutcome::Ran { .. })) {
            // 못 썼으면 청구를 놓는다 — 실패 한 번이 그 구간을 영영 막지 않게.
            hub.claims.release(project_id, key.0, key.1);
        }
        tracing::info!(
            target: "oculpm::automation",
            project_id,
            automation_id = %window.automation_id,
            events = window.events,
            ?outcome,
            "[FLOW] settle fired"
        );
    }
    Ok(())
}

/// 정착 트리거의 일지 중복 가드. `Ok(구간 키)` 면 써도 된다.
fn guard_journal_window(
    app: &AppHandle,
    project_id: u32,
    root: &std::path::Path,
    workday: &str,
    window: &SettleWindow,
    now: DateTime<Utc>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), &'static str> {
    // 1. 창 안에 **어떤 일지든** 있으면 비킨다 (자필이든 `auto:*` 초안이든).
    let since = std::time::SystemTime::from(window.started_at);
    if crate::oculpm::automation::draft_claim::entry_exists_in_window(root, workday, since) {
        return Err("이 구간에는 이미 일지가 있다 (에이전트 우선)");
    }
    // 2. 같은 구간을 다른 경로가 먼저 잡았으면 진다 (훅 ↔ 정착). 사유 문구는
    //    `draft_claim` 이 소유한다 — 두 경로가 다른 말로 적으면 History 를 못 읽는다.
    let hub = app.state::<WatcherAutomationHub>();
    let verdict = hub.claims.try_claim(
        project_id,
        window.started_at,
        window.last_event_at,
        DraftPath::Settle,
        now,
    );
    match claim_skip_reason(verdict) {
        None => Ok((window.started_at, window.last_event_at)),
        Some(reason) => Err(reason),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 일지 삽입 채널 (#reconcile-absorb)
// ─────────────────────────────────────────────────────────────────────────────

/// 새 일지 1건이 색인됐다 — 플랜 화해를 러너에 맡긴다.
///
/// 예전에는 `watcher.rs` 가 `reconcile_entry` 를 직접 spawn 했다. 이제 잡 러너를
/// 통과하므로 예산·동시성·취소·원장이 스케줄과 **같은 규약**을 쓴다. 플랜 편집
/// 로직 자체(CAS·`plan_write_lock`)는 `reconcile.rs` 가 그대로 소유한다.
pub async fn on_journal_inserted(
    app: &AppHandle,
    project_id: u32,
    entry_rel: &str,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let config = {
        let manager = app.state::<OculpmManager>();
        manager
            .get_config(project_id)
            .await
            .map_err(|e| e.to_string())?
    };
    let root = project_root(app, project_id).await?;
    let defs = load_watcher_defs(&root);
    let Some(rule) = plan_rule(&config, &defs) else {
        return Ok(());
    };

    let workday = {
        let manager = app.state::<OculpmManager>();
        manager
            .current_workday(project_id)
            .await
            .map_err(|e| e.to_string())?
    };
    let tz: Tz = config.workday.timezone.parse().unwrap_or(chrono_tz::UTC);
    let job = Job {
        project_id,
        automation_id: rule.automation_id.clone(),
        kind: AutomationKind::Watcher,
        title: rule.title.clone(),
        output: AutomationOutput::Plan,
        instructions: rule.instructions.clone(),
        conditions: rule.conditions.clone(),
        context: None,
        entry_ref: Some(entry_rel.to_string()),
        workday: workday.clone(),
        now: now.with_timezone(&tz).fixed_offset(),
        note: None,
    };

    let hub = app.state::<WatcherAutomationHub>();
    let gate = hub.begin_plan_run(project_id, rule.tier, now);
    match gate {
        PlanGate::Busy => {
            tracing::debug!(
                target: "oculpm::automation",
                project_id,
                entry = %entry_rel,
                "[FLOW] plan reconcile skipped (one already in flight)"
            );
            return Ok(());
        }
        PlanGate::Throttled => {
            scheduler::record_skip(
                app,
                &config,
                &workday,
                tz,
                job,
                "최소 간격(티어 지연 ×2) 안이라 재발동하지 않았다",
            )
            .await;
            return Ok(());
        }
        PlanGate::Go => {}
    }
    let _guard = PlanRunGuard {
        hub: &hub,
        project_id,
    };

    let outcome = scheduler::run_job(app, &config, &workday, tz, job).await;
    tracing::info!(
        target: "oculpm::automation",
        project_id,
        automation_id = %rule.automation_id,
        entry = %entry_rel,
        ?outcome,
        "[FLOW] plan reconcile via the job runner"
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부
// ─────────────────────────────────────────────────────────────────────────────

async fn project_root(app: &AppHandle, project_id: u32) -> Result<PathBuf, String> {
    let db = app.state::<Db>();
    Ok(PathBuf::from(
        db.get_project(project_id)
            .await
            .map_err(|e| e.to_string())?
            .root_path,
    ))
}

/// 워처 정의를 읽는다. 읽지 못하면 빈 목록 — 정의를 못 읽는 것이 자동화를
/// 돌릴 이유는 아니다 (반대는 위험하다: 없는 정의로 도는 것).
fn load_watcher_defs(root: &std::path::Path) -> Vec<AutomationDef> {
    match store::list_automations(root, AutomationKind::Watcher) {
        Ok(list) => list.into_iter().map(|p| p.def).collect(),
        Err(e) => {
            tracing::warn!(
                target: "oculpm::automation",
                error = %e,
                "could not list watcher definitions — treating as none"
            );
            Vec::new()
        }
    }
}

fn build_job(
    project_id: u32,
    def: &AutomationDef,
    workday: &str,
    tz: Tz,
    now: DateTime<Utc>,
    entry_ref: Option<String>,
) -> Job {
    Job {
        project_id,
        automation_id: def.id.clone(),
        kind: def.kind,
        title: def.title.clone(),
        output: def.output,
        instructions: def.instructions.clone(),
        conditions: def.conditions.clone(),
        context: None,
        entry_ref,
        workday: workday.to_string(),
        now: now.with_timezone(&tz).fixed_offset(),
        note: None,
    }
}

/// `git status` 를 관측 사실로 — 블로킹 호출이라 별도 스레드에서.
async fn git_status_lines(root: &std::path::Path) -> Vec<String> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        crate::git::uncommitted_changes(&root)
            .into_iter()
            .take(MAX_GIT_LINES)
            .map(|c| format!("{} {}", c.op, c.path))
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

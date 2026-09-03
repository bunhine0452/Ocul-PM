//! 잡 러너 — 모든 자동화가 지나는 단 하나의 집행 경로.
//!
//! ```text
//! run(Job) → [동시 1건 try_lock]  → 밀린 것은 큐가 아니라 드롭 + 사유 기록
//!          → Core Model 해석      → 미설정이면 조용히 스킵 (D2)
//!          → 일일 예산 확인        → 초과면 스킵 + 사유
//!          → LLM 호출 (failover)   → 실패해도 run 레코드는 남는다
//!          → redact 이중 방어
//!          → 산출물 쓰기 (일지 / 플랜 / 없음)
//!          → AutomationRun 마감
//! ```
//!
//! # 왜 큐가 아니라 드롭인가
//!
//! `auto_reconcile` 의 N4 선례다. 자동화는 전부 과금되는 LLM 호출이고, 쓰기
//! 폭주 중에 큐를 쌓으면 폭주를 **지연**시킬 뿐 없애지 못한다. 밀린 잡은
//! 버리되 **왜 버렸는지는 원장에 남긴다** — 안 돈 이유를 모르는 것이 자동화
//! 디버깅에서 가장 나쁜 상태다.
//!
//! # 락
//!
//! 새 락을 만들지 않는다. 프로젝트 쓰기 직렬화는 기존 `plan_write_lock`
//! (`manager/mod.rs`) 공유락 규약을 그대로 쓴다 — LLM 호출 **동안에는 잡지
//! 않고** 쓰기 구간에서만 잡는다 (사용자 편집이 우리 네트워크 왕복에
//! 막히지 않게).
//!
//! # 시각 주입
//!
//! [`Job::workday`]·[`Job::now`] 는 호출부가 채운다. 러너 안에서 시계를 읽지
//! 않는다 — 놓친 실행 따라잡기(Phase 1)와 정착 타이머(Phase 2)를 결정적으로
//! 시험할 수 있어야 한다.

#![allow(dead_code)] // 큐에 넣는 쪽(Phase 1·2)이 아직 없다 — mod.rs 참조.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, FixedOffset};
use regex::Regex;

use crate::commands::llm::{ChatFailure, ProviderModel};
use crate::db::automation::{
    AutomationState, RUN_CANCELLED, RUN_DEFERRED, RUN_DROPPED, RUN_FAILED, RUN_OK, RUN_SKIPPED,
};
use crate::db::Db;
use crate::llm::{ChatOptions, ChatResponse, Message, Role};
use crate::oculpm::automation::core_model::{self, CoreTarget};
use crate::oculpm::automation::store::{AutomationKind, AutomationOutput};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::redact::redact_text;
use crate::oculpm::session_id::SessionId;
use crate::oculpm::spec::{AgentRef, EntryStatus, EntryType, ManualEntryDraft};

/// 산출물 없는 자동화의 답변을 원장 메모로 남길 때의 길이 상한.
const MAX_NOTE_CHARS: usize = 2_000;
/// 한 번의 자동화가 받을 수 있는 최대 토큰. 지시문은 사람이 쓴 짧은 글이고
/// 산출물은 일지 한 건이라 넉넉하다.
const MAX_TOKENS: u32 = 1_500;

// i18n-ignore-next-line -- LLM 프롬프트 본문 (UI 문자열이 아니다).
const SYSTEM_PROMPT: &str = "\
당신은 개발 작업 기록기의 배경 자동화입니다. 사용자가 정의한 지시문을 그대로 \
수행하고, 결과를 마크다운 본문으로만 돌려주세요. 인사말·서론·메타 설명을 \
붙이지 마세요. 확실하지 않은 것은 추측하지 말고 모른다고 쓰세요.";

// ─────────────────────────────────────────────────────────────────────────────
// 잡
// ─────────────────────────────────────────────────────────────────────────────

/// 한 번의 자동화 발동.
#[derive(Debug, Clone)]
pub struct Job {
    pub project_id: u32,
    /// 정의 파일의 id (`.oculpm/automation/**/<id>.md`).
    pub automation_id: String,
    pub kind: AutomationKind,
    pub title: String,
    pub output: AutomationOutput,
    /// 모델에게 그대로 가는 지시문 (정의 본문).
    pub instructions: String,
    /// 지시문 뒤에 붙일 관측 사실 (변경 파일 목록·git 요약 등). Phase 1·2 가 채운다.
    pub context: Option<String>,
    /// 이 발동의 **원인이 된 일지**의 프로젝트 상대 경로. `output: plan` 은
    /// 이것 없이는 성립하지 않는다 (화해할 대상이 없다).
    pub entry_ref: Option<String>,
    /// 프로젝트 워크데이 `YYYYMMDD` (호출부가 `WorkdayResolver` 로 계산).
    pub workday: String,
    /// 발동 시각 (로컬 오프셋 포함).
    pub now: DateTime<FixedOffset>,
    /// 호출부가 붙이는 발동 사연 — 집행 루프의 `"missed catch-up"`, 「지금 실행」
    /// 의 수동 표시. 원장 메모 맨 앞에 붙어 History 에서 구분된다.
    pub note: Option<String>,
}

impl Job {
    /// 원장에 적을 시각 문자열 — **UTC** 다.
    ///
    /// 로컬 오프셋으로 적으면 `started_at >= ?` 사전식 비교(일일 예산)와
    /// `ORDER BY started_at DESC`(History)가 DST 경계에서 어긋난다. 화면은
    /// 어차피 로컬로 다시 그린다.
    pub fn stamp(&self) -> String {
        self.now.with_timezone(&chrono::Utc).to_rfc3339()
    }

    /// 호출부 사연 + 결말 사유를 한 메모로. 둘 다 없으면 `None`.
    fn merged_note(&self, outcome: Option<&str>) -> Option<String> {
        match (self.note.as_deref(), outcome) {
            (Some(a), Some(b)) => Some(format!("{a} · {b}")),
            (Some(a), None) => Some(a.to_string()),
            (None, b) => b.map(str::to_string),
        }
    }

    /// 발동 출처가 드러나는 세션 id (Decision 8 — 접두형).
    pub fn session_id(&self) -> SessionId {
        match self.kind {
            AutomationKind::Schedule => SessionId::schedule(&self.workday, self.now.time()),
            AutomationKind::Watcher => SessionId::automation(&self.workday, self.now.time()),
        }
    }
}

/// 러너를 부를 때 필요한 주변 상태.
pub struct JobContext<'a> {
    pub db: &'a Db,
    pub manager: &'a OculpmManager,
    /// 프로젝트 루트 — 플랜 산출물이 `.oculpm/planner/` 를 읽고 쓴다.
    pub root: std::path::PathBuf,
    /// 프로젝트 타임존 — 캐시 투영의 tz 백필이 색인 경로와 같아야 한다.
    pub tz: chrono_tz::Tz,
    /// 프로젝트 `auto_redact_patterns` 컴파일 결과 (이중 방어).
    pub redact: Vec<Regex>,
    /// `config.toml [automation] daily_run_budget`. `0` = 전면 정지.
    pub daily_run_budget: u32,
    /// 예산 창의 시작 시각(ISO8601) — 보통 오늘 워크데이의 시작.
    pub budget_since: String,
}

/// 한 잡의 결말. **어느 결말이든 원장에 행 하나가 남는다** (소실 없음).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobOutcome {
    /// 끝까지 갔다. `journal_path` 는 일지를 남긴 경우.
    Ran {
        run_id: i64,
        journal_path: Option<String>,
    },
    /// 다른 자동화가 이미 돌고 있어 버렸다 (큐를 만들지 않는다).
    Dropped(&'static str),
    /// 성립 불가 — Core Model 미설정 · 키 없음 · 예산 초과 · 미구현 산출물.
    /// **오류가 아니다.**
    Skipped(&'static str),
    /// 모델 호출이나 쓰기가 실패했다.
    Failed(String),
    /// 네트워크에 닿지 못했다 — **실패가 아니라 연기**다 (Phase 7).
    /// 집행부는 이걸 보면 다음 시각을 되돌려 따라잡기 규칙에 태운다.
    Deferred(String),
    Cancelled,
}

// ─────────────────────────────────────────────────────────────────────────────
// 모델 호출 이음매
// ─────────────────────────────────────────────────────────────────────────────

/// 러너가 모델을 부르는 유일한 통로. 실물은 [`LlmBackend`] 이고, 테스트는
/// 네트워크 없이 동시성·스킵 규약을 시험한다.
#[async_trait]
pub trait ChatBackend: Send + Sync {
    /// 이 대상 체인으로 부를 자격이 있는가 (키체인). 없으면 그 자동화는 성립
    /// 불가다 — 백엔드가 판정을 소유하므로 테스트가 OS 키체인을 건드리지 않는다.
    fn has_credentials(&self, target: &CoreTarget) -> bool;

    /// 실패는 [`ChatFailure`] 다 — 문자열 하나였을 때는 "서버에 닿지 못했다" 와
    /// "429 를 받았다" 가 구분되지 않아 둘 다 실패로 처리됐다.
    async fn chat(
        &self,
        target: &CoreTarget,
        messages: Vec<Message>,
        options: ChatOptions,
    ) -> Result<ChatResponse, ChatFailure>;
}

/// 실물 — `commands::llm::chat` 에 위임한다. 폴백 체인·키 로딩이 거기 이미 있다.
pub struct LlmBackend;

#[async_trait]
impl ChatBackend for LlmBackend {
    fn has_credentials(&self, target: &CoreTarget) -> bool {
        target.has_any_key()
    }

    async fn chat(
        &self,
        target: &CoreTarget,
        messages: Vec<Message>,
        options: ChatOptions,
    ) -> Result<ChatResponse, ChatFailure> {
        let fallbacks: Vec<ProviderModel> = target.fallbacks.clone();
        crate::commands::llm::chat_detailed(target.provider.clone(), messages, options, fallbacks)
            .await
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 러너
// ─────────────────────────────────────────────────────────────────────────────

/// 프로세스 전역 러너. 앱에 하나 두고 모든 프로젝트가 공유한다 — 동시 1건은
/// 프로젝트별이 아니라 **전역**이다 (배경 과금의 총량을 사람이 예측할 수 있게).
pub struct AutomationRunner {
    slot: Arc<tokio::sync::Mutex<()>>,
    /// 실행 중 1건의 취소 깃발. Phase 3 의 인라인 Stop 이 세운다.
    cancel: Arc<AtomicBool>,
    /// 지금 도는 잡의 `(project_id, automation_id)`. 닥터와 자동화 카드가
    /// **마운트 시점**에 읽는다 — 이벤트만으로는 이미 돌고 있던 잡을 놓친다.
    current: Arc<std::sync::Mutex<Option<(u32, String)>>>,
    backend: Arc<dyn ChatBackend>,
}

/// 실행 중 표시를 반드시 걷어내는 RAII 가드. `run()` 은 슬롯을 잡은 뒤에도
/// 이른 반환이 여럿이라(Core Model 미설정·키 없음·예산·취소), 손으로 지우면
/// 언젠가 한 갈래를 빠뜨려 "영원히 실행 중" 이 남는다.
struct RunningGuard(Arc<std::sync::Mutex<Option<(u32, String)>>>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

impl Default for AutomationRunner {
    fn default() -> Self {
        Self::new(Arc::new(LlmBackend))
    }
}

impl AutomationRunner {
    pub fn new(backend: Arc<dyn ChatBackend>) -> Self {
        Self {
            slot: Arc::new(tokio::sync::Mutex::new(())),
            cancel: Arc::new(AtomicBool::new(false)),
            current: Arc::new(std::sync::Mutex::new(None)),
            backend,
        }
    }

    /// 지금 도는 잡. 러너는 프로세스 전역 1건이라 프로젝트가 섞일 수 있어
    /// project_id 를 함께 돌려준다.
    pub fn running(&self) -> Option<(u32, String)> {
        self.current
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    fn mark_running(&self, project_id: u32, automation_id: &str) -> RunningGuard {
        *self.current.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((project_id, automation_id.to_string()));
        RunningGuard(self.current.clone())
    }

    /// 실행 중인 1건을 취소한다. 이미 끝났으면 무해한 no-op — 다음 실행이
    /// 시작할 때 깃발을 내린다.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.slot.try_lock().is_err()
    }

    /// 잡 하나를 집행한다. 모듈 문서의 파이프라인 그대로.
    pub async fn run(&self, ctx: &JobContext<'_>, job: Job) -> JobOutcome {
        // ── 1. 동시 1건. 밀린 것은 드롭하되 이유를 원장에 남긴다 ──
        let Ok(_slot) = self.slot.try_lock() else {
            self.record_terminal(
                ctx,
                &job,
                RUN_DROPPED,
                Some("다른 자동화가 실행 중 — 이번 발동은 버렸다 (큐를 쌓지 않는다)"),
            )
            .await;
            return JobOutcome::Dropped("another automation is running");
        };
        self.cancel.store(false, Ordering::SeqCst);
        let _running = self.mark_running(job.project_id, &job.automation_id);

        // ── 2. Core Model (D2). 미설정은 오류가 아니라 성립 불가다 ──
        let target = match core_model::resolve(ctx.db).await {
            Ok(Some(t)) => t,
            Ok(None) => {
                self.record_terminal(
                    ctx,
                    &job,
                    RUN_SKIPPED,
                    Some("배경 작업 모델(core model)이 설정되지 않았다"),
                )
                .await;
                return JobOutcome::Skipped("core model not configured");
            }
            Err(e) => return self.fail(ctx, &job, e).await,
        };
        if !self.backend.has_credentials(&target) {
            self.record_terminal(
                ctx,
                &job,
                RUN_SKIPPED,
                Some("배경 작업 모델의 API 키가 키체인에 없다"),
            )
            .await;
            return JobOutcome::Skipped("no api key for the core model chain");
        }

        // ── 3. 일일 예산 (폭주 가드) ──
        if let Some(reason) = self.over_budget(ctx, &job).await {
            self.record_terminal(ctx, &job, RUN_SKIPPED, Some(reason))
                .await;
            return JobOutcome::Skipped("daily run budget exhausted");
        }

        // ── 4. 원장 개시. 여기부터는 어떤 결말이든 이 행이 닫힌다 ──
        let session_id = job.session_id();
        let started_at = job.stamp();
        let run_id = match ctx
            .db
            .automation_run_start(
                job.project_id,
                job.automation_id.clone(),
                session_id.to_string(),
                started_at.clone(),
                "running".to_string(),
            )
            .await
        {
            Ok(id) => id,
            Err(e) => return JobOutcome::Failed(e.to_string()),
        };

        if self.cancelled() {
            self.close(ctx, &job, run_id, RUN_CANCELLED, None, None)
                .await;
            return JobOutcome::Cancelled;
        }

        // ── 5. 플랜 산출물은 여기서 갈라진다 (#reconcile-absorb) ──
        //
        // 플랜 편집은 `reconcile.rs` 가 소유한다 — 프롬프트·CAS·`plan_write_lock`
        // 규약을 두 벌 들지 않는다. 러너는 **집행 규약**(동시 1건·예산·취소·
        // 원장)만 얹고 그 모듈을 부른다. 그래서 일반 chat 보다 앞에 있다:
        // 화해는 활성 플랜마다 자기 호출을 하므로 여기서 한 번 더 부르면
        // 쓰이지 않는 응답에 과금된다.
        if job.output == AutomationOutput::Plan {
            return self.run_plan_reconcile(ctx, &job, run_id).await;
        }

        // ── 6. 모델 호출 (failover 체인) ──
        let content_lang = crate::oculpm::content_lang::current(ctx.db).await;
        let response = self
            .backend
            .chat(
                &target,
                vec![
                    Message {
                        role: Role::System,
                        content: content_lang.apply(SYSTEM_PROMPT),
                    },
                    Message {
                        role: Role::User,
                        content: build_user_prompt(&job),
                    },
                ],
                ChatOptions {
                    model: target.model.clone(),
                    temperature: Some(0.2),
                    max_tokens: Some(MAX_TOKENS),
                },
            )
            .await;
        let response = match response {
            Ok(r) => r,
            // 네트워크에 닿지도 못했다 — 이건 실패가 아니라 **연기**다.
            // 비행기에서 노트북을 열었다고 주간 요약을 영영 잃을 이유가 없다.
            Err(ChatFailure {
                message,
                offline: true,
            }) => {
                self.close(ctx, &job, run_id, RUN_DEFERRED, None, Some(&message))
                    .await;
                return JobOutcome::Deferred(message);
            }
            Err(ChatFailure { message, .. }) => {
                // 강등하되 소실 없음 — "이 자동화가 돌았고 모델이 실패했다" 는 남는다.
                self.close(ctx, &job, run_id, RUN_FAILED, None, Some(&message))
                    .await;
                return JobOutcome::Failed(message);
            }
        };

        if self.cancelled() {
            self.close(ctx, &job, run_id, RUN_CANCELLED, None, None)
                .await;
            return JobOutcome::Cancelled;
        }

        // ── 7. redact 이중 방어 — 모델 응답에 시크릿이 섞여 돌아올 수 있다 ──
        let (body, hits) = redact_text(&response.content, &ctx.redact);
        if !hits.is_empty() {
            tracing::warn!(
                target: "oculpm::automation",
                automation_id = %job.automation_id,
                hits = hits.len(),
                "automation output contained redactable content — masked"
            );
        }

        // ── 8. 산출물 ──
        match job.output {
            AutomationOutput::None => {
                let note = truncate(&body, MAX_NOTE_CHARS);
                self.close(ctx, &job, run_id, RUN_OK, None, Some(&note))
                    .await;
                JobOutcome::Ran {
                    run_id,
                    journal_path: None,
                }
            }
            AutomationOutput::Journal => {
                match self
                    .write_journal(ctx, &job, &session_id, &response, &body)
                    .await
                {
                    Ok(rel) => {
                        self.close(ctx, &job, run_id, RUN_OK, Some(&rel), None)
                            .await;
                        JobOutcome::Ran {
                            run_id,
                            journal_path: Some(rel),
                        }
                    }
                    Err(e) => {
                        self.close(ctx, &job, run_id, RUN_FAILED, None, Some(&e))
                            .await;
                        JobOutcome::Failed(e)
                    }
                }
            }
            // 앞(5단계)에서 이미 갈라졌다 — 여기 오면 코드가 어긋난 것이다.
            AutomationOutput::Plan => {
                self.close(ctx, &job, run_id, RUN_SKIPPED, None, Some("unreachable"))
                    .await;
                JobOutcome::Skipped("plan output is dispatched earlier")
            }
        }
    }

    /// 러너에 넣기 **전에** 걸러진 발동을 원장에 남긴다 (정착 트리거의
    /// 중복·최소 간격 가드가 부른다). 러너가 소유하는 이유는 하나다 — 스킵의
    /// 모양이 경로마다 갈라지면 History 에서 왜 안 돌았는지 읽을 수 없다.
    pub async fn record_skip(&self, ctx: &JobContext<'_>, job: &Job, reason: &str) {
        self.record_terminal(ctx, job, RUN_SKIPPED, Some(reason))
            .await;
    }

    /// 플랜 산출물 — 화해는 `reconcile.rs` 가 소유한다 (#reconcile-absorb).
    ///
    /// 러너가 하는 일은 집행 규약을 얹는 것뿐이다: 원장은 이미 열렸고, 동시
    /// 1건·예산·취소는 앞에서 통과했다. CAS(플랜이 LLM 호출 중에 바뀌면 양보)와
    /// `plan_write_lock` 공유락은 저쪽 모듈의 규약 그대로다.
    async fn run_plan_reconcile(&self, ctx: &JobContext<'_>, job: &Job, run_id: i64) -> JobOutcome {
        let Some(entry_rel) = job.entry_ref.as_deref() else {
            self.close(
                ctx,
                job,
                run_id,
                RUN_SKIPPED,
                None,
                Some("플랜 산출물은 원인이 된 일지가 있어야 돈다"),
            )
            .await;
            return JobOutcome::Skipped("plan output needs a journal entry as its cause");
        };
        let plan_lock = ctx.manager.plan_write_lock(job.project_id).await;
        let outcome = crate::oculpm::reconcile::reconcile_entry(
            ctx.db,
            job.project_id,
            &ctx.root,
            entry_rel,
            ctx.redact.clone(),
            ctx.tz,
            plan_lock,
        )
        .await;
        match outcome {
            Ok(crate::oculpm::reconcile::ReconcileOutcome::Skipped(reason)) => {
                self.close(ctx, job, run_id, RUN_SKIPPED, None, Some(reason))
                    .await;
                JobOutcome::Skipped(reason)
            }
            Ok(crate::oculpm::reconcile::ReconcileOutcome::Ran(results)) => {
                let note = summarize_reconcile(&results);
                // 전부 실패했으면 실패다 — "돌았다" 로 적으면 죽은 키가 성공처럼 보인다.
                let all_failed = !results.is_empty() && results.iter().all(|r| r.error.is_some());
                let status = if all_failed { RUN_FAILED } else { RUN_OK };
                self.close(ctx, job, run_id, status, None, Some(&note))
                    .await;
                if all_failed {
                    JobOutcome::Failed(note)
                } else {
                    JobOutcome::Ran {
                        run_id,
                        journal_path: None,
                    }
                }
            }
            Err(e) => {
                self.close(ctx, job, run_id, RUN_FAILED, None, Some(&e))
                    .await;
                JobOutcome::Failed(e)
            }
        }
    }

    // ── 내부 ────────────────────────────────────────────────────────────────

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    async fn over_budget(&self, ctx: &JobContext<'_>, job: &Job) -> Option<&'static str> {
        if ctx.daily_run_budget == 0 {
            return Some("daily_run_budget 이 0 — 자동화가 전면 정지 상태다");
        }
        match ctx
            .db
            .automation_billable_runs_since(job.project_id, ctx.budget_since.clone())
            .await
        {
            Ok(n) if n >= ctx.daily_run_budget => {
                Some("오늘의 자동화 실행 예산(daily_run_budget)을 다 썼다")
            }
            Ok(_) => None,
            // 셀 수 없으면 막지 않는다 — 예산은 폭주 가드이지 게이트가 아니다.
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::automation",
                    error = %e,
                    "could not count today's automation runs — budget check skipped"
                );
                None
            }
        }
    }

    /// 원장을 열지 않고 끝난 결말(드롭·사전 스킵)을 한 행으로 남긴다.
    async fn record_terminal(
        &self,
        ctx: &JobContext<'_>,
        job: &Job,
        status: &str,
        note: Option<&str>,
    ) {
        let at = job.stamp();
        let run_id = ctx
            .db
            .automation_run_start(
                job.project_id,
                job.automation_id.clone(),
                job.session_id().to_string(),
                at.clone(),
                status.to_string(),
            )
            .await;
        match run_id {
            Ok(id) => {
                let _ = ctx
                    .db
                    .automation_run_finish(id, status.to_string(), at, None, job.merged_note(note))
                    .await;
            }
            Err(e) => tracing::warn!(
                target: "oculpm::automation",
                error = %e,
                "could not record the automation outcome"
            ),
        }
        self.stamp_state(ctx, job, status, note.filter(|_| status == RUN_FAILED))
            .await;
    }

    async fn close(
        &self,
        ctx: &JobContext<'_>,
        job: &Job,
        run_id: i64,
        status: &str,
        journal_path: Option<&str>,
        note: Option<&str>,
    ) {
        if let Err(e) = ctx
            .db
            .automation_run_finish(
                run_id,
                status.to_string(),
                job.stamp(),
                journal_path.map(str::to_string),
                job.merged_note(note),
            )
            .await
        {
            tracing::warn!(
                target: "oculpm::automation",
                error = %e,
                "could not close the automation run row"
            );
        }
        self.stamp_state(ctx, job, status, note.filter(|_| status == RUN_FAILED))
            .await;
    }

    /// `automation_state` 의 마지막 실행 요약. `next_run_at` 은 집행 루프
    /// (Phase 1)가 소유하므로 여기서 건드리지 않는다 — 기존 값을 보존한다.
    async fn stamp_state(
        &self,
        ctx: &JobContext<'_>,
        job: &Job,
        status: &str,
        error: Option<&str>,
    ) {
        let next_run_at = ctx
            .db
            .automation_state_list(job.project_id)
            .await
            .ok()
            .and_then(|rows| {
                rows.into_iter()
                    .find(|r| r.automation_id == job.automation_id)
                    .and_then(|r| r.next_run_at)
            });
        let _ = ctx
            .db
            .automation_state_upsert(
                job.project_id,
                AutomationState {
                    automation_id: job.automation_id.clone(),
                    next_run_at,
                    last_run_at: Some(job.stamp()),
                    last_status: Some(status.to_string()),
                    last_error: error.map(str::to_string),
                },
            )
            .await;
    }

    async fn fail(&self, ctx: &JobContext<'_>, job: &Job, error: String) -> JobOutcome {
        self.record_terminal(ctx, job, RUN_FAILED, Some(&error))
            .await;
        JobOutcome::Failed(error)
    }

    /// 규격 일지 1건. **frontmatter 조립은 결정적** — 모델은 본문만 채운다
    /// (`journal_draft` 와 같은 규약: 파서 경고 0 을 구조적으로 담보한다).
    async fn write_journal(
        &self,
        ctx: &JobContext<'_>,
        job: &Job,
        session_id: &SessionId,
        response: &ChatResponse,
        body: &str,
    ) -> Result<String, String> {
        let slug = journal_slug(&job.automation_id);
        let (title, _) = redact_text(&job.title, &ctx.redact);
        let draft = ManualEntryDraft {
            entry_type: EntryType::Chore,
            slug,
            title,
            difficulty: None,
            body_markdown: compose_body(job, body, response),
            session_id: Some(session_id.to_string()),
            files_touched: Vec::new(),
            status: Some(EntryStatus::Done),
            tags: vec!["automation".to_string(), job.kind.as_str().to_string()],
            // 귀속은 auto-reconcile 선례를 따른다 — 출처는 session_id 접두가 가른다.
            agent: Some(AgentRef {
                id: format!("auto:{}", response.provider),
                version: Some(response.model.clone()),
                session: None,
            }),
            verified_by_user: Some(false),
            created_at: None,
        };
        // 프로젝트 쓰기 직렬화 — 기존 공유락 규약 재사용 (새 락을 만들지 않는다).
        let plan_lock = ctx.manager.plan_write_lock(job.project_id).await;
        let _guard = plan_lock.lock().await;
        ctx.manager
            .create_manual_journal_entry(ctx.db, job.project_id, draft)
            .await
            .map(|e| e.relative_path)
            .map_err(|e| e.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 파트
// ─────────────────────────────────────────────────────────────────────────────

/// 일지 slug — `validate_slug` 규칙([a-z0-9-], 1..=60)을 구조적으로 만족시킨다.
pub fn journal_slug(automation_id: &str) -> String {
    let base = crate::oculpm::automation::store::normalize_id(automation_id)
        .unwrap_or_else(|| "automation".to_string());
    let mut slug = format!("{base}-auto");
    if slug.len() > 60 {
        slug.truncate(60);
        while slug.ends_with('-') {
            slug.pop();
        }
    }
    slug
}

/// 지시문 + 관측 사실. 지시문은 사용자가 쓴 글 그대로 간다 (에디터의
/// "이 지시문이 그대로 모델에게 갑니다" 안내가 참이어야 한다).
pub fn build_user_prompt(job: &Job) -> String {
    let mut out = job.instructions.trim().to_string();
    if let Some(ctx) = &job.context {
        let ctx = ctx.trim();
        if !ctx.is_empty() {
            out.push_str("\n\n---\n");
            out.push_str(ctx);
        }
    }
    out
}

fn truncate(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    s.chars().take(cap).collect::<String>() + "…"
}

/// 화해 결과를 원장 메모 한 줄로. 적용 0건과 실패를 **구분해서** 적는다 —
/// 둘 다 "아무 일도 없었다" 로 보이면 죽은 키를 영영 못 찾는다.
pub fn summarize_reconcile(results: &[crate::oculpm::reconcile::PlanReconcileResult]) -> String {
    if results.is_empty() {
        return "화해할 활성 플랜이 없다".to_string();
    }
    let applied: usize = results.iter().map(|r| r.applied).sum();
    let failed: Vec<&str> = results
        .iter()
        .filter(|r| r.error.is_some())
        .map(|r| r.plan_id.as_str())
        .collect();
    let mut note = format!("플랜 {}건 · 글리프 {applied}건 갱신", results.len());
    if !failed.is_empty() {
        note.push_str(&format!(" · 실패 {}", failed.join(", ")));
    }
    note
}

/// 일지 본문 — 모델 본문 + 출처를 밝히는 메모. 사람이 나중에 이 일지를 보고
/// "누가 왜 썼는지" 를 알 수 있어야 한다.
fn compose_body(job: &Job, body: &str, response: &ChatResponse) -> String {
    format!(
        "{}\n\n---\n\n자동화 `{}` ({}) 가 {} 에 남긴 기록입니다. \
         모델 {}/{}. 내용을 검토하고 부정확하면 새 일지로 정정하세요.\n",
        body.trim(),
        job.automation_id,
        job.kind.as_str(),
        job.now.to_rfc3339(),
        response.provider,
        response.model,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

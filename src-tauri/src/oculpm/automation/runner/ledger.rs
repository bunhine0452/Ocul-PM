//! 실행 원장 쓰기 — `AutomationRunner` 의 조각 ({#automation-step-if} 라운드에서
//! 갈라 나왔다. 순수 이동이며 동작·시그니처 변경은 없다).
//!
//! **어떤 결말이든 행 하나가 남는다** 는 계약이 여기 산다. 드롭·스킵도 남기는
//! 이유는 하나다 — 안 돈 이유를 모르는 것이 자동화 디버깅에서 가장 나쁜
//! 상태이고, 조건 게이트가 붙은 뒤로는 「건너뜀」이 정상 결말이 됐다.
//!
//! `db/mod.rs` 의 단일 `impl Db` 를 도메인 파일로 가르는 것과 같은 결이다 —
//! 부모 모듈의 비공개 필드에 그대로 닿는다.

use super::*;

impl AutomationRunner {
    /// 원장을 열지 않고 끝난 결말(드롭·사전 스킵)을 한 행으로 남긴다.
    pub(super) async fn record_terminal(
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

    pub(super) async fn close(
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
    pub(super) async fn stamp_state(
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
}

//! 실행 조건의 **관측 사실** 수집 — `AutomationRunner` 의 조각
//! ({#automation-step-if}).
//!
//! 판정은 [`conditions::first_unmet`](crate::oculpm::automation::conditions::first_unmet)
//! 이 소유한다 (순수, 입력은 [`ConditionFacts`] 하나). 여기는 그가 볼 숫자를
//! 모으는 자리다 — DB 질의와 하위 프로세스가 사는 곳이라 순수한 쪽과 파일을
//! 나눈다.
//!
//! 두 규율이 이 파일의 전부다:
//!
//! 1. **묻지 않은 것은 세지 않는다.** `git_dirty` 하나가 하위 프로세스를,
//!    `journal_count_gte` 하나가 질의 두 번을 부른다. 조건 없는 자동화(대다수)
//!    는 [`AutomationRunner::gather_facts`] 까지 오지도 않는다.
//! 2. **못 읽으면 0으로 둔다.** 못 읽었는데 통과시키면 조건이 있다고 믿는
//!    게이트가 조용히 열린다 (fail-closed).

use super::*;

impl AutomationRunner {
    /// 이 잡의 조건이 묻는 사실만 읽어 온다.
    pub(super) async fn gather_facts(&self, ctx: &JobContext<'_>, job: &Job) -> ConditionFacts {
        let needs: FactNeeds = conditions::needs(&job.conditions);
        let mut facts = ConditionFacts::default();

        if needs.journal {
            facts.new_journal_entries = self.count_new_entries(ctx, job).await;
        }
        if needs.plan {
            facts.open_plan_items = ctx
                .db
                .list_open_plan_items(job.project_id, 1)
                .await
                .map(|rows| rows.len() as u32)
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        target: "oculpm::automation",
                        error = %e,
                        "could not count open plan items — treating the condition as unmet"
                    );
                    0
                });
        }
        if needs.git {
            let root = ctx.root.clone();
            facts.git_dirty = tokio::task::spawn_blocking(move || {
                crate::git::repo_root_for(&root)
                    .is_some_and(|repo| !crate::git::uncommitted_changes(&repo).is_empty())
            })
            .await
            .unwrap_or(false);
        }
        facts
    }

    /// 「직전 **성공** 실행 이후」 새로 들어온 일지 수.
    ///
    /// 창의 시작은 원장의 마지막 `ok` 행이다 — 실패·스킵은 창을 닫지 않는다
    /// (모델이 터진 주의 일지가 사라지면 다음 주에 영영 안 돈다). 한 번도
    /// 성공한 적이 없으면 전체 기간이고, 첫 실행은 돌아야 한다.
    ///
    /// 워크데이 범위 질의로 후보를 좁힌 뒤 **경계 워크데이만** `created_at`
    /// 으로 정확히 자른다. 날짜 단위로만 세면 같은 날 두 번째 발동이 아침에
    /// 쓴 일지를 다시 세어 「빈 요약을 또 만든다」 — 이 게이트가 없애려는 바로
    /// 그 상태다.
    async fn count_new_entries(&self, ctx: &JobContext<'_>, job: &Job) -> u32 {
        let last_ok = ctx
            .db
            .automation_runs_list(job.project_id, Some(job.automation_id.clone()), 50)
            .await
            .ok()
            .and_then(|rows| {
                rows.into_iter()
                    .find(|r| r.status == RUN_OK)
                    .map(|r| r.started_at)
            });

        let resolver =
            crate::oculpm::paths::WorkdayResolver::new(ctx.tz.name(), &ctx.day_starts_at)
                .unwrap_or(crate::oculpm::paths::WorkdayResolver {
                    tz: ctx.tz,
                    day_starts_at: chrono::NaiveTime::MIN,
                });
        let since_instant = last_ok
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc));
        let since_workday = since_instant
            .map(|i| resolver.workday_of(i))
            // 창이 없으면 전체 기간 — 워크데이는 사전식 비교라 "00000000" 이 하한이다.
            .unwrap_or_else(|| "00000000".to_string());

        let cache = crate::oculpm::cache::JournalCache::new(ctx.db);
        let rows = match cache
            .range_entries(job.project_id, &since_workday, &job.workday)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::automation",
                    error = %e,
                    "could not count new journal entries — treating the condition as unmet"
                );
                return 0;
            }
        };

        let Some(since_instant) = since_instant else {
            return rows.len() as u32;
        };
        // 경계 워크데이의 일지만 시각으로 다시 거른다 (질의 한 번 더).
        let stale: std::collections::HashSet<String> = cache
            .list_entries_for_workdays(job.project_id, std::slice::from_ref(&since_workday))
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|e| {
                DateTime::parse_from_rfc3339(&e.created_at)
                    .map(|c| c.with_timezone(&chrono::Utc) <= since_instant)
                    // 시각을 못 읽는 일지는 「새것이 아니다」로 본다 (fail-closed).
                    .unwrap_or(true)
            })
            .map(|e| e.relative_path)
            .collect();
        rows.into_iter()
            .filter(|r| !stale.contains(&r.relative_path))
            .count() as u32
    }
}

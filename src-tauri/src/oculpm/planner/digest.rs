//! Today 의 계획 쪽 집계 — **결정적으로** (LLM 0) 한 번에 (4.0 `{#ui-today}`).
//!
//! Today 는 「확인할 것」을 먼저 보여 준다. 그중 계획에서 오는 셋 — 판정 실패, 사람 몫(`[사용자]`),
//! 막힘(`[!]`) — 과 계획마다 「다음」 리프, 그리고 일지 → 계획 연결(오늘 한 일을 계획별로
//! 묶는 열쇠)을 여기서 한 번에 만든다. 화면이 플랜마다 `plan_get` 을 부르면 플랜 수만큼
//! 전체 재투영이 돈다.

use serde::Serialize;

use std::path::Path;

use super::project::{detail_dto, PlanCache, PlanDetail, PlanItemDto};

/// 전체 재투영 한 번으로 모든 플랜의 상세를 — 플랜마다 `PlanCache::get` 을 부르면 그만큼 돈다.
pub async fn load_details(
    cache: &PlanCache<'_>,
    project_id: u32,
    planner_root: &Path,
) -> Result<Vec<PlanDetail>, String> {
    let loaded = cache.reproject_all(project_id, planner_root).await?;
    Ok(loaded.iter().map(detail_dto).collect())
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct DigestItem {
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DigestPlan {
    pub plan_id: String,
    pub title: String,
    pub progress: f64,
    pub done_count: u32,
    pub item_count: u32,
    pub updated_at: String,
    pub done_when: Option<String>,
    pub check: Option<String>,
    pub last_verdict: Option<super::judge::PlanVerdict>,
    /// 다음에 잡을 리프 — 문서 순서상 첫 `[ ]`, 사람 몫은 건너뛴다. `[~]` 는 다른 세션이
    /// 잡은 것으로 본다 (`/oculpm:next` 와 같은 규칙).
    pub next: Option<DigestItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct JournalPlanLink {
    /// `.oculpm/` 기준 상대경로 그대로 (plan-log 의 일지 열).
    pub journal_ref: String,
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TodayDigest {
    /// active 플랜만, 최근 갱신 순.
    pub plans: Vec<DigestPlan>,
    /// 열린 사람 몫 항목 (`[사용자]`·`[사용자 결정]`·`[사용자 액션]`·`[user]` 로 시작).
    pub needs_user: Vec<DigestItem>,
    /// 막힌(`[!]`) 리프.
    pub blocked: Vec<DigestItem>,
    pub journal_plan: Vec<JournalPlanLink>,
}

/// 항목 문구가 사람 몫인가. 템플릿·플래너가 쓰는 대괄호 머리표만 본다.
pub fn is_user_item(title: &str) -> bool {
    let t = title.trim_start();
    t.starts_with("[사용자") || t.get(..5).is_some_and(|h| h.eq_ignore_ascii_case("[user"))
}

fn is_open(status: &str) -> bool {
    matches!(status, "todo" | "in_progress")
}

fn item(d: &PlanDetail, i: &PlanItemDto) -> DigestItem {
    DigestItem {
        plan_id: d.plan.plan_id.clone(),
        plan_title: d.plan.title.clone(),
        item_id: i.item_id.clone(),
        title: i.title.clone(),
        status: i.status.clone(),
    }
}

pub fn build(mut details: Vec<PlanDetail>) -> TodayDigest {
    details.retain(|d| d.plan.status == "active");
    details.sort_by(|a, b| b.plan.updated_at.cmp(&a.plan.updated_at));

    let mut out = TodayDigest {
        plans: Vec::with_capacity(details.len()),
        needs_user: Vec::new(),
        blocked: Vec::new(),
        journal_plan: Vec::new(),
    };
    for d in &details {
        let parents: std::collections::HashSet<&str> = d
            .items
            .iter()
            .filter_map(|i| i.parent_item.as_deref())
            .collect();
        let mut leaves: Vec<&PlanItemDto> = d
            .items
            .iter()
            .filter(|i| !parents.contains(i.item_id.as_str()))
            .collect();
        leaves.sort_by_key(|i| i.order_idx);

        let next = leaves
            .iter()
            .find(|i| i.status == "todo" && !is_user_item(&i.title))
            .map(|i| item(d, i));
        out.plans.push(DigestPlan {
            plan_id: d.plan.plan_id.clone(),
            title: d.plan.title.clone(),
            progress: d.plan.progress,
            done_count: d.plan.done_count,
            item_count: d.plan.item_count,
            updated_at: d.plan.updated_at.clone(),
            done_when: d.done_when.clone(),
            check: d.check.clone(),
            last_verdict: d.plan.last_verdict.clone(),
            next,
        });
        for i in &leaves {
            if is_open(&i.status) && is_user_item(&i.title) {
                out.needs_user.push(item(d, i));
            } else if i.status == "blocked" {
                out.blocked.push(item(d, i));
            }
        }
        for i in &d.items {
            for r in &i.journal_refs {
                out.journal_plan.push(JournalPlanLink {
                    journal_ref: r.clone(),
                    plan_id: d.plan.plan_id.clone(),
                    plan_title: d.plan.title.clone(),
                    item_id: i.item_id.clone(),
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::planner::judge::PlanVerdict;
    use crate::oculpm::planner::project::PlanSummary;

    fn it(id: &str, title: &str, status: &str, order: u32, parent: Option<&str>) -> PlanItemDto {
        PlanItemDto {
            item_id: id.into(),
            phase: None,
            title: title.into(),
            status: status.into(),
            order_idx: order,
            parent_item: parent.map(Into::into),
            note: None,
            last_agent: None,
            last_update: None,
            journal_refs: Vec::new(),
        }
    }

    fn plan(id: &str, status: &str, updated: &str, items: Vec<PlanItemDto>) -> PlanDetail {
        PlanDetail {
            plan: PlanSummary {
                plan_id: id.into(),
                title: format!("T {id}"),
                status: status.into(),
                owner_agent: "claude-code".into(),
                progress: 0.5,
                file_path: format!(".oculpm/planner/{id}.md"),
                updated_at: updated.into(),
                item_count: 4,
                done_count: 2,
                last_verdict: Some(PlanVerdict {
                    passed: false,
                    summary: "2 failed".into(),
                    ts: "2026-10-28T14:12:00+09:00".into(),
                    agent_id: "claude-code".into(),
                    item_id: "x".into(),
                }),
            },
            items,
            phases: Vec::new(),
            decisions: Vec::new(),
            warnings: Vec::new(),
            done_when: Some("끝".into()),
            check: Some("cargo test".into()),
        }
    }

    #[test]
    fn user_items_are_recognised_by_their_bracket_tag() {
        assert!(is_user_item("[사용자] 테스터 모집"));
        assert!(is_user_item("[사용자 액션] release env"));
        assert!(is_user_item("[User] approve"));
        assert!(!is_user_item("사용자 설정 화면 고치기"));
        assert!(!is_user_item("[x]"));
    }

    #[test]
    fn digest_keeps_active_plans_newest_first_and_picks_the_next_leaf() {
        let mut parent = it("p", "부모", "in_progress", 0, None);
        parent.journal_refs = vec!["20261028/Bugs/1402_bug_a.md".into()];
        let d = build(vec![
            plan(
                "old",
                "done",
                "2026-10-29",
                vec![it("z", "끝난 것", "todo", 0, None)],
            ),
            plan(
                "a",
                "active",
                "2026-10-27",
                vec![
                    parent,
                    it("c1", "잡힌 것", "in_progress", 1, Some("p")),
                    it("c2", "[사용자] 결정", "todo", 2, Some("p")),
                    it("c3", "막힌 것", "blocked", 3, None),
                    it("c4", "다음 것", "todo", 4, None),
                ],
            ),
            plan(
                "b",
                "active",
                "2026-10-28",
                vec![it("y", "[user] ok", "todo", 0, None)],
            ),
        ]);
        assert_eq!(
            d.plans
                .iter()
                .map(|p| p.plan_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        let a = &d.plans[1];
        assert_eq!(a.next.as_ref().unwrap().item_id, "c4");
        assert_eq!((a.done_count, a.item_count), (2, 4));
        assert!(!a.last_verdict.as_ref().unwrap().passed);
        assert!(
            d.plans[0].next.is_none(),
            "사람 몫만 남은 플랜엔 다음이 없다"
        );
        assert_eq!(
            d.needs_user
                .iter()
                .map(|i| i.item_id.as_str())
                .collect::<Vec<_>>(),
            ["y", "c2"]
        );
        assert_eq!(d.blocked.len(), 1);
        assert_eq!(d.blocked[0].item_id, "c3");
        assert_eq!(
            d.journal_plan,
            vec![JournalPlanLink {
                journal_ref: "20261028/Bugs/1402_bug_a.md".into(),
                plan_id: "a".into(),
                plan_title: "T a".into(),
                item_id: "p".into(),
            }]
        );
    }
}

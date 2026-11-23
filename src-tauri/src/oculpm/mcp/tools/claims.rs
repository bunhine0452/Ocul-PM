//! `[~]` 잡기의 주인과 나이 — `plan_status` 의 `plans[].claims` (love-round-20261123 #stale-in-progress-claims).
//!
//! `/oculpm:next` 는 `[~]` 를 「다른 세션이 잡은 것」으로 보고 건너뛴다. 그런데 크래시 · 컨텍스트 소진으로
//! 끝난 세션의 잡기는 누가 풀기 전까지 영원히 남았다 (이 저장소 polish-round 에 `[~]` 6개). plan-log 행에는
//! 이미 ts · agent 가 있으므로, 항목마다 마지막 `→~` 행을 찾아 누가 · 언제 잡았는지 싣고 오래됐으면
//! `stale` 로 표시한다. 그 판단(이어받기)은 에이전트가 한다 — 서버는 재료만 댄다.

use std::path::Path;

use serde_json::{json, Value};

use crate::oculpm::planner::log_archive::merge_archived_updates;
use crate::oculpm::planner::parse::{ItemStatus, ParsedPlan, PlanItemUpdate};

/// 이만큼 지난 잡기는 오래된 것 — 하루짜리 리프를 이틀 넘게 쥔 세션은 거의 끝난 세션이다.
pub(crate) const STALE_CLAIM_HOURS: i64 = 48;

/// 잡기 하나 — 리프 `[~]` 마다.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Claim {
    pub item: String,
    pub by: Option<String>,
    pub at: Option<String>,
    pub age_h: Option<i64>,
    /// 오래됐거나(48시간+) 잡은 기록이 아예 없다 — 살아 있는 잡기라고 보일 근거가 없다.
    pub stale: bool,
}

fn last_claim<'a>(updates: &'a [PlanItemUpdate], item: &str) -> Option<&'a PlanItemUpdate> {
    updates
        .iter()
        .rev()
        .find(|u| u.item_id == item && u.to_status.as_deref() == Some("in_progress"))
}

/// 리프 `[~]` 들의 잡기 — `updates` 는 그 플랜의 plan-log 행(오래된 것 먼저).
pub(crate) fn claims_from(
    parsed: &ParsedPlan,
    updates: &[PlanItemUpdate],
    now: jiff::Timestamp,
) -> Vec<Claim> {
    let parents = parsed.parent_ids();
    parsed
        .items
        .iter()
        .filter(|i| i.status == ItemStatus::InProgress && !parents.contains(i.item_id.as_str()))
        .map(|i| {
            let row = last_claim(updates, &i.item_id);
            let age_h = row
                .and_then(|r| crate::clock::parse_rfc3339(&r.ts))
                .map(|t| (now.as_second() - t.as_second()).max(0) / 3600);
            Claim {
                item: i.item_id.clone(),
                by: row.map(|r| r.agent_id.clone()).filter(|a| !a.is_empty()),
                at: row.map(|r| r.ts.clone()),
                age_h,
                stale: age_h.is_none_or(|h| h >= STALE_CLAIM_HOURS),
            }
        })
        .collect()
}

/// `plan_status` 가 싣는 모양 — 본문 plan-log 에 잡은 행이 없으면 아카이브(`<plan>.log.md`)까지 본다.
pub(crate) fn claims_json(planner_root: &Path, parsed: &ParsedPlan) -> Vec<Value> {
    let now = crate::clock::now();
    let mut claims = claims_from(parsed, &parsed.updates, now);
    if claims.iter().any(|c| c.at.is_none()) {
        let mut merged = parsed.clone();
        merge_archived_updates(planner_root, &mut merged, &[]);
        claims = claims_from(parsed, &merged.updates, now);
    }
    claims
        .into_iter()
        .map(|c| {
            json!({ "item": c.item, "by": c.by, "at": c.at, "age_h": c.age_h, "stale": c.stale })
        })
        .collect()
}

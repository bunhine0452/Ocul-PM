//! `home_brief` — 메인 화면(프로젝트 선택 화면)이 쓰는 단일 집계.
//!
//! # 왜 별도 커맨드인가
//!
//! `oculpm_workday_brief`(commands/oculpm.rs)를 대체하지 **않는다** — 목적이
//! 다르다. workday_brief 는 `for wd in workdays` 로 워크데이마다
//! `manager.list_journal_entries` 를 1회씩 호출하고, 그 각각이 본 쿼리 +
//! tags/files 하이드레이션을 돈다. 14일 × 프로젝트 10개면 수백 SQL 이 단일
//! 커넥션에서 직렬화된다 — Today 화면(단일 프로젝트)에는 적합하지만 홈(전
//! 프로젝트)에는 부적합하다.
//!
//! `home_brief` 는 **SQL 6문 고정**이며 프로젝트 수와 무관하다. 프로젝트가
//! 10개든 100개든 IPC 1회 · 쿼리 6개다.
//!
//! 이 주석이 없으면 미래의 누군가가 "중복 커맨드"라며 되돌린다.
//!
//! # 락을 잡지 않는다
//!
//! 이 모듈은 `OculpmManager` 를 참조하지 않는다 (인자로도 받지 않는다).
//! 매니저 init 은 프로젝트별 배타 락을 잡으므로, 홈에서 프로젝트 N개를
//! 훑으며 락을 건드리면 워처/에이전트와 경합한다. SQLite 캐시만 읽는다는
//! 사실을 **타입 시그니처로 강제**한다.
//!
//! # 신선도
//!
//! 읽는 테이블(`oculpm_journal`, `oculpm_plan_items`, `project_overviews`)은
//! 전부 디스크 마크다운에서 파생된 캐시다. 홈은 워처를 돌리지 않으므로
//! (프로젝트 미선택 상태에는 워처가 없다) 마지막 인덱싱 시점의 값을 본다 —
//! 홈의 용도(어디서 이어서 일할지 고르기)에는 충분하고, 프로젝트를 열면
//! 그 시점에 워처가 붙어 최신화된다.

use std::collections::HashMap;

use chrono::{Duration, Local};
use rusqlite::params;
use serde::Serialize;

use crate::db::{Db, OpenPlanItem};
use crate::error::Result;

/// 창(days)의 하한/상한. 프런트는 14를 보낸다.
const DAYS_MIN: u32 = 1;
const DAYS_MAX: u32 = 62;
/// 크로스 프로젝트 활동 피드 길이. 화면이 최대 8행을 그리고 여유를 둔다.
const FEED_LIMIT: i64 = 12;
/// 프로젝트당 "다음 할 일" 최대 개수.
const NEXT_TASK_CAP: usize = 3;
/// "활동 중"으로 셀 최근 일수 (`active_projects`).
const ACTIVE_WINDOW_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeDayCount {
    pub workday: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeActivePlan {
    pub plan_id: String,
    pub plan_title: String,
    /// 0..1 가중 롤업 (oculpm_plans.progress).
    pub progress: f64,
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeFeedItem {
    pub project_id: u32,
    pub relative_path: String,
    pub workday: String,
    pub created_at: String,
    pub title: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub agent_id: String,
    pub agent_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeProjectBrief {
    pub project_id: u32,
    /// 평생 일지 수 (창과 무관).
    pub total_entries: u32,
    /// MAX(created_at) — 창(days) 밖이어도 잡힌다. 오래 조용한 프로젝트도
    /// "마지막 활동 N일 전"을 정확히 말할 수 있어야 한다.
    pub last_at: Option<String>,
    pub last_workday: Option<String>,
    pub last_title: Option<String>,
    pub last_type: Option<String>,
    pub last_agent_id: Option<String>,
    pub last_agent_version: Option<String>,
    pub today_count: u32,
    /// 활동이 **있는 날만** 담는다 (희소 배열). 프런트가 days 길이로 0 패딩한다.
    pub days: Vec<HomeDayCount>,
    /// 활성 플랜의 미완 항목 ≤3 (진행중 우선).
    ///
    /// ⚠️ `oculpm_plan_items` 는 플래너 화면이 디스크 마크다운을 파싱할 때
    /// 채워지는 **투영 테이블**이다. 플래너를 한 번도 연 적 없는 프로젝트는
    /// 플랜 파일이 있어도 여기가 비어 있다 — 정상이며, 화면은 이 줄을
    /// 렌더하지 않는 것으로 대응한다 (틀린 값을 보여주지 않는다).
    pub next_tasks: Vec<OpenPlanItem>,
    pub active_plan: Option<HomeActivePlan>,
    /// `project_overviews.identity` — LLM 이 만든 캐시. 없으면 `None`.
    /// **여기서 생성하지 않는다** (LLM 호출 0).
    pub identity: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct HomeBrief {
    pub projects: Vec<HomeProjectBrief>,
    /// 로컬 캘린더 오늘 (YYYYMMDD).
    pub today_workday: String,
    /// 창의 시작일 (YYYYMMDD, 포함).
    pub since_workday: String,
    pub today_total: u32,
    /// 최근 7일 안에 일지가 하나라도 있는 프로젝트 수.
    pub active_projects: u32,
    /// 크로스 프로젝트 최신 12건.
    pub feed: Vec<HomeFeedItem>,
}

/// 로컬 캘린더 기준 YYYYMMDD. 프런트의 `calToday()` 와 같은 규약.
fn workday_key(offset_days: i64) -> String {
    let d = Local::now().date_naive() - Duration::days(offset_days);
    d.format("%Y%m%d").to_string()
}

/// 홈 화면 집계 전체. SQL 6문, 프로젝트 수 무관.
///
/// 모든 쿼리가 `JOIN projects` 를 낀다. `oculpm_journal` 은 `projects` 로의
/// 외래키가 없어서(migrations/012) 프로젝트를 워크스페이스에서 제거해도 일지
/// 행이 그대로 남는다 — 조인하지 않으면 지워진 프로젝트의 일지가 `today_total`
/// 과 `active_projects` 에 계속 더해지고, 피드에는 열 수 없는 유령 행이 뜬다.
pub async fn collect(db: &Db, days: u32) -> Result<HomeBrief> {
    let days = days.clamp(DAYS_MIN, DAYS_MAX);
    let today = workday_key(0);
    // days=14 → 오늘 포함 14일이므로 13일 전이 시작.
    let since = workday_key(days as i64 - 1);
    let active_since = workday_key(ACTIVE_WINDOW_DAYS - 1);

    let (since_q, active_since_q) = (since.clone(), active_since.clone());
    let today_q = today.clone();

    let brief = db
        .conn()
        .call(move |c| {
            // ── Q1 평생 집계 + 마지막 활동 시각 ───────────────────────────
            // 창 밖으로 밀려난 조용한 프로젝트의 "마지막 활동"을 저렴하게 얻는
            // 유일한 경로. GROUP BY 하나로 끝난다.
            let mut totals: HashMap<u32, (u32, Option<String>, Option<String>)> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    "SELECT j.project_id, COUNT(*), MAX(j.created_at), MAX(j.workday)
                       FROM oculpm_journal j
                       JOIN projects p ON p.id = j.project_id
                      GROUP BY j.project_id",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u32,
                        r.get::<_, i64>(1)? as u32,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                    ))
                })?;
                for row in rows {
                    let (pid, n, last_at, last_wd) = row?;
                    totals.insert(pid, (n, last_at, last_wd));
                }
            }

            // ── Q2 일별 버킷 (창 안) ──────────────────────────────────────
            let mut days_map: HashMap<u32, Vec<HomeDayCount>> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    "SELECT j.project_id, j.workday, COUNT(*)
                       FROM oculpm_journal j
                       JOIN projects p ON p.id = j.project_id
                      WHERE j.workday >= ?1
                      GROUP BY j.project_id, j.workday",
                )?;
                let rows = stmt.query_map(params![since_q], |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u32,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)? as u32,
                    ))
                })?;
                for row in rows {
                    let (pid, workday, count) = row?;
                    days_map
                        .entry(pid)
                        .or_default()
                        .push(HomeDayCount { workday, count });
                }
            }
            for v in days_map.values_mut() {
                v.sort_by(|a, b| a.workday.cmp(&b.workday));
            }

            // ── Q3 프로젝트별 최신 1건 ────────────────────────────────────
            // relative_path 를 2차 정렬키로 두어 같은 created_at 에서도 결정적.
            type LastEntry = (String, String, String, Option<String>);
            let mut last: HashMap<u32, LastEntry> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    "SELECT project_id, title, type, agent_id, agent_version FROM (
                       SELECT j.project_id, j.title, j.type, j.agent_id, j.agent_version,
                              ROW_NUMBER() OVER (PARTITION BY j.project_id
                                  ORDER BY j.created_at DESC, j.relative_path DESC) rn
                         FROM oculpm_journal j
                         JOIN projects p ON p.id = j.project_id
                     ) WHERE rn = 1",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u32,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<String>>(4)?,
                    ))
                })?;
                for row in rows {
                    let (pid, title, ty, agent, ver) = row?;
                    last.insert(pid, (title, ty, agent, ver));
                }
            }

            // ── Q4 크로스 프로젝트 피드 ───────────────────────────────────
            let mut feed: Vec<HomeFeedItem> = Vec::new();
            {
                let mut stmt = c.prepare(
                    "SELECT j.project_id, j.relative_path, j.workday, j.created_at, j.title,
                            j.type, j.agent_id, j.agent_version
                       FROM oculpm_journal j
                       JOIN projects p ON p.id = j.project_id
                      ORDER BY j.created_at DESC, j.relative_path DESC LIMIT ?1",
                )?;
                let rows = stmt.query_map(params![FEED_LIMIT], |r| {
                    Ok(HomeFeedItem {
                        project_id: r.get::<_, i64>(0)? as u32,
                        relative_path: r.get(1)?,
                        workday: r.get(2)?,
                        created_at: r.get(3)?,
                        title: r.get(4)?,
                        entry_type: r.get(5)?,
                        agent_id: r.get(6)?,
                        agent_version: r.get(7)?,
                    })
                })?;
                for row in rows {
                    feed.push(row?);
                }
            }

            // ── Q5 활성 플랜 미완 항목 상위 3 ─────────────────────────────
            // db.rs 의 list_open_plan_items 를 크로스 프로젝트로 일반화한 것.
            let mut next_tasks: HashMap<u32, Vec<OpenPlanItem>> = HashMap::new();
            let mut plan_of: HashMap<u32, (String, String, f64)> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    "SELECT project_id, plan_id, plan_title, item_id, item_title,
                            phase, status, progress FROM (
                       SELECT i.project_id, p.plan_id, p.title AS plan_title,
                              i.item_id, i.title AS item_title, i.phase, i.status,
                              p.progress,
                              ROW_NUMBER() OVER (PARTITION BY i.project_id
                                  ORDER BY (i.status='in_progress') DESC,
                                           p.updated_at DESC, i.order_idx ASC) rn,
                              DENSE_RANK() OVER (PARTITION BY i.project_id
                                  ORDER BY p.updated_at DESC, p.plan_id ASC) plan_rank
                         FROM oculpm_plan_items i
                         JOIN oculpm_plans p
                           ON p.project_id = i.project_id AND p.plan_id = i.plan_id
                         JOIN projects pr ON pr.id = i.project_id
                        WHERE p.status = 'active'
                          -- 컨테이너(부모) 항목은 실행 대상이 아니다. 자식을
                          -- 거느린 항목이 다음 할 일 슬롯을 잠식하면 정작
                          -- 손댈 수 있는 일이 밀려난다.
                          AND NOT EXISTS (
                                SELECT 1 FROM oculpm_plan_items c
                                 WHERE c.project_id = i.project_id
                                   AND c.plan_id = i.plan_id
                                   AND c.parent_item = i.item_id)
                          AND i.status IN ('todo','in_progress','blocked')
                     ) WHERE plan_rank = 1 AND rn <= ?1",
                )?;
                let rows = stmt.query_map(params![NEXT_TASK_CAP as i64], |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u32,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        OpenPlanItem {
                            plan_id: r.get(1)?,
                            plan_title: r.get(2)?,
                            item_id: r.get(3)?,
                            item_title: r.get(4)?,
                            phase: r.get(5)?,
                            status: r.get(6)?,
                        },
                        r.get::<_, f64>(7)?,
                    ))
                })?;
                for row in rows {
                    let (pid, plan_id, plan_title, item, progress) = row?;
                    // 첫 행(rn=1)의 플랜이 그 프로젝트의 대표 활성 플랜.
                    plan_of
                        .entry(pid)
                        .or_insert((plan_id, plan_title, progress));
                    next_tasks.entry(pid).or_default().push(item);
                }
            }

            // ── Q5b 플랜별 완료/전체 카운트 ───────────────────────────────
            let mut counts: HashMap<(u32, String), (u32, u32)> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    // 모수에서 컨테이너(부모) 항목과 취소/보류 항목을 뺀다 —
                    // 넣으면 "3/12" 같은 수치가 플래너 화면과 어긋나고, 끝낼
                    // 수 없는 항목이 분모에 남아 진행률이 100%에 못 닿는다.
                    "SELECT i.project_id, i.plan_id,
                            SUM(CASE WHEN i.status='done' THEN 1 ELSE 0 END), COUNT(*)
                       FROM oculpm_plan_items i
                       JOIN projects p ON p.id = i.project_id
                      WHERE i.status NOT IN ('dropped','deferred')
                        AND NOT EXISTS (
                              SELECT 1 FROM oculpm_plan_items c
                               WHERE c.project_id = i.project_id
                                 AND c.plan_id = i.plan_id
                                 AND c.parent_item = i.item_id)
                      GROUP BY i.project_id, i.plan_id",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u32,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)? as u32,
                        r.get::<_, i64>(3)? as u32,
                    ))
                })?;
                for row in rows {
                    let (pid, plan_id, done, total) = row?;
                    counts.insert((pid, plan_id), (done, total));
                }
            }

            // ── Q6 정체성 (순수 SELECT — LLM 아님) ────────────────────────
            let mut identity: HashMap<u32, String> = HashMap::new();
            {
                let mut stmt = c.prepare(
                    "SELECT o.project_id, o.identity FROM project_overviews o
                       JOIN projects p ON p.id = o.project_id
                      WHERE o.identity IS NOT NULL AND o.identity <> ''",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((r.get::<_, i64>(0)? as u32, r.get::<_, String>(1)?))
                })?;
                for row in rows {
                    let (pid, id) = row?;
                    identity.insert(pid, id);
                }
            }

            // ── 조립 ─────────────────────────────────────────────────────
            // 키 합집합: 일지가 없어도 플랜/정체성만 있는 프로젝트를 빠뜨리지
            // 않는다 (그린필드 직후가 정확히 그 상태다).
            let mut ids: Vec<u32> = totals.keys().copied().collect();
            for k in days_map.keys().chain(next_tasks.keys()).chain(identity.keys()) {
                if !ids.contains(k) {
                    ids.push(*k);
                }
            }
            ids.sort_unstable();

            let mut projects = Vec::with_capacity(ids.len());
            let mut today_total = 0u32;
            let mut active_projects = 0u32;

            for pid in ids {
                let (total_entries, last_at, last_workday) =
                    totals.get(&pid).cloned().unwrap_or((0, None, None));
                let days_vec = days_map.get(&pid).cloned().unwrap_or_default();

                let today_count = days_vec
                    .iter()
                    .find(|d| d.workday == today_q)
                    .map(|d| d.count)
                    .unwrap_or(0);
                today_total += today_count;
                if days_vec.iter().any(|d| d.workday >= active_since_q) {
                    active_projects += 1;
                }

                let (last_title, last_type, last_agent_id, last_agent_version) =
                    match last.get(&pid) {
                        Some((t, ty, a, v)) => {
                            (Some(t.clone()), Some(ty.clone()), Some(a.clone()), v.clone())
                        }
                        None => (None, None, None, None),
                    };

                let active_plan = plan_of.get(&pid).map(|(plan_id, plan_title, progress)| {
                    let (done, total) = counts
                        .get(&(pid, plan_id.clone()))
                        .copied()
                        .unwrap_or((0, 0));
                    HomeActivePlan {
                        plan_id: plan_id.clone(),
                        plan_title: plan_title.clone(),
                        progress: *progress,
                        done,
                        total,
                    }
                });

                projects.push(HomeProjectBrief {
                    project_id: pid,
                    total_entries,
                    last_at,
                    last_workday,
                    last_title,
                    last_type,
                    last_agent_id,
                    last_agent_version,
                    today_count,
                    days: days_vec,
                    next_tasks: next_tasks.get(&pid).cloned().unwrap_or_default(),
                    active_plan,
                    identity: identity.get(&pid).cloned(),
                });
            }

            Ok(HomeBrief {
                projects,
                today_workday: today_q,
                since_workday: since_q,
                today_total,
                active_projects,
                feed,
            })
        })
        .await?;

    Ok(brief)
}

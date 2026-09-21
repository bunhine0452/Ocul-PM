//! journal-scale-round `{#velocity}` — 주당 일지 건수·유형 비율 + 플랜 완료
//! 속도. Today 의 `VelocityCard`(`{#velocity-card}`)가 이 데이터를 그린다.
//!
//! 두 부분:
//!  - `weeks`: `oculpm_journal` 을 월요일 시작 ISO 주 단위로 묶어 타입별
//!    (feature/bug/error/refactor/chore) 집계. 최근 N 주를 **연속으로**
//!    만들고 일지가 없는 주도 0 으로 채운다 — `db::hotspot` 이 "허브 파일"
//!    잡음을 거르듯, 여기서는 "일지가 없던 주가 조용히 사라지는" 걸 막는다
//!    (빈 주가 사라지면 막대 그래프의 x축 간격이 거짓말을 한다).
//!  - `plan`: `oculpm_plan_items` 의 미완(= done/dropped 가 아닌) 개수와,
//!    `oculpm_plan_item_updates` 의 최근 4주 `to_status='done'` 전이 수로
//!    ETA(= 미완 / 최근 4주 평균)를 추정한다. 그 표가 통째로 비어 있으면
//!    (플래너를 한 번도 안 그린 프로젝트) `note` 로 그 사실을 드러낸다 — 단순
//!    "최근 4주에 완료가 0건" 과는 다른 사실이라 섞으면 안 된다.
//!
//! 주 경계·집계·ETA 계산은 DB 없이 테스트할 수 있게 순수 함수로 뺐다
//! (`recent_week_bounds` / `bucket_journal_rows` / `count_done_in_window` /
//! `compute_eta`) — 아래 테스트가 그 함수들을 직접 부른다.

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};

use super::*;

/// `weeks` 파라미터 하한 (커맨드 레이어가 clamp 에 쓴다).
pub const MIN_WEEKS: u32 = 1;
/// `weeks` 파라미터 상한.
pub const MAX_WEEKS: u32 = 26;
/// 커맨드가 `weeks` 를 안 주면 이 값.
pub const DEFAULT_WEEKS: u32 = 8;
/// ETA 의 "최근 4주 평균" 창 — 하드코딩(스펙이 정한 상수, 파라미터 아님).
const ETA_WINDOW_WEEKS: u32 = 4;

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, specta::Type)]
pub struct TypeCounts {
    pub feature: u32,
    pub bug: u32,
    pub error: u32,
    pub refactor: u32,
    pub chore: u32,
}

impl TypeCounts {
    fn add(&mut self, entry_type: &str) {
        match entry_type {
            "feature" => self.feature += 1,
            "bug" => self.bug += 1,
            "error" => self.error += 1,
            "refactor" => self.refactor += 1,
            "chore" => self.chore += 1,
            // 알 수 없는 type 은 조용히 무시 — 스키마가 보장하는 enum 밖 값이
            // 캐시에 섞였다면 그건 이 화면이 아니라 인덱서가 잡을 문제다.
            _ => {}
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
pub struct AgentCount {
    pub agent_id: String,
    pub count: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct WeekBucket {
    /// "2026-W38" (월요일이 속한 ISO 주).
    pub iso_week: String,
    /// 그 주의 월요일, workday 형식 "YYYYMMDD".
    pub from_workday: String,
    /// 그 주의 일요일, workday 형식 "YYYYMMDD".
    pub to_workday: String,
    pub total: u32,
    pub by_type: TypeCounts,
    /// count 내림차순 → agent_id 오름차순 (동점을 결정적으로).
    pub by_agent: Vec<AgentCount>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct PlanVelocity {
    pub open_items: u32,
    pub done_last_4w: u32,
    pub weekly_done_avg: f64,
    pub eta_weeks: Option<f64>,
    /// `oculpm_plan_item_updates` 가 이 프로젝트에 대해 통째로 빈 경우에만
    /// Some — "플래너를 한 번도 안 그렸다" 는 "최근 4주에 완료가 없다" 와
    /// 다른 사실이라 별도로 알린다.
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Velocity {
    /// 오래된 주 → 최신 주(오늘이 속한 주) 순, `WeekChart` 와 같은 방향.
    pub weeks: Vec<WeekBucket>,
    pub plan: PlanVelocity,
}

/// 월요일 시작 주 경계 `weeks`개를 오래된 → 최신 순으로. 마지막 항목은
/// `today` 가 속한 주(진행 중이라도 그대로 포함 — "이번 주는 아직 안 끝나서
/// 뺀다" 는 판단은 하지 않는다, WeekChart 의 "오늘" 처리와 같은 선).
fn recent_week_bounds(today: NaiveDate, weeks: u32) -> Vec<(NaiveDate, NaiveDate)> {
    let this_monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    (0..weeks)
        .rev()
        .map(|back| {
            let monday = this_monday - Duration::days(7 * back as i64);
            (monday, monday + Duration::days(6))
        })
        .collect()
}

fn workday_fmt(d: NaiveDate) -> String {
    d.format("%Y%m%d").to_string()
}

fn iso_week_label(d: NaiveDate) -> String {
    let iw = d.iso_week();
    format!("{}-W{:02}", iw.year(), iw.week())
}

fn parse_workday(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y%m%d").ok()
}

/// `bounds` 안에서 `d` 가 속한 주의 인덱스. 경계는 항상 연속·비겹침이라
/// 선형 탐색으로 충분하다 (많아야 `MAX_WEEKS`=26개).
fn bucket_index(bounds: &[(NaiveDate, NaiveDate)], d: NaiveDate) -> Option<usize> {
    bounds.iter().position(|(from, to)| d >= *from && d <= *to)
}

/// `(workday, type, agent_id)` 원본 행을 주 버킷에 채운다 — 없는 주도 0 인
/// 채로 `bounds` 순서 그대로 남는다 (연속·빈 주 보존이 이 함수의 핵심).
fn bucket_journal_rows(
    bounds: &[(NaiveDate, NaiveDate)],
    rows: &[(String, String, String)],
) -> Vec<WeekBucket> {
    let mut buckets: Vec<WeekBucket> = bounds
        .iter()
        .map(|(from, to)| WeekBucket {
            iso_week: iso_week_label(*from),
            from_workday: workday_fmt(*from),
            to_workday: workday_fmt(*to),
            total: 0,
            by_type: TypeCounts::default(),
            by_agent: Vec::new(),
        })
        .collect();
    let mut agent_counts: Vec<HashMap<String, u32>> = vec![HashMap::new(); buckets.len()];

    for (workday, entry_type, agent_id) in rows {
        let Some(d) = parse_workday(workday) else {
            continue;
        };
        let Some(idx) = bucket_index(bounds, d) else {
            continue;
        };
        let b = &mut buckets[idx];
        b.total += 1;
        b.by_type.add(entry_type);
        *agent_counts[idx].entry(agent_id.clone()).or_insert(0) += 1;
    }

    for (b, counts) in buckets.iter_mut().zip(agent_counts) {
        let mut v: Vec<AgentCount> = counts
            .into_iter()
            .map(|(agent_id, count)| AgentCount { agent_id, count })
            .collect();
        v.sort_by(|a, c| {
            c.count
                .cmp(&a.count)
                .then_with(|| a.agent_id.cmp(&c.agent_id))
        });
        b.by_agent = v;
    }

    buckets
}

/// `to_status='done'` 전이 timestamp(RFC3339) 목록 중 `bounds` 창 안에 속한
/// 개수. 파싱 실패 행은 조용히 건너뛴다 — 플랜 캐시는 마크다운에서 재구성
/// 가능한 파생값이라 여기서 패닉할 이유가 없다.
fn count_done_in_window(bounds: &[(NaiveDate, NaiveDate)], done_ts: &[String]) -> u32 {
    done_ts
        .iter()
        .filter_map(|ts| DateTime::parse_from_rfc3339(ts).ok())
        .filter(|dt| bucket_index(bounds, dt.date_naive()).is_some())
        .count() as u32
}

/// `open_items` 를 `weekly_done_avg` 로 나눈 ETA. 평균이 0 이면(=최근
/// `ETA_WINDOW_WEEKS`주 동안 완료가 하나도 없으면) 나눗셈이 무의미하므로
/// `None`.
fn compute_eta(open_items: u32, weekly_done_avg: f64) -> Option<f64> {
    if weekly_done_avg > 0.0 {
        Some(open_items as f64 / weekly_done_avg)
    } else {
        None
    }
}

impl Db {
    pub async fn velocity(&self, project_id: u32, weeks: u32) -> Result<Velocity> {
        let weeks = weeks.clamp(MIN_WEEKS, MAX_WEEKS);
        let today = Local::now().date_naive();
        let bounds = recent_week_bounds(today, weeks);
        let earliest = workday_fmt(bounds[0].0);
        let latest = workday_fmt(bounds[bounds.len() - 1].1);

        let journal_rows: Vec<(String, String, String)> = self
            .conn
            .call({
                let project_id = project_id as i64;
                let earliest = earliest.clone();
                let latest = latest.clone();
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT workday, type, agent_id FROM oculpm_journal
                         WHERE project_id = ?1 AND workday >= ?2 AND workday <= ?3",
                    )?;
                    let out = stmt
                        .query_map(params![project_id, earliest, latest], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                            ))
                        })?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    Ok(out)
                }
            })
            .await?;

        let week_buckets = bucket_journal_rows(&bounds, &journal_rows);

        let open_items: u32 = self
            .conn
            .call({
                let project_id = project_id as i64;
                move |c| {
                    let n: i64 = c.query_row(
                        "SELECT COUNT(*) FROM oculpm_plan_items
                         WHERE project_id = ?1 AND status NOT IN ('done', 'dropped')",
                        params![project_id],
                        |r| r.get(0),
                    )?;
                    Ok(n)
                }
            })
            .await? as u32;

        let updates_total: i64 = self
            .conn
            .call({
                let project_id = project_id as i64;
                move |c| {
                    let n: i64 = c.query_row(
                        "SELECT COUNT(*) FROM oculpm_plan_item_updates WHERE project_id = ?1",
                        params![project_id],
                        |r| r.get(0),
                    )?;
                    Ok(n)
                }
            })
            .await?;

        let done_ts: Vec<String> = self
            .conn
            .call({
                let project_id = project_id as i64;
                move |c| {
                    let mut stmt = c.prepare(
                        "SELECT ts FROM oculpm_plan_item_updates
                         WHERE project_id = ?1 AND to_status = 'done'",
                    )?;
                    let out = stmt
                        .query_map(params![project_id], |r| r.get::<_, String>(0))?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    Ok(out)
                }
            })
            .await?;

        let eta_bounds = recent_week_bounds(today, ETA_WINDOW_WEEKS);
        let done_last_4w = count_done_in_window(&eta_bounds, &done_ts);
        let weekly_done_avg = f64::from(done_last_4w) / f64::from(ETA_WINDOW_WEEKS);
        let eta_weeks = compute_eta(open_items, weekly_done_avg);
        let note = (updates_total == 0).then(|| {
            "플래너를 한 번도 안 그린 프로젝트라 완료 속도를 계산할 이력이 없어요.".to_string()
        });

        Ok(Velocity {
            weeks: week_buckets,
            plan: PlanVelocity {
                open_items,
                done_last_4w,
                weekly_done_avg,
                eta_weeks,
                note,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn monday(y: i32, m: u32, d: u32) -> NaiveDate {
        let date = NaiveDate::from_ymd_opt(y, m, d).unwrap();
        assert_eq!(
            date.weekday().num_days_from_monday(),
            0,
            "테스트 픽스처가 월요일이 아니다: {date}"
        );
        date
    }

    /// 3주 연속 경계를 만들고, 가운데 주를 비운 채 행을 흩뿌려도 그 주가
    /// total=0 으로 살아남는지 — "일지가 없던 주가 조용히 사라지는" 회귀를
    /// 잡는 테스트.
    #[test]
    fn buckets_rows_into_continuous_weeks_keeping_empty_weeks_at_zero() {
        // 2026-09-07 은 월요일. 3주 창 = [08-24..08-30] [08-31..09-06] [09-07..09-13].
        let today = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(); // 수요일, 셋째 주 안
        let bounds = recent_week_bounds(today, 3);
        assert_eq!(
            bounds,
            vec![
                (
                    monday(2026, 8, 24),
                    NaiveDate::from_ymd_opt(2026, 8, 30).unwrap()
                ),
                (
                    monday(2026, 8, 31),
                    NaiveDate::from_ymd_opt(2026, 9, 6).unwrap()
                ),
                (
                    monday(2026, 9, 7),
                    NaiveDate::from_ymd_opt(2026, 9, 13).unwrap()
                ),
            ],
            "월요일 시작 3주가 연속·오래된순이어야 한다"
        );

        let rows = vec![
            (
                "20260824".to_string(),
                "bug".to_string(),
                "claude-code".to_string(),
            ),
            (
                "20260825".to_string(),
                "feature".to_string(),
                "claude-code".to_string(),
            ),
            (
                "20260825".to_string(),
                "feature".to_string(),
                "cursor".to_string(),
            ),
            // 가운데 주(08-31..09-06)에는 일부러 아무 행도 안 넣는다.
            (
                "20260909".to_string(),
                "chore".to_string(),
                "claude-code".to_string(),
            ),
        ];
        let buckets = bucket_journal_rows(&bounds, &rows);

        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0].total, 3);
        assert_eq!(buckets[0].by_type.bug, 1);
        assert_eq!(buckets[0].by_type.feature, 2);
        assert_eq!(
            buckets[0].by_agent,
            vec![
                AgentCount {
                    agent_id: "claude-code".into(),
                    count: 2
                },
                AgentCount {
                    agent_id: "cursor".into(),
                    count: 1
                },
            ],
            "count 내림차순 → agent_id 오름차순"
        );

        assert_eq!(
            buckets[1].total, 0,
            "빈 주는 사라지지 않고 0 으로 남아야 한다"
        );
        assert_eq!(buckets[1].by_type, TypeCounts::default());
        assert!(buckets[1].by_agent.is_empty());

        assert_eq!(buckets[2].total, 1);
        assert_eq!(buckets[2].by_type.chore, 1);
        assert_eq!(buckets[2].iso_week, "2026-W37");
    }

    /// ETA = open/avg, avg 가 0 이면 None. `count_done_in_window` 가 창 밖의
    /// done 전이를 세지 않는 것도 같이 검증한다.
    #[test]
    fn eta_is_none_when_recent_avg_is_zero_otherwise_open_over_avg() {
        assert_eq!(
            compute_eta(40, 0.0),
            None,
            "최근 완료가 0건이면 나눗셈이 무의미하다"
        );
        assert_eq!(compute_eta(40, 10.0), Some(4.0));
        assert_eq!(
            compute_eta(0, 0.0),
            None,
            "미완이 0건이어도 avg=0 이면 그대로 None"
        );

        // 4주 창 = [08-17..08-23][08-24..08-30][08-31..09-06][09-07..09-13].
        let today = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap();
        let bounds = recent_week_bounds(today, 4);
        let done_ts = vec![
            "2026-08-10T10:00:00+09:00".to_string(), // 창 밖 — 창 시작(08-17)보다 1주 이르다
            "2026-09-01T10:00:00+09:00".to_string(), // 창 안
            "2026-09-09T10:00:00+09:00".to_string(), // 창 안
        ];
        assert_eq!(count_done_in_window(&bounds, &done_ts), 2);
        let avg = f64::from(count_done_in_window(&bounds, &done_ts)) / 4.0;
        assert_eq!(compute_eta(4, avg), Some(8.0));
    }

    /// DB 통합: 저널 캐시 + 플랜 캐시를 같이 시드해 `Db::velocity` 전체
    /// 경로(쿼리 3~4개 조합)가 순수 함수와 같은 답을 내는지 확인. `note` 는
    /// `oculpm_plan_item_updates` 가 비어 있을 때만 서는지도 같이 본다.
    #[tokio::test]
    async fn velocity_end_to_end_matches_pure_functions_and_flags_empty_plan_history() {
        let dir = tempdir().unwrap();
        let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();

        // `Db::velocity` 는 실행 시점의 `Local::now()` 를 "오늘" 로 쓴다 — 이
        // 테스트도 같은 시계로 "이번 주 월요일" 을 구해 그 위에 시드해야
        // 실행 시점의 실제 날짜와 무관하게 안정적이다 (고정 날짜를 박으면
        // 그 날짜의 주가 더 이상 "최근 N주" 창에 안 걸리는 순간 조용히
        // 깨진다).
        let today = Local::now().date_naive();
        let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        let feature_wd = workday_fmt(monday);
        let bug_wd = workday_fmt(monday + Duration::days(1));
        let feature_ts = format!("{}T10:00:00+09:00", monday.format("%Y-%m-%d"));
        let bug_ts = format!(
            "{}T10:00:00+09:00",
            (monday + Duration::days(1)).format("%Y-%m-%d")
        );
        // done 전이도 이번 주 안 — 4주 평균 창에 반드시 걸리게 한다.
        let done_ts = bug_ts.clone();

        let sql = format!(
            "INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');
             INSERT INTO oculpm_journal
               (project_id, relative_path, workday, type, slug, status, title,
                session_id, agent_id, language, verified_by_user, created_at,
                file_mtime, body_markdown, body_md_hash)
             VALUES
               (1, '{feature_wd}/Features_to_add/a.md', '{feature_wd}', 'feature', 's', 'done',
                'a', 'manual-x', 'claude-code', 'ko', 0, '{feature_ts}', 0, '', 'h'),
               (1, '{bug_wd}/Bugs/b.md', '{bug_wd}', 'bug', 's', 'done',
                'b', 'manual-x', 'claude-code', 'ko', 0, '{bug_ts}', 0, '', 'h');
             INSERT INTO oculpm_plans (project_id, plan_id, title, status, owner_agent, progress, file_path, updated_at)
             VALUES (1, 'p1', 'Plan', 'active', 'claude-code', 0.5, '.oculpm/planner/p1.md', '{done_ts}');
             INSERT INTO oculpm_plan_items (project_id, plan_id, item_id, title, status, order_idx)
             VALUES
               (1, 'p1', '#a', 'A', 'todo', 0),
               (1, 'p1', '#b', 'B', 'in_progress', 1),
               (1, 'p1', '#c', 'C', 'done', 2),
               (1, 'p1', '#d', 'D', 'dropped', 3);
             INSERT INTO oculpm_plan_item_updates (project_id, plan_id, item_id, ts, agent_id, from_status, to_status)
             VALUES (1, 'p1', '#c', '{done_ts}', 'claude-code', 'todo', 'done');"
        );
        db.conn()
            .call(move |c| -> Result<()> {
                c.execute_batch(&sql)?;
                Ok(())
            })
            .await
            .unwrap();

        let v = db.velocity(1, 3).await.unwrap();
        assert_eq!(v.weeks.len(), 3);
        // 마지막 주(오늘이 속한 주)에 feature 1 + bug 1 이 잡혀야 한다.
        let last = v.weeks.last().unwrap();
        assert_eq!(last.total, 2);
        assert_eq!(last.by_type.feature, 1);
        assert_eq!(last.by_type.bug, 1);

        assert_eq!(
            v.plan.open_items, 2,
            "todo + in_progress, done/dropped 는 제외"
        );
        assert_eq!(v.plan.done_last_4w, 1);
        assert_eq!(v.plan.weekly_done_avg, 0.25);
        assert_eq!(v.plan.eta_weeks, Some(8.0));
        assert_eq!(
            v.plan.note, None,
            "업데이트 이력이 있으면 note 가 없어야 한다"
        );

        // 두 번째 프로젝트 — 플랜 이력이 아예 없다 → note 가 서야 한다.
        db.conn()
            .call(|c| -> Result<()> {
                c.execute_batch(
                    "INSERT INTO projects (id, name, root_path) VALUES (2, 'q', '/tmp/q');",
                )?;
                Ok(())
            })
            .await
            .unwrap();
        let v2 = db.velocity(2, 3).await.unwrap();
        assert_eq!(v2.plan.open_items, 0);
        assert_eq!(v2.plan.done_last_4w, 0);
        assert_eq!(v2.plan.eta_weeks, None);
        assert!(
            v2.plan.note.is_some(),
            "플랜 이력이 전혀 없으면 note 로 알려야 한다"
        );
        assert!(v2.weeks.iter().all(|w| w.total == 0));
    }
}

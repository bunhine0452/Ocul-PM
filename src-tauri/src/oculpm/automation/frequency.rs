//! 빈도 모델 — "다음 실행 시각은 언제인가" 하나만 답하는 순수 계산.
//!
//! Osaurus 의 8빈도를 그대로 가져왔다 (`01-automation.md` §1.1). 정의 파일의
//! 문자열 필드(`frequency`/`at`/`weekday`/…)를 [`ScheduleSpec`] 으로 읽고,
//! [`ScheduleSpec::next_run_after`] 가 **시각을 주입받아** 다음 실행을 낸다 —
//! 여기서 시계를 읽지 않으므로 "3일 꺼져 있었다" 같은 시나리오를 결정적으로
//! 시험할 수 있다.
//!
//! # 타임존은 프로젝트 워크데이 타임존이다
//!
//! `17:00` 은 벽시계 시각이지 UTC 오프셋이 아니다. 그래서 계산은 **로컬 naive
//! 시각**에서 하고 마지막에 tz 로 되돌린다. DST 두 경계를 모두 정의한다:
//!
//! - **없는 시각**(봄, 02:30 이 건너뛰어짐) → 한 시간 밀어 재시도. 하루를
//!   통째로 거르는 것보다 늦게라도 도는 편이 기록기의 약속에 맞는다.
//! - **두 번 있는 시각**(가을, 02:30 이 두 번) → 이른 쪽. 한 번만 돈다.
//!
//! # 월말·윤년은 **자른다**
//!
//! `day_of_month: 31` 은 2월에 존재하지 않는다. 건너뛰면 2·4·6·9·11월에 조용히
//! 안 도는데, 사용자가 고른 건 "매달"이다. 그 달의 마지막 날로 자른다 (2/29 →
//! 평년 2/28 도 같다).

#![allow(dead_code)] // 집행 루프(scheduler.rs)와 커맨드가 소비한다.

use std::str::FromStr;

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

use crate::oculpm::automation::store::AutomationDef;

/// 탐색 상한 — 어떤 빈도든 이 횟수 안에 다음 시각이 나온다 (yearly 가 최악:
/// 윤년 자르기까지 봐도 2회). 무한 루프를 구조적으로 막는 안전벨트다.
const MAX_STEPS: u32 = 512;

/// `minutes` 빈도의 N 상한 (1분~하루).
const MAX_EVERY_MINUTES: u32 = 1_440;
/// `hourly` 빈도의 N 상한.
const MAX_EVERY_HOURS: u32 = 24;

/// 8빈도. 정의 파일의 `frequency:` 문자열과 1:1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Once,
    Minutes,
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
    Cron,
}

impl Frequency {
    pub const ALL: [Frequency; 8] = [
        Frequency::Once,
        Frequency::Minutes,
        Frequency::Hourly,
        Frequency::Daily,
        Frequency::Weekly,
        Frequency::Monthly,
        Frequency::Yearly,
        Frequency::Cron,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Frequency::Once => "once",
            Frequency::Minutes => "minutes",
            Frequency::Hourly => "hourly",
            Frequency::Daily => "daily",
            Frequency::Weekly => "weekly",
            Frequency::Monthly => "monthly",
            Frequency::Yearly => "yearly",
            Frequency::Cron => "cron",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|f| f.as_str() == s.trim())
    }
}

/// 해석된 스케줄. 필드 조합이 이미 검증돼 있다 — [`ScheduleSpec::next_run_after`]
/// 는 더 이상 실패하지 않는다(빈도가 소진된 `once` 만 `None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleSpec {
    /// 한 번만. 로컬 벽시계 기준.
    Once {
        at: NaiveDateTime,
    },
    /// N분마다 (마지막 실행 기준 상대 간격).
    Minutes {
        every: u32,
    },
    /// N시간마다, 매시 `minute` 분에.
    Hourly {
        every: u32,
        minute: u32,
    },
    Daily {
        hour: u32,
        minute: u32,
    },
    Weekly {
        weekday: chrono::Weekday,
        hour: u32,
        minute: u32,
    },
    /// `day` 가 그 달에 없으면 말일로 자른다.
    Monthly {
        day: u32,
        hour: u32,
        minute: u32,
    },
    /// `2/29` 는 평년에 `2/28` 로 잘린다.
    Yearly {
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
    },
    /// 5필드(표준) 또는 6·7필드(`cron` 크레이트 원형).
    Cron {
        expr: String,
    },
}

/// 해석 실패 사유. **UI 언어를 넣지 않는다** — 커맨드가 `AppError.code` 로
/// 그대로 실어 보내고 프런트가 i18n 키로 바꾼다.
pub type SpecError = &'static str;

fn parse_hhmm(raw: &str) -> Result<(u32, u32), SpecError> {
    let (h, m) = raw.trim().split_once(':').ok_or("automation_bad_time")?;
    let hour: u32 = h.trim().parse().map_err(|_| "automation_bad_time")?;
    let minute: u32 = m.trim().parse().map_err(|_| "automation_bad_time")?;
    if hour > 23 || minute > 59 {
        return Err("automation_bad_time");
    }
    Ok((hour, minute))
}

fn parse_weekday(raw: &str) -> Result<chrono::Weekday, SpecError> {
    raw.trim()
        .to_ascii_lowercase()
        .parse::<chrono::Weekday>()
        .map_err(|_| "automation_bad_weekday")
}

/// 5필드 표준 cron 을 `cron` 크레이트가 받는 6필드(초 선두)로 맞춘다.
/// 6·7필드는 그대로 통과.
pub fn normalize_cron(expr: &str) -> String {
    let fields = expr.split_whitespace().count();
    if fields == 5 {
        format!("0 {}", expr.trim())
    } else {
        expr.trim().to_string()
    }
}

impl ScheduleSpec {
    /// 정의 파일 → 스케줄. 스케줄이 아닌 정의(`kind: watcher`)는 `Err`.
    pub fn from_def(def: &AutomationDef) -> Result<Self, SpecError> {
        let raw = def.frequency.as_deref().unwrap_or("").trim();
        let freq = Frequency::parse(raw).ok_or("automation_bad_frequency")?;
        let at = def.at.as_deref().unwrap_or("").trim();

        match freq {
            Frequency::Once => {
                let parsed = NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M:%S")
                    .or_else(|_| NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M"))
                    .or_else(|_| NaiveDateTime::parse_from_str(at, "%Y-%m-%d %H:%M"))
                    .map_err(|_| "automation_bad_time")?;
                Ok(ScheduleSpec::Once { at: parsed })
            }
            Frequency::Minutes => {
                let every = def.every.unwrap_or(0);
                if !(1..=MAX_EVERY_MINUTES).contains(&every) {
                    return Err("automation_bad_interval");
                }
                Ok(ScheduleSpec::Minutes { every })
            }
            Frequency::Hourly => {
                let every = def.every.unwrap_or(1);
                if !(1..=MAX_EVERY_HOURS).contains(&every) {
                    return Err("automation_bad_interval");
                }
                // `at` 은 선택 — 없으면 정시(:00).
                let minute = if at.is_empty() { 0 } else { parse_hhmm(at)?.1 };
                Ok(ScheduleSpec::Hourly { every, minute })
            }
            Frequency::Daily => {
                let (hour, minute) = parse_hhmm(at)?;
                Ok(ScheduleSpec::Daily { hour, minute })
            }
            Frequency::Weekly => {
                let (hour, minute) = parse_hhmm(at)?;
                let weekday = parse_weekday(def.weekday.as_deref().unwrap_or(""))?;
                Ok(ScheduleSpec::Weekly {
                    weekday,
                    hour,
                    minute,
                })
            }
            Frequency::Monthly => {
                let (hour, minute) = parse_hhmm(at)?;
                let day = def.day_of_month.unwrap_or(0);
                if !(1..=31).contains(&day) {
                    return Err("automation_bad_day");
                }
                Ok(ScheduleSpec::Monthly { day, hour, minute })
            }
            Frequency::Yearly => {
                let (hour, minute) = parse_hhmm(at)?;
                let month = def.month.unwrap_or(0);
                let day = def.day.unwrap_or(0);
                if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
                    return Err("automation_bad_day");
                }
                Ok(ScheduleSpec::Yearly {
                    month,
                    day,
                    hour,
                    minute,
                })
            }
            Frequency::Cron => {
                let expr = def.cron.as_deref().unwrap_or("").trim();
                if expr.is_empty() {
                    return Err("automation_bad_cron");
                }
                let normalized = normalize_cron(expr);
                cron::Schedule::from_str(&normalized).map_err(|_| "automation_bad_cron")?;
                Ok(ScheduleSpec::Cron { expr: normalized })
            }
        }
    }

    /// `after` **이후**의 첫 실행 시각. `None` = 다시 돌지 않는다 (지나간 `once`).
    pub fn next_run_after(&self, tz: Tz, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let local = after.with_timezone(&tz).naive_local();

        match self {
            ScheduleSpec::Once { at } => (*at > local).then(|| resolve_local(tz, *at)).flatten(),
            // 상대 간격 — 벽시계에 정렬하지 않는다 (잦은 폴링의 의미가 그것이다).
            ScheduleSpec::Minutes { every } => Some(after + Duration::minutes(i64::from(*every))),
            ScheduleSpec::Hourly { every, minute } => {
                let mut cand = local
                    .with_minute(*minute)?
                    .with_second(0)?
                    .with_nanosecond(0)?;
                let step = Duration::hours(i64::from(*every));
                if cand > local {
                    // 이번 시(時)의 분이 아직 안 지났으면 그대로.
                } else {
                    cand += step;
                }
                for _ in 0..MAX_STEPS {
                    if let Some(dt) = resolve_local(tz, cand) {
                        if dt > after {
                            return Some(dt);
                        }
                    }
                    cand += step;
                }
                None
            }
            ScheduleSpec::Daily { hour, minute } => {
                self.scan_days(tz, after, local.date(), 1, |_| true, *hour, *minute)
            }
            ScheduleSpec::Weekly {
                weekday,
                hour,
                minute,
            } => {
                let wd = *weekday;
                self.scan_days(
                    tz,
                    after,
                    local.date(),
                    1,
                    move |d: NaiveDate| d.weekday() == wd,
                    *hour,
                    *minute,
                )
            }
            ScheduleSpec::Monthly { day, hour, minute } => {
                let mut year = local.year();
                let mut month = local.month();
                for _ in 0..MAX_STEPS {
                    let d = clamp_day(year, month, *day)?;
                    if let Some(dt) = day_at(tz, d, *hour, *minute) {
                        if dt > after {
                            return Some(dt);
                        }
                    }
                    (year, month) = next_month(year, month);
                }
                None
            }
            ScheduleSpec::Yearly {
                month,
                day,
                hour,
                minute,
            } => {
                for year in local.year()..local.year() + MAX_STEPS as i32 {
                    let d = clamp_day(year, *month, *day)?;
                    if let Some(dt) = day_at(tz, d, *hour, *minute) {
                        if dt > after {
                            return Some(dt);
                        }
                    }
                }
                None
            }
            ScheduleSpec::Cron { expr } => {
                let schedule = cron::Schedule::from_str(expr).ok()?;
                schedule
                    .after(&after.with_timezone(&tz))
                    .next()
                    .map(|dt| dt.with_timezone(&Utc))
            }
        }
    }

    /// 하루씩 훑으며 `pick` 을 통과하는 첫 날의 `hour:minute` 을 낸다.
    #[allow(clippy::too_many_arguments)]
    fn scan_days(
        &self,
        tz: Tz,
        after: DateTime<Utc>,
        from: NaiveDate,
        step_days: i64,
        pick: impl Fn(NaiveDate) -> bool,
        hour: u32,
        minute: u32,
    ) -> Option<DateTime<Utc>> {
        let mut d = from;
        for _ in 0..MAX_STEPS {
            if pick(d) {
                if let Some(dt) = day_at(tz, d, hour, minute) {
                    if dt > after {
                        return Some(dt);
                    }
                }
            }
            d += Duration::days(step_days);
        }
        None
    }
}

/// 그 달에 없는 날짜는 말일로 자른다 (31 → 2월이면 28/29).
fn clamp_day(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    for d in (1..=day).rev() {
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, d) {
            return Some(date);
        }
    }
    None
}

fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

fn day_at(tz: Tz, date: NaiveDate, hour: u32, minute: u32) -> Option<DateTime<Utc>> {
    resolve_local(tz, date.and_hms_opt(hour, minute, 0)?)
}

/// 로컬 벽시계 → UTC. DST 두 경계를 여기 한 곳에서만 정의한다 (모듈 문서 참조).
fn resolve_local(tz: Tz, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    use chrono::LocalResult;
    let mut candidate = naive;
    for _ in 0..3 {
        match tz.from_local_datetime(&candidate) {
            LocalResult::Single(dt) => return Some(dt.with_timezone(&Utc)),
            // 가을 — 같은 벽시계가 두 번. 이른 쪽만 돈다.
            LocalResult::Ambiguous(early, _late) => return Some(early.with_timezone(&Utc)),
            // 봄 — 이 벽시계는 존재하지 않는다. 한 시간 밀어 재시도.
            LocalResult::None => candidate += Duration::hours(1),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::automation::store::{AutomationKind, AutomationOutput};

    const SEOUL: Tz = chrono_tz::Asia::Seoul;
    /// DST 가 있는 타임존 — 두 경계를 실제로 밟기 위해.
    const NY: Tz = chrono_tz::America::New_York;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn local_of(tz: Tz, dt: DateTime<Utc>) -> String {
        dt.with_timezone(&tz).format("%Y-%m-%d %H:%M").to_string()
    }

    fn def(freq: &str) -> AutomationDef {
        let mut d = AutomationDef::new("t", AutomationKind::Schedule, "t", "2026-08-31");
        d.frequency = Some(freq.into());
        d.output = AutomationOutput::None;
        d
    }

    // ── 파싱 ────────────────────────────────────────────────────────────────

    #[test]
    fn every_frequency_parses_from_its_definition_fields() {
        let mut d = def("daily");
        d.at = Some("09:00".into());
        assert_eq!(
            ScheduleSpec::from_def(&d).unwrap(),
            ScheduleSpec::Daily { hour: 9, minute: 0 }
        );

        let mut d = def("weekly");
        d.at = Some("17:00".into());
        d.weekday = Some("fri".into());
        assert!(matches!(
            ScheduleSpec::from_def(&d).unwrap(),
            ScheduleSpec::Weekly {
                weekday: chrono::Weekday::Fri,
                ..
            }
        ));

        let mut d = def("monthly");
        d.at = Some("09:00".into());
        d.day_of_month = Some(1);
        assert!(matches!(
            ScheduleSpec::from_def(&d).unwrap(),
            ScheduleSpec::Monthly { day: 1, .. }
        ));

        let mut d = def("cron");
        d.cron = Some("0 9 * * MON-FRI".into());
        // 5필드는 초 자리를 붙여 크레이트 원형으로 맞춘다.
        assert_eq!(
            ScheduleSpec::from_def(&d).unwrap(),
            ScheduleSpec::Cron {
                expr: "0 0 9 * * MON-FRI".into()
            }
        );
    }

    #[test]
    fn broken_fields_fail_with_a_code_not_a_sentence() {
        let mut d = def("daily");
        d.at = Some("25:00".into());
        assert_eq!(ScheduleSpec::from_def(&d), Err("automation_bad_time"));

        let mut d = def("weekly");
        d.at = Some("09:00".into());
        d.weekday = Some("funday".into());
        assert_eq!(ScheduleSpec::from_def(&d), Err("automation_bad_weekday"));

        let mut d = def("minutes");
        d.every = Some(0);
        assert_eq!(ScheduleSpec::from_def(&d), Err("automation_bad_interval"));

        let mut d = def("cron");
        d.cron = Some("not a cron".into());
        assert_eq!(ScheduleSpec::from_def(&d), Err("automation_bad_cron"));

        assert_eq!(
            ScheduleSpec::from_def(&def("nonsense")),
            Err("automation_bad_frequency")
        );
    }

    // ── 다음 시각 ───────────────────────────────────────────────────────────

    #[test]
    fn daily_and_weekly_land_on_the_wall_clock() {
        let daily = ScheduleSpec::Daily { hour: 9, minute: 0 };
        // 08:00 KST → 오늘 09:00.
        let n = daily
            .next_run_after(SEOUL, utc("2026-08-31T08:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-08-31 09:00");
        // 09:00 정각 → 이미 지났다고 본다 (다음 날).
        let n = daily
            .next_run_after(SEOUL, utc("2026-08-31T09:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-09-01 09:00");

        let weekly = ScheduleSpec::Weekly {
            weekday: chrono::Weekday::Fri,
            hour: 17,
            minute: 0,
        };
        // 2026-08-31 은 월요일 → 다음 금요일은 9/4.
        let n = weekly
            .next_run_after(SEOUL, utc("2026-08-31T10:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-09-04 17:00");
    }

    #[test]
    fn relative_frequencies_step_from_the_given_instant() {
        let m = ScheduleSpec::Minutes { every: 15 };
        assert_eq!(
            m.next_run_after(SEOUL, utc("2026-08-31T08:07:00+09:00"))
                .unwrap(),
            utc("2026-08-31T08:22:00+09:00")
        );

        // 3시간마다 :30 — 정시 정렬은 분에만 건다.
        let h = ScheduleSpec::Hourly {
            every: 3,
            minute: 30,
        };
        let n = h
            .next_run_after(SEOUL, utc("2026-08-31T08:40:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-08-31 11:30");
        let n = h
            .next_run_after(SEOUL, utc("2026-08-31T08:10:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-08-31 08:30");
    }

    /// 월말 — `31일` 은 없는 달에서 **말일로 잘린다**. 건너뛰면 2·4·6·9·11월에
    /// 조용히 안 도는데, 사용자가 고른 건 "매달" 이다.
    #[test]
    fn monthly_clamps_to_the_last_day_of_short_months() {
        let s = ScheduleSpec::Monthly {
            day: 31,
            hour: 9,
            minute: 0,
        };
        let jan = s
            .next_run_after(SEOUL, utc("2026-01-15T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, jan), "2026-01-31 09:00");
        // 2026 은 평년 → 2/28.
        let feb = s
            .next_run_after(SEOUL, utc("2026-02-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, feb), "2026-02-28 09:00");
        // 2028 은 윤년 → 2/29.
        let leap = s
            .next_run_after(SEOUL, utc("2028-02-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, leap), "2028-02-29 09:00");
        let apr = s
            .next_run_after(SEOUL, utc("2026-04-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, apr), "2026-04-30 09:00");
    }

    /// 윤년 — `2/29` 연간 일정은 평년에 2/28 로 잘린다 (4년에 한 번만 도는 게
    /// 아니다).
    #[test]
    fn yearly_leap_day_clamps_in_common_years() {
        let s = ScheduleSpec::Yearly {
            month: 2,
            day: 29,
            hour: 9,
            minute: 0,
        };
        let a = s
            .next_run_after(SEOUL, utc("2026-01-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, a), "2026-02-28 09:00");
        let b = s
            .next_run_after(SEOUL, utc("2028-01-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, b), "2028-02-29 09:00");
        // 그 해의 날짜가 지났으면 다음 해.
        let c = s
            .next_run_after(SEOUL, utc("2026-06-01T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, c), "2027-02-28 09:00");
    }

    /// DST 봄 — 2026-03-08 미국 동부는 02:00→03:00 으로 뛴다. 02:30 일정은
    /// **건너뛰지 않고** 03:30 에 돈다.
    #[test]
    fn dst_spring_forward_shifts_instead_of_skipping_the_day() {
        let s = ScheduleSpec::Daily {
            hour: 2,
            minute: 30,
        };
        let n = s.next_run_after(NY, utc("2026-03-08T05:00:00Z")).unwrap();
        assert_eq!(local_of(NY, n), "2026-03-08 03:30", "그 날 안에 돈다");
    }

    /// DST 가을 — 2026-11-01 미국 동부는 01:30 이 두 번 온다. **이른 쪽 한 번만**.
    #[test]
    fn dst_fall_back_fires_once_on_the_earlier_instant() {
        let s = ScheduleSpec::Daily {
            hour: 1,
            minute: 30,
        };
        let n = s.next_run_after(NY, utc("2026-11-01T04:00:00Z")).unwrap();
        // 이른 01:30 = EDT(-04:00) = 05:30Z. 늦은 쪽은 06:30Z 다.
        assert_eq!(n, utc("2026-11-01T05:30:00Z"));
        // 그 다음은 이튿날 — 같은 날 두 번 돌지 않는다.
        let after = s.next_run_after(NY, n).unwrap();
        assert_eq!(local_of(NY, after), "2026-11-02 01:30");
    }

    #[test]
    fn once_fires_at_most_once() {
        let s = ScheduleSpec::Once {
            at: NaiveDate::from_ymd_opt(2026, 9, 1)
                .unwrap()
                .and_hms_opt(9, 0, 0)
                .unwrap(),
        };
        let n = s
            .next_run_after(SEOUL, utc("2026-08-31T00:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-09-01 09:00");
        assert_eq!(
            s.next_run_after(SEOUL, utc("2026-09-01T09:00:00+09:00")),
            None,
            "지나간 once 는 다시 돌지 않는다"
        );
    }

    /// cron 은 크레이트가 계산한다 — 여기서는 **요일 번호 방언**을 못박는다
    /// (`cron` 크레이트는 이름/1=일요일 규약이라 표준 cron 의 0=일요일과 다르다).
    #[test]
    fn cron_uses_names_and_the_crate_weekday_dialect() {
        let s = ScheduleSpec::Cron {
            expr: normalize_cron("0 9 * * MON-FRI"),
        };
        // 2026-08-31(월) 08:00 → 같은 날 09:00.
        let n = s
            .next_run_after(SEOUL, utc("2026-08-31T08:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-08-31 09:00");
        // 금요일 09:00 이후 → 주말을 건너뛰고 월요일.
        let n = s
            .next_run_after(SEOUL, utc("2026-09-04T10:00:00+09:00"))
            .unwrap();
        assert_eq!(local_of(SEOUL, n), "2026-09-07 09:00");
    }

    /// 3일 꺼져 있었다 — `next_run_after(now)` 는 **밀린 것을 쌓지 않고** 다음
    /// 미래 시각 하나만 낸다. 따라잡기가 "최대 1회" 인 근거가 이 성질이다.
    #[test]
    fn a_long_outage_yields_exactly_one_future_occurrence() {
        let s = ScheduleSpec::Daily { hour: 9, minute: 0 };
        let missed_since = utc("2026-08-28T09:00:00+09:00");
        let now = utc("2026-08-31T12:00:00+09:00");
        assert!(
            s.next_run_after(SEOUL, missed_since).unwrap() < now,
            "밀린 게 있었다"
        );
        let next = s.next_run_after(SEOUL, now).unwrap();
        assert_eq!(local_of(SEOUL, next), "2026-09-01 09:00");
    }
}

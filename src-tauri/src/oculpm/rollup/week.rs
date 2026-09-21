//! ISO 주 산술 — `YYYY-Www` 키와 그 주의 workday 경계.
//!
//! **ISO 8601 주**를 쓴다 (월요일 시작, 그 해의 첫 목요일이 든 주가 1주).
//! 달력 주 정의를 직접 고르지 않는 이유는 하나다 — `2026-W01` 이 무엇을
//! 가리키는지 사람도 도구도 이미 알고 있고, `chrono` 가 그 변환을 가지고 있다.
//! 우리가 정의를 하나 더 만들면 그 순간 "이 주가 어디서 끊기지"를 다시
//! 설명해야 한다.
//!
//! 경계는 **workday 문자열**(`YYYYMMDD`)로 돌려준다. 캐시 질의가 그 형태로
//! 범위를 받고(`range_entries`), 일지 경로의 첫 세그먼트도 같은 형태라
//! 중간 변환이 없다.

use chrono::{Datelike, NaiveDate, Weekday};

/// 날짜가 속한 ISO 주 키 — `2026-W38`.
pub fn week_key(date: NaiveDate) -> String {
    let iso = date.iso_week();
    format!("{:04}-W{:02}", iso.year(), iso.week())
}

/// `YYYY-Www` 를 (ISO 연도, 주)로. 모양이 아니면 `None`.
pub fn parse_week_key(key: &str) -> Option<(i32, u32)> {
    let (year, week) = key.trim().split_once("-W")?;
    if year.len() != 4 || week.len() != 2 {
        return None;
    }
    let year: i32 = year.parse().ok()?;
    let week: u32 = week.parse().ok()?;
    // 53주차가 있는 해가 실재하므로 상한은 53이고, 그 해에 53주가 없으면
    // 아래 `week_bounds` 가 `None` 으로 거른다 (달력이 판정한다).
    (1..=53).contains(&week).then_some((year, week))
}

/// 그 주의 월요일·일요일을 workday 문자열로. 없는 주(`2026-W53`)면 `None`.
pub fn week_bounds(key: &str) -> Option<(String, String)> {
    let (year, week) = parse_week_key(key)?;
    let mon = NaiveDate::from_isoywd_opt(year, week, Weekday::Mon)?;
    let sun = NaiveDate::from_isoywd_opt(year, week, Weekday::Sun)?;
    Some((workday_of(mon), workday_of(sun)))
}

/// `NaiveDate` → `YYYYMMDD`.
pub fn workday_of(date: NaiveDate) -> String {
    format!("{:04}{:02}{:02}", date.year(), date.month(), date.day())
}

/// `YYYYMMDD` → 그 날이 속한 ISO 주 키. 8자리 숫자가 아니면 `None`.
pub fn week_key_of_workday(workday: &str) -> Option<String> {
    Some(week_key(parse_workday(workday)?))
}

/// `YYYYMMDD` → `NaiveDate`.
pub fn parse_workday(workday: &str) -> Option<NaiveDate> {
    if workday.len() != 8 || !workday.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i32 = workday[0..4].parse().ok()?;
    let month: u32 = workday[4..6].parse().ok()?;
    let day: u32 = workday[6..8].parse().ok()?;
    NaiveDate::from_ymd_opt(year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 연도 경계가 ISO 정의대로 움직이는가 — 여기가 틀리면 12월 말·1월 초
    /// 일지가 통째로 엉뚱한 롤업에 들어간다.
    #[test]
    fn iso_year_boundary_follows_the_thursday_rule() {
        // 2027-01-01 은 금요일 → 그 주의 목요일은 2026-12-31 → ISO 2026-W53.
        assert_eq!(week_key_of_workday("20270101").unwrap(), "2026-W53");
        // 2026-01-01 은 목요일 → 그 주가 2026 의 1주.
        assert_eq!(week_key_of_workday("20260101").unwrap(), "2026-W01");
    }

    #[test]
    fn bounds_span_monday_to_sunday() {
        let (from, to) = week_bounds("2026-W38").unwrap();
        assert_eq!((from.as_str(), to.as_str()), ("20260914", "20260920"));
        // 경계 안의 날은 같은 키로 되돌아온다 (왕복).
        for day in ["20260914", "20260917", "20260920"] {
            assert_eq!(week_key_of_workday(day).unwrap(), "2026-W38");
        }
        assert_eq!(week_key_of_workday("20260921").unwrap(), "2026-W39");
    }

    /// 없는 주는 달력이 거른다 — 53주가 없는 해의 `W53`.
    #[test]
    fn a_week_that_does_not_exist_is_rejected() {
        assert!(week_bounds("2026-W53").is_some(), "2026 은 53주가 있다");
        assert!(week_bounds("2025-W53").is_none(), "2025 는 52주까지");
        assert!(week_bounds("2026-W54").is_none());
        assert!(week_bounds("2026-W00").is_none());
        assert!(week_bounds("2026W38").is_none());
        assert!(week_bounds("26-W38").is_none());
        assert!(week_bounds("2026-W3").is_none());
    }

    #[test]
    fn workday_parsing_rejects_nonsense() {
        assert!(parse_workday("2026091").is_none());
        assert!(parse_workday("2026-9-21").is_none());
        assert!(parse_workday("20260230").is_none(), "2월 30일은 없다");
        assert!(parse_workday("20260921").is_some());
    }
}

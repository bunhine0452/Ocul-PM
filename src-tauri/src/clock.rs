//! 시각 한 곳 — chrono 를 걷고 jiff 위에서 **같은 글자**를 낸다 (2026-11-19).
//!
//! chrono · chrono-tz 는 RustSec 이 관리 중단으로 올렸다(RUSTSEC-2026-0543 · 0555). 그 공지로 v4.11.1 태그의
//! cargo-deny 가 붉었고, 무시 대신 걷기로 했다(사용자 결정). 디스크 · DB · 원장에 이미 적힌 시각 글자는
//! 읽는 쪽이 문자열로도 비교하므로, 여기 함수들은 chrono 가 내던 꼴을 그대로 낸다:
//!
//! - [`rfc3339`] — `DateTime<Utc>::to_rfc3339()`: 소수 초는 0 · 3 · 6 · 9 자리 중 맞는 것, 끝은 `+00:00`.
//! - [`rfc3339_z`] — `to_rfc3339_opts(SecondsFormat::Secs, true)`: 초까지, 끝은 `Z`.
//! - [`rfc3339_millis_z`] — `to_rfc3339_opts(SecondsFormat::Millis, true)`.
//! - [`zoned_rfc3339`] — `DateTime<Local|Tz>::to_rfc3339()`: 소수 초는 위와 같고 끝은 `+09:00` 꼴.
//! - [`zoned_rfc3339_secs`] — `DateTime<Tz>::to_rfc3339_opts(SecondsFormat::Secs, false)`: 일지 `created_at` 꼴.
//!
//! 시간대 데이터는 chrono-tz 처럼 실행 파일에 굽는다(`tzdb-bundle-always`) — 시스템에 zoneinfo 가 없는
//! 리눅스에서도 `Asia/Seoul` 이 풀려야 일지 날짜 칸이 선다. 시스템 것이 있으면 jiff 가 그것을 먼저 쓴다.

pub use jiff::civil;
pub use jiff::tz::TimeZone;
pub use jiff::{SignedDuration, Timestamp, Zoned};

/// 지금 (UTC 순간).
pub fn now() -> Timestamp {
    Timestamp::now()
}

/// 지금, 이 기기의 시간대로.
pub fn local_now() -> Zoned {
    Zoned::now()
}

/// chrono `SecondsFormat::AutoSi` — 소수 초가 0 이면 없고, 아니면 3 · 6 · 9 자리 중 남김없이 담는 가장 짧은 것.
fn frac_auto(nanos: i32) -> String {
    let n = nanos.unsigned_abs();
    if n == 0 {
        String::new()
    } else if n.is_multiple_of(1_000_000) {
        format!(".{:03}", n / 1_000_000)
    } else if n.is_multiple_of(1_000) {
        format!(".{:06}", n / 1_000)
    } else {
        format!(".{n:09}")
    }
}

/// `2026-11-19T08:07:04.123+00:00` — chrono `DateTime<Utc>::to_rfc3339()` 와 같은 글자.
pub fn rfc3339(ts: Timestamp) -> String {
    format!(
        "{}{}+00:00",
        ts.strftime("%Y-%m-%dT%H:%M:%S"),
        frac_auto(ts.subsec_nanosecond())
    )
}

/// `2026-11-19T08:07:04Z` — chrono `to_rfc3339_opts(SecondsFormat::Secs, true)`.
pub fn rfc3339_z(ts: Timestamp) -> String {
    ts.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// `2026-11-19T08:07:04.123Z` — chrono `to_rfc3339_opts(SecondsFormat::Millis, true)`.
pub fn rfc3339_millis_z(ts: Timestamp) -> String {
    let ms = ts.subsec_nanosecond().unsigned_abs() / 1_000_000;
    format!("{}.{ms:03}Z", ts.strftime("%Y-%m-%dT%H:%M:%S"))
}

/// `2026-11-19T17:07:04.123456+09:00` — chrono `DateTime<Local>`(·`<Tz>`)`::to_rfc3339()`.
pub fn zoned_rfc3339(z: &Zoned) -> String {
    format!(
        "{}{}{}",
        z.strftime("%Y-%m-%dT%H:%M:%S"),
        frac_auto(z.subsec_nanosecond()),
        z.strftime("%:z")
    )
}

/// `2026-11-19T17:07:04+09:00` — chrono `to_rfc3339_opts(SecondsFormat::Secs, false)` (UTC 면 `+00:00`).
pub fn zoned_rfc3339_secs(z: &Zoned) -> String {
    z.strftime("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// RFC 3339 (오프셋 필수) → 순간. 못 읽으면 None — chrono `parse_from_rfc3339(..).ok()` 의 자리.
pub fn parse_rfc3339(s: &str) -> Option<Timestamp> {
    s.trim().parse::<Timestamp>().ok()
}

/// RFC 3339 를 **적힌 오프셋 그대로** 읽는다 — chrono `DateTime<FixedOffset>` 의 자리(그 칸의 벽시계 날짜가 필요할 때).
pub fn parse_rfc3339_fixed(s: &str) -> Option<Zoned> {
    let ts = parse_rfc3339(s)?;
    let pieces = jiff::fmt::temporal::Pieces::parse(s.trim()).ok()?;
    let offset = match pieces.offset()? {
        jiff::fmt::temporal::PiecesOffset::Numeric(n) => n.offset(),
        jiff::fmt::temporal::PiecesOffset::Zulu => jiff::tz::Offset::UTC,
        _ => return None,
    };
    Some(ts.to_zoned(TimeZone::fixed(offset)))
}

/// 이 기기 달력의 오늘 — chrono `Local::now().date_naive()`.
pub fn local_today() -> civil::Date {
    Zoned::now().date()
}

/// 날짜 ± n일 — chrono `date ± Duration::days(n)`.
pub fn add_days(d: civil::Date, n: i64) -> civil::Date {
    d.checked_add(jiff::Span::new().days(n))
        .expect("날짜 계산이 달력 범위를 넘었다")
}

/// `a - b` 의 날 수 — chrono `(a - b).num_days()`.
pub fn days_between(a: civil::Date, b: civil::Date) -> i64 {
    a.since(b).map_or(0, |s| i64::from(s.get_days()))
}

/// `YYYYMMDD` (워크데이 폴더 이름).
pub fn ymd(d: civil::Date) -> String {
    d.strftime("%Y%m%d").to_string()
}

/// `YYYYMMDD` → 날짜.
pub fn parse_ymd(s: &str) -> Option<civil::Date> {
    civil::Date::strptime("%Y%m%d", s).ok()
}

/// 초(유닉스) → 순간.
pub fn from_unix(secs: i64) -> Option<Timestamp> {
    Timestamp::from_second(secs).ok()
}

/// IANA 이름 → 시간대. chrono-tz `name.parse::<Tz>()` 의 자리.
pub fn zone(name: &str) -> Option<TimeZone> {
    TimeZone::get(name).ok()
}

/// 시간대의 IANA 이름(로그 · 경고 문장용). 이름 없는 고정 오프셋이면 `UTC±hh:mm` 꼴.
pub fn zone_name(tz: &TimeZone) -> String {
    tz.iana_name()
        .map_or_else(|| format!("{tz:?}"), str::to_string)
}

/// 그 시간대의 벽시계 `date + time` 을 순간으로 — chrono `tz.from_local_datetime(..).earliest()`.
/// 겹치는 시각(가을 되돌림)은 앞의 것, 없는 시각(봄 건너뜀)은 None.
pub fn earliest(tz: &TimeZone, dt: civil::DateTime) -> Option<Timestamp> {
    use jiff::tz::AmbiguousOffset;
    let offset = match tz.to_ambiguous_timestamp(dt).offset() {
        AmbiguousOffset::Unambiguous { offset } => offset,
        AmbiguousOffset::Fold { before, .. } => before,
        AmbiguousOffset::Gap { .. } => return None,
    };
    offset.to_timestamp(dt).ok()
}

/// 그 시간대의 벽시계 시각이 **딱 하나**일 때만 순간으로 — chrono `.single()`. 겹치거나 없는 시각은 None.
pub fn single(tz: &TimeZone, dt: civil::DateTime) -> Option<Timestamp> {
    match tz.to_ambiguous_timestamp(dt).offset() {
        jiff::tz::AmbiguousOffset::Unambiguous { offset } => offset.to_timestamp(dt).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> Timestamp {
        s.parse().unwrap()
    }

    /// 아래 기대 글자는 chrono 0.4.45 가 같은 순간에 낸 값이다(2026-11-19, 걷기 전에 나란히 돌려 받았다).

    #[test]
    fn rfc3339_matches_chrono_utc() {
        assert_eq!(
            rfc3339(ts("2026-11-19T08:07:04Z")),
            "2026-11-19T08:07:04+00:00"
        );
        assert_eq!(
            rfc3339(ts("2026-11-19T08:07:04.5Z")),
            "2026-11-19T08:07:04.500+00:00"
        );
        assert_eq!(
            rfc3339(ts("2026-11-19T08:07:04.123456Z")),
            "2026-11-19T08:07:04.123456+00:00"
        );
        assert_eq!(
            rfc3339(ts("2026-11-19T08:07:04.123456789Z")),
            "2026-11-19T08:07:04.123456789+00:00"
        );
        assert_eq!(
            rfc3339(ts("2026-11-19T08:07:04.000001Z")),
            "2026-11-19T08:07:04.000001+00:00"
        );
    }

    #[test]
    fn rfc3339_z_and_millis_match_chrono_opts() {
        assert_eq!(
            rfc3339_z(ts("2026-11-19T08:07:04.987Z")),
            "2026-11-19T08:07:04Z"
        );
        assert_eq!(
            rfc3339_millis_z(ts("2026-11-19T08:07:04Z")),
            "2026-11-19T08:07:04.000Z"
        );
        assert_eq!(
            rfc3339_millis_z(ts("2026-11-19T08:07:04.987654Z")),
            "2026-11-19T08:07:04.987Z"
        );
    }

    #[test]
    fn zoned_rfc3339_keeps_the_offset() {
        let seoul = zone("Asia/Seoul").unwrap();
        let z = ts("2026-11-19T08:07:04.25Z").to_zoned(seoul);
        assert_eq!(zoned_rfc3339(&z), "2026-11-19T17:07:04.250+09:00");
        let utc = ts("2026-11-19T08:07:04Z").to_zoned(TimeZone::UTC);
        assert_eq!(zoned_rfc3339(&utc), "2026-11-19T08:07:04+00:00");
        assert_eq!(zoned_rfc3339_secs(&z), "2026-11-19T17:07:04+09:00");
    }

    #[test]
    fn parsing_reads_what_chrono_wrote() {
        let a = parse_rfc3339("2026-11-19T17:07:04.250+09:00").unwrap();
        assert_eq!(a, ts("2026-11-19T08:07:04.25Z"));
        assert_eq!(
            parse_rfc3339("2026-11-19T08:07:04+00:00").unwrap(),
            ts("2026-11-19T08:07:04Z")
        );
        assert!(parse_rfc3339("not a time").is_none());
        assert!(
            parse_rfc3339("2026-11-19T08:07:04").is_none(),
            "오프셋 없는 글자는 순간이 아니다"
        );
        let fixed = parse_rfc3339_fixed("2026-11-19T01:00:00+09:00").unwrap();
        assert_eq!(fixed.date(), civil::date(2026, 11, 19));
        assert_eq!(fixed.offset(), jiff::tz::offset(9));
    }

    #[test]
    fn earliest_mirrors_chrono_in_gaps_and_folds() {
        let ny = zone("America/New_York").unwrap();
        // 2026-03-08 02:30 은 없다(봄 건너뜀).
        assert!(earliest(&ny, civil::date(2026, 3, 8).at(2, 30, 0, 0)).is_none());
        // 2026-11-01 01:30 은 두 번 있다 — 앞의 것(EDT, -04:00).
        let fold = earliest(&ny, civil::date(2026, 11, 1).at(1, 30, 0, 0)).unwrap();
        assert_eq!(fold, ts("2026-11-01T05:30:00Z"));
    }

    #[test]
    fn date_helpers_count_days_like_chrono() {
        let d = civil::date(2026, 3, 1);
        assert_eq!(add_days(d, -1), civil::date(2026, 2, 28));
        assert_eq!(add_days(d, 31), civil::date(2026, 4, 1));
        assert_eq!(
            days_between(civil::date(2026, 11, 19), civil::date(2026, 11, 12)),
            7
        );
        assert_eq!(
            days_between(civil::date(2026, 11, 12), civil::date(2026, 11, 19)),
            -7
        );
        assert_eq!(ymd(civil::date(2026, 1, 5)), "20260105");
        assert_eq!(parse_ymd("20261119"), Some(civil::date(2026, 11, 19)));
        assert_eq!(parse_ymd("2026-11-19"), None);
        assert_eq!(parse_ymd("20261332"), None);
    }

    #[test]
    fn the_bundled_zone_data_resolves_iana_names() {
        for name in [
            "Asia/Seoul",
            "UTC",
            "Etc/UTC",
            "America/New_York",
            "Pacific/Chatham",
        ] {
            assert!(zone(name).is_some(), "{name}");
        }
        assert!(zone("Not/AZone").is_none());
        assert!(
            zone("KST-9").is_none(),
            "POSIX 규칙 문자열은 IANA 이름이 아니다"
        );
    }
}

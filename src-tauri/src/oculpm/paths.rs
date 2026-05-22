//! Workday + path computation.
//!
//! `WorkdayResolver` is the single source of truth for:
//! - which `YYYYMMDD` folder a UTC instant belongs to (`workday_of`)
//! - the `HHMM` portion of that local time (`hhmm_of`)
//! - the next workday boundary as a UTC instant (`next_boundary`)
//! - all `.oculpm/...` path helpers
//!
//! Workday rules (see `docs/major_update/oculpm/00-spec.md` §7):
//! 1. Convert UTC instant to local time in `self.tz`.
//! 2. If local time-of-day < `day_starts_at`, the workday is the *previous*
//!    calendar date. Otherwise it's the current calendar date.
//!
//! DST handling:
//! - `workday_of` / `hhmm_of` always use the local time chrono-tz resolves
//!   the UTC instant to, so spring-forward / fall-back are handled implicitly.
//! - `next_boundary` uses `earliest()` on ambiguous fall-back instants and
//!   advances minute-by-minute through any spring-forward gap so the
//!   computed boundary is always a real UTC instant.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

use crate::oculpm::error::OculpmError;
use crate::oculpm::spec::EntryType;

#[allow(dead_code)] // Consumed by config.rs (W1-PR4) and OculpmManager (W1-PR7).
#[derive(Debug, Clone)]
pub struct WorkdayResolver {
    pub tz: Tz,
    pub day_starts_at: NaiveTime,
}

#[allow(dead_code)] // Consumed by config.rs (W1-PR4) and OculpmManager (W1-PR7).
impl WorkdayResolver {
    /// Construct from string forms.
    ///
    /// - `tz_name`: IANA timezone (e.g. `Asia/Seoul`, `UTC`, `America/New_York`).
    /// - `day_starts_at_hhmm`: `HH:MM` 24h (e.g. `00:00`, `03:00`).
    pub fn new(tz_name: &str, day_starts_at_hhmm: &str) -> Result<Self, OculpmError> {
        let tz: Tz = tz_name
            .parse()
            .map_err(|_| OculpmError::InvalidTimezone(tz_name.to_string()))?;
        let day_starts_at = NaiveTime::parse_from_str(day_starts_at_hhmm, "%H:%M")
            .map_err(|_| OculpmError::InvalidHHMM(day_starts_at_hhmm.to_string()))?;
        Ok(Self { tz, day_starts_at })
    }

    /// Workday key `YYYYMMDD` for a UTC instant.
    pub fn workday_of(&self, instant_utc: DateTime<Utc>) -> String {
        let local = instant_utc.with_timezone(&self.tz);
        let date = if local.time() < self.day_starts_at {
            local
                .date_naive()
                .pred_opt()
                .expect("date_naive().pred_opt() only fails at year_min; not reachable")
        } else {
            local.date_naive()
        };
        format!("{:04}{:02}{:02}", date.year(), date.month(), date.day())
    }

    /// Local `HHMM` for a UTC instant. 24h, zero-padded.
    pub fn hhmm_of(&self, instant_utc: DateTime<Utc>) -> String {
        let local = instant_utc.with_timezone(&self.tz);
        format!("{:02}{:02}", local.hour(), local.minute())
    }

    /// Next workday boundary as a UTC instant.
    ///
    /// If `instant_utc` is exactly at today's local boundary, the *next* one
    /// (tomorrow at `day_starts_at`) is returned, so callers can schedule a
    /// sleep without re-firing immediately.
    pub fn next_boundary(&self, instant_utc: DateTime<Utc>) -> DateTime<Utc> {
        let local = instant_utc.with_timezone(&self.tz);
        let today_boundary = self.local_boundary_utc(local.date_naive());
        if instant_utc >= today_boundary {
            // Past or exactly at today's boundary — schedule tomorrow's.
            let tomorrow = local
                .date_naive()
                .succ_opt()
                .expect("date_naive().succ_opt() only fails at year_max");
            self.local_boundary_utc(tomorrow)
        } else {
            today_boundary
        }
    }

    /// Resolve `local_date + day_starts_at` to a UTC instant, advancing
    /// through any DST spring-forward gap.
    fn local_boundary_utc(&self, local_date: NaiveDate) -> DateTime<Utc> {
        let mut t = self.day_starts_at;
        // In a DST spring-forward gap the wall-clock time we asked for
        // doesn't exist. Advance one minute at a time (≤ 1h covers all known
        // transitions) until chrono-tz can resolve it. `earliest()` returns
        // the pre-fold instant for fall-back ambiguity, which is the
        // convention we want for the *start* of a workday.
        for _ in 0..120 {
            let naive = local_date.and_time(t);
            if let Some(dt) = self.tz.from_local_datetime(&naive).earliest() {
                return dt.with_timezone(&Utc);
            }
            t = t
                .overflowing_add_signed(chrono::Duration::minutes(1))
                .0;
        }
        // Should be unreachable — fall back to UTC midnight of that date so
        // callers don't have to deal with Result.
        local_date
            .and_hms_opt(0, 0, 0)
            .expect("00:00:00 is always valid")
            .and_utc()
    }

    // ─── Path helpers ───────────────────────────────────────────────────────

    pub fn project_oculpm_dir(&self, project_root: &Path) -> PathBuf {
        project_root.join(".oculpm")
    }

    pub fn index_dir(&self, project_root: &Path, workday: &str) -> PathBuf {
        self.project_oculpm_dir(project_root)
            .join("index")
            .join(workday)
    }

    pub fn journal_dir(&self, project_root: &Path, workday: &str, kind: EntryType) -> PathBuf {
        let category = match kind {
            EntryType::Bug => "Bugs",
            EntryType::Feature => "Features_to_add",
            EntryType::Error => "Errors",
            EntryType::Refactor => "Refactors",
            EntryType::Chore => "Chores",
        };
        self.project_oculpm_dir(project_root)
            .join("journal")
            .join(workday)
            .join(category)
    }

    pub fn lock_path(&self, project_root: &Path) -> PathBuf {
        self.project_oculpm_dir(project_root).join(".lock")
    }

    pub fn schema_version_path(&self, project_root: &Path) -> PathBuf {
        self.project_oculpm_dir(project_root).join(".schema-version")
    }

    pub fn config_path(&self, project_root: &Path) -> PathBuf {
        self.project_oculpm_dir(project_root).join("config.toml")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W1/PR3-workday-resolver.md` for the
// full case matrix.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s)
            .expect("test fixture must be valid rfc3339")
            .with_timezone(&Utc)
    }

    fn kst() -> WorkdayResolver {
        WorkdayResolver::new("Asia/Seoul", "00:00").unwrap()
    }

    fn kst_late() -> WorkdayResolver {
        WorkdayResolver::new("Asia/Seoul", "03:00").unwrap()
    }

    fn utc_tz() -> WorkdayResolver {
        WorkdayResolver::new("UTC", "00:00").unwrap()
    }

    fn ny() -> WorkdayResolver {
        WorkdayResolver::new("America/New_York", "00:00").unwrap()
    }

    // ─── workday_of / hhmm_of ───────────────────────────────────────────────

    /// Case 1 — KST noon, default workday.
    #[test]
    fn workday_kst_noon() {
        let r = kst();
        let t = utc("2026-05-22T03:00:00Z"); // KST 12:00 on the 22nd
        assert_eq!(r.workday_of(t), "20260522");
        assert_eq!(r.hhmm_of(t), "1200");
    }

    /// Case 2 — KST just after local midnight.
    #[test]
    fn workday_kst_just_after_midnight() {
        let r = kst();
        let t = utc("2026-05-21T15:01:00Z"); // KST 00:01 on the 22nd
        assert_eq!(r.workday_of(t), "20260522");
        assert_eq!(r.hhmm_of(t), "0001");
    }

    /// Case 3 — KST just before local midnight.
    #[test]
    fn workday_kst_just_before_midnight() {
        let r = kst();
        let t = utc("2026-05-21T14:59:00Z"); // KST 23:59 on the 21st
        assert_eq!(r.workday_of(t), "20260521");
        assert_eq!(r.hhmm_of(t), "2359");
    }

    /// Case 4 — Late-start (03:00). 02:30 local belongs to *previous* workday.
    #[test]
    fn workday_kst_late_start_before_boundary() {
        let r = kst_late();
        let t = utc("2026-05-22T17:30:00Z"); // KST 02:30 on the 23rd
        assert_eq!(r.workday_of(t), "20260522");
        assert_eq!(r.hhmm_of(t), "0230");
    }

    /// Case 5 — Late-start (03:00). 03:00 local boundary → new workday.
    #[test]
    fn workday_kst_late_start_at_boundary() {
        let r = kst_late();
        let t = utc("2026-05-22T18:00:00Z"); // KST 03:00 on the 23rd
        assert_eq!(r.workday_of(t), "20260523");
        assert_eq!(r.hhmm_of(t), "0300");
    }

    /// Case 6 — UTC, end of day.
    #[test]
    fn workday_utc_end_of_day() {
        let r = utc_tz();
        let t = utc("2026-05-22T23:59:00Z");
        assert_eq!(r.workday_of(t), "20260522");
        assert_eq!(r.hhmm_of(t), "2359");
    }

    /// Case 7 — UTC, just past midnight.
    #[test]
    fn workday_utc_just_after_midnight() {
        let r = utc_tz();
        let t = utc("2026-05-23T00:00:00Z");
        assert_eq!(r.workday_of(t), "20260523");
        assert_eq!(r.hhmm_of(t), "0000");
    }

    /// Case 8 — DST spring-forward in America/New_York 2026-03-08.
    /// At 02:00 EST the clock jumps to 03:00 EDT. UTC 07:00 lands on the EDT
    /// side, so `hhmm_of` returns 0300 (not the originally-guessed 0200).
    #[test]
    fn workday_ny_dst_start() {
        let r = ny();
        let t = utc("2026-03-08T07:00:00Z");
        assert_eq!(r.workday_of(t), "20260308");
        assert_eq!(r.hhmm_of(t), "0300");
    }

    // ─── new() error paths ──────────────────────────────────────────────────

    /// Case 9 — Invalid timezone name.
    #[test]
    fn new_invalid_timezone() {
        let r = WorkdayResolver::new("Asia/Seoult", "00:00");
        assert!(matches!(r, Err(OculpmError::InvalidTimezone(_))));
    }

    /// Case 10 — Invalid HH:MM.
    #[test]
    fn new_invalid_hhmm() {
        let r = WorkdayResolver::new("Asia/Seoul", "25:00");
        assert!(matches!(r, Err(OculpmError::InvalidHHMM(_))));
    }

    // ─── next_boundary ──────────────────────────────────────────────────────

    /// Case 11 — KST 23:50 with default 00:00 start → next = KST 00:00 next day.
    #[test]
    fn next_boundary_kst_evening_default() {
        let r = kst();
        let t = utc("2026-05-22T14:50:00Z"); // KST 23:50 on the 22nd
        let nb = r.next_boundary(t);
        // KST 00:00 on the 23rd == UTC 15:00 on the 22nd.
        assert_eq!(nb, utc("2026-05-22T15:00:00Z"));
    }

    /// Case 12 — KST 03:30 with 03:00 start → next = KST 03:00 next day.
    #[test]
    fn next_boundary_kst_late_start() {
        let r = kst_late();
        let t = utc("2026-05-22T18:30:00Z"); // KST 03:30 on the 23rd
        let nb = r.next_boundary(t);
        // KST 03:00 on the 24th == UTC 18:00 on the 23rd.
        assert_eq!(nb, utc("2026-05-23T18:00:00Z"));
    }

    // ─── Path helpers ───────────────────────────────────────────────────────

    /// Case 13 — Path computation. Covers every helper in one test.
    #[test]
    fn path_helpers() {
        let r = kst();
        let root = Path::new("/p");

        assert_eq!(r.project_oculpm_dir(root), PathBuf::from("/p/.oculpm"));
        assert_eq!(
            r.index_dir(root, "20260522"),
            PathBuf::from("/p/.oculpm/index/20260522")
        );
        assert_eq!(
            r.journal_dir(root, "20260522", EntryType::Bug),
            PathBuf::from("/p/.oculpm/journal/20260522/Bugs")
        );
        assert_eq!(
            r.journal_dir(root, "20260522", EntryType::Feature),
            PathBuf::from("/p/.oculpm/journal/20260522/Features_to_add")
        );
        assert_eq!(
            r.journal_dir(root, "20260522", EntryType::Error),
            PathBuf::from("/p/.oculpm/journal/20260522/Errors")
        );
        assert_eq!(
            r.journal_dir(root, "20260522", EntryType::Refactor),
            PathBuf::from("/p/.oculpm/journal/20260522/Refactors")
        );
        assert_eq!(
            r.journal_dir(root, "20260522", EntryType::Chore),
            PathBuf::from("/p/.oculpm/journal/20260522/Chores")
        );
        assert_eq!(r.lock_path(root), PathBuf::from("/p/.oculpm/.lock"));
        assert_eq!(
            r.schema_version_path(root),
            PathBuf::from("/p/.oculpm/.schema-version")
        );
        assert_eq!(r.config_path(root), PathBuf::from("/p/.oculpm/config.toml"));
    }
}

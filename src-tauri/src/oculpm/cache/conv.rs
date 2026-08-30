//! 순수 변환 헬퍼 — 작업일·타임스탬프 파싱, enum↔문자열, SQLite 오류 매핑.
//!
//! `cache/mod.rs` 에서 갈라 나왔다. `pub(super)` 는 `cache` 와 그 자손에서만
//! 보이므로, 분할 전 `cache` 에 private 이던 가시 범위와 정확히 같다.

use super::*;

/// Parse "YYYYMMDD" → NaiveDate.
pub(super) fn parse_workday(s: &str) -> Option<chrono::NaiveDate> {
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year = s[0..4].parse::<i32>().ok()?;
    let month = s[4..6].parse::<u32>().ok()?;
    let day = s[6..8].parse::<u32>().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, month, day)
}

pub(super) fn format_workday(d: chrono::NaiveDate) -> String {
    use chrono::Datelike;
    format!("{:04}{:02}{:02}", d.year(), d.month(), d.day())
}

pub(super) fn today_fallback() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive()
}

/// Coerce one timestamp field for the cache projection (F7a-B). With a project
/// `tz`, backfill a missing offset (DST-correct) and record what changed; with
/// `None`, only flag the missing offset. Returns the value to store in cache;
/// the on-disk file is never modified here.
pub(super) fn coerce_timestamp(
    s: &str,
    tz: Option<Tz>,
    field: &str,
    warns: &mut Vec<String>,
) -> String {
    match tz {
        Some(tz) => match backfill_tz_offset(s, tz) {
            Some(fixed) => {
                warns.push(format!(
                    "{field} '{s}' lacks a timezone offset; backfilled to '{fixed}' ({tz}) for display (disk unchanged)"
                ));
                fixed
            }
            // Lacks an offset but couldn't be backfilled — e.g. a DST
            // spring-forward gap (a local time that doesn't exist). Still flag
            // it rather than letting the more-suspicious value pass silently.
            None => {
                if iso_lacks_offset(s) {
                    warns.push(format!(
                        "{field} '{s}' lacks a timezone offset (could not backfill in {tz})"
                    ));
                }
                s.to_string()
            }
        },
        None => {
            if iso_lacks_offset(s) {
                warns.push(format!(
                    "{field} '{s}' lacks a timezone offset (interpreted as project-local)"
                ));
            }
            s.to_string()
        }
    }
}

/// Decode the stored `parse_warnings` column (a JSON string array, or NULL) into
/// a `Vec<String>` for the DTO. Malformed JSON / NULL → empty (F7a).
pub(super) fn parse_warnings_vec(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

pub(super) fn workday_from_relative_path(relative_path: &str) -> String {
    // `<workday>/<Category>/<file>.md` — workday is the first path segment.
    crate::oculpm::paths::workday_of_rel(relative_path)
        .unwrap_or("00000000")
        .to_string()
}

pub(super) fn derive_slug_from_path(relative_path: &str) -> String {
    relative_path
        .rsplit('/')
        .next()
        .and_then(|s| s.strip_suffix(".md"))
        .unwrap_or(relative_path)
        .to_string()
}

pub(super) fn entry_type_as_str(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

pub(super) fn parse_entry_type_str(s: &str) -> Option<EntryType> {
    match s {
        "bug" => Some(EntryType::Bug),
        "feature" => Some(EntryType::Feature),
        "error" => Some(EntryType::Error),
        "refactor" => Some(EntryType::Refactor),
        "chore" => Some(EntryType::Chore),
        _ => None,
    }
}

pub(super) fn entry_status_as_str(s: EntryStatus) -> &'static str {
    match s {
        EntryStatus::Planned => "planned",
        EntryStatus::InProgress => "in_progress",
        EntryStatus::Done => "done",
        EntryStatus::Abandoned => "abandoned",
    }
}

pub(super) fn parse_entry_status_str(s: &str) -> Option<EntryStatus> {
    match s {
        "planned" => Some(EntryStatus::Planned),
        "in_progress" => Some(EntryStatus::InProgress),
        "done" => Some(EntryStatus::Done),
        "abandoned" => Some(EntryStatus::Abandoned),
        _ => None,
    }
}

pub(super) fn difficulty_as_str(d: Difficulty) -> &'static str {
    match d {
        Difficulty::Superhigh => "superhigh",
        Difficulty::High => "high",
        Difficulty::Medium => "medium",
        Difficulty::Low => "low",
        Difficulty::Verylow => "verylow",
    }
}

pub(super) fn parse_difficulty_str(s: &str) -> Option<Difficulty> {
    match s {
        "superhigh" => Some(Difficulty::Superhigh),
        "high" => Some(Difficulty::High),
        "medium" => Some(Difficulty::Medium),
        "low" => Some(Difficulty::Low),
        "verylow" => Some(Difficulty::Verylow),
        _ => None,
    }
}

pub(super) fn file_op_as_str(op: FileOp) -> &'static str {
    match op {
        FileOp::Create => "create",
        FileOp::Update => "update",
        FileOp::Delete => "delete",
        FileOp::Rename => "rename",
        FileOp::Correct => "correct",
    }
}

pub(super) fn parse_file_op_str(s: &str) -> Option<FileOp> {
    match s {
        "create" => Some(FileOp::Create),
        "update" | "modify" => Some(FileOp::Update),
        "delete" => Some(FileOp::Delete),
        "rename" => Some(FileOp::Rename),
        "correct" => Some(FileOp::Correct),
        _ => None,
    }
}

pub(super) fn map_sqlite_err(e: tokio_rusqlite::Error) -> OculpmError {
    OculpmError::Sqlite(e.to_string())
}

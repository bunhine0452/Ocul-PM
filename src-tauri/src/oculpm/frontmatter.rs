//! Fail-soft YAML frontmatter parsing and stable-order serialization.
//!
//! See `docs/major_update/oculpm/00-spec.md` §3 (frontmatter schema) and
//! `docs/major_update/oculpm/phases/W3-journal-today-ui.md` §W3-PR1.
//!
//! Contract:
//! - Any input parses without panic; broken YAML yields `parsed: None` and
//!   preserves `raw_yaml` so the UI can surface the original to the user.
//! - Missing optional fields are filled with spec-aligned defaults; missing
//!   required fields produce a parse warning but still emit `parsed: Some`
//!   when the YAML itself is well-formed and the required-field defaults
//!   are deterministic (e.g. `schema_version` → 1).
//! - `write_frontmatter_and_body` emits keys in a deterministic order to
//!   keep `git diff` minimal across re-writes.

#![allow(dead_code)] // Consumed by `cache.rs` (W3-PR2) and `commands/oculpm.rs`
                     // (W3-PR3).

use chrono::{DateTime, NaiveDateTime, TimeZone};
use chrono_tz::Tz;
use serde_yaml::Value as YamlValue;

use crate::oculpm::spec::{
    AgentRef, Difficulty, EntryStatus, EntryType, FileOp, FileTouched, JournalFrontmatter,
    RelatedRef,
};

/// Spec-defined required field names (`00-spec.md` §3.1). `agent.id` is
/// validated separately because it lives one level deeper.
pub const REQUIRED_FIELDS: &[&str] = &[
    "schema_version",
    "type",
    "slug",
    "status",
    "created_at",
    "session_id",
    "language",
];

/// Result of parsing the frontmatter region of a journal markdown file.
#[derive(Debug, Clone)]
pub struct ParsedFrontmatter {
    /// Original YAML text between the `---` fences, with the fences stripped.
    /// Always preserved verbatim so the UI can render the original if
    /// `parsed` is `None` or if the user wants to inspect raw input.
    pub raw_yaml: String,
    /// `None` when YAML itself is malformed, when a required field has a
    /// value that cannot be coerced into the target type (e.g. an unknown
    /// `type:` enum), or when there is no frontmatter at all.
    pub parsed: Option<JournalFrontmatter>,
    /// Non-fatal warnings: missing optional fields filled with defaults,
    /// missing required fields filled with defaults, deprecated keys, etc.
    pub parse_warnings: Vec<String>,
}

/// Split a markdown source into `(frontmatter, body)`.
///
/// Behaviour matrix:
/// - No leading `---\n` → returns `ParsedFrontmatter { raw_yaml: "", parsed: None, parse_warnings: [] }`,
///   body = full input (no characters lost).
/// - Leading `---\n` but no closing `\n---\n` before EOF → treated as having
///   no frontmatter (input is preserved as body). One warning is emitted.
/// - Leading `---\n…\n---\n` with malformed YAML inside → `parsed: None`,
///   `raw_yaml` populated, body = remainder.
/// - Well-formed YAML → fields normalised via `coerce_frontmatter`.
pub fn parse_frontmatter_and_body(markdown: &str) -> (ParsedFrontmatter, String) {
    let Some(rest) = strip_opening_fence(markdown) else {
        return (
            ParsedFrontmatter {
                raw_yaml: String::new(),
                parsed: None,
                parse_warnings: Vec::new(),
            },
            markdown.to_string(),
        );
    };

    let Some((yaml, body)) = split_closing_fence(rest) else {
        // Opened a fence but never closed it. The safest move is to treat
        // the whole input as body — losing the opening "---" would corrupt
        // user content, so we keep it inside the body.
        return (
            ParsedFrontmatter {
                raw_yaml: String::new(),
                parsed: None,
                parse_warnings: vec![
                    "frontmatter opening fence '---' has no matching closing fence".to_string(),
                ],
            },
            markdown.to_string(),
        );
    };

    let raw_yaml = yaml.to_string();
    let mut warnings = Vec::new();
    let parsed = match serde_yaml::from_str::<YamlValue>(yaml) {
        Ok(YamlValue::Null) => {
            warnings.push("frontmatter is empty".to_string());
            None
        }
        Ok(value) => coerce_frontmatter(&value, &mut warnings),
        Err(e) => {
            warnings.push(format!("yaml parse error: {e}"));
            None
        }
    };

    (
        ParsedFrontmatter {
            raw_yaml,
            parsed,
            parse_warnings: warnings,
        },
        body.to_string(),
    )
}

/// Serialise a frontmatter struct + body back to the on-disk markdown form.
///
/// Keys are emitted in the order specified by `00-spec.md` §3.1 so successive
/// rewrites produce stable diffs. Optional fields that are `None`/empty are
/// omitted from the output (rather than written as `null`) to keep authored
/// files clean — they round-trip back to the same default on re-read.
pub fn write_frontmatter_and_body(fm: &JournalFrontmatter, body: &str) -> String {
    let yaml = render_frontmatter_yaml(fm);
    let mut out = String::with_capacity(yaml.len() + body.len() + 16);
    out.push_str("---\n");
    out.push_str(&yaml);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(body);
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-time coercion (F7a-B). These never touch disk — callers apply them to
// the *cache/display* projection only, recording a parse warning so the ⚠
// reliability badge surfaces what was coerced. The on-disk markdown stays the
// authored SSOT; the explicit "fix original" action is a separate write path.
// ─────────────────────────────────────────────────────────────────────────────

/// Parse a timezone-less ISO-8601 local datetime (`YYYY-MM-DDThh:mm[:ss]`,
/// space-separated variant accepted). Returns `None` for anything that already
/// carries an offset, for date-only strings, or for non-datetime garbage.
fn parse_naive_local(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M"))
        .ok()
}

/// True when `s` is a real ISO datetime that is **missing** a timezone offset
/// (so a naive `new Date(...)` / lexicographic sort would misread it). A string
/// that already has `Z`/`±hh:mm`, or that isn't a datetime at all, returns
/// false — we only flag the specific "tz dropped" friction, nothing else.
pub fn iso_lacks_offset(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || DateTime::parse_from_rfc3339(s).is_ok() {
        return false;
    }
    parse_naive_local(s).is_some()
}

/// Backfill the project timezone offset onto a no-offset ISO datetime,
/// DST-correct via `chrono_tz`. Returns `Some(rfc3339_with_offset)` only when
/// `s` lacked an offset and was successfully interpreted in `tz`; returns
/// `None` (leave untouched) when it already had an offset or isn't a datetime.
/// On a DST fold (ambiguous local time) the earliest instant is chosen.
pub fn backfill_tz_offset(s: &str, tz: Tz) -> Option<String> {
    if !iso_lacks_offset(s) {
        return None;
    }
    let naive = parse_naive_local(s)?;
    let dt = tz.from_local_datetime(&naive).earliest()?;
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, false))
}

/// 제목 → 디스크 이름으로 쓸 kebab slug. **유니코드 alphanumeric 을 살린다** —
/// 한글 제목이 `discussion` · `plan` 같은 상수로 뭉개지지 않게.
///
/// 이 함수가 [`normalize_slug`] 와 짝인 이유: v1.19.0 이 frontmatter `slug:` 규약을
/// 유니코드로 옮겼는데, **디스크 이름을 만드는 쪽은 그 이전 ASCII 규칙에 남아**
/// 있었다. 일지는 파일명이 시각 접두사(`1146_bug_…`)로 유일해 증상이 안 났지만,
/// 논의 폴더와 플랜 파일은 **이름이 곧 정체성**이라 한글 제목이 전부 같은 이름으로
/// 떨어져 `-2`·`-3` 만 붙었다 (「사용자가 찾은 버그들」 → `discussion`).
///
/// `fallback` 은 정말로 남는 글자가 없을 때만 쓴다 (구두점만 있는 제목 등).
/// 60자에서 자르는 것은 경로 길이 방어다.
pub fn slug_from_title(title: &str, fallback: &str) -> String {
    let mut out = String::new();
    let mut prev_hyphen = true; // 선행 하이픈 방지
    for c in title.chars() {
        if c.is_alphanumeric() {
            // `to_ascii_lowercase` 는 A–Z 만 낮추고 한글·숫자·악센트는 그대로 둔다.
            out.push(c.to_ascii_lowercase());
            prev_hyphen = false;
        } else if !prev_hyphen {
            out.push('-');
            prev_hyphen = true;
        }
    }
    let s: String = out.trim_matches('-').chars().take(60).collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        fallback.to_string()
    } else {
        s
    }
}

/// Normalize a slug to kebab-case for display: lowercase ASCII letters, keep
/// any Unicode *alphanumeric* (so Hangul / other scripts survive intact), and
/// collapse every run of other characters into a single `-` (leading/trailing
/// trimmed; max 60 chars).
///
/// F7a-B shipped this ASCII-only (any non-ASCII char → no-op) to avoid dropping
/// the Korean half of a mixed slug like `버그-fix`. This follow-up makes it
/// Unicode-aware instead: `버그 수정!!` → `버그-수정`, `버그-FIX` → `버그-fix`,
/// while already-clean slugs (`버그-fix`, `한글슬러그`) stay untouched. Still a
/// no-op (`None`) when the result is empty or equals the input. Cache/display
/// only — the on-disk slug is never rewritten here.
pub fn normalize_slug(s: &str) -> Option<String> {
    let mut out = String::with_capacity(s.len());
    let mut prev_hyphen = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            // `to_ascii_lowercase` lowercases A–Z and leaves every other
            // codepoint (Hangul, digits, accented letters) unchanged.
            out.push(c.to_ascii_lowercase());
            prev_hyphen = false;
        } else if !prev_hyphen {
            out.push('-');
            prev_hyphen = true;
        }
    }
    let norm: String = out.trim_matches('-').chars().take(60).collect();
    let norm = norm.trim_matches('-').to_string();
    if norm.is_empty() || norm == s {
        None
    } else {
        Some(norm)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

fn strip_opening_fence(input: &str) -> Option<&str> {
    // The opening fence must be the very first line. Accept "---\n" and
    // "---\r\n"; reject anything else (including leading whitespace or BOM —
    // BOMs are rare in our authored files and surfacing them as "no
    // frontmatter" is preferable to silently allowing drift).
    if let Some(rest) = input.strip_prefix("---\n") {
        Some(rest)
    } else {
        input.strip_prefix("---\r\n")
    }
}

fn split_closing_fence(rest: &str) -> Option<(&str, &str)> {
    // Special case: empty frontmatter — the closing fence is the very first
    // thing in `rest` (immediately after the opening fence).
    if let Some(body) = rest.strip_prefix("---\n") {
        return Some(("", body));
    }
    if let Some(body) = rest.strip_prefix("---\r\n") {
        return Some(("", body));
    }
    if rest == "---" {
        return Some(("", ""));
    }

    // Look for "\n---\n" or "\n---\r\n" or trailing "\n---" at EOF.
    let mut search_from = 0usize;
    while let Some(pos) = rest[search_from..].find("\n---") {
        let abs = search_from + pos;
        let after = &rest[abs + 4..]; // skip "\n---"
        // Closing fence must end with newline or EOF — otherwise it's just
        // a horizontal-rule-like sequence inside the YAML (or body).
        if after.is_empty() {
            let yaml = &rest[..abs + 1]; // include the leading newline so YAML parses cleanly
            return Some((yaml, ""));
        }
        if let Some(body) = after.strip_prefix('\n') {
            let yaml = &rest[..abs + 1];
            return Some((yaml, body));
        }
        if let Some(body) = after.strip_prefix("\r\n") {
            let yaml = &rest[..abs + 1];
            return Some((yaml, body));
        }
        search_from = abs + 4;
    }
    None
}

fn coerce_frontmatter(value: &YamlValue, warnings: &mut Vec<String>) -> Option<JournalFrontmatter> {
    let map = value.as_mapping()?;

    // schema_version — required, default 1.
    let schema_version = map
        .get(YamlValue::String("schema_version".into()))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .unwrap_or_else(|| {
            warnings.push("schema_version missing; defaulting to 1".into());
            1
        });

    // type — required, no safe default (enum). Reject if absent or unknown.
    let entry_type = match map
        .get(YamlValue::String("type".into()))
        .and_then(|v| v.as_str())
    {
        Some(s) => match parse_entry_type(s) {
            Some(t) => t,
            None => {
                warnings.push(format!("unknown type '{s}'"));
                return None;
            }
        },
        None => {
            warnings.push("type missing".into());
            return None;
        }
    };

    // slug — required, no safe default.
    let slug = match map
        .get(YamlValue::String("slug".into()))
        .and_then(|v| v.as_str())
    {
        Some(s) if !s.trim().is_empty() => s.to_string(),
        _ => {
            warnings.push("slug missing or empty".into());
            return None;
        }
    };

    // status — required, default planned with warning.
    let status = map
        .get(YamlValue::String("status".into()))
        .and_then(|v| v.as_str())
        .and_then(parse_entry_status)
        .unwrap_or_else(|| {
            warnings.push("status missing or invalid; defaulting to 'planned'".into());
            EntryStatus::Planned
        });

    let difficulty = map
        .get(YamlValue::String("difficulty".into()))
        .and_then(|v| v.as_str())
        .and_then(parse_difficulty);

    // created_at — required string, defaults to empty + warning. UI surfaces.
    let created_at = map
        .get(YamlValue::String("created_at".into()))
        .and_then(stringify_scalar)
        .unwrap_or_else(|| {
            warnings.push("created_at missing".into());
            String::new()
        });
    let updated_at = map
        .get(YamlValue::String("updated_at".into()))
        .and_then(stringify_scalar);

    // session_id — required string, defaults to empty + warning.
    let session_id = map
        .get(YamlValue::String("session_id".into()))
        .and_then(stringify_scalar)
        .unwrap_or_else(|| {
            warnings.push("session_id missing".into());
            String::new()
        });

    // agent — required nested. Accept either a mapping or a bare string "id".
    let agent = match map.get(YamlValue::String("agent".into())) {
        Some(YamlValue::Mapping(m)) => {
            let id = m
                .get(YamlValue::String("id".into()))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let Some(id) = id else {
                warnings.push("agent.id missing".into());
                return None;
            };
            let version = m
                .get(YamlValue::String("version".into()))
                .and_then(stringify_scalar);
            AgentRef { id, version }
        }
        Some(YamlValue::String(s)) => AgentRef {
            id: s.clone(),
            version: None,
        },
        Some(_) => {
            warnings.push("agent has unexpected shape; expected mapping with 'id'".into());
            return None;
        }
        None => {
            warnings.push("agent missing".into());
            return None;
        }
    };

    // language — required, defaults to "ko" with warning.
    let language = map
        .get(YamlValue::String("language".into()))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            warnings.push("language missing; defaulting to 'ko'".into());
            "ko".into()
        });

    let verified_by_user = map
        .get(YamlValue::String("verified_by_user".into()))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let files_touched = match map.get(YamlValue::String("files_touched".into())) {
        Some(YamlValue::Sequence(seq)) => seq
            .iter()
            .filter_map(|item| parse_file_touched(item, warnings))
            .collect(),
        Some(YamlValue::Null) | None => Vec::new(),
        Some(_) => {
            warnings.push("files_touched is not a sequence; ignoring".into());
            Vec::new()
        }
    };

    let related = match map.get(YamlValue::String("related".into())) {
        Some(YamlValue::Sequence(seq)) => seq
            .iter()
            .filter_map(|item| parse_related(item, warnings))
            .collect(),
        Some(YamlValue::Null) | None => Vec::new(),
        Some(_) => {
            warnings.push("related is not a sequence; ignoring".into());
            Vec::new()
        }
    };

    let tags = match map.get(YamlValue::String("tags".into())) {
        Some(YamlValue::Sequence(seq)) => seq
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        Some(YamlValue::Null) | None => Vec::new(),
        Some(_) => {
            warnings.push("tags is not a sequence of strings; ignoring".into());
            Vec::new()
        }
    };

    Some(JournalFrontmatter {
        schema_version,
        entry_type,
        slug,
        status,
        difficulty,
        created_at,
        updated_at,
        session_id,
        agent,
        language,
        verified_by_user,
        files_touched,
        related,
        tags,
    })
}

fn parse_entry_type(s: &str) -> Option<EntryType> {
    match s {
        "bug" => Some(EntryType::Bug),
        "feature" => Some(EntryType::Feature),
        "error" => Some(EntryType::Error),
        "refactor" => Some(EntryType::Refactor),
        "chore" => Some(EntryType::Chore),
        _ => None,
    }
}

fn parse_entry_status(s: &str) -> Option<EntryStatus> {
    match s {
        "planned" => Some(EntryStatus::Planned),
        "in_progress" => Some(EntryStatus::InProgress),
        "done" => Some(EntryStatus::Done),
        "abandoned" => Some(EntryStatus::Abandoned),
        _ => None,
    }
}

fn parse_difficulty(s: &str) -> Option<Difficulty> {
    match s {
        "superhigh" => Some(Difficulty::Superhigh),
        "high" => Some(Difficulty::High),
        "medium" => Some(Difficulty::Medium),
        "low" => Some(Difficulty::Low),
        "verylow" => Some(Difficulty::Verylow),
        _ => None,
    }
}

fn parse_file_op(s: &str) -> Option<FileOp> {
    match s {
        "create" => Some(FileOp::Create),
        "update" => Some(FileOp::Update),
        "modify" => Some(FileOp::Update), // 00-spec mentions "update"; W3-PR3 plan uses "modify". Accept both.
        "delete" => Some(FileOp::Delete),
        "rename" => Some(FileOp::Rename),
        "correct" => Some(FileOp::Correct),
        _ => None,
    }
}

fn parse_file_touched(value: &YamlValue, warnings: &mut Vec<String>) -> Option<FileTouched> {
    let m = value.as_mapping()?;
    let path = m
        .get(YamlValue::String("path".into()))
        .and_then(|v| v.as_str())?
        .to_string();
    let op = m
        .get(YamlValue::String("op".into()))
        .and_then(|v| v.as_str())
        .and_then(parse_file_op)
        .unwrap_or_else(|| {
            warnings.push(format!("files_touched[{path}].op missing or unknown; defaulting to 'update'"));
            FileOp::Update
        });
    let bytes_added = m
        .get(YamlValue::String("bytes_added".into()))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let bytes_removed = m
        .get(YamlValue::String("bytes_removed".into()))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let rename_from = m
        .get(YamlValue::String("rename_from".into()))
        .and_then(stringify_scalar);
    Some(FileTouched {
        path,
        op,
        bytes_added,
        bytes_removed,
        rename_from,
    })
}

fn parse_related(value: &YamlValue, warnings: &mut Vec<String>) -> Option<RelatedRef> {
    let m = value.as_mapping()?;
    let ref_path = m
        .get(YamlValue::String("ref".into()))
        .and_then(|v| v.as_str())?
        .to_string();
    let kind = m
        .get(YamlValue::String("kind".into()))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            warnings.push(format!("related[{ref_path}].kind missing; defaulting to 'followup'"));
            "followup"
        })
        .to_string();
    Some(RelatedRef { ref_path, kind })
}

/// Stringify scalar-ish YAML values (string / int / float / bool / timestamp).
/// Returns `None` for sequences, mappings, and Null so absent fields stay
/// `None` rather than coercing to `"null"`.
fn stringify_scalar(v: &YamlValue) -> Option<String> {
    match v {
        YamlValue::String(s) => Some(s.clone()),
        YamlValue::Number(n) => Some(n.to_string()),
        YamlValue::Bool(b) => Some(b.to_string()),
        // serde_yaml represents YAML timestamps as tagged values; fall back
        // to the public Debug repr which round-trips well enough for our UI
        // surfacing of created_at/updated_at when authors quote them.
        YamlValue::Null | YamlValue::Sequence(_) | YamlValue::Mapping(_) | YamlValue::Tagged(_) => {
            None
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// rendering
// ─────────────────────────────────────────────────────────────────────────────

fn render_frontmatter_yaml(fm: &JournalFrontmatter) -> String {
    let mut out = String::new();
    push_scalar(&mut out, "schema_version", &fm.schema_version.to_string());
    push_scalar(&mut out, "type", entry_type_str(fm.entry_type));
    push_quoted(&mut out, "slug", &fm.slug);
    push_scalar(&mut out, "status", entry_status_str(fm.status));
    if let Some(d) = fm.difficulty {
        push_scalar(&mut out, "difficulty", difficulty_str(d));
    }
    push_quoted(&mut out, "created_at", &fm.created_at);
    if let Some(u) = &fm.updated_at {
        push_quoted(&mut out, "updated_at", u);
    }
    push_quoted(&mut out, "session_id", &fm.session_id);
    out.push_str("agent:\n");
    push_indented_quoted(&mut out, "  id", &fm.agent.id);
    if let Some(v) = &fm.agent.version {
        push_indented_quoted(&mut out, "  version", v);
    }
    push_quoted(&mut out, "language", &fm.language);
    push_scalar(
        &mut out,
        "verified_by_user",
        &fm.verified_by_user.to_string(),
    );
    if fm.files_touched.is_empty() {
        out.push_str("files_touched: []\n");
    } else {
        out.push_str("files_touched:\n");
        for ft in &fm.files_touched {
            out.push_str("  - path: ");
            push_yaml_quoted_value(&mut out, &ft.path);
            out.push('\n');
            out.push_str("    op: ");
            out.push_str(file_op_str(ft.op));
            out.push('\n');
            if let Some(n) = ft.bytes_added {
                out.push_str("    bytes_added: ");
                out.push_str(&n.to_string());
                out.push('\n');
            }
            if let Some(n) = ft.bytes_removed {
                out.push_str("    bytes_removed: ");
                out.push_str(&n.to_string());
                out.push('\n');
            }
            if let Some(r) = &ft.rename_from {
                out.push_str("    rename_from: ");
                push_yaml_quoted_value(&mut out, r);
                out.push('\n');
            }
        }
    }
    if fm.related.is_empty() {
        out.push_str("related: []\n");
    } else {
        out.push_str("related:\n");
        for r in &fm.related {
            out.push_str("  - ref: ");
            push_yaml_quoted_value(&mut out, &r.ref_path);
            out.push('\n');
            out.push_str("    kind: ");
            push_yaml_quoted_value(&mut out, &r.kind);
            out.push('\n');
        }
    }
    if fm.tags.is_empty() {
        out.push_str("tags: []\n");
    } else {
        out.push_str("tags:\n");
        for t in &fm.tags {
            out.push_str("  - ");
            push_yaml_quoted_value(&mut out, t);
            out.push('\n');
        }
    }
    out
}

fn push_scalar(out: &mut String, key: &str, value: &str) {
    out.push_str(key);
    out.push_str(": ");
    out.push_str(value);
    out.push('\n');
}

fn push_quoted(out: &mut String, key: &str, value: &str) {
    out.push_str(key);
    out.push_str(": ");
    push_yaml_quoted_value(out, value);
    out.push('\n');
}

fn push_indented_quoted(out: &mut String, key_with_indent: &str, value: &str) {
    out.push_str(key_with_indent);
    out.push_str(": ");
    push_yaml_quoted_value(out, value);
    out.push('\n');
}

/// Quote any string value using YAML double-quoted form. Escapes backslash,
/// double-quote, and control characters. Always quoting keeps the output
/// trivially safe for slugs/ISO timestamps/file paths without per-value
/// classification heuristics.
fn push_yaml_quoted_value(out: &mut String, value: &str) {
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn entry_type_str(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

fn entry_status_str(s: EntryStatus) -> &'static str {
    match s {
        EntryStatus::Planned => "planned",
        EntryStatus::InProgress => "in_progress",
        EntryStatus::Done => "done",
        EntryStatus::Abandoned => "abandoned",
    }
}

fn difficulty_str(d: Difficulty) -> &'static str {
    match d {
        Difficulty::Superhigh => "superhigh",
        Difficulty::High => "high",
        Difficulty::Medium => "medium",
        Difficulty::Low => "low",
        Difficulty::Verylow => "verylow",
    }
}

fn file_op_str(op: FileOp) -> &'static str {
    match op {
        FileOp::Create => "create",
        FileOp::Update => "update",
        FileOp::Delete => "delete",
        FileOp::Rename => "rename",
        FileOp::Correct => "correct",
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ─── 제목 → 디스크 이름 slug ────────────────────────────────────────────

    /// 이 버그의 본체 — 한글만 있는 제목이 상수 폴백으로 뭉개지던 것.
    /// 논의·플랜은 **이름이 곧 정체성**이라 전부 같은 이름이 되고 `-2`·`-3` 만
    /// 붙었다 (실제로 「사용자가 찾은 버그들」 → `discussion`).
    #[test]
    fn slug_from_title_keeps_hangul_instead_of_collapsing_to_the_fallback() {
        assert_eq!(
            slug_from_title("사용자가 찾은 버그들", "discussion"),
            "사용자가-찾은-버그들"
        );
        assert_eq!(slug_from_title("코드 화면 개편", "plan"), "코드-화면-개편");
        // 섞여 있으면 양쪽 다 산다 (ASCII 만 남기던 옛 규칙은 한글을 버렸다).
        assert_eq!(slug_from_title("버그 FIX 라운드", "plan"), "버그-fix-라운드");
    }

    #[test]
    fn slug_from_title_matches_the_old_ascii_behaviour_for_ascii_titles() {
        // 기존 폴더 이름이 흔들리지 않는다는 뜻이라 회귀 방어로 중요하다.
        assert_eq!(slug_from_title("Claude Plugin Strategy", "plan"), "claude-plugin-strategy");
        assert_eq!(slug_from_title("  pricing / open-core!! ", "plan"), "pricing-open-core");
        assert_eq!(slug_from_title("v2 Release", "plan"), "v2-release");
    }

    #[test]
    fn slug_from_title_falls_back_only_when_nothing_survives() {
        assert_eq!(slug_from_title("!!! ??? ---", "discussion"), "discussion");
        assert_eq!(slug_from_title("", "plan"), "plan");
        assert_eq!(slug_from_title("   ", "plan"), "plan");
    }

    #[test]
    fn slug_from_title_caps_length_and_never_ends_on_a_hyphen() {
        let long = "가".repeat(80);
        let out = slug_from_title(&long, "plan");
        assert_eq!(out.chars().count(), 60);
        // 자른 자리가 하이픈이어도 끝에 남기지 않는다.
        let words = "ab ".repeat(40);
        let out2 = slug_from_title(&words, "plan");
        assert!(!out2.ends_with('-'), "{out2}");
        assert!(!out2.starts_with('-'), "{out2}");
    }

    // ─── F7a-B read-time coercion helpers ───────────────────────────────────

    #[test]
    fn iso_lacks_offset_only_flags_real_tz_less_datetimes() {
        assert!(iso_lacks_offset("2026-06-22T10:00:00"));
        assert!(iso_lacks_offset("2026-06-22T10:00")); // minute precision
        assert!(iso_lacks_offset("2026-06-22 10:00:00")); // space variant
        // Already has an offset / Z → not flagged.
        assert!(!iso_lacks_offset("2026-06-22T10:00:00+09:00"));
        assert!(!iso_lacks_offset("2026-06-22T01:00:00Z"));
        // Not a datetime at all → not flagged (a different concern).
        assert!(!iso_lacks_offset("x"));
        assert!(!iso_lacks_offset("2026-06-22")); // date-only
        assert!(!iso_lacks_offset(""));
    }

    #[test]
    fn backfill_tz_offset_adds_project_offset_dst_correct() {
        let seoul: Tz = "Asia/Seoul".parse().unwrap();
        // Korea is UTC+9 year-round (no DST).
        assert_eq!(
            backfill_tz_offset("2026-06-22T10:00:00", seoul).as_deref(),
            Some("2026-06-22T10:00:00+09:00")
        );
        // A DST zone: New York in July is EDT (-04:00), in January EST (-05:00).
        let ny: Tz = "America/New_York".parse().unwrap();
        assert_eq!(
            backfill_tz_offset("2026-07-01T12:00:00", ny).as_deref(),
            Some("2026-07-01T12:00:00-04:00")
        );
        assert_eq!(
            backfill_tz_offset("2026-01-01T12:00:00", ny).as_deref(),
            Some("2026-01-01T12:00:00-05:00")
        );
        // Already offset-bearing or non-datetime → left untouched (None).
        assert_eq!(backfill_tz_offset("2026-06-22T10:00:00+09:00", seoul), None);
        assert_eq!(backfill_tz_offset("garbage", seoul), None);
    }

    #[test]
    fn normalize_slug_kebabs_only_when_needed() {
        assert_eq!(normalize_slug("My_Feature").as_deref(), Some("my-feature"));
        assert_eq!(normalize_slug("Has Spaces!!").as_deref(), Some("has-spaces"));
        assert_eq!(normalize_slug("--Trim--Me--").as_deref(), Some("trim-me"));
        // Already valid → None (no change).
        assert_eq!(normalize_slug("already-valid-123"), None);
    }

    #[test]
    fn normalize_slug_is_unicode_aware_for_hangul() {
        // Already-clean Hangul slugs are untouched (no Korean half dropped).
        assert_eq!(normalize_slug("한글슬러그"), None);
        assert_eq!(normalize_slug("버그-fix"), None);
        assert_eq!(normalize_slug("fix-한글-bug"), None);
        // But separators / case ARE normalized while Hangul survives intact.
        assert_eq!(normalize_slug("버그 수정!!").as_deref(), Some("버그-수정"));
        assert_eq!(normalize_slug("버그__수정").as_deref(), Some("버그-수정"));
        assert_eq!(normalize_slug("버그-FIX").as_deref(), Some("버그-fix"));
        assert_eq!(normalize_slug("  한글 슬러그  ").as_deref(), Some("한글-슬러그"));
        // All-punctuation / emoji → empty → None (no-op, not a lossy rewrite).
        assert_eq!(normalize_slug("!!!"), None);
        assert_eq!(normalize_slug("🎉"), None);
    }

    fn sample_yaml() -> String {
        r#"---
schema_version: 1
type: bug
slug: changelog-export-param-mismatch
status: done
difficulty: medium
created_at: "2026-05-22T20:55:00+09:00"
updated_at: "2026-05-22T21:08:14+09:00"
session_id: "20260522-001"
agent:
  id: claude-code
  version: "opus-4.7"
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
    bytes_added: 42
    bytes_removed: 18
related:
  - ref: "20260522/Bugs/2050_bug_diff.md"
    kind: followup
tags: ["changelog", "sqlite"]
---
[x] Changelog Export 파라미터 불일치

## 발생 원인
대충 SQL 빌더가 분기 안 함.

## 해결 방법
분기 추가.
"#
        .to_string()
    }

    #[test]
    fn parses_well_formed_frontmatter_with_no_warnings() {
        let (pf, body) = parse_frontmatter_and_body(&sample_yaml());
        assert!(pf.parse_warnings.is_empty(), "warnings: {:?}", pf.parse_warnings);
        let fm = pf.parsed.expect("should parse");
        assert_eq!(fm.entry_type, EntryType::Bug);
        assert_eq!(fm.slug, "changelog-export-param-mismatch");
        assert_eq!(fm.status, EntryStatus::Done);
        assert_eq!(fm.difficulty, Some(Difficulty::Medium));
        assert_eq!(fm.created_at, "2026-05-22T20:55:00+09:00");
        assert_eq!(fm.session_id, "20260522-001");
        assert_eq!(fm.agent.id, "claude-code");
        assert_eq!(fm.agent.version.as_deref(), Some("opus-4.7"));
        assert_eq!(fm.language, "ko");
        assert!(!fm.verified_by_user);
        assert_eq!(fm.files_touched.len(), 1);
        assert_eq!(fm.files_touched[0].path, "src-tauri/src/db.rs");
        assert_eq!(fm.files_touched[0].op, FileOp::Update);
        assert_eq!(fm.files_touched[0].bytes_added, Some(42));
        assert_eq!(fm.related.len(), 1);
        assert_eq!(fm.related[0].kind, "followup");
        assert_eq!(fm.tags, vec!["changelog", "sqlite"]);
        assert!(body.starts_with("[x] Changelog Export"));
    }

    #[test]
    fn no_frontmatter_returns_full_body() {
        let input = "# Just a heading\n\nbody text\n";
        let (pf, body) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none());
        assert!(pf.raw_yaml.is_empty());
        assert!(pf.parse_warnings.is_empty());
        assert_eq!(body, input);
    }

    #[test]
    fn unterminated_opening_fence_preserves_full_input_as_body() {
        let input = "---\nschema_version: 1\nno closing fence here\n";
        let (pf, body) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none());
        assert!(pf.raw_yaml.is_empty());
        assert_eq!(pf.parse_warnings.len(), 1);
        assert_eq!(body, input, "body must round-trip without losing any bytes");
    }

    #[test]
    fn korean_values_round_trip_through_yaml() {
        let input = "---\nschema_version: 1\ntype: bug\nslug: korean-test\nstatus: done\ncreated_at: \"2026-05-22T09:00:00+09:00\"\nsession_id: \"20260522-001\"\nagent: { id: claude-code }\nlanguage: ko\n---\n버그 발생\n";
        let (pf, _) = parse_frontmatter_and_body(input);
        let fm = pf.parsed.expect("parsed");
        assert_eq!(fm.slug, "korean-test");
        assert_eq!(fm.language, "ko");
    }

    #[test]
    fn unknown_type_fails_soft_with_warning() {
        let input = "---\nschema_version: 1\ntype: weird\nslug: x\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en\n---\nbody\n";
        let (pf, body) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none(), "unknown enum must not yield Some");
        assert!(!pf.raw_yaml.is_empty(), "raw_yaml must be preserved");
        assert!(pf
            .parse_warnings
            .iter()
            .any(|w| w.contains("unknown type")));
        assert_eq!(body, "body\n");
    }

    #[test]
    fn missing_required_field_yields_none_with_warning() {
        // slug missing — required, no safe default.
        let input = "---\nschema_version: 1\ntype: bug\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en\n---\nbody\n";
        let (pf, _) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none());
        assert!(pf
            .parse_warnings
            .iter()
            .any(|w| w.contains("slug missing")));
    }

    #[test]
    fn optional_fields_default_to_empty_collections() {
        // Required fields only; files_touched / related / tags absent.
        let input = "---\nschema_version: 1\ntype: chore\nslug: minimal\nstatus: planned\ncreated_at: \"2026-05-22T00:00:00+09:00\"\nsession_id: \"20260522-001\"\nagent: { id: manual }\nlanguage: ko\n---\n";
        let (pf, _) = parse_frontmatter_and_body(input);
        let fm = pf.parsed.expect("parsed");
        assert!(fm.files_touched.is_empty());
        assert!(fm.related.is_empty());
        assert!(fm.tags.is_empty());
        assert!(!fm.verified_by_user);
        assert!(fm.difficulty.is_none());
        assert!(fm.updated_at.is_none());
    }

    #[test]
    fn broken_yaml_preserves_raw_and_yields_none() {
        let input = "---\nschema_version: 1\ntype: bug\n  bad: [unclosed\n---\nbody\n";
        let (pf, body) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none());
        assert!(!pf.raw_yaml.is_empty(), "raw_yaml must be preserved");
        assert!(pf
            .parse_warnings
            .iter()
            .any(|w| w.contains("yaml parse error")));
        assert_eq!(body, "body\n");
    }

    #[test]
    fn round_trip_write_then_parse_preserves_fields() {
        let (pf, body) = parse_frontmatter_and_body(&sample_yaml());
        let fm = pf.parsed.unwrap();
        let rendered = write_frontmatter_and_body(&fm, &body);
        let (pf2, body2) = parse_frontmatter_and_body(&rendered);
        let fm2 = pf2.parsed.expect("re-parse");
        assert_eq!(fm.entry_type, fm2.entry_type);
        assert_eq!(fm.slug, fm2.slug);
        assert_eq!(fm.status, fm2.status);
        assert_eq!(fm.difficulty, fm2.difficulty);
        assert_eq!(fm.created_at, fm2.created_at);
        assert_eq!(fm.updated_at, fm2.updated_at);
        assert_eq!(fm.session_id, fm2.session_id);
        assert_eq!(fm.agent, fm2.agent);
        assert_eq!(fm.language, fm2.language);
        assert_eq!(fm.verified_by_user, fm2.verified_by_user);
        assert_eq!(fm.files_touched, fm2.files_touched);
        assert_eq!(fm.related, fm2.related);
        assert_eq!(fm.tags, fm2.tags);
        assert_eq!(body, body2);
    }

    #[test]
    fn round_trip_with_body_starting_with_triple_dash_is_preserved() {
        // A body that itself contains "---\n" — the writer always emits a
        // closing fence and a newline before the body, so the parser's
        // first "\n---\n" hit is the real closing fence.
        let fm = JournalFrontmatter {
            schema_version: 1,
            entry_type: EntryType::Feature,
            slug: "hr".into(),
            status: EntryStatus::InProgress,
            difficulty: None,
            created_at: "2026-05-24T09:00:00+09:00".into(),
            updated_at: None,
            session_id: "20260524-001".into(),
            agent: AgentRef {
                id: "manual".into(),
                version: None,
            },
            language: "ko".into(),
            verified_by_user: false,
            files_touched: Vec::new(),
            related: Vec::new(),
            tags: Vec::new(),
        };
        let body = "# header\n\n---\n\nthat triple-dash is a horizontal rule\n";
        let text = write_frontmatter_and_body(&fm, body);
        let (pf, body2) = parse_frontmatter_and_body(&text);
        assert!(pf.parsed.is_some());
        assert_eq!(body, body2);
    }

    #[test]
    fn empty_frontmatter_block_warns_and_returns_none() {
        let input = "---\n---\nbody\n";
        let (pf, body) = parse_frontmatter_and_body(input);
        assert!(pf.parsed.is_none());
        assert_eq!(body, "body\n");
        // raw_yaml is empty (just the leading newline) — warnings may or may
        // not include "frontmatter is empty" depending on serde_yaml's
        // treatment; either way no panic and no parse.
    }

    #[test]
    fn agent_as_bare_string_is_accepted() {
        let input = "---\nschema_version: 1\ntype: chore\nslug: x\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: manual\nlanguage: en\n---\n";
        let (pf, _) = parse_frontmatter_and_body(input);
        let fm = pf.parsed.expect("parsed");
        assert_eq!(fm.agent.id, "manual");
        assert!(fm.agent.version.is_none());
    }

    #[test]
    fn fuzz_random_bytes_never_panic() {
        // Use a deterministic LCG so the test is reproducible without a
        // dev-dep on `rand`. 256 iterations × 1 KiB ≈ 256 KiB total — fast.
        let mut state: u64 = 0xdead_beef_dead_beef;
        for _ in 0..256 {
            let mut buf = Vec::with_capacity(1024);
            for _ in 0..1024 {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                buf.push((state >> 33) as u8);
            }
            // serde_yaml + our parser must not panic on any sequence.
            let s = String::from_utf8_lossy(&buf);
            let _ = parse_frontmatter_and_body(&s);
        }
    }

    #[test]
    fn write_emits_stable_key_order() {
        let fm = JournalFrontmatter {
            schema_version: 1,
            entry_type: EntryType::Refactor,
            slug: "stable-order".into(),
            status: EntryStatus::Done,
            difficulty: Some(Difficulty::High),
            created_at: "2026-05-24T10:00:00+09:00".into(),
            updated_at: Some("2026-05-24T10:30:00+09:00".into()),
            session_id: "20260524-002".into(),
            agent: AgentRef {
                id: "claude-code".into(),
                version: Some("opus-4.7".into()),
            },
            language: "ko".into(),
            verified_by_user: true,
            files_touched: vec![FileTouched {
                path: "a.rs".into(),
                op: FileOp::Update,
                bytes_added: None,
                bytes_removed: None,
                rename_from: None,
            }],
            related: Vec::new(),
            tags: vec!["x".into()],
        };
        let text = write_frontmatter_and_body(&fm, "body\n");
        // schema_version must come before type, type before slug, etc.
        let sv = text.find("schema_version:").unwrap();
        let ty = text.find("type:").unwrap();
        let sl = text.find("slug:").unwrap();
        let st = text.find("status:").unwrap();
        let df = text.find("difficulty:").unwrap();
        let ca = text.find("created_at:").unwrap();
        let ua = text.find("updated_at:").unwrap();
        let si = text.find("session_id:").unwrap();
        let ag = text.find("agent:").unwrap();
        let la = text.find("language:").unwrap();
        let vu = text.find("verified_by_user:").unwrap();
        let ft = text.find("files_touched:").unwrap();
        let rl = text.find("related:").unwrap();
        let tg = text.find("tags:").unwrap();
        assert!(sv < ty);
        assert!(ty < sl);
        assert!(sl < st);
        assert!(st < df);
        assert!(df < ca);
        assert!(ca < ua);
        assert!(ua < si);
        assert!(si < ag);
        assert!(ag < la);
        assert!(la < vu);
        assert!(vu < ft);
        assert!(ft < rl);
        assert!(rl < tg);
    }
}

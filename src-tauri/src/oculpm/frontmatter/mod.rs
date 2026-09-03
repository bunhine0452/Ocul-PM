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
            // 에이전트 자신의 대화 id. 없는 것이 정상이다 — 이 필드가 생기기
            // 전의 일지와 손으로 쓴 항목에는 아예 없다.
            let session = m
                .get(YamlValue::String("session".into()))
                .and_then(stringify_scalar)
                .filter(|v| !v.trim().is_empty());
            AgentRef {
                id,
                version,
                session,
            }
        }
        Some(YamlValue::String(s)) => AgentRef {
            id: s.clone(),
            version: None,
            session: None,
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
            warnings.push(format!(
                "files_touched[{path}].op missing or unknown; defaulting to 'update'"
            ));
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
            warnings.push(format!(
                "related[{ref_path}].kind missing; defaulting to 'followup'"
            ));
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
    if let Some(sid) = &fm.agent.session {
        push_indented_quoted(&mut out, "  session", sid);
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
mod tests;

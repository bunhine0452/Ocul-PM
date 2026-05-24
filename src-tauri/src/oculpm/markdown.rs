//! Body parsing for journal markdown — checkbox/title extraction and
//! header collection (excluding fenced code blocks).
//!
//! See `docs/major_update/oculpm/00-spec.md` §3.2 (body conventions) and
//! `docs/major_update/oculpm/phases/W3-journal-today-ui.md` §W3-PR1.
//!
//! The first non-blank body line is treated as the entry title. Three forms
//! are recognised, in priority order:
//!
//! 1. `[x] Title` / `[ ] Title` → `(checkbox = Some(_), title = "Title")`
//! 2. `# Title` (any heading level) → `(checkbox = None, title = "Title")`
//! 3. Anything else → `(checkbox = None, title = trimmed line)`
//!
//! Headings (`##` and deeper) are extracted from the body via `pulldown-cmark`
//! so fenced code blocks containing `## fake` lines never leak into the
//! result. The first-line heading is intentionally skipped because it is
//! already represented as `title`.

#![allow(dead_code)] // Consumed by `cache.rs` (W3-PR2) and
                     // `commands/oculpm.rs` (W3-PR3).

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag};

/// Parsed view of a journal entry body.
#[derive(Debug, Clone)]
pub struct ParsedBody {
    pub title: String,
    /// `None` when the first line lacks a `[ ]`/`[x]` marker.
    pub checkbox: Option<bool>,
    /// `##` and deeper headings extracted from the body, in document order,
    /// excluding any inside fenced code blocks.
    pub headers: Vec<String>,
    /// Untouched original body — callers re-use this for cache writes.
    pub raw: String,
}

/// Parse a journal body. The input does **not** include frontmatter; it is
/// expected to be the body returned by
/// [`crate::oculpm::frontmatter::parse_frontmatter_and_body`].
pub fn parse_body(body: &str) -> ParsedBody {
    let (checkbox, title) = extract_title(body);
    let headers = extract_headers(body);
    ParsedBody {
        title,
        checkbox,
        headers,
        raw: body.to_string(),
    }
}

fn extract_title(body: &str) -> (Option<bool>, String) {
    let first_non_blank = body.lines().find(|line| !line.trim().is_empty());
    let Some(line) = first_non_blank else {
        return (None, String::new());
    };
    let trimmed = line.trim_start();

    // Form 1: "[x] ..." / "[ ] ..."
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(close) = rest.find(']') {
            let marker = &rest[..close];
            let after = &rest[close + 1..];
            if matches!(marker, " " | "x" | "X") && after.starts_with(' ') {
                let checked = matches!(marker, "x" | "X");
                return (Some(checked), after.trim_start().trim_end().to_string());
            }
        }
    }

    // Form 2: "# Title" (any heading level)
    if let Some(after_hashes) = strip_heading_prefix(trimmed) {
        return (None, after_hashes.trim_end().to_string());
    }

    // Form 3: raw first line
    (None, trimmed.trim_end().to_string())
}

fn strip_heading_prefix(line: &str) -> Option<&str> {
    let mut chars = line.char_indices();
    let mut hash_count = 0;
    let mut last_hash_end = 0;
    for (i, c) in chars.by_ref() {
        if c == '#' {
            hash_count += 1;
            last_hash_end = i + 1;
            if hash_count > 6 {
                return None;
            }
        } else {
            break;
        }
    }
    if hash_count == 0 {
        return None;
    }
    let rest = &line[last_hash_end..];
    let rest = rest.strip_prefix(' ')?;
    Some(rest)
}

fn extract_headers(body: &str) -> Vec<String> {
    let parser = Parser::new(body);
    let mut headers = Vec::new();
    let mut in_heading: Option<HeadingLevel> = None;
    let mut current = String::new();
    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = Some(level);
                current.clear();
            }
            Event::End(pulldown_cmark::TagEnd::Heading(_)) => {
                if let Some(level) = in_heading.take() {
                    // Skip H1 because the first body line is the title;
                    // the spec strongly suggests `## section` for sub-bodies.
                    if !matches!(level, HeadingLevel::H1) && !current.trim().is_empty() {
                        headers.push(current.trim().to_string());
                    }
                }
                current.clear();
            }
            Event::Text(t) if in_heading.is_some() => current.push_str(&t),
            Event::Code(c) if in_heading.is_some() => current.push_str(&c),
            _ => {}
        }
    }
    headers
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkbox_x_extracts_checked_title() {
        let pb = parse_body("[x] Changelog Export 파라미터 불일치\n\n## 발생 원인\n본문\n");
        assert_eq!(pb.checkbox, Some(true));
        assert_eq!(pb.title, "Changelog Export 파라미터 불일치");
        assert_eq!(pb.headers, vec!["발생 원인"]);
    }

    #[test]
    fn checkbox_space_extracts_unchecked_title() {
        let pb = parse_body("[ ] Pending item\n");
        assert_eq!(pb.checkbox, Some(false));
        assert_eq!(pb.title, "Pending item");
    }

    #[test]
    fn capital_x_is_checked() {
        let pb = parse_body("[X] Capital X\n");
        assert_eq!(pb.checkbox, Some(true));
        assert_eq!(pb.title, "Capital X");
    }

    #[test]
    fn heading_form_extracts_title_with_no_checkbox() {
        let pb = parse_body("# Top-level title\n\n## Section\nbody\n");
        assert_eq!(pb.checkbox, None);
        assert_eq!(pb.title, "Top-level title");
        assert_eq!(pb.headers, vec!["Section"]);
    }

    #[test]
    fn raw_first_line_when_no_marker() {
        let pb = parse_body("plain title here\n\nmore body\n");
        assert_eq!(pb.checkbox, None);
        assert_eq!(pb.title, "plain title here");
        assert!(pb.headers.is_empty());
    }

    #[test]
    fn empty_body_yields_empty_title() {
        let pb = parse_body("");
        assert_eq!(pb.title, "");
        assert!(pb.checkbox.is_none());
        assert!(pb.headers.is_empty());
    }

    #[test]
    fn leading_blank_lines_are_skipped() {
        let pb = parse_body("\n\n   \n[ ] After blanks\n");
        assert_eq!(pb.checkbox, Some(false));
        assert_eq!(pb.title, "After blanks");
    }

    #[test]
    fn fenced_code_block_headers_are_excluded() {
        let body = "[x] real title\n\n## real section\n\n```\n## fake header inside code\n```\n\n## another real\n";
        let pb = parse_body(body);
        assert_eq!(pb.title, "real title");
        assert_eq!(pb.headers, vec!["real section", "another real"]);
    }

    #[test]
    fn h1_is_excluded_from_headers_to_avoid_duplicating_title() {
        let body = "# title line\n\n# duplicate h1\n\n## sub\n";
        let pb = parse_body(body);
        assert_eq!(pb.title, "title line");
        // H1s are skipped — only "sub" remains.
        assert_eq!(pb.headers, vec!["sub"]);
    }

    #[test]
    fn bracket_no_space_after_does_not_match_checkbox() {
        // `[x]Title` with no trailing space should fall through to raw form.
        let pb = parse_body("[x]NoSpace\n");
        assert_eq!(pb.checkbox, None);
        assert_eq!(pb.title, "[x]NoSpace");
    }

    #[test]
    fn deep_heading_levels_extract_text() {
        let body = "title\n\n### deep\n#### deeper\n";
        let pb = parse_body(body);
        assert_eq!(pb.headers, vec!["deep", "deeper"]);
    }

    #[test]
    fn headers_with_inline_code_are_preserved() {
        let body = "title\n\n## fix `db.rs` bug\n";
        let pb = parse_body(body);
        assert_eq!(pb.headers, vec!["fix db.rs bug"]);
    }

    #[test]
    fn raw_is_preserved_verbatim() {
        let body = "[x] T\n\nrandom\n\n```\nx\n```\n";
        let pb = parse_body(body);
        assert_eq!(pb.raw, body);
    }
}

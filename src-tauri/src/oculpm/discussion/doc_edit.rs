//! Pure markdown surgery for the Discussion SSOT (PR-DISC 1 write path).
//!
//! All functions take the full markdown string and return a new one, preserving
//! everything they don't touch (the file is the source of truth — the app and
//! external agents edit the *same* document). No I/O here; the commands wrap
//! these with `atomic_io::write_atomic`. Unlike the planner (structured item
//! ops), a discussion is prose-heavy, so `write_body` swaps the whole body while
//! the frontmatter (id/title/status/created/owner/tags/resolution_ref) stays
//! app-managed.

#![allow(dead_code)] // Consumed by commands/discussion.rs.

const LOG_BEGIN: &str = "<!-- oculpm:discussion-log begin v1 -->";
const LOG_END: &str = "<!-- oculpm:discussion-log end -->";

/// Build a fresh discussion document: frontmatter + the section skeleton
/// (problem-first) + an empty discussion-log managed block. Parses clean.
pub fn create_discussion_skeleton(id: &str, title: &str, owner: &str, date: &str) -> String {
    format!(
        "---\noculpm_discussion: v1\nid: {id}\ntitle: \"{title}\"\nstatus: open\ncreated: {date}\nupdated: {date}\nowner: {owner}\n---\n\n\
         ## 문제 정의\n\n\n\
         ## 배경 / 조사 자료\n\n\n\
         ## 후보 해결 방안\n\n\n\
         ## 토의 / 메모\n\n{LOG_BEGIN}\n{LOG_END}\n\n\
         ## 결론\n\n\n\
         ## 다음 단계\n\n",
        id = id,
        title = escape_yaml(title),
        owner = owner,
        date = date,
    )
}

/// Replace the body (everything after the frontmatter fence) with `new_body`,
/// bumping `updated:` and preserving the frontmatter verbatim. A document with
/// no frontmatter fence → `new_body` is returned (fail-soft; the app always
/// writes a fenced skeleton, so this only guards malformed input).
pub fn write_body(md: &str, new_body: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let Some(start) = lines.iter().position(|l| l.trim() == "---") else {
        return ensure_trailing_newline(new_body);
    };
    if !lines[start + 1..].iter().any(|l| l.trim() == "---") {
        return ensure_trailing_newline(new_body);
    }
    set_fm_field(&mut lines, "updated", date, &["created", "status", "title", "id"]);
    // Recompute the closing fence (an insert may have shifted it).
    let start = lines.iter().position(|l| l.trim() == "---").unwrap();
    let end = start
        + 1
        + lines[start + 1..]
            .iter()
            .position(|l| l.trim() == "---")
            .unwrap();
    let fm = lines[start..=end].join("\n");
    format!("{}\n\n{}\n", fm, new_body.trim_end())
}

/// Set the frontmatter `status:` (and bump `updated:`), preserving everything
/// else. A document with no frontmatter fence is returned unchanged.
pub fn set_status(md: &str, status: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    if !set_fm_field(&mut lines, "status", status, &["title", "id"]) {
        return md.to_string();
    }
    set_fm_field(&mut lines, "updated", date, &["created", "status", "title", "id"]);
    lines.join("\n")
}

/// Set the frontmatter `title:` (and bump `updated:`). The `id` / folder are
/// unchanged so references keep working.
pub fn set_title(md: &str, title: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let value = format!("\"{}\"", escape_yaml(title));
    if !set_fm_field(&mut lines, "title", &value, &["id"]) {
        return md.to_string();
    }
    set_fm_field(&mut lines, "updated", date, &["created", "status", "title", "id"]);
    lines.join("\n")
}

/// Mark the discussion resolved and link the plan it was promoted into: sets
/// `status: resolved`, bumps `updated`, and writes a `resolution_ref:` nested
/// mapping (`plan_id` + `decided_at`) into the frontmatter (replacing any prior
/// one). Body is untouched. Returned unchanged if there's no frontmatter fence.
pub fn set_resolution(md: &str, plan_id: &str, decided_at: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    if !set_fm_field(&mut lines, "status", "resolved", &["title", "id"]) {
        return md.to_string();
    }
    set_fm_field(&mut lines, "updated", date, &["created", "status", "title", "id"]);
    remove_resolution_ref(&mut lines);
    // Insert the block just before the closing fence.
    let start = lines.iter().position(|l| l.trim() == "---").unwrap();
    let end = start
        + 1
        + lines[start + 1..]
            .iter()
            .position(|l| l.trim() == "---")
            .unwrap();
    let block = vec![
        "resolution_ref:".to_string(),
        format!("  plan_id: {plan_id}"),
        format!("  decided_at: {decided_at}"),
    ];
    for (k, line) in block.into_iter().enumerate() {
        lines.insert(end + k, line);
    }
    lines.join("\n")
}

/// Remove an existing `resolution_ref:` line and its indented children from the
/// frontmatter (so `set_resolution` can rewrite it idempotently).
fn remove_resolution_ref(lines: &mut Vec<String>) {
    let Some(start) = lines.iter().position(|l| l.trim() == "---") else {
        return;
    };
    let Some(rel) = lines[start + 1..].iter().position(|l| l.trim() == "---") else {
        return;
    };
    let end = start + 1 + rel;
    let Some(key_idx) = ((start + 1)..end)
        .find(|&i| lines[i].trim_start().starts_with("resolution_ref:"))
    else {
        return;
    };
    let mut last = key_idx;
    for i in (key_idx + 1)..end {
        let l = &lines[i];
        if l.starts_with(' ') || l.starts_with('\t') {
            last = i;
        } else {
            break;
        }
    }
    lines.drain(key_idx..=last);
}

// ── internals ───────────────────────────────────────────────────────────────

/// Set or insert a `key: value` line inside the first `--- … ---` fence.
/// Insert position: right after the first present key in `after` (priority
/// order), else at the fence top. Returns false if there's no fence.
fn set_fm_field(lines: &mut Vec<String>, key: &str, value: &str, after: &[&str]) -> bool {
    let Some(start) = lines.iter().position(|l| l.trim() == "---") else {
        return false;
    };
    let Some(rel) = lines[start + 1..].iter().position(|l| l.trim() == "---") else {
        return false;
    };
    let end = start + 1 + rel;
    let prefix = format!("{key}:");
    for line in lines.iter_mut().take(end).skip(start + 1) {
        if line.trim_start().starts_with(&prefix) {
            *line = format!("{key}: {value}");
            return true;
        }
    }
    let at = after
        .iter()
        .find_map(|k| {
            let kp = format!("{k}:");
            ((start + 1)..end).find(|&i| lines[i].trim_start().starts_with(&kp))
        })
        .map(|i| i + 1)
        .unwrap_or(start + 1);
    lines.insert(at, format!("{key}: {value}"));
    true
}

fn ensure_trailing_newline(s: &str) -> String {
    if s.ends_with('\n') {
        s.to_string()
    } else {
        format!("{s}\n")
    }
}

/// Minimal YAML double-quote escaping for the title scalar.
fn escape_yaml(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::discussion::parse::{parse_discussion, DiscussionStatus};

    #[test]
    fn skeleton_parses_clean() {
        let md = create_discussion_skeleton("my-topic", "내 토의", "user", "2026-06-29");
        let d = parse_discussion(&md, "my-topic");
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        assert_eq!(d.frontmatter.id, "my-topic");
        assert_eq!(d.frontmatter.title, "내 토의");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Open);
        assert_eq!(d.frontmatter.owner, "user");
        assert_eq!(d.options.len(), 0);
        assert_eq!(d.next_steps.len(), 0);
        assert_eq!(d.log.len(), 0);
    }

    #[test]
    fn write_body_swaps_body_and_keeps_frontmatter() {
        let md = create_discussion_skeleton("t", "제목", "user", "2026-06-01");
        let body = "## 문제 정의\n새 문제다\n\n## 다음 단계\n- [ ] 할것 {#s1}\n";
        let out = write_body(&md, body, "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        // frontmatter preserved, updated bumped
        assert_eq!(d.frontmatter.id, "t");
        assert_eq!(d.frontmatter.title, "제목");
        assert_eq!(d.frontmatter.updated.as_deref(), Some("2026-06-29"));
        assert_eq!(d.frontmatter.created.as_deref(), Some("2026-06-01"));
        // new body
        assert!(d.problem.contains("새 문제다"));
        assert_eq!(d.next_steps.len(), 1);
        assert_eq!(d.next_steps[0].step_id, "s1");
    }

    #[test]
    fn write_body_preserves_resolution_ref_nested_mapping() {
        let md = "---\noculpm_discussion: v1\nid: t\ntitle: \"제목\"\nstatus: resolved\ncreated: 2026-06-01\nupdated: 2026-06-01\nowner: user\nresolution_ref:\n  plan_id: my-plan\n  decided_at: 2026-06-02T10:00:00+09:00\n---\n\n## 문제 정의\n옛 본문\n";
        let out = write_body(&md, "## 문제 정의\n새 본문\n", "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert_eq!(d.frontmatter.resolution_plan_id.as_deref(), Some("my-plan"));
        assert_eq!(
            d.frontmatter.resolution_decided_at.as_deref(),
            Some("2026-06-02T10:00:00+09:00")
        );
        assert_eq!(d.frontmatter.status, DiscussionStatus::Resolved);
        assert!(d.problem.contains("새 본문"));
        assert_eq!(d.frontmatter.updated.as_deref(), Some("2026-06-29"));
    }

    #[test]
    fn set_status_changes_and_bumps_updated() {
        let md = create_discussion_skeleton("t", "제목", "user", "2026-06-01");
        let out = set_status(&md, "resolved", "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Resolved);
        assert_eq!(d.frontmatter.updated.as_deref(), Some("2026-06-29"));
        // round-trip back to open
        let back = set_status(&out, "open", "2026-06-30");
        assert_eq!(parse_discussion(&back, "t").frontmatter.status, DiscussionStatus::Open);
    }

    #[test]
    fn set_title_changes_title_keeps_id() {
        let md = create_discussion_skeleton("t", "옛 제목", "user", "2026-06-01");
        let out = set_title(&md, "새 제목", "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert_eq!(d.frontmatter.title, "새 제목");
        assert_eq!(d.frontmatter.id, "t");
        assert_eq!(d.frontmatter.updated.as_deref(), Some("2026-06-29"));
    }

    #[test]
    fn set_status_inserts_when_missing() {
        let md = "---\nid: t\ntitle: \"x\"\n---\n## 문제 정의\n본문\n";
        let out = set_status(md, "archived", "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Archived);
        assert!(out.contains("본문")); // body preserved
    }

    #[test]
    fn no_frontmatter_set_status_is_noop() {
        let md = "## 문제 정의\n프론트매터 없음\n";
        assert_eq!(set_status(md, "resolved", "2026-06-29"), md);
    }

    #[test]
    fn set_resolution_links_plan_and_resolves() {
        let md = create_discussion_skeleton("t", "제목", "user", "2026-06-01");
        let out = set_resolution(&md, "my-plan", "2026-06-29T15:00:00+09:00", "2026-06-29");
        let d = parse_discussion(&out, "t");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Resolved);
        assert_eq!(d.frontmatter.resolution_plan_id.as_deref(), Some("my-plan"));
        assert_eq!(
            d.frontmatter.resolution_decided_at.as_deref(),
            Some("2026-06-29T15:00:00+09:00")
        );
        assert_eq!(d.frontmatter.updated.as_deref(), Some("2026-06-29"));
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    }

    #[test]
    fn set_resolution_replaces_existing_ref() {
        let md = create_discussion_skeleton("t", "제목", "user", "2026-06-01");
        let once = set_resolution(&md, "plan-a", "2026-06-29T10:00:00+09:00", "2026-06-29");
        let twice = set_resolution(&once, "plan-b", "2026-06-30T10:00:00+09:00", "2026-06-30");
        let d = parse_discussion(&twice, "t");
        assert_eq!(d.frontmatter.resolution_plan_id.as_deref(), Some("plan-b"));
        // exactly one resolution_ref block (no duplicate keys left behind)
        assert_eq!(twice.matches("resolution_ref:").count(), 1);
    }
}

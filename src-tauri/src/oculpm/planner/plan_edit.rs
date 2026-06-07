//! Pure markdown surgery for the Plan SSOT (PR-PLN 1 write path).
//!
//! All functions take the full markdown string and return a new one, preserving
//! everything they don't touch (the file is the source of truth — the app and
//! external agents edit the *same* document). No I/O here; the commands wrap
//! these with `atomic_io::write_atomic`. The plan-log managed block uses the
//! same `<!-- oculpm:plan-log … -->` markers the parser reads, so a write →
//! parse round-trip is lossless.

#![allow(dead_code)] // Consumed by commands/plan.rs.

use crate::oculpm::planner::parse::ItemStatus;

const LOG_BEGIN: &str = "<!-- oculpm:plan-log begin v1 -->";
const LOG_END: &str = "<!-- oculpm:plan-log end -->";
const LOG_HEADER: &str = "| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |";
const LOG_SEP: &str = "|---|---|---|---|---|---|";

/// Build a fresh empty plan document (frontmatter + empty plan-log block).
pub fn create_plan_skeleton(id: &str, title: &str, owner: &str, date: &str) -> String {
    format!(
        "---\noculpm_plan: v1\nid: {id}\ntitle: \"{title}\"\nstatus: active\ncreated: {date}\nupdated: {date}\nowner: {owner}\n---\n\n{LOG_BEGIN}\n{LOG_END}\n",
        id = id,
        title = escape_yaml(title),
        owner = owner,
        date = date,
    )
}

#[derive(Debug)]
pub struct SetStatusResult {
    pub md: String,
    pub old_status: ItemStatus,
}

/// Flip one item's status glyph in place. Errors if the `{#item_id}` line isn't
/// found. Returns the rewritten markdown + the previous status (for the log).
pub fn set_item_status(
    md: &str,
    item_id: &str,
    new: ItemStatus,
) -> Result<SetStatusResult, String> {
    let needle = format!("{{#{item_id}}}");
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let idx = lines
        .iter()
        .position(|l| is_item_line(l) && l.contains(&needle))
        .ok_or_else(|| format!("item '{item_id}' not found in plan"))?;

    let line = lines[idx].clone();
    let lb = line.find('[').ok_or("malformed item line: no '['")?;
    let rb = line[lb..]
        .find(']')
        .map(|r| lb + r)
        .ok_or("malformed item line: no ']'")?;
    let old_status = ItemStatus::from_token(&line[lb + 1..rb]).unwrap_or(ItemStatus::Todo);
    lines[idx] = format!("{}[{}]{}", &line[..lb], new.token(), &line[rb + 1..]);

    Ok(SetStatusResult {
        md: lines.join("\n"),
        old_status,
    })
}

/// Insert a new item under `phase` (creating the phase section if absent).
/// Errors if `item_id` already exists.
pub fn add_item(
    md: &str,
    phase: &str,
    title: &str,
    item_id: &str,
    status: ItemStatus,
) -> Result<String, String> {
    if md.contains(&format!("{{#{item_id}}}")) {
        return Err(format!("item id '{item_id}' already exists"));
    }
    let new_line = format!("- [{}] {} {{#{}}}", status.token(), title.trim(), item_id);
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();

    let phase_idx = lines.iter().position(|l| {
        l.trim_start()
            .strip_prefix("## ")
            .map(|h| h.trim() == phase.trim())
            .unwrap_or(false)
    });

    match phase_idx {
        Some(pi) => {
            // Insert at the end of the phase block — before the next heading or
            // the plan-log block, skipping back over trailing blank lines.
            let mut at = lines.len();
            for j in (pi + 1)..lines.len() {
                let t = lines[j].trim_start();
                if t.starts_with("## ")
                    || t.starts_with("### ")
                    || t.starts_with("<!-- oculpm:plan-log")
                {
                    at = j;
                    break;
                }
            }
            while at > pi + 1 && lines[at - 1].trim().is_empty() {
                at -= 1;
            }
            lines.insert(at, new_line);
        }
        None => {
            // New section, placed before the plan-log block (or at EOF).
            let pos = lines
                .iter()
                .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log begin"))
                .unwrap_or(lines.len());
            for (k, b) in [
                String::new(),
                format!("## {}", phase.trim()),
                new_line,
                String::new(),
            ]
            .into_iter()
            .enumerate()
            {
                lines.insert(pos + k, b);
            }
        }
    }
    Ok(lines.join("\n"))
}

/// One appended row of the attribution log.
pub struct LogRow {
    pub ts: String,
    pub item_id: String,
    pub agent_id: String,
    pub from: Option<ItemStatus>,
    pub to: Option<ItemStatus>,
    pub journal_ref: Option<String>,
    pub note: Option<String>,
}

/// Append a row to the plan-log managed block (creating the block + table
/// header if missing). Append-only — never rewrites existing rows.
pub fn append_log_row(md: &str, row: &LogRow) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let begin = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log begin"));
    let end = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log end"));

    match (begin, end) {
        (Some(b), Some(e)) if e > b => {
            let has_header = lines[b + 1..e].iter().any(|l| {
                let t = l.trim_start();
                t.starts_with('|') && (t.contains("시각") || t.contains("항목"))
            });
            if has_header {
                lines.insert(e, render_row(row));
            } else {
                lines.insert(e, render_row(row));
                lines.insert(e, LOG_SEP.to_string());
                lines.insert(e, LOG_HEADER.to_string());
            }
        }
        _ => {
            if lines.last().map(|l| !l.trim().is_empty()).unwrap_or(false) {
                lines.push(String::new());
            }
            lines.push(LOG_BEGIN.to_string());
            lines.push(LOG_HEADER.to_string());
            lines.push(LOG_SEP.to_string());
            lines.push(render_row(row));
            lines.push(LOG_END.to_string());
            lines.push(String::new());
        }
    }
    lines.join("\n")
}

// ── internals ───────────────────────────────────────────────────────────────

fn is_item_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("- [") || t.starts_with("* [")
}

fn render_row(r: &LogRow) -> String {
    let change = format!(
        "{}→{}",
        r.from.map(|s| s.log_symbol()).unwrap_or(""),
        r.to.map(|s| s.log_symbol()).unwrap_or("")
    );
    format!(
        "| {} | #{} | {} | {} | {} | {} |",
        r.ts,
        r.item_id,
        r.agent_id,
        change,
        r.journal_ref.as_deref().unwrap_or(""),
        r.note.as_deref().unwrap_or(""),
    )
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
    use crate::oculpm::planner::parse::parse_plan;

    #[test]
    fn skeleton_parses_clean() {
        let md = create_plan_skeleton("my-plan", "내 계획", "user", "2026-06-07");
        let p = parse_plan(&md, "my-plan");
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        assert_eq!(p.frontmatter.id, "my-plan");
        assert_eq!(p.frontmatter.title, "내 계획");
        assert_eq!(p.frontmatter.owner, "user");
        assert_eq!(p.items.len(), 0);
        assert_eq!(p.updates.len(), 0);
    }

    #[test]
    fn full_write_round_trip() {
        // skeleton → add two items → flip one → log each → parse back.
        let md = create_plan_skeleton("p", "계획", "user", "2026-06-07");

        let md = add_item(&md, "Phase A", "첫 항목", "one", ItemStatus::Todo).unwrap();
        let md = append_log_row(
            &md,
            &LogRow {
                ts: "2026-06-07T10:00:00Z".into(),
                item_id: "one".into(),
                agent_id: "user".into(),
                from: None,
                to: Some(ItemStatus::Todo),
                journal_ref: None,
                note: Some("created".into()),
            },
        );

        let md = add_item(&md, "Phase A", "둘째 항목", "two", ItemStatus::Todo).unwrap();

        // flip #one → done
        let res = set_item_status(&md, "one", ItemStatus::Done).unwrap();
        assert_eq!(res.old_status, ItemStatus::Todo);
        let md = append_log_row(
            &res.md,
            &LogRow {
                ts: "2026-06-07T11:00:00Z".into(),
                item_id: "one".into(),
                agent_id: "inapp:anthropic".into(),
                from: Some(ItemStatus::Todo),
                to: Some(ItemStatus::Done),
                journal_ref: Some("journal/x.md".into()),
                note: None,
            },
        );

        // Parse the final document back.
        let p = parse_plan(&md, "p");
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        assert_eq!(p.items.len(), 2);
        let one = p.items.iter().find(|i| i.item_id == "one").unwrap();
        assert_eq!(one.status, ItemStatus::Done);
        assert_eq!(one.phase.as_deref(), Some("Phase A"));
        let two = p.items.iter().find(|i| i.item_id == "two").unwrap();
        assert_eq!(two.status, ItemStatus::Todo);

        // both items under the same phase
        assert_eq!(one.phase, two.phase);

        // log: 2 rows, latest for #one is the done transition by inapp:anthropic
        let one_updates: Vec<_> = p.updates.iter().filter(|u| u.item_id == "one").collect();
        assert_eq!(one_updates.len(), 2);
        let last = one_updates.last().unwrap();
        assert_eq!(last.agent_id, "inapp:anthropic");
        assert_eq!(last.from_status.as_deref(), Some("todo"));
        assert_eq!(last.to_status.as_deref(), Some("done"));
        assert_eq!(last.journal_ref.as_deref(), Some("journal/x.md"));
    }

    #[test]
    fn set_status_missing_item_errors() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let err = set_item_status(&md, "ghost", ItemStatus::Done).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn add_item_duplicate_id_errors() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "P", "a", "dup", ItemStatus::Todo).unwrap();
        let err = add_item(&md, "P", "b", "dup", ItemStatus::Todo).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn add_item_new_phase_then_existing_phase() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase A", "a2", "a2", ItemStatus::Todo).unwrap();
        let p = parse_plan(&md, "p");
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        let a1 = p.items.iter().find(|i| i.item_id == "a1").unwrap();
        let a2 = p.items.iter().find(|i| i.item_id == "a2").unwrap();
        let b1 = p.items.iter().find(|i| i.item_id == "b1").unwrap();
        assert_eq!(a1.phase.as_deref(), Some("Phase A"));
        assert_eq!(a2.phase.as_deref(), Some("Phase A"));
        assert_eq!(b1.phase.as_deref(), Some("Phase B"));
    }

    #[test]
    fn preserves_unrelated_content() {
        let md = "---\nid: p\ntitle: \"t\"\n---\n## Phase A\n- [ ] keep me {#keep}\n\n사용자 메모: 보존되어야 함\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
        let res = set_item_status(md, "keep", ItemStatus::Done).unwrap();
        assert!(res.md.contains("사용자 메모: 보존되어야 함"));
        assert!(res.md.contains("- [x] keep me {#keep}"));
    }
}

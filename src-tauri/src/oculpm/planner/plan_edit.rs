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

/// Set the plan-level frontmatter `status:` (and bump `updated:`), preserving
/// everything else. Used by the 완료·잠금 flow (Planner #1). If the frontmatter
/// has no `status:` line it's inserted (after `title:` when present); a document
/// with no frontmatter fence is returned unchanged.
pub fn set_plan_status(md: &str, status: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let start = match lines.iter().position(|l| l.trim() == "---") {
        Some(s) => s,
        None => return md.to_string(),
    };
    let end = match lines[start + 1..].iter().position(|l| l.trim() == "---") {
        Some(e) => start + 1 + e,
        None => return md.to_string(),
    };

    let mut status_set = false;
    for line in lines.iter_mut().take(end).skip(start + 1) {
        let t = line.trim_start();
        if t.starts_with("status:") {
            *line = format!("status: {status}");
            status_set = true;
        } else if t.starts_with("updated:") {
            *line = format!("updated: {date}");
        }
    }
    if !status_set {
        let at = ((start + 1)..end)
            .find(|&i| lines[i].trim_start().starts_with("title:"))
            .map(|i| i + 1)
            .unwrap_or(start + 1);
        lines.insert(at, format!("status: {status}"));
    }
    lines.join("\n")
}

/// Set the plan-level frontmatter `title:` (and bump `updated:`), preserving
/// everything else (PR — plan rename). The plan `id` / filename are unchanged.
pub fn set_plan_title(md: &str, title: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let start = match lines.iter().position(|l| l.trim() == "---") {
        Some(s) => s,
        None => return md.to_string(),
    };
    let end = match lines[start + 1..].iter().position(|l| l.trim() == "---") {
        Some(e) => start + 1 + e,
        None => return md.to_string(),
    };
    let mut title_set = false;
    for line in lines.iter_mut().take(end).skip(start + 1) {
        let t = line.trim_start();
        if t.starts_with("title:") {
            *line = format!("title: \"{}\"", escape_yaml(title));
            title_set = true;
        } else if t.starts_with("updated:") {
            *line = format!("updated: {date}");
        }
    }
    if !title_set {
        let at = ((start + 1)..end)
            .find(|&i| lines[i].trim_start().starts_with("id:"))
            .map(|i| i + 1)
            .unwrap_or(start + 1);
        lines.insert(at, format!("title: \"{}\"", escape_yaml(title)));
    }
    lines.join("\n")
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

/// 3-depth (#plan-3depth) — 롤업 인지 상태 변경. 모든 제품 쓰기 경로(앱 UI ·
/// MCP `plan_update` · reconcile)가 이걸 쓴다:
/// - 대상이 **하위를 가진 부모**면 거부 — 부모 상태는 하위 롤업으로 파생된다
///   (phase 와 동일: 직접 설정할 수 있는 상태가 아니다).
/// - 대상이 **자식**이면 변경 후 부모 글리프를 롤업으로 함께 정규화한다 —
///   파일의 글리프와 파생값이 갈라지지 않게 (본문 글리프가 정답 원칙 유지).
pub fn set_item_status_rolled(
    md: &str,
    item_id: &str,
    new: ItemStatus,
) -> Result<SetStatusResult, String> {
    let parsed = crate::oculpm::planner::parse::parse_plan(md, "x");
    if parsed.items.iter().any(|i| i.parent_item.as_deref() == Some(item_id)) {
        return Err(format!(
            "'{item_id}' 는 하위 항목이 있는 부모입니다 — 상태는 하위 롤업으로 자동 계산됩니다. \
             하위 항목을 갱신하세요"
        ));
    }
    let parent_id = parsed
        .items
        .iter()
        .find(|i| i.item_id == item_id)
        .and_then(|i| i.parent_item.clone());
    let result = set_item_status(md, item_id, new)?;
    if let Some(parent_id) = parent_id {
        // 방어 — parent_id 는 *파싱된* id 라 dedup(`x`→`x-2`) 산물일 수 있고,
        // 그 경우 needle 이 유일하게 맞는 줄이 원래 `{#x-2}` 를 달고 있던
        // **방관자**일 수 있다. 원문에 중복 {#id} 가 하나라도 있으면 어느 줄이
        // 진짜 부모인지 원문만으로 확정할 수 없으니 정규화를 통째로 건너뛴다
        // (파생 상태는 파서가 계속 보장 — 파일 글리프만 잠시 낡는다).
        let mut seen_raw = std::collections::HashSet::new();
        let has_dup = result
            .md
            .split('\n')
            .filter(|l| is_item_line(l))
            .filter_map(raw_brace_id)
            .any(|id| !seen_raw.insert(id.to_string()));
        let needle = format!("{{#{parent_id}}}");
        let raw_hits = result
            .md
            .split('\n')
            .filter(|l| is_item_line(l) && l.contains(&needle))
            .count();
        if has_dup || raw_hits != 1 {
            return Ok(result);
        }
        let reparsed = crate::oculpm::planner::parse::parse_plan(&result.md, "x");
        let siblings: Vec<ItemStatus> = reparsed
            .items
            .iter()
            .filter(|i| i.parent_item.as_deref() == Some(parent_id.as_str()))
            .map(|i| i.status)
            .collect();
        let roll = crate::oculpm::planner::parse::rollup_status(&siblings);
        if let Ok(normalized) = set_item_status(&result.md, &parent_id, roll) {
            return Ok(SetStatusResult { md: normalized.md, old_status: result.old_status });
        }
    }
    Ok(result)
}

/// 항목 줄의 원문 `{#id}` 를 뽑는다 (파서의 dedup 이전 값).
fn raw_brace_id(line: &str) -> Option<&str> {
    let s = line.rfind("{#")?;
    let e = line[s..].find('}')? + s;
    Some(&line[s + 2..e])
}

/// Remove an item line (`{#item_id}`) entirely. Errors if not found. Other
/// content (the plan-log rows referencing it) is left as historical record.
pub fn remove_item(md: &str, item_id: &str) -> Result<String, String> {
    let needle = format!("{{#{item_id}}}");
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let idx = lines
        .iter()
        .position(|l| is_item_line(l) && l.contains(&needle))
        .ok_or_else(|| format!("item '{item_id}' not found in plan"))?;
    let was_toplevel = !lines[idx].starts_with(' ') && !lines[idx].starts_with('\t');
    lines.remove(idx);
    // 3-depth — 최상위 항목을 지우면 바로 아래 들여쓴 하위들이 *직전* 최상위
    // 항목에 위치상 입양돼 그 항목의 상태를 파생값으로 잠가버린다. 하위를
    // 최상위로 승격(들여쓰기 제거)해 내용을 보존하며 입양을 끊는다.
    if was_toplevel {
        let mut i = idx;
        while i < lines.len() {
            let l = &lines[i];
            let indented = l.starts_with(' ') || l.starts_with('\t');
            if indented && is_item_line(l) {
                lines[i] = l.trim_start().to_string();
                i += 1;
            } else {
                break;
            }
        }
    }
    Ok(lines.join("\n"))
}

/// Rename an item's title text in place, preserving its status glyph and
/// `{#item_id}` marker. Errors if the item isn't found.
pub fn rename_item(md: &str, item_id: &str, new_title: &str) -> Result<String, String> {
    let needle = format!("{{#{item_id}}}");
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let idx = lines
        .iter()
        .position(|l| is_item_line(l) && l.contains(&needle))
        .ok_or_else(|| format!("item '{item_id}' not found in plan"))?;
    let line = lines[idx].clone();
    let rb = line.find(']').ok_or("malformed item line: no ']'")?;
    let marker = line.find("{#").ok_or("malformed item line: no marker")?;
    // head = "<indent>- [x]", tail = "{#id}…"
    lines[idx] = format!("{} {} {}", &line[..=rb], new_title.trim(), &line[marker..]);
    Ok(lines.join("\n"))
}

// ── phase (`## ` heading) structural ops ─────────────────────────────────────

/// Derive a `## ` heading's display name the way the parser does (`{#id}`
/// removed, trimmed). Returns `None` for non-`## ` lines.
fn phase_heading_name(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("## ")?;
    let mut h = rest.trim().to_string();
    if let Some(start) = h.find("{#") {
        if let Some(end_rel) = h[start..].find('}') {
            h.replace_range(start..=start + end_rel, "");
        }
    }
    Some(h.trim().to_string())
}

/// The ` {#id}` marker of a `## ` heading, if any (so rename can keep a phase's
/// tracking id). Returns the bare `{#id}` token without the leading space.
fn phase_heading_marker(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("## ")?;
    let start = rest.find("{#")?;
    let end_rel = rest[start..].find('}')?;
    Some(rest[start..=start + end_rel].to_string())
}

/// A `## ` heading is a Decisions section header, not a phase (same heuristic
/// the parser uses) — these are never renamed/removed/reordered as phases.
fn is_decisions_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("결정") || lower.contains("decision")
}

/// Rename a phase heading (`## <old>` → `## <new>`), preserving any `{#id}`
/// marker and every item beneath it. Errors if the phase isn't found.
pub fn rename_phase(md: &str, old: &str, new: &str) -> Result<String, String> {
    let new = new.trim();
    if new.is_empty() {
        return Err("단계 이름을 입력하세요.".to_string());
    }
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let idx = lines
        .iter()
        .position(|l| phase_heading_name(l).as_deref() == Some(old.trim()))
        .ok_or_else(|| format!("phase '{old}' not found"))?;
    let suffix = phase_heading_marker(&lines[idx])
        .map(|m| format!(" {m}"))
        .unwrap_or_default();
    lines[idx] = format!("## {new}{suffix}");
    Ok(lines.join("\n"))
}

/// Remove a phase heading and everything under it up to the next `## ` heading
/// or the plan-log block (i.e. all of its items). Errors if not found.
pub fn remove_phase(md: &str, phase: &str) -> Result<String, String> {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let start = lines
        .iter()
        .position(|l| phase_heading_name(l).as_deref() == Some(phase.trim()))
        .ok_or_else(|| format!("phase '{phase}' not found"))?;
    let mut end = lines.len();
    for j in (start + 1)..lines.len() {
        let t = lines[j].trim_start();
        if t.starts_with("## ") || t.starts_with("<!-- oculpm:plan-log") {
            end = j;
            break;
        }
    }
    lines.drain(start..end);
    Ok(lines.join("\n"))
}

/// Reorder a phase among its sibling phases (`up = true` moves it earlier). The
/// Decisions section and the plan-log are not phases and never move; a swap at
/// the first/last position is a no-op (returns the input unchanged).
pub fn move_phase(md: &str, phase: &str, up: bool) -> Result<String, String> {
    let lines: Vec<String> = md.split('\n').map(String::from).collect();
    // Phases live before the Decisions section and the plan-log block; bound the
    // reorder region so neither gets dragged along.
    let log_idx = lines
        .iter()
        .position(|l| l.trim_start().starts_with("<!-- oculpm:plan-log begin"))
        .unwrap_or(lines.len());
    let dec_idx = lines
        .iter()
        .position(|l| phase_heading_name(l).map(|n| is_decisions_name(&n)).unwrap_or(false))
        .unwrap_or(lines.len());
    let region_end = log_idx.min(dec_idx);

    let heads: Vec<usize> = (0..region_end)
        .filter(|&i| phase_heading_name(&lines[i]).is_some())
        .collect();
    let pos = heads
        .iter()
        .position(|&i| phase_heading_name(&lines[i]).as_deref() == Some(phase.trim()))
        .ok_or_else(|| format!("phase '{phase}' not found"))?;
    let other = if up {
        if pos == 0 {
            return Ok(md.to_string());
        }
        pos - 1
    } else {
        if pos + 1 >= heads.len() {
            return Ok(md.to_string());
        }
        pos + 1
    };

    // Blocks are adjacent (a, a+1). Each spans its heading up to the next
    // heading (or the region boundary), so trailing blank lines move with it.
    let a = pos.min(other);
    let b = pos.max(other);
    let a_start = heads[a];
    let a_end = heads[a + 1];
    let b_start = heads[b];
    let b_end = heads.get(b + 1).copied().unwrap_or(region_end);

    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    out.extend_from_slice(&lines[..a_start]);
    out.extend_from_slice(&lines[b_start..b_end]);
    out.extend_from_slice(&lines[a_start..a_end]);
    out.extend_from_slice(&lines[b_end..]);
    Ok(out.join("\n"))
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
    fn set_plan_status_locks_and_bumps_updated() {
        use crate::oculpm::planner::parse::PlanStatus;
        let md = create_plan_skeleton("p", "계획", "user", "2026-06-01");
        let locked = set_plan_status(&md, "done", "2026-06-07");
        let p = parse_plan(&locked, "p");
        assert_eq!(p.frontmatter.status, PlanStatus::Done);
        assert_eq!(p.frontmatter.updated.as_deref(), Some("2026-06-07"));
        // round-trip back to active.
        let active = set_plan_status(&locked, "active", "2026-06-08");
        assert_eq!(parse_plan(&active, "p").frontmatter.status, PlanStatus::Active);
    }

    #[test]
    fn set_plan_status_inserts_when_missing() {
        let md = "---\nid: p\ntitle: \"t\"\n---\n## A\n- [ ] x {#x}\n";
        let out = set_plan_status(md, "done", "2026-06-07");
        let p = parse_plan(&out, "p");
        assert_eq!(p.frontmatter.status.as_str(), "done");
        assert!(out.contains("- [ ] x {#x}")); // body preserved
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

    #[test]
    fn set_plan_title_changes_title_and_bumps_updated() {
        let md = create_plan_skeleton("p", "옛 제목", "user", "2026-06-01");
        let out = set_plan_title(&md, "새 제목", "2026-06-15");
        let p = parse_plan(&out, "p");
        assert_eq!(p.frontmatter.title, "새 제목");
        assert_eq!(p.frontmatter.updated.as_deref(), Some("2026-06-15"));
    }

    #[test]
    fn remove_item_drops_the_line() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "P", "a", "a1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "P", "b", "b1", ItemStatus::Todo).unwrap();
        let out = remove_item(&md, "a1").unwrap();
        let p = parse_plan(&out, "p");
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].item_id, "b1");
        assert!(remove_item(&out, "ghost").is_err());
    }

    #[test]
    fn rename_item_keeps_status_and_marker() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "P", "옛 항목", "x", ItemStatus::Done).unwrap();
        let out = rename_item(&md, "x", "새 항목").unwrap();
        let p = parse_plan(&out, "p");
        let it = p.items.iter().find(|i| i.item_id == "x").unwrap();
        assert_eq!(it.title, "새 항목");
        assert_eq!(it.status, ItemStatus::Done);
    }

    #[test]
    fn rename_phase_keeps_items_and_id() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
        let out = rename_phase(&md, "Phase A", "Phase A — 캐시 안정화").unwrap();
        let p = parse_plan(&out, "p");
        assert!(p.phases.iter().any(|ph| ph.name == "Phase A — 캐시 안정화"));
        let a1 = p.items.iter().find(|i| i.item_id == "a1").unwrap();
        assert_eq!(a1.phase.as_deref(), Some("Phase A — 캐시 안정화"));
        // empty title + missing phase both error.
        assert!(rename_phase(&out, "Phase B", "  ").is_err());
        assert!(rename_phase(&out, "ghost", "x").is_err());
    }

    #[test]
    fn rename_phase_preserves_brace_id() {
        let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n## 옛 단계 {#ph1}\n- [ ] a {#a}\n";
        let out = rename_phase(md, "옛 단계", "새 단계").unwrap();
        assert!(out.contains("## 새 단계 {#ph1}"), "{out}");
        let p = parse_plan(&out, "p");
        let ph = p.phases.iter().find(|ph| ph.name == "새 단계").unwrap();
        assert_eq!(ph.id.as_deref(), Some("ph1"));
    }

    #[test]
    fn remove_phase_drops_heading_and_items() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
        let out = remove_phase(&md, "Phase A").unwrap();
        let p = parse_plan(&out, "p");
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        assert!(!p.phases.iter().any(|ph| ph.name == "Phase A"));
        assert!(p.phases.iter().any(|ph| ph.name == "Phase B"));
        assert!(p.items.iter().all(|i| i.item_id != "a1"));
        assert!(p.items.iter().any(|i| i.item_id == "b1"));
        assert!(remove_phase(&out, "ghost").is_err());
    }

    #[test]
    fn move_phase_swaps_adjacent_and_no_ops_at_edges() {
        let md = create_plan_skeleton("p", "t", "user", "2026-06-07");
        let md = add_item(&md, "Phase A", "a1", "a1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase B", "b1", "b1", ItemStatus::Todo).unwrap();
        let md = add_item(&md, "Phase C", "c1", "c1", ItemStatus::Todo).unwrap();

        let names = |m: &str| -> Vec<String> {
            parse_plan(m, "p").phases.into_iter().map(|p| p.name).collect()
        };

        let up = move_phase(&md, "Phase B", true).unwrap();
        assert_eq!(names(&up), vec!["Phase B", "Phase A", "Phase C"]);
        // items still belong to their (now reordered) phases.
        let p = parse_plan(&up, "p");
        assert_eq!(
            p.items.iter().find(|i| i.item_id == "a1").unwrap().phase.as_deref(),
            Some("Phase A")
        );

        let down = move_phase(&up, "Phase A", false).unwrap();
        assert_eq!(names(&down), vec!["Phase B", "Phase C", "Phase A"]);

        // boundary no-ops return the document unchanged.
        assert_eq!(move_phase(&down, "Phase B", true).unwrap(), down);
        assert_eq!(move_phase(&down, "Phase A", false).unwrap(), down);
        assert!(move_phase(&down, "ghost", true).is_err());
    }

    #[test]
    fn move_phase_leaves_decisions_in_place() {
        let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n## Phase A\n- [ ] a {#a}\n\n## Phase B\n- [ ] b {#b}\n\n## 결정 (Decisions)\n### Decision X {#dx}\n본문\n";
        let out = move_phase(md, "Phase B", false).unwrap(); // B is last phase → no-op
        assert_eq!(out, md);
        let up = move_phase(md, "Phase B", true).unwrap();
        let p = parse_plan(&up, "p");
        assert_eq!(
            p.phases.iter().map(|ph| ph.name.as_str()).collect::<Vec<_>>(),
            vec!["Phase B", "Phase A"]
        );
        // decisions survived intact.
        assert!(up.contains("## 결정 (Decisions)"));
        assert_eq!(p.decisions.len(), 1);
    }

    // ─── 3-depth (#plan-3depth) ─────────────────────────────────────────────

    const NESTED: &str = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [ ] 부모 {#parent}\n  - [ ] 하나 {#c1}\n  - [ ] 둘 {#c2}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";

    /// 자식 변경이 부모 글리프를 롤업으로 정규화한다 (파일과 파생값의 일치).
    #[test]
    fn rolled_set_normalizes_parent_glyph() {
        let r1 = set_item_status_rolled(NESTED, "c1", ItemStatus::Done).unwrap();
        assert!(r1.md.contains("- [~] 부모 {#parent}"), "{}", r1.md);
        let r2 = set_item_status_rolled(&r1.md, "c2", ItemStatus::Done).unwrap();
        assert!(r2.md.contains("- [x] 부모 {#parent}"), "{}", r2.md);
        assert!(r2.md.contains("  - [x] 하나 {#c1}"));
    }

    /// 리뷰 M1 — dedup 된 부모 id(`x`→`x-2`)로 정규화하면 원래 `{#x-2}` 를
    /// 달고 있던 방관자 항목을 덮어쓸 수 있다: 원문 항목 줄이 유일할 때만
    /// 정규화하고, 모호하면 건드리지 않는다 (파생값은 파서가 계속 보장).
    #[test]
    fn rolled_set_skips_normalization_on_ambiguous_parent_id() {
        let md = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [ ] one {#x}\n- [ ] two {#x}\n  - [ ] kid {#k}\n- [ ] bystander {#x-2}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
        let r = set_item_status_rolled(md, "k", ItemStatus::Done).unwrap();
        assert!(r.md.contains("- [ ] bystander {#x-2}"), "방관자 불가침: {}", r.md);
        assert!(r.md.contains("  - [x] kid {#k}"));
    }

    /// 리뷰 M2 — 최상위 부모 삭제 시 하위가 직전 항목에 위치상 입양돼 그
    /// 항목이 파생·잠금 상태가 되던 문제: 하위를 최상위로 승격해 보존한다.
    #[test]
    fn remove_parent_promotes_children_to_top_level() {
        let md = "---\noculpm_plan: v1\nid: n\ntitle: \"n\"\nstatus: active\n---\n\n## P {#p}\n- [x] prev {#prev}\n- [ ] gone {#gone}\n  - [ ] a {#a}\n  - [x] b {#b}\n\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n";
        let out = remove_item(md, "gone").unwrap();
        assert!(out.contains("\n- [ ] a {#a}"), "승격: {out}");
        assert!(out.contains("\n- [x] b {#b}"));
        let parsed = crate::oculpm::planner::parse::parse_plan(&out, "n");
        let prev = parsed.items.iter().find(|i| i.item_id == "prev").unwrap();
        assert_eq!(prev.status, ItemStatus::Done, "prev 가 입양으로 파생되면 안 됨");
    }

    /// 부모 직접 설정은 거부 — 상태는 하위 롤업으로만 움직인다 (phase 와 동일).
    #[test]
    fn rolled_set_rejects_parent_with_children() {
        let err = set_item_status_rolled(NESTED, "parent", ItemStatus::Done).unwrap_err();
        assert!(err.contains("하위"), "{err}");
        // 중첩 없는 항목은 종전과 동일하게 동작.
        let flat = NESTED.replace("  - [ ] 하나 {#c1}\n  - [ ] 둘 {#c2}\n", "");
        let ok = set_item_status_rolled(&flat, "parent", ItemStatus::Done).unwrap();
        assert!(ok.md.contains("- [x] 부모 {#parent}"));
    }
}

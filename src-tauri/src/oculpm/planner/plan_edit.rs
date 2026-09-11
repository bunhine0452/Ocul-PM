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

// 플랜 레벨 `status:` 를 쓰는 자리는 여기가 아니라 `planner/lifecycle.rs` 다.
// 그 전이에는 문지기가 붙는다 — 미완 항목이 남은 플랜은 `done` 으로 닫히지
// 않는다 (`v3-release` `{#done-transition-guard}`). 순수 수술 함수를 여기 두면
// 문지기를 지나지 않고 쓸 수 있으므로 통째로 옮겼다.

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
    if parsed
        .items
        .iter()
        .any(|i| i.parent_item.as_deref() == Some(item_id))
    {
        return Err(format!(
            "'{item_id}' is a parent with children - its status is rolled up automatically. \
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
            return Ok(SetStatusResult {
                md: normalized.md,
                old_status: result.old_status,
            });
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

/// 항목 줄(+ 들여쓴 하위)을 잘라 다른 자리에 붙인다 (감사 라운드 2026-09-11
/// E2 — `PlanEditOp` 에 `move_phase` 는 있었는데 `move_item` 이 없어 항목은
/// 만든 자리에 영영 묶였다).
///
/// - `before = Some(id)`: 그 항목 **바로 앞**에, 그 항목과 같은 들여쓰기로.
/// - `before = None`: `phase` 의 끝(다음 머리·plan-log 앞)에 최상위로.
///
/// 자기 자신 앞으로·자기 하위 앞으로는 거절한다. plan-log 는 건드리지 않는다.
pub fn move_item(
    md: &str,
    item_id: &str,
    phase: Option<&str>,
    before: Option<&str>,
) -> Result<String, String> {
    let needle = format!("{{#{item_id}}}");
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let idx = lines
        .iter()
        .position(|l| is_item_line(l) && l.contains(&needle))
        .ok_or_else(|| format!("item '{item_id}' not found in plan"))?;
    let indent_of = |l: &str| l.len() - l.trim_start().len();
    let own_indent = indent_of(&lines[idx]);
    // 블록 = 이 줄 + 더 깊이 들여쓴 연속 항목 줄.
    let mut end = idx + 1;
    while end < lines.len() && is_item_line(&lines[end]) && indent_of(&lines[end]) > own_indent {
        end += 1;
    }
    let block: Vec<String> = lines.drain(idx..end).collect();

    let (at, target_indent) = match before {
        Some(b) => {
            if b == item_id || block.iter().any(|l| l.contains(&format!("{{#{b}}}"))) {
                return Err("cannot move an item before itself or its own child".to_string());
            }
            let bn = format!("{{#{b}}}");
            let bi = lines
                .iter()
                .position(|l| is_item_line(l) && l.contains(&bn))
                .ok_or_else(|| format!("item '{b}' not found in plan"))?;
            (bi, indent_of(&lines[bi]))
        }
        None => {
            let ph = phase.ok_or("move_item needs a phase or a before-item")?;
            let pi = lines
                .iter()
                .position(|l| phase_heading_name(l).is_some_and(|n| n == ph.trim()))
                .ok_or_else(|| format!("phase '{ph}' not found in plan"))?;
            let mut at = lines.len();
            for (j, line) in lines.iter().enumerate().skip(pi + 1) {
                let t = line.trim_start();
                if t.starts_with("## ") || t.starts_with("<!-- oculpm:plan-log") {
                    at = j;
                    break;
                }
            }
            while at > pi + 1 && lines[at - 1].trim().is_empty() {
                at -= 1;
            }
            (at, 0)
        }
    };
    // 들여쓰기를 목적지에 맞춘다 — 블록 내부의 상대 깊이는 유지.
    let shifted: Vec<String> = block
        .iter()
        .map(|l| {
            let rel = indent_of(l) - own_indent;
            format!("{}{}", " ".repeat(target_indent + rel), l.trim_start())
        })
        .collect();
    for (k, l) in shifted.into_iter().enumerate() {
        lines.insert(at + k, l);
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
        return Err("Enter a phase name.".to_string());
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
    for (j, line) in lines.iter().enumerate().skip(start + 1) {
        let t = line.trim_start();
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
        .position(|l| {
            phase_heading_name(l)
                .map(|n| is_decisions_name(&n))
                .unwrap_or(false)
        })
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
            for (j, line) in lines.iter().enumerate().skip(pi + 1) {
                let t = line.trim_start();
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
    // 자유 텍스트 셀의 `|` 는 열 경계로 읽히므로 이스케이프한다 — 파서
    // (`parse::split_table_cells`) 가 `\|` 를 글자로 되돌린다. 줄바꿈은 행을
    // 깨뜨리므로 공백으로.
    let cell = |s: &str| s.replace('|', "\\|").replace(['\n', '\r'], " ");
    format!(
        "| {} | #{} | {} | {} | {} | {} |",
        r.ts,
        r.item_id,
        cell(&r.agent_id),
        change,
        cell(r.journal_ref.as_deref().unwrap_or("")),
        cell(r.note.as_deref().unwrap_or("")),
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
#[path = "plan_edit_tests.rs"]
mod tests;

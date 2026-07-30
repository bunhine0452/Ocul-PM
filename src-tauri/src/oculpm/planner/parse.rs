//! Fail-soft parser: Plan markdown SSOT → structured [`ParsedPlan`].
//!
//! Contract (mirrors `frontmatter.rs`):
//! - Any input parses without panic. Broken/missing fields produce warnings,
//!   never a hard error — the UI surfaces `warnings` so nothing fails silently
//!   (`00-master-plan.md` §6).
//! - The markdown is the source of truth. This parser is the only place that
//!   understands the on-disk format; the projection (`oculpm_plan*`) and UI
//!   consume `ParsedPlan` only.
//!
//! Format reference: `docs/planner-upgrade/01-data-model-and-markdown-spec.md` §2.

#![allow(dead_code)] // Fields/methods consumed by the projection + commands (PR-PLN 0 part 2/3).

use std::collections::{HashMap, HashSet};

use serde_yaml::Value as YamlValue;

use crate::oculpm::frontmatter::parse_frontmatter_and_body;

// ─────────────────────────────────────────────────────────────────────────────
// Status enums
// ─────────────────────────────────────────────────────────────────────────────

/// Plan-level lifecycle (frontmatter `status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanStatus {
    Active,
    Done,
    Archived,
}

impl PlanStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PlanStatus::Active => "active",
            PlanStatus::Done => "done",
            PlanStatus::Archived => "archived",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "active" => Some(PlanStatus::Active),
            "done" => Some(PlanStatus::Done),
            "archived" => Some(PlanStatus::Archived),
            _ => None,
        }
    }
}

/// Item status — the six-state vocabulary from the reference checklist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemStatus {
    Todo,
    InProgress,
    Done,
    Blocked,
    Deferred,
    Dropped,
}

impl ItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemStatus::Todo => "todo",
            ItemStatus::InProgress => "in_progress",
            ItemStatus::Done => "done",
            ItemStatus::Blocked => "blocked",
            ItemStatus::Deferred => "deferred",
            ItemStatus::Dropped => "dropped",
        }
    }

    /// Parse the content inside a markdown task box `[<tok>]`.
    /// `" "`/empty → Todo, `~` → InProgress, `x`/`X` → Done, `!` → Blocked,
    /// `>` → Deferred, `-` → Dropped.
    pub fn from_token(tok: &str) -> Option<Self> {
        match tok.trim() {
            "" => Some(ItemStatus::Todo),
            "x" | "X" => Some(ItemStatus::Done),
            "~" => Some(ItemStatus::InProgress),
            "!" => Some(ItemStatus::Blocked),
            ">" => Some(ItemStatus::Deferred),
            "-" => Some(ItemStatus::Dropped),
            _ => None,
        }
    }

    /// Accept a token OR a display glyph (used when parsing update-log change
    /// cells like `~→x` or `☐→☑`).
    fn from_any(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        // Bracketed task box, e.g. agents writing `→[ ]` in the change column.
        if let Some(inner) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            if let Some(st) = Self::from_token(inner) {
                return Some(st);
            }
        }
        if let Some(st) = Self::from_token(s) {
            return Some(st);
        }
        match s {
            "☐" => Some(ItemStatus::Todo),
            "▣" => Some(ItemStatus::InProgress),
            "☑" => Some(ItemStatus::Done),
            "⚠" => Some(ItemStatus::Blocked),
            "✗" => Some(ItemStatus::Dropped),
            _ => None,
        }
    }

    /// Weight for the progress rollup. `None` = excluded from the denominator
    /// (blocked/deferred/dropped don't count toward "how far along").
    pub fn weight(self) -> Option<f64> {
        match self {
            ItemStatus::Todo => Some(0.0),
            ItemStatus::InProgress => Some(0.5),
            ItemStatus::Done => Some(1.0),
            ItemStatus::Blocked | ItemStatus::Deferred | ItemStatus::Dropped => None,
        }
    }

    /// The markdown task-box token for this status (`[<token>]`).
    pub fn token(self) -> &'static str {
        match self {
            ItemStatus::Todo => " ",
            ItemStatus::InProgress => "~",
            ItemStatus::Done => "x",
            ItemStatus::Blocked => "!",
            ItemStatus::Deferred => ">",
            ItemStatus::Dropped => "-",
        }
    }

    /// Compact symbol for the update-log change column. Todo renders as `☐`
    /// (a bare space would be invisible in a table). Round-trips via `from_any`.
    pub fn log_symbol(self) -> &'static str {
        match self {
            ItemStatus::Todo => "☐",
            _ => self.token(),
        }
    }

    /// Parse a canonical status string — inverse of [`Self::as_str`].
    pub fn parse_status(s: &str) -> Option<Self> {
        match s.trim() {
            "todo" => Some(ItemStatus::Todo),
            "in_progress" => Some(ItemStatus::InProgress),
            "done" => Some(ItemStatus::Done),
            "blocked" => Some(ItemStatus::Blocked),
            "deferred" => Some(ItemStatus::Deferred),
            "dropped" => Some(ItemStatus::Dropped),
            _ => None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsed structures
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PlanFrontmatter {
    pub id: String,
    pub title: String,
    pub status: PlanStatus,
    pub owner: String,
    pub created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlanItem {
    pub item_id: String,
    pub phase: Option<String>,
    pub title: String,
    pub status: ItemStatus,
    pub order_idx: u32,
    pub parent_item: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlanDecision {
    pub decision_id: String,
    pub title: String,
    pub body: String,
    pub locked_at: Option<String>,
    pub agent_id: Option<String>,
    pub affects: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PlanItemUpdate {
    pub ts: String,
    pub item_id: String,
    pub agent_id: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub journal_ref: Option<String>,
    pub note: Option<String>,
}

/// A `## Phase` heading. Trackable when it carries its own `{#id}` (agents
/// reference it in the plan-log); otherwise it's a pure grouping (`id = None`).
#[derive(Debug, Clone)]
pub struct PlanPhase {
    pub id: Option<String>,
    pub name: String,
    pub order_idx: u32,
}

#[derive(Debug, Clone)]
pub struct ParsedPlan {
    pub frontmatter: PlanFrontmatter,
    pub items: Vec<PlanItem>,
    pub phases: Vec<PlanPhase>,
    pub decisions: Vec<PlanDecision>,
    pub updates: Vec<PlanItemUpdate>,
    pub warnings: Vec<String>,
}

impl ParsedPlan {
    /// Weighted progress (0..1) over countable items (todo/in_progress/done).
    /// Empty / all-excluded → 0.0. 3-depth: 부모 항목은 하위의 파생값이므로
    /// 리프만 센다 (부모까지 세면 하위가 이중 가중된다).
    /// 3-depth — 하위를 가진 항목 id 집합. 이 항목들의 상태·카운트는 파생값
    /// 이므로 모든 집계는 이 집합을 제외한 리프 기준이어야 한다 (진척 바와
    /// done/total 카운트가 갈라지는 것 방지).
    pub fn parent_ids(&self) -> HashSet<&str> {
        self.items.iter().filter_map(|i| i.parent_item.as_deref()).collect()
    }

    pub fn progress(&self) -> f64 {
        let parents = self.parent_ids();
        let mut sum = 0.0;
        let mut n = 0u32;
        for it in &self.items {
            if parents.contains(it.item_id.as_str()) {
                continue;
            }
            if let Some(w) = it.status.weight() {
                sum += w;
                n += 1;
            }
        }
        if n == 0 {
            0.0
        } else {
            sum / n as f64
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Parse a Plan markdown document. `fallback_id` (typically the file stem) is
/// used when frontmatter has no `id`.
pub fn parse_plan(markdown: &str, fallback_id: &str) -> ParsedPlan {
    let mut warnings: Vec<String> = Vec::new();

    // Reuse the journal frontmatter fence-splitter (generic). We ignore its
    // journal-shaped `parsed`/warnings and re-parse the raw YAML as a plan.
    let (pf, body) = parse_frontmatter_and_body(markdown);
    // Agents often wrap a long item across lines (the `{#id}` ending up on the
    // continuation). Fold those back into one line before parsing.
    let body = fold_wrapped_items(&body);
    let mut frontmatter = parse_plan_frontmatter(&pf.raw_yaml, fallback_id, &mut warnings);
    let mut first_h1: Option<String> = None;

    let mut items: Vec<PlanItem> = Vec::new();
    let mut phases: Vec<PlanPhase> = Vec::new();
    let mut phase_order: u32 = 0;
    let mut decisions: Vec<PlanDecision> = Vec::new();
    let mut updates: Vec<PlanItemUpdate> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    let mut section = Section::Phases;
    let mut cur_phase: Option<String> = None;
    let mut order: u32 = 0;
    let mut last_toplevel: Option<String> = None;

    let mut in_log = false;
    let mut cur_decision: Option<PlanDecision> = None;
    let mut decision_lines: Vec<String> = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim_start();

        // --- plan-log managed block ---
        if trimmed.starts_with("<!-- oculpm:plan-log begin") {
            in_log = true;
            continue;
        }
        if trimmed.starts_with("<!-- oculpm:plan-log end") {
            in_log = false;
            continue;
        }
        if in_log {
            if let Some(u) = parse_log_row(trimmed) {
                updates.push(u);
            }
            continue;
        }

        // --- headings ---
        if let Some(h) = trimmed.strip_prefix("## ") {
            flush_decision(&mut cur_decision, &mut decision_lines, &mut decisions);
            // Phase headings may carry their own {#id} (agents track phases too).
            // Keep the id (so plan-log refs resolve), drop it from the name.
            let mut h = h.trim().to_string();
            let phase_id = extract_brace_id(&mut h);
            let h = h.trim();
            if is_decisions_heading(h) {
                section = Section::Decisions;
                cur_phase = None;
            } else {
                section = Section::Phases;
                cur_phase = Some(h.to_string());
                phases.push(PlanPhase {
                    id: phase_id,
                    name: h.to_string(),
                    order_idx: phase_order,
                });
                phase_order += 1;
            }
            last_toplevel = None;
            continue;
        }
        if let Some(h) = trimmed.strip_prefix("### ") {
            if matches!(section, Section::Decisions) {
                flush_decision(&mut cur_decision, &mut decision_lines, &mut decisions);
                cur_decision = Some(parse_decision_header(h.trim(), &mut seen_ids, &mut warnings));
                decision_lines.clear();
            }
            // 3-depth — 서브 헤딩도 항목 흐름을 끊는다: 헤딩 너머의 들여쓴
            // 항목이 헤딩 앞 최상위 항목에 입양되지 않게.
            last_toplevel = None;
            continue;
        }
        // `# H1` — a document title many agents write instead of frontmatter.
        if let Some(h) = trimmed.strip_prefix("# ") {
            if first_h1.is_none() {
                first_h1 = Some(h.trim().to_string());
            }
            continue;
        }

        match section {
            Section::Phases => {
                if let Some(item) = parse_item_line(
                    line,
                    cur_phase.clone(),
                    &mut order,
                    &mut last_toplevel,
                    &mut seen_ids,
                    &mut warnings,
                ) {
                    items.push(item);
                }
            }
            Section::Decisions => {
                if cur_decision.is_some() {
                    decision_lines.push(line.to_string());
                }
            }
        }
    }
    flush_decision(&mut cur_decision, &mut decision_lines, &mut decisions);

    // Title fallback: frontmatter title → first `# H1` → id (warn only when
    // there's truly nothing to name the plan).
    if frontmatter.title.is_empty() {
        frontmatter.title = match first_h1 {
            Some(h1) => strip_plan_prefix(&h1),
            None => {
                warnings.push("plan title missing; using id".into());
                frontmatter.id.clone()
            }
        };
    }

    // 3-depth (#plan-3depth) — 하위가 있는 항목의 상태는 하위 롤업이 정답이다
    // (phase 규칙과 동일 정신). 파일의 부모 글리프가 낡아도 파생값이 이기고,
    // 쓰기 경로(`plan_edit::set_item_status_rolled`)가 글리프를 함께 정규화한다.
    let mut child_statuses: HashMap<String, Vec<ItemStatus>> = HashMap::new();
    for it in &items {
        if let Some(p) = &it.parent_item {
            child_statuses.entry(p.clone()).or_default().push(it.status);
        }
    }
    let mut items = items;
    for it in &mut items {
        if let Some(kids) = child_statuses.get(&it.item_id) {
            it.status = rollup_status(kids);
        }
    }

    ParsedPlan {
        frontmatter,
        items,
        phases,
        decisions,
        updates,
        warnings,
    }
}

/// 3-depth — 하위 상태들의 롤업. dropped 는 모수에서 제외(전부 dropped 면
/// Dropped), 하나라도 blocked 면 Blocked, 전부 done/todo/deferred 면 그 값,
/// 그 외 혼합은 InProgress.
pub fn rollup_status(children: &[ItemStatus]) -> ItemStatus {
    let live: Vec<ItemStatus> =
        children.iter().copied().filter(|s| *s != ItemStatus::Dropped).collect();
    if live.is_empty() {
        return ItemStatus::Dropped;
    }
    if live.contains(&ItemStatus::Blocked) {
        return ItemStatus::Blocked;
    }
    for uniform in [ItemStatus::Done, ItemStatus::Todo, ItemStatus::Deferred] {
        if live.iter().all(|s| *s == uniform) {
            return uniform;
        }
    }
    ItemStatus::InProgress
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

enum Section {
    Phases,
    Decisions,
}

/// Headings that open the `## 결정` section, matched as a **whole label**.
///
/// This used to be a substring test (`contains("결정") || contains("decision")`),
/// which swallowed any phase whose title merely mentioned the word: the real
/// plan heading `## Phase A — 기록의 결정론화 {#phase-a}` was classified as the
/// decisions section, so all 7 checklist items under it vanished from both the
/// Planner UI and the MCP `plan_status` (20 items on disk → 13 reported).
///
/// Anchoring the match inverts the failure mode. An unrecognised decisions
/// label now renders as a phase — visible, and the user can rename it —
/// instead of a phase silently eating its own items, which no UI can reveal.
const DECISIONS_HEADINGS: &[&str] = &[
    "결정",
    "결정사항",
    "결정 사항",
    "주요 결정",
    "결정 기록",
    "결정 로그",
    "decision",
    "decisions",
    "decision log",
    "decision records",
];

fn is_decisions_heading(h: &str) -> bool {
    // `## 결정 (Decisions)` is the form AGENTS.md §7 documents, so a trailing
    // parenthetical gloss is stripped before matching.
    let mut s = h.trim();
    if s.ends_with(')') || s.ends_with('）') {
        if let Some(open) = s.rfind(['(', '（']) {
            s = s[..open].trim_end();
        }
    }
    let norm = s
        .trim_end_matches([':', '.', '·', '—', '-'])
        .trim()
        .to_lowercase();
    DECISIONS_HEADINGS.contains(&norm.as_str())
}

/// Merge a wrapped item's continuation lines back into the item line, so a
/// `{#id}` that landed on the second line is still found. A continuation is an
/// indented, plain-text line directly under an item (not a new list item,
/// heading, table row, comment, or blockquote).
fn fold_wrapped_items(body: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut prev_was_item = false;
    for line in body.split('\n') {
        let trimmed = line.trim_start();
        let is_item = trimmed.starts_with("- [") || trimmed.starts_with("* [");
        let indented = line.starts_with(' ') || line.starts_with('\t');
        let is_continuation = prev_was_item
            && indented
            && !trimmed.is_empty()
            && !trimmed.starts_with("- ")
            && !trimmed.starts_with("* ")
            && !trimmed.starts_with('#')
            && !trimmed.starts_with('|')
            && !trimmed.starts_with("<!--")
            && !trimmed.starts_with('>');
        if is_continuation {
            if let Some(last) = out.last_mut() {
                last.push(' ');
                last.push_str(trimmed);
            }
            // prev_was_item stays true — more continuation lines may follow.
        } else {
            out.push(line.to_string());
            prev_was_item = is_item;
        }
    }
    out.join("\n")
}

/// Strip a leading "Plan — " / "계획: " style prefix from an `# H1` title.
fn strip_plan_prefix(h1: &str) -> String {
    let t = h1.trim();
    for p in ["Plan — ", "Plan – ", "Plan - ", "Plan: ", "계획 — ", "계획: ", "계획 - "] {
        if let Some(rest) = t.strip_prefix(p) {
            let rest = rest.trim();
            if !rest.is_empty() {
                return rest.to_string();
            }
        }
    }
    t.to_string()
}

fn parse_plan_frontmatter(
    raw_yaml: &str,
    fallback_id: &str,
    warnings: &mut Vec<String>,
) -> PlanFrontmatter {
    let value: Option<YamlValue> = serde_yaml::from_str(raw_yaml).ok();
    let map = value.as_ref().and_then(|v| v.as_mapping());
    let get = |k: &str| -> Option<String> {
        map.and_then(|m| m.get(YamlValue::String(k.to_string())))
            .and_then(yaml_scalar)
            .filter(|s| !s.trim().is_empty())
    };

    // `id` from the filename is a fine default (plans are usually named after
    // their id), so it's not a warning. `title` is resolved by the caller
    // (frontmatter → first `# H1` heading → id); leave it empty if absent here.
    let id = get("id").unwrap_or_else(|| fallback_id.to_string());
    let title = get("title").unwrap_or_default();
    let status = match get("status") {
        Some(s) => PlanStatus::parse(&s).unwrap_or_else(|| {
            warnings.push(format!("unknown plan status '{s}'; defaulting to active"));
            PlanStatus::Active
        }),
        None => PlanStatus::Active,
    };
    let owner = get("owner").unwrap_or_else(|| "unknown".into());

    PlanFrontmatter {
        id,
        title,
        status,
        owner,
        created: get("created"),
        updated: get("updated"),
    }
}

/// Parse one body line as a checklist item. Returns `None` for non-item lines
/// (plain text, blank, bullets without a `[ ]` box).
fn parse_item_line(
    line: &str,
    phase: Option<String>,
    order: &mut u32,
    last_toplevel: &mut Option<String>,
    seen_ids: &mut HashSet<String>,
    warnings: &mut Vec<String>,
) -> Option<PlanItem> {
    let t = line.trim_start();
    // 들여쓰기 판정 — 탭 1개도 중첩 의도로 본다 (문자 수로만 재면 `\t` 는
    // 1 < 2 라 새 최상위가 되고, 이어지는 2칸 항목들을 제 하위로 입양한다).
    let ws = &line[..line.len() - t.len()];
    let indent = if ws.contains('\t') { 2 } else { ws.len() };

    // List marker.
    let rest = t.strip_prefix("- ").or_else(|| t.strip_prefix("* "))?;
    let rest = rest.trim_start();

    // Task box `[<tok>]`.
    if !rest.starts_with('[') {
        return None;
    }
    let close = rest.find(']')?;
    let token = &rest[1..close];
    let status = ItemStatus::from_token(token).unwrap_or_else(|| {
        warnings.push(format!("unknown item glyph '[{token}]'; defaulting to todo"));
        ItemStatus::Todo
    });
    let mut content = rest[close + 1..].trim().to_string();

    // Extract {#id}.
    let explicit_id = extract_brace_id(&mut content);
    // Extract note (⟶ … or -> …).
    let note = extract_note(&mut content);
    // Strip a trailing @agent·date summary token (informational only).
    strip_trailing_attr(&mut content);

    let title = content.trim().to_string();

    let item_id = match explicit_id {
        Some(id) => dedup_id(id, seen_ids),
        None => {
            warnings.push(format!("item '{title}' has no {{#id}}; generated one"));
            let base = {
                let s = slugify(&title);
                if s.is_empty() {
                    format!("item-{}", *order)
                } else {
                    s
                }
            };
            dedup_id(base, seen_ids)
        }
    };

    let parent = if indent >= 2 {
        last_toplevel.clone()
    } else {
        *last_toplevel = Some(item_id.clone());
        None
    };

    let item = PlanItem {
        item_id,
        phase,
        title,
        status,
        order_idx: *order,
        parent_item: parent,
        note,
    };
    *order += 1;
    Some(item)
}

/// Parse a `### Decision A — title {#id}` header into a skeleton decision.
fn parse_decision_header(
    h: &str,
    seen_ids: &mut HashSet<String>,
    warnings: &mut Vec<String>,
) -> PlanDecision {
    let mut title = h.to_string();
    let explicit = extract_brace_id(&mut title);
    let title = title.trim().to_string();
    let decision_id = match explicit {
        Some(id) => dedup_id(id, seen_ids),
        None => {
            warnings.push(format!("decision '{title}' has no {{#id}}; generated one"));
            let base = {
                let s = slugify(&title);
                if s.is_empty() {
                    "decision".to_string()
                } else {
                    s
                }
            };
            dedup_id(base, seen_ids)
        }
    };
    PlanDecision {
        decision_id,
        title,
        body: String::new(),
        locked_at: None,
        agent_id: None,
        affects: Vec::new(),
    }
}

/// Finalize the in-progress decision: pull `잠금`/`영향` meta out of its body.
fn flush_decision(
    cur: &mut Option<PlanDecision>,
    lines: &mut Vec<String>,
    out: &mut Vec<PlanDecision>,
) {
    let Some(mut d) = cur.take() else {
        lines.clear();
        return;
    };
    let mut body_lines: Vec<String> = Vec::new();
    for raw in lines.drain(..) {
        let l = raw.trim();
        let stripped = l.trim_start_matches(['-', '*', ' ']);
        if let Some(rest) = stripped.strip_prefix("잠금") {
            // "잠금 2026-06-07 · claude-code"
            let rest = rest.trim();
            if let Some((date, agent)) = rest.split_once('·') {
                d.locked_at = non_empty(date.trim());
                d.agent_id = non_empty(agent.trim());
            } else {
                d.locked_at = non_empty(rest);
            }
            continue;
        }
        if let Some(rest) = stripped.strip_prefix("영향:") {
            for part in rest.split([',', ' ']) {
                let p = part.trim().trim_start_matches('#');
                if !p.is_empty() {
                    d.affects.push(p.to_string());
                }
            }
            continue;
        }
        body_lines.push(raw);
    }
    d.body = body_lines.join("\n").trim().to_string();
    out.push(d);
}

/// Parse one markdown table row inside the plan-log block.
/// `| ts | #item | agent | from→to | journal | note |`
fn parse_log_row(line: &str) -> Option<PlanItemUpdate> {
    let line = line.trim();
    if !line.starts_with('|') {
        return None;
    }
    let cells: Vec<String> = line
        .trim_matches('|')
        .split('|')
        .map(|c| c.trim().to_string())
        .collect();
    // Separator row (---|---).
    if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ':') && !c.is_empty()) {
        return None;
    }
    // Header row.
    let joined = cells.join(" ");
    if joined.contains("시각") || joined.contains("에이전트") || joined.to_lowercase().contains("agent")
    {
        return None;
    }
    if cells.len() < 3 {
        return None;
    }
    let ts = cells[0].clone();
    let item_id = cells[1].trim_start_matches('#').to_string();
    let agent_id = cells[2].clone();
    if ts.is_empty() && item_id.is_empty() {
        return None;
    }
    let (from_status, to_status) = cells
        .get(3)
        .map(|c| parse_change(c))
        .unwrap_or((None, None));
    let journal_ref = cells.get(4).and_then(|c| non_empty(c));
    let note = cells.get(5).and_then(|c| non_empty(c));

    Some(PlanItemUpdate {
        ts,
        item_id,
        agent_id,
        from_status,
        to_status,
        journal_ref,
        note,
    })
}

/// `~→x` / `☐→☑` / `->` → (from, to) canonical status strings (raw fallback).
fn parse_change(s: &str) -> (Option<String>, Option<String>) {
    let s = s.trim();
    if s.is_empty() {
        return (None, None);
    }
    let parts: Vec<&str> = if s.contains('→') {
        s.splitn(2, '→').collect()
    } else if s.contains("->") {
        s.splitn(2, "->").collect()
    } else {
        return (None, canon_status(s));
    };
    let from = parts.first().and_then(|p| canon_status(p));
    let to = parts.get(1).and_then(|p| canon_status(p));
    (from, to)
}

fn canon_status(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    match ItemStatus::from_any(s) {
        Some(st) => Some(st.as_str().to_string()),
        None => Some(s.to_string()),
    }
}

// ── small string helpers ────────────────────────────────────────────────────

/// Extract `{#id}` from `s` (removing it in place). Returns the id without `#`.
fn extract_brace_id(s: &mut String) -> Option<String> {
    let start = s.find("{#")?;
    let end_rel = s[start..].find('}')?;
    let end = start + end_rel;
    let id = s[start + 2..end].trim().to_string();
    s.replace_range(start..=end, "");
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

/// Extract a `⟶ reason` / `-> reason` note (removing it in place).
fn extract_note(s: &mut String) -> Option<String> {
    let marker = if let Some(i) = s.find('⟶') {
        Some((i, '⟶'.len_utf8()))
    } else {
        s.find("->").map(|i| (i, 2))
    };
    let (idx, len) = marker?;
    let note = s[idx + len..].trim().to_string();
    s.truncate(idx);
    non_empty(&note)
}

/// Strip a trailing whitespace-separated `@…` attribution token (no spaces).
fn strip_trailing_attr(s: &mut String) {
    // Compute the cut index in a scoped borrow so we can mutate `s` after.
    let cut = {
        let trimmed_end = s.trim_end();
        trimmed_end.rfind(" @").filter(|&at| {
            let tail = &trimmed_end[at + 2..];
            !tail.is_empty() && !tail.contains(char::is_whitespace)
        })
    };
    if let Some(at) = cut {
        s.truncate(at);
    }
}

fn dedup_id(base: String, seen: &mut HashSet<String>) -> String {
    if seen.insert(base.clone()) {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn yaml_scalar(v: &YamlValue) -> Option<String> {
    match v {
        YamlValue::String(s) => Some(s.clone()),
        YamlValue::Number(n) => Some(n.to_string()),
        YamlValue::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
oculpm_plan: v1
id: fastembed-stabilize
title: "fastembed 안정화"
status: active
created: 2026-06-07
updated: 2026-06-07T14:03:00+09:00
owner: claude-code
---

## Phase A — 캐시 경로 안정화

- [x] fastembed 캐시 절대경로 고정 {#abs-cache} @claude-code·6/7
- [~] 패키징 빌드에서 모델 시드 검증 {#seed-verify}
  - [ ] 다른 머신 첫 실행 검증 {#fresh-machine}
- [!] 첫 실행 465MB 다운로드 UX {#dl-ux} ⟶ 진행 UI 부재
- [>] 모델 번들링 {#bundle} ⟶ 이월: 배포 라운드

## Phase B — 검색 품질
- [ ] 심볼/정확 검색 scope 실연동 {#search-scopes}

## 결정 (Decisions)

### Decision A — 캐시는 app_data_dir 절대경로 {#d-cache-abs}
- 잠금 2026-06-07 · claude-code
- 패키징 .app 의 CWD=/ 라 상대 캐시가 깨짐.
- 영향: #abs-cache, #seed-verify

<!-- oculpm:plan-log begin v1 -->
| 시각(ISO) | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-07T14:03:00+09:00 | #abs-cache | claude-code | ~→x | journal/20260607/Bugs/0902_bug_onnx.md | 절대경로 |
| 2026-06-07T14:05:11+09:00 | #seed-verify | user | ☐→~ | | 검증 시작 |
<!-- oculpm:plan-log end -->
"#;

    #[test]
    fn parses_full_plan() {
        let p = parse_plan(SAMPLE, "from-filename");
        assert!(p.warnings.is_empty(), "warnings: {:?}", p.warnings);

        assert_eq!(p.frontmatter.id, "fastembed-stabilize");
        assert_eq!(p.frontmatter.title, "fastembed 안정화");
        assert_eq!(p.frontmatter.status, PlanStatus::Active);
        assert_eq!(p.frontmatter.owner, "claude-code");
        assert_eq!(p.frontmatter.created.as_deref(), Some("2026-06-07"));

        // 6 items total (incl. nested + Phase B).
        assert_eq!(p.items.len(), 6);

        let abs = &p.items[0];
        assert_eq!(abs.item_id, "abs-cache");
        assert_eq!(abs.status, ItemStatus::Done);
        assert_eq!(abs.title, "fastembed 캐시 절대경로 고정");
        assert_eq!(abs.phase.as_deref(), Some("Phase A — 캐시 경로 안정화"));
        assert!(abs.parent_item.is_none());

        let nested = p.items.iter().find(|i| i.item_id == "fresh-machine").unwrap();
        assert_eq!(nested.parent_item.as_deref(), Some("seed-verify"));

        let dl = p.items.iter().find(|i| i.item_id == "dl-ux").unwrap();
        assert_eq!(dl.status, ItemStatus::Blocked);
        assert_eq!(dl.note.as_deref(), Some("진행 UI 부재"));

        let bundle = p.items.iter().find(|i| i.item_id == "bundle").unwrap();
        assert_eq!(bundle.status, ItemStatus::Deferred);

        let searchscope = p.items.iter().find(|i| i.item_id == "search-scopes").unwrap();
        assert_eq!(searchscope.phase.as_deref(), Some("Phase B — 검색 품질"));
        assert_eq!(searchscope.status, ItemStatus::Todo);

        // Decision.
        assert_eq!(p.decisions.len(), 1);
        let d = &p.decisions[0];
        assert_eq!(d.decision_id, "d-cache-abs");
        assert!(d.title.starts_with("Decision A — 캐시는"));
        assert_eq!(d.locked_at.as_deref(), Some("2026-06-07"));
        assert_eq!(d.agent_id.as_deref(), Some("claude-code"));
        assert_eq!(d.affects, vec!["abs-cache", "seed-verify"]);
        assert!(d.body.contains("CWD"));

        // Update log.
        assert_eq!(p.updates.len(), 2);
        let u0 = &p.updates[0];
        assert_eq!(u0.item_id, "abs-cache");
        assert_eq!(u0.agent_id, "claude-code");
        assert_eq!(u0.from_status.as_deref(), Some("in_progress"));
        assert_eq!(u0.to_status.as_deref(), Some("done"));
        assert_eq!(u0.journal_ref.as_deref(), Some("journal/20260607/Bugs/0902_bug_onnx.md"));
        let u1 = &p.updates[1];
        assert_eq!(u1.agent_id, "user");
        assert_eq!(u1.from_status.as_deref(), Some("todo"));
        assert_eq!(u1.to_status.as_deref(), Some("in_progress"));
        assert!(u1.journal_ref.is_none());
    }

    #[test]
    fn progress_rollup_excludes_blocked_deferred_dropped() {
        let p = parse_plan(SAMPLE, "x");
        // 3-depth: seed-verify 는 부모(파생)라 제외 — 리프만 센다.
        // Countable leaves: abs-cache(done=1) fresh-machine(todo=0)
        // search-scopes(todo=0). dl-ux(blocked) + bundle(deferred) excluded.
        // (1 + 0 + 0) / 3 = 1/3
        assert!((p.progress() - 1.0 / 3.0).abs() < 1e-9, "got {}", p.progress());
    }

    /// 3-depth — 하위가 있는 부모의 상태는 롤업이 파일 글리프를 이긴다.
    /// SAMPLE 의 seed-verify 는 `[~]` 이지만 유일한 하위가 todo 라 Todo 로 파생.
    #[test]
    fn parent_status_is_rolled_up_from_children() {
        let p = parse_plan(SAMPLE, "x");
        let parent = p.items.iter().find(|i| i.item_id == "seed-verify").unwrap();
        assert_eq!(parent.status, ItemStatus::Todo, "글리프 [~] 보다 롤업(하위 todo)이 정답");
        let leaf = p.items.iter().find(|i| i.item_id == "fresh-machine").unwrap();
        assert_eq!(leaf.status, ItemStatus::Todo);
    }

    /// 리뷰 F7/L2 — 탭 들여쓰기도 중첩이고, `###` 헤딩은 입양을 끊는다.
    #[test]
    fn tab_indent_nests_and_subheading_breaks_adoption() {
        let md = "---\noculpm_plan: v1\nid: t\ntitle: \"t\"\nstatus: active\n---\n\n## P {#p}\n- [ ] a {#a}\n\t- [ ] tabbed {#tb}\n\n### 메모\n  - [ ] stray {#st}\n";
        let p = parse_plan(md, "t");
        let tb = p.items.iter().find(|i| i.item_id == "tb").unwrap();
        assert_eq!(tb.parent_item.as_deref(), Some("a"), "탭도 중첩");
        let st = p.items.iter().find(|i| i.item_id == "st").unwrap();
        assert_eq!(st.parent_item, None, "### 너머 입양 금지");
    }

    #[test]
    fn rollup_status_covers_the_vocabulary() {
        use ItemStatus::*;
        assert_eq!(rollup_status(&[Done, Done]), Done);
        assert_eq!(rollup_status(&[Todo, Todo]), Todo);
        assert_eq!(rollup_status(&[Done, Todo]), InProgress);
        assert_eq!(rollup_status(&[Done, InProgress]), InProgress);
        assert_eq!(rollup_status(&[Done, Blocked, Todo]), Blocked, "blocked 최우선");
        assert_eq!(rollup_status(&[Dropped, Dropped]), Dropped);
        assert_eq!(rollup_status(&[Done, Dropped]), Done, "dropped 는 모수 제외");
        assert_eq!(rollup_status(&[Deferred, Deferred]), Deferred);
    }

    #[test]
    fn phase_titled_with_the_word_decision_keeps_its_items() {
        // Regression (2026-07-30): `is_decisions_heading` was a substring test,
        // so this real heading from `.oculpm/planner/claude-integration.md`
        // opened the decisions section and silently dropped every item under
        // it — the plan reported 13 of its 20 items in the UI and in the MCP
        // `plan_status`, with nothing anywhere to indicate the loss.
        let md = "---\noculpm_plan: v1\nid: p\ntitle: \"t\"\nstatus: active\n---\n\
                  ## Phase A — 기록의 결정론화 {#phase-a}\n\
                  - [x] 훅 브리지 {#ci0}\n\
                  - [ ] 실기기 확인 {#ci0-verify}\n\
                  \n\
                  ## 결정 (Decisions)\n\
                  ### Decision A — 제목 {#d-a}\n\
                  - 잠금 2026-07-30 · claude-code\n";
        let p = parse_plan(md, "p");

        assert_eq!(p.items.len(), 2, "items: {:?}", p.items);
        assert!(p.items.iter().all(|i| i.phase.as_deref() == Some("Phase A — 기록의 결정론화")));
        // The genuine decisions heading still opens the decisions section.
        assert_eq!(p.decisions.len(), 1);
        assert_eq!(p.decisions[0].decision_id, "d-a");
        // ...and it must NOT have been registered as a phase.
        assert_eq!(p.phases.len(), 1);
        assert_eq!(p.phases[0].id.as_deref(), Some("phase-a"));
    }

    #[test]
    fn decisions_heading_variants_still_open_the_decisions_section() {
        for heading in ["## 결정", "## 결정사항", "## Decisions", "## 결정 (Decisions)"] {
            let md = format!(
                "---\noculpm_plan: v1\nid: p\ntitle: \"t\"\n---\n\
                 ## Phase A\n- [ ] a {{#a}}\n\n{heading}\n### D — t {{#d}}\n본문\n"
            );
            let p = parse_plan(&md, "p");
            assert_eq!(p.decisions.len(), 1, "heading {heading:?} → {:?}", p.decisions);
            assert_eq!(p.phases.len(), 1, "heading {heading:?} leaked into phases");
        }
    }

    #[test]
    fn missing_id_falls_back_to_filename_quietly() {
        let md = "---\noculpm_plan: v1\ntitle: \"무제\"\n---\n## P\n- [ ] 무언가\n";
        let p = parse_plan(md, "my-file");
        assert_eq!(p.frontmatter.id, "my-file");
        // filename id + present title → no frontmatter warnings.
        assert!(
            !p.warnings.iter().any(|w| w.contains("id missing") || w.contains("title missing")),
            "{:?}",
            p.warnings
        );
        // Item without {#id} → generated, warned.
        assert_eq!(p.items.len(), 1);
        assert!(p.warnings.iter().any(|w| w.contains("no {#id}")));
    }

    #[test]
    fn title_falls_back_to_h1_without_warning() {
        // No frontmatter at all — just an H1 + phase + item (the real-world
        // shape an external agent produced).
        let md = "# Plan — Lean Autonomous Adelie\n\n## Phase 0 — 안전망 {#p0}\n- [ ] 분기 {#b}\n";
        let p = parse_plan(md, "autonomy-refactor");
        assert_eq!(p.frontmatter.id, "autonomy-refactor"); // filename
        assert_eq!(p.frontmatter.title, "Lean Autonomous Adelie"); // H1, "Plan — " stripped
        // phase {#id} stripped from the display name
        assert_eq!(p.items[0].phase.as_deref(), Some("Phase 0 — 안전망"));
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    }

    #[test]
    fn wrapped_item_id_on_continuation_line_is_found() {
        let md = "# 테스트 계획\n\n## Phase 1\n- [ ] 긴 항목 설명 첫 줄\n      (둘째 줄 계속) {#wrap-id}\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].item_id, "wrap-id");
        assert!(p.items[0].title.contains("둘째 줄 계속"));
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
    }

    #[test]
    fn change_column_accepts_bracketed_glyphs() {
        // Agents writing `→[ ]` (created as todo) in the plan-log change cell.
        let md = "## P\n- [ ] x {#x}\n\n<!-- oculpm:plan-log begin v1 -->\n| ts | item | agent | change | journal | note |\n|---|---|---|---|---|---|\n| 2026-06-07T10:00:00+09:00 | #x | claude-code | →[ ] | | created |\n<!-- oculpm:plan-log end -->\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.updates.len(), 1);
        assert_eq!(p.updates[0].to_status.as_deref(), Some("todo"));
    }

    #[test]
    fn phase_ids_are_captured_for_tracking() {
        let md = "# T\n## Phase 0 — 안전망 {#p0}\n- [x] a {#a}\n## Phase 1 {#p1}\n- [ ] b {#b}\n## Phase A\n- [ ] c {#c}\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.phases.len(), 3);
        assert_eq!(p.phases[0].id.as_deref(), Some("p0"));
        assert_eq!(p.phases[0].name, "Phase 0 — 안전망");
        assert_eq!(p.phases[1].id.as_deref(), Some("p1"));
        // phase without {#id} → grouping only
        assert!(p.phases[2].id.is_none());
        assert_eq!(p.phases[2].name, "Phase A");
        // items still group by phase name
        assert_eq!(p.items[0].phase.as_deref(), Some("Phase 0 — 안전망"));
    }

    #[test]
    fn unknown_glyph_defaults_todo_with_warning() {
        let md = "---\nid: x\n---\n## P\n- [?] 이상한 글리프 {#weird}\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.items[0].status, ItemStatus::Todo);
        assert!(p.warnings.iter().any(|w| w.contains("unknown item glyph")));
    }

    #[test]
    fn no_frontmatter_is_fail_soft() {
        let md = "## Phase A\n- [x] 일했음 {#did}\n";
        let p = parse_plan(md, "stem");
        assert_eq!(p.frontmatter.id, "stem");
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].status, ItemStatus::Done);
    }

    #[test]
    fn plain_bullets_are_not_items() {
        let md = "---\nid: x\n---\n## P\n- 그냥 텍스트 (체크박스 없음)\n- [x] 진짜 항목 {#real}\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].item_id, "real");
    }

    #[test]
    fn duplicate_ids_are_deduped() {
        let md = "---\nid: x\n---\n## P\n- [ ] a {#dup}\n- [ ] b {#dup}\n";
        let p = parse_plan(md, "x");
        assert_eq!(p.items[0].item_id, "dup");
        assert_eq!(p.items[1].item_id, "dup-2");
    }

    #[test]
    fn empty_plan_progress_is_zero() {
        let p = parse_plan("---\nid: x\n---\n", "x");
        assert_eq!(p.items.len(), 0);
        assert_eq!(p.progress(), 0.0);
    }

    #[test]
    fn fuzz_random_bytes_never_panic() {
        let mut state: u64 = 0x0123_4567_89ab_cdef;
        for _ in 0..256 {
            let mut buf = Vec::with_capacity(1024);
            for _ in 0..1024 {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                buf.push((state >> 33) as u8);
            }
            let s = String::from_utf8_lossy(&buf);
            let _ = parse_plan(&s, "fuzz");
        }
    }
}

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

    /// Weight for the progress rollup. `None` = excluded from the denominator (deferred/dropped left
    /// the plan). blocked 는 남은 미완(lifecycle.rs)이라 0 으로 **센다** — 빼면 막힌 계획이 100% 로 찍힌다.
    pub fn weight(self) -> Option<f64> {
        match self {
            ItemStatus::Todo | ItemStatus::Blocked => Some(0.0),
            ItemStatus::InProgress => Some(0.5),
            ItemStatus::Done => Some(1.0),
            ItemStatus::Deferred | ItemStatus::Dropped => None,
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
        self.items
            .iter()
            .filter_map(|i| i.parent_item.as_deref())
            .collect()
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
                cur_decision = Some(parse_decision_header(
                    h.trim(),
                    &mut seen_ids,
                    &mut warnings,
                ));
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
    let live: Vec<ItemStatus> = children
        .iter()
        .copied()
        .filter(|s| *s != ItemStatus::Dropped)
        .collect();
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
    for p in [
        "Plan — ",
        "Plan – ",
        "Plan - ",
        "Plan: ",
        "계획 — ",
        "계획: ",
        "계획 - ",
    ] {
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
        warnings.push(format!(
            "unknown item glyph '[{token}]'; defaulting to todo"
        ));
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
pub(crate) fn parse_log_row(line: &str) -> Option<PlanItemUpdate> {
    let line = line.trim();
    if !line.starts_with('|') {
        return None;
    }
    let cells = split_table_cells(line);
    // Separator row (---|---).
    if cells
        .iter()
        .all(|c| c.chars().all(|ch| ch == '-' || ch == ':') && !c.is_empty())
    {
        return None;
    }
    // Header row — the first cell is a label (`시각` / `ts`), never a timestamp.
    //
    // 예전 판정은 셀을 합친 문자열에 `agent`·`시각`·`에이전트` 가 있으면 헤더로
    // 봤다. 일지 경로(`…agent-discipline…`)·메모("agent-client-protocol",
    // "시각 보정") 에 그 낱말이 흔해 이 저장소에서만 데이터 행 22개가
    // 항목 이력·귀속에서 조용히 사라졌다 (2026-08-30 감사). 데이터 행은 항상
    // ISO 시각으로 시작하므로 첫 셀의 첫 글자가 숫자인지로 가른다.
    if !cells
        .first()
        .and_then(|c| c.chars().next())
        .is_some_and(|ch| ch.is_ascii_digit())
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

/// Split a markdown table row into trimmed cells, honouring `\|` as a literal
/// pipe (what `plan_edit::render_row` writes when a note contains `|`).
/// A bare split would shift every column after the first pipe in a note.
fn split_table_cells(line: &str) -> Vec<String> {
    let inner = line.trim_matches('|');
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut chars = inner.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' if chars.peek() == Some(&'|') => {
                cur.push('|');
                chars.next();
            }
            '|' => cells.push(std::mem::take(&mut cur).trim().to_string()),
            _ => cur.push(ch),
        }
    }
    cells.push(cur.trim().to_string());
    cells
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
#[path = "parse_tests.rs"]
mod tests;

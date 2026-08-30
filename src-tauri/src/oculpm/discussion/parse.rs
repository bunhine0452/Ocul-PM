//! Fail-soft parser: Discussion markdown SSOT → structured [`ParsedDiscussion`].
//!
//! Contract (mirrors `planner::parse`):
//! - Any input parses without panic. Broken/missing fields produce warnings,
//!   never a hard error — the UI surfaces `warnings` so nothing fails silently.
//! - The markdown is the source of truth. This parser is the only place that
//!   understands the on-disk format; the projection (`oculpm_discussion*`) and
//!   UI consume `ParsedDiscussion` only.
//!
//! Format reference: `docs/discussion-feature/01-data-model-and-markdown-spec.md` §2.

#![allow(dead_code)] // Fields consumed by the projection + commands (PR-DISC 0/1/4).

use std::collections::HashSet;

use serde_yaml::Value as YamlValue;

use crate::oculpm::frontmatter::parse_frontmatter_and_body;

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/// Discussion-level lifecycle (frontmatter `status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscussionStatus {
    Open,
    Resolved,
    Archived,
}

impl DiscussionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            DiscussionStatus::Open => "open",
            DiscussionStatus::Resolved => "resolved",
            DiscussionStatus::Archived => "archived",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "open" => Some(DiscussionStatus::Open),
            "resolved" => Some(DiscussionStatus::Resolved),
            "archived" => Some(DiscussionStatus::Archived),
            _ => None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsed structures
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct DiscussionFrontmatter {
    pub id: String,
    pub title: String,
    pub status: DiscussionStatus,
    pub owner: String,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub tags: Vec<String>,
    pub resolution_plan_id: Option<String>,
    pub resolution_decided_at: Option<String>,
}

/// A `### title {#id}` candidate solution under "## 후보 해결 방안".
#[derive(Debug, Clone)]
pub struct DiscussionOption {
    pub option_id: String,
    pub title: String,
    pub body: String,
    pub order_idx: u32,
}

/// One row of the discussion-log managed block.
#[derive(Debug, Clone)]
pub struct DiscussionLogEntry {
    pub ts: String,
    pub author: String,
    pub body: String,
}

/// A `- [ ] title {#id}` item under "## 다음 단계" — becomes a plan item on
/// promotion (PR-DISC 4).
#[derive(Debug, Clone)]
pub struct DiscussionNextStep {
    pub step_id: String,
    pub title: String,
    pub done: bool,
    pub order_idx: u32,
}

#[derive(Debug, Clone)]
pub struct ParsedDiscussion {
    pub frontmatter: DiscussionFrontmatter,
    pub problem: String,
    pub background: String,
    pub options: Vec<DiscussionOption>,
    pub log: Vec<DiscussionLogEntry>,
    pub conclusion: String,
    pub next_steps: Vec<DiscussionNextStep>,
    pub warnings: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Parse a Discussion markdown document. `fallback_id` (typically the folder
/// name) is used when frontmatter has no `id`.
pub fn parse_discussion(markdown: &str, fallback_id: &str) -> ParsedDiscussion {
    let mut warnings: Vec<String> = Vec::new();

    let (pf, body) = parse_frontmatter_and_body(markdown);
    // Agents often wrap a long next-step across lines (the `{#id}` ending up on
    // the continuation). Fold those back into one line before parsing.
    let body = fold_wrapped_items(&body);
    let mut frontmatter = parse_discussion_frontmatter(&pf.raw_yaml, fallback_id, &mut warnings);
    let mut first_h1: Option<String> = None;

    let mut problem_lines: Vec<String> = Vec::new();
    let mut background_lines: Vec<String> = Vec::new();
    let mut conclusion_lines: Vec<String> = Vec::new();
    let mut options: Vec<DiscussionOption> = Vec::new();
    let mut next_steps: Vec<DiscussionNextStep> = Vec::new();
    let mut log: Vec<DiscussionLogEntry> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    let mut section = Section::None;
    let mut in_log = false;
    let mut opt_order: u32 = 0;
    let mut step_order: u32 = 0;
    let mut cur_option: Option<DiscussionOption> = None;
    let mut option_body_lines: Vec<String> = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim_start();

        // --- discussion-log managed block (global, like plan-log) ---
        if trimmed.starts_with("<!-- oculpm:discussion-log begin") {
            in_log = true;
            continue;
        }
        if trimmed.starts_with("<!-- oculpm:discussion-log end") {
            in_log = false;
            continue;
        }
        if in_log {
            if let Some(e) = parse_log_row(trimmed) {
                log.push(e);
            }
            continue;
        }

        // --- `## ` section heading ---
        if let Some(h) = trimmed.strip_prefix("## ") {
            flush_option(&mut cur_option, &mut option_body_lines, &mut options);
            section = section_of(h.trim());
            continue;
        }
        // --- `### ` option heading (only inside the options section) ---
        if let Some(h) = trimmed.strip_prefix("### ") {
            if matches!(section, Section::Options) {
                flush_option(&mut cur_option, &mut option_body_lines, &mut options);
                cur_option = Some(parse_option_header(
                    h.trim(),
                    &mut opt_order,
                    &mut seen_ids,
                    &mut warnings,
                ));
                option_body_lines.clear();
            }
            continue;
        }
        // --- `# H1` — a document title some agents write instead of frontmatter ---
        if let Some(h) = trimmed.strip_prefix("# ") {
            if first_h1.is_none() {
                first_h1 = Some(h.trim().to_string());
            }
            continue;
        }

        match section {
            Section::Problem => problem_lines.push(line.to_string()),
            Section::Background => background_lines.push(line.to_string()),
            Section::Conclusion => conclusion_lines.push(line.to_string()),
            Section::Options => {
                if cur_option.is_some() {
                    option_body_lines.push(line.to_string());
                }
            }
            Section::NextSteps => {
                if let Some(s) =
                    parse_next_step_line(line, &mut step_order, &mut seen_ids, &mut warnings)
                {
                    next_steps.push(s);
                }
            }
            // Free-text outside the managed block in the log section, or text
            // under an unrecognized heading — not projected.
            Section::Log | Section::None => {}
        }
    }
    flush_option(&mut cur_option, &mut option_body_lines, &mut options);

    // Title fallback: frontmatter → first `# H1` → id.
    if frontmatter.title.is_empty() {
        frontmatter.title = match first_h1 {
            Some(h1) => h1,
            None => {
                warnings.push("discussion title missing; using id".into());
                frontmatter.id.clone()
            }
        };
    }

    ParsedDiscussion {
        frontmatter,
        problem: join_trimmed(&problem_lines),
        background: join_trimmed(&background_lines),
        options,
        log,
        conclusion: join_trimmed(&conclusion_lines),
        next_steps,
        warnings,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum Section {
    None,
    Problem,
    Background,
    Options,
    Log,
    Conclusion,
    NextSteps,
}

/// Map a `## ` heading to its section kind (Korean + English keywords).
fn section_of(h: &str) -> Section {
    let lower = h.to_lowercase();
    if h.contains("문제") || lower.contains("problem") {
        Section::Problem
    } else if h.contains("배경")
        || h.contains("조사")
        || h.contains("자료")
        || lower.contains("background")
        || lower.contains("research")
    {
        Section::Background
    } else if h.contains("방안")
        || h.contains("후보")
        || lower.contains("option")
        || lower.contains("solution")
    {
        Section::Options
    } else if h.contains("토의")
        || h.contains("메모")
        || lower.contains("discussion")
        || lower.contains("memo")
        || lower.contains("log")
    {
        Section::Log
    } else if h.contains("결론") || lower.contains("conclusion") {
        Section::Conclusion
    } else if h.contains("다음") || lower.contains("next") {
        Section::NextSteps
    } else {
        Section::None
    }
}

/// Parse a `### title {#id}` option header into a skeleton option.
fn parse_option_header(
    h: &str,
    order: &mut u32,
    seen_ids: &mut HashSet<String>,
    warnings: &mut Vec<String>,
) -> DiscussionOption {
    let mut title = h.to_string();
    let explicit = extract_brace_id(&mut title);
    let title = title.trim().to_string();
    let option_id = match explicit {
        Some(id) => dedup_id(id, seen_ids),
        None => {
            warnings.push(format!("option '{title}' has no {{#id}}; generated one"));
            let base = {
                let s = slugify(&title);
                if s.is_empty() {
                    format!("opt-{}", *order)
                } else {
                    s
                }
            };
            dedup_id(base, seen_ids)
        }
    };
    let opt = DiscussionOption {
        option_id,
        title,
        body: String::new(),
        order_idx: *order,
    };
    *order += 1;
    opt
}

fn flush_option(
    cur: &mut Option<DiscussionOption>,
    body_lines: &mut Vec<String>,
    out: &mut Vec<DiscussionOption>,
) {
    if let Some(mut opt) = cur.take() {
        opt.body = join_trimmed(body_lines);
        out.push(opt);
    }
    body_lines.clear();
}

/// Parse one body line as a `- [ ]` / `- [x]` next-step. Returns `None` for
/// non-item lines.
fn parse_next_step_line(
    line: &str,
    order: &mut u32,
    seen_ids: &mut HashSet<String>,
    warnings: &mut Vec<String>,
) -> Option<DiscussionNextStep> {
    let t = line.trim_start();
    let rest = t.strip_prefix("- ").or_else(|| t.strip_prefix("* "))?;
    let rest = rest.trim_start();
    if !rest.starts_with('[') {
        return None;
    }
    let close = rest.find(']')?;
    let token = rest[1..close].trim();
    let done = matches!(token, "x" | "X");
    let mut content = rest[close + 1..].trim().to_string();
    let explicit_id = extract_brace_id(&mut content);
    let title = content.trim().to_string();
    let step_id = match explicit_id {
        Some(id) => dedup_id(id, seen_ids),
        None => {
            warnings.push(format!("next step '{title}' has no {{#id}}; generated one"));
            let base = {
                let s = slugify(&title);
                if s.is_empty() {
                    format!("next-{}", *order)
                } else {
                    s
                }
            };
            dedup_id(base, seen_ids)
        }
    };
    let step = DiscussionNextStep {
        step_id,
        title,
        done,
        order_idx: *order,
    };
    *order += 1;
    Some(step)
}

/// Parse one markdown table row inside the discussion-log block.
/// `| ts | author | body |`
fn parse_log_row(line: &str) -> Option<DiscussionLogEntry> {
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
    if cells
        .iter()
        .all(|c| c.chars().all(|ch| ch == '-' || ch == ':') && !c.is_empty())
    {
        return None;
    }
    // Header row.
    let joined = cells.join(" ");
    let lower = joined.to_lowercase();
    if joined.contains("시각")
        || joined.contains("작성자")
        || joined.contains("내용")
        || lower.contains("author")
    {
        return None;
    }
    if cells.len() < 3 {
        return None;
    }
    let ts = cells[0].clone();
    let author = cells[1].clone();
    let body = cells[2].clone();
    if ts.is_empty() && body.is_empty() {
        return None;
    }
    Some(DiscussionLogEntry { ts, author, body })
}

fn parse_discussion_frontmatter(
    raw_yaml: &str,
    fallback_id: &str,
    warnings: &mut Vec<String>,
) -> DiscussionFrontmatter {
    let value: Option<YamlValue> = serde_yaml::from_str(raw_yaml).ok();
    let map = value.as_ref().and_then(|v| v.as_mapping());
    let get = |k: &str| -> Option<String> {
        map.and_then(|m| m.get(YamlValue::String(k.to_string())))
            .and_then(yaml_scalar)
            .filter(|s| !s.trim().is_empty())
    };

    let id = get("id").unwrap_or_else(|| fallback_id.to_string());
    let title = get("title").unwrap_or_default();
    let status = match get("status") {
        Some(s) => DiscussionStatus::parse(&s).unwrap_or_else(|| {
            warnings.push(format!(
                "unknown discussion status '{s}'; defaulting to open"
            ));
            DiscussionStatus::Open
        }),
        None => DiscussionStatus::Open,
    };
    let owner = get("owner").unwrap_or_else(|| "unknown".into());

    let tags = map
        .and_then(|m| m.get(YamlValue::String("tags".into())))
        .and_then(|v| v.as_sequence())
        .map(|seq| seq.iter().filter_map(yaml_scalar).collect())
        .unwrap_or_default();

    let (resolution_plan_id, resolution_decided_at) = map
        .and_then(|m| m.get(YamlValue::String("resolution_ref".into())))
        .and_then(|v| v.as_mapping())
        .map(|rm| {
            let g = |k: &str| {
                rm.get(YamlValue::String(k.to_string()))
                    .and_then(yaml_scalar)
                    .filter(|s| !s.trim().is_empty())
            };
            (g("plan_id"), g("decided_at"))
        })
        .unwrap_or((None, None));

    DiscussionFrontmatter {
        id,
        title,
        status,
        owner,
        created: get("created"),
        updated: get("updated"),
        tags,
        resolution_plan_id,
        resolution_decided_at,
    }
}

// ── small string helpers (shared shape with planner::parse) ───────────────────

/// Merge a wrapped item's continuation lines back into the item line, so a
/// `{#id}` that landed on the second line is still found.
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
        } else {
            out.push(line.to_string());
            prev_was_item = is_item;
        }
    }
    out.join("\n")
}

/// Join section lines, trimming leading/trailing blank lines.
fn join_trimmed(lines: &[String]) -> String {
    lines.join("\n").trim().to_string()
}

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
oculpm_discussion: v1
id: onnx-cache-strategy
title: "onnx 모델 캐시 전략 결정"
status: open
created: 2026-06-29
updated: 2026-06-29T14:03:00+09:00
owner: user
tags: ["fastembed", "packaging"]
---

## 문제 정의

패키징된 .app 의 CWD 가 / 라서 fastembed 의 상대 캐시 경로가 깨진다.
어디에 캐시를 고정할지 결정 필요.

## 배경 / 조사 자료

- 코드: src-tauri/src/embedding.rs:42
- 외부: https://example.com/fastembed

## 후보 해결 방안

### 방안 A — app_data_dir 절대경로 {#opt-app-data}
- 장점: CWD 무관, 영속적
- 단점: 첫 실행 다운로드는 여전

### 방안 B — 모델 번들 동봉 {#opt-bundle}
- 장점: 오프라인 즉시 동작
- 단점: 앱 용량 +465MB

## 토의 / 메모

<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-06-29T14:03:00+09:00 | user | A 로 가되 진행 UI 는 분리 |
| 2026-06-29T14:20:00+09:00 | claude-code | B 는 배포 라운드 재검토 |
<!-- oculpm:discussion-log end -->

## 결론

방안 A 채택. B 는 배포 라운드 이월.

## 다음 단계

- [ ] embedding.rs 캐시 경로를 app_data_dir 절대경로로 {#next-abs-cache}
- [x] 첫 실행 다운로드 진행 UI {#next-dl-ux}
"#;

    #[test]
    fn parses_full_discussion() {
        let d = parse_discussion(SAMPLE, "from-folder");
        assert!(d.warnings.is_empty(), "warnings: {:?}", d.warnings);

        assert_eq!(d.frontmatter.id, "onnx-cache-strategy");
        assert_eq!(d.frontmatter.title, "onnx 모델 캐시 전략 결정");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Open);
        assert_eq!(d.frontmatter.owner, "user");
        assert_eq!(d.frontmatter.tags, vec!["fastembed", "packaging"]);

        assert!(d.problem.contains("상대 캐시 경로가 깨진다"));
        assert!(d.background.contains("embedding.rs:42"));

        assert_eq!(d.options.len(), 2);
        assert_eq!(d.options[0].option_id, "opt-app-data");
        assert_eq!(d.options[0].title, "방안 A — app_data_dir 절대경로");
        assert!(d.options[0].body.contains("CWD 무관"));
        assert_eq!(d.options[1].option_id, "opt-bundle");

        assert_eq!(d.log.len(), 2);
        assert_eq!(d.log[0].author, "user");
        assert!(d.log[0].body.contains("진행 UI 는 분리"));
        assert_eq!(d.log[1].author, "claude-code");

        assert!(d.conclusion.contains("방안 A 채택"));

        assert_eq!(d.next_steps.len(), 2);
        assert_eq!(d.next_steps[0].step_id, "next-abs-cache");
        assert!(!d.next_steps[0].done);
        assert_eq!(d.next_steps[1].step_id, "next-dl-ux");
        assert!(d.next_steps[1].done);
    }

    #[test]
    fn resolution_ref_parsed_when_present() {
        let md = "---\nid: x\ntitle: \"T\"\nstatus: resolved\nresolution_ref:\n  plan_id: my-plan\n  decided_at: 2026-06-29T15:10:00+09:00\n---\n## 문제 정의\n해결됨\n";
        let d = parse_discussion(md, "x");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Resolved);
        assert_eq!(d.frontmatter.resolution_plan_id.as_deref(), Some("my-plan"));
        assert_eq!(
            d.frontmatter.resolution_decided_at.as_deref(),
            Some("2026-06-29T15:10:00+09:00")
        );
    }

    #[test]
    fn missing_id_falls_back_to_folder_quietly() {
        let md = "---\noculpm_discussion: v1\ntitle: \"무제\"\n---\n## 문제 정의\n무언가\n";
        let d = parse_discussion(md, "my-folder");
        assert_eq!(d.frontmatter.id, "my-folder");
        assert!(
            !d.warnings
                .iter()
                .any(|w| w.contains("id") || w.contains("title")),
            "{:?}",
            d.warnings
        );
    }

    #[test]
    fn title_falls_back_to_h1() {
        let md = "# 큰 결정 회의록\n\n## 문제 정의\n뭔가\n";
        let d = parse_discussion(md, "topic");
        assert_eq!(d.frontmatter.id, "topic");
        assert_eq!(d.frontmatter.title, "큰 결정 회의록");
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    }

    #[test]
    fn option_without_id_is_generated_with_warning() {
        let md = "---\nid: x\ntitle: \"T\"\n---\n## 후보 해결 방안\n### 그냥 방안\n- 내용\n";
        let d = parse_discussion(md, "x");
        assert_eq!(d.options.len(), 1);
        assert!(d.warnings.iter().any(|w| w.contains("no {#id}")));
    }

    #[test]
    fn wrapped_next_step_id_on_continuation_is_found() {
        let md = "---\nid: x\ntitle: \"T\"\n---\n## 다음 단계\n- [ ] 긴 항목 설명 첫 줄\n      (둘째 줄 계속) {#wrap}\n";
        let d = parse_discussion(md, "x");
        assert_eq!(d.next_steps.len(), 1);
        assert_eq!(d.next_steps[0].step_id, "wrap");
        assert!(d.next_steps[0].title.contains("둘째 줄 계속"));
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    }

    #[test]
    fn unknown_status_defaults_open_with_warning() {
        let md = "---\nid: x\ntitle: \"T\"\nstatus: weird\n---\n## 문제 정의\nx\n";
        let d = parse_discussion(md, "x");
        assert_eq!(d.frontmatter.status, DiscussionStatus::Open);
        assert!(d
            .warnings
            .iter()
            .any(|w| w.contains("unknown discussion status")));
    }

    #[test]
    fn no_frontmatter_is_fail_soft() {
        let md = "## 문제 정의\n문제가 있다\n## 다음 단계\n- [x] 했음 {#did}\n";
        let d = parse_discussion(md, "stem");
        assert_eq!(d.frontmatter.id, "stem");
        assert!(d.problem.contains("문제가 있다"));
        assert_eq!(d.next_steps.len(), 1);
        assert!(d.next_steps[0].done);
    }

    #[test]
    fn duplicate_ids_are_deduped() {
        let md = "---\nid: x\ntitle: \"T\"\n---\n## 다음 단계\n- [ ] a {#dup}\n- [ ] b {#dup}\n";
        let d = parse_discussion(md, "x");
        assert_eq!(d.next_steps[0].step_id, "dup");
        assert_eq!(d.next_steps[1].step_id, "dup-2");
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
            let _ = parse_discussion(&s, "fuzz");
        }
    }
}

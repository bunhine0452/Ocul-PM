//! PR-CI2 — oculpm MCP 도구 3종의 구현 (D3).
//!
//! **디스크가 SSOT** 라는 설계 그대로: 도구는 `.oculpm/` 마크다운만 읽고 쓴다.
//! SQLite/앱 상태에 일절 접근하지 않으므로 앱이 꺼져 있어도 동작하고, 앱이
//! 켜져 있으면 기존 watcher 가 파일 변경을 보고 인덱싱한다 (IPC 없음).
//!
//! 동시성: 앱/다른 에이전트가 같은 plan 파일을 만질 수 있으나, 이는 외부
//! 에이전트가 AGENTS.md 규칙대로 파일을 직접 편집하는 기존 지원 경로와 동일한
//! 위험 표면이다 (원자적 전체-파일 쓰기, 마지막-작성자 승리).

use std::path::Path;

use chrono::{SecondsFormat, Timelike, Utc};
use serde_json::{json, Value};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::frontmatter::write_frontmatter_and_body;
use crate::oculpm::manager::{category_subdir, entry_type_filename_token, pick_nonconflicting_path};
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
use crate::oculpm::planner::plan_edit::{append_log_row, set_item_status, LogRow};
use crate::oculpm::planner::project::{find_plan_path, planner_dir};
use crate::oculpm::redact::{
    build_forbidden_matcher, compile_redact_patterns, is_forbidden_path, redact_text,
};
use crate::oculpm::spec::{
    AgentRef, Difficulty, EntryStatus, EntryType, FileOp, FileTouched, JournalFrontmatter,
    OculpmConfig,
};

/// MCP `tools/list` 응답의 도구 정의. 스키마는 에이전트가 읽는 계약서다 —
/// AGENTS.md §2~§4 의 규칙을 여기 옮겨 담아 "규칙 문서를 안 읽은 에이전트"도
/// 규격 기록을 남기게 한다.
pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "journal_write",
            "description": "ocul-pm 작업 일지 1건을 기록한다. 하나의 논리적 작업 단위(버그 수정/기능/리팩토링/에러 사이클/잡일)를 끝냈을 때 호출. 경로·파일명·frontmatter 규격은 서버가 보장하므로 파일을 직접 만들지 말 것.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "type": { "type": "string", "enum": ["bug", "feature", "error", "refactor", "chore"], "description": "작업 단위의 종류" },
                    "slug": { "type": "string", "description": "ASCII kebab-case, 40자 이내 (예: fix-cache-invalidation)" },
                    "title": { "type": "string", "description": "한 줄 제목 (한국어 권장)" },
                    "body_markdown": { "type": "string", "description": "본문. 타입별 권장 헤더 — bug/error: '## 발생 원인'·'## 해결 방법', feature: '## 추가 기능'·'## 동작 흐름', refactor: '## 동기'·'## 변경 요약'. 마지막에 '## 검증' 1~3줄 필수. 시크릿 금지." },
                    "status": { "type": "string", "enum": ["planned", "in_progress", "done", "abandoned"], "description": "기본 done" },
                    "difficulty": { "type": "string", "enum": ["verylow", "low", "medium", "high", "superhigh"] },
                    "files_touched": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string" },
                                "op": { "type": "string", "enum": ["create", "update", "delete", "rename", "correct"] }
                            },
                            "required": ["path"]
                        }
                    },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "agent_id": { "type": "string", "description": "호출한 에이전트 id (기본 claude-code)" },
                    "agent_version": { "type": "string", "description": "모델명 (예: Opus 4.8)" }
                },
                "required": ["type", "slug", "title", "body_markdown"]
            }
        },
        {
            "name": "plan_status",
            "description": "이 프로젝트의 활성 플랜(.oculpm/planner)과 항목 진행 상태를 반환한다. 작업 시작 전 현재 계획·다음 할 일을 파악할 때 호출. 기본은 요약(계획별 진척 + 아직 안 끝난 항목만) — 완료 항목까지 필요할 때만 view=\"full\", 가능하면 plan_id 로 좁혀 부를 것.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "view": { "type": "string", "enum": ["summary", "full"], "description": "기본 summary (미완 항목만). full 은 완료·폐기까지 전부" },
                    "plan_id": { "type": "string", "description": "이 계획 하나만 (생략 시 모든 활성 계획)" },
                    "status": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["todo", "in_progress", "done", "blocked", "deferred", "dropped"] },
                        "description": "이 상태의 항목만. 지정하면 view 는 무시된다"
                    },
                    "limit": { "type": "integer", "description": "항목 수 상한 (기본 60, 최대 500)" },
                    "cursor": { "type": "string", "description": "이어보기 — 이전 응답의 next_cursor 를 그대로 넘긴다" }
                }
            }
        },
        {
            "name": "plan_update",
            "description": "플랜 항목 하나의 상태를 갱신하고 갱신 로그를 남긴다. 일지를 쓴 직후 대응 항목이 있으면 호출 (plan-log append 는 서버가 규격대로 수행).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan_id": { "type": "string" },
                    "item_id": { "type": "string", "description": "{#id} 의 id (# 제외)" },
                    "status": { "type": "string", "enum": ["todo", "in_progress", "done", "blocked", "deferred", "dropped"] },
                    "journal_path": { "type": "string", "description": "방금 쓴 일지의 .oculpm/ 상대경로 (journal_write 응답의 path)" },
                    "note": { "type": "string", "description": "plan-log 메모 열 (짧게)" },
                    "agent_id": { "type": "string", "description": "기본 claude-code" }
                },
                "required": ["plan_id", "item_id", "status"]
            }
        }
    ])
}

pub fn call_tool(root: &Path, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "journal_write" => journal_write(root, args),
        "plan_status" => plan_status(root, args),
        "plan_update" => plan_update(root, args),
        other => Err(format!("unknown tool: {other}")),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn load_config(root: &Path) -> OculpmConfig {
    OculpmConfig::load(&root.join(".oculpm").join("config.toml"))
        .unwrap_or_else(|_| OculpmConfig::default_for_new_project())
}

fn resolver_of(cfg: &OculpmConfig) -> WorkdayResolver {
    WorkdayResolver::new(&cfg.workday.timezone, &cfg.workday.day_starts_at)
        .unwrap_or_else(|_| WorkdayResolver::new("UTC", "00:00").expect("UTC resolver"))
}

// ─── journal_write ───────────────────────────────────────────────────────────

fn parse_entry_type(s: &str) -> Result<EntryType, String> {
    Ok(match s {
        "bug" => EntryType::Bug,
        "feature" => EntryType::Feature,
        "error" => EntryType::Error,
        "refactor" => EntryType::Refactor,
        "chore" => EntryType::Chore,
        other => return Err(format!("invalid type '{other}' (bug|feature|error|refactor|chore)")),
    })
}

fn parse_entry_status(s: &str) -> Result<EntryStatus, String> {
    Ok(match s {
        "planned" => EntryStatus::Planned,
        "in_progress" => EntryStatus::InProgress,
        "done" => EntryStatus::Done,
        "abandoned" => EntryStatus::Abandoned,
        other => return Err(format!("invalid status '{other}'")),
    })
}

fn parse_file_op(s: &str) -> FileOp {
    match s {
        "create" => FileOp::Create,
        "delete" => FileOp::Delete,
        "rename" => FileOp::Rename,
        "correct" => FileOp::Correct,
        _ => FileOp::Update,
    }
}

/// slug 를 ASCII kebab 으로 강제 (journal_draft::sanitize_slug 와 동일 규칙을
/// 여기서 재사용하기엔 의존 방향이 어색해 로컬 구현 — 규칙은 스키마에 명시).
fn sanitize_slug(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut prev_dash = true;
    for ch in raw.trim().to_lowercase().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else if ch == '-' || ch == '_' || ch.is_whitespace() {
            Some('-')
        } else {
            None
        };
        match mapped {
            Some('-') if prev_dash => {}
            Some('-') => { out.push('-'); prev_dash = true; }
            Some(c) => { out.push(c); prev_dash = false; }
            None => {}
        }
        if out.len() >= 60 { break; }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        Err("slug must contain ASCII letters/digits (kebab-case)".into())
    } else {
        Ok(trimmed)
    }
}

fn journal_write(root: &Path, args: &Value) -> Result<Value, String> {
    let entry_type = parse_entry_type(arg_str(args, "type").ok_or("'type' is required")?)?;
    let slug = sanitize_slug(arg_str(args, "slug").ok_or("'slug' is required")?)?;
    let title = arg_str(args, "title").ok_or("'title' is required")?.to_string();
    let body = args
        .get("body_markdown")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or("'body_markdown' is required")?;
    let status = match arg_str(args, "status") {
        Some(s) => parse_entry_status(s)?,
        None => EntryStatus::Done,
    };
    let difficulty = arg_str(args, "difficulty").and_then(|s| match s {
        "verylow" => Some(Difficulty::Verylow),
        "low" => Some(Difficulty::Low),
        "medium" => Some(Difficulty::Medium),
        "high" => Some(Difficulty::High),
        "superhigh" => Some(Difficulty::Superhigh),
        _ => None,
    });

    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let now = Utc::now();
    let workday = resolver.workday_of(now);
    let local = now.with_timezone(&resolver.tz);

    // files_touched + forbidden 검사 (manager 의 create 경로와 동일 계약).
    let files: Vec<FileTouched> = args
        .get("files_touched")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let path = f.get("path")?.as_str()?.trim().to_string();
                    if path.is_empty() { return None; }
                    Some(FileTouched {
                        path,
                        op: parse_file_op(f.get("op").and_then(Value::as_str).unwrap_or("update")),
                        bytes_added: None,
                        bytes_removed: None,
                        rename_from: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if !cfg.git.forbid_journal_for_paths.is_empty() && !files.is_empty() {
        let matcher = build_forbidden_matcher(root, &cfg.git.forbid_journal_for_paths);
        let hits: Vec<String> = files
            .iter()
            .filter(|f| is_forbidden_path(&matcher, &f.path))
            .map(|f| f.path.clone())
            .collect();
        if !hits.is_empty() {
            return Err(format!(
                "files_touched contains forbidden paths (git.forbid_journal_for_paths): {}",
                hits.join(", ")
            ));
        }
    }

    // redact — MCP 로 들어온 본문에도 프로젝트 시크릿 패턴을 적용.
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let (title, _) = redact_text(&title, &patterns);
    let (body, _) = redact_text(body, &patterns);

    let mut tags: Vec<String> = args
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| t.as_str()).map(str::to_string).collect())
        .unwrap_or_default();
    if !tags.iter().any(|t| t == "mcp-tool") {
        tags.push("mcp-tool".to_string()); // 출처 표식 — 파일 자기신고와 구분
    }

    let fm = JournalFrontmatter {
        schema_version: 1,
        entry_type,
        slug: slug.clone(),
        status,
        difficulty,
        created_at: local.to_rfc3339_opts(SecondsFormat::Secs, false),
        updated_at: None,
        session_id: arg_str(args, "session_id").map(str::to_string).unwrap_or_else(|| {
            format!(
                "mcp-{workday}-{:02}{:02}{:02}",
                local.hour(), local.minute(), local.second()
            )
        }),
        agent: AgentRef {
            id: arg_str(args, "agent_id").unwrap_or("claude-code").to_string(),
            version: arg_str(args, "agent_version").map(str::to_string),
        },
        language: "ko".to_string(),
        verified_by_user: false,
        files_touched: files,
        related: Vec::new(),
        tags,
    };

    // 첫 줄 체크박스 제목 (AGENTS.md §4) — 본문이 이미 체크박스로 시작하면 존중.
    let marker = if matches!(fm.status, EntryStatus::Done) { "[x]" } else { "[ ]" };
    let full_body = if body.trim_start().starts_with("[x]") || body.trim_start().starts_with("[ ]") {
        body.trim().to_string()
    } else {
        format!("{marker} {title}\n\n{}", body.trim())
    };

    let dir = root
        .join(".oculpm")
        .join("journal")
        .join(&workday)
        .join(category_subdir(entry_type));
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let base = format!(
        "{:02}{:02}_{}_{}",
        local.hour(),
        local.minute(),
        entry_type_filename_token(entry_type),
        slug
    );
    let (abs, file_name) = pick_nonconflicting_path(&dir, &base);
    let markdown = write_frontmatter_and_body(&fm, &full_body);
    write_atomic(&abs, markdown.as_bytes()).map_err(|e| e.to_string())?;

    let rel = format!(
        ".oculpm/journal/{workday}/{}/{file_name}",
        category_subdir(entry_type)
    );
    Ok(json!({ "path": rel, "session_id": fm.session_id }))
}

// ─── plan_status ─────────────────────────────────────────────────────────────

/// `limit` 기본값과 상한. 상한은 '한 번에 다 받겠다'는 호출을 막는 안전핀이다.
const DEFAULT_ITEM_LIMIT: usize = 60;
const MAX_ITEM_LIMIT: usize = 500;

/// `summary` 뷰에서 제외하는 종료 상태.
fn is_terminal(s: ItemStatus) -> bool {
    matches!(s, ItemStatus::Done | ItemStatus::Dropped)
}

/// TSV 한 칸에 들어갈 수 없는 문자를 공백으로 접는다 (열 정합 보호).
fn tsv_cell(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ")
}

/// 활성 플랜과 항목 상태.
///
/// 2026-07-30 토큰 라운드 전에는 인수가 하나도 없이 **모든 활성 플랜의 모든
/// 항목** 을 중첩 JSON 으로 뱉었다 — 이 저장소에서 8.3 KB, 계획 15개 × 항목
/// 14개 규모에서는 ~50 KB(≈12k 토큰)였고, 모델이 좁혀 달라고 말할 방법이
/// 없었다. 이제:
///
/// - 기본이 `summary` (미완 항목만) — 대개 필요한 건 '다음에 뭘 할지' 다.
/// - `plan_id` / `status` / `limit` / `cursor` 로 좁히고 이어볼 수 있다.
/// - 항목을 중첩 JSON 대신 **TSV** 로 싣는다 (실측 −37%). 상태 글자는 디스크의
///   글리프 어휘(`  ~ x ! > -`)를 그대로 쓴다 — 모델이 읽은 글자를 그대로 파일에
///   쓰게 되므로 번역 단계가 없다.
/// - `parse_plan` 이 내놓는 `warnings` 를 처음으로 노출한다. 망가진 플랜을
///   갱신하라고 시키면서 그 사실을 숨기고 있었다 (수십 바이트로 가장 값진 정보).
fn plan_status(root: &Path, args: &Value) -> Result<Value, String> {
    let view_full = arg_str(args, "view") == Some("full");
    let only_plan = arg_str(args, "plan_id").map(|s| s.to_string());
    let cursor = arg_str(args, "cursor").map(|s| s.to_string());
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, MAX_ITEM_LIMIT))
        .unwrap_or(DEFAULT_ITEM_LIMIT);
    // status 를 지정하면 그것이 뷰보다 강하다 (명시가 기본값을 이긴다).
    let status_filter: Option<Vec<ItemStatus>> = match args.get("status").and_then(Value::as_array) {
        Some(arr) if !arr.is_empty() => Some(
            arr.iter()
                .filter_map(Value::as_str)
                .map(parse_item_status)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        _ => None,
    };

    let planner_root = planner_dir(root);
    let entries = match std::fs::read_dir(&planner_root) {
        Ok(e) => e,
        Err(_) => return Ok(json!({ "plans": [], "note": "planner 폴더 없음 — 아직 플랜이 없다" })),
    };

    // 파일 순서는 OS 가 정하므로 정렬해 응답을 결정적으로 만든다 (cursor 가
    // 호출 간에 같은 자리를 가리켜야 한다).
    let mut paths: Vec<_> = entries
        .flatten()
        .map(|f| f.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();

    let mut plans: Vec<Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    // (plan_id, item_id, status_token, phase, title) — 필터를 통과한 전체 집합.
    let mut rows: Vec<(String, String, &'static str, String, String)> = Vec::new();

    for path in paths {
        let Ok(md) = std::fs::read_to_string(&path) else { continue };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        let parsed = parse_plan(&md, stem);
        if parsed.frontmatter.status.as_str() != "active" {
            continue; // 잠긴(done/archived) plan 은 갱신 대상이 아니다
        }
        let plan_id = parsed.frontmatter.id.clone();
        if only_plan.as_deref().is_some_and(|want| want != plan_id) {
            continue;
        }

        let done = parsed
            .items
            .iter()
            .filter(|i| matches!(i.status, ItemStatus::Done))
            .count();
        plans.push(json!({
            "id": plan_id,
            "title": parsed.frontmatter.title,
            "progress": { "done": done, "total": parsed.items.len() },
        }));
        for w in &parsed.warnings {
            warnings.push(format!("{plan_id}: {w}"));
        }

        for i in &parsed.items {
            let keep = match &status_filter {
                Some(want) => want.contains(&i.status),
                None => view_full || !is_terminal(i.status),
            };
            if keep {
                rows.push((
                    plan_id.clone(),
                    i.item_id.clone(),
                    i.status.token(),
                    i.phase.clone().unwrap_or_default(),
                    i.title.clone(),
                ));
            }
        }
    }

    if only_plan.is_some() && plans.is_empty() {
        return Err(format!(
            "plan '{}' not found or not active",
            only_plan.unwrap_or_default()
        ));
    }

    // cursor 는 **항목 id** 다 — 오프셋으로 하면 필터가 달라진 다음 호출에서
    // 엉뚱한 자리를 가리켜 항목을 건너뛰거나 되풀이한다.
    let total = rows.len();
    let start = match &cursor {
        Some(c) => match rows.iter().position(|r| &r.1 == c) {
            Some(i) => i,
            None => return Err(format!("cursor '{c}' not found — 처음부터 다시 호출할 것")),
        },
        None => 0,
    };
    let end = (start + limit).min(total);
    let page = &rows[start..end];

    let mut tsv = String::from("plan\titem\tst\tphase\ttitle");
    for (plan_id, item_id, tok, phase, title) in page {
        tsv.push('\n');
        tsv.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}",
            tsv_cell(plan_id),
            tsv_cell(item_id),
            tok,
            tsv_cell(phase),
            tsv_cell(title)
        ));
    }

    let mut out = json!({
        "plans": plans,
        "items_tsv": tsv,
        "legend": "st: ' '=todo ~=in_progress x=done !=blocked >=deferred -=dropped (디스크 글리프와 동일)",
        "returned": page.len(),
        "total": total,
        "more": end < total,
    });
    if !view_full && status_filter.is_none() {
        out["note"] = json!("summary 뷰 — 완료·폐기 항목은 제외됨. 전부 보려면 view=\"full\"");
    }
    if end < total {
        out["next_cursor"] = json!(rows[end].1);
    }
    if !warnings.is_empty() {
        out["warnings"] = json!(warnings);
    }
    Ok(out)
}

// ─── plan_update ─────────────────────────────────────────────────────────────

fn parse_item_status(s: &str) -> Result<ItemStatus, String> {
    Ok(match s {
        "todo" => ItemStatus::Todo,
        "in_progress" => ItemStatus::InProgress,
        "done" => ItemStatus::Done,
        "blocked" => ItemStatus::Blocked,
        "deferred" => ItemStatus::Deferred,
        "dropped" => ItemStatus::Dropped,
        other => return Err(format!(
            "invalid status '{other}' (todo|in_progress|done|blocked|deferred|dropped)"
        )),
    })
}

fn plan_update(root: &Path, args: &Value) -> Result<Value, String> {
    let plan_id = arg_str(args, "plan_id").ok_or("'plan_id' is required")?;
    let item_id = arg_str(args, "item_id").ok_or("'item_id' is required")?
        .trim_start_matches('#');
    let new_status = parse_item_status(arg_str(args, "status").ok_or("'status' is required")?)?;
    let agent_id = arg_str(args, "agent_id").unwrap_or("claude-code").to_string();

    let planner_root = planner_dir(root);
    let path = find_plan_path(&planner_root, plan_id)
        .ok_or_else(|| format!("plan '{plan_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = parse_plan(&md, plan_id);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(format!(
            "plan '{plan_id}' is locked (status={}) — 잠긴 plan 은 수정 금지",
            parsed.frontmatter.status.as_str()
        ));
    }

    let result = set_item_status(&md, item_id, new_status)?;
    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let now_local = Utc::now().with_timezone(&resolver.tz);
    // note·journal_path 도 plan-log 에 원문 그대로 남으므로 본문과 동일하게 redact.
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let row = LogRow {
        ts: now_local.to_rfc3339_opts(SecondsFormat::Secs, false),
        item_id: item_id.to_string(),
        agent_id,
        from: Some(result.old_status),
        to: Some(new_status),
        journal_ref: arg_str(args, "journal_path").map(|s| redact_text(s, &patterns).0),
        note: arg_str(args, "note").map(|s| redact_text(s, &patterns).0),
    };
    let with_log = append_log_row(&result.md, &row);
    write_atomic(&path, with_log.as_bytes()).map_err(|e| e.to_string())?;

    Ok(json!({
        "plan_id": plan_id,
        "item_id": item_id,
        "from": result.old_status.as_str(),
        "to": new_status.as_str(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::frontmatter::parse_frontmatter_and_body;
    use tempfile::TempDir;

    fn seed_plan(root: &Path) {
        let dir = planner_dir(root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("test-plan.md"),
            "---\noculpm_plan: v1\nid: test-plan\ntitle: \"테스트 플랜\"\nstatus: active\ncreated: 2026-07-20\nupdated: 2026-07-20\nowner: claude-code\n---\n\n## Phase 1 {#p1}\n- [ ] 첫 항목 {#first}\n- [~] 둘째 항목 {#second}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n",
        )
        .unwrap();
    }

    #[test]
    fn journal_write_produces_spec_valid_entry() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let args = serde_json::json!({
            "type": "bug",
            "slug": "Fix Cache!!",
            "title": "캐시 무효화 수정",
            "body_markdown": "## 발생 원인\n\n키 불일치.\n\n## 해결 방법\n\n정규화.\n\n## 검증\n\ncargo test 그린",
            "files_touched": [{ "path": "src/cache.rs", "op": "update" }],
            "agent_version": "Opus 4.8"
        });
        let out = call_tool(root, "journal_write", &args).unwrap();
        let rel = out["path"].as_str().unwrap();
        assert!(rel.contains("/Bugs/"), "{rel}");
        assert!(rel.ends_with("_bug_fix-cache.md"), "slug 는 kebab 강제: {rel}");

        let raw = std::fs::read_to_string(root.join(rel)).unwrap();
        let (parsed, body) = parse_frontmatter_and_body(&raw);
        let fm = parsed.parsed.expect("frontmatter parses");
        assert!(
            parsed.parse_warnings.is_empty(),
            "파서 경고 0 이 계약: {:?}",
            parsed.parse_warnings
        );
        assert_eq!(fm.agent.id, "claude-code");
        assert_eq!(fm.agent.version.as_deref(), Some("Opus 4.8"));
        assert!(!fm.verified_by_user);
        assert!(fm.tags.iter().any(|t| t == "mcp-tool"));
        assert!(fm.session_id.starts_with("mcp-"));
        assert!(body.trim_start().starts_with("[x] 캐시 무효화 수정"));
    }

    #[test]
    fn journal_write_rejects_forbidden_paths_and_redacts_body() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm")).unwrap();
        std::fs::write(
            root.join(".oculpm/config.toml"),
            "schema_version = 1\n[workday]\ntimezone = \"Asia/Seoul\"\nday_starts_at = \"00:00\"\n[session]\ninactivity_timeout_minutes = 30\nauto_close_on_workday_boundary = true\nauto_close_on_app_quit = true\ncrash_recovery_grace_minutes = 5\n[git]\njournal_committed = true\nforbid_journal_for_paths = [\".env\"]\nauto_redact_patterns = [\"sk-[A-Za-z0-9]+\"]\n[watcher]\nignore = []\nrespect_gitignore = true\ndebounce_ms = 500\nbatch_max_events = 200\n[agents]\nactive = []\nauto_detect_on_open = false\nauto_sync_adapters = false\n",
        )
        .unwrap();

        let forbidden = serde_json::json!({
            "type": "chore", "slug": "x", "title": "t", "body_markdown": "b",
            "files_touched": [{ "path": ".env" }]
        });
        let err = call_tool(root, "journal_write", &forbidden).unwrap_err();
        assert!(err.contains(".env"));

        let secret = serde_json::json!({
            "type": "chore", "slug": "secret-test", "title": "t",
            "body_markdown": "키는 sk-abcdef123 이다\n\n## 검증\n없음"
        });
        let out = call_tool(root, "journal_write", &secret).unwrap();
        let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
        assert!(!raw.contains("sk-abcdef123"), "redact 적용: {raw}");
    }

    /// Seed a plan with `n` todo items plus one done + one dropped, so the
    /// summary/full split and paging have something to bite on.
    fn seed_big_plan(root: &Path, id: &str, n: usize) {
        let dir = planner_dir(root);
        std::fs::create_dir_all(&dir).unwrap();
        let mut md = format!(
            "---\noculpm_plan: v1\nid: {id}\ntitle: \"큰 플랜\"\nstatus: active\n\
             created: 2026-07-30\nupdated: 2026-07-30\nowner: claude-code\n---\n\n## Phase 1 {{#p1}}\n"
        );
        for i in 0..n {
            md.push_str(&format!("- [ ] 항목 {i} {{#it-{i}}}\n"));
        }
        md.push_str("- [x] 끝난 항목 {#fin}\n- [-] 버린 항목 {#gone}\n");
        md.push_str("\n<!-- oculpm:plan-log begin v1 -->\n<!-- oculpm:plan-log end -->\n");
        std::fs::write(dir.join(format!("{id}.md")), md).unwrap();
    }

    #[test]
    fn plan_status_lists_active_items() {
        let dir = TempDir::new().unwrap();
        seed_plan(dir.path());
        let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
        let plans = out["plans"].as_array().unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0]["id"], "test-plan");
        assert_eq!(plans[0]["progress"]["total"], 2);
        // 항목은 중첩 JSON 이 아니라 TSV 로 실린다 (실측 −37%).
        let tsv = out["items_tsv"].as_str().unwrap();
        let lines: Vec<&str> = tsv.lines().collect();
        assert_eq!(lines[0], "plan\titem\tst\tphase\ttitle");
        assert_eq!(lines.len(), 3, "헤더 + 항목 2개: {tsv}");
        assert_eq!(lines[1], "test-plan\tfirst\t \tPhase 1\t첫 항목");
        assert_eq!(lines[2], "test-plan\tsecond\t~\tPhase 1\t둘째 항목");
        assert_eq!(out["returned"], 2);
        assert_eq!(out["total"], 2);
        assert_eq!(out["more"], false);
    }

    #[test]
    fn plan_status_legend_matches_the_on_disk_glyph_vocabulary() {
        // 와이어와 파일이 같은 어휘를 쓰게 한다 — 모델이 읽은 글자를 그대로
        // 파일에 쓰므로 번역 단계가 없다. 상태가 하나 늘면 이 테스트가 깨진다.
        let dir = TempDir::new().unwrap();
        seed_plan(dir.path());
        let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
        let legend = out["legend"].as_str().unwrap();
        for st in [
            ItemStatus::Todo,
            ItemStatus::InProgress,
            ItemStatus::Done,
            ItemStatus::Blocked,
            ItemStatus::Deferred,
            ItemStatus::Dropped,
        ] {
            let tok = st.token();
            let shown = if tok == " " { "' '" } else { tok };
            assert!(
                legend.contains(&format!("{shown}={}", st.as_str())),
                "legend 에 {} 누락: {legend}",
                st.as_str()
            );
        }
    }

    #[test]
    fn plan_status_summary_hides_terminal_items_and_full_shows_them() {
        let dir = TempDir::new().unwrap();
        seed_big_plan(dir.path(), "big", 3);

        let summary = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
        assert_eq!(summary["total"], 3, "summary 는 done/dropped 제외");
        assert!(!summary["items_tsv"].as_str().unwrap().contains("끝난 항목"));
        assert!(summary["note"].as_str().unwrap().contains("view=\"full\""));

        let full = call_tool(dir.path(), "plan_status", &serde_json::json!({ "view": "full" }))
            .unwrap();
        assert_eq!(full["total"], 5);
        assert!(full["items_tsv"].as_str().unwrap().contains("끝난 항목"));
        assert!(full.get("note").is_none());
        // 진척은 두 뷰에서 같다 — 필터는 표시만 줄이고 계산을 바꾸지 않는다.
        assert_eq!(summary["plans"][0]["progress"], full["plans"][0]["progress"]);
    }

    #[test]
    fn plan_status_status_filter_overrides_the_view() {
        let dir = TempDir::new().unwrap();
        seed_big_plan(dir.path(), "big", 2);
        let out = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "status": ["done"] }),
        )
        .unwrap();
        assert_eq!(out["total"], 1);
        assert!(out["items_tsv"].as_str().unwrap().contains("끝난 항목"));

        let err = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "status": ["없는상태"] }),
        )
        .unwrap_err();
        assert!(err.contains("invalid status"), "{err}");
    }

    #[test]
    fn plan_status_pages_by_item_id_cursor() {
        let dir = TempDir::new().unwrap();
        seed_big_plan(dir.path(), "big", 5);

        let p1 = call_tool(dir.path(), "plan_status", &serde_json::json!({ "limit": 2 })).unwrap();
        assert_eq!(p1["returned"], 2);
        assert_eq!(p1["total"], 5);
        assert_eq!(p1["more"], true);
        // cursor 는 오프셋이 아니라 항목 id — 필터가 달라져도 같은 자리를 가리킨다.
        let cursor = p1["next_cursor"].as_str().unwrap().to_string();
        assert_eq!(cursor, "it-2");

        let p2 = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "limit": 2, "cursor": cursor }),
        )
        .unwrap();
        assert_eq!(p2["returned"], 2);
        assert!(p2["items_tsv"].as_str().unwrap().contains("it-3"));
        assert!(!p2["items_tsv"].as_str().unwrap().contains("\tit-1\t"));

        let bad = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "cursor": "없는항목" }),
        )
        .unwrap_err();
        assert!(bad.contains("cursor"), "{bad}");
    }

    #[test]
    fn plan_status_narrows_to_one_plan_and_errors_on_unknown() {
        let dir = TempDir::new().unwrap();
        seed_plan(dir.path());
        seed_big_plan(dir.path(), "other", 2);

        let out = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "plan_id": "other" }),
        )
        .unwrap();
        assert_eq!(out["plans"].as_array().unwrap().len(), 1);
        assert!(!out["items_tsv"].as_str().unwrap().contains("test-plan"));

        let err = call_tool(
            dir.path(),
            "plan_status",
            &serde_json::json!({ "plan_id": "nope" }),
        )
        .unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    #[test]
    fn plan_status_surfaces_parser_warnings() {
        // 망가진 플랜을 갱신하라고 시키면서 그 사실을 숨기지 않는다.
        let dir = TempDir::new().unwrap();
        let pdir = planner_dir(dir.path());
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(
            pdir.join("warn.md"),
            "---\noculpm_plan: v1\nid: warn\ntitle: \"경고 플랜\"\nstatus: active\n---\n\
             \n## Phase 1\n- [ ] id 가 없는 항목\n",
        )
        .unwrap();
        let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
        let warnings = out["warnings"].as_array().expect("warnings 노출");
        assert!(
            warnings.iter().any(|w| w.as_str().unwrap().starts_with("warn: ")),
            "plan_id 로 귀속: {warnings:?}"
        );
    }

    #[test]
    fn plan_status_tsv_cells_never_break_columns() {
        let dir = TempDir::new().unwrap();
        let pdir = planner_dir(dir.path());
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(
            pdir.join("tabby.md"),
            "---\noculpm_plan: v1\nid: tabby\ntitle: \"탭 플랜\"\nstatus: active\n---\n\
             \n## Phase\tA\n- [ ] 탭\t들어간 제목 {#t1}\n",
        )
        .unwrap();
        let out = call_tool(dir.path(), "plan_status", &serde_json::json!({})).unwrap();
        let tsv = out["items_tsv"].as_str().unwrap();
        for line in tsv.lines() {
            assert_eq!(line.split('\t').count(), 5, "열이 5개여야 함: {line:?}");
        }
    }

    #[test]
    fn plan_update_flips_glyph_appends_log_and_respects_lock() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        seed_plan(root);
        let args = serde_json::json!({
            "plan_id": "test-plan", "item_id": "#first", "status": "done",
            "journal_path": "journal/20260720/Bugs/1200_bug_x.md", "note": "MCP 경유"
        });
        let out = call_tool(root, "plan_update", &args).unwrap();
        assert_eq!(out["from"], "todo");
        assert_eq!(out["to"], "done");

        let md = std::fs::read_to_string(planner_dir(root).join("test-plan.md")).unwrap();
        assert!(md.contains("- [x] 첫 항목 {#first}"));
        assert!(md.contains("| #first | claude-code |"), "plan-log append: {md}");
        assert!(md.contains("MCP 경유"));

        // 잠긴 plan 은 거부.
        let locked = md.replace("status: active", "status: done");
        std::fs::write(planner_dir(root).join("test-plan.md"), locked).unwrap();
        let err = call_tool(root, "plan_update", &args).unwrap_err();
        assert!(err.contains("locked"));
    }

    #[test]
    fn plan_update_note_and_journal_ref_are_redacted() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        seed_plan(root);
        let args = serde_json::json!({
            "plan_id": "test-plan", "item_id": "second", "status": "done",
            "note": "키 sk-abcdefghijklmnopqrstuvwx 로 검증함"
        });
        call_tool(root, "plan_update", &args).unwrap();
        let md = std::fs::read_to_string(planner_dir(root).join("test-plan.md")).unwrap();
        assert!(!md.contains("sk-abcdefghijklmnopqrstuvwx"), "시크릿이 plan-log 에 남음");
        assert!(md.contains("[REDACTED]"), "{md}");
    }

    #[test]
    fn unknown_tool_and_missing_args_error_cleanly() {
        let dir = TempDir::new().unwrap();
        assert!(call_tool(dir.path(), "nope", &serde_json::json!({})).is_err());
        let err = call_tool(dir.path(), "journal_write", &serde_json::json!({})).unwrap_err();
        assert!(err.contains("'type'"));
    }
}

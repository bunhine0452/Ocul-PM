//! `plan_update` — 플랜을 고치는 유일한 MCP 길 (love-round-20261123 #mcp-plan-add-item).
//!
//! 예전에는 항목 하나의 상태만 바꿨다. 그런데 AGENTS.md 는 「남은 일은 플랜 항목으로」(§1) ·
//! 「큰 결정은 `## 결정` 블록으로」(§5) 를 요구했고, `plan_create` 설명은 「겹치는 플랜에 항목을 더하라
//! (plan_update)」 고 안내했다 — 할 수 없는 일이었다. 에이전트는 python 으로 플랜 파일을 직접 고쳤고(이
//! 저장소 세션에서 Bash 쓰기 94건), 그때 CAS · 문지기 · `{#id}` 규격이 모두 빠졌다.
//!
//! 그래서 **새 도구가 아니라 인자**를 더했다. 한 호출은 한 번의 문지기 + 해시 대조 + 원자 쓰기다:
//! - `item_id` + `status` — 상태 바꾸기 (예전 그대로)
//! - `add` — 항목 더하기 (phase 끝에, 또는 `parent` 의 하위로). plan-log 에 `→☐` 행
//! - `decision` — `## 결정` 섹션에 결정 블록 하나
//! - `verdict` · `note` 만 — 상태를 안 바꾸고 판정 · 메모 한 줄 (항목 칸 `—`)
//!
//! 넷은 한 호출에 함께 와도 된다. 새 도구로 나눴다면 계약(base_hash 필수)이 둘이 되고, 마찰을 만난
//! 쪽은 늘 덜 지키는 쪽을 고른다.

use super::*;

use crate::oculpm::planner::log_archive::archive_overflow;
use crate::oculpm::planner::plan_decision::{add_decision, NewDecision};
use crate::oculpm::planner::plan_edit::{add_child_item, add_item, id_is_anchored};

/// 받아 주는 동의어 — `args.rs` 가 응답의 `received` 로 알린다.
const ALIASES: &[(&str, &str)] = &[
    ("hash", "base_hash"),
    ("plan", "plan_id"),
    ("item", "item_id"),
    ("state", "status"),
    ("memo", "note"),
    ("message", "note"),
    ("journal", "journal_path"),
    ("items", "add"),
];

/// 한 호출로 더할 수 있는 항목 수 — 거대 계획은 `plan_create` 로.
const MAX_ADDS: usize = 20;

/// `tools/list` 의 이 도구 계약서 — 구현 옆에 둔다 (`plan_status_definition` 과 같은 이유).
pub(crate) fn plan_update_definition() -> Value {
    json!({
        "name": "plan_update",
        "description": "플랜을 고친다 — 한 호출이 한 번의 안전한 쓰기다. ① 항목 상태: item_id + status (일지를 쓴 직후 대응 항목이 있으면) ② 항목 더하기: add (남은 일 · 이월 · 새로 찾은 일 — 플랜 파일을 직접 고치지 말 것) ③ 결정 잠그기: decision (`## 결정` 섹션의 블록) ④ 판정 · 메모만: verdict 나 note (상태는 그대로 — 확인 명령을 중간에 돌렸을 때). 넷을 한 호출에 함께 줘도 된다. plan-log 행은 서버가 규격대로 남긴다. **base_hash 가 필수다** — 먼저 plan_status 로 그 플랜의 hash 를 읽고 그 값을 넘길 것. 병렬 세션이 같은 플랜을 고칠 때 한쪽 변경이 조용히 사라지는 것을 막는다. 해시가 어긋나면 아무것도 쓰지 않고 현재 hash 를 담은 오류로 돌아오니, 다시 읽어 판단한 뒤 새 hash 로 재호출할 것.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plan_id": { "type": "string" },
                "base_hash": { "type": "string", "description": "**필수** — 네가 읽은 그 플랜 파일의 blake3 해시. 출처는 셋: plan_status 응답의 plans[].hash · plan_create 응답의 hash · 직전 plan_update 응답의 hash. 그 사이 남이 고쳤으면 덮어쓰지 않고 거부한다 (병렬 세션 보호)." },
                "item_id": { "type": "string", "description": "{#id} 의 id (# 제외) — status 와 함께 주면 그 항목의 상태를 바꾼다. status 없이 verdict · note 와 주면 그 항목에 메모만 남긴다" },
                "status": { "type": "string", "description": "todo|in_progress|done|blocked|deferred|dropped — plan_status 의 st 열 글리프(' ' ~ x ! > -)를 그대로 줘도 된다" },
                "journal_path": { "type": "string", "description": "방금 쓴 일지의 .oculpm/ 상대경로 (journal_write 응답의 path)" },
                "note": { "type": "string", "description": "plan-log 메모 열 (짧게). 확인 명령의 결과는 verdict 로 주면 서버가 `판정 ✓|✗` 접두를 붙인다" },
                "verdict": {
                    "type": "object",
                    "description": "확인 명령을 돌린 결과 — 서버가 `판정 ✓ <끝 줄>` 또는 `판정 ✗ <끝 줄>` 로 적고 돌린 OS 를 붙인다. 다음 세션의 시작 훅이 「마지막 판정」으로 싣는다. item_id · status 없이 이것만 줘도 된다",
                    "properties": {
                        "ok": { "type": "boolean", "description": "통과했으면 true" },
                        "last_line": { "type": "string", "description": "결과 끝 줄 (예: 418 passed · exit 0)" }
                    },
                    "required": ["ok"]
                },
                "add": {
                    "type": "array",
                    "description": "더할 항목들 (최대 20개). 새 항목은 할일 [ ] 로 생기고 plan-log 에 →☐ 행이 남는다",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string", "description": "항목 한 줄, 40자 안 (줄바꿈 금지)" },
                            "phase": { "type": "string", "description": "넣을 단계의 제목이나 {#id} — 생략하면 마지막 단계, 없는 이름이면 새 단계를 만든다" },
                            "parent": { "type": "string", "description": "선택 — 이 최상위 항목의 하위로 넣는다 (중첩은 1단계). 주면 phase 는 무시" },
                            "id": { "type": "string", "description": "선택 — 안정적 kebab id (생략하면 텍스트에서 짓는다)" },
                            "status": { "type": "string", "description": "선택 — 기본 todo" }
                        },
                        "required": ["text"]
                    }
                },
                "decision": {
                    "type": "object",
                    "description": "큰 결정 · 옵션 비교를 이 플랜의 `## 결정` 섹션에 `### Decision N — 제목 {#id}` 블록으로 잠근다 (날짜 · agent 는 서버가). 별도 문서를 만들지 말 것",
                    "properties": {
                        "title": { "type": "string", "description": "결정 한 줄" },
                        "body": { "type": "string", "description": "근거 · 버린 대안 (짧게)" },
                        "affects": { "type": "array", "items": { "type": "string" }, "description": "영향받는 항목 id 들" },
                        "id": { "type": "string", "description": "선택 — kebab id (생략하면 제목에서 짓는다)" }
                    },
                    "required": ["title"]
                },
                "agent_id": { "type": "string", "description": "생략 시 이 세션을 띄운 에이전트" }
            },
            "required": ["plan_id", "base_hash"]
        }
    })
}

struct AddSpec {
    text: String,
    phase: Option<String>,
    parent: Option<String>,
    id: Option<String>,
    status: ItemStatus,
}

struct DecisionSpec {
    title: String,
    body: String,
    affects: Vec<String>,
    id: Option<String>,
}

fn obj_str(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// `add` — 배열이 정식이지만 객체 하나도 받는다.
fn parse_adds(v: Option<&Value>, en: bool) -> Result<Vec<AddSpec>, String> {
    let list: Vec<&Value> = match v {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(a)) => a.iter().collect(),
        Some(o @ Value::Object(_)) => vec![o],
        Some(_) => {
            return Err(pick(
                en,
                "add 는 항목 객체의 배열이에요",
                "add must be an array of item objects",
            ))
        }
    };
    if list.len() > MAX_ADDS {
        return Err(if en {
            format!(
                "add takes at most {MAX_ADDS} items per call — use plan_create for a large plan"
            )
        } else {
            format!("add 는 한 번에 {MAX_ADDS}개까지예요 — 큰 계획은 plan_create 로")
        });
    }
    let mut missing = Vec::new();
    let mut out = Vec::new();
    for (i, a) in list.iter().enumerate() {
        let Some(text) = obj_str(a, &["text", "title"]) else {
            missing.push(format!("add[{i}].text"));
            continue;
        };
        let status = match obj_str(a, &["status"]) {
            Some(s) => parse_item_status(&s)?,
            None => ItemStatus::Todo,
        };
        out.push(AddSpec {
            text,
            phase: obj_str(a, &["phase"]),
            parent: obj_str(a, &["parent", "parent_id"])
                .map(|p| p.trim_start_matches('#').to_string()),
            id: obj_str(a, &["id", "item_id"]).map(|p| p.trim_start_matches('#').to_string()),
            status,
        });
    }
    if !missing.is_empty() {
        return Err(if en {
            format!(
                "missing {} — each added item needs a one-line text",
                missing.join(" · ")
            )
        } else {
            format!(
                "{} 이 없어요 — 더할 항목마다 한 줄 text 가 필요해요",
                missing.join(" · ")
            )
        });
    }
    Ok(out)
}

fn parse_decision(v: Option<&Value>, en: bool) -> Result<Option<DecisionSpec>, String> {
    let Some(d) = v.filter(|d| !d.is_null()) else {
        return Ok(None);
    };
    let title = obj_str(d, &["title"]).ok_or_else(|| {
        pick(
            en,
            "decision.title 이 없어요 — 결정 한 줄을 주세요",
            "decision.title is missing",
        )
    })?;
    let affects = match d.get("affects") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(Value::String(s)) => s
            .split([',', ' '])
            .filter(|p| !p.trim().is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    Ok(Some(DecisionSpec {
        title,
        body: obj_str(d, &["body", "body_markdown", "reason"]).unwrap_or_default(),
        affects,
        id: obj_str(d, &["id"]),
    }))
}

/// `verdict` — 객체 `{ok, last_line}` (또는 `✓ 10 passed` 같은 글) 를 판정 메모 한 줄로.
fn parse_verdict(v: Option<&Value>, en: bool) -> Result<Option<String>, String> {
    let (ok, line) = match v {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim();
            if let Some((ok, tail)) = crate::oculpm::planner::judge::parse_note(s) {
                (ok, tail)
            } else if let Some(t) = s.strip_prefix('✓') {
                (true, t.trim().to_string())
            } else if let Some(t) = s.strip_prefix('✗') {
                (false, t.trim().to_string())
            } else {
                return Err(pick(
                    en,
                    "verdict 는 {ok: true|false, last_line: \"결과 끝 줄\"} 로 주세요",
                    "verdict must be {ok: true|false, last_line: \"last result line\"}",
                ));
            }
        }
        Some(o) => {
            let ok = ["ok", "passed", "pass", "success"]
                .iter()
                .find_map(|k| o.get(*k).and_then(Value::as_bool))
                .ok_or_else(|| {
                    pick(
                        en,
                        "verdict.ok(true|false) 가 없어요",
                        "verdict.ok (true|false) is missing",
                    )
                })?;
            (
                ok,
                obj_str(o, &["last_line", "summary", "line", "output"]).unwrap_or_default(),
            )
        }
    };
    let line: String = line.replace(['\n', '\r'], " ").chars().take(200).collect();
    let head = format!(
        "{} {}",
        if en { "verdict" } else { "판정" },
        if ok { '✓' } else { '✗' }
    );
    Ok(Some(if line.trim().is_empty() {
        head
    } else {
        format!("{head} {}", line.trim())
    }))
}

fn pick(en: bool, ko: &str, en_s: &str) -> String {
    if en { en_s } else { ko }.to_string()
}

/// 이 플랜에서 아직 안 쓰인 id — 겹치면 `-2`, `-3` …
fn unique_id(md: &str, base: &str) -> String {
    if !id_is_anchored(md, base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|c| !id_is_anchored(md, c))
        .expect("unbounded")
}

/// 텍스트에서 kebab id — ASCII 가 없으면(한글뿐) `fallback`.
fn derived_id(text: &str, fallback: String) -> String {
    sanitize_slug(text)
        .ok()
        .map(|s| {
            s.chars()
                .take(40)
                .collect::<String>()
                .trim_end_matches('-')
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
}

pub(crate) fn plan_update(root: &Path, raw_args: &Value) -> Result<Value, String> {
    let en = self::args::project_en(root);
    let def = plan_update_definition();
    let norm = self::args::normalize(raw_args, ALIASES, en);
    let args = &norm.args;
    let mut received = norm.received;

    // 무엇을 하라는 호출인가 — 빠진 것은 **한 번에 전부** 말한다 (`args.rs`).
    let status_raw = args
        .get("status")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let item_id = arg_str(args, "item_id").map(|s| s.trim_start_matches('#'));
    let verdict = parse_verdict(args.get("verdict"), en)?;
    let note_arg = arg_str(args, "note");
    let adds = parse_adds(args.get("add"), en)?;
    let decision = parse_decision(args.get("decision"), en)?;
    let mut missing = self::args::missing(args, &["plan_id", "base_hash"]);
    match (item_id.is_some(), status_raw.is_some()) {
        (true, false) if verdict.is_none() && note_arg.is_none() => missing.push("status"),
        (false, true) => missing.push("item_id"),
        _ => {}
    }
    let asks_nothing = item_id.is_none()
        && status_raw.is_none()
        && adds.is_empty()
        && decision.is_none()
        && verdict.is_none()
        && note_arg.is_none();
    if !missing.is_empty() || asks_nothing {
        let mut msg = if missing.is_empty() {
            pick(
                en,
                "plan_update: 할 일이 없어요 — item_id+status · add · decision · verdict · note 중 하나는 주세요 (아무것도 쓰지 않았어요).",
                "plan_update: nothing to do — give item_id+status, add, decision, verdict or note (nothing was written).",
            )
        } else {
            self::args::missing_error("plan_update", &missing, &def, en)
        };
        if missing.contains(&"base_hash") {
            msg.push(' ');
            msg.push_str(&missing_base_hash(
                arg_str(args, "plan_id").unwrap_or("<plan_id>"),
            ));
        }
        return Err(msg);
    }
    let plan_id = arg_str(args, "plan_id").unwrap_or_default();
    let expected = arg_str(args, "base_hash").unwrap_or_default();
    let new_status = status_raw.map(parse_item_status).transpose()?;
    let agent_id = arg_str(args, "agent_id")
        .map(str::to_string)
        .unwrap_or_else(default_agent_id);

    let planner_root = planner_dir(root);
    let path = find_plan_path(&planner_root, plan_id)
        .ok_or_else(|| format!("plan '{plan_id}' not found"))?;

    // **여기서부터 쓰기까지가 한 임계구역이다** ({#cas-toctou}). 락을 **읽기 앞**에 두는 것이 요점이다 —
    // 대조에 쓴 그 바이트가 쓰기 순간까지 유효해야 한다. 이 문지기는 프로세스 경계를 넘고, 플랜 파일을
    // 고치는 모든 진입자(앱의 화해기 포함, {#reconcile-file-guard})가 같은 자리를 잡는다.
    let _guard = plan_guard(&path)?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // 잠금 판정이 **해시 대조보다 먼저**다 — 잠긴 플랜은 어떤 해시로 와도 못 고친다.
    let parsed = parse_plan(&md, plan_id);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(format!(
            "plan '{plan_id}' is locked (status={}) - locked plans cannot be edited",
            parsed.frontmatter.status.as_str()
        ));
    }
    // **`base_hash` 는 필수다** ({#cas-required}) — 선택으로 두면 사고를 내는 호출이 정확히 그것을 안 주는
    // 호출이라 보호가 켜지는 일이 없다. 이름 붙은 우회로도 없다: 정당한 "지금 막 읽었다" 는
    // plan_status · plan_create · 직전 plan_update 응답에서 공짜로 나온다.
    let actual = plan_hash(&md);
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(conflict_message(plan_id, expected, &actual));
    }

    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let now_local = crate::clock::now().to_zoned(resolver.tz.clone());
    let ts = crate::clock::zoned_rfc3339_secs(&now_local);
    let today = now_local.strftime("%Y-%m-%d").to_string();
    // 사람이 쓴 글이 plan 본문 · plan-log 에 원문 그대로 남으므로 본문과 같이 가린다.
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let clean = |s: &str| {
        redact_text(s, &patterns)
            .0
            .replace(['\n', '\r'], " ")
            .trim()
            .to_string()
    };
    // 판정 메모에는 돌린 OS 를 붙인다 — 다른 기기의 앱이 「여기선 아직」을 가린다 (`judge::stamp`).
    let mut note = match (verdict, note_arg) {
        (Some(v), Some(n)) => Some(format!("{v} — {n}")),
        (v, n) => v.or(n.map(str::to_string)),
    }
    .map(|s| clean(&s))
    .map(|s| crate::oculpm::planner::judge::stamp(&s, crate::oculpm::planner::judge::HERE));
    let mut journal_ref = arg_str(args, "journal_path").map(|s| redact_text(s, &patterns).0);

    let mut md = md;
    let mut rows: Vec<LogRow> = Vec::new();
    let mut out = json!({ "plan_id": plan_id });
    let row = |item: &str, from, to, journal_ref: Option<String>, note: Option<String>| LogRow {
        ts: ts.clone(),
        item_id: item.to_string(),
        agent_id: agent_id.clone(),
        from,
        to,
        journal_ref,
        note,
    };

    // ① 상태 바꾸기 — 판정 · 메모 · 일지는 이 행에 실린다.
    if let (Some(item), Some(st)) = (item_id, new_status) {
        let result = set_item_status_rolled(&md, item, st)?;
        md = result.md;
        rows.push(row(
            item,
            Some(result.old_status),
            Some(st),
            journal_ref.take(),
            note.take(),
        ));
        out["item_id"] = json!(item);
        out["from"] = json!(result.old_status.as_str());
        out["to"] = json!(st.as_str());
    }

    // ② 항목 더하기.
    let mut added = Vec::new();
    for (n, a) in adds.into_iter().enumerate() {
        let text = clean(&a.text);
        let (text, anchor) = match crate::oculpm::planner::plan_edit::trailing_anchor(&text) {
            Some((head, id)) if valid_kebab(id) => (head.to_string(), Some(id.to_string())),
            _ => (text.clone(), None),
        };
        let base = match a.id.or(anchor) {
            Some(id) if valid_kebab(&id) => id,
            Some(id) => {
                let fixed = derived_id(&id, format!("item-{}", parsed.items.len() + n + 1));
                received.push(if en {
                    format!("id `{id}` is not kebab-case — used `{fixed}`")
                } else {
                    format!("id `{id}` 가 kebab 이 아니라 `{fixed}` 로 썼어요")
                });
                fixed
            }
            None => derived_id(&text, format!("item-{}", parsed.items.len() + n + 1)),
        };
        let id = unique_id(&md, &base);
        let phase_shown = match &a.parent {
            Some(p) => {
                md = add_child_item(&md, p, &text, &id, a.status)?;
                None
            }
            None => {
                let phase = resolve_phase(&md, plan_id, a.phase.as_deref(), en, &mut received);
                md = add_item(&md, &phase, &text, &id, a.status)?;
                Some(phase)
            }
        };
        let tag = pick(en, "추가", "added");
        rows.push(row(
            &id,
            None,
            Some(a.status),
            journal_ref.take(),
            Some(tag),
        ));
        added.push(json!({ "id": id, "phase": phase_shown, "parent": a.parent }));
    }
    if !added.is_empty() {
        out["added"] = json!(added);
    }

    // ③ 결정 잠그기.
    if let Some(d) = decision {
        let title = clean(&d.title);
        let base =
            d.id.filter(|i| valid_kebab(i))
                .unwrap_or_else(|| derived_id(&title, "decision".to_string()));
        let id = unique_id(&md, &base);
        md = add_decision(
            &md,
            &NewDecision {
                id: &id,
                title: &title,
                body: &redact_text(&d.body, &patterns).0,
                affects: &d.affects,
                date: &today,
                agent: &agent_id,
                en,
            },
        )?;
        let tag = if en {
            format!("decision: {title}")
        } else {
            format!("결정: {title}")
        };
        rows.push(row(&id, None, None, journal_ref.take(), Some(tag)));
        out["decision"] = json!({ "id": id });
    }

    // ④ 상태를 안 바꾼 판정 · 메모 — 항목을 주면 그 항목에, 아니면 플랜 전체(항목 칸 `—`)에.
    if note.is_some() || journal_ref.is_some() {
        rows.push(row(
            item_id.unwrap_or(""),
            None,
            None,
            journal_ref.take(),
            note.take(),
        ));
    }

    for r in &rows {
        md = append_log_row(&md, r);
    }
    // 로그 표가 넘쳤으면 여기서 `<plan_id>.log.md` 로 갈라진다 — 응답의 hash 는 갈라진 뒤 내용이다.
    let with_log = archive_overflow(&planner_root, plan_id, &md)?;
    let check = parse_plan(&with_log, plan_id);
    if !check.warnings.is_empty() && parsed.warnings.is_empty() {
        return Err(format!(
            "internal: this edit would leave the plan with parser warnings - {:?} (nothing was written)",
            check.warnings
        ));
    }
    write_atomic(&path, with_log.as_bytes()).map_err(|e| e.to_string())?;

    // 다음 CAS 의 재료 — 방금 쓴 내용의 해시.
    out["hash"] = json!(plan_hash(&with_log));
    let mut warnings: Vec<String> = new_status
        .and_then(|st| close_nudge(&with_log, plan_id, st))
        .into_iter()
        .collect();
    warnings.extend(self::args::unknown_warning(
        &self::args::unknown_keys(args, &def, &[]),
        en,
    ));
    if !warnings.is_empty() {
        out["warnings"] = json!(warnings);
    }
    if !received.is_empty() {
        out["received"] = json!(received);
    }
    Ok(out)
}

/// `add` 의 phase — 제목이나 `{#id}` 로 찾는다. 안 주면 마지막 단계, 없는 이름이면 새 단계(알린다).
fn resolve_phase(
    md: &str,
    plan_id: &str,
    want: Option<&str>,
    en: bool,
    received: &mut Vec<String>,
) -> String {
    let phases = parse_plan(md, plan_id).phases;
    let Some(want) = want.map(|w| w.trim().trim_start_matches('#')) else {
        return match phases.last() {
            Some(p) => {
                received.push(if en {
                    format!("no `phase` — added under the last phase 「{}」", p.name)
                } else {
                    format!("`phase` 가 없어 마지막 단계 「{}」 에 더했어요", p.name)
                });
                p.name.clone()
            }
            None => pick(en, "할 일", "Tasks"),
        };
    };
    let found = phases.iter().find(|p| {
        p.name == want || p.id.as_deref() == Some(want) || p.name.eq_ignore_ascii_case(want)
    });
    match found {
        Some(p) => p.name.clone(),
        None => {
            received.push(if en {
                format!("no phase 「{want}」 in this plan — made a new one")
            } else {
                format!("단계 「{want}」 가 없어 새로 만들었어요")
            });
            want.to_string()
        }
    }
}

//! `plan_status` · `plan_update` — 플랜 상태 읽기와 CAS 갱신.
//!
//! `tools/mod.rs` 에서 떼어 나왔다 (플랜 `v3-record-integrity`). 이유는 두
//! 가지다: 저 파일이 이미 파일 크기 래칫 위에 있어 한 줄도 못 늘리고, 이
//! Phase 가 더하는 것이 **CAS 프로토콜 한 벌**(해시 발급 → 필수 대조 →
//! 임계구역)이라 한 자리에 모여 있어야 읽히기 때문이다. 옮기기만 한 코드는
//! 그대로 두고, 새로 붙은 것은 주석으로 표시했다.

use super::*;

use crate::oculpm::file_guard::{FileGuard, GuardPolicy};

// ─── plan_status ─────────────────────────────────────────────────────────────

/// `limit` 기본값과 상한. 상한은 '한 번에 다 받겠다'는 호출을 막는 안전핀이다.
const DEFAULT_ITEM_LIMIT: usize = 60;
const MAX_ITEM_LIMIT: usize = 500;

/// `summary` 뷰에서 제외하는 종료 상태.
fn is_terminal(s: ItemStatus) -> bool {
    matches!(s, ItemStatus::Done | ItemStatus::Dropped)
}

/// TSV 한 칸에 들어갈 수 없는 문자를 공백으로 접는다 (열 정합 보호).
pub(crate) fn tsv_cell(s: &str) -> String {
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
pub(crate) fn plan_status(root: &Path, args: &Value) -> Result<Value, String> {
    let view_full = arg_str(args, "view") == Some("full");
    let only_plan = arg_str(args, "plan_id").map(|s| s.to_string());
    let cursor = arg_str(args, "cursor").map(|s| s.to_string());
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, MAX_ITEM_LIMIT))
        .unwrap_or(DEFAULT_ITEM_LIMIT);
    // status 를 지정하면 그것이 뷰보다 강하다 (명시가 기본값을 이긴다).
    let status_filter: Option<Vec<ItemStatus>> = match args.get("status").and_then(Value::as_array)
    {
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
        Err(_) => return Ok(json!({ "plans": [], "note": "no planner folder - no plans yet" })),
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
    let mut rows: Vec<(String, String, &'static str, String, String, String)> = Vec::new();

    for path in paths {
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        let parsed = parse_plan(&md, stem);
        if parsed.frontmatter.status.as_str() != "active" {
            continue; // 잠긴(done/archived) plan 은 갱신 대상이 아니다
        }
        let plan_id = parsed.frontmatter.id.clone();
        if only_plan.as_deref().is_some_and(|want| want != plan_id) {
            continue;
        }

        // 3-depth — done/total 은 리프 기준 (부모는 파생값: progress() 와 동일).
        let parent_ids = parsed.parent_ids();
        let done = parsed
            .items
            .iter()
            .filter(|i| !parent_ids.contains(i.item_id.as_str()))
            .filter(|i| matches!(i.status, ItemStatus::Done))
            .count();
        let total = parsed
            .items
            .iter()
            .filter(|i| !parent_ids.contains(i.item_id.as_str()))
            .count();
        plans.push(json!({
            "id": plan_id,
            "title": parsed.frontmatter.title,
            "progress": { "done": done, "total": total },
            // **CAS 의 재료를 여기서 발급한다** ({#plan-status-hash}). 이전에는
            // `base_hash` 의 유일한 출처가 직전 `plan_update` 응답이라, 세션의
            // **첫** 갱신은 CAS 를 쓸 방법 자체가 없었다 — 그게 가장 흔한
            // 경우다. 플랜이 여럿이면 해시도 플랜마다 달라야 하므로 응답의
            // 공통 자리가 아니라 이 행에 붙인다.
            "hash": plan_hash(&md),
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
                    i.parent_item.clone().unwrap_or_default(),
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
            None => {
                return Err(format!(
                    "cursor '{c}' not found - call again from the start"
                ))
            }
        },
        None => 0,
    };
    let end = (start + limit).min(total);
    let page = &rows[start..end];

    // 3-depth — parent 열: 하위 항목이면 부모 item id, 최상위면 빈칸.
    let mut tsv = String::from("plan\titem\tst\tphase\ttitle\tparent");
    for (plan_id, item_id, tok, phase, title, parent) in page {
        tsv.push('\n');
        tsv.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}",
            tsv_cell(plan_id),
            tsv_cell(item_id),
            tok,
            tsv_cell(phase),
            tsv_cell(title),
            tsv_cell(parent)
        ));
    }

    let mut out = json!({
        "plans": plans,
        "items_tsv": tsv,
        "legend": "st: ' '=todo ~=in_progress x=done !=blocked >=deferred -=dropped (디스크 글리프와 동일 — 단 parent 열이 비지 않은 하위를 가진 부모 행의 st 는 하위 롤업 파생값)",
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

pub(crate) fn parse_item_status(s: &str) -> Result<ItemStatus, String> {
    Ok(match s {
        "todo" => ItemStatus::Todo,
        "in_progress" => ItemStatus::InProgress,
        "done" => ItemStatus::Done,
        "blocked" => ItemStatus::Blocked,
        "deferred" => ItemStatus::Deferred,
        "dropped" => ItemStatus::Dropped,
        other => {
            return Err(format!(
                "invalid status '{other}' (todo|in_progress|done|blocked|deferred|dropped)"
            ))
        }
    })
}

pub(crate) fn plan_update(root: &Path, args: &Value) -> Result<Value, String> {
    let plan_id = arg_str(args, "plan_id").ok_or("'plan_id' is required")?;
    let item_id = arg_str(args, "item_id")
        .ok_or("'item_id' is required")?
        .trim_start_matches('#');
    let new_status = parse_item_status(arg_str(args, "status").ok_or("'status' is required")?)?;
    let agent_id = arg_str(args, "agent_id")
        .map(str::to_string)
        .unwrap_or_else(default_agent_id);

    // **`base_hash` 는 필수다** ({#cas-required}).
    //
    // `session-shim-cli` 라운드는 이것을 선택 인자로 넣었다 — 기존 호출자를
    // 깨지 않으려는 판단이었다. 이번 감사에서 그 선택이 곧 실효 0 이라는 것이
    // 드러났다: 주지 않는 것이 옵트아웃이면, 병렬 세션 사고를 내는 호출은
    // **정확히 주지 않은 호출**이므로 보호가 켜지는 일이 없다. 안전장치를
    // 선택으로 두면 그것은 안전장치가 아니라 문서다.
    //
    // **하위호환은 깨는 쪽을 골랐다.** 낡은 호출자는 조용히 옛 동작으로
    // 흐르는 대신 여기서 멈추고, 오류가 다음 행동(`plan_status` 로 hash 를 읽고
    // 다시 부르기)까지 말한다. 에이전트에게는 그 문장이 곧 마이그레이션
    // 경로다 — 사람이 모든 프롬프트 사본을 고치기 전에도 스스로 복구한다.
    //
    // 이름 붙은 강제 우회로는 **두지 않았다.** 우회 플래그가 있으면 계약이 둘이
    // 되고, 마찰을 만나는 쪽은 늘 그 둘째 계약을 고른다. 정당한 "지금 막 읽었다"
    // 는 이미 세 곳에서 공짜로 나온다 — `plan_status.plans[].hash`,
    // `plan_create.hash`, 직전 `plan_update.hash`.
    let expected = arg_str(args, "base_hash").ok_or_else(|| missing_base_hash(plan_id))?;

    let planner_root = planner_dir(root);
    let path = find_plan_path(&planner_root, plan_id)
        .ok_or_else(|| format!("plan '{plan_id}' not found"))?;

    // **여기서부터 쓰기까지가 한 임계구역이다** ({#cas-toctou}).
    //
    // 예전에는 해시 비교와 `write_atomic` 사이에 아무 것도 없어서, 그 틈에 남이
    // 쓰면 CAS 가 통째로 무의미했다 — 두 호출이 같은 내용을 읽고 둘 다 대조를
    // 통과한 뒤 나중 쓴 쪽이 앞의 것을 덮는다. 락을 **읽기 앞**에 두는 것이
    // 요점이다: 대조에 쓴 그 바이트가 쓰기 순간까지 유효해야 한다.
    //
    // 락만으로 닫힌다 — 안에서 다시 읽어 재검증할 필요가 없다. 이 문지기는
    // 프로세스 경계를 넘고(파일 생성), 플랜 파일을 고치는 이 경로의 모든
    // 진입자가 같은 자리를 잡기 때문이다. 단, **앱 내부의 화해기
    // (`oculpm::reconcile`)는 아직 인프로세스 `plan_write_lock` 만 쓴다** —
    // 그쪽은 이 문지기 밖이라 남은 창이다 (후속으로 넘김).
    let _guard = plan_guard(&path)?;

    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // 잠금 판정이 **해시 대조보다 먼저**다. 잠긴 플랜은 어떤 해시로 와도 못
    // 고치므로, 순서가 반대면 호출자는 "다시 읽고 재시도하라"는 안내를 받아
    // 한 왕복을 더 쓴 끝에 결국 같은 거절을 만난다.
    let parsed = parse_plan(&md, plan_id);
    if parsed.frontmatter.status.as_str() != "active" {
        return Err(format!(
            "plan '{plan_id}' is locked (status={}) - locked plans cannot be edited",
            parsed.frontmatter.status.as_str()
        ));
    }

    let actual = plan_hash(&md);
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(conflict_message(plan_id, expected, &actual));
    }

    let result = set_item_status_rolled(&md, item_id, new_status)?;
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
        // 다음 CAS 의 재료 — 방금 쓴 내용의 해시. 이걸 안 주면 호출자가 파일을
        // 다시 읽어야 하고, 그 사이가 또 창이 된다.
        "hash": plan_hash(&with_log),
    }))
}

// ─── CAS 부속 ────────────────────────────────────────────────────────────────

/// 플랜 파일 내용의 blake3 hex — `base_hash` 가 가리키는 바로 그 값.
///
/// 발급하는 자리(`plan_status`·`plan_create`·`plan_update` 응답)와 대조하는
/// 자리가 **같은 함수**를 써야 한다. 한쪽이 원본 바이트를, 다른 쪽이 정규화된
/// 문자열을 해싱하면 아무도 CAS 를 통과하지 못한다.
pub(crate) fn plan_hash(md: &str) -> String {
    blake3::hash(md.as_bytes()).to_hex().to_string()
}

/// 플랜 하나를 지키는 크로스프로세스 문지기.
///
/// **자리**: 지키는 파일 옆(`.oculpm/planner/.<파일명>.lock`). `.oculpm/index/**`
/// 는 앱이 관리하는 파생물이라 피했고, `.oculpm/` 바로 아래에 새 폴더를 파면
/// 워처의 라우팅표(`data_area_for_path`)에 없는 경로라 코드 변경 ndjson 파이프
/// 라인까지 흘러 들어가 락 파일 생성·삭제가 변경 원장을 오염시킨다. `planner/`
/// 는 이미 "다시 읽어라" 신호만 내고 끊기는 구역이고, 어차피 같은 호출이 진짜
/// 쓰기로 그 신호를 한 번 더 낸다 — 같은 디바운스 창 안이라 사실상 공짜다.
/// 점으로 시작해 `*.md` 만 읽는 플랜 스캔에도 걸리지 않는다.
///
/// **경합은 잠깐 기다린다.** 임계구간이 밀리초인데 부딪혔다는 이유만으로
/// 충돌을 돌려주면, 정상 동시성이 CAS 충돌로 둔갑해 호출자가 "그냥 다시
/// 부르면 된다"를 배운다. 그 학습이 CAS 를 무력화한다.
fn plan_guard(plan_path: &Path) -> Result<FileGuard, String> {
    let name = plan_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("plan.md");
    let lock = plan_path.with_file_name(format!(".{name}.lock"));
    FileGuard::acquire(&lock, Utc::now(), GuardPolicy::waiting(2_000)).map_err(|e| {
        // 문지기를 못 잡았으면 **쓰지 않는다.** 조용히 진행하면 락이 없는 것보다
        // 나쁘다 — 보호받는다고 믿으면서 보호받지 못한다.
        format!(
            "{} plan '{}' 을 지금 쓸 수 없습니다: {e}. 다른 세션이 같은 플랜을 고치는 중입니다 — \
             잠시 뒤 plan_status 로 현재 hash 를 다시 읽고 base_hash 로 넘겨 재시도하세요.",
            crate::oculpm::agent_cli::WRITE_CONFLICT_PREFIX,
            plan_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("?")
        )
    })
}

/// `base_hash` 를 안 줬을 때 — **무엇을 하라는지**까지 말한다.
///
/// 이 오류는 쓰기 충돌이 아니므로 [`WRITE_CONFLICT_PREFIX`] 를 달지 않는다
/// (CLI exit 5 는 "그 사이 남이 고쳤다" 라는 뜻이어야 계약이 유지된다).
///
/// [`WRITE_CONFLICT_PREFIX`]: crate::oculpm::agent_cli::WRITE_CONFLICT_PREFIX
fn missing_base_hash(plan_id: &str) -> String {
    format!(
        "'base_hash' is required — plan_status 로 '{plan_id}' 의 현재 hash 를 읽고 그 값을 \
         base_hash 로 넘겨 다시 호출하세요 (plan_status 응답의 plans[].hash, 또는 직전 \
         plan_create/plan_update 응답의 hash 를 그대로 쓰면 됩니다). 병렬 세션이 같은 플랜을 \
         고칠 때 한쪽 변경이 조용히 사라지는 것을 막는 장치라 생략할 수 없습니다."
    )
}

/// 해시가 어긋났을 때 — 현재 hash 와 재시도 절차를 함께 싣는다.
///
/// 현재 hash 를 주는 것이 "그대로 다시 부르라"는 뜻은 아니다. 그 사이 항목이
/// 이미 다른 상태로 갔을 수 있으므로 **다시 읽어 판단**하는 것이 먼저다 —
/// 그래도 값을 실어 주는 것은, 안 실으면 호출자가 파일을 다시 읽어야 하고 그
/// 사이가 또 창이 되기 때문이다.
fn conflict_message(plan_id: &str, expected: &str, actual: &str) -> String {
    format!(
        "{} plan '{plan_id}' changed since you read it (expected {expected}, now {actual}) — \
         그 사이 다른 세션이 이 플랜을 고쳤습니다. ① plan_status 로 다시 읽어 그 항목이 아직 \
         네가 생각한 상태인지 확인하고 ② 여전히 필요하면 base_hash={actual} 로 다시 호출하세요. \
         아무것도 쓰지 않았습니다.",
        crate::oculpm::agent_cli::WRITE_CONFLICT_PREFIX
    )
}

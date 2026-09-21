//! `plan_create` — 새 플랜 파일 생성과 재사용 권고.
//!
//! `tools/mod.rs` 에서 떼어 나왔다 (`plan_ops.rs` 와 같은 이유 — 저 파일은
//! 크기 래칫 위라 한 줄도 못 늘린다). 옮기기만 한 코드는 그대로 두고, 새로
//! 붙은 것은 재사용 권고(`similar_active_plans`, `{#dedupe-on-create}`)다.

use super::*;

// ─── plan_create ─────────────────────────────────────────────────────────────

/// 플랜 규모 상한 — 한 호출로 거대 계획을 욱여넣는 것 방지 (TK0).
const MAX_PLAN_PHASES: usize = 20;
const MAX_PLAN_ITEMS: usize = 120;

/// frontmatter/{#id} 에 쓰는 kebab 검증 — sanitize 가 아니라 거부 (id 는
/// 에이전트가 안정적으로 재참조해야 하므로 조용한 변형이 더 위험하다).
fn valid_kebab(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && !s.starts_with('-')
        && !s.ends_with('-')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// used 에 없는 id 를 확보한다 (충돌 시 -2, -3 … 접미).
fn claim_unique_id(used: &mut std::collections::HashSet<String>, base: String) -> String {
    if used.insert(base.clone()) {
        return base;
    }
    let mut n = 2usize;
    loop {
        let cand = format!("{base}-{n}");
        if used.insert(cand.clone()) {
            return cand;
        }
        n += 1;
    }
}

/// 재사용 권고의 후보 한 줄.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SimilarPlan {
    pub id: String,
    pub title: String,
    pub hash: String,
}

/// 두 토큰 집합이 같은 일을 가리키는가 — 자카드 유사도 문턱.
const SIMILAR_JACCARD: f64 = 0.5;

/// 제목·id 를 비교용 토큰으로. 소문자, 글자/숫자 경계로 자르고, 숫자만인
/// 토큰(날짜·라운드 번호)과 한 글자는 버린다 — "라운드 2026-09-12" 와
/// "라운드 2026-09-15" 가 다른 계획으로 읽히면 이 검사는 아무것도 못 잡는다.
pub(crate) fn similarity_tokens(s: &str) -> std::collections::HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .filter(|t| !t.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string)
        .collect()
}

pub(crate) fn jaccard(
    a: &std::collections::HashSet<String>,
    b: &std::collections::HashSet<String>,
) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f64;
    let union = a.union(b).count() as f64;
    inter / union
}

/// 새 (id, 제목) 과 겹치는 **활성** 플랜들. 잠긴(done/archived) 플랜은 갱신
/// 대상이 아니므로 세지 않는다 — 라운드가 끝나 잠근 뒤 같은 이름으로 다음
/// 라운드를 여는 건 정상 경로다.
pub(crate) fn similar_active_plans(
    planner_root: &Path,
    plan_id: &str,
    title: &str,
) -> Vec<SimilarPlan> {
    let new_id = similarity_tokens(plan_id);
    let new_title = similarity_tokens(title);
    let Ok(entries) = std::fs::read_dir(planner_root) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries
        .flatten()
        .map(|f| f.path())
        .filter(|p| crate::oculpm::planner::log_archive::is_plan_path(p))
        .collect();
    paths.sort();
    let mut out = Vec::new();
    for path in paths {
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("plan");
        let parsed = parse_plan(&md, stem);
        if crate::oculpm::planner::log_archive::is_archive_markdown(&md)
            || parsed.frontmatter.status.as_str() != "active"
        {
            continue;
        }
        let id_score = jaccard(&new_id, &similarity_tokens(&parsed.frontmatter.id));
        let title_score = jaccard(&new_title, &similarity_tokens(&parsed.frontmatter.title));
        if id_score >= SIMILAR_JACCARD || title_score >= SIMILAR_JACCARD {
            out.push(SimilarPlan {
                id: parsed.frontmatter.id.clone(),
                title: parsed.frontmatter.title.clone(),
                hash: plan_hash(&md),
            });
        }
    }
    out
}

/// TK0 — 새 plan 파일 생성. §7 의 "새 plan 템플릿" 을 서버가 규격대로 조립해
/// frontmatter 누락(title 경고)·{#id} 줄바꿈 파손 같은 자기신고 오류를 원천
/// 차단한다. 슬림 템플릿(TK1)이 §7 생성 규격을 들어낼 수 있는 전제 조건.
pub(crate) fn plan_create(root: &Path, args: &Value) -> Result<Value, String> {
    let plan_id = arg_str(args, "plan_id").ok_or("'plan_id' is required")?;
    if !valid_kebab(plan_id) {
        return Err(format!(
            "plan_id '{plan_id}' must be kebab-case, 40 chars or fewer"
        ));
    }
    let fallback_agent_id = default_agent_id();
    let agent_id = arg_str(args, "agent_id").unwrap_or(&fallback_agent_id);
    if !agent_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
    {
        return Err(format!(
            "agent_id '{agent_id}' contains disallowed characters"
        ));
    }
    let phases_in = args
        .get("phases")
        .and_then(Value::as_array)
        .ok_or("'phases' is required")?;
    if phases_in.is_empty() || phases_in.len() > MAX_PLAN_PHASES {
        return Err(format!("phases must number 1-{MAX_PLAN_PHASES}"));
    }

    let planner_root = planner_dir(root);
    if planner_root.join(format!("{plan_id}.md")).exists()
        || find_plan_path(&planner_root, plan_id).is_some()
    {
        return Err(format!(
            "plan '{plan_id}' already exists - use plan_update to change it, or a different id for a new plan"
        ));
    }

    let cfg = load_config(root);
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let one_line = |s: &str| {
        redact_text(s, &patterns)
            .0
            .replace(['\n', '\r'], " ")
            .trim()
            .to_string()
    };
    let title = one_line(arg_str(args, "title").ok_or("'title' is required")?);

    // 재사용 권고 ({#dedupe-on-create}) — 같은 일을 다루는 활성 플랜이 이미
    // 있으면 새 파일 대신 그쪽 항목을 늘리는 게 맞다. 이 저장소에서 잠긴 플랜
    // 20개에 미완 63건이 쌓인 경로가 정확히 "라운드마다 새 플랜" 이었다.
    let allow_similar = args
        .get("allow_similar")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !allow_similar {
        let similar = similar_active_plans(&planner_root, plan_id, &title);
        if !similar.is_empty() {
            let listed = similar
                .iter()
                .map(|p| format!("{} 「{}」 (hash {})", p.id, p.title, p.hash))
                .collect::<Vec<_>>()
                .join(" · ");
            return Err(format!(
                "similar active plan(s) exist - prefer adding items there with plan_update: {listed}. \
                 If this is genuinely a separate plan, call again with allow_similar: true"
            ));
        }
    }

    let mut used_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let empty: Vec<Value> = Vec::new();
    let mut body = String::new();
    let mut item_count = 0usize;
    for (pi, phase) in phases_in.iter().enumerate() {
        let ptitle_raw = phase
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("phases[{pi}].title is required"))?;
        let pid = match phase.get("id").and_then(Value::as_str).map(str::trim) {
            Some(s) if !s.is_empty() => {
                if !valid_kebab(s) {
                    return Err(format!("phase id '{s}' must be kebab-case"));
                }
                claim_unique_id(&mut used_ids, s.to_string())
            }
            _ => claim_unique_id(&mut used_ids, format!("p{}", pi + 1)),
        };
        body.push_str(&format!("\n## {} {{#{pid}}}\n", one_line(ptitle_raw)));

        let items = phase
            .get("items")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        for (ii, item) in items.iter().enumerate() {
            item_count += 1;
            if item_count > MAX_PLAN_ITEMS {
                return Err(format!("Too many items (limit {MAX_PLAN_ITEMS})"));
            }
            let text_raw = item
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("phases[{pi}].items[{ii}].text is required"))?;
            let text = one_line(text_raw);
            let iid = match item.get("id").and_then(Value::as_str).map(str::trim) {
                Some(s) if !s.is_empty() => {
                    if !valid_kebab(s) {
                        return Err(format!("item id '{s}' must be kebab-case"));
                    }
                    claim_unique_id(&mut used_ids, s.to_string())
                }
                _ => {
                    // 텍스트에서 유도 — 한글뿐이면 빈 slug 가 되므로 위치 기반 폴백.
                    let derived = sanitize_slug(&text)
                        .ok()
                        .map(|s| s.chars().take(40).collect::<String>())
                        .map(|s| s.trim_end_matches('-').to_string())
                        .filter(|s| !s.is_empty());
                    claim_unique_id(
                        &mut used_ids,
                        derived.unwrap_or_else(|| format!("{pid}-{}", ii + 1)),
                    )
                }
            };
            body.push_str(&format!("- [ ] {text} {{#{iid}}}\n"));

            // 3-depth — 하위 작업 (두 칸 들여쓰기, 최대 1단계).
            let children = item
                .get("children")
                .and_then(Value::as_array)
                .unwrap_or(&empty);
            for (ci, child) in children.iter().enumerate() {
                item_count += 1;
                if item_count > MAX_PLAN_ITEMS {
                    return Err(format!("Too many items (limit {MAX_PLAN_ITEMS})"));
                }
                if child.get("children").is_some() {
                    return Err(format!(
                        "phases[{pi}].items[{ii}].children[{ci}] cannot have children - nesting is one level deep"
                    ));
                }
                let ctext_raw = child
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        format!("phases[{pi}].items[{ii}].children[{ci}].text is required")
                    })?;
                let ctext = one_line(ctext_raw);
                let cid = match child.get("id").and_then(Value::as_str).map(str::trim) {
                    Some(s) if !s.is_empty() => {
                        if !valid_kebab(s) {
                            return Err(format!("child id '{s}' must be kebab-case"));
                        }
                        claim_unique_id(&mut used_ids, s.to_string())
                    }
                    _ => {
                        let derived = sanitize_slug(&ctext)
                            .ok()
                            .map(|s| s.chars().take(40).collect::<String>())
                            .map(|s| s.trim_end_matches('-').to_string())
                            .filter(|s| !s.is_empty());
                        claim_unique_id(
                            &mut used_ids,
                            derived.unwrap_or_else(|| format!("{iid}-{}", ci + 1)),
                        )
                    }
                };
                body.push_str(&format!("  - [ ] {ctext} {{#{cid}}}\n"));
            }
        }
    }

    let resolver = resolver_of(&cfg);
    let today = Utc::now().with_timezone(&resolver.tz).format("%Y-%m-%d");
    let yaml_title = title.replace('\\', "\\\\").replace('"', "\\\"");
    let mut md = format!(
        "---\noculpm_plan: v1\nid: {plan_id}\ntitle: \"{yaml_title}\"\nstatus: active\n\
         created: {today}\nupdated: {today}\nowner: {agent_id}\n---\n"
    );
    if let Some(desc) = arg_str(args, "description") {
        let desc = redact_text(desc, &patterns).0;
        md.push_str(&format!("\n{}\n", desc.trim()));
    }
    md.push_str(&body);
    md.push_str(
        "\n<!-- oculpm:plan-log begin v1 -->\n\
         | 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n\
         |---|---|---|---|---|---|\n\
         <!-- oculpm:plan-log end -->\n",
    );

    // 자기 검증 — 방금 조립한 마크다운이 파서 경고 0 으로 읽혀야 규격 보증이
    // 말이 된다. 실패는 구현 버그이므로 파일을 쓰지 않고 에러로 노출한다.
    let parsed = parse_plan(&md, plan_id);
    if !parsed.warnings.is_empty() {
        return Err(format!(
            "internal: the generated file produced parser warnings - {:?}",
            parsed.warnings
        ));
    }

    std::fs::create_dir_all(&planner_root).map_err(|e| format!("mkdir failed: {e}"))?;
    let path = planner_root.join(format!("{plan_id}.md"));
    write_atomic(&path, md.as_bytes()).map_err(|e| e.to_string())?;

    Ok(json!({
        "path": format!(".oculpm/planner/{plan_id}.md"),
        "id": plan_id,
        "phases": phases_in.len(),
        "items": item_count,
        // 만든 직후의 첫 `plan_update` 가 CAS 를 쓸 수 있게 ({#cas-required}).
        // 없으면 방금 자기가 만든 파일을 다시 조회해야 하고, 그 왕복이 곧
        // "귀찮으니 안 쓴다"의 이유가 된다.
        "hash": plan_hash(&md),
    }))
}

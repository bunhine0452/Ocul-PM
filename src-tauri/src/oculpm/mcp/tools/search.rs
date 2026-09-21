//! MCP 도구 `journal_search` — 과거 일지 찾기.
//!
//! `tools/mod.rs` 에서 갈라 나왔다 ({#search-cache}). 그 파일은 1,197줄로 이미
//! 래칫 위였고, 여기 붙는 것은 "후보를 어디서 모으는가"라는 **두 번째 경로**라
//! 옮겨 두면 두 경로가 나란히 보인다.
//!
//! # 두 경로, 하나의 랭킹
//!
//! * **캐시** — 앱 SQLite(`oculpm_journal*`)를 읽기 전용으로 연다. 727건 기준
//!   파일을 한 개도 열지 않는다.
//! * **디스크** — 캐시를 못 쓰는 모든 경우. 경로로 먼저 거르고 남은 것만 읽는다.
//!
//! 어느 길이었는지는 응답의 `source` 칸이 말한다 — 검색 결과가 이상할 때
//! "어디서 읽었냐"를 먼저 물을 수 있어야 한다.
//!
//! 점수·정렬·`why` 는 두 경로 모두 [`crate::oculpm::journal_search::rank`] 가
//! 정한다 ({#search-rank}).

use std::path::Path;

use serde_json::{json, Value};

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::journal_search::cache::{self, CacheHandle, SqlFilters};
use crate::oculpm::journal_search::{rank, tokenize, SearchRow};
use crate::oculpm::manager::entry_type_filename_token;
use crate::oculpm::markdown::parse_body;
use crate::oculpm::redact::{compile_redact_patterns, redact_text};
use crate::oculpm::spec::{EntryStatus, EntryType};

use super::plan_ops::tsv_cell;
use super::{arg_str, load_config, parse_entry_status, parse_entry_type, str_array};

// 요약 층 히트 (`{#rollup-first}`). `tools/mod.rs` 가 아니라 여기서 선언하는
// 이유는 크기 래칫이다 — 그 파일은 이미 한계 위라 `mod` 한 줄도 못 늘린다.
// `search.rs` 의 하위 모듈은 `tools/search/` 에 산다 (Rust 2018 모듈 규칙).
mod rollup_hits;

/// 히트 수 기본값과 상한. `plan_status` 의 상한과 같은 이유의 안전핀이다 —
/// "한 번에 다 받겠다" 는 호출이 에이전트 컨텍스트를 통째로 먹는 걸 막는다.
pub(crate) const DEFAULT_HIT_LIMIT: usize = 20;
pub(crate) const MAX_HIT_LIMIT: usize = 50;

/// `20260821/Bugs/1842_bug_slug.md` 의 첫 세그먼트에서 workday 를 꺼낸다.
pub(crate) fn workday_of_rel(rel: &str) -> Option<&str> {
    crate::oculpm::paths::workday_of_rel(rel)
}

/// 파일명 `HHMM_<type>_<slug>.md` 의 type 토큰.
pub(crate) fn type_token_of_rel(rel: &str) -> Option<&'static str> {
    crate::oculpm::paths::type_token_of_rel(rel)
}

/// 사용자가 준 경로를 `.oculpm/journal/` 기준 상대경로로 정규화한다.
/// `journal_search` 가 돌려준 형태와 사람이 복붙하는 형태를 모두 받는다.
pub(crate) fn normalize_entry_rel(input: &str) -> String {
    let mut s = input.trim().replace('\\', "/");
    for prefix in ["./", ".oculpm/", "journal/"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
        }
    }
    s
}

/// 일지 경로로 인정할 수 있는 모양인가. `walk_journal` 의 스킵 규칙과 같은
/// 어휘를 쓰고, 여기에 경로 탈출 방어를 더한다 — 이 값은 사용자(=에이전트)가
/// 준 문자열이고 곧바로 파일 경로가 되기 때문이다.
pub(crate) fn is_safe_entry_rel(rel: &str) -> bool {
    if rel.is_empty() || !rel.ends_with(".md") {
        return false;
    }
    if rel.starts_with('/') || rel.contains(':') {
        return false; // 절대경로 · 윈도우 드라이브
    }
    rel.split('/')
        .all(|seg| !seg.is_empty() && seg != ".." && !seg.starts_with('.'))
}

/// 도구 인자를 접은 것 — 두 경로가 같은 값을 본다.
struct Args {
    tokens: Vec<String>,
    file: Option<String>,
    since: Option<String>,
    until: Option<String>,
    types: Vec<EntryType>,
    status: Vec<EntryStatus>,
    tags: Vec<String>,
    limit: usize,
}

fn parse_args(args: &Value) -> Result<Args, String> {
    Ok(Args {
        tokens: tokenize(arg_str(args, "query")),
        file: arg_str(args, "file")
            .map(|s| s.replace('\\', "/").to_lowercase())
            .filter(|s| !s.is_empty()),
        since: arg_str(args, "since").map(str::to_string),
        until: arg_str(args, "until").map(str::to_string),
        types: str_array(args, "types")
            .iter()
            .map(|s| parse_entry_type(s))
            .collect::<Result<Vec<_>, _>>()?,
        status: str_array(args, "status")
            .iter()
            .map(|s| parse_entry_status(s))
            .collect::<Result<Vec<_>, _>>()?,
        tags: str_array(args, "tags")
            .iter()
            .map(|s| s.to_lowercase())
            .collect(),
        limit: args
            .get("limit")
            .and_then(Value::as_u64)
            .map(|n| (n as usize).clamp(1, MAX_HIT_LIMIT))
            .unwrap_or(DEFAULT_HIT_LIMIT),
    })
}

/// 과거 일지 검색.
pub(crate) fn journal_search(root: &Path, args: &Value) -> Result<Value, String> {
    let handle = cache::open_for_root(root);
    journal_search_with(root, args, handle.as_ref())
}

/// 캐시 핸들을 밖에서 주입할 수 있는 판 — 테스트가 **캐시 경로 자체**를 물게
/// 한다. 환경변수 우회로를 뚫지 않는 이유는 병렬 테스트가 서로의 환경을 흔들기
/// 때문이다.
pub(crate) fn journal_search_with(
    root: &Path,
    args: &Value,
    cache: Option<&CacheHandle>,
) -> Result<Value, String> {
    let parsed = parse_args(args)?;
    let (rows, source) = match cache {
        Some(handle) => (collect_from_cache(handle, &parsed)?, "cache"),
        None => (collect_from_disk(root, &parsed), "disk"),
    };
    let scanned = rows.len();

    let cfg = load_config(root);
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);

    let scored = rank(rows, &parsed.tokens);
    let total = scored.len();
    let shown = scored.len().min(parsed.limit);

    let mut tsv = String::from("path\tdate\ttype\tst\ttitle\twhy");
    for hit in scored.iter().take(parsed.limit) {
        let (title, _) = redact_text(&hit.row.title, &patterns);
        let (why, _) = redact_text(&hit.why(), &patterns);
        tsv.push('\n');
        tsv.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}",
            tsv_cell(&hit.row.relative_path),
            hit.row.workday,
            hit.row.type_token,
            hit.row.status_token,
            tsv_cell(&title),
            tsv_cell(&why)
        ));
    }

    // 요약 층을 **먼저** 본다 (`{#rollup-first}`). 원본 히트는 그대로 두고
    // 별도 배열로 얹는다 — 섞으면 "먼저 읽을 것"이라는 신호가 사라진다.
    let rollups = rollup_hits::rollup_hits(root, &parsed.tokens, &patterns);

    let mut out = json!({
        "hits_tsv": tsv,
        "returned": shown,
        "total_matched": total,
        "more": total > shown,
        "scanned": scanned,
        "source": source,
        "legend": "why: 본문 매치는 발췌, 그 외는 매치한 자리(title/tag:…/slug/path:…/file:…). 본문 전체는 journal_read 로.",
    });
    if !rollups.is_empty() {
        out["rollups"] = json!(rollups);
        out["rollups_hint"] = json!(
            "주간 요약이 같은 질의에 걸렸습니다 — 개별 일지보다 먼저 journal_read 로 펼쳐 그 주의 맥락을 잡으세요."
        );
    }
    if total == 0 {
        out["note"] = json!(
            "일치하는 일지가 없습니다. query 를 짧게 하거나(부분 일치), file 필터를 파일명만으로 좁혀 보세요."
        );
    } else if total > shown {
        out["note"] =
            json!("limit 을 넘겼습니다 — 관련도 상위만 실렸습니다. 더 좁히거나 limit 을 올리세요.");
    }
    Ok(out)
}

/// 캐시 경로 — 구조 필터는 SQL 이, 질의 매칭은 랭킹이 한다.
fn collect_from_cache(handle: &CacheHandle, args: &Args) -> Result<Vec<SearchRow>, String> {
    let filters = SqlFilters {
        types: args
            .types
            .iter()
            .map(|t| entry_type_filename_token(*t).to_string())
            .collect(),
        status: args
            .status
            .iter()
            .map(|s| super::entry_status_token(*s).to_string())
            .collect(),
        tags: args.tags.clone(),
        file: args.file.clone(),
        since: args.since.clone(),
        until: args.until.clone(),
    };
    cache::fetch_rows(&handle.conn, handle.project_id, &filters)
        .map_err(|e| format!("캐시 조회 실패: {e}"))
}

/// 디스크 경로 — 경로만으로 거를 수 있는 것(기간·종류)을 먼저 걸러 파일을 여는
/// 횟수 자체를 줄이고, 남은 것만 읽어 frontmatter 로 판정한다.
fn collect_from_disk(root: &Path, args: &Args) -> Vec<SearchRow> {
    let journal_root = root.join(".oculpm").join("journal");
    let mut rels: Vec<String> = crate::oculpm::cache::walk_journal(&journal_root)
        .into_iter()
        .map(|(rel, _mtime)| rel)
        .collect();
    // 최신순. 경로가 `YYYYMMDD/Folder/HHMM_…` 라 문자열 역순이 곧 시간 역순이고,
    // 파일을 열지 않고 정할 수 있어 결정적이다 (mtime 은 체크아웃마다 바뀐다).
    rels.sort_unstable_by(|a, b| b.cmp(a));

    let mut rows: Vec<SearchRow> = Vec::new();
    for rel in &rels {
        // ── 경로만으로 거르기 (파일을 열지 않는다) ──────────────────────────
        let workday = workday_of_rel(rel).unwrap_or("");
        if let Some(s) = &args.since {
            if workday < s.as_str() {
                continue;
            }
        }
        if let Some(u) = &args.until {
            if workday > u.as_str() {
                continue;
            }
        }
        if !args.types.is_empty() {
            // 토큰을 못 읽는 파일은 거르지 않고 통과시켜 frontmatter 로 판정한다.
            if let Some(tok) = type_token_of_rel(rel) {
                if !args
                    .types
                    .iter()
                    .any(|t| entry_type_filename_token(*t) == tok)
                {
                    continue;
                }
            }
        }

        // ── 파일을 읽어야만 알 수 있는 것 ──────────────────────────────────
        let Ok(raw) = std::fs::read_to_string(journal_root.join(rel)) else {
            continue;
        };
        let (fm, body) = parse_frontmatter_and_body(&raw);
        let parsed = parse_body(&body);

        // frontmatter 가 깨진 일지도 검색 대상이다 — 오히려 그런 것이 잊히기
        // 쉽다. 파싱된 값이 있을 때만 그 값으로 거른다.
        let entry_type = fm.parsed.as_ref().map(|f| f.entry_type);
        let status = fm.parsed.as_ref().map(|f| f.status);
        if !args.types.is_empty() {
            match entry_type {
                Some(t) if args.types.contains(&t) => {}
                Some(_) => continue,
                // 파싱 실패 — 파일명 토큰이 통과시킨 것이므로 남긴다.
                None if type_token_of_rel(rel).is_none() => continue,
                None => {}
            }
        }
        if !args.status.is_empty() && !status.is_some_and(|s| args.status.contains(&s)) {
            continue;
        }

        let tags: Vec<String> = fm
            .parsed
            .as_ref()
            .map(|f| f.tags.clone())
            .unwrap_or_default();
        if !args
            .tags
            .iter()
            .all(|w| tags.iter().any(|t| t.to_lowercase() == *w))
        {
            continue;
        }

        let files: Vec<String> = fm
            .parsed
            .as_ref()
            .map(|f| f.files_touched.iter().map(|ft| ft.path.clone()).collect())
            .unwrap_or_default();
        // files_touched 필터 — 에이전트가 가장 자주 던지는 질문("이 파일 전에
        // 왜 건드렸지")이 여기로 답해진다.
        let mut file_hit = None;
        if let Some(want) = &args.file {
            match files
                .iter()
                .find(|p| p.replace('\\', "/").to_lowercase().contains(want))
            {
                Some(p) => file_hit = Some(p.clone()),
                None => continue,
            }
        }

        rows.push(SearchRow {
            relative_path: rel.clone(),
            workday: workday.to_string(),
            type_token: entry_type
                .map(entry_type_filename_token)
                .unwrap_or_else(|| type_token_of_rel(rel).unwrap_or("?"))
                .to_string(),
            status_token: status
                .map(super::entry_status_token)
                .unwrap_or("?")
                .to_string(),
            title: parsed.title.clone(),
            slug: fm
                .parsed
                .as_ref()
                .map(|f| f.slug.clone())
                .unwrap_or_default(),
            tags,
            files,
            body,
            file_hit,
        });
    }
    rows
}

/// 롤업 경로인가 — `rollups/2026-W38.md` (접두사는 `normalize_entry_rel` 이
/// 이미 걷었다). 이 한 술어가 `journal_read` 의 뿌리를 가른다.
fn is_rollup_rel(rel: &str) -> bool {
    rel.starts_with("rollups/") && rel[("rollups/".len())..].split('/').count() == 1
}

/// 일지 1건 전문. `{#rollup-first}` 이후로 **주간 요약도 같은 문으로** 읽는다
/// — 에이전트가 도구를 하나 더 배우지 않아도 요약 층에 닿는다.
pub(crate) fn journal_read(root: &Path, args: &Value) -> Result<Value, String> {
    let input = arg_str(args, "path").ok_or("'path' is required")?;
    let rel = normalize_entry_rel(input);
    if !is_safe_entry_rel(&rel) {
        return Err(format!(
            "'{input}' 은 일지 경로로 인정되지 않습니다 — journal_search 응답의 path 를 그대로 넘기세요 \
             (예: 20260821/Bugs/1842_bug_live-refresh.md, 또는 rollups/2026-W38.md)."
        ));
    }
    if is_rollup_rel(&rel) {
        return rollup_read(root, &rel);
    }
    let abs = root.join(".oculpm").join("journal").join(&rel);
    // 실파일만 인정한다 — `.oculpm` 가드와 같은 이유로 심볼릭 링크는 거부
    // (일지 트리 안의 링크가 프로젝트 밖 파일을 읽어 오는 경로를 막는다).
    let is_real_file = std::fs::symlink_metadata(&abs)
        .map(|m| m.file_type().is_file())
        .unwrap_or(false);
    if !is_real_file {
        return Err(format!("일지를 찾을 수 없습니다: {rel}"));
    }
    let raw = std::fs::read_to_string(&abs).map_err(|e| format!("read failed: {e}"))?;
    let (fm, body) = parse_frontmatter_and_body(&raw);
    let parsed = parse_body(&body);

    let cfg = load_config(root);
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let (title, _) = redact_text(&parsed.title, &patterns);
    let (body, _) = redact_text(&body, &patterns);

    let mut out = json!({
        "path": format!(".oculpm/journal/{rel}"),
        "workday": workday_of_rel(&rel).unwrap_or(""),
        "title": title,
        "body_markdown": body,
    });
    if let Some(f) = &fm.parsed {
        out["type"] = json!(entry_type_filename_token(f.entry_type));
        out["status"] = json!(super::entry_status_token(f.status));
        out["created_at"] = json!(f.created_at);
        out["agent"] = json!({ "id": f.agent.id, "version": f.agent.version });
        out["tags"] = json!(f.tags);
        out["files_touched"] = json!(f
            .files_touched
            .iter()
            .map(|ft| ft.path.clone())
            .collect::<Vec<_>>());
        out["related"] = json!(f.related);
    }
    if !fm.parse_warnings.is_empty() {
        // 망가진 frontmatter 를 숨기지 않는다 — plan_status 의 warnings 와 같은 원칙.
        out["parse_warnings"] = json!(fm.parse_warnings);
    }
    Ok(out)
}

/// 주간 요약 1건 전문. 일지와 같은 봉투 모양(path/title/body_markdown)을 쓰되
/// `kind: "rollup"` 로 자신을 밝힌다 — 에이전트가 "이건 원본이 아니라 층"임을
/// 알아야 인용할 때 원본을 한 번 더 확인한다.
fn rollup_read(root: &Path, rel: &str) -> Result<Value, String> {
    let week = rel
        .trim_start_matches("rollups/")
        .trim_end_matches(".md")
        .to_string();
    let (fm, body) = crate::oculpm::rollup::read_one(root, &week)
        .ok_or_else(|| format!("주간 요약을 찾을 수 없습니다: {rel}"))?;

    let cfg = load_config(root);
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let (body, _) = redact_text(&body, &patterns);

    Ok(json!({
        "kind": "rollup",
        "path": crate::oculpm::paths::rollup_rel(&fm.week),
        "week": fm.week,
        "range": { "from": fm.range.from, "to": fm.range.to },
        "entry_count": fm.entry_count,
        "generator": fm.generator,
        "generated_at": fm.generated_at,
        "title": format!("{} 주간 요약", fm.week),
        "body_markdown": body,
        "note": "요약 층입니다 — 그 주 일지를 접은 것이라 세부는 원본에 있습니다. 필요하면 journal_search(since/until) 로 그 주를 펼치세요.",
    }))
}

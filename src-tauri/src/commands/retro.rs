//! F4 — 회고/인사이트 (retrospective) commands.
//!
//! The product accumulates a unique longitudinal record — per-type journals,
//! per-file diffs, error cycles, agent attribution, a dependency graph — but
//! nothing synthesised it across time. This screen does: pick a workday range,
//! the backend gathers a *deterministic* set of signals, and an LLM turns them
//! into a Korean retro.
//!
//! Four commands:
//! - `retro_signals` — the deterministic signals (no LLM). The screen renders
//!   these immediately and uses their `signature` to detect staleness.
//! - `get_retro` — the cached narrative for a range (`None` if never generated).
//!   Merges two sources: the SQLite cache (API path) and the on-disk
//!   `.oculpm/retro/<range_key>.md` (Claude Code dispatch path) — newer wins.
//! - `generate_retro` — run the LLM over the signals and cache the result.
//! - `retro_dispatch_prompt` — assemble the same signals into a prompt for a
//!   terminal Claude Code session (no API key / billing; progress is visible
//!   in the terminal). The session writes the retro file `get_retro` reads.
//!
//! All journal text we read here comes from the SQLite cache, which is already
//! secret-masked on projection (redaction-wire / R1), so the retro inherits
//! that safety with no extra scrubbing. The cache table mirrors
//! `project_overviews`: a lossy, rebuildable derivative — no SSOT lives here.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use crate::db::{Db, RetroInsight};
use crate::llm;
use crate::oculpm::cache::{JournalCache, RangeEntry};
use crate::oculpm::spec::{AgentCount, DifficultyMix};

/// Caps keep the LLM prompt bounded on busy ranges. Generous — a normal week
/// stays far below these.
const SHIPPED_CAP: usize = 40;
const RESISTANCE_CAP: usize = 40;
const REPEATED_CAP: usize = 15;
const HOTSPOT_CAP: usize = 8;
/// A touched file whose reverse-dependency fan-out reaches this many files is
/// flagged a "core hub" — time spent there rippled widely.
const HUB_THRESHOLD: u32 = 3;

// ─── DTOs ────────────────────────────────────────────────────────────────────

/// A shipped unit — a completed feature/refactor journal entry.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ShippedItem {
    /// Raw frontmatter type: `feature` | `refactor`.
    pub kind: String,
    pub title: String,
    pub agent_id: String,
    pub workday: String,
}

/// A friction unit — an error/bug journal entry.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ResistanceItem {
    /// Raw frontmatter type: `error` | `bug`.
    pub kind: String,
    pub title: String,
    pub status: String,
    pub workday: String,
}

/// A file touched by 2+ error/bug entries in the range — a recurring trouble
/// spot.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RepeatedFile {
    pub path: String,
    /// Number of distinct error/bug entries that touched it.
    pub count: u32,
}

/// A file where effort concentrated, annotated with its graph fan-out so the
/// retro can say "time went into a high-fan-out core module" with evidence.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct EffortHotspot {
    pub path: String,
    /// Distinct journal entries that touched it in the range.
    pub touch_count: u32,
    /// Files that (transitively) import it (`get_change_impact` reverse-BFS).
    /// 0 when the path isn't in the code index (deleted / non-source / not yet
    /// indexed).
    pub impact_fan_out: u32,
    pub is_hub: bool,
}

/// The deterministic signal set the retro is grounded in. Returned to the UI
/// directly *and* fed to the LLM. `signature` hashes everything but itself, so
/// the frontend can compare it to a cached retro's signature to show staleness.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RetroSignals {
    /// Workday "YYYYMMDD".
    pub since: String,
    pub until: String,
    /// "since..until".
    pub range_key: String,
    pub signature: String,
    pub total_entries: u32,
    pub shipped: Vec<ShippedItem>,
    pub resistance: Vec<ResistanceItem>,
    pub repeated_files: Vec<RepeatedFile>,
    pub effort_hotspots: Vec<EffortHotspot>,
    pub agent_breakdown: Vec<AgentCount>,
    pub difficulty_mix: DifficultyMix,
}

// ─── deterministic aggregation (pure, testable) ──────────────────────────────

/// Everything that can be computed from the journal rows alone — no code graph,
/// no DB. `hot_paths` is the top-N most-touched files (path, touch_count) before
/// graph annotation. Factored out of [`gather_signals`] so it unit-tests
/// without a database.
struct AggParts {
    total_entries: u32,
    shipped: Vec<ShippedItem>,
    resistance: Vec<ResistanceItem>,
    repeated_files: Vec<RepeatedFile>,
    hot_paths: Vec<(String, u32)>,
    agent_breakdown: Vec<AgentCount>,
    difficulty_mix: DifficultyMix,
}

/// Count `file_path` occurrences across `entries`, once per entry (so an entry
/// listing the same path twice still counts once).
fn touch_counts<'a>(entries: impl Iterator<Item = &'a RangeEntry>) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for e in entries {
        let mut seen: HashSet<&str> = HashSet::new();
        for f in &e.files {
            if seen.insert(f.as_str()) {
                *counts.entry(f.clone()).or_insert(0) += 1;
            }
        }
    }
    counts
}

fn aggregate(entries: &[RangeEntry]) -> AggParts {
    let total_entries = entries.len() as u32;

    let mut shipped: Vec<ShippedItem> = entries
        .iter()
        .filter(|e| (e.entry_type == "feature" || e.entry_type == "refactor") && e.status == "done")
        .map(|e| ShippedItem {
            kind: e.entry_type.clone(),
            title: e.title.clone(),
            agent_id: e.agent_id.clone(),
            workday: e.workday.clone(),
        })
        .collect();
    shipped.truncate(SHIPPED_CAP);

    let mut resistance: Vec<ResistanceItem> = entries
        .iter()
        .filter(|e| e.entry_type == "error" || e.entry_type == "bug")
        .map(|e| ResistanceItem {
            kind: e.entry_type.clone(),
            title: e.title.clone(),
            status: e.status.clone(),
            workday: e.workday.clone(),
        })
        .collect();
    resistance.truncate(RESISTANCE_CAP);

    // Files that recur across error/bug entries (≥2 distinct entries).
    let bug_counts = touch_counts(
        entries
            .iter()
            .filter(|e| e.entry_type == "error" || e.entry_type == "bug"),
    );
    let mut repeated_files: Vec<RepeatedFile> = bug_counts
        .into_iter()
        .filter(|(_, c)| *c >= 2)
        .map(|(path, count)| RepeatedFile { path, count })
        .collect();
    repeated_files.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.path.cmp(&b.path)));
    repeated_files.truncate(REPEATED_CAP);

    // Effort hotspots: most-touched files across ALL entries.
    let mut hot_paths: Vec<(String, u32)> = touch_counts(entries.iter()).into_iter().collect();
    hot_paths.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    hot_paths.truncate(HOTSPOT_CAP);

    // Agent contribution.
    let mut agent_counts: HashMap<String, u32> = HashMap::new();
    for e in entries {
        *agent_counts.entry(e.agent_id.clone()).or_insert(0) += 1;
    }
    let mut agent_breakdown: Vec<AgentCount> = agent_counts
        .into_iter()
        .map(|(agent_id, entry_count)| AgentCount {
            agent_id,
            entry_count,
            share: if total_entries > 0 {
                entry_count as f32 / total_entries as f32
            } else {
                0.0
            },
        })
        .collect();
    agent_breakdown
        .sort_by(|a, b| b.entry_count.cmp(&a.entry_count).then_with(|| a.agent_id.cmp(&b.agent_id)));

    // Difficulty distribution.
    let mut difficulty_mix = DifficultyMix {
        verylow: 0,
        low: 0,
        medium: 0,
        high: 0,
        superhigh: 0,
        null_count: 0,
    };
    for e in entries {
        match e.difficulty.as_deref() {
            Some("verylow") => difficulty_mix.verylow += 1,
            Some("low") => difficulty_mix.low += 1,
            Some("medium") => difficulty_mix.medium += 1,
            Some("high") => difficulty_mix.high += 1,
            Some("superhigh") => difficulty_mix.superhigh += 1,
            _ => difficulty_mix.null_count += 1,
        }
    }

    AggParts {
        total_entries,
        shipped,
        resistance,
        repeated_files,
        hot_paths,
        agent_breakdown,
        difficulty_mix,
    }
}

/// blake3 over a canonical JSON of the signals (signature field blanked). Every
/// vector is already deterministically sorted, so the same data hashes the same.
fn compute_signature(signals: &RetroSignals) -> String {
    let json = serde_json::to_string(signals).unwrap_or_default();
    blake3::hash(json.as_bytes()).to_hex().to_string()
}

/// Gather the deterministic signals: journal aggregation + graph fan-out on the
/// hottest files. Shared by `retro_signals` and `generate_retro`.
async fn gather_signals(
    db: &Db,
    project_id: u32,
    since: &str,
    until: &str,
) -> Result<RetroSignals, String> {
    let entries = JournalCache::new(db)
        .range_entries(project_id, since, until)
        .await
        .map_err(|e| e.to_string())?;

    let parts = aggregate(&entries);

    // Annotate the hottest files with reverse-dependency fan-out. Bounded to
    // HOTSPOT_CAP paths, one cheap in-memory BFS each.
    let mut effort_hotspots = Vec::with_capacity(parts.hot_paths.len());
    for (path, touch_count) in parts.hot_paths {
        let report = db
            .get_change_impact(project_id, vec![path.clone()])
            .await
            .map_err(|e| e.to_string())?;
        let fan_out = report.affected.len() as u32;
        effort_hotspots.push(EffortHotspot {
            path,
            touch_count,
            impact_fan_out: fan_out,
            is_hub: fan_out >= HUB_THRESHOLD,
        });
    }

    let mut signals = RetroSignals {
        since: since.to_string(),
        until: until.to_string(),
        range_key: format!("{since}..{until}"),
        signature: String::new(),
        total_entries: parts.total_entries,
        shipped: parts.shipped,
        resistance: parts.resistance,
        repeated_files: parts.repeated_files,
        effort_hotspots,
        agent_breakdown: parts.agent_breakdown,
        difficulty_mix: parts.difficulty_mix,
    };
    signals.signature = compute_signature(&signals);
    Ok(signals)
}

// ─── commands ────────────────────────────────────────────────────────────────

/// Deterministic signals for a workday range — no LLM. `since`/`until` are
/// inclusive "YYYYMMDD".
#[tauri::command]
#[specta::specta]
pub async fn retro_signals(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
) -> Result<RetroSignals, String> {
    gather_signals(&db, project_id, &since, &until).await
}

/// PR-CI6 (EDD-lite) — 프로젝트 루트 `EVALS.md` 의 `## 기록` 표를 점수 추이로.
/// 파일이 없으면 `None` (UI 는 섹션을 그리지 않는다). 기간과 무관 — 문서
/// 전체가 신호다.
#[tauri::command]
#[specta::specta]
pub async fn eval_signals(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<crate::oculpm::evals::EvalSignals>, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(crate::oculpm::evals::signals_for(std::path::Path::new(
        &project.root_path,
    )))
}

/// The cached retro narrative for a range, or `None` if never generated.
///
/// Two generation paths land in two places — the API path in the SQLite cache,
/// the Claude Code dispatch path in `.oculpm/retro/<range_key>.md`. Whichever
/// is newer wins, so "다시 생성" through either path always shows up.
#[tauri::command]
#[specta::specta]
pub async fn get_retro(
    db: State<'_, Db>,
    project_id: u32,
    range_key: String,
) -> Result<Option<RetroInsight>, String> {
    let cached = db
        .get_retro_insight(project_id, range_key.clone())
        .await
        .map_err(|e| e.to_string())?;

    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let file = crate::oculpm::retro_file::read_retro_file(
        std::path::Path::new(&project.root_path),
        &range_key,
    );

    Ok(match (cached, file) {
        // 동률(같은 초)은 파일이 이긴다 — 사용자가 방금 터미널에서 지켜본
        // 산출물이 조용히 지는 쪽이 더 나쁘다. mtime=0(메타데이터 실패)은
        // 자연히 캐시에 진다.
        (Some(c), Some((f, mtime))) if mtime >= c.generated_at && mtime > 0 => {
            Some(retro_from_file(project_id, f, mtime))
        }
        (Some(c), _) => Some(c),
        (None, Some((f, mtime))) => Some(retro_from_file(project_id, f, mtime)),
        (None, None) => None,
    })
}

fn retro_from_file(
    project_id: u32,
    f: crate::oculpm::retro_file::RetroFile,
    mtime: u32,
) -> RetroInsight {
    RetroInsight {
        project_id,
        range_key: f.range_key,
        signature: f.signature,
        retro_md: f.body,
        generated_at: mtime,
        generated_by_model: Some(f.generated_by),
    }
}

/// Run the configured LLM over the range's signals and cache a Korean retro.
/// Always regenerates (the user clicked "생성") — the signature is stored so the
/// UI can later tell whether the data has drifted.
#[tauri::command]
#[specta::specta]
pub async fn generate_retro(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
    provider: String,
    model: String,
) -> Result<RetroInsight, String> {
    let signals = gather_signals(&db, project_id, &since, &until).await?;
    if signals.total_entries == 0 {
        return Err("이 기간에 기록된 작업이 없습니다.".to_string());
    }

    let retro_md = call_llm(&provider, &model, &signals).await?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);

    db.upsert_retro_insight(
        project_id,
        signals.range_key.clone(),
        signals.signature.clone(),
        retro_md.clone(),
        now,
        Some(model.clone()),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(RetroInsight {
        project_id,
        range_key: signals.range_key,
        signature: signals.signature,
        retro_md,
        generated_at: now,
        generated_by_model: Some(model),
    })
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT: &str = r#"너는 한국어로 개발 회고를 쓰는 시니어 엔지니어링 매니저다.
입력으로 한 기간의 결정적 작업 신호(출시된 일지, 마찰 일지, 노력이 몰린 파일과
코드그래프 팬아웃, 에이전트별 기여, 난이도 분포)를 받는다. 이를 사람이 읽을
회고로 종합하라.

규칙:
- 제공된 신호에만 근거하라. 없는 사실을 지어내지 마라.
- 신호가 비어 있으면 그 섹션은 "해당 없음" 한 줄로 끝내라.
- 마크다운 본문만 출력. 코드펜스/머리말/꼬리말 금지.
- 팬아웃이 큰(허브) 파일에 시간이 몰렸으면 그 의미(파급 위험·코어 작업)를 짚어라.
- 다음 섹션 순서를 지켜라:
## 한눈에 보기
(2~3문장 요약)
## 출시한 것
(완료된 기능/리팩토링을 묶어 서술)
## 저항한 것
(에러·버그, 반복 등장한 문제 파일)
## 노력이 몰린 곳
(가장 많이 건드린 파일과 그 파급)
## 에이전트 기여
(에이전트별 분담)
## 다음을 위한 제안
(신호에서 도출되는 1~3개의 실천 제안)"#;

fn fmt_signals(s: &RetroSignals) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "기간: {} ~ {} (총 일지 {}개)\n\n",
        s.since, s.until, s.total_entries
    ));

    out.push_str("[출시한 것 — 완료된 feature/refactor]\n");
    if s.shipped.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for it in &s.shipped {
            out.push_str(&format!(
                "- ({}) {} — {} / {}\n",
                it.kind, it.title, it.agent_id, it.workday
            ));
        }
    }

    out.push_str("\n[저항한 것 — error/bug 일지]\n");
    if s.resistance.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for it in &s.resistance {
            out.push_str(&format!(
                "- ({}, {}) {} / {}\n",
                it.kind, it.status, it.title, it.workday
            ));
        }
    }
    if !s.repeated_files.is_empty() {
        out.push_str("반복 등장한 문제 파일(2회 이상):\n");
        for rf in &s.repeated_files {
            out.push_str(&format!("- {} ({}회)\n", rf.path, rf.count));
        }
    }

    out.push_str("\n[노력이 몰린 파일 — 수정 횟수 × 코드그래프 팬아웃]\n");
    if s.effort_hotspots.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for h in &s.effort_hotspots {
            let hub = if h.is_hub { " (코어 허브)" } else { "" };
            out.push_str(&format!(
                "- {} — {}회 수정, {}개 파일이 의존{}\n",
                h.path, h.touch_count, h.impact_fan_out, hub
            ));
        }
    }

    out.push_str("\n[에이전트별 기여]\n");
    if s.agent_breakdown.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for a in &s.agent_breakdown {
            out.push_str(&format!(
                "- {}: {}개 ({:.0}%)\n",
                a.agent_id,
                a.entry_count,
                a.share * 100.0
            ));
        }
    }

    let d = &s.difficulty_mix;
    out.push_str(&format!(
        "\n[난이도 분포] 매우낮음 {} / 낮음 {} / 보통 {} / 높음 {} / 매우높음 {} / 미지정 {}\n",
        d.verylow, d.low, d.medium, d.high, d.superhigh, d.null_count
    ));

    out
}

async fn call_llm(provider: &str, model: &str, signals: &RetroSignals) -> Result<String, String> {
    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("{provider} API 키가 설정되지 않았습니다"))?
    };
    let client = llm::create(provider, api_key).map_err(|e| e.to_string())?;

    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: SYSTEM_PROMPT.to_string(),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: fmt_signals(signals),
                },
            ],
            llm::ChatOptions {
                model: model.to_string(),
                temperature: Some(0.4),
                max_tokens: Some(1800),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let content = response.content.trim();
    // Be tolerant if a model wraps the markdown in a fence despite instructions.
    let body = if content.starts_with("```") {
        content
            .trim_start_matches("```markdown")
            .trim_start_matches("```md")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        content
    };
    if body.is_empty() {
        return Err("회고 생성 결과가 비어 있습니다.".to_string());
    }
    Ok(body.to_string())
}

// ─── Claude Code dispatch (#retro-cc-generate) ───────────────────────────────

/// 회고 디스패치 프롬프트 (pure — 신호만으로 조립, 테스트 가능).
///
/// API 경로와 같은 신호·같은 섹션 규칙을 쓰되, 산출물을 LLM 응답이 아니라
/// `.oculpm/retro/<range_key>.md` **파일**로 받는다 — frontmatter 의
/// `signature` 를 여기서 채워 넣으므로 "오래됨" 배지가 파일 경로에서도 똑같이
/// 동작한다.
/// `redacted_signals_text` 는 **이미 redact 를 통과한** fmt_signals 출력이다 —
/// redact 를 프롬프트 전체에 돌리면 사용자 정의 패턴(예: hex 마스킹)이
/// frontmatter 계약의 signature·경로까지 부숴 신선도 판정이 무너진다.
/// 그래서 마스킹 대상(일지 제목·파일 경로가 든 신호 본문)만 밖에서 redact 하고,
/// 계약 블록은 여기서 원문 그대로 조립한다.
fn build_retro_dispatch_prompt(signals: &RetroSignals, redacted_signals_text: &str) -> String {
    let mut p = String::new();
    p.push_str("ocul-pm 회고 디스패치 — 아래 신호를 한국어 회고로 종합하라.\n\n");
    p.push_str("## 역할과 규칙\n\n");
    p.push_str(SYSTEM_PROMPT);
    p.push_str(
        "\n\n(위 규칙의 \"마크다운 본문만 출력·머리말 금지\"는 **회고 본문**에 대한 것이다 — \
         아래 산출물 계약의 frontmatter 는 예외로, 파일 맨 위에 반드시 포함한다.)",
    );
    p.push_str("\n\n## 입력 신호 (이것만 근거로 — 저장소를 다시 뒤질 필요 없음)\n\n");
    p.push_str(redacted_signals_text);
    p.push_str(&format!(
        r#"
## 산출물 — 파일 하나

회고 본문을 정확히 이 파일에 저장하라 (디렉터리가 없으면 만들 것):

`.oculpm/retro/{rk}.md`

파일은 반드시 아래 frontmatter 로 시작해야 한다 (값 그대로 복사, LF 개행):

```
---
oculpm_retro: v1
range_key: {rk}
signature: {sig}
generated_by: claude-code
---
```

frontmatter 아래에 회고 본문(## 한눈에 보기 부터)을 이어 쓴다.

주의:
- 이 파일 **하나만** 만든다 — 작업 일지·플랜 갱신은 하지 않는다 (회고는 작업 단위가 아니라 산출물이다).
- frontmatter 의 signature 는 수정 금지 — ocul-pm 이 회고의 신선도 판정에 쓴다.
- 저장 후 ocul-pm 회고 화면을 다시 열면 이 회고가 표시된다.
"#,
        rk = signals.range_key,
        sig = signals.signature,
    ));
    p
}

/// #retro-cc-generate — 회고 생성을 터미널의 Claude Code 세션으로 디스패치.
/// API 키·과금 없이 동작하고, 진행 과정이 터미널에 그대로 보인다. 플래너
/// 디스패치(IN2)와 같은 결: 프롬프트 파일 저장 → `claude "$(cat …)"` 프리필.
#[tauri::command]
#[specta::specta]
pub async fn retro_dispatch_prompt(
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
) -> Result<crate::commands::plan::DispatchPrompt, String> {
    let signals = gather_signals(&db, project_id, &since, &until).await?;
    // range_key 는 그대로 디스패치/회고 파일명이 된다 — `YYYYMMDD..YYYYMMDD`
    // 외 입력(경로 조작 포함)은 여기서 자른다 (읽기 경로의 가드와 대칭).
    if !crate::oculpm::retro_file::is_valid_range_key(&signals.range_key) {
        return Err(format!(
            "잘못된 기간 형식입니다: {} (YYYYMMDD 워크데이만 허용)",
            signals.range_key
        ));
    }
    if signals.total_entries == 0 {
        return Err("이 기간에 기록된 작업이 없습니다.".to_string());
    }

    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(&project.root_path);

    // 신호에는 일지 제목·파일 경로가 들어간다 — 신호 본문만 redact 하고,
    // frontmatter 계약(signature·경로)은 원문 유지 (build_retro_dispatch_prompt 주석 참조).
    let patterns = crate::oculpm::planner::dispatch::project_redact_patterns(&root);
    let (signals_text, _hits) =
        crate::oculpm::redact::redact_text(&fmt_signals(&signals), &patterns);
    let prompt = build_retro_dispatch_prompt(&signals, &signals_text);

    let dispatch_dir = root.join(".oculpm").join("index").join("dispatch");
    std::fs::create_dir_all(&dispatch_dir).map_err(|e| e.to_string())?;
    let file_name = format!("retro-{}.md", signals.range_key);
    let abs = dispatch_dir.join(&file_name);
    crate::oculpm::atomic_io::write_atomic(&abs, prompt.as_bytes()).map_err(|e| e.to_string())?;

    Ok(crate::commands::plan::DispatchPrompt {
        file_rel: format!(".oculpm/index/dispatch/{file_name}"),
        command: crate::oculpm::planner::dispatch::shell_command_for(&abs),
        item_title: format!("회고 {}", signals.range_key),
    })
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        ty: &str,
        status: &str,
        agent: &str,
        difficulty: Option<&str>,
        workday: &str,
        title: &str,
        files: &[&str],
    ) -> RangeEntry {
        RangeEntry {
            relative_path: format!("{workday}/X/{title}.md"),
            workday: workday.to_string(),
            entry_type: ty.to_string(),
            status: status.to_string(),
            difficulty: difficulty.map(str::to_string),
            agent_id: agent.to_string(),
            title: title.to_string(),
            files: files.iter().map(|s| s.to_string()).collect(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn dispatch_prompt_carries_contract() {
        let agg = aggregate(&[entry(
            "feature",
            "done",
            "claude-code",
            Some("high"),
            "20260726",
            "F1",
            &["src/a.rs"],
        )]);
        let mut signals = RetroSignals {
            since: "20260726".into(),
            until: "20260801".into(),
            range_key: "20260726..20260801".into(),
            signature: String::new(),
            total_entries: agg.total_entries,
            shipped: agg.shipped,
            resistance: agg.resistance,
            repeated_files: agg.repeated_files,
            effort_hotspots: vec![],
            agent_breakdown: agg.agent_breakdown,
            difficulty_mix: agg.difficulty_mix,
        };
        signals.signature = compute_signature(&signals);

        // 신호 본문이 공격적 redact 패턴(예: hex 마스킹)에 전부 지워져도
        // 계약 블록(signature·경로)은 원문 그대로 남아야 한다.
        let p = build_retro_dispatch_prompt(&signals, "[REDACTED-SIGNALS]");
        assert!(p.contains("[REDACTED-SIGNALS]"));
        // 산출 파일 경로·frontmatter 계약·신선도 서명이 전부 프롬프트에 실려야 한다.
        assert!(p.contains(".oculpm/retro/20260726..20260801.md"));
        assert!(p.contains("oculpm_retro: v1"));
        assert!(p.contains(&format!("signature: {}", signals.signature)));
        assert!(p.contains("generated_by: claude-code"));
        // 회고 섹션 규칙(시스템 프롬프트) 포함.
        assert!(p.contains("## 한눈에 보기"));
        // 일지·플랜을 건드리지 말라는 경계.
        assert!(p.contains("작업 일지·플랜 갱신은 하지 않는다"));
    }

    #[test]
    fn aggregate_partitions_shipped_and_resistance() {
        let entries = vec![
            entry("feature", "done", "claude-code", Some("high"), "20260620", "F1", &["src/a.rs"]),
            entry("refactor", "done", "cursor", Some("medium"), "20260620", "R1", &["src/a.rs"]),
            // in-progress feature is NOT shipped
            entry("feature", "in_progress", "claude-code", Some("low"), "20260621", "F2", &["src/b.rs"]),
            entry("bug", "done", "claude-code", None, "20260621", "B1", &["src/a.rs"]),
            entry("error", "abandoned", "cursor", Some("superhigh"), "20260622", "E1", &["src/a.rs"]),
        ];
        let agg = aggregate(&entries);

        assert_eq!(agg.total_entries, 5);
        // shipped = done feature + done refactor
        assert_eq!(agg.shipped.len(), 2);
        assert!(agg.shipped.iter().any(|s| s.title == "F1" && s.kind == "feature"));
        assert!(agg.shipped.iter().any(|s| s.title == "R1" && s.kind == "refactor"));
        // resistance = bug + error
        assert_eq!(agg.resistance.len(), 2);
        assert!(agg.resistance.iter().any(|r| r.kind == "bug"));
        assert!(agg.resistance.iter().any(|r| r.kind == "error"));
    }

    #[test]
    fn aggregate_repeated_files_need_two_distinct_bug_entries() {
        let entries = vec![
            entry("bug", "done", "a", None, "20260620", "B1", &["src/x.rs", "src/y.rs"]),
            entry("error", "done", "a", None, "20260621", "E1", &["src/x.rs"]),
            // a feature touching x.rs must NOT count toward repeated-bug-files
            entry("feature", "done", "a", None, "20260622", "F1", &["src/x.rs", "src/z.rs"]),
        ];
        let agg = aggregate(&entries);
        // x.rs appears in 2 bug/error entries → repeated; y.rs only once.
        assert_eq!(agg.repeated_files.len(), 1);
        assert_eq!(agg.repeated_files[0].path, "src/x.rs");
        assert_eq!(agg.repeated_files[0].count, 2);
    }

    #[test]
    fn aggregate_hot_paths_sorted_by_touch_count() {
        let entries = vec![
            entry("feature", "done", "a", None, "20260620", "F1", &["src/x.rs", "src/y.rs"]),
            entry("refactor", "done", "a", None, "20260621", "R1", &["src/x.rs"]),
            entry("chore", "done", "a", None, "20260622", "C1", &["src/x.rs", "src/z.rs"]),
        ];
        let agg = aggregate(&entries);
        // x.rs touched by 3 entries → first; ties broken by path.
        assert_eq!(agg.hot_paths[0], ("src/x.rs".to_string(), 3));
    }

    #[test]
    fn aggregate_agent_share_and_difficulty_mix() {
        let entries = vec![
            entry("feature", "done", "claude-code", Some("high"), "20260620", "F1", &[]),
            entry("bug", "done", "claude-code", Some("high"), "20260621", "B1", &[]),
            entry("refactor", "done", "cursor", None, "20260622", "R1", &[]),
        ];
        let agg = aggregate(&entries);
        // agents sorted by count desc: claude-code(2) then cursor(1)
        assert_eq!(agg.agent_breakdown[0].agent_id, "claude-code");
        assert_eq!(agg.agent_breakdown[0].entry_count, 2);
        assert!((agg.agent_breakdown[0].share - 2.0 / 3.0).abs() < 1e-6);
        // difficulty: 2 high, 1 unspecified
        assert_eq!(agg.difficulty_mix.high, 2);
        assert_eq!(agg.difficulty_mix.null_count, 1);
    }

    #[test]
    fn empty_entries_yield_zeroed_aggregate() {
        let agg = aggregate(&[]);
        assert_eq!(agg.total_entries, 0);
        assert!(agg.shipped.is_empty());
        assert!(agg.resistance.is_empty());
        assert!(agg.hot_paths.is_empty());
        assert!(agg.agent_breakdown.is_empty());
    }
}

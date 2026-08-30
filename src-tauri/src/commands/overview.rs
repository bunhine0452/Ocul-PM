//! G2 Project Overview commands (MASTER-GUIDE §4.2)
//!
//! The "Overview" panel answers the question *"what is this codebase?"* in
//! natural language. We gather a deterministic set of signals (README, manifest
//! files, language distribution, top-level structure) and ask the LLM to
//! produce a README-grade summary. The result is cached in
//! `project_overviews`; we only regenerate when the input signature changes.
//!
//! Commands exposed to the frontend:
//! - `get_project_overview` — read cached overview (or `None`).
//! - `generate_project_overview` — force re-run regardless of signature.
//! - `refresh_project_overview_if_stale` — fire-and-forget after indexing; only
//!   calls the LLM when the source signature has actually changed.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use crate::db::{Db, Goal, ProjectOverview};
use crate::indexer;
use crate::llm;

/// Upper bound on how much raw text we feed to the LLM, in bytes. README +
/// manifests easily blow up on monorepos, so we hard-cap and prefer README.
const MAX_SIGNAL_BYTES: usize = 24 * 1024;

/// Files we always try to read (in order of priority). Anything missing is
/// silently skipped — most projects only have a couple of these.
const MANIFEST_FILES: &[&str] = &[
    "README.md",
    "README",
    "package.json",
    "Cargo.toml",
    "src-tauri/tauri.conf.json",
    "pyproject.toml",
    "go.mod",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
];

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OverviewSignals {
    /// Top-level entries (file or dir names), sorted alphabetically.
    pub top_level: Vec<String>,
    /// `{ "rust": 142, "typescript": 78, ... }`. Empty when the project has not
    /// been indexed yet.
    pub language_counts: BTreeMap<String, u32>,
    /// Indexed file count from the `files` table.
    pub indexed_files: u32,
    /// Indexed chunk count from the `chunks` table.
    pub indexed_chunks: u32,
    /// Concatenated text of manifest files (README first), trimmed to
    /// `MAX_SIGNAL_BYTES`. Sent to the LLM verbatim.
    pub manifests_text: String,
}

// ---------- get / generate / refresh ----------

#[tauri::command]
#[specta::specta]
pub async fn get_project_overview(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<ProjectOverview>, String> {
    db.get_project_overview(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn generate_project_overview(
    db: State<'_, Db>,
    project_id: u32,
    provider: String,
    model: String,
) -> Result<ProjectOverview, String> {
    run_generation(&db, project_id, &provider, &model, /*force=*/ true)
        .await?
        .ok_or_else(|| "overview generation returned no result".to_string())
}

/// Returns `Some(new)` when the LLM was invoked, `None` when the cached
/// overview was still fresh enough to skip work.
#[tauri::command]
#[specta::specta]
pub async fn refresh_project_overview_if_stale(
    db: State<'_, Db>,
    project_id: u32,
    provider: String,
    model: String,
) -> Result<Option<ProjectOverview>, String> {
    run_generation(&db, project_id, &provider, &model, /*force=*/ false).await
}

/// Save a user-edited overview body. Setting `source_signature = None` is
/// load-bearing: the indexing hook checks for it and refuses to auto-regen
/// over manual edits (MASTER-GUIDE §4.2 "수동 편집 보호"). Identity and
/// stack_json are passed through unchanged from the caller — the frontend
/// editor lets users tweak the markdown body for now; richer per-section
/// edits land later.
#[tauri::command]
#[specta::specta]
pub async fn update_project_overview(
    db: State<'_, Db>,
    project_id: u32,
    identity: Option<String>,
    stack_json: Option<String>,
    overview_md: String,
) -> Result<ProjectOverview, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);

    db.upsert_project_overview(
        project_id,
        identity.clone(),
        stack_json.clone(),
        Some(overview_md.clone()),
        // None disables auto-regen until the user clicks "다시 생성".
        None,
        Some(now),
        Some("user-edit".to_string()),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(ProjectOverview {
        project_id,
        identity,
        stack_json,
        overview_md: Some(overview_md),
        source_signature: None,
        generated_at: Some(now),
        generated_by_model: Some("user-edit".to_string()),
    })
}

// ---------- internal pipeline ----------

/// Core generation pipeline shared by the user-facing commands above *and* the
/// post-indexing hook in `commands::project`. Exposed at crate-pub so the
/// indexing flow can fire it without re-implementing the LLM dance.
pub async fn run_generation(
    db: &Db,
    project_id: u32,
    provider: &str,
    model: &str,
    force: bool,
) -> Result<Option<ProjectOverview>, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);

    let signals = collect_signals(db, project_id, &root).await?;
    let signature = compute_signature(&signals);

    // Cheap fast-path: skip the LLM call when nothing about the project has
    // changed since the last overview generation.
    if !force {
        if let Some(existing) = db
            .get_project_overview(project_id)
            .await
            .map_err(|e| e.to_string())?
        {
            if existing.source_signature.as_deref() == Some(signature.as_str()) {
                return Ok(None);
            }
        }
    }

    let (identity, stack_json, overview_md) = call_llm(
        provider,
        model,
        &project.name,
        &signals,
        crate::oculpm::content_lang::current(db).await,
    )
    .await?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);

    db.upsert_project_overview(
        project_id,
        Some(identity.clone()),
        Some(stack_json.clone()),
        Some(overview_md.clone()),
        Some(signature.clone()),
        Some(now),
        Some(model.to_string()),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(Some(ProjectOverview {
        project_id,
        identity: Some(identity),
        stack_json: Some(stack_json),
        overview_md: Some(overview_md),
        source_signature: Some(signature),
        generated_at: Some(now),
        generated_by_model: Some(model.to_string()),
    }))
}

async fn collect_signals(db: &Db, project_id: u32, root: &Path) -> Result<OverviewSignals, String> {
    // Top-level structure — only one level deep to keep the signal small.
    let mut top_level: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with('.') {
                    continue;
                }
                top_level.push(name.to_string());
            }
        }
    }
    top_level.sort();

    // Language distribution from the indexed file list. We tolerate "not yet
    // indexed" by leaving the map empty.
    let files = db
        .list_project_files(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let mut language_counts: BTreeMap<String, u32> = BTreeMap::new();
    for (_id, path) in &files {
        if let Some(lang) = indexer::language_for(Path::new(path)) {
            *language_counts.entry(lang.to_string()).or_insert(0) += 1;
        }
    }

    let indexed_files = db
        .count_files(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let indexed_chunks = db
        .count_chunks(project_id)
        .await
        .map_err(|e| e.to_string())?;

    // Manifest text: read in priority order, stop once we've used the budget.
    let mut manifests_text = String::new();
    let mut budget = MAX_SIGNAL_BYTES;
    for manifest in MANIFEST_FILES {
        if budget == 0 {
            break;
        }
        let path = root.join(manifest);
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let take = content.len().min(budget);
        manifests_text.push_str(&format!("### {}\n", manifest));
        manifests_text.push_str(&content[..take]);
        if take < content.len() {
            manifests_text.push_str("\n... (truncated)\n");
        }
        manifests_text.push_str("\n\n");
        budget = budget.saturating_sub(take);
    }

    Ok(OverviewSignals {
        top_level,
        language_counts,
        indexed_files,
        indexed_chunks,
        manifests_text,
    })
}

fn compute_signature(signals: &OverviewSignals) -> String {
    // Deterministic ordering matters: BTreeMap + sorted top_level handles it.
    let mut hasher = blake3::Hasher::new();
    hasher.update(signals.manifests_text.as_bytes());
    for entry in &signals.top_level {
        hasher.update(entry.as_bytes());
        hasher.update(b"\n");
    }
    for (lang, count) in &signals.language_counts {
        hasher.update(lang.as_bytes());
        hasher.update(&count.to_le_bytes());
    }
    // file/chunk counts intentionally excluded — they change every indexing
    // run but rarely justify a full LLM regeneration on their own.
    hasher.finalize().to_hex().to_string()
}

async fn call_llm(
    provider: &str,
    model: &str,
    project_name: &str,
    signals: &OverviewSignals,
    content_lang: crate::oculpm::content_lang::ContentLang,
) -> Result<(String, String, String), String> {
    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("API key for {provider} is not set"))?
    };

    let client = llm::create(provider, api_key).map_err(|e| e.to_string())?;

    let lang_summary = if signals.language_counts.is_empty() {
        "(아직 인덱싱되지 않음)".to_string()
    } else {
        signals
            .language_counts
            .iter()
            .map(|(k, v)| format!("{k}: {v}"))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let user_msg = format!(
        "프로젝트 이름: {name}\n\n\
         최상위 구조 ({n_top}개):\n{top}\n\n\
         언어별 파일 수: {langs}\n\
         인덱싱: {files} files / {chunks} chunks\n\n\
         === 매니페스트/문서 ===\n{manifests}",
        name = project_name,
        n_top = signals.top_level.len(),
        top = signals.top_level.join("\n"),
        langs = lang_summary,
        files = signals.indexed_files,
        chunks = signals.indexed_chunks,
        manifests = signals.manifests_text,
    );

    let system_prompt = r#"You are a senior tech writer producing a README-grade overview
for a Korean developer's PM tool. You receive raw signals from a codebase
(top-level structure, manifest files, language stats) and must produce a
single JSON object with exactly these keys:

{
  "identity": "한 문장 (≤120자) 한국어. 이 프로젝트가 '무엇을 하는 무엇'인지 정의.",
  "stack": {
    "framework": "예: Tauri 2, Next.js 14, FastAPI",
    "languages": ["Rust", "TypeScript"],
    "package_manager": "pnpm | npm | cargo | uv | ...",
    "ui": "예: React 19 + Tailwind v4",
    "data": "예: SQLite + sqlite-vec",
    "notes": "선택. 통합/특이사항 (≤80자)"
  },
  "overview_md": "Markdown 한국어. 다음 섹션 순서를 지켜라:\n## 정체성\n## 핵심 기능 (불릿)\n## 디렉터리 가이드 (불릿: `path` — 설명)\n## 진입점 (불릿)\n## 특이사항 (불릿, 선택)"
}

규칙:
- 매니페스트가 비어있어도 '추정' 으로 채워서는 안 된다. 알 수 없는 값은 빈 문자열/배열.
- identity 는 마케팅 문구가 아닌 *기능적 정의*.
- 디렉터리 가이드는 실제 top-level 구조에서만 골라라 (없으면 비워라).
- Markdown 본문 외 다른 설명, 코드펜스, 주석 출력 금지. JSON 한 덩어리만."#;

    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: content_lang.apply(system_prompt),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: user_msg,
                },
            ],
            llm::ChatOptions {
                model: model.to_string(),
                temperature: Some(0.3),
                max_tokens: Some(2000),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let content = response.content.trim();
    let json_str = if content.starts_with("```") {
        content
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        content
    };

    let parsed: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse overview LLM response: {e}\nRaw: {content}"))?;

    let identity = parsed
        .get("identity")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let stack_json = parsed
        .get("stack")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string());
    let overview_md = parsed
        .get("overview_md")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if identity.is_empty() && overview_md.is_empty() {
        return Err(format!(
            "LLM returned an empty overview. Raw response: {content}"
        ));
    }

    Ok((identity, stack_json, overview_md))
}

// ---------- daily_brief ----------

/// Structured payload backing the Today screen. The frontend formats the
/// numbers; we just join the underlying tables in a single round trip.
///
/// `date_unix` is the local-day start (00:00) for which the brief was built.
/// Callers can request any day, defaulting to "today" by passing `None`.
///
/// Lite-W6 PR4: the changelog-derived fields were retired. The DTO shape
/// is kept (with empty/zero placeholders) until the legacy DailyBrief
/// view in TodayScreen is removed in a later PR; today's authoritative
/// activity source is the journal entries rendered by TimelineView.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DailyBrief {
    // i32 (not i64) so Specta can export this binding; unix seconds fit in i32
    // until 2038. See docs/errors/2026-05-21-specta-bigint-export.md
    pub date_unix: i32,
    /// Top 3 active goals — already ordered by priority then due_date.
    pub focus_goals: Vec<Goal>,
    /// Goals whose `updated_at` falls inside the requested day AND that are
    /// marked completed. The "what did I finish" column.
    pub completed_today: Vec<Goal>,
}

#[tauri::command]
#[specta::specta]
pub async fn daily_brief(
    db: State<'_, Db>,
    project_id: u32,
    // i32 (not i64) so Specta can export this binding. Widened to i64 below
    // for arithmetic and DB queries.
    date_unix: Option<i32>,
) -> Result<DailyBrief, String> {
    // The frontend computes "today midnight" using the user's LOCAL timezone
    // (`new Date().setHours(0,0,0,0)`) and passes that as `date_unix`. We must
    // honor that value verbatim — re-snapping it to a UTC day boundary here
    // shifted the window by the user's UTC offset, so morning-of-today entries
    // (created after local midnight but before UTC midnight) silently fell
    // outside the bucket. Only the `None` fallback snaps, since no client-side
    // anchor is available then.
    let day_start: i64 = match date_unix {
        Some(ts) => ts as i64,
        None => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            now - now.rem_euclid(86400)
        }
    };
    let day_end = day_start + 86400;

    // Focus = top 3 not-yet-done goals. We pull a small page and slice rather
    // than threading a LIMIT through list_goals — keeps that helper simple.
    let active_goals = db
        .list_goals(Some(project_id), None)
        .await
        .map_err(|e| e.to_string())?;
    let focus_goals: Vec<Goal> = active_goals
        .iter()
        .filter(|g| g.status != "completed" && g.status != "archived")
        .take(3)
        .cloned()
        .collect();
    let completed_today: Vec<Goal> = active_goals
        .iter()
        .filter(|g| {
            g.status == "completed"
                && (g.updated_at as i64) >= day_start
                && (g.updated_at as i64) < day_end
        })
        .cloned()
        .collect();

    Ok(DailyBrief {
        date_unix: day_start as i32,
        focus_goals,
        completed_today,
    })
}

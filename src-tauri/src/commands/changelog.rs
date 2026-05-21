//! G1 Changelog commands (MASTER-GUIDE §4.1)
//!
//! Core workflow:
//! 1. Frontend calls `commit_changelog_entry` with project_id + optional user_intent
//! 2. Backend runs `git diff --stat` to collect changed files
//! 3. Backend asks LLM to summarise the diff
//! 4. Entry + per-file records are stored in DB
//! 5. Frontend can list/update/delete/pin entries

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::db::{ChangelogEntry, ChangelogFileEntry, DailyChangelogBucket, Db};
use crate::git;
use crate::llm;

/// Maximum diff patch size per file (64 KB). Larger diffs are truncated.
const MAX_DIFF_BYTES: usize = 64 * 1024;

// ---------- commit_changelog_entry ----------

#[tauri::command]
#[specta::specta]
pub async fn commit_changelog_entry(
    db: State<'_, Db>,
    project_id: u32,
    user_intent: Option<String>,
    category: Option<String>,
    provider: String,
    model: String,
) -> Result<ChangelogEntry, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);

    // 1. Collect git diff stats (working tree vs HEAD)
    let file_stats = git::diff_stat(&root, None, None)
        .unwrap_or_default();

    if file_stats.is_empty() {
        return Err("No uncommitted changes detected. Nothing to log.".to_string());
    }

    let (total_files, total_added, total_removed) =
        git::diff_shortstat(&root, None, None).unwrap_or((0, 0, 0));

    // 2. Collect diff patches for each file (capped per file)
    let mut file_diffs: Vec<(String, String, String, u32, u32)> = Vec::new(); // (path, change_type, patch, +, -)
    for stat in &file_stats {
        let patch = git::diff_patch(&root, &stat.file_path, None, None, MAX_DIFF_BYTES)
            .unwrap_or_default();
        let change_type_str = match stat.change_type.as_str() {
            "A" => "created",
            "D" => "deleted",
            "R" => "renamed",
            _ => "modified",
        };
        file_diffs.push((
            stat.file_path.clone(),
            change_type_str.to_string(),
            patch,
            stat.lines_added,
            stat.lines_removed,
        ));
    }

    // 3. Build LLM prompt for summarisation
    let mut diff_context = String::new();
    for (path, ct, patch, added, removed) in &file_diffs {
        diff_context.push_str(&format!(
            "### `{}` ({}, +{} -{}):\n```diff\n{}\n```\n\n",
            path, ct, added, removed,
            if patch.len() > 4096 { &patch[..4096] } else { patch }
        ));
    }

    let user_msg = if let Some(ref intent) = user_intent {
        format!(
            "사용자 의도: {}\n\n변경된 파일 ({} files, +{} -{})\n\n{}",
            intent, total_files, total_added, total_removed, diff_context
        )
    } else {
        format!(
            "변경된 파일 ({} files, +{} -{})\n\n{}",
            total_files, total_added, total_removed, diff_context
        )
    };

    let system_prompt = r#"You are a technical changelog writer for a Korean developer's PM tool.
Given a git diff and optionally the user's intent (which may be in Korean), produce a JSON object:

{
  "title": "A concise one-line title in Korean (max 60 chars). Describe WHAT changed.",
  "ai_summary": "A markdown summary in Korean (3-8 sentences). Explain WHAT changed, WHY, and any notable technical details. Use bullet points for multiple changes.",
  "category": "One of: feature, fix, refactor, docs, test, chore",
  "per_file_summaries": { "path/to/file": "한 줄 파일별 요약" }
}

Output ONLY valid JSON, no markdown fences."#;

    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("API key for {provider} is not set"))?
    };

    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;

    let response = client
        .chat(
            vec![
                llm::Message { role: llm::Role::System, content: system_prompt.to_string() },
                llm::Message { role: llm::Role::User, content: user_msg },
            ],
            llm::ChatOptions {
                model,
                temperature: Some(0.3),
                max_tokens: Some(2000),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // 4. Parse LLM response
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
        .map_err(|e| format!("Failed to parse LLM changelog response: {e}\nRaw: {content}"))?;

    let ai_summary = parsed.get("ai_summary")
        .and_then(|v| v.as_str())
        .unwrap_or("변경 사항 요약을 생성하지 못했습니다.")
        .to_string();
    let title = parsed.get("title")
        .and_then(|v| v.as_str())
        .map(String::from);
    let llm_category = parsed.get("category")
        .and_then(|v| v.as_str())
        .map(String::from);
    let per_file_map: std::collections::HashMap<String, String> = parsed.get("per_file_summaries")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let final_category = category.or(llm_category);

    // 5. Insert changelog entry
    let entry = db.insert_changelog_entry(
        project_id,
        user_intent,
        None, // prompt_text — not from assist flow
        ai_summary,
        title,
        final_category,
        None, // external_tool
        total_files,
        total_added,
        total_removed,
    ).await.map_err(|e| e.to_string())?;

    // 6. Insert per-file records
    for (path, ct, patch, added, removed) in file_diffs {
        let summary = per_file_map.get(&path).cloned();
        db.insert_changelog_file(
            entry.id,
            path,
            ct,
            added,
            removed,
            if patch.is_empty() { None } else { Some(patch) },
            summary,
            None,
            None,
        ).await.map_err(|e| e.to_string())?;
    }

    Ok(entry)
}

// ---------- list / get / update / delete / pin ----------

#[tauri::command]
#[specta::specta]
pub async fn list_changelog(
    db: State<'_, Db>,
    project_id: u32,
    // i32 (not i64) so Specta can export the binding — TypeScript number can't
    // safely round-trip i64. See docs/errors/2026-05-21-specta-bigint-export.md
    since: Option<i32>,
    limit: Option<u32>,
) -> Result<Vec<ChangelogEntry>, String> {
    db.list_changelog_entries(project_id, since.map(|v| v as i64), limit.unwrap_or(100))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_changelog_detail(
    db: State<'_, Db>,
    entry_id: u32,
) -> Result<(ChangelogEntry, Vec<ChangelogFileEntry>), String> {
    let entry = db.get_changelog_entry(entry_id).await.map_err(|e| e.to_string())?;
    let files = db.list_changelog_files(entry_id).await.map_err(|e| e.to_string())?;
    Ok((entry, files))
}

#[tauri::command]
#[specta::specta]
pub async fn update_changelog(
    db: State<'_, Db>,
    entry_id: u32,
    title: Option<String>,
    category: Option<String>,
    ai_summary: Option<String>,
) -> Result<ChangelogEntry, String> {
    db.update_changelog_entry(entry_id, title, category, ai_summary)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_changelog(
    db: State<'_, Db>,
    entry_id: u32,
) -> Result<(), String> {
    db.delete_changelog_entry(entry_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn pin_changelog(
    db: State<'_, Db>,
    entry_id: u32,
) -> Result<ChangelogEntry, String> {
    db.pin_changelog_entry(entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// Group changelog entries into per-day buckets for the timeline UI
/// (MASTER-GUIDE §5.5). Buckets are sorted newest-day first; within a bucket,
/// entries follow the same DESC order as `list_changelog_entries`. We bucket
/// in Rust rather than SQL so the local-day boundary (UTC seconds rounded down
/// to 86400) stays consistent with what the frontend renders.
#[tauri::command]
#[specta::specta]
pub async fn list_changelog_by_day(
    db: State<'_, Db>,
    project_id: u32,
    days: Option<u32>,
) -> Result<Vec<DailyChangelogBucket>, String> {
    let days = days.unwrap_or(30).max(1) as i64;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let since = now - (days * 86400);

    let entries = db
        .list_changelog_entries(project_id, Some(since), 1000)
        .await
        .map_err(|e| e.to_string())?;

    // Group by day-start (UTC). Using a Vec<(day, Vec<Entry>)> rather than a
    // BTreeMap so newest-first ordering survives the grouping.
    let mut buckets: Vec<(i64, Vec<ChangelogEntry>)> = Vec::new();
    for entry in entries {
        let day = (entry.created_at as i64).div_euclid(86400) * 86400;
        match buckets.last_mut() {
            Some((d, list)) if *d == day => list.push(entry),
            _ => buckets.push((day, vec![entry])),
        }
    }

    let result = buckets
        .into_iter()
        .map(|(day, entries)| {
            let total_files: u32 = entries.iter().map(|e| e.files_changed).sum();
            let total_added: u32 = entries.iter().map(|e| e.lines_added).sum();
            let total_removed: u32 = entries.iter().map(|e| e.lines_removed).sum();
            // ISO yyyy-mm-dd derived from unix seconds (UTC). Frontend formats
            // for the user's locale; this string is stable for keying.
            let date = format_iso_date(day);
            DailyChangelogBucket {
                date,
                entries,
                total_files,
                total_lines_added: total_added,
                total_lines_removed: total_removed,
            }
        })
        .collect();

    Ok(result)
}

/// Export the project's changelog as a Markdown document loosely following
/// Keep-a-Changelog (https://keepachangelog.com/). Entries are grouped by
/// day with category sub-headings. The frontend writes the returned string
/// to disk via a save-as dialog (no FS writes from the backend).
///
/// MASTER-GUIDE §4.1 commands table — `export_changelog_markdown`.
#[tauri::command]
#[specta::specta]
pub async fn export_changelog_markdown(
    db: State<'_, Db>,
    project_id: u32,
    // `from` / `to`: unix seconds. i32 (not i64) for the same reason as elsewhere
    // — fits until 2038 and clears Specta's BigInt restriction.
    from: Option<i32>,
    to: Option<i32>,
) -> Result<String, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let entries = db
        .list_changelog_entries(project_id, from.map(|v| v as i64), 5000)
        .await
        .map_err(|e| e.to_string())?;

    let to_secs = to.map(|v| v as i64);
    let filtered: Vec<&ChangelogEntry> = entries
        .iter()
        .filter(|e| to_secs.map_or(true, |t| (e.created_at as i64) < t))
        .collect();

    let mut out = String::new();
    out.push_str(&format!("# {} — Changelog\n\n", project.name));
    out.push_str(
        "All notable changes to this project, summarised by the AI-PM\n\
         and grouped by day. Format inspired by Keep-a-Changelog.\n\n",
    );

    if filtered.is_empty() {
        out.push_str("_(no entries in the selected range)_\n");
        return Ok(out);
    }

    // Group by day-start, newest first.
    let mut buckets: Vec<(i64, Vec<&ChangelogEntry>)> = Vec::new();
    for entry in &filtered {
        let day = (entry.created_at as i64).div_euclid(86400) * 86400;
        match buckets.last_mut() {
            Some((d, list)) if *d == day => list.push(entry),
            _ => buckets.push((day, vec![entry])),
        }
    }

    for (day, day_entries) in buckets {
        out.push_str(&format!("## {}\n\n", format_iso_date(day)));

        // Group within a day by category — matches Keep-a-Changelog's Added /
        // Changed / Fixed sections. We map our internal categories to the
        // closest KaC heading.
        let mut by_cat: std::collections::BTreeMap<&str, Vec<&ChangelogEntry>> =
            std::collections::BTreeMap::new();
        for e in day_entries {
            let cat = e.category.as_deref().unwrap_or("misc");
            let heading = kac_section(cat);
            by_cat.entry(heading).or_default().push(e);
        }
        for (heading, list) in by_cat {
            out.push_str(&format!("### {}\n\n", heading));
            for e in list {
                let title = e.title.as_deref().unwrap_or_else(|| {
                    // Fallback: first non-empty line of the ai_summary.
                    e.ai_summary.lines().find(|l| !l.trim().is_empty()).unwrap_or("(untitled)")
                });
                let pin = if e.pinned { " 📌" } else { "" };
                out.push_str(&format!("- **{}**{}\n", title.trim(), pin));
                if let Some(intent) = e.user_intent.as_deref() {
                    if !intent.trim().is_empty() {
                        out.push_str(&format!("  - _의도_: {}\n", intent.trim()));
                    }
                }
                // Stats line
                out.push_str(&format!(
                    "  - _{} files · +{} / -{}_\n",
                    e.files_changed, e.lines_added, e.lines_removed
                ));
                // Indented ai_summary block.
                for line in e.ai_summary.lines() {
                    if line.trim().is_empty() {
                        out.push('\n');
                    } else {
                        out.push_str(&format!("  {}\n", line));
                    }
                }
                out.push('\n');
            }
        }
    }

    Ok(out)
}

fn kac_section(category: &str) -> &'static str {
    match category {
        "feature" => "Added",
        "fix" => "Fixed",
        "refactor" => "Changed",
        "docs" => "Documentation",
        "test" => "Tests",
        "chore" => "Chores",
        _ => "Other",
    }
}

fn format_iso_date(unix_seconds: i64) -> String {
    // Minimal Gregorian conversion — avoid pulling in chrono just for this.
    // Algorithm: Howard Hinnant's days_from_civil inverse.
    let days = unix_seconds.div_euclid(86400);
    // Shift to civil-from-days reference (1970-01-01 = day 0 → era epoch 0000-03-01).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

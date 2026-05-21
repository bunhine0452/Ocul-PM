//! G1 Changelog commands (MASTER-GUIDE §4.1)
//!
//! Core workflow:
//! 1. Frontend calls `commit_changelog_entry` with project_id + optional user_intent
//! 2. Backend runs `git diff --stat` to collect changed files
//! 3. Backend asks LLM to summarise the diff
//! 4. Entry + per-file records are stored in DB
//! 5. Frontend can list/update/delete/pin entries

use std::path::PathBuf;

use tauri::State;

use crate::db::{ChangelogEntry, ChangelogFileEntry, Db};
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
    since: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<ChangelogEntry>, String> {
    db.list_changelog_entries(project_id, since, limit.unwrap_or(100))
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

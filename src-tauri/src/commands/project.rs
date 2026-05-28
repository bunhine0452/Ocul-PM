use std::fs;
use std::path::PathBuf;
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tracing::info;

use crate::db::{
    ChunkSearchResult, ClarifyAnswer, ClarifyQuestion, ClarifyResult, Db, EditPromptResult,
    FileChange, Project,
};
use crate::embedding::{vec_to_bytes, Embedder};
use crate::indexer;
use crate::llm;


const EMBED_BATCH: usize = 32;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct IndexProgress {
    pub current: u32,
    pub total: u32,
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct IndexResult {
    pub files_processed: u32,
    pub files_changed: u32,
    pub chunks_created: u32,
    pub took_ms: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ProjectStats {
    pub files: u32,
    pub chunks: u32,
}

// ---------- Folder picker ----------

#[tauri::command]
#[specta::specta]
pub async fn select_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| match p {
        FilePath::Path(p) => p.to_str().map(String::from),
        _ => None,
    }))
}

// ---------- Projects ----------

#[tauri::command]
#[specta::specta]
pub async fn list_projects(db: State<'_, Db>) -> Result<Vec<Project>, String> {
    db.list_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_project(
    db: State<'_, Db>,
    name: String,
    root_path: String,
) -> Result<u32, String> {
    db.create_project(name, root_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_project(db: State<'_, Db>, project_id: u32) -> Result<(), String> {
    db.delete_project(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn rename_project(
    db: State<'_, Db>,
    project_id: u32,
    name: String,
) -> Result<(), String> {
    db.rename_project(project_id, name)
        .await
        .map_err(|e| e.to_string())
}


#[tauri::command]
#[specta::specta]
pub async fn project_stats(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<ProjectStats, String> {
    let files = db.count_files(project_id).await.map_err(|e| e.to_string())?;
    let chunks = db.count_chunks(project_id).await.map_err(|e| e.to_string())?;
    Ok(ProjectStats { files, chunks })
}

#[tauri::command]
#[specta::specta]
pub async fn clear_project_index(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<(), String> {
    db.clear_project_index(project_id)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Indexing ----------

#[tauri::command]
#[specta::specta]
pub async fn index_project(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    on_progress: Channel<IndexProgress>,
) -> Result<IndexResult, String> {
    use tauri::Manager;
    let _ = &app; // silence unused-var if hook is later disabled
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;

    let root = PathBuf::from(&project.root_path);

    // Load indexing knobs (chunk size, overlap, max file size, exclude globs)
    // from the settings table — missing/invalid values fall back to safe defaults.
    let settings_map: std::collections::HashMap<String, String> = db
        .settings_get_all()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();
    let index_config = indexer::config_from_settings(|k| settings_map.get(k).cloned());

    let files = indexer::walk_text_files(&root, &index_config);
    let total = files.len() as u32;
    info!(project = %project.name, files = total, "indexing start");

    let start = Instant::now();
    let mut files_processed = 0u32;
    let mut files_changed = 0u32;
    let mut chunks_created = 0u32;
    let mut import_resolver_queue = Vec::new();

    for (i, file_path) in files.iter().enumerate() {
        let rel = file_path.strip_prefix(&root).unwrap_or(file_path);
        let rel_str = rel.to_string_lossy().to_string();

        let _ = on_progress.send(IndexProgress {
            current: (i + 1) as u32,
            total,
            current_file: rel_str.clone(),
        });

        let Ok(content) = fs::read_to_string(file_path) else {
            continue;
        };

        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        let metadata = fs::metadata(file_path).map_err(|e| e.to_string())?;
        let size = metadata.len() as i64;
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let language = indexer::language_for(file_path).map(String::from);

        let (file_id, changed) = db
            .upsert_file(project_id, rel_str.clone(), hash, size, mtime, language)
            .await
            .map_err(|e| e.to_string())?;

        files_processed += 1;
        if !changed {
            continue;
        }
        files_changed += 1;

        let (chunks, analysis) = indexer::chunk_file(file_path, &content, &index_config);
        if let Some(ref ana) = analysis {
            for sym in &ana.symbols {
                db.insert_symbol_definition(file_id, sym.clone())
                    .await
                    .map_err(|e| e.to_string())?;
            }
            if !ana.imports.is_empty() {
                import_resolver_queue.push((file_id, rel_str.clone(), ana.imports.clone()));
            }
        }

        if chunks.is_empty() {
            continue;
        }

        for batch in chunks.chunks(EMBED_BATCH) {
            let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
            let embeddings = embedder.embed(texts).await?;

            for (chunk, embedding) in batch.iter().zip(embeddings.iter()) {
                db.insert_chunk_with_embedding(
                    file_id,
                    chunk.kind.to_string(),
                    chunk.start_line,
                    chunk.end_line,
                    chunk.content.clone(),
                    vec_to_bytes(embedding),
                )
                .await
                .map_err(|e| e.to_string())?;
                chunks_created += 1;
            }
        }
    }

    // Resolve dependencies for changed files
    if !import_resolver_queue.is_empty() {
        let all_files = db.list_project_files(project_id).await.map_err(|e| e.to_string())?;
        let project_files: std::collections::HashMap<String, u32> = all_files
            .into_iter()
            .map(|(id, path)| (path, id))
            .collect();

        let path_aliases = indexer::load_path_aliases(&root);

        for (source_file_id, source_rel_path, imports) in import_resolver_queue {
            for import_str in imports {
                if let Some(target_file_id) = indexer::resolve_import(
                    &root,
                    &source_rel_path,
                    &import_str,
                    &project_files,
                    &path_aliases,
                ) {
                    db.insert_file_dependency(project_id, source_file_id, target_file_id)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let took_ms = start.elapsed().as_millis().min(u32::MAX as u128) as u32;
    info!(files_processed, files_changed, chunks_created, took_ms, "indexing done");

    // G2 hook: refresh the project overview in the background. We resolve the
    // default provider/model from settings; if neither is configured (fresh
    // install) we silently skip — the Overview screen still has a manual
    // "다시 생성" button.
    let default_provider = settings_map.get("default_provider").cloned();
    let model_for_provider = default_provider.as_ref().and_then(|p| {
        settings_map
            .get(&format!("model_{}", p))
            .cloned()
            .or_else(|| settings_map.get("default_model").cloned())
    });
    if let (Some(provider), Some(model)) = (default_provider, model_for_provider) {
        let app_handle = app.clone();
        tokio::spawn(async move {
            let db_state = app_handle.state::<Db>();
            match crate::commands::overview::run_generation(
                &db_state,
                project_id,
                &provider,
                &model,
                /*force=*/ false,
            )
            .await
            {
                Ok(Some(_)) => info!(project_id, "overview refreshed after indexing"),
                Ok(None) => info!(project_id, "overview signature unchanged; skipped"),
                Err(e) => tracing::warn!(project_id, error = %e, "overview refresh failed"),
            }
        });
    }

    Ok(IndexResult {
        files_processed,
        files_changed,
        chunks_created,
        took_ms,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_dependency_graph(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<crate::db::DependencyGraph, String> {
    db.get_dependency_graph(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_symbols(
    db: State<'_, Db>,
    file_id: u32,
) -> Result<Vec<crate::ast::SymbolDef>, String> {
    db.get_file_symbols(file_id)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Search ----------

#[tauri::command]
#[specta::specta]
pub async fn search_chunks(
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<ChunkSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let embeddings = embedder.embed(vec![query]).await?;
    let query_emb = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "embed returned no result".to_string())?;

    db.search_chunks(project_id, vec_to_bytes(&query_emb), limit.max(1))
        .await
        .map_err(|e| e.to_string())
}

async fn get_project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn secure_join(root: &std::path::Path, rel_path: &str) -> Result<PathBuf, String> {
    let abs_path = root.join(rel_path);
    let clean = crate::indexer::clean_path(&abs_path);
    if clean.starts_with(root) {
        Ok(clean)
    } else {
        Err("Access denied: path traversal detected".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_project_files(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<(u32, String)>, String> {
    db.list_project_files(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn read_project_file(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<String, String> {
    let root = get_project_root(&db, project_id).await?;
    let full_path = secure_join(&root, &rel_path)?;
    tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
#[specta::specta]
pub async fn write_project_file(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let root = get_project_root(&db, project_id).await?;
    let full_path = secure_join(&root, &rel_path)?;
    tokio::fs::write(&full_path, content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

// ---------- File Change Detection ----------

#[tauri::command]
#[specta::specta]
pub async fn detect_file_changes(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<FileChange>, String> {
    db.clean_duplicate_file_changes().await.map_err(|e| e.to_string())?;
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let root = PathBuf::from(&project.root_path);

    // Get all currently indexed files
    let indexed_files = db.list_project_files(project_id).await.map_err(|e| e.to_string())?;
    let indexed_map: std::collections::HashMap<String, u32> = indexed_files
        .iter()
        .map(|(id, path)| (path.clone(), *id))
        .collect();

    // Walk current filesystem (use same settings-driven config as indexing)
    let settings_map: std::collections::HashMap<String, String> = db
        .settings_get_all()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();
    let index_config = indexer::config_from_settings(|k| settings_map.get(k).cloned());
    let current_files = indexer::walk_text_files(&root, &index_config);
    let mut current_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for file_path in &current_files {
        let rel = file_path.strip_prefix(&root).unwrap_or(file_path);
        let rel_str = rel.to_string_lossy().to_string();
        current_paths.insert(rel_str.clone());

        let Ok(content) = fs::read_to_string(file_path) else { continue };
        let new_hash = blake3::hash(content.as_bytes()).to_hex().to_string();

        if let Some(existing) = db.get_file_hash(project_id, rel_str.clone()).await.map_err(|e| e.to_string())? {
            let (_file_id, old_hash) = existing;
            if old_hash != new_hash {
                // Modified
                db.insert_file_change(
                    project_id,
                    rel_str.clone(),
                    "modified".to_string(),
                    Some(old_hash),
                    Some(new_hash),
                ).await.map_err(|e| e.to_string())?;
            }
        } else {
            // Created (new file not in index)
            db.insert_file_change(
                project_id,
                rel_str.clone(),
                "created".to_string(),
                None,
                Some(new_hash),
            ).await.map_err(|e| e.to_string())?;
        }
    }

    // Check for deleted files
    for path in indexed_map.keys() {
        if !current_paths.contains(path) {
            let old_hash = db.get_file_hash(project_id, path.clone())
                .await
                .map_err(|e| e.to_string())?
                .map(|(_, h)| h);
            db.insert_file_change(
                project_id,
                path.clone(),
                "deleted".to_string(),
                old_hash,
                None,
            ).await.map_err(|e| e.to_string())?;
        }
    }

    // Return today's changes
    let today_start = {
        let now = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        // Align to start of day (UTC)
        now - (now % 86400)
    };

    let changes = db.list_file_changes(project_id, today_start)
        .await
        .map_err(|e| e.to_string())?;

    Ok(changes)
}

#[tauri::command]
#[specta::specta]
pub async fn list_file_changes(
    db: State<'_, Db>,
    project_id: u32,
    since: i32,
) -> Result<Vec<FileChange>, String> {
    db.list_file_changes(project_id, since as i64)
        .await
        .map_err(|e| e.to_string())
}

// ───────────────────────────────────────────────────────────────────────
// G3: Edit prompt generation (with optional clarify step)
//
// Legacy `generate_edit_prompt` is kept as a thin shim that calls the
// `_with_answers` variant with an empty answer list — that way any caller
// still on the old contract keeps working until W6 / UI-7 cleanup.

#[tauri::command]
#[specta::specta]
pub async fn generate_edit_prompt(
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    user_request: String,
    provider: String,
    model: String,
) -> Result<EditPromptResult, String> {
    generate_with_answers_inner(&db, &embedder, project_id, &user_request, &[], &provider, &model)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn generate_edit_prompt_with_answers(
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    user_request: String,
    answers: Vec<ClarifyAnswer>,
    provider: String,
    model: String,
) -> Result<EditPromptResult, String> {
    generate_with_answers_inner(
        &db, &embedder, project_id, &user_request, &answers, &provider, &model,
    )
    .await
}

/// Evaluate how ambiguous the user's request is. Returns 1~3 clarifying
/// questions plus an `auto_proceed` flag — the frontend skips the dialog when
/// `auto_proceed` is true or when no questions are produced.
///
/// We deliberately do NOT embed code context here — the goal is a cheap
/// ambiguity check (≤500 input / ≤300 output tokens per §4.3), so the LLM
/// only sees the user's prompt and a short list of file paths from the
/// project to ground its questions.
#[tauri::command]
#[specta::specta]
pub async fn clarify_edit_intent(
    db: State<'_, Db>,
    project_id: u32,
    user_request: String,
    provider: String,
    model: String,
) -> Result<ClarifyResult, String> {
    let files = db
        .list_project_files(project_id)
        .await
        .map_err(|e| e.to_string())?;
    // Just send up to 30 names so the LLM has a rough sense of the surface
    // area without paying for full content tokens.
    let file_sample: Vec<String> = files.into_iter().take(30).map(|(_, p)| p).collect();

    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("API key for {provider} is not set"))?
    };
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;

    let system_prompt = r#"You judge how ambiguous a Korean developer's edit request is, BEFORE we generate the actual English prompt for a downstream coding agent.

Return ONLY valid JSON (no fences, no prose) shaped exactly like:
{
  "ambiguity_score": <float 0.0–1.0>,
  "questions": [
    { "id": "q1", "kind": "choice" | "text",
      "text": "<짧은 한국어 질문>",
      "options": ["옵션1","옵션2", ...]  // "choice" 일 때만, "text" 면 [] 로
    }
  ],
  "auto_proceed": <bool>
}

Rules:
- score 0.0–0.3 = 명확. auto_proceed=true, questions=[].
- score 0.4–1.0 = 모호. 1~3개 질문 생성. auto_proceed=false.
- Questions must reduce real ambiguity (대상 페이지/영향 범위/원하는 톤 등). Don't ask trivia.
- Korean tone, ≤40자, one question = one decision.
- 최대 3 questions.
"#;

    let user_msg = format!(
        "사용자 요청: {req}\n\n프로젝트 파일 샘플 ({n}개):\n{files}",
        req = user_request,
        n = file_sample.len(),
        files = file_sample.join("\n"),
    );

    let response = client
        .chat(
            vec![
                llm::Message { role: llm::Role::System, content: system_prompt.to_string() },
                llm::Message { role: llm::Role::User, content: user_msg },
            ],
            llm::ChatOptions {
                model,
                temperature: Some(0.2),
                max_tokens: Some(400),
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
        .map_err(|e| format!("Failed to parse clarify LLM response: {e}\nRaw: {content}"))?;

    let ambiguity_score = parsed
        .get("ambiguity_score")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.0);

    let auto_proceed = parsed
        .get("auto_proceed")
        .and_then(|v| v.as_bool())
        .unwrap_or(ambiguity_score < 0.4);

    let questions_value = parsed.get("questions").cloned().unwrap_or_default();
    let mut questions: Vec<ClarifyQuestion> = serde_json::from_value(questions_value)
        .unwrap_or_default();
    // Belt-and-suspenders: even if the LLM hands us 10 questions, hard-cap
    // at 3 — the master guide is explicit about this number.
    questions.truncate(3);

    Ok(ClarifyResult {
        ambiguity_score,
        questions,
        auto_proceed,
    })
}

// ─── shared core ───────────────────────────────────────────────────────

async fn generate_with_answers_inner(
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    user_request: &str,
    answers: &[ClarifyAnswer],
    provider: &str,
    model: &str,
) -> Result<EditPromptResult, String> {
    // 1. Vector search for relevant code chunks. We seed the embedding with
    // user_request + answers (joined) so refined intent steers retrieval.
    let mut query = user_request.to_string();
    for a in answers {
        query.push('\n');
        query.push_str(&a.answer);
    }
    let embeddings = embedder.embed(vec![query]).await?;
    let query_emb = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "embed returned no result".to_string())?;

    let chunks = db
        .search_chunks(project_id, vec_to_bytes(&query_emb), 8)
        .await
        .map_err(|e| e.to_string())?;

    let mut code_context = String::new();
    let mut related_files: Vec<String> = Vec::new();
    for chunk in &chunks {
        if !related_files.contains(&chunk.file_path) {
            related_files.push(chunk.file_path.clone());
        }
        code_context.push_str(&format!(
            "### `{}` (lines {}-{})\n```\n{}\n```\n\n",
            chunk.file_path, chunk.start_line, chunk.end_line, chunk.content
        ));
    }

    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("API key for {provider} is not set"))?
    };
    let client = llm::create(provider, api_key).map_err(|e| e.to_string())?;

    let system_prompt = format!(
        r#"You are an expert software engineering assistant that generates precise, actionable prompts for AI code editors (like Claude Code, Cursor, etc.).

Given the user's request (which may be in Korean or any language), optionally the user's clarifying answers, and the relevant code context from their codebase, you must output a JSON object with exactly two fields:

1. "english_prompt": A detailed, well-structured English prompt that an AI coding assistant can directly use to implement the requested changes. This should include:
   - Clear description of what needs to be changed
   - Which files are involved
   - Specific implementation details and constraints
   - The relevant code context embedded naturally

2. "korean_summary": A concise Korean summary (3-5 sentences) of what the prompt asks the AI to do, so the user can verify the intent is correct.

Relevant code from the project:
{code_context}

Output ONLY valid JSON, no markdown fences, no explanation outside the JSON."#
    );

    let mut user_msg = format!("사용자 요청: {}", user_request);
    if !answers.is_empty() {
        user_msg.push_str("\n\n사용자가 제공한 명확화 답변:\n");
        for a in answers {
            user_msg.push_str(&format!("- {}: {}\n", a.id, a.answer));
        }
    }

    let response = client
        .chat(
            vec![
                llm::Message { role: llm::Role::System, content: system_prompt },
                llm::Message { role: llm::Role::User, content: user_msg },
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
        .map_err(|e| format!("Failed to parse LLM response as JSON: {e}\nRaw: {content}"))?;

    let english_prompt = parsed
        .get("english_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or(content)
        .to_string();

    let korean_summary = parsed
        .get("korean_summary")
        .and_then(|v| v.as_str())
        .unwrap_or("요약을 생성하지 못했습니다.")
        .to_string();

    Ok(EditPromptResult {
        english_prompt,
        korean_summary,
        related_files,
    })
}

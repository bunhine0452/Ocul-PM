use std::fs;
use std::path::PathBuf;
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tracing::info;

use crate::db::{ChunkSearchResult, Db, Project, SymbolSearchResult};
use crate::embedding::{vec_to_bytes, Embedder};
use crate::indexer;


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
pub async fn delete_project(
    db: State<'_, Db>,
    project_id: u32,
    // Independently opt in to deleting Ocul-PM's on-disk artifacts from the
    // project folder: the `.oculpm/` directory and/or `AGENTS.md`. Both off by
    // default so the plain "워크스페이스에서 제거" stays non-destructive.
    delete_oculpm: bool,
    delete_agents_md: bool,
) -> Result<(), String> {
    if delete_oculpm || delete_agents_md {
        // Capture the root BEFORE the DB row is gone. If the project lookup
        // fails we skip file cleanup (nothing reliable to point at) and still
        // remove the workspace entry below.
        if let Ok(project) = db.get_project(project_id).await {
            let root = PathBuf::from(&project.root_path);
            if delete_oculpm {
                let oculpm_dir = root.join(".oculpm");
                if oculpm_dir.is_dir() {
                    fs::remove_dir_all(&oculpm_dir)
                        .map_err(|e| format!("Could not delete the .oculpm folder: {e}"))?;
                }
            }
            if delete_agents_md {
                let agents_md = root.join("AGENTS.md");
                if agents_md.is_file() {
                    fs::remove_file(&agents_md)
                        .map_err(|e| format!("Could not delete AGENTS.md: {e}"))?;
                }
            }
        }
    }
    db.delete_project(project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 카드·탭의 겉모습 — 아이콘 id 와 색 id. 둘 다 `None` 이면 기본값(이름에서
/// 유도)으로 되돌아간다.
#[tauri::command]
#[specta::specta]
pub async fn set_project_appearance(
    db: State<'_, Db>,
    project_id: u32,
    icon: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    db.set_project_appearance(project_id, icon, color)
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
            .upsert_file(project_id, rel_str.clone(), hash.clone(), size, mtime, language)
            .await
            .map_err(|e| e.to_string())?;

        files_processed += 1;
        if !changed {
            continue;
        }
        files_changed += 1;

        // PR6.6 — capture the just-indexed content as the diff baseline so
        // LocalDiffView can fall back to a snapshot diff when git can't
        // serve `HEAD` (fresh repo) or the project isn't a git repo.
        db.upsert_file_snapshot(
            project_id,
            rel_str.clone(),
            content.as_bytes().to_vec(),
            hash.clone(),
        )
        .await
        .map_err(|e| e.to_string())?;

        let (chunks, analysis) = indexer::chunk_file(file_path, &content, &index_config);
        if let Some(ref ana) = analysis {
            db.insert_symbol_definitions(file_id, ana.symbols.clone())
                .await
                .map_err(|e| e.to_string())?;
            if !ana.imports.is_empty() {
                import_resolver_queue.push((file_id, rel_str.clone(), ana.imports.clone()));
            }
            // PR-GR2: persist raw relations (resolved into calls/inherits edges
            // by rebuild_code_graph). Replace so re-index doesn't duplicate; an
            // empty vec clears stale rows for this file.
            let rels: Vec<(String, Option<String>, String)> = ana
                .relations
                .iter()
                .map(|r| (r.kind.clone(), r.from_symbol.clone(), r.name.clone()))
                .collect();
            db.replace_symbol_relations(file_id, rels)
                .await
                .map_err(|e| e.to_string())?;
        }

        if chunks.is_empty() {
            continue;
        }

        for batch in chunks.chunks(EMBED_BATCH) {
            let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
            let embeddings = embedder.embed(texts).await?;

            let rows: Vec<crate::db::ChunkInsert> = batch
                .iter()
                .zip(embeddings.iter())
                .map(|(chunk, embedding)| crate::db::ChunkInsert {
                    kind: chunk.kind.to_string(),
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    content: chunk.content.clone(),
                    embedding: vec_to_bytes(embedding),
                })
                .collect();
            chunks_created += db
                .insert_chunks_with_embeddings(file_id, rows)
                .await
                .map_err(|e| e.to_string())? as u32;
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

    // PR-GR1: rebuild the code graph (graph_nodes/graph_edges) from the freshly
    // indexed files / symbols / dependencies. Deterministic + LLM-free; best
    // effort (a failure here must not fail the whole index).
    if let Err(e) = db.rebuild_code_graph(project_id).await {
        tracing::warn!(project_id, error = %e, "code graph rebuild failed");
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
    // 의미검색 문서 제외 — false (default from the UI) hides .md/.txt/… so code
    // hits aren't buried; the search screen exposes a "문서 포함" toggle.
    include_docs: bool,
) -> Result<Vec<ChunkSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let embeddings = embedder.embed(vec![query]).await?;
    let query_emb = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "embed returned no result".to_string())?;

    db.search_chunks(project_id, vec_to_bytes(&query_emb), limit.max(1), include_docs)
        .await
        .map_err(|e| e.to_string())
}

// PR-R1b (A2) — exact substring search over indexed chunk text (no embedding).
#[tauri::command]
#[specta::specta]
pub async fn search_text(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<ChunkSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    db.search_text(project_id, query, limit.max(1))
        .await
        .map_err(|e| e.to_string())
}

// PR-R1b (A2) — symbol-name search over the AST symbol index.
#[tauri::command]
#[specta::specta]
pub async fn search_symbols(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<SymbolSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    db.search_symbols(project_id, query, limit.max(1))
        .await
        .map_err(|e| e.to_string())
}

// C2 — 결정적 스택 감지: 프로젝트 루트의 매니페스트(+확장자 폴백)만으로
// 언어·프레임워크 태그를 뽑는다 (LLM 0 · 네트워크 0). 스킬 카탈로그 추천의
// 매칭 키. 로직은 oculpm::stack_detect 에 — 여기는 root 해석만.
#[tauri::command]
#[specta::specta]
pub async fn detect_stack(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<String>, String> {
    let root = get_project_root(&db, project_id).await?;
    tokio::task::spawn_blocking(move || crate::oculpm::stack_detect::detect_stack(&root))
        .await
        .map_err(|e| format!("Stack detection failed: {e}"))
}

async fn get_project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// 프로젝트 루트 안쪽으로만 해석되는 join. `..` 이스케이프와 **절대경로**
/// (`Path::join` 은 절대경로를 받으면 base 를 통째로 버린다)를 둘 다 막는다.
///
/// 신뢰할 수 없는 출처(터미널 출력·검색 결과·LLM 응답)에서 온 경로는 반드시
/// 이걸 통과시킨다. `external_editor` 도 같은 함수를 쓴다 — 방어를 복제하면
/// 한쪽만 고쳐지고 다른 쪽이 남는다.
pub(crate) fn secure_join(root: &std::path::Path, rel_path: &str) -> Result<PathBuf, String> {
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

/// Read an inclusive, 1-indexed line range from a project file. Backs the
/// symbol-search "펼쳐서 코드 보기" toggle — symbol hits carry only a line
/// range, so the UI lazily fetches the body on expand instead of bloating
/// every result with content. Out-of-range bounds clamp to the file.
#[tauri::command]
#[specta::specta]
pub async fn read_file_range(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    start_line: u32,
    end_line: u32,
) -> Result<String, String> {
    let root = get_project_root(&db, project_id).await?;
    let full_path = secure_join(&root, &rel_path)?;
    let content = tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Ok(String::new());
    }
    let start = (start_line.max(1) as usize - 1).min(lines.len() - 1);
    let end = (end_line as usize).clamp(start + 1, lines.len());
    Ok(lines[start..end].join("\n"))
}

// (G3 clarify/edit-prompt 커맨드는 감사 2026-07-16 에서 은퇴 — 유일 소비자였던
//  ⌘\ AI 오버레이 Quick-Edit 이 제거되면서 함께 삭제. AI 패널이 정본이다.)

use std::fs;
use std::path::PathBuf;
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tracing::info;

use crate::db::{ChunkSearchResult, Db, Project};
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
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    on_progress: Channel<IndexProgress>,
) -> Result<IndexResult, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;

    let root = PathBuf::from(&project.root_path);
    let files = indexer::walk_text_files(&root);
    let total = files.len() as u32;
    info!(project = %project.name, files = total, "indexing start");

    let start = Instant::now();
    let mut files_processed = 0u32;
    let mut files_changed = 0u32;
    let mut chunks_created = 0u32;

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
            .upsert_file(project_id, rel_str, hash, size, mtime, language)
            .await
            .map_err(|e| e.to_string())?;

        files_processed += 1;
        if !changed {
            continue;
        }
        files_changed += 1;

        let chunks = indexer::chunk_lines(&content);
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

    let took_ms = start.elapsed().as_millis().min(u32::MAX as u128) as u32;
    info!(files_processed, files_changed, chunks_created, took_ms, "indexing done");

    Ok(IndexResult {
        files_processed,
        files_changed,
        chunks_created,
        took_ms,
    })
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

//! Lite-W6 PR6 — backend foundation for LocalDiffView (D5).
//!
//! Two commands:
//!   - `reindex_paths`: re-run the per-file indexing pipeline (hash check +
//!     chunk + AST + embeddings) for a caller-supplied path list. This is
//!     the partial-reindex counterpart to `index_project` from
//!     `commands::project`; the per-file body is kept in sync by hand for
//!     now. PR6.5+ may extract a shared helper.
//!   - `compute_diff`: returns the unified-diff text for a single path. The
//!     1.0 implementation is **git-only**; non-git projects receive an
//!     explicit `SnapshotsUnavailable` error so the UI can surface a
//!     "(snapshots arrive in 1.1)" hint instead of a generic failure.

use std::fs;
use std::path::PathBuf;
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;
use tracing::info;

use crate::db::Db;
use crate::embedding::{vec_to_bytes, Embedder};
use crate::git;
use crate::indexer;

const EMBED_BATCH: usize = 32;

/// Per-path outcome surfaced to the UI. Skip reasons let the caller render a
/// "(skipped: too large)" badge next to the path without re-running
/// `walk_text_files` filters.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReindexSkipReason {
    NotFound,
    ReadFailed { error: String },
    UpsertFailed { error: String },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ReindexSkip {
    pub path: String,
    pub reason: ReindexSkipReason,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LocalDiffReindexReport {
    pub indexed: Vec<String>,
    pub skipped: Vec<ReindexSkip>,
    pub elapsed_ms: u32,
    pub embeddings_updated: u32,
    pub ast_updated: u32,
}

/// Re-run the indexing pipeline for `paths` (relative to the project root).
/// Mirrors the per-file branch of `commands::project::index_project` so that
/// LocalDiffView can refresh a small set without re-scanning the whole tree.
#[tauri::command]
#[specta::specta]
pub async fn reindex_paths(
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    paths: Vec<String>,
) -> Result<LocalDiffReindexReport, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;

    let root = PathBuf::from(&project.root_path);
    let settings_map: std::collections::HashMap<String, String> = db
        .settings_get_all()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();
    let index_config = indexer::config_from_settings(|k| settings_map.get(k).cloned());

    let start = Instant::now();
    let mut indexed: Vec<String> = Vec::new();
    let mut skipped: Vec<ReindexSkip> = Vec::new();
    let mut embeddings_updated: u32 = 0;
    let mut ast_updated: u32 = 0;

    for rel_str in paths {
        let abs_path = root.join(&rel_str);
        if !abs_path.exists() {
            skipped.push(ReindexSkip {
                path: rel_str,
                reason: ReindexSkipReason::NotFound,
            });
            continue;
        }
        let content = match fs::read_to_string(&abs_path) {
            Ok(c) => c,
            Err(e) => {
                skipped.push(ReindexSkip {
                    path: rel_str,
                    reason: ReindexSkipReason::ReadFailed {
                        error: e.to_string(),
                    },
                });
                continue;
            }
        };
        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        let metadata = match fs::metadata(&abs_path) {
            Ok(m) => m,
            Err(e) => {
                skipped.push(ReindexSkip {
                    path: rel_str,
                    reason: ReindexSkipReason::ReadFailed {
                        error: e.to_string(),
                    },
                });
                continue;
            }
        };
        let size = metadata.len() as i64;
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let language = indexer::language_for(&abs_path).map(String::from);

        let (file_id, _changed) = match db
            .upsert_file(project_id, rel_str.clone(), hash, size, mtime, language)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                skipped.push(ReindexSkip {
                    path: rel_str,
                    reason: ReindexSkipReason::UpsertFailed {
                        error: e.to_string(),
                    },
                });
                continue;
            }
        };

        // We re-index unconditionally even when `changed=false` — callers
        // explicitly asked for these paths, so honouring the request is more
        // useful than the "skip unchanged" heuristic that index_project
        // applies during a full sweep.
        let (chunks, analysis) = indexer::chunk_file(&abs_path, &content, &index_config);
        if let Some(ref ana) = analysis {
            for sym in &ana.symbols {
                db.insert_symbol_definition(file_id, sym.clone())
                    .await
                    .map_err(|e| e.to_string())?;
                ast_updated += 1;
            }
        }
        if !chunks.is_empty() {
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
                    embeddings_updated += 1;
                }
            }
        }

        indexed.push(rel_str);
    }

    let elapsed_ms = start.elapsed().as_millis().min(u32::MAX as u128) as u32;
    info!(
        project = %project.name,
        indexed = indexed.len(),
        skipped = skipped.len(),
        embeddings_updated,
        ast_updated,
        elapsed_ms,
        "reindex_paths done"
    );

    Ok(LocalDiffReindexReport {
        indexed,
        skipped,
        elapsed_ms,
        embeddings_updated,
        ast_updated,
    })
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum DiffSource {
    /// `git diff HEAD -- <path>` output. Empty `patch` = no diff.
    Git { patch: String },
    /// Project is not a git repo. PR6 ships git-only; `file_snapshots`
    /// fallback (D5 §4.2) lands in 1.1.
    SnapshotsUnavailable,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiffResult {
    pub path: String,
    pub source: DiffSource,
}

/// Lite-W6 PR6 — compute the diff for a single path. Git path uses
/// `git::diff_patch`; non-git projects return `SnapshotsUnavailable` so the
/// frontend can render a "(snapshots arrive in 1.1)" placeholder instead of
/// failing.
#[tauri::command]
#[specta::specta]
pub async fn compute_diff(
    db: State<'_, Db>,
    project_id: u32,
    path: String,
    max_bytes: u32,
) -> Result<DiffResult, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;

    let root = PathBuf::from(&project.root_path);
    let max_bytes = max_bytes as usize;

    match git::diff_patch(&root, &path, None, None, max_bytes) {
        Ok(patch) => Ok(DiffResult {
            path,
            source: DiffSource::Git { patch },
        }),
        Err(e) if e == "Not a git repository." => Ok(DiffResult {
            path,
            source: DiffSource::SnapshotsUnavailable,
        }),
        Err(e) => Err(e),
    }
}

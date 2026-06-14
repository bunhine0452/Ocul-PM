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
        match reindex_single_file(&db, &embedder, project_id, &root, &index_config, &rel_str).await {
            Ok((emb, ast)) => {
                embeddings_updated += emb;
                ast_updated += ast;
                indexed.push(rel_str);
            }
            Err(reason) => skipped.push(ReindexSkip { path: rel_str, reason }),
        }
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

/// Reindex one file: upsert + diff snapshot + AST symbols + chunk embeddings.
/// Shared by the `reindex_paths` command and the watcher's incremental
/// auto-index (PR-5). Returns `(embeddings_updated, ast_updated)` or a
/// structured skip reason — unlike the old inline loop, an embed/insert
/// failure on one file is reported as a skip instead of aborting the batch.
/// The file is reindexed unconditionally (no hash short-circuit): callers
/// reach here only for paths they already know changed.
pub(crate) async fn reindex_single_file(
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    root: &std::path::Path,
    index_config: &indexer::IndexConfig,
    rel_str: &str,
) -> std::result::Result<(u32, u32), ReindexSkipReason> {
    let abs_path = root.join(rel_str);
    if !abs_path.exists() {
        return Err(ReindexSkipReason::NotFound);
    }
    let content = fs::read_to_string(&abs_path)
        .map_err(|e| ReindexSkipReason::ReadFailed { error: e.to_string() })?;
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let metadata = fs::metadata(&abs_path)
        .map_err(|e| ReindexSkipReason::ReadFailed { error: e.to_string() })?;
    let size = metadata.len() as i64;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let language = indexer::language_for(&abs_path).map(String::from);

    let (file_id, _changed) = db
        .upsert_file(project_id, rel_str.to_string(), hash.clone(), size, mtime, language)
        .await
        .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?;

    // PR6.6 — refresh the diff baseline so LocalDiffView's snapshot fallback
    // stays current.
    db.upsert_file_snapshot(
        project_id,
        rel_str.to_string(),
        content.as_bytes().to_vec(),
        hash.clone(),
    )
    .await
    .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?;

    let mut embeddings_updated: u32 = 0;
    let mut ast_updated: u32 = 0;
    let (chunks, analysis) = indexer::chunk_file(&abs_path, &content, index_config);
    if let Some(ref ana) = analysis {
        for sym in &ana.symbols {
            db.insert_symbol_definition(file_id, sym.clone())
                .await
                .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?;
            ast_updated += 1;
        }
    }
    if !chunks.is_empty() {
        for batch in chunks.chunks(EMBED_BATCH) {
            let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
            let embeddings = embedder
                .embed(texts)
                .await
                .map_err(|e| ReindexSkipReason::UpsertFailed { error: e })?;
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
                .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?;
                embeddings_updated += 1;
            }
        }
    }

    Ok((embeddings_updated, ast_updated))
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum DiffSource {
    /// `git diff HEAD -- <path>` output. Empty `patch` = no diff.
    Git { patch: String },
    /// PR6.6 — snapshot vs disk unified-diff. Used when the git path can't
    /// serve a baseline: fresh repo (HEAD-less), non-git project, or git
    /// returned an empty patch but the file changed on disk after indexing.
    Snapshot { patch: String },
    /// The file has neither a git baseline nor a captured snapshot. UI prompts
    /// the user to run a partial reindex first.
    SnapshotsUnavailable,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiffResult {
    pub path: String,
    pub source: DiffSource,
}

/// Hybrid diff: tries git first, falls back to the captured snapshot when git
/// can't help. Returns `SnapshotsUnavailable` only when neither baseline exists
/// — never bubbles `fatal: bad revision 'HEAD'` to the UI.
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
        Ok(patch) if !patch.trim().is_empty() => Ok(DiffResult {
            path,
            source: DiffSource::Git { patch },
        }),
        // git succeeded but produced an empty patch — for tracked files
        // that's the truth (HEAD == disk); for untracked files git silently
        // returns empty. Try the snapshot to disambiguate.
        Ok(_) => snapshot_diff(&db, project_id, &root, path, max_bytes).await,
        Err(e) if is_recoverable_git_failure(&e) => {
            snapshot_diff(&db, project_id, &root, path, max_bytes).await
        }
        Err(e) => Err(e),
    }
}

/// Persistent uncommitted-change list for the 변경 diff 화면. Backed by
/// `git status` so it survives app restarts and project switches (the live
/// file-watcher buffer does neither). Non-git projects return an empty Vec and
/// the UI keeps using the watcher buffer + snapshot baselines.
#[tauri::command]
#[specta::specta]
pub async fn git_uncommitted_changes(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<git::GitChange>, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let root = PathBuf::from(&project.root_path);
    Ok(git::uncommitted_changes(&root))
}

/// PR6.6 — re-capture snapshots for the supplied paths from disk content.
/// Powers the LocalDiffView "비우기" action: after the user acknowledges a
/// batch of changes, the diff baselines are advanced so subsequent edits
/// show against the just-cleared state instead of the original index.
#[tauri::command]
#[specta::specta]
pub async fn resnapshot_paths(
    db: State<'_, Db>,
    project_id: u32,
    paths: Vec<String>,
) -> Result<u32, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let root = PathBuf::from(&project.root_path);

    let mut updated: u32 = 0;
    for rel in paths {
        let abs = root.join(&rel);
        let Ok(bytes) = fs::read(&abs) else { continue };
        let hash = blake3::hash(&bytes).to_hex().to_string();
        db.upsert_file_snapshot(project_id, rel, bytes, hash)
            .await
            .map_err(|e| e.to_string())?;
        updated += 1;
    }
    Ok(updated)
}

fn is_recoverable_git_failure(err: &str) -> bool {
    err == "Not a git repository."
        || err.contains("bad revision 'HEAD'")
        || err.contains("unknown revision")
        || err.contains("ambiguous argument 'HEAD'")
}

async fn snapshot_diff(
    db: &Db,
    project_id: u32,
    root: &std::path::Path,
    path: String,
    max_bytes: usize,
) -> Result<DiffResult, String> {
    let Some(snapshot) = db
        .get_file_snapshot(project_id, path.clone())
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(DiffResult {
            path,
            source: DiffSource::SnapshotsUnavailable,
        });
    };

    let abs = root.join(&path);
    // A deleted file (no longer on disk) is not an error: render it as an
    // all-deletions diff against the snapshot baseline so the 변경 diff 화면 /
    // EntryDiffModal show "삭제됨" instead of surfacing
    // `No such file or directory (os error 2)`. Other IO errors still propagate.
    let disk_content = match fs::read(&abs) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("Failed to read {}: {}", path, e)),
    };

    if disk_content == snapshot.content {
        return Ok(DiffResult {
            path,
            source: DiffSource::Snapshot {
                patch: String::new(),
            },
        });
    }

    let prev_text = String::from_utf8_lossy(&snapshot.content);
    let next_text = String::from_utf8_lossy(&disk_content);
    let patch = render_unified_diff(&path, &prev_text, &next_text, max_bytes);

    Ok(DiffResult {
        path,
        source: DiffSource::Snapshot { patch },
    })
}

/// Format a unified-diff so the frontend's `classifyDiffLines` (which already
/// understands `git diff` output) can render snapshot diffs without changes.
/// The header mirrors `git diff --no-prefix` style with `a/` `b/` prefixes
/// to keep line classification consistent.
pub(crate) fn render_unified_diff(path: &str, prev: &str, next: &str, max_bytes: usize) -> String {
    use similar::TextDiff;

    let diff = TextDiff::from_lines(prev, next);
    let body = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();

    let header = format!("diff --git a/{path} b/{path}\n");
    let text = format!("{header}{body}");

    if text.len() > max_bytes {
        let truncated: String = text.chars().take(max_bytes).collect();
        format!(
            "{truncated}\n\n... (truncated, {} bytes total)",
            text.len()
        )
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recoverable_git_failures_cover_fresh_repo_and_non_git() {
        assert!(is_recoverable_git_failure("Not a git repository."));
        assert!(is_recoverable_git_failure(
            "fatal: bad revision 'HEAD'"
        ));
        assert!(is_recoverable_git_failure(
            "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree."
        ));
        assert!(is_recoverable_git_failure(
            "fatal: unknown revision 'main'"
        ));
        // Real git errors that should bubble up to the user untouched.
        assert!(!is_recoverable_git_failure(
            "fatal: pathspec 'foo' did not match any files"
        ));
        assert!(!is_recoverable_git_failure("Permission denied"));
    }

    #[test]
    fn render_unified_diff_produces_git_compatible_headers() {
        let prev = "line a\nline b\nline c\n";
        let next = "line a\nline B\nline c\n";
        let out = render_unified_diff("src/sample.txt", prev, next, 65_536);
        assert!(
            out.starts_with("diff --git a/src/sample.txt b/src/sample.txt\n"),
            "missing diff header: {out}"
        );
        assert!(out.contains("--- a/src/sample.txt"), "missing --- header: {out}");
        assert!(out.contains("+++ b/src/sample.txt"), "missing +++ header: {out}");
        assert!(out.contains("-line b"), "missing - line: {out}");
        assert!(out.contains("+line B"), "missing + line: {out}");
    }

    #[test]
    fn render_unified_diff_truncates_oversized_output() {
        let mut prev = String::new();
        let mut next = String::new();
        for i in 0..2_000 {
            prev.push_str(&format!("prev line {i}\n"));
            next.push_str(&format!("next line {i}\n"));
        }
        let out = render_unified_diff("big.txt", &prev, &next, 1_024);
        assert!(out.contains("... (truncated,"), "missing truncation marker");
        assert!(out.len() < 1_024 + 512, "truncation budget overshot: {}", out.len());
    }
}

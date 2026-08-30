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
    /// minified/생성 파일 — 한 줄이 `indexer::MAX_LINE_BYTES` 를 넘는다.
    Generated,
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
    if !indexer::is_indexable_content(&content) {
        return Err(ReindexSkipReason::Generated);
    }
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
        ast_updated += db
            .insert_symbol_definitions(file_id, ana.symbols.clone())
            .await
            .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?
            as u32;
    }
    if !chunks.is_empty() {
        for batch in chunks.chunks(EMBED_BATCH) {
            let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
            let embeddings = embedder
                .embed(texts)
                .await
                .map_err(|e| ReindexSkipReason::UpsertFailed { error: e })?;
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
            embeddings_updated += db
                .insert_chunks_with_embeddings(file_id, rows)
                .await
                .map_err(|e| ReindexSkipReason::UpsertFailed { error: e.to_string() })?
                as u32;
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
    /// 이미지/기타 바이너리 파일 — 텍스트 diff 는 의미가 없어(깨진 문자 나열)
    /// 파일 카드(이미지는 이전/현재 프리뷰 포함)로 렌더한다. 사이즈는 선택한
    /// baseline 기준 이전/현재 바이트 수; `None` 쪽은 존재하지 않음(신규/삭제).
    Binary {
        is_image: bool,
        old_size: Option<u32>,
        new_size: Option<u32>,
    },
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
/// — never bubbles `fatal: bad revision 'HEAD'` to the UI. 이미지/바이너리는
/// 텍스트 diff 대신 `DiffSource::Binary` 로 내려간다 (파일 카드 렌더).
#[tauri::command]
#[specta::specta]
pub async fn compute_diff(
    db: State<'_, Db>,
    project_id: u32,
    path: String,
    max_bytes: u32,
    // Which baseline to diff against. `None`/`"working"` = the working tree vs
    // `HEAD` (with snapshot fallback) — the default. `"last_commit"` = the most
    // recent commit (`HEAD~1..HEAD`), shown when the working tree is clean.
    baseline: Option<String>,
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
    let is_last_commit = baseline.as_deref() == Some("last_commit");

    // 이미지 확장자는 diff 출력과 무관하게 항상 파일 카드로 — untracked 이미지는
    // git diff 가 빈 패치를 내놓아 "Binary files …" 감지에 걸리지 않는다.
    if image_mime(&path).is_some() {
        let source = binary_source(&db, project_id, &root, &path, true, is_last_commit).await;
        return Ok(DiffResult { path, source });
    }

    if is_last_commit {
        let result = committed_diff(&root, path, max_bytes)?;
        if let DiffSource::Git { patch } = &result.source {
            if patch_reports_binary(patch) {
                let source =
                    binary_source(&db, project_id, &root, &result.path, false, true).await;
                return Ok(DiffResult {
                    path: result.path,
                    source,
                });
            }
        }
        return Ok(result);
    }

    match git::diff_patch(&root, &path, None, None, max_bytes) {
        // git 이 직접 바이너리라고 판정한 경우 (tracked 바이너리의 수정/삭제/스테이지된 추가).
        Ok(patch) if patch_reports_binary(&patch) => {
            let source = binary_source(&db, project_id, &root, &path, false, false).await;
            Ok(DiffResult { path, source })
        }
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

/// Binary variant 의 이전/현재 사이즈 채우기.
///   - working baseline: 이전 = `HEAD` 블롭 (없으면 스냅샷), 현재 = 디스크.
///   - `last_commit` baseline: 이전 = `HEAD~1` 블롭, 현재 = `HEAD` 블롭.
/// 어느 쪽이든 조회 실패는 `None`(존재하지 않음)으로 강등 — 여기서 에러를
/// 올리면 파일 카드조차 못 그린다.
async fn binary_source(
    db: &Db,
    project_id: u32,
    root: &std::path::Path,
    path: &str,
    is_image: bool,
    last_commit: bool,
) -> DiffSource {
    let (old_size, new_size) = if last_commit {
        (
            git::blob_size(root, path, "HEAD~1"),
            git::blob_size(root, path, "HEAD"),
        )
    } else {
        let old = match git::blob_size(root, path, "HEAD") {
            Some(s) => Some(s),
            None => db
                .get_file_snapshot(project_id, path.to_string())
                .await
                .ok()
                .flatten()
                .map(|s| s.content.len() as u64),
        };
        let new = fs::metadata(root.join(path))
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.len());
        (old, new)
    };
    DiffSource::Binary {
        is_image,
        old_size: old_size.map(clamp_u32),
        new_size: new_size.map(clamp_u32),
    }
}

fn clamp_u32(n: u64) -> u32 {
    n.min(u32::MAX as u64) as u32
}

/// Diff a single file across the most recent commit (`HEAD~1..HEAD`). Falls
/// back to the empty tree for a root commit so the first commit's files still
/// render (as all-additions). Always a `Git` source — no snapshot fallback,
/// since both sides are committed refs.
fn committed_diff(root: &std::path::Path, path: String, max_bytes: usize) -> Result<DiffResult, String> {
    let patch = match git::diff_patch(root, &path, Some("HEAD~1"), Some("HEAD"), max_bytes) {
        Ok(p) => p,
        Err(e) if is_recoverable_git_failure(&e) => {
            git::diff_patch(root, &path, Some(git::EMPTY_TREE), Some("HEAD"), max_bytes)?
        }
        Err(e) => return Err(e),
    };
    Ok(DiffResult {
        path,
        source: DiffSource::Git { patch },
    })
}

/// Files changed by the most recent commit, with its sha/subject. The 변경 diff
/// 화면 shows these when the working tree is clean (e.g. the agent committed its
/// work) so the screen isn't empty. `None` for non-git / no-commit repos.
#[tauri::command]
#[specta::specta]
pub async fn git_last_commit_changes(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<git::LastCommitChanges>, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let root = PathBuf::from(&project.root_path);
    Ok(git::last_commit_changes(&root))
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

/// 바이너리 diff 프리뷰의 한 쪽(이전/현재). 프론트가 `data:{mime};base64,…`
/// URI 로 조립해 `<img>` 로 그린다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BinarySide {
    pub mime: String,
    pub base64: String,
    pub size: u32,
}

/// `diff_binary_preview` 응답 — baseline 기준 이전/현재 바이트. 없는 쪽(신규의
/// 이전, 삭제의 현재)이나 16MB 초과 쪽은 `None` (프론트는 사이즈 카드만 표시).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct BinaryPreview {
    pub old: Option<BinarySide>,
    pub new: Option<BinarySide>,
}

/// base64 는 ~33% 부풀고 webview 로 통째로 넘어가므로 프리뷰 상한을 둔다
/// (docs_asset 의 MAX_ASSET_BYTES 와 동일 기준).
const MAX_PREVIEW_BYTES: usize = 16 * 1024 * 1024;

/// 변경 diff 화면의 이미지 프리뷰 payload. `compute_diff` 가
/// `DiffSource::Binary { is_image: true }` 를 내려준 파일에 대해 호출된다.
///   - working baseline: 이전 = `HEAD` 블롭(없으면 스냅샷), 현재 = 디스크.
///   - `last_commit`: 이전 = `HEAD~1`, 현재 = `HEAD`.
#[tauri::command]
#[specta::specta]
pub async fn diff_binary_preview(
    db: State<'_, Db>,
    project_id: u32,
    path: String,
    baseline: Option<String>,
) -> Result<BinaryPreview, String> {
    let project = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let root = PathBuf::from(&project.root_path);
    let mime = image_mime(&path).unwrap_or("application/octet-stream");

    let (old_bytes, new_bytes) = if baseline.as_deref() == Some("last_commit") {
        (
            git::show_file_bytes(&root, &path, "HEAD~1", MAX_PREVIEW_BYTES),
            git::show_file_bytes(&root, &path, "HEAD", MAX_PREVIEW_BYTES),
        )
    } else {
        let old = match git::show_file_bytes(&root, &path, "HEAD", MAX_PREVIEW_BYTES) {
            Some(b) => Some(b),
            None => db
                .get_file_snapshot(project_id, path.clone())
                .await
                .ok()
                .flatten()
                .map(|s| s.content)
                .filter(|c| c.len() <= MAX_PREVIEW_BYTES),
        };
        // 경로는 신뢰 경계 밖(watcher/git 출력)에서 온다 — 루트 밖 접근 차단.
        let abs = crate::commands::project::secure_join(&root, &path)?;
        let new = fs::read(&abs).ok().filter(|b| b.len() <= MAX_PREVIEW_BYTES);
        (old, new)
    };

    Ok(BinaryPreview {
        old: old_bytes.map(|b| encode_side(mime, b)),
        new: new_bytes.map(|b| encode_side(mime, b)),
    })
}

fn encode_side(mime: &str, bytes: Vec<u8>) -> BinarySide {
    use base64::Engine;
    BinarySide {
        mime: mime.to_string(),
        size: clamp_u32(bytes.len() as u64),
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    }
}

fn is_recoverable_git_failure(err: &str) -> bool {
    err == "Not a git repository."
        || err.contains("bad revision 'HEAD'")
        || err.contains("unknown revision")
        || err.contains("ambiguous argument 'HEAD'")
}

/// 이미지 프리뷰 대상 확장자 → MIME. SVG 는 텍스트(XML)라 코드 diff 가 더
/// 유용해서 제외한다. (webview = WKWebView/Safari 렌더 가능 포맷 위주)
fn image_mime(path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(path)
        .extension()?
        .to_str()?
        .to_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        _ => return None,
    })
}

/// git 의 휴리스틱과 동일 — 앞 8000 바이트 안에 NUL 이 있으면 바이너리.
fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

/// 디스크 파일의 앞 8KB 만 읽어 바이너리 여부 판별. 읽기 실패는 "텍스트"로
/// 취급해 기존 경로의 (더 구체적인) 에러 메시지가 유지되게 한다.
fn is_binary_on_disk(abs: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = fs::File::open(abs) else {
        return false;
    };
    let mut buf = [0u8; 8000];
    let Ok(n) = f.read(&mut buf) else {
        return false;
    };
    is_binary_bytes(&buf[..n])
}

/// `git diff` 출력이 내용 대신 "Binary files a/… and b/… differ" 안내인지.
fn patch_reports_binary(patch: &str) -> bool {
    patch
        .lines()
        .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"))
}

async fn snapshot_diff(
    db: &Db,
    project_id: u32,
    root: &std::path::Path,
    path: String,
    max_bytes: usize,
) -> Result<DiffResult, String> {
    let abs = root.join(&path);
    let Some(snapshot) = db
        .get_file_snapshot(project_id, path.clone())
        .await
        .map_err(|e| e.to_string())?
    else {
        // 스냅샷도 git baseline 도 없는 신규 파일. 바이너리면 프론트가 통짜
        // additions 로 읽으려다 실패(read_project_file 은 UTF-8 전용)하고
        // "읽는 중…" 에 갇히므로, 여기서 파일 카드로 강등한다.
        if is_binary_on_disk(&abs) {
            let new_size = fs::metadata(&abs).ok().filter(|m| m.is_file()).map(|m| m.len());
            return Ok(DiffResult {
                path,
                source: DiffSource::Binary {
                    is_image: false,
                    old_size: None,
                    new_size: new_size.map(clamp_u32),
                },
            });
        }
        return Ok(DiffResult {
            path,
            source: DiffSource::SnapshotsUnavailable,
        });
    };

    // A deleted file (no longer on disk) is not an error: render it as an
    // all-deletions diff against the snapshot baseline so the 변경 diff 화면 /
    // EntryDiffModal show "삭제됨" instead of surfacing
    // `No such file or directory (os error 2)`. Other IO errors still propagate.
    let disk_content = match fs::read(&abs) {
        Ok(c) => Some(c),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read {}: {}", path, e)),
    };

    // 어느 한쪽이라도 바이너리면 lossy 텍스트 diff(깨진 문자 나열) 대신 파일
    // 카드로. 삭제된 파일(disk `None`)은 new_size = None 으로 내려간다.
    if is_binary_bytes(&snapshot.content)
        || disk_content.as_deref().is_some_and(is_binary_bytes)
    {
        return Ok(DiffResult {
            path,
            source: DiffSource::Binary {
                is_image: false,
                old_size: Some(clamp_u32(snapshot.content.len() as u64)),
                new_size: disk_content.map(|c| clamp_u32(c.len() as u64)),
            },
        });
    }

    let disk_content = disk_content.unwrap_or_default();
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
        format!(
            "{}\n\n... (truncated, {} bytes total)",
            crate::git::truncate_at_char_boundary(&text, max_bytes),
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

    #[test]
    fn render_unified_diff_truncation_respects_byte_budget_for_multibyte_text() {
        // 옛 구현은 chars 기준으로 잘라 한글 diff 가 예산의 최대 3~4배로 부풀었다.
        let prev: String = "이전 줄입니다\n".repeat(2_000);
        let next: String = "다음 줄입니다\n".repeat(2_000);
        let out = render_unified_diff("big-ko.txt", &prev, &next, 1_024);
        assert!(out.contains("... (truncated,"), "missing truncation marker");
        assert!(out.len() < 1_024 + 128, "byte budget overshot: {}", out.len());
    }

    #[test]
    fn image_mime_maps_known_extensions_only() {
        assert_eq!(image_mime("assets/logo.PNG"), Some("image/png"));
        assert_eq!(image_mime("a/b/pic.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("icon.ico"), Some("image/x-icon"));
        // SVG 는 텍스트 diff 가 더 유용해서 의도적으로 제외.
        assert_eq!(image_mime("logo.svg"), None);
        assert_eq!(image_mime("src/main.rs"), None);
        assert_eq!(image_mime("no_extension"), None);
    }

    #[test]
    fn binary_sniff_finds_nul_only_in_head() {
        assert!(is_binary_bytes(b"\x89PNG\r\n\x1a\n\x00\x00"));
        assert!(!is_binary_bytes("plain text 안녕".as_bytes()));
        // NUL 이 8000 바이트 밖에만 있으면 텍스트 취급 (git 휴리스틱과 동일).
        let mut tail_nul = vec![b'a'; 9000];
        tail_nul[8500] = 0;
        assert!(!is_binary_bytes(&tail_nul));
    }

    #[test]
    fn patch_reports_binary_detects_git_binary_notice() {
        let patch = "diff --git a/img.png b/img.png\nindex 111..222 100644\nBinary files a/img.png and b/img.png differ\n";
        assert!(patch_reports_binary(patch));
        let added = "diff --git a/f.bin b/f.bin\nBinary files /dev/null and b/f.bin differ\n";
        assert!(patch_reports_binary(added));
        // 코드 안에 비슷한 문자열이 인용된 텍스트 diff 는 오탐하지 않는다.
        let text = "diff --git a/a.ts b/a.ts\n+  // Binary files a and b differ somehow\n";
        assert!(!patch_reports_binary(text));
    }
}

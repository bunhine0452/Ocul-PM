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

use crate::indexer::EMBED_BATCH;

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

/// 색인 진행률 IPC 의 최소 간격 — 프런트는 어차피 프레임마다 그리지 않는다.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ProjectStats {
    pub files: u32,
    pub chunks: u32,
    /// Unix seconds of the newest `files.indexed_at` row — `None` when the
    /// project has never been indexed. f64 because specta has no u64/i64.
    pub last_indexed_at: Option<f64>,
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
        .map_err(|e| e.to_string())?;
    // 프로젝트 하나의 파일·청크·임베딩이 통째로 빠졌다 — 페이지는 저절로
    // 돌아오지 않으므로 여기서 VACUUM (완성도 라운드 Phase 3). 사용자가 직접
    // 누른 삭제라 몇 초 멈춤이 허용된다.
    db.compact().await.map_err(|e| e.to_string())
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
pub async fn project_stats(db: State<'_, Db>, project_id: u32) -> Result<ProjectStats, String> {
    let files = db
        .count_files(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let chunks = db
        .count_chunks(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let last_indexed_at = db
        .last_indexed_at(project_id)
        .await
        .map_err(|e| e.to_string())?
        .map(|v| v as f64);
    Ok(ProjectStats {
        files,
        chunks,
        last_indexed_at,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn clear_project_index(db: State<'_, Db>, project_id: u32) -> Result<(), String> {
    db.clear_project_index(project_id)
        .await
        .map_err(|e| e.to_string())?;
    // 색인을 지운 직후가 DB 가 가장 홀쭉해질 수 있는 순간이다 — 다시 색인하기
    // 전에 되돌려 받는다 (완성도 라운드 Phase 3).
    db.compact().await.map_err(|e| e.to_string())
}

// ---------- Indexing ----------

/// `index_project` 의 파일당 **CPU·블로킹 구간** 결과 (read + blake3 + metadata).
///
/// 이 심 전체가 오랫동안 `spawn_blocking` **밖**, 즉 tokio 런타임 워커 위에서
/// 돌았다. 기준선 측정(`docs/20260904_v242-load-bearing/perf-baseline.md` §1 M2)
/// 은 이 저장소(1,327 파일, 릴리스 프로필)에서 walk 204 ms + read·blake3·
/// tree-sitter **6,207 ms** = 워커 하나를 **6,411 ms** 통째로 점유한다고 쟀다.
/// 그 구간을 여기(그리고 `chunk_file` 호출)로 모아 blocking 풀로 넘긴다.
struct PreparedFile {
    content: String,
    hash: String,
    size: i64,
    mtime: i64,
    language: Option<String>,
}

/// `Ok(None)` = 이 파일은 건너뛴다 (읽기 실패 · minified/생성 파일).
/// `Err` = 색인 전체를 중단할 만한 실패 (기존 `metadata` 의 `?` 와 같은 뜻).
fn prepare_file(path: &std::path::Path) -> Result<Option<PreparedFile>, String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(None);
    };
    // minified/생성 파일은 행을 남기지 않고 건너뛴다 — 다음 색인 때 다시
    // 판정되므로 규칙이 바뀌면 스스로 따라온다.
    if !indexer::is_indexable_content(&content) {
        return Ok(None);
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(Some(PreparedFile {
        size: metadata.len() as i64,
        mtime,
        language: indexer::language_for(path).map(String::from),
        content,
        hash,
    }))
}

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
    let index_config = std::sync::Arc::new(indexer::config_from_settings(|k| {
        settings_map.get(k).cloned()
    }));

    // walk 도 블로킹이다 (204 ms · perf-baseline M2). 파일당 루프와 같은 이유로
    // 런타임 워커 위에서 돌리지 않는다.
    let files = {
        let (root, cfg) = (root.clone(), index_config.clone());
        tokio::task::spawn_blocking(move || indexer::walk_text_files(&root, &cfg))
            .await
            .map_err(|e| e.to_string())?
    };
    let total = files.len() as u32;
    info!(project = %project.name, files = total, "indexing start");

    let start = Instant::now();
    let mut files_processed = 0u32;
    let mut files_changed = 0u32;
    let mut chunks_created = 0u32;
    let mut import_resolver_queue = Vec::new();
    // 진행률은 파일마다가 아니라 100ms 에 한 번 (완성도 라운드 Phase 3). 파일
    // 수천 개짜리 저장소에서 IPC 수천 건이 웹뷰 렌더를 밀어내던 것 — 첫 파일과
    // 마지막 파일은 무조건 보내 "n/total" 이 정확히 닫히게 한다.
    let mut last_progress: Option<Instant> = None;

    for (i, file_path) in files.iter().enumerate() {
        let rel = file_path.strip_prefix(&root).unwrap_or(file_path);
        let rel_str = rel.to_string_lossy().to_string();

        let is_last = i + 1 == files.len();
        if is_last || last_progress.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
            let _ = on_progress.send(IndexProgress {
                current: (i + 1) as u32,
                total,
                current_file: rel_str.clone(),
            });
            last_progress = Some(Instant::now());
        }

        let prepared = {
            let fp = file_path.clone();
            tokio::task::spawn_blocking(move || prepare_file(&fp))
                .await
                .map_err(|e| e.to_string())??
        };
        let Some(prepared) = prepared else {
            continue;
        };

        let (file_id, changed) = db
            .upsert_file(
                project_id,
                rel_str.clone(),
                prepared.hash.clone(),
                prepared.size,
                prepared.mtime,
                prepared.language,
            )
            .await
            .map_err(|e| e.to_string())?;

        files_processed += 1;
        if !changed {
            continue;
        }
        files_changed += 1;

        // tree-sitter 파싱이 이 심에서 가장 비싼 구간이다 — 여기도 blocking
        // 풀로. `content` 는 넘겼다가 돌려받아 복사본을 만들지 않는다.
        let (content, chunks, analysis) = {
            let (fp, cfg, content) = (file_path.clone(), index_config.clone(), prepared.content);
            tokio::task::spawn_blocking(move || {
                let (chunks, analysis) = indexer::chunk_file(&fp, &content, &cfg);
                (content, chunks, analysis)
            })
            .await
            .map_err(|e| e.to_string())?
        };

        // PR6.6 — capture the just-indexed content as the diff baseline so
        // LocalDiffView can fall back to a snapshot diff when git can't
        // serve `HEAD` (fresh repo) or the project isn't a git repo.
        db.upsert_file_snapshot(
            project_id,
            rel_str.clone(),
            content.into_bytes(),
            prepared.hash.clone(),
        )
        .await
        .map_err(|e| e.to_string())?;
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
                .insert_chunks_with_embeddings(project_id, file_id, rows)
                .await
                .map_err(|e| e.to_string())? as u32;
        }
    }

    // Resolve dependencies for changed files
    if !import_resolver_queue.is_empty() {
        let all_files = db
            .list_project_files(project_id)
            .await
            .map_err(|e| e.to_string())?;
        let project_files: std::collections::HashMap<String, u32> =
            all_files.into_iter().map(|(id, path)| (path, id)).collect();

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
    info!(
        files_processed,
        files_changed, chunks_created, took_ms, "indexing done"
    );

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
                &db_state, project_id, &provider, &model, /*force=*/ false,
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

    db.search_chunks(
        project_id,
        vec_to_bytes(&query_emb),
        limit.max(1),
        include_docs,
    )
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
pub async fn detect_stack(db: State<'_, Db>, project_id: u32) -> Result<Vec<String>, String> {
    let root = get_project_root(&db, project_id).await?;
    tokio::task::spawn_blocking(move || crate::oculpm::stack_detect::detect_stack(&root))
        .await
        .map_err(|e| format!("Stack detection failed: {e}"))
}

async fn get_project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
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

#[cfg(test)]
mod tests {
    use super::prepare_file;

    /// `index_project` 의 파일당 심을 `spawn_blocking` 으로 옮기면서 이 판정이
    /// 함수 하나로 빠져나왔다 — 판정 자체는 예전과 **한 글자도 달라지면 안 된다**.
    #[test]
    fn prepare_file_keeps_the_old_skip_rules() {
        let dir = tempfile::tempdir().unwrap();

        // 정상 파일 — 해시·크기·언어가 채워진다.
        let ok = dir.path().join("a.rs");
        std::fs::write(&ok, "fn main() {}\n").unwrap();
        let p = prepare_file(&ok).unwrap().expect("정상 파일은 Some");
        assert_eq!(p.content, "fn main() {}\n");
        assert_eq!(p.size, 13);
        assert_eq!(p.language.as_deref(), Some("rust"));
        assert_eq!(p.hash, blake3::hash(b"fn main() {}\n").to_hex().to_string());

        // 없는 파일 — 읽기 실패는 **건너뜀**이지 색인 중단이 아니다.
        assert!(prepare_file(&dir.path().join("nope.rs")).unwrap().is_none());

        // minified/생성 파일 — 한 줄이 너무 길면 행을 남기지 않고 건너뛴다.
        let min = dir.path().join("big.js");
        std::fs::write(&min, "x".repeat(50_000)).unwrap();
        assert!(prepare_file(&min).unwrap().is_none());
    }
}

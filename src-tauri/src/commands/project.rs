use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tracing::info;

use crate::db::{ChunkSearchResult, Db, Project, SymbolSearchResult};
use crate::embedding::{vec_to_bytes, Embedder};
use crate::indexer;
use crate::path_guard::secure_join;

mod index_flight;
mod prepare;
pub(crate) mod reconcile;
use prepare::prepare_file;

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
    /// 이번 walk 에 없어 색인에서 지운 파일 수 (A2 화해).
    pub files_removed: u32,
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
    // 웹뷰가 넘기는 경로를 그대로 받던 자리 — 루트·홈을 들이면 거기 `.oculpm/` 이
    // 깔리고 워처가 디스크 전체를 걷는다. 코드는 프런트가 문장으로 옮긴다(StartTab).
    if crate::oculpm::paths::is_unsafe_project_root(Path::new(&root_path)) {
        return Err("unsafe_project_root".to_string());
    }
    db.create_project(name, root_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_project(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    manager: State<'_, crate::oculpm::manager::OculpmManager>,
    project_id: u32,
    // Independently opt in to deleting Ocul-PM's on-disk artifacts from the
    // project folder: the `.oculpm/` directory and/or `AGENTS.md`. Both off by
    // default so the plain "워크스페이스에서 제거" stays non-destructive.
    delete_oculpm: bool,
    delete_agents_md: bool,
) -> Result<(), String> {
    // 매니저에서 **먼저** 잊는다 (감사 라운드 2026-09-11 A1) — 워처·세션·락을
    // 놓지 않으면 자동화 허브가 사라진 프로젝트를 5초마다 두드리고, 아래의
    // `.oculpm` 삭제 뒤에도 살아 있는 세션 액터가 index 를 되살릴 수 있다.
    manager.forget_project(project_id).await;
    // 창에서도 걷는다 — 왜 **행을 지우기 전**인지는 그 함수에 적어 두었다.
    crate::commands::window::close_project_surfaces(&app, project_id).await;
    // 탭이 없던 프로젝트도 서버가 떠 있을 수 있다 (닫힌 뒤 경주에서 진 spawn 등).
    crate::commands::window::stop_code_servers(&app, project_id).await;
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
    // 빠진 페이지는 저절로 안 돌아오므로 VACUUM (Phase 3). **기다리지 않는다**
    // (2026-09-22): 수 초~수십 초인데 DB 연결이 하나라 그동안 모든 호출이 줄을
    // 선다 — 2026-09-17 06:12 에 다른 탭의 init 이 3초 만에 실패한 이유다.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        match app_handle.state::<Db>().compact().await {
            Ok(()) => info!(project_id, "db compacted after project delete"),
            Err(e) => tracing::warn!(project_id, error = %e, "db compact after delete failed"),
        }
    });
    Ok(())
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

/// 같은 프로젝트의 색인은 한 번에 하나 — 진행 중이면 합류한다 (#index-double-run).
#[tauri::command]
#[specta::specta]
pub async fn index_project(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    embedder: State<'_, Embedder>,
    project_id: u32,
    on_progress: Channel<IndexProgress>,
) -> Result<IndexResult, String> {
    let sink = Box::new(move |p| drop(on_progress.send(p)));
    index_flight::INDEX_FLIGHTS
        .run(project_id, sink, |progress| {
            run_index(&app, &db, &embedder, project_id, progress)
        })
        .await
}

async fn run_index(
    app: &tauri::AppHandle,
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    on_progress: index_flight::IndexProgressTx,
) -> Result<IndexResult, String> {
    use tauri::Manager;
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
    // 일지·롤업은 코드 걷기가 `.oculpm/` 을 숨김으로 건너뛰므로 전용 스윕이
    // 따로 돈다 (`{#search-semantic-journal}`). 총계에 미리 더한다 — 안 그러면
    // 막대가 코드 끝에서 100% 로 멈춘 채 일지 임베딩을 기다린다.
    let journal_todo = crate::journal_index::todo_from_settings(&root, &settings_map).await?;
    let total = (files.len() + journal_todo.len()) as u32;
    info!(project = %project.name, files = total, "indexing start");

    // diff 기준선 스냅샷은 **git 이 HEAD 로 못 주는 파일**에만 남긴다
    // (`{#snapshot-git-dup}`, 2026-09-12). `commands/diff.rs` 는 `git show HEAD:`
    // 가 실패할 때만 `file_snapshots` 를 읽는데, 색인은 모든 파일을 찍고 있었다 —
    // 라이브 DB 에서 9,817행 81MB 가 git 이 이미 가진 내용의 복사본이었다.
    // 저장소당 `ls-tree` 한 번이라 파일 수천 개에도 git 프로세스는 손에 꼽는다.
    let in_head: std::collections::HashSet<String> = {
        let (root, files) = (root.clone(), files.clone());
        tokio::task::spawn_blocking(move || {
            let mut head = crate::git::nesting::HeadIndex::default();
            files
                .iter()
                .filter_map(|p| {
                    let rel = crate::git::slash(p.strip_prefix(&root).unwrap_or(p));
                    head.contains(&root, &rel).then_some(rel)
                })
                .collect()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    // 이번 walk 에서 스냅샷이 **필요한** 파일 — 색인이 끝나면 이 밖의 스냅샷은
    // 전부 지운다 (HEAD 에 들어간 파일의 옛 복사본 · `files` 행이 없는 고아).
    let mut snapshot_keep: Vec<String> = Vec::new();

    let start = Instant::now();
    let mut files_processed = 0u32;
    let mut files_changed = 0u32;
    let (mut chunks_created, mut chunks_embedded) = (0u32, 0u32);
    let mut import_resolver_queue = Vec::new();
    // 진행률은 파일마다가 아니라 100ms 에 한 번 (완성도 라운드 Phase 3). 파일
    // 수천 개짜리 저장소에서 IPC 수천 건이 웹뷰 렌더를 밀어내던 것 — 첫 파일과
    // 마지막 파일은 무조건 보내 "n/total" 이 정확히 닫히게 한다.
    let mut last_progress: Option<Instant> = None;

    for (i, file_path) in files.iter().enumerate() {
        let rel = file_path.strip_prefix(&root).unwrap_or(file_path);
        // 색인 키는 저장 모양(`/`) — 워처의 증분 색인(`change.path`)과 같은 행을 가리키게.
        let rel_str = crate::git::slash(rel);

        let is_last = i + 1 == files.len();
        if is_last || last_progress.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
            on_progress.send(IndexProgress {
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

        let needs_snapshot = !in_head.contains(&rel_str);
        if needs_snapshot {
            snapshot_keep.push(rel_str.clone());
        }
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
        // serve `HEAD` (fresh repo, untracked file) or the project isn't a
        // git repo. HEAD 에 있는 파일은 찍지 않는다 (`{#snapshot-git-dup}`).
        if needs_snapshot {
            db.upsert_file_snapshot(
                project_id,
                rel_str.clone(),
                content.into_bytes(),
                prepared.hash.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;
        }
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

        // 같은 내용의 벡터는 다시 임베딩하지 않는다 — 옛 청크 · 통째 사본 (`indexer::store`).
        let pending = chunks.into_iter().map(Into::into).collect();
        let stored = indexer::store::store_file_chunks(
            db,
            embedder,
            project_id,
            file_id,
            &prepared.hash,
            pending,
        )
        .await?;
        chunks_created += stored.inserted;
        chunks_embedded += stored.embedded;
    }

    // 일지·롤업 스윕. 옵션이 꺼져 있으면 `journal_todo` 가 비어 있고, 그러면
    // 바로 아래 화해가 남은 일지 행을 청소한다.
    let code_done = files.len() as u32;
    let (journal_files, journal_chunks) =
        crate::journal_index::sweep(db, embedder, project_id, &root, journal_todo, |n, path| {
            on_progress.send(IndexProgress {
                current: code_done + n,
                total,
                current_file: path.to_string(),
            });
        })
        .await?;
    chunks_created += journal_chunks;
    files_processed += journal_files.len() as u32;

    // 화해 — 색인에는 있는데 이번 walk 에 없는 파일을 지운다 (감사 라운드
    // 2026-09-11 A2). 앱이 꺼진 사이 지워진 파일, 나중에 `.gitignore` 에 들어간
    // 폴더는 워처의 Delete 이벤트를 받지 못해 영영 남았다 — 이 저장소만 101 행.
    let files_removed = {
        let mut walked: std::collections::HashSet<String> = files
            .iter()
            .map(|p| crate::git::slash(p.strip_prefix(&root).unwrap_or(p)))
            .collect();
        walked.extend(journal_files);
        let stale: Vec<String> = db
            .list_project_files(project_id)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(_, path)| path)
            .filter(|path| !walked.contains(path))
            .collect();
        let n = db
            .delete_files_by_paths(project_id, stale)
            .await
            .map_err(|e| e.to_string())?;
        if n > 0 {
            info!(
                project_id,
                removed = n,
                "index reconcile: dropped files no longer on the walk"
            );
        }
        n
    };
    // 스냅샷 화해 (`{#snapshot-git-dup}`) — 위 `files` 화해와 같은 가정(이번
    // walk 가 완전하다) 위에서, 필요 목록 밖의 스냅샷을 한 트랜잭션으로 지운다.
    match db
        .retain_file_snapshots(project_id, std::mem::take(&mut snapshot_keep))
        .await
    {
        Ok(n) if n > 0 => info!(
            project_id,
            removed = n,
            "index reconcile: dropped snapshots git already serves (or orphans)"
        ),
        Ok(_) => {}
        Err(e) => tracing::warn!(project_id, error = %e, "snapshot reconcile failed"),
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
        files_changed, chunks_created, chunks_embedded, took_ms, "indexing done"
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
                Err(e) => {
                    tracing::warn!(project_id, error = %e, "overview refresh failed");
                    // 로그만으로는 아무도 모른다 — 화면으로 올린다 (2026-09-14 감사 7번).
                    let evt = crate::commands::overview::LlmBackgroundFailed {
                        project_id,
                        provider: provider.clone(),
                        model: model.clone(),
                        job: "overview".to_string(),
                        message: e,
                    };
                    let _ = tauri_specta::Event::emit(&evt, &app_handle);
                }
            }
        });
    }

    Ok(IndexResult {
        files_processed,
        files_changed,
        chunks_created,
        files_removed,
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
    // 일지 청크 포함 — 기본 true (「일지 제외」 토글이 false 를 보낸다). 프런트
    // 필터가 아니라 인자인 이유는 상한(limit)이 백엔드에 있어서다: 프런트에서
    // 걸러 내면 "일지를 뺀 20건" 이 아니라 "20건 중 남은 것" 이 된다.
    include_journal: bool,
) -> Result<Vec<ChunkSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let embeddings = embedder.embed(vec![query]).await?;
    let query_emb = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "embed returned no result".to_string())?;

    let mut hits = db
        .search_chunks(
            project_id,
            vec_to_bytes(&query_emb),
            limit.max(1),
            include_docs,
            include_journal,
        )
        .await
        .map_err(|e| e.to_string())?;
    // 꺼낸 청크는 AI 패널 프롬프트(RAG, `aiContext.ts`)와 모바일로 기기 밖에 나간다.
    // 저장소 파일이라 「사용자가 친 글」 이 아니므로 프로젝트 패턴으로 가린다
    // (2026-10-08 검토 — notion_export 와 같은 규율). 화면의 의미 검색도 같은 결과를
    // 본다. 정확 문자열 검색(`search_text`)은 가리지 않는다 — 그 문자열을 찾는 중이다.
    let patterns = match db.get_project(project_id).await {
        Ok(p) => crate::oculpm::redact::patterns_for_project(std::path::Path::new(&p.root_path)),
        Err(_) => crate::oculpm::redact::compile_redact_patterns(&[]),
    };
    for hit in &mut hits {
        hit.content = crate::oculpm::redact::redact_text(&hit.content, &patterns).0;
    }
    Ok(hits)
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
    read_lines(&root, &rel_path, start_line, end_line).await
}

/// `root` 안 `rel_path` 의 `[start_line, end_line]` (1부터). 명령과 테스트가 같은 길을 탄다.
async fn read_lines(
    root: &std::path::Path,
    rel_path: &str,
    start_line: u32,
    end_line: u32,
) -> Result<String, String> {
    let full_path = secure_join(root, rel_path)?;
    // 색인이 빼는 비밀 파일(`.env`·키 파일 …)은 여기서도 안 읽는다. 데스크톱 호출부는
    // 색인에서 온 경로라 걸릴 일이 없지만, 모바일 브리지는 아무 경로나 보낼 수 있다 —
    // 페어링된 폰이 `.env` 를 읽던 자리 (2026-10-09 리포트).
    let name = full_path.file_name().map(|n| n.to_string_lossy());
    if name.is_some_and(|n| crate::oculpm::redact::is_secret_file_name(&n)) {
        return Err(format!("{rel_path}: secret files are not readable here"));
    }
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
    use super::read_lines;

    /// 색인이 빼는 비밀 파일은 범위 읽기로도 안 나온다 — 모바일 브리지가 아무 경로나
    /// 보낼 수 있는 창구다. 평범한 파일은 그대로 읽힌다 (대조군).
    #[tokio::test]
    async fn secret_files_stay_unreadable_through_line_ranges() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "API_KEY=x\n").unwrap();
        std::fs::create_dir(dir.path().join("keys")).unwrap();
        std::fs::write(dir.path().join("keys/deploy.pem"), "-----\n").unwrap();
        std::fs::write(dir.path().join("main.rs"), "fn a() {}\nfn b() {}\n").unwrap();

        assert!(read_lines(dir.path(), ".env", 1, 5).await.is_err());
        assert!(read_lines(dir.path(), "keys/deploy.pem", 1, 5)
            .await
            .is_err());
        assert_eq!(
            read_lines(dir.path(), "main.rs", 2, 2).await.unwrap(),
            "fn b() {}"
        );
    }
}

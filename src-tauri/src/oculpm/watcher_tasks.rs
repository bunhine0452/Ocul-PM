//! 워처가 띄우는 **곁일(background work)** — 동시 상한과 수명을 워처에 묶는다.
//!
//! 이 파일이 생긴 이유는 두 가지다.
//!
//! **1. 수명.** `schedule_incremental_index` 와 `schedule_history_capture` 는
//! 둘 다 `tauri::async_runtime::spawn` 으로 **detached** 였다. 프로젝트를 닫아
//! 워처를 내려도 그 태스크들은 살아남아 계속 DB 를 두드렸다. 브랜치를 한 번
//! 전환하면 한 배치에 1,058 이벤트가 들어오므로(perf-baseline §1 M1), 닫힌
//! 프로젝트가 수백 개의 색인 태스크를 뒤에 남기는 일이 실제로 가능했다.
//! 이건 성능이 아니라 **정확성·수명** 문제다.
//!
//! **2. 동시 상한.** 상한이 없으면 같은 버스트가 임베딩 모델과 tree-sitter 를
//! 동시에 수백 벌 부른다. 새 의존성은 쓰지 않는다 — tokio 의 `Semaphore` 와
//! `watch` 로 충분하다 (`tokio-util` 의 `CancellationToken`/`TaskTracker` 는
//! 직접 의존성이 아니라 굳이 늘리지 않았다).
//!
//! 취소는 **두 겹**이다: 세마포어를 `close()` 하면 아직 시작 못 한 것이 즉시
//! 포기하고, `watch` 신호는 이미 `await` 중인 것을 다음 폴에서 끊는다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::{watch, Semaphore};

use crate::db::Db;
use crate::embedding::Embedder;
use crate::oculpm::history;
use crate::oculpm::spec::{FileChangeEvent, FileOp};

/// 증분 색인 동시 상한.
///
/// 2 인 이유: 임베딩은 `embedding.rs` 의 전역 뮤텍스로 어차피 직렬화된다 —
/// 그보다 많이 띄우면 처리량은 그대로인 채 OS 스레드만 파킹된다. 하나가
/// 임베딩을 도는 동안 다른 하나가 읽기·해시·DB 를 진행할 만큼만 둔다.
pub const INDEX_PERMITS: usize = 2;

/// 로컬 히스토리 캡처 동시 상한. 캡처 자체는 `spawn_blocking` 안의 짧은 파일
/// IO 라 색인보다 넉넉해도 되지만, 버스트 하나가 blocking 풀을 통째로 먹는
/// 것(그 풀을 git·검색과 나눠 쓴다)은 막는다.
pub const HISTORY_PERMITS: usize = 4;

/// 곁일의 갈래 — 갈래마다 상한이 따로다. 히스토리 버스트가 색인을 굶기면
/// 안 되고, 그 반대도 안 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Index,
    History,
}

/// 워처가 소유하는 곁일 게이트. `WatcherInner` 가 들고 다닌다 (`Clone`).
#[derive(Clone)]
pub struct WatcherTasks {
    index: Arc<Semaphore>,
    history: Arc<Semaphore>,
    cancel: watch::Receiver<bool>,
    /// 경로별 직렬화 — 같은 `(프로젝트, 경로)` 의 곁일은 한 번에 하나만 돈다.
    ///
    /// 퍼밋이 2개라 같은 파일의 Update 와 Delete 가 **동시에** 돌 수 있었다: Update 가
    /// 내용을 읽어 임베딩하는 사이 Delete 가 행을 걷고, 그 뒤 Update 의 upsert 가
    /// 행을 되살린다 — 디스크에 없는 파일이 의미 검색에 남는 유령 색인(실측
    /// 2026-10-18, 14행)의 남은 경로다. 열쇠는 일이 끝나면 지워 표가 자라지 않는다.
    keys: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

/// 워처 본체(`ProjectWatcher`)가 쥐는 종료 손잡이. 드롭만 해도 곁일이 끊긴다.
pub struct WatcherTasksShutdown {
    tx: watch::Sender<bool>,
    index: Arc<Semaphore>,
    history: Arc<Semaphore>,
}

impl WatcherTasksShutdown {
    /// 아직 시작 못 한 곁일은 즉시 포기시키고, 도는 것은 다음 폴에서 끊는다.
    /// 멱등 — `stop()` 이 부르고 드롭이 한 번 더 불러도 무해하다.
    ///
    /// **순서가 중요하다: 닫기가 먼저다.** 취소 신호를 먼저 보내면 도는 곁일이
    /// 깨어나 퍼밋을 놓고, 그 퍼밋이 대기 중이던 곁일에게 곧바로 넘어간다 —
    /// 내려가는 워처가 오히려 남은 일감을 **깨워서 돌린다**. 실제로 이 순서로
    /// 짰다가 테스트에서 8개 중 4개가 뒤늦게 실행됐다. `close()` 를 먼저 하면
    /// 대기자는 전부 `AcquireError` 를 받고, 그 뒤 풀리는 퍼밋을 받을 waiter 가
    /// 남지 않는다.
    pub fn shutdown(&self) {
        self.index.close();
        self.history.close();
        // `send` 는 수신자가 없으면 실패한다 — 그 경우에도 값은 남아야 한다.
        self.tx.send_replace(true);
    }
}

impl Drop for WatcherTasksShutdown {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 게이트 한 쌍을 만든다.
pub fn gate() -> (WatcherTasks, WatcherTasksShutdown) {
    let (tx, cancel) = watch::channel(false);
    let index = Arc::new(Semaphore::new(INDEX_PERMITS));
    let history = Arc::new(Semaphore::new(HISTORY_PERMITS));
    (
        WatcherTasks {
            index: index.clone(),
            history: history.clone(),
            cancel,
            keys: Arc::new(Mutex::new(HashMap::new())),
        },
        WatcherTasksShutdown { tx, index, history },
    )
}

impl WatcherTasks {
    /// 곁일 하나를 띄운다. 상한을 넘으면 **기다리고**, 워처가 내려가면 **포기한다**.
    pub fn spawn<F>(&self, lane: Lane, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        self.spawn_keyed(lane, None, fut)
    }

    /// `spawn` 에 열쇠를 더한 것 — 같은 열쇠의 곁일은 퍼밋을 받은 뒤에도 앞선 것이
    /// 끝나기를 기다린다. 열쇠는 `"<project_id>:<rel_path>"` 를 쓴다.
    pub fn spawn_keyed<F>(&self, lane: Lane, key: Option<String>, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        if *self.cancel.borrow() {
            return;
        }
        let sem = match lane {
            Lane::Index => self.index.clone(),
            Lane::History => self.history.clone(),
        };
        let mut cancel = self.cancel.clone();
        let keys = self.keys.clone();
        tauri::async_runtime::spawn(async move {
            // 세마포어가 닫혔다 = 워처가 내려갔다. 시작조차 하지 않는다.
            let Ok(_permit) = sem.acquire_owned().await else {
                tracing::debug!(
                    target: "oculpm::watcher", ?lane,
                    "곁일 취소 — 워처가 내려가 시작하지 않는다"
                );
                return;
            };
            let lock = key.as_ref().map(|k| {
                let mut map = keys.lock().unwrap_or_else(|e| e.into_inner());
                map.entry(k.clone()).or_default().clone()
            });
            {
                // 퍼밋을 쥔 채 기다린다 — 같은 경로의 앞선 곁일은 짧고(파일 하나),
                // 그 사이 다른 경로가 둘째 퍼밋으로 진행한다.
                let _serial = match lock.as_ref() {
                    Some(m) => Some(m.lock().await),
                    None => None,
                };
                tokio::select! {
                    biased;
                    _ = cancel.changed() => tracing::debug!(
                        target: "oculpm::watcher", ?lane,
                        "곁일 취소 — 워처가 내려갔다"
                    ),
                    () = fut => {}
                }
            }
            if let (Some(k), Some(m)) = (key, lock) {
                let mut map = keys.lock().unwrap_or_else(|e| e.into_inner());
                drop(m);
                // 표에 남은 Arc 하나뿐이면 기다리는 이가 없다 — 열쇠를 거둔다.
                if map.get(&k).is_some_and(|e| Arc::strong_count(e) == 1) {
                    map.remove(&k);
                }
            }
        });
    }

    /// 지금 열려 있는 경로 열쇠 수 — 테스트·진단용.
    pub fn open_keys(&self) -> usize {
        self.keys.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// 지금 이 게이트가 살아 있는가 — 테스트·진단용.
    pub fn is_live(&self) -> bool {
        !*self.cancel.borrow() && !self.index.is_closed() && !self.history.is_closed()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// classify 의 blocking 구간
// ─────────────────────────────────────────────────────────────────────────────

/// `metadata` + (상한 이하면) `read` + blake3 를 **`spawn_blocking` 안**에서.
///
/// 정직하게: 이건 **작다**. 기준선 측정(perf-baseline §1 M1b)에서 체크아웃
/// 한 번당 33 ms, 8 MB 상한에 걸리는 최악의 단일 파일이 약 36 ms 였다. 4.3 초
/// 드레인의 주범이 아니다. 그럼에도 옮기는 이유는 **위생**이다 — 런타임 워커
/// 위에서 파일을 통째로 읽는 코드는, 나중에 상한이 커지거나 느린 네트워크
/// 볼륨이 끼면 그때는 주범이 된다.
///
/// 반환값은 `(bytes, hash_after)`. 파일을 읽지 못했거나 상한을 넘으면 해시는
/// `None` — 소비자는 `bytes > cap && hash.is_none()` 으로 "큰 파일이라 해시를
/// 건너뜀" 을 읽는다.
pub async fn stat_and_hash(abs_path: PathBuf, hash_byte_cap: u64) -> (u32, Option<String>) {
    tokio::task::spawn_blocking(move || {
        let Ok(meta) = std::fs::metadata(&abs_path) else {
            return (0u32, None);
        };
        let len = meta.len();
        let bytes = u32::try_from(len).unwrap_or(u32::MAX);
        if len > hash_byte_cap {
            return (bytes, None);
        }
        let hash = std::fs::read(&abs_path)
            .ok()
            .map(|b| format!("blake3:{}", blake3::hash(&b).to_hex()));
        (bytes, hash)
    })
    .await
    .unwrap_or((0, None))
}

// ─────────────────────────────────────────────────────────────────────────────
// 곁일 본체
// ─────────────────────────────────────────────────────────────────────────────

/// B5 — 로컬 히스토리 캡처.
///
/// 삭제는 판을 만들지 않는다 — **지운 파일의 내용을 되찾는 것이 이 기능의
/// 가장 좋은 순간**이라, 삭제 시점에 판을 더하는 대신 기존 판을 그대로 둔다.
/// 해시가 없는 이벤트(파일이 해시 상한보다 크다)도 건너뛴다: 어차피 스냅샷
/// 상한(256KB)을 훨씬 넘는 크기다.
pub fn schedule_history_capture(
    tasks: &WatcherTasks,
    handle: &tauri::AppHandle,
    project_id: u32,
    root: &Path,
    change: &FileChangeEvent,
) {
    if matches!(change.op, FileOp::Delete) {
        return;
    }
    let Some(hash) = change.hash_after.clone() else {
        return;
    };
    if !history::should_capture(&change.path) {
        return;
    }
    // 루트 아래 worktree 사본의 판은 그 worktree 의 git 이 이미 갖는다 — 한 프로젝트의
    // 히스토리 302MB 중 236MB 가 그 사본이었다 (`indexer::worktree`).
    if crate::indexer::worktree::under_linked_worktree(root, Path::new(&change.path)) {
        return;
    }
    let handle = handle.clone();
    let root = root.to_path_buf();
    let rel_path = change.path.clone();
    let op = if matches!(change.op, FileOp::Create) {
        history::HistoryOp::Create
    } else {
        history::HistoryOp::Update
    };
    tasks.spawn(Lane::History, async move {
        use tauri::Manager;
        let db = handle.state::<Db>();
        // 이 라운드에서 유일하게 기본 **켜짐**인 설정이다 — 소급이
        // 불가능하기 때문이다(안 찍어 둔 판은 영원히 없다).
        let on = db
            .settings_get("code_local_history".to_string())
            .await
            .ok()
            .flatten();
        if matches!(on.as_deref(), Some("false") | Some("0")) {
            return;
        }
        let max = db
            .settings_get("code_local_history_max_entries".to_string())
            .await
            .ok()
            .flatten()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(history::DEFAULT_MAX_ENTRIES);
        // 프로젝트 총량 예산 (D1) — 설정 MB, 기본 512.
        let budget = history::budget_from_setting(
            db.settings_get("code_local_history_budget_mb".to_string())
                .await
                .ok()
                .flatten()
                .as_deref(),
        );

        // 쪽지 소비는 동기다 — `spawn_blocking` 너머로 State 를 들고 가지 않는다.
        let source = handle
            .state::<history::HistoryState>()
            .take_source(project_id, &rel_path, &hash);

        let path_for_log = rel_path.clone();
        let done = tauri::async_runtime::spawn_blocking(move || {
            history::capture(&root, &rel_path, op, source, Some(&hash), max, budget)
        })
        .await;
        match done {
            Ok(Ok(history::CaptureOutcome::Captured)) => tracing::debug!(
                target: "oculpm::watcher", project_id, path = %path_for_log, ?source,
                "local history: captured a version"
            ),
            Ok(Err(e)) => tracing::warn!(
                target: "oculpm::watcher", project_id, path = %path_for_log, error = %e,
                "local history: capture failed"
            ),
            _ => {}
        }
    });
}

/// PR-5 — 바뀐 코드 파일 하나의 증분 재색인. 의미/심볼/텍스트 검색이 수동
/// 재구축 없이 최신을 유지한다.
///
/// 가드레일:
///   - `auto_index` 설정 뒤에 있고 (미설정이면 켜짐),
///   - **이미 색인이 있는** 프로젝트에서만 돈다 — 첫 색인의 모델 다운로드 +
///     임베딩 폭풍은 명시적 「인덱스 재구축」 의 몫이다,
///   - 전체 스윕과 같은 파일 단위 필터로 색인 불가 경로를 건너뛰고,
///   - 워처의 디바운스 루프를 막지 않도록 곁일로 돈다 (상한·수명은 게이트가).
pub fn schedule_incremental_index(
    tasks: &WatcherTasks,
    handle: &tauri::AppHandle,
    project_id: u32,
    root: &Path,
    rel_path: String,
    op: FileOp,
    hash_after: Option<String>,
) {
    // 경로만으로 색인 밖인 것(벤더 폴더 · 잠금 파일 · worktree 사본)은 곁일을 띄우지
    // 않는다 — 띄우면 퍼밋 2개 줄에 서서 DB 를 네 번 물은 뒤에야 버려진다. 지우기는
    // 예전에 든 행을 걷어야 하므로 그대로 보낸다.
    if !matches!(op, FileOp::Delete) && !crate::indexer::in_index_scope(root, Path::new(&rel_path))
    {
        return;
    }
    let handle = handle.clone();
    let root = root.to_path_buf();
    let key = format!("{project_id}:{rel_path}");
    tasks.spawn_keyed(Lane::Index, Some(key), async move {
        use tauri::Manager;
        let db = handle.state::<Db>();

        // 사용자 토글 존중 (미설정·꺼짐이 아닌 값은 켜짐으로 본다).
        let auto = db
            .settings_get("auto_index".to_string())
            .await
            .ok()
            .flatten();
        if matches!(auto.as_deref(), Some("false") | Some("0")) {
            return;
        }
        // 있는 색인을 최신으로 유지할 뿐 — 부트스트랩은 수동으로 둔다.
        if !matches!(db.count_files(project_id).await, Ok(n) if n > 0) {
            return;
        }

        // 내용이 실제로 안 바뀌었으면 건너뛴다. 워처가 이미 해시했으므로
        // (`hash_after`) 색인된 해시와 비교하면 재읽기·재임베딩을 피한다 —
        // macOS 에서는 그것이 저장할 때마다 "다른 앱의 파일 접근" 권한 프롬프트를
        // 다시 띄우던 원인이었다 (도그푸딩 2026-06-15). Create/Update 만 해시를
        // 들고 온다; Delete 는 언제나 진행한다.
        if !matches!(op, FileOp::Delete) {
            if let Some(h) = hash_after.as_deref() {
                let new_hash = h.strip_prefix("blake3:").unwrap_or(h);
                if let Ok(Some((_, stored))) = db.get_file_hash(project_id, rel_path.clone()).await
                {
                    if stored == new_hash {
                        return;
                    }
                }
            }
        }

        match op {
            FileOp::Delete => {
                match remove_deleted_from_index(&db, project_id, &root, &rel_path).await {
                    Ok(()) => tracing::debug!(
                        target: "oculpm::watcher", project_id, path = %rel_path,
                        "auto-index: removed deleted file"
                    ),
                    Err(e) => tracing::warn!(
                        target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                        "auto-index: delete failed"
                    ),
                }
            }
            _ => {
                let settings_map: std::collections::HashMap<String, String> =
                    match db.settings_get_all().await {
                        Ok(v) => v.into_iter().collect(),
                        Err(_) => return,
                    };
                let cfg = crate::indexer::config_from_settings(|k| settings_map.get(k).cloned());
                if !crate::indexer::is_indexable_path(&root, Path::new(&rel_path), &cfg) {
                    return;
                }
                let embedder = handle.state::<Embedder>();
                match crate::indexer::reindex_single_file(
                    &db, &*embedder, project_id, &root, &cfg, &rel_path,
                )
                .await
                {
                    Ok((emb, _ast)) => {
                        tracing::debug!(
                            target: "oculpm::watcher", project_id, path = %rel_path,
                            embeddings = emb, "auto-index: reindexed"
                        );
                        // 읽기와 저장 사이에 파일이 사라졌으면 방금 쓴 행이 유령이다.
                        // Delete 이벤트는 이 곁일보다 먼저 지나갔을 수 있다(경로
                        // 직렬화는 **겹침**을 막지, **순서**를 되돌리지는 않는다).
                        reap_if_vanished(&db, project_id, &root, &rel_path).await;
                    }
                    // 정상 동작인 건너뜀은 debug 로 — WARN 으로 두면 진짜
                    // 실패(저장·임베딩)가 그 사이에 묻힌다. 두 갈래다:
                    //  · 생성물(minified·tsbuildinfo·`.vscode-test` 아래 번들)
                    //  · 파일이 그 사이 사라졌다 — fs 이벤트와 이 곁일 사이에
                    //    지워지거나 이름이 바뀐 것(에디터의 원자적 저장이 만드는
                    //    임시파일, 빌드 산출물의 churn, 브랜치 전환)은 경합이
                    //    아니라 **일상**이다. `Delete` 로 다시 오면 행이 걷힌다.
                    Err(reason)
                        if matches!(reason, crate::indexer::ReindexSkipReason::Generated)
                            || is_vanished(&reason) =>
                    {
                        tracing::debug!(
                            target: "oculpm::watcher", project_id, path = %rel_path,
                            ?reason, "auto-index: reindex skipped"
                        )
                    }
                    Err(reason) => tracing::warn!(
                        target: "oculpm::watcher", project_id, path = %rel_path,
                        ?reason, "auto-index: reindex skipped"
                    ),
                }
            }
        }
    });
}

/// 지워진 경로의 색인 행을 걷는다. 경로가 디스크에 아예 없으면 **그 아래도** 걷는다 —
/// 폴더를 통째로 옮기거나 지우면 안의 파일마다 Remove 가 온다는 보장이 없다
/// (`Db::delete_files_under`). 있으면(지우고 곧바로 다시 만든 경우) 그 행만.
pub(crate) async fn remove_deleted_from_index(
    db: &Db,
    project_id: u32,
    root: &Path,
    rel_path: &str,
) -> crate::error::Result<()> {
    if root.join(rel_path).exists() {
        db.delete_file_by_path(project_id, rel_path.to_string())
            .await
    } else {
        db.delete_files_under(project_id, rel_path.to_string())
            .await
            .map(|_| ())
    }
}

/// 색인을 막 쓴 파일이 그 사이 디스크에서 사라졌으면 행을 걷는다. 돌려주는 값은
/// 걷었는지 — 테스트가 본다. 실패는 WARN 으로만 (다음 Delete 나 기동 화해가 받는다).
pub(crate) async fn reap_if_vanished(
    db: &Db,
    project_id: u32,
    root: &Path,
    rel_path: &str,
) -> bool {
    if root.join(rel_path).exists() {
        return false;
    }
    match remove_deleted_from_index(db, project_id, root, rel_path).await {
        Ok(()) => {
            tracing::debug!(
                target: "oculpm::watcher", project_id, path = %rel_path,
                "auto-index: file vanished during indexing — row removed"
            );
            true
        }
        Err(e) => {
            tracing::warn!(
                target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                "auto-index: vanished-file cleanup failed"
            );
            false
        }
    }
}

/// 일지·롤업 한 편의 증분 의미 색인 (journal-scale-round
/// `{#search-semantic-journal}`).
///
/// 가드레일은 `schedule_incremental_index` 와 같은 셋이다 — 설정 뒤에 있고
/// (여기서는 `search_include_journal`, 미설정이면 켬), **이미 색인이 있는**
/// 프로젝트에서만 돌고 (첫 임베딩 모델 다운로드는 「인덱스 재구축」의 몫),
/// 워처 루프를 막지 않도록 곁일로 돈다.
///
/// 해시 게이트는 `reindex_journal_file` 안에 있다 (`upsert_file` 이
/// `changed=false` 를 돌려주면 임베딩을 아예 안 부른다) — 워처가 일지 이벤트에
/// 해시를 달아 오지 않으므로 여기서 미리 걸 수 없다.
pub fn schedule_journal_index(
    tasks: &WatcherTasks,
    handle: &tauri::AppHandle,
    project_id: u32,
    root: &Path,
    rel_path: String,
) {
    let handle = handle.clone();
    let root = root.to_path_buf();
    let key = format!("{project_id}:{rel_path}");
    tasks.spawn_keyed(Lane::Index, Some(key), async move {
        use tauri::Manager;
        let db = handle.state::<Db>();

        let raw = db
            .settings_get(crate::journal_index::SETTING_INCLUDE_JOURNAL.to_string())
            .await
            .ok()
            .flatten();
        if !crate::journal_index::include_journal_enabled(raw.as_deref()) {
            return;
        }
        if !matches!(db.count_files(project_id).await, Ok(n) if n > 0) {
            return;
        }

        // 지워진 일지는 행부터 걷는다 — 파일이 없으면 재색인할 것도 없다.
        if !root.join(&rel_path).exists() {
            if let Err(e) = db.delete_file_by_path(project_id, rel_path.clone()).await {
                tracing::warn!(
                    target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                    "journal-index: delete failed"
                );
            }
            return;
        }

        let embedder = handle.state::<Embedder>();
        // 리댁션은 `journal_index` 가 소유한다 — 여기서 패턴을 만들지 않는다.
        match crate::journal_index::reindex_journal_entry(
            &db, &embedder, project_id, &root, &rel_path,
        )
        .await
        {
            Ok((true, chunks)) => tracing::debug!(
                target: "oculpm::watcher", project_id, path = %rel_path, chunks,
                "journal-index: reindexed"
            ),
            Ok((false, _)) => {}
            Err(e) => tracing::warn!(
                target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                "journal-index: skipped"
            ),
        }
    });
}

/// 「그 사이 파일이 사라졌다」 인가. fs 이벤트와 재색인 사이의 시간은 디바운스와
/// 큐 대기만큼 벌어져 있어, 그동안 지워지거나 이름이 바뀌는 일은 흔하다 —
/// 실패가 아니라 일상이라 로그 등급이 다르다.
///
/// `NotFound` 는 존재 확인에서, `ReadFailed` 는 그 확인과 읽기 **사이**에
/// 사라진 경우다 (같은 사실의 두 시점).
fn is_vanished(reason: &crate::indexer::ReindexSkipReason) -> bool {
    use crate::indexer::ReindexSkipReason as R;
    match reason {
        R::NotFound => true,
        R::ReadFailed { error } => {
            error.contains("No such file or directory")
                || error.contains("os error 2")
                // 디렉터리가 파일 자리를 차지했다 = 그 사이 갈아치워졌다.
                || error.contains("Is a directory")
                // 머리 1KB 는 UTF-8 인데 뒤가 아니다 (탐침 `looks_binary` 를 지난
                // 비텍스트). 고칠 것이 없는 일상이라 같은 등급으로 둔다.
                || error.contains("did not contain valid UTF-8")
        }
        R::Generated | R::UpsertFailed { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::is_vanished;
    use crate::indexer::ReindexSkipReason as R;

    /// 설치본 로그 2026-09-09~11 의 교훈: 정상 경로의 반복 WARN 은 로그 오염이자
    /// 진짜 결함을 가린다. 「사라졌다」 만 debug 로 내리고 저장·임베딩 실패는
    /// WARN 그대로 — 그쪽은 색인이 조용히 뒤처진다는 뜻이다.
    #[test]
    fn only_the_vanished_file_is_routine() {
        assert!(is_vanished(&R::NotFound));
        assert!(is_vanished(&R::ReadFailed {
            error: "No such file or directory (os error 2)".into()
        }));
        assert!(is_vanished(&R::ReadFailed {
            error: "Is a directory (os error 21)".into()
        }));
        assert!(is_vanished(&R::ReadFailed {
            error: "stream did not contain valid UTF-8".into()
        }));
        // 진짜 실패들.
        assert!(!is_vanished(&R::ReadFailed {
            error: "Permission denied (os error 13)".into()
        }));
        assert!(!is_vanished(&R::UpsertFailed {
            error: "database is locked".into()
        }));
        assert!(!is_vanished(&R::Generated));
    }

    /// 설치본 로그 2026-09-30: PDF 가 NUL 탐침을 지나 `read_to_string` 에서 WARN 으로
    /// 터졌다. 머리가 ASCII 인 바이너리와 비 UTF-8 텍스트는 경로 판정에서 걸러진다.
    #[test]
    fn non_utf8_heads_are_not_indexable() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = crate::indexer::IndexConfig::default();
        let pdf = dir.path().join("a.pdf");
        std::fs::write(
            &pdf,
            b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n",
        )
        .unwrap();
        assert!(!crate::indexer::is_indexable_path(
            dir.path(),
            std::path::Path::new("a.pdf"),
            &cfg
        ));
        let euc_kr = dir.path().join("memo.txt");
        std::fs::write(&euc_kr, b"\xc7\xd1\xb1\xdb \xb8\xde\xb8\xf0\n").unwrap();
        assert!(!crate::indexer::is_indexable_path(
            dir.path(),
            std::path::Path::new("memo.txt"),
            &cfg
        ));
        // 탐침 경계에서 잘린 한글 한 글자는 텍스트다.
        let mut ko = vec![b'a'; 1023];
        ko.extend_from_slice("가".as_bytes());
        let cut = dir.path().join("cut.md");
        std::fs::write(&cut, &ko).unwrap();
        assert!(crate::indexer::is_indexable_path(
            dir.path(),
            std::path::Path::new("cut.md"),
            &cfg
        ));
    }

    /// 유령 색인의 남은 경로(2026-10-18 보류 14행): 같은 파일의 Update 와 Delete 가
    /// 퍼밋 둘로 **겹쳐** 돌았다. 같은 열쇠는 직렬, 다른 열쇠는 병렬이어야 한다.
    #[tokio::test]
    async fn same_key_tasks_never_overlap_but_different_keys_do() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::time::Duration;
        let (tasks, _shutdown) = super::gate();
        let running = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let done = Arc::new(AtomicUsize::new(0));
        let spawn = |key: &str| {
            let (running, max_seen, done) = (running.clone(), max_seen.clone(), done.clone());
            tasks.spawn_keyed(super::Lane::Index, Some(key.to_string()), async move {
                let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                max_seen.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(40)).await;
                running.fetch_sub(1, Ordering::SeqCst);
                done.fetch_add(1, Ordering::SeqCst);
            });
        };
        // 같은 열쇠 둘 — 퍼밋은 2개라 예전엔 겹쳤다.
        spawn("1:src/a.rs");
        spawn("1:src/a.rs");
        for _ in 0..100 {
            if done.load(Ordering::SeqCst) == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(done.load(Ordering::SeqCst), 2);
        assert_eq!(
            max_seen.load(Ordering::SeqCst),
            1,
            "같은 경로는 한 번에 하나"
        );
        assert_eq!(tasks.open_keys(), 0, "끝난 열쇠는 거둔다");

        // 다른 열쇠 둘 — 퍼밋 2개를 다 쓴다.
        max_seen.store(0, Ordering::SeqCst);
        done.store(0, Ordering::SeqCst);
        spawn("1:src/a.rs");
        spawn("1:src/b.rs");
        for _ in 0..100 {
            if done.load(Ordering::SeqCst) == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(done.load(Ordering::SeqCst), 2);
        assert_eq!(max_seen.load(Ordering::SeqCst), 2, "다른 경로는 나란히");
        assert_eq!(tasks.open_keys(), 0);
    }

    /// 직렬화는 겹침을 막지 순서를 되돌리지 않는다 — Delete 가 먼저 지나간 뒤 Update 가
    /// 행을 되살렸으면, 저장 직후의 존재 확인이 그 행을 걷는다.
    #[tokio::test]
    async fn a_row_written_for_a_vanished_file_is_reaped() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("alive.rs"), "fn a() {}\n").unwrap();
        let db = crate::db::Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("proj".into(), root.to_string_lossy().into_owned())
            .await
            .unwrap();
        for path in ["alive.rs", "gone.rs"] {
            db.upsert_file(pid, path.into(), "h".into(), 1, 0, None)
                .await
                .unwrap();
        }
        assert!(!super::reap_if_vanished(&db, pid, &root, "alive.rs").await);
        assert!(super::reap_if_vanished(&db, pid, &root, "gone.rs").await);
        let left: Vec<String> = db
            .list_project_files(pid)
            .await
            .unwrap()
            .into_iter()
            .map(|(_, path)| path)
            .collect();
        assert_eq!(left, ["alive.rs"]);
    }

    /// 실측 2026-10-18: 통째로 사라진 폴더 아래 파일이 색인에 유령으로 남았다 —
    /// 폴더를 옮기거나 지우면 파일마다 Remove 가 온다는 보장이 없다.
    #[tokio::test]
    async fn deleting_a_vanished_folder_drops_every_row_under_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        std::fs::create_dir_all(root.join("keep")).unwrap();
        std::fs::write(root.join("keep/a.rs"), "fn a() {}\n").unwrap();
        std::fs::write(root.join("work-sibling.rs"), "fn b() {}\n").unwrap();
        let db = crate::db::Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("proj".into(), root.to_string_lossy().into_owned())
            .await
            .unwrap();
        for path in [
            "keep/a.rs",
            "work-sibling.rs",
            "작업/.work/x.txt",
            "작업/.work/sub/y.txt",
        ] {
            db.upsert_file(pid, path.into(), "h".into(), 1, 0, None)
                .await
                .unwrap();
        }
        // `작업/` 폴더가 통째로 사라졌다 — 이벤트는 폴더 하나뿐.
        super::remove_deleted_from_index(&db, pid, &root, "작업")
            .await
            .unwrap();
        // 같은 접두어의 형제(`work-sibling.rs` ↔ `work`)는 건드리지 않는다.
        super::remove_deleted_from_index(&db, pid, &root, "work")
            .await
            .unwrap();
        let mut left: Vec<String> = db
            .list_project_files(pid)
            .await
            .unwrap()
            .into_iter()
            .map(|(_, p)| p)
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec!["keep/a.rs".to_string(), "work-sibling.rs".to_string()]
        );

        // 경로가 아직 있으면(지우고 곧바로 다시 만든 폴더) 그 아래는 남긴다.
        super::remove_deleted_from_index(&db, pid, &root, "keep")
            .await
            .unwrap();
        assert_eq!(db.list_project_files(pid).await.unwrap().len(), 2);
    }
}

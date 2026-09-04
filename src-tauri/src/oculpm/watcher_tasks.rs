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

use std::path::{Path, PathBuf};
use std::sync::Arc;

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
        if *self.cancel.borrow() {
            return;
        }
        let sem = match lane {
            Lane::Index => self.index.clone(),
            Lane::History => self.history.clone(),
        };
        let mut cancel = self.cancel.clone();
        tauri::async_runtime::spawn(async move {
            // 세마포어가 닫혔다 = 워처가 내려갔다. 시작조차 하지 않는다.
            let Ok(_permit) = sem.acquire_owned().await else {
                tracing::debug!(
                    target: "oculpm::watcher", ?lane,
                    "곁일 취소 — 워처가 내려가 시작하지 않는다"
                );
                return;
            };
            tokio::select! {
                biased;
                _ = cancel.changed() => tracing::debug!(
                    target: "oculpm::watcher", ?lane,
                    "곁일 취소 — 워처가 내려갔다"
                ),
                () = fut => {}
            }
        });
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

        // 쪽지 소비는 동기다 — `spawn_blocking` 너머로 State 를 들고 가지 않는다.
        let source = handle
            .state::<history::HistoryState>()
            .take_source(project_id, &rel_path, &hash);

        let path_for_log = rel_path.clone();
        let done = tauri::async_runtime::spawn_blocking(move || {
            history::capture(&root, &rel_path, op, source, Some(&hash), max)
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
    let handle = handle.clone();
    let root = root.to_path_buf();
    tasks.spawn(Lane::Index, async move {
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
            FileOp::Delete => match db.delete_file_by_path(project_id, rel_path.clone()).await {
                Ok(()) => tracing::debug!(
                    target: "oculpm::watcher", project_id, path = %rel_path,
                    "auto-index: removed deleted file"
                ),
                Err(e) => tracing::warn!(
                    target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                    "auto-index: delete failed"
                ),
            },
            _ => {
                let settings_map: std::collections::HashMap<String, String> =
                    match db.settings_get_all().await {
                        Ok(v) => v.into_iter().collect(),
                        Err(_) => return,
                    };
                let cfg = crate::indexer::config_from_settings(|k| settings_map.get(k).cloned());
                let abs = root.join(&rel_path);
                if !crate::indexer::is_indexable_path(&abs, &cfg) {
                    return;
                }
                let embedder = handle.state::<Embedder>();
                match crate::indexer::reindex_single_file(
                    &db, &embedder, project_id, &root, &cfg, &rel_path,
                )
                .await
                {
                    Ok((emb, _ast)) => tracing::debug!(
                        target: "oculpm::watcher", project_id, path = %rel_path,
                        embeddings = emb, "auto-index: reindexed"
                    ),
                    Err(reason) => tracing::warn!(
                        target: "oculpm::watcher", project_id, path = %rel_path,
                        ?reason, "auto-index: reindex skipped"
                    ),
                }
            }
        }
    });
}

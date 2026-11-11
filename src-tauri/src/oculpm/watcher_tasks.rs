//! 워처가 띄우는 **곁일(background work)** — 동시 상한과 수명을 워처에 묶는다.
//!
//! 이 파일이 생긴 이유는 두 가지다.
//!
//! **1. 수명.** 기준선 동기(예전엔 증분 색인)와 옛 로컬 히스토리 캡처는
//! 둘 다 `tauri::async_runtime::spawn` 으로 **detached** 였다. 프로젝트를 닫아
//! 워처를 내려도 그 태스크들은 살아남아 계속 DB 를 두드렸다. 브랜치를 한 번
//! 전환하면 한 배치에 1,058 이벤트가 들어오므로(perf-baseline §1 M1), 닫힌
//! 프로젝트가 수백 개의 곁일을 뒤에 남기는 일이 실제로 가능했다.
//! 이건 성능이 아니라 **정확성·수명** 문제다.
//!
//! **2. 동시 상한.** 상한이 없으면 같은 버스트가 파일 읽기·git·DB 쓰기를
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
use crate::oculpm::spec::FileOp;

/// diff 기준선 동기(`crate::baseline`) 동시 상한. 일감은 파일 하나의 읽기 ·
/// `git cat-file` 한 번 · DB 쓰기 한 번이라, 둘이면 버스트가 DB 연결 하나 앞에
/// 줄을 세우지 않는다. (예전 코드 색인 시절 임베딩 직렬화 때문에 정한 값이다.)
pub const BASELINE_PERMITS: usize = 2;

/// 새 일지의 diff 캡처(`entry_diffs`) 동시 상한. 일지 하나가 git 몇 번 · 사이드카 쓰기
/// 한 번이고, 같은 저장소를 두드리므로 하나씩 돈다 (Windows 성능 라운드 2026-11-11 —
/// 그 전엔 소비 루프 안에서 `await` 했다).
pub const CAPTURE_PERMITS: usize = 1;

/// 곁일의 갈래 — 갈래마다 상한이 따로다 (로컬 히스토리 갈래는 읽는 화면이 3.x 코드
/// 편집기와 함께 사라져 2026-11-01 에 걷었다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Baseline,
    /// 새 일지의 diff 사이드카 캡처 + 라인 수.
    Capture,
}

/// 워처가 소유하는 곁일 게이트. `WatcherInner` 가 들고 다닌다 (`Clone`).
#[derive(Clone)]
pub struct WatcherTasks {
    baseline: Arc<Semaphore>,
    capture: Arc<Semaphore>,
    cancel: watch::Receiver<bool>,
    /// 경로별 직렬화 — 같은 `(프로젝트, 경로)` 의 곁일은 한 번에 하나만 돈다.
    ///
    /// 퍼밋이 2개라 같은 파일의 Update 와 Delete 가 **동시에** 돌 수 있었다: Update 가
    /// 내용을 읽는 사이 Delete 가 행을 걷고, 그 뒤 Update 의 upsert 가 행을
    /// 되살린다 — 디스크에 없는 파일의 유령 행(실측 2026-10-18, 코드 색인 14행)의
    /// 남은 경로다. 열쇠는 일이 끝나면 지워 표가 자라지 않는다.
    keys: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

/// 워처 본체(`ProjectWatcher`)가 쥐는 종료 손잡이. 드롭만 해도 곁일이 끊긴다.
pub struct WatcherTasksShutdown {
    tx: watch::Sender<bool>,
    baseline: Arc<Semaphore>,
    capture: Arc<Semaphore>,
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
        self.baseline.close();
        self.capture.close();
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
    let baseline = Arc::new(Semaphore::new(BASELINE_PERMITS));
    let capture = Arc::new(Semaphore::new(CAPTURE_PERMITS));
    (
        WatcherTasks {
            baseline: baseline.clone(),
            capture: capture.clone(),
            cancel,
            keys: Arc::new(Mutex::new(HashMap::new())),
        },
        WatcherTasksShutdown {
            tx,
            baseline,
            capture,
        },
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
            Lane::Baseline => self.baseline.clone(),
            Lane::Capture => self.capture.clone(),
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
        !*self.cancel.borrow() && !self.baseline.is_closed()
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
///
/// `memo` 는 (길이, 수정 시각)이 그대로인 파일의 지난 해시다 (Windows 성능 라운드
/// 2026-11-11). 윈도우는 새 파일 하나를 Create + Modify 로 두 번 알려서, 같은 내용을
/// 두 번 읽고 해시한 뒤에야 `repeat` 가 둘째를 걸렀다 — 8 MB 파일이면 두 번 8 MB 다.
pub async fn stat_and_hash(abs_path: PathBuf, hash_byte_cap: u64) -> (u32, Option<String>) {
    stat_and_hash_with(abs_path, hash_byte_cap, Arc::default()).await
}

/// [`stat_and_hash`] 에 기억(`memo`)을 더한 것 — 워처가 쓰는 쪽.
pub async fn stat_and_hash_with(
    abs_path: PathBuf,
    hash_byte_cap: u64,
    memo: Arc<HashMemo>,
) -> (u32, Option<String>) {
    tokio::task::spawn_blocking(move || {
        let Ok(meta) = std::fs::metadata(&abs_path) else {
            return (0u32, None);
        };
        let len = meta.len();
        let bytes = u32::try_from(len).unwrap_or(u32::MAX);
        if len > hash_byte_cap {
            return (bytes, None);
        }
        let mtime = meta.modified().ok();
        if let Some(hit) = mtime.and_then(|m| memo.get(&abs_path, len, m)) {
            return (bytes, Some(hit));
        }
        let hash = std::fs::read(&abs_path)
            .ok()
            .map(|b| format!("blake3:{}", blake3::hash(&b).to_hex()));
        if let (Some(m), Some(h)) = (mtime, &hash) {
            memo.put(abs_path, len, m, h.clone());
        }
        (bytes, hash)
    })
    .await
    .unwrap_or((0, None))
}

/// [`stat_and_hash`] 의 기억 — 경로 → (길이, 수정 시각, 해시). 이만큼 차면 비운다.
#[derive(Default)]
pub struct HashMemo(Mutex<HashMap<PathBuf, (u64, std::time::SystemTime, String)>>);

const HASH_MEMO_MAX: usize = 4096;

impl HashMemo {
    fn get(&self, path: &Path, len: u64, mtime: std::time::SystemTime) -> Option<String> {
        let m = self.0.lock().unwrap_or_else(|e| e.into_inner());
        m.get(path)
            .filter(|(l, t, _)| *l == len && *t == mtime)
            .map(|(_, _, h)| h.clone())
    }

    fn put(&self, path: PathBuf, len: u64, mtime: std::time::SystemTime, hash: String) {
        let mut m = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if m.len() >= HASH_MEMO_MAX {
            m.clear();
        }
        m.insert(path, (len, mtime, hash));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 곁일 본체
// ─────────────────────────────────────────────────────────────────────────────

/// 바뀐 파일 하나의 diff 기준선 동기 (`crate::baseline`) — HEAD 에 있으면 스냅샷을
/// 걷고, 없으면 찍는다. 예전엔 증분 코드 색인이 같은 일을 곁들여 했다 (4.0 에서 색인을
/// 걷으며 이 조각만 남았다).
///
/// 경로만으로 범위 밖인 것(벤더 폴더 · 잠금·비밀 파일 · worktree 사본)은 곁일을 띄우지
/// 않는다. 지우기는 예전에 찍은 행을 걷어야 하므로 그대로 보낸다.
pub fn schedule_baseline_sync(
    tasks: &WatcherTasks,
    handle: &tauri::AppHandle,
    project_id: u32,
    root: &Path,
    rel_path: String,
    op: FileOp,
    known_hash: Option<String>,
) {
    if !matches!(op, FileOp::Delete) && !crate::baseline::in_scope(root, Path::new(&rel_path)) {
        return;
    }
    let handle = handle.clone();
    let root = root.to_path_buf();
    let key = format!("{project_id}:{rel_path}");
    tasks.spawn_keyed(Lane::Baseline, Some(key), async move {
        use tauri::Manager;
        let db = handle.state::<Db>();
        if matches!(op, FileOp::Delete) {
            if let Err(e) = crate::baseline::remove(&db, project_id, &root, &rel_path).await {
                tracing::warn!(
                    target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                    "baseline: delete failed"
                );
            }
            return;
        }
        match crate::baseline::sync_one_known(
            &db,
            project_id,
            &root,
            &rel_path,
            known_hash.as_deref(),
        )
        .await
        {
            // 읽기와 저장 사이에 파일이 사라졌으면 방금 쓴 행이 유령이다. Delete 이벤트는
            // 이 곁일보다 먼저 지나갔을 수 있다(경로 직렬화는 **겹침**을 막지, **순서**를
            // 되돌리지는 않는다).
            Ok(true) => {
                reap_if_vanished(&db, project_id, &root, &rel_path).await;
            }
            Ok(false) => {}
            // 정상 동작인 건너뜀(그 사이 사라짐 · 생성물 · 범위 밖)은 debug 로 — WARN 으로
            // 두면 진짜 실패(저장)가 그 사이에 묻힌다.
            Err(reason) if reason.is_routine() => tracing::debug!(
                target: "oculpm::watcher", project_id, path = %rel_path,
                ?reason, "baseline: skipped"
            ),
            Err(reason) => tracing::warn!(
                target: "oculpm::watcher", project_id, path = %rel_path,
                ?reason, "baseline: skipped"
            ),
        }
    });
}

/// 스냅샷을 막 쓴 파일이 그 사이 디스크에서 사라졌으면 행을 걷는다. 돌려주는 값은
/// 걷었는지 — 테스트가 본다. 실패는 WARN 으로만 (다음 Delete 나 기동 정리가 받는다).
pub(crate) async fn reap_if_vanished(
    db: &Db,
    project_id: u32,
    root: &Path,
    rel_path: &str,
) -> bool {
    if root.join(rel_path).exists() {
        return false;
    }
    match crate::baseline::remove(db, project_id, root, rel_path).await {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(
                target: "oculpm::watcher", project_id, path = %rel_path, error = %e,
                "baseline: vanished-file cleanup failed"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    /// 유령 행의 남은 경로(2026-10-18 보류 14행): 같은 파일의 Update 와 Delete 가
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
            tasks.spawn_keyed(super::Lane::Baseline, Some(key.to_string()), async move {
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
        // 열쇠는 본문이 끝난 **뒤** 거둔다 — `done` 이 2가 된 직후 바로 단언하면 느린
        // 러너(Windows CI, 2026-10-27~28)에서 거두기 전 표를 읽어 1 이 나온다. 기다린다.
        wait_keys_reaped(&tasks).await;
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
        wait_keys_reaped(&tasks).await;
        assert_eq!(tasks.open_keys(), 0);
    }

    /// 길이·수정 시각이 그대로면 다시 읽지 않는다 — 내용이 바뀌면(시각이 바뀌면) 다시 읽는다.
    #[tokio::test]
    async fn unchanged_file_is_hashed_once() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"one").unwrap();
        let memo = Arc::new(super::HashMemo::default());
        let (_, h1) = super::stat_and_hash_with(f.clone(), 1024, memo.clone()).await;
        assert_eq!(memo.0.lock().unwrap().len(), 1);
        let (_, h2) = super::stat_and_hash_with(f.clone(), 1024, memo.clone()).await;
        assert_eq!(h1, h2);
        // 같은 길이의 다른 내용 + 다른 시각 → 새 해시.
        std::fs::write(&f, b"two").unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let (_, h3) = super::stat_and_hash_with(f, 1024, memo).await;
        assert_ne!(h1, h3);
    }

    /// 끝난 열쇠가 표에서 빠질 때까지 최대 1초 — 거두기는 본문 완료 뒤의 별도 단계다.
    async fn wait_keys_reaped(tasks: &super::WatcherTasks) {
        for _ in 0..100 {
            if tasks.open_keys() == 0 {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    /// 직렬화는 겹침을 막지 순서를 되돌리지 않는다 — Delete 가 먼저 지나간 뒤 Update 가
    /// 행을 되살렸으면, 저장 직후의 존재 확인이 그 행을 걷는다. 폴더째 사라졌으면 그
    /// 아래도 걷고, 같은 접두어의 형제는 건드리지 않는다.
    #[tokio::test]
    async fn a_snapshot_written_for_a_vanished_file_is_reaped() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("alive.rs"), "fn a() {}\n").unwrap();
        std::fs::write(root.join("work-sibling.rs"), "fn b() {}\n").unwrap();
        let db = crate::db::Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("proj".into(), root.to_string_lossy().into_owned())
            .await
            .unwrap();
        for path in [
            "alive.rs",
            "gone.rs",
            "work-sibling.rs",
            "work/x.txt",
            "work/sub/y.txt",
        ] {
            db.upsert_file_snapshot(pid, path.into(), b"x".to_vec(), "h".into())
                .await
                .unwrap();
        }
        assert!(!super::reap_if_vanished(&db, pid, &root, "alive.rs").await);
        assert!(super::reap_if_vanished(&db, pid, &root, "gone.rs").await);
        assert!(super::reap_if_vanished(&db, pid, &root, "work").await);
        let mut left = db.snapshot_paths(pid).await.unwrap();
        left.sort();
        assert_eq!(left, ["alive.rs", "work-sibling.rs"]);
    }
}

//! 워처 백프레셔 — 유계 큐가 **무엇을 약속하는가** (v2.42.0 `{#watcher-bounded}`).
//!
//! 기준선 측정(`docs/20260904_v242-load-bearing/perf-baseline.md` §1 M1)이 잰
//! 사실 둘이 이 파일의 전제다:
//!
//! - `git checkout` 한 번(378 파일)이 **한 배치에 1,058 이벤트**를 붓는다.
//! - 채널이 받는 것은 gitignore 판정 **이전**의 날것이라, `target/`(이 저장소
//!   55,663 파일)의 쓰기도 전부 큐에 먼저 들어온다.
//!
//! 그래서 세 가지를 문다: (a) 정상 버스트는 **한 건도 버리지 않는다**,
//! (b) 넘칠 때 생산자는 **막히지 않고** 가장 오래된 것이 밀려난다,
//! (c) 버림은 **조용하지 않다** — 소비자가 정착한 뒤 재동기화가 반드시 불린다.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{CreateKind, EventKind};
use notify_debouncer_full::DebouncedEvent;

use ocul_pm_lib::oculpm::watcher_queue::{self, WatcherSink, DEFAULT_CAPACITY};
use ocul_pm_lib::oculpm::watcher_tasks::{self, Lane, INDEX_PERMITS};

/// 경로만 다른 이벤트 하나. 실제 워처가 받는 모양(Create + 경로 1개)과 같다.
fn ev(n: usize) -> DebouncedEvent {
    let event = notify::Event::new(EventKind::Create(CreateKind::File))
        .add_path(std::path::PathBuf::from(format!("/p/f{n}.rs")));
    DebouncedEvent::new(event, Instant::now())
}

fn path_of(e: &DebouncedEvent) -> String {
    e.event.paths[0].to_string_lossy().to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// 큐 자체
// ─────────────────────────────────────────────────────────────────────────────

/// 측정된 정상 버스트(1,058)는 **한 건도 버리지 않는다**. 이게 용량 4,096 의
/// 존재 이유다 — 배치 하나를 통째로 버리는 용량이면 브랜치를 바꿀 때마다
/// 재동기화가 돌아 백프레셔가 상시 부하가 된다.
#[test]
fn a_measured_checkout_burst_fits_without_dropping() {
    let (tx, rx) = watcher_queue::channel(DEFAULT_CAPACITY);
    let dropped = tx.push_batch((0..1058).map(ev).collect());
    assert_eq!(
        dropped, 0,
        "체크아웃 1회 배치(1,058)는 통째로 들어가야 한다"
    );
    assert_eq!(rx.len(), 1058);
    assert!(rx.take_resync().is_none(), "버린 게 없으면 재동기화도 없다");
}

/// 넘치면 **가장 오래된 것**이 밀려난다 — 남는 것은 언제나 최신 `capacity` 개.
#[test]
fn overflow_drops_the_oldest_and_keeps_the_newest() {
    let cap = 8;
    let (tx, rx) = watcher_queue::channel(cap);
    let dropped = tx.push_batch((0..20).map(ev).collect());

    assert_eq!(dropped, 12, "20 중 12 가 밀려나야 한다");
    assert_eq!(rx.len(), cap);
    assert_eq!(rx.dropped_total(), 12);

    // 남은 것은 12..20 — 가장 최근 8 개.
    let rt = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let survivors: Vec<String> = rt.block_on(async {
        let mut out = Vec::new();
        while let Some(e) = rx.recv().await {
            out.push(path_of(&e));
            if out.len() == cap {
                break;
            }
        }
        out
    });
    assert_eq!(survivors.first().map(String::as_str), Some("/p/f12.rs"));
    assert_eq!(survivors.last().map(String::as_str), Some("/p/f19.rs"));
}

/// 생산자(notify 워커 스레드)는 **절대 막히지 않는다.**
///
/// 소비자가 하나도 안 붙은 채로 용량의 12배를 한 번에 부어도 즉시 돌아오고,
/// 메모리는 용량에서 멈춘다. 예전 unbounded 채널은 여기서 50,000 개를 전부
/// 들고 있었다 — `cargo build` 한 번이 `target/` 55,663 파일을 건드리면 그게
/// 그대로 힙이 됐다.
#[test]
fn the_producer_never_blocks_and_memory_stops_at_capacity() {
    let cap = 4096;
    let (tx, rx) = watcher_queue::channel(cap);

    // 실제와 같이 tokio 밖 std 스레드에서 민다.
    let handle = std::thread::spawn(move || {
        let started = Instant::now();
        for batch in 0..50 {
            tx.push_batch((0..1000).map(|i| ev(batch * 1000 + i)).collect());
        }
        started.elapsed()
    });
    let elapsed = handle.join().expect("생산자 스레드가 패닉하면 안 된다");

    assert!(
        elapsed < Duration::from_secs(5),
        "생산자가 막혔다 ({elapsed:?}) — 유계 큐는 생산자를 기다리게 하면 안 된다"
    );
    assert_eq!(rx.len(), cap, "큐 길이는 용량에서 멈춰야 한다");
    assert_eq!(rx.dropped_total(), 50_000 - cap as u64);
}

/// 버림은 재동기화 신호를 켜고, 그 신호는 **한 번만** 가져가진다.
#[test]
fn dropping_arms_the_resync_flag_exactly_once() {
    let (tx, rx) = watcher_queue::channel(4);
    tx.push_batch((0..10).map(ev).collect());

    assert_eq!(rx.take_resync(), Some(6), "버린 누계를 함께 돌려준다");
    assert!(rx.take_resync().is_none(), "가져간 신호는 꺼져야 한다");

    // 다시 넘치면 다시 켜지고, 누계는 이어진다.
    tx.push_batch((10..14).map(ev).collect());
    assert_eq!(rx.take_resync(), Some(10));
}

// ─────────────────────────────────────────────────────────────────────────────
// 소비 루프
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct RecordingSink {
    handled: Mutex<Vec<String>>,
    resyncs: Mutex<Vec<u64>>,
}

/// `Arc<T>` 는 fundamental 이 아니라 고아 규칙에 걸린다 — 로컬 래퍼로 감싼다.
struct SinkHandle(Arc<RecordingSink>);

impl WatcherSink for SinkHandle {
    async fn handle_event(&self, e: DebouncedEvent) {
        self.0.handled.lock().unwrap().push(path_of(&e));
    }
    async fn resync_after_drops(&self, dropped: u64) {
        self.0.resyncs.lock().unwrap().push(dropped);
    }
}

/// 버림이 있었으면 소비자는 **정착한 뒤** 반드시 만회한다 — 버스트 한복판이
/// 아니라 큐가 빈 첫 순간에.
#[tokio::test]
async fn the_drain_loop_resyncs_after_it_settles() {
    let (tx, rx) = watcher_queue::channel(4);
    tx.push_batch((0..10).map(ev).collect());
    drop(tx); // 디바운서가 내려간 상황 = 루프가 큐를 비우고 끝난다.

    let sink = Arc::new(RecordingSink::default());
    watcher_queue::drain_loop(1, rx, SinkHandle(sink.clone())).await;

    let handled = sink.handled.lock().unwrap().clone();
    assert_eq!(handled.len(), 4, "살아남은 4건만 처리된다");
    assert_eq!(handled[0], "/p/f6.rs");

    let resyncs = sink.resyncs.lock().unwrap().clone();
    assert_eq!(
        resyncs,
        vec![6],
        "정착 후 딱 한 번, 버린 누계를 들고 불린다"
    );
}

/// 버림이 없으면 재동기화는 **한 번도** 불리지 않는다 (상시 부하 금지).
#[tokio::test]
async fn a_clean_run_never_resyncs() {
    let (tx, rx) = watcher_queue::channel(DEFAULT_CAPACITY);
    tx.push_batch((0..100).map(ev).collect());
    drop(tx);

    let sink = Arc::new(RecordingSink::default());
    watcher_queue::drain_loop(1, rx, SinkHandle(sink.clone())).await;

    assert_eq!(sink.handled.lock().unwrap().len(), 100);
    assert!(sink.resyncs.lock().unwrap().is_empty());
}

/// 이벤트 하나가 패닉해도 루프는 다음 이벤트로 넘어간다 (도그푸딩 2026-08-23).
#[tokio::test]
async fn one_panicking_event_does_not_kill_the_loop() {
    struct Panicky(Arc<AtomicUsize>);
    impl WatcherSink for Panicky {
        async fn handle_event(&self, e: DebouncedEvent) {
            self.0.fetch_add(1, Ordering::SeqCst);
            if path_of(&e).ends_with("f1.rs") {
                panic!("한 이벤트만 터진다");
            }
        }
        async fn resync_after_drops(&self, _dropped: u64) {}
    }

    let (tx, rx) = watcher_queue::channel(16);
    tx.push_batch((0..4).map(ev).collect());
    drop(tx);

    let seen = Arc::new(AtomicUsize::new(0));
    // 패닉 훅을 잠시 죽여 테스트 출력이 지저분해지지 않게 한다.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    watcher_queue::drain_loop(1, rx, Panicky(seen.clone())).await;
    std::panic::set_hook(prev);

    assert_eq!(
        seen.load(Ordering::SeqCst),
        4,
        "패닉 이후 이벤트도 처리된다"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 곁일 게이트 — 동시 상한과 수명 (`{#index-semaphore}`)
// ─────────────────────────────────────────────────────────────────────────────

/// 동시 상한을 넘겨 돌지 않는다.
#[tokio::test]
async fn the_gate_caps_concurrency() {
    let (tasks, _shutdown) = watcher_tasks::gate();
    let live = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));

    for _ in 0..(INDEX_PERMITS * 4) {
        let (live, peak) = (live.clone(), peak.clone());
        tasks.spawn(Lane::Index, async move {
            let now = live.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
            live.fetch_sub(1, Ordering::SeqCst);
        });
    }
    tokio::time::sleep(Duration::from_millis(400)).await;

    assert_eq!(live.load(Ordering::SeqCst), 0, "전부 끝나야 한다");
    assert!(
        peak.load(Ordering::SeqCst) <= INDEX_PERMITS,
        "동시 {} 를 넘겼다: {}",
        INDEX_PERMITS,
        peak.load(Ordering::SeqCst)
    );
}

/// 워처가 내려가면 **아직 시작 못 한 곁일은 시작조차 하지 않는다.**
///
/// 예전에는 `tauri::async_runtime::spawn` 으로 detached 였기 때문에, 프로젝트를
/// 닫아도 남은 태스크가 계속 DB 를 두드렸다.
#[tokio::test]
async fn shutdown_cancels_work_that_has_not_started() {
    let (tasks, shutdown) = watcher_tasks::gate();
    let started = Arc::new(AtomicUsize::new(0));

    // 상한만큼을 오래 붙잡아 둔다. **퍼밋을 실제로 쥐었다는 신호를 기다린 뒤**
    // 나머지를 넣어야 한다 — 스폰 순서는 실행 순서를 보장하지 않으므로, 그냥
    // 잠깐 자고 넘어가면 뒤엣것이 먼저 퍼밋을 채 갈 수 있다.
    let (holding_tx, mut holding_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    for _ in 0..INDEX_PERMITS {
        let holding_tx = holding_tx.clone();
        tasks.spawn(Lane::Index, async move {
            let _ = holding_tx.send(());
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
    }
    for _ in 0..INDEX_PERMITS {
        holding_rx.recv().await.expect("퍼밋 보유 신호");
    }

    // 여기서부터 넣는 것은 전부 대기열에 남는다.
    for _ in 0..8 {
        let started = started.clone();
        tasks.spawn(Lane::Index, async move {
            started.fetch_add(1, Ordering::SeqCst);
        });
    }
    tokio::time::sleep(Duration::from_millis(50)).await;

    shutdown.shutdown();
    tokio::time::sleep(Duration::from_millis(150)).await;

    assert_eq!(
        started.load(Ordering::SeqCst),
        0,
        "워처가 내려간 뒤 대기 중이던 곁일이 돌았다"
    );
    assert!(!tasks.is_live());

    // 내려간 게이트에 새로 넣어도 돌지 않는다.
    let after = Arc::new(AtomicUsize::new(0));
    let a2 = after.clone();
    tasks.spawn(Lane::Index, async move {
        a2.fetch_add(1, Ordering::SeqCst);
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(after.load(Ordering::SeqCst), 0);
}

/// 손잡이를 **드롭만 해도** 같은 취소가 걸린다 — `ProjectWatcher` 가 어떤
/// 경로로 사라지든(정상 stop · abort · 패닉) 곁일이 남지 않게.
#[tokio::test]
async fn dropping_the_handle_cancels_too() {
    let (tasks, shutdown) = watcher_tasks::gate();
    assert!(tasks.is_live());
    drop(shutdown);
    assert!(!tasks.is_live());

    let ran = Arc::new(AtomicUsize::new(0));
    let r2 = ran.clone();
    tasks.spawn(Lane::Index, async move {
        r2.fetch_add(1, Ordering::SeqCst);
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(ran.load(Ordering::SeqCst), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// classify 의 blocking 구간 (`{#classify-blocking}`)
// ─────────────────────────────────────────────────────────────────────────────

/// 해시 계산이 `spawn_blocking` 으로 옮겨 가도 **답은 같아야 한다** — 상한
/// 이하면 blake3, 넘으면 `None` 이되 바이트 수는 그대로.
#[tokio::test]
async fn stat_and_hash_keeps_the_old_answers() {
    let dir = tempfile::tempdir().unwrap();
    let small = dir.path().join("small.txt");
    std::fs::write(&small, b"hello").unwrap();

    let (bytes, hash) = watcher_tasks::stat_and_hash(small.clone(), 8 * 1024 * 1024).await;
    assert_eq!(bytes, 5);
    assert_eq!(
        hash.as_deref(),
        Some(format!("blake3:{}", blake3::hash(b"hello").to_hex()).as_str())
    );

    // 상한을 1 바이트로 낮추면 "큰 파일" 취급 — 해시는 없고 크기는 남는다.
    let (bytes, hash) = watcher_tasks::stat_and_hash(small, 1).await;
    assert_eq!(bytes, 5);
    assert!(hash.is_none());

    // 없는 파일은 (0, None).
    let (bytes, hash) = watcher_tasks::stat_and_hash(dir.path().join("nope"), 1024).await;
    assert_eq!(bytes, 0);
    assert!(hash.is_none());
}

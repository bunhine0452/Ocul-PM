//! 워처 이벤트 큐 — **유계 링 + 가장 오래된 것 버리기 + 재동기화 신호**.
//!
//! `watcher.rs` 는 오랫동안 `mpsc::unbounded_channel` 로 notify 워커 스레드와
//! 소비 태스크를 이었다. 무제한인 이유는 분명했다: notify 의 콜백은 tokio 밖
//! **std 스레드**에서 돌기 때문에 거기서 막히면 OS 워처가 이벤트를 들고 있게
//! 되고, 그건 유실과 메모리 폭증으로 이어진다. 그래서 "막지 않는다" 를 위해
//! "한계가 없다" 를 골랐다.
//!
//! 그 대가는 v2.42.0 기준선 측정(`docs/20260904_v242-load-bearing/perf-baseline.md`
//! §1 M1)이 정확히 보여 준다:
//!
//! - `git checkout` 한 번(378 파일)이 **한 배치에 1,058 이벤트**를 부었다.
//!   체크아웃 자체는 149 ms, 워처가 정적화되기까지 **4,272 ms**.
//! - 채널이 받는 것은 **gitignore 판정 이전의 날것**이다. `target/`·`node_modules/`
//!   쓰기도 전부 큐에 먼저 들어온 뒤 `handle_event` 6단계에서 버려진다. 지금
//!   이 저장소의 `src-tauri/target` 에만 **55,663 파일**이 있다.
//!
//! 즉 `cargo build` 한 번이 채널을 수만 건으로 채울 수 있고, 그 상한이 없다.
//!
//! 이 모듈이 고르는 절충은 **유계 + drop-oldest** 다:
//!
//! - 생산자는 여전히 **절대 블록하지 않는다.** 채널을 기다리는 대신, 마이크로초
//!   단위의 `std::sync::Mutex` 만 잡고 링에 밀어 넣는다. 가득 차 있으면 **가장
//!   오래된 것을 버리고** 새 것을 넣는다 (오래된 이벤트일수록 이미 다른 이벤트가
//!   덮어썼을 확률이 높다).
//! - 버림은 **조용하지 않다.** 버린 순간 `resync_pending` 이 켜지고, 소비자는
//!   큐가 비는 첫 순간(= 정착) 에 `WatcherSink::resync_after_drops` 로 만회한다.
//!
//! 소비 루프(`drain_loop`)도 여기 산다 — `watcher.rs` 는 2,241줄로 이미 파일
//! 크기 래칫을 넘겨 한 줄도 늘릴 수 없고, 그 제약이 마침 옳은 분리를 시켰다.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures::future::FutureExt;
use notify_debouncer_full::DebouncedEvent;
use tokio::sync::Notify;

/// 큐 용량 — **배치가 아니라 이벤트 개수** 단위.
///
/// 왜 4,096 인가:
///
/// 1. 측정된 최악의 정상 버스트가 **한 배치 1,058 이벤트**(378 파일 체크아웃,
///    perf-baseline M1)다. 배치 단위로 용량을 재면 "1 배치" 조차 한 번의
///    브랜치 전환에서 통째로 버려지므로, 단위는 이벤트여야 한다.
/// 2. 4,096 은 그 버스트의 **약 3.9배**다. 브랜치 전환·리베이스·대형 머지처럼
///    사람이 의도한 조작은 버림 없이 통째로 들어온다 — 정상 동작에서 버리면
///    재동기화가 상시로 돌아 백프레셔의 의미가 사라진다.
/// 3. 상한은 메모리로도 정당화된다. `DebouncedEvent` 하나가 경로 힙까지
///    ~200 B 안팎이므로 4,096 은 **1 MB 남짓**에서 멈춘다. 지금은 상한이 없고,
///    `target/` 55,663 파일을 훑는 `cargo build` 가 그 전부를 큐에 올릴 수 있다.
///
/// 이 값을 바꾸려면 위 세 근거 중 무엇이 바뀌었는지 함께 적는다.
pub const DEFAULT_CAPACITY: usize = 4096;

struct Shared {
    queue: Mutex<VecDeque<DebouncedEvent>>,
    capacity: usize,
    notify: Notify,
    /// 송신측이 살아 있는가. `QueueSender` 가 드롭되면 `false`.
    open: AtomicBool,
    /// 이 워처가 살아 있는 동안 버린 이벤트 누계 (진단·로그용).
    dropped_total: AtomicU64,
    /// 마지막 재동기화 이후 버림이 있었는가.
    resync_pending: AtomicBool,
}

impl Shared {
    fn pop(&self) -> Option<DebouncedEvent> {
        lock(&self.queue).pop_front()
    }
}

/// 잠금 중독(consumer 패닉)이 생산자를 영구히 막지 않게 한다 — 워처의 소비
/// 루프는 `catch_unwind` 로 이벤트 하나의 패닉을 삼키므로 실제로 중독될
/// 여지가 있고, 그때 이벤트를 못 받는 것보다 이어 가는 편이 낫다.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 생산자 손잡이. **tokio 밖(std 스레드)에서 부르도록 만들어졌다.**
pub struct QueueSender {
    shared: Arc<Shared>,
}

impl QueueSender {
    /// 디바운서가 넘긴 배치 하나를 링에 붓는다. **절대 블록하지 않는다.**
    ///
    /// 반환값은 이번 호출에서 버린 이벤트 수다 (0 이면 전부 들어갔다).
    pub fn push_batch(&self, events: Vec<DebouncedEvent>) -> usize {
        if events.is_empty() {
            return 0;
        }
        let mut dropped = 0usize;
        {
            let mut q = lock(&self.shared.queue);
            for ev in events {
                if q.len() >= self.shared.capacity {
                    q.pop_front();
                    dropped += 1;
                }
                q.push_back(ev);
            }
        }
        if dropped > 0 {
            self.shared
                .dropped_total
                .fetch_add(dropped as u64, Ordering::Relaxed);
            // Release — 소비자가 `take_resync` 에서 Acquire 로 읽는다.
            self.shared.resync_pending.store(true, Ordering::Release);
        }
        // 대기자가 없으면 퍼밋으로 저장된다 → 깨움 유실 없음 (소비자는 하나).
        self.shared.notify.notify_one();
        dropped
    }
}

impl Drop for QueueSender {
    fn drop(&mut self) {
        self.shared.open.store(false, Ordering::Release);
        self.shared.notify.notify_waiters();
    }
}

/// 소비자 손잡이. 소비자는 **하나**라고 가정한다 (`notify_one` 의 전제).
pub struct QueueReceiver {
    shared: Arc<Shared>,
}

impl QueueReceiver {
    /// 다음 이벤트. 송신측이 사라지고 큐도 비면 `None`.
    pub async fn recv(&self) -> Option<DebouncedEvent> {
        loop {
            // **먼저 등록하고 그다음에 확인한다.** 순서가 뒤집히면 확인과 대기
            // 사이에 들어온 깨움이 사라져 소비자가 영원히 잠든다.
            let notified = self.shared.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            if let Some(ev) = self.shared.pop() {
                return Some(ev);
            }
            if !self.shared.open.load(Ordering::Acquire) {
                // 송신측이 사라졌다 — 남은 것을 마저 비우고 끝낸다.
                return self.shared.pop();
            }
            notified.await;
        }
    }

    /// 버림이 있었으면 그 사실을 **가져가며 끈다**. 반환값은 누계 버림 수.
    pub fn take_resync(&self) -> Option<u64> {
        if self.shared.resync_pending.swap(false, Ordering::AcqRel) {
            Some(self.shared.dropped_total.load(Ordering::Relaxed))
        } else {
            None
        }
    }

    /// 지금 이 순간 큐가 비었는가 (= 소비자가 정착했는가).
    pub fn is_empty(&self) -> bool {
        lock(&self.shared.queue).is_empty()
    }

    /// 큐에 쌓여 있는 이벤트 수 — 진단용.
    pub fn len(&self) -> usize {
        lock(&self.shared.queue).len()
    }

    /// 이 워처가 지금까지 버린 이벤트 누계.
    pub fn dropped_total(&self) -> u64 {
        self.shared.dropped_total.load(Ordering::Relaxed)
    }
}

/// 유계 링 하나를 만든다.
pub fn channel(capacity: usize) -> (QueueSender, QueueReceiver) {
    let shared = Arc::new(Shared {
        queue: Mutex::new(VecDeque::with_capacity(capacity.min(1024))),
        capacity: capacity.max(1),
        notify: Notify::new(),
        open: AtomicBool::new(true),
        dropped_total: AtomicU64::new(0),
        resync_pending: AtomicBool::new(false),
    });
    (
        QueueSender {
            shared: shared.clone(),
        },
        QueueReceiver { shared },
    )
}

/// 큐에서 꺼낸 이벤트를 받아 처리하는 쪽 (`watcher::WatcherInner`).
///
/// 트레이트로 뺀 이유는 하나다 — 소비 루프를 `watcher.rs` 밖에 두면서도
/// 실제 처리기는 그 파일에 남기기 위해서. 덕분에 이 모듈은 tauri 없이도
/// 테스트할 수 있다.
pub trait WatcherSink: Send + Sync + 'static {
    /// 이벤트 하나를 처리한다.
    fn handle_event(&self, ev: DebouncedEvent) -> impl std::future::Future<Output = ()> + Send;

    /// 버림이 있었던 창(window)을 만회한다. 큐가 **빈 첫 순간**에 불린다.
    fn resync_after_drops(&self, dropped: u64) -> impl std::future::Future<Output = ()> + Send;
}

/// 소비 루프. 송신측이 사라질 때까지 돈다.
///
/// 이벤트 **하나**의 패닉이 루프를 죽이면 그 프로젝트의 실시간 갱신이 앱을
/// 다시 켤 때까지 조용히 사라진다 — `debouncer` 는 그대로 `Some` 이라 상태는
/// "Running", `watcher_start` 는 "이미 돌고 있음" 으로 no-op 이다. 도그푸딩
/// 2026-08-23 에서 실제로 겪은 실패라, 여기서 삼키고 **크게 남긴 뒤** 다음
/// 이벤트로 넘어간다.
pub async fn drain_loop<S: WatcherSink>(project_id: u32, rx: QueueReceiver, sink: S) {
    loop {
        // 정착 시점 = 큐가 빈 첫 순간. 버스트 한복판에서 재동기화를 돌리면
        // 그 자체가 다음 버스트가 된다.
        if rx.is_empty() {
            if let Some(dropped) = rx.take_resync() {
                sink.resync_after_drops(dropped).await;
            }
        }
        let Some(ev) = rx.recv().await else { break };
        let path = ev.event.paths.first().cloned();
        let caught = std::panic::AssertUnwindSafe(sink.handle_event(ev))
            .catch_unwind()
            .await;
        if caught.is_err() {
            tracing::error!(
                target: "oculpm::watcher",
                project_id,
                path = ?path,
                "[FLOW] handle_event panicked — 이 이벤트만 버리고 계속한다"
            );
        }
    }
    // 종료 직전 마지막 만회 — 버림 뒤 곧바로 워처가 내려간 경우.
    if let Some(dropped) = rx.take_resync() {
        sink.resync_after_drops(dropped).await;
    }
    // 여기 도달 = 송신측(debouncer)이 사라졌다. 정상 종료(`stop()`)일 수도,
    // 워커 스레드가 죽은 것일 수도 있다 — 예전 문구는 전자라고 단정해 후자를
    // 은폐했다. 감독관(`supervisor`)이 재무장한다.
    tracing::info!(
        target: "oculpm::watcher",
        project_id,
        dropped_total = rx.dropped_total(),
        "[FLOW] watcher receive loop ended (debouncer dropped — stop() 이거나 워커 사망)"
    );
}

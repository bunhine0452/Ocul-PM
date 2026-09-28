//! 프로젝트별 색인 **단일 비행** (#index-double-run, 2026-09-28).
//!
//! 프로젝트를 추가하면 색인이 두 번 동시에 돌았다 (E2E 로그 `index reconcile …
//! removed=1`). 트리거가 둘이다:
//!
//! 1. `StartTab` — 폴더를 등록하자마자 `index_project` 를 건다.
//! 2. `ProjectTab` — 그 프로젝트가 탭에 열리면 청크가 0 개인지 보고 또 건다.
//!    첫 색인은 임베딩 모델 내려받기부터라 한참 동안 청크가 0 이다.
//!
//! 두 실행은 서로의 walk 를 모른 채 같은 행을 쓰고, 한쪽의 화해가 다른 쪽이
//! 방금 넣은 행(예: 그 사이 `.oculpm` 초기화가 만든 `AGENTS.md`)을 "walk 에 없다"
//! 며 지웠다 — 그 `removed=1` 이다. 프런트의 두 자리를 맞추는 대신 백엔드가
//! 막는다: 창·탭·마법사 어느 경로에서 오든 같은 프로젝트의 색인은 **한 번에
//! 하나**이고, 진행 중에 온 요청은 그 실행에 **합류**한다 — 진행률을 같이 받고
//! 같은 결과를 돌려받는다. 합류한 쪽의 UI(ProjectTab 의 진행 막대)는 그대로 돈다.
//!
//! 끝난 뒤에 온 요청은 새로 돈다 (색인은 해시 게이트라 바뀐 것만 다시 한다).

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use tokio::sync::watch;

use super::{IndexProgress, IndexResult};

type Sink<P> = Box<dyn Fn(P) + Send + Sync>;
type IndexOutcome = Result<IndexResult, String>;

/// `index_project` 의 단일 비행 표 — 창·탭 어디서 불러도 프로세스에 하나다.
pub(super) static INDEX_FLIGHTS: LazyLock<SingleFlight<IndexProgress, IndexOutcome>> =
    LazyLock::new(|| SingleFlight::new(|| Err("indexing was interrupted".to_string())));

/// 이끄는 색인 실행이 진행률을 뿌리는 손잡이.
pub(super) type IndexProgressTx = Progress<IndexProgress, IndexOutcome>;

/// 키(프로젝트 id)마다 진행 중인 작업 하나.
pub(super) struct SingleFlight<P, R> {
    flights: Mutex<HashMap<u32, Arc<Flight<P, R>>>>,
    /// 이끄는 쪽이 끝을 못 보고 사라졌을 때(퓨처 취소) 합류자에게 줄 값.
    abandoned: fn() -> R,
}

struct Flight<P, R> {
    sinks: Mutex<Vec<Sink<P>>>,
    /// 늦게 합류한 쪽이 다음 틱까지 빈 막대를 보지 않게 마지막 진행률을 준다.
    last: Mutex<Option<P>>,
    done: watch::Sender<Option<R>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // 싱크 하나가 패닉해도 색인 자체는 계속된다 — 독은 무시한다.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 이끄는 실행이 진행률을 뿌리는 손잡이.
pub(super) struct Progress<P, R>(Arc<Flight<P, R>>);

impl<P: Clone, R> Progress<P, R> {
    pub fn send(&self, p: P) {
        let sinks = lock(&self.0.sinks);
        for sink in sinks.iter() {
            sink(p.clone());
        }
        *lock(&self.0.last) = Some(p);
    }
}

impl<P: Clone, R: Clone> SingleFlight<P, R> {
    pub fn new(abandoned: fn() -> R) -> Self {
        Self {
            flights: Mutex::new(HashMap::new()),
            abandoned,
        }
    }

    /// `key` 의 작업이 진행 중이면 합류해 그 결과를, 아니면 `work` 를 돌려 결과를.
    pub async fn run<F, Fut>(&self, key: u32, sink: Sink<P>, work: F) -> R
    where
        F: FnOnce(Progress<P, R>) -> Fut,
        Fut: std::future::Future<Output = R>,
    {
        // 표 잠금은 이 블록 안에서만 — `await` 너머로 들고 가지 않는다.
        let role = {
            let mut flights = lock(&self.flights);
            match flights.get(&key) {
                Some(flight) => {
                    // 잠금 순서 sinks → last 는 `Progress::send` 와 같다 — 합류가
                    // 뿌리기 사이에 끼어 틱 하나를 두 번 받거나 잃지 않는다.
                    let mut sinks = lock(&flight.sinks);
                    if let Some(p) = lock(&flight.last).clone() {
                        sink(p);
                    }
                    sinks.push(sink);
                    Err(flight.done.subscribe())
                }
                None => {
                    let flight = Arc::new(Flight {
                        sinks: Mutex::new(vec![sink]),
                        last: Mutex::new(None),
                        done: watch::Sender::new(None),
                    });
                    flights.insert(key, flight.clone());
                    Ok(flight)
                }
            }
        };
        let flight = match role {
            Ok(flight) => flight,
            Err(mut done) => {
                tracing::info!(project_id = key, "indexing already running — joined it");
                return match done.wait_for(Option::is_some).await {
                    Ok(v) => v.clone().unwrap_or_else(self.abandoned),
                    Err(_) => (self.abandoned)(),
                };
            }
        };

        let mut guard = Leader {
            owner: self,
            key,
            flight: flight.clone(),
            outcome: None,
        };
        let result = work(Progress(flight)).await;
        guard.outcome = Some(result.clone());
        drop(guard);
        result
    }

    #[cfg(test)]
    fn joined(&self, key: u32) -> usize {
        lock(&self.flights)
            .get(&key)
            .map_or(0, |f| lock(&f.sinks).len())
    }
}

/// 이끄는 실행의 뒷정리 — 정상 종료든 퓨처 취소든 **먼저 표에서 빼고** 결과를
/// 알린다. 순서가 거꾸로면 이미 끝난 실행에 새 요청이 합류할 틈이 생긴다.
struct Leader<'a, P, R> {
    owner: &'a SingleFlight<P, R>,
    key: u32,
    flight: Arc<Flight<P, R>>,
    outcome: Option<R>,
}

impl<P, R> Drop for Leader<'_, P, R> {
    fn drop(&mut self) {
        {
            let mut flights = lock(&self.owner.flights);
            if flights
                .get(&self.key)
                .is_some_and(|f| Arc::ptr_eq(f, &self.flight))
            {
                flights.remove(&self.key);
            }
        }
        let outcome = self.outcome.take().unwrap_or_else(self.owner.abandoned);
        self.flight.done.send_replace(Some(outcome));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    type Flights = SingleFlight<u32, Result<u32, String>>;

    fn flights() -> Arc<Flights> {
        Arc::new(SingleFlight::new(|| Err("abandoned".to_string())))
    }

    fn recorder() -> (Arc<Mutex<Vec<u32>>>, Sink<u32>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        (seen, Box::new(move |p| s.lock().unwrap().push(p)))
    }

    async fn until_joined(f: &Flights, key: u32, n: usize) {
        while f.joined(key) < n {
            tokio::task::yield_now().await;
        }
    }

    /// 추가 한 번(StartTab) + 탭 열기(ProjectTab) = 색인 **한 번**. 둘 다 같은
    /// 결과를 받고, 늦게 온 쪽도 진행률을 받는다.
    #[tokio::test]
    async fn a_second_request_joins_the_running_index() {
        let f = flights();
        let runs = Arc::new(AtomicUsize::new(0));
        let (release, released) = oneshot::channel::<()>();
        let (first_seen, first_sink) = recorder();
        let (second_seen, second_sink) = recorder();

        let leader = {
            let (f, runs) = (f.clone(), runs.clone());
            tokio::spawn(async move {
                f.run(7, first_sink, |progress| async move {
                    runs.fetch_add(1, Ordering::SeqCst);
                    progress.send(1);
                    released.await.unwrap();
                    progress.send(2);
                    Ok(42)
                })
                .await
            })
        };
        until_joined(&f, 7, 1).await;
        while first_seen.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }

        let joiner = {
            let (f, runs) = (f.clone(), runs.clone());
            tokio::spawn(async move {
                f.run(7, second_sink, |_| async move {
                    runs.fetch_add(1, Ordering::SeqCst);
                    Ok(0)
                })
                .await
            })
        };
        until_joined(&f, 7, 2).await;
        release.send(()).unwrap();

        assert_eq!(leader.await.unwrap(), Ok(42));
        assert_eq!(joiner.await.unwrap(), Ok(42));
        assert_eq!(runs.load(Ordering::SeqCst), 1, "색인은 한 번만 돈다");
        assert_eq!(*first_seen.lock().unwrap(), vec![1, 2]);
        // 합류 시점의 마지막 진행률(1)을 먼저 받고, 이후 틱(2)을 받는다.
        assert_eq!(*second_seen.lock().unwrap(), vec![1, 2]);
        assert_eq!(f.joined(7), 0, "끝나면 표에서 빠진다");
    }

    /// 끝난 뒤에 온 요청은 새로 돈다 · 다른 프로젝트는 서로 막지 않는다.
    #[tokio::test]
    async fn finished_or_other_projects_run_again() {
        let f = flights();
        let runs = Arc::new(AtomicUsize::new(0));
        for key in [1, 1, 2] {
            let runs = runs.clone();
            let (_, sink) = recorder();
            let r = f
                .run(key, sink, |_| async move {
                    Ok(runs.fetch_add(1, Ordering::SeqCst) as u32)
                })
                .await;
            assert!(r.is_ok());
        }
        assert_eq!(runs.load(Ordering::SeqCst), 3);
    }

    /// 이끄는 퓨처가 취소돼도 합류자는 영영 기다리지 않고, 다음 요청은 새로 돈다.
    #[tokio::test]
    async fn an_abandoned_leader_releases_its_joiners() {
        let f = flights();
        let leader = {
            let f = f.clone();
            let (_, sink) = recorder();
            tokio::spawn(async move {
                f.run(3, sink, |_| std::future::pending::<Result<u32, String>>())
                    .await
            })
        };
        until_joined(&f, 3, 1).await;
        let joiner = {
            let f = f.clone();
            let (_, sink) = recorder();
            tokio::spawn(async move { f.run(3, sink, |_| async { Ok(9) }).await })
        };
        until_joined(&f, 3, 2).await;

        leader.abort();
        assert_eq!(joiner.await.unwrap(), Err("abandoned".to_string()));
        let (_, sink) = recorder();
        assert_eq!(f.run(3, sink, |_| async { Ok(5) }).await, Ok(5));
    }
}

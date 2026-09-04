//! 턴의 수명 — **한 대화에 도는 프롬프트는 하나**, 그리고 **어떻게 끝나든 종료 이벤트**.
//!
//! 두 결함을 같은 자리에서 막는다 (플랜 `v241-errors-first`).
//!
//! 1. `{#acp-inflight}` — 예전에는 같은 대화에 프롬프트를 두 번 보내면
//!    [`AcpState::set_sink`] 가 **자리를 덮어쓸 뿐**이었다. 첫 턴의 스트림은
//!    갈 곳을 잃고, 두 턴의 조각이 한 말풍선에 섞여 히스토리가 꼬였다. 이제
//!    자리를 못 잡으면 [`TurnGuard::begin`] 이 `None` 을 주고, 커맨드가
//!    `acp_session_busy` 로 **거절한다** — 조용히 덮지 않는다.
//!
//! 2. `{#acp-raii-completion}` — 종료 이벤트(`done`/`failed`)가 커맨드의 두
//!    match arm 에서만 나갔다. 그 사이의 `?` 조기 return, 태스크 드롭(창을
//!    닫거나 앱이 내려갈 때), 패닉으로 끝나면 **아무것도 안 나가고 UI 는 영영
//!    "생각 중"** 이었다. 종료를 `Drop` 에 실으면 이 전 경로가 한 번에 덮인다.
//!
//! 락 규율: 이 모듈의 임계 구역은 `HashMap` 삽입·삭제뿐이고 `.await` 를 넘지
//! 않는다 (`acp/` 전체가 지키는 clone-out-then-act 관용구).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::ipc::Channel;

use super::process::AcpState;
use super::session::AcpEvent;

/// 가드가 안전망으로 내보내는 실패 사유. 사용자에게 보이는 문구가 아니라
/// 프런트가 턴을 닫는 근거이자 로그용 원문이다 (`AppError` 규약과 같은 이유로
/// 영어).
pub const TURN_ABANDONED: &str =
    "the prompt task ended without a stop reason (cancelled, dropped, or failed early)";

/// `(대상, 대화)` 마다 **도는 턴 하나**를 지키는 장부.
///
/// 값이 토큰인 이유: 어댑터가 죽으면 [`clear_target`](Self::clear_target) 이
/// 표식을 지우고 사용자는 곧바로 새 턴을 시작할 수 있는데, 그때 죽은 턴의
/// 가드가 뒤늦게 드롭되면서 **새 턴의 자리를 풀어 버리는** 경합이 있다.
/// 토큰이 다르면 풀지 않는다.
#[derive(Default)]
pub struct TurnRegistry {
    inflight: Mutex<HashMap<(u64, String), u64>>,
    next: AtomicU64,
}

impl TurnRegistry {
    /// poison 을 이유로 문을 닫지 않는다 — 임계 구역이 삽입·삭제뿐이라 패닉이
    /// 자료를 반쯤 고쳐 놓을 수 없고, 여기서 닫으면 남은 세션 내내 프롬프트를
    /// 못 보낸다.
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<(u64, String), u64>> {
        self.inflight.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 자리를 잡는다. 이미 도는 턴이 있으면 `None`.
    fn begin(&self, target_id: u64, session_id: &str) -> Option<u64> {
        let token = self.next.fetch_add(1, Ordering::Relaxed);
        let mut map = self.map();
        if map.contains_key(&(target_id, session_id.to_string())) {
            return None;
        }
        map.insert((target_id, session_id.to_string()), token);
        Some(token)
    }

    /// **내가 잡은 자리일 때만** 푼다.
    fn end(&self, target_id: u64, session_id: &str, token: u64) {
        let key = (target_id, session_id.to_string());
        let mut map = self.map();
        if map.get(&key) == Some(&token) {
            map.remove(&key);
        }
    }

    /// 이 대화에 도는 턴이 있는가.
    pub fn in_flight(&self, target_id: u64, session_id: &str) -> bool {
        self.map()
            .contains_key(&(target_id, session_id.to_string()))
    }

    /// 이 대상의 표식을 전부 지운다 — 어댑터가 죽거나 멈출 때. 남겨 두면
    /// 되살아난 어댑터에서 그 대화가 영영 "도는 중"이라 프롬프트가 막힌다.
    pub fn clear_target(&self, target_id: u64) {
        self.map().retain(|(tid, _), _| *tid != target_id);
    }
}

/// 턴 이벤트가 갈 자리 (싱크) 배선. `AcpState` 의 impl 을 여기로 갈라 둔 것은
/// `cache/query.rs`·`manager/journal.rs` 와 같은 이유다 — 한 덩어리의 관심사가
/// 한 파일에 모이고, `process.rs` 는 프로세스 수명에 집중한다.
impl AcpState {
    /// 이 대화의 스트리밍 자리에 싱크를 앉힌다.
    ///
    /// 자리를 **덮어쓴다.** 프롬프트 경로에서 덮어써도 되는 이유는
    /// [`TurnGuard::begin`] 이 자리를 먼저 잡고, 실패하면 여기까지 오지 않기
    /// 때문이다.
    ///
    /// 가드 밖에서 부르는 곳이 아직 하나 있다 — `acp_load_session` 의 대화
    /// 재생. 그 대화에 턴이 도는 중이면 재생이 자리를 빼앗는다(가드 이전의
    /// 옛 동작 그대로). 다만 가드가 종료 이벤트를 **자기가 들고 있는 채널로**
    /// 직접 보내므로, 자리를 빼앗겨도 그 턴이 "생각 중"으로 굳지는 않는다.
    pub fn set_sink(&self, target_id: u64, session_id: String, sink: Channel<AcpEvent>) {
        if let Ok(mut map) = self.sinks.lock() {
            map.insert((target_id, session_id), sink);
        }
    }

    pub fn clear_sink(&self, target_id: u64, session_id: &str) {
        if let Ok(mut map) = self.sinks.lock() {
            map.remove(&(target_id, session_id.to_string()));
        }
    }

    /// 이 프로젝트의 모든 자리를 치운다 (어댑터가 죽거나 멈출 때).
    ///
    /// 턴 표식도 함께 지운다 — 남겨 두면 되살아난 어댑터에서 그 대화가 영영
    /// "도는 중"이라 프롬프트가 막힌다.
    pub fn clear_sinks(&self, target_id: u64) {
        if let Ok(mut map) = self.sinks.lock() {
            map.retain(|(pid, _), _| *pid != target_id);
        }
        self.turns.clear_target(target_id);
    }

    /// 턴 장부 — [`TurnGuard`] 가 자리를 잡고 푸는 곳.
    pub fn turns(&self) -> &TurnRegistry {
        &self.turns
    }
}

/// 한 턴의 수명 표식. 살아 있는 동안 그 대화의 자리를 쥐고, 드롭되는 순간
/// 자리를 풀며 **종료 이벤트가 나갔음을 보장한다**.
///
/// 참조: `block/buzz` 의 `TurnCompletionGuard` — 성공·에러·타임아웃·취소·패닉
/// 전 경로를 `Drop` 하나로 덮는다.
pub struct TurnGuard<'a> {
    state: &'a AcpState,
    target_id: u64,
    session_id: String,
    token: u64,
    sink: Channel<AcpEvent>,
    /// [`finish`](Self::finish) 가 이미 종료를 알렸는가 — 이중 발행 방지.
    finished: bool,
}

impl<'a> TurnGuard<'a> {
    /// 이 대화의 턴 자리를 잡고 스트리밍 싱크를 앉힌다.
    ///
    /// 이미 도는 턴이 있으면 `None` — 호출자는 **거절해야 한다.** 자리를 잡은
    /// 뒤에야 싱크를 앉히는 순서가 중요하다: 반대로 하면 거절당한 두 번째
    /// 프롬프트가 첫 턴의 싱크를 이미 덮은 뒤다.
    pub fn begin(
        state: &'a AcpState,
        target_id: u64,
        session_id: String,
        sink: Channel<AcpEvent>,
    ) -> Option<Self> {
        let token = state.turns().begin(target_id, &session_id)?;
        state.set_sink(target_id, session_id.clone(), sink.clone());
        Some(Self {
            state,
            target_id,
            session_id,
            token,
            sink,
            finished: false,
        })
    }

    /// 정상 종료 — 싱크를 먼저 치우고 종료 이벤트를 **한 번** 내보낸다.
    ///
    /// 치우기가 먼저인 이유는 예전 코드와 같다: 늦게 도착한 `session/update`
    /// 조각이 이미 닫힌 턴의 채널로 흘러들지 않게 한다.
    pub fn finish(mut self, event: AcpEvent) {
        self.finished = true;
        self.state.clear_sink(self.target_id, &self.session_id);
        if let Err(e) = self.sink.send(event) {
            tracing::debug!(target_id = self.target_id, error = %e, "ACP 턴 종료 이벤트 전송 실패");
        }
    }
}

impl Drop for TurnGuard<'_> {
    fn drop(&mut self) {
        self.state.clear_sink(self.target_id, &self.session_id);
        self.state
            .turns()
            .end(self.target_id, &self.session_id, self.token);
        if self.finished {
            return;
        }
        // 여기까지 왔다는 건 커맨드가 종료를 알리지 못하고 끝났다는 뜻이다 —
        // 조기 return, 태스크 드롭, 패닉. 말없이 끝내면 UI 가 영원히 "생각 중".
        tracing::warn!(
            target_id = self.target_id,
            session_id = %self.session_id,
            "ACP 턴이 종료를 알리지 못하고 끝났다 — failed 로 닫는다"
        );
        let _ = self.sink.send(AcpEvent::Failed {
            message: TURN_ABANDONED.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tauri::ipc::InvokeResponseBody;

    /// 실제 `Channel<AcpEvent>` 를 쓴다 — 트레이트로 흉내 내면 정작 프런트가
    /// 받는 경로(직렬화 + `IpcResponse`)를 안 통과한 채 초록이 된다.
    fn recording_channel() -> (Channel<AcpEvent>, Arc<Mutex<Vec<String>>>) {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, seen)
    }

    fn kinds(seen: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        seen.lock()
            .unwrap()
            .iter()
            .filter_map(|raw| {
                serde_json::from_str::<serde_json::Value>(raw)
                    .ok()?
                    .get("kind")?
                    .as_str()
                    .map(str::to_string)
            })
            .collect()
    }

    /// 같은 대화에 두 번째 프롬프트가 들어오면 **거절**된다.
    ///
    /// 예전에는 조용히 싱크를 덮어써서 첫 턴의 스트림이 갈 곳을 잃었다.
    #[test]
    fn a_second_turn_on_the_same_conversation_is_refused() {
        let state = AcpState::default();
        let (first, _) = recording_channel();
        let (second, _) = recording_channel();

        let held = TurnGuard::begin(&state, 7, "s1".into(), first).expect("첫 턴");
        assert!(TurnGuard::begin(&state, 7, "s1".into(), second.clone()).is_none());

        // 옆 대화·옆 대상은 서로 막지 않는다.
        assert!(TurnGuard::begin(&state, 7, "s2".into(), second.clone()).is_some());
        assert!(TurnGuard::begin(&state, 8, "s1".into(), second).is_some());

        drop(held);
        let (third, _) = recording_channel();
        assert!(
            TurnGuard::begin(&state, 7, "s1".into(), third).is_some(),
            "턴이 끝나면 같은 대화가 다시 열려야 한다"
        );
    }

    /// **종료를 알리지 못하고 끝난 턴**도 종료 이벤트를 내보낸다 (조기 return).
    ///
    /// 이 단언이 `Drop` 구현을 문다 — 지우면 `failed` 가 사라져 깨진다.
    #[test]
    fn an_abandoned_turn_still_reports_termination() {
        let state = AcpState::default();
        let (channel, seen) = recording_channel();

        // `?` 로 일찍 빠져나가는 커맨드 본문을 그대로 흉내 낸다.
        fn early_return(state: &AcpState, channel: Channel<AcpEvent>) -> Result<(), String> {
            let _guard = TurnGuard::begin(state, 7, "s1".into(), channel).ok_or("busy")?;
            Err("프로젝트 루트 해석 실패".into())
        }

        assert!(early_return(&state, channel).is_err());
        assert_eq!(kinds(&seen), vec!["failed"]);
        assert!(
            !state.turns().in_flight(7, "s1"),
            "자리가 풀려야 다음 프롬프트가 들어올 수 있다"
        );
    }

    /// 싱크도 함께 치워진다 — 남겨 두면 죽은 턴의 채널로 다음 대화의 조각이 샌다.
    #[test]
    fn an_abandoned_turn_also_vacates_the_streaming_sink() {
        let state = AcpState::default();
        let (channel, seen) = recording_channel();

        {
            let _guard = TurnGuard::begin(&state, 7, "s1".into(), channel).expect("턴");
            state.emit(
                7,
                "s1",
                AcpEvent::Chunk {
                    text: "안녕".into(),
                },
            );
        }
        state.emit(
            7,
            "s1",
            AcpEvent::Chunk {
                text: "드롭 이후".into(),
            },
        );

        assert_eq!(kinds(&seen), vec!["chunk", "failed"]);
    }

    /// 정상 종료는 **정확히 한 번**만 알린다 — `Drop` 의 안전망이 겹쳐 울리면
    /// 프런트가 성공한 턴을 실패로 다시 닫는다.
    #[test]
    fn a_finished_turn_reports_exactly_one_termination() {
        let state = AcpState::default();
        let (channel, seen) = recording_channel();

        let guard = TurnGuard::begin(&state, 7, "s1".into(), channel).expect("턴");
        guard.finish(AcpEvent::Done {
            stop_reason: "end_turn".into(),
        });

        assert_eq!(kinds(&seen), vec!["done"]);
        assert!(!state.turns().in_flight(7, "s1"));
    }

    /// 태스크가 **응답을 기다리다 통째로 드롭**돼도 종료가 나간다 (창을 닫거나
    /// 앱이 내려갈 때 Tauri 가 하는 일).
    #[tokio::test]
    async fn a_turn_dropped_mid_await_still_reports_termination() {
        let state = AcpState::default();
        let (channel, seen) = recording_channel();

        let turn = async {
            let _guard = TurnGuard::begin(&state, 7, "s1".into(), channel).expect("턴");
            // 어댑터 응답을 기다리는 자리.
            std::future::pending::<()>().await;
        };
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), turn)
                .await
                .is_err(),
            "대기 중 취소를 재현해야 한다"
        );

        assert_eq!(kinds(&seen), vec!["failed"]);
        assert!(!state.turns().in_flight(7, "s1"));
    }

    /// 어댑터가 죽으면 표식을 통째로 지운다 — 안 지우면 되살아난 뒤 그 대화가
    /// 영영 "도는 중"이다. 그리고 죽은 턴의 가드가 뒤늦게 드롭돼도 **새 턴의
    /// 자리를 풀지 않는다**(토큰이 다르다).
    #[test]
    fn an_adapter_restart_frees_the_conversation_without_freeing_the_next_turn() {
        let state = AcpState::default();
        let (first, _) = recording_channel();
        let stale = TurnGuard::begin(&state, 7, "s1".into(), first).expect("첫 턴");

        state.clear_sinks(7);
        assert!(!state.turns().in_flight(7, "s1"));

        let (second, _) = recording_channel();
        let fresh = TurnGuard::begin(&state, 7, "s1".into(), second).expect("되살아난 뒤 첫 턴");
        drop(stale);
        assert!(
            state.turns().in_flight(7, "s1"),
            "죽은 턴의 뒤늦은 드롭이 새 턴의 자리를 풀면 안 된다"
        );
        drop(fresh);
        assert!(!state.turns().in_flight(7, "s1"));
    }
}

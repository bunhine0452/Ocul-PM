//! listen_any → SSE 재송출 허브 (#mb2-sse).
//!
//! 화이트리스트 이벤트만 링 버퍼(256) + broadcast 로 흘린다. SSE 클라이언트는
//! Last-Event-ID 로 재접속하고, 버퍼 안이면 놓친 것부터 재전송받는다 —
//! 버퍼 밖(너무 오래 끊김)이면 있는 것부터 주므로, 폰 쪽은 재접속 시 화면
//! 재조회를 병행한다 (기존 데스크톱 워처 복구 패턴과 동일).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::sync::broadcast;

/// 폰으로 재송출하는 이벤트 — 창·트레이·터미널·DAP·LSP 는 데스크톱 전용이라 제외.
/// 이름은 bindings.ts 의 와이어 이름 그대로 (tauri-specta kebab-case).
pub const FORWARDED_EVENTS: &[&str] = &[
    "oculpm-session-started",
    "oculpm-session-ended",
    "oculpm-journal-added",
    "oculpm-journal-updated",
    "oculpm-journal-path-changed",
    "oculpm-file-changed",
    "oculpm-watch-yielded",
    "oculpm-plan-reconciled",
    "oculpm-integrity-warning",
    "oculpm-data-changed",
    "oculpm-agent-drift",
    "oculpm-agents-template-changed",
    "settings-changed",
];

const BUFFER_CAP: usize = 256;
const CHANNEL_CAP: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredEvent {
    pub id: u64,
    pub event: String,
    /// emit 시점의 JSON 문자열 그대로 — 재직렬화 없이 SSE data 로 나간다.
    pub payload: String,
}

pub struct EventHub {
    seq: AtomicU64,
    buffer: Mutex<VecDeque<StoredEvent>>,
    tx: broadcast::Sender<StoredEvent>,
}

impl Default for EventHub {
    fn default() -> Self {
        Self {
            seq: AtomicU64::new(0),
            buffer: Mutex::new(VecDeque::with_capacity(BUFFER_CAP)),
            tx: broadcast::channel(CHANNEL_CAP).0,
        }
    }
}

impl EventHub {
    pub fn publish(&self, event: &str, payload: String) -> u64 {
        let id = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let stored = StoredEvent { id, event: event.to_string(), payload };
        {
            let mut buf = self.buffer.lock().expect("event buffer poisoned");
            if buf.len() == BUFFER_CAP {
                buf.pop_front();
            }
            buf.push_back(stored.clone());
        }
        // 구독자 0 이면 Err — 정상 (아무도 안 듣는 동안의 이벤트는 버퍼에만 남는다).
        let _ = self.tx.send(stored);
        id
    }

    /// `last_id` 이후의 버퍼 내용 — 재접속 재전송용. `None` 은 처음 접속(재전송 없음).
    pub fn since(&self, last_id: Option<u64>) -> Vec<StoredEvent> {
        let Some(last) = last_id else { return Vec::new() };
        let buf = self.buffer.lock().expect("event buffer poisoned");
        buf.iter().filter(|e| e.id > last).cloned().collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StoredEvent> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_monotonic_from_one() {
        let hub = EventHub::default();
        assert_eq!(hub.publish("a", "{}".into()), 1);
        assert_eq!(hub.publish("b", "{}".into()), 2);
    }

    #[test]
    fn since_returns_only_newer_events() {
        let hub = EventHub::default();
        for i in 0..5 {
            hub.publish("e", format!("{i}"));
        }
        let replay = hub.since(Some(2));
        assert_eq!(replay.iter().map(|e| e.id).collect::<Vec<_>>(), vec![3, 4, 5]);
        assert!(hub.since(None).is_empty(), "처음 접속은 재전송 없음");
        assert!(hub.since(Some(5)).is_empty(), "놓친 것이 없으면 빈 목록");
    }

    #[test]
    fn buffer_evicts_oldest_beyond_cap() {
        let hub = EventHub::default();
        for i in 0..(BUFFER_CAP as u64 + 10) {
            hub.publish("e", format!("{i}"));
        }
        // 너무 오래 끊겼던 클라이언트(last=0) — 버퍼에 남은 것부터.
        let replay = hub.since(Some(0));
        assert_eq!(replay.len(), BUFFER_CAP);
        assert_eq!(replay.first().unwrap().id, 11);
    }

    #[tokio::test]
    async fn subscribers_receive_live_events() {
        let hub = EventHub::default();
        let mut rx = hub.subscribe();
        hub.publish("live", r#"{"x":1}"#.into());
        let got = rx.recv().await.unwrap();
        assert_eq!(got.event, "live");
        assert_eq!(got.id, 1);
    }
}

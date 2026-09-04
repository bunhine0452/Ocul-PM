//! 세션별 PTY 쓰기 큐 (#pty-write-lock).
//!
//! **PTY 마스터로의 쓰기는 막힌다.** 자식이 raw 모드로 tty 를 잡고 입력을 읽지
//! 않는 동안(vim·less·도구 호출 중인 claude — 터미널에서 가장 흔한 상태다)
//! 마스터의 입력 큐가 차고, 그 뒤의 `write` 는 **무기한 블록한다.** 재현으로
//! 확인한 값(macOS 25.6, 2026-09-04): 정규(canonical) 모드에서는 64 MB 를
//! 1.7 초에 삼키지만, `stty raw` + 읽지 않는 포그라운드에서는 1 MB 중
//! **0 바이트**를 쓰고 5초가 지나도 돌아오지 않았다.
//!
//! 예전에는 그 `write_all`+`flush` 를 `host.rs` 의 요청 처리기가 **전역 세션 맵
//! 락을 쥔 채** 직접 불렀다. 그러면 두 겹으로 번진다:
//!
//! 1. 전역 락이라 **다른 세션의 모든 요청**(attach·resize·kill)이 함께 선다.
//! 2. 요청 처리는 접속별 읽기 루프 안에서 **동기로** 돌므로, 그 접속의 뒤에 온
//!    프레임이 통째로 밀린다. 앱의 요청 상한은 10초고
//!    ([`crate::ptyhost::client`]), 그걸 넘기면 접속을 죽은 것으로 표시한다 —
//!    **붙여넣기 한 번이 모든 터미널의 연결을 끊는 자리**가 이것이었다.
//!
//! 그래서 쓰기는 세션마다 **자기 스레드와 자기 큐**를 갖는다. 요청 처리기는
//! 큐에 넣기만 하고 즉시 답한다. 순서 계약(키 입력 순서가 곧 계약)은 큐가
//! FIFO 이고 소비자가 하나뿐이라 그대로 지켜진다.

use std::io::Write;
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

/// 큐에 쌓아 둘 수 있는 입력 조각 수.
///
/// **무제한이 아닌 이유**: 영영 읽지 않는 세션이 있으면 무제한 큐는 조용히
/// 메모리로 자란다. 유한이되 넉넉하게 — 사람의 타이핑과 붙여넣기가 이 수를
/// 채우려면 세션이 이미 완전히 멈춰 있어야 하고, 그때는 조용히 버리는 대신
/// **오류로 말하는 것**이 맞다 (`write_to_pty` 가 프런트로 올린다).
const QUEUE_CAP: usize = 1024;

/// 한 세션의 PTY 입력 파이프. 복제 가능한 핸들로 쓰라고 `Arc` 에 담아 둔다 —
/// 세션 맵에서 꺼낼 때 **락은 이것 하나를 복제하는 동안만** 잡힌다.
pub struct SessionWriter {
    tx: SyncSender<Vec<u8>>,
    /// 쓰기 스레드가 남긴 마지막 실패. 큐에 넣는 쪽은 그 실패를 **다음
    /// `enqueue` 에서** 받는다 — 비동기로 옮긴 대가로 오류가 사라지면 안 된다.
    failure: Arc<Mutex<Option<String>>>,
}

impl SessionWriter {
    /// 쓰기 스레드를 띄우고 그 입구를 돌려준다.
    ///
    /// 스레드는 `tokio` 의 blocking 풀이 아니라 **전용 OS 스레드**다: 여기서
    /// 막히는 것이 정상 동작이므로(위 문서), 풀을 쓰면 세션 수만큼 풀 자리를
    /// 영구 점유해 git·코드 검색과 나눠 쓰는 그 풀을 굶긴다.
    ///
    /// 종료는 입구가 사라지는 것으로 족하다 — [`SessionWriter`] 가 드롭되면
    /// `recv` 가 끊기고, 스레드가 `sink`(= PTY 마스터의 writer fd)를 놓는다.
    pub fn spawn(mut sink: Box<dyn Write + Send>) -> Self {
        let (tx, rx) = sync_channel::<Vec<u8>>(QUEUE_CAP);
        let failure = Arc::new(Mutex::new(None));
        let reported = failure.clone();
        std::thread::spawn(move || {
            while let Ok(chunk) = rx.recv() {
                let outcome = match sink.write_all(&chunk) {
                    Ok(()) => sink.flush(),
                    Err(e) => Err(e),
                };
                if let Err(e) = outcome {
                    *reported.lock().unwrap_or_else(|p| p.into_inner()) =
                        Some(format!("Failed to write to PTY: {e}"));
                    break;
                }
            }
        });
        Self { tx, failure }
    }

    /// 입력 한 조각을 큐에 넣는다 — **절대 블록하지 않는다.**
    ///
    /// `Ok` 는 "PTY 가 받았다"가 아니라 "순서대로 갈 자리에 들어갔다"는 뜻이다.
    /// 실제 쓰기가 실패했으면 그 사실이 다음 호출에서 올라온다.
    pub fn enqueue(&self, data: &str) -> Result<(), String> {
        if let Some(why) = self
            .failure
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
        {
            return Err(why);
        }
        match self.tx.try_send(data.as_bytes().to_vec()) {
            Ok(()) => Ok(()),
            // 조용히 버리지 않는다 — 사라진 키 입력은 사용자가 알 길이 없다.
            Err(TrySendError::Full(_)) => Err(format!(
                "PTY input queue is full ({QUEUE_CAP} chunks) — the shell is not reading"
            )),
            Err(TrySendError::Disconnected(_)) => {
                Err("Failed to write to PTY: the writer is gone".to_string())
            }
        }
    }
}

//! 앱 안 터미널의 출력 길 — PTY 에서 읽은 바이트를 글자로 잇고, 상태 신호(OSC 7501)를 세션 표에 반영하고,
//! 출력을 묶어 웹뷰로 보낸다. `terminal.rs` 가 800줄을 넘지 않게 떼어 냈다(2026-11-11).

use std::io::Write;
use std::sync::{Arc, Mutex};

use super::{Inner, TermEvent, TermStatus};
use crate::program_status;

/// 읽은 바이트에서 **완성된 UTF-8 만** 꺼낸다 — 한글 한 글자(3바이트)가 두 번의 읽기에
/// 걸쳐 오면 앞 조각을 다음 읽기까지 남긴다. 잘못된 바이트는 대체 문자로.
pub fn take_utf8(carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(carry) {
        Ok(s) => {
            let out = s.to_owned();
            carry.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let out = String::from_utf8_lossy(&carry[..valid]).into_owned();
            carry.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(carry).into_owned();
            carry.clear();
            out
        }
    }
}

/// 상태 신호 하나를 세션 표에 반영한다. 탐침이면 그 PTY 에 답을 쓰고, 루트 보고가 상태를
/// 바꾸면 웹뷰로 보낼 사건을 돌려준다. 하위 기록(`id=…`)은 지금 보지 않는다.
pub(super) fn apply_program_status(
    table: &Arc<Mutex<Inner>>,
    id: u32,
    msg: program_status::Message,
) -> Option<TermEvent> {
    let mut t = table.lock().ok()?;
    let s = t.map.get_mut(&id)?;
    match msg {
        program_status::Message::Query => {
            let _ = s.writer.write_all(program_status::QUERY_REPLY);
            let _ = s.writer.flush();
            None
        }
        program_status::Message::Report(r) if r.id.is_none() => {
            let next = r.state.map(|state| TermStatus {
                state: state.as_str().to_string(),
                kind: r.kind.map(|k| k.as_str().to_string()),
                msg: r.msg.clone(),
                since: s
                    .info
                    .status
                    .as_ref()
                    .filter(|prev| prev.state == state.as_str())
                    .map(|prev| prev.since.clone())
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            });
            if s.info.status == next {
                return None;
            }
            s.info.status = next.clone();
            Some(TermEvent::Status { status: next })
        }
        program_status::Message::Report(_) => None,
    }
}

/// 출력을 묶어 보내는 기준 — 마지막 조각 뒤 이만큼 잠잠하면 보낸다.
pub(super) const FLUSH_QUIET: std::time::Duration = std::time::Duration::from_millis(5);
/// 쉬지 않고 흘러도 첫 글자가 이보다 오래 기다리지 않는다(한 화면 주기 ~16ms 안).
pub(super) const FLUSH_MAX_DELAY: std::time::Duration = std::time::Duration::from_millis(12);
/// 이만큼 모이면 잠잠하기를 기다리지 않고 보낸다.
pub(super) const FLUSH_BYTES: usize = 64 * 1024;

/// 모은 출력을 한 번에 웹뷰로 보낸다.
fn flush_output<F: Fn(TermEvent)>(
    emit: &F,
    pending: &mut String,
    first_at: &mut Option<std::time::Instant>,
) {
    if !pending.is_empty() {
        emit(TermEvent::Output {
            data: std::mem::take(pending),
        });
    }
    *first_at = None;
}

/// 읽기 스레드가 넘긴 조각을 받아 **묶어서** 보낸다 — 채널이 끊기면(EOF) 남은 것을 보내고 돌아온다.
///
/// 예전에는 `read` 한 번(최대 8KB)이 곧 웹뷰 송신 한 번이었다. Windows 의 ConPTY 는 출력을 잘게 쪼개 내보내고
/// Claude Code 의 전체 화면 렌더러는 한 프레임을 통째로 다시 그려, 송신마다 WebView2 스크립트 실행 한 번이
/// 쌓여 화면이 밀렸다(2026-11-11). 이제 `FLUSH_QUIET` 잠잠 · `FLUSH_MAX_DELAY` · `FLUSH_BYTES` 가운데 먼저
/// 오는 때에 한 번 보낸다.
///
/// 상태 신호는 여전히 **조각마다, 그 조각의 출력이 화면으로 가기 전에** 반영한다 — 탐침의 답이 xterm 의
/// DA1 응답보다 먼저 가야 claude 가 이 터미널이 신호를 받는다고 본다. 상태 사건을 보낼 때는 그 앞까지
/// 모은 출력을 먼저 보내, 출력 · 상태의 순서가 예전과 같다.
pub(super) fn pump_output<F: Fn(TermEvent)>(
    rx: &std::sync::mpsc::Receiver<Vec<u8>>,
    table: &Arc<Mutex<Inner>>,
    id: u32,
    emit: &F,
) {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Instant;
    let mut carry: Vec<u8> = Vec::new();
    let mut scanner = program_status::Scanner::default();
    let mut pending = String::new();
    let mut first_at: Option<Instant> = None;
    let mut last_at = Instant::now();
    loop {
        let chunk = match first_at {
            None => match rx.recv() {
                Ok(chunk) => chunk,
                Err(_) => break,
            },
            Some(first) => {
                let deadline = (last_at + FLUSH_QUIET).min(first + FLUSH_MAX_DELAY);
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(chunk) => chunk,
                    Err(RecvTimeoutError::Timeout) => {
                        flush_output(emit, &mut pending, &mut first_at);
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        };
        for msg in scanner.feed(&chunk) {
            if let Some(ev) = apply_program_status(table, id, msg) {
                flush_output(emit, &mut pending, &mut first_at);
                emit(ev);
            }
        }
        carry.extend_from_slice(&chunk);
        let text = take_utf8(&mut carry);
        if !text.is_empty() {
            let now = Instant::now();
            pending.push_str(&text);
            last_at = now;
            first_at.get_or_insert(now);
        }
        if pending.len() >= FLUSH_BYTES {
            flush_output(emit, &mut pending, &mut first_at);
        }
    }
    // 끝에 남은 반쪽 글자는 대체 문자로라도 보낸다 — 끝 사건보다 먼저.
    if !carry.is_empty() {
        pending.push_str(&String::from_utf8_lossy(&carry));
    }
    flush_output(emit, &mut pending, &mut first_at);
}

//! 앱 안 터미널의 출력 길 — PTY 에서 읽은 바이트를 글자로 잇고, 신호(OSC 7501 상태 · OSC 0/2 제목 · BEL ·
//! OSC 9/777 알림)를 세션 표에 반영하고, 출력을 묶어 웹뷰로 보낸다. `terminal.rs` 가 800줄을 넘지 않게
//! 떼어 냈다(2026-11-11).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::pty_io::Flow;
use super::{Inner, Session, TermEvent, TermSessions, TermStatus};
use crate::program_status::{self, Message};

/// 읽은 바이트에서 **완성된 UTF-8 만** 꺼낸다 — 한글 한 글자(3바이트)가 두 번의 읽기에 걸쳐 오면 앞 조각을
/// 다음 읽기까지 남긴다. 잘못된 바이트는 그 길이만큼만 대체 문자로 — 예전에는 하나라도 있으면 조각 전체를
/// 손실 변환해, 그 뒤에서 다음 읽기로 걸친 반쪽 한글까지 대체 문자가 됐다.
pub fn take_utf8(carry: &mut Vec<u8>) -> String {
    let mut out = String::new();
    let mut start = 0;
    while start < carry.len() {
        match std::str::from_utf8(&carry[start..]) {
            Ok(text) => {
                out.push_str(text);
                start = carry.len();
            }
            Err(e) => {
                let valid = start + e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[start..valid]).unwrap_or_default());
                match e.error_len() {
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        start = valid + bad;
                    }
                    // 끝의 덜 온 글자 — 다음 읽기까지 남긴다.
                    None => {
                        start = valid;
                        break;
                    }
                }
            }
        }
    }
    carry.drain(..start);
    out
}

/// 제목 · 종 · 알림을 웹뷰로 보내는 간격 — 같은 세션은 이 안에 한 번. 제목은 간격 안에 바뀐 마지막 것을
/// 간격 끝에 보낸다(Claude Code 는 제목을 프레임마다 다시 보낸다 — 스피너는 정화가 떼고, 남은 바뀜만 센다).
pub(super) const SIGNAL_GAP: Duration = Duration::from_secs(1);

/// 세션 하나의 신호 박자 — 펌프 스레드 안에서만 산다.
#[derive(Default)]
struct Pace {
    title_sent: Option<Instant>,
    /// 바뀐 제목을 보낼 차례가 남았다.
    title_due: bool,
    bell_sent: Option<Instant>,
    notice_sent: Option<Instant>,
}

impl Pace {
    fn ready(last: Option<Instant>, now: Instant) -> bool {
        last.is_none_or(|t| now.duration_since(t) >= SIGNAL_GAP)
    }

    /// 남은 제목을 보낼 때 — 차례가 있을 때만. 보낸 적이 없으면 지금.
    fn title_at(&self, now: Instant) -> Option<Instant> {
        self.title_due
            .then(|| self.title_sent.map_or(now, |t| t + SIGNAL_GAP))
    }
}

/// 두 출처에서 이 세션의 제목을 다시 정한다 — OSC 7501 의 `title=` 이 OSC 0 · 2 보다 먼저. 바뀌었으면 보낼
/// 차례를 남긴다.
fn retitle(s: &mut Session, pace: &mut Pace) {
    let title = s.program_title.clone().or_else(|| s.osc_title.clone());
    if title != s.info.title {
        s.info.title = title;
        pace.title_due = true;
    }
}

/// 신호 하나를 세션 표에 반영한다. 탐침이면 그 PTY 의 쓰기 줄에 답을 넣고, 상태 · 종 · 알림이면 지금 웹뷰로
/// 보낼 사건을 돌려준다. 제목은 `pace` 에 차례로 남는다(`emit_title`). 하위 기록(`id=…`)은 지금 보지 않는다.
fn apply_message(
    table: &Arc<Mutex<Inner>>,
    id: u32,
    msg: Message,
    pace: &mut Pace,
    now: Instant,
) -> Option<TermEvent> {
    let mut t = table.lock().ok()?;
    let s = t.map.get_mut(&id)?;
    match msg {
        Message::Query => {
            let _ = s.input.reply(program_status::QUERY_REPLY.to_vec());
            None
        }
        Message::Report(r) if r.id.is_none() => {
            let prev = s.info.status.as_ref();
            let next = r.state.map(|state| TermStatus {
                state: state.as_str().to_string(),
                kind: r.kind.map(|k| k.as_str().to_string()),
                // 까닭 글도 제목처럼 거른다 — 띠 · 툴팁 · OS 알림 본문에 앱이 덧붙인 말과 한 줄로 선다(SEC-03).
                msg: r.msg.as_deref().and_then(program_status::clean_msg),
                since: prev
                    .filter(|p| p.state == state.as_str())
                    .map(|p| p.since.clone())
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                // 이름은 한 번 알리면 남는다 — 매 보고에 싣지 않는 프로그램도 있다.
                app: r.app.clone().or_else(|| prev.and_then(|p| p.app.clone())),
            });
            // 보고에 실린 제목도 같은 정화를 거친다. 지우기(`state=clear`)면 함께 지운다.
            let reported = r.title.as_deref().and_then(|t| {
                program_status::clean_text(t.as_bytes(), program_status::TITLE_CHARS)
            });
            s.program_title = next
                .as_ref()
                .and(reported.or_else(|| s.program_title.clone()));
            // 지우기는 그 프로그램이 손을 뗐다는 뜻이다 — 그것이 OSC 0 · 2 로 붙인 제목도 함께 내린다. 끝날 때
            // 제목을 되돌리지 않는 프로그램이 많아, 제목을 안 찍는 셸에서는 끝난 대화 주제가 탭 이름으로 남았다.
            if next.is_none() {
                s.osc_title = None;
            }
            retitle(s, pace);
            if s.info.status == next {
                return None;
            }
            s.info.status = next.clone();
            Some(TermEvent::Status { status: next })
        }
        Message::Report(_) => None,
        Message::Title(title) => {
            s.osc_title = title;
            retitle(s, pace);
            None
        }
        // 셸만 도는 칸의 종(탭 완성 실패 따위)은 소식이 아니다 — 셸 위에서 무언가 돌 때만.
        Message::Bell => {
            let running = s.fg_busy().unwrap_or(s.info.status.is_some());
            if !running || !Pace::ready(pace.bell_sent, now) {
                return None;
            }
            pace.bell_sent = Some(now);
            Some(TermEvent::Bell)
        }
        Message::Notice { title, body } => {
            if !Pace::ready(pace.notice_sent, now) {
                return None;
            }
            pace.notice_sent = Some(now);
            Some(TermEvent::Notice { title, body })
        }
    }
}

/// 남은 제목 차례를 보낸다 — 표의 지금 제목으로.
fn emit_title<F: Fn(TermEvent)>(table: &Arc<Mutex<Inner>>, id: u32, pace: &mut Pace, emit: &F) {
    pace.title_due = false;
    pace.title_sent = Some(Instant::now());
    let title = table
        .lock()
        .ok()
        .and_then(|t| t.map.get(&id).map(|s| s.info.title.clone()));
    if let Some(title) = title {
        emit(TermEvent::Title { title });
    }
}

impl TermSessions {
    /// 그 프로젝트에서 내 손을 기다리는(OSC 7501 blocked) 살아 있는 세션 수 — 창 제목 · Dock 배지가 센다
    /// (`commands/window/attention.rs`). 셸이 다시 앞에 선 칸(claude 가 `state=clear` 없이 죽었다)의 낡은
    /// 기다림은 세지 않는다 — 셸이 살아 있는 한 「기다림 1」 이 끝없이 섰다. 기다리는 칸만 ioctl 하나를 더 묻고,
    /// 물을 수 없으면(Windows) 예전처럼 센다.
    pub fn waiting_in(&self, project_id: u32) -> u32 {
        let Ok(inner) = self.inner.lock() else {
            return 0;
        };
        let blocked = |s: &&Session| {
            let st = s.info.status.as_ref();
            s.info.alive && st.is_some_and(|st| st.state == "blocked") && s.fg_busy() != Some(false)
        };
        inner
            .map
            .values()
            .filter(|s| s.info.project_id == project_id)
            .filter(blocked)
            .count() as u32
    }
}

/// 출력을 묶어 보내는 기준 — 마지막 조각 뒤 이만큼 잠잠하면 보낸다.
pub(super) const FLUSH_QUIET: Duration = Duration::from_millis(5);
/// 쉬지 않고 흘러도 첫 글자가 이보다 오래 기다리지 않는다(한 화면 주기 ~16ms 안).
pub(super) const FLUSH_MAX_DELAY: Duration = Duration::from_millis(12);
/// 이만큼 모이면 잠잠하기를 기다리지 않고 보낸다.
pub(super) const FLUSH_BYTES: usize = 64 * 1024;

/// 모은 출력을 한 번에 웹뷰로 보낸다 — 보낸 바이트를 흐름에 먼저 적는다(알림이 셈보다 먼저 와 어긋나지 않게).
fn flush_output<F: Fn(TermEvent)>(
    emit: &F,
    flow: &Flow,
    pending: &mut String,
    first_at: &mut Option<Instant>,
) {
    if !pending.is_empty() {
        let data = std::mem::take(pending);
        let n = data.len();
        flow.sent(n);
        emit(TermEvent::Output {
            data,
            n: u32::try_from(n).unwrap_or(u32::MAX),
        });
    }
    *first_at = None;
}

/// 읽기 스레드가 넘긴 조각을 받아 **묶어서** 보낸다 — 채널이 끊기면(EOF) 남은 것을 보내고 돌아온다.
///
/// 예전에는 `read` 한 번(최대 8KB)이 곧 웹뷰 송신 한 번이었다. Windows 의 ConPTY 는 출력을 잘게 쪼개 내보내고
/// Claude Code 의 전체 화면 렌더러는 한 프레임을 통째로 다시 그려, 송신마다 WebView2 스크립트 실행 한 번이
/// 쌓여 화면이 밀렸다(2026-11-11). 이제 `FLUSH_QUIET` 잠잠 · `FLUSH_MAX_DELAY` · `FLUSH_BYTES` 가운데 먼저
/// 오는 때에 한 번 보낸다. 다음 조각을 받기 전에는 웹뷰가 밀렸는지 본다(`Flow::hold`) — 밀렸으면 여기서 서고,
/// 그동안 읽기 스레드의 채널이 차서 커널 PTY 버퍼가 생산자를 멈춘다.
///
/// 신호는 여전히 **조각마다, 그 조각의 출력이 화면으로 가기 전에** 반영한다 — 탐침의 답이 xterm 의 DA1
/// 응답보다 먼저 가야 claude 가 이 터미널이 신호를 받는다고 본다. 사건을 보낼 때는 그 앞까지 모은 출력을
/// 먼저 보내, 출력 · 상태의 순서가 예전과 같다.
pub(super) fn pump_output<F: Fn(TermEvent)>(
    rx: &std::sync::mpsc::Receiver<Vec<u8>>,
    table: &Arc<Mutex<Inner>>,
    id: u32,
    emit: &F,
    flow: &Flow,
) {
    use std::sync::mpsc::RecvTimeoutError;
    let mut carry: Vec<u8> = Vec::new();
    let mut scanner = program_status::Scanner::default();
    let mut pace = Pace::default();
    let mut pending = String::new();
    let mut first_at: Option<Instant> = None;
    let mut last_at = Instant::now();
    loop {
        flow.hold();
        let now = Instant::now();
        if pace.title_at(now).is_some_and(|at| at <= now) {
            emit_title(table, id, &mut pace, emit);
        }
        let flush_at = first_at.map(|first| (last_at + FLUSH_QUIET).min(first + FLUSH_MAX_DELAY));
        let wake = [flush_at, pace.title_at(now)].into_iter().flatten().min();
        let chunk = match wake {
            None => match rx.recv() {
                Ok(chunk) => chunk,
                Err(_) => break,
            },
            Some(at) => match rx.recv_timeout(at.saturating_duration_since(now)) {
                Ok(chunk) => chunk,
                Err(RecvTimeoutError::Timeout) => {
                    if flush_at.is_some_and(|t| t <= Instant::now()) {
                        flush_output(emit, flow, &mut pending, &mut first_at);
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            },
        };
        let now = Instant::now();
        for msg in scanner.feed(&chunk) {
            if let Some(ev) = apply_message(table, id, msg, &mut pace, now) {
                flush_output(emit, flow, &mut pending, &mut first_at);
                emit(ev);
            }
        }
        carry.extend_from_slice(&chunk);
        let text = take_utf8(&mut carry);
        if !text.is_empty() {
            pending.push_str(&text);
            last_at = now;
            first_at.get_or_insert(now);
        }
        if pending.len() >= FLUSH_BYTES {
            flush_output(emit, flow, &mut pending, &mut first_at);
        }
    }
    // 끝에 남은 반쪽 글자는 대체 문자로라도 보낸다 — 끝 사건보다 먼저. 보낼 차례가 남은 제목도.
    if !carry.is_empty() {
        pending.push_str(&String::from_utf8_lossy(&carry));
    }
    flush_output(emit, flow, &mut pending, &mut first_at);
    if pace.title_due {
        emit_title(table, id, &mut pace, emit);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::tests::{sh, spec, start_blocked, wait_until};
    use super::*;

    /// 기다리던 프로그램이 `state=clear` 없이 죽어 셸이 다시 앞에 서면 그 기다림은 세지 않는다(창 제목 · Dock
    /// 배지). 표의 상태는 그대로 둔다 — 세지만 않는다.
    #[test]
    fn a_wait_left_behind_by_a_dead_program_is_not_counted() {
        let sessions = TermSessions::default();
        let info = start_blocked(&sessions, "w", 3);
        sessions.write(info.id, "\x03").unwrap(); // Ctrl+C — 앞의 프로그램이 죽고 셸이 앞에 선다
        wait_until(
            || sessions.waiting_in(3) == 0,
            "셸이 앞에 섰는데 낡은 기다림을 센다",
        );
        let status = sessions.list("w")[0].status.clone();
        assert_eq!(status.map(|s| s.state).as_deref(), Some("blocked"));
        sessions.close_all();
    }

    /// 상태를 지우면(`state=clear`) 그 프로그램이 OSC 0 · 2 로 붙인 제목도 내린다 — 제목을 안 찍는 셸에서는 끝난
    /// 대화 주제가 탭 이름으로 남았다.
    #[test]
    fn clearing_the_status_takes_the_program_title_down_too() {
        let sessions = TermSessions::default();
        let info = sessions
            .start(spec("w", 1), sh("sleep 10"), "sh".into(), None, |_| {})
            .unwrap();
        let pump = |bytes: &[u8]| {
            let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(1);
            tx.send(bytes.to_vec()).unwrap();
            drop(tx);
            pump_output(&rx, &sessions.inner, info.id, &|_| {}, &Flow::new(None));
            sessions.list("w")[0].title.clone()
        };
        let working = pump(b"\x1b]0;login fix\x07\x1b]7501;state=working\x1b\\");
        assert_eq!(working.as_deref(), Some("login fix"));
        assert_eq!(pump(b"\x1b]7501;state=clear\x1b\\"), None);
        sessions.close_all();
    }

    /// SEC-03 — 프로그램이 보낸 까닭 글의 RLO · 폭 0 글자는 상태에 실리지 않는다. 그대로 실리면 OS 알림 본문
    /// `msg · 허락을 기다려요` 에서 앱의 말까지 오른쪽에서 왼쪽으로 뒤집혀 그려졌다(띠 · 탭 툴팁도 같은 글을 그린다).
    #[test]
    fn a_reported_message_is_cleaned_before_it_reaches_the_status() {
        use base64::Engine;
        let sessions = TermSessions::default();
        let info = sessions
            .start(spec("w", 1), sh("sleep 10"), "sh".into(), None, |_| {})
            .unwrap();
        let msg = base64::engine::general_purpose::STANDARD
            .encode("\u{202E}approve Read: \u{200B}notes.md");
        let report = format!("\x1b]7501;state=blocked:kind=permission:msg={msg}\x1b\\");
        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(1);
        tx.send(report.into_bytes()).unwrap();
        drop(tx);
        pump_output(&rx, &sessions.inner, info.id, &|_| {}, &Flow::new(None));
        let status = sessions.list("w")[0].status.clone().unwrap();
        assert_eq!(status.msg.as_deref(), Some("approve Read: notes.md"));
        sessions.close_all();
    }
}

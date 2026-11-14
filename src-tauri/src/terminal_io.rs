//! 앱 안 터미널의 PTY 입출력 — 쓰기 줄 · 닫기 · 출력 흐름 제어. `terminal.rs` 가 800줄을 넘지 않게 떼어
//! 냈다(2026-11-15).
//!
//! # 쓰기 ([`Input`])
//!
//! 예전에는 `term_write` 가 앱 전체가 함께 쓰는 세션 표 잠금을 쥔 채 PTY 에 `write_all` 했고, 그 명령은 메인
//! 스레드에서 돌았다. 빌드 중인 칸에 긴 붙여넣기를 하면 커널 버퍼가 차서 쓰기가 막히고, 그동안 모든 창의 키
//! 입력 · 크기 바꾸기 · 상태 반영이 함께 섰다(Ctrl+C 도 같은 길이었다). 이제 세션마다 쓰기 스레드가 writer 를
//! 갖고, 쓰기는 큐에 넣고 곧장 돌아온다. 명령은 여전히 동기라 키 순서는 그대로다(동기 명령은 차례로 돈다).
//!
//! # 닫기 ([`reap`])
//!
//! portable-pty 의 `kill` 은 SIGHUP 뒤 최대 200ms 를 기다렸다가 SIGKILL 한다 — 그것을 메인 스레드에서 세션마다
//! 잤다. 이제 표에서 빼자마자 돌아오고 죽이기 · 거두기는 따로 돈다(거두지 않던 좀비도 남기지 않는다).
//!
//! # 출력 흐름 ([`Flow`])
//!
//! Tauri 의 Channel 송신은 웹뷰가 밀려도 막히지 않는다 — `yes` · 큰 `cat` 에서 웹뷰 메모리가 붓고, xterm 은
//! 대기 50MB 를 넘으면 출력을 버린다. 웹뷰가 그린 만큼 알려 오면(`term_ack`) 그만큼만 더 보낸다: 안 그린 것이
//! [`HIGH`] 를 넘으면 [`LOW`] 까지 기다리고, 그동안 읽기가 서서 커널 PTY 버퍼가 생산자를 멈춘다.

use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use portable_pty::{Child, MasterPty};

/// 쓰기 대기가 이만큼을 넘으면 큰 쓰기(붙여넣기)는 더 받지 않는다 — 프런트가 「바빠요」 토스트를 띄운다.
pub(super) const MAX_PENDING: usize = 1024 * 1024;
/// 대기가 넘쳐도 받는 쓰기 — 키 하나 · 짧은 조합. 버리지 않고 순서대로 뒤에 선다(Ctrl+C 를 잃지 않게).
const KEY_BYTES: usize = 64;
/// 대기가 넘쳤다는 오류 — 명령이 `terminal_busy` 로 바꾼다.
pub const BUSY: &str = "busy";

/// 세션 하나의 쓰기 줄 — 보내는 쪽만 들고, writer 는 쓰기 스레드가 갖는다. 마지막 보내는 쪽이 사라지면
/// (세션을 표에서 뺐다) 남은 것을 다 쓰고 스레드가 끝난다.
pub(super) struct Input {
    tx: mpsc::Sender<Vec<u8>>,
    pending: Arc<AtomicUsize>,
}

impl Input {
    pub(super) fn spawn(id: u32, mut writer: Box<dyn Write + Send>) -> Result<Input, String> {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let pending = Arc::new(AtomicUsize::new(0));
        let left = pending.clone();
        std::thread::Builder::new()
            .name(format!("term-{id}-write"))
            .spawn(move || {
                for chunk in rx {
                    let ok = writer.write_all(&chunk).and_then(|()| writer.flush());
                    left.fetch_sub(chunk.len(), Ordering::SeqCst);
                    if ok.is_err() {
                        break; // PTY 가 닫혔다 — 남은 것은 쓸 곳이 없다
                    }
                }
            })
            .map_err(|e| format!("thread: {e}"))?;
        Ok(Input { tx, pending })
    }

    /// 큐에 넣고 곧장 돌아온다. 대기가 [`MAX_PENDING`] 을 넘었으면 큰 쓰기는 [`BUSY`].
    pub(super) fn send(&self, bytes: Vec<u8>) -> Result<(), String> {
        let n = bytes.len();
        if n == 0 {
            return Ok(());
        }
        if n > KEY_BYTES && self.pending.load(Ordering::SeqCst) > MAX_PENDING {
            return Err(BUSY.to_string());
        }
        self.pending.fetch_add(n, Ordering::SeqCst);
        self.tx.send(bytes).map_err(|_| {
            self.pending.fetch_sub(n, Ordering::SeqCst);
            "session ended".to_string()
        })
    }
}

/// 크기 바꾸기 · 포그라운드 그룹 묻기가 표 잠금 밖에서 쓰는 PTY 마스터.
pub(super) type SharedMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;

type Reaped = (Box<dyn Child + Send + Sync>, SharedMaster);

/// 세션의 자식을 죽이고 거둔 뒤 PTY 를 닫는다 — 따로 도는 스레드에서. 스레드를 못 띄우면 여기서 한다.
pub(super) fn reap(
    id: u32,
    child: Box<dyn Child + Send + Sync>,
    master: SharedMaster,
) -> Option<JoinHandle<()>> {
    fn finish(slot: &Mutex<Option<Reaped>>) {
        let taken = slot.lock().ok().and_then(|mut s| s.take());
        if let Some((mut child, master)) = taken {
            let _ = child.kill();
            let _ = child.wait();
            drop(master);
        }
    }
    let slot = Arc::new(Mutex::new(Some((child, master))));
    let theirs = slot.clone();
    let spawned = std::thread::Builder::new()
        .name(format!("term-{id}-reap"))
        .spawn(move || finish(&theirs));
    if spawned.is_err() {
        finish(&slot);
    }
    spawned.ok()
}

/// 앱을 끌 때만 — 거두기를 이만큼까지 기다린다. `kill` 의 SIGHUP 유예(200ms) 뒤 SIGKILL 까지 닿게 조금 넉넉히:
/// HUP 를 무시하는 프로그램도 고아로 남기지 않고, 세션이 몇이든 끄기가 늦어지는 것은 이 한 번뿐이다.
pub(super) const SHUTDOWN_WAIT: Duration = Duration::from_millis(300);

/// 거두기 스레드들이 끝나기를 `limit` 까지 기다린다.
pub(super) fn join_until(handles: Vec<JoinHandle<()>>, limit: Duration) {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline && handles.iter().any(|h| !h.is_finished()) {
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// 웹뷰가 아직 안 그린 출력이 이만큼을 넘으면 읽기를 멈춘다 — 창이 앞에 있을 때.
pub(super) const HIGH: u64 = 256 * 1024;
/// 창이 뒤에 있으면 — 가려진 웹뷰는 타이머가 늦게 돌아 알림이 늦다. 뒤에서 도는 빌드가 서지 않게 넉넉히.
pub(super) const HIGH_BACK: u64 = 4 * 1024 * 1024;
/// 멈췄으면 이만큼 아래로 내려올 때 다시 읽는다.
pub(super) const LOW: u64 = 32 * 1024;
/// 알림이 이만큼 안 오면 스스로 푼다 — 웹뷰가 다시 그려졌거나(알림이 끊김) 아주 늦어도 영영 서지 않게.
pub(super) const HOLD_MAX: Duration = Duration::from_secs(2);
/// 창이 앞인지 다시 묻는 간격 — 묻기는 메인 스레드를 한 번 오간다.
const FRONT_TTL: Duration = Duration::from_millis(500);

/// 그 세션의 창이 앞에 있는가 — `term_open` 이 넘긴다. 없으면(시험) 늘 앞.
pub type FrontFn = Box<dyn Fn() -> bool + Send + Sync>;

impl super::TermSessions {
    /// 웹뷰가 그 세션의 출력을 `bytes` 만큼 그렸다(`term_ack`) — 기다리던 출력 스레드가 다시 읽는다.
    pub fn ack(&self, id: u32, bytes: u32) {
        let flow = self
            .inner
            .lock()
            .ok()
            .and_then(|t| t.map.get(&id).map(|s| s.flow.clone()));
        if let Some(flow) = flow {
            flow.ack(u64::from(bytes));
        }
    }
}

/// 세션 하나의 출력 흐름 — 보냈지만 웹뷰가 아직 그렸다고 알리지 않은 바이트.
pub(super) struct Flow {
    unacked: Mutex<u64>,
    cv: Condvar,
    front: Option<FrontFn>,
    front_seen: Mutex<Option<(Instant, bool)>>,
}

impl Flow {
    pub(super) fn new(front: Option<FrontFn>) -> Flow {
        Flow {
            unacked: Mutex::new(0),
            cv: Condvar::new(),
            front,
            front_seen: Mutex::new(None),
        }
    }

    pub(super) fn sent(&self, n: usize) {
        if let Ok(mut u) = self.unacked.lock() {
            *u += n as u64;
        }
    }

    /// 웹뷰가 그린 만큼 — 기다리던 펌프가 있으면 깨운다.
    pub(super) fn ack(&self, n: u64) {
        if let Ok(mut u) = self.unacked.lock() {
            *u = u.saturating_sub(n);
            if *u <= LOW {
                self.cv.notify_all();
            }
        }
    }

    fn unacked(&self) -> u64 {
        self.unacked.lock().map(|u| *u).unwrap_or(0)
    }

    fn front(&self) -> bool {
        let Some(ask) = &self.front else { return true };
        let now = Instant::now();
        if let Ok(seen) = self.front_seen.lock() {
            if let Some((at, front)) = *seen {
                if now.duration_since(at) < FRONT_TTL {
                    return front;
                }
            }
        }
        let front = ask();
        if let Ok(mut seen) = self.front_seen.lock() {
            *seen = Some((now, front));
        }
        front
    }

    /// 펌프가 다음 조각을 읽기 전에 — 웹뷰가 밀렸으면 [`LOW`] 까지 기다린다. [`HOLD_MAX`] 가 지나면 셈을 비우고
    /// 그대로 간다(늦게 온 알림은 0 아래로 내려가지 않는다). 창이 앞인지는 잠금 밖에서 묻는다 — 묻기는 메인
    /// 스레드를 오가고, 메인 스레드의 `term_ack` 가 이 잠금을 기다린다.
    pub(super) fn hold(&self) {
        if self.unacked() <= HIGH {
            return;
        }
        let high = if self.front() { HIGH } else { HIGH_BACK };
        let Ok(guard) = self.unacked.lock() else {
            return;
        };
        if *guard <= high {
            return;
        }
        let (mut guard, waited) = match self.cv.wait_timeout_while(guard, HOLD_MAX, |u| *u > LOW) {
            Ok(pair) => pair,
            Err(poisoned) => poisoned.into_inner(),
        };
        if waited.timed_out() {
            *guard = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::output::{pump_output, FLUSH_BYTES};
    #[cfg(unix)]
    use super::super::tests::{sh, spec, wait_until};
    #[cfg(unix)]
    use super::super::TermSessions;
    use super::super::{Inner, TermEvent};
    use super::*;

    /// 읽지 않는 자식에 큰 붙여넣기를 해도 — 그 쓰기도, 다른 세션의 쓰기 · 목록도 곧장 돌아온다. 예전에는
    /// 앱 전체의 표 잠금을 쥔 채 PTY 에 쓰다가 커널 버퍼가 차면 그 자리에서 섰다(메인 스레드째).
    #[cfg(unix)]
    #[test]
    fn a_session_that_does_not_read_does_not_stall_the_others() {
        let sessions = TermSessions::default();
        let deaf_cmd = sh("stty raw -echo; sleep 5");
        let deaf = sessions
            .start(spec("w", 1), deaf_cmd, "sh".into(), None, |_| {})
            .unwrap();
        let other_cmd = sh("exec cat > /dev/null");
        let other = sessions
            .start(spec("w", 1), other_cmd, "sh".into(), None, |_| {})
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let paste = "x".repeat(64 * 1024);
        let t = Instant::now();
        sessions.write(deaf.id, &paste).unwrap();
        assert!(t.elapsed() < Duration::from_millis(10), "{:?}", t.elapsed());
        // 한 번의 스케줄링 흔들림은 봐준다(빌드가 같은 기계에서 돈다) — 셋 중 가장 빠른 것이 10ms 안.
        // 예전 길이었다면 셋 다 자식이 끝날 때(5초)까지 섰다.
        let mut best = Duration::MAX;
        for _ in 0..3 {
            let t = Instant::now();
            sessions.write(other.id, "abc\n").unwrap();
            assert_eq!(sessions.list("w").len(), 2);
            best = best.min(t.elapsed());
            assert!(
                t.elapsed() < Duration::from_millis(500),
                "{:?}",
                t.elapsed()
            );
        }
        assert!(best < Duration::from_millis(10), "{best:?}");
        sessions.close_all();
    }

    /// 대기가 넘치면 큰 쓰기는 `BUSY` — 키 하나는 그래도 받아 순서대로 뒤에 세운다(Ctrl+C 를 잃지 않게).
    #[cfg(unix)]
    #[test]
    fn a_full_queue_refuses_pastes_but_still_takes_keys() {
        let sessions = TermSessions::default();
        let deaf = sessions
            .start(
                spec("w", 1),
                sh("stty raw -echo; sleep 5"),
                "sh".into(),
                None,
                |_| {},
            )
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        sessions
            .write(deaf.id, &"x".repeat(MAX_PENDING + 1))
            .unwrap();
        assert_eq!(
            sessions.write(deaf.id, &"y".repeat(100)),
            Err(BUSY.to_string())
        );
        assert_eq!(sessions.write(deaf.id, "\x03"), Ok(()));
        sessions.close_all();
    }

    /// HUP 를 무시하는 자식 — 닫기는 곧장 돌아오고(예전에는 메인 스레드에서 200ms 를 잤다), 거두기 스레드가
    /// 유예 뒤 SIGKILL 하고 거둔다.
    #[cfg(unix)]
    #[test]
    fn closing_a_session_that_ignores_hangup_returns_at_once_and_still_ends_it() {
        let sessions = TermSessions::default();
        let cmd = sh("trap '' HUP; exec sleep 30");
        let info = sessions
            .start(spec("w", 1), cmd, "sh".into(), None, |_| {})
            .unwrap();
        let pid = {
            let inner = sessions.inner.lock().unwrap();
            inner.map[&info.id].child.process_id().unwrap() as i32
        };
        std::thread::sleep(Duration::from_millis(300)); // trap 과 exec 가 자리를 잡게
        let t = Instant::now();
        sessions.close(info.id);
        assert!(t.elapsed() < Duration::from_millis(10), "{:?}", t.elapsed());
        assert!(sessions.list("w").is_empty());
        // SAFETY: 신호 0 은 보내지 않고 그 pid 가 아직 있는지(거두기 전의 좀비 포함)만 묻는다.
        wait_until(
            || unsafe { libc::kill(pid, 0) } != 0,
            "HUP 를 무시한 자식이 끝내 죽지 않았다",
        );
    }

    /// 쓰기 줄은 순서를 지킨다 — 천 번 쓴 줄이 cat 에게 그 차례대로 닿는다.
    #[cfg(unix)]
    #[test]
    fn a_thousand_writes_reach_the_program_in_order() {
        let sessions = TermSessions::default();
        let (tx, rx) = mpsc::channel::<TermEvent>();
        let cmd = sh("stty -echo; printf 'ready\\n'; exec cat");
        let info = sessions
            .start(spec("w", 1), cmd, "sh".into(), None, move |e| {
                let _ = tx.send(e);
            })
            .unwrap();
        let mut out = String::new();
        let mut read_until = |want: &str| {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !out.contains(want) && Instant::now() < deadline {
                if let Ok(TermEvent::Output { data, .. }) =
                    rx.recv_timeout(Duration::from_millis(100))
                {
                    out.push_str(&data);
                }
            }
            assert!(out.contains(want), "출력: {out:?}");
            out.clone()
        };
        read_until("ready");
        for i in 0..1000 {
            sessions.write(info.id, &format!("{i}\n")).unwrap();
        }
        let out = read_until("999\r\n");
        let got: Vec<u32> = out.lines().filter_map(|l| l.trim().parse().ok()).collect();
        assert_eq!(got, (0..1000).collect::<Vec<u32>>());
        sessions.close_all();
    }

    /// 웹뷰가 그렸다고 알리지 않으면 펌프는 `HIGH` 를 조금 넘긴 데서 서고, 알리면 다시 흐르고, 끝내 안 와도
    /// `HOLD_MAX` 뒤에는 스스로 푼다(창이 가려져 웹뷰 타이머가 늦어도 영영 서지 않게).
    #[test]
    fn the_pump_stops_at_high_until_acked_and_frees_itself_after_hold_max() {
        let table: Arc<Mutex<Inner>> = Arc::default();
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
        let flow = Arc::new(Flow::new(None));
        let sent = Arc::new(AtomicUsize::new(0));
        let producer = std::thread::spawn(move || {
            let chunk = vec![b'x'; 8192];
            for _ in 0..512 {
                if tx.send(chunk.clone()).is_err() {
                    break;
                }
            }
        });
        let (f, s) = (flow.clone(), sent.clone());
        let pump = std::thread::spawn(move || {
            let emit = |ev: TermEvent| {
                if let TermEvent::Output { n, .. } = ev {
                    s.fetch_add(n as usize, Ordering::SeqCst);
                }
            };
            pump_output(&rx, &table, 1, &emit, &f);
        });
        let settle = || std::thread::sleep(Duration::from_millis(300));
        settle();
        let stalled = sent.load(Ordering::SeqCst);
        let ceiling = HIGH as usize + FLUSH_BYTES + 8192;
        assert!(stalled > HIGH as usize && stalled <= ceiling, "{stalled}");
        settle();
        assert_eq!(
            sent.load(Ordering::SeqCst),
            stalled,
            "알림 없이는 더 보내지 않는다"
        );

        flow.ack(stalled as u64);
        settle();
        let resumed = sent.load(Ordering::SeqCst);
        assert!(resumed > stalled, "알림이 오면 다시 흐른다");
        assert!(resumed <= stalled + ceiling, "{resumed}");

        std::thread::sleep(HOLD_MAX + Duration::from_millis(500));
        assert!(
            sent.load(Ordering::SeqCst) > resumed,
            "HOLD_MAX 뒤에는 스스로 푼다"
        );

        let deadline = Instant::now() + Duration::from_secs(20);
        while !pump.is_finished() && Instant::now() < deadline {
            flow.ack(u64::MAX);
            std::thread::sleep(Duration::from_millis(5));
        }
        producer.join().unwrap();
        pump.join().unwrap();
        assert_eq!(sent.load(Ordering::SeqCst), 512 * 8192, "버린 출력은 없다");
    }
}

//! Linux single-instance 의 폴백 잠금 (크로스플랫폼 라운드 `#os-single-instance-dbus`).
//!
//! `tauri-plugin-single-instance` 는 Linux 에서 **세션 D-Bus** 로 두 번째 인스턴스를
//! 가른다 — 이름(`<식별자>.SingleInstance`)을 잡으면 첫 인스턴스, 이미 잡혀 있으면
//! 인자를 넘기고 끝난다. 그런데 버스에 못 붙으면(세션 버스 없는 최소 설치 · SSH X
//! 포워딩 · 일부 컨테이너 · 세션 매니저 없는 창 관리자) 연결 오류를 **조용히
//! 삼키고** 넘어간다 (2.4.4 `platform_impl/linux.rs` 의 `_ => {}`). 그러면 앱이 두
//! 번 뜨고, 뒤에 뜬 쪽이 기동 때 앞의 것에게서 프로젝트 락을 전부 뺏는다
//! (`Cargo.toml` 의 single-instance 주석 · 감사 E4).
//!
//! 그래서 D-Bus 와 **상관없이** 앱 데이터 폴더의 잠금 파일에 배타 잠금(flock)을 건다:
//!
//! - 버스가 살아 있으면 두 번째 인스턴스는 플러그인이 먼저 끝낸다 — 여기까지 오지
//!   않는다. 잠금은 첫 인스턴스가 쥐고만 있다.
//! - 버스가 없으면 두 번째 인스턴스가 여기서 잠금에 실패하고, 이유를 로그에 남긴 뒤
//!   끝난다.
//!
//! **한계:** D-Bus 없이는 두 번째 인스턴스의 인자 — 딥링크(`oculpm://…`)와 "기존 창을
//! 앞으로" — 를 첫 인스턴스에 **전달하지 못한다.** 두 번째 인스턴스는 링크를 로그에
//! 남기고 그냥 끝난다.
//!
//! flock 은 프로세스가 죽으면 커널이 푼다 — 비정상 종료 뒤에 남는 잠금이 없다. Rust 의
//! `File` 은 `O_CLOEXEC` 로 열리므로 PTY 호스트 같은 자식에게 잠금이 새지 않는다.
//! 업데이터 재시작은 새 프로세스를 먼저 띄우고 옛 프로세스가 끝나므로, 잠금이 잡혀
//! 있으면 [`RETRY_FOR`] 동안 다시 시도한다.
//!
//! 배선은 Linux 에서만 한다 (`lib.rs` 의 single-instance 자리). macOS·Windows 는 플러그인이
//! OS 기본 수단(NSDistributedNotification · 이름 있는 뮤텍스)을 쓰므로 경로 불변이다.
//! 잠금·주소 해석은 순수해서 세 OS 에서 모두 테스트한다.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 앱 데이터 폴더 안의 잠금 파일 이름.
pub const LOCK_FILE: &str = "instance.lock";

/// 잠금이 잡혀 있을 때 다시 시도하는 시간 — 업데이터 재시작이 옛 프로세스의 종료와
/// 겹치는 틈. 두 번째 인스턴스는 그만큼 늦게 끝날 뿐이다.
pub const RETRY_FOR: Duration = Duration::from_secs(3);
const RETRY_EVERY: Duration = Duration::from_millis(100);

#[derive(Debug)]
pub enum Acquire {
    /// 이 프로세스가 잠금을 쥐었다. `File` 이 살아 있는 동안 유지된다.
    Held(File),
    /// 다른 프로세스가 쥐고 있다. 잠금 파일에 적힌 그 프로세스의 pid (읽혔으면).
    Busy { holder: Option<u32> },
    /// 잠금 자체를 못 건다(폴더 권한 · 잠금 미지원 파일 시스템) — 막지 않고 뜬다.
    Unavailable(std::io::Error),
}

/// `dir/instance.lock` 에 배타 잠금을 건다. 잡혀 있으면 `retry_for` 동안 다시 본다.
pub fn try_acquire(dir: &Path, retry_for: Duration) -> Acquire {
    if let Err(e) = std::fs::create_dir_all(dir) {
        return Acquire::Unavailable(e);
    }
    // truncate 하지 않는다 — 잡혀 있으면 쥔 쪽의 pid 를 읽어야 한다.
    let mut file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(LOCK_FILE))
    {
        Ok(f) => f,
        Err(e) => return Acquire::Unavailable(e),
    };
    let start = Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => {
                // 진단용 — 두 번째 인스턴스가 "누가 쥐고 있나" 를 로그에 남긴다.
                let _ = file.set_len(0);
                let _ = file.seek(SeekFrom::Start(0));
                let _ = write!(file, "{}", std::process::id());
                let _ = file.flush();
                return Acquire::Held(file);
            }
            Err(TryLockError::WouldBlock) if start.elapsed() < retry_for => {
                std::thread::sleep(RETRY_EVERY);
            }
            Err(TryLockError::WouldBlock) => {
                let mut text = String::new();
                let _ = file.seek(SeekFrom::Start(0));
                let _ = file.read_to_string(&mut text);
                return Acquire::Busy {
                    holder: text.trim().parse().ok(),
                };
            }
            Err(TryLockError::Error(e)) => return Acquire::Unavailable(e),
        }
    }
}

// ── 세션 D-Bus 에 닿는가 ───────────────────────────────────────────────────

/// 세션 버스 주소 하나를 어떻게 두드려 볼 수 있나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BusTarget {
    /// `unix:path=…` — 파일 시스템의 소켓.
    Path(PathBuf),
    /// `unix:abstract=…` — Linux 추상 소켓 이름.
    Abstract(String),
    /// tcp·launchd·autolaunch 등 — 여기서 두드려 보지 않는다(모름으로 둔다).
    Other(String),
}

/// 세션 버스 주소 후보 — `zbus::Address::session()` 과 같은 규칙이다(플러그인이 그걸
/// 쓴다): `DBUS_SESSION_BUS_ADDRESS` 가 있으면 그것(`;` 로 여럿), 없으면
/// `$XDG_RUNTIME_DIR/bus`, 그것도 없으면 `/run/user/<uid>/bus`.
pub fn session_bus_targets(
    env_address: Option<&str>,
    runtime_dir: Option<&str>,
    uid: u32,
) -> Vec<BusTarget> {
    let Some(address) = env_address.filter(|a| !a.trim().is_empty()) else {
        let dir = runtime_dir
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(format!("/run/user/{uid}")));
        return vec![BusTarget::Path(dir.join("bus"))];
    };
    address
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            let (transport, params) = entry.split_once(':').unwrap_or((entry, ""));
            let value = |key: &str| {
                params.split(',').find_map(|kv| {
                    let (k, v) = kv.split_once('=')?;
                    (k == key).then(|| crate::text::percent_decode(v))
                })
            };
            if transport != "unix" {
                return BusTarget::Other(transport.to_string());
            }
            if let Some(path) = value("path") {
                BusTarget::Path(PathBuf::from(path))
            } else if let Some(name) = value("abstract") {
                BusTarget::Abstract(name)
            } else {
                BusTarget::Other(entry.to_string())
            }
        })
        .collect()
}

/// 두드려 본 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BusProbe {
    Reachable,
    /// 두드려 본 주소 전부가 연결을 거절했다 — 플러그인도 못 붙는다.
    Unreachable(String),
    /// 두드려 볼 수 없는 주소만 있다 — 경고하지 않는다.
    Unknown,
}

/// 이 프로세스의 환경에서 세션 버스에 소켓 연결이 되는가. 인증·이름 요청까지는 하지
/// 않는다 — "버스가 아예 없다" 를 잡는 것이 목적이다.
#[cfg(target_os = "linux")]
pub fn probe_session_bus() -> BusProbe {
    let env = std::env::var("DBUS_SESSION_BUS_ADDRESS").ok();
    let runtime = std::env::var("XDG_RUNTIME_DIR").ok();
    // SAFETY: 인자 없는 시스템 호출이고 실패하지 않는다.
    let uid = unsafe { libc::geteuid() };
    probe_targets(&session_bus_targets(
        env.as_deref(),
        runtime.as_deref(),
        uid,
    ))
}

/// 후보 하나라도 연결되면 닿는다. 두드릴 수 없는 후보만 남으면 모름.
#[cfg(target_os = "linux")]
pub fn probe_targets(targets: &[BusTarget]) -> BusProbe {
    use std::os::linux::net::SocketAddrExt;
    use std::os::unix::net::{SocketAddr, UnixStream};

    let mut tried = Vec::new();
    let mut unknown = false;
    for target in targets {
        let connected = match target {
            BusTarget::Path(path) => UnixStream::connect(path).is_ok(),
            BusTarget::Abstract(name) => SocketAddr::from_abstract_name(name.as_bytes())
                .and_then(|addr| UnixStream::connect_addr(&addr))
                .is_ok(),
            BusTarget::Other(_) => {
                unknown = true;
                continue;
            }
        };
        if connected {
            return BusProbe::Reachable;
        }
        tried.push(format!("{target:?}"));
    }
    if unknown {
        BusProbe::Unknown
    } else {
        BusProbe::Unreachable(tried.join(" · "))
    }
}

// ── 배선 (Linux) ──────────────────────────────────────────────────────────

/// 잠금 파일 핸들 — 앱이 끝날 때까지 쥐고 있는다.
#[cfg(target_os = "linux")]
struct InstanceLock(#[allow(dead_code)] File);

/// single-instance 플러그인 **바로 뒤에** 등록하는 플러그인. 플러그인 setup 은 등록
/// 순서대로, 설정 파일의 창을 만들기 **전에** 돈다 — 두 번째 인스턴스가 창을 한 번
/// 번쩍 띄우고 사라지지 않는다 (앱의 `.setup` 은 창을 만든 뒤라 늦다).
#[cfg(target_os = "linux")]
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("instance-lock")
        .setup(|app, _api| {
            enforce(app);
            Ok(())
        })
        .build()
}

#[cfg(target_os = "linux")]
fn enforce<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;

    let bus = probe_session_bus();
    if let BusProbe::Unreachable(tried) = &bus {
        tracing::warn!(
            target: "oculpm::boot",
            tried = %tried,
            "[FLOW] 세션 D-Bus 에 닿지 않는다 — single-instance 플러그인이 꺼진 채다. \
             잠금 파일로 두 번째 인스턴스를 막는다 (딥링크·창 앞으로 전달은 안 된다)"
        );
    }
    let Some(dir) = crate::app_dirs::app_data_dir() else {
        tracing::warn!(target: "oculpm::boot", "[FLOW] 앱 데이터 폴더를 못 구해 인스턴스 잠금을 건너뛴다");
        return;
    };
    match try_acquire(&dir, RETRY_FOR) {
        Acquire::Held(file) => {
            app.manage(InstanceLock(file));
        }
        Acquire::Busy { holder } => {
            let argv: Vec<String> = std::env::args().collect();
            let links = crate::deeplink::links_in_argv(&argv);
            tracing::warn!(
                target: "oculpm::boot",
                holder = ?holder,
                bus = ?bus,
                dropped_links = ?links,
                "[FLOW] 이미 떠 있는 인스턴스가 잠금을 쥐고 있다 — 이 프로세스는 끝난다. \
                 D-Bus 가 없어 인자(딥링크)를 첫 인스턴스에 넘기지 못했다"
            );
            eprintln!(
                "ocul-pm is already running (pid {}). Without a D-Bus session bus the second \
                 instance cannot hand its arguments over — exiting.",
                holder.map_or_else(|| "?".to_string(), |p| p.to_string())
            );
            // 로그 파일은 non-blocking 작성기라 곧장 끝내면 마지막 줄이 사라진다.
            std::thread::sleep(Duration::from_millis(300));
            app.cleanup_before_exit();
            std::process::exit(0);
        }
        Acquire::Unavailable(e) => {
            tracing::warn!(
                target: "oculpm::boot",
                error = %e,
                path = %dir.join(LOCK_FILE).display(),
                "[FLOW] 인스턴스 잠금을 못 걸었다 — 막지 않고 뜬다"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(a: Acquire) -> File {
        match a {
            Acquire::Held(f) => f,
            other => panic!("잠금을 쥐어야 한다: {other:?}"),
        }
    }

    /// 두 번째 인스턴스 — 첫 번째가 쥔 동안은 잡지 못하고, 쥔 쪽의 pid 를 읽는다.
    #[test]
    fn second_acquire_is_busy_while_the_first_holds() {
        let dir = tempfile::tempdir().unwrap();
        let first = held(try_acquire(dir.path(), Duration::ZERO));
        match try_acquire(dir.path(), Duration::ZERO) {
            Acquire::Busy { holder } => assert_eq!(holder, Some(std::process::id())),
            other => panic!("잡혀 있어야 한다: {other:?}"),
        }
        drop(first);
        held(try_acquire(dir.path(), Duration::ZERO));
    }

    /// 업데이터 재시작 — 옛 프로세스가 곧 놓으면 새 프로세스는 기다렸다가 잡는다.
    #[test]
    fn a_lock_released_within_the_retry_window_is_taken() {
        let dir = tempfile::tempdir().unwrap();
        let first = held(try_acquire(dir.path(), Duration::ZERO));
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(first);
        });
        held(try_acquire(dir.path(), Duration::from_secs(5)));
        releaser.join().unwrap();
    }

    /// 앱 데이터 폴더가 아직 없어도(첫 실행) 만들고 잡는다.
    #[test]
    fn creates_the_data_dir_on_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b");
        held(try_acquire(&nested, Duration::ZERO));
        assert!(nested.join(LOCK_FILE).is_file());
    }

    /// 잠금을 못 거는 자리(폴더 자리에 파일)는 막지 않는다 — Unavailable 로 뜬다.
    #[test]
    fn an_unusable_dir_is_unavailable_not_busy() {
        let dir = tempfile::tempdir().unwrap();
        let file_in_the_way = dir.path().join("x");
        std::fs::write(&file_in_the_way, b"").unwrap();
        assert!(matches!(
            try_acquire(&file_in_the_way, Duration::ZERO),
            Acquire::Unavailable(_)
        ));
    }

    #[test]
    fn bus_address_follows_zbus_rules() {
        // 환경변수 없음 → XDG_RUNTIME_DIR/bus → /run/user/<uid>/bus
        assert_eq!(
            session_bus_targets(None, Some("/run/user/1000"), 1000),
            vec![BusTarget::Path("/run/user/1000/bus".into())]
        );
        assert_eq!(
            session_bus_targets(None, None, 1001),
            vec![BusTarget::Path("/run/user/1001/bus".into())]
        );
        assert_eq!(
            session_bus_targets(Some("  "), Some(""), 7),
            vec![BusTarget::Path("/run/user/7/bus".into())]
        );
        // 명시 주소 — path · abstract(guid 가 붙는다) · 여럿 · 두드릴 수 없는 것.
        assert_eq!(
            session_bus_targets(Some("unix:path=/run/user/1000/bus"), None, 0),
            vec![BusTarget::Path("/run/user/1000/bus".into())]
        );
        assert_eq!(
            session_bus_targets(
                Some("unix:abstract=/tmp/dbus-AbC,guid=0123;tcp:host=localhost,port=1"),
                None,
                0
            ),
            vec![
                BusTarget::Abstract("/tmp/dbus-AbC".into()),
                BusTarget::Other("tcp".into())
            ]
        );
        assert_eq!(
            session_bus_targets(Some("unix:path=/tmp/with%20space"), None, 0),
            vec![BusTarget::Path("/tmp/with space".into())]
        );
    }

    /// 아무도 듣지 않는 소켓 경로 — 버스가 없는 세션을 흉내 낸다 (Linux 러너).
    #[cfg(target_os = "linux")]
    #[test]
    fn probe_sees_a_missing_bus_and_a_listening_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bus");
        let targets = vec![BusTarget::Path(path.clone())];
        assert!(matches!(probe_targets(&targets), BusProbe::Unreachable(_)));
        // 듣는 소켓이 생기면 닿는다.
        let _listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        assert_eq!(probe_targets(&targets), BusProbe::Reachable);
        // 두드릴 수 없는 주소만 있으면 경고하지 않는다(모름).
        assert_eq!(
            probe_targets(&[BusTarget::Other("tcp".into())]),
            BusProbe::Unknown
        );
        // 추상 소켓도 같은 규칙 — 아무도 안 듣는 이름은 닿지 않는다.
        let name = format!("oculpm-test-{}", std::process::id());
        assert!(matches!(
            probe_targets(&[BusTarget::Abstract(name)]),
            BusProbe::Unreachable(_)
        ));
    }
}

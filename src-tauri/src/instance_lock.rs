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
//! **주소를 못 읽으면 플러그인이 패닉한다** (`#os-dbus-addr-panic`). 같은 파일의 setup 은
//! `zbus::blocking::connection::Builder::session().unwrap()` 으로 시작한다 — 연결 오류는
//! 삼키지만 **주소 해석 오류는 `unwrap` 이 기동 중 패닉으로 바꾼다.** `DBUS_SESSION_BUS_ADDRESS`
//! 가 zbus 가 못 읽는 값(빈 문자열 · 오타 · 모르는 전송)이거나, 그 변수가 없고
//! `XDG_RUNTIME_DIR` 에 쉼표가 있으면 그렇다. 그래서 등록 전에 [`session_address_problem`]
//! 으로 zbus 의 규칙을 미리 대 보고, 못 읽을 주소면 플러그인을 건너뛰고 잠금 파일만 쓴다.
//!
//! 배선은 [`register`] 한 곳이다 (`lib.rs` 의 single-instance 자리). 폴백 잠금과 주소 검사는
//! Linux 에서만 한다 — macOS·Windows 는 플러그인이 OS 기본 수단(NSDistributedNotification ·
//! 이름 있는 뮤텍스)을 쓰므로 경로 불변이다. 잠금·주소 해석은 순수해서 세 OS 에서 모두
//! 테스트한다.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashMap;
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

// ── zbus 가 이 주소를 읽는가 ──────────────────────────────────────────────

/// 이 환경에서 `zbus::Address::session()` 이 **오류를 내는가** — 내면 그 이유. single-instance
/// 2.4.4 는 그 결과를 `unwrap` 하므로 오류 = 기동 중 패닉이다 (`#os-dbus-addr-panic`).
///
/// zbus 5 의 규칙 그대로다 (5.15~5.19 `address/mod.rs` 의 `session`): 변수가 있으면(빈 문자열
/// 이어도) 그 값을, 없으면(또는 UTF-8 이 아니면) `unix:path=$XDG_RUNTIME_DIR/bus` 를 읽는다.
/// `XDG_RUNTIME_DIR` 도 없으면 `/run/user/<uid>/bus` 라 늘 읽힌다. 두 인자는
/// `std::env::var(..).ok()` 모양이다.
pub fn session_address_problem(
    env_address: Option<&str>,
    runtime_dir: Option<&str>,
) -> Option<String> {
    match (env_address, runtime_dir) {
        (Some(address), _) => zbus_address_problem(address),
        (None, Some(dir)) => zbus_address_problem(&format!("unix:path={dir}/bus")),
        (None, None) => None,
    }
}

/// 주소 하나를 zbus 5 의 `Address::from_str` 규칙으로 읽어 본다 (Linux 빌드 기준).
///
/// 문법은 그대로 옮겼다: `<전송>:<키>=<값>,…` — 전송은 첫 `:` 앞 한 글자 이상, 키는 ASCII
/// 영숫자, 값은 쉼표 아닌 한 글자 이상. zbus 는 `;` 로 가르지 **않는다** — 여러 주소는 첫
/// 값에 통째로 붙는다(읽히기는 한다).
///
/// 받는 전송은 **좁게** 잡는다 — `unix`(path·abstract·dir·tmpdir 중 정확히 하나)와
/// `tcp`·`nonce-tcp` 만. zbus 가 받는 `unixexec`·`ibus`·`vsock` 도 여기서는 모름 = 문제로
/// 친다. 틀리는 방향이 한쪽뿐이어야 한다: 받는 주소를 문제로 치면 두 번째 인스턴스의 인자
/// 전달만 잃지만(잠금은 그대로), 못 받는 주소를 괜찮다고 하면 앱이 뜨지 않는다.
pub fn zbus_address_problem(address: &str) -> Option<String> {
    let Some((transport, options)) = address.split_once(':') else {
        return Some(format!("no transport (missing ':') in {address:?}"));
    };
    if transport.is_empty() {
        return Some(format!("empty transport in {address:?}"));
    }
    let mut opts = HashMap::new();
    // `separated(0.., kv, ',')` 뒤 입력 끝 — 빈 옵션은 되고, 빈 조각(앞뒤·연속 쉼표)은 안 된다.
    if !options.is_empty() {
        for kv in options.split(',') {
            let Some((key, value)) = kv.split_once('=') else {
                return Some(format!("option {kv:?} is not key=value"));
            };
            if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return Some(format!("option key {key:?} is not alphanumeric"));
            }
            if value.is_empty() {
                return Some(format!("option {key:?} has an empty value"));
            }
            opts.insert(key, value);
        }
    }
    // zbus 는 uuid 로 읽는다 — 버스가 실제로 내는 32자리 16진수만 받는다(uuid 의 부분집합).
    if let Some(guid) = opts.get("guid") {
        if guid.len() != 32 || !guid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(format!("guid {guid:?} is not 32 hex digits"));
        }
    }
    match transport {
        "unix" => {
            let sockets = ["path", "abstract", "dir", "tmpdir"]
                .iter()
                .filter(|key| opts.contains_key(*key))
                .count();
            (sockets != 1)
                .then(|| "unix: needs exactly one of path/abstract/dir/tmpdir".to_string())
        }
        "tcp" | "nonce-tcp" => tcp_problem(&opts, transport == "nonce-tcp"),
        other => Some(format!("transport {other:?} is not one this check accepts")),
    }
}

/// zbus 5 `Tcp::from_options`.
fn tcp_problem(opts: &HashMap<&str, &str>, nonce_required: bool) -> Option<String> {
    if opts.contains_key("bind") {
        return Some("tcp: `bind` is not supported".into());
    }
    if !opts.contains_key("host") {
        return Some("tcp: missing `host`".into());
    }
    let Some(port) = opts.get("port") else {
        return Some("tcp: missing `port`".into());
    };
    if port.parse::<u16>().is_err() {
        return Some(format!("tcp: invalid `port` {port:?}"));
    }
    if let Some(family) = opts.get("family") {
        if !matches!(*family, "ipv4" | "ipv6") {
            return Some(format!("tcp: invalid `family` {family:?}"));
        }
    }
    match opts.get("noncefile") {
        Some(file) if !percent_encoding_ok(file) => {
            Some(format!("tcp: `noncefile` {file:?} is not percent-encoded"))
        }
        None if nonce_required => Some("nonce-tcp: missing `noncefile`".into()),
        _ => None,
    }
}

/// zbus 5 `decode_percents` — 날 글자는 `-0-9A-Za-z_/.\*` 만, 나머지는 `%XX`.
fn percent_encoding_ok(value: &str) -> bool {
    let mut bytes = value.bytes();
    while let Some(b) = bytes.next() {
        let plain = b.is_ascii_alphanumeric() || b"-_/.\\*".contains(&b);
        if plain {
            continue;
        }
        if b != b'%' {
            return false;
        }
        let hex = |b: Option<u8>| b.is_some_and(|b| b.is_ascii_hexdigit());
        if !hex(bytes.next()) || !hex(bytes.next()) {
            return false;
        }
    }
    true
}

// ── 배선 ─────────────────────────────────────────────────────────────────

/// single-instance 플러그인을 등록한다 — `lib.rs` 의 자리. 앱의 **첫** 플러그인이어야 한다
/// (두 번째 인스턴스는 여기서 끝나고, 창을 만들기 전이다).
///
/// Linux 에서는 둘을 더 한다:
/// - 세션 D-Bus 주소를 zbus 가 못 읽으면([`session_address_problem`]) 플러그인을 **건너뛴다**
///   — 등록하면 setup 의 `unwrap` 이 기동 중 패닉한다. 경고 한 줄을 남긴다.
/// - 그 바로 뒤에 잠금 파일 플러그인([`plugin`])을 단다. 건너뛴 경우에도 두 번째 인스턴스는
///   거기서 막힌다.
///
/// macOS·Windows 는 예전 그대로 플러그인 하나다 (D3).
pub fn register<R, F>(builder: tauri::Builder<R>, on_second_instance: F) -> tauri::Builder<R>
where
    R: tauri::Runtime,
    F: FnMut(&tauri::AppHandle<R>, Vec<String>, String) + Send + Sync + 'static,
{
    #[cfg(target_os = "linux")]
    {
        let problem = session_address_problem(
            std::env::var("DBUS_SESSION_BUS_ADDRESS").ok().as_deref(),
            std::env::var("XDG_RUNTIME_DIR").ok().as_deref(),
        );
        let builder = match &problem {
            Some(why) => {
                tracing::warn!(
                    target: "oculpm::boot",
                    why = %why,
                    "[FLOW] 세션 D-Bus 주소를 zbus 가 못 읽는다 — single-instance 플러그인을 \
                     건너뛴다(등록하면 기동 중 패닉). 잠금 파일로 두 번째 인스턴스를 막는다 \
                     (딥링크·창 앞으로 전달은 안 된다)"
                );
                builder
            }
            None => builder.plugin(tauri_plugin_single_instance::init(on_second_instance)),
        };
        builder.plugin(plugin())
    }
    #[cfg(not(target_os = "linux"))]
    {
        builder.plugin(tauri_plugin_single_instance::init(on_second_instance))
    }
}

/// 잠금 파일 핸들 — 앱이 끝날 때까지 쥐고 있는다.
#[cfg(target_os = "linux")]
struct InstanceLock(#[allow(dead_code)] File);

/// single-instance 플러그인 **바로 뒤에** 등록하는 플러그인([`register`] 가 단다). 플러그인
/// setup 은 등록 순서대로, 설정 파일의 창을 만들기 **전에** 돈다 — 두 번째 인스턴스가 창을
/// 한 번 번쩍 띄우고 사라지지 않는다 (앱의 `.setup` 은 창을 만든 뒤라 늦다).
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
                 D-Bus 가 없거나 그 주소를 못 읽어 인자(딥링크)를 첫 인스턴스에 넘기지 못했다"
            );
            eprintln!(
                "ocul-pm is already running (pid {}). Without a usable D-Bus session bus the second \
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
    /// pid 읽기는 유닉스(flock = 권고 잠금)에서만 — Windows 의 `try_lock` 은 LockFileEx
    /// 강제 잠금이라 다른 핸들이 잠긴 파일을 못 읽는다(`None`). 이 플러그인은 Linux 전용이다.
    #[test]
    fn second_acquire_is_busy_while_the_first_holds() {
        let dir = tempfile::tempdir().unwrap();
        let first = held(try_acquire(dir.path(), Duration::ZERO));
        match try_acquire(dir.path(), Duration::ZERO) {
            Acquire::Busy { holder } => {
                if cfg!(unix) {
                    assert_eq!(holder, Some(std::process::id()));
                }
            }
            other => panic!("잡혀 있어야 한다: {other:?}"),
        }
        drop(first);
        // 놓은 뒤 다시 잡기는 **재시도 창**으로 — 같은 테스트 바이너리의 옆 스레드가 그 순간
        // 자식을 띄우면(fork·posix_spawn) 자식이 exec 할 때까지 이 파일의 열린 설명을 물고
        // 있어 flock 이 잠깐 더 잡혀 있다(`O_CLOEXEC` 은 exec 때 닫는다). 병렬 전체 실행에서
        // 간헐로 여기서 떨어졌다. 제품 경로는 이미 `RETRY_FOR` 로 다시 본다.
        held(try_acquire(dir.path(), RETRY_FOR));
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

    /// zbus 5 `Address::from_str`(Linux) 의 표 — 받는 것, 못 받는 것, 받지만 여기서 모름으로
    /// 치는 것 (#os-dbus-addr-panic). 실제 zbus 와 대 보는 것은 Linux 의 자식 프로세스 표다.
    #[test]
    fn zbus_address_rules_table() {
        let accepted = [
            "unix:path=/run/user/1000/bus",
            "unix:path=/run/user/1000/bus,guid=0123456789abcdef0123456789ABCDEF",
            "unix:abstract=/tmp/dbus-AbC",
            "unix:dir=/tmp",
            "unix:tmpdir=/tmp",
            "unix:path=/a;unix:path=/b", // zbus 는 `;` 로 가르지 않는다 — 첫 path 값에 붙는다
            "unix:path=/a=b,foo=bar",    // 값 안의 `=` · 모르는 키는 무시
            "unix:path=/tmp/with%20space",
            "tcp:host=127.0.0.1,port=4142",
            "tcp:host=localhost,port=4142,family=ipv6",
            "nonce-tcp:host=localhost,port=1,noncefile=/a/file%20x",
        ];
        for address in accepted {
            assert_eq!(zbus_address_problem(address), None, "{address:?}");
        }
        let rejected = [
            "",
            "   ",
            "garbage",
            ":path=/x",
            "unix:",
            "unix:foo=bar",
            "unix:path=/a,abstract=b",
            "unix:path=/a,",
            "unix:,path=/a",
            "unix:path=",
            "unix:pa-th=/a",
            "unix:path=/a,guid=0123",
            "tcp:host=localhost",
            "tcp:host=localhost,port=32f",
            "tcp:host=localhost,port=70000",
            "tcp:host=localhost,port=1,family=ipv7",
            "tcp:host=h,port=1,bind=x",
            "nonce-tcp:host=h,port=1",
            "nonce-tcp:host=h,port=1,noncefile=a b",
            "foo:opt=1",
            "launchd:env=X",
            "autolaunch:",
            // zbus 는 받지만 이 검사는 모름 = 문제로 친다 (잃는 것은 인자 전달뿐).
            "ibus:",
            "unixexec:path=/bin/true",
            "vsock:cid=1,port=2",
        ];
        for address in rejected {
            assert!(zbus_address_problem(address).is_some(), "{address:?}");
        }
    }

    /// 변수 → 읽을 주소. 빈 변수는 **빈 주소**다(폴백하지 않는다) — 가장 흔한 패닉 입력.
    #[test]
    fn session_address_follows_zbus_fallback() {
        assert_eq!(session_address_problem(None, None), None);
        assert_eq!(session_address_problem(None, Some("/run/user/1000")), None);
        assert_eq!(session_address_problem(None, Some("")), None);
        assert!(session_address_problem(None, Some("/tmp/a,b")).is_some());
        assert!(session_address_problem(Some(""), Some("/run/user/1000")).is_some());
        assert_eq!(
            session_address_problem(Some("unix:path=/x"), Some("/tmp/a,b")),
            None
        );
    }

    // ── 실제 플러그인으로 (Linux) ─────────────────────────────────────────

    /// 자식 모드 스위치 — `raw`(플러그인 그대로) · `guarded`([`register`]).
    #[cfg(target_os = "linux")]
    const SI_CHILD_ENV: &str = "OCULPM_SINGLE_INSTANCE_CHILD";
    #[cfg(target_os = "linux")]
    const SI_CHILD_TEST: &str = "instance_lock::tests::single_instance_child";

    /// **자식 프로세스 본체** — 평소에는 아무것도 안 하고 통과한다. 부모가 환경 변수를
    /// 걸어 `--exact` 로 다시 띄우면 모의 앱을 single-instance 와 함께 짓는다. 환경은
    /// 프로세스 전역이라 부모 안에서 바꾸지 않고 자식을 띄운다.
    #[cfg(target_os = "linux")]
    #[test]
    fn single_instance_child() {
        let Ok(mode) = std::env::var(SI_CHILD_ENV) else {
            return;
        };
        let builder = tauri::test::mock_builder();
        let builder = if mode == "raw" {
            builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        } else {
            register(builder, |_, _, _| {})
        };
        // 모의 설정의 식별자는 빈 문자열이라 버스 이름(`.SingleInstance`)이 틀린다 — 그러면
        // 주소와 무관하게 `.name(..).unwrap()` 에서 패닉한다. 앱의 식별자를 쓴다.
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = crate::app_dirs::BUNDLE_IDENTIFIER.into();
        let app = builder.build(context);
        assert!(app.is_ok(), "모의 앱: {:?}", app.err());
    }

    /// 자식을 띄워 끝을 기다린다 — (성공했나, stderr). 세션 버스·데이터 폴더는 빈 임시
    /// 폴더라 실제 버스에 닿지 않는다.
    #[cfg(target_os = "linux")]
    fn run_child(mode: &str, address: Option<&str>, runtime_dir: &Path) -> (bool, String) {
        let data = tempfile::tempdir().unwrap();
        let mut cmd = crate::proc::std_cmd(std::env::current_exe().unwrap());
        cmd.args([SI_CHILD_TEST, "--exact", "--nocapture", "--test-threads=1"])
            .env(SI_CHILD_ENV, mode)
            .env("XDG_DATA_HOME", data.path())
            .env("XDG_RUNTIME_DIR", runtime_dir)
            .env_remove("DBUS_SESSION_BUS_ADDRESS")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        if let Some(address) = address {
            cmd.env("DBUS_SESSION_BUS_ADDRESS", address);
        }
        let mut child = cmd.spawn().expect("자식 테스트 프로세스");
        let mut stderr = child.stderr.take().unwrap();
        let reader = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        let deadline = Instant::now() + Duration::from_secs(60);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("자식이 60초 안에 끝나지 않는다: {mode} {address:?}");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        (status.success(), reader.join().unwrap())
    }

    /// 패닉 경로의 실측과 가드 (#os-dbus-addr-panic) — 같은 주소로 **실제 플러그인**을 짓는다.
    /// - 검사가 괜찮다는 주소는 플러그인이 패닉하지 않는다 (검사가 zbus 보다 느슨하지 않다).
    /// - zbus 가 못 읽는 주소는 플러그인이 `unwrap` 에서 **패닉한다** (L-OS3 의 추정이 사실).
    /// - 같은 주소로 [`register`] 를 거치면 앱이 뜬다.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_bad_session_address_panics_the_plugin_but_not_register() {
        let tmp = tempfile::tempdir().unwrap();
        let nobus = tmp.path().join("nobus");
        let (runtime, comma_runtime) = (tmp.path().join("runtime"), tmp.path().join("a,b"));
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::create_dir_all(&comma_runtime).unwrap();
        let (runtime, comma_runtime) = (runtime.as_path(), comma_runtime.as_path());
        let path = |p: &Path| format!("unix:path={}", p.display());
        let good: Vec<(Option<String>, &Path)> = vec![
            (Some(path(&nobus)), runtime),
            (
                Some(format!("{},guid={}", path(&nobus), "ab".repeat(16))),
                runtime,
            ),
            (Some(format!("{};{}", path(&nobus), path(&nobus))), runtime),
            (
                Some(format!("unix:abstract=oculpm-nobus-{}", std::process::id())),
                runtime,
            ),
            (Some("tcp:host=127.0.0.1,port=1".into()), runtime),
            (None, runtime),
        ];
        for (address, dir) in &good {
            let problem =
                session_address_problem(address.as_deref(), Some(&dir.display().to_string()));
            assert_eq!(problem, None, "{address:?}");
            let (ok, err) = run_child("raw", address.as_deref(), dir);
            assert!(
                ok,
                "읽히는 주소인데 플러그인이 실패했다 {address:?}:\n{err}"
            );
        }
        let bad: Vec<(Option<&str>, &Path)> = vec![
            (Some(""), runtime),
            (Some("garbage"), runtime),
            (Some("unix:"), runtime),
            (Some("unix:foo=bar"), runtime),
            (Some("unix:path=/a,"), runtime),
            (Some("unix:path=/a,guid=0123"), runtime),
            (Some("tcp:host=127.0.0.1,port=notaport"), runtime),
            (Some("launchd:env=X"), runtime),
            (None, comma_runtime), // 변수 없음 + XDG_RUNTIME_DIR 에 쉼표
        ];
        for (address, dir) in &bad {
            let problem = session_address_problem(*address, Some(&dir.display().to_string()));
            assert!(problem.is_some(), "{address:?} {}", dir.display());
            // 패닉 자리가 플러그인의 주소 `unwrap` 이어야 한다 — 다른 이유의 실패가 아니다.
            let (ok, err) = run_child("raw", *address, dir);
            let at_address = err.contains("tauri-plugin-single-instance")
                && (err.contains("Address(") || err.contains("InvalidGUID"));
            assert!(
                !ok && at_address,
                "플러그인이 주소에서 패닉해야 한다 {address:?}:\n{err}"
            );
            let (ok, err) = run_child("guarded", *address, dir);
            assert!(ok, "register 를 거치면 떠야 한다 {address:?}:\n{err}");
        }
    }
}

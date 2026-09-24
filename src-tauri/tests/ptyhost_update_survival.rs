//! **Windows 업데이트를 건너는 호스트** (플랜 `cross-platform-port` #w3-update-ptyhost-lock) —
//! windows 러너에서 실제 앱 바이너리로 돈다. 사용자가 Windows 를 직접 못 보므로 이 파일이 눈이다.
//!
//! 흉내 내는 것: Tauri 의 NSIS 설치 파일은 업데이트 때 (1) `ocul-pm.exe` 를 **이름으로** 끝내고
//! (2) 설치 폴더의 `ocul-pm.exe` 를 덮어쓴다. 호스트가 설치 폴더 밖의 다른 이름 복사본으로
//! 돌면 둘 다 호스트에 닿지 않는다 — 그걸 실제 프로세스로 확인한다.
//!
//! - 앱 바이너리(`CARGO_BIN_EXE_ocul-pm`)를 임시 "설치 폴더" 에 `ocul-pm.exe` 로 둔다.
//! - 앱과 같은 길(`launch::launch`)로 호스트를 복사본에서 띄우고 세션을 연다.
//! - **대조군**: 설치 폴더의 원본으로 도는 호스트를 하나 더 띄워 전제를 확인한다 — 원본이
//!   돌면 원본을 덮어쓰지도 지우지도 못하고, 이름으로 끝내면 끝난다.
//! - `taskkill /IM ocul-pm.exe /F` → 대조군만 죽고 복사본 호스트는 산다.
//! - 설치 폴더의 원본을 덮어쓰고·지우고·새 판으로 다시 쓴다 → 된다.
//! - 새로 붙은 앱이 세션·스크롤백을 이어받고, 셸이 여전히 입력을 받는다.
//! - 새 판의 복사본을 띄워도 자리는 그대로 — 먼저 있던 호스트를 이어받는다.
//! - 쓰는 호스트가 있는 복사본은 지워지지 않고, 호스트가 내려가면 지워진다.
//!
//! 이 파일의 테스트는 **한 줄로** 돈다(`SERIAL`) — `taskkill /IM ocul-pm.exe` 는 이름이 같은
//! 모든 프로세스를 끝내므로, 옆 테스트가 원본으로 띄운 호스트까지 죽일 수 있다.
#![cfg(windows)]

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write as _};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use ocul_pm_lib::ptyhost::client::{connect_or_spawn, spawn_host_from, PtyHostClient};
use ocul_pm_lib::ptyhost::launch::{launch, HostOrigin, Timing};
use ocul_pm_lib::ptyhost::pipe::Identity;
use ocul_pm_lib::ptyhost::protocol::{Event, Request, Response};
use ocul_pm_lib::ptyhost::stage::{self, COPY_PREFIX};
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::mpsc;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

const APP: &str = env!("CARGO_BIN_EXE_ocul-pm");
const SID: &str = "p1-update-survival";

/// 러너의 디버그 앱 바이너리는 기동이 느리다 — 앱의 시한(원본 3초)으로 재면 느린 기동을
/// 실패로 읽어 원본으로 물러선다. 이 파일은 물러서기가 아니라 **복사본이 사는가**를 본다.
const PATIENT: Timing = Timing {
    copy: Duration::from_secs(90),
    original: Duration::from_secs(90),
};

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ─── 틀 ──────────────────────────────────────────────────────────────────────

/// 테스트 전체의 상한 — 동기 호출이 매달리면 여기서 끊는다(단계 시한 60분을 기다리지 않게).
fn watchdog(what: &'static str, limit: Duration) -> Arc<AtomicBool> {
    let done = Arc::new(AtomicBool::new(false));
    let flag = done.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + limit;
        while !flag.load(Ordering::SeqCst) {
            if Instant::now() > deadline {
                let _ = std::io::stderr().write_all(
                    format!("\n[watchdog] {what}: {limit:?} 넘게 끝나지 않는다\n").as_bytes(),
                );
                std::process::exit(101);
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
    done
}

/// 실패해도 호스트를 내린다 — 분리 기동한 호스트는 테스트보다 오래 살고, 세션을 쥔 채 남으면
/// 테스트 출력 파이프까지 물고 단계 전체를 매달리게 한다 (`ptyhost_roundtrip` 과 같은 이유).
struct ShutdownOnDrop(PathBuf);

impl Drop for ShutdownOnDrop {
    fn drop(&mut self) {
        let socket = self.0.clone();
        let _ = std::thread::spawn(move || {
            let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            rt.block_on(async {
                let work = async {
                    if let Ok(c) = PtyHostClient::connect(&socket, |_| {}).await {
                        let _ = c.request(Request::Shutdown).await;
                    }
                };
                let _ = tokio::time::timeout(Duration::from_secs(5), work).await;
            });
        })
        .join();
    }
}

fn channel() -> (
    impl Fn(Event) + Send + Sync + Clone + 'static,
    mpsc::UnboundedReceiver<Event>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        move |ev| {
            let _ = tx.send(ev);
        },
        rx,
    )
}

/// 앱의 재접속 — 호스트가 없으면 띄우지 않는다(있어야 한다).
async fn attach_app(socket: &Path) -> (PtyHostClient, mpsc::UnboundedReceiver<Event>) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let (on_event, rx) = channel();
        match connect_or_spawn(&[socket.to_path_buf()], false, on_event).await {
            Ok(Some(client)) => return (client, rx),
            Ok(None) | Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            other => panic!("호스트에 못 붙었다: {:?}", other.map(|c| c.is_some())),
        }
    }
}

/// `SID` 의 출력에서 `done` 이 참이 될 때까지 모은다. 터미널 질의(커서 위치·장치 속성)에는
/// xterm.js 대신 답한다 — 답을 기다리는 conhost·셸은 입력을 받기 전에 멈춘다.
async fn read_until(
    app: &PtyHostClient,
    events: &mut mpsc::UnboundedReceiver<Event>,
    what: &str,
    mut done: impl FnMut(&str) -> bool,
) -> String {
    const QUERIES: [(&str, &str); 3] = [
        ("\x1b[6n", "\x1b[1;1R"),
        ("\x1b[c", "\x1b[?1;0c"),
        ("\x1b[0c", "\x1b[?1;0c"),
    ];
    let mut seen = String::new();
    let outcome = tokio::time::timeout(Duration::from_secs(60), async {
        while let Some(ev) = events.recv().await {
            if let Event::Data { sid, text, .. } = ev {
                if sid == SID {
                    for (query, reply) in QUERIES {
                        for _ in text.matches(query) {
                            let _ = app
                                .request(Request::Write {
                                    sid: SID.into(),
                                    data: reply.into(),
                                })
                                .await;
                        }
                    }
                    seen.push_str(&text);
                    if done(&seen) {
                        return;
                    }
                }
            }
        }
    })
    .await;
    assert!(outcome.is_ok(), "{what} — 받은 출력: {seen:?}");
    seen
}

async fn write(client: &PtyHostClient, data: &str) {
    let resp = client
        .request(Request::Write {
            sid: SID.into(),
            data: data.into(),
        })
        .await
        .expect("전송");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
}

/// 기본 셸 후보(L-SHELL) — pwsh 가 있으면 그것, 없으면 Windows PowerShell(늘 있다).
fn shell() -> String {
    let pwsh = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join("pwsh.exe").is_file()))
        .unwrap_or(false);
    if pwsh { "pwsh.exe" } else { "powershell.exe" }.into()
}

/// 이 경로의 파이프를 **지금** 받고 있는 프로세스의 실행 파일 — 호스트가 어디서 떴는지의
/// 사실.
async fn server_image(socket: &Path) -> PathBuf {
    let pid = server_pid(socket).await;
    image_of(pid).unwrap_or_else(|| panic!("pid {pid} 의 실행 파일을 못 읽는다"))
}

/// 이 경로의 파이프를 받고 있는 프로세스 — 붙었다 바로 끊는 접속 하나로 묻는다.
async fn server_pid(socket: &Path) -> u32 {
    let name = Identity::current().expect("토큰").pipe_name(socket);
    let deadline = Instant::now() + Duration::from_secs(10);
    let pipe = loop {
        match ClientOptions::new().open(&name) {
            Ok(pipe) => break pipe,
            Err(e) if Instant::now() < deadline => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => panic!("{} 를 받는 호스트가 없다: {e}", socket.display()),
        }
    };
    let mut pid = 0u32;
    // SAFETY: 살아 있는 파이프 핸들, 출력은 지역 변수.
    let ok = unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle() as HANDLE, &mut pid) };
    assert_ne!(ok, 0, "서버 pid: {}", std::io::Error::last_os_error());
    pid
}

/// 프로세스가 아직 도는가 — 끝났지만 핸들이 남은 프로세스도 끝난 것으로 본다.
fn alive(pid: u32) -> bool {
    // SAFETY: 실패하면 null — 없는 프로세스다.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let mut code = 0u32;
    // SAFETY: 방금 연 핸들, 출력은 지역 변수. 끝나면 닫는다.
    let ok = unsafe { GetExitCodeProcess(handle, &mut code) };
    unsafe { CloseHandle(handle) };
    ok != 0 && code == STILL_ACTIVE as u32
}

fn image_of(pid: u32) -> Option<PathBuf> {
    // SAFETY: 실패하면 null — 아래에서 가른다.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buf = vec![0u16; 32 * 1024];
    let mut len = buf.len() as u32;
    // SAFETY: 버퍼 길이를 함께 넘긴다. 끝나면 핸들을 닫는다.
    let ok = unsafe { QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) };
    unsafe { CloseHandle(process) };
    (ok != 0).then(|| PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
}

/// 같은 파일인가 — 러너의 임시 폴더는 8.3 짧은 이름(`RUNNER~1`)이라 문자열로는 못 잰다.
fn same_file(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| {
        fs::canonicalize(p)
            .unwrap_or_else(|e| panic!("{}: {e}", p.display()))
            .to_string_lossy()
            .to_lowercase()
    };
    canon(a) == canon(b)
}

/// 이 실행 파일 이름으로 도는 프로세스가 있는가 (Toolhelp32 — 이름만 본다).
fn running(image_name: &str) -> bool {
    // SAFETY: 스냅숏 핸들은 아래에서 닫는다.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return false;
    }
    // SAFETY: 0 으로 채운 POD 구조체에 크기만 적는다.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = false;
    // SAFETY: 살아 있는 스냅숏과 크기를 적은 구조체.
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while more {
        let len = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case(image_name) {
            found = true;
            break;
        }
        // SAFETY: 위와 같다.
        more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    // SAFETY: 위에서 연 스냅숏을 한 번만 닫는다.
    unsafe { CloseHandle(snapshot) };
    found
}

async fn wait_until(what: &str, limit: Duration, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !done() {
        assert!(Instant::now() < deadline, "{what} — {limit:?} 안에 안 됐다");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().unwrap().to_string_lossy().into_owned()
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// "새 판" — 같은 앱에 표식을 덧붙인다. PE 는 파일 끝에 붙은 바이트를 읽지 않으므로 그대로
/// 실행되고, 내용 해시가 달라 복사본 이름이 갈린다.
fn write_new_build(exe: &Path) -> std::io::Result<()> {
    let mut bytes = fs::read(APP)?;
    bytes.extend_from_slice(b"\0ocul-pm update-survival: the next build\0");
    fs::write(exe, bytes)
}

/// 설치 파일의 파일 연산 — 방금 끝난 프로세스의 이미지를 백신이 훑는 동안의 잠깐 거절은
/// 다시 해 본다(설치 파일도 재시도한다). 10초 넘게 거절되면 실패다.
async fn installer_op(what: &str, mut op: impl FnMut() -> std::io::Result<()>) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match op() {
            Ok(()) => return,
            Err(e) if Instant::now() < deadline => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(e) => panic!("{what}: {e}"),
        }
    }
}

// ─── 실행 파일이 제 폴더에 기대는 것이 없는가 ─────────────────────────────────

/// 파일의 `offset` 부터 `len` 바이트 — 끝에 닿으면 짧게 돌려준다.
fn read_at(f: &mut fs::File, offset: u64, len: usize) -> Vec<u8> {
    let mut buf = Vec::with_capacity(len);
    f.seek(SeekFrom::Start(offset)).unwrap();
    Read::take(&mut *f, len as u64)
        .read_to_end(&mut buf)
        .unwrap();
    buf
}

fn u16_of(b: &[u8], i: usize) -> u64 {
    u64::from(u16::from_le_bytes([b[i], b[i + 1]]))
}

fn u32_of(b: &[u8], i: usize) -> u64 {
    u64::from(u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]))
}

/// PE 의 가져오기 표(일반 + 지연)에 적힌 DLL 이름들.
fn imported_dlls(path: &Path) -> Vec<String> {
    let mut f = fs::File::open(path).expect("앱 바이너리");
    let dos = read_at(&mut f, 0, 64);
    assert_eq!(&dos[..2], b"MZ");
    let pe = u32_of(&dos, 0x3c);
    let head = read_at(&mut f, pe, 24);
    assert_eq!(&head[..4], b"PE\0\0");
    let sections = u16_of(&head, 6) as usize;
    let optional_size = u16_of(&head, 20) as usize;
    let optional = read_at(&mut f, pe + 24, optional_size);
    let dirs = match u16_of(&optional, 0) {
        0x20b => 112, // PE32+
        0x10b => 96,  // PE32
        magic => panic!("모르는 PE 매직 {magic:#x}"),
    };
    let table = read_at(&mut f, pe + 24 + optional_size as u64, sections * 40);
    let file_offset = |rva: u64| -> u64 {
        (0..sections)
            .map(|i| &table[i * 40..i * 40 + 40])
            .find_map(|s| {
                let (va, vsize, raw) = (u32_of(s, 12), u32_of(s, 8), u32_of(s, 20));
                let size = vsize.max(u32_of(s, 16));
                (rva >= va && rva < va + size).then(|| raw + (rva - va))
            })
            .unwrap_or_else(|| panic!("RVA {rva:#x} 가 어느 섹션에도 없다"))
    };

    let mut dlls = Vec::new();
    // (디렉터리 번호, 서술자 크기, 서술자 안의 이름 RVA 자리): 1 = 가져오기, 13 = 지연 가져오기.
    for (index, stride, name_at) in [(1usize, 20usize, 12usize), (13, 32, 4)] {
        let rva = u32_of(&optional, dirs + index * 8);
        if rva == 0 {
            continue;
        }
        let mut offset = file_offset(rva);
        loop {
            let desc = read_at(&mut f, offset, stride);
            if desc.len() < stride || desc.iter().all(|&b| b == 0) {
                break;
            }
            let name_rva = u32_of(&desc, name_at);
            if name_rva != 0 {
                let bytes = read_at(&mut f, file_offset(name_rva), 256);
                let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                dlls.push(String::from_utf8_lossy(&bytes[..end]).into_owned());
            }
            offset += stride as u64;
        }
    }
    dlls
}

/// 복사본은 설치 폴더 밖에 **혼자** 있다 — 실행 파일 옆에 놓인 DLL 을 기대면 복사본은 뜨지
/// 못한다. 가져오는 DLL 이 전부 시스템 것(System32 에 있거나 API 집합)인지 본다. 목록은
/// 로그에 남긴다(보고용 — 캡처를 피해 stderr 로 곧장 쓴다).
#[test]
fn the_app_binary_needs_nothing_beside_itself() {
    let dlls = imported_dlls(Path::new(APP));
    assert!(!dlls.is_empty(), "가져오기 표를 못 읽었다");
    let system =
        PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot")).join("System32");
    let _ = std::io::stderr()
        .write_all(format!("\n[ptyhost-deps] {} imports {}\n", APP, dlls.join(", ")).as_bytes());
    let foreign: Vec<&String> = dlls
        .iter()
        .filter(|dll| {
            let lower = dll.to_ascii_lowercase();
            let api_set = lower.starts_with("api-ms-") || lower.starts_with("ext-ms-");
            !api_set && !system.join(dll.as_str()).is_file()
        })
        .collect();
    assert!(
        foreign.is_empty(),
        "시스템에 없는 DLL 을 가져온다 — 설치 폴더 밖의 복사본은 이걸 못 찾는다: {foreign:?} (전체: {dlls:?})"
    );
}

// ─── 업데이트를 건넌다 ───────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_host_from_the_copy_survives_an_update_of_the_install_folder() {
    let _serial = SERIAL.lock().await;
    let done = watchdog("ptyhost_update_survival", Duration::from_secs(480));

    let root = tempfile::tempdir().unwrap();
    let install = root.path().join("install");
    fs::create_dir_all(&install).unwrap();
    let exe = install.join("ocul-pm.exe");
    fs::copy(APP, &exe).expect("설치 폴더에 앱을 둔다");
    let appdata = root.path().join("roaming").join("com.test.ocul-pm");
    fs::create_dir_all(&appdata).unwrap();
    let socket = appdata.join("ptyhost-dev.sock");
    let stage_dir = stage::stage_dir_for(&root.path().join("local"), &socket).unwrap();

    // ── 복사본에서 기동 — 앱과 같은 길 ──────────────────────────────────
    let (on_event, mut events) = channel();
    let (app, origin) = launch(&exe, Some(&stage_dir), &socket, on_event, &PATIENT)
        .await
        .expect("호스트를 띄운다");
    let _host = ShutdownOnDrop(socket.clone());
    let HostOrigin::Copy(copy_x) = origin else {
        panic!("복사본에서 뜨지 않았다: {origin:?}");
    };
    assert_eq!(copy_x.parent(), Some(stage_dir.as_path()));
    assert!(file_name(&copy_x).starts_with(COPY_PREFIX), "{copy_x:?}");
    assert_eq!(names(&stage_dir), vec![file_name(&copy_x)]);
    let serving = server_image(&socket).await;
    assert!(
        same_file(&serving, &copy_x),
        "자리를 받는 것은 복사본이어야 한다: {serving:?}"
    );

    // ── 세션 — 업데이트를 건너야 할 셸 ─────────────────────────────────
    let resp = app
        .request(Request::Start {
            sid: SID.into(),
            cwd: String::new(),
            rows: 24,
            cols: 80,
            shell: shell(),
            env: vec![("TERM".into(), "xterm-256color".into())],
            nonce: "nonce-update".into(),
            shell_integration: false,
        })
        .await
        .expect("start");
    assert!(matches!(resp, Response::Session { .. }), "{resp:?}");
    read_until(&app, &mut events, "프롬프트", |s| s.contains('>')).await;
    write(&app, "Write-Output ('before-update-' + (40+2))\r").await;
    read_until(&app, &mut events, "업데이트 전 출력", |s| {
        s.contains("before-update-42")
    })
    .await;

    // ── 대조군: 설치 폴더의 원본으로 도는 호스트 ────────────────────────
    let control = appdata.join("control.sock");
    let _control = ShutdownOnDrop(control.clone());
    spawn_host_from(&exe, &control).expect("대조군 호스트");
    let (probe, _) = attach_app(&control).await;
    drop(probe);
    let control_pid = server_pid(&control).await;
    assert!(same_file(
        &image_of(control_pid).expect("대조군의 실행 파일"),
        &exe
    ));
    let host_pid = server_pid(&socket).await;
    // 전제 — 원본이 돌고 있으면 설치 파일이 원본을 바꾸지 못한다(그래서 복사본이다).
    assert!(
        fs::OpenOptions::new().write(true).open(&exe).is_err(),
        "실행 중인 원본을 쓰기로 열 수 있다 — 전제가 틀렸다"
    );
    assert!(
        fs::remove_file(&exe).is_err(),
        "실행 중인 원본을 지울 수 있다 — 전제가 틀렸다"
    );

    // ── 업데이트 1: 이름으로 끝내기 (NSIS 의 KillProcess 흉내) ─────────────
    // 종료 코드는 보지 않는다 — 앞 테스트 바이너리의 호스트가 마침 내려가는 중이면 그 하나를
    // 못 끝냈다고 0 이 아닌 코드가 나온다. 증거는 아래의 대조군 사망이다.
    let out = ocul_pm_lib::proc::std_cmd("taskkill")
        .args(["/IM", "ocul-pm.exe", "/F"])
        .output()
        .expect("taskkill");
    let said = format!(
        "{} {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    // 대조군은 죽는다 — 흉내가 실제로 이름으로 끝낸다는 증거.
    let deadline = Instant::now() + Duration::from_secs(20);
    while alive(control_pid) {
        assert!(
            Instant::now() < deadline,
            "이름으로 끝냈는데 대조군이 산다 — taskkill: {said}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // 복사본 호스트는 산다 — 같은 자리를 여전히 같은 프로세스가 받는다.
    assert!(alive(host_pid), "복사본 호스트가 이름 끝내기에 죽었다");
    assert_eq!(server_pid(&socket).await, host_pid);

    // ── 업데이트 2: 설치 폴더의 원본 교체 — 쓰는 프로세스가 없으니 된다 ───
    installer_op("원본을 덮어쓴다", || write_new_build(&exe)).await;
    installer_op("원본을 지운다", || fs::remove_file(&exe)).await;
    installer_op("새 판을 설치한다", || write_new_build(&exe)).await;
    assert!(alive(host_pid), "원본을 바꾸는 동안 호스트가 죽었다");

    // ── 업데이트한 앱이 다시 붙는다 — 세션·스크롤백이 그대로, 셸이 받는다 ──
    drop(app);
    drop(events);
    let (app, mut events) = attach_app(&socket).await;
    let Response::Attach {
        attach: Some(snapshot),
    } = app
        .request(Request::Attach { sid: SID.into() })
        .await
        .expect("attach")
    else {
        panic!("업데이트 뒤의 앱이 세션을 못 찾는다");
    };
    assert!(
        snapshot.text.contains("before-update-42"),
        "스크롤백: {:?}",
        snapshot.text
    );
    assert_eq!(snapshot.nonce, "nonce-update");
    write(&app, "Write-Output ('after-update-' + (40+44))\r").await;
    read_until(&app, &mut events, "업데이트 뒤 출력", |s| {
        s.contains("after-update-84")
    })
    .await;

    // ── 새 판의 복사본이 떠도 자리는 그대로 — 먼저 있던 호스트를 이어받는다 ──
    let (next, origin) = launch(&exe, Some(&stage_dir), &socket, |_| {}, &PATIENT)
        .await
        .expect("새 판의 기동");
    let HostOrigin::Copy(copy_y) = origin else {
        panic!("새 판이 복사본을 못 만들었다: {origin:?}");
    };
    assert_ne!(copy_x, copy_y, "내용이 다르면 복사본 이름이 갈린다");
    assert_eq!(
        server_pid(&socket).await,
        host_pid,
        "새 판의 복사본이 세션을 쥔 호스트의 자리를 뺏었다"
    );
    let resp = next
        .request(Request::Attach { sid: SID.into() })
        .await
        .expect("attach");
    assert!(
        matches!(resp, Response::Attach { attach: Some(_) }),
        "{resp:?}"
    );
    drop(next);
    // 뒤에 뜬 새 판은 자리가 차 있는 것을 보고 스스로 비켜 났다.
    wait_until(
        "새 판의 복사본이 비켜 난다",
        Duration::from_secs(60),
        || !running(&file_name(&copy_y)),
    )
    .await;

    // ── 쓰는 호스트가 있는 복사본은 지워지지 않는다 ─────────────────────
    let pruned = stage::prune(&stage_dir, &copy_y);
    assert!(pruned.removed.is_empty(), "{:?}", pruned.removed);
    assert_eq!(
        pruned
            .kept
            .iter()
            .map(|(p, _)| p.clone())
            .collect::<Vec<_>>(),
        vec![copy_x.clone()],
        "돌고 있는 복사본은 Windows 가 지우기를 거절해야 한다"
    );

    // ── 호스트가 내려가면 옛 복사본이 지워진다 ──────────────────────────
    let resp = app.request(Request::Shutdown).await.expect("shutdown");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    drop(app);
    drop(events);
    wait_until(
        "복사본 호스트가 끝난다",
        Duration::from_secs(30),
        || !alive(host_pid),
    )
    .await;
    let mut removed = Vec::new();
    wait_until(
        "옛 복사본이 지워진다",
        Duration::from_secs(10),
        || {
            removed.extend(stage::prune(&stage_dir, &copy_y).removed);
            !removed.is_empty()
        },
    )
    .await;
    assert_eq!(removed, vec![copy_x.clone()]);
    assert_eq!(names(&stage_dir), vec![file_name(&copy_y)]);

    done.store(true, Ordering::SeqCst);
}

// ─── 복사본을 못 쓰면 원본으로 ───────────────────────────────────────────────

/// 복사본을 만들 수 없는 자리(파일 밑)면 **원본으로 물러선다** — 세션이 아예 안 뜨는 것보다
/// 업데이트 생존만 잃는 편이 낫다. 이유가 남는다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn when_the_copy_cannot_be_made_the_original_serves() {
    let _serial = SERIAL.lock().await;
    let done = watchdog("ptyhost_update_survival fallback", Duration::from_secs(240));

    let root = tempfile::tempdir().unwrap();
    let install = root.path().join("install");
    fs::create_dir_all(&install).unwrap();
    let exe = install.join("ocul-pm.exe");
    fs::copy(APP, &exe).unwrap();
    let blocker = root.path().join("a-file");
    fs::write(&blocker, b"").unwrap();
    let stage_dir = blocker.join("ptyhost-dev");
    let appdata = root.path().join("roaming").join("com.test.ocul-pm");
    fs::create_dir_all(&appdata).unwrap();
    let socket = appdata.join("ptyhost-dev.sock");

    let (app, origin) = launch(&exe, Some(&stage_dir), &socket, |_| {}, &PATIENT)
        .await
        .expect("원본으로라도 뜬다");
    let _host = ShutdownOnDrop(socket.clone());
    let HostOrigin::Original { why } = origin else {
        panic!("복사본을 만들 수 없는 자리인데 복사본이라고 한다: {origin:?}");
    };
    assert!(why.contains("failed to copy the executable"), "{why}");
    assert!(same_file(&server_image(&socket).await, &exe));
    // 원본 호스트도 제 할 일을 한다.
    let resp = app
        .request(Request::Attach { sid: SID.into() })
        .await
        .expect("attach");
    assert!(
        matches!(resp, Response::Attach { attach: None }),
        "{resp:?}"
    );

    let resp = app.request(Request::Shutdown).await.expect("shutdown");
    assert!(matches!(resp, Response::Ok), "{resp:?}");
    drop(app);
    tokio::time::sleep(Duration::from_millis(2500)).await;
    done.store(true, Ordering::SeqCst);
}

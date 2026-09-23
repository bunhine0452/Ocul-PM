//! Windows 전송 — Unix 도메인 소켓의 자리를 **네임드 파이프**로 (#pty-transport).
//!
//! 자리 규칙은 OS 와 무관하게 [`super::client`] 가 소유한다: 정식 자리
//! `<app_data>/ptyhost[-dev].sock`, 옛 자리, 빌드 격리, 프로토콜을 이름에 담지 않는
//! 것까지. 이 모듈은 그 **경로를 파이프 이름으로 바꾸는 한 겹**이다. 같은 경로는
//! 언제나 같은 이름이 되므로 업데이트를 건너도 자리가 그대로고, 경로가 곧
//! 신원이라 호스트 로그 폴더(`경로.parent()/logs`)도 유닉스와 같은 곳에 남는다.
//!
//! 파이프 이름공간(`\\.\pipe\`)은 **기계 전역**이다. 파일 소켓은 앱 데이터 폴더의
//! 권한이 막아 주던 것을 여기서는 셋으로 직접 막는다.
//!
//! 1. **사용자별 이름.** 이름에 현재 사용자 SID 를 해시해 넣는다 — 같은 PC 의 다른
//!    사용자와 자리가 겹치지 않는다. 관리자 권한(승격)으로 뜬 앱은 **따로 센다**:
//!    승격된 호스트에 보통 권한의 앱이 붙으면 그 앱이 여는 셸이 조용히 관리자
//!    셸이 된다.
//! 2. **현재 사용자 전용 보안 기술자.** 파이프의 기본 DACL 은 Everyone 에게 읽기를
//!    준다 — 남이 붙어 터미널 출력(이벤트)을 받아 볼 수 있다. 사용자 SID 하나에만
//!    전권을 주고, 승격된 호스트는 무결성 레이블 High 로 그보다 낮은 프로세스의
//!    읽기·쓰기를 막는다.
//! 3. **남의 파이프에 붙지 않는다.** 전역 이름공간이라 누구든 우리 이름으로 먼저
//!    파이프를 만들 수 있다. 붙은 뒤 서버 프로세스의 사용자 SID 를 확인하고 다르면
//!    끊는다. 호스트는 `first_pipe_instance` 로 남이 만든 이름에 인스턴스를 보태지
//!    않는다.

use std::ffi::{c_void, OsStr};
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio::net::windows::named_pipe::{
    ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, LocalFree, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, HANDLE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, TokenElevation, TokenUser, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// 서버가 인스턴스를 전부 접속에 내준 찰나(`ERROR_PIPE_BUSY`)를 기다려 주는 상한.
/// 호스트는 접속을 받자마자 다음 인스턴스를 만들므로 정상이면 마이크로초다.
const BUSY_WAIT: Duration = Duration::from_secs(1);

/// 호스트가 뜰 때 같은 이름을 **비켜 주는 중인** 옛 호스트를 기다리는 상한.
///
/// 빈 옛 호스트를 교체하는 길(`client::retire`)은 `Shutdown` 의 응답을 받은 뒤 곧바로
/// 새 호스트를 띄운다. 유닉스는 응답 전에 소켓 파일을 지워 자리가 즉시 비지만,
/// 파이프 이름은 **마지막 인스턴스가 닫힐 때** 사라진다 — 옛 호스트가 받는 인스턴스를
/// 닫고 앱의 접속이 끊기기까지 잠깐이 걸린다. 앱의 접속 재시도(3초) 안에 끝나야 한다.
const VACATE_WAIT: Duration = Duration::from_secs(2);

/// 경로(정식·옛 자리) → 파이프 이름. 순수 함수 — 사용자와 승격 여부를 인자로 받는다.
///
/// **이 규칙이 곧 자리다.** 해시 입력이나 모양을 바꾸면 업데이트한 앱이 옛 호스트를
/// 못 찾는다 — 유닉스에서 소켓 이름에 프로토콜을 담았다가 업데이트가 세션을 끊은
/// 사고(v2.34.0)와 같은 자리다. 바꿔야 한다면 옛 규칙을 옛 자리로 남길 것.
/// `the_pipe_name_is_pinned` 가 지킨다.
///
/// 경로는 소문자로 접는다 — Windows 경로는 대소문자를 가리지 않고, 같은 폴더를
/// 다른 대소문자로 받았다고 자리가 갈리면 안 된다.
pub fn pipe_name_for(socket: &Path, user_sid: &str, elevated: bool) -> String {
    let stem = socket
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("ptyhost");
    let mut hasher = blake3::Hasher::new();
    hasher.update(user_sid.as_bytes());
    hasher.update(b"\n");
    hasher.update(socket.to_string_lossy().to_lowercase().as_bytes());
    let hash = hasher.finalize().to_hex();
    let admin = if elevated { "-admin" } else { "" };
    format!(r"\\.\pipe\ocul-pm-{stem}{admin}-{}", &hash[..16])
}

/// 파이프의 보안 기술자(SDDL). 순수 함수.
///
/// - `D:P(A;;GA;;;<SID>)` — 상속을 끊은 DACL, 현재 사용자 SID 하나에 전권.
///   다음 인스턴스를 만드는 권한(`FILE_CREATE_PIPE_INSTANCE`)도 여기 들어 있다.
/// - 승격된 호스트는 `S:(ML;;NWNR;;;HI)` — 무결성 High. 그보다 낮은 프로세스는
///   쓰지도(접속해 명령을 보내지도) 읽지도(터미널 출력을 받지도) 못한다.
pub fn sddl_for(user_sid: &str, elevated: bool) -> String {
    let label = if elevated { "S:(ML;;NWNR;;;HI)" } else { "" };
    format!("D:P(A;;GA;;;{user_sid}){label}")
}

/// 이 프로세스의 신원 — 사용자 SID 와 승격 여부.
pub struct Identity {
    user: TokenUserBuf,
    /// `S-1-5-21-…` 문자열 — 이름 해시와 SDDL 이 쓴다.
    pub sid: String,
    pub elevated: bool,
}

impl Identity {
    /// 이 프로세스의 신원. 토큰은 프로세스 수명 동안 바뀌지 않으므로 한 번만 읽는다.
    pub fn current() -> io::Result<&'static Identity> {
        static CURRENT: OnceLock<Result<Identity, String>> = OnceLock::new();
        CURRENT
            .get_or_init(|| read_identity().map_err(|e| e.to_string()))
            .as_ref()
            .map_err(|e| io::Error::other(format!("failed to read the process token: {e}")))
    }

    /// `socket` 경로에 해당하는 이 사용자의 파이프 이름.
    pub fn pipe_name(&self, socket: &Path) -> String {
        pipe_name_for(socket, &self.sid, self.elevated)
    }
}

fn read_identity() -> io::Result<Identity> {
    // SAFETY: GetCurrentProcess 는 닫을 필요 없는 의사 핸들을 돌려준다.
    let me = unsafe { GetCurrentProcess() };
    let user = token_user(me)?;
    let sid = sid_string(user.sid())?;
    let elevated = token_elevated(me)?;
    Ok(Identity {
        user,
        sid,
        elevated,
    })
}

/// `TOKEN_USER` 와 그 뒤에 붙는 SID 를 함께 담는 버퍼. `u64` 로 잡아 구조체
/// 정렬(포인터 8바이트)을 맞춘다. SID 포인터는 이 버퍼 **안**을 가리키고, 힙
/// 메모리는 `Vec` 이 옮겨져도 제자리라 안전하다.
struct TokenUserBuf(Vec<u64>);

impl TokenUserBuf {
    fn sid(&self) -> PSID {
        // SAFETY: 버퍼는 GetTokenInformation(TokenUser) 가 채운 TOKEN_USER 로 시작한다.
        unsafe { (*(self.0.as_ptr() as *const TOKEN_USER)).User.Sid }
    }
}

/// 프로세스 토큰을 열어 `f` 에 넘기고 닫는다.
fn with_token<T>(process: HANDLE, f: impl FnOnce(HANDLE) -> io::Result<T>) -> io::Result<T> {
    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: 출력 포인터는 살아 있는 지역 변수다.
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = f(token);
    // SAFETY: 위에서 연 토큰 핸들을 한 번만 닫는다.
    unsafe { CloseHandle(token) };
    result
}

fn token_user(process: HANDLE) -> io::Result<TokenUserBuf> {
    with_token(process, |token| {
        let mut len = 0u32;
        // SAFETY: 길이만 묻는 호출 — 버퍼 없이 필요한 크기를 `len` 에 받는다.
        unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len) };
        if len == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        // SAFETY: 버퍼는 `len` 바이트 이상이다.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr() as *mut c_void,
                len,
                &mut len,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(TokenUserBuf(buf))
    })
}

fn token_elevated(process: HANDLE) -> io::Result<bool> {
    with_token(process, |token| {
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        // SAFETY: 출력 버퍼는 TOKEN_ELEVATION 크기의 지역 변수다.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut TOKEN_ELEVATION as *mut c_void,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(elevation.TokenIsElevated != 0)
    })
}

fn sid_string(sid: PSID) -> io::Result<String> {
    let mut raw: *mut u16 = std::ptr::null_mut();
    // SAFETY: `sid` 는 유효한 SID 를 가리킨다. 돌려받은 문자열은 LocalFree 로 놓는다.
    if unsafe { ConvertSidToStringSidW(sid, &mut raw) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: NUL 로 끝나는 UTF-16 문자열이다.
    let text = unsafe {
        let len = (0..).take_while(|&i| *raw.add(i) != 0).count();
        String::from_utf16_lossy(std::slice::from_raw_parts(raw, len))
    };
    // SAFETY: ConvertSidToStringSidW 가 LocalAlloc 으로 잡은 것이다.
    unsafe { LocalFree(raw as *mut c_void) };
    Ok(text)
}

/// 호스트가 만드는 인스턴스들의 보안 기술자 — 모든 인스턴스가 같은 것을 쓴다.
pub struct PipeSecurity(PSECURITY_DESCRIPTOR);

// SAFETY: 만든 뒤로는 읽기만 하는 LocalAlloc 메모리다 — 스레드를 옮겨도 된다.
unsafe impl Send for PipeSecurity {}
unsafe impl Sync for PipeSecurity {}

impl PipeSecurity {
    pub fn from_sddl(sddl: &str) -> io::Result<Self> {
        let wide: Vec<u16> = OsStr::new(sddl).encode_wide().chain(Some(0)).collect();
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: NUL 로 끝나는 문자열, 출력 포인터는 지역 변수.
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(sd))
    }

    /// 이 사용자의 호스트용 — [`sddl_for`] 그대로.
    pub fn for_identity(me: &Identity) -> io::Result<Self> {
        Self::from_sddl(&sddl_for(&me.sid, me.elevated))
    }

    /// 인스턴스 하나를 만든다. `first` 면 이 이름의 **첫** 인스턴스여야 한다 —
    /// 이미 있으면 `ERROR_ACCESS_DENIED` 로 실패한다(남의 파이프에 끼어들지 않는다).
    pub fn create_instance(&self, name: &str, first: bool) -> io::Result<NamedPipeServer> {
        let mut attrs = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        };
        // SAFETY: `attrs` 는 유효한 SECURITY_ATTRIBUTES 이고 호출 동안 살아 있다.
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    name,
                    &mut attrs as *mut SECURITY_ATTRIBUTES as *mut c_void,
                )
        }
    }
}

impl Drop for PipeSecurity {
    fn drop(&mut self) {
        // SAFETY: ConvertStringSecurityDescriptorToSecurityDescriptorW 가 잡은 것이다.
        unsafe { LocalFree(self.0) };
    }
}

fn is_os_error(e: &io::Error, code: u32) -> bool {
    e.raw_os_error() == Some(code as i32)
}

/// 이 파이프 너머의 서버가 **우리 사용자**의 프로세스인가.
fn server_is_ours(pipe: HANDLE, me: &Identity) -> io::Result<()> {
    let mut pid = 0u32;
    // SAFETY: 살아 있는 파이프 핸들, 출력은 지역 변수.
    if unsafe { GetNamedPipeServerProcessId(pipe, &mut pid) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: 실패하면 null 이다 — 아래에서 가른다.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("the pty-host pipe is served by a process we cannot inspect (pid {pid})"),
        ));
    }
    let owner = token_user(process);
    // SAFETY: 위에서 연 핸들을 한 번만 닫는다.
    unsafe { CloseHandle(process) };
    let owner = owner?;
    // SAFETY: 두 SID 모두 살아 있는 버퍼 안을 가리킨다.
    if unsafe { EqualSid(owner.sid(), me.user.sid()) } == 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("the pty-host pipe is served by another user's process (pid {pid})"),
        ));
    }
    Ok(())
}

/// 앱 쪽 접속 — 이 경로의 파이프에 붙고, 서버가 우리 사용자인지 확인한다.
/// 호스트가 없으면(`NotFound`) 그대로 에러 — 부르는 쪽이 다음 자리로 넘어간다.
pub async fn connect(socket: &Path) -> io::Result<NamedPipeClient> {
    let me = Identity::current()?;
    let name = me.pipe_name(socket);
    let deadline = Instant::now() + BUSY_WAIT;
    let client = loop {
        match ClientOptions::new().open(&name) {
            Ok(client) => break client,
            Err(e) if is_os_error(&e, ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Err(e) => return Err(e),
        }
    };
    server_is_ours(client.as_raw_handle() as HANDLE, me)?;
    Ok(client)
}

/// 내려가라고 한 호스트의 자리가 **실제로 빌 때까지** 기다린다 — 빈 옛 호스트를
/// 교체하는 길(`client::retire`) 전용.
///
/// 유닉스 호스트는 `Shutdown` 에 답하기 **전에** 소켓 파일을 지워, 답을 받은 앱이 곧바로
/// 띄운 새 호스트가 빈 자리에 앉는다. 파이프는 이름이 인스턴스와 같이 살고, 옛 호스트는
/// 받기 루프가 비운 것을 알아챈 뒤에야 받는 인스턴스를 닫는다. 그 사이에 새 호스트가
/// 뜨면 옛 호스트를 "살아 있는 호스트" 로 보고 물러나고, 앱은 곧 내려갈 옛 호스트에
/// 붙는다. 그래서 이름이 사라진 것(`NotFound`)을 보고 나서 띄운다. 상한이 지나면 그냥
/// 간다 — 새 호스트의 [`claim`] 이 한 번 더 기다린다.
pub async fn wait_until_vacant(socket: &Path) {
    let Ok(me) = Identity::current() else {
        return;
    };
    let name = me.pipe_name(socket);
    let deadline = Instant::now() + VACATE_WAIT;
    while Instant::now() < deadline {
        match ClientOptions::new().open(&name) {
            Err(e) if is_os_error(&e, ERROR_FILE_NOT_FOUND) => return,
            // 아직 받는다(곧 닫는다) 또는 붙어 있던 접속이 끝나기를 기다리는 중.
            _ => tokio::time::sleep(Duration::from_millis(25)).await,
        }
    }
}

/// 호스트가 자리를 잡은 결과.
pub struct Claimed {
    pub name: String,
    pub security: PipeSecurity,
    /// 첫 인스턴스 — 접속을 기다리는 중이다.
    pub first: NamedPipeServer,
}

/// 호스트가 이 경로의 자리를 잡는다. `Ok(None)` = 살아서 받고 있는 호스트가
/// 이미 있다 — 유닉스 `serve` 의 "먼저 뜬 쪽이 승자" 와 같은 자리다.
///
/// 파이프에는 시체가 없다(이름은 마지막 인스턴스와 함께 사라진다). 대신 **비켜 주는
/// 중인** 호스트가 있다: 받는 인스턴스는 닫았고 붙어 있던 접속이 끝나기를 기다리는
/// 상태 — 이름은 아직 있는데 접속은 `ERROR_PIPE_BUSY` 다. 그때는 [`VACATE_WAIT`]
/// 까지 기다렸다 다시 잡는다.
pub async fn claim(socket: &Path) -> Result<Option<Claimed>, String> {
    let me = Identity::current().map_err(|e| e.to_string())?;
    let name = me.pipe_name(socket);
    let security = PipeSecurity::for_identity(me)
        .map_err(|e| format!("failed to build the pipe security descriptor: {e}"))?;
    let deadline = Instant::now() + VACATE_WAIT;
    loop {
        let taken = match security.create_instance(&name, true) {
            Ok(first) => {
                return Ok(Some(Claimed {
                    name,
                    security,
                    first,
                }))
            }
            Err(e) if is_os_error(&e, ERROR_ACCESS_DENIED) => e,
            Err(e) => return Err(format!("failed to create the pty-host pipe: {e}")),
        };
        // 이 이름의 파이프가 이미 있다. 누가, 어떤 상태로 쥐고 있는지 두드려 본다.
        match ClientOptions::new().open(&name) {
            Ok(probe) => {
                // 살아서 받고 있다. 우리 사용자의 호스트면 우리는 필요 없다 — 남의
                // 것이면 조용히 물러나지 않고 말한다(앱이 붙어도 거절할 자리다).
                return server_is_ours(probe.as_raw_handle() as HANDLE, me)
                    .map(|()| None)
                    .map_err(|e| format!("the pty-host pipe name is taken: {e}"));
            }
            Err(e)
                if (is_os_error(&e, ERROR_PIPE_BUSY) || is_os_error(&e, ERROR_FILE_NOT_FOUND))
                    && Instant::now() < deadline =>
            {
                // 비켜 주는 중이거나 방금 사라졌다 — 잠깐 뒤 다시.
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => {
                return Err(format!(
                    "the pty-host pipe name is held and not answering: {taken} / {e}"
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **자리는 고정이다.** 해시 규칙이 바뀌면 업데이트한 앱이 옛 호스트를 못 찾는다.
    /// 이 값이 바뀌어야 한다면 옛 규칙을 옛 자리로 남기고 이 줄을 고칠 것.
    #[test]
    fn the_pipe_name_is_pinned() {
        let socket = Path::new(r"C:\Users\me\AppData\Roaming\com.kimhyunbin.ocul-pm\ptyhost.sock");
        assert_eq!(
            pipe_name_for(socket, "S-1-5-21-1-2-3-1001", false),
            PINNED_NAME,
        );
    }

    const PINNED_NAME: &str = r"\\.\pipe\ocul-pm-ptyhost-8c6cf66a68c66bce";

    /// 프로토콜은 이름에 없다 — 경로의 줄기(stem)와 해시뿐이다.
    #[test]
    fn the_pipe_name_does_not_carry_the_protocol() {
        let name = pipe_name_for(Path::new(r"C:\x\ptyhost-dev.sock"), "S-1-5-21-9", false);
        assert!(name.starts_with(r"\\.\pipe\ocul-pm-ptyhost-dev-"), "{name}");
        assert!(
            !name.contains(&format!("v{}", super::super::protocol::PROTO_VERSION)),
            "{name}"
        );
    }

    /// 사용자·승격·빌드(경로)마다 자리가 갈린다. 대소문자는 가르지 않는다.
    #[test]
    fn pipe_names_split_by_user_elevation_and_path() {
        let path = Path::new(r"C:\Users\me\AppData\Roaming\app\ptyhost.sock");
        let base = pipe_name_for(path, "S-1-5-21-1", false);
        assert_ne!(
            base,
            pipe_name_for(path, "S-1-5-21-2", false),
            "다른 사용자"
        );
        let admin = pipe_name_for(path, "S-1-5-21-1", true);
        assert_ne!(base, admin, "승격");
        assert!(admin.contains("-admin-"), "{admin}");
        assert_ne!(
            base,
            pipe_name_for(
                Path::new(r"C:\Users\me\AppData\Roaming\app\ptyhost-dev.sock"),
                "S-1-5-21-1",
                false
            ),
            "dev 빌드"
        );
        assert_eq!(
            base,
            pipe_name_for(
                Path::new(r"c:\users\ME\appdata\roaming\APP\ptyhost.sock"),
                "S-1-5-21-1",
                false
            ),
            "같은 폴더를 다른 대소문자로 받아도 같은 자리다"
        );
    }

    /// 보안 기술자 — 사용자 하나에 전권, 승격이면 무결성 High.
    #[test]
    fn sddl_grants_only_the_user() {
        assert_eq!(sddl_for("S-1-5-21-7", false), "D:P(A;;GA;;;S-1-5-21-7)");
        assert_eq!(
            sddl_for("S-1-5-21-7", true),
            "D:P(A;;GA;;;S-1-5-21-7)S:(ML;;NWNR;;;HI)"
        );
    }

    /// 실제 토큰을 읽는다 — CI 러너에서 이 경로가 도는지.
    #[test]
    fn reads_this_process_identity() {
        let me = Identity::current().expect("토큰을 읽는다");
        assert!(me.sid.starts_with("S-1-"), "{}", me.sid);
    }

    /// 두 보안 기술자(보통·승격 중 이 프로세스에 맞는 것)로 실제 파이프를 만들고
    /// 붙을 수 있어야 한다 — SDDL 이 틀리면 호스트가 뜨지 못하거나 앱이 못 붙는다.
    #[tokio::test]
    async fn a_pipe_with_our_descriptor_admits_us() {
        let me = Identity::current().unwrap();
        let mut variants = vec![false];
        if me.elevated {
            variants.push(true);
        }
        for elevated in variants {
            let dir = tempfile::tempdir().unwrap();
            let name = pipe_name_for(&dir.path().join("t.sock"), &me.sid, elevated);
            let security = PipeSecurity::from_sddl(&sddl_for(&me.sid, elevated)).unwrap();
            let server = security.create_instance(&name, true).expect("만든다");
            let client = ClientOptions::new().open(&name).expect("우리는 붙는다");
            server.connect().await.expect("받는다");
            server_is_ours(client.as_raw_handle() as HANDLE, me).expect("우리 서버다");
            // 첫 인스턴스가 있는 이름에 또 "첫" 인스턴스는 못 만든다 — 남의 이름에
            // 끼어들지 않는 장치.
            let again = security.create_instance(&name, true).unwrap_err();
            assert!(is_os_error(&again, ERROR_ACCESS_DENIED), "{again}");
        }
    }
}

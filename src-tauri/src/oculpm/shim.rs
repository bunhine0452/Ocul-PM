//! 세션 전용 심 디렉터리 — **에이전트의 손에 `oculpm` 을 쥐여 준다**
//! (플랜 `session-shim-cli`, block/buzz `crates/buzz-dev-mcp/src/shim.rs` 차용).
//!
//! 두 가지를 푼다.
//!
//! **① MCP 를 안 쓰는 에이전트도 기록한다.** 지금은 MCP 가 없으면 AGENTS.md
//! 규격대로 파일을 직접 쓰라고 부탁하는 수밖에 없다 — 템플릿의 §2(파일 규격)가
//! 매 세션 토큰을 무는 이유가 그것이다. PATH 에 `oculpm` 이 있으면 한 줄이다.
//!
//! **② 신원.** `agent.id` 는 여태 에이전트가 프롬프트에서 **자칭**하는 값이었다.
//! 심 디렉터리에 세션 토큰을 두면 프로세스가 자기를 증명한다 — 우리가 띄운
//! 세션만 그 파일을 읽을 수 있기 때문이다.
//!
//! ## PATH 를 우리가 덮어쓰지 않는 이유
//!
//! Finder 로 띄운 `.app` 의 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이다
//! ([`acp::env`](crate::acp::env)가 로그인 셸을 띄워 PATH 를 받아오는 이유).
//! 그 PATH 로 사용자의 터미널을 열면 brew·nvm 이 통째로 사라진다. 그래서
//! **터미널에는 `OCULPM_SHIM_DIR` 만 넘기고**, 셸 통합 스크립트가 사용자 rc 가
//! 끝난 뒤 그 값을 PATH 앞에 붙인다. 우리가 만든 PATH 를 강요하지 않는다.
//!
//! 우리가 직접 띄우는 자식(ACP 어댑터)은 로그인 셸 PATH 를 이미 알고 있으므로
//! 그 앞에 붙여 넘긴다.
//!
//! ## 수명
//!
//! 디렉터리는 앱 데이터 아래 세션 id 별로 산다. 세션이 끝나면 지우고, 앱이 뜰
//! 때 남은 것을 걷는다 — 프로세스가 죽어 정리 경로를 못 지나간 경우가 있기
//! 때문이다 (이 저장소의 고아 프로세스 일지들이 그 이야기다).
//!
//! ## OS 별 (크로스플랫폼 라운드 `#shell-shim`)
//!
//! - **Windows**: 심은 `oculpm.exe` 다. 심링크(개발자 모드) → **하드 링크**(권한
//!   불필요, 같은 볼륨이면 즉시·공간 0) → 복사본 순. `oculpm.cmd` 는 두지 않는다 —
//!   셸은 PATHEXT 로 `oculpm.exe` 를 바로 찾고, 배치 파일은 `%*` 로 넘긴 인자를
//!   cmd 규칙으로 다시 해석해 에이전트가 넘기는 JSON(따옴표·`&`·`%`)을 망가뜨린다
//!   (CVE-2024-24576 "BatBadBut" 의 그 자리). 셸이 넘기는 argv0 는 `…\oculpm.exe`
//!   이거나(PowerShell·Git Bash) 친 그대로 `oculpm`(cmd)이라 둘 다 심으로 본다.
//! - **Linux AppImage**: `current_exe()` 는 실행 중에만 있는 squashfs 마운트
//!   (`/tmp/.mount_XXXX/usr/bin/…`) 안이다. 심은 마운트 밖의 `$APPIMAGE` 를
//!   가리키고, 그 경로로 들어온 호출의 원래 argv0 는 AppImage 런타임이 `$ARGV0`
//!   에 실어 준다 (D10).
//! - PATH 목록 구분자는 OS 규칙(`;` / `:`)이다.

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::write_atomic;

/// 앱 데이터 아래 심 뿌리.
pub const SHIM_SUBDIR: &str = "shim";

/// 심이 노출하는 이름. 에이전트가 치는 명령어이자 심링크 파일명이다.
pub const SHIM_BIN: &str = "oculpm";

/// 토큰 파일명 (심 디렉터리 안).
pub const TOKEN_FILE: &str = "session.json";

/// 심 디렉터리를 가리키는 환경변수 — 셸 통합이 PATH 에 붙일 때 읽는다.
pub const ENV_SHIM_DIR: &str = "OCULPM_SHIM_DIR";

/// 토큰 파일을 가리키는 환경변수. CLI 가 자기 신원을 찾는 1순위.
pub const ENV_TOKEN: &str = "OCULPM_SESSION_TOKEN";

/// **이 세션이 누구인가** — 심 디렉터리에 0600 으로 놓인다.
///
/// 프롬프트로 자칭하는 값이 아니라 우리가 적어 준 값이다. CLI 는 이것을 먼저
/// 믿고, 없을 때만 인자·환경변수로 물러난다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionToken {
    /// 이 세션이 붙어 있는 프로젝트 루트 (절대경로).
    pub project_root: String,
    /// 기록에 남는 이름 — `claude-code` · `codex` …
    ///
    /// **터미널 세션에는 없다.** 셸을 띄우는 시점에는 사용자가 그 안에서
    /// `claude` 를 칠지 `codex` 를 칠지 알 수 없기 때문이다 (에이전트 판정은
    /// 나중에 `agentDetect` 가 도는 프로세스를 보고 한다). 우리가 어댑터를
    /// 직접 띄우는 ACP 세션에만 채운다 — **모르는 것을 적지 않는다.**
    pub agent_id: Option<String>,
    /// ocul-pm 세션 id (있으면). 일지 귀속을 이어 붙일 때 쓴다.
    pub session_id: Option<String>,
}

/// 설치된 심 한 벌.
#[derive(Debug, Clone)]
pub struct SessionShim {
    pub dir: PathBuf,
    pub token_path: PathBuf,
}

impl SessionShim {
    /// 자식에게 넘길 환경변수 — PATH 는 건드리지 않는다 (모듈 문서 참조).
    pub fn env_pairs(&self) -> Vec<(String, String)> {
        vec![
            (ENV_SHIM_DIR.to_string(), self.dir.display().to_string()),
            (ENV_TOKEN.to_string(), self.token_path.display().to_string()),
        ]
    }

    /// 우리가 직접 띄우는 자식용 — 주어진 PATH 앞에 심을 붙인다.
    pub fn prepend_path(&self, base: &str) -> String {
        let sep = if cfg!(windows) { ';' } else { ':' };
        format!("{}{sep}{base}", self.dir.display())
    }
}

/// 심 파일 이름 — Windows 는 셸이 PATHEXT 로 찾도록 `.exe` 를 붙인다.
fn shim_file_name() -> &'static str {
    if cfg!(windows) {
        "oculpm.exe"
    } else {
        SHIM_BIN
    }
}

/// 심이 가리킬 실행 파일. 순수 함수 — AppImage 안이면 마운트 밖의 `$APPIMAGE`.
///
/// `appimage` 는 `$APPIMAGE` 값과 그 파일이 실제로 있는지다 (없는 경로를
/// 가리키는 값은 무시하고 `current_exe` 로 — 모르는 것을 믿지 않는다).
fn shim_target(current_exe: PathBuf, appimage: Option<(PathBuf, bool)>) -> PathBuf {
    match appimage {
        Some((path, true)) if cfg!(target_os = "linux") && path.is_absolute() => path,
        _ => current_exe,
    }
}

/// 이 프로세스의 [`shim_target`].
fn system_shim_target() -> io::Result<PathBuf> {
    let appimage = std::env::var_os("APPIMAGE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .map(|p| {
            let exists = p.is_file();
            (p, exists)
        });
    Ok(shim_target(std::env::current_exe()?, appimage))
}

/// 심을 어떻게 걸었는가 — 로그와 테스트용.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    /// 이미 있던 것을 그대로 썼다.
    Existing,
    Symlink,
    /// Windows — 심링크 권한이 없을 때.
    HardLink,
    /// Windows — 다른 볼륨이라 하드 링크도 안 될 때.
    Copy,
}

fn session_dir(app_data: &Path, session_id: &str) -> PathBuf {
    app_data.join(SHIM_SUBDIR).join(sanitize(session_id))
}

/// 세션 id 는 파일명이 된다 — 경로 구분자와 `..` 를 지운다.
fn sanitize(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "session".to_string()
    } else {
        cleaned
    }
}

#[cfg(unix)]
fn set_owner_only(path: &Path, dir: bool) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if dir { 0o700 } else { 0o600 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path, _dir: bool) -> io::Result<()> {
    // 윈도우는 ACL 이라 mode 비트가 없다. 앱 데이터 디렉터리 자체가 사용자
    // 프로필 아래라 기본 권한이 이미 사용자 한정이다.
    Ok(())
}

/// `exe` 로 `oculpm` 심을 건다 (이미 있으면 그대로).
///
/// 윈도우는 심링크에 권한이 필요하므로(개발자 모드/관리자) 실패하면 하드 링크,
/// 그것도 안 되면(다른 볼륨) **복사본**으로 물러난다. 그것도 안 되면 호출부가
/// 심 없이 세션을 띄운다 — 심은 부가 기능이고, 이것 때문에 터미널이 안 뜨는
/// 쪽이 훨씬 나쁘다.
fn link_to(dir: &Path, exe: &dyn Fn() -> io::Result<PathBuf>) -> io::Result<(PathBuf, LinkKind)> {
    let target = dir.join(shim_file_name());
    if target.exists() {
        return Ok((target, LinkKind::Existing));
    }
    // 실행 파일은 걸 때만 찾는다 — 이미 걸린 심에는 `current_exe` 가 필요 없다.
    let kind = link_or_copy(&exe()?, &target)?;
    Ok((target, kind))
}

#[cfg(unix)]
fn link_or_copy(exe: &Path, target: &Path) -> io::Result<LinkKind> {
    std::os::unix::fs::symlink(exe, target).map(|()| LinkKind::Symlink)
}

#[cfg(windows)]
fn link_or_copy(exe: &Path, target: &Path) -> io::Result<LinkKind> {
    if std::os::windows::fs::symlink_file(exe, target).is_ok() {
        return Ok(LinkKind::Symlink);
    }
    if std::fs::hard_link(exe, target).is_ok() {
        return Ok(LinkKind::HardLink);
    }
    std::fs::copy(exe, target).map(|_| LinkKind::Copy)
}

/// 이 세션의 심을 깔고(멱등) 토큰을 적는다.
pub fn install(app_data: &Path, session_id: &str, token: &SessionToken) -> io::Result<SessionShim> {
    install_with(app_data, session_id, token, &system_shim_target).map(|(shim, _)| shim)
}

/// [`install`] 의 본체 — 심이 가리킬 실행 파일을 인자로 받는다. 통합 테스트가
/// 빌드된 앱 바이너리(`CARGO_BIN_EXE_ocul-pm`)로 진짜 심을 걸어 보는 자리.
#[doc(hidden)]
pub fn install_pointing_at(
    app_data: &Path,
    session_id: &str,
    token: &SessionToken,
    exe: &Path,
) -> io::Result<(SessionShim, LinkKind)> {
    install_with(app_data, session_id, token, &|| Ok(exe.to_path_buf()))
}

fn install_with(
    app_data: &Path,
    session_id: &str,
    token: &SessionToken,
    exe: &dyn Fn() -> io::Result<PathBuf>,
) -> io::Result<(SessionShim, LinkKind)> {
    let dir = session_dir(app_data, session_id);
    std::fs::create_dir_all(&dir)?;
    set_owner_only(&dir, true)?;
    let (_, kind) = link_to(&dir, exe)?;

    let token_path = dir.join(TOKEN_FILE);
    let body = serde_json::to_vec_pretty(token).map_err(io::Error::other)?;
    write_atomic(&token_path, &body).map_err(|e| io::Error::other(e.to_string()))?;
    set_owner_only(&token_path, false)?;

    Ok((SessionShim { dir, token_path }, kind))
}

/// 세션이 끝났다 — 심을 지운다.
pub fn remove(app_data: &Path, session_id: &str) {
    let _ = std::fs::remove_dir_all(session_dir(app_data, session_id));
}

/// 앱이 뜰 때 남은 심을 걷는다.
///
/// 세션이 정리 경로를 못 지나가고 죽는 일이 있다 — 그때 토큰 파일이 디스크에
/// 남아 있으면 다음 세션이 남의 신원을 주울 수 있다. 지금 도는 세션 id 목록을
/// 받아 **그 밖의 것만** 지운다.
pub fn sweep(app_data: &Path, live: &[String]) -> usize {
    let root = app_data.join(SHIM_SUBDIR);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return 0;
    };
    let keep: std::collections::HashSet<String> = live.iter().map(|s| sanitize(s)).collect();
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| !keep.contains(&e.file_name().to_string_lossy().to_string()))
        .filter(|e| std::fs::remove_dir_all(e.path()).is_ok())
        .count()
}

/// **이 프로세스는 누구인가** — CLI 가 자기 신원을 찾는 길.
///
/// 순서가 곧 신뢰 순서다:
///
/// 1. `OCULPM_SESSION_TOKEN` 이 가리키는 파일 — 우리가 띄운 세션.
/// 2. 실행된 심링크 **옆**의 토큰 — 환경변수가 벗겨져도(`env -i` 같은) 심을
///    거쳐 들어왔다는 사실 자체가 신원이다.
///
/// 둘 다 없으면 `None` — 그때 CLI 는 자칭을 허용하되 `unverified` 로 남긴다.
pub fn resolve_token(argv0: Option<&str>) -> Option<SessionToken> {
    let from_env = std::env::var_os(ENV_TOKEN).map(PathBuf::from);
    let argv0 = effective_argv0(argv0);
    resolve_token_from(from_env.as_deref(), argv0.as_deref())
}

/// 환경변수를 **인자로** 받는 판정. `resolve_token` 은 프로세스 환경을 읽어
/// 이걸 부른다 — 테스트가 진짜 세션 토큰(ocul-pm 터미널 안에서 `cargo test` 를
/// 돌리면 `OCULPM_SESSION_TOKEN` 이 실제로 서 있다)을 주워 오지 않게 하려고
/// 환경을 읽는 자리를 하나로 모았다.
fn resolve_token_from(env_token: Option<&Path>, argv0: Option<&str>) -> Option<SessionToken> {
    if let Some(path) = env_token {
        if let Some(token) = read_token(path) {
            return Some(token);
        }
    }
    let beside = beside_dir(argv0?, cfg!(target_os = "macos"))?.join(TOKEN_FILE);
    read_token(&beside)
}

/// 심 옆 토큰을 찾을 디렉터리 — argv0 의 부모.
///
/// macOS 는 예전 그대로다(D3). 그 밖의 OS 에서는 **절대 경로의 부모만** 믿는다:
/// 친 이름 그대로 넘어온 argv0(`oculpm` — cmd.exe·bash 가 그렇게 넘긴다)의
/// "부모" 는 빈 경로, 곧 작업 폴더라서, 프로젝트에 놓인 `session.json` 하나가
/// 신원이 되어 버린다.
fn beside_dir(argv0: &str, trust_relative: bool) -> Option<PathBuf> {
    let parent = Path::new(argv0).parent()?;
    (trust_relative || parent.is_absolute()).then(|| parent.to_path_buf())
}

/// **심을 거쳐 들어왔는가** — argv0 의 파일명이 심 이름(`oculpm`)인가.
///
/// 심은 CLI 표면이다. 이 이름으로 들어온 호출은 낱말이 무엇이든 CLI 로 끝나야
/// 한다. `main` 이 모르는 낱말을 GUI 로 흘려보내면 에이전트의 오타 하나가
/// **두 번째 앱 인스턴스**를 띄운다 — 2026-09-08 에 전역 훅에 남아 있던
/// `oculpm hook pretooluse`(구현된 적 없는 낱말)가 편집마다 창을 띄우고
/// 5초 훅 타임아웃에 죽었다. 사용자 눈에는 "창이 떴다가 알아서 꺼진다" 였다.
///
/// Windows 는 `oculpm.exe` 도(대소문자 무관) 심이다 — PowerShell·Git Bash 는
/// 찾은 전체 경로(`…\oculpm.exe`)를 argv0 로 넘긴다. AppImage 안이면 원래
/// argv0 는 `$ARGV0` 에 있다 (모듈 문서).
pub fn invoked_as_shim(argv0: Option<&str>) -> bool {
    let argv0 = effective_argv0(argv0);
    is_shim_name(argv0.as_deref().unwrap_or_default(), cfg!(windows))
}

/// argv0 가 심 이름인가. 순수 함수 — `windows` 로 두 규칙을 한 러너에서 본다.
fn is_shim_name(argv0: &str, windows: bool) -> bool {
    if !windows {
        return Path::new(argv0)
            .file_name()
            .is_some_and(|name| name == SHIM_BIN);
    }
    let name = argv0
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(argv0)
        .to_ascii_lowercase();
    name == SHIM_BIN || name == "oculpm.exe"
}

/// 이 호출의 원래 argv0. Linux AppImage 안이면 런타임이 넘긴 `$ARGV0`.
fn effective_argv0(argv0: Option<&str>) -> Option<String> {
    if cfg!(target_os = "linux") {
        let appimage = std::env::var_os("APPIMAGE");
        let original = std::env::var_os("ARGV0");
        if let Some(original) = appimage_argv0(appimage.as_deref(), original.as_deref()) {
            return Some(original);
        }
    }
    argv0.map(str::to_string)
}

/// AppImage 런타임이 실어 준 원래 argv0 — `$APPIMAGE` 와 `$ARGV0` 가 둘 다 있을 때만.
fn appimage_argv0(appimage: Option<&OsStr>, argv0: Option<&OsStr>) -> Option<String> {
    appimage.filter(|v| !v.is_empty())?;
    argv0
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string_lossy().into_owned())
}

/// 이 경로에서 위로 올라가며 **추적 중인 프로젝트 루트**를 찾는다.
///
/// 터미널은 아무 데서나 열릴 수 있다 — `cwd` 가 곧 프로젝트 루트라는 보장이
/// 없으므로 토큰에는 찾아낸 루트를 적는다. 못 찾으면 `None` 이고, 그때는
/// 토큰에 프로젝트를 적지 않는다(모르는 것을 적지 않는다는 같은 규율).
pub fn tracked_root(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|dir| dir.join(".oculpm").is_dir())
        .map(Path::to_path_buf)
}

/// **여기서 도는데 저기에 쓰려는가** — 명시된 root 와 지금 서 있는 자리가 서로
/// 다른 추적 프로젝트면 그 다른 프로젝트를 돌려준다.
///
/// `~/.codex/config.toml` 처럼 **머신 전역**인 설정에 `--root` 를 박아 두면 모든
/// 세션이 그 항목을 싣는다. 2026-09-04 에 실제로 유튜브 프로젝트의 Codex 세션이
/// 이 저장소에 일지를 썼다 — 서버는 cwd 가 유튜브인 채로 `--root ai-pm` 으로 떠
/// 있었다. cwd 가 추적 프로젝트가 아니면(패키징된 앱은 `/` 에서 뜬다) 판단하지
/// 않는다 — 모르는 것으로 남을 막지 않는다.
pub fn conflicting_tracked_root(explicit_root: &Path, cwd: &Path) -> Option<PathBuf> {
    let here = tracked_root(cwd)?;
    let here = here.canonicalize().unwrap_or(here);
    let there = explicit_root
        .canonicalize()
        .unwrap_or_else(|_| explicit_root.to_path_buf());
    (here != there).then_some(here)
}

fn read_token(path: &Path) -> Option<SessionToken> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn token() -> SessionToken {
        SessionToken {
            project_root: "/tmp/p".into(),
            agent_id: Some("codex".into()),
            session_id: Some("20260903-001".into()),
        }
    }

    #[test]
    fn install_is_idempotent_and_leaves_a_readable_token() {
        let app = TempDir::new().unwrap();
        let first = install(app.path(), "sess-1", &token()).unwrap();
        let again = install(app.path(), "sess-1", &token()).unwrap();
        assert_eq!(first.dir, again.dir);
        assert_eq!(read_token(&first.token_path), Some(token()));
        assert!(first.dir.join(shim_file_name()).exists());
    }

    /// **심 이름으로 들어왔는가**가 CLI 냐 GUI 냐를 가른다.
    ///
    /// 앱 바이너리(`ocul-pm`)로 들어온 호출은 GUI 로 가야 하고 — Finder 가
    /// 붙이는 `-psn_…` 때문에 — 심(`oculpm`)으로 들어온 호출은 낱말이
    /// 무엇이든 CLI 로 끝나야 한다 (2026-09-08 의 유령 창).
    #[test]
    fn only_the_shim_name_means_the_cli() {
        assert!(invoked_as_shim(Some("/x/shim/sess-1/oculpm")));
        assert!(invoked_as_shim(Some("oculpm")));
        assert!(!invoked_as_shim(Some(
            "/Applications/ocul-pm.app/Contents/MacOS/ocul-pm"
        )));
        assert!(!invoked_as_shim(Some(
            "/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp"
        )));
        assert!(!invoked_as_shim(Some("")));
        assert!(!invoked_as_shim(None));
    }

    /// 세션 id 는 파일명이 된다 — 경로를 담아 보내도 밖으로 나가지 못한다.
    #[test]
    fn a_session_id_cannot_escape_the_shim_root() {
        let app = TempDir::new().unwrap();
        let shim = install(app.path(), "../../etc/passwd", &token()).unwrap();
        assert!(shim.dir.starts_with(app.path().join(SHIM_SUBDIR)));
    }

    /// 남은 심을 걷되 **도는 세션은 건드리지 않는다.**
    #[test]
    fn sweep_removes_only_what_is_no_longer_live() {
        let app = TempDir::new().unwrap();
        install(app.path(), "alive", &token()).unwrap();
        install(app.path(), "ghost", &token()).unwrap();

        assert_eq!(sweep(app.path(), &["alive".to_string()]), 1);
        assert!(app.path().join(SHIM_SUBDIR).join("alive").exists());
        assert!(!app.path().join(SHIM_SUBDIR).join("ghost").exists());
    }

    /// 환경변수가 없어도 **심을 거쳐 들어왔다는 사실**이 신원이 된다.
    #[test]
    fn the_token_is_found_beside_the_symlink_without_env() {
        let app = TempDir::new().unwrap();
        let shim = install(app.path(), "sess-2", &token()).unwrap();
        let argv0 = shim.dir.join(SHIM_BIN).display().to_string();
        assert_eq!(resolve_token_from(None, Some(&argv0)), Some(token()));
        assert_eq!(resolve_token_from(None, Some("/usr/bin/oculpm")), None);
    }

    /// 환경변수가 있으면 그쪽이 먼저다 — 심 옆 토큰은 그 다음 차례.
    #[test]
    fn the_env_token_outranks_the_one_beside_the_symlink() {
        let app = TempDir::new().unwrap();
        let beside = install(app.path(), "sess-4", &token()).unwrap();
        let other = SessionToken {
            project_root: "/tmp/other".into(),
            agent_id: Some("claude-code".into()),
            session_id: None,
        };
        let env_shim = install(app.path(), "sess-5", &other).unwrap();
        let argv0 = beside.dir.join(SHIM_BIN).display().to_string();
        assert_eq!(
            resolve_token_from(Some(&env_shim.token_path), Some(&argv0)),
            Some(other)
        );
    }

    #[test]
    fn path_is_prepended_never_replaced() {
        let app = TempDir::new().unwrap();
        let shim = install(app.path(), "sess-3", &token()).unwrap();
        let merged = shim.prepend_path("/usr/local/bin:/usr/bin");
        assert!(merged.starts_with(&shim.dir.display().to_string()));
        assert!(merged.ends_with("/usr/local/bin:/usr/bin"));
        // OS 구분자로 이어 붙였다 — split_paths 의 첫 항목이 심 디렉터리다.
        assert_eq!(
            std::env::split_paths(&merged).next(),
            Some(shim.dir.clone())
        );
    }

    /// Windows 는 `oculpm.exe` 도 심이다 (PowerShell·Git Bash 가 넘기는 전체 경로).
    /// 유닉스 규칙은 예전 그대로 — `oculpm` 한 이름뿐.
    #[test]
    fn shim_names_per_os() {
        for argv0 in [
            r"C:\Users\u\AppData\Roaming\x\shim\s1\oculpm.exe",
            r"C:\x\OCULPM.EXE",
            "oculpm",
            "/c/Users/u/shim/s1/oculpm.exe",
        ] {
            assert!(is_shim_name(argv0, true), "{argv0}");
        }
        for argv0 in [
            r"C:\Program Files\Ocul-PM\ocul-pm.exe",
            r"C:\x\oculpm-mcp.exe",
            r"C:\x\oculpm.cmd",
            "",
        ] {
            assert!(!is_shim_name(argv0, true), "{argv0}");
        }
        assert!(is_shim_name("/x/shim/s1/oculpm", false));
        assert!(!is_shim_name("/x/shim/s1/oculpm.exe", false));
    }

    /// AppImage 런타임의 `$ARGV0` 는 `$APPIMAGE` 와 함께일 때만 믿는다.
    #[test]
    fn appimage_argv0_needs_both_variables() {
        let img = Some(OsStr::new("/home/u/Apps/Ocul-PM.AppImage"));
        assert_eq!(
            appimage_argv0(img, Some(OsStr::new("oculpm"))).as_deref(),
            Some("oculpm")
        );
        assert_eq!(appimage_argv0(None, Some(OsStr::new("oculpm"))), None);
        assert_eq!(
            appimage_argv0(Some(OsStr::new("")), Some(OsStr::new("oculpm"))),
            None
        );
        assert_eq!(appimage_argv0(img, None), None);
    }

    /// AppImage 안이면 심은 마운트 밖의 `$APPIMAGE` 를 가리킨다 (Linux 만).
    #[test]
    fn shim_target_prefers_an_existing_appimage_on_linux() {
        let exe = PathBuf::from("/tmp/.mount_abc/usr/bin/ocul-pm");
        let image = std::env::temp_dir().join("Ocul-PM.AppImage");
        let picked = shim_target(exe.clone(), Some((image.clone(), true)));
        if cfg!(target_os = "linux") {
            assert_eq!(picked, image);
        } else {
            assert_eq!(picked, exe);
        }
        // 없는 파일·상대 경로는 믿지 않는다.
        assert_eq!(shim_target(exe.clone(), Some((image, false))), exe);
        assert_eq!(
            shim_target(exe.clone(), Some((PathBuf::from("Ocul-PM.AppImage"), true))),
            exe
        );
        assert_eq!(shim_target(exe.clone(), None), exe);
    }

    /// 친 이름 그대로의 argv0(`oculpm`)로는 작업 폴더의 `session.json` 을 줍지
    /// 않는다 (macOS 는 예전 그대로).
    #[test]
    fn a_bare_argv0_does_not_read_a_token_from_the_working_directory() {
        let dir = TempDir::new().unwrap();
        let abs = dir.path().join("oculpm");
        assert_eq!(
            beside_dir(&abs.display().to_string(), false),
            Some(dir.path().to_path_buf())
        );
        assert_eq!(beside_dir("oculpm", false), None);
        assert_eq!(beside_dir("oculpm", true), Some(PathBuf::new()));
    }

    /// Windows 의 심은 심링크 → 하드 링크 → 복사본. 러너(관리자)는 심링크가
    /// 되므로, 권한 없는 사용자가 타는 하드 링크 길 — **실행 중인** 실행 파일에
    /// 거는 링크 — 을 따로 확인한다 (앱은 자기 자신에게 건다).
    #[cfg(windows)]
    #[test]
    fn windows_a_running_exe_can_be_hard_linked() {
        let dir = TempDir::new().unwrap();
        let exe = std::env::current_exe().unwrap();
        let target = dir.path().join("oculpm.exe");
        std::fs::hard_link(&exe, &target).expect("실행 중인 exe 에 하드 링크");
        assert_eq!(
            std::fs::metadata(&target).unwrap().len(),
            std::fs::metadata(&exe).unwrap().len()
        );
        let (shim, kind) =
            install_pointing_at(dir.path(), "s-link", &token(), &exe).expect("심 설치");
        eprintln!("windows 심 방식: {kind:?}");
        assert!(shim.dir.join("oculpm.exe").is_file());
        assert_ne!(kind, LinkKind::Existing);
    }

    /// 전역 설정에 박힌 root 는 남의 프로젝트에 쓴다 — 그 자리를 이름으로 짚는다.
    #[test]
    fn a_pinned_root_conflicts_with_a_different_tracked_cwd() {
        let dir = TempDir::new().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        for p in [&a, &b] {
            std::fs::create_dir_all(p.join(".oculpm")).unwrap();
        }
        assert_eq!(
            conflicting_tracked_root(&a, &b).map(|p| p
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()),
            Some("b".to_string())
        );
        // 같은 프로젝트(하위 폴더 포함)는 충돌이 아니다.
        let sub = a.join("src");
        std::fs::create_dir_all(&sub).unwrap();
        assert_eq!(conflicting_tracked_root(&a, &a), None);
        assert_eq!(conflicting_tracked_root(&a, &sub), None);
        // 추적 프로젝트가 아닌 자리에서는 판단하지 않는다.
        let loose = dir.path().join("loose");
        std::fs::create_dir_all(&loose).unwrap();
        assert_eq!(conflicting_tracked_root(&a, &loose), None);
    }
}

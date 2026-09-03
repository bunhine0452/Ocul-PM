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
        format!("{}:{base}", self.dir.display())
    }
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

/// 자기 실행 파일로 `oculpm` 심링크를 건다.
///
/// 윈도우는 심링크에 권한이 필요하므로(개발자 모드/관리자) 실패하면 **복사본**
/// 으로 물러난다. 그것도 안 되면 심 없이 세션을 띄운다 — 심은 부가 기능이고,
/// 이것 때문에 터미널이 안 뜨는 쪽이 훨씬 나쁘다.
fn link_self(dir: &Path) -> io::Result<PathBuf> {
    let target = dir.join(if cfg!(windows) {
        "oculpm.exe"
    } else {
        SHIM_BIN
    });
    if target.exists() {
        return Ok(target);
    }
    let exe = std::env::current_exe()?;
    link_or_copy(&exe, &target)?;
    Ok(target)
}

#[cfg(unix)]
fn link_or_copy(exe: &Path, target: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(exe, target)
}

#[cfg(windows)]
fn link_or_copy(exe: &Path, target: &Path) -> io::Result<()> {
    // 윈도우는 심링크에 권한이 필요하다(개발자 모드/관리자) — 안 되면 복사본.
    std::os::windows::fs::symlink_file(exe, target)
        .or_else(|_| std::fs::copy(exe, target).map(|_| ()))
}

/// 이 세션의 심을 깔고(멱등) 토큰을 적는다.
pub fn install(app_data: &Path, session_id: &str, token: &SessionToken) -> io::Result<SessionShim> {
    let dir = session_dir(app_data, session_id);
    std::fs::create_dir_all(&dir)?;
    set_owner_only(&dir, true)?;
    link_self(&dir)?;

    let token_path = dir.join(TOKEN_FILE);
    let body = serde_json::to_vec_pretty(token).map_err(io::Error::other)?;
    write_atomic(&token_path, &body).map_err(|e| io::Error::other(e.to_string()))?;
    set_owner_only(&token_path, false)?;

    Ok(SessionShim { dir, token_path })
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
    if let Ok(path) = std::env::var(ENV_TOKEN) {
        if let Some(token) = read_token(Path::new(&path)) {
            return Some(token);
        }
    }
    let beside = Path::new(argv0?).parent()?.join(TOKEN_FILE);
    read_token(&beside)
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
        assert!(first.dir.join(SHIM_BIN).exists() || cfg!(windows));
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
        assert_eq!(resolve_token(Some(&argv0)), Some(token()));
        assert_eq!(resolve_token(Some("/usr/bin/oculpm")), None);
    }

    #[test]
    fn path_is_prepended_never_replaced() {
        let app = TempDir::new().unwrap();
        let shim = install(app.path(), "sess-3", &token()).unwrap();
        let merged = shim.prepend_path("/usr/local/bin:/usr/bin");
        assert!(merged.starts_with(&shim.dir.display().to_string()));
        assert!(merged.ends_with("/usr/local/bin:/usr/bin"));
    }
}

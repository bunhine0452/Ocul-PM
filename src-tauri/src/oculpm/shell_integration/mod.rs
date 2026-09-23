//! 터미널 셸 통합 — 명령 경계(OSC 133)와 작업 디렉터리를 앱이 알게 한다.
//!
//! # 왜 ZDOTDIR 우회를 쓰지 않는가
//!
//! VS Code 는 zsh 를 자체 임시 디렉터리(ZDOTDIR)로 띄우고 `.zshenv`/`.zshrc`/
//! `.zprofile`/`.zlogin` shim 4개에서 사용자 파일을 대신 source 한다. 이 방식은
//! 실패했을 때 "통합이 안 됨"이 아니라 **"터미널을 아예 못 씀"** 등급의 사고가
//! 된다 — 소싱 순서를 잘못 재현하면 PATH(nvm/homebrew/asdf)가 뒤바뀌고,
//! HISTFILE 이 ZDOTDIR 을 따라가 히스토리가 갈라지며, `${ZDOTDIR:-$HOME}` 를
//! 읽는 프레임워크(zim/zinit)가 앱 임시 경로를 가리킨다. VS Code 도 이 문제를
//! 수년째 이슈로 안고 있다.
//!
//! # 대신 쓰는 것: 비활성 한 줄
//!
//! 사용자 rc 에 심는 것은 아래 한 줄이 전부다.
//!
//! ```sh
//! [ -n "$OCULPM_SHELL_INTEGRATION" ] && [ -r "$OCULPM_SHELL_INTEGRATION" ] && . "$OCULPM_SHELL_INTEGRATION"
//! ```
//!
//! `OCULPM_SHELL_INTEGRATION` 은 ocul-pm 의 PTY 만 설정한다. 따라서 이 줄은
//! iTerm2·Terminal.app·다른 앱의 셸에서 **아무 일도 하지 않는다**. 설치 실패의
//! 최대 피해가 "통합이 안 켜짐" 으로 묶인다.
//!
//! PowerShell(Windows·Linux)도 같은 규율이다 — `$PROFILE.CurrentUserAllHosts` 에
//! 같은 모양의 비활성 한 줄을 심고, 사용자 프로필을 대신 실행하지 않는다
//! ([`powershell`] 모듈 문서). macOS 의 pwsh 는 예전처럼 "미지원" 이다(D3).
//!
//! 쓰기는 [`atomic_io::write_managed_block`] 을 쓰므로 멱등이고, 블록 밖 사용자
//! 콘텐츠를 보존하며 [`uninstall`] 로 완전히 되돌릴 수 있다. `.gitignore` 관리
//! 블록(`manager::init_project`)과 정확히 같은 기계장치다.

mod default_shell;
mod powershell;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};
use crate::oculpm::spec::CommentStyle;

pub use default_shell::{resolve_default_shell, HostOs, ShellFacts};

/// 관리 블록 식별자 — `.gitignore`/`AGENTS.md` 와 같은 값을 쓴다.
const BLOCK_ID: &str = "oculpm";

/// 앱 데이터 안의 스크립트 보관 폴더 (프로젝트 밖 — 여러 프로젝트가 공유한다).
const SCRIPT_DIR: &str = "shell-integration";

const ZSH_SCRIPT: &str = include_str!("templates/oculpm.zsh");
const BASH_SCRIPT: &str = include_str!("templates/oculpm.bash");
const PWSH_SCRIPT: &str = include_str!("templates/oculpm.ps1");

/// 우리가 지원하는 셸. 그 외는 조용히 통합을 건너뛴다(터미널은 정상 동작).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ShellKind {
    Zsh,
    Bash,
    /// Windows PowerShell 5.1 · PowerShell 7+ (Windows·Linux). macOS 에서는 미지원.
    #[serde(rename = "powershell")]
    PowerShell,
    /// fish·nu·cmd 등 — 통합 미지원.
    Unsupported,
}

impl ShellKind {
    fn script(self) -> Option<&'static str> {
        match self {
            ShellKind::Zsh => Some(ZSH_SCRIPT),
            ShellKind::Bash => Some(BASH_SCRIPT),
            ShellKind::PowerShell => Some(PWSH_SCRIPT),
            ShellKind::Unsupported => None,
        }
    }

    fn file_name(self) -> Option<&'static str> {
        match self {
            ShellKind::Zsh => Some("oculpm.zsh"),
            ShellKind::Bash => Some("oculpm.bash"),
            ShellKind::PowerShell => Some("oculpm.ps1"),
            ShellKind::Unsupported => None,
        }
    }
}

/// PTY 를 띄울 때 쓰는 셸 경로. 설정 화면의 상태 표시와 실제 PTY 가 **같은**
/// 값을 봐야 "설치됨"이 거짓말이 되지 않으므로, 두 곳이 이 함수를 공유한다.
///
/// 판정 규칙은 [`resolve_default_shell`] (순수 함수, OS 별 표).
pub fn current_shell() -> String {
    default_shell::system_default_shell()
}

/// `$SHELL` 경로에서 셸 종류를 판정한다 — 이 빌드가 도는 OS 기준.
///
/// basename 만 보고 판단하며, `-zsh` 같은 로그인 셸 argv0 표기와 버전 접미사
/// (`bash-5.2`)도 받아준다.
pub fn detect_shell_kind(shell_path: &str) -> ShellKind {
    detect_shell_kind_for(HostOs::current(), shell_path)
}

/// [`detect_shell_kind`] 의 순수판 — OS 를 인자로 받는다.
pub fn detect_shell_kind_for(os: HostOs, shell_path: &str) -> ShellKind {
    let base = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell_path)
        .trim_start_matches('-');
    let stem = base.split('-').next().unwrap_or(base);
    match stem {
        "zsh" => ShellKind::Zsh,
        "bash" | "sh" => ShellKind::Bash,
        _ if os != HostOs::MacOs && powershell::is_powershell(shell_path) => ShellKind::PowerShell,
        _ => ShellKind::Unsupported,
    }
}

/// rc 에 심는 관리 블록 본문. zsh/bash 는 POSIX `.` 만 쓴다.
fn rc_block_body(kind: ShellKind) -> String {
    if kind == ShellKind::PowerShell {
        return powershell::block_body();
    }
    [
        "# ocul-pm 터미널 셸 통합 — 명령 경계·종료코드·작업 디렉터리를 앱에 알립니다.",
        "# OCULPM_SHELL_INTEGRATION 은 ocul-pm 이 띄운 터미널에서만 설정되므로,",
        "# 다른 터미널에서 이 줄은 아무 일도 하지 않습니다. 제거는 앱 설정에서.",
        "[ -n \"$OCULPM_SHELL_INTEGRATION\" ] && [ -r \"$OCULPM_SHELL_INTEGRATION\" ] && . \"$OCULPM_SHELL_INTEGRATION\"",
    ]
    .join("\n")
}

/// 스크립트를 앱 데이터에 멱등하게 쓴다. 반환값은 그 절대경로.
///
/// 내용이 이미 같으면 디스크를 건드리지 않는다 (셸을 띄울 때마다 불리므로
/// 불필요한 쓰기를 피한다).
pub fn materialize_script(app_data_dir: &Path, kind: ShellKind) -> OculpmResult<Option<PathBuf>> {
    let (Some(script), Some(name)) = (kind.script(), kind.file_name()) else {
        return Ok(None);
    };
    let path = app_data_dir.join(SCRIPT_DIR).join(name);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if existing == script {
            return Ok(Some(path));
        }
    }
    atomic_io::write_atomic(&path, script.as_bytes())?;
    Ok(Some(path))
}

/// 설치 상태. UI 가 "설치 / 제거" 버튼 상태를 정하는 데 쓴다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ShellIntegrationStatus {
    /// `$SHELL` 로 판정한 셸 종류.
    pub shell: ShellKind,
    /// rc 에 우리 관리 블록이 있다.
    pub installed: bool,
    /// rc 절대경로 (지원 셸이 아니면 빈 문자열).
    pub rc_path: String,
    /// 앱이 심는 스크립트 절대경로 (지원 셸이 아니면 빈 문자열).
    pub script_path: String,
    /// rc 에 begin/end 중 하나만 있어 쓰기가 막힌 상태 — 사용자가 손으로
    /// 고쳐야 한다. 이 경우 install 은 실패한다(파일 손상 방지가 우선).
    pub block_broken: bool,
}

/// rc 파일이 사는 뿌리들. zsh/bash 는 홈, PowerShell 은 문서 폴더(Windows)나
/// XDG 설정 폴더(Linux) — 테스트는 전부 임시 폴더로 바꿔 끼운다.
#[derive(Debug, Clone)]
pub(crate) struct RcLocations {
    pub(crate) home: PathBuf,
    /// Windows 의 알려진 폴더 "문서" (OneDrive 로 옮겨졌으면 그 자리).
    pub(crate) documents: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME` 또는 `~/.config`.
    pub(crate) config: Option<PathBuf>,
}

impl RcLocations {
    /// 이 머신의 진짜 자리. macOS 는 홈만 쓴다 (PowerShell 미지원 — 예전 그대로).
    pub(crate) fn system(home: &Path) -> Self {
        if cfg!(target_os = "macos") {
            return RcLocations {
                home: home.to_path_buf(),
                documents: None,
                config: None,
            };
        }
        RcLocations {
            home: home.to_path_buf(),
            documents: directories::UserDirs::new()
                .and_then(|dirs| dirs.document_dir().map(Path::to_path_buf)),
            config: directories::BaseDirs::new().map(|dirs| dirs.config_dir().to_path_buf()),
        }
    }
}

/// 이 셸의 rc(프로필) 절대경로.
fn rc_path_for(
    os: HostOs,
    loc: &RcLocations,
    kind: ShellKind,
    shell_path: &str,
) -> Option<PathBuf> {
    match kind {
        ShellKind::Zsh => Some(loc.home.join(".zshrc")),
        ShellKind::Bash => Some(loc.home.join(".bashrc")),
        ShellKind::PowerShell => {
            powershell::profile_path(os, powershell::edition_of(os, shell_path), loc)
        }
        ShellKind::Unsupported => None,
    }
}

/// 현재 설치 상태를 읽는다. 파일을 만들거나 고치지 않는다.
pub fn status(home: &Path, app_data_dir: &Path, shell_path: &str) -> ShellIntegrationStatus {
    status_in(
        HostOs::current(),
        &RcLocations::system(home),
        app_data_dir,
        shell_path,
    )
}

/// [`status`] 의 본체 — OS 와 rc 자리를 인자로 받는다.
pub(crate) fn status_in(
    os: HostOs,
    loc: &RcLocations,
    app_data_dir: &Path,
    shell_path: &str,
) -> ShellIntegrationStatus {
    let shell = detect_shell_kind_for(os, shell_path);
    let rc = rc_path_for(os, loc, shell, shell_path);
    let script = shell
        .file_name()
        .map(|n| app_data_dir.join(SCRIPT_DIR).join(n));

    let (installed, block_broken) = match rc.as_deref() {
        Some(path) => match atomic_io::read_managed_block(path, BLOCK_ID, CommentStyle::Hash) {
            Ok(Some(_)) => (true, false),
            Ok(None) => (false, false),
            // begin/end 짝이 안 맞으면 쓰기가 거부된다 — UI 에 알려야 한다.
            Err(OculpmError::ManagedBlockMismatch { .. }) => (false, true),
            Err(_) => (false, false),
        },
        None => (false, false),
    };

    ShellIntegrationStatus {
        shell,
        installed,
        rc_path: rc.map(|p| p.display().to_string()).unwrap_or_default(),
        script_path: script.map(|p| p.display().to_string()).unwrap_or_default(),
        block_broken,
    }
}

/// rc 에 관리 블록을 심는다 (멱등). 지원하지 않는 셸이면 에러.
pub fn install(home: &Path, app_data_dir: &Path, shell_path: &str) -> OculpmResult<()> {
    install_in(
        HostOs::current(),
        &RcLocations::system(home),
        app_data_dir,
        shell_path,
        &powershell::effective_execution_policy,
    )
}

/// [`install`] 의 본체. `policy` 는 PowerShell 에게 실효 실행 정책을 묻는 함수
/// (Windows 에서만 불린다 — 테스트는 가짜를 넘긴다).
pub(crate) fn install_in(
    os: HostOs,
    loc: &RcLocations,
    app_data_dir: &Path,
    shell_path: &str,
    policy: &dyn Fn(&str) -> Option<String>,
) -> OculpmResult<()> {
    let kind = detect_shell_kind_for(os, shell_path);
    let unsupported = || {
        OculpmError::InvalidConfig(format!(
            "Shell integration does not support this shell: {shell_path}"
        ))
    };
    if kind == ShellKind::Unsupported {
        return Err(unsupported());
    }
    let rc = rc_path_for(os, loc, kind, shell_path).ok_or_else(|| {
        OculpmError::InvalidConfig(format!(
            "Could not find where {shell_path} keeps its profile (the Documents or config folder is missing)."
        ))
    })?;
    if kind == ShellKind::PowerShell {
        powershell::preflight(os, shell_path, &rc, policy)?;
    }
    materialize_script(app_data_dir, kind)?;
    atomic_io::write_managed_block(&rc, BLOCK_ID, &rc_block_body(kind), CommentStyle::Hash)?;
    Ok(())
}

/// rc 에서 관리 블록을 걷어낸다 (없으면 no-op). 스크립트 파일은 다른 프로젝트가
/// 공유할 수 있으므로 지우지 않는다.
pub fn uninstall(home: &Path, shell_path: &str) -> OculpmResult<()> {
    uninstall_in(HostOs::current(), &RcLocations::system(home), shell_path)
}

/// [`uninstall`] 의 본체.
pub(crate) fn uninstall_in(os: HostOs, loc: &RcLocations, shell_path: &str) -> OculpmResult<()> {
    let kind = detect_shell_kind_for(os, shell_path);
    let Some(rc) = rc_path_for(os, loc, kind, shell_path) else {
        return Ok(());
    };
    atomic_io::remove_managed_block(&rc, BLOCK_ID, CommentStyle::Hash)?;
    if kind == ShellKind::PowerShell {
        powershell::remove_if_blank(&rc)?;
    }
    Ok(())
}

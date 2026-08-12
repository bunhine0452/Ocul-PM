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
//! 쓰기는 [`atomic_io::write_managed_block`] 을 쓰므로 멱등이고, 블록 밖 사용자
//! 콘텐츠를 보존하며 [`uninstall`] 로 완전히 되돌릴 수 있다. `.gitignore` 관리
//! 블록(`manager::init_project`)과 정확히 같은 기계장치다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};
use crate::oculpm::spec::CommentStyle;

/// 관리 블록 식별자 — `.gitignore`/`AGENTS.md` 와 같은 값을 쓴다.
const BLOCK_ID: &str = "oculpm";

/// 앱 데이터 안의 스크립트 보관 폴더 (프로젝트 밖 — 여러 프로젝트가 공유한다).
const SCRIPT_DIR: &str = "shell-integration";

const ZSH_SCRIPT: &str = include_str!("templates/oculpm.zsh");
const BASH_SCRIPT: &str = include_str!("templates/oculpm.bash");

/// 우리가 지원하는 셸. 그 외는 조용히 통합을 건너뛴다(터미널은 정상 동작).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ShellKind {
    Zsh,
    Bash,
    /// fish·nu·pwsh 등 — 통합 미지원.
    Unsupported,
}

impl ShellKind {
    fn script(self) -> Option<&'static str> {
        match self {
            ShellKind::Zsh => Some(ZSH_SCRIPT),
            ShellKind::Bash => Some(BASH_SCRIPT),
            ShellKind::Unsupported => None,
        }
    }

    fn file_name(self) -> Option<&'static str> {
        match self {
            ShellKind::Zsh => Some("oculpm.zsh"),
            ShellKind::Bash => Some("oculpm.bash"),
            ShellKind::Unsupported => None,
        }
    }

    /// 이 셸이 대화형 세션에서 읽는 rc 파일 (홈 기준 상대경로).
    fn rc_rel(self) -> Option<&'static str> {
        match self {
            ShellKind::Zsh => Some(".zshrc"),
            ShellKind::Bash => Some(".bashrc"),
            ShellKind::Unsupported => None,
        }
    }
}

/// PTY 를 띄울 때 쓰는 셸 경로. 설정 화면의 상태 표시와 실제 PTY 가 **같은**
/// 값을 봐야 "설치됨"이 거짓말이 되지 않으므로, 두 곳이 이 함수를 공유한다.
pub fn current_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

/// `$SHELL` 경로에서 셸 종류를 판정한다. 순수 함수 — 테스트 대상.
///
/// basename 만 보고 판단하며, `-zsh` 같은 로그인 셸 argv0 표기와 버전 접미사
/// (`bash-5.2`)도 받아준다.
pub fn detect_shell_kind(shell_path: &str) -> ShellKind {
    let base = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell_path)
        .trim_start_matches('-');
    let stem = base.split('-').next().unwrap_or(base);
    match stem {
        "zsh" => ShellKind::Zsh,
        "bash" | "sh" => ShellKind::Bash,
        _ => ShellKind::Unsupported,
    }
}

/// rc 에 심는 관리 블록 본문. 셸 종류와 무관하게 POSIX `.` 만 쓴다.
fn rc_block_body() -> String {
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

fn rc_path_for(home: &Path, kind: ShellKind) -> Option<PathBuf> {
    kind.rc_rel().map(|rel| home.join(rel))
}

/// 현재 설치 상태를 읽는다. 파일을 만들거나 고치지 않는다.
pub fn status(home: &Path, app_data_dir: &Path, shell_path: &str) -> ShellIntegrationStatus {
    let shell = detect_shell_kind(shell_path);
    let rc = rc_path_for(home, shell);
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
    let kind = detect_shell_kind(shell_path);
    let rc = rc_path_for(home, kind).ok_or_else(|| {
        OculpmError::InvalidConfig(format!("Shell integration does not support this shell: {shell_path}"))
    })?;
    materialize_script(app_data_dir, kind)?;
    atomic_io::write_managed_block(&rc, BLOCK_ID, &rc_block_body(), CommentStyle::Hash)?;
    Ok(())
}

/// rc 에서 관리 블록을 걷어낸다 (없으면 no-op). 스크립트 파일은 다른 프로젝트가
/// 공유할 수 있으므로 지우지 않는다.
pub fn uninstall(home: &Path, shell_path: &str) -> OculpmResult<()> {
    let kind = detect_shell_kind(shell_path);
    let Some(rc) = rc_path_for(home, kind) else {
        return Ok(());
    };
    atomic_io::remove_managed_block(&rc, BLOCK_ID, CommentStyle::Hash)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_zsh_from_common_shell_paths() {
        for path in ["/bin/zsh", "/usr/local/bin/zsh", "-zsh", "zsh"] {
            assert_eq!(detect_shell_kind(path), ShellKind::Zsh, "{path}");
        }
    }

    #[test]
    fn detects_bash_including_versioned_and_sh() {
        for path in ["/bin/bash", "/opt/homebrew/bin/bash-5.2", "-bash", "/bin/sh"] {
            assert_eq!(detect_shell_kind(path), ShellKind::Bash, "{path}");
        }
    }

    #[test]
    fn unsupported_shells_are_skipped_not_guessed() {
        for path in ["/opt/homebrew/bin/fish", "/usr/bin/nu", "pwsh.exe", ""] {
            assert_eq!(detect_shell_kind(path), ShellKind::Unsupported, "{path}");
        }
    }

    /// rc 에 심는 줄은 OCULPM_SHELL_INTEGRATION 이 없으면 아무 일도 하면 안 된다
    /// — 사용자의 다른 터미널을 건드리지 않는다는 설계의 핵심.
    #[test]
    fn rc_block_is_inert_without_the_env_var() {
        let body = rc_block_body();
        assert!(body.contains("[ -n \"$OCULPM_SHELL_INTEGRATION\" ]"));
        assert!(body.contains("[ -r \"$OCULPM_SHELL_INTEGRATION\" ]"));
        // 가드 없이 무조건 실행되는 줄이 섞여 있으면 안 된다.
        for line in body.lines().filter(|l| !l.trim_start().starts_with('#')) {
            assert!(
                line.contains("OCULPM_SHELL_INTEGRATION"),
                "가드 없는 실행 줄: {line}"
            );
        }
    }

    #[test]
    fn materialize_is_idempotent_and_skips_rewrite() {
        let dir = tempfile::tempdir().unwrap();
        let first = materialize_script(dir.path(), ShellKind::Zsh)
            .unwrap()
            .unwrap();
        let mtime1 = std::fs::metadata(&first).unwrap().modified().unwrap();
        let second = materialize_script(dir.path(), ShellKind::Zsh)
            .unwrap()
            .unwrap();
        assert_eq!(first, second);
        let mtime2 = std::fs::metadata(&second).unwrap().modified().unwrap();
        assert_eq!(mtime1, mtime2, "내용이 같으면 다시 쓰지 않아야 한다");
    }

    #[test]
    fn materialize_returns_none_for_unsupported_shell() {
        let dir = tempfile::tempdir().unwrap();
        assert!(materialize_script(dir.path(), ShellKind::Unsupported)
            .unwrap()
            .is_none());
    }

    #[test]
    fn install_preserves_existing_rc_content_and_uninstall_restores_it() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let rc = home.path().join(".zshrc");
        let original = "export PATH=/my/bin:$PATH\nalias ll='ls -la'\n";
        std::fs::write(&rc, original).unwrap();

        install(home.path(), data.path(), "/bin/zsh").unwrap();
        let after = std::fs::read_to_string(&rc).unwrap();
        assert!(after.contains("export PATH=/my/bin:$PATH"));
        assert!(after.contains("alias ll='ls -la'"));
        assert!(after.contains("OCULPM_SHELL_INTEGRATION"));

        // 두 번 설치해도 블록이 하나뿐이어야 한다.
        install(home.path(), data.path(), "/bin/zsh").unwrap();
        let twice = std::fs::read_to_string(&rc).unwrap();
        assert_eq!(twice.matches("oculpm:begin").count(), 1);

        uninstall(home.path(), "/bin/zsh").unwrap();
        let restored = std::fs::read_to_string(&rc).unwrap();
        assert!(!restored.contains("OCULPM_SHELL_INTEGRATION"));
        assert!(restored.contains("alias ll='ls -la'"));
    }

    #[test]
    fn status_reports_installed_state() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();

        let before = status(home.path(), data.path(), "/bin/zsh");
        assert_eq!(before.shell, ShellKind::Zsh);
        assert!(!before.installed);
        assert!(before.rc_path.ends_with(".zshrc"));

        install(home.path(), data.path(), "/bin/zsh").unwrap();
        let after = status(home.path(), data.path(), "/bin/zsh");
        assert!(after.installed);
        assert!(!after.block_broken);
    }

    #[test]
    fn status_flags_a_broken_block_instead_of_claiming_not_installed() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        // begin 만 있고 end 가 없는 상태 — 사용자가 손으로 지운 경우.
        std::fs::write(home.path().join(".zshrc"), "# oculpm:begin v1\necho hi\n").unwrap();
        let st = status(home.path(), data.path(), "/bin/zsh");
        assert!(!st.installed);
        assert!(st.block_broken);
    }

    #[test]
    fn install_rejects_unsupported_shell() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        assert!(install(home.path(), data.path(), "/opt/homebrew/bin/fish").is_err());
    }

    /// 스크립트는 우리 PTY 밖에서 즉시 빠져나가야 하고, 4개 마커를 전부 쏴야 한다.
    #[test]
    fn scripts_guard_on_oculpm_term_and_emit_all_markers() {
        for script in [ZSH_SCRIPT, BASH_SCRIPT] {
            assert!(script.contains("OCULPM_TERM"));
            for marker in ["133;A", "133;B", "133;C", "133;D"] {
                assert!(script.contains(marker), "{marker} 누락");
            }
            assert!(script.contains("nonce"));
            // tmux/screen 에서는 신호가 밖으로 나가지 못하므로 스스로 꺼야 한다.
            assert!(script.contains("TMUX"));
        }
    }
}

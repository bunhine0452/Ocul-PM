//! 플러그인 훅(`plugin/oculpm/hooks/*.sh`)을 **에이전트가 실제로 돌리는 셸**로
//! 띄운다 — 통합 테스트 셋(`acp_journal_gate` · `resume_context` ·
//! `session_verdict`)이 `mod hook_sh;` 로 함께 쓴다 (크로스플랫폼 W2).
//!
//! macOS·Linux 는 `/bin/sh`. Windows 에는 `/bin/sh` 가 없고, Claude Code 는
//! 훅을 **Git Bash** 로 돌린다(Windows 에서 Claude Code 를 쓰려면 Git for
//! Windows 가 전제다) — 그 `sh.exe` 를 찾는다. 예전엔 이 파일들이 `#![cfg(unix)]`
//! 라 Windows 러너에서 0건으로 "통과" 했다.
//!
//! 못 찾으면 건너뛰지 않고 **붉힌다** — 건너뛰면 훅이 검증되지 않은 채 초록이 된다.

use std::path::{Path, PathBuf};

/// 훅을 돌릴 셸.
pub fn sh() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/bin/sh")
    }
    #[cfg(windows)]
    {
        let candidates = git_bash_candidates();
        candidates
            .iter()
            .find(|p| p.is_file())
            .cloned()
            .unwrap_or_else(|| {
                panic!(
                    "Git Bash(sh.exe)를 찾지 못했다 — Claude Code 가 Windows 에서 훅을 도는 \
                     셸이다. Git for Windows 를 설치할 것. 본 자리: {candidates:?}"
                )
            })
    }
}

/// Git for Windows 의 `sh.exe` 가 있을 자리 — 전체 사용자 설치, 사용자별 설치,
/// 그리고 PATH 의 `git.exe`(`<git>\cmd\git.exe` → `<git>\bin\sh.exe`).
#[cfg(windows)]
fn git_bash_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(var) {
            out.push(PathBuf::from(dir).join(r"Git\bin\sh.exe"));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        out.push(PathBuf::from(local).join(r"Programs\Git\bin\sh.exe"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.join("git.exe").is_file() {
                if let Some(root) = dir.parent() {
                    out.push(root.join(r"bin\sh.exe"));
                }
            }
        }
    }
    out
}

/// JSON 문자열 안에 넣을 경로 — Windows 의 `\` 를 이스케이프한다 (에이전트가
/// 보내는 payload 는 올바른 JSON 이다). 다른 OS 에서는 그대로다.
#[allow(dead_code)] // resume_context 는 payload 에 경로를 싣지 않는다.
pub fn json_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
}

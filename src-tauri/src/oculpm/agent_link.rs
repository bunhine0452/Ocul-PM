//! 에이전트와 이어졌는가 — 시작 창의 「Claude Code 를 아직 못 봤어요」 와 설정의 「일지가 안 와요」 진단이
//! 읽는 재료 (love-round #first-run · #no-journal-diagnosis, 11-23).
//!
//! 자식 프로세스도 네트워크도 없다 — 파일이 있는가와 그 수정 시각만 본다. 그래서 「없다」 를 단언하지 않는다:
//! `claude_seen = false` 는 「이 기기에서 아직 흔적을 못 봤다」 이고, 화면도 그렇게 말한다.

use std::ffi::OsStr;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::claude_hooks::INBOX_REL;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentLinkHealth {
    /// 이 기기에서 Claude Code 의 흔적을 봤다 — `~/.claude` 가 있거나 `claude` 실행 파일이 PATH · 공식 설치
    /// 자리에 있다. `false` 여도 「없다」 가 아니다(nvm 같은 곳에 깔고 한 번도 안 돌렸을 수 있다).
    pub claude_seen: bool,
    /// 이 프로젝트에 플러그인 훅 신호가 마지막으로 온 때(RFC 3339 UTC) — 인박스
    /// (`.oculpm/hooks/claude-events.jsonl`)의 수정 시각. `None` 이면 한 번도 안 왔다(또는 프로젝트가 없다).
    pub hook_last_at: Option<String>,
}

/// PATH 의 한 칸에서 찾는 이름 — Windows 는 네이티브판(`.exe`)과 npm 판(`.cmd` · `.ps1`).
const CLAUDE_NAMES: &[&str] = &["claude", "claude.exe", "claude.cmd", "claude.ps1"];

/// [`AgentLinkHealth::claude_seen`] 의 판정 (순수 — 홈과 PATH 값을 받는다).
pub fn claude_seen_in(home: Option<&Path>, path_env: Option<&OsStr>) -> bool {
    if let Some(home) = home {
        if home.join(".claude").is_dir() {
            return true;
        }
        // 공식 네이티브 설치판의 자리 — 세 OS 공통(`~/.local/bin`). Finder 로 뜬 앱의 PATH 에는 없다.
        let local = home.join(".local").join("bin");
        if CLAUDE_NAMES.iter().any(|n| local.join(n).is_file()) {
            return true;
        }
    }
    path_env.is_some_and(|p| {
        std::env::split_paths(p).any(|dir| CLAUDE_NAMES.iter().any(|n| dir.join(n).is_file()))
    })
}

/// [`AgentLinkHealth::hook_last_at`] — 인박스의 수정 시각. 워처가 다 읽은 인박스를 비울 때도 파일은 남고
/// (`compact_inbox` 는 지우지 않고 비운다) 그 일은 훅이 막 쓴 직후에만 일어나, 수정 시각은 마지막 신호와 같다.
pub fn hook_last_at(root: &Path) -> Option<String> {
    let modified = std::fs::metadata(root.join(INBOX_REL))
        .ok()?
        .modified()
        .ok()?;
    let ts = crate::clock::Timestamp::try_from(modified).ok()?;
    Some(crate::clock::rfc3339_z(ts))
}

pub fn health(root: Option<&Path>) -> AgentLinkHealth {
    let home = super::paths::home_dir();
    AgentLinkHealth {
        claude_seen: claude_seen_in(home.as_deref(), std::env::var_os("PATH").as_deref()),
        hook_last_at: root.and_then(hook_last_at),
    }
}

#[cfg(test)]
#[path = "agent_link_tests.rs"]
mod tests;

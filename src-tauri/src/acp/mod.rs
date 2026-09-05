//! ACP(Agent Client Protocol) 클라이언트 서브시스템.
//!
//! 설계 SSOT: [`docs/acp-panel/00-master-plan.md`]. 요약하면 — ocul-pm 이 ACP
//! **클라이언트**가 되어 Claude Code 또는 Codex ACP 어댑터를 띄우고, 그 너머의
//! 에이전트를 앱 안에서 구동한다. 우리는 에이전트를 구현하지 않는다.
//!
//! - [`env`] — node·npm·claude 탐색 (패키징 `.app` 의 빈약한 PATH 대응)
//! - [`adapter`] — 어댑터 npm 패키지 버전 고정 설치
//! - [`journal_gate`] — 앱 안 대화의 생존 흔적 + 기록 판정 (셸 훅이 없는 자리)
//! - [`process`] — 어댑터 프로세스 수명 + 연결 유지 + 이벤트 라우팅
//! - [`recording`] — 대화의 기록 신원(ACP UUID ↔ ocul-pm) + 기록 도구 부착 결과
//! - [`session`] — `session/update` → 프런트 이벤트 매핑
//! - [`turn`] — 대화당 도는 턴 하나 + 어떻게 끝나든 종료 이벤트 (RAII)

use std::path::Path;

use serde::{Deserialize, Serialize};

pub mod adapter;
pub mod env;
pub mod identity;
pub mod journal_gate;
pub mod process;
pub mod recording;
pub mod session;
pub mod turn;

pub use journal_gate::{AcpGateState, AcpObjection};
pub use process::{AcpAgentInfo, AcpState};
pub use recording::{AcpRecordingState, AcpRecordingStatus};
pub use session::AcpEvent;
pub use turn::TurnGuard;

/// ACP backend selected by the client. Serialized spelling is part of the IPC
/// contract, so keep it stable even if adapter package names change.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "snake_case")]
pub enum AcpProvider {
    #[default]
    Claude,
    Codex,
}

impl AcpProvider {
    pub fn state_key(self, project_id: u32) -> u64 {
        (u64::from(project_id) << 1) | u64::from(matches!(self, Self::Codex))
    }

    /// 기록에 남는 이름 (`.oculpm` 일지·플랜의 `agent.id`). 사전에 이미 있는
    /// 어댑터 id 를 그대로 쓴다 — 색·라벨이 그 표에 매여 있다
    /// (`src/features/today/agentColor.ts`).
    pub fn agent_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-code",
            Self::Codex => "codex",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{codex_auth_detected_at, AcpProvider};

    #[test]
    fn provider_state_keys_are_stable_and_isolated() {
        assert_eq!(AcpProvider::Claude.state_key(0), 0);
        assert_eq!(AcpProvider::Codex.state_key(0), 1);
        assert_eq!(AcpProvider::Claude.state_key(42), 84);
        assert_eq!(AcpProvider::Codex.state_key(42), 85);
        assert_ne!(
            AcpProvider::Codex.state_key(41),
            AcpProvider::Claude.state_key(42)
        );
    }

    #[test]
    fn codex_auth_diagnostic_checks_presence_without_reading_credentials() {
        let home = tempfile::tempdir().unwrap();
        assert!(!codex_auth_detected_at(Some(home.path()), false));
        assert!(codex_auth_detected_at(None, true));

        std::fs::write(home.path().join("auth.json"), "not parsed by diagnostics").unwrap();
        assert!(codex_auth_detected_at(Some(home.path()), false));
    }
}

/// 에이전트 화면이 뜨기 전에 무엇이 없는지 알려주기 위한 진단.
///
/// 실패를 "안 됨" 하나로 뭉치지 않는 이유: 사용자가 할 수 있는 조치가 각각
/// 다르다 — Node 설치 / Claude Code 로그인 / 어댑터 설치 버튼.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AcpDiagnostics {
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    /// Node 가 최소 버전 이상인가.
    pub node_ok: bool,
    pub node_min_major: u32,
    /// node 를 어디서 찾았는지 (로그인 셸에서 찾았다면 진단에 그대로 표시).
    pub path_source: Option<env::PathSource>,
    pub npm_path: Option<String>,
    /// 어댑터가 구동할 Claude Code CLI. 없으면 핸드셰이크는 되도 프롬프트가 죽는다.
    pub claude_path: Option<String>,
    /// 그 CLI 를 **어댑터가 들고 온 것**인가 (시스템 설치가 아니라).
    ///
    /// 사용자에게 할 말이 달라진다: 딸려 온 것이면 따로 설치할 게 없고, 시스템
    /// 것이면 그쪽 버전이 오르내리는 것을 우리가 못 막는다.
    pub claude_bundled: bool,
    pub adapter_version: Option<String>,
    pub adapter_expected: String,
    /// 설치돼 있고 고정 버전과 일치하는가.
    pub adapter_ok: bool,
    pub codex_adapter_version: Option<String>,
    pub codex_adapter_expected: String,
    pub codex_adapter_ok: bool,
    /// Credential material exists; values are never read or returned.
    pub codex_auth_detected: bool,
    /// 전부 충족 — 에이전트를 띄울 수 있다.
    pub ready: bool,
    pub codex_ready: bool,
}

/// 현재 머신 상태를 있는 그대로 읽는다. 쓰기 없음.
pub async fn diagnose(app_data: &Path) -> AcpDiagnostics {
    let node = env::resolve_binary("node").await;
    let node_version = match &node {
        Some((path, _)) => env::node_version(path).await,
        None => None,
    };
    let node_ok = node_version
        .as_deref()
        .and_then(env::parse_node_major)
        .is_some_and(|major| major >= env::MIN_NODE_MAJOR);

    let npm = env::resolve_binary("npm").await;

    let adapter_version = adapter::installed_version(app_data);
    let adapter_ok = adapter_version.as_deref() == Some(adapter::PINNED_VERSION);
    let codex_adapter_version = adapter::codex_installed_version(app_data);
    let codex_adapter_ok = codex_adapter_version.as_deref() == Some(adapter::CODEX_PINNED_VERSION);
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|base| base.home_dir().join(".codex")));
    // 어댑터가 받는 키는 둘이다 — `CODEX_API_KEY` 를 빼면 그것만 넣어 둔
    // 사용자가 "인증 없음"으로 표시된다 (실제로는 잘 돈다).
    let api_key_present =
        std::env::var_os("CODEX_API_KEY").is_some() || std::env::var_os("OPENAI_API_KEY").is_some();
    let codex_auth_detected = codex_auth_detected_at(codex_home.as_deref(), api_key_present);

    // **어댑터가 들고 온 것을 먼저 본다.** 어댑터가 실제로 그걸 쓰기 때문이다
    // (`CLAUDE_CODE_EXECUTABLE` 이 없으면 SDK 옆의 네이티브 바이너리를 집는다).
    // 시스템 `claude` 를 먼저 보면, 딸려 온 것으로 멀쩡히 도는 사용자에게
    // "Claude Code 를 설치하세요" 라고 거짓말을 하게 된다.
    let bundled = adapter::bundled_claude(app_data);
    let claude = match bundled {
        Some(path) => Some((path, true)),
        None => env::resolve_binary("claude")
            .await
            .map(|(path, _)| (path, false)),
    };

    AcpDiagnostics {
        node_path: node.as_ref().map(|(p, _)| p.display().to_string()),
        node_version,
        node_ok,
        node_min_major: env::MIN_NODE_MAJOR,
        path_source: node.as_ref().map(|(_, src)| *src),
        npm_path: npm.as_ref().map(|(p, _)| p.display().to_string()),
        claude_path: claude.as_ref().map(|(p, _)| p.display().to_string()),
        claude_bundled: claude.as_ref().is_some_and(|(_, bundled)| *bundled),
        adapter_version,
        adapter_expected: adapter::PINNED_VERSION.to_string(),
        adapter_ok,
        codex_adapter_version,
        codex_adapter_expected: adapter::CODEX_PINNED_VERSION.to_string(),
        codex_adapter_ok,
        codex_auth_detected,
        ready: node_ok && adapter_ok && claude.is_some(),
        codex_ready: node_ok && codex_adapter_ok && codex_auth_detected,
    }
}

fn codex_auth_detected_at(codex_home: Option<&Path>, api_key_present: bool) -> bool {
    api_key_present || codex_home.is_some_and(|path| path.join("auth.json").is_file())
}

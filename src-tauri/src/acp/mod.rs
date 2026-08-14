//! ACP(Agent Client Protocol) 클라이언트 서브시스템.
//!
//! 설계 SSOT: [`docs/acp-panel/00-master-plan.md`]. 요약하면 — ocul-pm 이 ACP
//! **클라이언트**가 되어 `@agentclientprotocol/claude-agent-acp` 어댑터를 띄우고,
//! 그 너머의 Claude Code 를 앱 안에서 에이전트로 구동한다. 우리는 에이전트를
//! 구현하지 않는다.
//!
//! - [`env`] — node·npm·claude 탐색 (패키징 `.app` 의 빈약한 PATH 대응)
//! - [`adapter`] — 어댑터 npm 패키지 버전 고정 설치
//! - [`process`] — 어댑터 프로세스 수명 + 연결 유지 + 이벤트 라우팅
//! - [`session`] — `session/update` → 프런트 이벤트 매핑

use std::path::Path;

use serde::{Deserialize, Serialize};

pub mod adapter;
pub mod env;
pub mod process;
pub mod session;

pub use process::{AcpAgentInfo, AcpState};
pub use session::AcpEvent;

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
    pub adapter_version: Option<String>,
    pub adapter_expected: String,
    /// 설치돼 있고 고정 버전과 일치하는가.
    pub adapter_ok: bool,
    /// 전부 충족 — 에이전트를 띄울 수 있다.
    pub ready: bool,
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
    let claude = env::resolve_binary("claude").await;

    let adapter_version = adapter::installed_version(app_data);
    let adapter_ok = adapter_version.as_deref() == Some(adapter::PINNED_VERSION);

    AcpDiagnostics {
        node_path: node.as_ref().map(|(p, _)| p.display().to_string()),
        node_version,
        node_ok,
        node_min_major: env::MIN_NODE_MAJOR,
        path_source: node.as_ref().map(|(_, src)| *src),
        npm_path: npm.as_ref().map(|(p, _)| p.display().to_string()),
        claude_path: claude.as_ref().map(|(p, _)| p.display().to_string()),
        adapter_version,
        adapter_expected: adapter::PINNED_VERSION.to_string(),
        adapter_ok,
        ready: node_ok && adapter_ok && claude.is_some(),
    }
}

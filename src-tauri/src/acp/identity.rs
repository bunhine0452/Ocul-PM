//! ACP 세션의 **신원과 존재** — 참여자 카드와 세션 심.
//!
//! `process.rs` 에서 갈라져 나왔다 (파일 크기 래칫이 자리를 가리켰다). 셋은
//! 한 가지를 한다: 이 어댑터가 **누구이고 지금 있다**는 것을 앱 밖에 알린다 —
//! 참여자 목록(A2A)에 카드를 올리고, 심 디렉터리에 토큰을 적고, 끝나면 둘 다
//! 거둔다.

use std::path::Path;

use tauri::Manager;

use super::{AcpAgentInfo, AcpProvider};

/// 이 ACP 세션의 심을 깐다 — 실패는 삼킨다 (심이 없어도 세션은 돌아야 한다).
///
/// 터미널과 달리 **`agent_id` 를 적는다**: 우리가 어느 어댑터를 띄우는지 알기
/// 때문이다. 그 값이 있으면 CLI 가 자칭을 덮어쓴다.
pub(super) fn install_session_shim(
    app: &tauri::AppHandle,
    target_id: u64,
    provider: AcpProvider,
    project_root: &Path,
) -> Option<crate::oculpm::shim::SessionShim> {
    use crate::oculpm::shim;
    let dir = app.path().app_data_dir().ok()?;
    let token = shim::SessionToken {
        project_root: project_root.display().to_string(),
        agent_id: Some(provider.agent_id().to_string()),
        session_id: None,
    };
    shim::install(&dir, &format!("acp-{target_id}"), &token)
        .inspect_err(|e| tracing::warn!("ACP 세션 심 설치 실패 — {e}"))
        .ok()
}

/// 이 어댑터를 프로젝트의 **참여자 목록**에 올린다 (A2A Phase 1 · `oculpm::a2a`).
///
/// pid 로 **앱의 것**을 적는다. 어댑터는 우리 자식이라 앱이 죽으면 함께 죽고,
/// 그러면 아래 teardown 이 못 돌더라도 pid 판정이 이 카드를 저절로 죽은 것으로
/// 만든다 — 유령 참여자에게 작업을 넘기는 사고(마스터플랜 R2)가 구조적으로 막힌다.
///
/// 실패는 삼킨다. 참여자 목록은 곁들이는 기능이고, 그것 때문에 에이전트가 안 뜨면
/// 주객이 뒤바뀐다.
pub(super) fn publish_card(project_root: &Path, provider: AcpProvider, info: &AcpAgentInfo) {
    use crate::oculpm::a2a::registry::{self, AgentCard, AgentSurface};

    let card = AgentCard {
        agent_id: format!("{}-app", provider.agent_id()),
        name: info.name.clone(),
        description: info.title.clone(),
        version: info.version.clone(),
        skills: Vec::new(),
        provider: provider.agent_id().to_string(),
        surface: AgentSurface::App,
        session_id: None,
        pid: Some(std::process::id()),
        project_root: project_root.display().to_string(),
        heartbeat_at: chrono::Utc::now().to_rfc3339(),
        // 앱이 직접 띄운 어댑터다 — 이름이 자칭이 아니라 우리가 아는 값이다
        // (플랜 `session-shim-cli`).
        verified: true,
    };
    if let Err(e) = registry::register(project_root, &card) {
        tracing::debug!(error = %e, "A2A 참여자 등록 실패 (무시)");
    }
}

/// 연결이 끝났으니 목록에서 내린다. 실패해도 pid 판정이 뒤를 봐준다.
pub(super) fn withdraw_card(project_root: &Path, provider: AcpProvider) {
    crate::oculpm::a2a::registry::unregister(project_root, &format!("{}-app", provider.agent_id()));
}

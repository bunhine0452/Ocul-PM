//! ACP 세션의 **신원** — 세션 심.
//!
//! `process.rs` 에서 갈라져 나왔다 (파일 크기 래칫이 자리를 가리켰다). 이
//! 어댑터가 **누구인지**를 앱 밖에 알린다 — 심 디렉터리에 토큰을 적고, 끝나면
//! 거둔다.

use std::path::Path;

use tauri::Manager;

use super::AcpProvider;

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

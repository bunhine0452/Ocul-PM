//! 앱 안 ACP 대화의 **기록 상태**를 화면에 올리는 얇은 표면
//! (플랜 `v3-record-integrity` {#mcp-missing-visible}).
//!
//! 로직은 [`crate::acp::recording`] 소유 — 여기는 대상 키 계산과 장부 접근만
//! 한다 (commands 는 얇게, CLAUDE.md 규약). [`acp`](super::acp) 에서 갈라져
//! 나온 이유는 파일 크기 래칫이 자리를 가리켰기 때문이다.

use tauri::{AppHandle, Manager, State};

use crate::acp::{AcpProvider, AcpRecordingState, AcpRecordingStatus};
use crate::app_error::AppError;

fn target_of(project_id: u32, provider: Option<AcpProvider>) -> u64 {
    provider.unwrap_or_default().state_key(project_id)
}

/// 이 대화의 기록 부착 결과를 대상 장부에 남긴다.
///
/// 화면은 이 값을 다시 계산하지 않고 **일어난 그대로** 읽는다 — 재계산하면
/// "지금은 있는데 그때는 없었다"를 영영 말할 수 없다. 못 찾은 경우는 로그에도
/// 남긴다: 조용한 성공을 없애는 것이 이 항목의 요점이다.
pub(crate) fn note_recording(
    app: &AppHandle,
    target: u64,
    probe: &crate::acp::recording::McpBinaryProbe,
    token: &str,
    acp_session_id: Option<String>,
) {
    let mut status = AcpRecordingStatus::from_probe(probe, token);
    status.acp_session_id = acp_session_id;
    if !status.attached {
        tracing::warn!(
            searched = ?status.searched,
            "기록 도구(oculpm-mcp) 없이 ACP 대화를 엽니다 — 에이전트가 일지를 못 씁니다"
        );
    }
    app.state::<AcpRecordingState>().record(target, status);
}

/// 마지막으로 연 대화의 기록 상태 (연 적이 없으면 `None` — 모르는 것을 말하지
/// 않는다).
#[tauri::command]
#[specta::specta]
pub fn acp_recording_status(
    state: State<'_, AcpRecordingState>,
    project_id: u32,
    provider: Option<AcpProvider>,
) -> Result<Option<AcpRecordingStatus>, AppError> {
    Ok(state.get(target_of(project_id, provider)))
}

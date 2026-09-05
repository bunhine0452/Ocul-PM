//! 앱 안 ACP 대화의 **배달 게이트** 표면 (플랜 `v3-record-integrity`
//! {#gate-beyond-cc}).
//!
//! 로직은 [`crate::acp::journal_gate`] 소유 — 여기는 경로·신원 해석과 상태
//! 장부 접근만 한다 (commands 는 얇게, CLAUDE.md 규약). [`acp`](super::acp) 에서
//! 갈라져 나온 이유는 [`acp_recording`](super::acp_recording) 과 같다: 그 파일이
//! 이미 크기 래칫 상한이다.
//!
//! 판정은 `git status` 를 부르므로 **블로킹**이다. 커맨드가 async 라
//! [`spawn_blocking`](tokio::task::spawn_blocking) 으로 넘긴다 — 턴이 끝난
//! 직후라 수십 ms 지만, 그 몇 십 ms 를 런타임 워커에서 재우면 옆 대화의
//! 스트리밍이 함께 멈춘다.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::acp::{self, AcpGateState, AcpObjection};
use crate::app_error::AppError;

/// 이 ACP 대화의 **기록 신원**. 원장에 없으면 `None` — 신원을 모르는 채로
/// 마커를 쓰면 아무도 못 읽는 이름이 하나 늘 뿐이다.
fn identity_of(app: &AppHandle, acp_session_id: &str) -> Option<String> {
    let app_data = app.path().app_data_dir().ok()?;
    acp::recording::lookup(&app_data, acp_session_id)
}

/// 세션이 열렸다 — 생존 흔적을 남긴다.
///
/// 여기서 실패해도 대화는 열린다. 흔적이 없으면 판정이 서지 않을 뿐이고, 판정이
/// 안 서는 것은 "판정 불가"이지 위반이 아니다.
pub(crate) fn note_opened(root: &Path, conversation: &str) {
    acp::journal_gate::opened(root, conversation);
}

/// 턴이 끝났다 — 생존 흔적을 갱신하고 판정한다.
///
/// 신원을 못 찾으면 아무 것도 하지 않는다. 그 경우는 원장을 못 쓴 대화(디스크
/// 오류)뿐이고, 그때는 이 대화가 남길 일지에도 신원이 안 실려 있어 붙잡을
/// 근거 자체가 없다.
pub(crate) async fn note_turn_ended(app: &AppHandle, root: PathBuf, acp_session_id: String) {
    let Some(conversation) = identity_of(app, &acp_session_id) else {
        return;
    };
    let app = app.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let state = app.state::<AcpGateState>();
        acp::journal_gate::turn_ended(&state, &root, &acp_session_id, &conversation)
    })
    .await;
    if let Err(e) = outcome {
        tracing::debug!(error = %e, "ACP 기록 판정을 마치지 못했다 (무시)");
    }
}

/// 대화를 내렸다 — 판정 한 번 더, 그리고 마커 청소.
pub(crate) async fn note_closed(app: &AppHandle, root: PathBuf, acp_session_id: String) {
    let Some(conversation) = identity_of(app, &acp_session_id) else {
        return;
    };
    let app = app.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let state = app.state::<AcpGateState>();
        acp::journal_gate::closed(&state, &root, &acp_session_id, &conversation);
    })
    .await;
    if let Err(e) = outcome {
        tracing::debug!(error = %e, "ACP 세그먼트를 닫지 못했다 (무시)");
    }
}

/// 지금 이 대화에 걸려 있는 이의 (없으면 `None`).
///
/// 화면은 이 값을 **다시 계산하지 않는다.** 판정은 턴이 끝난 그 순간의
/// 워킹트리를 보고 내려졌고, 몇 초 뒤에 다시 재면 다른 답이 나온다.
#[tauri::command]
#[specta::specta]
pub fn acp_journal_objection(
    state: State<'_, AcpGateState>,
    session_id: String,
) -> Result<Option<AcpObjection>, AppError> {
    Ok(state.get(&session_id))
}

/// 배너를 닫았다 — 이 대화에서는 다시 띄우지 않는다.
///
/// 게이트가 **대화당 1회**인 규율의 화면 쪽 절반이다. 다음 턴에 다시 판정해도
/// `.delivery-gate-<대화>` 플래그가 이미 서 있어 원장이 또 늘지는 않지만, 배너
/// 자체는 판정이 살아 있는 한 다시 그려진다 — 그래서 닫힘을 여기 적어 둔다.
#[tauri::command]
#[specta::specta]
pub fn acp_journal_objection_dismiss(
    state: State<'_, AcpGateState>,
    session_id: String,
) -> Result<bool, AppError> {
    state.dismiss(&session_id);
    Ok(true)
}

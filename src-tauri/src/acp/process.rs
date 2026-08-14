//! PR-ACP1/2 — 어댑터 프로세스 수명과 이벤트 라우팅 (docs/acp-panel/00-master-plan.md D1).
//!
//! ACP 크레이트의 연결은 `connect_with(transport, closure)` 형태다 — 클로저가
//! 사는 동안만 연결이 산다. 커맨드는 호출마다 끝나므로, **백그라운드 태스크가
//! 클로저를 붙잡고 있고** 커맨드는 거기서 꺼낸 `ConnectionTo` 클론으로 말한다.
//! (`ConnectionTo` 는 Clone — 크레이트가 의도한 사용법이다.)
//!
//! 클로저가 반환되면 = 어댑터가 죽었거나 우리가 껐다는 뜻이므로, 그 자리에서
//! 레지스트리 엔트리를 지운다. 그래야 "켜져 있다고 표시되는데 실은 죽은" 상태가
//! 생기지 않는다.
//!
//! `session/update` 알림은 **연결 생성 시점에 한 번** 등록한 핸들러로 들어온다.
//! 프롬프트마다 새로 붙일 수 없으므로, 핸들러는 프로젝트별 "현재 싱크"를 찾아
//! 흘려보낸다 — 싱크가 없으면(프롬프트 밖) 조용히 버린다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use agent_client_protocol::schema::v1::{
    InitializeRequest, PermissionOptionId, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo};
use futures::channel::oneshot;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::Manager;

use super::session::{map_update, permission_event, AcpConfigOption, AcpEvent};

/// 핸드셰이크로 확인한 상대편 정보. 프런트가 "무엇에 붙었는지" 보여준다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AcpAgentInfo {
    pub name: String,
    pub title: Option<String>,
    pub version: String,
    /// `authMethods` 가 비어 있지 않으면 별도 인증 흐름이 필요하다는 뜻 —
    /// 2026-08-14 실측은 빈 배열(구독 로그인 재사용)이었다.
    pub auth_required: bool,
}

struct Running {
    connection: ConnectionTo<Agent>,
    /// drop 만으로도 클로저의 `stop_rx.await` 가 풀린다 — 명시 send 는 선택.
    _stop: oneshot::Sender<()>,
    info: AcpAgentInfo,
    /// `session/new` 로 받은 대화 세션.
    session: Option<SessionId>,
    /// 그 세션이 제공하는 설정 항목 (모델·Effort·모드 …).
    options: Vec<AcpConfigOption>,
}

/// 프로젝트별 어댑터 레지스트리. v1 은 프로젝트당 1개 (D3).
#[derive(Default)]
pub struct AcpState {
    running: Mutex<HashMap<u32, Running>>,
    /// 진행 중인 프롬프트의 이벤트 싱크.
    sinks: Mutex<HashMap<u32, Channel<AcpEvent>>>,
    /// 사용자 응답을 기다리는 권한 요청 (우리가 만든 request_id → 결정 채널).
    pending: Mutex<HashMap<String, PendingPermission>>,
}

/// 아직 결정되지 않은 권한 요청.
struct PendingPermission {
    project_id: u32,
    decide: oneshot::Sender<Option<PermissionOptionId>>,
}

impl AcpState {
    /// 살아 있는 연결의 상대편 정보.
    pub fn info(&self, project_id: u32) -> Option<AcpAgentInfo> {
        self.running.lock().ok()?.get(&project_id).map(|r| r.info.clone())
    }

    /// 살아 있는 연결 핸들.
    pub fn connection(&self, project_id: u32) -> Option<ConnectionTo<Agent>> {
        self.running
            .lock()
            .ok()?
            .get(&project_id)
            .map(|r| r.connection.clone())
    }

    pub fn session(&self, project_id: u32) -> Option<SessionId> {
        self.running.lock().ok()?.get(&project_id).and_then(|r| r.session.clone())
    }

    pub fn set_session(&self, project_id: u32, session: SessionId, options: Vec<AcpConfigOption>) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.session = Some(session);
                running.options = options;
            }
        }
    }

    /// 세션을 버린다 (설정 항목도 함께). 다음 `ensure_session` 이 새로 만든다.
    pub fn clear_session(&self, project_id: u32) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.session = None;
                running.options = Vec::new();
            }
        }
    }

    pub fn options(&self, project_id: u32) -> Vec<AcpConfigOption> {
        self.running
            .lock()
            .ok()
            .and_then(|m| m.get(&project_id).map(|r| r.options.clone()))
            .unwrap_or_default()
    }

    /// 설정 변경이 성공한 뒤 로컬 사본을 맞춘다 — 재조회 왕복을 아끼고, UI 가
    /// 낙관적으로 그린 값과 우리 상태가 어긋나지 않게 한다.
    pub fn patch_option(&self, project_id: u32, config_id: &str, value: &str) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                for option in &mut running.options {
                    if option.id == config_id {
                        option.current = Some(value.to_string());
                    }
                }
            }
        }
    }

    pub fn set_sink(&self, project_id: u32, sink: Channel<AcpEvent>) {
        if let Ok(mut map) = self.sinks.lock() {
            map.insert(project_id, sink);
        }
    }

    pub fn clear_sink(&self, project_id: u32) {
        if let Ok(mut map) = self.sinks.lock() {
            map.remove(&project_id);
        }
    }

    /// 진행 중인 프롬프트가 있으면 이벤트를 흘린다. 없으면 버린다.
    pub fn emit(&self, project_id: u32, event: AcpEvent) {
        let sink = match self.sinks.lock() {
            Ok(map) => map.get(&project_id).cloned(),
            Err(_) => None,
        };
        if let Some(sink) = sink {
            if let Err(e) = sink.send(event) {
                tracing::debug!(project_id, error = %e, "ACP 이벤트 전송 실패 (수신자 없음)");
            }
        }
    }

    fn park_permission(
        &self,
        request_id: String,
        project_id: u32,
        decide: oneshot::Sender<Option<PermissionOptionId>>,
    ) {
        if let Ok(mut map) = self.pending.lock() {
            map.insert(request_id, PendingPermission { project_id, decide });
        }
    }

    /// 사용자 결정을 전달한다. `None` 이면 거절/취소. 모르는 id 면 `false`.
    pub fn resolve_permission(&self, request_id: &str, option: Option<PermissionOptionId>) -> bool {
        let parked = match self.pending.lock() {
            Ok(mut map) => map.remove(request_id),
            Err(_) => None,
        };
        match parked {
            Some(pending) => pending.decide.send(option).is_ok(),
            None => false,
        }
    }

    /// 프로젝트의 미결 권한 요청을 전부 취소로 닫는다.
    ///
    /// 프로토콜 요구사항이다 — `session/cancel` 을 보낸 클라이언트는 진행 중인
    /// 모든 `session/request_permission` 에 취소로 응답해야 한다. 안 하면
    /// 에이전트가 영영 우리를 기다린다.
    pub fn cancel_pending_permissions(&self, project_id: u32) -> usize {
        let taken: Vec<PendingPermission> = match self.pending.lock() {
            Ok(mut map) => {
                let ids: Vec<String> = map
                    .iter()
                    .filter(|(_, p)| p.project_id == project_id)
                    .map(|(id, _)| id.clone())
                    .collect();
                ids.iter().filter_map(|id| map.remove(id)).collect()
            }
            Err(_) => Vec::new(),
        };
        let count = taken.len();
        for pending in taken {
            let _ = pending.decide.send(None);
        }
        count
    }

    fn insert(&self, project_id: u32, running: Running) {
        if let Ok(mut map) = self.running.lock() {
            map.insert(project_id, running);
        }
    }

    fn remove(&self, project_id: u32) -> bool {
        self.running
            .lock()
            .map(|mut m| m.remove(&project_id).is_some())
            .unwrap_or(false)
    }
}

/// 어댑터를 띄우고 `initialize` 까지 마친다. 이미 떠 있으면 그 정보를 그대로.
///
/// 작업 디렉터리를 받지 않는 건 ACP 에서 **cwd 가 프로세스가 아니라 세션의
/// 속성**이기 때문이다 — 프로젝트 루트는 `session/new` 가 넘긴다.
pub async fn start(
    app: tauri::AppHandle,
    project_id: u32,
    node: &Path,
    entry: &Path,
    path_env: &str,
) -> Result<AcpAgentInfo, String> {
    if let Some(existing) = app.state::<AcpState>().info(project_id) {
        return Ok(existing);
    }

    let config = AcpAgentConfig::new(node)
        .arg(entry.to_string_lossy().to_string())
        // 어댑터는 내부에서 `claude` 바이너리를 다시 찾는다 — 우리가 해석한
        // PATH 를 물려주지 않으면 패키징된 앱에서만 조용히 실패한다.
        .env("PATH", path_env);
    let agent = AcpAgent::new(config);

    let (ready_tx, ready_rx) = oneshot::channel::<AcpAgentInfo>();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    let task_app = app.clone();
    // 클로저는 등록에, 알림 핸들러는 라우팅에, 태스크 본문은 등록 해제에 쓴다.
    let register_app = app.clone();
    let notify_app = app.clone();
    let permission_app = app.clone();

    tauri::async_runtime::spawn(async move {
        let outcome = Client
            .builder()
            .name("ocul-pm")
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    notify_app
                        .state::<AcpState>()
                        .emit(project_id, map_update(&notification.update));
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            // 권한 요청. **여기서 사용자를 기다리면 안 된다** — 콜백은 dispatch
            // 루프를 붙잡고, 그동안 어떤 메시지도 처리되지 않는다(크레이트
            // concepts::ordering). 그래서 즉시 spawn 으로 빠져나가고, 응답은
            // 사용자가 고른 뒤 그 태스크가 보낸다.
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, cx| {
                    let request_id = uuid::Uuid::new_v4().to_string();
                    let (decide_tx, decide_rx) = oneshot::channel();

                    let state = permission_app.state::<AcpState>();
                    state.park_permission(request_id.clone(), project_id, decide_tx);
                    state.emit(project_id, permission_event(request_id, &request));

                    cx.spawn(async move {
                        let outcome = match decide_rx.await {
                            Ok(Some(option)) => RequestPermissionOutcome::Selected(
                                SelectedPermissionOutcome::new(option),
                            ),
                            // 거절이든 앱 종료로 채널이 끊겼든 취소로 닫는다 —
                            // 응답을 안 보내면 에이전트가 영영 멈춰 있다.
                            _ => RequestPermissionOutcome::Cancelled,
                        };
                        responder.respond(RequestPermissionResponse::new(outcome))
                    })?;

                    Ok(())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent, move |cx: ConnectionTo<Agent>| async move {
                let init = cx
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;

                let implementation = init.agent_info.as_ref();
                let info = AcpAgentInfo {
                    name: implementation
                        .map(|i| i.name.clone())
                        .unwrap_or_else(|| "unknown".to_string()),
                    title: implementation.and_then(|i| i.title.clone()),
                    version: implementation.map(|i| i.version.clone()).unwrap_or_default(),
                    auth_required: !init.auth_methods.is_empty(),
                };

                register_app.state::<AcpState>().insert(
                    project_id,
                    Running {
                        connection: cx.clone(),
                        _stop: stop_tx,
                        info: info.clone(),
                        session: None,
                        options: Vec::new(),
                    },
                );
                let _ = ready_tx.send(info);

                // 종료 신호(또는 sender drop)까지 연결을 붙잡고 있는다.
                let _ = stop_rx.await;
                Ok(())
            })
            .await;

        // 여기 도달 = 어댑터가 죽었거나 우리가 껐다. 어느 쪽이든 등록 해제.
        let state = task_app.state::<AcpState>();
        if state.remove(project_id) {
            tracing::info!(project_id, "ACP 어댑터 연결 종료");
        }
        state.clear_sink(project_id);
        // 연결이 끊겼으면 대기 중인 승인 카드도 의미가 없다.
        state.cancel_pending_permissions(project_id);
        if let Err(e) = outcome {
            tracing::warn!(project_id, error = %e, "ACP 연결이 오류로 끝났다");
        }
    });

    ready_rx
        .await
        .map_err(|_| "어댑터 핸드셰이크에 실패했습니다 (로그를 확인하세요)".to_string())
}

/// 어댑터를 내린다. 떠 있지 않았으면 `false`.
pub fn stop(app: &tauri::AppHandle, project_id: u32) -> bool {
    // Running 을 드롭하면 stop sender 가 함께 떨어져 클로저가 풀리고,
    // 백그라운드 태스크가 어댑터 프로세스를 정리한다.
    let state = app.state::<AcpState>();
    state.clear_sink(project_id);
    state.cancel_pending_permissions(project_id);
    state.remove(project_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 권한 요청은 **반드시** 응답으로 닫혀야 한다 — 안 닫으면 에이전트가 영영
    /// 우리를 기다린다. 여기서 보는 건 그 계약의 골자다.
    #[test]
    fn resolving_a_parked_permission_delivers_the_choice() {
        let state = AcpState::default();
        let (tx, rx) = oneshot::channel();
        state.park_permission("req-1".to_string(), 7, tx);

        assert!(state.resolve_permission("req-1", Some(PermissionOptionId::new("allow"))));

        let decided = futures::executor::block_on(rx).expect("결정이 전달돼야 한다");
        assert_eq!(decided.map(|o| o.0.to_string()), Some("allow".to_string()));
    }

    #[test]
    fn resolving_twice_is_reported_as_unknown_the_second_time() {
        let state = AcpState::default();
        let (tx, _rx) = oneshot::channel();
        state.park_permission("req-1".to_string(), 7, tx);

        assert!(state.resolve_permission("req-1", None));
        assert!(
            !state.resolve_permission("req-1", None),
            "이미 닫힌 요청을 또 닫았다고 보고하면 UI 가 유령 카드를 만든다"
        );
    }

    /// 취소는 그 프로젝트 것만 닫는다 — 옆 프로젝트의 승인 카드를 함께 날리면
    /// 사용자가 누르지도 않은 거절이 일어난다.
    #[test]
    fn cancelling_closes_only_the_requested_project() {
        let state = AcpState::default();
        let (tx_a, rx_a) = oneshot::channel();
        let (tx_b, rx_b) = oneshot::channel();
        state.park_permission("a".to_string(), 1, tx_a);
        state.park_permission("b".to_string(), 2, tx_b);

        assert_eq!(state.cancel_pending_permissions(1), 1);

        assert_eq!(futures::executor::block_on(rx_a), Ok(None), "취소로 닫혀야 한다");
        assert!(
            state.resolve_permission("b", None),
            "다른 프로젝트 요청은 그대로 살아 있어야 한다"
        );
        drop(rx_b);
    }
}

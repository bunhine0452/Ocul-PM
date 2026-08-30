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
use std::sync::atomic::{AtomicU64, Ordering};
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

use super::session::{
    commands_of, config_of, failure_of, file_change_report_of, map_update, mode_of,
    permission_event, title_of,
    usage_of,
    AcpCommand, AcpConfigOption, AcpEvent, AcpRateLimit, AcpUsage,
};

/// 어댑터 콜드 스타트(node 기동 + Claude Code 로그인 확인)를 감안한 상한.
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

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
    /// 이 연결의 세대. 죽는 연결이 **더 새 연결의 등록을 지우는 것**을 막는다.
    epoch: u64,
    connection: ConnectionTo<Agent>,
    /// drop 만으로도 클로저의 `stop_rx.await` 가 풀린다 — 명시 send 는 선택.
    _stop: oneshot::Sender<()>,
    info: AcpAgentInfo,
    /// **화면이 지금 보고 있는** 대화.
    ///
    /// "활성 세션"이 아니다. 프롬프트·취소는 대화 id 를 인자로 받으므로 여러
    /// 대화가 동시에 돌 수 있고, 이 칸은 그중 어느 것을 화면이 띄우고 있는지의
    /// 장부일 뿐이다 — 설정 항목처럼 "보고 있는 대화"에 걸리는 것들이 쓴다.
    session: Option<SessionId>,
    /// 그 세션이 제공하는 설정 항목 (모델·Effort·모드 …).
    options: Vec<AcpConfigOption>,
    /// 슬래시 커맨드 목록. **프롬프트 밖에서** 도착하므로(세션 시작 직후)
    /// 싱크에 흘려보내는 것만으로는 잡을 수 없어 여기에 갈무리한다.
    commands: Vec<AcpCommand>,
    /// 마지막으로 본 사용량. 툴바가 프롬프트 밖에서도 보여 줘야 하므로 갈무리.
    usage: Option<AcpUsage>,
    /// 현재 세션 제목 (에이전트가 나중에 붙인다).
    title: Option<String>,
    /// `/usage` 를 물어보는 **전용 대화** — 어댑터가 살아 있는 동안 하나만 쓴다.
    ///
    /// 물어볼 때마다 파고 지우려 했더니, 지우기와 어댑터의 전사 기록이 경합해
    /// 가끔 살아남아 목록에 "/usage" 가 쌓였다. 하나만 두고 **목록에서 감춘다** —
    /// 지우기가 실패해도 사용자 눈에는 없다. 어댑터가 죽으면 같이 사라진다.
    scratch: Option<SessionId>,
}

/// 프로젝트별 어댑터 레지스트리. v1 은 프로젝트당 1개 (D3).
#[derive(Default)]
pub struct AcpState {
    running: Mutex<HashMap<u32, Running>>,
    /// 진행 중인 프롬프트의 이벤트 싱크.
    /// 이벤트를 흘려보낼 곳 — **(프로젝트, 대화)** 단위다.
    ///
    /// 프로젝트 단위였을 때는 대화를 하나 열 때마다 그 하나뿐인 자리를 빼앗아,
    /// 답변이 흐르는 중에 다른 대화로 넘어가면 **진행 중이던 스트림이 그
    /// 자리에서 끊겼다**(돌아와도 그 답은 영영 안 온다). 대화마다 자리를 주면
    /// 서로 밀어내지 않는다.
    sinks: Mutex<HashMap<(u32, String), Channel<AcpEvent>>>,
    /// 사용자 응답을 기다리는 권한 요청 (우리가 만든 request_id → 결정 채널).
    pending: Mutex<HashMap<String, PendingPermission>>,
    /// 켜져 있으면 에이전트 답변 텍스트를 여기에 모은다.
    ///
    /// `/usage` 처럼 **우리가 대신 물어보는** 턴의 답을 읽으려고 둔다. 프런트
    /// 채널로는 받을 수 없다 — 사용자가 시작한 프롬프트가 아니기 때문이다.
    capture: Mutex<Option<(String, String)>>,
    /// **동시 start 직렬화.** 없으면 어댑터가 둘 뜬다 — React StrictMode 가
    /// effect 를 두 번 돌리는 것만으로도 재현됐다(첫 연결 실패 → 재시도하면
    /// 됨). 늦게 뜬 쪽이 레지스트리를 덮고, 먼저 죽는 쪽이 그 등록을 지워
    /// `session/new` 가 "oneshot canceled" 로 떨어졌다.
    start_lock: tokio::sync::Mutex<()>,
    /// `session/new` 직렬화 — 두 커맨드가 동시에 세션을 만들면 하나가 덮이고
    /// 덮인 쪽은 에이전트에 남아 새는 세션이 된다.
    pub session_lock: tokio::sync::Mutex<()>,
    next_epoch: AtomicU64,
    /// 살아 있는 어댑터 연결 태스크 수. `stop_all_blocking` 이 종료 때 이 값이
    /// 0 이 되기를 잠깐 기다린다 — 어댑터 프로세스(node + 손자 claude) 는 그
    /// 태스크가 끝나며 크레이트가 프로세스 그룹째 죽이는데, tao 는 ExitRequested
    /// 직후 `process::exit` 하므로 기다리지 않으면 고아로 남는다(2026-08-30 감사).
    live: std::sync::atomic::AtomicUsize,
}

/// 아직 결정되지 않은 권한 요청.
struct PendingPermission {
    project_id: u32,
    /// **어느 대화의 승인인가.**
    ///
    /// 프로젝트 단위로만 알고 있었을 때는 한 대화를 취소하면 나란히 돌던 옆
    /// 대화의 승인 카드까지 함께 닫혔다 — 누르지도 않았는데 거절된 것이다.
    session_id: String,
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
                // 제목은 세션의 것이다 — 안 지우면 새 대화에 옛 제목이 남는다.
                running.title = None;
            }
        }
    }

    /// `/usage` 전용 대화의 id (있으면).
    pub fn scratch(&self, project_id: u32) -> Option<SessionId> {
        self.running.lock().ok()?.get(&project_id)?.scratch.clone()
    }

    pub fn set_scratch(&self, project_id: u32, session: SessionId) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.scratch = Some(session);
            }
        }
    }

    /// 보고 있는 대화만 바꾼다 — **설정은 그대로 둔다.**
    ///
    /// `session/prompt` 는 대화 id 를 인자로 받으므로 "활성 대화"는 우리 쪽
    /// 장부일 뿐이다. 화면이 이미 그 대화의 기록을 들고 있어 다시 읽을 필요가
    /// 없을 때, `session/load` 를 부르지 않고 이것만 바꾼다 (재생 트래픽도,
    /// 그 대화에 물려 있는 스트림을 건드릴 일도 없다).
    pub fn select_session(&self, project_id: u32, session: SessionId, title: Option<String>) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.session = Some(session);
                running.title = title;
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

    pub fn usage(&self, project_id: u32) -> Option<AcpUsage> {
        self.running.lock().ok()?.get(&project_id)?.usage.clone()
    }

    /// 한도는 한 번에 한 종류씩 온다 — 종류별로 **누적**해야 세션·주간·Fable
    /// 세 줄이 다 모인다. 덮어쓰면 마지막 한 줄만 남는다.
    fn merge_usage(&self, project_id: u32, fresh: AcpUsage) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                let mut limits = running
                    .usage
                    .as_ref()
                    .map(|u| u.limits.clone())
                    .unwrap_or_default();
                for limit in fresh.limits {
                    match limits.iter_mut().find(|l| l.kind == limit.kind) {
                        Some(existing) => *existing = limit,
                        None => limits.push(limit),
                    }
                }
                // 알림에는 기여도 대목이 없다 — 갖고 있던 것을 유지한다.
                let detail = running.usage.as_ref().and_then(|u| u.detail.clone());
                running.usage = Some(AcpUsage { limits, detail, ..fresh });
            }
        }
    }

    pub fn commands(&self, project_id: u32) -> Vec<AcpCommand> {
        self.running
            .lock()
            .ok()
            .and_then(|m| m.get(&project_id).map(|r| r.commands.clone()))
            .unwrap_or_default()
    }

    fn set_commands(&self, project_id: u32, commands: Vec<AcpCommand>) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.commands = commands;
            }
        }
    }

    /// 설정 한 벌을 통째로 갈아 끼운다 (에이전트가 보내 준 것).
    pub fn set_options(&self, project_id: u32, options: Vec<AcpConfigOption>) {
        if options.is_empty() {
            return;
        }
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.options = options;
            }
        }
    }

    pub fn title(&self, project_id: u32) -> Option<String> {
        self.running.lock().ok()?.get(&project_id)?.title.clone()
    }

    pub fn set_title(&self, project_id: u32, title: Option<String>) {
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                running.title = title;
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

    pub fn set_sink(&self, project_id: u32, session_id: String, sink: Channel<AcpEvent>) {
        if let Ok(mut map) = self.sinks.lock() {
            map.insert((project_id, session_id), sink);
        }
    }

    pub fn clear_sink(&self, project_id: u32, session_id: &str) {
        if let Ok(mut map) = self.sinks.lock() {
            map.remove(&(project_id, session_id.to_string()));
        }
    }

    /// 이 프로젝트의 모든 자리를 치운다 (어댑터가 죽거나 멈출 때).
    pub fn clear_sinks(&self, project_id: u32) {
        if let Ok(mut map) = self.sinks.lock() {
            map.retain(|(pid, _), _| *pid != project_id);
        }
    }

    /// 답변 텍스트 갈무리를 시작한다 (이전 내용은 버린다).
    /// 이 세션의 답변만 갈무리한다.
    ///
    /// 세션을 지정하는 이유: `/usage` 는 **일회용 대화**에서 물어본다(사용자의
    /// 대화에 "/usage" 가 남지 않도록). 프로젝트 단위로 모으면 그 사이 흐르는
    /// 진짜 대화의 글자까지 섞여 들어온다.
    pub fn start_capture(&self, session_id: String) {
        if let Ok(mut slot) = self.capture.lock() {
            *slot = Some((session_id, String::new()));
        }
    }

    /// 갈무리를 끝내고 모인 텍스트를 가져온다.
    pub fn take_capture(&self) -> Option<String> {
        Some(self.capture.lock().ok()?.take()?.1)
    }

    /// 지금 이 세션을 갈무리 중인가 — 그렇다면 그 알림은 **화면 것이 아니다.**
    pub fn is_capturing(&self, session_id: &str) -> bool {
        self.capture
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|(id, _)| id == session_id))
            .unwrap_or(false)
    }

    fn push_capture(&self, session_id: &str, text: &str) {
        if let Ok(mut slot) = self.capture.lock() {
            if let Some((id, buffer)) = slot.as_mut() {
                if id == session_id {
                    buffer.push_str(text);
                }
            }
        }
    }

    /// `/usage` 가 준 한도로 갈아 끼운다.
    ///
    /// 병합이 아니라 **교체**인 이유: `/usage` 는 세 줄을 한 번에 주는 완전한
    /// 스냅샷이라, 옛 `_meta` 조각과 섞으면 같은 한도가 두 이름으로 두 줄
    /// 보인다(`seven_day` 와 `week (all models)`).
    pub fn replace_limits(
        &self,
        project_id: u32,
        limits: Vec<AcpRateLimit>,
        detail: Option<String>,
    ) {
        // 둘 다 못 읽었으면 아무 것도 하지 않는다 — 파싱이 실패한 응답으로
        // 멀쩡한 값을 지우면 카드가 비어 버린다.
        if limits.is_empty() && detail.is_none() {
            return;
        }
        if let Ok(mut map) = self.running.lock() {
            if let Some(running) = map.get_mut(&project_id) {
                let base = running.usage.clone().unwrap_or(AcpUsage {
                    used: 0,
                    size: 0,
                    cost_usd: None,
                    limits: Vec::new(),
                    detail: None,
                });
                // 기여도 대목은 `/usage` 만 준다 — 이번에 못 받았으면 지난 것을
                // 남긴다. 지우면 턴이 한 번 돌 때마다 카드가 반쪽이 된다.
                let detail = detail.or(base.detail.clone());
                // 한도만 못 읽은 경우도 있다 — 그때 빈 목록으로 갈아 끼우면
                // 계기가 통째로 사라진다(계기는 한도가 없으면 안 그린다).
                let limits = if limits.is_empty() { base.limits.clone() } else { limits };
                running.usage = Some(AcpUsage { limits, detail, ..base });
            }
        }
    }

    /// 진행 중인 프롬프트가 있으면 이벤트를 흘린다. 없으면 버린다.
    pub fn emit(&self, project_id: u32, session_id: &str, event: AcpEvent) {
        let sink = match self.sinks.lock() {
            Ok(map) => map.get(&(project_id, session_id.to_string())).cloned(),
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
        session_id: String,
        decide: oneshot::Sender<Option<PermissionOptionId>>,
    ) {
        if let Ok(mut map) = self.pending.lock() {
            map.insert(
                request_id,
                PendingPermission {
                    project_id,
                    session_id,
                    decide,
                },
            );
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

    /// 미결 권한 요청을 취소로 닫는다.
    ///
    /// 프로토콜 요구사항이다 — `session/cancel` 을 보낸 클라이언트는 진행 중인
    /// 모든 `session/request_permission` 에 취소로 응답해야 한다. 안 하면
    /// 에이전트가 영영 우리를 기다린다.
    ///
    /// `session` 이 `Some` 이면 **그 대화 것만** 닫는다. 대화 여럿이 나란히
    /// 도는 지금은 이쪽이 기본이어야 한다 — 프로젝트를 통째로 닫는 것은
    /// 어댑터가 죽었을 때처럼 정말 전부가 무효인 경우뿐이다.
    pub fn cancel_pending_permissions(&self, project_id: u32, session: Option<&str>) -> usize {
        let taken: Vec<PendingPermission> = match self.pending.lock() {
            Ok(mut map) => {
                let ids: Vec<String> = map
                    .iter()
                    .filter(|(_, p)| p.project_id == project_id)
                    .filter(|(_, p)| session.is_none_or(|want| p.session_id == want))
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

    /// 자기 세대일 때만 지운다 — 이미 새 연결이 들어와 있으면 건드리지 않는다.
    fn remove_if(&self, project_id: u32, epoch: u64) -> bool {
        match self.running.lock() {
            Ok(mut map) => match map.get(&project_id) {
                Some(running) if running.epoch == epoch => map.remove(&project_id).is_some(),
                _ => false,
            },
            Err(_) => false,
        }
    }

    fn remove(&self, project_id: u32) -> bool {
        self.running
            .lock()
            .map(|mut m| m.remove(&project_id).is_some())
            .unwrap_or(false)
    }

    /// 앱 종료 — 모든 어댑터를 내리고 연결 태스크가 프로세스를 정리할 때까지
    /// **잠깐** 기다린다(최대 1초). `stop` 과 같은 경로: `Running` 을 떨어뜨리면
    /// 클로저가 풀리고, 크레이트가 어댑터 프로세스 그룹을 SIGKILL 한다. 그전엔
    /// ExitRequested 에서 아무도 어댑터를 안 건드려 node+claude 가 고아로 남았다.
    pub fn stop_all_blocking(&self) {
        let dropped: Vec<u32> = match self.running.lock() {
            Ok(mut map) => map.drain().map(|(id, _running)| id).collect(),
            Err(_) => Vec::new(),
        };
        for project_id in &dropped {
            self.clear_sinks(*project_id);
            self.cancel_pending_permissions(*project_id, None);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        while self.live.load(Ordering::SeqCst) > 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let left = self.live.load(Ordering::SeqCst);
        if !dropped.is_empty() || left > 0 {
            tracing::info!(
                stopped = dropped.len(),
                still_live = left,
                "ACP 어댑터 종료 정리"
            );
        }
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
    // 시작은 한 번에 하나만. 두 번째 호출자는 여기서 기다렸다가 위 조기반환으로
    // 같은 어댑터를 공유한다 (프런트가 몇 번 부르든 프로세스는 하나다).
    let state = app.state::<AcpState>();
    let _start_guard = state.start_lock.lock().await;
    if let Some(existing) = state.info(project_id) {
        return Ok(existing);
    }
    let epoch = state.next_epoch.fetch_add(1, Ordering::Relaxed);

    let config = AcpAgentConfig::new(node)
        .arg(entry.to_string_lossy().to_string())
        // 어댑터는 내부에서 `claude` 바이너리를 다시 찾는다 — 우리가 해석한
        // PATH 를 물려주지 않으면 패키징된 앱에서만 조용히 실패한다.
        .env("PATH", path_env);
    // 어댑터의 stderr 를 앱 로그로 옮긴다.
    //
    // 지금까지 이걸 안 보고 있었다. 어댑터 너머의 CLI 가 화면에 찍는 것 중
    // **stderr 로 나가는 것**(시작 실패 사유, 플래그를 못 알아들었다는 불평)은
    // 안 읽으면 "아무 일도 안 일어난 것처럼 보이는" 상태가 된다.
    //
    // 다만 CLI 의 **대화형 화면**에 그리는 것(원격 조종 짝짓기 안내 같은)은
    // 여기로도 안 온다 — 2026-08-15 실측. 그건 프로토콜로 옮겨질 데이터가
    // 애초에 없는 것이라 통로를 뚫는 문제가 아니다.
    //
    // stdin/stdout(프로토콜 본문)은 흘린다 — 대화 내용이 통째로 로그에 남는
    // 것은 로그가 아니라 사본이고, 거기엔 소스 코드도 비밀도 섞인다.
    let agent = AcpAgent::new(config).with_debug(|line, direction| {
        if direction == agent_client_protocol::LineDirection::Stderr {
            tracing::info!(target: "oculpm::acp", "[adapter] {line}");
        }
    });

    let (ready_tx, ready_rx) = oneshot::channel::<AcpAgentInfo>();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    let task_app = app.clone();
    // 클로저는 등록에, 알림 핸들러는 라우팅에, 태스크 본문은 등록 해제에 쓴다.
    let register_app = app.clone();
    let notify_app = app.clone();
    let permission_app = app.clone();

    // 연결 태스크 하나 = 살아 있는 어댑터 하나. 태스크 끝에서 내린다
    // (`stop_all_blocking` 이 0 을 기다린다).
    state.live.fetch_add(1, Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let outcome = Client
            .builder()
            .name("ocul-pm")
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    let state = notify_app.state::<AcpState>();
                    // `/usage` 를 물어보는 **일회용 대화**의 알림은 화면 것이
                    // 아니다 — 그대로 흘리면 사용자가 보고 있는 대화에 남의
                    // 답변이 끼어든다. 갈무리만 하고 여기서 끊는다.
                    let from = notification.session_id.0.to_string();
                    if state.is_capturing(&from) {
                        if let AcpEvent::Chunk { text } = map_update(&notification.update) {
                            state.push_capture(&from, &text);
                        }
                        return Ok(());
                    }
                    // 커맨드 목록은 프롬프트 밖(세션 시작 직후)에 오므로 싱크에만
                    // 의존하면 놓친다 — 상태에 갈무리해 두고 UI 가 물어보게 한다.
                    if let Some(commands) = commands_of(&notification.update) {
                        state.set_commands(project_id, commands);
                    }
                    if let Some(usage) = usage_of(&notification.update) {
                        state.merge_usage(project_id, usage);
                    }
                    // 에이전트 쪽에서 바뀐 설정을 따라간다 — 모델 교체가 권한
                    // 모드를 내리는 경우가 있어 이걸 놓치면 UI 가 거짓말을 한다.
                    if let Some(options) = config_of(&notification.update) {
                        state.set_options(project_id, options);
                    }
                    if let Some(mode) = mode_of(&notification.update) {
                        state.patch_option(project_id, "mode", &mode);
                    }
                    if let Some(title) = title_of(&notification.update) {
                        state.set_title(project_id, Some(title));
                    }
                    // 세션 실패·경고는 **제목 알림과 같은 봉투**에 실려 온다.
                    // 먼저 흘려보내고 나서 아래 일반 매핑으로 넘어간다.
                    if let Some(failure) = failure_of(&notification.update) {
                        state.emit(project_id, &from, failure);
                    }
                    // 파일 변경 감사도 같은 봉투(`session_info_update`)로 온다.
                    if let Some(report) = file_change_report_of(&notification.update) {
                        state.emit(project_id, &from, report);
                    }
                    state.emit(project_id, &from, map_update(&notification.update));
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
                    // 권한 요청은 **그 대화의 화면**이 받아야 한다.
                    let asking = request.session_id.0.to_string();
                    state.park_permission(
                        request_id.clone(),
                        project_id,
                        asking.clone(),
                        decide_tx,
                    );
                    state.emit(project_id, &asking, permission_event(request_id, &request));

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
                // 세션 실패 확장을 켠다 (opt-in).
                //
                // 안 켜면 한도 초과·인증 실패·모델 폴백 같은 것이 **평범한 오류
                // 문자열이나 침묵**으로 온다. 켜면 종류(`limit`·`access`·…)와
                // 심각도가 붙은 기록으로 와서 대화에 그대로 남길 수 있다 —
                // 특히 "모델이 조용히 폴백됐다"는 안 알려 주면 알 길이 없다.
                //
                // 네임스페이스가 `jetbrains.air` 인 것은 이 확장을 그쪽이 먼저
                // 정의했기 때문이다(어댑터 문서 그대로). 우리가 고를 수 없다.
                let mut caps_meta = serde_json::Map::new();
                caps_meta.insert(
                    "jetbrains".to_string(),
                    serde_json::json!({
                        // `agentFileChangeReport` 는 0.70.0 신규 — 이번 턴에
                        // 바꾼 파일을 에이전트가 직접 신고한다. 우리는 파일
                        // 변경을 watcher·git 으로 추론해 왔는데, 이건 1차
                        // 출처이고 자식 프로세스가 바꾼 것까지 포함한다.
                        // 광고하지 않으면 어댑터가 감사 자체를 켜지 않는다.
                        "air": {
                            "version": 1,
                            "capabilities": ["sessionFailure", "agentFileChangeReport"]
                        }
                    }),
                );
                let init = cx
                    .send_request(
                        InitializeRequest::new(ProtocolVersion::V1).client_capabilities(
                            agent_client_protocol::schema::v1::ClientCapabilities::new()
                                .meta(caps_meta),
                        ),
                    )
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
                        epoch,
                        connection: cx.clone(),
                        _stop: stop_tx,
                        info: info.clone(),
                        session: None,
                        options: Vec::new(),
                        commands: Vec::new(),
                        usage: None,
                        title: None,
                        scratch: None,
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
        if state.remove_if(project_id, epoch) {
            tracing::info!(project_id, epoch, "ACP 어댑터 연결 종료");
        }
        state.clear_sinks(project_id);
        // 연결이 끊겼으면 대기 중인 승인 카드도 의미가 없다 — 대화를 가리지
        // 않고 전부.
        state.cancel_pending_permissions(project_id, None);
        if let Err(e) = outcome {
            tracing::warn!(project_id, error = %e, "ACP 연결이 오류로 끝났다");
        }
        // 여기 도달했으면 크레이트가 어댑터 프로세스를 이미 정리했다.
        state.live.fetch_sub(1, Ordering::SeqCst);
    });

    // 타임아웃이 있어야 하는 이유: 이 함수는 start_lock 을 쥐고 있다. 어댑터가
    // 응답 없이 매달리면 락이 영원히 잡혀 **재시도 버튼까지 막힌다**.
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, ready_rx).await {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(_)) => Err("어댑터 핸드셰이크에 실패했습니다 (로그를 확인하세요)".to_string()),
        Err(_) => Err("어댑터가 응답하지 않습니다 (핸드셰이크 시간 초과)".to_string()),
    }
}

/// 어댑터를 내린다. 떠 있지 않았으면 `false`.
pub fn stop(app: &tauri::AppHandle, project_id: u32) -> bool {
    // Running 을 드롭하면 stop sender 가 함께 떨어져 클로저가 풀리고,
    // 백그라운드 태스크가 어댑터 프로세스를 정리한다.
    let state = app.state::<AcpState>();
    state.clear_sinks(project_id);
    state.cancel_pending_permissions(project_id, None);
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
        state.park_permission("req-1".to_string(), 7, "s1".to_string(), tx);

        assert!(state.resolve_permission("req-1", Some(PermissionOptionId::new("allow"))));

        let decided = futures::executor::block_on(rx).expect("결정이 전달돼야 한다");
        assert_eq!(decided.map(|o| o.0.to_string()), Some("allow".to_string()));
    }

    #[test]
    fn resolving_twice_is_reported_as_unknown_the_second_time() {
        let state = AcpState::default();
        let (tx, _rx) = oneshot::channel();
        state.park_permission("req-1".to_string(), 7, "s1".to_string(), tx);

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
        state.park_permission("a".to_string(), 1, "s1".to_string(), tx_a);
        state.park_permission("b".to_string(), 2, "s2".to_string(), tx_b);

        assert_eq!(state.cancel_pending_permissions(1, None), 1);

        assert_eq!(futures::executor::block_on(rx_a), Ok(None), "취소로 닫혀야 한다");
        assert!(
            state.resolve_permission("b", None),
            "다른 프로젝트 요청은 그대로 살아 있어야 한다"
        );
        drop(rx_b);
    }

    /// **같은 프로젝트의 다른 대화**도 마찬가지다. 대화 여럿을 나란히 돌리는
    /// 지금, 한 대화의 취소가 옆 대화의 승인 카드를 닫으면 사용자는 누르지도
    /// 않은 거절을 당한다 — 프로젝트 경계보다 이쪽이 훨씬 자주 밟힌다.
    #[test]
    fn cancelling_one_conversation_leaves_its_neighbour_alone() {
        let state = AcpState::default();
        let (tx_a, rx_a) = oneshot::channel();
        let (tx_b, rx_b) = oneshot::channel();
        state.park_permission("a".to_string(), 1, "sess-a".to_string(), tx_a);
        state.park_permission("b".to_string(), 1, "sess-b".to_string(), tx_b);

        assert_eq!(state.cancel_pending_permissions(1, Some("sess-a")), 1);

        assert_eq!(futures::executor::block_on(rx_a), Ok(None), "취소로 닫혀야 한다");
        assert!(
            state.resolve_permission("b", None),
            "옆 대화의 승인 카드는 그대로 살아 있어야 한다"
        );
        drop(rx_b);
    }
}

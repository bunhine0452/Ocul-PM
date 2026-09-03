//! Phase 6 — 외부 A2A 엔드포인트 (마스터플랜 §10).
//!
//! 로컬 프로세스가 아닌 것들(클라우드 세션, 다른 기계의 ocul-pm, 외부
//! 에이전트)이 **같은 원장에 참여하는 문**이다. 파일 우편함은 로컬의 빠른 길로
//! 그대로 두고, 이 문은 그 위에 얹는다 — 프로토콜을 두 벌 만들지 않는다.
//!
//! ## 세 가지 안전 장치
//!
//! 1. **기본 꺼짐.** 사용자가 켜야 뜬다.
//! 2. **루프백 전용.** [`LoopbackAddr`] 뉴타입이라 `0.0.0.0` 바인딩은 컴파일
//!    단계에서 불가능하다 (모바일 브리지의 `TailscaleBindAddr` 와 같은 규율).
//!    바인딩 뒤 되읽어 확인까지 한다 — OS 가 다른 주소를 주면 리스너를 버린다.
//! 3. **매 기동 새 토큰.** 디스크에 저장하지 않는다. 저장하지 않는 비밀은
//!    새지 않고, 앱을 껐다 켜면 어차피 새로 켜야 하는 문이다.
//!
//! ## v1 이 지원하는 것과 안 하는 것
//!
//! Agent Card 발견 · `agents/list`(확장) · `message/send` · `tasks/get` 까지다.
//! `message/stream`(SSE)·푸시 알림·`tasks/cancel` 은 **명시적으로 거부**한다
//! (`-32004 UnsupportedOperation`) — 조용히 성공한 척하면 상대가 오지 않을 답을
//! 기다린다. 문을 먼저 달고 방을 나중에 채우는 순서다.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Mutex;

use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde_json::{json, Value};
use tokio::sync::oneshot;

use super::{mailbox, registry, tasks};

/// 기본 포트. 고정인 이유는 외부 설정에 URL 을 적어 두기 때문 — 켤 때마다
/// 바뀌면 그 설정이 매번 거짓이 된다. 이미 쓰이고 있으면 **실패로 알린다**
/// (조용히 다른 포트로 옮기면 카드의 `url` 이 거짓말을 한다).
pub const DEFAULT_PORT: u16 = 8737;

/// A2A 프로토콜 버전 — 카드가 광고하는 값.
const PROTOCOL_VERSION: &str = "0.3.0";

/// 루프백 주소만 담을 수 있는 뉴타입. 다른 주소는 **만들 수가 없다.**
#[derive(Debug, Clone, Copy)]
pub struct LoopbackAddr(Ipv4Addr);

impl LoopbackAddr {
    pub fn new() -> Self {
        Self(Ipv4Addr::LOCALHOST)
    }

    pub fn socket_addr(self, port: u16) -> SocketAddr {
        SocketAddr::from((self.0, port))
    }
}

impl Default for LoopbackAddr {
    fn default() -> Self {
        Self::new()
    }
}

/// 화면에 주는 상태.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct A2aServerStatus {
    pub running: bool,
    /// `http://127.0.0.1:8737` — 도는 동안만.
    pub url: Option<String>,
    /// 이 문이 열려 있는 프로젝트.
    pub project_id: Option<u32>,
    /// **한 번 켜는 동안만 유효한 토큰.** 디스크에 남지 않는다.
    pub token: Option<String>,
}

struct Running {
    bound: SocketAddr,
    project_id: u32,
    token: String,
    _stop: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct A2aServerState {
    server: Mutex<Option<Running>>,
}

#[derive(Clone)]
struct Ctx {
    root: PathBuf,
    project_id: u32,
    token: String,
    url: String,
}

impl A2aServerState {
    pub fn status(&self) -> A2aServerStatus {
        let guard = self.server.lock().expect("a2a server state poisoned");
        match guard.as_ref() {
            Some(run) => A2aServerStatus {
                running: true,
                url: Some(format!("http://{}", run.bound)),
                project_id: Some(run.project_id),
                token: Some(run.token.clone()),
            },
            None => A2aServerStatus {
                running: false,
                url: None,
                project_id: None,
                token: None,
            },
        }
    }

    /// 문을 연다 (멱등 — 이미 열려 있으면 그 상태 그대로).
    ///
    /// 프로젝트가 바뀌면 **닫고 다시 연다**: 카드 하나가 에이전트 하나를
    /// 가리킨다는 것이 A2A 의 전제라, 한 문이 두 프로젝트를 섬기면 카드가
    /// 거짓이 된다.
    pub async fn start(&self, project_id: u32, root: PathBuf) -> Result<A2aServerStatus, String> {
        if let Some(current) = self.status().project_id {
            if current == project_id {
                return Ok(self.status());
            }
            self.stop();
        }

        let want = LoopbackAddr::new().socket_addr(DEFAULT_PORT);
        let listener = tokio::net::TcpListener::bind(want)
            .await
            .map_err(|e| format!("{want} 에 바인딩하지 못했습니다: {e}"))?;
        let bound = listener
            .local_addr()
            .map_err(|e| format!("바인딩 주소를 되읽지 못했습니다: {e}"))?;
        if !bound.ip().is_loopback() {
            drop(listener);
            return Err(format!("루프백이 아닌 주소({bound})에는 열지 않습니다"));
        }

        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let ctx = Ctx {
            root,
            project_id,
            token: token.clone(),
            url: format!("http://{bound}"),
        };
        let (tx, rx) = oneshot::channel::<()>();
        let app = router(ctx);
        tauri::async_runtime::spawn(async move {
            let serve = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = rx.await;
            });
            if let Err(e) = serve.await {
                tracing::warn!(error = %e, "A2A 엔드포인트가 오류로 끝났다");
            }
        });

        *self.server.lock().expect("a2a server state poisoned") = Some(Running {
            bound,
            project_id,
            token,
            _stop: tx,
        });
        Ok(self.status())
    }

    /// 닫는다 (멱등). `Running` 을 드롭하면 shutdown 신호가 함께 떨어진다.
    pub fn stop(&self) -> A2aServerStatus {
        self.server
            .lock()
            .expect("a2a server state poisoned")
            .take();
        self.status()
    }
}

fn router(ctx: Ctx) -> Router {
    Router::new()
        // 발견은 인증 없이 — A2A 의 카드는 공개 문서이고, 이 문 자체가
        // 루프백·옵트인이라 카드가 새어 나갈 자리가 없다.
        .route("/.well-known/agent-card.json", get(agent_card))
        .route("/a2a", post(rpc))
        .with_state(ctx)
}

/// A2A Agent Card. 필수 필드는 스펙 그대로 두고, 우리 확장은 `metadata` 에.
async fn agent_card(State(ctx): State<Ctx>) -> impl IntoResponse {
    let participants: Vec<Value> = registry::list_live(&ctx.root, Utc::now())
        .into_iter()
        .map(|c| json!({ "id": c.agent_id, "name": c.name, "surface": c.surface }))
        .collect();
    Json(json!({
        "protocolVersion": PROTOCOL_VERSION,
        "name": "ocul-pm",
        "description": "한 프로젝트에 붙어 있는 에이전트들의 공유 원장 — 참여자·우편함·태스크·구역 임대.",
        "url": format!("{}/a2a", ctx.url),
        "preferredTransport": "JSONRPC",
        "version": env!("CARGO_PKG_VERSION"),
        "capabilities": { "streaming": false, "pushNotifications": false, "stateTransitionHistory": true },
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            { "id": "message", "name": "메시지 배달", "description": "참여자에게 한 마디 보낸다", "tags": ["a2a"] },
            { "id": "tasks", "name": "태스크 조회", "description": "넘긴 작업의 상태를 읽는다", "tags": ["a2a"] }
        ],
        "metadata": { "oculpm": { "projectId": ctx.project_id, "participants": participants } },
    }))
}

fn rpc_error(id: Value, code: i32, message: &str) -> Json<Value> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
}

fn rpc_ok(id: Value, result: Value) -> Json<Value> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// JSON-RPC 2.0 진입점. 토큰이 맞아야 한 줄이라도 읽는다.
async fn rpc(
    State(ctx): State<Ctx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    body: String,
) -> axum::response::Response {
    // 심층 방어 — 루프백에만 바인딩했지만 출발지도 확인한다.
    if !peer.ip().is_loopback() {
        return (StatusCode::FORBIDDEN, "loopback only").into_response();
    }
    let authorized = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|token| token == ctx.token);
    if !authorized {
        return (StatusCode::UNAUTHORIZED, "bad or missing bearer token").into_response();
    }

    let Ok(req) = serde_json::from_str::<Value>(&body) else {
        return rpc_error(Value::Null, -32700, "parse error").into_response();
    };
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = req.get("method").and_then(Value::as_str) else {
        return rpc_error(id, -32600, "invalid request").into_response();
    };
    let empty = json!({});
    let params = req.get("params").unwrap_or(&empty);
    audit(&ctx, method, peer);

    match method {
        "agents/list" => rpc_ok(
            id,
            json!({
                "agents": registry::list_live(&ctx.root, Utc::now())
                    .into_iter()
                    .map(|c| json!({ "id": c.agent_id, "name": c.name, "surface": c.surface }))
                    .collect::<Vec<_>>()
            }),
        )
        .into_response(),
        "message/send" => message_send(&ctx, id, params).into_response(),
        "tasks/get" => match params.get("id").and_then(Value::as_str) {
            Some(task_id) => match tasks::read(&ctx.root, task_id) {
                Some(task) => rpc_ok(id, a2a_task(&task)).into_response(),
                None => rpc_error(id, -32001, "task not found").into_response(),
            },
            None => rpc_error(id, -32602, "'id' is required").into_response(),
        },
        // 조용히 성공한 척하지 않는다 — 상대가 오지 않을 답을 기다리게 된다.
        "message/stream"
        | "tasks/resubscribe"
        | "tasks/cancel"
        | "tasks/pushNotificationConfig/set"
        | "tasks/pushNotificationConfig/get"
        | "tasks/pushNotificationConfig/list"
        | "tasks/pushNotificationConfig/delete"
        | "agent/getAuthenticatedExtendedCard" => {
            rpc_error(id, -32004, "this operation is not supported yet").into_response()
        }
        _ => rpc_error(id, -32601, "method not found").into_response(),
    }
}

/// A2A `message/send` → 우리 우편함.
///
/// **받는 이를 반드시 짚어야 한다**(`metadata.to`). 우리 카드가 가리키는 것은
/// 에이전트 하나가 아니라 **여럿이 붙어 있는 원장**이라, 누구에게 보내는지 없이는
/// 배달할 곳이 없다. `agents/list` 가 그 목록이다.
fn message_send(ctx: &Ctx, id: Value, params: &Value) -> Json<Value> {
    let Some(to) = params.pointer("/metadata/to").and_then(Value::as_str) else {
        return rpc_error(
            id,
            -32602,
            "metadata.to is required — call agents/list to pick a recipient",
        );
    };
    let text = params
        .pointer("/message/parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        return rpc_error(id, -32602, "message.parts must carry text");
    }
    let from = params
        .pointer("/metadata/from")
        .and_then(Value::as_str)
        .unwrap_or("remote");

    match mailbox::send(
        &ctx.root,
        &mailbox::Outgoing {
            from: from.to_string(),
            to: to.to_string(),
            text,
            task_id: params
                .pointer("/message/taskId")
                .and_then(Value::as_str)
                .map(str::to_string),
            artifacts: Vec::new(),
        },
        Utc::now(),
    ) {
        Ok(message) => rpc_ok(
            id,
            json!({ "kind": "message", "messageId": message.id, "role": "agent" }),
        ),
        Err(e) => rpc_error(id, -32602, &e.to_string()),
    }
}

/// 우리 Task → A2A Task 모양. 우리 것만 아는 값은 `metadata` 로 내린다.
fn a2a_task(task: &tasks::Task) -> Value {
    json!({
        "kind": "task",
        "id": task.id,
        "contextId": task.to,
        "status": {
            "state": task.state,
            "timestamp": task.updated_at,
        },
        "metadata": {
            "oculpm": {
                "from": task.from,
                "to": task.to,
                "title": task.title,
                "note": task.note,
                "artifacts": task.artifacts,
                "deadlineAt": task.deadline_at,
            }
        },
    })
}

/// 감사 로그 — 누가 무엇을 불렀는지. **본문은 남기지 않는다** (메시지에는
/// 사용자 내용이 실린다).
fn audit(ctx: &Ctx, method: &str, peer: SocketAddr) {
    let line = json!({
        "at": Utc::now().to_rfc3339(),
        "method": method,
        "peer": peer.ip().to_string(),
    })
    .to_string();
    let path = ctx.root.join(".oculpm/agents/audit/a2a.ndjson");
    let _ = crate::oculpm::atomic_io::append_ndjson(&path, &line);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn ctx(root: &std::path::Path) -> Ctx {
        Ctx {
            root: root.to_path_buf(),
            project_id: 7,
            token: "secret-token".to_string(),
            url: "http://127.0.0.1:8737".to_string(),
        }
    }

    async fn call(root: &std::path::Path, token: Option<&str>, body: Value) -> (StatusCode, Value) {
        // 실제 서비스에서는 axum 이 실어 주는 값 — 라우터만 태우는 테스트에서는
        // 우리가 넣는다 (없으면 추출기가 500 을 낸다).
        let mut req = Request::builder()
            .method("POST")
            .uri("/a2a")
            .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 51234))));
        if let Some(token) = token {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        let response = router(ctx(root))
            .oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    /// 루프백 주소 말고는 **만들 수가 없다** (모바일 브리지와 같은 규율).
    #[test]
    fn the_bind_address_can_only_be_loopback() {
        assert!(LoopbackAddr::new()
            .socket_addr(DEFAULT_PORT)
            .ip()
            .is_loopback());
    }

    #[tokio::test]
    async fn the_card_is_public_but_the_rpc_needs_a_token() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let card = router(ctx(root))
            .oneshot(
                Request::builder()
                    .uri("/.well-known/agent-card.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(card.status(), StatusCode::OK);

        let (status, _) = call(
            root,
            None,
            json!({"jsonrpc":"2.0","id":1,"method":"agents/list"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = call(
            root,
            Some("wrong"),
            json!({"jsonrpc":"2.0","id":1,"method":"agents/list"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, body) = call(
            root,
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":1,"method":"agents/list"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["result"]["agents"].is_array());
    }

    /// 외부에서 온 메시지는 **받는 이를 짚어야** 배달된다.
    #[tokio::test]
    async fn message_send_requires_a_named_recipient_and_lands_in_the_inbox() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let (_, body) = call(
            root,
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":1,"method":"message/send",
                   "params":{"message":{"parts":[{"kind":"text","text":"안녕"}]}}}),
        )
        .await;
        assert_eq!(
            body["error"]["code"], -32602,
            "받는 이가 없으면 거절: {body}"
        );

        let (_, body) = call(
            root,
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":2,"method":"message/send",
                   "params":{"message":{"parts":[{"kind":"text","text":"리뷰 부탁"}]},
                             "metadata":{"to":"codex-app","from":"cloud-agent"}}}),
        )
        .await;
        assert_eq!(body["result"]["kind"], "message", "{body}");

        let inbox = mailbox::unread(root, "codex-app");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].text, "리뷰 부탁");
        assert_eq!(inbox[0].from, "cloud-agent");
    }

    /// 안 되는 것은 **안 된다고 말한다** — 조용히 성공한 척하면 상대가
    /// 오지 않을 답을 기다린다.
    #[tokio::test]
    async fn unsupported_methods_say_so_instead_of_pretending() {
        let dir = tempfile::tempdir().unwrap();
        for method in ["message/stream", "tasks/cancel", "tasks/resubscribe"] {
            let (_, body) = call(
                dir.path(),
                Some("secret-token"),
                json!({"jsonrpc":"2.0","id":1,"method":method}),
            )
            .await;
            assert_eq!(body["error"]["code"], -32004, "{method}: {body}");
        }
        let (_, body) = call(
            dir.path(),
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":1,"method":"nope/nope"}),
        )
        .await;
        assert_eq!(body["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn tasks_get_returns_the_ledger_state() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let task = tasks::create(
            root,
            &tasks::NewTask {
                from: "claude-code-app".to_string(),
                to: "codex-app".to_string(),
                title: "고치기".to_string(),
                note: None,
                artifacts: Vec::new(),
                deadline_hours: None,
            },
            Utc::now(),
        )
        .unwrap();

        let (_, body) = call(
            root,
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":1,"method":"tasks/get","params":{"id":task.id}}),
        )
        .await;
        assert_eq!(body["result"]["status"]["state"], "submitted", "{body}");
        assert_eq!(body["result"]["metadata"]["oculpm"]["title"], "고치기");

        let (_, body) = call(
            root,
            Some("secret-token"),
            json!({"jsonrpc":"2.0","id":1,"method":"tasks/get","params":{"id":"nope"}}),
        )
        .await;
        assert_eq!(body["error"]["code"], -32001);
    }
}

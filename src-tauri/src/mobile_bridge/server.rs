//! MobileServer — axum 인프로세스 서버 수명 관리 (#mb0-axum, #mb1-dispatch).
//!
//! 별도 데몬이 아니라 Tauri 프로세스 안에서 돈다 (플랜 D2 #inprocess-server) —
//! 키체인·워처·DB 상태를 그대로 공유하고, 앱이 꺼지면 모바일도 꺼진다.
//!
//! 라우트 계약 (플랜 D3~D5):
//!   비보호  GET  /healthz              — 생존 확인 (버전 포함)
//!   비보호  POST /pair                 — 페어링 코드 → Bearer 토큰 (자체 rate-limit)
//!   보호    GET  /api/ping             — 폰이 토큰을 검증하는 용도
//!   보호    POST /api/invoke/{cmd}     — 화이트리스트 커맨드 디스패치 (dispatch.rs)
//!   비보호  GET  /*                    — 프런트 정적 서빙 (임베디드/dev dist)
//! 전 라우트 공통: Tailscale 인터페이스 바인드 + 출발지 IP 가드.
//!
//! 핸들러가 런타임 제네릭(R: tauri::Runtime)인 이유: 프로덕션은 Wry 지만
//! 통합 테스트는 MockRuntime 으로 같은 라우터를 tower oneshot 으로 돌린다.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Mutex, RwLock};
use std::time::Instant;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::Value;
use tauri::Manager as _;
use tokio::sync::oneshot;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::response::sse::{Event as SseFrame, KeepAlive, Sse};
use futures::StreamExt as _;

use super::bind::TailscaleBindAddr;
use super::dispatch::DispatchError;
use super::events::{EventHub, FORWARDED_EVENTS};
use super::pairing::{self, PairAttempt, PairingSession};
use crate::db::Db;

/// 기본 포트 — 설정 노출 전까지 고정값. IANA 미등록 대역.
pub const DEFAULT_PORT: u16 = 42815;

/// 실행 중 서버 핸들. drop 대신 `stop()` 의 oneshot 으로 graceful shutdown.
struct RunningServer {
    bound: SocketAddr,
    shutdown: oneshot::Sender<()>,
}

/// Tauri 관리 상태 — 서버는 동시에 최대 1개, 페어링 세션도 최대 1개.
#[derive(Default)]
pub struct MobileBridgeState {
    server: Mutex<Option<RunningServer>>,
    pairing: Mutex<Option<PairingSession>>,
    /// 발급 토큰의 blake3 해시 전집합 — 기동 시 DB 에서 적재, 페어링/해제 때 갱신.
    token_hashes: RwLock<HashSet<String>>,
    /// listen_any → SSE 재송출 허브 (#mb2-sse). Arc: 'static 리스너 클로저와 공유.
    event_hub: Arc<EventHub>,
    /// 이벤트 포워더는 최초 기동 때 1회만 등록한다 — 서버를 껐다 켜도 중복 등록
    /// 없음 (구독자가 없는 동안의 send 실패는 EventHub 가 무해하게 삼킨다).
    forwarders_registered: AtomicBool,
    /// 서버가 도는 동안의 caffeinate 자식 (#mb4-caffeinate, macOS 전용).
    /// -i: 유휴 시스템 잠자기만 막는다 — 뚜껑 닫힘은 못 막고, 그 한계는 설정
    /// 화면 안내문이 담당한다 (플랜 D7 — 자동 우회 안 함).
    caffeinate: Mutex<Option<std::process::Child>>,
}

/// 프런트에 주는 상태 스냅샷 (설정 '모바일' 탭이 소비).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct MobileBridgeStatus {
    pub running: bool,
    /// "100.x.y.z:port" — running 일 때만.
    pub addr: Option<String>,
}

/// `mobile_bridge_pairing_begin` 응답 — 설정 화면이 코드·QR 을 그린다.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct PairingInfo {
    pub code: String,
    pub url: String,
    pub expires_in_secs: u32,
}

impl MobileBridgeState {
    pub fn status(&self) -> MobileBridgeStatus {
        let guard = self.server.lock().expect("mobile bridge state poisoned");
        MobileBridgeStatus {
            running: guard.is_some(),
            addr: guard.as_ref().map(|s| format!("{}", s.bound)),
        }
    }

    /// 서버 기동. 이미 돌고 있으면 그 상태를 그대로 반환 (멱등).
    ///
    /// `TailscaleBindAddr` 만 받으므로 0.0.0.0/127.0.0.1 폴백은 컴파일 에러다
    /// (#mb0-bind-newtype).
    pub async fn start(&self, app: tauri::AppHandle) -> Result<MobileBridgeStatus, String> {
        if self.status().running {
            return Ok(self.status());
        }

        // 토큰 해시 적재 — 인증 미들웨어는 DB 왕복 없이 메모리 대조만 한다.
        let db = app.state::<Db>();
        let hashes = db.mobile_device_hashes().await.map_err(|e| e.to_string())?;
        *self.token_hashes.write().expect("token hash lock poisoned") =
            hashes.into_iter().collect();

        let addr = TailscaleBindAddr::detect().map_err(|e| e.to_string())?;
        let want = addr.socket_addr(DEFAULT_PORT);

        let listener = tokio::net::TcpListener::bind(want)
            .await
            .map_err(|e| format!("failed to bind {want}: {e}"))?;

        // 바인딩 후 되읽기 검증 — OS 가 다른 주소를 줬으면 리스너 폐기 (#mb0-bind-guard).
        let bound = listener
            .local_addr()
            .map_err(|e| format!("failed to read back bound address: {e}"))?;
        if bound.ip() != want.ip() {
            drop(listener);
            return Err(format!(
                "bound address {bound} does not match requested {want}; refusing to serve"
            ));
        }

        self.register_event_forwarders(&app);

        let router = router(app.clone());
        let (tx, rx) = oneshot::channel::<()>();

        tauri::async_runtime::spawn(async move {
            let serve = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = rx.await;
            });
            if let Err(e) = serve.await {
                tracing::error!("[mobile-bridge] server exited with error: {e}");
            } else {
                tracing::info!("[mobile-bridge] server stopped");
            }
        });

        tracing::info!("[mobile-bridge] serving on {bound}");
        let mut guard = self.server.lock().expect("mobile bridge state poisoned");
        *guard = Some(RunningServer { bound, shutdown: tx });
        drop(guard);
        self.start_caffeinate();
        Ok(self.status())
    }

    /// 서버가 살아 있는 동안 유휴 잠자기를 막는다 (#mb4-caffeinate). 실패해도
    /// 서버는 계속 — 전원 유지는 편의지 전제 조건이 아니다.
    fn start_caffeinate(&self) {
        #[cfg(target_os = "macos")]
        {
            let mut guard = self.caffeinate.lock().expect("caffeinate lock poisoned");
            if guard.is_some() {
                return;
            }
            match std::process::Command::new("/usr/bin/caffeinate").arg("-i").spawn() {
                Ok(child) => {
                    tracing::info!("[mobile-bridge] caffeinate started (pid {})", child.id());
                    *guard = Some(child);
                }
                Err(e) => tracing::warn!("[mobile-bridge] caffeinate failed to start: {e}"),
            }
        }
    }

    fn stop_caffeinate(&self) {
        let child = self.caffeinate.lock().expect("caffeinate lock poisoned").take();
        if let Some(mut c) = child {
            let _ = c.kill();
            let _ = c.wait();
            tracing::info!("[mobile-bridge] caffeinate stopped");
        }
    }

    /// graceful 중지. 진행 중 페어링 세션도 버린다. 안 돌고 있으면 no-op (멱등).
    pub fn stop(&self) -> MobileBridgeStatus {
        let server = self.server.lock().expect("mobile bridge state poisoned").take();
        if let Some(s) = server {
            let _ = s.shutdown.send(());
        }
        *self.pairing.lock().expect("pairing lock poisoned") = None;
        self.stop_caffeinate();
        self.status()
    }

    /// 페어링 세션 시작 — 기존 세션은 대체 (코드 재발급). 서버가 꺼져 있으면 에러.
    pub fn pairing_begin(&self) -> Result<PairingInfo, String> {
        let bound = {
            let guard = self.server.lock().expect("mobile bridge state poisoned");
            guard
                .as_ref()
                .map(|s| s.bound)
                .ok_or("mobile bridge is not running — start it first")?
        };
        let now = Instant::now();
        let session = PairingSession::begin(now);
        let info = PairingInfo {
            code: session.code().to_string(),
            url: format!("http://{bound}/"),
            expires_in_secs: session.remaining_secs(now) as u32,
        };
        *self.pairing.lock().expect("pairing lock poisoned") = Some(session);
        Ok(info)
    }

    pub fn has_token_hash(&self, hash: &str) -> bool {
        self.token_hashes.read().expect("token hash lock poisoned").contains(hash)
    }

    pub fn add_token_hash(&self, hash: String) {
        self.token_hashes.write().expect("token hash lock poisoned").insert(hash);
    }

    pub fn remove_token_hash(&self, hash: &str) {
        self.token_hashes.write().expect("token hash lock poisoned").remove(hash);
    }

    /// 화이트리스트 이벤트를 허브로 흘리는 listen_any 등록 (1회).
    fn register_event_forwarders<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) {
        if self.forwarders_registered.swap(true, Ordering::SeqCst) {
            return;
        }
        use tauri::Listener as _;
        for name in FORWARDED_EVENTS {
            let hub = Arc::clone(&self.event_hub);
            app.listen_any(*name, move |event| {
                hub.publish(name, event.payload().to_string());
            });
        }
        tracing::info!("[mobile-bridge] forwarding {} event kinds to SSE", FORWARDED_EVENTS.len());
    }
}

fn router<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Router {
    let version = app.package_info().version.to_string();
    let protected = Router::new()
        .route("/api/ping", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .route("/api/invoke/{cmd}", post(invoke_cmd::<R>))
        .route("/api/events", get(events_sse::<R>))
        .route("/api/chat", post(chat_sse))
        .layer(axum::middleware::from_fn_with_state(app.clone(), require_bearer::<R>));

    Router::new()
        .route(
            "/healthz",
            get(move || {
                let version = version.clone();
                async move { Json(serde_json::json!({ "ok": true, "version": version })) }
            }),
        )
        .route("/pair", post(pair::<R>))
        .merge(protected)
        .fallback(get(serve_static::<R>))
        .layer(axum::middleware::from_fn(guard_peer))
        .with_state(app)
}

/// 심층 방어 — 출발지 IP 가 100.64.0.0/10 밖이면 거부 (#mb0-bind-guard).
/// Tailscale 인터페이스에만 바인드하므로 정상 경로에선 항상 통과한다.
async fn guard_peer(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    match peer {
        SocketAddr::V4(v4) if super::bind::in_cgnat_range(*v4.ip()) => next.run(req).await,
        _ => {
            tracing::warn!("[mobile-bridge] rejected request from non-tailnet peer {peer}");
            StatusCode::FORBIDDEN.into_response()
        }
    }
}

/// Bearer 토큰 검증 — blake3 해시를 메모리 집합과 대조. 통과 시 last_seen 갱신.
async fn require_bearer<R: tauri::Runtime>(
    State(app): State<tauri::AppHandle<R>>,
    req: Request,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let Some(token) = token else {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "missing bearer token" })))
            .into_response();
    };
    let hash = pairing::hash_token(token);
    let state = app.state::<MobileBridgeState>();
    if !state.has_token_hash(&hash) {
        tracing::warn!("[mobile-bridge] rejected request with unknown token");
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "invalid token" })))
            .into_response();
    }
    let db = app.state::<Db>();
    let _ = db
        .mobile_device_touch(hash, chrono::Local::now().to_rfc3339())
        .await;
    next.run(req).await
}

/// POST /api/chat — LLM 스트리밍 (#mb4-chat-sse).
///
/// IPC Channel 을 못 쓰는 폰을 위한 chat_stream 의 SSE 판 — 본체는
/// `commands::llm::run_chat_stream` 공유라 폴백·부분응답 규칙이 동일하다.
/// 프레임: event "chat", data = ChatEvent JSON ({kind:"delta"|"done"|"error"}).
/// API 키는 서버(키체인)에서 읽는다 — 폰에는 키가 절대 내려가지 않는다 (D5).
async fn chat_sse(
    Json(body): Json<ChatSseRequest>,
) -> Sse<impl futures::Stream<Item = Result<SseFrame, std::convert::Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<crate::llm::ChatEvent>(32);
    tauri::async_runtime::spawn(async move {
        // 종료 신호(Done/Error)는 run_chat_stream 이 싱크로 보낸다 — 반환값은
        // 이미 스트림에 실려 있어 별도 처리 불필요.
        let _ = crate::commands::llm::run_chat_stream(
            body.provider,
            body.messages,
            body.options,
            body.fallbacks,
            tx,
        )
        .await;
    });
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event)
            .unwrap_or_else(|e| format!(r#"{{"kind":"error","message":"serialize: {e}"}}"#));
        Ok(SseFrame::default().event("chat").data(data))
    });
    Sse::new(stream)
}

#[derive(serde::Deserialize)]
struct ChatSseRequest {
    provider: String,
    messages: Vec<crate::llm::Message>,
    options: crate::llm::ChatOptions,
    #[serde(default)]
    fallbacks: Vec<crate::commands::llm::ProviderModel>,
}

/// GET /api/events — SSE 이벤트 스트림 (#mb2-sse).
///
/// EventSource 는 커스텀 헤더를 못 실으므로 폰 셤은 fetch 스트리밍으로 읽는다
/// (Bearer 는 보통 헤더, Last-Event-ID 도 헤더). 재접속 시 버퍼(256) 안이면
/// 놓친 것부터 재전송. keep-alive 주석 15초.
async fn events_sse<R: tauri::Runtime>(
    State(app): State<tauri::AppHandle<R>>,
    headers: axum::http::HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<SseFrame, std::convert::Infallible>>> {
    let state = app.state::<MobileBridgeState>();
    let last: Option<u64> = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse().ok());

    // 구독을 먼저 열고 스냅샷을 뜬다 — 사이에 낀 이벤트는 live 쪽에 있고,
    // cutoff 필터가 재전송분과의 중복만 걷어낸다 (유실도 중복도 없음).
    let rx = state.event_hub.subscribe();
    let replay = state.event_hub.since(last);
    let cutoff = replay.last().map(|e| e.id).or(last).unwrap_or(0);

    let replay_stream = futures::stream::iter(replay);
    let live = tokio_stream::wrappers::BroadcastStream::new(rx)
        .filter_map(move |r| futures::future::ready(r.ok().filter(|e| e.id > cutoff)));

    let stream = replay_stream.chain(live).map(|e| {
        Ok(SseFrame::default()
            .id(e.id.to_string())
            .event(e.event)
            .data(e.payload))
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("ping"),
    )
}

/// POST /api/invoke/{cmd} — 화이트리스트 디스패치 (#mb1-dispatch).
///
/// 응답 계약 (#mb1-envelope): 성공 = 커맨드 Ok 값의 JSON 그대로 (네이티브 invoke
/// 의 resolve 에 대응) / 404 미등재 / 400 인자 오류 / 422 커맨드 Err (reject 대응).
async fn invoke_cmd<R: tauri::Runtime>(
    State(app): State<tauri::AppHandle<R>>,
    axum::extract::Path(cmd): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> Response {
    let body_val = if body.is_empty() {
        Value::Object(Default::default())
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => v,
            Err(e) => return error_json(StatusCode::BAD_REQUEST, &format!("invalid JSON body: {e}")),
        }
    };

    let started = Instant::now();
    let result = super::dispatch::dispatch(&app, &cmd, body_val).await;
    let ms = started.elapsed().as_millis();

    // 감사 로그 — 커맨드명·소요·결과만. 인자와 응답 본문은 남기지 않는다
    // (일지 본문·시크릿 유출 방지 — redact 원칙과 동일 선상).
    match &result {
        Ok(_) => tracing::info!("[mobile-bridge] invoke {cmd} ok ({ms}ms)"),
        Err(DispatchError::UnknownCommand) => {
            tracing::warn!("[mobile-bridge] invoke {cmd} rejected: not whitelisted")
        }
        Err(DispatchError::BadArgs(m)) => {
            tracing::warn!("[mobile-bridge] invoke {cmd} bad args: {m}")
        }
        Err(DispatchError::Command(_)) => {
            tracing::warn!("[mobile-bridge] invoke {cmd} returned error ({ms}ms)")
        }
    }

    match result {
        Ok(v) => Json(v).into_response(),
        Err(DispatchError::UnknownCommand) => error_json(StatusCode::NOT_FOUND, "unknown command"),
        Err(DispatchError::BadArgs(m)) => error_json(StatusCode::BAD_REQUEST, &m),
        Err(DispatchError::Command(m)) => error_json(StatusCode::UNPROCESSABLE_ENTITY, &m),
    }
}

#[derive(serde::Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    name: String,
}

/// POST /pair — 코드 대조에 성공하면 토큰을 **1회** 돌려주고 해시만 남긴다.
async fn pair<R: tauri::Runtime>(
    State(app): State<tauri::AppHandle<R>>,
    Json(body): Json<PairRequest>,
) -> Response {
    let state = app.state::<MobileBridgeState>();
    let now = Instant::now();

    // 세션 판정 — 잠금 안에서 대조까지 끝내고, 결과에 따라 소모/유지한다.
    let attempt = {
        let mut guard = state.pairing.lock().expect("pairing lock poisoned");
        let Some(session) = guard.as_mut() else {
            return error_json(StatusCode::NOT_FOUND, "no pairing in progress");
        };
        let attempt = session.check(&body.code, now);
        match attempt {
            // 1회용 — 성공·만료·소진 모두 세션을 태운다.
            PairAttempt::Accepted | PairAttempt::Expired | PairAttempt::Exhausted => {
                *guard = None;
            }
            PairAttempt::WrongCode { .. } => {}
        }
        attempt
    };

    match attempt {
        PairAttempt::Expired => error_json(StatusCode::GONE, "pairing code expired"),
        PairAttempt::Exhausted => {
            error_json(StatusCode::TOO_MANY_REQUESTS, "too many attempts — pairing cancelled")
        }
        PairAttempt::WrongCode { remaining } => error_json(
            StatusCode::FORBIDDEN,
            &format!("wrong code ({remaining} attempts remaining)"),
        ),
        PairAttempt::Accepted => {
            let token = pairing::generate_token();
            let hash = pairing::hash_token(&token);
            let name = if body.name.trim().is_empty() {
                "mobile device".to_string()
            } else {
                body.name.trim().chars().take(64).collect()
            };
            let db = app.state::<Db>();
            if let Err(e) = db
                .mobile_device_insert(name, hash.clone(), chrono::Local::now().to_rfc3339())
                .await
            {
                tracing::error!("[mobile-bridge] failed to persist paired device: {e}");
                return error_json(StatusCode::INTERNAL_SERVER_ERROR, "failed to persist device");
            }
            state.add_token_hash(hash);
            tracing::info!("[mobile-bridge] paired new device");
            Json(serde_json::json!({ "token": token })).into_response()
        }
    }
}

/// 프런트 정적 서빙 (#mb0-static).
///
/// 패키징 빌드는 바이너리에 임베드된 에셋(`AssetResolver`)에서 — 디스크에 dist 가
/// 없고, 리졸버는 정규화된 경로만 알아 경로 탈출이 성립하지 않는다.
/// dev 빌드는 임베드가 없으므로 `$CARGO_MANIFEST_DIR/../dist` 의 ServeDir 폴백
/// (ServeDir 자체가 `..` 세그먼트를 거부한다 — secure_docs_join 과 같은 성질).
/// SPA 라우팅: 파일이 없으면 index.html.
async fn serve_static<R: tauri::Runtime>(
    State(app): State<tauri::AppHandle<R>>,
    req: Request,
) -> Response {
    let path = req.uri().path().to_string();
    let resolver = app.asset_resolver();
    let key = if path == "/" { "/index.html".to_string() } else { path.clone() };

    if let Some(asset) = resolver.get(key.clone()).or_else(|| {
        // SPA 폴백 — 알 수 없는 경로는 index.html (딥링크 새로고침 대응).
        if key.rsplit('/').next().is_some_and(|seg| !seg.contains('.')) {
            resolver.get("/index.html".to_string())
        } else {
            None
        }
    }) {
        return ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response();
    }

    // dev 폴백 — pnpm build 산출물. 없으면 404 에 안내를 담는다.
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dist.is_dir() {
        let svc = tower_http::services::ServeDir::new(&dist)
            .append_index_html_on_directories(true)
            .fallback(tower_http::services::ServeFile::new(dist.join("index.html")));
        use tower::ServiceExt as _;
        return match svc.oneshot(req).await {
            Ok(res) => res.into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        };
    }
    error_json(
        StatusCode::NOT_FOUND,
        "no frontend assets — run `pnpm build` for the dev fallback",
    )
}

fn error_json(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use axum::body::{to_bytes, Body};
    use axum::http::Request as HttpRequest;
    use tower::ServiceExt as _;

    use super::*;

    /// MockRuntime 앱 + 임시 DB — 라우터 통합 테스트의 공통 바닥.
    async fn test_app() -> (tauri::App<tauri::test::MockRuntime>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let db = Db::open(dir.path().join("test.db")).await.unwrap();
        app.manage(db);
        app.manage(crate::oculpm::manager::OculpmManager::new());
        app.manage(MobileBridgeState::default());
        (app, dir)
    }

    fn request(
        method: &str,
        uri: &str,
        peer: Ipv4Addr,
        token: Option<&str>,
        json_body: Option<&str>,
    ) -> HttpRequest<Body> {
        let mut b = HttpRequest::builder().method(method).uri(uri);
        if let Some(t) = token {
            b = b.header("authorization", format!("Bearer {t}"));
        }
        let body = match json_body {
            Some(j) => {
                b = b.header("content-type", "application/json");
                Body::from(j.to_string())
            }
            None => Body::empty(),
        };
        let mut req = b.body(body).unwrap();
        // into_make_service_with_connect_info 가 serve 시점에 넣는 것을 재현.
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((peer, 51234))));
        req
    }

    const TAILNET: Ipv4Addr = Ipv4Addr::new(100, 90, 1, 2);
    const LAN: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 5);

    async fn body_json(res: Response) -> Value {
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn healthz_ok_from_tailnet_peer() {
        let (app, _dir) = test_app().await;
        let res = router(app.handle().clone())
            .oneshot(request("GET", "/healthz", TAILNET, None, None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await["ok"], Value::Bool(true));
    }

    #[tokio::test]
    async fn non_tailnet_peer_is_forbidden_everywhere() {
        let (app, _dir) = test_app().await;
        for uri in ["/healthz", "/pair", "/api/ping", "/api/invoke/list_projects"] {
            let res = router(app.handle().clone())
                .oneshot(request("GET", uri, LAN, None, None))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{uri}");
        }
    }

    #[tokio::test]
    async fn protected_routes_require_token() {
        let (app, _dir) = test_app().await;
        // 토큰 없음 → 401.
        let res = router(app.handle().clone())
            .oneshot(request("GET", "/api/ping", TAILNET, None, None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        // 모르는 토큰 → 401.
        let res = router(app.handle().clone())
            .oneshot(request("GET", "/api/ping", TAILNET, Some("bogus"), None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    /// 페어링 → 토큰 → 보호 라우트 왕복 (#mb1-tests 의 축).
    #[tokio::test]
    async fn pair_then_invoke_roundtrip() {
        let (app, _dir) = test_app().await;
        let state = app.state::<MobileBridgeState>();

        // 세션 심기 — pairing_begin() 은 실행 중 서버(bound 주소)를 요구하므로
        // 테스트는 같은 모듈 특권으로 세션만 넣는다.
        let session = PairingSession::begin(Instant::now());
        let code = session.code().to_string();
        *state.pairing.lock().unwrap() = Some(session);

        // 틀린 코드 → 403, 세션은 유지.
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/pair", TAILNET, None, Some(r#"{"code":"999999x"}"#)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // 맞는 코드 → 토큰 1회 발급.
        let body = format!(r#"{{"code":"{code}","name":"test phone"}}"#);
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/pair", TAILNET, None, Some(&body)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let token = body_json(res).await["token"].as_str().unwrap().to_string();

        // 세션은 소모됐다 — 같은 코드 재사용 불가.
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/pair", TAILNET, None, Some(&body)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        // 발급 토큰으로 보호 라우트 통과.
        let res = router(app.handle().clone())
            .oneshot(request("GET", "/api/ping", TAILNET, Some(&token), None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // invoke — 빈 DB 의 list_projects 는 네이티브와 같은 [] (#mb1-envelope).
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/api/invoke/list_projects", TAILNET, Some(&token), Some("{}")))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await, serde_json::json!([]));

        // settings_get(None) → null — Option 직렬화가 네이티브 계약 그대로.
        let res = router(app.handle().clone())
            .oneshot(request(
                "POST", "/api/invoke/settings_get", TAILNET, Some(&token), Some(r#"{"key":"nope"}"#),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await, Value::Null);

        // 미등재 커맨드 → 404. clear_all_data 는 실존하지만 화이트리스트 밖.
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/api/invoke/clear_all_data", TAILNET, Some(&token), Some("{}")))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        // 인자 타입 오류 → 400.
        let res = router(app.handle().clone())
            .oneshot(request(
                "POST", "/api/invoke/project_stats", TAILNET, Some(&token), Some(r#"{"projectId":"abc"}"#),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    /// chat SSE — 미설정 프로바이더는 스트림 안의 error 이벤트로 끝난다
    /// (#mb4-chat-sse). 네트워크·API 키 없이 전체 파이프를 검증한다.
    #[tokio::test]
    async fn chat_sse_streams_error_event_for_unconfigured_provider() {
        let (app, _dir) = test_app().await;
        let state = app.state::<MobileBridgeState>();
        let token = pairing::generate_token();
        state.add_token_hash(pairing::hash_token(&token));

        let body = r#"{"provider":"no-such-provider","messages":[],"options":{"model":"x","temperature":null,"max_tokens":null},"fallbacks":[]}"#;
        let res = router(app.handle().clone())
            .oneshot(request("POST", "/api/chat", TAILNET, Some(&token), Some(body)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let mut stream = res.into_body().into_data_stream();
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
            .await
            .expect("chat SSE first frame timed out")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&first);
        assert!(text.contains("event: chat"), "{text}");
        assert!(text.contains(r#""kind":"error""#), "{text}");
    }

    /// 실제 emit → listen_any 포워더 → SSE 재전송까지의 전체 파이프 (#mb2-sse).
    #[tokio::test]
    async fn sse_replays_missed_events_after_reconnect() {
        let (app, _dir) = test_app().await;
        let state = app.state::<MobileBridgeState>();
        state.register_event_forwarders(&app.handle().clone());

        // 화이트리스트 이벤트는 허브에 쌓인다.
        use tauri::Emitter as _;
        app.emit("oculpm-journal-added", serde_json::json!({ "project_id": 1 })).unwrap();
        app.emit("settings-changed", serde_json::json!({ "keys": ["theme"] })).unwrap();
        // 화이트리스트 밖 이벤트는 무시된다.
        app.emit("window-tabs-changed", serde_json::json!({})).unwrap();

        // 토큰 준비 (보호 라우트).
        let token = pairing::generate_token();
        state.add_token_hash(pairing::hash_token(&token));

        // Last-Event-ID: 1 → id 2 만 재전송받아야 한다.
        let mut req = request("GET", "/api/events", TAILNET, Some(&token), None);
        req.headers_mut().insert("last-event-id", "1".parse().unwrap());
        let res = router(app.handle().clone()).oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let mut body = res.into_body().into_data_stream();
        let first = tokio::time::timeout(std::time::Duration::from_secs(2), body.next())
            .await
            .expect("SSE first frame timed out")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&first);
        assert!(text.contains("id: 2"), "재전송 프레임에 id 2: {text}");
        assert!(text.contains("event: settings-changed"), "{text}");
        assert!(!text.contains("oculpm-journal-added"), "id 1 은 재전송 금지: {text}");
        assert!(!text.contains("window-tabs-changed"), "비화이트리스트 유입: {text}");
    }
}

//! PR-ACP0 — ACP 클라이언트 런타임 공존 검증 (docs/acp-panel/00-master-plan.md §5).
//!
//! 이 라운드의 **유일한 미검증 리스크**를 좁히기 위한 테스트다: 프로토콜이
//! 되느냐가 아니라(스크래치 스파이크로 이미 확인), `agent-client-protocol`
//! 크레이트가 쓰는 `async-process`/`async-io` 리액터가 **tauri 와 같은 tokio
//! 멀티스레드 런타임 안에서** 살아 있느냐다. 두 리액터가 서로를 굶기면
//! 여기서 타임아웃으로 드러난다.
//!
//! 기본 `#[ignore]` — 외부 의존(네트워크·Node·Claude Code 로그인)이 있어
//! CI 게이트에 넣지 않는다. 수동 실행:
//!
//! ```bash
//! cargo test --test acp_handshake -- --ignored --nocapture --test-threads=1
//! ```
//!
//! `--test-threads=1` 이 필요하다: 각 테스트가 어댑터(=Claude Code 세션)를 하나씩
//! 띄우므로 병렬로 돌리면 6개가 동시에 뜬다. 레이트리밋에 걸려 **본 변경과
//! 무관한 실패**가 나온다 (실측: 병렬 1건 실패 → 단독 재실행 통과).

use std::time::Duration;

use agent_client_protocol::schema::v1::InitializeRequest;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};

/// 어댑터 실행 커맨드. 버전 고정은 PR-ACP1 의 설치 경로가 담당한다 —
/// 여기서는 스파이크와 동일하게 npx 로 최신을 끌어온다.
const ADAPTER_ARGV: [&str; 3] = ["npx", "-y", "@agentclientprotocol/claude-agent-acp"];

/// 어댑터 콜드 스타트(npx 캐시 미스 포함)를 감안한 여유.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);

/// 도구를 쓰는 턴은 모델 왕복이 여러 번이라 더 넉넉하게.
const TURN_TIMEOUT: Duration = Duration::from_secs(240);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn acp_handshake_survives_tokio_runtime() {
    let agent = AcpAgent::from_args(ADAPTER_ARGV).expect("어댑터 커맨드 파싱");

    let handshake = Client.builder().name("ocul-pm").connect_with(
        agent,
        |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            eprintln!("agentInfo = {:?}", init.agent_info);
            eprintln!("authMethods = {:?}", init.auth_methods);
            Ok(init)
        },
    );

    let init = tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake)
        .await
        .expect("핸드셰이크 타임아웃 — async-io 리액터가 tokio 런타임에서 굶었을 가능성")
        .expect("핸드셰이크 실패");

    // 스파이크에서 확인한 두 가지가 Rust 경로에서도 성립하는지 —
    // ① 응답이 실제로 파싱된다, ② 인증 절차가 없다(구독 로그인 재사용).
    assert!(
        init.auth_methods.is_empty(),
        "authMethods 가 비어 있지 않다 — 인증 흐름 설계가 필요하다: {:?}",
        init.auth_methods
    );
}

/// PR-ACP1 — 실제 조달 경로(node 해석 → 버전 고정 설치 → 그 진입점으로 기동)가
/// 통째로 도는지. `npx` 우회 없이 앱이 릴리스에서 밟을 경로 그대로다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn adapter_installs_and_starts_from_pinned_entry() {
    use ocul_pm_lib::acp::{adapter, env};

    let (node, node_src) = env::resolve_binary("node")
        .await
        .expect("node 를 찾지 못했다 — PATH 도 로그인 셸도 실패");
    let (npm, _) = env::resolve_binary("npm")
        .await
        .expect("npm 을 찾지 못했다");
    let version = env::node_version(&node).await.expect("node --version 실패");
    eprintln!("node = {} ({:?}) {version}", node.display(), node_src);

    let major = env::parse_node_major(&version).expect("node 버전 파싱");
    assert!(
        major >= env::MIN_NODE_MAJOR,
        "Node {major} 는 최소 버전 미만"
    );

    // 앱 데이터 디렉터리 대역 — 실제 앱 설치본을 건드리지 않는다.
    let app_data = tempfile::tempdir().expect("임시 폴더");
    let path_env = env::effective_path().await;

    let installed = adapter::install(app_data.path(), &npm, &path_env)
        .await
        .expect("어댑터 설치 실패");
    assert_eq!(
        installed,
        adapter::PINNED_VERSION,
        "고정 버전이 설치돼야 한다"
    );
    assert_eq!(
        adapter::installed_version(app_data.path()).as_deref(),
        Some(adapter::PINNED_VERSION)
    );

    // 설치된 진입점을 node 로 직접 띄워 핸드셰이크 — process::start 가 하는 것과
    // 같은 조합(node + entry + PATH)이다.
    let entry = adapter::entry_path(app_data.path());
    let config = agent_client_protocol::AcpAgentConfig::new(&node)
        .arg(entry.to_string_lossy().to_string())
        .env("PATH", &path_env);

    let handshake = Client.builder().name("ocul-pm").connect_with(
        AcpAgent::new(config),
        |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await
        },
    );

    let init = tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake)
        .await
        .expect("핸드셰이크 타임아웃")
        .expect("핸드셰이크 실패");

    let info = init.agent_info.expect("agentInfo 가 없다");
    assert_eq!(info.version, adapter::PINNED_VERSION);
}

/// Codex도 앱의 고정 설치 경로에서 실제 ACP initialize 응답을 돌려준다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Codex 로그인) — 수동 실행 전용"]
async fn codex_adapter_installs_and_starts_from_pinned_entry() {
    use agent_client_protocol::schema::v1::{
        ContentBlock, NewSessionRequest, PromptRequest, TextContent,
    };
    use ocul_pm_lib::acp::{adapter, env};

    let (node, _) = env::resolve_binary("node")
        .await
        .expect("node 를 찾지 못했다");
    let (npm, _) = env::resolve_binary("npm")
        .await
        .expect("npm 을 찾지 못했다");
    let app_data = tempfile::tempdir().expect("임시 폴더");
    let workspace = tempfile::tempdir().expect("임시 작업 폴더");
    let cwd = workspace.path().to_path_buf();
    let path_env = env::effective_path().await;

    let installed = adapter::install_codex(app_data.path(), &npm, &path_env)
        .await
        .expect("Codex 어댑터 설치 실패");
    assert_eq!(installed, adapter::CODEX_PINNED_VERSION);

    let config = agent_client_protocol::AcpAgentConfig::new(&node)
        .arg(
            adapter::codex_entry_path(app_data.path())
                .to_string_lossy()
                .to_string(),
        )
        .env("PATH", &path_env);
    let handshake = Client.builder().name("ocul-pm").connect_with(
        AcpAgent::new(config),
        |cx: ConnectionTo<Agent>| async move {
            let init = cx
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let session = cx
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?
                .session_id;
            let response = cx
                .send_request(PromptRequest::new(
                    session,
                    vec![ContentBlock::Text(TextContent::new(
                        "Reply with exactly OK. Do not use tools.".to_string(),
                    ))],
                ))
                .block_task()
                .await?;
            Ok((init, response.stop_reason))
        },
    );

    let (init, stop_reason) = tokio::time::timeout(TURN_TIMEOUT, handshake)
        .await
        .expect("Codex 핸드셰이크 타임아웃")
        .expect("Codex 핸드셰이크 실패");
    let info = init.agent_info.expect("Codex agentInfo 가 없다");
    assert!(!info.name.is_empty());
    assert!(
        init.auth_methods
            .iter()
            .any(|method| method.id().0.as_ref() == "chat-gpt"),
        "ChatGPT 인증 방법을 광고하지 않았다: {:?}",
        init.auth_methods
    );
    assert_eq!(format!("{stop_reason:?}").to_lowercase(), "endturn");
}

/// PR-ACP2 — 프롬프트 한 턴이 **우리 이벤트 타입으로** 흘러나오는지.
///
/// 합성 값이 아니라 진짜 어댑터가 보내는 `session/update` 를 `map_update` 에
/// 통과시킨다 — 스키마가 바뀌어 매핑이 조용히 `Other` 로 미끄러지면 여기서 잡힌다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn prompt_streams_chunks_and_ends_the_turn() {
    use std::sync::{Arc, Mutex};

    use agent_client_protocol::schema::v1::{
        ContentBlock, NewSessionRequest, PromptRequest, SessionNotification, TextContent,
    };
    use ocul_pm_lib::acp::session::{map_update, stop_reason_label, AcpEvent};

    let seen: Arc<Mutex<Vec<AcpEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let collector = seen.clone();

    let agent = AcpAgent::from_args(ADAPTER_ARGV).expect("어댑터 커맨드 파싱");
    let cwd = tempfile::tempdir().expect("임시 작업 폴더");
    let cwd_path = cwd.path().to_path_buf();

    let turn = Client
        .builder()
        .name("ocul-pm")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                collector
                    .lock()
                    .unwrap()
                    .push(map_update(&notification.update));
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(agent, move |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let session = cx
                .send_request(NewSessionRequest::new(cwd_path))
                .block_task()
                .await?
                .session_id;

            let response = cx
                .send_request(PromptRequest::new(
                    session,
                    vec![ContentBlock::Text(TextContent::new(
                        "2 + 2 는? 숫자만 답해.".to_string(),
                    ))],
                ))
                .block_task()
                .await?;

            Ok(stop_reason_label(&response.stop_reason))
        });

    let stop_reason = tokio::time::timeout(HANDSHAKE_TIMEOUT, turn)
        .await
        .expect("턴 타임아웃")
        .expect("턴 실패");

    assert_eq!(stop_reason, "end_turn");

    let events = seen.lock().unwrap();
    let answer: String = events
        .iter()
        .filter_map(|e| match e {
            AcpEvent::Chunk { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        answer.contains('4'),
        "답변 청크가 Chunk 로 매핑되지 않았다 — 관측된 이벤트: {events:?}"
    );
    assert!(
        events.iter().any(|e| matches!(e, AcpEvent::Usage { .. })),
        "usage_update 가 Usage 로 매핑되지 않았다"
    );
}

/// PR-ACP3 — 도구 호출과 권한 요청이 **실제로** 흘러오는지.
///
/// 임시 폴더를 cwd 로 주고 읽기만 시킨다 — 저장소를 건드리지 않는다. 권한
/// 요청이 오면 첫 선택지로 승인하고, 그 뒤 턴이 정상 종료되는지까지 본다
/// (응답을 안 보내면 에이전트가 영영 멈춘다 — 그 계약이 지켜지는지가 핵심).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn tool_calls_and_permission_requests_reach_the_client() {
    use std::sync::{Arc, Mutex};

    use agent_client_protocol::schema::v1::{
        ContentBlock, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
        RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
        SessionNotification, TextContent,
    };
    use ocul_pm_lib::acp::session::{map_update, permission_event, stop_reason_label, AcpEvent};

    let events: Arc<Mutex<Vec<AcpEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let from_notifications = events.clone();
    let from_requests = events.clone();

    let workspace = tempfile::tempdir().expect("임시 작업 폴더");
    std::fs::write(workspace.path().join("hello.txt"), "hi\n").expect("픽스처 파일");
    let cwd = workspace.path().to_path_buf();

    let agent = AcpAgent::from_args(ADAPTER_ARGV).expect("어댑터 커맨드 파싱");

    let turn = Client
        .builder()
        .name("ocul-pm")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                from_notifications
                    .lock()
                    .unwrap()
                    .push(map_update(&notification.update));
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                from_requests
                    .lock()
                    .unwrap()
                    .push(permission_event("test-req".to_string(), &request));

                // **순서를 믿지 않는다.** 선택지 배열의 첫 항목이 승인이라는
                // 보장은 없다 — 실제로 거절이 앞에 오는 경우가 있어서, 처음엔
                // 승인했다고 믿었는데 파일이 안 생기는 형태로 드러났다.
                // 사용자가 "허용"을 누르는 것과 같으려면 kind 로 골라야 한다.
                for option in &request.options {
                    eprintln!("선택지: {} ({:?})", option.name, option.kind);
                }
                let allow = request
                    .options
                    .iter()
                    .find(|o| format!("{:?}", o.kind).to_lowercase().starts_with("allow"));
                let outcome = match allow {
                    Some(option) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option.option_id.clone()),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, move |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let session = cx
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?
                .session_id;

            let response = cx
                .send_request(PromptRequest::new(
                    session,
                    vec![ContentBlock::Text(TextContent::new(
                        // 쓰기를 시켜야 승인 요청이 뜬다(읽기는 보통 자동 승인된다).
                        // cwd 는 임시 폴더라 저장소는 안전하다.
                        "hello.txt 를 읽고 같은 폴더에 copy.txt 로 복사해줘.".to_string(),
                    ))],
                ))
                .block_task()
                .await?;

            Ok(stop_reason_label(&response.stop_reason))
        });

    let stop_reason = tokio::time::timeout(TURN_TIMEOUT, turn)
        .await
        .expect("턴 타임아웃 — 권한 응답이 전달되지 않았을 수 있다")
        .expect("턴 실패");

    assert_eq!(stop_reason, "end_turn");

    let seen = events.lock().unwrap();
    let tool_calls: Vec<&AcpEvent> = seen
        .iter()
        .filter(|e| matches!(e, AcpEvent::ToolCall { .. }))
        .collect();
    assert!(
        !tool_calls.is_empty(),
        "도구 호출이 ToolCall 로 매핑되지 않았다 — 관측: {:?}",
        seen.iter().map(kind_of).collect::<Vec<_>>()
    );

    let permissions = seen
        .iter()
        .filter(|e| matches!(e, AcpEvent::Permission { .. }))
        .count();
    eprintln!(
        "도구 호출 {}건 · 권한 요청 {permissions}건",
        tool_calls.len()
    );

    // 승인 계약의 핵심: 요청이 왔고, 우리가 응답했고, 그래서 턴이 **끝났다**.
    // 응답을 안 보내면 위 timeout 에서 죽는다. (기본 모드가 bypassPermissions /
    // acceptEdits 로 설정된 머신에서는 요청이 오지 않아 이 assert 가 실패한다.)
    assert!(
        permissions >= 1,
        "쓰기인데도 승인 요청이 오지 않았다 — Claude Code 권한 모드를 확인하라"
    );
    assert!(
        workspace.path().join("copy.txt").is_file(),
        "승인했는데 파일이 만들어지지 않았다 — 응답이 에이전트에 전달되지 않았다"
    );
}

/// 관측 이벤트를 종류 문자열로 (실패 메시지용).
#[allow(dead_code)]
fn kind_of(event: &ocul_pm_lib::acp::session::AcpEvent) -> &'static str {
    use ocul_pm_lib::acp::session::AcpEvent as E;
    match event {
        E::Chunk { .. } => "chunk",
        E::UserChunk { .. } => "user_chunk",
        E::Thought { .. } => "thought",
        E::Usage { .. } => "usage",
        E::ToolCall { .. } => "tool_call",
        E::ToolUpdate { .. } => "tool_update",
        E::Permission { .. } => "permission",
        E::ConfigChanged { .. } => "config_changed",
        E::Other { .. } => "other",
        E::Done { .. } => "done",
        E::Failed { .. } => "failed",
        // e883dd7 이 추가한 두 갈래. 와일드카드로 덮지 않는다 — 이 match 가
        // 비망라라서 컴파일이 깨지는 것이 새 이벤트를 놓치지 않게 하는 장치다.
        E::Failure { .. } => "failure",
        E::Plan { .. } => "plan",
        // 어댑터 0.70.0 의 파일 변경 감사.
        E::FileChangeReport { .. } => "file_change_report",
    }
}

/// PR-ACP4 — 세션 설정 변경이 실제로 먹히는지.
///
/// `SetSessionConfigOptionRequest` 의 값 표현(`value_id`)은 스키마에서 추론한
/// 것이라 와이어에서 한 번 확인해야 한다. 임시 세션이므로 사용자의 실제 설정에
/// 영향이 없다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn session_config_options_can_be_changed() {
    use agent_client_protocol::schema::v1::{
        NewSessionRequest, SessionConfigOptionValue, SetSessionConfigOptionRequest,
    };
    use ocul_pm_lib::acp::session::map_config_options;

    let agent = AcpAgent::from_args(ADAPTER_ARGV).expect("어댑터 커맨드 파싱");
    let cwd = tempfile::tempdir().expect("임시 작업 폴더");
    let cwd_path = cwd.path().to_path_buf();

    let changed = Client.builder().name("ocul-pm").connect_with(
        agent,
        move |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let created = cx
                .send_request(NewSessionRequest::new(cwd_path))
                .block_task()
                .await?;

            let options = map_config_options(created.config_options.as_deref().unwrap_or_default());
            eprintln!(
                "설정 항목: {:?}",
                options.iter().map(|o| o.id.as_str()).collect::<Vec<_>>()
            );

            // 모델을 sonnet 으로 — 임시 세션이라 사용자 설정은 그대로다.
            let model = options
                .iter()
                .find(|o| o.id == "model")
                .expect("model 설정 항목이 있어야 한다");
            let target = model
                .choices
                .iter()
                .find(|c| c.value == "sonnet")
                .expect("sonnet 선택지가 있어야 한다");

            cx.send_request(SetSessionConfigOptionRequest::new(
                created.session_id.clone(),
                "model".to_string(),
                SessionConfigOptionValue::value_id(target.value.clone()),
            ))
            .block_task()
            .await?;

            Ok(options.len())
        },
    );

    let count = tokio::time::timeout(HANDSHAKE_TIMEOUT, changed)
        .await
        .expect("설정 변경 타임아웃")
        .expect("설정 변경 실패 — value 표현이 틀렸을 수 있다");

    assert!(count >= 2, "모델·모드 정도는 있어야 한다 (관측 {count}개)");
}

/// PR-ACP5 — 첨부(`ResourceLink`)를 에이전트가 실제로 읽는지.
///
/// 우리는 파일 내용을 프롬프트에 넣지 않고 링크만 준다. 그 선택이 성립하려면
/// 에이전트가 링크를 따라가 읽어야 한다 — 안 읽으면 첨부가 조용히 무의미해진다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "외부 의존(Node·네트워크·Claude Code 로그인) — 수동 실행 전용"]
async fn attached_resource_links_are_read_by_the_agent() {
    use std::sync::{Arc, Mutex};

    use agent_client_protocol::schema::v1::{
        ContentBlock, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
        RequestPermissionRequest, RequestPermissionResponse, ResourceLink,
        SelectedPermissionOutcome, SessionNotification, TextContent,
    };
    use ocul_pm_lib::acp::session::{map_update, AcpEvent};

    // 모델이 지어낼 수 없는 토큰 — 진짜 읽었을 때만 답에 나온다.
    const SECRET: &str = "ZQ7-marmalade-1731";

    let workspace = tempfile::tempdir().expect("임시 작업 폴더");
    let file = workspace.path().join("notes.txt");
    std::fs::write(&file, format!("the passphrase is {SECRET}\n")).expect("픽스처 파일");
    let cwd = workspace.path().to_path_buf();
    let file_uri = format!("file://{}", file.display());

    let answer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let collector = answer.clone();

    let agent = AcpAgent::from_args(ADAPTER_ARGV).expect("어댑터 커맨드 파싱");

    let turn = Client
        .builder()
        .name("ocul-pm")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let AcpEvent::Chunk { text } = map_update(&notification.update) {
                    collector.lock().unwrap().push_str(&text);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let allow = request
                    .options
                    .iter()
                    .find(|o| format!("{:?}", o.kind).to_lowercase().starts_with("allow"));
                let outcome = match allow {
                    Some(option) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option.option_id.clone()),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, move |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let session = cx
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?
                .session_id;

            cx.send_request(PromptRequest::new(
                session,
                vec![
                    ContentBlock::Text(TextContent::new(
                        "첨부한 파일에 적힌 passphrase 를 그대로 답해. 다른 말은 하지 마."
                            .to_string(),
                    )),
                    ContentBlock::ResourceLink(ResourceLink::new("notes.txt", file_uri)),
                ],
            ))
            .block_task()
            .await
        });

    tokio::time::timeout(TURN_TIMEOUT, turn)
        .await
        .expect("턴 타임아웃")
        .expect("턴 실패");

    let text = answer.lock().unwrap().clone();
    assert!(
        text.contains(SECRET),
        "첨부 링크를 따라 읽지 않았다 — 답변: {text:?}"
    );
}

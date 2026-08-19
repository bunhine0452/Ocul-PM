//! PR-ACP1 — ACP 어댑터 커맨드 (docs/acp-panel/00-master-plan.md §5).
//!
//! 설정 → 통합 탭의 "에이전트 런타임" 블록과 에이전트 화면이 부른다. 로직은
//! `crate::acp` 소유 — 여기는 경로 해석(app_data / 프로젝트 루트)과 에러 문자열
//! 변환만 한다 (commands 는 얇게, CLAUDE.md 규약).

use std::path::PathBuf;

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, DeleteSessionRequest, ListSessionsRequest,
    McpServer, McpServerStdio, NewSessionRequest, PromptRequest,
    ImageContent, LoadSessionRequest, ResourceLink, SessionConfigOptionValue,
    SetSessionConfigOptionRequest,
    TextContent,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::acp::{self, AcpAgentInfo, AcpDiagnostics, AcpEvent, AcpState};
use crate::db::Db;

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 폴더를 찾을 수 없습니다: {e}"))
}

/// node·npm·claude·어댑터 설치 상태를 읽는다 (쓰기 없음).
#[tauri::command]
#[specta::specta]
pub async fn acp_diagnose(app: AppHandle) -> Result<AcpDiagnostics, String> {
    let dir = app_data_dir(&app)?;
    Ok(acp::diagnose(&dir).await)
}

/// 고정 버전 어댑터를 설치하고 갱신된 진단을 돌려준다 (멱등).
#[tauri::command]
#[specta::specta]
pub async fn acp_install_adapter(app: AppHandle) -> Result<AcpDiagnostics, String> {
    let dir = app_data_dir(&app)?;
    let (npm, _) = acp::env::resolve_binary("npm")
        .await
        .ok_or_else(|| "npm 을 찾을 수 없습니다 — Node.js 를 설치하세요".to_string())?;
    let path_env = acp::env::effective_path().await;

    acp::adapter::install(&dir, &npm, &path_env).await?;
    Ok(acp::diagnose(&dir).await)
}

/// 프롬프트에 함께 보낼 이미지 하나 (붙여넣기·드롭).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AcpImage {
    /// `image/png` 등.
    pub mime_type: String,
    /// data URI 접두사(`data:image/png;base64,`) 없이 **본문만**.
    pub data_base64: String,
}

/// 실행 중인 에이전트의 전체 상태 — 상대편 정보 + 세션 설정 항목.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AcpSession {
    pub agent: AcpAgentInfo,
    /// 슬래시 커맨드 목록 (`/plugin` 등) — 어댑터가 준 그대로.
    pub commands: Vec<acp::session::AcpCommand>,
    /// 현재 대화 세션 id — 목록에서 어느 것이 열려 있는지 표시하는 데 쓴다.
    pub session_id: Option<String>,
    /// 현재 세션 제목 (에이전트가 붙여 준 것. 아직이면 `None`).
    pub title: Option<String>,
    /// 모델 · Effort · Fast mode · 권한 모드 · 서브에이전트 …
    /// **어댑터가 준 그대로**다 — 우리가 목록을 들고 있지 않는다.
    pub options: Vec<acp::session::AcpConfigOption>,
}

/// 어댑터를 띄우고 `initialize` + `session/new` 까지 마친다 (이미 떠 있으면 그대로).
///
/// PR-ACP4 에서 세션 생성을 여기로 당겼다. 설정 항목(모델·Effort…)은
/// `session/new` 응답에만 실려 오는데, 첫 프롬프트까지 미루면 그때까지 셀렉터를
/// 그릴 수 없기 때문이다. cwd 는 프로젝트 루트로 이미 확정돼 있다.
#[tauri::command]
#[specta::specta]
pub async fn acp_start(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AcpSession, String> {
    let dir = app_data_dir(&app)?;
    let mut diagnostics = acp::diagnose(&dir).await;

    // Node 는 우리가 대신 깔지 않는다. 런타임을 말없이 시스템에 심는 것은
    // 사용자의 nvm/fnm 설정과 부딪히고, 무엇보다 물어보지 않고 할 일이 아니다.
    if !diagnostics.node_ok {
        return Err(format!(
            "Node.js {}+ 가 필요합니다 (현재: {})",
            diagnostics.node_min_major,
            diagnostics.node_version.as_deref().unwrap_or("없음")
        ));
    }

    // 어댑터는 **우리 것**이다 — 앱 데이터 안에만 깔리고 시스템을 건드리지 않는다.
    // 그래서 없으면 물어보지 않고 깐다. 여기서 깔면 Claude Code CLI 도 같이 온다
    // (SDK 의 플랫폼별 네이티브 바이너리) — 사용자가 따로 설치할 것은 Node 뿐이다.
    //
    // 첫 실행에 몇십 초가 걸릴 수 있지만 "설정에 가서 설치하세요" 라고 돌려보내는
    // 것보다 낫다 — 그 버튼을 찾아 누르는 것 말고 선택지가 없는 안내였다.
    if !diagnostics.adapter_ok {
        let (npm, _) = acp::env::resolve_binary("npm")
            .await
            .ok_or_else(|| "npm 을 찾을 수 없습니다 — Node.js 를 설치하세요".to_string())?;
        acp::adapter::install(&dir, &npm, &acp::env::effective_path().await).await?;
        diagnostics = acp::diagnose(&dir).await;
        if !diagnostics.adapter_ok {
            return Err(
                "ACP 어댑터 설치에 실패했습니다 — 설정 → 통합에서 다시 시도하세요".to_string(),
            );
        }
    }

    let node = PathBuf::from(
        diagnostics
            .node_path
            .ok_or_else(|| "node 경로를 해석하지 못했습니다".to_string())?,
    );
    let entry = acp::adapter::entry_path(&dir);
    let path_env = acp::env::effective_path().await;

    let agent = acp::process::start(app.clone(), project_id, &node, &entry, &path_env).await?;
    ensure_session(&app, &db, project_id).await?;

    Ok(session_snapshot(&app, project_id, agent))
}

/// 프런트에 돌려줄 현재 상태 한 벌.
fn session_snapshot(app: &AppHandle, project_id: u32, agent: AcpAgentInfo) -> AcpSession {
    let state = app.state::<AcpState>();
    AcpSession {
        agent,
        title: state.title(project_id),
        commands: state.commands(project_id),
        session_id: state.session(project_id).map(|s| s.0.to_string()),
        options: state.options(project_id),
    }
}

/// 이 세션에 물려 줄 MCP 서버들.
///
/// **우리 것 하나**다: `oculpm-mcp`. 그러면 앱 안의 Claude Code 가 `journal_write`
/// ·`plan_update` 같은 도구를 그대로 쓸 수 있다 — 프로젝트에 `.mcp.json` 을
/// 등록해 두지 않았어도. (이 앱은 자기 자신을 추적한다. 에이전트가 일지를 못
/// 쓰는 것이 기본값이면 그 전제가 반쪽이 된다.)
///
/// 바이너리를 못 찾으면 **아무 것도 안 넘긴다** — 없는 명령을 서버라고 넘기면
/// 어댑터가 매 세션마다 그것을 띄우려다 실패한다. 개발 중에는
/// `cargo build --bin oculpm-mcp` 전까지 그 상태다.
fn client_mcp_servers() -> Vec<McpServer> {
    let Some(binary) = crate::oculpm::mcp::register::resolve_binary_path() else {
        return Vec::new();
    };
    vec![McpServer::Stdio(McpServerStdio::new("oculpm", binary))]
}

/// 세션이 없으면 만든다 (있으면 그대로). 설정 항목도 함께 갈무리한다.
async fn ensure_session(
    app: &AppHandle,
    db: &Db,
    project_id: u32,
) -> Result<agent_client_protocol::schema::v1::SessionId, String> {
    let state = app.state::<AcpState>();
    // 세션 생성도 한 번에 하나만 — `acp_start` 와 `acp_prompt` 가 겹쳐 들어오면
    // 세션이 둘 만들어지고 하나는 에이전트 쪽에 남아 샌다.
    let _guard = state.session_lock.lock().await;
    if let Some(existing) = state.session(project_id) {
        return Ok(existing);
    }

    let connection = state
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;
    let cwd = project_root(db, project_id).await?;

    let created = connection
        .send_request(NewSessionRequest::new(cwd).mcp_servers(client_mcp_servers()))
        .block_task()
        .await
        .map_err(|e| format!("세션을 만들지 못했습니다: {e}"))?;

    state.set_session(
        project_id,
        created.session_id.clone(),
        acp::session::map_config_options(created.config_options.as_deref().unwrap_or_default()),
    );
    Ok(created.session_id)
}

/// 어댑터를 내린다. 떠 있지 않았으면 `false`.
#[tauri::command]
#[specta::specta]
pub fn acp_stop(app: AppHandle, project_id: u32) -> Result<bool, String> {
    Ok(acp::process::stop(&app, project_id))
}

/// 현재 떠 있는 어댑터 정보 (없으면 `None`).
#[tauri::command]
#[specta::specta]
pub fn acp_status(state: State<'_, AcpState>, project_id: u32) -> Result<Option<AcpAgentInfo>, String> {
    Ok(state.info(project_id))
}

/// 프롬프트를 보내고 턴이 끝날 때까지 이벤트를 `on_event` 로 흘린다.
///
/// `attachments` 는 함께 보낼 파일의 절대경로다. 내용을 우리가 읽어 넣지 않고
/// **링크(`ResourceLink`)만** 준다 — 에이전트가 자기 파일 도구로 필요한 만큼만
/// 읽는 편이 토큰 면에서 낫고, 큰 파일을 통째로 프롬프트에 밀어 넣는 사고도 막는다.
#[tauri::command]
#[specta::specta]
pub async fn acp_prompt(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    text: String,
    attachments: Vec<String>,
    images: Vec<AcpImage>,
    on_event: Channel<AcpEvent>,
) -> Result<String, String> {
    let connection = app
        .state::<AcpState>()
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;

    // 보통은 `acp_start` 가 이미 만들어 뒀다 — 여기 폴백이 남아 있는 건
    // 어댑터가 죽었다 살아난 뒤의 첫 프롬프트를 위해서다.
    let session = ensure_session(&app, &db, project_id).await?;

    // 알림 핸들러는 연결 생성 시점에 한 번 등록돼 있다 — 여기서는 "지금 누가
    // 듣는지"만 바꿔 끼운다.
    app.state::<AcpState>()
        .set_sink(project_id, session.0.to_string(), on_event.clone());

    let mut blocks = vec![ContentBlock::Text(TextContent::new(text))];

    // 이미지는 **내용을 실어 보낸다**(파일과 달리 링크로는 못 준다 — 클립보드
    // 이미지는 디스크에 존재하지도 않는다). 어댑터가 `promptCapabilities.image`
    // 를 광고하므로 base64 그대로 넘긴다.
    for image in &images {
        blocks.push(ContentBlock::Image(ImageContent::new(
            image.data_base64.clone(),
            image.mime_type.clone(),
        )));
    }
    if !attachments.is_empty() {
        // `@` 멘션은 상대경로로, 파일 대화상자는 절대경로로 온다 — 여기서 한
        // 모양으로 맞춘다. ACP 는 모든 경로가 절대여야 한다고 못 박는다.
        let root = project_root(&db, project_id).await?;
        for path in &attachments {
            let absolute = {
                let candidate = std::path::Path::new(path);
                if candidate.is_absolute() {
                    candidate.to_path_buf()
                } else {
                    root.join(candidate)
                }
            };
            let name = absolute
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            blocks.push(ContentBlock::ResourceLink(ResourceLink::new(
                name,
                format!("file://{}", absolute.display()),
            )));
        }
    }

    // 이번 턴의 **파일 변경 감사**를 요청한다 (어댑터 0.70.0).
    //
    // 이걸 실어야 어댑터가 턴 끝에 숨은 continuation 을 넣어 "이번 턴에 바꾼
    // 워크스페이스 파일을 전부 신고하라"를 시키고, 그 답이
    // `session_info_update` 로 돌아온다(`acp::session::file_change_report_of`).
    // 키는 정확히 `version`·`requestId` 둘뿐이어야 하고 requestId 는
    // `[A-Za-z0-9._:-]{1,128}` 이어야 한다 — 어댑터가 그렇게 검사한다(실측).
    // 세션 안에서 같은 requestId 를 두 번 쓰면 두 번째는 무시되므로 매 턴 새로 만든다.
    //
    // `/usage` 같은 내부 프롬프트에는 일부러 붙이지 않는다 — 파일을 바꿀 일이
    // 없는데 숨은 턴만 한 번 더 도는 비용이다.
    let request_id = uuid::Uuid::new_v4().to_string();
    let mut prompt_meta = serde_json::Map::new();
    prompt_meta.insert(
        "jetbrains".to_string(),
        serde_json::json!({
            "air": {
                "agentFileChangeReportRequest": { "version": 1, "requestId": request_id }
            }
        }),
    );

    let outcome = connection
        .send_request(PromptRequest::new(session.clone(), blocks).meta(prompt_meta))
        .block_task()
        .await;

    app.state::<AcpState>().clear_sink(project_id, &session.0);

    match outcome {
        Ok(response) => {
            let reason = acp::session::stop_reason_label(&response.stop_reason);
            let _ = on_event.send(AcpEvent::Done {
                stop_reason: reason.clone(),
            });
            Ok(reason)
        }
        Err(e) => {
            let message = e.to_string();
            let _ = on_event.send(AcpEvent::Failed {
                message: message.clone(),
            });
            Err(message)
        }
    }
}

/// 진행 중인 턴을 취소한다. 세션이 없으면 `false`.
///
/// 취소는 알림(fire-and-forget)이라 즉시 끊기지 않는다 — 에이전트가
/// `stopReason: cancelled` 로 턴을 닫아 주면 그때 `Done` 이 온다.
#[tauri::command]
#[specta::specta]
pub fn acp_cancel(app: AppHandle, project_id: u32) -> Result<bool, String> {
    let state = app.state::<AcpState>();
    let (Some(connection), Some(session)) = (state.connection(project_id), state.session(project_id))
    else {
        return Ok(false);
    };

    // 프로토콜 요구사항 — 취소한 클라이언트는 미결 권한 요청에 전부 취소로
    // 응답해야 한다. 순서가 중요하다: 먼저 풀어 줘야 에이전트가 취소를 처리할
    // 수 있는 상태가 된다.
    state.cancel_pending_permissions(project_id);

    connection
        .send_notification(CancelNotification::new(session))
        .map_err(|e| format!("취소를 보내지 못했습니다: {e}"))?;
    Ok(true)
}

/// 세션 설정을 바꾼다 (모델 · Effort · Fast mode · 권한 모드 · 서브에이전트 …).
///
/// 값 목록을 우리가 검증하지 않는 게 의도다 — 어댑터가 준 선택지를 그대로
/// 돌려보내므로, Claude Code 가 모델을 추가해도 우리 코드는 그대로다.
#[tauri::command]
#[specta::specta]
pub async fn acp_set_config_option(
    app: AppHandle,
    project_id: u32,
    config_id: String,
    value: String,
) -> Result<Vec<acp::session::AcpConfigOption>, String> {
    let state = app.state::<AcpState>();
    let (Some(connection), Some(session)) = (state.connection(project_id), state.session(project_id))
    else {
        return Err("에이전트가 실행 중이 아닙니다".to_string());
    };

    connection
        .send_request(SetSessionConfigOptionRequest::new(
            session,
            config_id.clone(),
            SessionConfigOptionValue::value_id(value.clone()),
        ))
        .block_task()
        .await
        .map_err(|e| format!("설정을 바꾸지 못했습니다: {e}"))?;

    let state = app.state::<AcpState>();
    state.patch_option(project_id, &config_id, &value);
    Ok(state.options(project_id))
}

/// 권한 카드의 선택을 전달한다. `option_id` 가 `None` 이면 거절(취소)로 닫는다.
#[tauri::command]
#[specta::specta]
pub fn acp_permission_respond(
    state: State<'_, AcpState>,
    request_id: String,
    option_id: Option<String>,
) -> Result<bool, String> {
    Ok(state.resolve_permission(&request_id, option_id.map(Into::into)))
}

/// 파일 선택 대화상자 (다중 선택, 프로젝트 루트에서 시작). 취소하면 빈 배열.
#[tauri::command]
#[specta::specta]
pub async fn acp_pick_files(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let root = project_root(&db, project_id).await?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<FilePath>>>();
    app.dialog()
        .file()
        .set_directory(root)
        .pick_files(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.await.map_err(|e| e.to_string())?;
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| match p {
            FilePath::Path(path) => Some(path.display().to_string()),
            _ => None,
        })
        .collect())
}

/// `@` 멘션 자동완성용 프로젝트 파일 목록.
///
/// 인덱스(DB)가 아니라 **디스크를 직접 걷는다** — 인덱싱 전이거나 방금 만든
/// 파일도 멘션할 수 있어야 하기 때문이다. `ignore` 크레이트라 .gitignore 를
/// 존중한다(node_modules/target 이 딸려오지 않는다).
#[tauri::command]
#[specta::specta]
pub async fn acp_list_files(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    limit: u32,
) -> Result<Vec<String>, String> {
    let root = project_root(&db, project_id).await?;
    let needle = query.to_lowercase();
    let cap = limit.clamp(1, 200) as usize;

    let matches = tauri::async_runtime::spawn_blocking(move || {
        let mut found: Vec<String> = Vec::new();
        for entry in ignore::WalkBuilder::new(&root).hidden(true).build().flatten() {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root) else {
                continue;
            };
            let rel = rel.display().to_string();
            if needle.is_empty() || rel.to_lowercase().contains(&needle) {
                found.push(rel);
                if found.len() >= cap {
                    break;
                }
            }
        }
        found
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(matches)
}

/// 대화를 비운다 — 새 세션을 만들고 기존 세션을 버린다.
///
/// ACP 에 "메시지 N 으로 되감기"는 없다(`session/fork` 는 되감을 지점을 받지
/// 않는다). 그래서 확장의 Rewind 대신 **새로 시작**만 제공한다.
#[tauri::command]
#[specta::specta]
pub async fn acp_new_session(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<AcpSession, String> {
    let state = app.state::<AcpState>();
    let agent = state
        .info(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;

    // 미결 승인 카드는 지금 세션에 매인 것이므로 먼저 닫는다.
    state.cancel_pending_permissions(project_id);
    state.clear_session(project_id);
    ensure_session(&app, &db, project_id).await?;

    Ok(session_snapshot(&app, project_id, agent))
}

/// 과거 대화 하나 (에이전트가 보관한다 — 우리가 저장하지 않는다).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AcpSessionSummary {
    pub id: String,
    pub title: Option<String>,
    /// ISO 8601 문자열 (어댑터가 주는 그대로 — 우리가 파싱해 다시 쓰지 않는다).
    pub updated_at: Option<String>,
}

/// 이 프로젝트의 과거 대화 목록.
///
/// **우리가 저장하지 않는다** — Claude Code 가 이미 자기 세션 스토어를 갖고
/// 있고, ACP `session/list` 가 그걸 그대로 열어 준다. 여기에 사본을 두면
/// 터미널에서 연 세션과 앱에서 연 세션이 갈라진다.
#[tauri::command]
#[specta::specta]
pub async fn acp_list_sessions(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<AcpSessionSummary>, String> {
    let connection = app
        .state::<AcpState>()
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;
    let cwd = project_root(&db, project_id).await?;

    let mut request = ListSessionsRequest::new();
    request.cwd = Some(cwd.clone());

    let response = connection
        .send_request(request)
        .block_task()
        .await
        .map_err(|e| format!("대화 목록을 불러오지 못했습니다: {e}"))?;

    // `cwd` 를 요청에 실었지만 **우리가 다시 거른다.** 필터는 어댑터의 선의에
    // 기대는 부분이고, 남의 프로젝트 대화가 목록에 섞이면 열어 보기 전까지
    // 알 수 없다. 경로 비교는 정규화 후 — 심볼릭 링크로 들어온 루트와
    // 어댑터가 돌려준 실경로가 다를 수 있다.
    let root = std::fs::canonicalize(&cwd).unwrap_or(cwd);
    // `/usage` 전용 대화는 우리가 판 것이지 사용자의 대화가 아니다 — 감춘다.
    //
    // id 로 거르는 것은 **이번 실행분**만 잡는다. 앱이 죽으면 그 대화는 디스크에
    // 남고 다음 실행에서는 우리가 그 id 를 모른다 — 그래서 제목으로도 한 번 더
    // 거른다. 첫 메시지가 `/usage` 인 대화는 우리가 판 것뿐이다(사용자가 치는
    // `/usage` 는 프롬프트로 나가지 않고 화면에서 위젯을 연다).
    let scratch = app.state::<AcpState>().scratch(project_id);
    Ok(response
        .sessions
        .into_iter()
        .filter(|info| scratch.as_ref() != Some(&info.session_id))
        .filter(|info| info.title.as_deref() != Some("/usage"))
        .filter(|info| {
            std::fs::canonicalize(&info.cwd)
                .unwrap_or_else(|_| info.cwd.clone())
                == root
        })
        .map(|info| AcpSessionSummary {
            id: info.session_id.0.to_string(),
            title: info.title,
            updated_at: info.updated_at,
        })
        .collect())
}

/// 보고 있는 대화를 바꾼다 — **어댑터에는 아무 것도 묻지 않는다.**
///
/// 화면이 이미 그 대화의 기록을 들고 있을 때 쓴다. `session/load` 로 갈아타면
/// 지난 대화를 통째로 되받는 비용이 들고, 더 나쁜 것은 그 대화에 **아직 흐르고
/// 있는 답변**의 자리를 잠깐 빼앗는다는 점이다(돌아왔더니 답이 멎어 있다).
///
/// 제목은 화면이 안다(탭·목록에서 왔다) — 여기서 다시 물어보지 않는다.
#[tauri::command]
#[specta::specta]
pub fn acp_select_session(
    app: AppHandle,
    project_id: u32,
    session_id: String,
    title: Option<String>,
) -> Result<AcpSession, String> {
    let state = app.state::<AcpState>();
    let agent = state
        .info(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;
    state.select_session(
        project_id,
        agent_client_protocol::schema::v1::SessionId::new(session_id),
        title,
    );
    Ok(session_snapshot(&app, project_id, agent))
}

/// 대화를 **영구 삭제**한다 (`session/delete`).
///
/// 프로토콜에 이름을 바꾸는 방법은 없다 — 목록의 제목은 에이전트가 붙인 것이고
/// 우리가 고칠 수 있는 자리가 아니다. 그래서 이름표는 앱이 따로 들고(프런트),
/// **지우기만** 어댑터에 맡긴다. 어댑터가 이 기능을 광고하지 않으면 오류로
/// 되돌아오므로 우리가 미리 막지 않는다.
///
/// 지금 열려 있는 대화를 지우는 것도 막지 않는다 — 지운 뒤 무엇을 열지는
/// 화면의 판단이다(새 대화가 자연스럽다).
#[tauri::command]
#[specta::specta]
pub async fn acp_delete_session(
    app: AppHandle,
    project_id: u32,
    session_id: String,
) -> Result<bool, String> {
    let connection = app
        .state::<AcpState>()
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;

    connection
        .send_request(DeleteSessionRequest::new(session_id))
        .block_task()
        .await
        .map_err(|e| format!("대화를 지우지 못했습니다: {e}"))?;
    Ok(true)
}

/// 과거 대화를 연다 — **지난 메시지까지 화면에 되살린다**.
///
/// `session/resume` 이 아니라 `session/load` 를 쓴다. 스펙이 둘을 명확히
/// 가른다: resume 은 "대화를 재생하지 **말아야** 한다", load 는 "전체 대화를
/// `session/update` 로 재생해야 한다". 처음에 resume 을 골라서 세션은 이어지는데
/// 화면은 빈 채로 남았다.
///
/// 재생분이 `on_event` 로 흐르도록 요청 **전에** 싱크를 꽂는다 — 알림 핸들러는
/// 싱크가 없으면 조용히 버리므로, 순서가 뒤집히면 지난 대화가 통째로 사라진다.
#[tauri::command]
#[specta::specta]
pub async fn acp_load_session(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    session_id: String,
    on_event: Channel<AcpEvent>,
) -> Result<AcpSession, String> {
    let state = app.state::<AcpState>();
    let agent = state
        .info(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;
    let connection = state
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;

    // 지금 세션에 매인 승인 카드는 무효가 된다.
    state.cancel_pending_permissions(project_id);
    let cwd = project_root(&db, project_id).await?;

    app.state::<AcpState>()
        .set_sink(project_id, session_id.clone(), on_event);

    let loaded = connection
        .send_request(LoadSessionRequest::new(session_id.clone(), cwd))
        .block_task()
        .await;

    let state = app.state::<AcpState>();
    state.clear_sink(project_id, &session_id);

    let loaded = loaded.map_err(|e| format!("대화를 열지 못했습니다: {e}"))?;
    state.set_session(
        project_id,
        session_id.into(),
        acp::session::map_config_options(loaded.config_options.as_deref().unwrap_or_default()),
    );
    Ok(session_snapshot(&app, project_id, agent))
}

/// 슬래시 커맨드 목록.
///
/// 별도 커맨드인 이유: 목록은 `session/new` **응답이 아니라** 그 직후의 알림으로
/// 온다. `acp_start` 가 돌려주는 스냅샷에는 아직 비어 있을 수 있으므로, 사용자가
/// `/` 를 칠 때 물어보는 편이 항상 최신이다.
#[tauri::command]
#[specta::specta]
pub fn acp_commands(
    state: State<'_, AcpState>,
    project_id: u32,
) -> Result<Vec<acp::session::AcpCommand>, String> {
    Ok(state.commands(project_id))
}

/// 마지막으로 본 사용량 (한도 포함). 아직 한 번도 못 봤으면 `None`. 읽기 전용.
#[tauri::command]
#[specta::specta]
pub fn acp_usage(
    state: State<'_, AcpState>,
    project_id: u32,
) -> Result<Option<acp::session::AcpUsage>, String> {
    Ok(state.usage(project_id))
}

/// `/usage` 로 한도를 **실제로 새로 읽는다**.
///
/// 이게 성립하는 근거는 실측이다(2026-08-15): `/usage` 는 CLI 가 로컬에서
/// 답하는 커맨드라 `inputTokens = outputTokens = 0` 이다. 즉 토큰을 쓰지 않고,
/// `usage_update` 의 `_meta` 가 한 종류씩 흘려 주는 것과 달리 세션·주간·Fable
/// 을 **한 번에** 준다. 그래서 새로고침 버튼이 진짜 새로고침일 수 있다.
///
/// 사용자가 시작한 턴이 아니라 답을 프런트 채널로 받을 수 없으므로, 상태에
/// 갈무리 버퍼를 켜 두고 답변 텍스트를 모아 파싱한다.
#[tauri::command]
#[specta::specta]
pub async fn acp_refresh_usage(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Option<acp::session::AcpUsage>, String> {
    let connection = app
        .state::<AcpState>()
        .connection(project_id)
        .ok_or_else(|| "에이전트가 실행 중이 아닙니다".to_string())?;
    // **전용 대화 하나에서 묻는다.**
    //
    // `/usage` 는 결국 프롬프트라, 보고 있는 대화에 보내면 그 대화의 기록에
    // "/usage" 가 남는다. 아직 한 마디도 안 한 대화였다면 그것이 **제목**까지
    // 되어 목록 맨 위에 "/usage" 라는 대화가 생겼다.
    //
    // 그래서 물어볼 대화를 따로 둔다. 물어볼 때마다 파고 지우는 것도 해 봤는데
    // 지우기와 어댑터의 전사 기록이 경합해 가끔 살아남았다 — 어댑터가 사는 동안
    // **하나만** 두고 목록에서 감추는 편이 확실하다(`acp_list_sessions` 가 뺀다).
    let state = app.state::<AcpState>();
    let scratch = match state.scratch(project_id) {
        Some(existing) => existing,
        None => {
            let cwd = project_root(&db, project_id).await?;
            // MCP 서버는 안 물린다 — 이 대화는 `/usage` 한 줄을 묻고 마는
            // 일회용이다. 서버를 띄우면 그만큼 느려지고, 쓸 일도 없다.
            let created = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await
                .map_err(|e| format!("사용량을 불러오지 못했습니다: {e}"))?
                .session_id;
            state.set_scratch(project_id, created.clone());
            created
        }
    };

    state.start_capture(scratch.0.to_string());
    let outcome = connection
        .send_request(PromptRequest::new(
            scratch,
            vec![ContentBlock::Text(TextContent::new("/usage".to_string()))],
        ))
        .block_task()
        .await;

    let state = app.state::<AcpState>();
    let report = state.take_capture().unwrap_or_default();
    outcome.map_err(|e| format!("사용량을 불러오지 못했습니다: {e}"))?;

    state.replace_limits(
        project_id,
        acp::session::parse_usage_report(&report),
        acp::session::parse_usage_detail(&report),
    );
    Ok(state.usage(project_id))
}

/// 현재 세션 설정 (에이전트 쪽 변경까지 반영된 값). 읽기 전용·값싸다.
///
/// 별도 커맨드인 이유: 모델을 바꾸면 어댑터가 권한 모드를 조용히 내릴 수 있고,
/// 그 사실은 우리가 보낸 요청의 **응답이 아니라 알림**으로 온다. UI 가 주기적
/// 으로 되읽어야 "Auto 라 적혀 있는데 실은 Manual" 을 피할 수 있다.
#[tauri::command]
#[specta::specta]
pub fn acp_options(
    state: State<'_, AcpState>,
    project_id: u32,
) -> Result<Vec<acp::session::AcpConfigOption>, String> {
    Ok(state.options(project_id))
}

/// 현재 세션 제목. 상단바가 따라가려고 짧은 주기로 읽는다 (로컬 조회).
#[tauri::command]
#[specta::specta]
pub fn acp_session_title(
    state: State<'_, AcpState>,
    project_id: u32,
) -> Result<Option<String>, String> {
    Ok(state.title(project_id))
}

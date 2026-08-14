//! PR-ACP1 — ACP 어댑터 커맨드 (docs/acp-panel/00-master-plan.md §5).
//!
//! 설정 → 통합 탭의 "에이전트 런타임" 블록과 에이전트 화면이 부른다. 로직은
//! `crate::acp` 소유 — 여기는 경로 해석(app_data / 프로젝트 루트)과 에러 문자열
//! 변환만 한다 (commands 는 얇게, CLAUDE.md 규약).

use std::path::PathBuf;

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, ListSessionsRequest, NewSessionRequest, PromptRequest,
    LoadSessionRequest, ResourceLink, SessionConfigOptionValue, SetSessionConfigOptionRequest,
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

/// 실행 중인 에이전트의 전체 상태 — 상대편 정보 + 세션 설정 항목.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AcpSession {
    pub agent: AcpAgentInfo,
    /// 현재 대화 세션 id — 목록에서 어느 것이 열려 있는지 표시하는 데 쓴다.
    pub session_id: Option<String>,
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
    let diagnostics = acp::diagnose(&dir).await;
    if !diagnostics.node_ok {
        return Err(format!(
            "Node.js {}+ 가 필요합니다 (현재: {})",
            diagnostics.node_min_major,
            diagnostics.node_version.as_deref().unwrap_or("없음")
        ));
    }
    if !diagnostics.adapter_ok {
        return Err("ACP 어댑터가 설치되지 않았습니다 — 설정에서 설치하세요".to_string());
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
        session_id: state.session(project_id).map(|s| s.0.to_string()),
        options: state.options(project_id),
    }
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
        .send_request(NewSessionRequest::new(cwd))
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
    app.state::<AcpState>().set_sink(project_id, on_event.clone());

    let mut blocks = vec![ContentBlock::Text(TextContent::new(text))];
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

    let outcome = connection
        .send_request(PromptRequest::new(session, blocks))
        .block_task()
        .await;

    app.state::<AcpState>().clear_sink(project_id);

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
    Ok(response
        .sessions
        .into_iter()
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

    app.state::<AcpState>().set_sink(project_id, on_event);

    let loaded = connection
        .send_request(LoadSessionRequest::new(session_id.clone(), cwd))
        .block_task()
        .await;

    let state = app.state::<AcpState>();
    state.clear_sink(project_id);

    let loaded = loaded.map_err(|e| format!("대화를 열지 못했습니다: {e}"))?;
    state.set_session(
        project_id,
        session_id.into(),
        acp::session::map_config_options(loaded.config_options.as_deref().unwrap_or_default()),
    );
    Ok(session_snapshot(&app, project_id, agent))
}

//! 코드 화면 ↔ 디버그 어댑터 창구 (docs/dap/00-master-plan.md).
//!
//! `commands/lsp.rs` 와 같은 태도로 얇게 유지한다 — 프로세스 수명·프레이밍·
//! 상태 기계는 `crate::dap` 이 하고, 여기서는 프로젝트 루트 해석과 배선만.
//!
//! 다만 LSP 와 결정적으로 다른 것이 하나 있다: **디버거는 상태가 있다.** 멈춰
//! 있지 않으면 스택도 변수도 물을 수 없으므로, 그 사실을 오류가 아니라 빈
//! 결과로 답한다 — 조작 중에 상태가 바뀌는 것은 정상이고, 그때마다 빨간
//! 토스트가 뜨면 디버깅을 할 수 없다.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::dap::registry::{adapter_by_id, resolve_adapter, ADAPTERS};
use crate::dap::session::{DapSession, LaunchConfig, SessionSignal};
use crate::dap::spec::{
    wire_id, DapBreakpoint, DapFrame, DapOutput, DapScope, DapSessionInfo, DapState, DapVariable,
};
use crate::dap::state::DapState as DapStateStore;
use crate::db::Db;

/// 세션 상태가 바뀌었다. 디버그 패널의 버튼 활성화가 전부 이걸로 파생된다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct DapSessionChanged {
    pub project_id: u32,
    pub session: DapSessionInfo,
}

/// 디버기의 표준 출력·오류 한 줄.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct DapOutputEmitted {
    pub project_id: u32,
    pub output: DapOutput,
}

/// 어댑터가 확정한 중단점 상태 (옮겨졌거나 못 걸었거나).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct DapBreakpointsChanged {
    pub project_id: u32,
    pub breakpoints: Vec<DapBreakpoint>,
}

/// 이 기계에서 쓸 수 있는 디버그 어댑터 한 줄 (안내용).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DapAdapterInfo {
    pub language_id: String,
    /// 찾았다면 그 절대경로. 못 찾았으면 `None`.
    pub resolved: Option<String>,
    /// 미설치일 때 그대로 보여 줄 설치 방법 (자동 설치는 하지 않는다).
    pub install_hint: String,
}

/// 한 파일의 중단점 줄들 (1-based).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DapFileBreakpoints {
    pub path: String,
    pub lines: Vec<u32>,
}

/// 실행 구성 — 프런트가 그대로 채워 보낸다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DapLaunchRequest {
    pub language_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub stop_on_entry: bool,
    pub cwd: Option<String>,
}

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// 어댑터 일람 — 어느 언어를 디버그할 수 있는지, 없으면 어떻게 까는지.
#[tauri::command]
#[specta::specta]
pub async fn dap_adapters() -> Result<Vec<DapAdapterInfo>, String> {
    let mut out = Vec::with_capacity(ADAPTERS.len());
    for spec in ADAPTERS {
        out.push(DapAdapterInfo {
            language_id: spec.language_id.to_string(),
            resolved: resolve_adapter(spec)
                .await
                .map(|c| c.program.to_string_lossy().to_string()),
            install_hint: spec.install_hint.to_string(),
        });
    }
    Ok(out)
}

/// 지금 세션 (없으면 `None`).
#[tauri::command]
#[specta::specta]
pub async fn dap_session(
    dap: State<'_, DapStateStore>,
    project_id: u32,
) -> Result<Option<DapSessionInfo>, String> {
    match dap.session(project_id).await {
        Some(s) => Ok(Some(s.info().await)),
        None => Ok(None),
    }
}

/// 중단점 토글. 세션이 살아 있으면 어댑터에도 바로 밀어 넣는다 — 멈춰 있는
/// 동안 찍은 중단점이 다음 실행에야 걸리면 쓸모가 없다.
#[tauri::command]
#[specta::specta]
pub async fn dap_toggle_breakpoint(
    dap: State<'_, DapStateStore>,
    project_id: u32,
    rel_path: String,
    line: u32,
) -> Result<Vec<u32>, String> {
    let lines = dap.toggle_breakpoint(project_id, &rel_path, line).await;
    if let Some(session) = dap.session(project_id).await {
        if session.state().await != DapState::Ended {
            // 실패해도 저장소의 진실은 이미 바뀌었다 — 목록은 돌려주고 경고만.
            if let Err(e) = session.push_breakpoints(&rel_path, &lines).await {
                tracing::warn!(target: "dap", error = %e, "중단점을 어댑터에 밀어넣지 못했다");
            }
        }
    }
    Ok(lines)
}

/// 한 파일의 중단점 (거터가 그린다).
#[tauri::command]
#[specta::specta]
pub async fn dap_breakpoints(
    dap: State<'_, DapStateStore>,
    project_id: u32,
    rel_path: String,
) -> Result<Vec<u32>, String> {
    Ok(dap.breakpoint_lines(project_id, &rel_path).await)
}

/// 프로젝트 전체 중단점 (디버그 패널의 목록).
#[tauri::command]
#[specta::specta]
pub async fn dap_all_breakpoints(
    dap: State<'_, DapStateStore>,
    project_id: u32,
) -> Result<Vec<DapFileBreakpoints>, String> {
    Ok(dap
        .all_breakpoints(project_id)
        .await
        .into_iter()
        .map(|(path, lines)| DapFileBreakpoints { path, lines })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn dap_clear_breakpoints(
    dap: State<'_, DapStateStore>,
    project_id: u32,
) -> Result<(), String> {
    dap.clear_breakpoints(project_id).await;
    Ok(())
}

/// 디버그 시작. 어댑터를 띄우고 `initialize` → `launch` → 중단점 →
/// `configurationDone` 까지 간다 (순서는 상태 기계가 맡는다 — #no-order).
#[tauri::command]
#[specta::specta]
pub async fn dap_start(
    app: AppHandle,
    db: State<'_, Db>,
    dap: State<'_, DapStateStore>,
    project_id: u32,
    request: DapLaunchRequest,
) -> Result<DapSessionInfo, String> {
    let root = project_root(&db, project_id).await?;
    let spec = adapter_by_id(&request.language_id)
        .ok_or_else(|| format!("{} 는 디버그를 지원하지 않습니다", request.language_id))?;
    let adapter = resolve_adapter(spec).await.ok_or_else(|| {
        format!(
            "디버그 어댑터를 찾지 못했습니다. 설치: {}",
            spec.install_hint
        )
    })?;

    let config = LaunchConfig {
        language_id: request.language_id.clone(),
        program: request.program.clone(),
        args: request.args.clone(),
        stop_on_entry: request.stop_on_entry,
        cwd: request.cwd.clone(),
    };

    let sink = {
        let app = app.clone();
        std::sync::Arc::new(move |signal: SessionSignal| {
            let _ = match signal {
                SessionSignal::State(session) => DapSessionChanged {
                    project_id,
                    session,
                }
                .emit(&app),
                SessionSignal::Output(output) => DapOutputEmitted { project_id, output }.emit(&app),
                SessionSignal::Breakpoints(breakpoints) => DapBreakpointsChanged {
                    project_id,
                    breakpoints,
                }
                .emit(&app),
            };
        })
    };

    let path_env = crate::acp::env::effective_path().await;
    let session = DapSession::start(spec, &adapter, root, &config, path_env, sink).await?;
    dap.put(project_id, session.clone()).await;

    let breakpoints = dap.all_breakpoints(project_id).await;
    // 실패해도 세션은 남겨 둔다 — 상태가 Ended 로 가 있어 UI 가 이유를 보여 준다.
    session.launch(&config, breakpoints).await?;
    Ok(session.info().await)
}

/// 디버그 종료 (사용자가 멈춤 버튼).
#[tauri::command]
#[specta::specta]
pub async fn dap_stop(dap: State<'_, DapStateStore>, project_id: u32) -> Result<(), String> {
    dap.stop_project(project_id).await;
    Ok(())
}

/// 실행 제어. 다섯 동작을 하나로 받는다 — 전부 "스레드 하나에 명령을 보낸다"
/// 는 같은 모양이라, 커맨드를 다섯 개로 늘리면 배선만 늘고 읽기는 나빠진다.
#[tauri::command]
#[specta::specta]
pub async fn dap_control(
    dap: State<'_, DapStateStore>,
    project_id: u32,
    action: String,
) -> Result<(), String> {
    let command = match action.as_str() {
        "continue" => "continue",
        "next" => "next",
        "step_in" => "stepIn",
        "step_out" => "stepOut",
        "pause" => "pause",
        other => return Err(format!("알 수 없는 실행 제어: {other}")),
    };
    let session = dap
        .session(project_id)
        .await
        .ok_or("디버그 세션이 없습니다")?;
    let thread_id = session.thread_id().await.ok_or("멈춘 스레드가 없습니다")?;
    session
        .request(command, Some(serde_json::json!({ "threadId": thread_id })))
        .await?;
    Ok(())
}

/// 호출 스택. **멈춰 있을 때만** 의미가 있다 — 아니면 빈 목록이다(오류가 아니라).
#[tauri::command]
#[specta::specta]
pub async fn dap_stack(
    db: State<'_, Db>,
    dap: State<'_, DapStateStore>,
    project_id: u32,
) -> Result<Vec<DapFrame>, String> {
    let Some(session) = dap.session(project_id).await else {
        return Ok(Vec::new());
    };
    if session.state().await != DapState::Stopped {
        return Ok(Vec::new());
    }
    let Some(thread_id) = session.thread_id().await else {
        return Ok(Vec::new());
    };
    let root = project_root(&db, project_id).await?;
    // 정의로 이동과 같은 이유로 canonical 루트와 비교한다 — 저장소가 심링크
    // 아래에 있으면 접두사가 안 맞아 프로젝트 안의 프레임까지 "밖" 으로 읽힌다.
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root);
    let body = session
        .request(
            "stackTrace",
            Some(serde_json::json!({ "threadId": thread_id, "startFrame": 0, "levels": 64 })),
        )
        .await?;
    Ok(crate::dap::spec::frames_from_json(&body, &canon_root))
}

#[tauri::command]
#[specta::specta]
pub async fn dap_scopes(
    dap: State<'_, DapStateStore>,
    project_id: u32,
    frame_id: f64,
) -> Result<Vec<DapScope>, String> {
    let Some(session) = dap.session(project_id).await else {
        return Ok(Vec::new());
    };
    let body = session
        .request(
            "scopes",
            Some(serde_json::json!({ "frameId": wire_id(frame_id) })),
        )
        .await?;
    Ok(crate::dap::spec::scopes_from_json(&body))
}

/// 변수 한 겹. 트리는 **펼칠 때** 읽는다 — 큰 구조체를 한 번에 다 읽으면
/// 멈춘 순간 앱이 굳는다 (코드 트리의 지연 로딩과 같은 원칙).
#[tauri::command]
#[specta::specta]
pub async fn dap_variables(
    dap: State<'_, DapStateStore>,
    project_id: u32,
    variables_reference: f64,
) -> Result<Vec<DapVariable>, String> {
    let Some(session) = dap.session(project_id).await else {
        return Ok(Vec::new());
    };
    let body = session
        .request(
            "variables",
            Some(serde_json::json!({ "variablesReference": wire_id(variables_reference) })),
        )
        .await?;
    Ok(crate::dap::spec::variables_from_json(&body))
}

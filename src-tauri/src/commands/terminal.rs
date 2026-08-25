//! 터미널 커맨드 — PTY 호스트의 얇은 클라이언트 (#pty-host, 2026-08-25).
//!
//! PTY 세션은 이제 이 프로세스가 아니라 **분리된 호스트 프로세스**
//! (`ptyhost/`)가 소유한다 — 앱이 업데이트로 재시작해도 셸이 죽지 않게.
//! 여기 커맨드들은 소켓 너머로 요청을 전달하고, 호스트의 출력 이벤트를
//! tauri 이벤트(`pty-data-{sid}` / `pty-exit-{sid}`)로 재방출할 뿐이다.
//! 프런트엔드 계약(idempotent start · attach 스냅샷 · seq 중복 제거 ·
//! unknown sid 의 write 오류)은 전부 호스트가 그대로 지킨다.
//!
//! 셸·환경·nonce 계산은 여전히 **앱이** 한다 — 통합 스크립트 실체화가 앱
//! 데이터 경로(tauri 핸들)를 필요로 하기 때문이고, 호스트는 받은 대로 띄운다.

use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::oculpm::shell_integration;
use crate::ptyhost::client::{connect_or_spawn, socket_path, PtyHostClient};
use crate::ptyhost::protocol::{Event, Request, Response};

/// `start_pty_session` 반환값 — 프런트가 OSC 신호를 검증하는 데 필요한 정보.
#[derive(Clone, Serialize, specta::Type)]
pub struct PtySessionInfo {
    /// 이 값이 실려 있지 않은 OSC 133 페이로드는 신뢰하지 않는다.
    pub nonce: String,
    pub shell_integration: bool,
}

#[derive(Clone, Serialize, specta::Type)]
pub struct PtyAttach {
    /// 지금까지의 스크롤백 (상한 내). xterm 에 그대로 write 해 리플레이한다.
    pub text: String,
    /// 스냅샷에 포함된 마지막 청크의 seq — 이 값 이하의 라이브 이벤트는 중복.
    pub seq: u32,
    /// 살아있는 세션의 nonce. 재마운트한 화면도 OSC 를 검증할 수 있어야 하므로
    /// start 경로와 동일한 값을 여기서도 돌려준다.
    pub nonce: String,
    pub shell_integration: bool,
}

/// `pty-data-{id}` 이벤트 페이로드. `seq` 는 attach 스냅샷과의 중복 제거용.
#[derive(Clone, Serialize)]
pub struct PtyChunk {
    pub seq: u32,
    pub text: String,
}

/// 호스트 클라이언트 핸들. 세션 자체는 호스트에 있고, 여기는 접속만 쥔다.
#[derive(Default)]
pub struct PtyState {
    client: tokio::sync::Mutex<Option<Arc<PtyHostClient>>>,
}

impl PtyState {
    /// 살아있는 클라이언트를 얻는다 — 없으면 접속하고, `spawn` 이면 호스트를
    /// 띄운다. `Ok(None)` = 호스트가 없다 (= 세션도 없다).
    async fn client(
        &self,
        app: &tauri::AppHandle,
        spawn: bool,
    ) -> Result<Option<Arc<PtyHostClient>>, String> {
        let mut slot = self.client.lock().await;
        if let Some(c) = slot.as_ref() {
            if c.is_alive() {
                return Ok(Some(c.clone()));
            }
            *slot = None;
        }
        let socket = socket_path_for(app)?;
        let emitter = app.clone();
        // 호스트 이벤트 → tauri 이벤트 재방출. app.emit 은 전역 브로드캐스트라
        // 예전 in-process 경로와 프런트가 보는 모양이 완전히 같다.
        let on_event = move |ev: Event| match ev {
            Event::Data { sid, seq, text } => {
                let _ = emitter.emit(&format!("pty-data-{sid}"), PtyChunk { seq, text });
            }
            Event::Exit { sid } => {
                let _ = emitter.emit(&format!("pty-exit-{sid}"), ());
            }
        };
        match connect_or_spawn(&socket, spawn, on_event).await? {
            Some(c) => {
                let c = Arc::new(c);
                *slot = Some(c.clone());
                Ok(Some(c))
            }
            None => Ok(None),
        }
    }

    /// 창 하나가 소유한 세션 전량 종료 (멀티 창 T4).
    pub fn kill_with_prefix(&self, app: &tauri::AppHandle, prefix: &str) {
        blocking_kill(app, Request::KillPrefix { prefix: prefix.to_string() });
    }

    /// 지정한 접두사들**만 남기고** 전량 종료 (마지막 앱 창 닫힘의 총정리).
    pub fn kill_except(&self, app: &tauri::AppHandle, keep: &[String]) {
        blocking_kill(app, Request::KillExcept { keep: keep.to_vec() });
    }
}

/// kill 계열의 공통 배관 — 호스트가 없으면 (= 세션이 없으면) 조용히 끝.
///
/// 창 이벤트 훅(메인 스레드, 동기)에서 불리는데, **마지막 창 닫힘 경로는 이
/// 직후 앱이 종료될 수 있다** — spawn 으로 띄우면 종료와 경주해 kill 이
/// 유실되고 셸이 산다. 그래서 짧은 상한을 걸고 완료를 기다린다. 정상 왕복은
/// 밀리초 단위고, 호스트가 이상하면 상한이 UI 를 지킨다.
fn blocking_kill(app: &tauri::AppHandle, req: Request) {
    let app = app.clone();
    tauri::async_runtime::block_on(async move {
        let work = async {
            let state = app.state::<PtyState>();
            if let Ok(Some(client)) = state.client(&app, false).await {
                if let Ok(Response::Count { n }) = client.request(req).await {
                    if n > 0 {
                        tracing::info!(target: "terminal", killed = n, "PTY sessions killed");
                    }
                }
            }
        };
        let _ = tokio::time::timeout(std::time::Duration::from_millis(800), work).await;
    });
}

fn socket_path_for(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve the app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create the app data dir: {e}"))?;
    Ok(socket_path(&dir))
}

#[tauri::command]
#[specta::specta]
pub async fn start_pty_session(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<PtySessionInfo, String> {
    let shell = shell_integration::current_shell();

    let mut env: Vec<(String, String)> = vec![
        ("TERM".into(), "xterm-256color".into()),
        // xterm.js 5.x 는 트루컬러를 지원한다 — CLI 들이 24bit 팔레트를 쓰도록.
        ("COLORTERM".into(), "truecolor".into()),
    ];
    // 한국어 입력 fix (2026-07-16): Finder 로 실행된 .app 은 LANG 이 비어 셸이
    // C 로케일로 뜬다 — 기존 값은 존중하고 없을 때만 UTF-8 보장. (호스트는 이
    // 앱이 띄우므로 같은 env 를 물려받지만, 판정은 계약대로 앱 쪽에서 한다.)
    if std::env::var("LANG").map(|v| v.trim().is_empty()).unwrap_or(true) {
        env.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    if std::env::var("LC_ALL").is_err() && std::env::var("LC_CTYPE").is_err() {
        env.push(("LC_CTYPE".into(), "UTF-8".into()));
    }

    // 셸 통합 (OSC 133/7). 사용자 rc 에 심긴 **비활성 한 줄**이 아래 변수를
    // 보고서야 스크립트를 source 한다. 실패는 전부 삼킨다: 통합이 안 켜지는
    // 것보다 터미널이 안 뜨는 쪽이 훨씬 나쁘다.
    let nonce = Uuid::new_v4().simple().to_string();
    let script = materialize_integration_script(&app, &shell);
    env.push(("OCULPM_TERM".into(), "1".into()));
    env.push(("OCULPM_NONCE".into(), nonce.clone()));
    if let Some(path) = script.as_deref() {
        env.push(("OCULPM_SHELL_INTEGRATION".into(), path.to_string()));
    }

    let client = state
        .client(&app, true)
        .await?
        .ok_or_else(|| "pty-host unavailable".to_string())?;
    match client
        .request(Request::Start {
            sid: session_id,
            cwd,
            rows,
            cols,
            shell,
            env,
            nonce,
            shell_integration: script.is_some(),
        })
        .await?
    {
        Response::Session { nonce, shell_integration } => {
            Ok(PtySessionInfo { nonce, shell_integration })
        }
        Response::Error { message } => Err(message),
        other => Err(format!("unexpected pty-host response: {other:?}")),
    }
}

/// 이 셸용 통합 스크립트를 앱 데이터에 실체화하고 절대경로를 돌려준다.
///
/// 지원하지 않는 셸(fish·nu·pwsh)·앱 데이터 접근 실패·쓰기 실패는 전부 `None`
/// 으로 삼킨다. 셸 통합은 부가 기능이고, 여기서 에러를 올리면 터미널 자체가
/// 안 뜬다.
fn materialize_integration_script(app: &tauri::AppHandle, shell: &str) -> Option<String> {
    let kind = shell_integration::detect_shell_kind(shell);
    let dir = app
        .path()
        .app_data_dir()
        .inspect_err(|e| tracing::warn!("셸 통합: 앱 데이터 경로 조회 실패 — {e}"))
        .ok()?;
    match shell_integration::materialize_script(&dir, kind) {
        Ok(path) => path.map(|p| p.display().to_string()),
        Err(e) => {
            tracing::warn!("셸 통합: 스크립트 생성 실패 — {e}");
            None
        }
    }
}

/// 살아있는 세션의 스크롤백 스냅샷을 반환한다 (없으면 None). 화면 재마운트가
/// `start` 대신 이걸 먼저 불러 세션을 이어받는다 — **앱 재시작 후에도** 호스트가
/// 살아 있으면 여기서 세션이 되살아난다.
#[tauri::command]
#[specta::specta]
pub async fn attach_pty_session(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<Option<PtyAttach>, String> {
    let Some(client) = state.client(&app, false).await? else {
        return Ok(None);
    };
    match client.request(Request::Attach { sid: session_id }).await {
        Ok(Response::Attach { attach }) => Ok(attach.map(|a| PtyAttach {
            text: a.text,
            seq: a.seq,
            nonce: a.nonce,
            shell_integration: a.shell_integration,
        })),
        // 접속이 그 사이 죽었다 — "세션 없음" 과 같은 답이 맞다 (start 로 진행).
        Err(_) => Ok(None),
        Ok(other) => Err(format!("unexpected pty-host response: {other:?}")),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn write_to_pty(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let Some(client) = state.client(&app, false).await? else {
        // 종전과 같은 계약 — 미지의 세션에 "조용한 성공" 을 주지 않는다 (A0d).
        return Err(format!("unknown pty session: {session_id}"));
    };
    match client.request(Request::Write { sid: session_id, data }).await? {
        Response::Ok => Ok(()),
        Response::Error { message } => Err(message),
        other => Err(format!("unexpected pty-host response: {other:?}")),
    }
}

/// 이 PTY 에서 **지금 화면을 잡고 있는 프로그램**의 명령줄 — 디스패치
/// 프리필(IN2)의 근거. 판정(어떤 에이전트인가)은 프런트 `agentDetect.ts` 가
/// 한다. tcgetpgrp + `ps` 는 호스트가 수행한다 (PTY 가 거기 있으므로).
#[tauri::command]
#[specta::specta]
pub async fn pty_foreground_command(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<Option<String>, String> {
    let Some(client) = state.client(&app, false).await? else {
        return Err(format!("unknown pty session: {session_id}"));
    };
    match client.request(Request::Foreground { sid: session_id }).await? {
        Response::Foreground { command } => Ok(command),
        Response::Error { message } => Err(message),
        other => Err(format!("unexpected pty-host response: {other:?}")),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn resize_pty(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let Some(client) = state.client(&app, false).await? else {
        // 미지의 세션 resize 는 종전에도 조용한 no-op 였다.
        return Ok(());
    };
    match client.request(Request::Resize { sid: session_id, rows, cols }).await {
        Ok(Response::Error { message }) => Err(message),
        _ => Ok(()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn kill_pty_session(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let Some(client) = state.client(&app, false).await? else {
        return Ok(());
    };
    let _ = client.request(Request::Kill { sid: session_id }).await;
    Ok(())
}

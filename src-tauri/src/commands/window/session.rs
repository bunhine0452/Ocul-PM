//! 세션 복원 — 업데이트 재시작을 건너 창·탭 구성을 되살린다.
//!
//! 스냅숏(`Session`)은 탭 id 를 싣지 않고, 복원은 저장된 라벨을 그대로 써서
//! `tauri-plugin-window-state` 가 기억한 자리를 따라오게 한다.

use super::*;

/// 창·탭 스냅숏이 사는 설정 키.
///
/// **키가 있다는 것 자체가 "다음 실행에서 복원하라" 는 표시**다. 그래서 평소엔
/// 없고, 업데이트 재시작 직전에만 쓰이며, 복원은 읽는 즉시 지운다.
pub const SESSION_KEY: &str = "window_session";

/// 창 하나 — 탭 순서와 활성 탭.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionWindow {
    /// 저장 당시의 창 라벨. 그대로 되살려야 위치·크기가 따라온다.
    pub label: String,
    /// 탭 순서 — `None` 은 시작 탭.
    pub tabs: Vec<Option<u32>>,
    /// 활성 탭의 **인덱스**. 탭 id 는 다음 실행에서 새로 발급되므로 못 쓴다.
    pub active: usize,
}

/// 재시작을 건너 옮겨지는 창 구성 전체.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub windows: Vec<SessionWindow>,
    /// 떼어낸 터미널 창의 프로젝트 (`terminal_windows`).
    pub terminals: Vec<u32>,
    /// 마지막으로 포커스됐던 창 — 복원을 마치고 이 창을 앞으로 가져온다.
    pub focused: Option<String>,
}

/// 스냅숏을 **지금 열 수 있는 것만** 남기고 다듬는다.
///
/// 거르는 것은 둘이다: ① 그 사이 지워진 프로젝트(탭만 되살리면 `#12` 짜리
/// 유령 탭이 뜬다), ② 중복 — I1(프로젝트당 탭 하나, 전역 유일)은 복원에도
/// 그대로 걸린다. 탭이 하나도 안 남은 창은 통째로 버린다 (빈 창은 레지스트리가
/// 표현하지 못한다).
///
/// 순수 함수라 Tauri 런타임 없이 단위 테스트한다.
pub fn sanitize_session(session: &Session, known: &HashSet<u32>) -> Session {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut windows: Vec<SessionWindow> = Vec::with_capacity(session.windows.len());
    for w in &session.windows {
        let mut tabs: Vec<Option<u32>> = Vec::with_capacity(w.tabs.len());
        let mut active: Option<usize> = None;
        for (i, project) in w.tabs.iter().enumerate() {
            if let Some(pid) = project {
                if !known.contains(pid) || !seen.insert(*pid) {
                    continue;
                }
            }
            if i == w.active {
                active = Some(tabs.len());
            }
            tabs.push(*project);
        }
        if tabs.is_empty() {
            continue;
        }
        windows.push(SessionWindow {
            label: w.label.clone(),
            tabs,
            // 활성 탭 자체가 걸러졌으면 첫 탭으로 — 창이 빈 화면으로 뜨지 않게.
            active: active.unwrap_or(0),
        });
    }
    let terminals = session
        .terminals
        .iter()
        .copied()
        .filter(|pid| known.contains(pid))
        .collect();
    let focused = session
        .focused
        .clone()
        .filter(|f| windows.iter().any(|w| &w.label == f));
    Session {
        windows,
        terminals,
        focused,
    }
}

/// 지금 창·탭을 저장한다 — **우리가 일으킨 재시작** 직전에만 부른다.
///
/// 사용자가 직접 끈 앱이 다음에 시작 탭으로 열리는 것은 예측 가능한 동작이라
/// 그대로 둔다. 업데이트는 사용자가 고른 중단이 아니라 우리가 끼워 넣은
/// 중단이므로, 하던 자리로 돌려놓는 책임도 우리에게 있다.
#[tauri::command]
#[specta::specta]
pub async fn save_window_session(app: AppHandle) -> Result<(), String> {
    let session = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.session()
    };
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    let db = app.state::<crate::db::Db>();
    db.settings_set(SESSION_KEY.to_string(), json)
        .await
        .map_err(|e| e.to_string())
}

/// 저장된 창·탭을 되살린다 — 업데이트 재시작 직후 **한 번**.
///
/// setup 은 동기 구간이라 DB 를 기다릴 수 없어 백그라운드로 넘긴다. 그동안
/// `main` 은 시작 탭 하나를 문 평범한 창으로 이미 떠 있고, 스냅숏이 도착하면
/// 그 창이 저장된 탭 집합을 이어받는다 (프런트는 `WindowTabsChanged` 로 따라
/// 그린다 — 첫 조회를 놓치지 않도록 리스너를 단 뒤 한 번 더 읽는다).
pub fn restore_session(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = restore_session_inner(&app).await {
            tracing::warn!(target: "window", error = %e, "창 세션 복원 실패");
        }
    });
}

async fn restore_session_inner(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let Some(raw) = db
        .settings_get(SESSION_KEY.to_string())
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    // **먼저 지운다.** 뒤에서 무엇이 실패하든 낡은 구성이 매 실행마다 다시
    // 펼쳐지는 것보다, 한 번 놓치는 편이 낫다.
    db.settings_delete(SESSION_KEY.to_string())
        .await
        .map_err(|e| e.to_string())?;

    let stored: Session = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let known: HashSet<u32> = db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let Session {
        mut windows,
        terminals,
        focused,
    } = sanitize_session(&stored, &known);
    if windows.is_empty() {
        return Ok(());
    }

    // 첫 창은 이미 떠 있다 (`adopt_first_window`) — 스냅숏의 `main`, 없으면 맨
    // 앞 창이 그 자리를 이어받는다 (`session()` 이 `main` 을 맨 앞에 둔다).
    // 새로 만들지 않는 이유는 단순하다: 이미 있는 창을 두고 또 만들면 빈 창이
    // 하나 남는다.
    let primary = windows.remove(0);
    {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.restore_window(FIRST_WINDOW, &primary.tabs, primary.active);
        for w in &windows {
            reg.restore_window(&w.label, &w.tabs, w.active);
        }
    }
    tracing::info!(
        target: "window",
        windows = windows.len() + 1,
        terminals = terminals.len(),
        "업데이트 전 창 구성을 되살린다"
    );
    broadcast(app, FIRST_WINDOW).await;

    for w in &windows {
        // 라벨이 이미 살아 있으면 건드리지 않는다 (있을 수 없지만, 있으면
        // 웹뷰가 둘 겹친다).
        if app.get_webview_window(&w.label).is_some() {
            continue;
        }
        let title = window_title(app, w.tabs.get(w.active).copied().flatten()).await;
        if let Err(e) = spawn_window(app, &w.label, None, None, false, title).await {
            tracing::warn!(target: "window", label = %w.label, error = %e, "창 복원 실패");
        }
    }

    // 떼어낸 터미널 창도 그대로. 셸까지 살아 돌아온다 — PTY 호스트가 별개
    // 프로세스라 업데이트 재시작을 넘어 살고(2026-08-25), sid 가 프로젝트
    // 접두사라 새 창의 xterm 이 그대로 attach 한다.
    for pid in terminals {
        if let Err(e) = open_terminal_window(app.clone(), pid).await {
            tracing::warn!(target: "window", project_id = pid, error = %e, "터미널 창 복원 실패");
        }
    }

    // 보고 있던 창을 앞으로. 뒤늦게 뜬 창들이 포커스를 가져갔으므로 맨 마지막에
    // 한다. 이어받은 창의 옛 라벨은 `main` 으로 옮겨 읽는다.
    let front = match focused.as_deref() {
        Some(label) if label != primary.label => label.to_string(),
        _ => FIRST_WINDOW.to_string(),
    };
    focus_window(app, &front);
    Ok(())
}

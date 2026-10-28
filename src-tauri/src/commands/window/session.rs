//! 세션 복원 — 업데이트 재시작을 건너 창 구성을 되살린다.
//!
//! 스냅숏은 창마다 (라벨, 프로젝트) 한 쌍이다. 복원은 저장된 라벨을 그대로 써서
//! `tauri-plugin-window-state` 가 기억한 자리를 따라오게 한다.

use super::*;

/// 창 스냅숏이 사는 설정 키.
///
/// **키가 있다는 것 자체가 "다음 실행에서 복원하라" 는 표시**다. 그래서 평소엔
/// 없고, 업데이트 재시작 직전에만 쓰이며, 복원은 읽는 즉시 지운다.
pub const SESSION_KEY: &str = "window_session";

/// 창 하나.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SessionWindow {
    /// 저장 당시의 창 라벨. 그대로 되살려야 위치·크기가 따라온다.
    pub label: String,
    /// 그 창의 프로젝트 — `None` 은 시작 창.
    #[serde(default)]
    pub project: Option<u32>,
    /// 3.x 탭 모양의 스냅숏 — 3.x 가 업데이트 직전에 저장하고 4.0 이 읽는 한 번을
    /// 위해서만 읽는다(쓰지 않는다). 활성 탭의 프로젝트가 그 창의 프로젝트가 된다.
    #[serde(default, skip_serializing)]
    pub tabs: Vec<Option<u32>>,
    #[serde(default, skip_serializing)]
    pub active: usize,
}

impl SessionWindow {
    /// 이 창이 담을 프로젝트 — 4.0 모양이면 `project`, 3.x 탭 모양이면 활성 탭의
    /// 프로젝트(시작 탭이었으면 첫 프로젝트 탭).
    fn resolved_project(&self) -> Option<u32> {
        self.project.or_else(|| {
            self.tabs
                .get(self.active)
                .copied()
                .flatten()
                .or_else(|| self.tabs.iter().find_map(|t| *t))
        })
    }
}

/// 재시작을 건너 옮겨지는 창 구성 전체.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub windows: Vec<SessionWindow>,
    /// 마지막으로 포커스됐던 창 — 복원을 마치고 이 창을 앞으로 가져온다.
    pub focused: Option<String>,
}

/// 스냅숏을 **지금 열 수 있는 것만** 남기고 다듬는다.
///
/// 거르는 것은 둘이다: ① 그 사이 지워진 프로젝트(그 창은 시작 창으로 뜬다),
/// ② 중복 — I1(프로젝트당 창 하나)은 복원에도 그대로 걸린다. 같은 프로젝트를 담은
/// 두 번째 창은 버린다.
///
/// 순수 함수라 Tauri 런타임 없이 단위 테스트한다.
pub fn sanitize_session(session: &Session, known: &HashSet<u32>) -> Session {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut windows: Vec<SessionWindow> = Vec::with_capacity(session.windows.len());
    for w in &session.windows {
        let project = w.resolved_project().filter(|pid| known.contains(pid));
        if let Some(pid) = project {
            if !seen.insert(pid) {
                continue;
            }
        }
        windows.push(SessionWindow {
            label: w.label.clone(),
            project,
            ..SessionWindow::default()
        });
    }
    let focused = session
        .focused
        .clone()
        .filter(|f| windows.iter().any(|w| &w.label == f));
    Session { windows, focused }
}

/// 지금 창 구성을 저장한다 — **우리가 일으킨 재시작** 직전에만 부른다.
///
/// 사용자가 직접 끈 앱이 다음에 시작 창으로 열리는 것은 예측 가능한 동작이라
/// 그대로 둔다. 업데이트는 우리가 끼워 넣은 중단이므로 하던 자리로 돌려놓는다.
#[tauri::command]
#[specta::specta]
pub async fn save_window_session(app: AppHandle) -> Result<(), String> {
    let session = app.state::<WindowProjects>().lock().session();
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    let db = app.state::<crate::db::Db>();
    db.settings_set(SESSION_KEY.to_string(), json)
        .await
        .map_err(|e| e.to_string())
}

/// 저장된 창을 되살린다 — 업데이트 재시작 직후 **한 번**.
///
/// setup 은 동기 구간이라 DB 를 기다릴 수 없어 백그라운드로 넘긴다. 그동안 `main` 은
/// 시작 창으로 이미 떠 있고, 스냅숏이 도착하면 그 창이 첫 창의 프로젝트를 이어받는다
/// (프런트는 `WindowProjectChanged` 로 따라 그린다).
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
        focused,
    } = sanitize_session(&stored, &known);
    if windows.is_empty() {
        return Ok(());
    }

    // 첫 창은 이미 떠 있다 (`adopt_first_window`) — 스냅숏의 `main`, 없으면 맨 앞
    // 창이 그 자리를 이어받는다 (`session()` 이 `main` 을 맨 앞에 둔다).
    let primary = windows.remove(0);
    {
        let state = app.state::<WindowProjects>();
        let mut reg = state.lock();
        reg.restore_window(FIRST_WINDOW, primary.project);
        for w in &windows {
            reg.restore_window(&w.label, w.project);
        }
    }
    tracing::info!(
        target: "window",
        windows = windows.len() + 1,
        "업데이트 전 창 구성을 되살린다"
    );
    announce(app, FIRST_WINDOW);

    for w in &windows {
        // 라벨이 이미 살아 있으면 건드리지 않는다 (웹뷰가 둘 겹친다).
        if app.get_webview_window(&w.label).is_some() {
            continue;
        }
        let title = window_title(app, w.project).await;
        if let Err(e) = spawn_window(app, &w.label, None, title).await {
            tracing::warn!(target: "window", label = %w.label, error = %e, "창 복원 실패");
        }
    }

    // 보고 있던 창을 앞으로 — 뒤늦게 뜬 창들이 포커스를 가져갔으므로 맨 마지막에.
    // 이어받은 창의 옛 라벨은 `main` 으로 옮겨 읽는다.
    let front = match focused.as_deref() {
        Some(label) if label != primary.label => label.to_string(),
        _ => FIRST_WINDOW.to_string(),
    };
    focus_window(app, &front);
    Ok(())
}

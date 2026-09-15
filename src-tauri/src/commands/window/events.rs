//! 프런트로 나가는 이벤트·DTO 와 그 발신 helpers(`snapshot`·`broadcast`·`emit_*`).
//!
//! 이벤트 구조체는 `lib.rs` 의 `collect_events!` 가 `commands::window::*` 경로로
//! 집어 가므로 이름·derive 를 바꾸지 않는다. 프런트는 여기 실린 것만 믿는다.

use super::*;

/// 탭 스트립이 그릴 정보. 시작 탭은 `project_id: None` 이고 이름은 프런트가
/// 사전에서 붙인다 (백엔드가 UI 문자열을 만들지 않는다).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TabInfo {
    pub tab_id: u32,
    pub project_id: Option<u32>,
    pub name: String,
    pub root_path: String,
    /// 프로젝트 겉모습 — 탭도 카드와 같은 아이콘·색으로 그린다. 둘 다 id 이고
    /// `None` 이면 프런트가 이름에서 유도한다 (카드와 같은 규칙).
    pub icon: Option<String>,
    pub color: Option<String>,
}

/// 탭을 옮길 수 있는 창 하나 (메뉴용). 이름은 프런트가 붙인다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AppWindowInfo {
    pub label: String,
    /// 그 창에서 지금 보이는 탭의 프로젝트. 시작 탭이면 `None`.
    pub active_project_id: Option<u32>,
    pub tab_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct WindowTabsSnapshot {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u32>,
}

/// 한 창의 탭 구성이 바뀌었다 — 그 창의 프런트가 스트립을 다시 그린다.
/// 이름까지 실어 보내므로 프런트는 후속 조회가 필요 없다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct WindowTabsChanged {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u32>,
}

/// ⌘W 가 눌렸다 — **닫을 대상을 프런트가 고른다**.
///
/// 예전에는 Rust 가 곧장 탭을 닫았다. 그런데 화면 안에 또 닫을 것이 생겼다
/// (Claude Code 의 세션 탭): 사용자는 브라우저처럼 "안쪽부터" 닫히기를 기대한다.
/// 무엇이 열려 있는지는 프런트만 아는 사실이라 판단도 그쪽이 한다.
///
/// 프런트가 안 듣고 있으면 ⌘W 는 아무 일도 하지 않는다 — 창을 닫는 길은
/// ⇧⌘W(Close Window)에 그대로 남아 있고, 그쪽은 Rust 가 직접 처리한다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct CloseIntent {
    pub window: String,
    /// 프런트가 아무 것도 소비하지 않으면 닫을 탭.
    pub tab: Option<u32>,
}

/// ⌘T 가 눌렸다 — **무엇을 새로 열지 프런트가 고른다** (2026-09-01).
///
/// `CloseIntent` 와 같은 사정이다: 메뉴 액셀러레이터라 macOS 가 웹뷰보다 먼저
/// 먹어치우고, 그래서 터미널이 걸어 둔 ⌘T keydown 은 한 번도 돌지 않았다 —
/// 셸에 타이핑하다 ⌘T 를 눌러도 프로젝트 탭이 열렸다. 포커스가 어디에 있는지는
/// 프런트만 아는 사실이므로 판단도 그쪽이 한다.
///
/// 아무도 소비하지 않으면 창이 평소대로 **시작 탭**을 연다 (프런트의 기본값).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct NewTabIntent {
    pub window: String,
}

/// 어디든 열린 프로젝트 집합이 바뀌었다 — 시작 탭의 "열림" 배지.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ProjectWindowsChanged {
    pub open: Vec<u32>,
}

/// 터미널을 창으로 떼어낸 프로젝트 집합이 바뀌었다 (2026-08-15).
///
/// 셸의 도크·터미널 화면은 이걸 듣고 자리표시자로 바뀐다. 사용자가 분리 창을
/// OS 의 닫기 버튼으로 닫아도 같은 길로 되돌아온다 — 프런트가 자기 상태를
/// 진실로 삼지 않는 이유다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TerminalWindowsChanged {
    pub open: Vec<u32>,
}

/// 다른 창에서 끌고 온 탭이 **이 창의 스트립 위**에 있다 (창 간 드래그).
///
/// `x` 는 창 안쪽 왼쪽 위 기준 **논리 px**. 받는 쪽이 웹뷰 줌으로 나눠 CSS px 로
/// 바꾼 뒤, 자기 탭 기하로 삽입 자리를 계산해 캐럿을 그리고 그 인덱스를
/// `tab_drop_hint` 로 되돌려 준다 — Rust 는 탭 폭을 모르기 때문이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TabDragOver {
    pub window: String,
    pub x: f64,
    /// 끌려오는 탭. 자기 탭이면(같은 창 되돌아오기) 무시할 수 있게 실어 보낸다.
    pub tab_id: u32,
    /// 끌려오는 탭의 겉모습 — **스트립에 처음 들어선 순간에만** 실린다.
    ///
    /// 받는 창은 남의 탭 이름을 알 길이 없다(레지스트리도 프로젝트 DB 도 그
    /// 창의 것이 아니다). 그런데 자리표시자에 이름이 없으면 "무엇이 오는지"는
    /// 모른 채 "무언가 온다"만 보인다 — 창이 셋이면 그게 곧 오조준이 된다.
    ///
    /// 매번 싣지 않는 이유는 값이 DB 조회 한 번이기 때문이다. 포인터는 초당
    /// 수십 번 움직이지만 **겨누는 창이 바뀌는 일**은 드물다. 받는 쪽은 처음
    /// 받은 것을 `TabDragLeave` 까지 들고 있으면 된다.
    pub preview: Option<TabPreview>,
}

/// 끌려오는 탭을 받는 창이 그리기 위한 최소 정보 — 스트립의 탭과 **같은**
/// 재료다(이름·아이콘·색). 프로젝트 id 를 안 싣는 이유는 받는 창이 그것으로
/// 할 수 있는 일이 없어서다: 아직 자기 탭이 아니라 조회해도 남의 것이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TabPreview {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// 시작 탭인가 — 이름이 비어 있고 아이콘이 고정이라 갈래가 필요하다.
    pub is_start: bool,
}

/// 손에 들려 있던 창을 **놓았다** — 이제 평범한 창이다.
///
/// 떼어내는 동안 그 창은 탭 줄만 그리고 화면 마운트를 붙잡고 있었다
/// (`?tearoff=1`). 이 이벤트가 그 손을 놓아 준다 — 프로젝트 init·워처·자동색인이
/// 그때 비로소 돈다. 끌려다니다 남의 창에 합쳐지면 이 이벤트는 오지 않고 창이
/// 그대로 닫히므로, 그 전부가 아예 시작되지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TearOffSettled {
    pub window: String,
}

/// 그 탭이 이 창의 스트립을 벗어났다 (또는 드래그가 끝났다) — 캐럿을 지운다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TabDragLeave {
    pub window: String,
}

pub(super) async fn snapshot(app: &AppHandle, label: &str) -> WindowTabsSnapshot {
    let (order, active) = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let st = reg.get(label).cloned().unwrap_or_default();
        (st.order, st.active)
    };
    let db = app.state::<crate::db::Db>();
    let mut tabs = Vec::with_capacity(order.len());
    for tab in order {
        let (name, root_path, icon, color) = match tab.project_id {
            // 프로젝트가 DB 에서 사라졌어도 탭은 그려야 한다 — 이름만 폴백.
            Some(pid) => match db.get_project(pid).await {
                Ok(p) => (p.name, p.root_path, p.icon, p.color),
                Err(_) => (format!("#{pid}"), String::new(), None, None),
            },
            None => (String::new(), String::new(), None, None),
        };
        tabs.push(TabInfo {
            tab_id: tab.id,
            project_id: tab.project_id,
            name,
            root_path,
            icon,
            color,
        });
    }
    WindowTabsSnapshot {
        window: label.to_string(),
        tabs,
        active,
    }
}

/// 창별 변경 + 전역 배지를 함께 알린다.
pub(super) async fn broadcast(app: &AppHandle, label: &str) {
    let snap = snapshot(app, label).await;
    let _ = WindowTabsChanged {
        window: snap.window.clone(),
        tabs: snap.tabs,
        active: snap.active,
    }
    .emit_to(app, label);
    emit_open_projects(app);
}

pub(super) fn emit_open_projects(app: &AppHandle) {
    let open = app.state::<WindowTabs>().lock().all_open_projects();
    let _ = ProjectWindowsChanged { open }.emit(app);
}

pub(super) fn emit_terminal_windows(app: &AppHandle) {
    let open = app.state::<WindowTabs>().lock().terminal_window_projects();
    let _ = TerminalWindowsChanged { open }.emit(app);
}

//! 창·탭 관리 — SSOT: docs/20260811_three-features/01b-chrome-tabs.md.
//!
//! 창 모델 (크롬식 탭): 창은 **탭의 집합**이고, 탭은 두 종류다.
//!
//! - **시작 탭** — 프로젝트 메인 화면(목록·추가·관리). Chrome 의 새 탭 페이지.
//!   여기서 프로젝트를 고르면 **그 자리에서** 프로젝트 탭이 된다.
//! - **프로젝트 탭** — 그 프로젝트의 전체 셸.
//!
//! 불변식:
//! - I1 — 프로젝트당 탭 하나, **전역 유일**. 이미 열려 있으면 그 창을 포커스하고
//!        그 탭을 활성화한다. (덕분에 `OculpmManager` 가 watcher refcount 없이
//!        프로젝트당 엔트리 하나를 유지할 수 있다 — D2)
//! - I3 — **프로젝트** 탭의 프로젝트는 탭의 수명 동안 바뀌지 않는다. 시작 탭이
//!        프로젝트 탭으로 승격하는 것은 한 방향뿐이다.
//!
//! 라벨에서 프로젝트를 읽을 수 없으므로 **이 모듈이 레지스트리를 소유**한다.
//! 프런트는 `WindowTabsChanged` 로 미러링만 한다.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_specta::Event;

/// 추가로 만드는 창의 라벨 접두사. `tauri-plugin-window-state` 가 라벨 기준으로
/// 위치·크기를 기억하므로 `win-1`, `win-2` … 는 재실행 사이에도 재사용된다.
pub const WINDOW_PREFIX: &str = "win-";
/// `tauri.conf.json` 이 만드는 첫 창. **특별하지 않다** — 다른 창과 똑같이
/// 탭을 물고, 똑같이 닫힌다 (예전 "런처 전용 창" 개념은 시작 탭이 대체했다).
pub const FIRST_WINDOW: &str = "main";

/// 기본 크기·최소 크기는 `tauri.conf.json` 의 첫 창과 맞춘다.
const WINDOW_W: f64 = 1150.0;
const WINDOW_H: f64 = 780.0;
const WINDOW_MIN_W: f64 = 960.0;
const WINDOW_MIN_H: f64 = 640.0;

pub fn window_label(n: u32) -> String {
    format!("{WINDOW_PREFIX}{n}")
}

/// 탭을 물 수 있는 창인가 — 트레이 팝오버(`tray`)만 제외된다.
pub fn is_app_window(label: &str) -> bool {
    label == FIRST_WINDOW
        || label
            .strip_prefix(WINDOW_PREFIX)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

/// PTY 세션 id 접두사. **프로젝트** 기준이라 탭이 창을 옮겨 다녀도 유효하다 —
/// 그래서 떼어낸 탭의 셸이 죽지 않는다. 끝의 `-` 덕분에 `p1-` 이 `p12-…` 를
/// 잡아먹지 않는다. 프런트의 `TerminalScreenV2.newId` 와 짝이다.
pub fn pty_prefix_for(project_id: u32) -> String {
    format!("p{project_id}-")
}

// ─── 레지스트리 ──────────────────────────────────────────────────────────────

/// 탭 하나. `project_id` 가 `None` 이면 시작 탭.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tab {
    pub id: u32,
    pub project_id: Option<u32>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct WindowState {
    pub order: Vec<Tab>,
    pub active: Option<u32>,
}

/// 창 → 탭 집합. 순수 자료구조라 Tauri 런타임 없이 단위 테스트할 수 있다.
#[derive(Debug, Default)]
pub struct Registry {
    windows: HashMap<String, WindowState>,
    /// 새 탭이 어느 창에 붙을지 결정한다. 창이 포커스될 때마다 갱신.
    last_focused: Option<String>,
    next_window: u32,
    next_tab: u32,
}

impl Registry {
    fn mint(&mut self, project_id: Option<u32>) -> Tab {
        self.next_tab += 1;
        Tab { id: self.next_tab, project_id }
    }

    /// 이 프로젝트가 열려 있는 (창, 탭 id) — I1 이라 있어야 최대 하나.
    pub fn locate_project(&self, project_id: u32) -> Option<(String, u32)> {
        self.windows.iter().find_map(|(label, st)| {
            st.order
                .iter()
                .find(|t| t.project_id == Some(project_id))
                .map(|t| (label.clone(), t.id))
        })
    }

    fn locate_tab(&self, tab_id: u32) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, st)| st.order.iter().any(|t| t.id == tab_id))
            .map(|(label, _)| label.clone())
    }

    pub fn get(&self, label: &str) -> Option<&WindowState> {
        self.windows.get(label)
    }

    /// 열려 있는 전체 프로젝트 id (시작 화면의 "열림" 배지). 정렬해 돌려준다.
    pub fn all_open_projects(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self
            .windows
            .values()
            .flat_map(|st| st.order.iter().filter_map(|t| t.project_id))
            .collect();
        ids.sort_unstable();
        ids
    }

    /// 창을 등록한다. `main` 처럼 이미 존재하는 창을 시작 탭 하나로 여는 데도 쓴다.
    fn register(&mut self, label: &str, project_id: Option<u32>) -> u32 {
        let tab = self.mint(project_id);
        self.windows
            .insert(label.to_string(), WindowState { order: vec![tab], active: Some(tab.id) });
        self.last_focused = Some(label.to_string());
        tab.id
    }

    /// 새 창 라벨을 발급하고 탭 하나와 함께 등록한다.
    fn reserve(&mut self, project_id: Option<u32>) -> String {
        self.next_window += 1;
        let label = window_label(self.next_window);
        self.register(&label, project_id);
        label
    }

    /// 이미 있는 창의 끝에 탭을 붙이고 활성화한다.
    fn append(&mut self, label: &str, project_id: Option<u32>) -> u32 {
        let tab = self.mint(project_id);
        let st = self.windows.entry(label.to_string()).or_default();
        st.order.push(tab);
        st.active = Some(tab.id);
        tab.id
    }

    /// 시작 탭을 **제자리에서** 프로젝트 탭으로 승격한다 (Chrome 의 새 탭에서
    /// 주소를 여는 것과 같다 — 탭이 옮겨가지 않고 내용만 바뀐다).
    fn assign_project(&mut self, tab_id: u32, project_id: u32) -> Option<String> {
        let label = self.locate_tab(tab_id)?;
        let st = self.windows.get_mut(&label)?;
        let tab = st.order.iter_mut().find(|t| t.id == tab_id)?;
        tab.project_id = Some(project_id);
        st.active = Some(tab_id);
        Some(label)
    }

    /// 탭 제거. 반환값은 (창 라벨, 사라진 프로젝트, 창이 비었는가).
    ///
    /// 활성 탭을 지우면 Chrome 처럼 **오른쪽 이웃**으로 넘어가고, 없으면 왼쪽.
    fn remove_tab(&mut self, tab_id: u32) -> Option<(String, Option<u32>, bool)> {
        let label = self.locate_tab(tab_id)?;
        let st = self.windows.get_mut(&label)?;
        let idx = st.order.iter().position(|t| t.id == tab_id)?;
        let gone = st.order.remove(idx);
        if st.active == Some(tab_id) {
            st.active = st.order.get(idx).or_else(|| st.order.last()).map(|t| t.id);
        }
        let empty = st.order.is_empty();
        if empty {
            self.windows.remove(&label);
        }
        Some((label, gone.project_id, empty))
    }

    fn activate(&mut self, tab_id: u32) -> Option<String> {
        let label = self.locate_tab(tab_id)?;
        self.windows.get_mut(&label)?.active = Some(tab_id);
        self.last_focused = Some(label.clone());
        Some(label)
    }

    /// 요청된 순서를 **현재 탭 집합으로 걸러** 적용한다 — 프런트가 낡은 목록을
    /// 보냈을 때 탭이 사라지거나 남의 탭이 끼어드는 걸 막는다.
    fn reorder(&mut self, label: &str, requested: &[u32]) -> bool {
        let Some(st) = self.windows.get_mut(label) else {
            return false;
        };
        let mut next: Vec<Tab> = Vec::with_capacity(st.order.len());
        for id in requested {
            if let Some(tab) = st.order.iter().find(|t| t.id == *id) {
                if !next.iter().any(|t| t.id == tab.id) {
                    next.push(*tab);
                }
            }
        }
        // 요청에서 빠진 탭은 잃지 않고 뒤에 붙인다.
        for tab in &st.order {
            if !next.iter().any(|t| t.id == tab.id) {
                next.push(*tab);
            }
        }
        let changed = next != st.order;
        st.order = next;
        changed
    }

    fn note_focus(&mut self, label: &str) {
        if self.windows.contains_key(label) {
            self.last_focused = Some(label.to_string());
        }
    }

    /// 새 탭이 붙을 창 — 마지막으로 포커스된 창.
    fn preferred_window(&self) -> Option<String> {
        self.last_focused
            .as_ref()
            .filter(|l| self.windows.contains_key(*l))
            .cloned()
            .or_else(|| self.windows.keys().next().cloned())
    }
}

#[derive(Default)]
pub struct WindowTabs(Mutex<Registry>);

impl WindowTabs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

// ─── 이벤트 / DTO ────────────────────────────────────────────────────────────

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

/// 어디든 열린 프로젝트 집합이 바뀌었다 — 시작 탭의 "열림" 배지.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ProjectWindowsChanged {
    pub open: Vec<u32>,
}

async fn snapshot(app: &AppHandle, label: &str) -> WindowTabsSnapshot {
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
    WindowTabsSnapshot { window: label.to_string(), tabs, active }
}

/// 창별 변경 + 전역 배지를 함께 알린다.
async fn broadcast(app: &AppHandle, label: &str) {
    let snap = snapshot(app, label).await;
    let _ = WindowTabsChanged { window: snap.window.clone(), tabs: snap.tabs, active: snap.active }
        .emit_to(app, label);
    emit_open_projects(app);
}

fn emit_open_projects(app: &AppHandle) {
    let open = app.state::<WindowTabs>().lock().all_open_projects();
    let _ = ProjectWindowsChanged { open }.emit(app);
}

// ─── 커맨드 ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn open_devtools(webview: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err("DevTools is only available in development builds.".to_string())
    }
}

/// 쿼리 파라미터 값 최소 이스케이프. 신규 의존성 없이, 파라미터를 깨뜨리는
/// 문자(`&` `#` `%` 공백 …)만 퍼센트 인코딩한다. UTF-8 은 바이트 단위로
/// 인코딩되어 프런트의 `decodeURIComponent` 가 그대로 복원한다.
fn encode_query_value(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 새 창의 URL. 탭 집합은 프런트가 마운트 직후 `get_window_tabs` 로 읽지만,
/// 라벨과 딥링크 목적지는 URL 로 실어야 한다 — 갓 만든 창의 프런트는 아직
/// 리스너를 달기 전이라 `emit` 이 유실된다.
fn window_url(label: &str, nav: Option<&crate::tray::TrayNavigate>) -> String {
    let mut url = format!("index.html?win={}", encode_query_value(label));
    if let Some(nav) = nav {
        url.push_str(&format!("&view={}", encode_query_value(&nav.view)));
        if let Some(entry) = nav.entry_path.as_deref() {
            url.push_str(&format!("&entry={}", encode_query_value(entry)));
        }
    }
    url
}

/// 프로젝트를 탭으로 연다 — I1 이 여기서 강제된다.
///
/// - 이미 어딘가 열려 있으면 그 창을 포커스하고 그 탭을 활성화한다.
/// - `window` 가 지정되면 그 창의 마지막 탭으로 붙인다.
/// - 없으면 마지막으로 포커스된 창에 붙이고, 창이 아예 없으면 새 창.
#[tauri::command]
#[specta::specta]
pub async fn open_project_tab(
    app: AppHandle,
    project_id: u32,
    window: Option<String>,
) -> Result<(), String> {
    open_project_tab_with_nav(&app, project_id, window, None).await
}

pub async fn open_project_tab_with_nav(
    app: &AppHandle,
    project_id: u32,
    window: Option<String>,
    nav: Option<&crate::tray::TrayNavigate>,
) -> Result<(), String> {
    // 상주 모드에서 Dock 아이콘을 내려놨을 수 있다 — 창을 띄우기 전에 되돌린다.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    // ① 이미 열려 있으면 그 창을 포커스하고 탭만 활성화한다 (I1).
    let existing = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.locate_project(project_id).map(|(_, tab_id)| tab_id).and_then(|id| reg.activate(id))
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str()).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ② 붙일 창을 고른다. 레지스트리에는 있는데 창이 이미 죽었으면 새로 만든다.
    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };

    if let Some(label) = target {
        {
            let state = app.state::<WindowTabs>();
            state.lock().append(&label, Some(project_id));
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str()).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ③ 새 창.
    create_window(app, Some(project_id), nav, None).await
}

/// `+` — 시작 탭(프로젝트 메인 화면)을 연다. Chrome 의 새 탭 페이지.
#[tauri::command]
#[specta::specta]
pub async fn new_start_tab(app: AppHandle, window: Option<String>) -> Result<(), String> {
    new_start_tab_inner(&app, window).await
}

pub async fn new_start_tab_inner(app: &AppHandle, window: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };
    let Some(label) = target else {
        return create_window(app, None, None, None).await;
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().append(&label, None);
    }
    focus_window(app, &label);
    broadcast(app, &label).await;
    Ok(())
}

/// 앱 메뉴의 "새 창" — 언제나 새 창을 만든다 (탭을 붙이지 않는다).
pub async fn new_window_inner(app: &AppHandle) -> Result<(), String> {
    create_window(app, None, None, None).await
}

/// 시작 탭에서 프로젝트를 골랐다 — **그 자리에서** 프로젝트 탭이 된다.
/// 단, 그 프로젝트가 이미 다른 탭에 열려 있으면 (I1) 그쪽을 활성화하고
/// 시작 탭은 그대로 둔다.
#[tauri::command]
#[specta::specta]
pub async fn set_tab_project(
    app: AppHandle,
    tab_id: u32,
    project_id: u32,
) -> Result<(), String> {
    let already = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.locate_project(project_id)
    };
    if let Some((label, existing_tab)) = already {
        if existing_tab != tab_id {
            let state = app.state::<WindowTabs>();
            state.lock().activate(existing_tab);
            focus_window(&app, &label);
            broadcast(&app, &label).await;
            return Ok(());
        }
    }
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.assign_project(tab_id, project_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

/// 탭을 닫는다. 창의 마지막 탭이면 창도 닫는다 (Chrome 과 같다).
#[tauri::command]
#[specta::specta]
pub async fn close_tab(app: AppHandle, tab_id: u32) -> Result<(), String> {
    close_tab_inner(&app, tab_id).await
}

pub async fn close_tab_inner(app: &AppHandle, tab_id: u32) -> Result<(), String> {
    let removed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.remove_tab(tab_id)
    };
    let Some((label, project_id, emptied)) = removed else {
        return Ok(());
    };
    if let Some(pid) = project_id {
        release_project(app, pid);
    }
    if emptied {
        // 마지막 탭을 닫으면 창도 닫힌다 (Chrome 과 같다) — `⌘W` 한 키로
        // "탭 닫기" 와 "창 닫기" 가 자연스럽게 이어지는 지점이다.
        // 창 닫기가 CloseRequested 훅을 돌리지만, 레지스트리에서 이미 빠졌으므로
        // 남은 탭 정리는 no-op 이고 "마지막 창" 판정만 정상적으로 걸린다.
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    } else {
        broadcast(app, &label).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn activate_tab(app: AppHandle, tab_id: u32) -> Result<(), String> {
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.activate(tab_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reorder_tabs(app: AppHandle, window: String, order: Vec<u32>) -> Result<(), String> {
    let changed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reorder(&window, &order)
    };
    if changed {
        broadcast(&app, &window).await;
    }
    Ok(())
}

/// 탭을 창 밖으로 떼어낸다 — 화면 좌표(CSS 픽셀)에 새 창을 만든다.
///
/// 새 창에서 셸이 다시 마운트되므로 DOM 상태(스크롤 위치)는 잃지만, 화면·필터·
/// 터미널 탭 구성은 프로젝트별 localStorage 에 있고 **PTY 세션은 Rust 에 살아
/// 있어** 스크롤백까지 재부착된다 (`pty_prefix_for` 가 프로젝트 기준이라 가능).
#[tauri::command]
#[specta::specta]
pub async fn detach_tab(app: AppHandle, tab_id: u32, x: f64, y: f64) -> Result<(), String> {
    let removed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        // 창에 탭이 하나뿐이면 떼어낼 게 없다 — 그대로 두는 게 맞다
        // (떼어내면 원본 창이 닫히고 같은 내용의 새 창이 뜨는 셈이라 순수 손해).
        let single = reg
            .locate_tab(tab_id)
            .and_then(|l| reg.get(&l).map(|st| st.order.len() <= 1))
            .unwrap_or(true);
        if single {
            None
        } else {
            reg.remove_tab(tab_id)
        }
    };
    let Some((source, project_id, _)) = removed else {
        return Ok(());
    };
    broadcast(&app, &source).await;
    create_window(&app, project_id, None, Some((x, y))).await
}

/// 창이 마운트 직후 자기 탭 구성을 읽는다 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn get_window_tabs(app: AppHandle, window: String) -> Result<WindowTabsSnapshot, String> {
    Ok(snapshot(&app, &window).await)
}

/// 프런트가 해석한 UI 언어를 알려 준다 — 메뉴 라벨을 그 언어로 다시 만든다.
///
/// Rust 는 프런트의 i18n 사전을 읽지 않고, `language: "system"` 을 OS 로케일로
/// 푸는 것도 백엔드에서는 불안정하다 (GUI 프로세스에는 `LANG` 이 없다).
/// **이미 해석을 끝낸 프런트가 결과만 넘겨주는 것**이 가장 정확하다.
#[tauri::command]
#[specta::specta]
pub async fn apply_menu_language(app: AppHandle, lang: String) -> Result<(), String> {
    let menu = crate::menu::build(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// 시작 탭이 "열림" 배지를 그리기 위한 1회 조회 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn list_open_project_ids(app: AppHandle) -> Result<Vec<u32>, String> {
    let state = app.state::<WindowTabs>();
    let ids = state.lock().all_open_projects();
    Ok(ids)
}

// ─── 창 생성·정리 ────────────────────────────────────────────────────────────

fn focus_window(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 앱 창을 하나 앞으로 — 없으면 시작 탭으로 하나 만든다.
/// 트레이 메뉴 "열기" 와 상주 모드 복귀의 공용 경로.
pub async fn focus_or_open_window(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let existing = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window().filter(|l| app.get_webview_window(l).is_some())
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        return Ok(());
    }
    create_window(app, None, None, None).await
}

async fn create_window(
    app: &AppHandle,
    project_id: Option<u32>,
    nav: Option<&crate::tray::TrayNavigate>,
    position: Option<(f64, f64)>,
) -> Result<(), String> {
    // **휴면 창**을 먼저 재사용한다 — 웹뷰는 살아 있는데 레지스트리에는 없는
    // 창. 두 경우에 생긴다: ① 앱 시작 직후의 `main`(아직 편입 전), ② 상주
    // 모드에서 마지막 창을 닫아 숨겨 둔 창. 재사용하지 않으면 숨은 웹뷰가
    // 영원히 남고 매번 새 라벨이 발급된다.
    let dormant = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let mut labels: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|l| is_app_window(l) && reg.get(l).is_none())
            .cloned()
            .collect();
        // 결정적으로 고른다 — `main` 을 우선하고 그다음 라벨 순.
        labels.sort();
        labels
            .iter()
            .find(|l| l.as_str() == FIRST_WINDOW)
            .or_else(|| labels.first())
            .cloned()
    };
    if let Some(label) = dormant {
        {
            let state = app.state::<WindowTabs>();
            state.lock().register(&label, project_id);
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        return Ok(());
    }

    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reserve(project_id)
    };

    let title = match project_id {
        Some(pid) => {
            let db = app.state::<crate::db::Db>();
            db.get_project(pid).await.map(|p| p.name).unwrap_or_else(|_| "Ocul-PM".to_string())
        }
        None => "Ocul-PM".to_string(),
    };

    let mut builder =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App(window_url(&label, nav).into()))
            .title(title)
            .hidden_title(true)
            .inner_size(WINDOW_W, WINDOW_H)
            .min_inner_size(WINDOW_MIN_W, WINDOW_MIN_H)
            .resizable(true);
    if let Some((x, y)) = position {
        // 포인터가 새 창의 타이틀바 근처에 오도록 살짝 위·왼쪽으로 당긴다.
        builder = builder.position(x - 120.0, y - 16.0);
    }

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            // 예약만 해두고 창이 안 뜨면 유령 엔트리가 남는다 — 되돌린다.
            let state = app.state::<WindowTabs>();
            state.lock().windows.remove(&label);
            return Err(e.to_string());
        }
    };

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    attach_window_hooks(app, &window, label);
    emit_open_projects(app);
    Ok(())
}

/// `tauri.conf.json` 이 만든 첫 창을 레지스트리에 등록하고 훅을 붙인다.
/// 앱 시작 시 setup 에서 한 번 호출한다.
pub fn adopt_first_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FIRST_WINDOW) else {
        return;
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().register(FIRST_WINDOW, None);
    }
    attach_window_hooks(app, &window, FIRST_WINDOW.to_string());
}

/// 창 이벤트 훅 — 포커스 추적 + 닫을 때 그 창의 **모든 탭** 정리.
///
/// 프런트의 `beforeunload` 에 맡기지 않는 이유: 강제 종료·크래시 시 새기
/// 때문이다. Rust 쪽 창 이벤트가 유일하게 믿을 수 있는 지점이다.
fn attach_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, label: String) {
    let handle = app.clone();
    window.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Focused(true) => {
            let state = handle.state::<WindowTabs>();
            state.lock().note_focus(&label);
        }
        // `Destroyed` 가 아니라 `CloseRequested` 를 쓴다 — 앱 종료 경로에서는
        // 발화하지 않아, 종료 중에 "마지막 창" 판정이 무언가를 다시 띄우는
        // 사고를 구조적으로 막는다.
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if handle_window_closed(&handle, &label) {
                api.prevent_close();
            }
        }
        _ => {}
    });
}

/// 반환값 `true` 면 닫기를 가로챈 것 (트레이 상주 모드에서 숨기기만 함).
fn handle_window_closed(app: &AppHandle, label: &str) -> bool {
    let (closed_tabs, remaining) = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        let tabs = reg
            .windows
            .remove(label)
            .map(|st| st.order.iter().filter_map(|t| t.project_id).collect::<Vec<_>>())
            .unwrap_or_default();
        if reg.last_focused.as_deref() == Some(label) {
            reg.last_focused = None;
        }
        (tabs, reg.windows.len())
    };

    for project_id in closed_tabs {
        release_project(app, project_id);
    }
    emit_open_projects(app);

    if remaining > 0 {
        return false;
    }

    // 마지막 창 — 어떤 PTY 도 주인이 없다. 접두사 없는 레거시 sid(멀티 창
    // 이전에 저장된 터미널 탭)까지 여기서 회수한다.
    if let Some(pty) = app.try_state::<crate::commands::terminal::PtyState>() {
        pty.kill_with_prefix("");
    }
    crate::tray::handle_last_window_closed(app, label)
}

/// 탭이 사라질 때의 프로젝트 단위 정리 — **PTY 종료만** 한다.
///
/// 예전에는 watcher 도 함께 멈췄다. 하지만 감시 범위가 "열린 탭" 에서 "추적
/// 중인 모든 프로젝트" 로 바뀌면서(2026-08-12), watcher 의 수명은 탭이 아니라
/// **앱 프로세스**에 묶인다 — 여기서 멈추면 탭을 닫는 순간 그 프로젝트가
/// 상단바에서 다시 사라진다. 종료 시 정리는 `shutdown_all_blocking` 이 한다.
fn release_project(app: &AppHandle, project_id: u32) {
    if let Some(pty) = app.try_state::<crate::commands::terminal::PtyState>() {
        let killed = pty.kill_with_prefix(&pty_prefix_for(project_id));
        if killed > 0 {
            tracing::info!(target: "window", project_id, killed, "tab closed — PTY sessions killed");
        }
    }
}

/// 지금 포커스된 앱 창. 메뉴 이벤트에는 대상 창이 실려 오지 않으므로 여기서
/// 찾는다. 실제 포커스를 먼저 보고(가장 정확하다), 못 찾으면 레지스트리가
/// 기억하는 마지막 포커스 창으로 떨어진다 — 메뉴를 여는 순간 창이 포커스를
/// 잃는 플랫폼도 있기 때문이다. 트레이 팝오버는 앱 창이 아니라 제외된다.
pub fn focused_app_window(app: &AppHandle) -> Option<String> {
    let live = app
        .webview_windows()
        .into_iter()
        .find(|(label, w)| is_app_window(label) && w.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    live.or_else(|| {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window()
    })
}

/// 그 창에서 지금 보이고 있는 탭.
pub fn active_tab_of(app: &AppHandle, label: &str) -> Option<u32> {
    let state = app.state::<WindowTabs>();
    let reg = state.lock();
    reg.get(label).and_then(|st| st.active)
}

/// 추적 중인 **모든** 프로젝트의 감시를 시작한다 (앱 시작 시 1회).
///
/// 왜 전부인가 — 이 앱의 약속은 "외부 에이전트가 한 일을 기록한다" 이고, 그
/// 기록은 watcher 가 만든다. 예전에는 watcher 가 **탭 수명**에 묶여 있어서,
/// 탭을 열지 않은 프로젝트에서 에이전트가 아무리 일해도 세션이 생성조차
/// 되지 않았다 — 상단바가 "하나만 감지" 하던 이유가 이것이다.
///
/// 부하는 순차 + 간격으로 흩는다: 프로젝트 N 개의 init(디스크 쓰기 포함)과
/// 인덱싱이 동시에 터지면 콜드 스타트가 눈에 띄게 느려지고, macOS 폴더 접근
/// 권한 프롬프트가 한꺼번에 쏟아진다. 실패는 프로젝트 단위로 삼킨다 —
/// 하나가 안 열린다고 나머지 감시를 포기할 이유가 없다.
pub fn start_background_watchers(app: &AppHandle) {
    const STAGGER: std::time::Duration = std::time::Duration::from_millis(400);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let projects = {
            let db = handle.state::<crate::db::Db>();
            match db.list_projects().await {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(target: "oculpm::bootstrap", error = %e, "프로젝트 목록 조회 실패");
                    return;
                }
            }
        };
        tracing::info!(target: "oculpm::bootstrap", n = projects.len(), "백그라운드 감시 시작");

        for project in projects {
            let root = std::path::PathBuf::from(&project.root_path);
            // 사라진 폴더는 조용히 건너뛴다 — 사용자가 옮겼거나 지웠을 뿐,
            // 시작 로그를 에러로 채울 일이 아니다.
            if !root.is_dir() {
                continue;
            }
            let lang = {
                let db = handle.state::<crate::db::Db>();
                match crate::oculpm::content_lang::current(&db).await {
                    crate::oculpm::content_lang::ContentLang::English => "en",
                    _ => "ko",
                }
            };
            let manager = handle.state::<crate::oculpm::manager::OculpmManager>();
            if let Err(e) = manager.init_project(project.id, &root, lang).await {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e,
                    "init 실패 — 이 프로젝트는 감시하지 않는다"
                );
                continue;
            }
            if let Err(e) = manager.watcher_start(project.id, Some(handle.clone())).await {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e, "watcher 시작 실패"
                );
            }
            drop(manager);
            tokio::time::sleep(STAGGER).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg_with(windows: &[(&str, &[Option<u32>])]) -> Registry {
        let mut reg = Registry::default();
        for (label, projects) in windows {
            for (i, p) in projects.iter().enumerate() {
                if i == 0 {
                    reg.register(label, *p);
                } else {
                    reg.append(label, *p);
                }
            }
            // 첫 탭을 활성으로 되돌려 테스트가 예측 가능하게.
            if let Some(st) = reg.windows.get_mut(*label) {
                st.active = st.order.first().map(|t| t.id);
            }
        }
        reg
    }

    fn ids(reg: &Registry, label: &str) -> Vec<u32> {
        reg.get(label).unwrap().order.iter().map(|t| t.id).collect()
    }

    fn projects(reg: &Registry, label: &str) -> Vec<Option<u32>> {
        reg.get(label).unwrap().order.iter().map(|t| t.project_id).collect()
    }

    #[test]
    fn labels_distinguish_app_windows() {
        assert!(is_app_window("main"));
        assert!(is_app_window("win-1"));
        assert!(is_app_window("win-42"));
        assert!(!is_app_window("tray"));
        assert!(!is_app_window("win-"));
        assert!(!is_app_window("win-abc"));
        assert!(!is_app_window("window-1"));
    }

    /// 접두사가 다른 프로젝트를 잡아먹지 않는다 — `p1-` 이 `p12-…` 를 죽이면
    /// 탭 하나를 닫을 때 다른 탭의 셸이 함께 죽는다.
    #[test]
    fn pty_prefix_does_not_swallow_longer_ids() {
        let p1 = pty_prefix_for(1);
        assert!("p1-a1b2c3d4".starts_with(&p1));
        assert!(!"p12-a1b2c3d4".starts_with(&p1));
    }

    #[test]
    fn tab_ids_are_unique_across_windows() {
        let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(7)])]);
        let mut all = ids(&reg, "main");
        all.extend(ids(&reg, "win-1"));
        let mut sorted = all.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), all.len(), "탭 id 는 창을 가로질러 유일해야 한다");
    }

    #[test]
    fn locate_project_finds_the_owning_window_and_tab() {
        let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(9)])]);
        let (label, tab_id) = reg.locate_project(3).unwrap();
        assert_eq!(label, "main");
        assert_eq!(tab_id, ids(&reg, "main")[1]);
        assert_eq!(reg.locate_project(11), None);
    }

    /// 시작 탭은 프로젝트가 없으므로 "열림" 목록에 끼지 않는다.
    #[test]
    fn start_tabs_are_not_open_projects() {
        let reg = reg_with(&[("main", &[None, Some(9), None]), ("win-1", &[Some(3)])]);
        assert_eq!(reg.all_open_projects(), vec![3, 9]);
    }

    /// 시작 탭에서 프로젝트를 고르면 **자리를 지킨 채** 승격한다.
    #[test]
    fn assign_project_promotes_in_place() {
        let mut reg = reg_with(&[("main", &[Some(3), None, Some(9)])]);
        let start = ids(&reg, "main")[1];
        assert_eq!(reg.assign_project(start, 5).as_deref(), Some("main"));
        assert_eq!(projects(&reg, "main"), vec![Some(3), Some(5), Some(9)]);
        assert_eq!(reg.get("main").unwrap().active, Some(start));
        assert_eq!(ids(&reg, "main")[1], start, "탭 id 는 유지된다");
    }

    #[test]
    fn assign_project_on_unknown_tab_is_noop() {
        let mut reg = reg_with(&[("main", &[None])]);
        assert_eq!(reg.assign_project(9999, 5), None);
        assert_eq!(projects(&reg, "main"), vec![None]);
    }

    /// 활성 탭을 닫으면 오른쪽 이웃으로 넘어간다 (Chrome 과 같다).
    #[test]
    fn closing_active_tab_moves_to_right_neighbour() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
        let tabs = ids(&reg, "main");
        reg.activate(tabs[1]);
        let (label, project, empty) = reg.remove_tab(tabs[1]).unwrap();
        assert_eq!((label.as_str(), project, empty), ("main", Some(7), false));
        assert_eq!(reg.get("main").unwrap().active, Some(tabs[2]));
    }

    /// 오른쪽이 없으면 왼쪽으로.
    #[test]
    fn closing_last_active_tab_falls_back_left() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
        let tabs = ids(&reg, "main");
        reg.activate(tabs[1]);
        reg.remove_tab(tabs[1]);
        assert_eq!(reg.get("main").unwrap().active, Some(tabs[0]));
    }

    #[test]
    fn removing_the_only_tab_drops_the_window() {
        let mut reg = reg_with(&[("main", &[Some(3)])]);
        let tab = ids(&reg, "main")[0];
        assert_eq!(reg.remove_tab(tab), Some(("main".into(), Some(3), true)));
        assert!(reg.get("main").is_none());
        assert!(reg.all_open_projects().is_empty());
    }

    /// 시작 탭을 닫아도 정리할 프로젝트가 없다 (PTY·watcher 를 건드리면 안 된다).
    #[test]
    fn closing_a_start_tab_reports_no_project() {
        let mut reg = reg_with(&[("main", &[None, Some(3)])]);
        let start = ids(&reg, "main")[0];
        let (_, project, empty) = reg.remove_tab(start).unwrap();
        assert_eq!(project, None);
        assert!(!empty);
    }

    /// 낡은 목록이 와도 탭이 사라지거나 남의 탭이 끼어들지 않는다.
    #[test]
    fn reorder_filters_unknown_and_keeps_missing() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
        let t = ids(&reg, "main");
        assert!(reg.reorder("main", &[t[2], t[0], 9999]));
        assert_eq!(ids(&reg, "main"), vec![t[2], t[0], t[1]]);
    }

    #[test]
    fn reorder_reports_no_change_when_identical() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
        let t = ids(&reg, "main");
        assert!(!reg.reorder("main", &t));
        assert!(!reg.reorder("win-nope", &[1]));
    }

    /// 새 탭은 마지막으로 포커스된 창에 붙는다.
    #[test]
    fn preferred_window_follows_focus() {
        let mut reg = reg_with(&[("main", &[Some(3)]), ("win-1", &[Some(7)])]);
        reg.note_focus("win-1");
        assert_eq!(reg.preferred_window().as_deref(), Some("win-1"));
        // 그 창이 사라지면 남은 창 중 하나로 폴백한다 (유령 라벨 반환 금지).
        reg.windows.remove("win-1");
        assert_eq!(reg.preferred_window().as_deref(), Some("main"));
        reg.windows.remove("main");
        assert_eq!(reg.preferred_window(), None);
    }

    #[test]
    fn reserve_issues_monotonic_labels() {
        let mut reg = Registry::default();
        assert_eq!(reg.reserve(Some(3)), "win-1");
        assert_eq!(reg.reserve(None), "win-2");
        assert_eq!(reg.locate_project(3).unwrap().0, "win-1");
    }

    #[test]
    fn plain_window_url_has_only_label() {
        assert_eq!(window_url("win-2", None), "index.html?win=win-2");
    }

    #[test]
    fn deeplink_url_carries_view_and_entry() {
        let nav = crate::tray::TrayNavigate {
            view: "journal".into(),
            project_id: Some(3),
            entry_path: Some("journal/20260812/Bugs/0603_bug_a b.md".into()),
        };
        assert_eq!(
            window_url("win-1", Some(&nav)),
            "index.html?win=win-1&view=journal&entry=journal/20260812/Bugs/0603_bug_a%20b.md"
        );
    }

    /// `&` 가 그대로 새면 뒤 파라미터가 통째로 잘린다.
    #[test]
    fn query_encoding_escapes_separators_and_utf8() {
        assert_eq!(encode_query_value("a&b=c#d"), "a%26b%3Dc%23d");
        assert_eq!(encode_query_value("일지"), "%EC%9D%BC%EC%A7%80");
    }
}

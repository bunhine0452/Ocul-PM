//! v2.3.0 메뉴바 상주 — SSOT: docs/menubar/00-master-plan.md (D1~D5).
//!
//! D1 — 트레이 2상태: 유휴(정적) / 주의(점).
//! 아이콘은 번들 에셋 없이 **런타임에 RGBA 로 그린다** (동심원 로고 모티프).
//! macOS 템플릿 이미지 규약 — 검정+알파만 사용, `icon_as_template(true)`.
//!
//! **세션 활성 시 회전 애니메이션은 2026-08-12 에 제거했다** (사용자 요청).
//! 메뉴바에서 끊임없이 도는 아이콘은 정보량 대비 시선을 너무 많이 가져간다.
//! "세션이 돈다" 는 신호는 두 군데에 그대로 있다 — 팝오버의 "세션 N 활성"
//! 줄, 그리고 탭 스트립의 활동 점.
//!
//! D2 — 팝오버는 무장식 보조 창 1개(label `tray`)를 숨김 생성해 재사용.
//! 포커스 이탈 시 hide. 데이터 조회는 팝오버 프런트가 기존 커맨드로 직접
//! (D3 — 신규 집계 커맨드 없음, 폴링 없음).
//!
//! 세션 신호는 `oculpm-session-started/ended` 앱 이벤트 구독이 1차 입력이고,
//! 애니메이션이 도는 동안에는 세션 액터의 실제 상태를 주기적으로 재확인한다
//! (`reconcile_active`). `ended` 는 액터가 정상 종료될 때만 나오므로 —
//! 프로젝트를 닫거나 앱이 죽으면 유실된다 — 이벤트만 믿으면 활성 세션이
//! 없는데도 아이콘이 영원히 돈다.
//! 세션 0 이면 애니메이션 타이머가 스스로 멈춘다 — 유휴 전력 0 (§5).

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Listener, LogicalPosition, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const TRAY_WINDOW: &str = "tray";
const TRAY_ID: &str = "oculpm-tray";
/// 22pt @2x — macOS 메뉴바 표준 크기.
const SIZE: u32 = 44;
/// 창 크기 — 카드(344×484) + 사방 12px 투명 여백(CSS 그림자·라운드 코너용).
const POPOVER_W: f64 = 368.0;
const POPOVER_H: f64 = 508.0;
/// 세션 액터 조회 응답 대기 상한. 액터가 무거운 작업 중이면 늦게 답할 수
/// 있으므로, 넘기면 "모름"으로 두고 다음 회차에 다시 본다.
const RECONCILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// 팝오버 → 메인 창 딥링크 (D5). `view` 는 프런트 `UiV2View` 문자열.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TrayNavigate {
    pub view: String,
    pub project_id: Option<u32>,
    /// `.oculpm/` 상대 일지 경로 — 있으면 해당 일지를 연다.
    pub entry_path: Option<String>,
}

#[derive(Default)]
pub struct TrayState {
    /// `"{project_id}:{session_id}"` — 프로젝트를 가로지르는 활성 세션 집합.
    active: Mutex<HashSet<String>>,
    attention: AtomicBool,
    /// 최근 일지 알림 시각들 — git 백필처럼 일지가 몰릴 때 스로틀 (§아래).
    notified_at: Mutex<Vec<std::time::Instant>>,
}

impl TrayState {
    fn active_count(&self) -> usize {
        self.active.lock().map(|s| s.len()).unwrap_or(0)
    }
}

// ─── 아이콘 렌더 ─────────────────────────────────────────────────────────────

/// 브랜드 아크 모티프 (랜딩 `#arc-motif` 의 트레이판) — 완전한 동심원이
/// 아니라 **끊긴 호 3개**가 서로 다른 각도로 놓인다. 애니메이션은 반경
/// 펄스 대신 **호의 회전** — 위상 0.0~1.0 이 정확히 한 바퀴라 루프가
/// 심리스다. 링 반경별 부호를 엇갈려 서로 반대 방향으로 돈다.
struct Ring {
    r: f32,
    /// 호 폭 (px 반값).
    w: f32,
    /// 틈 중심각 (rad, 유휴 기준) — 랜딩 모티프의 rotate 값을 옮김.
    gap_at: f32,
    /// 틈 크기 (rad).
    gap: f32,
}

const ARCS: [Ring; 3] = [
    Ring { r: 6.2, w: 1.55, gap_at: 1.22, gap: 1.5 },
    Ring { r: 11.2, w: 1.55, gap_at: -0.70, gap: 1.25 },
    Ring { r: 16.2, w: 1.55, gap_at: 2.18, gap: 1.05 },
];

/// 각도 차 (rad) 를 [-π, π] 로 정규화한 절대값.
fn ang_dist(a: f32, b: f32) -> f32 {
    let mut d = (a - b) % std::f32::consts::TAU;
    if d > std::f32::consts::PI {
        d -= std::f32::consts::TAU;
    }
    if d < -std::f32::consts::PI {
        d += std::f32::consts::TAU;
    }
    d.abs()
}

/// 서브픽셀 하나의 알파 (0..1).
fn sample_alpha(fx: f32, fy: f32, attention: bool) -> f32 {
    let c = (SIZE as f32) / 2.0;
    let dx = fx - c;
    let dy = fy - c;
    let d = (dx * dx + dy * dy).sqrt();
    let ang = dy.atan2(dx);
    let mut a = 0.0f32;

    for arc in ARCS.iter() {
        let radial = (arc.r - d).abs();
        if radial >= arc.w + 0.8 {
            continue;
        }
        // 반경 방향 소프트 엣지.
        let ra = (1.0 - (radial / arc.w).powi(2)).clamp(0.0, 1.0);
        // 각도 방향 — 틈 밖이면 1, 틈 가장자리는 픽셀 단위 페더.
        // 회전 항(`arc.dir * TAU * phase`)은 애니메이션과 함께 제거했다.
        let rot = arc.gap_at;
        let half_gap = arc.gap / 2.0;
        let feather = 1.4 / arc.r; // 호 끝 라운딩 ≈ 1.4px
        let aa = ((ang_dist(ang, rot) - half_gap) / feather).clamp(0.0, 1.0);
        a = a.max(ra * aa);
    }

    // 중심점.
    if d < 2.5 {
        a = a.max((1.0 - (d / 2.5).powi(4)).clamp(0.0, 1.0));
    }

    if attention {
        // 우상단 점 — 템플릿(실루엣)이라 색 대신 형태로 구분.
        let ad = ((fx - (SIZE as f32 - 6.5)).powi(2) + (fy - 6.5).powi(2)).sqrt();
        if ad < 4.0 {
            a = a.max((1.0 - (ad / 4.0).powi(6)).clamp(0.0, 1.0));
        }
    }
    a
}

/// 아이콘을 그린다. 2×2 슈퍼샘플링 — 22pt 크기에서 호 가장자리가 또렷하게.
/// 상태는 `attention` 하나뿐이다 (회전 애니메이션 제거 후).
fn render_icon(attention: bool) -> Image<'static> {
    let s = SIZE as usize;
    let mut buf = vec![0u8; s * s * 4];
    for y in 0..s {
        for x in 0..s {
            let mut acc = 0.0f32;
            for (ox, oy) in [(0.25f32, 0.25f32), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                acc += sample_alpha(x as f32 + ox, y as f32 + oy, attention);
            }
            let px = (y * s + x) * 4;
            buf[px] = 0;
            buf[px + 1] = 0;
            buf[px + 2] = 0;
            buf[px + 3] = ((acc / 4.0).clamp(0.0, 1.0) * 255.0) as u8;
        }
    }
    Image::new_owned(buf, SIZE, SIZE)
}

fn set_tray_icon(app: &AppHandle, img: Image<'static>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(img));
        // set_icon 이후에도 템플릿 플래그 유지 (다크 메뉴바 대응).
        let _ = tray.set_icon_as_template(true);
    }
}

fn set_idle_icon(app: &AppHandle, attention: bool) {
    set_tray_icon(app, render_icon(attention));
}

// ─── 활성 세션 재확인 ────────────────────────────────────────────────────────

/// `"{project_id}:{session_id}"` 키에서 project_id 를 뽑는다.
fn project_id_of(key: &str) -> Option<u32> {
    key.split(':').next()?.parse().ok()
}

/// 트레이가 기억하는 활성 세션 집합을 **세션 액터의 실제 상태**와 맞추고,
/// 남은 활성 세션 수를 돌려준다.
///
/// `oculpm-session-ended` 는 액터가 스스로 finalize 할 때만 나온다. 프로젝트를
/// 닫거나(액터 drop) 앱이 비정상 종료하면 이벤트 없이 세션이 사라지므로,
/// 이벤트만 구독하면 활성 세션이 0 인데도 아이콘이 계속 돈다. 여기서 프로젝트
/// 별로 실제 상태를 물어 유령 키를 걷어낸다.
async fn reconcile_active(app: &AppHandle, state: &Arc<TrayState>) -> usize {
    let Some(manager) = app.try_state::<crate::oculpm::manager::OculpmManager>() else {
        return state.active_count();
    };
    let known: HashSet<String> = match state.active.lock() {
        Ok(set) => set.clone(),
        Err(_) => return 0,
    };
    let mut project_ids: Vec<u32> = known.iter().filter_map(|k| project_id_of(k)).collect();
    project_ids.sort_unstable();
    project_ids.dedup();

    let mut keep: HashSet<String> = HashSet::new();
    for pid in project_ids {
        match tokio::time::timeout(RECONCILE_TIMEOUT, manager.get_current_session(pid)).await {
            // 살아 있는 세션은 프로젝트당 최대 1개 — 그 키만 남긴다.
            Ok(Ok(Some(session))) => {
                keep.insert(format!("{}:{}", pid, session.id));
            }
            // 유휴(None) 이거나 액터·프로젝트가 사라짐(Err) → 이 프로젝트는 비활성.
            Ok(_) => {}
            Err(_) => {
                tracing::debug!(target: "tray", project_id = pid, "세션 상태 조회 시간초과 — 판단 보류");
                keep.extend(
                    known
                        .iter()
                        .filter(|k| project_id_of(k) == Some(pid))
                        .cloned(),
                );
            }
        }
    }

    let Ok(mut set) = state.active.lock() else {
        return 0;
    };
    // 조회하는 동안 새로 시작된 세션(known 에 없던 키)은 건드리지 않는다.
    set.retain(|k| keep.contains(k) || !known.contains(k));
    set.len()
}

// ─── 세션·주의 신호 구독 ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SessionEventPayload {
    project_id: u32,
    session: SessionIdOnly,
}

#[derive(Deserialize)]
struct SessionIdOnly {
    id: String,
}

fn listen_signals(app: &AppHandle, state: Arc<TrayState>) {
    // 이벤트 이름은 tauri-specta 가 bindings.ts 에 내보내는 kebab 이름과 동일
    // (예: OculpmSessionStarted → "oculpm-session-started").
    {
        let (app, state) = (app.clone(), state.clone());
        app.clone().listen("oculpm-session-started", move |event| {
            if let Ok(p) = serde_json::from_str::<SessionEventPayload>(event.payload()) {
                if let Ok(mut set) = state.active.lock() {
                    set.insert(format!("{}:{}", p.project_id, p.session.id));
                }
                // 회전 애니메이션은 제거됐다 — 활성 집합만 갱신한다.
            }
        });
    }
    {
        let state = state.clone();
        app.clone().listen("oculpm-session-ended", move |event| {
            if let Ok(p) = serde_json::from_str::<SessionEventPayload>(event.payload()) {
                if let Ok(mut set) = state.active.lock() {
                    set.remove(&format!("{}:{}", p.project_id, p.session.id));
                }
                // 0 이 되면 애니메이션 태스크가 다음 tick 에 스스로 멈춘다.
            }
        });
    }
    {
        let (app, state) = (app.clone(), state.clone());
        app.clone().listen("oculpm-integrity-warning", move |_| {
            state.attention.store(true, Ordering::Relaxed);
            set_idle_icon(&app, true);
        });
    }
    {
        let (app, state) = (app.clone(), state.clone());
        app.clone().listen("oculpm-journal-added", move |event| {
            if let Ok(p) = serde_json::from_str::<JournalAddedPayload>(event.payload()) {
                notify_journal_added(&app, &state, p);
            }
        });
    }
}

// ─── 새 일지 네이티브 알림 (옵인) ────────────────────────────────────────────

#[derive(Deserialize)]
struct JournalAddedPayload {
    project_id: u32,
    summary: JournalSummaryLite,
}

#[derive(Deserialize)]
struct JournalSummaryLite {
    title: String,
    #[serde(rename = "type")]
    entry_type: String,
    agent_id: String,
}

fn type_label(t: &str) -> &str {
    match t {
        "feature" => "기능",
        "bug" => "버그",
        "error" => "에러",
        "refactor" => "리팩토링",
        "chore" => "잡일",
        other => other,
    }
}

/// 새 일지 → macOS 알림. git 백필·재인덱싱처럼 일지가 몰릴 때 알림 폭탄을
/// 막기 위해 10초 창에 3건을 넘으면 조용히 버린다 (제목까지 봤다면 이미
/// 팝오버·앱이 더 나은 표면이다).
fn notify_journal_added(app: &AppHandle, state: &Arc<TrayState>, p: JournalAddedPayload) {
    let db = app.state::<crate::db::Db>();
    let enabled =
        tauri::async_runtime::block_on(setting_on(&db, SETTING_NOTIFY_JOURNAL, false));
    if !enabled {
        return;
    }
    {
        let Ok(mut times) = state.notified_at.lock() else { return };
        let now = std::time::Instant::now();
        times.retain(|t| now.duration_since(*t).as_secs() < 10);
        if times.len() >= 3 {
            return;
        }
        times.push(now);
    }
    let project = tauri::async_runtime::block_on(db.get_project(p.project_id))
        .map(|pr| pr.name)
        .unwrap_or_else(|_| "프로젝트".to_string());
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(format!("{project} — 새 일지"))
        .body(format!(
            "[{}] {} · {}",
            type_label(&p.summary.entry_type),
            p.summary.title,
            p.summary.agent_id
        ))
        .show();
}

// ─── 팝오버 창 (D2) ──────────────────────────────────────────────────────────

fn create_popover(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW,
        WebviewUrl::App("index.html?tray=1".into()),
    )
    .title("Ocul-PM")
    .inner_size(POPOVER_W, POPOVER_H)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    // 라운드 코너는 CSS 가 그린다 — 창은 투명 캔버스(macOSPrivateApi)이고
    // 시스템 그림자는 사각 프레임을 다시 드러내므로 끈다.
    .transparent(true)
    .shadow(false)
    .build()?;
    let w = win.clone();
    win.on_window_event(move |ev| {
        if let tauri::WindowEvent::Focused(false) = ev {
            let _ = w.hide();
        }
    });
    Ok(win)
}

fn popover(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(TRAY_WINDOW)
        .or_else(|| create_popover(app).ok())
}

fn toggle_popover(app: &AppHandle, state: &Arc<TrayState>, click: tauri::PhysicalPosition<f64>) {
    // 팝오버 열람 = 주의 확인으로 간주 (D1).
    if state.attention.swap(false, Ordering::Relaxed) {
        set_idle_icon(app, false);
    }
    // 유령 세션 정리 — 아이콘은 이제 안 돌지만, 활성 집합이 계속 부풀면 주의
    // 신호 판정이 어긋난다. 여는 순간 한 번 실제 상태와 대조한다.
    {
        let (app, state) = (app.clone(), state.clone());
        tauri::async_runtime::spawn(async move {
            reconcile_active(&app, &state).await;
        });
    }
    let Some(win) = popover(app) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    // 배치: 클릭 x 를 중심으로 메뉴바 바로 아래. 실측 로그 (PR-MB0 스파이크).
    let scale = win.scale_factor().unwrap_or(2.0);
    tracing::debug!(target: "tray", ?click, scale, "tray click position");
    let mut x = click.x / scale - POPOVER_W / 2.0;
    // 메뉴바(~25pt) 아래에서 시작 — 시스템이 메뉴바 위 배치를 거부할 수
    // 있으므로 겹치지 않게. 창 상단 12px 는 투명 여백이라 카드의 시각적
    // 간격은 메뉴바로부터 ~17px.
    let y = 30.0;
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let mw = monitor.size().width as f64 / monitor.scale_factor();
        x = x.clamp(8.0, (mw - POPOVER_W - 8.0).max(8.0));
    }
    let _ = win.set_position(tauri::Position::Logical(LogicalPosition { x, y }));
    let _ = win.show();
    let _ = win.set_focus();
    // 프런트 재조회 트리거 — 열릴 때만 데이터를 당긴다 (폴링 없음).
    let _ = tauri::Emitter::emit_to(app, TRAY_WINDOW, "tray-popover-shown", ());
}

// ─── 상주 설정 (D4) ──────────────────────────────────────────────────────────

pub const SETTING_SHOW_ICON: &str = "tray.show_icon"; // 기본 on ("0" 일 때만 숨김)
pub const SETTING_KEEP_RUNNING: &str = "tray.keep_running"; // 기본 off
pub const SETTING_HIDE_DOCK: &str = "tray.hide_dock"; // 기본 off
pub const SETTING_NOTIFY_JOURNAL: &str = "tray.notify_journal"; // 기본 off

async fn setting_on(db: &crate::db::Db, key: &str, default_on: bool) -> bool {
    match db.settings_get(key.to_string()).await {
        Ok(Some(v)) => v == "1",
        _ => default_on,
    }
}

/// 설정 변경 후 트레이에 반영 (아이콘 표시/숨김). 설정 UI 가 부른다.
pub async fn apply_settings(app: &AppHandle) {
    let db = app.state::<crate::db::Db>();
    let show = setting_on(&db, SETTING_SHOW_ICON, true).await;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(show);
    }
}

/// 마지막 창을 닫을 때의 판정 — 순수 함수라 창 런타임 없이 단위 테스트한다.
///
/// 상주 옵인 전의 ⌘W 계약: 마지막 창을 닫으면 앱이 종료된다. 숨겨진 트레이
/// 팝오버 창이 살아 있어 Tauri 의 "마지막 창 닫힘 → 종료" 가 자연 발화하지
/// 않으므로 명시적으로 판정한다. 창이 더 남아 있으면 당연히 종료하지 않는다
/// — 작업 중인 다른 창을 죽이는 참사(R1)를 막는 자리다.
pub fn should_exit_on_last_window_close(remaining_windows: usize, keep_running: bool) -> bool {
    remaining_windows == 0 && !keep_running
}

/// 마지막 앱 창이 닫혔다. `true` 를 돌려주면 닫기를 가로챈 것(트레이 상주).
pub fn handle_last_window_closed(app: &AppHandle, label: &str) -> bool {
    let db = app.state::<crate::db::Db>();
    let keep = tauri::async_runtime::block_on(setting_on(&db, SETTING_KEEP_RUNNING, false));
    if should_exit_on_last_window_close(0, keep) {
        app.exit(0);
        return false;
    }
    // 상주 모드 — 창을 닫는 대신 숨겨 두면 다음 "열기" 가 즉시 뜬다.
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.hide();
    }
    #[cfg(target_os = "macos")]
    {
        let hide_dock =
            tauri::async_runtime::block_on(setting_on(&db, SETTING_HIDE_DOCK, false));
        if hide_dock {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    true
}

/// 앱 창을 앞으로 (트레이 메뉴 "열기"). 없으면 시작 탭으로 하나 만든다.
pub fn show_main(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::window::focus_or_open_window(&handle).await;
    });
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

pub fn init(app: &tauri::App) -> tauri::Result<()> {
    let state = Arc::new(TrayState::default());
    app.manage(state.clone());

    let open_item = MenuItemBuilder::with_id("tray-open", "Ocul-PM 열기").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray-quit", "Ocul-PM 종료").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .separator()
        .item(&quit_item)
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(render_icon(false))
        .icon_as_template(true)
        .tooltip("Ocul-PM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event({
            let state = state.clone();
            move |tray, event| match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => toggle_popover(tray.app_handle(), &state, position),
                // 더블클릭 = 팝오버 닫기 (앱 열기 아님 — 실기기 피드백).
                // macOS 는 Click(→팝오버 열림) 후 DoubleClick 이 이어지므로
                // 여기서 숨기면 더블클릭의 순효과가 "닫힘"이 된다.
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    if let Some(win) = tray.app_handle().get_webview_window(TRAY_WINDOW) {
                        let _ = win.hide();
                    }
                }
                _ => {}
            }
        })
        .build(app)?;

    listen_signals(app.handle(), state);
    // 첫 클릭이 빠르도록 팝오버를 미리 (숨김) 생성 — 실패해도 클릭 시 재시도.
    let _ = create_popover(app.handle());
    // 저장된 설정 반영 (아이콘 숨김 옵션).
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move { apply_settings(&handle).await });
    Ok(())
}

// ─── 커맨드 ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn tray_open_main(app: AppHandle, nav: Option<TrayNavigate>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(TRAY_WINDOW) {
        let _ = win.hide();
    }

    // 프로젝트가 지정된 딥링크는 **그 프로젝트의 탭**으로 간다 (T5). 예전처럼
    // 전역 emit 을 하면 열려 있는 모든 창이 남의 일지로 점프한다.
    let Some(project_id) = nav.as_ref().and_then(|n| n.project_id) else {
        crate::commands::window::focus_or_open_window(&app).await?;
        return Ok(());
    };
    let nav = nav.expect("project_id 를 꺼냈으므로 nav 는 Some");

    // 탭을 열거나(없으면) 활성화하고(있으면) 그 창에만 목적지를 전달한다.
    // 갓 만든 창은 아직 리스너가 없어 emit 이 유실되므로, 그 경우 커맨드가
    // 목적지를 URL 에 실어 보낸다.
    crate::commands::window::open_project_tab_with_nav(&app, project_id, None, Some(&nav)).await
}

#[tauri::command]
#[specta::specta]
pub async fn tray_hide_popover(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(TRAY_WINDOW) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 설정 UI 가 토글 저장 직후 호출 — 아이콘 표시/숨김 즉시 반영.
#[tauri::command]
#[specta::specta]
pub async fn tray_apply_settings(app: AppHandle) -> Result<(), String> {
    apply_settings(&app).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_template_black_with_alpha() {
        {
            for attention in [false, true] {
                let img = render_icon(attention);
                let rgba = img.rgba();
                assert_eq!(rgba.len(), (SIZE * SIZE * 4) as usize);
                let mut any_alpha = false;
                for px in rgba.chunks_exact(4) {
                    assert_eq!((px[0], px[1], px[2]), (0, 0, 0), "템플릿은 검정만");
                    if px[3] > 0 {
                        any_alpha = true;
                    }
                }
                assert!(any_alpha, "빈 아이콘 방지");
            }
        }
    }

    #[test]
    fn attention_dot_changes_top_right_region() {
        let plain = render_icon(false);
        let attn = render_icon(true);
        assert_ne!(plain.rgba(), attn.rgba(), "주의 점이 실제로 그려져야 함");
    }

    #[test]
    fn project_id_parses_from_active_key() {
        // 세션 id 에도 '-' 와 숫자가 섞이지만 project_id 는 첫 ':' 앞 전부.
        assert_eq!(project_id_of("7:20260730-001"), Some(7));
        assert_eq!(project_id_of("12:20260730-042"), Some(12));
        assert_eq!(project_id_of("nope:20260730-001"), None);
        assert_eq!(project_id_of(""), None);
    }

    /// R1 — 창 하나를 닫았다고 작업 중인 다른 창이 죽으면 안 된다.
    #[test]
    fn exits_only_when_no_window_remains() {
        // 남은 창이 없으면 옛 계약 그대로: 닫기 = 종료.
        assert!(should_exit_on_last_window_close(0, false));
        // 상주 설정 ON — 종료하지 않고 숨긴다 (기존 동작).
        assert!(!should_exit_on_last_window_close(0, true));
        // R1 — 창이 남아 있으면 무슨 일이 있어도 종료하지 않는다.
        assert!(!should_exit_on_last_window_close(3, false));
        assert!(!should_exit_on_last_window_close(3, true));
        assert!(!should_exit_on_last_window_close(1, false));
    }

    /// 회전 애니메이션 제거 회귀 방지 — 아이콘은 **입력이 같으면 언제나 같다**.
    /// 위상 인자가 다시 생기면 이 테스트가 컴파일부터 깨진다.
    #[test]
    fn icon_is_deterministic_and_static() {
        assert_eq!(render_icon(false).rgba(), render_icon(false).rgba());
        assert_eq!(render_icon(true).rgba(), render_icon(true).rgba());
    }
}

//! v2.3.0 메뉴바 상주 — SSOT: docs/menubar/00-master-plan.md (D1~D5).
//!
//! D1 — 트레이 3상태: 유휴(정적) / 세션 활성(펄스 애니메이션) / 주의(점).
//! 아이콘은 번들 에셋 없이 **런타임에 RGBA 로 그린다** (동심원 로고 모티프).
//! macOS 템플릿 이미지 규약 — 검정+알파만 사용, `icon_as_template(true)`.
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
use tauri_specta::Event;

pub const TRAY_WINDOW: &str = "tray";
const TRAY_ID: &str = "oculpm-tray";
/// 22pt @2x — macOS 메뉴바 표준 크기.
const SIZE: u32 = 44;
/// 창 크기 — 카드(344×484) + 사방 12px 투명 여백(CSS 그림자·라운드 코너용).
const POPOVER_W: f64 = 368.0;
const POPOVER_H: f64 = 508.0;
/// 애니메이션 프레임 수·주기 (사전 렌더 — 런타임 드로잉은 시작 시 1회).
/// 한 사이클 = 호가 한 바퀴 (12×160ms ≈ 1.9초/회전, 심리스 루프).
const PULSE_FRAMES: usize = 12;
const PULSE_TICK_MS: u64 = 160;
/// 애니메이션이 도는 동안 실제 세션 상태를 다시 확인하는 주기 (프레임 수).
/// 30 × 160ms ≈ 4.8초 — `ended` 이벤트를 통째로 놓쳐도 이 안에 멈춘다.
const RECONCILE_EVERY: usize = 30;
/// 세션 액터 조회 응답 대기 상한. 액터가 무거운 작업 중이면 늦게 답할 수
/// 있으므로, 넘기면 "모름"으로 두고 다음 회차에 다시 본다 (섣부른 정지 방지).
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
    animating: AtomicBool,
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
    /// 회전 방향 (+1/-1).
    dir: f32,
}

const ARCS: [Ring; 3] = [
    Ring { r: 6.2, w: 1.55, gap_at: 1.22, gap: 1.5, dir: 1.0 },
    Ring { r: 11.2, w: 1.55, gap_at: -0.70, gap: 1.25, dir: -1.0 },
    Ring { r: 16.2, w: 1.55, gap_at: 2.18, gap: 1.05, dir: 1.0 },
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
fn sample_alpha(fx: f32, fy: f32, pulse: Option<f32>, attention: bool) -> f32 {
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
        let rot = match pulse {
            Some(p) => arc.gap_at + arc.dir * std::f32::consts::TAU * p,
            None => arc.gap_at,
        };
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

/// 한 프레임을 그린다. `pulse` 는 0.0~1.0 위상 (None = 유휴 정적).
/// 2×2 슈퍼샘플링 — 22pt 크기에서 호 가장자리가 또렷하게.
fn render_frame(pulse: Option<f32>, attention: bool) -> Image<'static> {
    let s = SIZE as usize;
    let mut buf = vec![0u8; s * s * 4];
    for y in 0..s {
        for x in 0..s {
            let mut acc = 0.0f32;
            for (ox, oy) in [(0.25f32, 0.25f32), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                acc += sample_alpha(x as f32 + ox, y as f32 + oy, pulse, attention);
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
    set_tray_icon(app, render_frame(None, attention));
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

// ─── 애니메이션 (D1 — 세션 활성 시에만) ──────────────────────────────────────

fn start_animation(app: &AppHandle, state: &Arc<TrayState>) {
    if state.animating.swap(true, Ordering::SeqCst) {
        return; // 이미 도는 중
    }
    // 프레임 사전 렌더 — 루프 안에서는 픽셀 계산 없음.
    let frames: Vec<Image<'static>> = (0..PULSE_FRAMES)
        .map(|i| render_frame(Some(i as f32 / PULSE_FRAMES as f32), false))
        .collect();
    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut i = 0usize;
        loop {
            // 이벤트만 믿지 않는다 — 주기적으로 액터의 실제 상태와 대조해
            // 유령 세션을 걷어낸다. i == 0 은 방금 온 started 이벤트라 건너뛴다.
            let remaining = if i > 0 && i.is_multiple_of(RECONCILE_EVERY) {
                reconcile_active(&app, &state).await
            } else {
                state.active_count()
            };
            if remaining == 0 {
                break;
            }
            set_tray_icon(&app, frames[i % PULSE_FRAMES].clone());
            i += 1;
            tokio::time::sleep(std::time::Duration::from_millis(PULSE_TICK_MS)).await;
        }
        state.animating.store(false, Ordering::SeqCst);
        set_idle_icon(&app, state.attention.load(Ordering::Relaxed));
    });
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
                start_animation(&app, &state);
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
            if !state.animating.load(Ordering::SeqCst) {
                set_idle_icon(&app, true);
            }
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
    if state.attention.swap(false, Ordering::Relaxed) && !state.animating.load(Ordering::SeqCst) {
        set_idle_icon(app, false);
    }
    // 팝오버는 디스크의 세션 목록을 직접 읽어 "지금 활성 세션 없음" 을 보여준다.
    // 아이콘이 계속 돌면 둘이 어긋나 보이므로, 여는 순간 한 번 맞춘다. 활성이
    // 0 이 되면 애니메이션 루프가 다음 tick(160ms) 에 스스로 멈춘다.
    {
        let (app, state) = (app.clone(), state.clone());
        tauri::async_runtime::spawn(async move {
            if reconcile_active(&app, &state).await == 0
                && !state.animating.load(Ordering::SeqCst)
            {
                set_idle_icon(&app, state.attention.load(Ordering::Relaxed));
            }
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

/// 메인 창 닫기 = 트레이로 최소화 (옵인). CloseRequested 훅에서 호출.
/// true 를 돌려주면 닫기를 가로챈 것.
pub fn handle_main_close_requested(app: &AppHandle) -> bool {
    let db = app.state::<crate::db::Db>();
    let keep = tauri::async_runtime::block_on(setting_on(&db, SETTING_KEEP_RUNNING, false));
    if !keep {
        // 상주 옵인 전의 ⌘W 계약 유지: 메인 창 닫기 = 앱 종료. 숨겨진 트레이
        // 팝오버 창이 살아 있어 "마지막 창 닫힘 → 종료" 가 자연 발화하지
        // 않으므로 명시적으로 종료한다 (graceful — 락 해제 경로 동일).
        app.exit(0);
        return false;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
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

/// 메인 창 표시 + 포커스 (트레이 메뉴·팝오버 딥링크 공용).
pub fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
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
        .icon(render_frame(None, false))
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
    show_main(&app);
    if let Some(nav) = nav {
        nav.emit(&app).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        for pulse in [None, Some(0.3)] {
            for attention in [false, true] {
                let img = render_frame(pulse, attention);
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
        let plain = render_frame(None, false);
        let attn = render_frame(None, true);
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

    #[test]
    fn pulse_frames_differ_across_phase() {
        let a = render_frame(Some(0.0), false);
        let b = render_frame(Some(0.5), false);
        assert_ne!(a.rgba(), b.rgba());
    }
}

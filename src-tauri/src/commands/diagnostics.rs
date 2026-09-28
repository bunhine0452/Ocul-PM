use serde::Serialize;
use tauri::State;

use crate::db::{Db, DbHealth};

mod platform;

#[tauri::command]
#[specta::specta]
pub async fn db_health(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.health().await.map_err(|e| e.to_string())
}

/// 빈 페이지 회수 + WAL 절단(VACUUM). 몇 초 걸리고 그동안 다른 DB 호출은
/// 줄을 서므로 사용자가 진단 탭에서 직접 누른다. 끝난 뒤의 크기를 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn db_compact(db: State<'_, Db>) -> Result<DbHealth, String> {
    db.compact().await.map_err(|e| e.to_string())?;
    db.health().await.map_err(|e| e.to_string())
}

/// 「진단 정보 복사」 한 벌 (#w5-report). 베타 버그 리포트에 그대로 붙는다 —
/// 비밀·계정·호스트명은 싣지 않고, 경로 속 홈(사용자 이름)은 `~` 로 가린다.
/// 설치 형식은 L-UPD 의 설치 형식 커맨드가 따로 준다 (프런트가 합친다).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiagnosticsReport {
    pub app_version: String,
    /// `macos` · `windows` · `linux` (`std::env::consts::OS`).
    pub os: String,
    /// 사람이 읽는 OS 판 — 못 읽으면 `None`.
    pub os_version: Option<String>,
    /// `x86_64` · `aarch64`.
    pub arch: String,
    /// `WebView2 …` · `WebKitGTK …`. macOS 는 OS 에 딸린 WKWebView 라 `None`.
    pub webview: Option<String>,
    /// Linux 데스크톱 세션 (`wayland · GNOME`).
    pub session: Option<String>,
    /// 시스템 시간대 — 새 `.oculpm` 설정의 workday 기본값과 같다.
    pub timezone: String,
    /// 로그 폴더 (`~` 로 가림). 파일 로그가 꺼진 실행이면 `None`.
    pub log_dir: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn diagnostics_report() -> Result<DiagnosticsReport, String> {
    let home = directories::BaseDirs::new().map(|b| b.home_dir().to_path_buf());
    Ok(DiagnosticsReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        os_version: platform::os_version(),
        arch: std::env::consts::ARCH.to_string(),
        webview: platform::webview(),
        session: platform::session(),
        timezone: crate::oculpm::config::default_timezone(),
        log_dir: crate::log_dir().map(|p| platform::tilde_home(p, home.as_deref())),
    })
}

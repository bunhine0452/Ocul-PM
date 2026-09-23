//! 터미널 셸 통합 설치/제거 커맨드 (설정 → 터미널).
//!
//! 사용자 rc(`~/.zshrc`·`~/.bashrc`)를 건드리는 유일한 경로다. **자동 설치는
//! 절대 하지 않는다** — 남의 dotfile 을 묻지 않고 고치는 것은 되돌리기 어려운
//! 변경이므로, 설정 화면의 명시적 버튼에서만 불린다.
//!
//! 실제 로직은 전부 [`crate::oculpm::shell_integration`] 에 있고(순수 함수 +
//! 단위 테스트), 여기서는 홈/앱데이터 경로만 해결해 넘긴다.

use tauri::Manager;

use crate::oculpm::shell_integration::{self, ShellIntegrationStatus};

/// 홈 디렉터리와 앱 데이터 디렉터리를 함께 해결한다.
fn dirs(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("Could not find the home directory: {e}"))?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app data directory: {e}"))?;
    Ok((home, data))
}

/// 현재 설치 상태를 읽는다. 파일을 만들거나 고치지 않는다.
#[tauri::command]
#[specta::specta]
pub fn shell_integration_status(app: tauri::AppHandle) -> Result<ShellIntegrationStatus, String> {
    let (home, data) = dirs(&app)?;
    Ok(shell_integration::status(
        &home,
        &data,
        &shell_integration::current_shell(),
    ))
}

/// rc 에 관리 블록을 심는다 (멱등). 갱신된 상태를 그대로 돌려줘 UI 가 한 번 더
/// 조회하지 않아도 되게 한다.
// `async` — 메인 스레드에서 돌지 않게. PowerShell 은 설치 전에 실행 정책을 셸에
// 물어보는데(보통 1초 안팎, 최악 시한 45초 × 재시도 1회), 동기 커맨드면 그동안
// UI 가 멈춘다 (크로스플랫폼 L-SHELL). 메인 스레드 전용 API 는 쓰지 않는다.
#[tauri::command(async)]
#[specta::specta]
pub fn shell_integration_install(app: tauri::AppHandle) -> Result<ShellIntegrationStatus, String> {
    let (home, data) = dirs(&app)?;
    let shell = shell_integration::current_shell();
    shell_integration::install(&home, &data, &shell).map_err(|e| e.to_string())?;
    Ok(shell_integration::status(&home, &data, &shell))
}

/// rc 에서 관리 블록을 걷어낸다 (없으면 no-op).
#[tauri::command]
#[specta::specta]
pub fn shell_integration_uninstall(
    app: tauri::AppHandle,
) -> Result<ShellIntegrationStatus, String> {
    let (home, data) = dirs(&app)?;
    let shell = shell_integration::current_shell();
    shell_integration::uninstall(&home, &shell).map_err(|e| e.to_string())?;
    Ok(shell_integration::status(&home, &data, &shell))
}

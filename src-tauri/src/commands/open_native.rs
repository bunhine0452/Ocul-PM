//! OS 기본 앱/오프너로 경로·URL 을 여는 얇은 셸아웃 (`open` / `xdg-open` / `start`).
//!
//! `oculpm_open_entry_in_editor` 가 opener-scope 회귀를 세 번 겪고 백엔드가
//! 절대경로를 직접 셸아웃해 여는 전용 경로로 만든 것 — 여기로 옮긴 것은
//! 자리뿐이다 (commands/oculpm.rs 의 800줄 래칫). `vscode://` 같은 커스텀
//! 스킴은 `open_url` 의 http(s) 화이트리스트 밖이라 `open_native_url` 로 간다.

/// 커스텀 스킴 URL(`vscode://…`)을 OS 오프너로 — `open_native` 와 같은 명령
/// (`open` / `xdg-open` / `start`)이 URL 도 받는다. http(s) 가 아니므로
/// `open_url` 의 화이트리스트 밖이라 따로 둔다.
pub(super) fn open_native_url(url: &str) -> std::io::Result<()> {
    open_native(std::path::Path::new(url))
}

#[cfg(target_os = "macos")]
pub(super) fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    crate::proc::std_cmd("open")
        .arg(path)
        .status()
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err(std::io::Error::other(format!("open exited with {s}")))
            }
        })
}

#[cfg(target_os = "linux")]
pub(super) fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    crate::proc::std_cmd("xdg-open")
        .arg(path)
        .status()
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err(std::io::Error::other(format!("xdg-open exited with {s}")))
            }
        })
}

#[cfg(target_os = "windows")]
pub(super) fn open_native(path: &std::path::Path) -> std::io::Result<()> {
    shell_open(path.as_os_str())
}

/// Windows — 셸(`cmd`)을 거치지 않고 ShellExecuteExW 로 연다 (opener 플러그인의
/// 함수, 스코프 설정과 무관한 Rust 쪽 호출이다).
///
/// 예전엔 `cmd /c start "" <대상>` 이었다. cmd 는 따옴표 밖의 `&`·`|`·`^` 를
/// 명령 구분자로 읽는다 — `vscode://…?entry=a&b` 나 `C:\Users\A&B\…` 는 거기서
/// 끊기고 **뒤쪽이 명령으로 실행**됐다. std 는 공백이 없는 인자를 따옴표로
/// 감싸지 않으므로 그 자리는 그대로 열려 있었다.
#[cfg(target_os = "windows")]
pub(crate) fn shell_open(target: &std::ffi::OsStr) -> std::io::Result<()> {
    tauri_plugin_opener::open_url(target.to_string_lossy(), None::<&str>)
        .map_err(|e| std::io::Error::other(e.to_string()))
}

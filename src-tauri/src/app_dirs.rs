//! `AppHandle` 없이 앱 데이터 폴더를 구하는 단일 창구.
//!
//! GUI 는 Tauri 의 `app_data_dir()` 을 쓴다 — **OS 데이터 폴더 + 번들 식별자**
//! (`dirs::data_dir()/com.kimhyunbin.ocul-pm`). 그런데 AppHandle 이 없는 세 자리
//! (로그 설정 · `ocul-pm config` CLI · MCP 일지 검색 캐시)는 예전에
//! `directories::ProjectDirs::from("com","kimhyunbin","ocul-pm")` 로 구했다. 그 둘은
//! **macOS 에서만** 같은 폴더다:
//!
//! | OS | ProjectDirs | Tauri `app_data_dir` |
//! |---|---|---|
//! | macOS | `~/Library/Application Support/com.kimhyunbin.ocul-pm` | 같음 |
//! | Windows | `%APPDATA%\kimhyunbin\ocul-pm\data` | `%APPDATA%\com.kimhyunbin.ocul-pm` |
//! | Linux | `~/.local/share/ocul-pm` | `~/.local/share/com.kimhyunbin.ocul-pm` |
//!
//! 그래서 Windows·Linux 에서 CLI 가 GUI 와 **다른 DB** 를 열고, 로그가 딴 폴더에
//! 쌓이고, MCP 일지 검색이 앱 캐시를 못 찾아 디스크 스캔으로 내려갔다
//! (크로스플랫폼 라운드 #paths-projectdirs-mismatch, L-PTY2 발견). 이제 셋 다
//! Tauri 와 같은 규칙으로 여기서 구한다 — macOS 는 같은 경로라 동작 불변.

use std::path::PathBuf;

/// `tauri.conf.json` 의 `identifier` — 테스트가 그 파일과 대조한다.
pub const BUNDLE_IDENTIFIER: &str = "com.kimhyunbin.ocul-pm";

/// Tauri `app_data_dir()` 과 같은 폴더. 홈을 못 구하면 `None`.
pub fn app_data_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.data_dir().join(BUNDLE_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 식별자가 번들 설정과 어긋나면 GUI 와 다른 폴더를 가리킨다.
    #[test]
    fn identifier_matches_the_bundle_config() {
        let conf = include_str!("../tauri.conf.json");
        let json: serde_json::Value = serde_json::from_str(conf).expect("tauri.conf.json");
        assert_eq!(json["identifier"], BUNDLE_IDENTIFIER);
    }

    /// macOS 는 예전(`ProjectDirs`)과 **같은 경로**여야 한다 — 기존 사용자의 DB·로그가
    /// 그 자리에 있다 (크로스플랫폼 D3: macOS 불변).
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_path_is_unchanged_from_project_dirs() {
        let old = directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm")
            .map(|p| p.data_dir().to_path_buf());
        assert_eq!(app_data_dir(), old);
    }

    /// Windows·Linux 는 Tauri 규칙(OS 데이터 폴더 + 식별자)이다 — 예전 ProjectDirs
    /// 경로가 아니다.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn non_macos_path_follows_tauri_not_project_dirs() {
        let dir = app_data_dir().expect("data dir");
        assert!(dir.ends_with(BUNDLE_IDENTIFIER), "{dir:?}");
        let old = directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm")
            .map(|p| p.data_dir().to_path_buf());
        assert_ne!(Some(dir), old);
    }
}

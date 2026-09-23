//! 다른 도구의 설정 위치 — 크로스플랫폼 {#integ-paths}
//!
//! Claude Desktop · Claude Code · Codex 설정 파일이 **어느 OS 에서 어디 있나**를
//! 이 한 자리만 안다. 홈은 `HOME` 이 아니라 `directories` 가 판정한다 — Windows
//! 에는 `HOME` 이 없고(Git Bash 가 띄운 자식에만 있다), 있어도 사용자 프로필이
//! 아닐 수 있다. 판정 규칙은 전부 입력을 받는 순수 함수로 두고(세 OS 러너가 같은
//! 표를 문다), 환경을 읽는 얇은 겉함수만 따로 둔다.

use std::path::{Path, PathBuf};

/// 사용자 홈 — macOS·Linux `$HOME` 판정, Windows `FOLDERID_Profile`.
pub fn home_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.home_dir().to_path_buf())
}

/// `path` 가 사용자 홈 **자체**인가 — 홈에 `.oculpm` 스캐폴드를 까는 설정 사고를
/// 막는 가드(`project_init`)가 쓴다. 예전 가드는 `HOME` 환경변수와 비교해서
/// **Windows 에서는 꺼져 있었다** (그 OS 에는 `HOME` 이 없다). 양쪽을 canonicalize
/// 해서 잰다 — Windows 는 둘 다 verbatim(`\\?\`) 표기, 심볼릭 링크 홈도 같은 판정.
pub fn is_home_dir(path: &Path) -> bool {
    is_home_dir_of(path, home_dir().as_deref())
}

/// [`is_home_dir`] 의 판정 (순수 — 홈을 받는다).
pub fn is_home_dir_of(path: &Path, home: Option<&Path>) -> bool {
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    home.is_some_and(|home| canon(path) == canon(home))
}

/// Claude Code 설정 루트 `~/.claude` — 세 OS 공통 (Windows 도 `%USERPROFILE%\.claude`).
pub fn claude_code_home() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".claude"))
}

/// Codex 홈 — `CODEX_HOME` 이 있으면 그것, 없으면 `~/.codex` (Windows `%USERPROFILE%\.codex`).
pub fn codex_home() -> Option<PathBuf> {
    codex_home_from(std::env::var_os("CODEX_HOME"), home_dir())
}

/// [`codex_home`] 의 판정. 빈 `CODEX_HOME` 은 없는 것으로 본다 — Codex 자신이
/// 그렇게 읽는다(빈 값을 그대로 쓰면 `config.toml` 이 작업 폴더 상대경로가 된다).
pub fn codex_home_from(env: Option<std::ffi::OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    env.filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|h| h.join(".codex")))
}

/// Claude Desktop 설정 파일 이름.
pub const CLAUDE_DESKTOP_CONFIG_FILE: &str = "claude_desktop_config.json";

/// Microsoft Store(MSIX) 판 Claude Desktop 의 패키지 폴더 이름. MSIX 는 앱의
/// `%APPDATA%` 쓰기를 `%LOCALAPPDATA%\Packages\<이것>\LocalCache\Roaming` 으로
/// 가상화한다 — 앱은 **그쪽 파일만** 읽으므로 문서의 `%APPDATA%\Claude` 에 써도
/// 무시된다 (anthropics/claude-code#25579 · #26073 · #29100).
pub const CLAUDE_DESKTOP_MSIX_PACKAGE: &str = "Claude_pzs8sxrjxfjjc";

/// Claude Desktop 설정 폴더. `config_dir()` 가 macOS `~/Library/Application
/// Support` · Linux `$XDG_CONFIG_HOME`(없으면 `~/.config`) · Windows Roaming
/// AppData 를 준다. Windows 는 MSIX 판을 먼저 본다 ([`claude_desktop_dir_windows`]).
pub fn claude_desktop_config_dir() -> Option<PathBuf> {
    let base = directories::BaseDirs::new()?;
    if cfg!(windows) {
        return Some(claude_desktop_dir_windows(
            base.config_dir(),
            base.data_local_dir(),
        ));
    }
    Some(base.config_dir().join("Claude"))
}

/// `<Claude Desktop 설정 폴더>/claude_desktop_config.json`.
pub fn claude_desktop_config_path() -> Option<PathBuf> {
    claude_desktop_config_dir().map(|dir| dir.join(CLAUDE_DESKTOP_CONFIG_FILE))
}

/// Windows 의 Claude Desktop 설정 폴더 판정 (순수 — 세 OS 러너가 같은 표를 문다).
///
/// 1. 알려진 MSIX 패키지 폴더의 `LocalCache\Roaming\Claude` 가 있으면 그것.
/// 2. 다른 `Claude_*` 패키지 폴더 중 그 자리가 있는 것 — 설정 파일이 이미 있는
///    쪽을 먼저, 그다음 이름순 첫째 (패키지 게시자 해시가 바뀌어도 따라간다).
/// 3. 없으면 설치형(Squirrel) 판의 `%APPDATA%\Claude`.
///
/// 설치 여부 판정("폴더가 있나")은 호출자 몫이라, 3번은 폴더가 없어도 돌려준다.
pub fn claude_desktop_dir_windows(roaming: &Path, local: &Path) -> PathBuf {
    let packages = local.join("Packages");
    let roaming_of = |pkg: &Path| pkg.join("LocalCache").join("Roaming").join("Claude");
    let known = roaming_of(&packages.join(CLAUDE_DESKTOP_MSIX_PACKAGE));
    if known.is_dir() {
        return known;
    }
    let mut others: Vec<PathBuf> = std::fs::read_dir(&packages)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("Claude_"))
        .map(|e| roaming_of(&e.path()))
        .filter(|dir| dir.is_dir())
        .collect();
    others.sort_by_key(|dir| (!dir.join(CLAUDE_DESKTOP_CONFIG_FILE).is_file(), dir.clone()));
    others
        .into_iter()
        .next()
        .unwrap_or_else(|| roaming.join("Claude"))
}

/// 사이드카 안정 자리 — Linux AppImage 전용 (`$XDG_DATA_HOME/ocul-pm/bin`, 없으면
/// `~/.local/share/ocul-pm/bin`). AppImage 의 사이드카는 실행 중에만 있는
/// squashfs 마운트(`/tmp/.mount_XXXX`) 안에 있어, 다른 앱 설정에 그 경로를 적으면
/// 앱이 꺼지는 순간 죽은 경로가 된다 (마스터플랜 D10). 플러그인 셔틀
/// (`plugin/*/bin/oculpm-mcp`)도 같은 자리를 찾는다.
pub fn stable_sidecar_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.data_dir().join("ocul-pm").join("bin"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_home_honours_codex_home_and_ignores_an_empty_one() {
        let home = Some(PathBuf::from("/h"));
        assert_eq!(
            codex_home_from(Some("/custom".into()), home.clone()),
            Some(PathBuf::from("/custom"))
        );
        assert_eq!(
            codex_home_from(Some("".into()), home.clone()),
            Some(PathBuf::from("/h/.codex")),
            "빈 CODEX_HOME 을 쓰면 config.toml 이 작업 폴더 상대경로가 된다"
        );
        assert_eq!(
            codex_home_from(None, home),
            Some(PathBuf::from("/h/.codex"))
        );
        assert_eq!(codex_home_from(None, None), None);
    }

    /// MSIX 판이 있으면 그쪽 — 앱이 실제로 읽는 파일이 거기뿐이다.
    #[test]
    fn windows_desktop_dir_prefers_the_msix_package_over_roaming_appdata() {
        let tmp = tempfile::TempDir::new().unwrap();
        let roaming = tmp.path().join("Roaming");
        let local = tmp.path().join("Local");
        std::fs::create_dir_all(roaming.join("Claude")).unwrap();

        // MSIX 없음 → 설치형 자리.
        assert_eq!(
            claude_desktop_dir_windows(&roaming, &local),
            roaming.join("Claude")
        );

        // 모르는 게시자 해시의 패키지 — 따라간다.
        let other = local.join("Packages/Claude_zzzz/LocalCache/Roaming/Claude");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(claude_desktop_dir_windows(&roaming, &local), other);

        // 알려진 패키지가 있으면 그것이 먼저다.
        let known = local
            .join("Packages")
            .join(CLAUDE_DESKTOP_MSIX_PACKAGE)
            .join("LocalCache/Roaming/Claude");
        std::fs::create_dir_all(&known).unwrap();
        assert_eq!(claude_desktop_dir_windows(&roaming, &local), known);
    }

    #[test]
    fn windows_desktop_dir_picks_the_package_that_already_has_a_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let local = tmp.path().join("Local");
        let a = local.join("Packages/Claude_aaaa/LocalCache/Roaming/Claude");
        let b = local.join("Packages/Claude_bbbb/LocalCache/Roaming/Claude");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        // 이름순이면 a 지만, 설정이 있는 쪽은 b 다.
        std::fs::write(b.join(CLAUDE_DESKTOP_CONFIG_FILE), "{}").unwrap();
        assert_eq!(claude_desktop_dir_windows(tmp.path(), &local), b);
        // `LocalCache\Roaming\Claude` 가 없는 `Claude_` 껍데기는 고르지 않는다.
        let shell = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(shell.path().join("Local/Packages/Claude_empty")).unwrap();
        assert_eq!(
            claude_desktop_dir_windows(&shell.path().join("R"), &shell.path().join("Local")),
            shell.path().join("R").join("Claude")
        );
    }

    #[test]
    fn the_home_itself_is_home_but_a_folder_under_it_is_not() {
        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("kim");
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        assert!(is_home_dir_of(&home, Some(&home)));
        // `proj/..` 처럼 돌아 들어와도 같은 자리다 (canonicalize).
        assert!(is_home_dir_of(&project.join(".."), Some(&home)));
        assert!(!is_home_dir_of(&project, Some(&home)));
        assert!(
            !is_home_dir_of(&home, None),
            "홈을 모르면 가드는 막지 않는다"
        );
    }

    /// macOS·Linux 의 홈 판정은 예전 가드가 보던 `HOME` 과 **같은 값**이다 — 가드를
    /// `HOME` 비교에서 `home_dir()` 로 옮겨도 그 OS 들의 동작은 그대로다.
    #[cfg(unix)]
    #[test]
    fn on_unix_home_dir_is_the_home_env() {
        if let Some(env) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
            assert_eq!(home_dir(), Some(PathBuf::from(env)));
        }
    }

    /// macOS 는 이 라운드 전과 **같은 자리**여야 한다 (D3).
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_locations_are_unchanged() {
        let home = home_dir().expect("home");
        assert_eq!(
            claude_desktop_config_path(),
            Some(home.join("Library/Application Support/Claude/claude_desktop_config.json"))
        );
        assert_eq!(claude_code_home(), Some(home.join(".claude")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_locations_follow_xdg() {
        let home = home_dir().expect("home");
        let xdg = |var: &str, fallback: &str| {
            std::env::var_os(var)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(fallback))
        };
        assert_eq!(
            claude_desktop_config_path(),
            Some(xdg("XDG_CONFIG_HOME", ".config").join("Claude/claude_desktop_config.json"))
        );
        assert_eq!(claude_code_home(), Some(home.join(".claude")));
        assert_eq!(
            stable_sidecar_dir(),
            Some(xdg("XDG_DATA_HOME", ".local/share").join("ocul-pm/bin"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_locations_use_the_profile_not_home() {
        let profile = PathBuf::from(std::env::var_os("USERPROFILE").expect("USERPROFILE"));
        assert_eq!(home_dir(), Some(profile.clone()));
        assert_eq!(claude_code_home(), Some(profile.join(".claude")));
        if std::env::var_os("CODEX_HOME").is_none() {
            assert_eq!(codex_home(), Some(profile.join(".codex")));
        }
        let desktop = claude_desktop_config_path().expect("desktop");
        let appdata = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA"));
        let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA"));
        assert!(
            desktop == appdata.join("Claude").join(CLAUDE_DESKTOP_CONFIG_FILE)
                || desktop.starts_with(local.join("Packages")),
            "{}",
            desktop.display()
        );
    }
}

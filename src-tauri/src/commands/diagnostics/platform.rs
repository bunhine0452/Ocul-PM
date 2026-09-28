//! 「진단 정보 복사」 의 OS·WebView 판 읽기 (#w5-report, 2026-09-28).
//!
//! 베타 버그 리포트에 붙는 글이라 **비밀·사용자 이름이 새지 않게** 만든다:
//! 경로는 홈을 `~` 로 가리고, 이름·계정·호스트명 같은 값은 애초에 읽지 않는다.
//! 판 읽기가 실패하면 그 칸만 비운다 — 진단이 진단 때문에 실패하면 안 된다.

use std::path::Path;

/// 사람이 읽는 OS 판. 못 읽으면 `None`.
pub fn os_version() -> Option<String> {
    imp::os_version()
}

/// WebView 엔진과 판. macOS 는 OS 에 딸린 WKWebView 라 따로 적지 않는다(`None`) —
/// OS 판이 곧 그 판이다. (wry 의 macOS 판 읽기는 WebKit 번들을 `unload` 해서
/// 쓰지 않는다.)
pub fn webview() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        let engine = if cfg!(windows) {
            "WebView2"
        } else {
            "WebKitGTK"
        };
        tauri::webview_version()
            .ok()
            .map(|v| format!("{engine} {v}"))
    }
}

/// Linux 데스크톱 세션 (`wayland · GNOME`). 다른 OS 는 `None`.
pub fn session() -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    join_present(&[env("XDG_SESSION_TYPE"), env("XDG_CURRENT_DESKTOP")])
}

/// 홈 아래 경로는 `~` 로 — 경로 속 사용자 이름을 리포트에 싣지 않는다.
pub fn tilde_home(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|h| path.strip_prefix(h).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display()),
        None => path.display().to_string(),
    }
}

fn join_present(parts: &[Option<String>]) -> Option<String> {
    let v: Vec<&str> = parts.iter().flatten().map(|s| s.trim()).collect();
    (!v.is_empty()).then(|| v.join(" · "))
}

/// `/etc/os-release` 의 `PRETTY_NAME` (따옴표 벗김).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn os_release_pretty_name(text: &str) -> Option<String> {
    text.lines()
        .find_map(|l| l.trim().strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
        .filter(|v| !v.is_empty())
}

/// macOS `SystemVersion.plist` 에서 `<key>K</key><string>V</string>` 의 V.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn plist_string(text: &str, key: &str) -> Option<String> {
    let after_key = text.split_once(&format!("<key>{key}</key>"))?.1;
    let value = after_key
        .split_once("<string>")?
        .1
        .split_once("</string>")?
        .0;
    Some(value.trim().to_string()).filter(|v| !v.is_empty())
}

/// Windows 판 이름. 레지스트리 `ProductName` 은 Windows 11 에서도 "Windows 10"
/// 이라(알려진 함정) 빌드 번호로 가른다 — 22000 부터 11.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_label(build: Option<&str>, ubr: Option<u32>, display: Option<&str>) -> Option<String> {
    let build_no: u32 = build?.trim().parse().ok()?;
    let name = if build_no >= 22_000 {
        "Windows 11"
    } else {
        "Windows 10"
    };
    let build = match ubr {
        Some(ubr) => format!("{build_no}.{ubr}"),
        None => build_no.to_string(),
    };
    Some(match display.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => format!("{name} {d} (build {build})"),
        None => format!("{name} (build {build})"),
    })
}

#[cfg(target_os = "macos")]
mod imp {
    pub fn os_version() -> Option<String> {
        let text =
            std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
        let version = super::plist_string(&text, "ProductVersion")?;
        Some(match super::plist_string(&text, "ProductBuildVersion") {
            Some(build) => format!("macOS {version} ({build})"),
            None => format!("macOS {version}"),
        })
    }
}

#[cfg(target_os = "linux")]
mod imp {
    pub fn os_version() -> Option<String> {
        let pretty = std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|t| super::os_release_pretty_name(&t));
        let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease")
            .ok()
            .map(|k| format!("kernel {}", k.trim()));
        super::join_present(&[pretty, kernel])
    }
}

#[cfg(windows)]
mod imp {
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    const CURRENT_VERSION: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn reg_sz(value: &str) -> Option<String> {
        let (key, value) = (wide(CURRENT_VERSION), wide(value));
        let mut buf = vec![0u16; 256];
        let mut len = u32::try_from(buf.len() * 2).ok()?;
        // SAFETY: 키·값 이름은 NUL 로 끝나는 살아 있는 UTF-16 버퍼이고, `buf` 는
        // `len` 바이트를 담는다. 판 문자열은 짧다 — 넘치면 실패로 보고 칸을 비운다.
        let rc = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                buf.as_mut_ptr().cast(),
                &mut len,
            )
        };
        if rc != ERROR_SUCCESS {
            return None;
        }
        let chars = (len as usize / 2).min(buf.len());
        Some(
            String::from_utf16_lossy(&buf[..chars])
                .trim_end_matches('\0')
                .to_string(),
        )
    }

    fn reg_dword(value: &str) -> Option<u32> {
        let (key, value) = (wide(CURRENT_VERSION), wide(value));
        let mut data: u32 = 0;
        let mut len = std::mem::size_of::<u32>() as u32;
        // SAFETY: 데이터 포인터는 4바이트 `u32` 를 가리키고 `len` 이 그 크기다.
        let rc = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_DWORD,
                null_mut(),
                (&mut data as *mut u32).cast(),
                &mut len,
            )
        };
        (rc == ERROR_SUCCESS).then_some(data)
    }

    pub fn os_version() -> Option<String> {
        // `DisplayVersion`(23H2) 은 20H2 부터, 그 전은 `ReleaseId`(2004).
        let display = reg_sz("DisplayVersion").or_else(|| reg_sz("ReleaseId"));
        super::windows_label(
            reg_sz("CurrentBuild").as_deref(),
            reg_dword("UBR"),
            display.as_deref(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn home_is_masked_but_other_paths_are_kept() {
        let home = PathBuf::from(if cfg!(windows) {
            r"C:\Users\kim"
        } else {
            "/home/kim"
        });
        let logs = home.join("AppData").join("logs");
        let masked = tilde_home(&logs, Some(&home));
        assert!(!masked.contains("kim"), "{masked}");
        assert!(masked.starts_with('~'), "{masked}");
        assert!(masked.ends_with("logs"), "{masked}");
        assert_eq!(tilde_home(&home, Some(&home)), "~");

        let other = PathBuf::from(if cfg!(windows) {
            r"D:\data\logs"
        } else {
            "/var/log/x"
        });
        assert_eq!(tilde_home(&other, Some(&home)), other.display().to_string());
        assert_eq!(tilde_home(&logs, None), logs.display().to_string());
    }

    #[test]
    fn os_release_pretty_name_is_unquoted() {
        let text = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\nID=ubuntu\n";
        assert_eq!(
            os_release_pretty_name(text).as_deref(),
            Some("Ubuntu 22.04.4 LTS")
        );
        assert_eq!(os_release_pretty_name("ID=arch\n"), None);
    }

    #[test]
    fn plist_value_is_read_by_key() {
        let text = "<dict>\n\t<key>ProductBuildVersion</key>\n\t<string>24C101</string>\n\
                    \t<key>ProductVersion</key>\n\t<string>15.2</string>\n</dict>";
        assert_eq!(
            plist_string(text, "ProductVersion").as_deref(),
            Some("15.2")
        );
        assert_eq!(
            plist_string(text, "ProductBuildVersion").as_deref(),
            Some("24C101")
        );
        assert_eq!(plist_string(text, "Missing"), None);
    }

    #[test]
    fn windows_11_is_told_apart_by_build_number() {
        assert_eq!(
            windows_label(Some("22631"), Some(4460), Some("23H2")).as_deref(),
            Some("Windows 11 23H2 (build 22631.4460)")
        );
        assert_eq!(
            windows_label(Some("19045"), None, Some("22H2")).as_deref(),
            Some("Windows 10 22H2 (build 19045)")
        );
        assert_eq!(
            windows_label(Some("17763"), Some(1), None).as_deref(),
            Some("Windows 10 (build 17763.1)")
        );
        assert_eq!(windows_label(None, Some(1), Some("23H2")), None);
    }

    #[test]
    fn join_present_skips_missing_parts() {
        assert_eq!(
            join_present(&[Some("wayland".into()), None, Some("GNOME".into())]).as_deref(),
            Some("wayland · GNOME")
        );
        assert_eq!(join_present(&[None, None]), None);
    }

    /// 러너 3종이 각자의 실제 경로(plist · 레지스트리 · os-release)를 지난다.
    #[test]
    fn the_live_os_version_is_readable() {
        let v = os_version().expect("OS 판을 읽어야 한다");
        let expected = if cfg!(target_os = "macos") {
            "macOS"
        } else if cfg!(windows) {
            "Windows"
        } else {
            "kernel"
        };
        assert!(v.contains(expected), "{v}");
    }

    /// Windows(WebView2 런타임)·Linux(WebKitGTK 공유 라이브러리) 판 읽기.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_live_webview_version_is_readable() {
        let v = webview().expect("WebView 판을 읽어야 한다");
        assert!(
            v.starts_with("WebView2 ") || v.starts_with("WebKitGTK "),
            "{v}"
        );
        assert!(v.chars().any(|c| c.is_ascii_digit()), "{v}");
    }
}

//! 앱 아이콘 — 컬러 / 흑백 (2026-11-04, macOS).
//!
//! 사용자 요청 「앱 아이콘 색을 흑백으로 바꿀 수 있게」. 설정 「표시 › 앱 아이콘」 이 `app_icon` 키(`color` ·
//! `mono`)를 저장하면(`settings_set`) 여기서 바꾼다 — 따로 선 명령은 없다. 앱이 뜰 때도 한 번 다시 건다.
//!
//! 두 자리를 바꾼다:
//! - **Dock(떠 있는 동안)** — `NSApplication.applicationIconImage`. `None` 이면 번들 아이콘으로 돌아간다.
//! - **번들(꺼져 있을 때 · Finder · Launchpad)** — `NSWorkspace.setIcon:forFile:` 로 `.app` 에 사용자 아이콘을
//!   붙인다(Finder 「정보 가져오기」 에 아이콘을 붙여 넣는 것과 같다). 업데이트가 번들을 갈아 끼우면 떨어지는데,
//!   새 판이 뜨며 다시 붙인다. `.app` 밖(개발 빌드의 맨 실행 파일)에서는 Dock 만 바꾼다.
//!
//! 흑백 그림은 컬러 아이콘(`landing/icon.svg`)과 같은 모양에 색만 회색으로 바꾼 `icons/mono/icon-mono.svg` 를
//! 512px 로 구운 것이다. 네트워크 · 자식 프로세스는 없다.

use tauri::AppHandle;

/// 설정 키 — 프런트 `KEYS.appIcon` 과 같다.
pub const KEY: &str = "app_icon";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppIcon {
    Color,
    Mono,
}

impl AppIcon {
    /// 모르는 값은 컬러 — 설정이 깨져도 아이콘이 사라지지 않는다.
    pub fn parse(raw: &str) -> Self {
        if raw.trim() == "mono" {
            AppIcon::Mono
        } else {
            AppIcon::Color
        }
    }
}

/// 아이콘을 건다 — AppKit 은 메인 스레드에서만 만진다.
pub fn apply(app: &AppHandle, icon: AppIcon) {
    #[cfg(target_os = "macos")]
    if let Err(e) = app.run_on_main_thread(move || macos::apply(icon)) {
        tracing::warn!(target: "app_icon", error = %e, "앱 아이콘을 메인 스레드로 넘기지 못함");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, icon);
}

#[cfg(target_os = "macos")]
mod macos {
    use super::AppIcon;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
    use objc2_foundation::{MainThreadMarker, NSBundle, NSData};

    static MONO_PNG: &[u8] = include_bytes!("../icons/mono/icon-mono.png");

    pub(super) fn apply(icon: AppIcon) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let image = match icon {
            AppIcon::Color => None,
            AppIcon::Mono => {
                let data = NSData::with_bytes(MONO_PNG);
                NSImage::initWithData(NSImage::alloc(), &data)
            }
        };
        if icon == AppIcon::Mono && image.is_none() {
            tracing::warn!(target: "app_icon", "흑백 아이콘 그림을 읽지 못함");
            return;
        }
        let app = NSApplication::sharedApplication(mtm);
        // SAFETY: 메인 스레드(mtm)에서, 살아 있는 NSImage 또는 None(번들 아이콘으로 되돌림)을 넘긴다.
        unsafe { app.setApplicationIconImage(image.as_deref()) };

        // 번들 — 이미 그 상태면 건드리지 않는다(기동마다 번들에 쓰지 않게). 사용자 아이콘은 번들 뿌리의
        // `Icon\r` 파일로 남는다.
        let bundle = NSBundle::mainBundle().bundlePath().to_string();
        if !bundle.ends_with(".app") {
            return;
        }
        let has_custom = std::path::Path::new(&bundle).join("Icon\r").exists();
        if has_custom == (icon == AppIcon::Mono) {
            return;
        }
        let path = objc2_foundation::NSString::from_str(&bundle);
        let ok = NSWorkspace::sharedWorkspace().setIcon_forFile_options(
            image.as_deref(),
            &path,
            NSWorkspaceIconCreationOptions(0),
        );
        tracing::info!(target: "app_icon", ?icon, ok, "번들 아이콘을 바꿨다");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_values_fall_back_to_color() {
        assert_eq!(AppIcon::parse("mono"), AppIcon::Mono);
        assert_eq!(AppIcon::parse(" mono\n"), AppIcon::Mono);
        assert_eq!(AppIcon::parse("color"), AppIcon::Color);
        assert_eq!(AppIcon::parse(""), AppIcon::Color);
        assert_eq!(AppIcon::parse("rainbow"), AppIcon::Color);
    }
}

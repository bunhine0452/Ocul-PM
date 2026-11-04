//! 앱 아이콘 — 초록(기본) · 다크 · 라이트 · 흑백 · 파랑 · 보라 · 장미 · 주황 · 청록 (2026-11-04, macOS).
//!
//! 사용자 요청 「앱 아이콘 색을 흑백으로 바꿀 수 있게」 → 「다크 모드도, 더 많은 색도」. 설정 「표시 › 앱 아이콘」 이
//! `app_icon` 키를 저장하면(`settings_set`) 여기서 바꾼다 — 따로 선 명령은 없다. 앱이 뜰 때도 한 번 다시 건다.
//!
//! 두 자리를 바꾼다:
//! - **Dock(떠 있는 동안)** — `NSApplication.applicationIconImage`. `None` 이면 번들 아이콘으로 돌아간다.
//! - **번들(꺼져 있을 때 · Finder · Launchpad)** — `NSWorkspace.setIcon:forFile:` 로 `.app` 에 사용자 아이콘을
//!   붙인다(Finder 「정보 가져오기」 에 아이콘을 붙여 넣는 것과 같다). 업데이트가 번들을 갈아 끼우면 떨어지는데,
//!   새 판이 뜨며 다시 붙인다. `.app` 밖(개발 빌드의 맨 실행 파일)에서는 Dock 만 바꾼다.
//!
//! 그림은 프런트 `features/settings/appIconArt.ts` 의 색 벌을 `scripts/build-app-icons.mjs` 가 512px 로 구운
//! `icons/variants/<id>.png` 다 — 설정의 미리보기와 같은 함수에서 나온다. 네트워크 · 자식 프로세스는 없다.

use tauri::AppHandle;

/// 설정 키 — 프런트 `KEYS.appIcon` 과 같다.
pub const KEY: &str = "app_icon";

/// 변형 id → 구운 그림. 기본(`color`)과 모르는 값은 `None` — 번들 아이콘 그대로(설정이 깨져도 아이콘이 사라지지 않는다).
pub fn variant_png(id: &str) -> Option<&'static [u8]> {
    Some(match id.trim() {
        "dark" => include_bytes!("../icons/variants/dark.png"),
        "light" => include_bytes!("../icons/variants/light.png"),
        "mono" => include_bytes!("../icons/variants/mono.png"),
        "blue" => include_bytes!("../icons/variants/blue.png"),
        "violet" => include_bytes!("../icons/variants/violet.png"),
        "rose" => include_bytes!("../icons/variants/rose.png"),
        "orange" => include_bytes!("../icons/variants/orange.png"),
        "teal" => include_bytes!("../icons/variants/teal.png"),
        _ => return None,
    })
}

/// 아이콘을 건다 — AppKit 은 메인 스레드에서만 만진다. `force` 가 아니면(기동 때) 번들이 이미 그 꼴(사용자
/// 아이콘이 있다 / 없다)이면 번들은 건드리지 않는다. 설정을 바꿀 때는 변형끼리 오가므로 늘 쓴다.
pub fn apply(app: &AppHandle, id: &str, force: bool) {
    let png = variant_png(id);
    #[cfg(target_os = "macos")]
    if let Err(e) = app.run_on_main_thread(move || macos::apply(png, force)) {
        tracing::warn!(target: "app_icon", error = %e, "앱 아이콘을 메인 스레드로 넘기지 못함");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, png, force);
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
    use objc2_foundation::{MainThreadMarker, NSBundle, NSData, NSString};

    pub(super) fn apply(png: Option<&'static [u8]>, force: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let image = match png {
            None => None,
            Some(bytes) => {
                let img = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes));
                if img.is_none() {
                    tracing::warn!(target: "app_icon", "아이콘 그림을 읽지 못함");
                    return;
                }
                img
            }
        };
        let app = NSApplication::sharedApplication(mtm);
        // SAFETY: 메인 스레드(mtm)에서, 살아 있는 NSImage 또는 None(번들 아이콘으로 되돌림)을 넘긴다.
        unsafe { app.setApplicationIconImage(image.as_deref()) };

        // 번들 — 사용자 아이콘은 번들 뿌리의 `Icon\r` 파일로 남는다.
        let bundle = NSBundle::mainBundle().bundlePath().to_string();
        if !bundle.ends_with(".app") {
            return;
        }
        let has_custom = std::path::Path::new(&bundle).join("Icon\r").exists();
        if !force && has_custom == image.is_some() {
            return;
        }
        let ok = NSWorkspace::sharedWorkspace().setIcon_forFile_options(
            image.as_deref(),
            &NSString::from_str(&bundle),
            NSWorkspaceIconCreationOptions(0),
        );
        tracing::info!(target: "app_icon", custom = image.is_some(), ok, "번들 아이콘을 바꿨다");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_a_picture_and_default_has_none() {
        for id in [
            "dark", "light", "mono", "blue", "violet", "rose", "orange", "teal",
        ] {
            let png = variant_png(id).unwrap_or_else(|| panic!("{id} 그림이 없다"));
            assert_eq!(&png[1..4], b"PNG", "{id} 는 PNG 여야 한다");
        }
        assert!(variant_png("color").is_none());
        assert!(variant_png("").is_none());
        assert!(variant_png("rainbow").is_none());
        assert!(variant_png(" mono\n").is_some());
    }

    /// 프런트 목록(`appIconArt.ts` 의 APP_ICON_IDS)과 같은 id 를 안다 — 한쪽에만 더하면 빨개진다.
    #[test]
    fn ids_match_the_frontend_list() {
        let ts = include_str!("../../src/features/settings/appIconArt.ts");
        let line = ts
            .lines()
            .find(|l| l.contains("export const APP_ICON_IDS"))
            .expect("APP_ICON_IDS 줄");
        let ids: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
        assert_eq!(ids.first(), Some(&"color"));
        for id in &ids[1..] {
            assert!(
                variant_png(id).is_some(),
                "{id} 는 프런트에 있는데 그림이 없다"
            );
        }
        assert_eq!(ids.len(), 9);
    }
}

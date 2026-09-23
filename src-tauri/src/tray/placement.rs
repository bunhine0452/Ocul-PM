//! 트레이 팝오버를 **어디에** 띄우는가 — 비-mac (크로스플랫폼 W2 `#os-tray-menu`).
//!
//! macOS 는 메뉴바가 늘 위라 `tray.rs` 가 직접 "y = 30" 에 둔다. 여기는
//! 작업 표시줄이 아래·위·옆 어디든 될 수 있는 Windows 의 몫이다.

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindow;

#[cfg(not(target_os = "macos"))]
use super::{POPOVER_H, POPOVER_W};

/// 작업 영역 — 모니터에서 작업 표시줄·상단 바를 뺀 사각형 (물리 픽셀).
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(super) struct WorkArea {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// 비-mac 팝오버의 좌상단 (물리 픽셀) — 순수 함수라 세 OS 에서 테스트한다.
///
/// macOS 는 메뉴바가 늘 위라 "y = 30" 이면 됐다. Windows 작업 표시줄은 기본이
/// **아래**고(위·옆으로 옮길 수 있다), GNOME 상단 바는 위다. 그래서 클릭이 작업
/// 영역의 아래 절반이면 바닥 위에, 위 절반이면 꼭대기 아래에 붙인다. 가로는 클릭
/// 중심, 작업 영역 안으로 자른다 — 옆으로 세운 작업 표시줄도 이 자르기로 피한다.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(super) fn popover_origin_near_tray(
    click: (f64, f64),
    size: (f64, f64),
    area: WorkArea,
    margin: f64,
) -> (f64, f64) {
    let (w, h) = size;
    let min_x = area.x + margin;
    let max_x = (area.x + area.w - w - margin).max(min_x);
    let x = (click.0 - w / 2.0).clamp(min_x, max_x);
    let lower_half = click.1 >= area.y + area.h / 2.0;
    let y = if lower_half {
        area.y + area.h - h - margin
    } else {
        area.y + margin
    };
    // 화면이 팝오버보다 작으면 위 가장자리를 맞춘다 (닫기 쪽 머리가 보이게).
    (x, y.max(area.y))
}

/// 클릭한 모니터의 작업 영역에 맞춰 팝오버를 놓는다 (Windows — Linux 의
/// appindicator 는 클릭 이벤트를 주지 않아 여기 오지 않는다).
#[cfg(not(target_os = "macos"))]
pub(super) fn place_near_tray(win: &WebviewWindow, click: tauri::PhysicalPosition<f64>) {
    let monitor = win
        .monitor_from_point(click.x, click.y)
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        tracing::debug!(target: "tray", ?click, "모니터를 모름 — 기본 자리에 둔다");
        return;
    };
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    let (x, y) = popover_origin_near_tray(
        (click.x, click.y),
        (POPOVER_W * scale, POPOVER_H * scale),
        WorkArea {
            x: f64::from(wa.position.x),
            y: f64::from(wa.position.y),
            w: f64::from(wa.size.width),
            h: f64::from(wa.size.height),
        },
        8.0 * scale,
    );
    tracing::debug!(target: "tray", ?click, scale, x, y, "tray popover position");
    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA_1080: WorkArea = WorkArea {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1040.0,
    };

    /// Windows 기본 — 작업 표시줄이 아래. 팝오버는 작업 영역 바닥 위, 클릭 x
    /// 중심, 화면 오른쪽 끝을 넘지 않는다.
    #[test]
    fn popover_sits_above_a_bottom_taskbar() {
        let (x, y) = popover_origin_near_tray((1800.0, 1060.0), (368.0, 508.0), AREA_1080, 8.0);
        assert_eq!(y, 1040.0 - 508.0 - 8.0);
        assert_eq!(x, 1920.0 - 368.0 - 8.0, "오른쪽 끝에서 잘린다");
        // 가운데 근처 클릭은 클릭 중심 그대로.
        let (x, _) = popover_origin_near_tray((1000.0, 1060.0), (368.0, 508.0), AREA_1080, 8.0);
        assert_eq!(x, 1000.0 - 184.0);
    }

    /// 작업 표시줄을 위로 옮긴 Windows · GNOME 상단 바 — 꼭대기 아래.
    #[test]
    fn popover_hangs_below_a_top_bar() {
        let area = WorkArea {
            x: 0.0,
            y: 40.0,
            w: 1920.0,
            h: 1040.0,
        };
        let (x, y) = popover_origin_near_tray((20.0, 10.0), (368.0, 508.0), area, 8.0);
        assert_eq!((x, y), (8.0, 48.0), "왼쪽 끝에서 잘리고 바 아래에 붙는다");
    }

    /// 두 번째 모니터(음수 좌표·HiDPI)와 팝오버보다 작은 화면.
    #[test]
    fn popover_stays_inside_odd_work_areas() {
        let left = WorkArea {
            x: -2560.0,
            y: 0.0,
            w: 2560.0,
            h: 1380.0,
        };
        let (x, y) = popover_origin_near_tray((-100.0, 1420.0), (736.0, 1016.0), left, 16.0);
        assert!(x >= left.x + 16.0 && x + 736.0 <= left.x + left.w - 16.0 + 0.001);
        assert_eq!(y, 1380.0 - 1016.0 - 16.0);

        let tiny = WorkArea {
            x: 0.0,
            y: 0.0,
            w: 300.0,
            h: 400.0,
        };
        let (x, y) = popover_origin_near_tray((150.0, 390.0), (368.0, 508.0), tiny, 8.0);
        assert_eq!(
            (x, y),
            (8.0, 0.0),
            "작은 화면에서도 패닉 없이 왼쪽 위를 맞춘다"
        );
    }
}

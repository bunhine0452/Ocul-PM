//! 프로젝트 창 나란히 놓기 (2026-11-03).
//!
//! 프로젝트마다 창을 띄워 에이전트를 돌리면 창이 셋 넷이 된다. macOS 의 창 분할(⌃⌥ 화살표 ·
//! 「이동 및 크기 조절」)은 반쪽 · 4분의 1 뿐이라 셋을 같은 폭으로 세울 수 없었고, 손으로 맞추면
//! 폭이 들쭉날쭉했다. 이 명령은 지금 보이는 앱 창 전부를 **지금 창이 있는 화면**의 작업 영역(메뉴
//! 막대 · Dock 을 뺀 곳)에 같은 폭의 칸으로 세운다.
//!
//! - 순서는 지금 놓인 순서(왼쪽 → 오른쪽, 위 → 아래)를 따른다 — 손으로 고른 자리를 흐트리지 않는다.
//! - 한 칸이 최소 폭(480pt)보다 좁아지면 줄을 하나 늘린다. 마지막 줄의 창은 그 줄의 폭을 나눠 쓴다.
//! - 배치(`tile_layout`)는 순수 함수라 Tauri 없이 테스트한다.

use super::*;

/// 물리 픽셀 사각형.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TileCell {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// `n` 개의 창을 `area` 에 칸으로 나눈다. `min_w` 는 한 칸의 최소 폭(물리 px).
///
/// 열 수는 「최소 폭을 지키는 가장 많은 열」로 줄 수를 정한 뒤, 줄마다 고르게 나눈다
/// (창 5개 · 최대 4열 → 2줄 → 3 + 2). 나눗셈의 나머지 픽셀은 마지막 칸이 먹어 빈틈이 없다.
pub fn tile_layout(area: TileCell, n: usize, min_w: u32) -> Vec<TileCell> {
    if n == 0 {
        return Vec::new();
    }
    let max_cols = ((area.w / min_w.max(1)) as usize).clamp(1, n);
    let rows = n.div_ceil(max_cols);
    let cols = n.div_ceil(rows);
    let mut out = Vec::with_capacity(n);
    for r in 0..rows {
        let in_row = cols.min(n - r * cols);
        let y0 = area.h as u64 * r as u64 / rows as u64;
        let y1 = area.h as u64 * (r as u64 + 1) / rows as u64;
        for c in 0..in_row {
            let x0 = area.w as u64 * c as u64 / in_row as u64;
            let x1 = area.w as u64 * (c as u64 + 1) / in_row as u64;
            out.push(TileCell {
                x: area.x + x0 as i32,
                y: area.y + y0 as i32,
                w: (x1 - x0) as u32,
                h: (y1 - y0) as u32,
            });
        }
    }
    out
}

/// 보이는 앱 창 전부를 지금 창의 화면에 나란히 세운다. 세운 창의 수를 돌려준다.
#[tauri::command]
#[specta::specta]
pub async fn tile_app_windows(app: AppHandle) -> Result<u32, String> {
    tile_inner(&app)
}

pub(crate) fn tile_inner(app: &AppHandle) -> Result<u32, String> {
    let labels: Vec<String> = {
        let state = app.state::<WindowProjects>();
        let reg = state.lock();
        reg.windows.keys().cloned().collect()
    };
    // 숨긴 창(상주 모드에서 마지막으로 닫아 둔 휴면 창)은 세지 않는다.
    let mut windows: Vec<tauri::WebviewWindow> = labels
        .iter()
        .filter_map(|l| app.get_webview_window(l))
        .filter(|w| w.is_visible().unwrap_or(false))
        .collect();
    if windows.is_empty() {
        return Ok(0);
    }

    let focused = focused_app_window(app).and_then(|l| app.get_webview_window(&l));
    let monitor = focused
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "화면을 찾지 못했어요".to_string())?;
    let work = monitor.work_area();
    let area = TileCell {
        x: work.position.x,
        y: work.position.y,
        w: work.size.width,
        h: work.size.height,
    };
    let min_w = (WINDOW_MIN_W * monitor.scale_factor()).round() as u32;

    // 전체 화면 · 최대화 · 최소화를 먼저 푼다 — 그대로 두면 크기를 바꿔도 먹지 않는다.
    for w in &windows {
        if w.is_fullscreen().unwrap_or(false) {
            let _ = w.set_fullscreen(false);
        }
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        }
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
    }
    // 지금 놓인 순서대로 — 왼쪽에 있던 창이 왼쪽 칸으로.
    windows.sort_by_key(|w| {
        w.outer_position()
            .map(|p| (p.x, p.y))
            .unwrap_or((i32::MAX, i32::MAX))
    });

    for (w, cell) in windows.iter().zip(tile_layout(area, windows.len(), min_w)) {
        // `set_size` 는 안쪽 크기다 — 제목줄 · 테두리(비-mac 의 OS 장식) 몫을 빼야 칸에 꼭 맞는다.
        let (dw, dh) = match (w.outer_size(), w.inner_size()) {
            (Ok(o), Ok(i)) => (
                o.width.saturating_sub(i.width),
                o.height.saturating_sub(i.height),
            ),
            _ => (0, 0),
        };
        let _ = w.set_position(tauri::PhysicalPosition::new(cell.x, cell.y));
        let _ = w.set_size(tauri::PhysicalSize::new(
            cell.w.saturating_sub(dw),
            cell.h.saturating_sub(dh),
        ));
    }
    if let Some(w) = focused {
        let _ = w.set_focus();
    }
    Ok(windows.len() as u32)
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    const AREA: TileCell = TileCell {
        x: 0,
        y: 50,
        w: 3000,
        h: 1800,
    };

    #[test]
    fn three_windows_get_three_equal_columns() {
        let cells = tile_layout(AREA, 3, 960);
        assert_eq!(cells.len(), 3);
        assert_eq!(
            cells.iter().map(|c| (c.x, c.w)).collect::<Vec<_>>(),
            vec![(0, 1000), (1000, 1000), (2000, 1000)]
        );
        assert!(cells.iter().all(|c| c.y == 50 && c.h == 1800));
    }

    /// 칸이 최소 폭보다 좁아지면 줄을 늘린다 — 5개, 최대 3열 → 2줄(3 + 2), 마지막 줄은 그 줄을 나눠 쓴다.
    #[test]
    fn too_many_wraps_into_rows() {
        let cells = tile_layout(AREA, 5, 960);
        assert_eq!(cells.len(), 5);
        assert_eq!(
            cells[0],
            TileCell {
                x: 0,
                y: 50,
                w: 1000,
                h: 900
            }
        );
        assert_eq!(
            cells[3],
            TileCell {
                x: 0,
                y: 950,
                w: 1500,
                h: 900
            }
        );
        assert_eq!(
            cells[4],
            TileCell {
                x: 1500,
                y: 950,
                w: 1500,
                h: 900
            }
        );
    }

    /// 나머지 픽셀이 빈틈으로 남지 않는다 — 칸을 이으면 작업 영역 폭과 같다.
    #[test]
    fn cells_cover_the_area_without_gaps() {
        let area = TileCell {
            x: -1440,
            y: 25,
            w: 1001,
            h: 700,
        };
        let cells = tile_layout(area, 3, 300);
        assert_eq!(cells.iter().map(|c| c.w).sum::<u32>(), 1001);
        assert_eq!(cells[0].x, -1440);
        assert_eq!(cells[2].x + cells[2].w as i32, -1440 + 1001);
    }

    #[test]
    fn one_and_none() {
        assert!(tile_layout(AREA, 0, 960).is_empty());
        assert_eq!(tile_layout(AREA, 1, 960), vec![AREA]);
        // 화면보다 넓은 최소 폭이어도 한 열은 선다.
        assert_eq!(tile_layout(AREA, 2, 9999).len(), 2);
    }
}

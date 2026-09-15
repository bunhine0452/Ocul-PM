//! 탭 드래그 — 떼어내기(`detach_tab`·크롬식 tear-off)와 창 간 다시 붙이기.
//!
//! 창 기하·커서(OS 물리 px)는 Rust 만 알고 탭 폭은 CSS 만 알아서, 프런트와
//! 왕복하며 겨누는 자리를 미리 맞춰 둔다. 놓는 순간은 레지스트리를 읽을 뿐이다.

use super::*;

/// 탭을 창 밖으로 떼어낸다 — 화면 좌표(CSS 픽셀)에 새 창을 만든다.
///
/// 새 창에서 셸이 다시 마운트되므로 DOM 상태(스크롤 위치)는 잃지만, 화면·필터·
/// 터미널 탭 구성은 프로젝트별 localStorage 에 있고 **PTY 세션은 Rust 에 살아
/// 있어** 스크롤백까지 재부착된다 (`pty_prefix_for` 가 프로젝트 기준이라 가능).
#[tauri::command]
#[specta::specta]
pub async fn detach_tab(
    app: AppHandle,
    tab_id: u32,
    anchor_x: Option<f64>,
    anchor_y: Option<f64>,
) -> Result<(), String> {
    let removed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        // 창에 탭이 하나뿐이면 떼어낼 게 없다 — 그대로 두는 게 맞다
        // (떼어내면 원본 창이 닫히고 같은 내용의 새 창이 뜨는 셈이라 순수 손해).
        let single = reg
            .locate_tab(tab_id)
            .and_then(|l| reg.get(&l).map(|st| st.order.len() <= 1))
            .unwrap_or(true);
        if single {
            None
        } else {
            reg.remove_tab(tab_id)
        }
    };
    let Some((source, project_id, _)) = removed else {
        return Ok(());
    };
    broadcast(&app, &source).await;
    // 앵커는 **포인터로 떼어냈을 때만** 있다 — 새 창 안에서 "잡았던 그 자리"가
    // 될 지점(창 좌상단 기준 논리 px). 메뉴·키보드로 부르면 겨눈 지점이 없으므로
    // 창 자리는 OS 에 맡긴다.
    //
    // 커서는 이벤트가 아니라 **OS 에서** 받는다 (결정 2). 예전엔 `screenX` 에
    // 상수 오프셋(-120, -16)을 더해 "타이틀바 근처" 를 노렸는데, 웹뷰 줌이
    // 걸리면 그 상수가 틀어져 창이 손에서 멀찍이 떨어진 자리에 떴다.
    let at = match (anchor_x, anchor_y) {
        (Some(ax), Some(ay)) => {
            let scale = app
                .get_webview_window(&source)
                .and_then(|w| w.scale_factor().ok())
                .unwrap_or(1.0);
            app.cursor_position()
                .ok()
                .map(|c| detached_origin((c.x, c.y), scale, (ax, ay)))
        }
        _ => None,
    };
    create_window(&app, project_id, None, at, false)
        .await
        .map(|_| ())
}

/// 떼어낸 창의 좌상단 (논리 px) — 잡았던 자리가 커서 밑에 그대로 오도록.
///
/// `cursor` 는 OS 가 주는 **물리** px, `anchor` 는 새 창 안에서 커서 밑에 와야
/// 할 지점(논리 px). 배율이 0 이하로 오면 1 로 본다 — 창이 사라지는 중이면
/// 배율 조회가 이상한 값을 줄 수 있는데, 그때 창을 화면 밖으로 던지느니 조금
/// 어긋나는 편이 낫다.
pub fn detached_origin(cursor: (f64, f64), scale: f64, anchor: (f64, f64)) -> (f64, f64) {
    let sf = if scale > 0.0 { scale } else { 1.0 };
    (cursor.0 / sf - anchor.0, cursor.1 / sf - anchor.1)
}

// ─── 창 간 탭 드래그 (다시 붙이기) ──────────────────────────────────────────
//
// 떼어내기(`detach_tab`)의 반대편. 크롬처럼 **다른 창의 스트립에 떨어뜨려**
// 탭을 합친다. 세 몫으로 나뉜다.
//
//   ① 어느 창 위인가 — Rust. 창 기하는 Rust 만 안다. 커서는 OS 에게 직접
//      묻는다(`cursor_position`, 물리 px): 웹뷰 줌이 걸려 있어도 흔들리지 않는
//      유일한 좌표계다.
//   ② 어느 탭 **사이**인가 — 대상 창의 프런트. 탭 폭은 CSS 가 정하므로 DOM 만
//      알 수 있다. 계산 결과를 `tab_drop_hint` 로 되돌려 준다.
//   ③ 실제 이동 — Rust (`drop_tear_off`). 레지스트리가 SSOT 다.
//
// 손을 놓는 순간에 ②를 물어보면 왕복 한 번이 늦으므로, 드래그 **내내** 미리
// 주고받아 둔다. 그래서 놓는 순간은 레지스트리를 읽는 것으로 끝난다.

/// 지금 커서가 다른 앱 창의 탭 스트립 위인가. 대상 창 라벨을 돌려준다.
///
/// 드래그 중 포인터가 움직일 때마다 호출된다 — 대상이 바뀌면 떠난 창에
/// `TabDragLeave`, 새 창에 `TabDragOver` 를 보내 캐럿을 옮긴다.
#[tauri::command]
#[specta::specta]
pub async fn tab_drag_over(
    app: AppHandle,
    tab_id: u32,
    band: f64,
) -> Result<Option<String>, String> {
    // 손에 창이 들려 있으면 그쪽이 기준이다 — 끌던 탭은 이미 그 창의 것이고
    // **id 도 새로 발급됐다** (프런트가 들고 있는 옛 id 로는 못 찾는다).
    let tear = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.tearing()
    };
    let source = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.locate_tab(tear.as_ref().map_or(tab_id, |t| t.tab_id))
    };
    // 들고 있는 창은 **먼저 옮긴다** — 히트테스트보다 앞이어야 커서와 창이 같은
    // 프레임에서 맞는다.
    if let Some(tear) = &tear {
        follow_cursor(&app, tear);
    }
    let hit = source
        .as_deref()
        .and_then(|src| strip_under_cursor(&app, src, band));

    // 크롬의 합치기 미리보기 — 남의 스트립을 겨누는 순간 들고 있던 창은
    // **사라지고** 그 창의 줄에 자리가 벌어진다. 놓기 전에 결과가 그대로 보인다.
    if tear.is_some() {
        let toggled = {
            let state = app.state::<WindowTabs>();
            let mut reg = state.lock();
            reg.set_tear_hidden(hit.is_some())
        };
        if let (Some(hidden), Some(tear)) = (toggled, &tear) {
            if let Some(win) = app.get_webview_window(&tear.label) {
                let _ = if hidden { win.hide() } else { win.show() };
            }
        }
    }

    let (left, entered, fresh) = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        match &hit {
            Some((label, _)) => {
                let fresh = reg.hovering() != Some(label.as_str());
                (reg.hover(label), Some(label.clone()), fresh)
            }
            None => (reg.unhover(), None, false),
        }
    };
    if let Some(prev) = left {
        let _ = TabDragLeave {
            window: prev.clone(),
        }
        .emit_to(&app, &prev);
    }
    if let Some((label, x)) = hit {
        // 겉모습은 스트립에 **처음 들어선** 프레임에만 싣는다 (DB 조회 1회).
        let carried = tear.as_ref().map_or(tab_id, |t| t.tab_id);
        let preview = if fresh {
            tab_preview(&app, carried).await
        } else {
            None
        };
        let _ = TabDragOver {
            window: label.clone(),
            x,
            tab_id: carried,
            preview,
        }
        .emit_to(&app, &label);
    }
    Ok(entered)
}

/// 끌려오는 탭의 겉모습을 읽는다 — 받는 창이 자리표시자를 그릴 재료.
///
/// 이름·아이콘·색의 출처는 `snapshot` 과 **같다**. 갈라지면 같은 프로젝트가
/// 끌려올 때와 앉은 뒤에 다르게 보인다.
async fn tab_preview(app: &AppHandle, tab_id: u32) -> Option<TabPreview> {
    let project_id = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let label = reg.locate_tab(tab_id)?;
        reg.get(&label)?
            .order
            .iter()
            .find(|t| t.id == tab_id)?
            .project_id
    };
    let Some(pid) = project_id else {
        return Some(TabPreview {
            name: String::new(),
            icon: None,
            color: None,
            is_start: true,
        });
    };
    let db = app.state::<crate::db::Db>();
    // 프로젝트가 DB 에서 사라졌어도 자리표시자는 그려야 한다 — 이름만 폴백.
    let (name, icon, color) = match db.get_project(pid).await {
        Ok(p) => (p.name, p.icon, p.color),
        Err(_) => (format!("#{pid}"), None, None),
    };
    Some(TabPreview {
        name,
        icon,
        color,
        is_start: false,
    })
}

/// 대상 창이 계산한 삽입 인덱스를 기록한다 (위 ②).
#[tauri::command]
#[specta::specta]
pub async fn tab_drop_hint(app: AppHandle, window: String, index: u32) -> Result<(), String> {
    let state = app.state::<WindowTabs>();
    state.lock().note_drop_index(&window, index as usize);
    Ok(())
}

/// 탭을 `target` 창의 `index` 자리로 옮기고 양쪽 창을 다시 그린다.
///
/// 드래그(`drop_tear_off`)와 메뉴(`move_tab_to_window`)가 **같은 길**을 쓴다 —
/// 나뉘어 있으면 한쪽만 고쳐져 "끌면 되는데 메뉴로는 안 되는" 종류의 어긋남이
/// 생긴다. 옮겼으면 `true`.
async fn commit_move(app: &AppHandle, tab_id: u32, target: &str, index: usize) -> bool {
    let moved = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.move_tab(tab_id, target, index)
    };
    let Some((source, emptied)) = moved else {
        return false;
    };
    // 대상 창은 항상 다시 그린다. 원래 창은 살아 있을 때만 (비었으면 닫는다).
    broadcast(app, target).await;
    if emptied {
        if let Some(win) = app.get_webview_window(&source) {
            let _ = win.close();
        }
    } else if source != target {
        broadcast(app, &source).await;
    }
    focus_window(app, target);
    true
}

/// 탭을 **이름으로 지정한** 창으로 옮긴다 — 드래그의 키보드·메뉴 등가물.
///
/// 끌어다 놓기는 포인터가 있어야만 성립한다. 창이 겹쳐 있거나 화면이 좁아
/// 조준이 어려울 때도, 보조기술로 조작할 때도 같은 일을 할 수 있어야 한다.
/// 자리는 맨 뒤다 — 메뉴에는 겨눈 지점이 없으므로 지어내지 않는다.
#[tauri::command]
#[specta::specta]
pub async fn move_tab_to_window(
    app: AppHandle,
    tab_id: u32,
    window: String,
) -> Result<bool, String> {
    Ok(commit_move(&app, tab_id, &window, usize::MAX).await)
}

/// 탭을 옮길 수 있는 창 목록 (메뉴가 그린다).
///
/// 창 **이름**은 싣지 않는다 — 백엔드는 UI 문자열을 만들지 않는다는 규율이
/// 있고, 프런트는 이미 프로젝트 목록을 들고 있어 id 하나면 스트립과 **같은**
/// 이름·아이콘을 붙일 수 있다.
#[tauri::command]
#[specta::specta]
pub async fn list_app_windows(app: AppHandle) -> Result<Vec<AppWindowInfo>, String> {
    let state = app.state::<WindowTabs>();
    let reg = state.lock();
    let mut out: Vec<AppWindowInfo> = reg
        .windows
        .iter()
        // 웹뷰가 이미 사라진 창은 뺀다 — 닫히는 중인 창으로 탭을 보내면
        // 그 탭이 함께 사라진다.
        .filter(|(label, _)| app.get_webview_window(label).is_some())
        .map(|(label, st)| AppWindowInfo {
            label: label.clone(),
            active_project_id: st
                .active
                .and_then(|id| st.order.iter().find(|t| t.id == id))
                .and_then(|t| t.project_id),
            tab_count: st.order.len() as u32,
        })
        .collect();
    // 라벨 순 — 메뉴 항목이 열 때마다 뒤바뀌면 손이 자리를 못 외운다.
    out.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(out)
}

/// 드래그가 끝났다(또는 취소됐다) — 겨누던 창의 캐럿을 지운다.
#[tauri::command]
#[specta::specta]
pub async fn tab_drag_end(app: AppHandle) -> Result<(), String> {
    let (left, stray) = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        (reg.unhover(), reg.take_tearing())
    };
    if let Some(prev) = left {
        let _ = TabDragLeave {
            window: prev.clone(),
        }
        .emit_to(&app, &prev);
    }
    // 손에 창이 남은 채로 드래그가 끝났다 — 놓은 것으로 본다. 안 그러면 숨겨진
    // 창이 영영 남고(레지스트리에는 있는데 화면에 없다) 다음 떼어내기도 막힌다.
    if let Some(tear) = stray {
        settle_tear_off(&app, &tear);
    }
    Ok(())
}

// ─── 크롬식 떼어내기 — 탭이 줄을 벗어나면 **창이 된다** ──────────────────────
//
// 고스트가 아니라 진짜 창이다. 크롬이 그렇게 하는 데는 이유가 있다: 떼어낸
// 결과가 곧 창이므로, 놓기 전에 그 창을 그대로 보여 주면 사용자는 결과를 미리
// 보는 게 아니라 **결과를 직접 들고 있는** 것이 된다.
//
// 끌려다니는 동안 그 창은 탭 줄만 그리고 화면 마운트를 붙잡는다(`?tearoff=1`) —
// 남의 창에 도로 합치면 프로젝트 init·워처·자동색인이 아예 시작되지 않는다.

/// 들고 있는 창을 커서 밑으로 옮긴다. 커서는 OS 에서 물리 px 로 받아 그 창의
/// 배율로 나눈다 (결정 2 — 웹뷰 줌에 흔들리지 않는 유일한 좌표계).
fn follow_cursor(app: &AppHandle, tear: &TearOff) {
    let Some(win) = app.get_webview_window(&tear.label) else {
        return;
    };
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let (x, y) = detached_origin((cursor.x, cursor.y), scale, tear.anchor);
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

/// 손을 놓았다 — 평범한 창으로 되돌린다 (다시 보이게 하고, 포커스하고, 프런트의
/// 마운트 보류를 푼다).
fn settle_tear_off(app: &AppHandle, tear: &TearOff) {
    if let Some(win) = app.get_webview_window(&tear.label) {
        let _ = win.show();
    }
    focus_window(app, &tear.label);
    let _ = TearOffSettled {
        window: tear.label.clone(),
    }
    .emit_to(app, &tear.label);
}

/// 탭이 줄을 벗어났다 — **지금** 창으로 떼어내 손에 들려 준다.
///
/// `anchor` 는 창 좌상단에서 커서까지의 거리(논리 px). 이미 들고 있으면 그대로
/// `true` 를 돌려준다(멱등) — 프런트는 프레임마다 부를 수 있다.
///
/// 손에 드는 방법은 창의 탭 수에 따라 둘로 갈린다.
/// - 탭이 둘 이상 — 탭을 빼서 **새 창**을 만든다 (`?tearoff=1`).
/// - 탭이 하나 — **그 창 자체**를 든다 (`carry_whole`). 새 창을 만들면 원본이
///   닫히고 같은 내용의 창이 새로 뜰 뿐인데, 여기서 거절해 버리면 떼어낸 창이
///   드래그로 되돌아올 길 자체가 없어진다 (2026-08-31 회귀).
#[tauri::command]
#[specta::specta]
pub async fn begin_tear_off(
    app: AppHandle,
    tab_id: u32,
    anchor_x: f64,
    anchor_y: f64,
) -> Result<bool, String> {
    let held = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.tearing()
    };
    if held.is_some() {
        return Ok(true);
    }

    // 창째로 들 경우를 대비해 **먼저** 창 자리를 재 둔다 — 무르면 되돌릴 곳이고,
    // 커서를 따라 옮기기 시작하면 두 번 다시 알 수 없다.
    let home = {
        let state = app.state::<WindowTabs>();
        let label = state.lock().locate_tab(tab_id);
        label
            .and_then(|l| app.get_webview_window(&l))
            .and_then(|w| {
                let sf = match w.scale_factor() {
                    Ok(sf) if sf > 0.0 => sf,
                    _ => 1.0,
                };
                w.outer_position()
                    .ok()
                    .map(|p| (f64::from(p.x) / sf, f64::from(p.y) / sf))
            })
    };
    let carried = match home {
        Some(home) => {
            let state = app.state::<WindowTabs>();
            let mut reg = state.lock();
            reg.carry_whole(tab_id, (anchor_x, anchor_y), home)
        }
        // 웹뷰를 못 찾았거나 자리를 못 읽었다 — 창째로 들 수 없다. 탭이 하나뿐인
        // 창이면 아래에서 `false` 로 떨어진다.
        None => false,
    };
    if carried {
        // 잡았던 자리가 곧바로 커서 밑에 오게 한다 — 새 창을 만드는 쪽이
        // `position` 으로 하는 일과 같다 (첫 틱까지 창이 멈춰 있으면 튄다).
        let tear = {
            let state = app.state::<WindowTabs>();
            let reg = state.lock();
            reg.tearing()
        };
        if let Some(tear) = tear {
            follow_cursor(&app, &tear);
        }
        return Ok(true);
    }

    let taken = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        let Some(label) = reg.locate_tab(tab_id) else {
            return Ok(false);
        };
        let st = reg.get(&label).ok_or("창을 찾지 못했습니다")?;
        // 여기까지 왔는데 탭이 하나면 `carry_whole` 이 창 자리를 못 읽었다는 뜻
        // (웹뷰가 사라지는 중). 새 창을 만들어 봐야 원본이 닫히고 같은 내용이
        // 다시 뜰 뿐이라 순수 손해이므로, 그냥 이 줄의 드래그로 남긴다.
        if st.order.len() <= 1 {
            return Ok(false);
        }
        let index = st.order.iter().position(|t| t.id == tab_id).unwrap_or(0);
        reg.remove_tab(tab_id)
            .map(|(source, project_id, _)| (source, project_id, index))
    };
    let Some((source, project_id, index)) = taken else {
        return Ok(false);
    };
    broadcast(&app, &source).await;

    let scale = app
        .get_webview_window(&source)
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let at = app
        .cursor_position()
        .ok()
        .map(|c| detached_origin((c.x, c.y), scale, (anchor_x, anchor_y)));

    let label = create_window(&app, project_id, None, at, true).await?;
    {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        // 새 창 안에서 이 탭은 **새 id** 로 앉아 있다 — 그걸 기억해야 놓기·무르기가
        // 실제로 그 탭에 가 닿는다.
        let Some(fresh) = reg
            .get(&label)
            .and_then(|st| st.order.first())
            .map(|t| t.id)
        else {
            return Ok(false);
        };
        reg.tearing = Some(TearOff {
            label,
            tab_id: fresh,
            anchor: (anchor_x, anchor_y),
            source,
            index,
            // 새로 만든 창이라 되돌릴 자리가 없다 — 무르면 통째로 닫힌다.
            home: None,
            hidden: false,
        });
    }
    Ok(true)
}

/// 손을 놓았다. 남의 스트립을 겨누고 있었으면 그리로 합치고(`true`), 아니면
/// 그 자리에 창으로 남는다(`false`).
///
/// 창째로 들었든(`carry_whole`) 새로 만들어 들었든 마무리는 똑같다 — 합치면
/// `move_tab` 이 원래 창을 비우고 `commit_move` 가 그 창을 닫는다. 그래서
/// **떼어낸 창을 도로 끌어다 붙이면 창이 하나 줄어든다** (크롬과 같다).
#[tauri::command]
#[specta::specta]
pub async fn drop_tear_off(app: AppHandle) -> Result<bool, String> {
    let Some(tear) = ({
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.take_tearing()
    }) else {
        return Ok(false);
    };
    let hint = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.take_drop_hint()
    };
    if let Some((target, index)) = hint {
        // 인덱스가 아직 안 왔으면 맨 뒤 — 창을 가로질러 온 탭이 사라지는 것보다 낫다.
        if commit_move(&app, tear.tab_id, &target, index.unwrap_or(usize::MAX)).await {
            let _ = TabDragLeave {
                window: target.clone(),
            }
            .emit_to(&app, &target);
            return Ok(true);
        }
    }
    // 못 합쳤다 — 숨겨 두었을 수 있으므로 반드시 되살린다.
    settle_tear_off(&app, &tear);
    Ok(false)
}

/// Escape — 떼어낸 창을 물리고 **원래대로** 돌려놓는다.
///
/// 무엇을 되돌리는지는 어떻게 들었는지에 달렸다.
/// - 새 창으로 들었으면 탭을 원래 창의 원래 자리로 옮긴다. 빈 창은
///   `commit_move` 가 닫는다. 원래 창이 그새 사라졌으면 되돌릴 곳이 없으므로
///   그냥 놓은 것으로 본다.
/// - 창째로 들었으면(`home`) 옮길 탭이 없다 — 되돌릴 것은 **창 자리**다.
///   여기서 `commit_move` 로 가면 같은 창 안 재배열이라 성공해 버려서, 겨누는
///   동안 숨겨 둔 창이 숨은 채로 남는다 (`settle_tear_off` 가 안 불린다).
#[tauri::command]
#[specta::specta]
pub async fn cancel_tear_off(app: AppHandle) -> Result<(), String> {
    let Some(tear) = ({
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.unhover();
        reg.take_tearing()
    }) else {
        return Ok(());
    };
    if let Some((x, y)) = tear.home {
        if let Some(win) = app.get_webview_window(&tear.label) {
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
        settle_tear_off(&app, &tear);
        return Ok(());
    }
    if commit_move(&app, tear.tab_id, &tear.source, tear.index).await {
        return Ok(());
    }
    settle_tear_off(&app, &tear);
    Ok(())
}

/// 커서 밑에 있는 **다른** 앱 창의 스트립 — (라벨, 창 안쪽 x·논리 px).
///
/// 커서는 OS 에서 물리 px 로 받아 창마다 그 창의 배율로 나눈다. 모니터마다
/// 배율이 다른 환경에서도 맞는 유일한 변환이다.
fn strip_under_cursor(app: &AppHandle, source: &str, band: f64) -> Option<(String, f64)> {
    let cursor = app.cursor_position().ok()?;
    let known: Vec<String> = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let mut labels: Vec<String> = reg
            .windows
            .keys()
            .filter(|l| l.as_str() != source)
            .cloned()
            .collect();
        // 겹친 창의 앞뒤는 알 수 없다 — 포커스된 창을 먼저 보고, 나머지는 라벨
        // 순으로 본다. 어느 쪽이든 **같은 상황에서 같은 답**이 나와야 한다.
        labels.sort();
        labels
    };
    let mut fallback = None;
    for label in known {
        let Some(win) = app.get_webview_window(&label) else {
            continue;
        };
        if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
            continue;
        }
        let (Ok(pos), Ok(size), Ok(sf)) =
            (win.inner_position(), win.inner_size(), win.scale_factor())
        else {
            continue;
        };
        let lx = (cursor.x - pos.x as f64) / sf;
        let ly = (cursor.y - pos.y as f64) / sf;
        if !hits_tab_strip(lx, ly, size.width as f64 / sf, band) {
            continue;
        }
        if win.is_focused().unwrap_or(false) {
            return Some((label, lx));
        }
        fallback.get_or_insert((label, lx));
    }
    fallback
}

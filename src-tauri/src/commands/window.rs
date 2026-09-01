//! 창·탭 관리 — SSOT: docs/20260811_three-features/01b-chrome-tabs.md.
//!
//! 창 모델 (크롬식 탭): 창은 **탭의 집합**이고, 탭은 두 종류다.
//!
//! - **시작 탭** — 프로젝트 메인 화면(목록·추가·관리). Chrome 의 새 탭 페이지.
//!   여기서 프로젝트를 고르면 **그 자리에서** 프로젝트 탭이 된다.
//! - **프로젝트 탭** — 그 프로젝트의 전체 셸.
//!
//! 불변식:
//! - I1 — 프로젝트당 탭 하나, **전역 유일**. 이미 열려 있으면 그 창을 포커스하고
//!   그 탭을 활성화한다. (덕분에 `OculpmManager` 가 watcher refcount 없이
//!   프로젝트당 엔트리 하나를 유지할 수 있다 — D2)
//! - I3 — **프로젝트** 탭의 프로젝트는 탭의 수명 동안 바뀌지 않는다. 시작 탭이
//!   프로젝트 탭으로 승격하는 것은 한 방향뿐이다.
//!
//! 라벨에서 프로젝트를 읽을 수 없으므로 **이 모듈이 레지스트리를 소유**한다.
//! 프런트는 `WindowTabsChanged` 로 미러링만 한다.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_specta::Event;

/// 추가로 만드는 창의 라벨 접두사. `tauri-plugin-window-state` 가 라벨 기준으로
/// 위치·크기를 기억하므로 `win-1`, `win-2` … 는 재실행 사이에도 재사용된다.
pub const WINDOW_PREFIX: &str = "win-";
/// `tauri.conf.json` 이 만드는 첫 창. **특별하지 않다** — 다른 창과 똑같이
/// 탭을 물고, 똑같이 닫힌다 (예전 "런처 전용 창" 개념은 시작 탭이 대체했다).
pub const FIRST_WINDOW: &str = "main";

/// 기본 크기·최소 크기는 `tauri.conf.json` 의 첫 창과 맞춘다.
const WINDOW_W: f64 = 1150.0;
const WINDOW_H: f64 = 780.0;
const WINDOW_MIN_W: f64 = 960.0;
const WINDOW_MIN_H: f64 = 640.0;

/// 분리 터미널 창 — 셸 하나가 편한 크기. 탭 창보다 훨씬 작아도 된다
/// (사이드바도 탭 스트립도 없다).
const TERM_WINDOW_W: f64 = 820.0;
const TERM_WINDOW_H: f64 = 520.0;
const TERM_WINDOW_MIN_W: f64 = 380.0;
const TERM_WINDOW_MIN_H: f64 = 240.0;

pub fn window_label(n: u32) -> String {
    format!("{WINDOW_PREFIX}{n}")
}

/// 탭을 물 수 있는 창인가 — 트레이 팝오버(`tray`)만 제외된다.
pub fn is_app_window(label: &str) -> bool {
    label == FIRST_WINDOW
        || label
            .strip_prefix(WINDOW_PREFIX)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

/// 창 위쪽 어디까지를 "탭 스트립" 으로 볼지 넘어서는 여유 (논리 px).
///
/// 창 테두리 바로 위까지 끌고 갔을 때도 놓을 수 있어야 한다 — 크롬도 스트립
/// 위쪽으로 한 뼘 넘어간 커서를 받아 준다. 아래로는 여유를 주지 않는다:
/// 스트립 밑은 콘텐츠라 거기서 놓이면 "어디에 붙었지?" 가 된다.
pub const STRIP_OVERSHOOT: f64 = 10.0;

/// 창 안쪽 좌표(논리 px)가 탭 스트립 띠 안인가.
///
/// `band` 는 스트립 높이(논리 px)로, 프런트가 자기 CSS 높이 × 웹뷰 줌으로 재서
/// 넘겨준다 — Rust 가 CSS 를 알 필요도, 줌을 추적할 필요도 없다.
pub fn hits_tab_strip(local_x: f64, local_y: f64, width: f64, band: f64) -> bool {
    local_x >= 0.0 && local_x <= width && local_y >= -STRIP_OVERSHOOT && local_y <= band
}

/// PTY 세션 id 접두사. **프로젝트** 기준이라 탭이 창을 옮겨 다녀도 유효하다 —
/// 그래서 떼어낸 탭의 셸이 죽지 않는다. 끝의 `-` 덕분에 `p1-` 이 `p12-…` 를
/// 잡아먹지 않는다. 프런트의 `TerminalSurface.newId` 와 짝이다.
pub fn pty_prefix_for(project_id: u32) -> String {
    format!("p{project_id}-")
}

/// 분리한 **터미널 전용 창**의 라벨 접두사 (2026-08-15 터미널 도크).
///
/// 탭을 물지 않는 창이라 `is_app_window` 가 일부러 false 를 준다 — 탭
/// 레지스트리·⌘W·"마지막 창" 판정이 이 창을 탭 창으로 오해하면 안 된다.
/// 프로젝트당 하나이므로 라벨에 프로젝트 id 를 박는다 (I1 과 같은 규율).
pub const TERM_WINDOW_PREFIX: &str = "term-";

pub fn terminal_window_label(project_id: u32) -> String {
    format!("{TERM_WINDOW_PREFIX}{project_id}")
}

/// 라벨이 터미널 창이면 그 프로젝트 id. 아니면 `None`.
pub fn terminal_window_project(label: &str) -> Option<u32> {
    label.strip_prefix(TERM_WINDOW_PREFIX)?.parse().ok()
}

// ─── 레지스트리 ──────────────────────────────────────────────────────────────

/// 탭 하나. `project_id` 가 `None` 이면 시작 탭.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tab {
    pub id: u32,
    pub project_id: Option<u32>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct WindowState {
    pub order: Vec<Tab>,
    pub active: Option<u32>,
}

/// 끌려다니는 중인 떼어낸 창.
#[derive(Debug, Clone, PartialEq)]
pub struct TearOff {
    pub label: String,
    /// 떼어낸 창 **안에서의** 탭 id.
    ///
    /// 끌던 것과 **다른 값**이다 — 창을 만들 때 탭이 새로 발급되기 때문이다
    /// (`reserve` → `register` → `mint`). 프런트가 들고 있던 옛 id 로 마무리를
    /// 부르면 그 탭은 어디에도 없어 조용히 아무 일도 일어나지 않는다. 그래서
    /// 놓기·무르기는 id 를 **받지 않고** 여기서 읽는다.
    pub tab_id: u32,
    /// 창 좌상단에서 커서까지의 거리 (논리 px) — 매 틱 `cursor - anchor` 로 옮긴다.
    pub anchor: (f64, f64),
    /// 나온 창과 그 자리 — Escape 로 되돌릴 때 쓴다.
    pub source: String,
    pub index: usize,
    /// **창째로** 들었으면 그 창의 원래 좌상단 (논리 px). 탭이 하나뿐인 창은
    /// 새 창을 만들지 않고 그 창 자체가 손에 들리므로(`label == source`), 무를
    /// 때 되돌릴 것이 탭 자리가 아니라 **창 자리**다.
    ///
    /// 새 창을 만들어 든 경우에는 `None` — 무르면 그 창이 통째로 닫힌다.
    pub home: Option<(f64, f64)>,
    /// 남의 스트립을 겨누는 중이라 숨겨 두었나 (크롬의 합치기 미리보기).
    pub hidden: bool,
}

/// 창 → 탭 집합. 순수 자료구조라 Tauri 런타임 없이 단위 테스트할 수 있다.
#[derive(Debug, Default)]
pub struct Registry {
    windows: HashMap<String, WindowState>,
    /// 터미널을 창으로 떼어낸 프로젝트 (2026-08-15). 탭과 **함께** PTY 의
    /// 소유자를 이룬다 — 둘 다 없어져야 셸을 죽인다 (`release_project`).
    terminal_windows: HashSet<u32>,
    /// 새 탭이 어느 창에 붙을지 결정한다. 창이 포커스될 때마다 갱신.
    last_focused: Option<String>,
    /// 창 **간** 드래그가 지금 겨누는 자리 — (대상 창, 삽입 인덱스).
    ///
    /// 인덱스는 대상 창의 프런트가 자기 탭 기하를 보고 계산해 되돌려 준다
    /// (Rust 는 탭 폭을 모른다 — CSS 가 정한다). 아직 안 왔으면 `None` = 맨 뒤.
    /// 드래그가 끝나거나 스트립을 벗어나면 지워진다.
    drop_hint: Option<(String, Option<usize>)>,
    /// 지금 **손에 들려 있는** 창 — 탭을 스트립 밖으로 끌어 떼어낸 진짜 창이다.
    ///
    /// 크롬과 같은 규약: 탭이 줄을 벗어나는 순간 창이 되어 커서를 따라오고,
    /// 남은 탭들은 그 자리에서 줄을 메운다. 놓기 전까지는 되돌릴 수 있어야
    /// 하므로 어디서 나왔는지(`source`·`index`)를 함께 기억한다.
    tearing: Option<TearOff>,
    next_window: u32,
    next_tab: u32,
}

impl Registry {
    fn mint(&mut self, project_id: Option<u32>) -> Tab {
        self.next_tab += 1;
        Tab {
            id: self.next_tab,
            project_id,
        }
    }

    /// 이 프로젝트가 열려 있는 (창, 탭 id) — I1 이라 있어야 최대 하나.
    pub fn locate_project(&self, project_id: u32) -> Option<(String, u32)> {
        self.windows.iter().find_map(|(label, st)| {
            st.order
                .iter()
                .find(|t| t.project_id == Some(project_id))
                .map(|t| (label.clone(), t.id))
        })
    }

    /// 진단용 한 줄 요약 — `win-1:[3(p=7),4(start)]` 꼴.
    ///
    /// 닫기가 "아무 일도 안 하는" 증상은 프런트가 든 탭 id 와 레지스트리가 아는
    /// 것이 어긋났을 때 난다. 그때 알아야 할 것은 **양쪽 값**이라, 로그에 기대는
    /// 순간 이 요약이 없으면 재현을 또 한 번 시켜야 한다.
    pub fn summary(&self) -> String {
        let mut labels: Vec<&String> = self.windows.keys().collect();
        labels.sort();
        labels
            .iter()
            .map(|label| {
                let tabs = self.windows[*label]
                    .order
                    .iter()
                    .map(|t| match t.project_id {
                        Some(pid) => format!("{}(p={pid})", t.id),
                        None => format!("{}(start)", t.id),
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{label}:[{tabs}]")
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn locate_tab(&self, tab_id: u32) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, st)| st.order.iter().any(|t| t.id == tab_id))
            .map(|(label, _)| label.clone())
    }

    pub fn get(&self, label: &str) -> Option<&WindowState> {
        self.windows.get(label)
    }

    /// 열려 있는 전체 프로젝트 id (시작 화면의 "열림" 배지). 정렬해 돌려준다.
    pub fn all_open_projects(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self
            .windows
            .values()
            .flat_map(|st| st.order.iter().filter_map(|t| t.project_id))
            .collect();
        ids.sort_unstable();
        ids
    }

    /// 창을 등록한다. `main` 처럼 이미 존재하는 창을 시작 탭 하나로 여는 데도 쓴다.
    fn register(&mut self, label: &str, project_id: Option<u32>) -> u32 {
        let tab = self.mint(project_id);
        self.windows.insert(
            label.to_string(),
            WindowState {
                order: vec![tab],
                active: Some(tab.id),
            },
        );
        self.last_focused = Some(label.to_string());
        tab.id
    }

    /// 새 창 라벨을 발급하고 탭 하나와 함께 등록한다.
    fn reserve(&mut self, project_id: Option<u32>) -> String {
        self.next_window += 1;
        let label = window_label(self.next_window);
        self.register(&label, project_id);
        label
    }

    /// 이미 있는 창의 끝에 탭을 붙이고 활성화한다.
    fn append(&mut self, label: &str, project_id: Option<u32>) -> u32 {
        let tab = self.mint(project_id);
        let st = self.windows.entry(label.to_string()).or_default();
        st.order.push(tab);
        st.active = Some(tab.id);
        tab.id
    }

    /// 시작 탭을 **제자리에서** 프로젝트 탭으로 승격한다 (Chrome 의 새 탭에서
    /// 주소를 여는 것과 같다 — 탭이 옮겨가지 않고 내용만 바뀐다).
    fn assign_project(&mut self, tab_id: u32, project_id: u32) -> Option<String> {
        let label = self.locate_tab(tab_id)?;
        let st = self.windows.get_mut(&label)?;
        let tab = st.order.iter_mut().find(|t| t.id == tab_id)?;
        tab.project_id = Some(project_id);
        st.active = Some(tab_id);
        Some(label)
    }

    /// 탭 제거. 반환값은 (창 라벨, 사라진 프로젝트, 창이 비었는가).
    ///
    /// 활성 탭을 지우면 Chrome 처럼 **오른쪽 이웃**으로 넘어가고, 없으면 왼쪽.
    fn remove_tab(&mut self, tab_id: u32) -> Option<(String, Option<u32>, bool)> {
        let label = self.locate_tab(tab_id)?;
        let st = self.windows.get_mut(&label)?;
        let idx = st.order.iter().position(|t| t.id == tab_id)?;
        let gone = st.order.remove(idx);
        if st.active == Some(tab_id) {
            st.active = st.order.get(idx).or_else(|| st.order.last()).map(|t| t.id);
        }
        let empty = st.order.is_empty();
        if empty {
            self.windows.remove(&label);
        }
        Some((label, gone.project_id, empty))
    }

    /// 탭을 **다른 창으로** 옮긴다 (창 간 드래그 = 다시 붙이기).
    ///
    /// `remove_tab` + `append` 로는 안 되는 이유가 둘 있다: ① 인덱스를 지정해
    /// 끼워야 하고(크롬은 커서 자리에 꽂는다), ② 원래 창이 비어도 **프로젝트를
    /// 놓아주면 안 된다** — 탭은 살아서 다른 창에 있으므로 PTY·워처가 그대로여야
    /// 한다. `close_tab` 경로를 재사용하면 그 자리에서 `release_project` 가 돌아
    /// 셸이 죽는다.
    ///
    /// 반환값은 (원래 창, 그 창이 비었는가). 같은 창으로 옮기는 것은 순서
    /// 변경과 같으므로 여기서도 성립한다.
    fn move_tab(&mut self, tab_id: u32, target: &str, index: usize) -> Option<(String, bool)> {
        // 대상 창이 닫히는 중일 수 있다 — 없으면 탭을 건드리지 않는다.
        if !self.windows.contains_key(target) {
            return None;
        }
        let source = self.locate_tab(tab_id)?;
        let st = self.windows.get_mut(&source)?;
        let pos = st.order.iter().position(|t| t.id == tab_id)?;
        let tab = st.order.remove(pos);
        if st.active == Some(tab_id) {
            st.active = st.order.get(pos).or_else(|| st.order.last()).map(|t| t.id);
        }
        // 같은 창 안의 이동이면 곧바로 다시 넣으므로 "비었다" 가 아니다.
        let emptied = st.order.is_empty() && source != target;
        if emptied {
            self.windows.remove(&source);
        }
        let dst = self.windows.get_mut(target)?;
        let at = index.min(dst.order.len());
        dst.order.insert(at, tab);
        dst.active = Some(tab_id);
        self.last_focused = Some(target.to_string());
        Some((source, emptied))
    }

    /// 드래그가 이 창의 스트립 위에 있다고 기록한다. 대상이 바뀌면 인덱스는
    /// 버린다 (남의 창에서 잰 값이라 의미가 없다). 반환값은 **직전 대상** —
    /// 바뀌었을 때만 `Some` 이라, 떠난 창에만 정확히 한 번 알릴 수 있다.
    fn hover(&mut self, target: &str) -> Option<String> {
        match self.drop_hint.take() {
            Some((prev, index)) if prev == target => {
                self.drop_hint = Some((prev, index));
                None
            }
            prev => {
                self.drop_hint = Some((target.to_string(), None));
                prev.map(|(label, _)| label)
            }
        }
    }

    /// 지금 겨누고 있는 창 — `hover` 를 부르기 **전**에 물어봐야 "처음 들어섰다"
    /// 를 알 수 있다. `hover` 의 반환값(직전 대상)만으로는 첫 진입과 제자리
    /// 유지가 둘 다 `None` 이라 구분되지 않는다.
    fn hovering(&self) -> Option<&str> {
        self.drop_hint.as_ref().map(|(label, _)| label.as_str())
    }

    /// 스트립을 벗어났다 — 겨누던 창을 알려 준다 (캐럿을 지우게).
    fn unhover(&mut self) -> Option<String> {
        self.drop_hint.take().map(|(label, _)| label)
    }

    /// 대상 창이 계산한 삽입 인덱스. 겨누는 창이 아니면 무시한다 — 늦게 도착한
    /// 보고가 다음 대상의 자리를 덮어쓰지 못하게.
    fn note_drop_index(&mut self, window: &str, index: usize) {
        if let Some((label, slot)) = self.drop_hint.as_mut() {
            if label == window {
                *slot = Some(index);
            }
        }
    }

    fn take_drop_hint(&mut self) -> Option<(String, Option<usize>)> {
        self.drop_hint.take()
    }

    /// 탭이 **하나뿐인** 창을 창째로 손에 든다 (크롬: 마지막 탭을 끌면 창이 끌린다).
    ///
    /// 새 창을 만들지 않는다 — 만들면 원본 창이 닫히고 같은 내용의 창이 새로
    /// 뜰 뿐이라 순수 손해이고, 그동안 프로젝트가 통째로 다시 마운트된다.
    /// 대신 그 창 자체를 `tearing` 에 앉힌다: 이후 `follow_cursor` 가 그 창을
    /// 옮기고 `drop_tear_off` 가 남의 창으로 합쳐 준다 (`move_tab` 이 빈 창을
    /// 정리한다). 여기서 거절하면 **떼어낸 창이 되돌아올 길이 사라진다.**
    ///
    /// 탭이 둘 이상이면 아무것도 하지 않고 `false` — 그쪽은 새 창을 만든다.
    fn carry_whole(&mut self, tab_id: u32, anchor: (f64, f64), home: (f64, f64)) -> bool {
        let Some(label) = self.locate_tab(tab_id) else {
            return false;
        };
        let Some(st) = self.windows.get(&label) else {
            return false;
        };
        if st.order.len() > 1 {
            return false;
        }
        self.tearing = Some(TearOff {
            label: label.clone(),
            tab_id,
            anchor,
            source: label,
            index: 0,
            home: Some(home),
            hidden: false,
        });
        true
    }

    fn tearing(&self) -> Option<TearOff> {
        self.tearing.clone()
    }

    fn take_tearing(&mut self) -> Option<TearOff> {
        self.tearing.take()
    }

    /// 겨누는 창이 생기면 들고 있는 창을 숨긴다 (크롬의 합치기 미리보기).
    /// 반환값은 **상태가 바뀌었을 때만** `Some` — 매 틱 hide/show 를 부르면
    /// 창이 깜빡인다.
    fn set_tear_hidden(&mut self, hidden: bool) -> Option<bool> {
        let tear = self.tearing.as_mut()?;
        if tear.hidden == hidden {
            return None;
        }
        tear.hidden = hidden;
        Some(hidden)
    }

    fn activate(&mut self, tab_id: u32) -> Option<String> {
        let label = self.locate_tab(tab_id)?;
        self.windows.get_mut(&label)?.active = Some(tab_id);
        self.last_focused = Some(label.clone());
        Some(label)
    }

    /// 요청된 순서를 **현재 탭 집합으로 걸러** 적용한다 — 프런트가 낡은 목록을
    /// 보냈을 때 탭이 사라지거나 남의 탭이 끼어드는 걸 막는다.
    fn reorder(&mut self, label: &str, requested: &[u32]) -> bool {
        let Some(st) = self.windows.get_mut(label) else {
            return false;
        };
        let mut next: Vec<Tab> = Vec::with_capacity(st.order.len());
        for id in requested {
            if let Some(tab) = st.order.iter().find(|t| t.id == *id) {
                if !next.iter().any(|t| t.id == tab.id) {
                    next.push(*tab);
                }
            }
        }
        // 요청에서 빠진 탭은 잃지 않고 뒤에 붙인다.
        for tab in &st.order {
            if !next.iter().any(|t| t.id == tab.id) {
                next.push(*tab);
            }
        }
        let changed = next != st.order;
        st.order = next;
        changed
    }

    fn note_focus(&mut self, label: &str) {
        if self.windows.contains_key(label) {
            self.last_focused = Some(label.to_string());
        }
    }

    /// 터미널 창이 떠 있는 프로젝트 (정렬). 프런트의 자리표시자 판정에 쓴다.
    pub fn terminal_window_projects(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.terminal_windows.iter().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// 이 프로젝트의 PTY 를 아직 쓰고 있는 곳이 있는가 — 탭이든 터미널 창이든.
    ///
    /// PTY 정리의 유일한 판정이다. 탭만 보고 죽이던 시절에는, 터미널을 창으로
    /// 떼어낸 뒤 프로젝트 탭을 닫으면 분리 창 안의 셸이 통째로 사라졌다.
    fn project_in_use(&self, project_id: u32) -> bool {
        self.terminal_windows.contains(&project_id) || self.locate_project(project_id).is_some()
    }

    /// 새 탭이 붙을 창 — 마지막으로 포커스된 창.
    fn preferred_window(&self) -> Option<String> {
        self.last_focused
            .as_ref()
            .filter(|l| self.windows.contains_key(*l))
            .cloned()
            .or_else(|| self.windows.keys().next().cloned())
    }
}

#[derive(Default)]
pub struct WindowTabs(Mutex<Registry>);

impl WindowTabs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

// ─── 이벤트 / DTO ────────────────────────────────────────────────────────────

/// 탭 스트립이 그릴 정보. 시작 탭은 `project_id: None` 이고 이름은 프런트가
/// 사전에서 붙인다 (백엔드가 UI 문자열을 만들지 않는다).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TabInfo {
    pub tab_id: u32,
    pub project_id: Option<u32>,
    pub name: String,
    pub root_path: String,
    /// 프로젝트 겉모습 — 탭도 카드와 같은 아이콘·색으로 그린다. 둘 다 id 이고
    /// `None` 이면 프런트가 이름에서 유도한다 (카드와 같은 규칙).
    pub icon: Option<String>,
    pub color: Option<String>,
}

/// 탭을 옮길 수 있는 창 하나 (메뉴용). 이름은 프런트가 붙인다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AppWindowInfo {
    pub label: String,
    /// 그 창에서 지금 보이는 탭의 프로젝트. 시작 탭이면 `None`.
    pub active_project_id: Option<u32>,
    pub tab_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct WindowTabsSnapshot {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u32>,
}

/// 한 창의 탭 구성이 바뀌었다 — 그 창의 프런트가 스트립을 다시 그린다.
/// 이름까지 실어 보내므로 프런트는 후속 조회가 필요 없다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct WindowTabsChanged {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u32>,
}

/// ⌘W 가 눌렸다 — **닫을 대상을 프런트가 고른다**.
///
/// 예전에는 Rust 가 곧장 탭을 닫았다. 그런데 화면 안에 또 닫을 것이 생겼다
/// (Claude Code 의 세션 탭): 사용자는 브라우저처럼 "안쪽부터" 닫히기를 기대한다.
/// 무엇이 열려 있는지는 프런트만 아는 사실이라 판단도 그쪽이 한다.
///
/// 프런트가 안 듣고 있으면 ⌘W 는 아무 일도 하지 않는다 — 창을 닫는 길은
/// ⇧⌘W(Close Window)에 그대로 남아 있고, 그쪽은 Rust 가 직접 처리한다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct CloseIntent {
    pub window: String,
    /// 프런트가 아무 것도 소비하지 않으면 닫을 탭.
    pub tab: Option<u32>,
}

/// ⌘T 가 눌렸다 — **무엇을 새로 열지 프런트가 고른다** (2026-09-01).
///
/// `CloseIntent` 와 같은 사정이다: 메뉴 액셀러레이터라 macOS 가 웹뷰보다 먼저
/// 먹어치우고, 그래서 터미널이 걸어 둔 ⌘T keydown 은 한 번도 돌지 않았다 —
/// 셸에 타이핑하다 ⌘T 를 눌러도 프로젝트 탭이 열렸다. 포커스가 어디에 있는지는
/// 프런트만 아는 사실이므로 판단도 그쪽이 한다.
///
/// 아무도 소비하지 않으면 창이 평소대로 **시작 탭**을 연다 (프런트의 기본값).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct NewTabIntent {
    pub window: String,
}

/// 어디든 열린 프로젝트 집합이 바뀌었다 — 시작 탭의 "열림" 배지.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ProjectWindowsChanged {
    pub open: Vec<u32>,
}

/// 터미널을 창으로 떼어낸 프로젝트 집합이 바뀌었다 (2026-08-15).
///
/// 셸의 도크·터미널 화면은 이걸 듣고 자리표시자로 바뀐다. 사용자가 분리 창을
/// OS 의 닫기 버튼으로 닫아도 같은 길로 되돌아온다 — 프런트가 자기 상태를
/// 진실로 삼지 않는 이유다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TerminalWindowsChanged {
    pub open: Vec<u32>,
}

/// 다른 창에서 끌고 온 탭이 **이 창의 스트립 위**에 있다 (창 간 드래그).
///
/// `x` 는 창 안쪽 왼쪽 위 기준 **논리 px**. 받는 쪽이 웹뷰 줌으로 나눠 CSS px 로
/// 바꾼 뒤, 자기 탭 기하로 삽입 자리를 계산해 캐럿을 그리고 그 인덱스를
/// `tab_drop_hint` 로 되돌려 준다 — Rust 는 탭 폭을 모르기 때문이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TabDragOver {
    pub window: String,
    pub x: f64,
    /// 끌려오는 탭. 자기 탭이면(같은 창 되돌아오기) 무시할 수 있게 실어 보낸다.
    pub tab_id: u32,
    /// 끌려오는 탭의 겉모습 — **스트립에 처음 들어선 순간에만** 실린다.
    ///
    /// 받는 창은 남의 탭 이름을 알 길이 없다(레지스트리도 프로젝트 DB 도 그
    /// 창의 것이 아니다). 그런데 자리표시자에 이름이 없으면 "무엇이 오는지"는
    /// 모른 채 "무언가 온다"만 보인다 — 창이 셋이면 그게 곧 오조준이 된다.
    ///
    /// 매번 싣지 않는 이유는 값이 DB 조회 한 번이기 때문이다. 포인터는 초당
    /// 수십 번 움직이지만 **겨누는 창이 바뀌는 일**은 드물다. 받는 쪽은 처음
    /// 받은 것을 `TabDragLeave` 까지 들고 있으면 된다.
    pub preview: Option<TabPreview>,
}

/// 끌려오는 탭을 받는 창이 그리기 위한 최소 정보 — 스트립의 탭과 **같은**
/// 재료다(이름·아이콘·색). 프로젝트 id 를 안 싣는 이유는 받는 창이 그것으로
/// 할 수 있는 일이 없어서다: 아직 자기 탭이 아니라 조회해도 남의 것이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TabPreview {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// 시작 탭인가 — 이름이 비어 있고 아이콘이 고정이라 갈래가 필요하다.
    pub is_start: bool,
}

/// 손에 들려 있던 창을 **놓았다** — 이제 평범한 창이다.
///
/// 떼어내는 동안 그 창은 탭 줄만 그리고 화면 마운트를 붙잡고 있었다
/// (`?tearoff=1`). 이 이벤트가 그 손을 놓아 준다 — 프로젝트 init·워처·자동색인이
/// 그때 비로소 돈다. 끌려다니다 남의 창에 합쳐지면 이 이벤트는 오지 않고 창이
/// 그대로 닫히므로, 그 전부가 아예 시작되지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TearOffSettled {
    pub window: String,
}

/// 그 탭이 이 창의 스트립을 벗어났다 (또는 드래그가 끝났다) — 캐럿을 지운다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct TabDragLeave {
    pub window: String,
}

async fn snapshot(app: &AppHandle, label: &str) -> WindowTabsSnapshot {
    let (order, active) = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let st = reg.get(label).cloned().unwrap_or_default();
        (st.order, st.active)
    };
    let db = app.state::<crate::db::Db>();
    let mut tabs = Vec::with_capacity(order.len());
    for tab in order {
        let (name, root_path, icon, color) = match tab.project_id {
            // 프로젝트가 DB 에서 사라졌어도 탭은 그려야 한다 — 이름만 폴백.
            Some(pid) => match db.get_project(pid).await {
                Ok(p) => (p.name, p.root_path, p.icon, p.color),
                Err(_) => (format!("#{pid}"), String::new(), None, None),
            },
            None => (String::new(), String::new(), None, None),
        };
        tabs.push(TabInfo {
            tab_id: tab.id,
            project_id: tab.project_id,
            name,
            root_path,
            icon,
            color,
        });
    }
    WindowTabsSnapshot {
        window: label.to_string(),
        tabs,
        active,
    }
}

/// 창별 변경 + 전역 배지를 함께 알린다.
async fn broadcast(app: &AppHandle, label: &str) {
    let snap = snapshot(app, label).await;
    let _ = WindowTabsChanged {
        window: snap.window.clone(),
        tabs: snap.tabs,
        active: snap.active,
    }
    .emit_to(app, label);
    emit_open_projects(app);
}

fn emit_open_projects(app: &AppHandle) {
    let open = app.state::<WindowTabs>().lock().all_open_projects();
    let _ = ProjectWindowsChanged { open }.emit(app);
}

fn emit_terminal_windows(app: &AppHandle) {
    let open = app.state::<WindowTabs>().lock().terminal_window_projects();
    let _ = TerminalWindowsChanged { open }.emit(app);
}

// ─── 커맨드 ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn open_devtools(webview: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err("DevTools is only available in development builds.".to_string())
    }
}

/// 쿼리 파라미터 값 최소 이스케이프. 신규 의존성 없이, 파라미터를 깨뜨리는
/// 문자(`&` `#` `%` 공백 …)만 퍼센트 인코딩한다. UTF-8 은 바이트 단위로
/// 인코딩되어 프런트의 `decodeURIComponent` 가 그대로 복원한다.
fn encode_query_value(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 새 창의 URL. 탭 집합은 프런트가 마운트 직후 `get_window_tabs` 로 읽지만,
/// 라벨과 딥링크 목적지는 URL 로 실어야 한다 — 갓 만든 창의 프런트는 아직
/// 리스너를 달기 전이라 `emit` 이 유실된다.
fn window_url(label: &str, nav: Option<&crate::tray::TrayNavigate>, tearoff: bool) -> String {
    let mut url = format!("index.html?win={}", encode_query_value(label));
    // 떼어내는 **중**인 창은 탭 줄만 그리고 화면 마운트를 붙잡는다. 끌려다니는
    // 몇백 ms 동안 프로젝트 init·워처·자동색인을 돌릴 이유가 없고, 도로 남의
    // 창에 합치면 그 전부가 낭비가 된다.
    if tearoff {
        url.push_str("&tearoff=1");
    }
    if let Some(nav) = nav {
        url.push_str(&format!("&view={}", encode_query_value(&nav.view)));
        if let Some(entry) = nav.entry_path.as_deref() {
            url.push_str(&format!("&entry={}", encode_query_value(entry)));
        }
    }
    url
}

/// 프로젝트를 탭으로 연다 — I1 이 여기서 강제된다.
///
/// - 이미 어딘가 열려 있으면 그 창을 포커스하고 그 탭을 활성화한다.
/// - `window` 가 지정되면 그 창의 마지막 탭으로 붙인다.
/// - 없으면 마지막으로 포커스된 창에 붙이고, 창이 아예 없으면 새 창.
#[tauri::command]
#[specta::specta]
pub async fn open_project_tab(
    app: AppHandle,
    project_id: u32,
    window: Option<String>,
) -> Result<(), String> {
    open_project_tab_with_nav(&app, project_id, window, None).await
}

pub async fn open_project_tab_with_nav(
    app: &AppHandle,
    project_id: u32,
    window: Option<String>,
    nav: Option<&crate::tray::TrayNavigate>,
) -> Result<(), String> {
    // 상주 모드에서 Dock 아이콘을 내려놨을 수 있다 — 창을 띄우기 전에 되돌린다.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    // ① 이미 열려 있으면 그 창을 포커스하고 탭만 활성화한다 (I1).
    let existing = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.locate_project(project_id)
            .map(|(_, tab_id)| tab_id)
            .and_then(|id| reg.activate(id))
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str())
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ② 붙일 창을 고른다. 레지스트리에는 있는데 창이 이미 죽었으면 새로 만든다.
    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };

    if let Some(label) = target {
        {
            let state = app.state::<WindowTabs>();
            state.lock().append(&label, Some(project_id));
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        if let Some(nav) = nav {
            nav.emit_to(app, label.as_str())
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // ③ 새 창.
    create_window(app, Some(project_id), nav, None, false)
        .await
        .map(|_| ())
}

/// `+` — 시작 탭(프로젝트 메인 화면)을 연다. Chrome 의 새 탭 페이지.
#[tauri::command]
#[specta::specta]
pub async fn new_start_tab(app: AppHandle, window: Option<String>) -> Result<(), String> {
    new_start_tab_inner(&app, window).await
}

pub async fn new_start_tab_inner(app: &AppHandle, window: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let target = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        window
            .filter(|l| reg.get(l).is_some())
            .or_else(|| reg.preferred_window())
            .filter(|l| app.get_webview_window(l).is_some())
    };
    let Some(label) = target else {
        return create_window(app, None, None, None, false)
            .await
            .map(|_| ());
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().append(&label, None);
    }
    focus_window(app, &label);
    broadcast(app, &label).await;
    Ok(())
}

/// 앱 메뉴의 "새 창" — 언제나 새 창을 만든다 (탭을 붙이지 않는다).
pub async fn new_window_inner(app: &AppHandle) -> Result<(), String> {
    create_window(app, None, None, None, false)
        .await
        .map(|_| ())
}

/// 시작 탭에서 프로젝트를 골랐다 — **그 자리에서** 프로젝트 탭이 된다.
/// 단, 그 프로젝트가 이미 다른 탭에 열려 있으면 (I1) 그쪽을 활성화하고
/// 시작 탭은 그대로 둔다.
#[tauri::command]
#[specta::specta]
pub async fn set_tab_project(app: AppHandle, tab_id: u32, project_id: u32) -> Result<(), String> {
    let already = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.locate_project(project_id)
    };
    if let Some((label, existing_tab)) = already {
        if existing_tab != tab_id {
            let state = app.state::<WindowTabs>();
            state.lock().activate(existing_tab);
            focus_window(&app, &label);
            broadcast(&app, &label).await;
            return Ok(());
        }
    }
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.assign_project(tab_id, project_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

/// **유령 창**인가 — 웹뷰는 살아 있는데 레지스트리가 모르는 앱 창.
///
/// 이 상태의 창은 어떤 조작으로도 닫히지 않는다. 탭 × 는 "모르는 탭" 으로
/// 떨어지고, ⌘W 는 `active_tab_of` 가 `None` 이라 프런트가 걸러 내며, 남는
/// 길은 OS 빨간 버튼뿐이다. 판정을 순수 함수로 빼 두면 런타임 없이 못 박을 수
/// 있다 — 이 조건이 느슨해지면 **멀쩡한 창을 닫는** 반대편 사고가 된다.
fn ghost_window(reg: &Registry, asking: Option<&str>) -> Option<String> {
    let label = asking?;
    // 터미널 창·트레이는 애초에 탭 레지스트리 밖에 산다 — 유령이 아니다.
    if !is_app_window(label) || reg.get(label).is_some() {
        return None;
    }
    Some(label.to_string())
}

/// 탭을 닫는다. 창의 마지막 탭이면 창도 닫는다 (Chrome 과 같다).
///
/// `asking` 은 Tauri 가 주입하는 **호출한 창**이다 (프런트는 안 넘긴다). 요청한
/// 탭이 레지스트리에 없을 때 그 창이 유령인지 판단하는 데 쓴다 — 아래 참조.
#[tauri::command]
#[specta::specta]
pub async fn close_tab(
    app: AppHandle,
    asking: tauri::WebviewWindow,
    tab_id: u32,
) -> Result<(), String> {
    close_tab_from(&app, Some(asking.label()), tab_id).await
}

async fn close_tab_from(app: &AppHandle, asking: Option<&str>, tab_id: u32) -> Result<(), String> {
    let removed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.remove_tab(tab_id)
    };
    let Some((label, project_id, emptied)) = removed else {
        // 여기가 "닫기 버튼이 안 먹는다" 의 유일하게 남은 조용한 갈래다 (2026-08-29).
        // 프런트가 든 탭 id 를 레지스트리가 모르면 탭도 창도 건드리지 않고 Ok 를
        // 냈다 — 화면에는 아무 변화도 아무 메시지도 없다. Err 로 올리지는 않는다:
        // × 를 두 번 눌렀을 때처럼 **이미 닫힌 탭**을 다시 닫는 정상 경로도 여기로
        // 오기 때문이다. 대신 양쪽 값을 로그에 남겨 다음 재현에서 갈리게 한다.
        let (known, ghost) = {
            let state = app.state::<WindowTabs>();
            let reg = state.lock();
            // **유령 창** — 웹뷰는 살아 있는데 레지스트리에서 빠진 창.
            // 이 상태의 창은 어떤 조작으로도 닫히지 않는다: 탭 × 는 여기(모르는
            // 탭)로 떨어지고, ⌘W 는 `active_tab_of` 가 None 이라 프런트가 걸러
            // 내며, 남는 길은 OS 빨간 버튼뿐이다. 사용자가 요청한 일은 "이 창을
            // 닫는 것" 이고 레지스트리에 지킬 것도 없으니, 그대로 닫아 준다.
            (reg.summary(), ghost_window(&reg, asking))
        };
        tracing::warn!(
            tab_id,
            asking = asking.unwrap_or("-"),
            ghost = ghost.is_some(),
            registry = %known,
            "[FLOW] close_tab: 레지스트리에 없는 탭"
        );
        if let Some(label) = ghost {
            let Some(win) = app.get_webview_window(&label) else {
                return Ok(());
            };
            win.close()
                .map_err(|e| format!("유령 창 '{label}' 닫기 실패: {e}"))?;
            tracing::info!(window = %label, "[FLOW] 레지스트리에서 빠진 창을 닫았다");
        }
        return Ok(());
    };
    if let Some(pid) = project_id {
        release_project(app, pid).await;
    }
    if emptied {
        // 마지막 탭을 닫으면 창도 닫힌다 (Chrome 과 같다) — `⌘W` 한 키로
        // "탭 닫기" 와 "창 닫기" 가 자연스럽게 이어지는 지점이다.
        // 창 닫기가 CloseRequested 훅을 돌리지만, 레지스트리에서 이미 빠졌으므로
        // 남은 탭 정리는 no-op 이고 "마지막 창" 판정만 정상적으로 걸린다.
        //
        // 실패를 삼키지 않는다 (2026-08-29). 예전엔 `let _ = win.close()` 였고
        // 창을 못 찾은 경우는 아예 조용했다. 그런데 이 지점이 틀어지면 증상은
        // **탭은 사라졌는데 창이 남는다** — 사용자에게는 "닫기가 안 먹는다" 로
        // 보이고, 레지스트리에서는 이미 탭이 빠져 나가 되돌릴 수도 없다.
        // 어느 쪽으로 실패했는지 로그와 반환값 양쪽에 남긴다.
        let Some(win) = app.get_webview_window(&label) else {
            tracing::error!(
                window = %label,
                "[FLOW] 마지막 탭을 닫았는데 그 창의 웹뷰를 찾지 못했다 — 창이 그대로 남는다"
            );
            return Err(format!("창 '{label}' 을 찾을 수 없어 닫지 못했습니다"));
        };
        if let Err(e) = win.close() {
            tracing::error!(window = %label, error = %e, "[FLOW] 마지막 탭을 닫았으나 창 닫기 실패");
            return Err(format!("창 '{label}' 닫기 실패: {e}"));
        }
        tracing::info!(window = %label, "[FLOW] 마지막 탭이 닫혀 창도 닫는다");
    } else {
        broadcast(app, &label).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn activate_tab(app: AppHandle, tab_id: u32) -> Result<(), String> {
    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.activate(tab_id)
    };
    if let Some(label) = label {
        broadcast(&app, &label).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reorder_tabs(app: AppHandle, window: String, order: Vec<u32>) -> Result<(), String> {
    let changed = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reorder(&window, &order)
    };
    if changed {
        broadcast(&app, &window).await;
    }
    Ok(())
}

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

/// 창이 마운트 직후 자기 탭 구성을 읽는다 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn get_window_tabs(app: AppHandle, window: String) -> Result<WindowTabsSnapshot, String> {
    Ok(snapshot(&app, &window).await)
}

/// 프런트가 해석한 UI 언어를 알려 준다 — 메뉴 라벨을 그 언어로 다시 만든다.
///
/// Rust 는 프런트의 i18n 사전을 읽지 않고, `language: "system"` 을 OS 로케일로
/// 푸는 것도 백엔드에서는 불안정하다 (GUI 프로세스에는 `LANG` 이 없다).
/// **이미 해석을 끝낸 프런트가 결과만 넘겨주는 것**이 가장 정확하다.
#[tauri::command]
#[specta::specta]
pub async fn apply_menu_language(app: AppHandle, lang: String) -> Result<(), String> {
    // `apply` 가 창 메뉴 지정(macOS ⌃⌥ 창 분할)까지 함께 한다 — 언어를 바꿀
    // 때마다 서브메뉴를 새로 만들므로 지정도 매번 다시 해야 한다.
    crate::menu::apply(&app, &lang).map_err(|e| e.to_string())?;
    Ok(())
}

/// 시작 탭이 "열림" 배지를 그리기 위한 1회 조회 (이후는 이벤트로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn list_open_project_ids(app: AppHandle) -> Result<Vec<u32>, String> {
    let state = app.state::<WindowTabs>();
    let ids = state.lock().all_open_projects();
    Ok(ids)
}

// ─── 분리 터미널 창 (2026-08-15) ─────────────────────────────────────────────

/// 이 프로젝트의 터미널을 **자기 창**으로 떼어낸다 (도크의 ⇱).
///
/// 탭이 아니라 별개의 경량 창이다 (`index.html?term=<id>`) — 사이드바도
/// 탭 스트립도 없이 터미널만 그린다. 세션은 옮겨가지 않고 **그대로 이어진다**:
/// PTY 는 Rust 에 살아 있고 sid 가 프로젝트 기준(`pty_prefix_for`)이라, 새 창의
/// xterm 이 같은 sid 로 attach 하면 스크롤백까지 복원된다.
///
/// 이미 떠 있으면 새로 만들지 않고 그 창을 앞으로 가져온다 (프로젝트당 하나).
#[tauri::command]
#[specta::specta]
pub async fn open_terminal_window(app: AppHandle, project_id: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let label = terminal_window_label(project_id);
    if app.get_webview_window(&label).is_some() {
        // 레지스트리에서 빠져 있는데 웹뷰만 남아 있을 수 있다 (닫기 훅이 못 돈
        // 경우) — 다시 등록해 두어야 프런트의 자리표시자와 어긋나지 않는다.
        {
            let state = app.state::<WindowTabs>();
            state.lock().terminal_windows.insert(project_id);
        }
        focus_window(&app, &label);
        emit_terminal_windows(&app);
        return Ok(());
    }

    let title = {
        let db = app.state::<crate::db::Db>();
        db.get_project(project_id)
            .await
            .map(|p| p.name)
            .unwrap_or_else(|_| "Ocul-PM".to_string())
    };

    let url = format!("index.html?term={project_id}");
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .hidden_title(true)
        .inner_size(TERM_WINDOW_W, TERM_WINDOW_H)
        .min_inner_size(TERM_WINDOW_MIN_W, TERM_WINDOW_MIN_H)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    {
        let state = app.state::<WindowTabs>();
        state.lock().terminal_windows.insert(project_id);
    }
    attach_terminal_window_hooks(&app, &window, project_id);
    emit_terminal_windows(&app);
    Ok(())
}

/// 분리한 터미널을 앱으로 되돌린다 — 창만 닫으면 된다. 셸을 죽이지 않는 것은
/// 닫기 훅이 "탭이 아직 이 프로젝트를 쓰는가"를 보고 판단하기 때문이다.
#[tauri::command]
#[specta::specta]
pub async fn close_terminal_window(app: AppHandle, project_id: u32) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&terminal_window_label(project_id)) {
        win.close().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // 창이 이미 사라졌는데 레지스트리에만 남은 경우 — 프런트가 자리표시자에
    // 갇히지 않도록 여기서 정리하고 알린다.
    let stale = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.terminal_windows.remove(&project_id)
    };
    if stale {
        emit_terminal_windows(&app);
    }
    Ok(())
}

/// 마운트 직후 1회 조회 (이후는 `TerminalWindowsChanged` 로 갱신).
#[tauri::command]
#[specta::specta]
pub async fn list_terminal_windows(app: AppHandle) -> Result<Vec<u32>, String> {
    let state = app.state::<WindowTabs>();
    let ids = state.lock().terminal_window_projects();
    Ok(ids)
}

/// 터미널 창의 닫기 훅 — 레지스트리에서 빼고, **탭도 없으면** 셸을 정리한다.
///
/// 프런트의 언마운트에 맡기지 않는 이유는 탭 창과 같다: 강제 종료·크래시에서는
/// 돌지 않는다.
fn attach_terminal_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, project_id: u32) {
    let handle = app.clone();
    window.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { .. } = ev {
            let still_used = {
                let state = handle.state::<WindowTabs>();
                let mut reg = state.lock();
                reg.terminal_windows.remove(&project_id);
                reg.project_in_use(project_id)
            };
            if !still_used {
                // 죽인 개수 로그는 terminal.rs 안에서 남는다. 창 이벤트 훅이라
                // 동기판을 쓴다 (terminal.rs 의 "두 갈래인 이유" 참고).
                crate::commands::terminal::kill_ptys_with_prefix_blocking(
                    &handle,
                    &pty_prefix_for(project_id),
                );
            }
            emit_terminal_windows(&handle);
        }
    });
}

// ─── 창 생성·정리 ────────────────────────────────────────────────────────────

fn focus_window(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 앱 창을 하나 앞으로 — 없으면 시작 탭으로 하나 만든다.
/// 트레이 메뉴 "열기" 와 상주 모드 복귀의 공용 경로.
pub async fn focus_or_open_window(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let existing = {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window()
            .filter(|l| app.get_webview_window(l).is_some())
    };
    if let Some(label) = existing {
        focus_window(app, &label);
        return Ok(());
    }
    create_window(app, None, None, None, false)
        .await
        .map(|_| ())
}

async fn create_window(
    app: &AppHandle,
    project_id: Option<u32>,
    nav: Option<&crate::tray::TrayNavigate>,
    position: Option<(f64, f64)>,
    tearoff: bool,
) -> Result<String, String> {
    // **휴면 창**을 먼저 재사용한다 — 웹뷰는 살아 있는데 레지스트리에는 없는
    // 창. 두 경우에 생긴다: ① 앱 시작 직후의 `main`(아직 편입 전), ② 상주
    // 모드에서 마지막 창을 닫아 숨겨 둔 창. 재사용하지 않으면 숨은 웹뷰가
    // 영원히 남고 매번 새 라벨이 발급된다.
    // 떼어내는 중인 창은 **반드시 새로** 만든다 — 휴면 창은 이미 평범한 앱 URL 로
    // 떠 있어서 `?tearoff=1` 이 안 먹고, 그러면 끌려다니는 동안 프로젝트가
    // 통째로 마운트된다.
    let dormant = if tearoff {
        None
    } else {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        let mut labels: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|l| is_app_window(l) && reg.get(l).is_none())
            .cloned()
            .collect();
        // 결정적으로 고른다 — `main` 을 우선하고 그다음 라벨 순.
        labels.sort();
        labels
            .iter()
            .find(|l| l.as_str() == FIRST_WINDOW)
            .or_else(|| labels.first())
            .cloned()
    };
    if let Some(label) = dormant {
        {
            let state = app.state::<WindowTabs>();
            state.lock().register(&label, project_id);
        }
        // 떼어내기로 온 것이면 휴면 창도 손 밑으로 옮긴다 — 안 옮기면 끌어낸
        // 결과가 엉뚱한 자리(직전에 숨은 자리)에서 튀어나온다.
        if let (Some((x, y)), Some(win)) = (position, app.get_webview_window(&label)) {
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
        focus_window(app, &label);
        broadcast(app, &label).await;
        return Ok(label);
    }

    let label = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        reg.reserve(project_id)
    };

    let title = match project_id {
        Some(pid) => {
            let db = app.state::<crate::db::Db>();
            db.get_project(pid)
                .await
                .map(|p| p.name)
                .unwrap_or_else(|_| "Ocul-PM".to_string())
        }
        None => "Ocul-PM".to_string(),
    };

    let mut builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(window_url(&label, nav, tearoff).into()),
    )
    .title(title)
    .hidden_title(true)
    .inner_size(WINDOW_W, WINDOW_H)
    .min_inner_size(WINDOW_MIN_W, WINDOW_MIN_H)
    .resizable(true)
    // 손에 들려 있는 창은 포커스를 뺏지 않는다. 뺏으면 마우스 이벤트를 끌던
    // 창에서 가로채 갈 위험이 있고(드래그가 그 자리에서 죽는다), 화면상으로도
    // "아직 놓지 않았다" 가 안 읽힌다.
    .focused(!tearoff);
    if let Some((x, y)) = position {
        // 이미 "창 좌상단" 으로 계산돼 온다 (`detached_origin`) — 여기서 다시
        // 보정하지 않는다.
        builder = builder.position(x, y);
    }

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            // 예약만 해두고 창이 안 뜨면 유령 엔트리가 남는다 — 되돌린다.
            let state = app.state::<WindowTabs>();
            state.lock().windows.remove(&label);
            return Err(e.to_string());
        }
    };

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    attach_window_hooks(app, &window, label.clone());
    emit_open_projects(app);
    Ok(label)
}

/// `tauri.conf.json` 이 만든 첫 창을 레지스트리에 등록하고 훅을 붙인다.
/// 앱 시작 시 setup 에서 한 번 호출한다.
pub fn adopt_first_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FIRST_WINDOW) else {
        return;
    };
    {
        let state = app.state::<WindowTabs>();
        state.lock().register(FIRST_WINDOW, None);
    }
    attach_window_hooks(app, &window, FIRST_WINDOW.to_string());
}

/// 창 이벤트 훅 — 포커스 추적 + 닫을 때 그 창의 **모든 탭** 정리.
///
/// 프런트의 `beforeunload` 에 맡기지 않는 이유: 강제 종료·크래시 시 새기
/// 때문이다. Rust 쪽 창 이벤트가 유일하게 믿을 수 있는 지점이다.
fn attach_window_hooks(app: &AppHandle, window: &tauri::WebviewWindow, label: String) {
    let handle = app.clone();
    window.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Focused(true) => {
            let state = handle.state::<WindowTabs>();
            state.lock().note_focus(&label);
        }
        // `Destroyed` 가 아니라 `CloseRequested` 를 쓴다 — 앱 종료 경로에서는
        // 발화하지 않아, 종료 중에 "마지막 창" 판정이 무언가를 다시 띄우는
        // 사고를 구조적으로 막는다.
        tauri::WindowEvent::CloseRequested { api, .. } if handle_window_closed(&handle, &label) => {
            api.prevent_close();
        }
        _ => {}
    });
}

/// 반환값 `true` 면 닫기를 가로챈 것 (트레이 상주 모드에서 숨기기만 함).
fn handle_window_closed(app: &AppHandle, label: &str) -> bool {
    let (closed_tabs, remaining) = {
        let state = app.state::<WindowTabs>();
        let mut reg = state.lock();
        let tabs = reg
            .windows
            .remove(label)
            .map(|st| {
                st.order
                    .iter()
                    .filter_map(|t| t.project_id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if reg.last_focused.as_deref() == Some(label) {
            reg.last_focused = None;
        }
        (tabs, reg.windows.len())
    };

    for project_id in closed_tabs {
        release_project_blocking(app, project_id);
    }
    emit_open_projects(app);

    if remaining > 0 {
        return false;
    }

    // 분리 터미널 창은 탭 창이 아니지만 **앱이 아직 하는 일**이다. 남아 있는데
    // 여기서 종료·상주 전환을 밟으면, 방금 떼어낸 터미널이 통째로 사라진다.
    let detached = app.state::<WindowTabs>().lock().terminal_window_projects();
    if !detached.is_empty() {
        return false;
    }

    // 마지막 창 — 어떤 PTY 도 주인이 없다. 접두사 없는 레거시 sid(멀티 창
    // 이전에 저장된 터미널 탭)까지 여기서 회수한다.
    crate::commands::terminal::kill_ptys_except_blocking(app, &[]);
    crate::tray::handle_last_window_closed(app, label)
}

/// 탭이 사라질 때의 프로젝트 단위 정리 — **PTY 종료만** 한다.
///
/// 예전에는 watcher 도 함께 멈췄다. 하지만 감시 범위가 "열린 탭" 에서 "추적
/// 중인 모든 프로젝트" 로 바뀌면서(2026-08-12), watcher 의 수명은 탭이 아니라
/// **앱 프로세스**에 묶인다 — 여기서 멈추면 탭을 닫는 순간 그 프로젝트가
/// 상단바에서 다시 사라진다. 종료 시 정리는 `shutdown_all_blocking` 이 한다.
///
/// 이 비동기판은 **커맨드**(탭 닫기)가 쓴다. 창 이벤트 훅은 아래 동기판이다 —
/// 왜 나뉘어야 하는지는 `commands/terminal.rs` 의 "두 갈래인 이유" 참고.
/// 여기서 동기판을 부르면 tokio 가 패닉해 **그 뒤의 창 닫기가 통째로 사라진다**
/// (2026-08-29, 떼어낸 창이 안 닫히던 뿌리).
async fn release_project(app: &AppHandle, project_id: u32) {
    if !releasable(app, project_id) {
        return;
    }
    crate::commands::terminal::kill_ptys_with_prefix(app, &pty_prefix_for(project_id)).await;
}

/// 같은 정리를 창 이벤트 훅(메인 스레드·동기)에서. 여기서는 기다려야 한다 —
/// 마지막 창 닫힘 직후 앱이 종료될 수 있어 spawn 은 종료와 경주한다.
fn release_project_blocking(app: &AppHandle, project_id: u32) {
    if !releasable(app, project_id) {
        return;
    }
    crate::commands::terminal::kill_ptys_with_prefix_blocking(app, &pty_prefix_for(project_id));
}

/// 이 프로젝트의 셸을 정리해도 되는가.
///
/// 2026-08-15 — 터미널을 창으로 떼어냈으면 **그 창이 아직 셸의 주인**이다.
/// 탭만 보고 죽이면, 분리 창을 띄워 둔 채 프로젝트 탭을 닫는 순간 그 안의
/// 셸이 전부 사라진다 (창은 살아 있는데 내용만 죽는 셈).
fn releasable(app: &AppHandle, project_id: u32) -> bool {
    !app.state::<WindowTabs>().lock().project_in_use(project_id)
}

/// 지금 포커스된 앱 창. 메뉴 이벤트에는 대상 창이 실려 오지 않으므로 여기서
/// 찾는다. 실제 포커스를 먼저 보고(가장 정확하다), 못 찾으면 레지스트리가
/// 기억하는 마지막 포커스 창으로 떨어진다 — 메뉴를 여는 순간 창이 포커스를
/// 잃는 플랫폼도 있기 때문이다. 트레이 팝오버는 앱 창이 아니라 제외된다.
pub fn focused_app_window(app: &AppHandle) -> Option<String> {
    let live = app
        .webview_windows()
        .into_iter()
        .find(|(label, w)| is_app_window(label) && w.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    live.or_else(|| {
        let state = app.state::<WindowTabs>();
        let reg = state.lock();
        reg.preferred_window()
    })
}

/// 지금 포커스된 **분리 터미널 창**의 라벨.
///
/// ⌘W/⇧⌘W 처리에 반드시 먼저 물어봐야 한다: `focused_app_window` 는 터미널
/// 창을 앱 창으로 치지 않아 "마지막으로 포커스된 탭 창"으로 떨어지고, 그러면
/// 터미널 창에서 누른 ⌘W 가 **다른 창의 탭**을 닫아 버린다.
pub fn focused_terminal_window(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(label, w)| {
            terminal_window_project(label).is_some() && w.is_focused().unwrap_or(false)
        })
        .map(|(label, _)| label)
}

/// 그 창에서 지금 보이고 있는 탭.
pub fn active_tab_of(app: &AppHandle, label: &str) -> Option<u32> {
    let state = app.state::<WindowTabs>();
    let reg = state.lock();
    reg.get(label).and_then(|st| st.active)
}

/// 추적 중인 **모든** 프로젝트의 감시를 시작한다 (앱 시작 시 1회).
///
/// 왜 전부인가 — 이 앱의 약속은 "외부 에이전트가 한 일을 기록한다" 이고, 그
/// 기록은 watcher 가 만든다. 예전에는 watcher 가 **탭 수명**에 묶여 있어서,
/// 탭을 열지 않은 프로젝트에서 에이전트가 아무리 일해도 세션이 생성조차
/// 되지 않았다 — 상단바가 "하나만 감지" 하던 이유가 이것이다.
///
/// 부하는 순차 + 간격으로 흩는다: 프로젝트 N 개의 init(디스크 쓰기 포함)과
/// 인덱싱이 동시에 터지면 콜드 스타트가 눈에 띄게 느려지고, macOS 폴더 접근
/// 권한 프롬프트가 한꺼번에 쏟아진다. 실패는 프로젝트 단위로 삼킨다 —
/// 하나가 안 열린다고 나머지 감시를 포기할 이유가 없다.
pub fn start_background_watchers(app: &AppHandle) {
    const STAGGER: std::time::Duration = std::time::Duration::from_millis(400);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let projects = {
            let db = handle.state::<crate::db::Db>();
            match db.list_projects().await {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(target: "oculpm::bootstrap", error = %e, "프로젝트 목록 조회 실패");
                    return;
                }
            }
        };
        tracing::info!(target: "oculpm::bootstrap", n = projects.len(), "백그라운드 감시 시작");

        for project in projects {
            let root = std::path::PathBuf::from(&project.root_path);
            // 사라진 폴더는 조용히 건너뛴다 — 사용자가 옮겼거나 지웠을 뿐,
            // 시작 로그를 에러로 채울 일이 아니다.
            if !root.is_dir() {
                continue;
            }
            let lang = {
                let db = handle.state::<crate::db::Db>();
                match crate::oculpm::content_lang::current(&db).await {
                    crate::oculpm::content_lang::ContentLang::English => "en",
                    _ => "ko",
                }
            };
            let manager = handle.state::<crate::oculpm::manager::OculpmManager>();
            if let Err(e) = manager.init_project(project.id, &root, lang).await {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e,
                    "init 실패 — 이 프로젝트는 감시하지 않는다"
                );
                continue;
            }
            // **앱이 새로 뜰 때만** 살아 있는 다른 인스턴스에게서 락을 가져온다
            // (2026-08-23). "가장 최근에 연 인스턴스가 주인" 이라는 규칙이라야
            // 사용자가 결과를 예측할 수 있다 — 예전엔 먼저 뜬 쪽이 영원히
            // 이겨서, 설치본을 띄워 둔 채 개발 빌드를 돌리면 개발 빌드가 어떤
            // 프로젝트도 감시하지 못했다. 쫓겨난 쪽은 하트비트가 그 사실을
            // 발견해 5초 안에 감시를 접는다 (`oculpm::lock`).
            //
            // 재시도(감독관)는 이 정책을 쓰지 않는다 — 두 인스턴스가 60초마다
            // 서로를 쫓아내며 무한히 주고받는다.
            if let Err(e) = manager
                .watcher_start_with(
                    project.id,
                    Some(handle.clone()),
                    crate::oculpm::lock::AcquirePolicy::TakeOver,
                )
                .await
            {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e, "watcher 시작 실패"
                );
            }
            tokio::time::sleep(STAGGER).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg_with(windows: &[(&str, &[Option<u32>])]) -> Registry {
        let mut reg = Registry::default();
        for (label, projects) in windows {
            for (i, p) in projects.iter().enumerate() {
                if i == 0 {
                    reg.register(label, *p);
                } else {
                    reg.append(label, *p);
                }
            }
            // 첫 탭을 활성으로 되돌려 테스트가 예측 가능하게.
            if let Some(st) = reg.windows.get_mut(*label) {
                st.active = st.order.first().map(|t| t.id);
            }
        }
        reg
    }

    fn ids(reg: &Registry, label: &str) -> Vec<u32> {
        reg.get(label).unwrap().order.iter().map(|t| t.id).collect()
    }

    fn projects(reg: &Registry, label: &str) -> Vec<Option<u32>> {
        reg.get(label)
            .unwrap()
            .order
            .iter()
            .map(|t| t.project_id)
            .collect()
    }

    #[test]
    fn labels_distinguish_app_windows() {
        assert!(is_app_window("main"));
        assert!(is_app_window("win-1"));
        assert!(is_app_window("win-42"));
        assert!(!is_app_window("tray"));
        assert!(!is_app_window("win-"));
        assert!(!is_app_window("win-abc"));
        assert!(!is_app_window("window-1"));
    }

    /// 접두사가 다른 프로젝트를 잡아먹지 않는다 — `p1-` 이 `p12-…` 를 죽이면
    /// 탭 하나를 닫을 때 다른 탭의 셸이 함께 죽는다.
    #[test]
    fn pty_prefix_does_not_swallow_longer_ids() {
        let p1 = pty_prefix_for(1);
        assert!("p1-a1b2c3d4".starts_with(&p1));
        assert!(!"p12-a1b2c3d4".starts_with(&p1));
    }

    /// 터미널 창은 탭을 물지 않는다 — 탭 레지스트리·⌘W·"마지막 창" 판정이
    /// 이 라벨을 앱 창으로 오해하면 남의 탭을 닫거나 앱을 종료시킨다.
    #[test]
    fn terminal_windows_are_not_app_windows() {
        assert!(!is_app_window("term-3"));
        assert_eq!(terminal_window_label(3), "term-3");
        assert_eq!(terminal_window_project("term-3"), Some(3));
        assert_eq!(terminal_window_project("win-3"), None);
        assert_eq!(terminal_window_project("term-"), None);
        assert_eq!(terminal_window_project("term-abc"), None);
    }

    /// PTY 정리의 유일한 판정 — 탭이든 터미널 창이든 **하나라도 남아 있으면**
    /// 셸을 죽이지 않는다. 탭만 보던 시절에는, 터미널을 창으로 떼어낸 뒤
    /// 프로젝트 탭을 닫는 순간 분리 창 안의 셸이 전부 사라졌다.
    #[test]
    fn a_detached_terminal_window_keeps_the_project_in_use() {
        let mut reg = reg_with(&[("main", &[Some(3)])]);
        let tab = ids(&reg, "main")[0];

        assert!(reg.project_in_use(3), "탭이 있으니 쓰는 중");
        reg.terminal_windows.insert(3);
        reg.remove_tab(tab);
        assert!(reg.project_in_use(3), "탭은 닫혔지만 터미널 창이 남았다");

        reg.terminal_windows.remove(&3);
        assert!(!reg.project_in_use(3), "둘 다 없으면 그때 정리한다");
    }

    #[test]
    fn terminal_window_projects_are_sorted() {
        let mut reg = Registry::default();
        reg.terminal_windows.insert(9);
        reg.terminal_windows.insert(2);
        assert_eq!(reg.terminal_window_projects(), vec![2, 9]);
    }

    #[test]
    fn tab_ids_are_unique_across_windows() {
        let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(7)])]);
        let mut all = ids(&reg, "main");
        all.extend(ids(&reg, "win-1"));
        let mut sorted = all.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            sorted.len(),
            all.len(),
            "탭 id 는 창을 가로질러 유일해야 한다"
        );
    }

    #[test]
    fn locate_project_finds_the_owning_window_and_tab() {
        let reg = reg_with(&[("main", &[None, Some(3)]), ("win-1", &[Some(9)])]);
        let (label, tab_id) = reg.locate_project(3).unwrap();
        assert_eq!(label, "main");
        assert_eq!(tab_id, ids(&reg, "main")[1]);
        assert_eq!(reg.locate_project(11), None);
    }

    /// 시작 탭은 프로젝트가 없으므로 "열림" 목록에 끼지 않는다.
    #[test]
    fn start_tabs_are_not_open_projects() {
        let reg = reg_with(&[("main", &[None, Some(9), None]), ("win-1", &[Some(3)])]);
        assert_eq!(reg.all_open_projects(), vec![3, 9]);
    }

    /// 시작 탭에서 프로젝트를 고르면 **자리를 지킨 채** 승격한다.
    #[test]
    fn assign_project_promotes_in_place() {
        let mut reg = reg_with(&[("main", &[Some(3), None, Some(9)])]);
        let start = ids(&reg, "main")[1];
        assert_eq!(reg.assign_project(start, 5).as_deref(), Some("main"));
        assert_eq!(projects(&reg, "main"), vec![Some(3), Some(5), Some(9)]);
        assert_eq!(reg.get("main").unwrap().active, Some(start));
        assert_eq!(ids(&reg, "main")[1], start, "탭 id 는 유지된다");
    }

    #[test]
    fn assign_project_on_unknown_tab_is_noop() {
        let mut reg = reg_with(&[("main", &[None])]);
        assert_eq!(reg.assign_project(9999, 5), None);
        assert_eq!(projects(&reg, "main"), vec![None]);
    }

    /// 활성 탭을 닫으면 오른쪽 이웃으로 넘어간다 (Chrome 과 같다).
    #[test]
    fn closing_active_tab_moves_to_right_neighbour() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
        let tabs = ids(&reg, "main");
        reg.activate(tabs[1]);
        let (label, project, empty) = reg.remove_tab(tabs[1]).unwrap();
        assert_eq!((label.as_str(), project, empty), ("main", Some(7), false));
        assert_eq!(reg.get("main").unwrap().active, Some(tabs[2]));
    }

    /// 오른쪽이 없으면 왼쪽으로.
    #[test]
    fn closing_last_active_tab_falls_back_left() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
        let tabs = ids(&reg, "main");
        reg.activate(tabs[1]);
        reg.remove_tab(tabs[1]);
        assert_eq!(reg.get("main").unwrap().active, Some(tabs[0]));
    }

    #[test]
    fn removing_the_only_tab_drops_the_window() {
        let mut reg = reg_with(&[("main", &[Some(3)])]);
        let tab = ids(&reg, "main")[0];
        assert_eq!(reg.remove_tab(tab), Some(("main".into(), Some(3), true)));
        assert!(reg.get("main").is_none());
        assert!(reg.all_open_projects().is_empty());
    }

    /// 시작 탭을 닫아도 정리할 프로젝트가 없다 (PTY·watcher 를 건드리면 안 된다).
    #[test]
    fn closing_a_start_tab_reports_no_project() {
        let mut reg = reg_with(&[("main", &[None, Some(3)])]);
        let start = ids(&reg, "main")[0];
        let (_, project, empty) = reg.remove_tab(start).unwrap();
        assert_eq!(project, None);
        assert!(!empty);
    }

    /// 낡은 목록이 와도 탭이 사라지거나 남의 탭이 끼어들지 않는다.
    #[test]
    fn reorder_filters_unknown_and_keeps_missing() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7), Some(9)])]);
        let t = ids(&reg, "main");
        assert!(reg.reorder("main", &[t[2], t[0], 9999]));
        assert_eq!(ids(&reg, "main"), vec![t[2], t[0], t[1]]);
    }

    #[test]
    fn reorder_reports_no_change_when_identical() {
        let mut reg = reg_with(&[("main", &[Some(3), Some(7)])]);
        let t = ids(&reg, "main");
        assert!(!reg.reorder("main", &t));
        assert!(!reg.reorder("win-nope", &[1]));
    }

    /// 새 탭은 마지막으로 포커스된 창에 붙는다.
    #[test]
    fn move_tab_inserts_at_the_requested_index_of_the_target_window() {
        let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)]), ("win-2", &[Some(3)])]);
        let moving = reg.get("win-1").unwrap().order[1].id;
        let out = reg.move_tab(moving, "win-2", 0);
        assert_eq!(out, Some(("win-1".into(), false)));
        assert_eq!(projects(&reg, "win-2"), vec![Some(2), Some(3)]);
        assert_eq!(projects(&reg, "win-1"), vec![Some(1)]);
        // 옮겨간 탭이 대상 창의 활성 탭이 된다 — 사용자가 방금 손에 들고 있었다.
        assert_eq!(reg.get("win-2").unwrap().active, Some(moving));
    }

    #[test]
    fn moving_the_last_tab_reports_the_source_window_as_emptied() {
        let mut reg = reg_with(&[("win-1", &[Some(1)]), ("win-2", &[Some(2)])]);
        let moving = reg.get("win-1").unwrap().order[0].id;
        assert_eq!(
            reg.move_tab(moving, "win-2", 9),
            Some(("win-1".into(), true))
        );
        assert!(reg.get("win-1").is_none());
        assert_eq!(projects(&reg, "win-2"), vec![Some(2), Some(1)]);
        // 창은 비었어도 프로젝트는 **여전히 열려 있다** — 탭이 옮겨갔을 뿐이다.
        assert_eq!(reg.all_open_projects(), vec![1, 2]);
    }

    /// 진단 요약은 **양쪽 값**을 담아야 쓸모가 있다 — 시도한 탭 id 와 실제 보유분.
    #[test]
    fn summary_shows_which_window_holds_which_tab() {
        let reg = reg_with(&[("main", &[None, Some(7)]), ("win-1", &[Some(3)])]);
        // 라벨 정렬 — 로그를 여러 건 나란히 놓고 읽을 때 순서가 흔들리면 안 된다.
        assert_eq!(reg.summary(), "main:[1(start),2(p=7)] win-1:[3(p=3)]");
    }

    #[test]
    fn summary_of_an_empty_registry_is_empty() {
        assert_eq!(Registry::default().summary(), "");
    }

    #[test]
    fn ghost_is_an_app_window_the_registry_forgot() {
        let reg = reg_with(&[("main", &[None])]);
        // 레지스트리가 모르는 앱 창 — 유령이다.
        assert_eq!(ghost_window(&reg, Some("win-1")), Some("win-1".into()));
        // 알고 있는 창은 아니다 (이미 닫힌 탭을 다시 닫는 정상 경로가 여기로 온다).
        assert_eq!(ghost_window(&reg, Some("main")), None);
        // 탭 레지스트리 밖에 사는 창들은 유령 판정 대상이 아니다.
        assert_eq!(ghost_window(&reg, Some("term-3")), None);
        assert_eq!(ghost_window(&reg, Some("tray")), None);
        // 호출한 창을 모르면(내부 경로) 판정하지 않는다.
        assert_eq!(ghost_window(&reg, None), None);
    }

    /// 떼어낸 창의 탭을 닫으면 그 창이 닫힌다 — 떼어내기와 닫기가 이어지는 지점.
    ///
    /// 두 단계가 각각 맞아도 **이어 붙였을 때** 어긋날 수 있는 자리다: 떼어내기는
    /// `remove_tab` + `reserve` 로 창을 새로 세우고, 닫기는 그 창이 비었는지를
    /// `remove_tab` 의 셋째 값으로 판정한다. 가운데의 `reserve` 가 탭을 **하나만**
    /// 등록한다는 사실에 기대고 있으므로, 거기에 시작 탭이라도 하나 더 붙는 날
    /// 조용히 "닫아도 창이 남는" 증상이 된다.
    #[test]
    fn closing_the_tab_of_a_detached_window_empties_that_window() {
        let mut reg = reg_with(&[("main", &[None, Some(1)])]);
        let moving = reg.get("main").unwrap().order[1].id;
        // detach_tab 이 하는 일: remove_tab → create_window(reserve/register)
        let removed = reg.remove_tab(moving);
        assert_eq!(removed, Some(("main".into(), Some(1), false)));
        let label = reg.reserve(Some(1));
        assert_eq!(label, "win-1");
        let born = reg.get("win-1").unwrap().order[0].id;
        // 떼어낸 창의 X — close_tab 이 보는 값
        let out = reg.remove_tab(born);
        assert_eq!(
            out,
            Some(("win-1".into(), Some(1), true)),
            "emptied 가 true 여야 창이 닫힌다"
        );
        assert!(reg.get("win-1").is_none());
        // handle_window_closed 가 보는 값
        assert_eq!(
            reg.windows.len(),
            1,
            "main 이 남아 있어야 prevent_close 가 안 걸린다"
        );
    }

    #[test]
    fn move_tab_into_its_own_window_is_a_reorder() {
        let mut reg = reg_with(&[("win-1", &[Some(1), Some(2), Some(3)])]);
        let moving = reg.get("win-1").unwrap().order[2].id;
        assert_eq!(
            reg.move_tab(moving, "win-1", 0),
            Some(("win-1".into(), false))
        );
        assert_eq!(projects(&reg, "win-1"), vec![Some(3), Some(1), Some(2)]);
    }

    #[test]
    fn move_tab_to_a_missing_window_leaves_everything_alone() {
        let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
        let moving = reg.get("win-1").unwrap().order[0].id;
        assert_eq!(reg.move_tab(moving, "win-9", 0), None);
        assert_eq!(projects(&reg, "win-1"), vec![Some(1), Some(2)]);
    }

    #[test]
    fn hovering_a_new_window_reports_the_one_being_left() {
        let mut reg = Registry::default();
        assert_eq!(reg.hover("win-1"), None);
        // 같은 창을 계속 겨누면 떠난 창은 없다 (캐럿을 지우면 안 된다).
        assert_eq!(reg.hover("win-1"), None);
        reg.note_drop_index("win-1", 2);
        assert_eq!(reg.hover("win-2"), Some("win-1".into()));
        // 대상이 바뀌면 인덱스는 버려진다 — 남의 창에서 잰 값이다.
        assert_eq!(reg.take_drop_hint(), Some(("win-2".into(), None)));
    }

    #[test]
    fn a_late_index_report_from_a_stale_window_is_ignored() {
        let mut reg = Registry::default();
        reg.hover("win-2");
        reg.note_drop_index("win-1", 5);
        assert_eq!(reg.take_drop_hint(), Some(("win-2".into(), None)));
    }

    /// 겉모습(`TabPreview`)은 스트립에 **처음 들어선** 프레임에만 싣는다 —
    /// 그 판정이 `hovering()` 이다. `hover()` 의 반환값만 보면 첫 진입과 제자리
    /// 유지가 둘 다 `None` 이라 구분되지 않고, 결과는 둘 중 하나다: 매 프레임
    /// DB 를 때리거나, 자리표시자가 영영 이름을 못 받거나.
    /// 떼어낸 창은 **잡았던 자리가 커서 밑에** 오도록 놓인다. 예전 상수
    /// 오프셋(-120, -16)은 줌이 걸리면 그만큼 틀어졌다.
    #[test]
    fn detached_window_lands_under_the_hand() {
        // 배율 2 인 화면: 물리 (800, 200) = 논리 (400, 100).
        // 새 창 안 (86, 22) 지점이 그 자리에 와야 하므로 원점은 (314, 78).
        assert_eq!(
            detached_origin((800.0, 200.0), 2.0, (86.0, 22.0)),
            (314.0, 78.0)
        );
        // 배율 1 은 그대로 뺀다.
        assert_eq!(
            detached_origin((500.0, 300.0), 1.0, (86.0, 6.0)),
            (414.0, 294.0)
        );
        // 배율이 0 으로 와도 창을 화면 밖으로 던지지 않는다.
        assert_eq!(
            detached_origin((500.0, 300.0), 0.0, (0.0, 0.0)),
            (500.0, 300.0)
        );
    }

    #[test]
    fn hovering_tells_first_entry_from_staying() {
        let mut reg = Registry::default();
        assert_eq!(reg.hovering(), None);
        reg.hover("win-1");
        assert_eq!(reg.hovering(), Some("win-1"));
        reg.hover("win-1");
        assert_eq!(reg.hovering(), Some("win-1"));
        reg.hover("win-2");
        assert_eq!(reg.hovering(), Some("win-2"));
        reg.unhover();
        assert_eq!(reg.hovering(), None);
    }

    #[test]
    fn unhover_clears_the_hint_once() {
        let mut reg = Registry::default();
        reg.hover("win-1");
        assert_eq!(reg.unhover(), Some("win-1".into()));
        assert_eq!(reg.unhover(), None);
    }

    #[test]
    fn strip_band_accepts_above_the_window_but_never_below_the_strip() {
        // 스트립 안.
        assert!(hits_tab_strip(10.0, 4.0, 900.0, 38.0));
        // 창 테두리 위로 살짝 — 받아 준다.
        assert!(hits_tab_strip(10.0, -6.0, 900.0, 38.0));
        // 너무 위 · 스트립 아래(콘텐츠) · 창 가로 밖.
        assert!(!hits_tab_strip(10.0, -40.0, 900.0, 38.0));
        assert!(!hits_tab_strip(10.0, 60.0, 900.0, 38.0));
        assert!(!hits_tab_strip(-2.0, 10.0, 900.0, 38.0));
        assert!(!hits_tab_strip(950.0, 10.0, 900.0, 38.0));
    }

    #[test]
    fn preferred_window_follows_focus() {
        let mut reg = reg_with(&[("main", &[Some(3)]), ("win-1", &[Some(7)])]);
        reg.note_focus("win-1");
        assert_eq!(reg.preferred_window().as_deref(), Some("win-1"));
        // 그 창이 사라지면 남은 창 중 하나로 폴백한다 (유령 라벨 반환 금지).
        reg.windows.remove("win-1");
        assert_eq!(reg.preferred_window().as_deref(), Some("main"));
        reg.windows.remove("main");
        assert_eq!(reg.preferred_window(), None);
    }

    #[test]
    fn reserve_issues_monotonic_labels() {
        let mut reg = Registry::default();
        assert_eq!(reg.reserve(Some(3)), "win-1");
        assert_eq!(reg.reserve(None), "win-2");
        assert_eq!(reg.locate_project(3).unwrap().0, "win-1");
    }

    #[test]
    fn plain_window_url_has_only_label() {
        assert_eq!(window_url("win-2", None, false), "index.html?win=win-2");
    }

    /// 끌려다니는 창은 URL 로 자기 처지를 안다 — 프런트가 그걸 보고 화면
    /// 마운트를 붙잡는다. 이 파라미터가 빠지면 드래그 몇백 ms 마다 프로젝트
    /// init·워처·자동색인이 통째로 돌고, 합쳐 버리면 전부 낭비가 된다.
    #[test]
    fn tearoff_url_tells_the_window_it_is_being_carried() {
        assert_eq!(
            window_url("win-3", None, true),
            "index.html?win=win-3&tearoff=1"
        );
    }

    /// 떼어낸 창의 탭은 **새 id** 를 받는다 — 이 전제가 `TearOff.tab_id` 의
    /// 존재 이유다. 프런트가 들고 있던 옛 id 로 놓기·무르기를 부르면 그 탭은
    /// 어디에도 없어 조용히 아무 일도 일어나지 않는다 (가장 고약한 실패 모양:
    /// 창은 떴는데 놓아도 합쳐지지 않고, Escape 도 안 먹는다).
    #[test]
    fn a_torn_off_window_mints_a_new_tab_id() {
        let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
        let dragged = ids(&reg, "win-1")[1];
        let (_, project_id, _) = reg.remove_tab(dragged).unwrap();
        let label = reg.reserve(project_id);
        let fresh = ids(&reg, &label)[0];
        assert_ne!(fresh, dragged);
        assert_eq!(projects(&reg, &label), vec![Some(2)]);
        // 옛 id 는 이제 어디에도 없다.
        assert_eq!(reg.locate_tab(dragged), None);
    }

    #[test]
    fn a_lone_tab_window_is_carried_whole_instead_of_respawned() {
        let mut reg = reg_with(&[("win-3", &[Some(2)])]);
        let only = ids(&reg, "win-3")[0];

        assert!(reg.carry_whole(only, (86.0, 20.0), (400.0, 120.0)));

        let tear = reg.tearing().unwrap();
        // 새 창을 만들지 않았다 — 들고 있는 것이 그 창 자신이다.
        assert_eq!(tear.label, "win-3");
        assert_eq!(tear.source, "win-3");
        assert_eq!(tear.tab_id, only);
        // 무를 때 되돌릴 **창 자리**를 기억한다 (탭 자리가 아니다).
        assert_eq!(tear.home, Some((400.0, 120.0)));
        // 창도 탭도 그대로다 — 아무것도 다시 마운트되지 않는다.
        assert_eq!(ids(&reg, "win-3"), vec![only]);
    }

    #[test]
    fn carrying_whole_is_declined_when_the_window_has_siblings() {
        let mut reg = reg_with(&[("win-1", &[Some(1), Some(2)])]);
        let dragged = ids(&reg, "win-1")[1];
        // 형제가 있으면 탭만 빠져나가 새 창이 된다 — 창째로 들지 않는다.
        assert!(!reg.carry_whole(dragged, (86.0, 20.0), (0.0, 0.0)));
        assert!(reg.tearing().is_none());
        assert_eq!(ids(&reg, "win-1").len(), 2);
    }

    #[test]
    fn carrying_whole_is_declined_for_an_unknown_tab() {
        let mut reg = reg_with(&[("win-1", &[Some(1)])]);
        assert!(!reg.carry_whole(9999, (0.0, 0.0), (0.0, 0.0)));
        assert!(reg.tearing().is_none());
    }

    /// 회귀 못 박기 — 떼어낸 창(탭 하나)이 드래그로 **되돌아온다**.
    ///
    /// 2026-08-29 에 `attach_tab` 이 tear-off 로 합쳐지면서 마지막 탭이 거절돼
    /// 돌아올 길이 사라졌다. 창째로 들면 그다음은 평범한 `move_tab` 이다.
    #[test]
    fn a_carried_lone_tab_window_merges_back_and_leaves_no_window_behind() {
        let mut reg = reg_with(&[("win-1", &[Some(1)]), ("win-3", &[Some(2)])]);
        let carried = ids(&reg, "win-3")[0];
        assert!(reg.carry_whole(carried, (86.0, 20.0), (400.0, 120.0)));

        let tear = reg.tearing().unwrap();
        let (source, emptied) = reg.move_tab(tear.tab_id, "win-1", 0).unwrap();

        assert_eq!(source, "win-3");
        // 비었다고 알려야 `commit_move` 가 그 창을 닫는다.
        assert!(emptied);
        assert!(reg.get("win-3").is_none());
        assert_eq!(projects(&reg, "win-1"), vec![Some(2), Some(1)]);
    }

    /// hide/show 는 **바뀔 때만** 부른다 — 매 틱 부르면 창이 깜빡인다.
    #[test]
    fn tear_hidden_reports_only_transitions() {
        let mut reg = Registry::default();
        // 들고 있는 창이 없으면 아무 말도 하지 않는다.
        assert_eq!(reg.set_tear_hidden(true), None);
        reg.tearing = Some(TearOff {
            label: "win-9".into(),
            tab_id: 7,
            anchor: (86.0, 20.0),
            source: "win-1".into(),
            index: 1,
            home: None,
            hidden: false,
        });
        assert_eq!(reg.set_tear_hidden(true), Some(true));
        assert_eq!(reg.set_tear_hidden(true), None);
        assert_eq!(reg.set_tear_hidden(false), Some(false));
        // 손을 놓으면 한 번만 꺼내진다.
        assert!(reg.take_tearing().is_some());
        assert!(reg.take_tearing().is_none());
    }

    #[test]
    fn deeplink_url_carries_view_and_entry() {
        let nav = crate::tray::TrayNavigate {
            view: "journal".into(),
            project_id: Some(3),
            entry_path: Some("journal/20260812/Bugs/0603_bug_a b.md".into()),
        };
        assert_eq!(
            window_url("win-1", Some(&nav), false),
            "index.html?win=win-1&view=journal&entry=journal/20260812/Bugs/0603_bug_a%20b.md"
        );
    }

    /// `&` 가 그대로 새면 뒤 파라미터가 통째로 잘린다.
    #[test]
    fn query_encoding_escapes_separators_and_utf8() {
        assert_eq!(encode_query_value("a&b=c#d"), "a%26b%3Dc%23d");
        assert_eq!(encode_query_value("일지"), "%EC%9D%BC%EC%A7%80");
    }
}

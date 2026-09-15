//! 창→탭 레지스트리 — `Registry` 와 그 원소(`Tab`·`WindowState`·`TearOff`).
//!
//! 순수 자료구조라 Tauri 런타임 없이 단위 테스트한다. 커맨드는 이 위에서
//! 락을 잡고 상태를 바꾼 뒤 `events` 로 프런트에 알린다.

use super::*;

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
    pub(super) windows: HashMap<String, WindowState>,
    /// 터미널을 창으로 떼어낸 프로젝트 (2026-08-15). 탭과 **함께** PTY 의
    /// 소유자를 이룬다 — 둘 다 없어져야 셸을 죽인다 (`release_project`).
    pub(super) terminal_windows: HashSet<u32>,
    /// 새 탭이 어느 창에 붙을지 결정한다. 창이 포커스될 때마다 갱신.
    pub(super) last_focused: Option<String>,
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
    pub(super) tearing: Option<TearOff>,
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

    pub(super) fn locate_tab(&self, tab_id: u32) -> Option<String> {
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

    /// 지금의 창·탭 구성을 스냅숏으로 뜬다 — 업데이트 재시작을 건너 되살리기
    /// 위한 것이다 (`SESSION_KEY`).
    ///
    /// 탭 **id 는 싣지 않는다.** 다음 실행의 id 는 새로 발급되므로 저장해 봐야
    /// 아무것도 가리키지 못한다. 활성 탭은 그래서 인덱스로 적는다.
    pub fn session(&self) -> Session {
        let mut windows: Vec<SessionWindow> = self
            .windows
            .iter()
            .map(|(label, st)| SessionWindow {
                label: label.clone(),
                tabs: st.order.iter().map(|t| t.project_id).collect(),
                active: st
                    .active
                    .and_then(|id| st.order.iter().position(|t| t.id == id))
                    .unwrap_or(0),
            })
            .collect();
        // 복원 순서를 결정적으로 — `main` 이 먼저, 나머지는 라벨 순.
        windows.sort_by(|a, b| {
            (a.label != FIRST_WINDOW, &a.label).cmp(&(b.label != FIRST_WINDOW, &b.label))
        });
        Session {
            windows,
            terminals: self.terminal_window_projects(),
            focused: self.last_focused.clone(),
        }
    }

    /// 창 하나를 **저장된 라벨 그대로** 되살린다.
    ///
    /// 라벨을 유지하는 것이 핵심이다 — `tauri-plugin-window-state` 가 위치·크기를
    /// 라벨로 기억하므로, 같은 라벨로 다시 띄우면 창이 있던 자리에 그대로 뜬다.
    /// 새 라벨을 발급하면 탭은 살아 돌아와도 창이 화면 한가운데로 모인다.
    ///
    /// 이어서 발급될 라벨이 되살린 것과 부딪히지 않도록 `next_window` 도 민다.
    pub(super) fn restore_window(&mut self, label: &str, tabs: &[Option<u32>], active: usize) {
        if tabs.is_empty() {
            return;
        }
        let order: Vec<Tab> = tabs.iter().map(|p| self.mint(*p)).collect();
        let active_id = order.get(active).or_else(|| order.first()).map(|t| t.id);
        self.windows.insert(
            label.to_string(),
            WindowState {
                order,
                active: active_id,
            },
        );
        if let Some(n) = label
            .strip_prefix(WINDOW_PREFIX)
            .and_then(|n| n.parse::<u32>().ok())
        {
            self.next_window = self.next_window.max(n);
        }
        self.last_focused = Some(label.to_string());
    }

    /// 창을 등록한다. `main` 처럼 이미 존재하는 창을 시작 탭 하나로 여는 데도 쓴다.
    pub(super) fn register(&mut self, label: &str, project_id: Option<u32>) -> u32 {
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
    pub(super) fn reserve(&mut self, project_id: Option<u32>) -> String {
        self.next_window += 1;
        let label = window_label(self.next_window);
        self.register(&label, project_id);
        label
    }

    /// 이미 있는 창의 끝에 탭을 붙이고 활성화한다.
    pub(super) fn append(&mut self, label: &str, project_id: Option<u32>) -> u32 {
        let tab = self.mint(project_id);
        let st = self.windows.entry(label.to_string()).or_default();
        st.order.push(tab);
        st.active = Some(tab.id);
        tab.id
    }

    /// 시작 탭을 **제자리에서** 프로젝트 탭으로 승격한다 (Chrome 의 새 탭에서
    /// 주소를 여는 것과 같다 — 탭이 옮겨가지 않고 내용만 바뀐다).
    pub(super) fn assign_project(&mut self, tab_id: u32, project_id: u32) -> Option<String> {
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
    pub(super) fn remove_tab(&mut self, tab_id: u32) -> Option<(String, Option<u32>, bool)> {
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
    pub(super) fn move_tab(
        &mut self,
        tab_id: u32,
        target: &str,
        index: usize,
    ) -> Option<(String, bool)> {
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
    pub(super) fn hover(&mut self, target: &str) -> Option<String> {
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
    pub(super) fn hovering(&self) -> Option<&str> {
        self.drop_hint.as_ref().map(|(label, _)| label.as_str())
    }

    /// 스트립을 벗어났다 — 겨누던 창을 알려 준다 (캐럿을 지우게).
    pub(super) fn unhover(&mut self) -> Option<String> {
        self.drop_hint.take().map(|(label, _)| label)
    }

    /// 대상 창이 계산한 삽입 인덱스. 겨누는 창이 아니면 무시한다 — 늦게 도착한
    /// 보고가 다음 대상의 자리를 덮어쓰지 못하게.
    pub(super) fn note_drop_index(&mut self, window: &str, index: usize) {
        if let Some((label, slot)) = self.drop_hint.as_mut() {
            if label == window {
                *slot = Some(index);
            }
        }
    }

    pub(super) fn take_drop_hint(&mut self) -> Option<(String, Option<usize>)> {
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
    pub(super) fn carry_whole(
        &mut self,
        tab_id: u32,
        anchor: (f64, f64),
        home: (f64, f64),
    ) -> bool {
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

    pub(super) fn tearing(&self) -> Option<TearOff> {
        self.tearing.clone()
    }

    pub(super) fn take_tearing(&mut self) -> Option<TearOff> {
        self.tearing.take()
    }

    /// 겨누는 창이 생기면 들고 있는 창을 숨긴다 (크롬의 합치기 미리보기).
    /// 반환값은 **상태가 바뀌었을 때만** `Some` — 매 틱 hide/show 를 부르면
    /// 창이 깜빡인다.
    pub(super) fn set_tear_hidden(&mut self, hidden: bool) -> Option<bool> {
        let tear = self.tearing.as_mut()?;
        if tear.hidden == hidden {
            return None;
        }
        tear.hidden = hidden;
        Some(hidden)
    }

    pub(super) fn activate(&mut self, tab_id: u32) -> Option<String> {
        let label = self.locate_tab(tab_id)?;
        self.windows.get_mut(&label)?.active = Some(tab_id);
        self.last_focused = Some(label.clone());
        Some(label)
    }

    /// 요청된 순서를 **현재 탭 집합으로 걸러** 적용한다 — 프런트가 낡은 목록을
    /// 보냈을 때 탭이 사라지거나 남의 탭이 끼어드는 걸 막는다.
    pub(super) fn reorder(&mut self, label: &str, requested: &[u32]) -> bool {
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

    pub(super) fn note_focus(&mut self, label: &str) {
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
    pub(super) fn project_in_use(&self, project_id: u32) -> bool {
        self.terminal_windows.contains(&project_id) || self.locate_project(project_id).is_some()
    }

    /// 새 탭이 붙을 창 — 마지막으로 포커스된 창.
    pub(super) fn preferred_window(&self) -> Option<String> {
        self.last_focused
            .as_ref()
            .filter(|l| self.windows.contains_key(*l))
            .cloned()
            .or_else(|| self.windows.keys().next().cloned())
    }
}

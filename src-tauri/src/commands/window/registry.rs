//! 창→프로젝트 레지스트리 — 순수 자료구조라 Tauri 런타임 없이 단위 테스트한다.
//!
//! 커맨드는 이 위에서 락을 잡고 상태를 바꾼 뒤 `events` 로 프런트에 알린다.

use super::*;

/// 창 라벨 → 그 창의 프로젝트 (`None` = 시작 창).
#[derive(Debug, Default)]
pub struct Registry {
    pub(super) windows: HashMap<String, Option<u32>>,
    /// 마지막으로 포커스된 창 — 메뉴 이벤트처럼 대상 창이 실려 오지 않는 요청이 쓴다.
    pub(super) last_focused: Option<String>,
    next_window: u32,
}

impl Registry {
    /// 이 프로젝트를 담은 창 — I1 이라 있어야 최대 하나.
    pub fn locate_project(&self, project_id: u32) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, p)| **p == Some(project_id))
            .map(|(label, _)| label.clone())
    }

    /// 창의 프로젝트. 레지스트리가 모르는 창이면 `None` 과 구분되도록 이중 `Option`.
    pub fn project_of(&self, label: &str) -> Option<Option<u32>> {
        self.windows.get(label).copied()
    }

    /// 진단용 한 줄 요약 — `main:start win-1:p7` 꼴.
    pub fn summary(&self) -> String {
        let mut labels: Vec<&String> = self.windows.keys().collect();
        labels.sort();
        labels
            .iter()
            .map(|label| match self.windows[*label] {
                Some(pid) => format!("{label}:p{pid}"),
                None => format!("{label}:start"),
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// 열려 있는 전체 프로젝트 id (시작 창의 「열림」 표시). 정렬해 돌려준다.
    pub fn all_open_projects(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.windows.values().filter_map(|p| *p).collect();
        ids.sort_unstable();
        ids
    }

    /// 지금의 창 구성을 스냅숏으로 뜬다 — 업데이트 재시작을 건너 되살리기 위한 것이다.
    pub fn session(&self) -> Session {
        let mut windows: Vec<SessionWindow> = self
            .windows
            .iter()
            .map(|(label, project)| SessionWindow {
                label: label.clone(),
                project: *project,
                ..SessionWindow::default()
            })
            .collect();
        // 복원 순서를 결정적으로 — `main` 이 먼저, 나머지는 라벨 순.
        windows.sort_by(|a, b| {
            (a.label != FIRST_WINDOW, &a.label).cmp(&(b.label != FIRST_WINDOW, &b.label))
        });
        Session {
            windows,
            focused: self.last_focused.clone(),
        }
    }

    /// 창 하나를 **저장된 라벨 그대로** 되살린다 — `tauri-plugin-window-state` 가
    /// 위치·크기를 라벨로 기억하므로, 같은 라벨이라야 창이 있던 자리에 뜬다. 이어서
    /// 발급될 라벨이 되살린 것과 부딪히지 않도록 `next_window` 도 민다.
    pub(super) fn restore_window(&mut self, label: &str, project: Option<u32>) {
        self.windows.insert(label.to_string(), project);
        if let Some(n) = label
            .strip_prefix(WINDOW_PREFIX)
            .and_then(|n| n.parse::<u32>().ok())
        {
            self.next_window = self.next_window.max(n);
        }
        self.last_focused = Some(label.to_string());
    }

    /// 창을 등록한다. `main` 처럼 이미 떠 있는 창을 편입하는 데도 쓴다.
    pub(super) fn register(&mut self, label: &str, project: Option<u32>) {
        self.windows.insert(label.to_string(), project);
        self.last_focused = Some(label.to_string());
    }

    /// 새 창 라벨을 발급하고 등록한다.
    pub(super) fn reserve(&mut self, project: Option<u32>) -> String {
        self.next_window += 1;
        let label = window_label(self.next_window);
        self.register(&label, project);
        label
    }

    /// 시작 창이 프로젝트를 고른다 — **그 창이** 그 프로젝트가 된다.
    ///
    /// 그 프로젝트가 이미 다른 창에 열려 있으면 바꾸지 않고 그 창을 돌려준다(I1) —
    /// 부르는 쪽이 그 창을 앞으로 가져온다. 모르는 창이면 `Err(())`.
    pub(super) fn adopt(&mut self, label: &str, project_id: u32) -> Result<Adopt, ()> {
        if let Some(owner) = self.locate_project(project_id) {
            return Ok(if owner == label {
                Adopt::Already
            } else {
                Adopt::ElsewhereIn(owner)
            });
        }
        let slot = self.windows.get_mut(label).ok_or(())?;
        // I3 — 프로젝트 창은 다른 프로젝트로 바뀌지 않는다.
        if slot.is_some() {
            return Err(());
        }
        *slot = Some(project_id);
        Ok(Adopt::Adopted)
    }

    /// 지운 프로젝트의 창을 시작 창으로 되돌린다. 돌려준 라벨이 그 창이다.
    pub(super) fn release_project(&mut self, project_id: u32) -> Option<String> {
        let label = self.locate_project(project_id)?;
        self.windows.insert(label.clone(), None);
        Some(label)
    }

    /// 창이 닫혔다 — 레지스트리에서 빼고 남은 창 수를 돌려준다.
    pub(super) fn remove(&mut self, label: &str) -> usize {
        self.windows.remove(label);
        if self.last_focused.as_deref() == Some(label) {
            self.last_focused = None;
        }
        self.windows.len()
    }

    pub(super) fn note_focus(&mut self, label: &str) {
        if self.windows.contains_key(label) {
            self.last_focused = Some(label.to_string());
        }
    }

    /// 프로젝트를 담은 창 하나 — 딥링크 확인 시트를 띄울 자리(시트는 프로젝트 창에만 있다).
    /// `focused` 가 프로젝트 창이면 그 창, 아니면 마지막 포커스 창, 그것도 아니면 라벨 순 첫 창.
    pub fn project_window(&self, focused: Option<&str>) -> Option<String> {
        let holds = |l: &str| matches!(self.windows.get(l), Some(Some(_)));
        focused
            .filter(|l| holds(l))
            .or_else(|| self.last_focused.as_deref().filter(|l| holds(l)))
            .map(str::to_string)
            .or_else(|| {
                let mut labels: Vec<&String> = self.windows.keys().filter(|l| holds(l)).collect();
                labels.sort();
                labels.first().map(|l| (*l).clone())
            })
    }

    /// 앞으로 가져올 창 — 마지막으로 포커스된 창, 없으면 아무 창.
    pub(super) fn preferred_window(&self) -> Option<String> {
        self.last_focused
            .as_ref()
            .filter(|l| self.windows.contains_key(*l))
            .cloned()
            .or_else(|| {
                let mut labels: Vec<&String> = self.windows.keys().collect();
                labels.sort();
                labels.first().map(|l| (*l).clone())
            })
    }
}

/// `Registry::adopt` 의 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Adopt {
    /// 이 창이 그 프로젝트가 됐다.
    Adopted,
    /// 이 창이 이미 그 프로젝트다 — 할 일이 없다.
    Already,
    /// 그 프로젝트는 다른 창에 열려 있다 — 그 창을 앞으로.
    ElsewhereIn(String),
}

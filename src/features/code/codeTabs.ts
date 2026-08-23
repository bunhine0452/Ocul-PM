// 코드 화면의 탭·분할 상태 — 순수 함수만. 컴포넌트에서 떼어 단위 테스트한다
// (treeUtils 와 같은 원칙).
//
// 왜 별도 모듈인가: 탭 하나를 닫는 것이 "배열에서 하나 빼기" 로 끝나지 않는다.
// 다음 활성 탭을 고르고, 창이 비면 분할을 접고, 포커스를 옮겨야 한다. 파일
// 조작(이름 바꾸기·삭제)이 들어오면 **열려 있는 탭의 경로까지** 따라 움직여야
// 한다 — 이 규칙들이 렌더 코드 사이에 흩어지면 곧 어긋난다.
//
// 상태는 영속된다 (WorkspaceContext 의 `codeTabs`). 직접 localStorage 를 만지는
// 것은 pnpm lint 가 막는다.

/** 창(pane) 하나에 열린 것들. */
export interface CodePaneTabs {
  /** 열린 파일 경로 — 탭 바의 좌→우 순서 그대로. */
  tabs: string[];
  /** 지금 보이는 파일. `tabs` 가 비면 null. */
  active: string | null;
}

/** 코드 화면 전체의 탭 상태. */
export interface CodeTabsState {
  /** 창. 길이 1 = 단일, 2 = 좌우 분할. 그 이상은 만들지 않는다. */
  panes: CodePaneTabs[];
  /** 키보드·저장·파일 조작이 향하는 창의 index. */
  focused: number;
}

/** 분할은 좌우 둘까지 — 셋 이상은 좁은 화면에서 어차피 못 쓴다. */
export const MAX_PANES = 2;

export function emptyTabs(): CodeTabsState {
  return { panes: [{ tabs: [], active: null }], focused: 0 };
}

/** 어느 창에든 열려 있는 경로 전체 (중복 제거). */
export function allOpenPaths(state: CodeTabsState): string[] {
  const seen = new Set<string>();
  for (const pane of state.panes) for (const p of pane.tabs) seen.add(p);
  return [...seen];
}

/** 지금 포커스된 창의 활성 파일 — 툴바·상태줄이 가리키는 대상. */
export function focusedPath(state: CodeTabsState): string | null {
  return state.panes[state.focused]?.active ?? null;
}

/**
 * 영속에서 되살린 값 정리. 저장된 JSON 은 이전 버전이 쓴 것일 수도, 손으로
 * 고쳐진 것일 수도 있다 — 렌더가 믿을 수 있는 모양으로 강제한다.
 */
export function sanitizeTabs(raw: unknown): CodeTabsState {
  const src = raw as Partial<CodeTabsState> | null | undefined;
  const rawPanes = Array.isArray(src?.panes) ? src.panes : [];
  const panes: CodePaneTabs[] = rawPanes.slice(0, MAX_PANES).map((pane) => {
    const tabs = Array.isArray(pane?.tabs)
      ? [...new Set(pane.tabs.filter((p): p is string => typeof p === "string" && p.length > 0))]
      : [];
    const active = typeof pane?.active === "string" && tabs.includes(pane.active) ? pane.active : (tabs[0] ?? null);
    return { tabs, active };
  });
  // 창이 하나도 없거나 두 번째가 비어 있으면 단일 창으로 접는다 — 빈 창이
  // 화면 절반을 먹은 채 되살아나는 것이 가장 나쁘다.
  const kept = panes.filter((p, i) => i === 0 || p.tabs.length > 0);
  if (kept.length === 0) return emptyTabs();
  const focused = typeof src?.focused === "number" && src.focused >= 0 && src.focused < kept.length ? src.focused : 0;
  return { panes: kept, focused };
}

// ─── 열기 · 닫기 ────────────────────────────────────────────────────────────

/** 파일을 창에 연다. 이미 열려 있으면 그 탭을 활성화만 한다. */
export function openFile(state: CodeTabsState, path: string, pane = state.focused): CodeTabsState {
  const index = clampPane(state, pane);
  const target = state.panes[index];
  const tabs = target.tabs.includes(path) ? target.tabs : [...target.tabs, path];
  return {
    panes: replacePane(state.panes, index, { tabs, active: path }),
    focused: index,
  };
}

export function activateTab(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const index = clampPane(state, pane);
  if (!state.panes[index].tabs.includes(path)) return state;
  return {
    panes: replacePane(state.panes, index, { ...state.panes[index], active: path }),
    focused: index,
  };
}

export function focusPane(state: CodeTabsState, pane: number): CodeTabsState {
  const index = clampPane(state, pane);
  return index === state.focused ? state : { ...state, focused: index };
}

/**
 * 탭 하나 닫기. 다음 활성 탭은 **오른쪽 이웃, 없으면 왼쪽** — 편집기의 관례다
 * (닫은 자리에 다음 것이 올라온다).
 */
export function closeTab(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const index = clampPane(state, pane);
  const target = state.panes[index];
  const at = target.tabs.indexOf(path);
  if (at < 0) return state;
  const tabs = target.tabs.filter((p) => p !== path);
  const active =
    target.active !== path ? target.active : (tabs[at] ?? tabs[at - 1] ?? null);
  return collapseEmptyPane({
    panes: replacePane(state.panes, index, { tabs, active }),
    focused: state.focused,
  });
}

/** 이 창의 다른 탭을 전부 닫는다. */
export function closeOthers(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const index = clampPane(state, pane);
  if (!state.panes[index].tabs.includes(path)) return state;
  return {
    panes: replacePane(state.panes, index, { tabs: [path], active: path }),
    focused: index,
  };
}

// ─── 분할 ───────────────────────────────────────────────────────────────────

/** 좌우 2분할. 이미 분할 중이면 반대쪽으로 포커스만 옮긴다. */
export function splitEditor(state: CodeTabsState): CodeTabsState {
  if (state.panes.length >= MAX_PANES) {
    return focusPane(state, state.focused === 0 ? 1 : 0);
  }
  const seed = state.panes[state.focused].active;
  return {
    panes: [...state.panes, seed ? { tabs: [seed], active: seed } : { tabs: [], active: null }],
    focused: state.panes.length,
  };
}

/** 분할 해제 — 두 번째 창의 탭을 첫 창으로 합친다 (미저장 편집은 버퍼에 그대로). */
export function unsplitEditor(state: CodeTabsState): CodeTabsState {
  if (state.panes.length < 2) return state;
  const [first, second] = state.panes;
  const tabs = [...new Set([...first.tabs, ...second.tabs])];
  // 포커스가 있던 쪽의 파일을 계속 보여준다 — 분할을 접었다고 보던 것이
  // 바뀌면 자리를 잃는다.
  const active = state.panes[state.focused].active ?? first.active ?? tabs[0] ?? null;
  return { panes: [{ tabs, active }], focused: 0 };
}

/** 탭을 반대쪽 창으로 보낸다. 분할 전이면 분할하면서 보낸다. */
export function moveTabToOtherPane(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const from = clampPane(state, pane);
  if (!state.panes[from].tabs.includes(path)) return state;
  if (state.panes.length < MAX_PANES) {
    const split: CodeTabsState = {
      panes: [...state.panes, { tabs: [path], active: path }],
      focused: state.panes.length,
    };
    return closeTab(split, from, path);
  }
  const to = from === 0 ? 1 : 0;
  return closeTab(openFile(state, path, to), from, path);
}

// ─── 파일 조작과의 정합 ─────────────────────────────────────────────────────
//
// 여기가 이 모듈의 존재 이유다. 디스크에서 파일이 사라지거나 이름이 바뀌었는데
// 탭이 옛 경로를 들고 있으면, 그 탭은 저장할 수도 되읽을 수도 없는 유령이 된다.

/**
 * 이름이 바뀐(혹은 옮겨진) 경로를 탭에 반영한다.
 *
 * `isDir` 이면 **접두사 전체**를 갈아끼운다 — 폴더 하나를 옮기면 그 아래 열려
 * 있던 파일이 전부 따라 움직여야 한다.
 */
export function renameOpenPath(
  state: CodeTabsState,
  from: string,
  to: string,
  isDir: boolean,
): CodeTabsState {
  const remap = (path: string): string => {
    if (path === from) return to;
    if (isDir && path.startsWith(from + "/")) return to + path.slice(from.length);
    return path;
  };
  let changed = false;
  const panes = state.panes.map((pane) => {
    const tabs = pane.tabs.map(remap);
    if (tabs.every((p, i) => p === pane.tabs[i])) return pane;
    changed = true;
    // 옮긴 자리에 이미 같은 이름의 탭이 있었을 수 있다 — 중복은 접는다.
    return { tabs: [...new Set(tabs)], active: pane.active ? remap(pane.active) : null };
  });
  return changed ? { ...state, panes } : state;
}

/** 지워진 경로(폴더면 그 아래 전부)의 탭을 닫는다. */
export function closeOpenPath(state: CodeTabsState, path: string, isDir: boolean): CodeTabsState {
  const gone = (p: string) => p === path || (isDir && p.startsWith(path + "/"));
  let changed = false;
  const panes = state.panes.map((pane) => {
    const tabs = pane.tabs.filter((p) => !gone(p));
    if (tabs.length === pane.tabs.length) return pane;
    changed = true;
    const at = pane.active ? pane.tabs.indexOf(pane.active) : -1;
    const active =
      pane.active && !gone(pane.active)
        ? pane.active
        : // 닫힌 자리에서 오른쪽으로 가장 가까운 살아남은 탭.
          (pane.tabs.slice(at + 1).find((p) => !gone(p)) ??
            pane.tabs.slice(0, Math.max(at, 0)).reverse().find((p) => !gone(p)) ??
            null);
    return { tabs, active };
  });
  return changed ? collapseEmptyPane({ ...state, panes }) : state;
}

/** 이 경로(폴더면 그 아래)에 걸리는, 열려 있는 파일들 — 삭제 확인에 보여준다. */
export function openPathsUnder(state: CodeTabsState, path: string, isDir: boolean): string[] {
  return allOpenPaths(state).filter((p) => p === path || (isDir && p.startsWith(path + "/")));
}

// ─── 내부 ───────────────────────────────────────────────────────────────────

function clampPane(state: CodeTabsState, pane: number): number {
  return pane >= 0 && pane < state.panes.length ? pane : state.focused;
}

function replacePane(panes: CodePaneTabs[], index: number, next: CodePaneTabs): CodePaneTabs[] {
  return panes.map((p, i) => (i === index ? next : p));
}

/** 분할 중에 한쪽이 비면 분할을 접는다 — 빈 창은 화면 절반을 낭비할 뿐이다. */
function collapseEmptyPane(state: CodeTabsState): CodeTabsState {
  if (state.panes.length < 2) return state;
  const emptyIndex = state.panes.findIndex((p) => p.tabs.length === 0);
  if (emptyIndex < 0) return state;
  return { panes: state.panes.filter((_, i) => i !== emptyIndex), focused: 0 };
}

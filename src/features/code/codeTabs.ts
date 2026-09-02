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
  /**
   * 이 창의 **미리보기 탭** — 훑어보려고 연 파일 한 자리. `tabs` 안에 있거나 null.
   *
   * 다음에 미리보기로 여는 파일이 이 자리를 차지한다. 그래서 트리를 스무 번
   * 눌러도 탭은 하나다. 고정되는 순간(더블클릭·편집·창 이동·메뉴) 보통 탭이
   * 되고 이 값은 null 로 돌아간다.
   */
  preview: string | null;
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
  return { panes: [{ tabs: [], active: null, preview: null }], focused: 0 };
}

/** 이 창의 미리보기 경로 — 탭 바가 기울임으로 그릴 대상. */
export function previewPath(state: CodeTabsState, pane: number): string | null {
  return state.panes[pane]?.preview ?? null;
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
    // 미리보기 필드가 없던 시절의 JSON 도 받는다 (undefined → null).
    const preview =
      typeof pane?.preview === "string" && tabs.includes(pane.preview) ? pane.preview : null;
    return { tabs, active, preview };
  });
  // 창이 하나도 없거나 두 번째가 비어 있으면 단일 창으로 접는다 — 빈 창이
  // 화면 절반을 먹은 채 되살아나는 것이 가장 나쁘다.
  const kept = panes.filter((p, i) => i === 0 || p.tabs.length > 0);
  if (kept.length === 0) return emptyTabs();
  const focused = typeof src?.focused === "number" && src.focused >= 0 && src.focused < kept.length ? src.focused : 0;
  return { panes: kept, focused };
}

// ─── 열기 · 닫기 ────────────────────────────────────────────────────────────

export interface OpenFileOptions {
  /**
   * 훑어보기로 여는가 (트리 단일 클릭). 켜면 이 창의 미리보기 자리를 **교체**한다.
   *
   * VS Code 와 같은 기본값이다: 미리보기로 여는 입구는 트리 단일 클릭 하나뿐이고
   * 팔레트·검색·코드 이동·일지는 전부 고정으로 연다 — 거기는 "훑어본다" 가
   * 아니라 "이걸 하려고 왔다" 는 신호다.
   */
  preview?: boolean;
  /**
   * 미저장 편집이 있는 경로들. 미리보기 자리가 미저장이면 **교체하지 않는다**.
   *
   * 원칙적으로 첫 편집이 곧바로 고정시키므로 미저장 미리보기 탭은 생기지
   * 않는다. 그래도 방어한다 — 미저장 편집이 화면에서 사라지는 경로를 코드
   * 수준에서 0으로 만든다.
   */
  dirtyPaths?: ReadonlySet<string>;
}

/** 파일을 창에 연다. 이미 열려 있으면 그 탭을 활성화만 한다. */
export function openFile(
  state: CodeTabsState,
  path: string,
  pane = state.focused,
  opts?: OpenFileOptions,
): CodeTabsState {
  const index = clampPane(state, pane);
  const target = state.panes[index];

  if (target.tabs.includes(path)) {
    // 이미 열려 있다 — 활성화만 한다. 미리보기 자리는 건드리지 않는다
    // (고정된 탭을 다시 눌렀다고 미리보기가 되면 그 탭이 사라질 수 있다).
    return {
      panes: replacePane(state.panes, index, { ...target, active: path }),
      focused: index,
    };
  }

  if (opts?.preview) {
    const slot = target.preview;
    const canReplace = slot != null && target.tabs.includes(slot) && !opts.dirtyPaths?.has(slot);
    // 자리 이동 없이 **같은 자리**에 새 경로를 얹는다 — 훑는 동안 탭이 좌우로
    // 튀면 다음에 누를 것을 눈으로 다시 찾아야 한다.
    const tabs = canReplace
      ? target.tabs.map((p) => (p === slot ? path : p))
      : [...target.tabs, path];
    return {
      panes: replacePane(state.panes, index, { tabs, active: path, preview: path }),
      focused: index,
    };
  }

  return {
    panes: replacePane(state.panes, index, {
      tabs: [...target.tabs, path],
      active: path,
      preview: target.preview,
    }),
    focused: index,
  };
}

/**
 * 미리보기 탭을 보통 탭으로 승격한다 (더블클릭 · 첫 편집 · 창 이동 · 메뉴).
 *
 * 그 경로가 미리보기가 아니면 **같은 상태를 그대로** 돌려준다 — 타자마다 부르는
 * 자리가 있어서(첫 편집), 여기서 새 객체를 만들면 매 글자 리렌더가 된다.
 */
export function pinTab(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const index = clampPane(state, pane);
  if (state.panes[index]?.preview !== path) return state;
  return {
    ...state,
    panes: replacePane(state.panes, index, { ...state.panes[index], preview: null }),
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
    panes: replacePane(state.panes, index, {
      tabs,
      active,
      preview: target.preview === path ? null : target.preview,
    }),
    focused: state.focused,
  });
}

/**
 * 포커스된 창의 활성 탭을 좌우 이웃으로 옮긴다 (⌃Tab · ⇧⌘]/[). 끝에서는
 * 반대쪽 끝으로 감아 돈다 — 브라우저 탭 순환과 같은 관례다.
 */
export function cycleTab(state: CodeTabsState, delta: 1 | -1): CodeTabsState {
  const pane = state.panes[state.focused];
  if (!pane || pane.tabs.length < 2 || pane.active == null) return state;
  const at = pane.tabs.indexOf(pane.active);
  const next = pane.tabs[(at + delta + pane.tabs.length) % pane.tabs.length];
  return activateTab(state, state.focused, next);
}

/** 이 창의 다른 탭을 전부 닫는다. */
export function closeOthers(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const index = clampPane(state, pane);
  if (!state.panes[index].tabs.includes(path)) return state;
  return {
    panes: replacePane(state.panes, index, {
      tabs: [path],
      active: path,
      // 남은 하나가 미리보기였다면 그대로 미리보기다 — "다른 탭 닫기" 는
      // 고정하겠다는 뜻이 아니다.
      preview: state.panes[index].preview === path ? path : null,
    }),
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
  // 새 창의 씨앗 탭은 **고정**이다 — 미리보기가 창을 넘어가면 한쪽에서 훑는
  // 것이 반대쪽에서 보던 파일을 갈아치운다.
  return {
    panes: [
      ...state.panes,
      seed
        ? { tabs: [seed], active: seed, preview: null }
        : { tabs: [], active: null, preview: null },
    ],
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
  // 미리보기 자리는 창마다 하나다 — 합칠 때는 첫 창의 것만 남긴다.
  const preview = first.preview && tabs.includes(first.preview) ? first.preview : null;
  return { panes: [{ tabs, active, preview }], focused: 0 };
}

/** 탭을 반대쪽 창으로 보낸다. 분할 전이면 분할하면서 보낸다. */
export function moveTabToOtherPane(state: CodeTabsState, pane: number, path: string): CodeTabsState {
  const from = clampPane(state, pane);
  if (!state.panes[from].tabs.includes(path)) return state;
  // 창을 옮기는 것은 "이걸 계속 볼 것" 이라는 신호다 — 도착한 탭은 고정이다.
  if (state.panes.length < MAX_PANES) {
    const split: CodeTabsState = {
      panes: [...state.panes, { tabs: [path], active: path, preview: null }],
      focused: state.panes.length,
    };
    return closeTab(split, from, path);
  }
  const to = from === 0 ? 1 : 0;
  return closeTab(pinTab(openFile(state, path, to), to, path), from, path);
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
    const next = [...new Set(tabs)];
    const preview = pane.preview ? remap(pane.preview) : null;
    return {
      tabs: next,
      active: pane.active ? remap(pane.active) : null,
      preview: preview && next.includes(preview) ? preview : null,
    };
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
    return { tabs, active, preview: pane.preview && !gone(pane.preview) ? pane.preview : null };
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

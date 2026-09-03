import { useCallback, useEffect, useRef, useState } from "react";
import {
  SquareTerminal,
  X,
  Search,
  Columns2,
  Rows2,
  PanelLeftDock,
  GripVertical,
} from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { requestManualEntry } from "@/lib/journalCompose";
// 모듈 t() 는 `formatMatchCount`(순수·테스트 대상) 용, useT() 는 컴포넌트 용.
import { t, useT } from "@/i18n";
import { useSettings } from "@/contexts/SettingsContext";
import { useProjectRuntime, useTerminalSessions, type TerminalTab } from "@/contexts/WorkspaceContext";
import {
  leaf,
  collectSids,
  splitPane,
  removePane,
  setRatio,
  siblingSid,
  clampRatio,
  type PaneNode,
  type PaneDir,
} from "@/lib/termPanes";
import { sessionColorStyle } from "@/lib/sessionColors";
import { useSessionColorMenu } from "./useSessionColorMenu";
import { TerminalInstance, type TerminalHandles, type ShellState } from "./TerminalInstance";
import { readSearchDecorations } from "./termTheme";
import { canAutoRename, shellTitleToTabLabel } from "./tabTitle";
import { summarizeShell } from "./shellStatus";
import { useAgentRuns } from "./useAgentRuns";
import {
  consumePendingDispatch,
  hasPendingDispatchFor,
  peekPendingDispatch,
  subscribePendingDispatch,
} from "./dispatchBus";
import { writeDispatchTo } from "./dispatchTarget";
import { registerCloseHandler } from "@/lib/closeIntent";
import { registerNewTabHandler } from "@/lib/newTabIntent";
import { focusOfTab, panesOfTab } from "./activePane";
import {
  contains,
  pickDropTarget,
  previewBox,
  toBox,
  type Box,
  type DragGeometry,
  type Moving,
  type PaneBox,
} from "./paneDrop";
import {
  reorderTerminalTabs,
  mergeTabIntoPane,
  movePaneToEdge,
  extractPaneToTab,
  sidsOf,
  type TabsState,
} from "./dragOps";
// 재배열 산술은 창 탭 스트립과 **같은 순수 함수**를 쓴다. 축을 모르는 함수라
// (중심 좌표 배열 + 포인터 좌표) 세로 레일에 그대로 통한다 — 두 탭 줄이 서로
// 다르게 반응하면 "어느 탭 줄이냐"에 따라 손이 달라져야 한다.
import { tabDropIndex, DRAG_START_PX } from "@/features/shell/tabOrder";
// 고스트의 감쇠는 창 탭과 **같은 것**을 쓴다 (lib/dragMotion.ts) — 두 물체가
// 다른 속도로 따라오면 같은 앱에서 손이 두 가지를 배워야 한다.
import { advanceGhost, ghostTransform, wantsReducedMotion } from "@/lib/dragMotion";
import {
  TERM_FONT_MIN as FONT_MIN,
  TERM_FONT_MAX as FONT_MAX,
  TERM_FONT_DEFAULT as FONT_DEFAULT,
  clampTermFont as clampFont,
} from "./fontSize";
import {
  TERM_DENSITIES,
  TERM_DENSITY_LABEL,
  clampTermDensity,
  termLineHeight,
  termPanePad,
} from "./density";
import { TerminalRail } from "./TerminalRail";
import { TerminalAgentPill } from "./TerminalAgentPill";
import type { PaneSignal } from "./agentMode";
import { TerminalBlockMenu } from "./TerminalBlockMenu";
import type { BlockActivation } from "./TerminalInstanceImpl";
import { TerminalShellStatus } from "./TerminalShellStatus";
import { formatCwdCrumb } from "./railModel";

// 터미널 본체 — 2026-07-20 대규모 개편 (iTerm2/cmux/Warp 참조).
//  - 세션 지속: PTY 는 화면을 떠나도 살아있고(백엔드 스크롤백 리플레이),
//    탭/페인을 닫을 때만 kill 한다.
//  - 분할 페인: 탭마다 이진 트리 레이아웃(@/lib/termPanes) — ⌘D 가로,
//    ⇧⌘D 세로, 드래그 리사이즈(로컬 오버레이 + pointerup 커밋), 포커스 링.
//  - 탭: 더블클릭 리네임, 호버 닫기, ⌘T/⌘W.
//  - 검색 오버레이(⌘F, addon-search), 글자 크기(⌘+/⌘-/⇧⌘0, 영속),
//    하단 상태바(탭·페인·단축키 힌트·글자크기·.oculpm 감시).
//
// 2026-08-28 — **시각 정체성 라운드**. 가로 탭 줄을 세로 세션 레일로 바꾸고
// (→ TerminalRail), 밀도 프리셋·앰비언트 페인 테두리·비활성 페인 디밍·라이브
// 경과 시간을 넣었다. 에이전트를 서너 개 띄워 놓고 몇 시간을 보는 화면이라
// "지금 어디에 타이핑되는가 · 무엇이 돌고 있는가"를 곁눈질로 알 수 있어야 한다.
//
// 2026-08-15 — **여러 면이 함께 쓰는 컴포넌트로 분리**했다 (예전엔 터미널
// 화면 파일 안에 붙어 있었다). 지금 이걸 그리는 곳은 셋이다:
//   ① 터미널 화면 (TerminalScreenV2)  ② 도크 (TerminalDock)  ③ 분리 창.
// 세션 목록은 셋이 **공유**한다 (WorkspaceContext.terminalTabs). 같은 PTY 에
// xterm 두 개가 동시에 붙으면 fit/resize 가 서로를 되돌려 화면이 떨리므로,
// **한 번에 하나만 마운트**해야 한다 — 그 심판은 ShellV2 가 본다.

/**
 * PTY 세션 id. 창 소유권을 id 에 새긴다 (멀티 창 T4) — 창을 닫을 때 백엔드가
 * `p<projectId>-` 접두사로 **자기 창의 세션만** 골라 죽여 좀비 셸을 막고, 두
 * 창이 같은 8자 난수를 뽑아 한쪽 입력이 남의 셸로 가는 사고도 구조적으로
 * 불가능해진다. 접두사 규격은 `src-tauri/src/commands/window.rs::pty_prefix_for`
 * 와 짝이다 — 한쪽만 바꾸면 정리가 조용히 실패한다.
 */
function newId(projectId: number | null): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return projectId == null ? rand : `p${projectId}-${rand}`;
}

/**
 * 검색 카운터 표시 — "3/17". 검색어가 없으면 빈 문자열, 일치가 없으면 안내,
 * 결과가 하이라이트 한계를 넘어 활성 인덱스를 못 셀 땐(-1) 총 개수만 보여준다.
 */
export function formatMatchCount(
  query: string,
  matches: { index: number; count: number } | null,
): string {
  if (!query) return "";
  if (!matches) return "";
  if (matches.count === 0) return t("term.matchNone");
  if (matches.index < 0) return t("term.matchCount", { n: matches.count });
  return `${matches.index + 1}/${matches.count}`;
}

export interface TerminalSurfaceProps {
  projectRoot: string | null;
  /**
   * 좁은 자리(도크)용 — 상태바에서 단축키 힌트를 빼고 여백을 줄인다.
   * 기능은 동일하다.
   */
  compact?: boolean;
  /**
   * 단축키(⌘F·⌘D·⌘L·⌘±)를 언제 들을지.
   *  - `always`: 이 면이 화면 전체를 차지한다 (터미널 화면·분리 창).
   *  - `focused`: 포커스가 이 면 안에 있을 때만. 도크는 다른 화면 위에 얹혀
   *    있으므로 이걸 써야 한다 — 아니면 일지를 읽다 누른 ⌘F 가 터미널
   *    스크롤백 검색을 연다.
   */
  keyboardScope?: "always" | "focused";
  /** 탭 줄 오른쪽 끝에 덧붙이는 버튼들 (도크의 자리 바꾸기·분리·닫기). */
  headerActions?: React.ReactNode;
  /** 포커스된 페인의 셸 통합이 켜져 있는지 — 화면 툴바 부제에 쓴다. */
  onShellActiveChange?: (active: boolean) => void;
  /**
   * 탭 줄의 빈 자리를 **창 드래그 영역**으로 쓴다 (분리 터미널 창 전용).
   *
   * 그 창은 `titleBarStyle: Overlay` 라 잡을 타이틀바가 없고, 탭 스트립도
   * 툴바도 없어 탭 줄이 유일한 상단 크롬이다 — 여기에 리전을 안 주면 창을
   * **아예 옮길 수 없다**. 도크·터미널 화면에서는 켜면 안 된다: 그쪽 탭 줄을
   * 끌면 앱 창 전체가 따라 움직인다.
   */
  dragRegion?: boolean;
  /**
   * ⌘T 를 **포커스와 무관하게** 이 면이 가져간다 (분리 터미널 창 전용).
   *
   * 앱 창에서는 포커스가 터미널 안에 있을 때만 가져간다 — 배경 프로젝트 탭도
   * 마운트된 채라(크롬식 탭) 포커스 말고는 "지금 보고 있는 터미널" 을 가릴
   * 방법이 없다. 분리 창에는 다른 탭이 아예 없으므로 그 조건이 필요 없고,
   * 오히려 포커스가 크롬 버튼에 가 있으면 ⌘T 가 통째로 씹힌다.
   */
  ownsNewTab?: boolean;
}

export function TerminalSurface({
  projectRoot,
  compact = false,
  keyboardScope = "always",
  headerActions,
  onShellActiveChange,
  dragRegion = false,
  ownsNewTab = false,
}: TerminalSurfaceProps) {
  const { t } = useT();
  // Phase 4 #workspace-split — 세션 조각과 런타임 조각만 구독한다. 검색어·
  // 플래너 접힘 같은 취향이 바뀌어도 터미널은 다시 그려지지 않는다.
  const { terminalTabs, terminalActiveId, setSessions } = useTerminalSessions();
  const runtime = useProjectRuntime();
  const { settings, set: setSetting } = useSettings();
  // 앱 전역 설정에서 읽는다 (2026-08-15) — 설정 화면·상태바·⌘± 가 한 값을
  // 공유하고, 창을 여러 개 띄워도 SQLite 라 전부 같은 크기가 된다.
  const fontSize = clampFont(settings.terminalFontSize || FONT_DEFAULT);
  // 밀도도 같은 이유로 앱 전역 설정이다 — 도크·터미널 화면·분리 창이 같은
  // 값을 봐야 창을 옮길 때 줄 간격이 튀지 않는다.
  const density = clampTermDensity(settings.terminalDensity);
  const lineHeight = termLineHeight(density);
  const railCollapsed = settings.terminalRailCollapsed;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 검색 결과 카운터 "3/17" — SearchAddon.onDidChangeResults 가 채운다.
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  // 드래그 중 비율은 로컬 오버레이로만 그리고 pointerup 에 컨텍스트로 커밋
  // (드래그 매 프레임 전역 상태를 흔들지 않기 위해).
  const [drag, setDrag] = useState<{ tabId: string; path: string; ratio: number } | null>(null);
  /**
   * 세션 옮기기 드래그 (2026-08-28) — 레일 카드나 페인을 집어 **다른 자리**로
   * 옮긴다. 위 `drag`(분할 비율 조절)와 이름이 비슷하지만 완전히 다른 조작이다.
   *
   *  - 레일 카드 → 페인 가장자리 : 두 세션을 나란히 (드래그 분할)
   *  - 레일 카드 → 레일          : 순서 바꾸기
   *  - 페인 그립 → 페인 가장자리 : 분할 안에서 자리 바꾸기
   *  - 페인 그립 → 레일          : 페인을 독립 세션으로 빼내기 (분할의 반대)
   */
  const [moving, setMoving] = useState<Moving | null>(null);
  /**
   * 같은 값의 ref. 포인터 처리는 rAF 로 미뤄지는데, 그 콜백은 예약된 시점의
   * 렌더 클로저를 들고 있어 최신 `moving` 을 못 본다 — 판정 재료는 여기서 읽는다.
   */
  const movingRef = useRef<Moving | null>(null);
  movingRef.current = moving;
  // 글자 크기 px 직접 입력 — 타이핑 중 초안(null = 편집 중 아님).
  const [fontDraft, setFontDraft] = useState<string | null>(null);

  // 단축키 스코프 판정용 — 이 면의 루트.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 드롭 판정에 필요한 기하 — 전부 ref 다. 드래그 중 매 프레임 읽으므로 상태로
  // 들고 있으면 재렌더가 자기 자신을 다시 재게 만든다.
  const railElRef = useRef<HTMLElement | null>(null);
  const cardElsRef = useRef(new Map<string, HTMLElement>());
  const bodyElRef = useRef<HTMLDivElement | null>(null);
  const paneElsRef = useRef(new Map<string, HTMLElement>());
  /**
   * 방금 드래그로 끝난 포인터인가 — 레일 카드의 `click` 이 뒤따라 오는데,
   * 그때 이미 사라진 세션을 고르면 활성 탭이 엉뚱한 데로 튄다 (합치기로 탭이
   * 하나 없어진 직후가 정확히 그 경우다).
   */
  const justMovedRef = useRef(false);

  // sid → xterm 핸들 (검색/포커스 제어). onReady 로 채워진다.
  const regRef = useRef(new Map<string, TerminalHandles>());

  // sid → 셸 통합 상태(OSC 133). 통합이 설치되지 않은 세션은 여기 안 들어온다.
  const [shellStates, setShellStates] = useState<Record<string, ShellState>>({});
  // sid → 페인 신호(alt-screen · BEL · 마지막 출력). 셸 통합과 **독립**으로
  // 온다 — 둘을 합쳐 "에이전트가 나를 기다리는가"를 판정한다 (→ agentMode).
  const [paneSignals, setPaneSignals] = useState<Record<string, PaneSignal>>({});
  // 거터 캡슐을 눌러 연 블록 액션 팝오버. 한 번에 하나만 뜬다.
  const [blockMenu, setBlockMenu] = useState<BlockActivation | null>(null);
  /**
   * 셸이 스스로 끝난 페인 (2026-09-02).
   *
   * 예전에는 `[프로세스 종료됨]` 한 줄을 찍고 끝이었다. 탭은 그대로 남고 PTY 만
   * 사라지므로, 거기 타이핑하면 백엔드의 "unknown pty session" 이 조용히
   * 버려졌다 — 사용자 눈에는 **먹통이 된 터미널**이고, 탭을 닫았다 여는 것
   * 말고는 되살릴 길이 없었다. 이제 사실을 말하고 손잡이를 준다.
   */
  const [ended, setEnded] = useState<Record<string, true>>({});
  /**
   * 다시 시작 횟수 — `TerminalInstance` 의 `key` 에 실어 **제자리 재마운트**를
   * 만든다. 세션 id 는 그대로라 마운트 경로(attach → 없음 → start)가 같은
   * 자리에 새 셸을 세운다.
   */
  const [restartNonce, setRestartNonce] = useState<Record<string, number>>({});

  // IN2 — 디스패치 프리필: 대기 중인 건을 활성 페인 PTY 에 써 둔다 (개행 없음
  // — 실행은 사용자가 Enter 로). sid 는 ref 로 최신을 읽는다 — deps 재실행(탭
  // 생성·라벨 갱신)이 재시도 체인을 취소하면 이미 consume 된 상태라 프리필이
  // 조용히 증발했었다. consume 은 쓰기 **성공 후에만**.
  //
  // 여기까지 오는 건 "생산자가 썼을 때 아직 셸이 없었다" 는 경우뿐이다 —
  // 살아있는 셸이면 생산자(`handoffDispatch`)가 그 자리에 직접 꽂는다. 그래서
  // 마운트 시점 한 번 + **대기열 구독** 둘 다 필요하다: 도크를 열어 둔 채
  // 셸이 뜨기 전에 디스패치하면 마운트는 이미 지나가 있다.
  const dispatchSidRef = useRef<string | null>(null);
  const dispatchBusyRef = useRef(false);
  // 대기 건의 주인만 집는다. 크롬식 탭에선 터미널 면이 탭마다 살아 있어(도크를
  // 열어 둔 탭 + 터미널 화면인 탭), 주인을 안 보면 남의 프로젝트 면이 먼저
  // 집어 그 셸(cwd = 남의 루트)에 프리필한다. ref 로 읽는 이유는 아래 pump 가
  // deps `[]` 로 한 번만 서기 때문 (sid 와 같은 이유).
  const dispatchProjectRef = useRef(runtime.currentProjectId);
  dispatchProjectRef.current = runtime.currentProjectId;
  useEffect(() => {
    let disposed = false;
    const pump = () => {
      if (disposed || dispatchBusyRef.current) return;
      if (!hasPendingDispatchFor(dispatchProjectRef.current)) return;
      dispatchBusyRef.current = true;
      let tries = 0;
      const stop = () => {
        dispatchBusyRef.current = false;
      };
      const retry = () => {
        if (tries++ < 50) setTimeout(tick, 300);
        else stop();
      };
      const tick = () => {
        if (disposed) return stop();
        const pending = peekPendingDispatch();
        const sid = dispatchSidRef.current;
        if (!pending) return stop();
        // 재시도하는 동안 주인이 다른 건으로 교체됐을 수 있다 (슬롯은 하나,
        // 마지막 의도가 이긴다) — 매 tick 다시 확인한다.
        if (!hasPendingDispatchFor(dispatchProjectRef.current)) return stop();
        if (!sid) return retry();
        void writeDispatchTo(sid, pending)
          .then((done) => {
            if (!done) return retry();
            consumePendingDispatch();
            stop();
          })
          .catch(retry);
      };
      tick();
    };
    pump();
    const off = subscribePendingDispatch(pump);
    return () => {
      disposed = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 명령 경계에서 코딩 에이전트 실행을 추적 → 세션 신호 + 일지 제안.
  // 셸 통합이 꺼져 있으면 shellStates 가 비어 있어 자동으로 no-op 이다.
  const { finished: finishedRuns, dismiss: dismissFinishedRun } = useAgentRuns(
    shellStates,
    runtime.currentProjectId,
  );

  const activeTab = terminalTabs.find((tab) => tab.id === terminalActiveId) ?? null;
  dispatchSidRef.current = activeTab ? focusOfTab(activeTab) : null;

  // Ensure at least one tab exists.
  useEffect(() => {
    if (terminalTabs.length === 0) {
      const id = newId(runtime.currentProjectId);
      const tab: TerminalTab = { id, label: "zsh", shell: "zsh", cwd: projectRoot ?? "" };
      setSessions(() => ({ terminalTabs: [tab], terminalActiveId: id }));
    } else if (terminalActiveId == null || !terminalTabs.some((tab) => tab.id === terminalActiveId)) {
      setSessions((prev) => ({ ...prev, terminalActiveId: terminalTabs[0].id }));
    }
  }, [terminalTabs, terminalActiveId, projectRoot, runtime.currentProjectId, setSessions]);

  // 닫힌 세션의 핸들 정리.
  useEffect(() => {
    const alive = new Set(terminalTabs.flatMap((tab) => collectSids(panesOfTab(tab))));
    for (const sid of regRef.current.keys()) {
      if (!alive.has(sid)) regRef.current.delete(sid);
    }
    // 셸 상태도 같이 회수 — 안 그러면 탭을 여닫을 때마다 맵이 무한정 자란다.
    const reap = <T,>(prev: Record<string, T>): Record<string, T> => {
      const stale = Object.keys(prev).filter((sid) => !alive.has(sid));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const sid of stale) delete next[sid];
      return next;
    };
    setShellStates(reap);
    setPaneSignals(reap);
    setEnded(reap);
    setRestartNonce(reap);
  }, [terminalTabs]);

  /**
   * 끝난 셸을 그 자리에서 다시 세운다. 세션 id 는 그대로 두고 xterm 만 새로
   * 만든다 — 탭·분할 배치도, 사용자가 지은 이름도 그대로다.
   */
  const restartPane = (sid: string) => {
    const drop = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    };
    setEnded(drop);
    // 죽은 셸의 마지막 상태·신호는 새 셸의 것이 아니다 — 함께 걷는다.
    setShellStates(drop);
    setPaneSignals(drop);
    setRestartNonce((prev) => ({ ...prev, [sid]: (prev[sid] ?? 0) + 1 }));
  };

  const patchTab = (id: string, fn: (tab: TerminalTab) => TerminalTab) =>
    setSessions((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) => (tab.id === id ? fn(tab) : tab)),
    }));

  // 세션 색 메뉴 — 상태·배선은 전용 훅이 소유한다 (이 파일은 이미 한계 초과).
  const colorMenu = useSessionColorMenu(terminalTabs, patchTab);

  const addTab = () => {
    const id = newId(runtime.currentProjectId);
    const n = terminalTabs.length + 1;
    const tab: TerminalTab = { id, label: `zsh ${n}`, shell: "zsh", cwd: projectRoot ?? "" };
    setSessions((prev) => ({
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: id,
    }));
  };

  const closeTab = (id: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === id);
    if (tab) for (const sid of collectSids(panesOfTab(tab))) void commands.killPtySession(sid);
    setSessions((prev) => {
      const remaining = prev.terminalTabs.filter((tab) => tab.id !== id);
      const nextActive =
        prev.terminalActiveId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : prev.terminalActiveId;
      return { terminalTabs: remaining, terminalActiveId: nextActive };
    });
  };

  const selectTab = (id: string) => setSessions((prev) => ({ ...prev, terminalActiveId: id }));

  const commitRename = () => {
    if (!renaming) return;
    const label = renaming.draft.trim();
    if (label) patchTab(renaming.id, (tab) => ({ ...tab, label }));
    setRenaming(null);
  };

  const splitFocused = (dir: PaneDir) => {
    if (!activeTab) return;
    const sid = focusOfTab(activeTab);
    const newSid = newId(runtime.currentProjectId);
    patchTab(activeTab.id, (tab) => ({
      ...tab,
      panes: splitPane(panesOfTab(tab), sid, dir, newSid),
      focusSid: newSid,
    }));
  };

  // ⌘W — 분할 중이면 포커스 페인만, 마지막 페인이면 탭을 닫는다.
  const closeFocusedPane = () => {
    if (!activeTab) return;
    const panes = panesOfTab(activeTab);
    const sid = focusOfTab(activeTab);
    if (panes.type === "leaf") {
      closeTab(activeTab.id);
      return;
    }
    const nextFocus = siblingSid(panes, sid);
    void commands.killPtySession(sid);
    patchTab(activeTab.id, (tab) => {
      const next = removePane(panesOfTab(tab), sid);
      return { ...tab, panes: next ?? leaf(tab.id), focusSid: nextFocus ?? undefined };
    });
  };

  const closePane = (sid: string) => {
    if (!activeTab) return;
    const panes = panesOfTab(activeTab);
    if (panes.type === "leaf") {
      closeTab(activeTab.id);
      return;
    }
    const nextFocus = siblingSid(panes, sid);
    void commands.killPtySession(sid);
    patchTab(activeTab.id, (tab) => {
      const next = removePane(panesOfTab(tab), sid);
      return { ...tab, panes: next ?? leaf(tab.id), focusSid: nextFocus ?? undefined };
    });
  };

  const focusPane = (tabId: string, sid: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.focusSid === sid) return;
    patchTab(tabId, (tab) => ({ ...tab, focusSid: sid }));
  };

  // ── 세션 옮기기 드래그 ────────────────────────────────────────────────────
  //
  // 판정은 전부 순수 함수(`paneDrop`)와 상태 변형(`dragOps`)에 있고, 여기서는
  // 포인터와 기하를 그쪽에 넘기는 배선만 한다. 포인터 캡처를 쓰므로 커서가
  // xterm 캔버스 위로 지나가도 move/up 을 계속 받는다 — 안 그러면 터미널이
  // 이벤트를 삼켜 드래그가 페인 위에서 끊긴다.

  /** 탭 목록 전체를 한 번에 바꾼다. 바뀐 게 없으면 상태를 건드리지 않는다. */
  const applyMove = (fn: (state: TabsState) => TabsState) =>
    setSessions((prev) => {
      const next = fn({ tabs: prev.terminalTabs, activeId: prev.terminalActiveId });
      if (next.tabs === prev.terminalTabs && next.activeId === prev.terminalActiveId) return prev;
      return { terminalTabs: next.tabs, terminalActiveId: next.activeId };
    });

  const beginMove =
    (kind: "tab" | "pane", tabId: string, sid?: string) =>
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      justMovedRef.current = false;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // 페인 그립은 뒤에 있는 터미널로 이벤트가 새면 안 된다 (선택·포커스 이동).
      if (kind === "pane") e.stopPropagation();
      const born: Moving = {
        kind,
        tabId,
        sid,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        rail: null,
        pane: null,
      };
      pointerRef.current = { x: e.clientX, y: e.clientY };
      ghostPoseRef.current = { x: e.clientX, y: e.clientY, tilt: 0 };
      // 판정에 쓸 기하는 **집는 순간** 한 번 잰다 (→ DragGeometry). 이때는 아직
      // 아무것도 안 움직였으므로 레이아웃이 깨끗하다.
      measureGeometry();
      // ref 를 **먼저** 채운다 — 첫 pointermove 가 이 렌더보다 먼저 올 수 있고,
      // 그때 ref 가 비어 있으면 그 프레임을 통째로 흘린다.
      movingRef.current = born;
      setMoving(born);
    };

  /**
   * 커서 밑의 페인과 그 가장자리. 자기 자신(또는 자기 탭 전체)은 건너뛴다 —
   * 자기 옆에 자기를 붙일 수는 없다.
   *
   * 숨은 탭의 페인은 `display:none` 이라 rect 가 0 이므로 자연히 제외된다.
   */
  const hitPane = (m: Moving, x: number, y: number) => {
    const geom = geomRef.current;
    if (!geom) return null;
    const skip = new Set<string>();
    if (m.kind === "pane") {
      skip.add(m.sid as string);
    } else {
      // 탭을 끌 때는 그 탭의 **모든** 페인이 제외된다. 지금 보이는 탭을 스스로
      // 끌고 있다면 대상이 하나도 안 남는데, 그게 옳다 — 자기 자신과 나란히
      // 놓을 수는 없다.
      const own = terminalTabs.find((tab) => tab.id === m.tabId);
      if (own) for (const sid of sidsOf(own)) skip.add(sid);
    }
    const boxes = skip.size ? geom.panes.filter((pane) => !skip.has(pane.sid)) : geom.panes;
    // 페인 사이 8px 손잡이와 캔버스 둘레 8px 여백까지 흡착한다 — 예전엔 상자
    // "안"만 봐서, 페인에서 페인으로 건너가는 동안 미리보기가 꺼졌다 켜지고
    // 하필 그 틈에서 손을 놓으면 조용히 아무 일도 일어나지 않았다.
    return pickDropTarget(boxes, x, y);
  };

  /** 레일 위 삽입 자리 — 세로 목록이라 카드 **중심 y** 로 잰다. */
  const hitRail = (y: number) => {
    const geom = geomRef.current;
    const rail = geom?.rail;
    if (!geom || !rail) return null;
    const index = tabDropIndex(geom.centers, y);
    // 캐럿은 그 자리 카드의 위 모서리, 맨 뒤면 마지막 카드의 아래 모서리.
    const at = geom.edges[index];
    const last = geom.edges[geom.edges.length - 1];
    const edge = Number.isFinite(at) ? at : Number.isFinite(last) ? last : rail.top;
    return { index, top: edge - rail.top };
  };

  /**
   * 기하를 다시 잰다 — 드래그를 시작할 때, 그리고 드래그 중 레이아웃이 실제로
   * 움직였을 때(창 크기·레일 스크롤)만.
   */
  const measureGeometry = () => {
    const panes: PaneBox[] = [];
    const boxBySid = new Map<string, Box>();
    for (const [sid, el] of paneElsRef.current) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const box = toBox(rect);
      panes.push({ sid, box });
      boxBySid.set(sid, box);
    }
    const railRect = railElRef.current?.getBoundingClientRect() ?? null;
    const cards = terminalTabs.map(
      (tab) => cardElsRef.current.get(tab.id)?.getBoundingClientRect() ?? null,
    );
    const centers = cards.map((r) => (r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY));
    const edges = cards.map((r) => (r ? r.top : Number.NaN));
    const tail = cards[cards.length - 1];
    edges.push(tail ? tail.bottom : Number.NaN);
    const bodyRect = bodyElRef.current?.getBoundingClientRect() ?? null;
    geomRef.current = {
      panes,
      boxBySid,
      rail: railRect ? toBox(railRect) : null,
      centers,
      edges,
      body: bodyRect ? toBox(bodyRect) : null,
    };
  };
  // 리스너는 드래그가 살아 있는 동안만 붙는다 — 아래 이펙트가 렌더 클로저를
  // 붙들지 않도록 최신 함수를 ref 로 넘긴다.
  const measureRef = useRef(measureGeometry);
  measureRef.current = measureGeometry;

  /**
   * 포인터를 프레임 단위로 묶는다.
   *
   * 예전엔 `pointermove` 마다 곧장 `setMoving` 을 했다. 포인터는 초당 60~120 번
   * 오는데 그때마다 이 컴포넌트(레일 + 살아 있는 xterm 페인 전부)가 다시 그려지고,
   * 그 렌더 안에서 `dropPreview` 가 다시 `getBoundingClientRect` 를 부르며, 다음
   * move 의 `hitPane` 이 **모든 페인**의 rect 를 또 읽었다 — 레이아웃을 더럽히고
   * 곧바로 다시 재는 짓을 프레임마다 반복한 셈이라 손이 무겁게 끌렸다.
   *
   * 이제 좌표만 ref 에 적고 rAF 한 번으로 몰아서 판정한다. 그리고 **판정 결과가
   * 그대로면 setState 를 하지 않는다** — 한 페인의 오른쪽 띠 안에서 커서를 흔드는
   * 동안은 재렌더가 0 번이다.
   */
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  /** 커서를 따라다니는 고스트 — 위치는 React 를 거치지 않고 직접 쓴다. */
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const geomRef = useRef<DragGeometry | null>(null);

  /**
   * 고스트의 자세 — 좌표와 기울기 (2026-08-29).
   *
   * 예전엔 `pointermove` 가 올 때마다 고스트를 커서 좌표에 **그대로** 박았다.
   * 1:1 로 붙긴 하는데, 손이 멈추면 물체도 같은 프레임에 딱 멎어서 종이 조각을
   * 끄는 게 아니라 커서 모양이 하나 바뀐 것처럼 보였다. 이제 매 프레임 남은
   * 거리의 일부만 좁히며 따라온다 — 관성이 아니라 **감쇠**라 오버슈트가 없고,
   * 몇 프레임 안에 손 밑으로 정확히 들어와 앉는다.
   */
  const ghostPoseRef = useRef({ x: 0, y: 0, tilt: 0 });
  const ghostRafRef = useRef<number | null>(null);

  const writeGhost = () => {
    const el = ghostElRef.current;
    if (!el) return;
    el.style.transform = ghostTransform(ghostPoseRef.current);
  };

  /** 고스트를 손 밑에 **즉시** 놓는다 — 태어나는 순간과 모션 최소화 설정용. */
  const snapGhost = () => {
    const { x, y } = pointerRef.current;
    ghostPoseRef.current = { x, y, tilt: 0 };
    writeGhost();
  };

  /**
   * 고스트만 도는 프레임 루프. 판정(`flushMove`)과 **분리한다**: 판정은 커서가
   * 움직일 때만 필요하지만, 따라붙기는 커서가 멎은 뒤에도 몇 프레임 더 돌아야
   * 물체가 손 밑으로 들어와 앉는다.
   */
  const startGhostLoop = () => {
    if (ghostRafRef.current != null) return;
    if (wantsReducedMotion()) {
      snapGhost();
      return;
    }
    const step = () => {
      const { pose, settled } = advanceGhost(ghostPoseRef.current, pointerRef.current);
      ghostPoseRef.current = pose;
      writeGhost();
      // 손 밑에 앉았으면 프레임을 놓는다 — 멈춰 있는 물체를 60fps 로 다시 그릴
      // 이유가 없다. 다음 `pointermove` 의 `flushMove` 가 도로 켠다.
      ghostRafRef.current = settled ? null : requestAnimationFrame(step);
    };
    ghostRafRef.current = requestAnimationFrame(step);
  };

  const stopGhostLoop = () => {
    if (ghostRafRef.current == null) return;
    cancelAnimationFrame(ghostRafRef.current);
    ghostRafRef.current = null;
  };

  // 드래그 중에만 리스너를 단다. 여기서 다시 재지 않으면 스크롤한 레일 위에
  // 옛 좌표로 캐럿이 뜬다 — 굳힌 기하의 유일한 대가다.
  const isMoving = moving != null;
  useEffect(() => {
    if (!isMoving) return;
    const remeasure = () => measureRef.current();
    window.addEventListener("resize", remeasure);
    // 스크롤은 버블하지 않는다 — 레일 목록의 것을 받으려면 캡처여야 한다.
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [isMoving]);

  // 드래그 도중 언마운트(창 닫기·화면 전환)되면 프레임이 남는다.
  useEffect(() => stopGhostLoop, []);

  const flushMove = () => {
    rafRef.current = null;
    const m = movingRef.current;
    if (!m) return;
    const { x, y } = pointerRef.current;
    const moved =
      m.moved || Math.abs(x - m.startX) > DRAG_START_PX || Math.abs(y - m.startY) > DRAG_START_PX;
    if (!moved) return;
    // 여기서는 루프를 켜기만 한다 — 좌표를 쫓는 일은 그쪽이 맡는다.
    startGhostLoop();

    const railBox = geomRef.current?.rail ?? null;
    const onRail = railBox ? contains(railBox, x, y) : false;
    const rail = onRail ? hitRail(y) : null;
    const pane = onRail ? null : hitPane(m, x, y);

    // 같은 자리를 겨누고 있으면 아무것도 하지 않는다 (고스트는 이미 움직였다).
    if (
      m.moved === moved &&
      m.rail?.index === rail?.index &&
      m.rail?.top === rail?.top &&
      m.pane?.sid === pane?.sid &&
      m.pane?.edge === pane?.edge
    ) {
      return;
    }
    setMoving({ ...m, moved, rail, pane });
  };

  const onMovePointer = (e: React.PointerEvent<HTMLElement>) => {
    if (!movingRef.current) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flushMove);
  };

  /** 예약된 프레임을 버린다 — 드래그가 끝난 뒤 판정이 한 번 더 돌면 안 된다. */
  const dropPendingFrame = () => {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const endMovePointer = () => {
    const m = movingRef.current;
    if (!m) return;
    dropPendingFrame();
    stopGhostLoop();
    geomRef.current = null;
    movingRef.current = null;
    setMoving(null);
    if (!m.moved) return; // 클릭이다 — 선택/포커스는 각 요소의 onClick 이 한다.
    justMovedRef.current = true;

    if (m.pane) {
      const { sid: target, edge } = m.pane;
      applyMove((prev) =>
        m.kind === "tab"
          ? mergeTabIntoPane(prev, m.tabId, target, edge)
          : movePaneToEdge(prev, m.tabId, m.sid as string, target, edge),
      );
      return;
    }
    const drop = m.rail;
    if (!drop) return;
    // 새 탭 id 는 리듀서 **밖에서** 만든다 — 안에서 만들면 StrictMode 이중
    // 호출이 서로 다른 id 를 뽑아 어느 쪽이 남을지 알 수 없게 된다.
    const bornId = newId(runtime.currentProjectId);
    applyMove((prev) =>
      m.kind === "tab"
        ? reorderTerminalTabs(prev, m.tabId, drop.index)
        : extractPaneToTab(prev, m.tabId, m.sid as string, drop.index, bornId),
    );
  };

  const cancelMove = () => {
    dropPendingFrame();
    stopGhostLoop();
    geomRef.current = null;
    movingRef.current = null;
    setMoving(null);
  };

  /** 드래그로 끝난 포인터의 뒤따르는 click 은 무시한다 (사라진 세션 선택 방지). */
  const selectFromRail = (id: string) => {
    if (justMovedRef.current) {
      justMovedRef.current = false;
      return;
    }
    selectTab(id);
  };

  const setFont = (px: number) => void setSetting("terminalFontSize", clampFont(px));
  // 델타는 화면에 보이는 값 기준이다 — 설정이 범위 밖 값을 들고 있어도
  // (수동 편집·과거 값) ⌘+ 한 번이 눈에 보이는 크기에서 한 칸 움직인다.
  const fontDelta = (d: number) => setFont(fontSize + d);
  const fontReset = () => setFont(FONT_DEFAULT);

  /** px 입력 커밋 — 빈 값·범위 밖은 현재 값으로 되돌린다. */
  const commitFontDraft = () => {
    if (fontDraft === null) return;
    const parsed = Number.parseInt(fontDraft, 10);
    if (Number.isFinite(parsed)) setFont(parsed);
    setFontDraft(null);
  };

  const focusedHandles = () => (activeTab ? regRef.current.get(focusOfTab(activeTab)) : undefined);

  /** 셸이 알려온 제목으로 탭 이름을 갱신 — 사용자가 직접 지은 이름은 보존. */
  const applyShellTitle = (tabId: string, title: string) => {
    const label = shellTitleToTabLabel(title);
    if (!label) return;
    setSessions((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) =>
        tab.id === tabId && canAutoRename(tab.label) && tab.label !== label
          ? { ...tab, label }
          : tab,
      ),
    }));
  };

  const openSearch = () => setSearchOpen(true);
  const closeSearch = () => {
    setSearchOpen(false);
    setMatches(null);
    focusedHandles()?.search.clearDecorations();
    focusedHandles()?.term.focus();
  };
  // 하이라이트 색은 테마 토큰에서 매번 새로 읽는다 (테마 전환 즉시 반영).
  const searchOptions = () => ({ decorations: readSearchDecorations() });
  const runSearch = (dirn: "next" | "prev") => {
    const h = focusedHandles();
    if (!h || !query) return;
    if (dirn === "next") h.search.findNext(query, searchOptions());
    else h.search.findPrevious(query, searchOptions());
  };

  /**
   * ⌘↑/⌘↓ — 명령 블록 사이를 건너뛴다. 300줄 뱉은 빌드 로그에서 다음
   * 프롬프트까지 스크롤바를 끌지 않아도 된다.
   *
   * 셸 통합이 없으면 블록이 하나도 없다 — 조용히 아무 일도 안 하는 대신
   * **왜 안 되는지** 말한다 (기능이 고장 난 것처럼 보이지 않게).
   */
  const gotoBlock = (dir: "prev" | "next") => {
    const h = focusedHandles();
    if (!h) return;
    const target = h.blocks.goto(dir);
    if (!target && h.blocks.list().length === 0) toast.info(t("term.block.none"));
  };

  /** ⌘L — 스크롤백을 비우고 현재 줄만 남긴다 (Terminal.app 의 ⌘K 자리). */
  const clearScreen = () => {
    const h = focusedHandles();
    if (!h) return;
    h.term.clear();
    h.term.focus();
  };

  // 화면-로컬 단축키 — 핸들러는 ref 로 항상 최신을 읽고 리스너는 1회 등록.
  const actionsRef = useRef({
    addTab,
    closeFocusedPane,
    splitFocused,
    openSearch,
    closeSearch,
    clearScreen,
    gotoBlock,
    fontDelta,
    fontReset,
    searchOpen,
    keyboardScope,
    ownsNewTab,
  });
  actionsRef.current = {
    addTab,
    closeFocusedPane,
    splitFocused,
    openSearch,
    closeSearch,
    clearScreen,
    gotoBlock,
    fontDelta,
    fontReset,
    searchOpen,
    keyboardScope,
    ownsNewTab,
  };
  /**
   * ⌘W — **포커스가 터미널 안에 있으면 페인을 닫는다** (2026-08-29).
   *
   * 여기는 keydown 이 아니라 "안쪽부터 닫기" 사슬(`lib/closeIntent`)로 온다.
   * macOS 에서 ⌘W 는 앱 메뉴의 accelerator 라 OS 가 먼저 먹어치우고 웹뷰에는
   * keydown 이 오지 않는다 — 예전에 여기 있던 ⌘W 분기가 그래서 한 번도 안 돌았고,
   * 터미널에 타이핑하다 ⌘W 를 눌러도 **프로젝트 탭**이 닫혔다. Rust 는 대신
   * `CloseIntent` 를 쏘므로, 그 사슬에 들어가는 것이 유일하게 동작하는 길이다.
   *
   * scope 를 주는 이유: 도크는 다른 화면 **위에 얹혀** 있어서 등록 순서만으로는
   * "지금 사용자가 어디에 있는가" 를 알 수 없다. 포커스가 이 면 안에 있을 때만
   * 우선권을 갖고, 아니면 뒤 화면(코드 탭·세션 탭)이 평소대로 받는다.
   */
  useEffect(
    () =>
      registerCloseHandler(
        () => {
          const root = rootRef.current;
          if (!root || !root.contains(document.activeElement)) return false;
          actionsRef.current.closeFocusedPane();
          return true;
        },
        () => rootRef.current,
      ),
    [],
  );

  /**
   * ⌘T — **포커스가 터미널 안에 있으면 셸 탭을 연다** (2026-09-01).
   *
   * ⌘W 와 판박이다: `⌘T` 도 앱 메뉴 액셀러레이터라(menu.rs `ACC_NEW_TAB`)
   * macOS 가 웹뷰보다 먼저 먹어치우고, 위 keydown 리스너의 ⌘T 분기는 한 번도
   * 돈 적이 없었다 — 셸에 타이핑하다 ⌘T 를 누르면 **프로젝트 탭**이 새로
   * 열렸다. 치트시트는 "⌘T = 터미널 새 탭" 이라고 적혀 있었으니 약속만 남고
   * 동작이 없던 셈이다. Rust 가 `NewTabIntent` 를 쏘므로 그 사슬에 들어가는
   * 것이 유일하게 동작하는 길이다.
   */
  useEffect(
    () =>
      registerNewTabHandler(
        () => {
          const root = rootRef.current;
          if (!root) return false;
          // 분리 창은 이 면이 곧 창이라 포커스를 묻지 않는다 (`ownsNewTab`).
          if (!actionsRef.current.ownsNewTab && !root.contains(document.activeElement)) {
            return false;
          }
          actionsRef.current.addTab();
          return true;
        },
        () => rootRef.current,
      ),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      // 도크는 다른 화면 **위에 얹혀** 있다 — 포커스가 터미널 안에 없는데도
      // ⌘F 를 가로채면 일지를 읽던 사용자가 스크롤백 검색을 만나게 된다.
      if (a.keyboardScope === "focused") {
        const root = rootRef.current;
        if (!root || !root.contains(document.activeElement)) return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        // ⌘T 는 여기 없다 — ⌘W 와 같이 앱 메뉴 액셀러레이터라 keydown 이 오지
        // 않는다. 아래 `registerNewTabHandler` 가 정본이다.
        if (k === "d") {
          e.preventDefault();
          e.stopPropagation();
          a.splitFocused(e.shiftKey ? "col" : "row");
        } else if (k === "f" && !e.shiftKey) {
          e.preventDefault();
          a.openSearch();
        } else if (k === "l" && !e.shiftKey) {
          // ⌘K 는 전역 커맨드 팔레트가 선점하므로(useGlobalShortcuts) ⌘L 을 쓴다.
          // 셸 자체의 Ctrl+L 은 그대로 PTY 로 흘러가 함께 동작한다.
          e.preventDefault();
          e.stopPropagation();
          a.clearScreen();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // 셸 자체의 히스토리(↑/↓)와 겹치지 않는다 — 저쪽은 수식어가 없다.
          e.preventDefault();
          e.stopPropagation();
          a.gotoBlock(e.key === "ArrowUp" ? "prev" : "next");
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          a.fontDelta(1);
        } else if (e.key === "-") {
          e.preventDefault();
          a.fontDelta(-1);
        } else if (e.shiftKey && (e.key === "0" || e.key === ")")) {
          // ⌘0 은 전역 화면 이동(navRegistry 10번째)이 함께 잡아가 눌렀을 때
          // 글자 크기 초기화 + 화면 전환이 동시에 일어났다 → ⇧⌘0 으로 옮긴다.
          e.preventDefault();
          e.stopPropagation();
          a.fontReset();
        }
      } else if (e.key === "Escape" && a.searchOpen) {
        a.closeSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
    path: string,
    dir: PaneDir,
  ) => {
    e.preventDefault();
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const calc = (ev: PointerEvent) =>
      clampRatio(
        dir === "row"
          ? (ev.clientX - rect.left) / Math.max(1, rect.width)
          : (ev.clientY - rect.top) / Math.max(1, rect.height),
      );
    const move = (ev: PointerEvent) => setDrag({ tabId, path, ratio: calc(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const ratio = calc(ev);
      patchTab(tabId, (tab) => ({ ...tab, panes: setRatio(panesOfTab(tab), path, ratio) }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 출력 안의 `src/foo.ts:42` ⌘클릭 → 외부 편집기. 경로는 터미널이 뱉은
  // 신뢰할 수 없는 문자열이므로 백엔드가 secure_join 으로 루트 안쪽인지 다시
  // 판정한다 — 거절당하면 조용히 넘기지 말고 이유를 보여준다.
  const openFileRef = useCallback(
    async (path: string, line: number | null) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(
        projectRoot,
        path,
        settings.externalEditorCommand,
        line,
      );
      if (res.status === "error")
        toast.destructive(t("term.openEditorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // 포커스된 페인의 셸 통합 상태 — 상태바(cwd·라이브 명령)와 툴바 부제가
  // 여기서 나온다. 요약 문구는 `TerminalShellStatus` 가 직접 만든다 (시계를
  // 그 안에 가두기 위해).
  const focusedShell = activeTab ? shellStates[focusOfTab(activeTab)] : undefined;
  const shellActive = focusedShell?.active === true;
  useEffect(() => {
    onShellActiveChange?.(shellActive);
  }, [shellActive, onShellActiveChange]);

  // 감사 fix (2026-07-16): 실제 워처 상태(oculpmStatus.watcher_state) 그대로.
  const watcher = runtime.oculpmStatus?.watcher_state ?? null;
  const watchLabel =
    watcher === "running"
      ? t("term.watchRunning")
      : watcher === "error"
        ? t("term.watchError")
        : t("term.watchOff");
  const watchColor =
    watcher === "running" ? "#57c98a" : watcher === "error" ? "var(--t-bug)" : "var(--text-3)";

  /**
   * 놓기 전에 보여 줄 상자 — `.term-body` 기준 좌표. 겨눈 페인의 **실제** 화면
   * 상자에서 계산하므로 여백·손잡이 폭이 이미 반영돼 있다.
   */
  const dropPreview = (() => {
    const target = moving?.pane;
    const geom = geomRef.current;
    const base = geom?.body;
    // 상자는 드래그 스냅샷에서 읽는다 — 렌더 도중 rect 를 다시 재면 그 프레임의
    // 레이아웃을 강제로 계산시키고, 다음 포인터가 또 그 값을 읽는다.
    const paneBox = target ? geom?.boxBySid.get(target.sid) : undefined;
    if (!target || !base || !paneBox) return null;
    const box = previewBox(paneBox, target.edge);
    if (!box) return null;
    return {
      left: box.left - base.left,
      top: box.top - base.top,
      width: box.width,
      height: box.height,
    };
  })();

  /**
   * 커서를 따라다니는 고스트의 이름표.
   *
   * 왜 필요한가: 예전엔 끌리는 카드가 제자리에서 흐려지기만 하고(`.dragging`)
   * 커서를 따라오는 것이 하나도 없었다. 직접 조작은 손과 물체가 1:1 로 붙어
   * 있어야 성립하는데, 손만 움직이고 물체는 가만히 있으니 캐럿이 한 칸씩 튈
   * 때마다 걸리는 느낌이 났다 — "뻑뻑함"의 정체가 이것이다.
   *
   * 레일 카드 자신을 옮기지 않는 이유: 레일은 `overflow: hidden` 이고 목록은
   * 세로 스크롤이라, 카드를 페인 쪽으로 끌면 레일 경계에서 잘려 사라진다.
   * 화면에 고정된 별도 요소만이 캔버스 위까지 따라갈 수 있다.
   */
  const ghostLabel = (() => {
    if (!moving?.moved) return null;
    const tab = terminalTabs.find((candidate) => candidate.id === moving.tabId);
    if (!tab) return null;
    return moving.kind === "pane" ? t("term.dragGhostPane", { label: tab.label }) : tab.label;
  })();

  // 끝난 실행은 sid 로 오고 레일은 탭 단위로 그린다 — 여기서 옮긴다.
  // 탭 수가 한 자리라 매 렌더 다시 만드는 비용은 무시할 만하다.
  const finishedByTab: Record<string, { agentLabel: string; duration: string } | undefined> = {};
  for (const tab of terminalTabs) {
    const run = finishedRuns[focusOfTab(tab)];
    if (run) finishedByTab[tab.id] = run;
  }

  const renderPane = (tab: TerminalTab, node: PaneNode, path: string): React.ReactNode => {
    const isActiveTab = tab.id === terminalActiveId;
    if (node.type === "leaf") {
      const focusSid = focusOfTab(tab);
      const count = collectSids(panesOfTab(tab)).length;
      const focused = count > 1 && node.sid === focusSid;
      // 앰비언트 상태 테두리 — 페인이 스스로 무슨 상태인지 말한다. 셸 통합이
      // 없으면 "off" 라 아무 색도 입지 않는다 (모르는 걸 초록으로 칠하지 않는다).
      const shell = shellStates[node.sid];
      const tone = (shell ? summarizeShell(shell)?.tone : null) ?? "off";
      const dropping = moving?.pane?.sid === node.sid;
      // 지금 손에 들려 있는 페인 — 제자리에 남은 것은 자국일 뿐이라는 표시.
      const lifted = moving?.moved === true && moving.kind === "pane" && moving.sid === node.sid;
      return (
        <div
          // 드롭 판정은 페인의 실제 화면 상자로 한다 — 트리를 따라 계산하면
          // 여백·분할 손잡이 폭만큼 어긋나 "가장자리를 겨눴는데 안 잡힌다".
          ref={(el) => {
            if (el) paneElsRef.current.set(node.sid, el);
            else paneElsRef.current.delete(node.sid);
          }}
          className={
            "term-pane" +
            (focused ? " focused" : "") +
            (count > 1 && !focused ? " dim" : "") +
            (lifted ? " lifted" : "") +
            (dropping ? " dropping" : "")
          }
          data-tone={tone}
          style={sessionColorStyle(tab.color)}
        >
          <TerminalInstance
            // 다시 시작 = 제자리 재마운트. sid 는 그대로다 (→ restartPane).
            key={`${node.sid}:${restartNonce[node.sid] ?? 0}`}
            sessionId={node.sid}
            cwd={tab.cwd || projectRoot || ""}
            visible={isActiveTab}
            fontSize={fontSize}
            lineHeight={lineHeight}
            persistent
            autoFocus={node.sid === focusSid}
            onReady={(h) => {
              regRef.current.set(node.sid, h);
              // 결과 수는 포커스된 페인의 것만 표시한다 (검색은 항상 포커스 페인 대상).
              h.search.onDidChangeResults((e) => {
                if (regRef.current.get(node.sid) !== h) return;
                setMatches({ index: e.resultIndex, count: e.resultCount });
              });
            }}
            onFocusIn={() => focusPane(tab.id, node.sid)}
            onTitleChange={(title) => applyShellTitle(tab.id, title)}
            onShellState={(shell) =>
              setShellStates((prev) =>
                prev[node.sid] === shell ? prev : { ...prev, [node.sid]: shell },
              )
            }
            onSignal={(signal) =>
              setPaneSignals((prev) =>
                prev[node.sid] === signal ? prev : { ...prev, [node.sid]: signal },
              )
            }
            onBlockActivate={setBlockMenu}
            onExit={() =>
              setEnded((prev) => (prev[node.sid] ? prev : { ...prev, [node.sid]: true }))
            }
            onOpenFileRef={projectRoot ? openFileRef : undefined}
          />
          {/* 에이전트 표시 — 판정과 1초 시계를 이 컴포넌트 안에 가둔다.
              여기서 하면 매초 페인 트리 전체가 다시 그려진다. */}
          <TerminalAgentPill shell={shell} signal={paneSignals[node.sid]} />
          {/* 끝난 셸 — 출력은 그대로 둔다 (읽고 복사할 수 있어야 한다). 아래에
              사실과 손잡이만 얹는다. */}
          {ended[node.sid] ? (
            <div className="term-ended" role="status">
              <span>{t("term.ended.title")}</span>
              <button
                type="button"
                className="ts-btn"
                onClick={() => restartPane(node.sid)}
                title={t("term.ended.restartHint")}
              >
                {t("term.ended.restart")}
              </button>
            </div>
          ) : null}
          {count > 1 ? (
            <>
              {/* 페인을 집는 손잡이. 마우스 전용 어포던스라 보조기술에는 감춘다
                  — 키보드 등가물은 ⌘D/⇧⌘D(분할)와 ⌘W(닫기)가 이미 있다.
                  캔버스 위에 직접 포인터를 걸면 셸 선택·드래그와 싸우므로,
                  잡는 자리를 따로 둔다 (iTerm2 도 페인은 손잡이로 옮긴다). */}
              <span
                className="pane-grip"
                role="presentation"
                aria-hidden="true"
                title={t("term.dragPaneHint")}
                onPointerDown={beginMove("pane", tab.id, node.sid)}
                onPointerMove={onMovePointer}
                onPointerUp={endMovePointer}
                onPointerCancel={cancelMove}
              >
                <GripVertical size={11} />
              </span>
              <button
                type="button"
                className="pane-close"
                onClick={() => closePane(node.sid)}
                aria-label={t("term.closePane")}
                title={t("term.closePaneHint")}
              >
                <X size={11} />
              </button>
            </>
          ) : null}
        </div>
      );
    }
    const ratio = drag && drag.tabId === tab.id && drag.path === path ? drag.ratio : node.ratio;
    return (
      <div className={"term-split " + node.dir}>
        <div className="term-cell" style={{ flexGrow: ratio }}>
          {renderPane(tab, node.a, path + "a")}
        </div>
        <div
          className={"term-divider " + node.dir}
          onPointerDown={(e) => startDrag(e, tab.id, path, node.dir)}
          role="separator"
          aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
        />
        <div className="term-cell" style={{ flexGrow: 1 - ratio }}>
          {renderPane(tab, node.b, path + "b")}
        </div>
      </div>
    );
  };

  return (
    <div
      className={"term-wrap" + (compact ? " compact" : "") + (moving?.moved ? " is-moving" : "")}
      ref={rootRef}
      style={{ "--term-pane-pad": `${termPanePad(density)}px` } as React.CSSProperties}
    >
      {/* 얇은 머리줄 — 레일 토글과 도구만 둔다 (2026-08-28). 세션 목록은 아래
          세로 레일이 맡는다.

          Tauri 는 클릭된 엘리먼트 **자신**의 속성만 본다 (조상을 타고 오르지
          않는다) — 그래서 컨테이너와 빈 스페이서에 각각 drag-region 을 붙이고,
          버튼에는 일부러 붙이지 않아 클릭이 그대로 산다. */}
      <div className="term-head" data-tauri-drag-region={dragRegion || undefined}>
        <button
          type="button"
          className="term-tool"
          onClick={() => void setSetting("terminalRailCollapsed", !railCollapsed)}
          title={t(railCollapsed ? "term.rail.expand" : "term.rail.collapse")}
          aria-label={t(railCollapsed ? "term.rail.expand" : "term.rail.collapse")}
          aria-pressed={!railCollapsed}
        >
          <PanelLeftDock size={14} />
        </button>
        <span className="term-head-spacer" data-tauri-drag-region={dragRegion || undefined} />
        <div className="term-tools">
          <button
            type="button"
            className="term-tool"
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            title={t("term.searchScrollbackHint")}
            aria-label={t("term.searchScrollback")}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => splitFocused("row")}
            title={t("term.splitRowHint")}
            aria-label={t("term.splitRow")}
          >
            <Columns2 size={14} />
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => splitFocused("col")}
            title={t("term.splitColHint")}
            aria-label={t("term.splitCol")}
          >
            <Rows2 size={14} />
          </button>
          {headerActions}
        </div>
      </div>

      <div className="term-main">
        <TerminalRail
          tabs={terminalTabs}
          shellStates={shellStates}
          paneSignals={paneSignals}
          finished={finishedByTab}
          onJournalFromRun={(id) => {
            requestManualEntry();
            const tab = terminalTabs.find((candidate) => candidate.id === id);
            if (tab) dismissFinishedRun(focusOfTab(tab));
          }}
          onDismissFinished={(id) => {
            const tab = terminalTabs.find((candidate) => candidate.id === id);
            if (tab) dismissFinishedRun(focusOfTab(tab));
          }}
          activeId={terminalActiveId}
          collapsed={railCollapsed}
          renaming={renaming}
          onSelect={selectFromRail}
          onClose={closeTab}
          onAdd={addTab}
          drag={{
            movingId: moving?.moved ? (moving.kind === "tab" ? moving.tabId : null) : null,
            caretTop: moving?.moved ? (moving.rail?.top ?? null) : null,
            registerRail: (el) => {
              railElRef.current = el;
            },
            registerCard: (id, el) => {
              if (el) cardElsRef.current.set(id, el);
              else cardElsRef.current.delete(id);
            },
            onPointerDown: (id, e) => beginMove("tab", id)(e),
            onPointerMove: onMovePointer,
            onPointerUp: endMovePointer,
            onPointerCancel: cancelMove,
          }}
          onRenameStart={(id, label) => setRenaming({ id, draft: label })}
          onRenameChange={(draft) => setRenaming((prev) => (prev ? { ...prev, draft } : prev))}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRenaming(null)}
          onCardMenu={colorMenu.open}
        />
        {colorMenu.node}

        <div className="term-body" ref={bodyElRef}>
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className="term-canvas"
              style={{ display: tab.id === terminalActiveId ? "flex" : "none" }}
            >
              {renderPane(tab, panesOfTab(tab), "")}
            </div>
          ))}
          {/* 놓으면 차지할 자리. 페인의 `::before`(상태 띠 z=4)·`::after`(포커스 링
            z=3)·`.pane-close`(z=5) 위에 와야 하므로 z-index 6 이다. */}
          {dropPreview && moving?.pane ? (
            // key 를 겨눈 자리로 준다 — 자리가 바뀌면 요소가 새로 태어나면서
            // 등장 애니메이션이 다시 돈다. 위치에 transition 을 거는 것과는
            // 다르다: 상자는 여전히 **즉시** 그 자리에 있고, 제자리에서 부풀 뿐이라
            // 화면을 가로질러 미끄러지는 자취가 남지 않는다.
            <div
              key={`${moving.pane.sid}:${moving.pane.edge}`}
              className="term-drop"
              style={dropPreview}
              aria-hidden="true"
            />
          ) : null}
          {searchOpen ? (
            <div className="term-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  const h = focusedHandles();
                  if (!h) return;
                  if (next) h.search.findNext(next, { incremental: true, ...searchOptions() });
                  else {
                    h.search.clearDecorations();
                    setMatches(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
                  else if (e.key === "Escape") closeSearch();
                }}
                placeholder={t("term.searchPlaceholder")}
                aria-label={t("term.searchLabel")}
              />
              <span
                className={"ts-count" + (query && matches?.count === 0 ? " empty" : "")}
                aria-live="polite"
              >
                {formatMatchCount(query, matches)}
              </span>
              <button
                type="button"
                className="ts-btn"
                onClick={() => runSearch("prev")}
                title={t("term.prevMatch")}
              >
                ↑
              </button>
              <button
                type="button"
                className="ts-btn"
                onClick={() => runSearch("next")}
                title={t("term.nextMatch")}
              >
                ↓
              </button>
              <button
                type="button"
                className="ts-btn"
                onClick={closeSearch}
                aria-label={t("term.closeSearch")}
                title={t("term.closeSearchHint")}
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {blockMenu ? (
        <TerminalBlockMenu
          activation={blockMenu}
          projectId={runtime.currentProjectId}
          onClose={() => setBlockMenu(null)}
          onFill={(command) => {
            const sid = activeTab ? focusOfTab(activeTab) : null;
            if (!sid) return;
            // 개행 없이 그대로 쓴다 — 실행은 사람이 Enter 로 (디스패치 프리필과
            // 같은 규약). `writeDispatchTo` 는 안 쓴다: 저쪽은 전경 프로세스를
            // 보고 에이전트면 프롬프트로 붙여넣는 다른 계약이다.
            void commands.writeToPty(sid, command).then((res) => {
              if (res.status === "error") toast.destructive(res.error);
            });
          }}
        />
      ) : null}

      <div className="term-status">
        {/* 왼쪽 = 어디에 있는가. 절대 경로는 좁은 줄에서 앞이 잘려 아무 정보도
            주지 못하므로 프로젝트 루트 기준 상대 경로로 접는다. 셸 통합이 없어
            cwd 를 모르면 세션 이름으로 물러선다. */}
        <span className="ts-seg ts-crumb" title={focusedShell?.cwd ?? undefined}>
          <SquareTerminal size={12} />
          <span className="ts-crumb-text">
            {formatCwdCrumb(focusedShell?.cwd ?? null, projectRoot) || activeTab?.label || "—"}
          </span>
        </span>
        {/* 가운데 = 지금 무슨 일이 일어나는가 (실행 중이면 1초마다 갱신). */}
        <TerminalShellStatus shell={focusedShell} />
        {/* 좁은 도크에서는 단축키 힌트가 다른 정보를 밀어낸다 — 넓을 때만. */}
        {compact ? null : <span className="ts-hint">{t("term.shortcuts")}</span>}
        <span style={{ flex: 1 }} />
        <label className="ts-seg ts-density" title={t("term.density.hint")}>
          {compact ? null : <span>{t("term.density.label")}</span>}
          <select
            className="ts-select"
            value={density}
            onChange={(e) => void setSetting("terminalDensity", clampTermDensity(e.target.value))}
            aria-label={t("term.density.label")}
          >
            {TERM_DENSITIES.map((preset) => (
              <option key={preset} value={preset}>
                {t(TERM_DENSITY_LABEL[preset])}
              </option>
            ))}
          </select>
        </label>
        <span className="ts-seg">
          <button
            type="button"
            className="ts-btn"
            onClick={() => fontDelta(-1)}
            aria-label={t("term.fontSmaller")}
          >
            A−
          </button>
          <span className="ts-font">
            <input
              type="number"
              className="ts-font-input"
              min={FONT_MIN}
              max={FONT_MAX}
              step={1}
              value={fontDraft ?? String(fontSize)}
              aria-label={t("term.fontSizeInput")}
              title={t("term.fontSizeHint", { min: FONT_MIN, max: FONT_MAX })}
              onChange={(e) => {
                const raw = e.target.value;
                setFontDraft(raw);
                // 범위 안 값만 즉시 반영 — "1"(→18 을 치는 중)이 9 로 튀지 않게
                // 클램프 없이 통과시킨다. 범위 밖·빈 값은 blur 에서 정리.
                const parsed = Number.parseInt(raw, 10);
                if (parsed >= FONT_MIN && parsed <= FONT_MAX) setFont(parsed);
              }}
              onBlur={commitFontDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFontDraft();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFontDraft(null);
                  e.currentTarget.blur();
                }
              }}
            />
            px
          </span>
          <button
            type="button"
            className="ts-btn"
            onClick={() => fontDelta(1)}
            aria-label={t("term.fontLarger")}
          >
            A+
          </button>
        </span>
        {compact ? null : (
          <span className="ts-seg">
            <span className="ts-dot" style={{ background: watchColor }} />
            {watchLabel}
          </span>
        )}
      </div>
      {/* 손에 들린 것. 위치는 rAF 안에서 `transform` 으로 직접 쓴다 — 좌표를
          상태에 담으면 포인터마다 이 컴포넌트(살아 있는 xterm 페인 전부)가
          다시 그려져, 고치려던 그 무게가 그대로 돌아온다. */}
      {ghostLabel == null ? null : (
        <div
          className="term-ghost"
          aria-hidden="true"
          ref={(el) => {
            ghostElRef.current = el;
            // 첫 프레임부터 커서 위에 있어야 한다 — 기본 위치(0,0)에 한 번
            // 그려지면 왼쪽 위에서 날아오는 것처럼 보인다. 태어날 때만은
            // 따라붙기(감쇠)를 건너뛰고 손 밑에 바로 놓는다.
            if (el) snapGhost();
          }}
        >
          <SquareTerminal size={12} />
          <span className="tg-name">{ghostLabel}</span>
        </div>
      )}
    </div>
  );
}

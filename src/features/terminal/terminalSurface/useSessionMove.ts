// 세션 옮기기 드래그(레일 카드·페인 그립 → 페인 가장자리/레일) — `TerminalSurface.tsx`
// 에서 옮겨 왔다 (2026-09-15 분할). 판정은 paneDrop·dragOps 의 순수 함수, 여기는
// 포인터·기하·고스트 배선. 이펙트 순서(리스너 → 고스트 정리) 와 ref 공유 불변.
import { useEffect, useRef, useState } from "react";
import type { useT } from "@/i18n";
import type { TerminalTab, TerminalSessionsValue } from "@/contexts/WorkspaceContext";
import {
  contains,
  pickDropTarget,
  previewBox,
  toBox,
  type Box,
  type DragGeometry,
  type Moving,
  type PaneBox,
} from "../paneDrop";
import {
  reorderTerminalTabs,
  mergeTabIntoPane,
  movePaneToEdge,
  extractPaneToTab,
  sidsOf,
  type TabsState,
} from "../dragOps";
// 재배열 산술은 창 탭 스트립과 **같은 순수 함수**를 쓴다. 축을 모르는 함수라
// (중심 좌표 배열 + 포인터 좌표) 세로 레일에 그대로 통한다 — 두 탭 줄이 서로
// 다르게 반응하면 "어느 탭 줄이냐"에 따라 손이 달라져야 한다.
import { tabDropIndex, DRAG_START_PX } from "@/features/shell/tabOrder";
// 고스트의 감쇠는 창 탭과 **같은 것**을 쓴다 (lib/dragMotion.ts) — 두 물체가
// 다른 속도로 따라오면 같은 앱에서 손이 두 가지를 배워야 한다.
import { advanceGhost, ghostTransform, wantsReducedMotion } from "@/lib/dragMotion";
import { newId } from "./sessionId";

export interface SessionMoveDeps {
  terminalTabs: TerminalTab[];
  setSessions: TerminalSessionsValue["setSessions"];
  projectId: number | null;
  selectTab: (id: string) => void;
  t: ReturnType<typeof useT>["t"];
}

export function useSessionMove({ terminalTabs, setSessions, projectId, selectTab, t }: SessionMoveDeps) {
  /**
   * 세션 옮기기 드래그 (2026-08-28) — 레일 카드나 페인을 집어 **다른 자리**로
   * 옮긴다. `useSplitDrag` 의 `drag`(분할 비율 조절)와 이름이 비슷하지만 완전히 다른 조작이다.
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
    const bornId = newId(projectId);
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

  return {
    moving,
    railElRef,
    cardElsRef,
    bodyElRef,
    paneElsRef,
    ghostElRef,
    snapGhost,
    beginMove,
    onMovePointer,
    endMovePointer,
    cancelMove,
    selectFromRail,
    dropPreview,
    ghostLabel,
  };
}

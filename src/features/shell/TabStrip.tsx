/**
 * 탭 스트립 — 크롬식 탭 (01b-chrome-tabs.md §4).
 *
 * 클릭 전환 · 닫기 · 드래그 순서 변경 · **창 밖으로 떼어내기** · **다른 창의
 * 스트립에 떨어뜨려 다시 붙이기** (2026-08-28).
 *
 * 창 간 드래그의 몫은 셋으로 나뉜다 — 이 파일은 ②와 그리기만 한다.
 *   ① 어느 창 위인가: Rust (`tab_drag_over`, 창 기하는 Rust 만 안다)
 *   ② 어느 탭 **사이**인가: 받는 창의 이 컴포넌트 (탭 폭은 CSS 가 정한다)
 *   ③ 실제 이동: Rust (`attach_tab`)
 *
 * 산술(삽입 인덱스·재배열·떼어내기 판정)은 전부 `tabOrder.ts` 의 순수 함수라
 * 여기서는 포인터를 그쪽에 넘기는 배선만 한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, FolderGit2, LayoutGrid } from "lucide-react";
import type { Project, TabInfo } from "@/lib/bindings";
import { useT } from "@/i18n";
import {
  resolveProjectColor,
  resolveProjectIcon,
} from "@/features/onboarding/home/projectAppearance";
import { tabDropIndex, reorderTabs, isDetachGesture, DRAG_START_PX } from "./tabOrder";
import { advanceGhost, ghostTransform, wantsReducedMotion } from "@/lib/dragMotion";
import { clampGhost, setDraggingCursor } from "@/lib/nativeDrag";

/**
 * macOS 신호등이 차지하는 좌측 폭. `TitleBarStyle::Overlay` 라 신호등이
 * 콘텐츠 위에 떠 있으므로 첫 탭이 그 아래 깔리지 않게 비워 둔다
 * (Chrome/Safari 도 같은 처리).
 */
const TRAFFIC_LIGHT_INSET = 78;

/**
 * 받는 스트립이 벌리는 자리의 폭 (CSS px). 자리표시자 탭도 같은 폭이다.
 *
 * 끌려오는 탭의 **진짜** 폭을 쓰지 않는 이유: 그 폭은 보내는 창의 CSS 가 정하고
 * 이름 길이마다 달라서, 받는 쪽이 알려면 드래그 내내 하나 더 주고받아야 한다.
 * 자리가 벌어졌다는 사실만 읽히면 되므로 고정 폭이 싸고 흔들리지 않는다.
 */
const INCOMING_SLOT_PX = 132;

/** 고스트가 창 가장자리에서 유지하는 여백 (CSS px). */
const GHOST_EDGE_PX = 10;

/** 새로 온 탭이 자리를 잡는 데 걸리는 시간 — CSS `tabstrip-arrive` 와 같아야 한다. */
const ARRIVE_MS = 260;

/**
 * 받는 창이 그릴 "끌려오는 탭" 의 겉모습. 백엔드가 스트립에 처음 들어선
 * 프레임에만 실어 보낸다 (`TabDragOver.preview`).
 */
export interface IncomingTab {
  name: string;
  icon: string | null;
  color: string | null;
  isStart: boolean;
}

interface TabStripProps {
  tabs: TabInfo[];
  activeId: number | null;
  isMac: boolean;
  /** 세션이 도는 프로젝트 — 백그라운드 탭의 활동을 점으로 알린다. */
  busyProjects: Set<number>;
  /** 아직 어느 탭에서도 열려 있지 않은 프로젝트 — `+` 팝오버 목록. */
  closedProjects: Project[];
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onReorder: (order: number[]) => void;
  /**
   * 새 창으로 떼어낸다.
   *
   * 좌표는 화면 좌표가 아니라 **새 창 안의 앵커** — 잡았던 자리가 커서 밑에
   * 그대로 오도록, 새 창 좌상단에서 그 지점까지의 거리(CSS px)다. 창을 놓는
   * 일은 Rust 가 OS 커서로 하므로(결정 2, 줌에 안 흔들린다) 여기서는 "무엇을
   * 커서 밑에 둘지" 만 말한다. 메뉴에서 부르면 겨눈 지점이 없어 `null` 이다.
   */
  onDetach: (tabId: number, anchorX: number | null, anchorY: number | null) => void;
  onNewTab: () => void;
  onOpenProject: (projectId: number) => void;
  /**
   * 다른 창에서 끌려온 탭이 지금 이 스트립 위에 있다 — 창 안쪽 CSS x.
   * `null` 이면 없다. (논리 px → CSS px 환산은 창이 한다 — 웹뷰 줌을 아는 쪽.)
   */
  incomingX?: number | null;
  /**
   * 끌려오는 탭의 겉모습 — 받는 스트립이 자리표시자에 이름·아이콘을 붙인다.
   * `incomingX` 가 있는데 이게 없으면 이름 없는 빈 자리로 그린다 (열화 경로).
   */
  incoming?: IncomingTab | null;
  /** 위 x 로 계산한 삽입 자리를 되돌려 준다 — 백엔드가 기억했다가 놓을 때 쓴다. */
  onIncomingIndex?: (index: number) => void;
  /**
   * 드래그가 스트립 밖으로 나갔다 — 다른 창을 겨누는지 물어봐 달라.
   * `stripHeight` 는 이 스트립의 CSS 높이 (창이 줌을 곱해 논리 px 로 바꾼다).
   */
  onDragHover?: (tabId: number, stripHeight: number) => void;
  /**
   * 손을 놓았다. 다른 창에 붙었으면 `true` — 그때는 떼어내기도 재배열도 하지
   * 않는다 (탭은 이미 남의 창에 있다).
   */
  onDragDrop?: (tabId: number) => Promise<boolean>;
  /** 드래그가 스트립 안으로 돌아왔거나 취소됐다 — 겨누던 캐럿을 지운다. */
  onDragCleanup?: () => void;
  /** 지금 겨누는 다른 창이 있다 — 스트립을 "넘겨주는 중" 으로 그린다. */
  handingOff?: boolean;
  /**
   * 탭을 보낼 수 있는 **다른** 창들 (이 창은 빠져 있다). 컨텍스트 메뉴가 그린다.
   *
   * 드래그만으로는 닫히지 않는 구멍이 둘 있다: 키보드·보조기술 사용자에게는
   * 길이 아예 없고, 창이 겹쳐 있으면 포인터로도 조준이 어렵다.
   */
  windowChoices?: WindowChoice[];
  /** 메뉴가 열렸다 — 목록을 새로 읽어 달라 (창은 언제든 늘고 준다). */
  onMenuOpen?: () => void;
  onMoveToWindow?: (tabId: number, window: string) => void;
}

export interface WindowChoice {
  /** 창 라벨 (`win-3` 등) — 백엔드가 아는 이름. */
  label: string;
  /** 사람이 읽는 이름 — 그 창에서 지금 보이는 탭의 이름. */
  name: string;
  tabCount: number;
}

interface DragState {
  tabId: number;
  startX: number;
  /** DRAG_START_PX 를 넘기 전에는 클릭으로 취급한다. */
  moved: boolean;
  order: number[];
  detaching: boolean;
  /**
   * 탭 **안쪽** 어디를 잡았나 (탭 왼쪽 위 기준 CSS px).
   *
   * 고스트를 이 오프셋만큼 물려 놓으면, 스트립을 벗어나는 순간 탭이 손가락
   * 아래 **잡았던 그 자리** 그대로 떨어져 나온다. 커서 끝에 붙이면 물체가 한 번
   * 튀고, 그 한 번이 "떼어낸 게 맞나" 를 의심하게 만든다.
   */
  grabX: number;
  grabY: number;
}

export function TabStrip({
  tabs,
  activeId,
  isMac,
  busyProjects,
  closedProjects,
  onActivate,
  onClose,
  onReorder,
  onDetach,
  onNewTab,
  onOpenProject,
  incomingX = null,
  incoming = null,
  onIncomingIndex,
  onDragHover,
  onDragDrop,
  onDragCleanup,
  handingOff = false,
  windowChoices = [],
  onMenuOpen,
  onMoveToWindow,
}: TabStripProps) {
  const { t } = useT();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  /**
   * 포인터 처리를 rAF 로 묶기 위한 그림자 상태.
   *
   * 예전엔 `pointermove` 마다 곧장 `setDrag` 를 했다 — 항상 새 객체라 순서가
   * 그대로여도 스트립 전체가 다시 그려졌고, 그 직전에 **모든 탭**의 rect 를
   * 읽어 레이아웃을 강제로 다시 계산했다. rAF 한 번으로 몰고, 순서가 안 바뀌면
   * 상태를 건드리지 않는다.
   */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  /** 끌린 탭의 드래그 시작 시점 화면 x, 그리고 지금 걸어 둔 이동량. */
  const homeXRef = useRef(0);
  const appliedDxRef = useRef(0);
  /**
   * 스트립을 벗어난 동안 손을 따라다니는 **고스트** (2026-08-29).
   *
   * 스트립 안에서는 탭 자신이 움직이면 되지만(크롬), 밖으로 나가는 순간 그 길이
   * 끊긴다 — `.tabstrip-tabs` 가 `overflow: hidden` 이라 탭은 줄 밖으로 못 나가고
   * 스트립은 창 맨 위 38px 이다. 그래서 예전엔 창 밖으로 끌어도 손에 아무것도
   * 없었고, 스트립이 흐려지는 것만이 유일한 신호였다: **무엇을** 떼어내는지도,
   * 어디로 가는지도 안 보였다.
   *
   * 자세는 React 를 거치지 않고 프레임마다 직접 쓴다 (감쇠는 `dragMotion.ts`).
   */
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const ghostPoseRef = useRef({ x: 0, y: 0, tilt: 0 });
  const ghostRafRef = useRef<number | null>(null);
  /** 커서가 창 밖으로 나가 고스트가 가장자리에 붙었나 — 자리표시 문구가 갈린다. */
  const [ghostPinned, setGhostPinned] = useState(false);
  /**
   * 위 값의 그림자. 프레임마다 `setGhostPinned` 를 부르면 값이 그대로여도 스트립이
   * 다시 그려진다 — 고스트를 React 밖에서 그리는 이유가 그것인데 여기서 도로
   * 불러들이면 아무 소용이 없다.
   */
  const pinnedRef = useRef(false);
  const markPinned = (on: boolean) => {
    if (pinnedRef.current === on) return;
    pinnedRef.current = on;
    setGhostPinned(on);
  };
  const [adderOpen, setAdderOpen] = useState(false);
  /**
   * 탭 컨텍스트 메뉴 — 드래그의 **등가물**이다 (우클릭 · Shift+F10 · 메뉴 키).
   * `left` 는 스트립 기준 x 라 탭이 스크롤·리사이즈로 움직여도 그 자리에 열린다.
   */
  const [menu, setMenu] = useState<{ tabId: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /**
   * 받는 쪽 — 끌려온 탭이 꽂힐 자리와 캐럿을 그릴 x (스트립 기준 CSS px).
   *
   * 캐럿은 탭 **사이**에 끼우지 않고 절대 위치로 띄운다: `role="tablist"` 는
   * `role="tab"` 만 직계 자식으로 받으므로(axe `aria-required-children`), 사이에
   * 끼우면 접근성 구조가 깨진다.
   */
  const [caret, setCaret] = useState<{ index: number; left: number } | null>(null);
  /** 같은 인덱스를 반복해 보고하지 않기 위한 직전 값. */
  const reportedRef = useRef<number | null>(null);

  // 드래그 중에는 로컬 순서로 그려 즉각 반응하게 하고, 놓을 때 백엔드에 커밋한다.
  const order = drag?.order ?? tabs.map((tb) => tb.tab_id);
  const byId = new Map(tabs.map((tb) => [tb.tab_id, tb]));
  const shown = order.map((id) => byId.get(id)).filter((tb): tb is TabInfo => tb != null);

  // `+` 팝오버 바깥 클릭 닫기.
  useEffect(() => {
    if (!adderOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".tabstrip-adder")) setAdderOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [adderOpen]);

  /**
   * 받는 쪽 — 끌려온 x 를 자기 탭 기하로 재서 삽입 자리를 정하고 백엔드에
   * 되돌려 준다. 여기서 계산하는 이유는 하나다: 탭 폭은 CSS 가 정하므로
   * (이름 길이에 따라 96~200px) DOM 을 가진 쪽만 답을 알 수 있다.
   */
  useEffect(() => {
    if (incomingX == null) {
      setCaret(null);
      reportedRef.current = null;
      return;
    }
    // 기하는 `offsetLeft/offsetWidth` 로 읽는다 — `getBoundingClientRect` 는
    // **transform 이 반영된** 값이라, 자리를 벌리려고 뒤쪽 탭을 밀어 두면 그
    // 밀린 위치가 다음 프레임의 판정으로 되먹임돼 자리가 앞뒤로 진동한다.
    // offset* 은 레이아웃 값이라 transform 에 흔들리지 않는다.
    const strip = stripRef.current;
    const stripLeft = strip?.getBoundingClientRect().left ?? 0;
    const boxes = order.map((id) => {
      const el = tabRefs.current.get(id);
      return el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
    });
    const centers = boxes.map((b) =>
      b ? stripLeft + b.left + b.width / 2 : Number.POSITIVE_INFINITY,
    );
    const index = tabDropIndex(centers, incomingX);
    // 자리는 그 탭의 **왼쪽 모서리**, 맨 뒤면 마지막 탭의 오른쪽 모서리
    // (스트립 기준 — 인라인 `left` 로 그대로 쓴다).
    const last = boxes[boxes.length - 1];
    const left = boxes[index]?.left ?? (last ? last.left + last.width : 0);
    setCaret({ index, left });
    if (reportedRef.current !== index) {
      reportedRef.current = index;
      onIncomingIndex?.(index);
    }
    // `order` 는 매 렌더 새 배열이라 의존성에 넣으면 무한 루프가 된다 —
    // 탭 기하는 ref 로 그때그때 읽으므로 x 만 보면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingX, tabs.length]);

  /**
   * 새로 들어온 탭 — 한 번만 등장 모션을 준다.
   *
   * 창 사이로 옮겨진 탭이 **아무 예고 없이** 스트립에 나타나면, 놓은 자리와
   * 앉은 자리가 같은지조차 눈으로 확인할 수 없다. 붙이기·새 탭·프로젝트 열기가
   * 모두 같은 길로 오므로 판정도 한 곳에서 한다: 직전 렌더에 없던 id.
   */
  const [arriving, setArriving] = useState<ReadonlySet<number>>(() => new Set());
  const knownRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    const ids = new Set(tabs.map((tb) => tb.tab_id));
    const known = knownRef.current;
    knownRef.current = ids;
    // 첫 렌더는 "등장"이 아니다 — 창을 열 때 탭 전부가 튀어나오면 안 된다.
    if (known == null) return;
    const fresh = [...ids].filter((id) => !known.has(id));
    if (fresh.length === 0) return;
    setArriving((prev) => new Set([...prev, ...fresh]));
    const timer = setTimeout(() => {
      setArriving((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, ARRIVE_MS);
    return () => clearTimeout(timer);
  }, [tabs]);

  // 메뉴 바깥 클릭 · Escape 로 닫기. 닫을 때 포커스를 원래 탭으로 되돌린다 —
  // 안 되돌리면 키보드 사용자가 메뉴를 닫는 순간 문서 맨 앞으로 튕긴다.
  const closeMenu = (restoreFocus = true) => {
    const tabId = menu?.tabId;
    setMenu(null);
    if (restoreFocus && tabId != null) tabRefs.current.get(tabId)?.focus();
  };

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".tabstrip-menu")) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  // 열리면 첫 항목으로 포커스를 옮긴다 (WAI-ARIA menu 규약).
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, [menu]);

  const openMenu = (tabId: number, anchor: HTMLElement | null) => {
    const strip = stripRef.current?.getBoundingClientRect();
    const rect = anchor?.getBoundingClientRect();
    setMenu({ tabId, left: (rect?.left ?? strip?.left ?? 0) - (strip?.left ?? 0) });
    onMenuOpen?.();
  };

  /** 메뉴 안 위아래 이동 — 끝에서 감싼다 (WAI-ARIA menu). */
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[((at < 0 ? 0 : at) + step + items.length) % items.length].focus();
  };

  const beginDrag = (tabId: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 포인터 캡처 — 커서가 창 밖으로 나가도 move/up 을 계속 받아야
    // "떼어내기"를 판정할 수 있다.
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const born: DragState = {
      tabId,
      startX: e.clientX,
      moved: false,
      order: tabs.map((tb) => tb.tab_id),
      detaching: false,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
    };
    pointerRef.current = { x: e.clientX, y: e.clientY };
    homeXRef.current = rect.left;
    appliedDxRef.current = 0;
    // 첫 pointermove 가 이 렌더보다 먼저 올 수 있다 — ref 를 먼저 채운다.
    dragRef.current = born;
    setDrag(born);
  };

  // ── 고스트 (스트립 밖) ──────────────────────────────────────────────────

  /** 이번 프레임 고스트가 있어야 할 자리 — 잡은 오프셋을 물고, 창 안에 가둔다. */
  const ghostTarget = () => {
    const d = dragRef.current;
    const el = ghostElRef.current;
    const { x, y } = pointerRef.current;
    const want = { x: x - (d?.grabX ?? 0), y: y - (d?.grabY ?? 0) };
    if (!el) return { ...want, outside: false };
    return clampGhost(
      want,
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: window.innerWidth, h: window.innerHeight },
      GHOST_EDGE_PX,
    );
  };

  const writeGhost = () => {
    const el = ghostElRef.current;
    if (el) el.style.transform = ghostTransform(ghostPoseRef.current);
  };

  /** 고스트를 손 밑에 **즉시** 놓는다 — 태어나는 순간과 모션 최소화 설정용. */
  const snapGhost = () => {
    const at = ghostTarget();
    ghostPoseRef.current = { x: at.x, y: at.y, tilt: 0 };
    writeGhost();
    markPinned(at.outside);
  };

  /**
   * 고스트만 도는 프레임 루프. 판정(`flushDrag`)과 분리한다 — 판정은 커서가
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
      const at = ghostTarget();
      const { pose, settled } = advanceGhost(ghostPoseRef.current, at);
      ghostPoseRef.current = pose;
      writeGhost();
      markPinned(at.outside);
      ghostRafRef.current = settled ? null : requestAnimationFrame(step);
    };
    ghostRafRef.current = requestAnimationFrame(step);
  };

  /**
   * 고스트 엘리먼트를 잡는 ref — **정체성이 고정**돼야 한다.
   *
   * 인라인 화살표로 주면 렌더마다 새 함수라 React 가 떼었다 다시 붙이고, 그때마다
   * `snapGhost` 가 돌아 물체가 커서에 딱 박힌다 — 감쇠가 매번 처음부터 다시
   * 시작되는 셈이라 "따라온다" 가 끊긴다. 붙는 순간에만 한 번 앉히면 된다.
   */
  const snapGhostRef = useRef(() => {});
  snapGhostRef.current = snapGhost;
  const attachGhost = useCallback((el: HTMLDivElement | null) => {
    ghostElRef.current = el;
    // 태어나는 순간 손 밑에 정확히 놓는다 — 첫 프레임에 (0,0) 에서 날아오면
    // 떼어낸 게 아니라 어디선가 튀어나온 것으로 보인다.
    if (el) snapGhostRef.current();
  }, []);

  const stopGhostLoop = () => {
    if (ghostRafRef.current == null) return;
    cancelAnimationFrame(ghostRafRef.current);
    ghostRafRef.current = null;
  };

  // 드래그 도중 언마운트(창 닫기·탭 이동)되면 프레임과 전역 커서가 남는다.
  useEffect(
    () => () => {
      stopGhostLoop();
      setDraggingCursor(false);
    },
    [],
  );

  /**
   * 끌리는 탭을 커서에 붙여 둔다 — React 를 거치지 않고 직접 쓴다.
   *
   * 이게 없던 시절이 "뻑뻑함"의 본체였다: 손을 움직여도 탭은 제자리에 있고
   * 그림자만 얹힌 채, 이웃 탭들이 한 칸씩 툭툭 자리를 바꿨다. 직접 조작은 손과
   * 물체가 붙어 있어야 성립한다 (Chrome 탭이 하는 그대로다).
   *
   * 이동량은 탭 줄 안으로 가둔다 — `.tabstrip-tabs` 가 `overflow: hidden` 이라
   * 밖으로 밀면 잘려서 사라진다. 줄을 벗어나는 동안은 이 함수가 손을 떼고
   * 고스트가 물체를 넘겨받는다 (`returnDraggedHome` → `startGhostLoop`).
   */
  const paintDragged = (state: DragState) => {
    const el = tabRefs.current.get(state.tabId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // rect 에는 지금 걸린 transform 이 이미 반영돼 있다 — 빼서 "제자리"를 얻는다.
    // 재배열로 탭이 다른 칸으로 옮겨 가면 이 제자리가 바뀌므로, 시작 위치만
    // 기억하고 매 프레임 다시 재야 한다 (안 하면 순서가 바뀌는 순간 탭이 한 칸
    // 폭만큼 튄다).
    const home = rect.left - appliedDxRef.current;
    const want = homeXRef.current + (pointerRef.current.x - state.startX);
    let dx = want - home;
    const bounds = el.parentElement?.getBoundingClientRect();
    if (bounds) {
      dx = Math.min(Math.max(dx, bounds.left - home), bounds.right - rect.width - home);
    }
    appliedDxRef.current = dx;
    el.style.transform = `translateX(${dx}px)`;
  };

  /**
   * 끌린 탭을 줄 안 제자리로 되돌린다 — 스트립을 벗어난 동안.
   *
   * 고스트가 손을 따라가는 동안 원래 탭까지 옆으로 밀려 있으면 물체가 둘로
   * 보인다. 제자리에 흐리게 남겨 두면 "취소하면 여기" 가 읽힌다.
   */
  const returnDraggedHome = () => {
    const id = dragRef.current?.tabId;
    const el = id == null ? null : tabRefs.current.get(id);
    if (el && appliedDxRef.current !== 0) el.style.transform = "";
    appliedDxRef.current = 0;
  };

  /** 끌린 탭을 제자리로 돌려놓는다 — 손을 놓거나 취소했을 때. */
  const clearDragPaint = () => {
    const id = dragRef.current?.tabId;
    if (id != null) {
      const el = tabRefs.current.get(id);
      if (el) el.style.transform = "";
    }
    appliedDxRef.current = 0;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopGhostLoop();
    markPinned(false);
    setDraggingCursor(false);
  };

  /** 드래그를 되돌린다 — Escape · pointercancel. 순서도 창도 건드리지 않는다. */
  const cancelDrag = () => {
    if (!dragRef.current) return;
    clearDragPaint();
    dragRef.current = null;
    setDrag(null);
    onDragCleanup?.();
  };

  const flushDrag = () => {
    rafRef.current = null;
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = pointerRef.current;
    const moved = d.moved || Math.abs(x - d.startX) > DRAG_START_PX;
    if (!moved) return;
    setDraggingCursor(true);

    const strip = stripRef.current?.getBoundingClientRect();
    const detaching = strip ? isDetachGesture(strip, y) : false;

    // 떼어내는 중에는 자리를 흔들지 않는다 — 커서가 스트립 밖에 있으니
    // 삽입 위치를 계산해 봐야 의미가 없고 화면만 요동친다.
    if (detaching) {
      if (!d.moved || !d.detaching) setDrag({ ...d, moved, detaching });
      // 탭은 줄 안에 제자리로 돌려놓고(그 자리가 "취소하면 여기") 손을 따라가는
      // 일은 고스트에 넘긴다.
      returnDraggedHome();
      startGhostLoop();
      // 창 밖으로 나간 동안만 물어본다 — 스트립 안에서는 물어볼 이유가 없고,
      // 매 프레임 IPC 를 때리면 재배열이 뚝뚝 끊긴다.
      onDragHover?.(d.tabId, strip?.height ?? 0);
      return;
    }
    // 스트립 안으로 돌아왔다 — 남의 창에 남겨 둔 캐럿을 지우고 고스트를 접는다.
    if (d.detaching) {
      onDragCleanup?.();
      stopGhostLoop();
      markPinned(false);
    }

    paintDragged(d);
    const centers = d.order.map((id) => {
      const rect = tabRefs.current.get(id)?.getBoundingClientRect();
      return rect ? rect.left + rect.width / 2 : Number.POSITIVE_INFINITY;
    });
    const from = d.order.indexOf(d.tabId);
    const to = tabDropIndex(centers, x);
    const order = reorderTabs(d.order, from, to);
    // 순서도 상태도 그대로면 재렌더할 이유가 없다 — 탭은 이미 커서에 붙어 있다.
    if (d.moved === moved && !d.detaching && order.join() === d.order.join()) return;
    setDrag({ ...d, moved, detaching: false, order });
  };

  /**
   * Escape 로 되돌린다 — 끄는 조작에는 반드시 무르는 길이 있어야 한다.
   *
   * 여기가 없으면 잘못 집었을 때 빠져나갈 길이 "원래 자리에 정확히 되놓기" 뿐인데,
   * 그 자리는 이미 이웃들이 비켜서서 어디였는지 알 수 없다.
   */
  const isDragging = drag?.moved ?? false;
  useEffect(() => {
    if (!isDragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelDrag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `cancelDrag` 는 매 렌더 새 함수지만 읽는 것은 전부 ref 라 최신이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flushDrag);
  };

  /**
   * 떼어낸 창 안에서 커서 밑에 와야 할 지점 (창 좌상단 기준 CSS px).
   *
   * 새 창에서 이 탭은 **혼자**라 첫 자리에 앉는다 — 그래서 지금 첫 탭이 앉은
   * 자리(신호등 인셋·패딩이 이미 반영돼 있다)에 잡았던 오프셋을 더하면 된다.
   */
  const detachAnchor = (state: DragState) => {
    const strip = stripRef.current?.getBoundingClientRect();
    const first = tabRefs.current.get(state.order[0]);
    return {
      x: (strip?.left ?? 0) + (first?.offsetLeft ?? 0) + state.grabX,
      y: (strip?.top ?? 0) + (first?.offsetTop ?? 0) + state.grabY,
    };
  };

  const endDrag = () => {
    const state = dragRef.current;
    if (!state) return;
    // 비동기 경계를 넘으므로 앵커는 지금 재 둔다 (놓고 나면 탭이 사라진다).
    const anchor = detachAnchor(state);
    clearDragPaint();
    dragRef.current = null;
    setDrag(null);
    if (!state.moved) {
      onActivate(state.tabId);
      return;
    }
    // 스트립 밖에서 놓았다 — **다른 창에 붙이기가 먼저**다. 겨누는 창이 있으면
    // 그리로 합치고, 없을 때만 새 창으로 떼어낸다. 순서를 뒤집으면 남의 창 위에
    // 정확히 떨어뜨려도 새 창이 하나 더 생긴다.
    if (state.detaching) {
      if (!onDragDrop) {
        onDetach(state.tabId, anchor.x, anchor.y);
        return;
      }
      void onDragDrop(state.tabId)
        .catch(() => false)
        .then((attached) => {
          if (!attached) onDetach(state.tabId, anchor.x, anchor.y);
        });
      return;
    }
    onDragCleanup?.();
    const before = tabs.map((tb) => tb.tab_id);
    if (state.order.join() !== before.join()) onReorder(state.order);
  };

  return (
    <div
      ref={stripRef}
      className={
        "tabstrip" +
        (drag?.detaching ? " is-detaching" : "") +
        (drag?.detaching && handingOff ? " is-handoff" : "") +
        (caret ? " is-receiving" : "")
      }
      style={isMac ? { paddingLeft: TRAFFIC_LIGHT_INSET } : undefined}
    >
      {/* `role="tablist"` 는 `tab` 만 자식으로 가져야 한다 — `+` 버튼과 드래그
          리전은 바깥에 둔다 (안에 두면 aria-required-children 위반). */}
      <div className="tabstrip-tabs" role="tablist" aria-label={t("tabs.stripLabel")}>
        {shown.map((tb, at) => {
          const active = tb.tab_id === activeId;
          const dragging = drag?.moved && drag.tabId === tb.tab_id;
          // 떼어내는 중인 탭은 **자국**으로만 남는다 — 물체는 고스트가 들고 있다.
          const torn = dragging && drag?.detaching;
          // 받는 쪽 — 꽂힐 자리 뒤의 탭들이 비켜서서 자리를 벌린다. 자리표시자가
          // 그 틈에 들어앉으므로, 캐럿 한 줄보다 "무엇이 어디에" 가 분명해진다.
          const shifted = caret != null && at >= caret.index;
          const isStart = tb.project_id == null;
          const label = isStart ? t("tabs.startTab") : tb.name;
          const busy = tb.project_id != null && busyProjects.has(tb.project_id);
          // 탭도 카드와 **같은** 아이콘·색을 쓴다 — 두 화면에서 같은 프로젝트가
          // 다르게 보이면 색으로 식별한다는 목적이 무너진다.
          const TabIcon = isStart ? LayoutGrid : resolveProjectIcon(tb.name, tb.icon).Icon;
          const tabColor = isStart ? undefined : resolveProjectColor(tb.name, tb.color);
          return (
            // `role="tablist"` 는 `role="tab"` 을 **직계 자식**으로 요구한다
            // (axe `aria-required-children` — presentation 껍데기를 끼우면 깨진다).
            // 그래서 닫기 버튼은 탭 안에 두되 보조기술에서는 감추고(중첩 위젯
            // 방지), 키보드 등가물로 Delete/Backspace 를 준다 — VS Code 와 같은
            // 구조다.
            <div
              key={tb.tab_id}
              ref={(el) => {
                if (el) tabRefs.current.set(tb.tab_id, el);
                else tabRefs.current.delete(tb.tab_id);
              }}
              role="tab"
              // 네이티브 드래그 차단 — CSS `-webkit-user-drag: none` 과 짝이다.
              // CSS 는 요소 드래그를 끄지만 **선택된 텍스트**에서 시작하는
              // 드래그는 못 막고, WebKit 이 그 세션을 열면 우리 포인터 드래그가
              // pointercancel 로 끊긴다 (탭이 손을 안 따라오고 반투명한 텍스트만
              // 따라다니는 증상). draggable 은 요소를, onDragStart 는 남은 경로를
              // 막는다 — 둘 다 있어야 새는 곳이 없다.
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              data-pc={tabColor}
              id={`tab-t${tb.tab_id}`}
              aria-controls={`tabpanel-t${tb.tab_id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tb.root_path || label}
              className={
                "tabstrip-tab" +
                (active ? " on" : "") +
                (isStart ? " is-start" : "") +
                (dragging && !torn ? " dragging" : "") +
                (torn ? " torn" : "") +
                (shifted ? " shifted" : "") +
                (arriving.has(tb.tab_id) ? " arriving" : "")
              }
              // 자리를 벌리는 이동만 인라인으로 — 끌리는 탭의 `transform` 은
              // 프레임마다 직접 쓰므로(React 밖) 여기서 겹쳐 쓰면 안 된다.
              style={shifted ? { transform: `translateX(${INCOMING_SLOT_PX}px)` } : undefined}
              onPointerDown={beginDrag(tb.tab_id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
              onAuxClick={(e) => {
                // 가운데 버튼 = 닫기 (브라우저 관습).
                if (e.button === 1) onClose(tb.tab_id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(tb.tab_id, e.currentTarget);
              }}
              onKeyDown={(e) => {
                // 컨텍스트 메뉴의 **키보드 등가물** (WAI-ARIA 권고). 창 간
                // 이동이 포인터 전용으로 남지 않게 하는 유일한 길이다 — 이게
                // 없으면 드래그를 못 하는 사용자에게는 기능 자체가 없다.
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  openMenu(tb.tab_id, e.currentTarget);
                  return;
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(tb.tab_id);
                  return;
                }
                // Delete/Backspace = 탭 닫기 — 아래 × 어포던스의 키보드 등가물.
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  onClose(tb.tab_id);
                  return;
                }
                // 좌우 화살표 = 이웃 탭 (WAI-ARIA tablist 규약). 끝에서 감싼다.
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (step !== 0 && shown.length > 1) {
                  e.preventDefault();
                  const i = shown.findIndex((x) => x.tab_id === tb.tab_id);
                  onActivate(shown[(i + step + shown.length) % shown.length].tab_id);
                }
              }}
            >
              <TabIcon strokeWidth={2} className="tabstrip-icon" />
              <span className="tabstrip-name">{label}</span>
              {/* 백그라운드 탭에서 에이전트가 돌고 있다는 유일한 신호 —
                  탭이 숨어 있으면 화면으로는 알 수 없다. */}
              {busy && (
                <span
                  className="tabstrip-busy"
                  role="img"
                  aria-label={t("tabs.sessionActive", { name: label })}
                />
              )}
              {/* 마우스 전용 어포던스 — 보조기술에는 감춘다(위젯 중첩 방지).
                  키보드/스크린리더 사용자의 경로는 위 Delete/Backspace 다. */}
              <span
                className="tabstrip-close"
                role="presentation"
                aria-hidden="true"
                title={t("tabs.close", { name: label })}
                // 닫기에서 시작한 포인터가 탭 드래그로 번지면 안 된다.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tb.tab_id);
                }}
              >
                <X size={12} strokeWidth={2.5} />
              </span>
            </div>
          );
        })}
      </div>

      <div className="tabstrip-adder">
        <button
          type="button"
          className="tabstrip-new"
          aria-label={t("tabs.new")}
          title={t("tabs.newHint")}
          aria-haspopup="menu"
          aria-expanded={adderOpen}
          // 클릭 = 새 시작 탭 (Chrome 과 같다). 우클릭이면 "바로 이 프로젝트"
          // 지름길 목록을 연다 — 시작 탭을 거치지 않고 한 번에 열고 싶을 때.
          onClick={() => onNewTab()}
          onContextMenu={(e) => {
            e.preventDefault();
            setAdderOpen((o) => !o);
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
        {adderOpen && (
          <div className="tabstrip-pop" role="menu" aria-label={t("tabs.new")}>
            {closedProjects.length > 0 ? (
              <div className="tabstrip-pop-list">
                {closedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className="tabstrip-pop-item"
                    onClick={() => {
                      setAdderOpen(false);
                      onOpenProject(p.id);
                    }}
                  >
                    <FolderGit2 size={14} strokeWidth={2} color="var(--accent)" />
                    <span className="tabstrip-pop-meta">
                      <span className="tabstrip-pop-name">{p.name}</span>
                      <span className="tabstrip-pop-path">{p.root_path}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="tabstrip-pop-empty">{t("tabs.allOpen")}</p>
            )}
            <button
              type="button"
              role="menuitem"
              className="tabstrip-pop-manage"
              onClick={() => {
                setAdderOpen(false);
                onNewTab();
              }}
            >
              <LayoutGrid size={13} /> {t("tabs.openStart")}
            </button>
          </div>
        )}
      </div>

      {/* 탭 컨텍스트 메뉴 — 드래그 없이 같은 일을 하는 길. `role="tablist"` 는
          `tab` 만 자식으로 받으므로 목록 **바깥**에 둔다. */}
      {menu ? (
        <div
          ref={menuRef}
          className="tabstrip-menu"
          role="menu"
          aria-label={t("tabs.menu.label")}
          style={{ left: menu.left }}
          onKeyDown={onMenuKey}
        >
          {windowChoices.length > 0 ? (
            windowChoices.map((w) => (
              <button
                key={w.label}
                type="button"
                role="menuitem"
                className="tabstrip-menu-item"
                onClick={() => {
                  closeMenu(false);
                  onMoveToWindow?.(menu.tabId, w.label);
                }}
              >
                {t("tabs.menu.moveTo", { name: w.name })}
              </button>
            ))
          ) : (
            // 창이 하나뿐이라 보낼 곳이 없다. 항목을 감추는 대신 이유를 적는다
            // — 비어 있는 메뉴는 "고장" 으로 읽힌다.
            <p className="tabstrip-menu-empty">{t("tabs.menu.noOtherWindow")}</p>
          )}
          {/* 마지막 탭은 떼어낼 수 없다 (원래 창이 닫히고 같은 내용의 새 창이
              뜰 뿐이라 순수 손해) — 백엔드도 거절하므로 아예 안 그린다. */}
          {tabs.length > 1 ? (
            <button
              type="button"
              role="menuitem"
              className="tabstrip-menu-item"
              onClick={() => {
                closeMenu(false);
                onDetach(menu.tabId, null, null);
              }}
            >
              {t("tabs.menu.detach")}
            </button>
          ) : null}
          <span className="tabstrip-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="tabstrip-menu-item"
            onClick={() => {
              closeMenu(false);
              onClose(menu.tabId);
            }}
          >
            {t("tabs.menu.close")}
          </button>
        </div>
      ) : null}

      {/* 다른 창에서 끌려온 탭이 **꽂힐 자리**. 탭 사이에 끼우면 tablist 의 자식
          구조가 깨지므로(axe `aria-required-children`) 절대 위치로 띄운다.

          예전엔 3px 캐럿 한 줄이었다. 자리는 알려 주지만 "무엇이" 오는지는
          말하지 않아서, 창이 셋이면 겨눈 창이 맞는지 확인할 방법이 없었다.
          이제 탭 모양 그대로 자리를 차지하고(뒤 탭들이 비켜선다) 이름을 단다. */}
      {caret ? (
        <span
          className="tabstrip-slot"
          aria-hidden="true"
          style={{ left: caret.left, width: INCOMING_SLOT_PX }}
          data-pc={
            incoming && !incoming.isStart
              ? resolveProjectColor(incoming.name, incoming.color)
              : undefined
          }
        >
          {incoming ? (
            (() => {
              const SlotIcon = incoming.isStart
                ? LayoutGrid
                : resolveProjectIcon(incoming.name, incoming.icon).Icon;
              return (
                <>
                  <SlotIcon strokeWidth={2} className="tabstrip-icon" />
                  <span className="tabstrip-name">
                    {incoming.isStart ? t("tabs.startTab") : incoming.name}
                  </span>
                </>
              );
            })()
          ) : (
            <span className="tabstrip-name">{t("tabs.drag.incoming")}</span>
          )}
        </span>
      ) : null}

      {/* 남는 공간은 창 드래그 리전 — 무장식 타이틀바의 잡는 자리를 대신한다.
          더블클릭에는 **아무것도 붙이지 않는다**: 여기가 곧 타이틀바라
          Tauri 의 드래그 리전 스크립트가 이미 창 확대/복원(zoom)을 처리한다
          (tauri `src/window/scripts/drag.js`). 예전엔 여기에 "새 탭"을 걸어
          두어서 타이틀바를 더블클릭할 때마다 창 크기 조절과 **동시에** 탭이
          하나씩 늘어났다 — 새 탭은 `+` 버튼과 ⌘T 가 담당한다. */}
      <div className="tabstrip-drag" data-tauri-drag-region aria-hidden="true" />

      {/* 스트립을 벗어난 동안 손을 따라다니는 물체. `position: fixed` 라
        `.tabstrip-tabs` 의 `overflow: hidden` 에 잘리지 않고 창 전체를 쓴다.
        자세는 JS 가 프레임마다 쓰므로 등장 모션은 transform 과 겹치지 않는
        `scale`/`opacity` 로만 준다. */}
      {drag?.detaching && drag.moved ? (
        <div
          className={"tabstrip-ghost" + (ghostPinned ? " pinned" : "")}
          aria-hidden="true"
          data-mode={handingOff ? "merge" : "new"}
          data-pc={(() => {
            const tb = byId.get(drag.tabId);
            return tb?.project_id == null ? undefined : resolveProjectColor(tb.name, tb.color);
          })()}
          data-hint={handingOff ? t("tabs.drag.toWindow") : t("tabs.drag.toNewWindow")}
          ref={attachGhost}
        >
          {(() => {
            const tb = byId.get(drag.tabId);
            const isStart = tb?.project_id == null;
            const GhostIcon = isStart
              ? LayoutGrid
              : resolveProjectIcon(tb?.name ?? "", tb?.icon ?? null).Icon;
            return (
              <>
                <GhostIcon strokeWidth={2} className="tabstrip-icon" />
                <span className="tabstrip-name">
                  {isStart ? t("tabs.startTab") : (tb?.name ?? "")}
                </span>
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

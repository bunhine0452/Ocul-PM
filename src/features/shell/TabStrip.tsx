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
import { useEffect, useRef, useState } from "react";
import { Plus, X, FolderGit2, LayoutGrid } from "lucide-react";
import type { Project, TabInfo } from "@/lib/bindings";
import { useT } from "@/i18n";
import {
  resolveProjectColor,
  resolveProjectIcon,
} from "@/features/onboarding/home/projectAppearance";
import { tabDropIndex, reorderTabs, isDetachGesture, DRAG_START_PX } from "./tabOrder";

/**
 * macOS 신호등이 차지하는 좌측 폭. `TitleBarStyle::Overlay` 라 신호등이
 * 콘텐츠 위에 떠 있으므로 첫 탭이 그 아래 깔리지 않게 비워 둔다
 * (Chrome/Safari 도 같은 처리).
 */
const TRAFFIC_LIGHT_INSET = 78;

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
   * 새 창으로 떼어낸다. 좌표는 **포인터로 떼어냈을 때만** 있다 — 메뉴에서
   * 부르면 겨눈 지점이 없으므로 `null` 을 주고 창 자리는 OS 에 맡긴다.
   */
  onDetach: (tabId: number, screenX: number | null, screenY: number | null) => void;
  onNewTab: () => void;
  onOpenProject: (projectId: number) => void;
  /**
   * 다른 창에서 끌려온 탭이 지금 이 스트립 위에 있다 — 창 안쪽 CSS x.
   * `null` 이면 없다. (논리 px → CSS px 환산은 창이 한다 — 웹뷰 줌을 아는 쪽.)
   */
  incomingX?: number | null;
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
    const rects = order.map((id) => tabRefs.current.get(id)?.getBoundingClientRect() ?? null);
    const centers = rects.map((r) => (r ? r.left + r.width / 2 : Number.POSITIVE_INFINITY));
    const index = tabDropIndex(centers, incomingX);
    const strip = stripRef.current?.getBoundingClientRect();
    // 캐럿은 그 자리 탭의 **왼쪽 모서리**, 맨 뒤면 마지막 탭의 오른쪽 모서리.
    const edge = rects[index]?.left ?? rects[rects.length - 1]?.right ?? strip?.left ?? 0;
    setCaret({ index, left: edge - (strip?.left ?? 0) });
    if (reportedRef.current !== index) {
      reportedRef.current = index;
      onIncomingIndex?.(index);
    }
    // `order` 는 매 렌더 새 배열이라 의존성에 넣으면 무한 루프가 된다 —
    // 탭 기하는 ref 로 그때그때 읽으므로 x 만 보면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingX, tabs.length]);

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
    setDrag({
      tabId,
      startX: e.clientX,
      moved: false,
      order: tabs.map((tb) => tb.tab_id),
      detaching: false,
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const moved = drag.moved || Math.abs(e.clientX - drag.startX) > DRAG_START_PX;
    if (!moved) return;

    const strip = stripRef.current?.getBoundingClientRect();
    const detaching = strip ? isDetachGesture(strip, e.clientY) : false;

    // 떼어내는 중에는 자리를 흔들지 않는다 — 커서가 스트립 밖에 있으니
    // 삽입 위치를 계산해 봐야 의미가 없고 화면만 요동친다.
    if (detaching) {
      setDrag({ ...drag, moved, detaching });
      // 창 밖으로 나간 동안만 물어본다 — 스트립 안에서는 물어볼 이유가 없고,
      // 매 프레임 IPC 를 때리면 재배열이 뚝뚝 끊긴다.
      onDragHover?.(drag.tabId, strip?.height ?? 0);
      return;
    }
    // 스트립 안으로 돌아왔다 — 남의 창에 남겨 둔 캐럿을 지운다.
    if (drag.detaching) onDragCleanup?.();

    const centers = drag.order.map((id) => {
      const rect = tabRefs.current.get(id)?.getBoundingClientRect();
      return rect ? rect.left + rect.width / 2 : Number.POSITIVE_INFINITY;
    });
    const from = drag.order.indexOf(drag.tabId);
    const to = tabDropIndex(centers, e.clientX);
    setDrag({ ...drag, moved, detaching: false, order: reorderTabs(drag.order, from, to) });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const state = drag;
    // 비동기 경계를 넘으므로 좌표는 지금 붙잡아 둔다.
    const { screenX, screenY } = e;
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
        onDetach(state.tabId, screenX, screenY);
        return;
      }
      void onDragDrop(state.tabId)
        .catch(() => false)
        .then((attached) => {
          if (!attached) onDetach(state.tabId, screenX, screenY);
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
        {shown.map((tb) => {
          const active = tb.tab_id === activeId;
          const dragging = drag?.moved && drag.tabId === tb.tab_id;
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
                (dragging ? " dragging" : "") +
                (dragging && drag?.detaching ? " detaching" : "")
              }
              onPointerDown={beginDrag(tb.tab_id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
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

      {/* 다른 창에서 끌려온 탭이 꽂힐 자리. 탭 사이에 끼우면 tablist 의 자식
          구조가 깨지므로(axe `aria-required-children`) 절대 위치로 띄운다. */}
      {caret ? (
        <span className="tabstrip-caret" aria-hidden="true" style={{ left: caret.left }} />
      ) : null}

      {/* 남는 공간은 창 드래그 리전 — 무장식 타이틀바의 잡는 자리를 대신한다.
          더블클릭에는 **아무것도 붙이지 않는다**: 여기가 곧 타이틀바라
          Tauri 의 드래그 리전 스크립트가 이미 창 확대/복원(zoom)을 처리한다
          (tauri `src/window/scripts/drag.js`). 예전엔 여기에 "새 탭"을 걸어
          두어서 타이틀바를 더블클릭할 때마다 창 크기 조절과 **동시에** 탭이
          하나씩 늘어났다 — 새 탭은 `+` 버튼과 ⌘T 가 담당한다. */}
      <div className="tabstrip-drag" data-tauri-drag-region aria-hidden="true" />
    </div>
  );
}

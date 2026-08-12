/**
 * 탭 스트립 — 크롬식 탭 (01b-chrome-tabs.md §4).
 *
 * 1차 범위: 클릭 전환 · 닫기 · 드래그 순서 변경 · **창 밖으로 떼어내기**.
 * 다른 창의 스트립에 드롭해서 합치는 건 2차 (Rust 화면좌표 히트테스트 필요).
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
  onDetach: (tabId: number, screenX: number, screenY: number) => void;
  onNewTab: () => void;
  onOpenProject: (projectId: number) => void;
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
}: TabStripProps) {
  const { t } = useT();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [adderOpen, setAdderOpen] = useState(false);

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
      return;
    }

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
    setDrag(null);
    if (!state.moved) {
      onActivate(state.tabId);
      return;
    }
    if (state.detaching) {
      onDetach(state.tabId, e.screenX, e.screenY);
      return;
    }
    const before = tabs.map((tb) => tb.tab_id);
    if (state.order.join() !== before.join()) onReorder(state.order);
  };

  return (
    <div
      ref={stripRef}
      className={"tabstrip" + (drag?.detaching ? " is-detaching" : "")}
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
              onKeyDown={(e) => {
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

      {/* 남는 공간은 창 드래그 리전 — 무장식 타이틀바의 잡는 자리를 대신한다.
          더블클릭은 브라우저 관습대로 새 탭 (탭 UI 에서는 macOS 의 "더블클릭
          으로 최대화" 보다 이쪽이 기대에 맞는다). */}
      <div
        className="tabstrip-drag"
        data-tauri-drag-region
        aria-hidden="true"
        onDoubleClick={() => onNewTab()}
      />
    </div>
  );
}

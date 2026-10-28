import { Columns2, Minimize2, PanelLeftDock, Rows2, Search } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { sessionColorStyle } from "@/lib/sessionColors";
import { dragRegion as screenDragRegion } from "@/lib/platform";
import { useT } from "@/i18n";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import { collectSids, type PaneDir } from "@/lib/termPanes";

// 터미널 머리줄 — 레일 토글 · 지금 보고 있는 세션 · 도구 (2026-08-28, 2026-09-11 분리).
//
// 2026-10-25 시안 A: 터미널 **화면**에서는 이 줄이 화면 툴바와 한 줄로 합쳐진다
// (`screenTitle`). 예전에는 툴바(제목·셸 통합 부제·도크로) 아래에 이 줄이 따로
// 있고, 그 아래 페인 머리띠까지 세 줄이 출력 위를 덮었다. 도크와 분리 창에는 화면
// 툴바가 없으므로 예전처럼 이 줄 하나가 머리다 — 같은 조각을 두 껍데기에 담는다.
//
// Tauri 는 클릭된 엘리먼트 **자신**의 속성만 본다 (조상을 타고 오르지 않는다) —
// 그래서 컨테이너와 제목 조각에 각각 drag-region 을 붙이고, 버튼에는 일부러
// 붙이지 않아 클릭이 그대로 산다.

interface TerminalHeadBarProps {
  railCollapsed: boolean;
  onToggleRail: () => void;
  activeTab: TerminalTab | null | undefined;
  onSearch: () => void;
  onSplit: (dir: PaneDir) => void;
  /** 확대 중인 페인이 이 탭에 있다 — 되돌리는 손잡이를 제목 옆에 둔다. */
  zoomed: boolean;
  onUnzoom: () => void;
  /** 분리 창에서는 이 줄이 창의 손잡이다. */
  dragRegion: boolean;
  /** 화면 제목 — 있으면 화면 툴바(`Toolbar`)로 그린다 (터미널 화면). */
  screenTitle?: string;
  /** 보기 메뉴 `Aa` (`TerminalViewMenu`). */
  viewMenu: React.ReactNode;
  /** 줄 끝에 덧붙이는 도구 (화면: 도크로 · 도크: 자리 옮기기·떼어내기·닫기). */
  children?: React.ReactNode;
}

export function TerminalHeadBar({
  railCollapsed,
  onToggleRail,
  activeTab,
  onSearch,
  onSplit,
  zoomed,
  onUnzoom,
  dragRegion,
  screenTitle,
  viewMenu,
  children,
}: TerminalHeadBarProps) {
  const { t } = useT();
  const paneCount = activeTab?.panes ? collectSids(activeTab.panes).length : 1;
  const drag = screenTitle !== undefined ? screenDragRegion() : dragRegion ? { "data-tauri-drag-region": true } : {};

  const railToggle = (
    <button
      type="button"
      className="term-tool"
      onClick={onToggleRail}
      title={t(railCollapsed ? "term.rail.expand" : "term.rail.collapse")}
      aria-label={t(railCollapsed ? "term.rail.expand" : "term.rail.collapse")}
      aria-pressed={!railCollapsed}
    >
      <PanelLeftDock size={15} />
    </button>
  );

  const session = activeTab ? (
    <>
      {/* 세션 색을 고른 탭은 이름 앞에 그 색 점 — 레일 카드의 띠와 같은 색이다. */}
      {activeTab.color ? (
        <span className="tht-dot" style={sessionColorStyle(activeTab.color)} aria-hidden="true" />
      ) : null}
      <span className="tht-name" {...drag}>
        {activeTab.label}
      </span>
      {paneCount > 1 ? (
        <span className="tht-count" {...drag}>
          {t("term.head.panes", { n: paneCount })}
        </span>
      ) : null}
      {zoomed ? (
        <button type="button" className="tht-zoom" onClick={onUnzoom} title={t("term.zoomedHint")}>
          <Minimize2 size={11} />
          {t("term.zoomed")}
        </button>
      ) : null}
    </>
  ) : null;

  const tools = (
    <div className="term-tools">
      <button
        type="button"
        className="term-tool"
        onClick={onSearch}
        title={t("term.searchScrollbackHint")}
        aria-label={t("term.searchScrollback")}
      >
        <Search size={15} />
      </button>
      <button
        type="button"
        className="term-tool"
        onClick={() => onSplit("row")}
        title={t("term.splitRowHint")}
        aria-label={t("term.splitRow")}
      >
        <Columns2 size={15} />
      </button>
      <button
        type="button"
        className="term-tool"
        onClick={() => onSplit("col")}
        title={t("term.splitColHint")}
        aria-label={t("term.splitCol")}
      >
        <Rows2 size={15} />
      </button>
      {viewMenu}
      {children ? <span className="term-tool-sep" aria-hidden="true" /> : null}
      {children}
    </div>
  );

  if (screenTitle !== undefined) {
    return (
      <Toolbar
        beta
        leading={railToggle}
        title={
          <span className="term-head-title" {...drag}>
            <span className="tht-screen" {...drag}>
              {screenTitle}
            </span>
            {session ? (
              <span className="tht-slash" aria-hidden="true" {...drag}>
                /
              </span>
            ) : null}
            {session}
          </span>
        }
      >
        {tools}
      </Toolbar>
    );
  }

  return (
    <div className="term-head" {...drag}>
      {railToggle}
      <span className="term-head-title" {...drag}>
        {session}
      </span>
      {tools}
    </div>
  );
}

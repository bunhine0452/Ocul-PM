import { Columns2, PanelLeftDock, Rows2, Search } from "@/components/Icons";
import { useT } from "@/i18n";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import { collectSids, type PaneDir } from "@/lib/termPanes";

// 터미널 머리줄 — 레일 토글 · 지금 보고 있는 세션 · 도구 (2026-08-28, 2026-09-11 분리).
//
// 세션 목록은 아래 세로 레일이 맡고, 여기는 얇게 남긴다. 가운데의 세션 이름은
// 2026-09-11 리디자인에서 붙었다 — 레일을 접으면 "지금 어느 셸을 보고 있는가"
// 를 말해 주는 곳이 이 줄뿐이다.
//
// Tauri 는 클릭된 엘리먼트 **자신**의 속성만 본다 (조상을 타고 오르지 않는다) —
// 그래서 컨테이너와 가운데 띠에 각각 drag-region 을 붙이고, 버튼에는 일부러
// 붙이지 않아 클릭이 그대로 산다.

interface TerminalHeadBarProps {
  railCollapsed: boolean;
  onToggleRail: () => void;
  activeTab: TerminalTab | null | undefined;
  onSearch: () => void;
  onSplit: (dir: PaneDir) => void;
  /** 분리 창에서는 이 줄이 창의 손잡이다. */
  dragRegion: boolean;
  /** 도크가 덧붙이는 도구 (자리 옮기기·떼어내기·닫기). */
  children?: React.ReactNode;
}

export function TerminalHeadBar({
  railCollapsed,
  onToggleRail,
  activeTab,
  onSearch,
  onSplit,
  dragRegion,
  children,
}: TerminalHeadBarProps) {
  const { t } = useT();
  const paneCount = activeTab?.panes ? collectSids(activeTab.panes).length : 1;
  return (
    <div className="term-head" data-tauri-drag-region={dragRegion || undefined}>
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
      <span className="term-head-title" data-tauri-drag-region={dragRegion || undefined}>
        {activeTab ? (
          <>
            <span className="tht-name">{activeTab.label}</span>
            {paneCount > 1 ? (
              <span className="tht-count">{t("term.head.panes", { n: paneCount })}</span>
            ) : null}
          </>
        ) : null}
      </span>
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
        {children}
      </div>
    </div>
  );
}

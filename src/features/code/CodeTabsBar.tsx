// 창(pane) 하나의 탭 바. 상태는 전혀 갖지 않는다 — 열림 목록은 부모의
// codeTabs 상태가 소유하고 여기는 그리기·입력만 한다 (열린 메뉴 자리만 예외).
import { memo, useState } from "react";

import { X, Columns2, Minimize2 } from "@/components/Icons";
import { FileIcon } from "./FileIcon";
import { t, useT } from "@/i18n";

import { CodeContextMenu } from "./CodeContextMenu";

/** 창 간 탭 드래그의 페이로드 형식. `pane:path` — path 에 `:` 가 있어도 안전하게 첫 `:` 로만 쪼갠다. */
export const TAB_DND_MIME = "application/x-oculpm-code-tab";

interface CodeTabsBarProps {
  paneIndex: number;
  tabs: string[];
  active: string | null;
  dirtyPaths: Set<string>;
  isSplit: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onSplit: () => void;
  onUnsplit: () => void;
  onMoveToOtherPane: (path: string) => void;
  onDropTab: (fromPane: number, path: string) => void;
}

export const CodeTabsBar = memo(function CodeTabsBar({
  paneIndex,
  tabs,
  active,
  dirtyPaths,
  isSplit,
  onActivate,
  onClose,
  onCloseOthers,
  onSplit,
  onUnsplit,
  onMoveToOtherPane,
  onDropTab,
}: CodeTabsBarProps) {
  useT();
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const parseDrag = (e: React.DragEvent): { fromPane: number; path: string } | null => {
    const raw = e.dataTransfer.getData(TAB_DND_MIME);
    if (!raw) return null;
    const sep = raw.indexOf(":");
    if (sep < 0) return null;
    const fromPane = Number(raw.slice(0, sep));
    const path = raw.slice(sep + 1);
    return Number.isInteger(fromPane) && path ? { fromPane, path } : null;
  };

  return (
    <div
      className={"code-tabs" + (dropActive ? " drop" : "")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        setDropActive(false);
        const payload = parseDrag(e);
        if (!payload) return;
        e.preventDefault();
        onDropTab(payload.fromPane, payload.path);
      }}
    >
      <div className="code-tabs-list" role="tablist" aria-label={t("code.tabs.aria")}>
        {tabs.map((path) => {
          const name = path.slice(path.lastIndexOf("/") + 1);
          const isActive = path === active;
          const isDirty = dirtyPaths.has(path);
          return (
            <div
              key={path}
              role="tab"
              aria-selected={isActive}
              tabIndex={-1}
              draggable
              className={"code-tab" + (isActive ? " on" : "") + (isDirty ? " dirty" : "")}
              title={path}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DND_MIME, `${paneIndex}:${path}`);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onActivate(path)}
              // 가운데 버튼으로 닫기 — 브라우저 탭과 같은 관례.
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, path });
              }}
            >
              <FileIcon name={name} size={15} className="code-tab-ico" />
              <span className="code-tab-name">{name}</span>
              {/* 미저장 점과 닫기 ×가 **한 슬롯**을 쓴다 (VS Code 와 같다):
                  dirty 는 점, 탭에 호버하면 × 로 바뀐다 — 점만 있으면 닫을 수
                  없고, × 만 있으면 미저장을 모른 채 닫는다. 전환은 CSS 가 한다. */}
              <span className="code-tab-slot">
                {isDirty ? <span className="code-tab-dot" aria-label={t("code.dirty")} /> : null}
                <button
                  type="button"
                  className="code-tab-close"
                  aria-label={t("code.tabs.closeAria", { name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(path);
                  }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="code-tabs-actions">
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={isSplit ? onUnsplit : onSplit}
          title={isSplit ? t("code.tabs.unsplit") : t("code.tabs.split")}
          aria-label={isSplit ? t("code.tabs.unsplit") : t("code.tabs.split")}
        >
          {isSplit ? <Minimize2 size={14} /> : <Columns2 size={14} />}
        </button>
      </div>

      {menu ? (
        <CodeContextMenu
          x={menu.x}
          y={menu.y}
          label={t("code.tabs.aria")}
          onClose={() => setMenu(null)}
          items={[
            { label: t("code.tabs.closeTab"), onSelect: () => onClose(menu.path) },
            {
              label: t("code.tabs.closeOthers"),
              onSelect: () => onCloseOthers(menu.path),
              disabled: tabs.length < 2,
            },
            {
              label: isSplit ? t("code.tabs.moveOther") : t("code.tabs.openBeside"),
              onSelect: () => onMoveToOtherPane(menu.path),
              separatorBefore: true,
            },
          ]}
        />
      ) : null}
    </div>
  );
});

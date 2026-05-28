import { Button } from "@/components/ui/button";
import { X, Terminal as TerminalIcon } from "@/components/Icons";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { useWorkspace, type BottomDrawerTab } from "@/contexts/WorkspaceContext";
import { useState, useRef } from "react";

// MASTER-GUIDE §5.6 — Code 화면 하단의 드로워.
//   - Terminal: 기존 TerminalPanel (PiP 제거됨, Detach window 만 유지)
//
// Lite-W6 PR5: GitPanel retired (moved to src/legacy/). The drawer now
// renders a single Terminal pane; the tab bar is kept for symmetry with
// the future MASTER-GUIDE §5.6 (Terminal + secondary docks) but only one
// tab is wired up.
//
// `bottomDrawerOpen` / `bottomDrawerTab` 은 WorkspaceContext 가 보유.
// ⌘J 단축키로 열기/닫기 — `useGlobalShortcuts` 가 처리.

interface BottomDrawerProps {
  activeProjectId: number | null;
  projectRoot: string | null;
}

const TABS: Array<{ id: BottomDrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
];

export function BottomDrawer({ activeProjectId: _activeProjectId, projectRoot }: BottomDrawerProps) {
  const { state, setState } = useWorkspace();
  const { bottomDrawerOpen: open, bottomDrawerTab: tab } = state;

  const [drawerHeight, setDrawerHeight] = useState(288); // 72 * 4 = 288px default
  const [isMaximized, setIsMaximized] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  function setTab(id: BottomDrawerTab) {
    setState((prev) => ({ ...prev, bottomDrawerTab: id, bottomDrawerOpen: true }));
  }
  function close() {
    setState((prev) => ({ ...prev, bottomDrawerOpen: false }));
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartHeight.current = drawerHeight;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const deltaY = dragStartY.current - e.clientY;
    const newHeight = Math.max(100, dragStartHeight.current + deltaY);
    setDrawerHeight(newHeight);
    if (isMaximized) setIsMaximized(false);
  };

  const handleMouseUp = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  return (
    <div
      className={`border-t border-border bg-secondary/15 flex flex-col shrink-0 overflow-hidden relative ${!open ? "h-9 transition-all duration-200" : ""}`}
      style={open ? { height: isMaximized ? "100%" : `${drawerHeight}px` } : {}}
    >
      {open && !isMaximized && (
        <div
          onMouseDown={startResize}
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-20 hover:bg-primary/50 active:bg-primary transition-colors"
        />
      )}
      {/* Tab bar — visible whether the drawer is collapsed or expanded.
          Clicking a tab while collapsed opens it directly to that tab. */}
      <div className="h-9 border-b border-border/60 flex items-center px-2 shrink-0 select-none">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = open && tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => (active ? close() : setTab(t.id))}
              className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
        <kbd className="ml-auto text-[10px] text-muted-foreground/70 font-mono mr-1">⌘J</kbd>
        {open && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleMaximize} title={isMaximized ? "Restore Panel Size" : "Maximize Panel Size"}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground hover:text-foreground">
                {isMaximized ? (
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                ) : (
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                )}
              </svg>
            </Button>
            <Button variant="ghost" size="sm" onClick={close} title="닫기 (⌘J)">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "terminal" && (
            <TerminalPanel
              projectRoot={projectRoot}
              isPip={false}
              onTogglePip={() => {}}
              activeTab="terminal"
            />
          )}
        </div>
      )}
    </div>
  );
}

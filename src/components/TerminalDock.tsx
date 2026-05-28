import { useCallback, useEffect, useRef } from "react";

import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { X, Terminal as TerminalIcon } from "@/components/Icons";
import { Button } from "@/components/ui/button";

/**
 * Lite-W6 PR7 Part 2 — Workspace-level Terminal dock.
 *
 * Replaces the Code-screen-only `BottomDrawer` so Terminal is reachable from
 * every view (Today / Plan / Code). Layout is driven by
 * `WorkspaceState.layoutMode` + `splitRatio`:
 *
 *   - "main-only"     : the dock is `display: none` so the activeView fills
 *                       100%. `TerminalPanel` stays mounted (PTY sessions
 *                       survive hide/show); the panel itself only initialises
 *                       xterm when it's actually visible.
 *   - "split"         : the dock occupies the bottom strip; a resize handle
 *                       at the top edge writes `splitRatio` back to the
 *                       context. The activeView pane (rendered by `App.tsx`)
 *                       takes the complementary portion.
 *   - "terminal-only" : the dock takes the full vertical space.
 *
 * ⌘J / ⌘⇧J cycle the modes; see `useGlobalShortcuts`.
 */
export function TerminalDock({ projectRoot }: { projectRoot: string | null }) {
  const { state, setState } = useWorkspace();
  const { layoutMode, splitRatio } = state;

  const dragStartY = useRef(0);
  const dragStartRatio = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (layoutMode !== "split") return;
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartRatio.current = splitRatio;

      const parentRect = containerRef.current?.parentElement?.getBoundingClientRect();
      const onMove = (move: MouseEvent) => {
        if (!parentRect) return;
        const delta = move.clientY - dragStartY.current;
        const nextRatio = dragStartRatio.current + delta / parentRect.height;
        const clamped = Math.min(0.9, Math.max(0.1, nextRatio));
        setState((p) => ({ ...p, splitRatio: clamped }));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [layoutMode, splitRatio, setState],
  );

  function close() {
    setState((p) => ({ ...p, layoutMode: "main-only" }));
  }
  function maximize() {
    setState((p) => ({ ...p, layoutMode: "terminal-only" }));
  }
  function restoreSplit() {
    setState((p) => ({ ...p, layoutMode: "split" }));
  }

  const visible = layoutMode !== "main-only";
  const flexBasis =
    layoutMode === "terminal-only"
      ? "100%"
      : layoutMode === "split"
        ? `${(1 - splitRatio) * 100}%`
        : "0";

  // Keep the DOM mounted even when hidden so xterm/PTY sessions don't drop
  // on every ⌘J. Visibility-driven autosize lives inside `TerminalPanel`.
  useEffect(() => {
    // no-op; here only to surface the intent that visibility transitions
    // shouldn't tear down the panel.
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{ flexBasis, display: visible ? "flex" : "none" }}
      className="shrink-0 flex-col border-t border-border bg-secondary/15 overflow-hidden relative min-h-0"
    >
      {layoutMode === "split" && (
        <div
          onMouseDown={onResizeStart}
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-20 hover:bg-primary/50 active:bg-primary transition-colors"
        />
      )}
      <div className="h-9 border-b border-border/60 flex items-center px-2 shrink-0 select-none">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold text-primary bg-primary/15">
          <TerminalIcon className="w-3.5 h-3.5" />
          Terminal
        </span>
        <kbd className="ml-auto text-[10px] text-muted-foreground/70 font-mono mr-1">
          ⌘J
        </kbd>
        <div className="flex items-center gap-1">
          {layoutMode === "split" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={maximize}
              title="풀스크린 (⌘⇧J)"
            >
              <MaximizeIcon />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={restoreSplit}
              title="분할 보기로 복원"
            >
              <RestoreIcon />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={close} title="닫기 (⌘J)">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <TerminalPanel
          projectRoot={projectRoot}
          isPip={false}
          onTogglePip={() => {}}
          activeTab="terminal"
        />
      </div>
    </div>
  );
}

// The two SVGs below match the visual language of the legacy BottomDrawer's
// maximize/restore icons (re-used 1:1 so dogfood muscle memory doesn't
// shift). Both are 14px square 24-viewbox strokes.
function MaximizeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground hover:text-foreground"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground hover:text-foreground"
    >
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

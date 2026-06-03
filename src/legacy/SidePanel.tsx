/**
 * Workspace-level left side panel — toggled with ⌘B (Lite-W6 PR8 Part 2).
 *
 * Hosts the FileExplorer + the indexing/re-index footer that used to live
 * inside `CodeWorkbench`. Lives at the same level as the IA strip and the
 * activeView pane so it stays visible regardless of which view (Today /
 * Plan / Code) the user is on.
 *
 * The right edge carries a resize handle that drags into
 * `WorkspaceContext.sidePanelWidth` (persisted, clamped via
 * `migrateSidePanelWidth`).
 *
 * LocalDiffView will dock here too once PR6.3 lands its UI.
 */

import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type IndexProgress,
  type ProjectTreeNode,
} from "@/lib/bindings";
import { FileExplorer, type ChangeOp } from "./FileExplorer";
import { LocalDiffView } from "@/features/diff/LocalDiffView";
import { Button } from "./ui/button";
import { ChevronLeft, RefreshCw, X } from "./Icons";
import {
  useWorkspace,
  SIDE_PANEL_MIN_WIDTH,
  effectiveSidePanelMaxWidth,
} from "@/contexts/WorkspaceContext";

interface SidePanelProps {
  projectId: number;
  /** Number of files currently in the SQLite index — drives the footer gauge. */
  indexedCount: number;
  recentChanges: Record<string, ChangeOp>;
  /** Called after re-index completes so the parent can refresh the indexed list. */
  onReindexed: () => Promise<void> | void;
}

export function SidePanel({
  projectId,
  indexedCount,
  recentChanges,
  onReindexed,
}: SidePanelProps) {
  const {
    state,
    setActiveFile,
    setState,
    setSidePanelOpen,
    setSidePanelWidth,
    setSidePanelMode,
    clearRecentChanges,
    openDiffFor,
  } = useWorkspace();
  const {
    activeFile,
    fileExplorerExpanded,
    indexingProjectId,
    indexProgress,
    sidePanelWidth,
    sidePanelMode,
  } = state;
  const showDiff = sidePanelMode === "diff";

  // ── Tree loader ────────────────────────────────────────────────────────
  const [tree, setTree] = useState<ProjectTreeNode | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    commands
      .listProjectTree(projectId, null)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setTree(res.data);
        } else {
          console.error("[SidePanel] listProjectTree failed:", res.error);
          setTree({ name: "", relative_path: "", is_dir: true, children: [] });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error("[SidePanel] listProjectTree threw:", e);
          setTree({ name: "", relative_path: "", is_dir: true, children: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const reloadTree = async () => {
    const res = await commands.listProjectTree(projectId, null);
    if (res.status === "ok") setTree(res.data);
  };

  // ── Re-index orchestration ─────────────────────────────────────────────
  const indexing = indexingProjectId === projectId;
  const runReindex = async () => {
    setState((p) => ({ ...p, indexingProjectId: projectId }));
    const channel = new Channel<IndexProgress>();
    channel.onmessage = (prog) =>
      setState((p) => ({ ...p, indexProgress: prog }));
    try {
      await commands.indexProject(projectId, channel);
    } finally {
      await onReindexed();
      await reloadTree();
      setState((p) => ({ ...p, indexingProjectId: null, indexProgress: null }));
    }
  };

  const toggleExpand = (relPath: string) => {
    setState((p) => ({
      ...p,
      fileExplorerExpanded: {
        ...p.fileExplorerExpanded,
        [relPath]: !p.fileExplorerExpanded[relPath],
      },
    }));
  };

  // ── Resize handle ──────────────────────────────────────────────────────
  // Mode-aware cap: files mode stays at the existing 500 px cap, diff mode
  // expands up to 1100 px so LocalDiffView can flip to side-by-side at
  // ≥1024 px container width (Lite-W6 PR6.5).
  const maxWidth = effectiveSidePanelMaxWidth(sidePanelMode);
  const renderedWidth = Math.min(sidePanelWidth, maxWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: renderedWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const next = Math.min(
        maxWidth,
        Math.max(SIDE_PANEL_MIN_WIDTH, dragRef.current.startWidth + dx),
      );
      setSidePanelWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      className="relative flex flex-col border-r border-border shrink-0 glassy-sidebar"
      style={{ width: renderedWidth }}
      aria-label="파일 탐색기 사이드 패널"
    >
      {/* Header: Files / Diff toggle + close (⌘B) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/80 shrink-0">
        <div
          role="tablist"
          aria-label="사이드 패널 모드"
          className="inline-flex items-center rounded-md border border-border/80 bg-secondary/40 p-0.5 text-[11px] font-semibold uppercase tracking-wider"
        >
          <button
            role="tab"
            aria-selected={!showDiff}
            onClick={() => setSidePanelMode("files")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              !showDiff
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Files
          </button>
          <button
            role="tab"
            aria-selected={showDiff}
            onClick={() => setSidePanelMode("diff")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              showDiff
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Diff
          </button>
        </div>
        <button
          onClick={() => setSidePanelOpen(false)}
          className="p-1 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="사이드 패널 닫기 (⌘B)"
          aria-label="사이드 패널 닫기"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body — FileExplorer or LocalDiffView depending on mode */}
      <div className="flex-1 overflow-hidden">
        {showDiff ? (
          <LocalDiffView projectId={projectId} />
        ) : (
          <FileExplorer
            tree={tree}
            activeFile={activeFile}
            onSelectFile={setActiveFile}
            expanded={fileExplorerExpanded}
            onToggleExpand={toggleExpand}
            recentChanges={recentChanges}
            onChangedFileClick={openDiffFor}
          />
        )}
      </div>

      {/* Indexing gauge / Re-index — hidden in Diff mode (LocalDiffView has its own header) */}
      <div
        className="p-3 border-t border-border/80 bg-secondary/15 select-none shrink-0"
        style={{ display: showDiff ? "none" : undefined }}
      >
        {indexing ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-primary font-bold">
              <span className="truncate max-w-[70%]">
                {indexProgress?.current_file || "Indexing files..."}
              </span>
              <span>
                {indexProgress?.current}/{indexProgress?.total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${
                    ((indexProgress?.current || 0) /
                      Math.max(indexProgress?.total || 1, 1)) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground font-semibold">
                {indexedCount} files indexed
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={runReindex}
                className="h-6 px-2 text-[10px] font-bold"
                title="Update File Index"
              >
                <RefreshCw className="w-2.5 h-2.5 mr-1" />
                Re-index
              </Button>
            </div>
            {Object.keys(recentChanges).length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearRecentChanges}
                className="h-6 px-2 w-full text-[10px] font-medium text-muted-foreground hover:text-foreground justify-between"
                title="변경 하이라이트 다시 보지 않기"
              >
                <span>{Object.keys(recentChanges).length}개 변경 비우기</span>
                <X className="w-2.5 h-2.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Resize handle — sits on the right edge */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary z-10 transition-colors"
        role="separator"
        aria-orientation="vertical"
        aria-label="사이드 패널 폭 조절"
      />
    </aside>
  );
}

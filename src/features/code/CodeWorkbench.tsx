import { useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type IndexProgress } from "@/lib/bindings";
import { FileExplorer } from "@/components/FileExplorer";
import { DependencyGraphView } from "@/features/projects/DependencyGraphView";
import { AiWorkbench } from "./AiWorkbench";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Code2, Network, RefreshCw, Loader2, FolderCode, ExternalLink } from "@/components/Icons";

// MASTER-GUIDE §5.6 — Code 워크벤치
//
//   ┌────────┬───────────────────────┬────────────┐
//   │  Tree  │  Viewer / Graph       │ AiWorkbench│
//   │ (Files)│  (primary content)    │ (right)    │
//   └────────┴───────────────────────┴────────────┘
//
// Lite-W6 PR5: the built-in CodeEditor moved to src/legacy/ — the main pane
// now offers "외부 에디터로 열기" (full surface comes in PR8). GitPanel also
// retired to src/legacy/.
// Lite-W6 PR7 Part 2: Terminal moved out of CodeWorkbench's BottomDrawer
// into the Workspace-level TerminalDock (App.tsx). ⌘J / ⌘⇧J operate on
// `layoutMode` regardless of activeView.

interface CodeWorkbenchProps {
  projectId: number;
  projectRoot: string | null;
  projectFiles: Array<[number, string]>;
  reloadProjectFiles: () => Promise<void>;
}

export function CodeWorkbench({
  projectId,
  projectRoot,
  projectFiles,
  reloadProjectFiles,
}: CodeWorkbenchProps) {
  const { state, setState, setActiveFile } = useWorkspace();
  const { activeFile, aiWorkbenchOpen, codeSubTab, indexingProjectId, indexProgress } = state;

  // codeSubTab is still useful inside CodeWorkbench:
  //   - "files" → Tree + viewer placeholder (default)
  //   - "graph" → DependencyGraphView replaces the viewer pane
  //   - "ai"    → open AiWorkbench (mode toggled inside the panel)
  //   - "terminal" → open the Workspace-level TerminalDock in split mode
  //     (Lite-W6 PR7 Part 2 retired the Code-only BottomDrawer).
  useEffect(() => {
    if (codeSubTab === "ai") {
      setState((p) => ({ ...p, aiWorkbenchOpen: true }));
    } else if (codeSubTab === "terminal") {
      setState((p) => ({ ...p, layoutMode: "split" }));
    }
    // We intentionally don't depend on setState — it's a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSubTab]);

  const showGraph = codeSubTab === "graph";

  function openFile(path: string, _line?: number) {
    setState((p) => ({ ...p, activeFile: path, codeSubTab: "files" }));
  }

  const [aiWidth, setAiWidth] = useState(380);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = aiWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = startWidth - (moveEvent.clientX - startX);
      setAiWidth(Math.max(300, Math.min(newWidth, 1200)));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* C-1: Tree */}
      <FileTree
        files={projectFiles}
        activeFile={activeFile}
        onSelectFile={(p) => setActiveFile(p)}
        indexing={indexingProjectId === projectId}
        progress={indexProgress}
        onReindex={async () => {
          await runIndex(projectId, () => setState((p) => ({ ...p, indexingProjectId: projectId })));
          await reloadProjectFiles();
          setState((p) => ({ ...p, indexingProjectId: null, indexProgress: null }));
        }}
        onProgress={(prog) => setState((p) => ({ ...p, indexProgress: prog }))}
      />

      {/* C-2 & C-4: Primary content + Bottom drawer in a middle column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 flex overflow-hidden bg-background relative min-w-0">
          {showGraph ? (
            <DependencyGraphView projectId={projectId} onOpenFile={openFile} />
          ) : activeFile ? (
            <OpenInExternalEditor
              projectRoot={projectRoot}
              filePath={activeFile}
              onClose={() => setActiveFile(null)}
            />
          ) : (
            <EditorPlaceholder />
          )}
        </main>
        {/* Lite-W6 PR7 Part 2 retired the local BottomDrawer — Terminal now
            docks at the Workspace level via TerminalDock (App.tsx). */}
      </div>

      {/* C-3: AI Workbench (right) — toggle with ⌘\\ */}
      {aiWorkbenchOpen && (
        <>
          <div
            onMouseDown={startResize}
            className="w-1 cursor-col-resize bg-transparent hover:bg-primary/50 active:bg-primary z-10 transition-colors shrink-0"
          />
          <div style={{ width: aiWidth }} className="shrink-0 min-w-0 border-l border-border bg-background">
            <AiWorkbench activeProjectId={projectId} activeFile={activeFile} />
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// FileTree wrapper — same tree as before, with the indexing gutter
// ───────────────────────────────────────────────────────────────────────

function FileTree({
  files,
  activeFile,
  onSelectFile,
  indexing,
  progress,
  onReindex,
  onProgress,
}: {
  files: Array<[number, string]>;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  indexing: boolean;
  progress: IndexProgress | null;
  onReindex: () => Promise<void>;
  onProgress: (p: IndexProgress) => void;
}) {
  // `onProgress` is wired so the Channel below can stream into context state.
  // We keep it as a separate prop instead of building the channel here so the
  // caller controls lifecycle.
  void onProgress;

  return (
    <aside className="w-[240px] flex flex-col border-r border-border shrink-0 glassy-sidebar">
      <div className="flex-1 overflow-hidden">
        <FileExplorer files={files} activeFile={activeFile} onSelectFile={onSelectFile} />
      </div>
      <div className="p-3 border-t border-border/80 bg-secondary/15 select-none shrink-0">
        {indexing ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-primary font-bold">
              <span className="truncate max-w-[70%]">{progress?.current_file || "Indexing files..."}</span>
              <span>{progress?.current}/{progress?.total}</span>
            </div>
            <div className="h-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${((progress?.current || 0) / Math.max(progress?.total || 1, 1)) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground font-semibold">
              {files.length} files indexed
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onReindex}
              className="h-6 px-2 text-[10px] font-bold"
              title="Update File Index"
            >
              <RefreshCw className="w-2.5 h-2.5 mr-1" />
              Re-index
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

function EditorPlaceholder() {
  const { setCodeSubTab } = useWorkspace();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#faf9f5]/50 dark:bg-[#181715]/50 relative select-none">
      <div className="w-16 h-16 rounded-3xl bg-secondary/60 border border-border flex items-center justify-center mb-6 shadow-sm">
        <Code2 className="w-8 h-8 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-xl font-bold font-heading mb-1.5">열린 파일이 없습니다</h2>
      <p className="text-xs text-muted-foreground/80 max-w-sm mb-6 leading-relaxed">
        왼쪽 트리에서 파일을 선택하거나 ⌘K 로 Command Palette 를 여세요.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setCodeSubTab("graph")}>
          <Network className="w-3.5 h-3.5 mr-1.5" />
          Dependency Graph
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCodeSubTab("files")}>
          <FolderCode className="w-3.5 h-3.5 mr-1.5" />
          Files
        </Button>
      </div>
    </div>
  );
}

// Lite-W6 PR5 placeholder. The built-in CodeEditor is retired (src/legacy/),
// the proper external-editor launch lands in PR8. Until then we show the
// selected file's path so the user knows what they picked and can copy it.
function OpenInExternalEditor({
  projectRoot,
  filePath,
  onClose,
}: {
  projectRoot: string | null;
  filePath: string;
  onClose: () => void;
}) {
  const absolutePath = projectRoot ? `${projectRoot}/${filePath}` : filePath;
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#faf9f5]/50 dark:bg-[#181715]/50 relative select-none">
      <div className="w-16 h-16 rounded-3xl bg-secondary/60 border border-border flex items-center justify-center mb-6 shadow-sm">
        <ExternalLink className="w-8 h-8 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-xl font-bold font-heading mb-1.5">선택된 파일</h2>
      <code className="text-xs font-mono text-muted-foreground/90 max-w-lg break-all mb-1">
        {filePath}
      </code>
      <p className="text-[10px] text-muted-foreground/60 max-w-lg break-all mb-6 font-mono">
        {absolutePath}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled title="PR8 에서 정식 구현">
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          외부 에디터에서 열기 (PR8)
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Indexing helper — wraps the Channel boilerplate. Kept local to CodeWorkbench
// because no other view starts indexing today.
// ───────────────────────────────────────────────────────────────────────

async function runIndex(projectId: number, _onStart?: () => void): Promise<void> {
  const channel = new Channel<IndexProgress>();
  // Progress events are dropped here intentionally — the Workspace currently
  // owns the progress UI via WorkspaceContext, and CodeWorkbench drives the
  // re-index from a contained button. A richer event hook can be added when
  // a future caller (e.g. command palette) needs streaming feedback.
  channel.onmessage = () => {};
  await commands.indexProject(projectId, channel);
}

// Loader2 is referenced from JSX — keep the import alive even if collapsed.
void Loader2;

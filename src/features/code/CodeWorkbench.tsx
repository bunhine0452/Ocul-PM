import { useEffect } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type IndexProgress } from "@/lib/bindings";
import { FileExplorer } from "@/components/FileExplorer";
import { CodeEditor } from "@/components/CodeEditor";
import { DependencyGraphView } from "@/features/projects/DependencyGraphView";
import { AiWorkbench } from "./AiWorkbench";
import { BottomDrawer } from "./BottomDrawer";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Code2, Network, RefreshCw, Loader2, FolderCode } from "@/components/Icons";

// MASTER-GUIDE §5.6 — Code 워크벤치
//
//   ┌────────┬───────────────────────┬────────────┐
//   │  Tree  │  Editor / Graph       │ AiWorkbench│
//   │ (Files)│  (primary content)    │ (right)    │
//   ├────────┴───────────────────────┴────────────┤
//   │  BottomDrawer (Terminal / Git / Problems)  │
//   └────────────────────────────────────────────┘
//
// Tree 좌측, Editor 가운데, AiWorkbench 우측 (⌘\ 토글), Bottom Drawer
// 아래 (⌘J 토글). 사이드바의 Code sub-tab 6 종은 이 한 화면 안에 흡수됨:
//   - files/graph: 가운데 primary content 토글
//   - chat/assist: AiWorkbench 모드 토글
//   - terminal/git: BottomDrawer 의 탭으로 흡수

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
  //   - "files" → Tree + Editor (default)
  //   - "graph" → DependencyGraphView replaces the Editor pane
  //   - "ai"    → open AiWorkbench (mode toggled inside the panel)
  //   - "terminal" / "git" → open the BottomDrawer at that tab
  useEffect(() => {
    if (codeSubTab === "ai") {
      setState((p) => ({ ...p, aiWorkbenchOpen: true }));
    } else if (codeSubTab === "terminal") {
      setState((p) => ({ ...p, bottomDrawerOpen: true, bottomDrawerTab: "terminal" }));
    } else if (codeSubTab === "git") {
      setState((p) => ({ ...p, bottomDrawerOpen: true, bottomDrawerTab: "git" }));
    }
    // We intentionally don't depend on setState — it's a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSubTab]);

  const showGraph = codeSubTab === "graph";

  function openFile(path: string, _line?: number) {
    setState((p) => ({ ...p, activeFile: path, codeSubTab: "files" }));
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden min-h-0">
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

        {/* C-2: Primary content (Editor or Graph) */}
        <main className="flex-1 flex overflow-hidden bg-background relative min-w-0">
          {showGraph ? (
            <DependencyGraphView projectId={projectId} onOpenFile={openFile} />
          ) : activeFile ? (
            <CodeEditor
              projectId={projectId}
              filePath={activeFile}
              initialScrollLine={null}
              onClose={() => setActiveFile(null)}
            />
          ) : (
            <EditorPlaceholder />
          )}
        </main>

        {/* C-3: AI Workbench (right) — toggle with ⌘\\ */}
        {aiWorkbenchOpen && (
          <div className="w-[380px] shrink-0 min-w-0">
            <AiWorkbench activeProjectId={projectId} activeFile={activeFile} />
          </div>
        )}
      </div>

      {/* C-4: Bottom drawer (Terminal / Git / Problems) — toggle with ⌘J */}
      <BottomDrawer activeProjectId={projectId} projectRoot={projectRoot} />
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
      <h2 className="text-xl font-bold font-heading mb-1.5">No File Opened</h2>
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

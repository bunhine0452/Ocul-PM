import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { DependencyGraphView } from "@/features/projects/DependencyGraphView";
import { AiWorkbench } from "./AiWorkbench";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Code2, Network, FolderCode, ExternalLink, Loader2 } from "@/components/Icons";
import { toast } from "@/lib/toast";

// MASTER-GUIDE §5.6 — Code 워크벤치
//
//   ┌───────────────────────┬────────────┐
//   │  Viewer / Graph       │ AiWorkbench│
//   │  (primary content)    │ (right)    │
//   └───────────────────────┴────────────┘
//
// Lite-W6 PR5: the built-in CodeEditor moved to src/legacy/ — the main pane
// offers "외부 에디터로 열기" via `commands.openInEditor` (Lite-W6 PR8 Part 2).
// GitPanel also retired to src/legacy/.
// Lite-W6 PR7 Part 2: Terminal moved out of CodeWorkbench's BottomDrawer
// into the Workspace-level TerminalDock (App.tsx). ⌘J / ⌘⇧J operate on
// `layoutMode` regardless of activeView.
// Lite-W6 PR8 Part 2: the local FileTree moved out into the Workspace-
// level SidePanel (⌘B). CodeWorkbench no longer owns file browsing —
// every activeView reaches files through ⌘B.

interface CodeWorkbenchProps {
  projectId: number;
  projectRoot: string | null;
  /** Indexed file count — still surfaced via Today/Stats; kept on the prop
   *  shape so the App.tsx wiring stays unchanged across PR8 parts. */
  projectFiles: Array<[number, string]>;
  reloadProjectFiles: () => Promise<void>;
}

export function CodeWorkbench({
  projectId,
  projectRoot,
}: CodeWorkbenchProps) {
  const { state, setState, setActiveFile, setSidePanelOpen } = useWorkspace();
  const {
    activeFile,
    aiWorkbenchOpen,
    codeSubTab,
    sidePanelOpen,
  } = state;

  // codeSubTab still drives the Code-view secondary UI:
  //   - "files" → viewer placeholder + auto-open ⌘B if user hasn't already
  //   - "graph" → DependencyGraphView replaces the viewer pane
  //   - "ai"    → open AiWorkbench (mode toggled inside the panel)
  //   - "terminal" → open the Workspace-level TerminalDock in split mode
  //     (Lite-W6 PR7 Part 2 retired the Code-only BottomDrawer).
  useEffect(() => {
    if (codeSubTab === "ai") {
      setState((p) => ({ ...p, aiWorkbenchOpen: true }));
    } else if (codeSubTab === "terminal") {
      setState((p) => ({ ...p, layoutMode: "split" }));
    } else if (codeSubTab === "files" && !sidePanelOpen) {
      // Open ⌘B automatically when the user navigates to Files — landing in
      // an empty Code view with no file tree is more surprising than the
      // alternative. They can dismiss with ⌘B.
      setSidePanelOpen(true);
    }
    // setState/setSidePanelOpen are stable; intentionally narrow the deps.
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
      {/* C-2: Primary content. The FileTree is now Workspace-level (⌘B). */}
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

function EditorPlaceholder() {
  const { setCodeSubTab, toggleSidePanel } = useWorkspace();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#faf9f5]/50 dark:bg-[#181715]/50 relative select-none">
      <div className="w-16 h-16 rounded-3xl bg-secondary/60 border border-border flex items-center justify-center mb-6 shadow-sm">
        <Code2 className="w-8 h-8 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-xl font-bold font-heading mb-1.5">열린 파일이 없습니다</h2>
      <p className="text-xs text-muted-foreground/80 max-w-sm mb-6 leading-relaxed">
        <kbd className="font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px]">⌘B</kbd>{" "}
        로 파일 탐색기를 열거나 <kbd className="font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px]">⌘K</kbd>{" "}
        로 Command Palette 를 여세요.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={toggleSidePanel}>
          <FolderCode className="w-3.5 h-3.5 mr-1.5" />
          파일 탐색기 (⌘B)
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCodeSubTab("graph")}>
          <Network className="w-3.5 h-3.5 mr-1.5" />
          Dependency Graph
        </Button>
      </div>
    </div>
  );
}

/**
 * Lite-W6 PR8 Part 2: launch the user's preferred external editor via
 * `commands.openInEditor`. The command template comes from
 * `settings.externalEditorCommand` (default `code "%path"`).
 */
function OpenInExternalEditor({
  projectRoot,
  filePath,
  onClose,
}: {
  projectRoot: string | null;
  filePath: string;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const editorCmd = settings.externalEditorCommand;
  const absolutePath = projectRoot ? `${projectRoot}/${filePath}` : filePath;
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    if (!projectRoot) {
      toast.warning("프로젝트 루트를 찾을 수 없습니다.");
      return;
    }
    if (!editorCmd.trim()) {
      toast.warning("외부 에디터 명령이 비어 있습니다. Settings → ocul-pm 에서 설정해 주세요.", {
        durationMs: 6000,
      });
      return;
    }
    setLaunching(true);
    try {
      const res = await commands.openInEditor(projectRoot, filePath, editorCmd);
      if (res.status === "error") {
        toast.destructive(`외부 에디터 실행 실패: ${res.error}`);
      }
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#faf9f5]/50 dark:bg-[#181715]/50 relative select-none">
      <div className="w-16 h-16 rounded-3xl bg-secondary/60 border border-border flex items-center justify-center mb-6 shadow-sm">
        <ExternalLink className="w-8 h-8 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-xl font-bold font-heading mb-1.5">선택된 파일</h2>
      <code className="text-xs font-mono text-muted-foreground/90 max-w-lg break-all mb-1">
        {filePath}
      </code>
      <p className="text-[10px] text-muted-foreground/60 max-w-lg break-all mb-2 font-mono">
        {absolutePath}
      </p>
      <p className="text-[10px] text-muted-foreground/60 max-w-lg mb-6 font-mono">
        에디터 명령:{" "}
        <span className="text-foreground/80">{editorCmd || "(설정되지 않음)"}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={launch} disabled={launching || !editorCmd.trim()}>
          {launching ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          )}
          외부 에디터에서 열기
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  );
}

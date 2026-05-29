import { useEffect, useMemo, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type Project, type ProjectStats, type IndexProgress } from "@/lib/bindings";

// Core Components
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";

// Feature Panels
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { PlannerPanel } from "@/features/planner/PlannerPanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { TodayScreen } from "@/features/today/TodayScreen";
import { CodeWorkbench } from "@/features/code/CodeWorkbench";
import { TerminalDock } from "@/components/TerminalDock";
import { SidePanel } from "@/components/SidePanel";
import { AiOverlay } from "@/components/AiOverlay";
import { AiWorkbench } from "@/features/code/AiWorkbench";
import type { ChangeOp } from "@/components/FileExplorer";
import { StartScreen } from "@/features/onboarding/StartScreen";
import { GreenfieldWizard } from "@/features/onboarding/GreenfieldWizard";

import { useWorkspace, type CodeSubTab } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";

import {
  FolderCode,
  Network,
  Calendar,
  Settings,
  Code2,
  Sparkles,
  Terminal,
  Flame,
} from "./components/Icons";
import "./App.css";


type StatsMap = Record<number, ProjectStats>;

function App() {
  // ── Workspace state (project, view, file, indexing, etc.) ──────────────
  // All persistence + 17 legacy localStorage keys are owned by WorkspaceContext.
  // Reads/writes go through useWorkspace(); App no longer touches localStorage.
  const {
    state,
    setProject,
    setActiveView,
    setCodeSubTab,
    setActiveFile,
    setIndexing,
    resetWorkspace,
    setOculpmStatus,
  } = useWorkspace();

  const {
    currentProjectId: selectedProjectId,
    currentProjectName: selectedProjectName,
    currentProjectRoot: selectedProjectRoot,
    activeView,
    codeSubTab,
    indexingProjectId: indexingId,
  } = state;

  // ── Local-only (volatile) UI state ─────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [error, setError] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<Array<[number, string]>>([]);

  // Project lifecycle dialogs
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Global overlays
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [greenfieldOpen, setGreenfieldOpen] = useState(false);

  // ── Keyboard shortcuts (⌘1~5, ⌘K, ⌘,, ⌘\, ⌘J) ─────────────────────────
  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
  });

  // Restore project files list on load or ID change
  useEffect(() => {
    if (selectedProjectId !== null) {
      loadProjectFiles(selectedProjectId);
    }
  }, [selectedProjectId]);

  // .oculpm/ auto-init + watcher start on project selection (W1-PR7 + F-1 fix).
  // Idempotent server-side, so safe to call on every selection. Non-fatal:
  // a project remains usable even if ocul-pm fails to initialise here.
  //
  // W3-PR4: after init, hydrate WorkspaceContext.oculpmStatus so EmptyToday /
  // TodayScreen can branch without a separate fetch.
  //
  // F-1 fix (dogfooding _w3 §3.1): also start the filesystem watcher so
  // file_changes are captured AND journal cache stays in sync with disk
  // (deletes/creates/edits appear in Today within the debounce window).
  // Cleanup stops the previous project's watcher when the user switches.
  // W4 dogfooding follow-up (2026-05-26) — install the console bridge ONCE so
  // any uncaught warning lands in `oculpm.log`. Idempotent (`installed` guard).
  useEffect(() => {
    installConsoleBridge();
    oculpmLog.flow("App mounted — console bridge installed");
  }, []);

  useEffect(() => {
    if (selectedProjectId == null) {
      setOculpmStatus(null);
      return;
    }
    const projectId = selectedProjectId;
    let cancelled = false;
    oculpmLog.flow("step 0 — project selected", { projectId });
    void (async () => {
      const initRes = await commands.oculpmInit(projectId);
      if (cancelled) return;
      if (initRes.status === "error") {
        oculpmLog.error("init", `oculpmInit failed: ${initRes.error}`, { projectId });
        setOculpmStatus(null);
        return;
      }
      oculpmLog.flow("step 1+2 OK — init + sync_agents returned to frontend", { projectId });
      const statusRes = await commands.oculpmGetStatus(projectId);
      if (cancelled) return;
      if (statusRes.status === "ok") {
        setOculpmStatus(statusRes.data);
      } else {
        setOculpmStatus(null);
      }
      const wsRes = await commands.oculpmWatcherStart(projectId);
      if (cancelled) return;
      if (wsRes.status === "error") {
        oculpmLog.error("watcher", `watcherStart failed: ${wsRes.error}`, { projectId });
      } else {
        oculpmLog.flow("step 3 OK — watcher running", { projectId });
      }
    })();
    return () => {
      cancelled = true;
      // Fire-and-forget — stop is idempotent and tolerates uninit projects.
      void commands.oculpmWatcherStop(projectId).catch(() => {});
    };
  }, [selectedProjectId, setOculpmStatus]);

  // Refresh project lists
  async function refreshProjects() {
    setError(null);
    const res = await commands.listProjects();
    if (res.status === "ok") {
      setProjects(res.data);
      const all: StatsMap = {};
      for (const p of res.data) {
        const s = await commands.projectStats(p.id);
        if (s.status === "ok") all[p.id] = s.data;
      }
      setStats(all);
    } else {
      setError(res.error);
    }
  }

  async function loadProjectFiles(projectId: number) {
    try {
      const res = await commands.listProjectFiles(projectId);
      if (res.status === "ok") setProjectFiles(res.data);
      else console.error("Failed to load project files:", res.error);
    } catch (err) {
      console.error("Error loading project files:", err);
    }
  }

  useEffect(() => {
    refreshProjects();
  }, []);

  async function handleAddProject() {
    setError(null);
    const folder = await commands.selectProjectFolder();
    if (folder.status !== "ok" || !folder.data) return;
    const path = folder.data;
    const name = path.split("/").filter(Boolean).pop() ?? "project";
    const created = await commands.createProject(name, path);
    if (created.status === "ok") await refreshProjects();
    else setError(created.error);
  }

  async function startIndex(id: number, reset = false) {
    setIndexing(id, null);
    setError(null);

    if (reset) {
      const cleared = await commands.clearProjectIndex(id);
      if (cleared.status === "error") {
        setError(cleared.error);
        setIndexing(null);
        return;
      }
    }

    const channel = new Channel<IndexProgress>();
    channel.onmessage = (p) => setIndexing(id, p);

    const res = await commands.indexProject(id, channel);
    if (res.status === "error") setError(res.error);
    setIndexing(null);

    await refreshProjects();
    if (selectedProjectId === id) await loadProjectFiles(id);
  }

  const startRenameProject = (p: Project) => {
    setRenamingProject(p);
    setNewName(p.name);
  };

  const handleRenameProject = async () => {
    if (!renamingProject || !newName.trim()) return;
    setError(null);
    const res = await commands.renameProject(renamingProject.id, newName.trim());
    if (res.status === "ok") {
      setRenamingProject(null);
      setNewName("");
      await refreshProjects();
    } else {
      setError(res.error);
    }
  };

  const confirmDeleteProject = (p: Project) => setDeletingProject(p);

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setError(null);
    const res = await commands.deleteProject(deletingProject.id);
    if (res.status === "ok") {
      setDeletingProject(null);
      if (selectedProjectId === deletingProject.id) handleBackToDashboard();
      else await refreshProjects();
    } else {
      setError(res.error);
    }
  };

  const handleSelectProject = async (p: Project) => {
    setProject(p.id, p.name, p.root_path);
    setActiveFile(null);
    // W3-PR4: don't force a view — DEFAULT_STATE.activeView is "today" and
    // returning users keep their last pick (preserved by WorkspaceContext's
    // persisted state). Calling setActiveView here would flip the override
    // flag and trample on user preference.
    await loadProjectFiles(p.id);
  };

  const handleBackToDashboard = () => {
    resetWorkspace();
    setProject(null, null, null);
    refreshProjects();
  };

  const isDetachedTerminalWindow = window.location.search.includes("window=terminal");
  if (isDetachedTerminalWindow) {
    return (
      <div className="w-screen h-screen bg-stone-950 flex flex-col overflow-hidden select-text text-stone-100">
        <TerminalPanel
          projectRoot={selectedProjectRoot}
          isPip={false}
          onTogglePip={() => {}}
          activeTab="terminal"
          isDetachedWindow={true}
        />
      </div>
    );
  }

  // Lite-W6 PR9 — `?window=ai` mounts only AiWorkbench, no overlay chrome.
  // Project context follows the main window's last selection via
  // WorkspaceContext persistence so the detached window has somewhere to
  // operate even without an in-window project picker.
  const isDetachedAiWindow = window.location.search.includes("window=ai");
  if (isDetachedAiWindow) {
    return (
      <div className="w-screen h-screen bg-background flex flex-col overflow-hidden">
        <AiWorkbench
          activeProjectId={selectedProjectId}
          activeFile={state.activeFile}
        />
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary overflow-hidden">
      <TitleBar
        projectName={selectedProjectName}
        projectId={selectedProjectId}
        onBackToDashboard={selectedProjectId ? handleBackToDashboard : undefined}
      />

      {selectedProjectId === null ? (
        <StartScreen
          projects={projects}
          stats={stats}
          indexingId={indexingId}
          error={error}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRenameProject={startRenameProject}
          onDeleteProject={confirmDeleteProject}
          onOpenSettings={() => setSettingsOpen(true)}
          onStartGreenfield={() => setGreenfieldOpen(true)}
        />
      ) : (
        <Workspace
          activeView={activeView}
          codeSubTab={codeSubTab}
          setActiveView={setActiveView}
          setCodeSubTab={setCodeSubTab}
          selectedProjectId={selectedProjectId}
          selectedProjectRoot={selectedProjectRoot}
          projectFiles={projectFiles}
          reloadProjectFiles={() => loadProjectFiles(selectedProjectId)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Global overlays */}
      <AiOverlay
        activeProjectId={selectedProjectId}
        activeFile={state.activeFile}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onReindex={
          selectedProjectId !== null ? () => startIndex(selectedProjectId, false) : undefined
        }
      />

      {settingsOpen && (
        <SettingsOverlay onClose={() => setSettingsOpen(false)} />
      )}

      {greenfieldOpen && (
        <GreenfieldWizard
          onClose={() => setGreenfieldOpen(false)}
          onComplete={async (projectId) => {
            setGreenfieldOpen(false);
            await refreshProjects();
            const res = await commands.listProjects();
            if (res.status === "ok") {
              const created = res.data.find((p) => p.id === projectId);
              if (created) handleSelectProject(created);
            }
          }}
        />
      )}

      {/* Rename / Delete dialogs */}
      {renamingProject && (
        <Dialog title="이름 변경" onClose={() => setRenamingProject(null)}>
          <p className="text-xs text-muted-foreground">
            프로젝트 워크스페이스의 새 이름을 입력하세요. 실제 디렉토리 이름은 변경되지 않습니다.
          </p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-xl bg-background text-sm focus:outline-none focus:border-primary transition-colors text-foreground"
            placeholder="Project name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameProject();
              if (e.key === "Escape") setRenamingProject(null);
            }}
          />
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setRenamingProject(null)}
              className="px-4 py-2 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleRenameProject}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-semibold transition-colors"
            >
              이름 변경
            </button>
          </div>
        </Dialog>
      )}

      {deletingProject && (
        <Dialog title="프로젝트 제거" titleClass="text-destructive" onClose={() => setDeletingProject(null)}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground font-mono">{deletingProject.name}</span>을(를)
            Ocul-PM 워크스페이스에서 제거하시겠습니까?
            <br />
            <span className="text-destructive font-semibold">참고:</span> 앱 데이터베이스에서 인덱스와
            목표가 삭제되지만, 실제 프로젝트 폴더는 삭제되지 않습니다.
          </p>
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setDeletingProject(null)}
              className="px-4 py-2 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleDeleteProject}
              className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl text-xs font-semibold transition-colors"
            >
              프로젝트 제거
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// Old Dashboard function removed — replaced by StartScreen (W6 UI-6).

// ────────────────────────────────────────────────────────────────────────
// Workspace view (5-IA + Code sub-tabs)
// ────────────────────────────────────────────────────────────────────────

// W3-PR4: Today promoted to first (⌘1). Overview becomes #2 (⌘2).
// `useGlobalShortcuts` mirrors this order — keep the two in lock-step.
// Lite-W6 PR7 Part 1: IA collapsed from 4 (Today/Overview/Plan/Code) to
// 3 (Today/Plan/Code). Overview was absorbed into Today per 04-ui-ux §2.
// Shortcuts re-pack to ⌘1~⌘3; ⌘4/⌘5 retire.
const PRIMARY_NAV = [
  { id: "today" as const, label: "오늘", icon: Flame,           shortcut: "⌘1" },
  { id: "plan" as const,  label: "계획", icon: Calendar,        shortcut: "⌘2" },
  { id: "code" as const,  label: "코드", icon: Code2,           shortcut: "⌘3" },
];

const CODE_SUB_NAV: Array<{ id: CodeSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "files",    label: "Files",    icon: FolderCode },
  { id: "ai",       label: "AI",       icon: Sparkles },
  { id: "graph",    label: "Graph",    icon: Network },
  { id: "terminal", label: "Terminal", icon: Terminal },
];

function Workspace(props: {
  activeView: "today" | "plan" | "code";
  codeSubTab: CodeSubTab;
  setActiveView: (v: "today" | "plan" | "code") => void;
  setCodeSubTab: (s: CodeSubTab) => void;
  selectedProjectId: number;
  selectedProjectRoot: string | null;
  projectFiles: Array<[number, string]>;
  reloadProjectFiles: () => Promise<void>;
  onOpenSettings: () => void;
}) {
  const {
    activeView, codeSubTab,
    setActiveView, setCodeSubTab,
    selectedProjectId, selectedProjectRoot,
    projectFiles,
    reloadProjectFiles,
    onOpenSettings,
  } = props;
  // Lite-W6 PR7 Part 2 — workspace-level dock layout.
  // Lite-W6 PR8 Part 2 — ⌘B side panel + recentChanges → lookup map.
  const { state: workspaceState } = useWorkspace();
  const { layoutMode, splitRatio, sidePanelOpen, recentChanges } = workspaceState;
  const recentChangesMap = useMemo<Record<string, ChangeOp>>(() => {
    const map: Record<string, ChangeOp> = {};
    for (const c of recentChanges) map[c.path] = c.op;
    return map;
  }, [recentChanges]);
  const mainPaneStyle: React.CSSProperties =
    layoutMode === "terminal-only"
      ? { display: "none" }
      : layoutMode === "split"
        ? { flexBasis: `${splitRatio * 100}%`, minHeight: 0 }
        : { flexBasis: "100%", minHeight: 0 };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* A. Primary IA strip (5 views) */}
      <nav className="w-14 bg-secondary/35 border-r border-border flex flex-col justify-between items-center py-4 select-none shrink-0 glassy-sidebar" role="navigation" aria-label="메인 내비게이션">
        <div className="flex flex-col space-y-3 w-full px-2" role="list">
          {PRIMARY_NAV.map((nav) => {
            const Icon = nav.icon;
            const isActive = activeView === nav.id;
            return (
              <button
                key={nav.id}
                onClick={() => setActiveView(nav.id)}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title={`${nav.label} (${nav.shortcut})`}
                aria-label={`${nav.label} (${nav.shortcut})`}
                aria-current={isActive ? "page" : undefined}
                role="listitem"
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>

        <div className="flex flex-col space-y-3 w-full px-2">
          <button
            onClick={onOpenSettings}
            className="p-2.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-all cursor-pointer"
            title="Settings (⌘,)"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* A.5: Workspace-level FileTree side panel — ⌘B toggle (Lite-W6 PR8 Part 2). */}
      {sidePanelOpen && (
        <SidePanel
          projectId={selectedProjectId}
          indexedCount={projectFiles.length}
          recentChanges={recentChangesMap}
          onReindexed={reloadProjectFiles}
        />
      )}

      {/* B. Code sub-nav (only inside Code view) — UI-5 will absorb this */}
      {activeView === "code" && (
        <aside className="w-12 border-r border-border flex flex-col items-center py-3 space-y-2 shrink-0 bg-secondary/15">
          {CODE_SUB_NAV.map((sub) => {
            const Icon = sub.icon;
            const isActive = codeSubTab === sub.id;
            return (
              <button
                key={sub.id}
                onClick={() => setCodeSubTab(sub.id)}
                className={`p-2 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title={sub.label}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </aside>
      )}

      {/* C. Primary content + Workspace-level Terminal dock (PR7 Part 2).
          The activeView pane and the TerminalDock share the column; the
          dock's own `display:none` keeps PTY sessions alive when
          layoutMode is "main-only". */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background relative min-w-0">
        <div style={mainPaneStyle} className="flex flex-col overflow-hidden">
          {activeView === "today" && (
            <div className="flex-1 h-full overflow-hidden">
              <TodayScreen activeProjectId={selectedProjectId} />
            </div>
          )}

          {activeView === "plan" && (
            <div className="flex-1 h-full overflow-hidden">
              <PlannerPanel activeProjectId={selectedProjectId} />
            </div>
          )}

          {activeView === "code" && (
            <CodeWorkbench
              projectId={selectedProjectId}
              projectRoot={selectedProjectRoot}
              projectFiles={projectFiles}
              reloadProjectFiles={reloadProjectFiles}
            />
          )}
        </div>
        <TerminalDock projectRoot={selectedProjectRoot} />
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Settings overlay + dialog helper
// ────────────────────────────────────────────────────────────────────────

function SettingsOverlay({ onClose }: { onClose: () => void }) {
  // Esc to close — feels native for an overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="닫기 (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto scrollbar-thin">
          <SettingsPanel embedded />
        </div>
      </div>
    </div>
  );
}

function Dialog({
  title,
  titleClass,
  onClose,
  children,
}: {
  title: string;
  titleClass?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <h3 className={`text-lg font-bold ${titleClass ?? "text-foreground"}`}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default App;

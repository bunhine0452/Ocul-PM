import { useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type Project, type ProjectStats, type IndexProgress } from "@/lib/bindings";

// Core Components
import { TitleBar } from "./components/TitleBar";
import { FileExplorer } from "./components/FileExplorer";
import { CodeEditor } from "./components/CodeEditor";
import { CommandPalette } from "./components/CommandPalette";

// Feature Panels
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { PlannerPanel } from "@/features/planner/PlannerPanel";
import { DependencyGraphView } from "@/features/projects/DependencyGraphView";
import { AssistPanel } from "@/features/assist/AssistPanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { GitPanel } from "@/features/git/GitPanel";
import { OverviewScreen } from "@/features/overview/OverviewScreen";
import { TodayScreen } from "@/features/today/TodayScreen";
import { ChangelogScreen } from "@/features/changelog/ChangelogScreen";

import { useWorkspace, type CodeSubTab } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

import {
  FolderCode,
  MessageSquare,
  Network,
  Calendar,
  Settings,
  Plus,
  RefreshCw,
  Code2,
  LayoutDashboard,
  Pencil,
  Trash2,
  OculIcon,
  Sparkles,
  Terminal,
  GitBranch,
  Flame,
  FileCode,
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
  } = useWorkspace();

  const {
    currentProjectId: selectedProjectId,
    currentProjectName: selectedProjectName,
    currentProjectRoot: selectedProjectRoot,
    activeView,
    codeSubTab,
    activeFile,
    indexingProjectId: indexingId,
    indexProgress: progress,
  } = state;

  // ── Local-only (volatile) UI state ─────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [error, setError] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<Array<[number, string]>>([]);
  const [initialScrollLine, setInitialScrollLine] = useState<number | null>(null);

  // Project lifecycle dialogs
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Global overlays
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Keyboard shortcuts (⌘1~5, ⌘K, ⌘,, ⌘\, ⌘J) ─────────────────────────
  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
  });

  // Open file & jump to specific line; lands user in Code → Files tab.
  const handleOpenFile = (path: string, startLine?: number) => {
    setCodeSubTab("files");
    setActiveView("code");
    setActiveFile(path);
    setInitialScrollLine(startLine ?? null);
  };

  // Restore project files list on load or ID change
  useEffect(() => {
    if (selectedProjectId !== null) {
      loadProjectFiles(selectedProjectId);
    }
  }, [selectedProjectId]);

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
    setActiveView("overview");
    setActiveFile(null);
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

  return (
    <div className="h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary overflow-hidden">
      <TitleBar
        projectName={selectedProjectName}
        onBackToDashboard={selectedProjectId ? handleBackToDashboard : undefined}
      />

      {selectedProjectId === null ? (
        <Dashboard
          projects={projects}
          stats={stats}
          indexingId={indexingId}
          error={error}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRenameProject={startRenameProject}
          onDeleteProject={confirmDeleteProject}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <Workspace
          activeView={activeView}
          codeSubTab={codeSubTab}
          setActiveView={setActiveView}
          setCodeSubTab={setCodeSubTab}
          selectedProjectId={selectedProjectId}
          selectedProjectRoot={selectedProjectRoot}
          activeFile={activeFile}
          initialScrollLine={initialScrollLine}
          setActiveFile={setActiveFile}
          setInitialScrollLine={setInitialScrollLine}
          handleOpenFile={handleOpenFile}
          projectFiles={projectFiles}
          indexingId={indexingId}
          progress={progress}
          startIndex={startIndex}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Global overlays */}
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

      {/* Rename / Delete dialogs */}
      {renamingProject && (
        <Dialog title="Rename Project" onClose={() => setRenamingProject(null)}>
          <p className="text-xs text-muted-foreground">
            Enter a new name for the project workspace. The actual directory will not be renamed.
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
              Cancel
            </button>
            <button
              onClick={handleRenameProject}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-semibold transition-colors"
            >
              Rename
            </button>
          </div>
        </Dialog>
      )}

      {deletingProject && (
        <Dialog title="Remove Project" titleClass="text-destructive" onClose={() => setDeletingProject(null)}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to remove{" "}
            <span className="font-bold text-foreground font-mono">{deletingProject.name}</span> from the
            Ocul-PM workspace?
            <br />
            <span className="text-destructive font-semibold">Note:</span> This will remove the index
            and goals from the app database, but will NOT delete the project folder from your computer.
          </p>
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setDeletingProject(null)}
              className="px-4 py-2 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteProject}
              className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl text-xs font-semibold transition-colors"
            >
              Remove Project
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Dashboard view (no project selected)
// ────────────────────────────────────────────────────────────────────────

function Dashboard(props: {
  projects: Project[];
  stats: StatsMap;
  indexingId: number | null;
  error: string | null;
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onOpenSettings: () => void;
}) {
  const { projects, stats, indexingId, error, onSelectProject, onAddProject, onRenameProject, onDeleteProject, onOpenSettings } = props;
  return (
    <main className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-10 scrollbar-thin">
      <div className="flex flex-col items-center text-center space-y-3 mt-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground font-heading flex items-center justify-center">
          <OculIcon className="w-9 h-9 text-primary mr-3" strokeWidth={1.5} />
          <span>Ocul-PM</span>
        </h1>
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          오늘 무엇을 만들 건가요?
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground tracking-tight">Your Projects</h2>
          <div className="flex items-center space-x-3">
            <span className="text-xs text-muted-foreground font-medium">{projects.length} Total</span>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg border border-border hover:border-primary/45 hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-all duration-200 flex items-center space-x-1.5 text-xs font-semibold cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Settings</span>
              <kbd className="text-[9px] text-muted-foreground/70 font-mono ml-1">⌘,</kbd>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold rounded-xl">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {projects.map((p) => {
            const s = stats[p.id];
            const isIndexing = indexingId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => onSelectProject(p)}
                className="group bg-card hover:bg-accent/40 border border-border/80 hover:border-primary/40 rounded-2xl p-5 cursor-pointer shadow-sm hover:shadow-md transition-all duration-300 transform hover:-translate-y-0.5 flex flex-col justify-between min-h-[150px] relative overflow-hidden"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <FolderCode className="w-10 h-10 text-primary/80 group-hover:text-primary transition-colors" strokeWidth={1.5} />
                    <div className="flex items-center space-x-1">
                      {isIndexing && (
                        <span className="flex items-center space-x-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold mr-2">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          <span>Indexing</span>
                        </span>
                      )}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onRenameProject(p)}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          title="Rename Project"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteProject(p)}
                          className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <h3 className="font-bold text-base truncate text-foreground group-hover:text-primary transition-colors">
                    {p.name}
                  </h3>
                  <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-1">{p.root_path}</p>
                </div>

                <div className="flex items-center justify-between mt-4 border-t border-border/40 pt-3">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    {s ? `${s.files} files` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-medium">
                    {s ? `${s.chunks} chunks` : ""}
                  </span>
                </div>
              </div>
            );
          })}

          <button
            onClick={onAddProject}
            className="group border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-2xl p-5 flex flex-col items-center justify-center min-h-[150px] transition-all duration-300 cursor-pointer text-muted-foreground hover:text-primary"
          >
            <Plus className="w-8 h-8 mb-2 stroke-[1.5] group-hover:scale-110 transition-transform duration-300" />
            <span className="text-xs font-bold">Add Project Folder</span>
          </button>
        </div>
      </section>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Workspace view (5-IA + Code sub-tabs)
// ────────────────────────────────────────────────────────────────────────

const PRIMARY_NAV = [
  { id: "overview" as const,  label: "Overview",  icon: LayoutDashboard, shortcut: "⌘1" },
  { id: "today" as const,     label: "Today",     icon: Flame,           shortcut: "⌘2" },
  { id: "plan" as const,      label: "Plan",      icon: Calendar,        shortcut: "⌘3" },
  { id: "changelog" as const, label: "Changelog", icon: FileCode,        shortcut: "⌘4" },
  { id: "code" as const,      label: "Code",      icon: Code2,           shortcut: "⌘5" },
];

const CODE_SUB_NAV: Array<{ id: CodeSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "files",    label: "Files",    icon: FolderCode },
  { id: "chat",     label: "Chat",     icon: MessageSquare },
  { id: "assist",   label: "Assist",   icon: Sparkles },
  { id: "graph",    label: "Graph",    icon: Network },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "git",      label: "Git",      icon: GitBranch },
];

function Workspace(props: {
  activeView: "overview" | "today" | "plan" | "changelog" | "code";
  codeSubTab: CodeSubTab;
  setActiveView: (v: "overview" | "today" | "plan" | "changelog" | "code") => void;
  setCodeSubTab: (s: CodeSubTab) => void;
  selectedProjectId: number;
  selectedProjectRoot: string | null;
  activeFile: string | null;
  initialScrollLine: number | null;
  setActiveFile: (f: string | null) => void;
  setInitialScrollLine: (n: number | null) => void;
  handleOpenFile: (path: string, line?: number) => void;
  projectFiles: Array<[number, string]>;
  indexingId: number | null;
  progress: IndexProgress | null;
  startIndex: (id: number, reset?: boolean) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const {
    activeView, codeSubTab,
    setActiveView, setCodeSubTab,
    selectedProjectId, selectedProjectRoot,
    activeFile, initialScrollLine, setActiveFile, setInitialScrollLine,
    handleOpenFile, projectFiles,
    indexingId, progress, startIndex, onOpenSettings,
  } = props;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* A. Primary IA strip (5 views) */}
      <aside className="w-14 bg-secondary/35 border-r border-border flex flex-col justify-between items-center py-4 select-none shrink-0 glassy-sidebar">
        <div className="flex flex-col space-y-3 w-full px-2">
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
      </aside>

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

      {/* C. File explorer panel (Code → Files only) */}
      {activeView === "code" && codeSubTab === "files" && (
        <div className="w-[250px] flex flex-col border-r border-border shrink-0 glassy-sidebar">
          <div className="flex-1 overflow-hidden">
            <FileExplorer
              files={projectFiles}
              activeFile={activeFile}
              onSelectFile={(path) => {
                setActiveFile(path);
                setInitialScrollLine(null);
              }}
            />
          </div>
          <div className="p-3 border-t border-border/80 bg-secondary/15 select-none shrink-0">
            {indexingId === selectedProjectId ? (
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
                  {projectFiles.length} files indexed
                </span>
                <button
                  onClick={() => startIndex(selectedProjectId, false)}
                  className="px-2 py-1 rounded bg-secondary hover:bg-accent border border-border text-[10px] font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                  title="Update File Index"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Re-index</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* D. Primary content */}
      <main className="flex-1 flex overflow-hidden bg-background relative">
        {activeView === "overview" && (
          <div className="flex-1 h-full overflow-hidden">
            <OverviewScreen activeProjectId={selectedProjectId} />
          </div>
        )}

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

        {activeView === "changelog" && (
          <div className="flex-1 h-full overflow-hidden">
            <ChangelogScreen activeProjectId={selectedProjectId} />
          </div>
        )}

        {activeView === "code" && codeSubTab === "files" && (
          <div className="flex-1 flex overflow-hidden">
            {activeFile ? (
              <CodeEditor
                projectId={selectedProjectId}
                filePath={activeFile}
                initialScrollLine={initialScrollLine}
                onClose={() => setActiveFile(null)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#faf9f5]/50 dark:bg-[#181715]/50 relative select-none">
                <div className="w-16 h-16 rounded-3xl bg-secondary/60 border border-border flex items-center justify-center mb-6 shadow-sm">
                  <Code2 className="w-8 h-8 text-primary" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-bold font-heading mb-1.5">No File Opened</h2>
                <p className="text-xs text-muted-foreground/80 max-w-sm mb-6 leading-relaxed">
                  Select a file from the explorer tree on the left to inspect or edit.
                </p>
                <div className="grid grid-cols-2 gap-4 max-w-md w-full bg-card/45 p-4 rounded-2xl border border-border/50 text-left text-xs text-muted-foreground font-medium">
                  <div className="space-y-1">
                    <div className="font-bold text-foreground">Command Palette</div>
                    <div>Press <kbd className="bg-secondary px-1 py-0.5 rounded border">⌘K</kbd> for any action.</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold text-foreground">Save Changes</div>
                    <div>Press <kbd className="bg-secondary px-1 py-0.5 rounded border">⌘/Ctrl + S</kbd> to save.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === "code" && codeSubTab === "chat" && (
          <div className="flex-1 h-full overflow-hidden">
            <ChatPanel isWorkspaceMode activeProjectId={selectedProjectId} activeFile={activeFile} />
          </div>
        )}

        {activeView === "code" && codeSubTab === "assist" && (
          <div className="flex-1 h-full overflow-hidden">
            <AssistPanel activeProjectId={selectedProjectId} />
          </div>
        )}

        {activeView === "code" && codeSubTab === "graph" && (
          <div className="flex-1 h-full overflow-hidden">
            <DependencyGraphView projectId={selectedProjectId} onOpenFile={handleOpenFile} />
          </div>
        )}

        {activeView === "code" && codeSubTab === "git" && (
          <div className="flex-1 h-full overflow-hidden">
            <GitPanel projectId={selectedProjectId} />
          </div>
        )}

        {/* Terminal stays mounted across switches so the shell + scrollback survive.
            §5.6 dropped the PiP draggable mode; only Detach window remains. */}
        <TerminalPanel
          projectRoot={selectedProjectRoot}
          isPip={false}
          onTogglePip={() => {}}
          activeTab={activeView === "code" ? codeSubTab : "files"}
        />
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

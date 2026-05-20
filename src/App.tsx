import { useState, useEffect } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type Project, type ProjectStats, type IndexProgress, type DbHealth } from "@/lib/bindings";

// Core Components
import { TitleBar } from "./components/TitleBar";
import { FileExplorer } from "./components/FileExplorer";
import { CodeEditor } from "./components/CodeEditor";

// Feature Panels
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { PlannerPanel } from "@/features/planner/PlannerPanel";
import { DependencyGraphView } from "@/features/projects/DependencyGraphView";
import { AssistPanel } from "@/features/assist/AssistPanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { GitPanel } from "@/features/git/GitPanel";

import {
  FolderCode,
  MessageSquare,
  Network,
  Calendar,
  Settings,
  Database,
  Plus,
  RefreshCw,
  Code2,
  LayoutDashboard,
  Pencil,
  Trash2,
  OculIcon,
  Sparkles,
  Terminal,
  GitBranch
} from "./components/Icons";
import "./App.css";


type StatsMap = Record<number, ProjectStats>;

function App() {
  // Global Project States
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [indexingId, setIndexingId] = useState<number | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Renaming and Deleting states
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Diagnostics
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Active Workspace States
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
    const saved = localStorage.getItem("selectedProjectId");
    return saved ? Number(saved) : null;
  });
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(() => {
    return localStorage.getItem("selectedProjectName");
  });
  const [selectedProjectRoot, setSelectedProjectRoot] = useState<string | null>(() => {
    return localStorage.getItem("selectedProjectRoot");
  });
  const [activeTab, setActiveTab] = useState<"files" | "chat" | "assist" | "graph" | "planner" | "settings" | "diagnostics" | "terminal" | "git">((() => {
    const saved = localStorage.getItem("activeTab");
    return (saved as any) || "files";
  }));
  const [projectFiles, setProjectFiles] = useState<Array<[number, string]>>([]);
  const [activeFile, setActiveFile] = useState<string | null>(() => {
    return localStorage.getItem("activeFile");
  });
  const [initialScrollLine, setInitialScrollLine] = useState<number | null>(null);

  // Handle opening file and jumping to specific line
  const handleOpenFile = (path: string, startLine?: number) => {
    setActiveTab("files");
    setActiveFile(path);
    if (startLine !== undefined) {
      setInitialScrollLine(startLine);
    } else {
      setInitialScrollLine(null);
    }
  };

  // Sync workspace states to localStorage
  useEffect(() => {
    if (selectedProjectId !== null) {
      localStorage.setItem("selectedProjectId", String(selectedProjectId));
    } else {
      localStorage.removeItem("selectedProjectId");
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProjectName !== null) {
      localStorage.setItem("selectedProjectName", selectedProjectName);
    } else {
      localStorage.removeItem("selectedProjectName");
    }
  }, [selectedProjectName]);

  useEffect(() => {
    if (selectedProjectRoot !== null) {
      localStorage.setItem("selectedProjectRoot", selectedProjectRoot);
    } else {
      localStorage.removeItem("selectedProjectRoot");
    }
  }, [selectedProjectRoot]);

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeFile !== null) {
      localStorage.setItem("activeFile", activeFile);
    } else {
      localStorage.removeItem("activeFile");
    }
  }, [activeFile]);

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

  // Load files for a specific project
  async function loadProjectFiles(projectId: number) {
    try {
      const res = await commands.listProjectFiles(projectId);
      if (res.status === "ok") {
        setProjectFiles(res.data);
      } else {
        console.error("Failed to load project files:", res.error);
      }
    } catch (err) {
      console.error("Error loading project files:", err);
    }
  }

  // Initialize projects
  useEffect(() => {
    refreshProjects();
  }, []);

  // Add folder as project
  async function handleAddProject() {
    setError(null);
    const folder = await commands.selectProjectFolder();
    if (folder.status !== "ok" || !folder.data) return;
    const path = folder.data;
    const name = path.split("/").filter(Boolean).pop() ?? "project";
    const created = await commands.createProject(name, path);
    if (created.status === "ok") {
      await refreshProjects();
    } else {
      setError(created.error);
    }
  }

  // Start project indexing
  async function startIndex(id: number, reset = false) {
    setIndexingId(id);
    setProgress(null);
    setError(null);

    if (reset) {
      const cleared = await commands.clearProjectIndex(id);
      if (cleared.status === "error") {
        setError(cleared.error);
        setIndexingId(null);
        return;
      }
    }

    const channel = new Channel<IndexProgress>();
    channel.onmessage = (p) => setProgress(p);

    const res = await commands.indexProject(id, channel);
    if (res.status === "error") {
      setError(res.error);
    }
    setIndexingId(null);
    setProgress(null);

    // Refresh files list and stats
    await refreshProjects();
    if (selectedProjectId === id) {
      await loadProjectFiles(id);
    }
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

  const confirmDeleteProject = (p: Project) => {
    setDeletingProject(p);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setError(null);
    const res = await commands.deleteProject(deletingProject.id);
    if (res.status === "ok") {
      setDeletingProject(null);
      // If deleted project was selected, reset workspace
      if (selectedProjectId === deletingProject.id) {
        handleBackToDashboard();
      } else {
        await refreshProjects();
      }
    } else {
      setError(res.error);
    }
  };

  // Handle select project
  const handleSelectProject = async (p: Project) => {
    setSelectedProjectId(p.id);
    setSelectedProjectName(p.name);
    setSelectedProjectRoot(p.root_path);
    setActiveTab("files");
    setActiveFile(null);
    await loadProjectFiles(p.id);
  };

  // Close workspace and return to dashboard
  const handleBackToDashboard = () => {
    setSelectedProjectId(null);
    setSelectedProjectName(null);
    setSelectedProjectRoot(null);
    setActiveFile(null);
    refreshProjects();
  };

  // DB diagnostics health check
  async function checkDb() {
    const result = await commands.dbHealth();
    if (result.status === "ok") {
      setHealth(result.data);
      setHealthError(null);
    } else {
      setHealthError(result.error);
      setHealth(null);
    }
  }

  // Effect to load DB health if diagnostics panel is chosen
  useEffect(() => {
    if (activeTab === "diagnostics" && selectedProjectId !== null) {
      checkDb();
    }
  }, [activeTab]);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col pt-11 selection:bg-primary/20 selection:text-primary overflow-hidden">
      {/* OS Frameless Custom TitleBar */}
      <TitleBar projectName={selectedProjectName} onBackToDashboard={selectedProjectId ? handleBackToDashboard : undefined} />

      {selectedProjectId === null ? (
        // ──────────────────────────────────────────
        // 1. DASHBOARD VIEW (NO ACTIVE PROJECT SELECT)
        // ──────────────────────────────────────────
        <main className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-10 scrollbar-thin">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-3 mt-4">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground font-heading flex items-center justify-center">
              <OculIcon className="w-9 h-9 text-primary mr-3" strokeWidth={1.5} />
              <span>Ocul-PM</span>
            </h1>
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Manage and index code repositories with semantic search
            </p>
          </div>

          {/* Project List */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground tracking-tight">Your Projects</h2>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-muted-foreground font-medium">{projects.length} Total</span>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="p-1.5 rounded-lg border border-border hover:border-primary/45 hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-all duration-200 flex items-center space-x-1.5 text-xs font-semibold cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Settings</span>
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
                    onClick={() => handleSelectProject(p)}
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
                              onClick={() => startRenameProject(p)}
                              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              title="Rename Project"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => confirmDeleteProject(p)}
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
                      <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-1">
                        {p.root_path}
                      </p>
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

              {/* Add Project Box */}
              <button
                onClick={handleAddProject}
                className="group border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-2xl p-5 flex flex-col items-center justify-center min-h-[150px] transition-all duration-300 cursor-pointer text-muted-foreground hover:text-primary"
              >
                <Plus className="w-8 h-8 mb-2 stroke-[1.5] group-hover:scale-110 transition-transform duration-300" />
                <span className="text-xs font-bold">Add Project Folder</span>
              </button>
            </div>
          </section>

          {/* Diagnostics Section */}
          <section className="border-t border-border/60 pt-6">
            <button
              onClick={() => {
                setShowDiagnostics(!showDiagnostics);
                if (!showDiagnostics) checkDb();
              }}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center space-x-1.5 cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{showDiagnostics ? "Hide Diagnostics" : "Show System Diagnostics"}</span>
            </button>

            {showDiagnostics && (
              <div className="mt-4 p-4 rounded-xl border bg-card text-xs font-mono space-y-2 animate-in fade-in slide-in-from-top-1">
                <div className="flex justify-between items-center pb-2 border-b border-border/40">
                  <span className="font-bold">Database Status</span>
                  <button onClick={checkDb} className="hover:text-primary flex items-center space-x-1">
                    <RefreshCw className="w-3 h-3" />
                    <span>Check Health</span>
                  </button>
                </div>
                {health && (
                  <div className="space-y-1">
                    <div><span className="text-muted-foreground">SQLite Version:</span> {health.sqlite_version}</div>
                    <div><span className="text-muted-foreground">VEC Extension:</span> {health.vec_version}</div>
                    <div><span className="text-muted-foreground">Schema Version:</span> v{health.schema_version}</div>
                    <div className="break-all"><span className="text-muted-foreground">Database Path:</span> {health.path}</div>
                  </div>
                )}
                {healthError && <p className="text-destructive font-medium">Diagnostics Error: {healthError}</p>}
              </div>
            )}
          </section>
        </main>
      ) : (
        // ──────────────────────────────────────────
        // 2. PROJECT WORKSPACE VIEW (IDE MODE)
        // ──────────────────────────────────────────
        <div className="flex-1 flex overflow-hidden">
          {/* A. Thin Left Sidebar strip (Tab Navigaton) */}
          <aside className="w-14 bg-secondary/35 border-r border-border flex flex-col justify-between items-center py-4 select-none shrink-0 glassy-sidebar">
            <div className="flex flex-col space-y-4 w-full px-2">
              <button
                onClick={() => setActiveTab("files")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "files"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="Files Explorer"
              >
                <FolderCode className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("chat")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "chat"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="AI Code Chat"
              >
                <MessageSquare className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("assist")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "assist"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="AI 코드 어시스턴트"
              >
                <Sparkles className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("graph")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "graph"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="Dependency Map"
              >
                <Network className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("planner")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "planner"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="Project Planner"
              >
                <Calendar className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("terminal")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "terminal"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="로컬 터미널"
              >
                <Terminal className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("git")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "git"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="Git Log & Remotes"
              >
                <GitBranch className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col space-y-3 w-full px-2">
              <button
                onClick={() => setActiveTab("settings")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "settings"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="LLM Settings"
              >
                <Settings className="w-5 h-5" />
              </button>

              <button
                onClick={() => setActiveTab("diagnostics")}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === "diagnostics"
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
                title="DB Health & Diagnostics"
              >
                <Database className="w-5 h-5" />
              </button>

              <div className="border-t border-border/60 my-1 pt-2">
                <button
                  onClick={handleBackToDashboard}
                  className="p-2.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all cursor-pointer w-full"
                  title="Exit Workspace"
                >
                  <LayoutDashboard className="w-5 h-5" />
                </button>
              </div>
            </div>
          </aside>

          {/* B. Secondary Sidebar panel (conditionally rendered for FileExplorer) */}
          {activeTab === "files" && (
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

              {/* Index Trigger & Progress Gutter */}
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
                        style={{ width: `${((progress?.current || 0) / Math.max(progress?.total || 1, 1)) * 100}%` }}
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

          {/* C. Primary Main Content View Pane */}
          <main className="flex-1 flex overflow-hidden bg-background relative">
            {activeTab === "files" && (
              <div className="flex-1 flex overflow-hidden">
                {activeFile ? (
                  <CodeEditor
                    projectId={selectedProjectId}
                    filePath={activeFile}
                    initialScrollLine={initialScrollLine}
                    onClose={() => setActiveFile(null)}
                  />
                ) : (
                  // Editor Greeting Placeholder Screen
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
                        <div className="font-bold text-foreground">Semantic Chat</div>
                        <div>Switch to Chat to query codebase.</div>
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

            {activeTab === "chat" && (
              <div className="flex-1 h-full overflow-hidden">
                <ChatPanel isWorkspaceMode={true} activeProjectId={selectedProjectId} activeFile={activeFile} />
              </div>
            )}


            {activeTab === "graph" && (
              <div className="flex-1 h-full overflow-hidden">
                <DependencyGraphView 
                  projectId={selectedProjectId} 
                  onOpenFile={handleOpenFile}
                />
              </div>
            )}

            {activeTab === "assist" && (
              <div className="flex-1 h-full overflow-hidden">
                <AssistPanel activeProjectId={selectedProjectId} />
              </div>
            )}

            {activeTab === "planner" && (
              <div className="flex-1 h-full overflow-hidden">
                <PlannerPanel activeProjectId={selectedProjectId} />
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="flex-1 h-full overflow-hidden">
                <TerminalPanel projectRoot={selectedProjectRoot} />
              </div>
            )}

            {activeTab === "git" && selectedProjectId !== null && (
              <div className="flex-1 h-full overflow-hidden">
                <GitPanel projectId={selectedProjectId} />
              </div>
            )}


            {activeTab === "settings" && (
              <div className="flex-1 h-full overflow-y-auto p-6 scrollbar-thin">
                <div className="max-w-5xl mx-auto space-y-4">
                  <div className="border-b pb-3 flex items-center justify-between">
                    <h2 className="text-lg font-bold">Settings</h2>
                  </div>
                  <SettingsPanel embedded />
                </div>
              </div>
            )}

            {activeTab === "diagnostics" && (
              <div className="flex-1 h-full overflow-y-auto p-6 scrollbar-thin">
                <div className="max-w-3xl mx-auto space-y-6">
                  <div className="border-b pb-3 mb-2 flex items-center justify-between">
                    <h2 className="text-lg font-bold">Database & File Diagnostics</h2>
                    <button onClick={checkDb} className="text-xs font-semibold text-primary hover:underline flex items-center space-x-1">
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Refresh Health</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-card p-4 rounded-2xl border border-border">
                      <h4 className="font-bold text-xs uppercase text-muted-foreground/80 tracking-wider mb-2">Workspace Root</h4>
                      <p className="font-mono text-[11px] truncate" title={selectedProjectRoot || ""}>{selectedProjectRoot}</p>
                    </div>
                    <div className="bg-card p-4 rounded-2xl border border-border">
                      <h4 className="font-bold text-xs uppercase text-muted-foreground/80 tracking-wider mb-2">Active DB Path</h4>
                      <p className="font-mono text-[11px] truncate" title={health?.path || ""}>{health?.path || "Not queried"}</p>
                    </div>
                  </div>

                  <div className="bg-card p-5 rounded-2xl border border-border space-y-3 font-mono text-xs">
                    <h3 className="font-bold text-sm font-sans mb-1">SQLite & Vec Module</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 bg-secondary/40 rounded-xl">
                        <div className="text-[10px] text-muted-foreground">SQLite</div>
                        <div className="text-sm font-bold mt-0.5">{health?.sqlite_version || "—"}</div>
                      </div>
                      <div className="p-3 bg-secondary/40 rounded-xl">
                        <div className="text-[10px] text-muted-foreground">sqlite-vec</div>
                        <div className="text-sm font-bold mt-0.5">{health?.vec_version || "—"}</div>
                      </div>
                      <div className="p-3 bg-secondary/40 rounded-xl">
                        <div className="text-[10px] text-muted-foreground">Schema</div>
                        <div className="text-sm font-bold mt-0.5">v{health?.schema_version || "—"}</div>
                      </div>
                    </div>
                  </div>

                  {healthError && (
                    <div className="p-3 bg-destructive/15 border border-destructive/25 text-destructive rounded-xl text-xs font-semibold">
                      Diagnostics Failure: {healthError}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Rename Dialog */}
      {renamingProject && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-foreground">Rename Project</h3>
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
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      {deletingProject && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-destructive">Remove Project</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to remove <span className="font-bold text-foreground font-mono">{deletingProject.name}</span> from the Ocul-PM workspace?
              <br />
              <span className="text-destructive font-semibold">Note:</span> This will remove the index and goals from the app database, but will NOT delete the project folder from your computer.
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
          </div>
        </div>
      )}

      {/* Settings Dialog Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-xl w-full animate-in fade-in zoom-in-95 duration-200 relative max-h-[85vh] flex flex-col">
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors z-10 cursor-pointer"
              title="Close Settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="overflow-y-auto">
              <SettingsPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

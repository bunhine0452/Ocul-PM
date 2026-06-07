import { lazy, Suspense, useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type Project, type ProjectStats, type IndexProgress } from "@/lib/bindings";

// Core Components
import { CommandPalette } from "./components/CommandPalette";

// Feature Panels
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { AiOverlay } from "@/components/AiOverlay";
import { UpdateBanner } from "@/components/UpdateBanner";
import { StartScreen } from "@/features/onboarding/StartScreen";
import { GreenfieldWizard } from "@/features/onboarding/GreenfieldWizard";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

// PR-UI 7 — ui_v2 is now the ONLY shell (flag removed). ShellV2 stays lazy so
// it (plus its token/layer CSS chunk) loads only once a project is open; the
// project picker (StartScreen) renders without pulling the shell chunk.
const ShellV2 = lazy(() => import("@/features/shell/ShellV2"));
import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";

import "./App.css";


type StatsMap = Record<number, ProjectStats>;

function App() {
  // ── Workspace state (project, view, file, indexing, etc.) ──────────────
  // All persistence + 17 legacy localStorage keys are owned by WorkspaceContext.
  // Reads/writes go through useWorkspace(); App no longer touches localStorage.
  const {
    state,
    setProject,
    setUiV2View,
    setActiveFile,
    setIndexing,
    resetWorkspace,
    setOculpmStatus,
  } = useWorkspace();

  const {
    currentProjectId: selectedProjectId,
    currentProjectName: selectedProjectName,
    currentProjectRoot: selectedProjectRoot,
    indexingProjectId: indexingId,
  } = state;

  // ── Local-only (volatile) UI state ─────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [error, setError] = useState<string | null>(null);

  // Project lifecycle dialogs
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Global overlays
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [greenfieldOpen, setGreenfieldOpen] = useState(false);

  // ── Keyboard shortcuts (⌘1~⌘7, ⌘K, ⌘,, ⌘\) ────────────────────────────
  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    // ⌘1~⌘7 + ⌘, drive the ui_v2 screens (01-ia-and-shell §3).
    uiV2Nav: setUiV2View,
  });

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

  // Auto-index on first open: if the opened project has no chunks yet, chunk it
  // in the background so 코드 검색 returns results instead of an empty/errored
  // list. Matches the "프로젝트를 불러오면 자동 청킹" expectation and also covers
  // projects added before auto-index existed. The persisted index makes later
  // opens skip this (chunks > 0). Manual "재구축" still refreshes on demand.
  useEffect(() => {
    if (selectedProjectId == null) return;
    const pid = selectedProjectId;
    let cancelled = false;
    void (async () => {
      const s = await commands.projectStats(pid);
      if (cancelled || s.status !== "ok") return;
      if (s.data.chunks === 0 && indexingId !== pid) {
        void startIndex(pid);
      }
    })();
    return () => {
      cancelled = true;
    };
    // startIndex/indexingId are intentionally not deps — this should run once
    // per project open, keyed on the selected project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (created.status === "ok") {
      await refreshProjects();
      // Auto-chunk the freshly added project so 코드 검색 works without a manual
      // "재구축" step. Progress shows on StartScreen via indexingId. Indexing is
      // incremental (hash-gated), so later opens skip unchanged files.
      void startIndex(created.data);
    } else {
      setError(created.error);
    }
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

  const handleSelectProject = (p: Project) => {
    setProject(p.id, p.name, p.root_path);
    setActiveFile(null);
    // Don't force a view — returning users keep their last ui_v2 screen
    // (WorkspaceContext.uiV2View persists it).
  };

  const handleBackToDashboard = () => {
    resetWorkspace();
    setProject(null, null, null);
    refreshProjects();
  };

  return (
    <div className="h-screen overflow-hidden">
      {/* PR-UI 7 — ui_v2 is the only shell. A selected project mounts the
          full-screen ShellV2 (its own chrome); no project shows the picker. */}
      {selectedProjectId !== null ? (
        <Suspense fallback={null}>
          <ShellV2
            projectName={selectedProjectName}
            projectRoot={selectedProjectRoot}
            onOpenProjectSwitcher={handleBackToDashboard}
          />
        </Suspense>
      ) : (
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
      )}

      {/* Global overlays */}
      <UpdateBanner />
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

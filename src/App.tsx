import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type Project,
  type IndexProgress,
  type ProjectBlueprint,
} from "@/lib/bindings";

// Core Components
import { CommandPalette } from "./components/CommandPalette";

// Feature Panels
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { BootSplash } from "@/components/BootSplash";
import { UpdateBanner } from "@/components/UpdateBanner";
import { EmbeddingModelBanner } from "@/components/EmbeddingModelBanner";
import { StartScreen } from "@/features/onboarding/StartScreen";
import { GreenfieldWizard } from "@/features/onboarding/GreenfieldWizard";

import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

// PR-UI 7 — ui_v2 is now the ONLY shell (flag removed). ShellV2 stays lazy so
// it (plus its token/layer CSS chunk) loads only once a project is open; the
// project picker (StartScreen) renders without pulling the shell chunk.
const ShellV2 = lazy(() => import("@/features/shell/ShellV2"));
import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";
import { toast } from "@/lib/toast";

import "./App.css";


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
  const [error, setError] = useState<string | null>(null);

  // Project lifecycle dialogs
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  // Opt-in: independently wipe Ocul-PM's on-disk artifacts from the project
  // folder when removing. Both reset every time the dialog opens.
  const [deleteOculpm, setDeleteOculpm] = useState(false);
  const [deleteAgentsMd, setDeleteAgentsMd] = useState(false);

  // Global overlays
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [greenfieldOpen, setGreenfieldOpen] = useState(false);
  // 대시보드 "복원" (감사 fix) — 저장된 초안을 마법사에 넘겨 이어서 시작.
  const [greenfieldResume, setGreenfieldResume] = useState<ProjectBlueprint | null>(null);

  // ── Keyboard shortcuts (⌘1~⌘7, ⌘K, ⌘,, ⌘\) ────────────────────────────
  // 대시보드(프로젝트 미선택)에서는 셸이 언마운트라 화면 전환이 의미가 없다.
  // 예전에는 그대로 setUiV2View 를 호출해 ⌘, 가 무반응이면서(설정이 안 열림)
  // 언마운트된 셸의 uiV2View 만 조용히 바꿔 놓았다 — 힌트는 표시하면서
  // 동작하지 않는 거짓 UI. 이제 ⌘, 만 설정 오버레이로 연결하고 나머지 화면
  // 전환은 삼킨다. 프로젝트가 열려 있으면 종전대로 셸로 그대로 넘어간다.
  const navFromShortcut = useCallback(
    (v: UiV2View) => {
      if (selectedProjectId === null) {
        if (v === "settings") setSettingsOpen(true);
        return;
      }
      setUiV2View(v);
    },
    [selectedProjectId, setUiV2View],
  );

  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    // ⌘1~⌘7 + ⌘, drive the ui_v2 screens (01-ia-and-shell §3).
    uiV2Nav: navFromShortcut,
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

      // Offer a master-template upgrade for projects initialized before a
      // template bump (their on-disk AGENTS.md is stale vs the shipped rules).
      const upRes = await commands.oculpmAgentsCheckMasterUpgrade(projectId);
      if (cancelled) return;
      if (upRes.status === "ok" && upRes.data) {
        const { from_version, to_version } = upRes.data;
        toast.warning("에이전트 규칙(AGENTS.md) 업데이트가 있어요", {
          title: `규칙 템플릿 v${from_version} → v${to_version}`,
          dedupKey: `master-upgrade-${projectId}`,
          durationMs: 20000,
          actions: [
            {
              label: "업데이트",
              onClick: () => {
                void (async () => {
                  const r = await commands.oculpmAgentsApplyMasterUpgrade(projectId);
                  if (r.status === "ok") {
                    toast.info("AGENTS.md 를 최신 규칙으로 갱신했어요 (이전 master 는 _template.md.bak 백업).");
                  } else {
                    toast.destructive(`업데이트 실패: ${r.error}`);
                  }
                })();
              },
            },
          ],
        });
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
      // 프로젝트별 projectStats 직렬 루프는 2026-07-31 에 제거했다 — 유일한
      // 소비처가 메인 화면의 "N 파일 · N 청크" 였는데, 그건 인덱싱 내부 지표라
      // 사용자 가치가 없으면서 프로젝트 수만큼 IPC 를 직렬로 때렸다.
      // 메인 화면은 이제 home_brief 1콜로 필요한 걸 전부 받는다.
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

  const confirmDeleteProject = (p: Project) => {
    setDeleteOculpm(false);
    setDeleteAgentsMd(false);
    setDeletingProject(p);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setError(null);
    const res = await commands.deleteProject(deletingProject.id, deleteOculpm, deleteAgentsMd);
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
      {/* 부트 스플래시 — 콜드 스타트 1회, 첫 페인트를 브랜드 모션으로 덮고
          들리며 아래 UI(시트 상승·내비 캐스케이드)를 드러낸다. */}
      <BootSplash />
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
          indexingId={indexingId}
          error={error}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRenameProject={startRenameProject}
          onDeleteProject={confirmDeleteProject}
          onOpenSettings={() => setSettingsOpen(true)}
          onStartGreenfield={() => {
            setGreenfieldResume(null);
            setGreenfieldOpen(true);
          }}
          onResumeBlueprint={(bp) => {
            setGreenfieldResume(bp);
            setGreenfieldOpen(true);
          }}
        />
      )}

      {/* Global overlays — AI 오버레이는 감사(2026-07-16)에서 은퇴, ⌘\ 는 AI 패널로 */}
      <UpdateBanner />
      <EmbeddingModelBanner />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onReindex={
          selectedProjectId !== null ? () => startIndex(selectedProjectId, false) : undefined
        }
        projects={projects}
        onSelectProject={handleSelectProject}
      />

      {settingsOpen && (
        <SettingsOverlay onClose={() => setSettingsOpen(false)} />
      )}

      {greenfieldOpen && (
        <GreenfieldWizard
          resume={greenfieldResume}
          onClose={() => {
            setGreenfieldOpen(false);
            setGreenfieldResume(null);
          }}
          onComplete={async (projectId) => {
            setGreenfieldOpen(false);
            setGreenfieldResume(null);
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
          <div className="mt-1 space-y-1.5">
            <label className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-muted/40 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteOculpm}
                onChange={(e) => setDeleteOculpm(e.target.checked)}
                className="mt-0.5 accent-destructive"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                프로젝트 폴더의 <code className="font-mono text-foreground">.oculpm</code> 폴더도 삭제
              </span>
            </label>
            <label className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-muted/40 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteAgentsMd}
                onChange={(e) => setDeleteAgentsMd(e.target.checked)}
                className="mt-0.5 accent-destructive"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                프로젝트 폴더의 <code className="font-mono text-foreground">AGENTS.md</code> 파일도 삭제
              </span>
            </label>
            {(deleteOculpm || deleteAgentsMd) && (
              <p className="text-[11px] text-destructive px-1">
                선택한 파일은 디스크에서 영구 삭제되며 되돌릴 수 없습니다.
              </p>
            )}
          </div>
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
      data-home-overlay
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
        {/* `embedded` 는 **호스트가 좌우 여백을 준다**는 전제로 만들어졌다
            (ShellV2 는 `.page` 로 감싼다 — ShellV2.tsx). 이 모달은 그동안
            패딩 없는 div 로 감싸고 있어서 탭·입력·카드가 전부 카드 가장자리에
            붙어 있었다. 헤더의 px-6 과 같은 좌우 여백을 준다. */}
        <div className="overflow-y-auto scrollbar-thin px-6 pt-5">
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

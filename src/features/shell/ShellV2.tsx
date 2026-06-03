import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/lib/theme";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { SearchScreenV2 } from "@/features/search/SearchScreenV2";
import { TerminalScreenV2 } from "@/features/terminal/TerminalScreenV2";
import { AiPanelScreenV2 } from "@/features/chat/AiPanelScreenV2";
import { SettingsScreenV2 } from "@/features/settings/SettingsScreenV2";
import type { JournalEntrySummary } from "@/lib/bindings";

// The 5 token/layer stylesheets. This static import is the token-isolation
// mechanism (PR-UI 0 §0.6): App lazy-loads ShellV2 via React.lazy, so Vite
// emits this CSS as a SEPARATE chunk that the browser fetches only when the
// ui_v2 shell first mounts. flag-off never loads the ShellV2 chunk → the new
// --accent (green) never reaches the legacy cream UI. (Verified in PR-UI 1:
// the build emits a distinct ShellV2 CSS chunk; the main bundle keeps only the
// legacy tokens.)
import "@/styles/index.css";

// Final UI Update — the 248px-sidebar shell. PR-UI 7 made this the only shell
// (the feature flag is gone); App mounts it full-screen whenever a project is
// selected. Each screen renders its OWN <Toolbar> (UI-MASTER-PROMPT §7.4), so
// the shell only owns the sidebar + the screen router. All 8 screens are built.

interface ShellV2Props {
  projectName: string | null;
  projectRoot: string | null;
  /** Opens the project switcher. PR-UI 1 routes this to the dashboard picker. */
  onOpenProjectSwitcher: () => void;
}

export default function ShellV2({
  projectName,
  projectRoot,
  onOpenProjectSwitcher,
}: ShellV2Props) {
  const { state, setUiV2View, setState } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const view = state.uiV2View;
  const isDark = resolvedTheme === "dark";

  // One-shot focus handoff: Today's MiniEntry → 작업 일지 ring-highlight. Kept
  // as shell-local ephemeral state (focus is not persisted; it's a single
  // event, mirroring WorkspaceContext.diffTarget's one-shot semantics).
  const [journalFocus, setJournalFocus] = useState<string | null>(null);

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the native
  // traffic lights float over the top-left. With the legacy TitleBar gone in
  // ui_v2, the sidebar must reserve a top strip so the brand clears them.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const projectId = state.currentProjectId;
  const workday = state.workdayKey ?? state.oculpmStatus?.current_workday ?? null;
  const oculpmReady = state.oculpmStatus?.initialized === true;
  const dateLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const openEntryInJournal = (entry: JournalEntrySummary) => {
    setJournalFocus(entry.relative_path);
    setUiV2View("journal");
  };

  // A journal card → 변경 diff 화면. Park the path on WorkspaceContext.
  // diffActivePath so PR-UI 4's DiffScreen can pre-select it.
  const openDiffForEntry = (entry: JournalEntrySummary) => {
    setState((prev) => ({ ...prev, diffActivePath: entry.relative_path }));
    setUiV2View("diff");
  };

  return (
    <div className="app" style={{ height: "100%" }}>
      <Sidebar
        view={view}
        onNavigate={setUiV2View}
        projectName={projectName}
        projectPath={projectRoot}
        onOpenProjectSwitcher={onOpenProjectSwitcher}
        isDark={isDark}
        onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
        macTopInset={isMac ? 22 : 0}
      />
      <main className="content">
        {view === "settings" ? (
          // Settings is global (⌘,) — reachable even before a project is
          // selected; its per-project rows self-disable when projectId is null.
          <SettingsScreenV2 projectId={projectId} projectRoot={projectRoot} />
        ) : projectId == null ? (
          <>
            <Toolbar title={view === "today" ? "Today" : "작업 일지"} />
            <div className="scroll">
              <div className="page fade-in">
                <div className="empty-hint">프로젝트를 먼저 선택해주세요.</div>
              </div>
            </div>
          </>
        ) : view === "today" ? (
          <TodayScreenV2
            projectId={projectId}
            workday={workday}
            oculpmReady={oculpmReady}
            onNavigate={setUiV2View}
            onOpenEntry={openEntryInJournal}
            dateLabel={dateLabel}
            tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        ) : view === "journal" ? (
          <JournalScreenV2
            projectId={projectId}
            todayKey={workday}
            oculpmReady={oculpmReady}
            onOpenDiff={openDiffForEntry}
            focusPath={journalFocus}
            onFocusConsumed={() => setJournalFocus(null)}
          />
        ) : view === "diff" ? (
          <DiffScreenV2 projectId={projectId} projectRoot={projectRoot} branch={null} />
        ) : view === "planner" ? (
          <PlannerScreenV2 projectId={projectId} onNavigate={setUiV2View} />
        ) : view === "search" ? (
          <SearchScreenV2 projectId={projectId} />
        ) : view === "terminal" ? (
          <TerminalScreenV2 projectRoot={projectRoot} />
        ) : view === "ai" ? (
          <AiPanelScreenV2 projectId={projectId} />
        ) : null}
      </main>
    </div>
  );
}

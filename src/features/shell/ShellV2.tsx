import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/lib/theme";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import type { JournalEntrySummary } from "@/lib/bindings";

// The 5 token/layer stylesheets. This static import is the token-isolation
// mechanism (PR-UI 0 §0.6): App lazy-loads ShellV2 via React.lazy, so Vite
// emits this CSS as a SEPARATE chunk that the browser fetches only when the
// ui_v2 shell first mounts. flag-off never loads the ShellV2 chunk → the new
// --accent (green) never reaches the legacy cream UI. (Verified in PR-UI 1:
// the build emits a distinct ShellV2 CSS chunk; the main bundle keeps only the
// legacy tokens.)
import "@/styles/index.css";

// Final UI Update (ui_v2) — the new 248px-sidebar shell. Mounted by App ONLY
// when isUiV2Enabled() is true. No ui_v2 class name collides with legacy
// (verified PR-UI 1). Each screen renders its OWN <Toolbar> (UI-MASTER-PROMPT
// §7.4), so the shell only owns the sidebar + the screen router. Screens not
// yet built (PR-UI 4~6) fall through to a labelled placeholder.

const PLACEHOLDER_META: Record<
  "planner" | "search" | "terminal" | "ai" | "settings",
  { title: string; sub?: string; pr: string }
> = {
  planner: { title: "Planner", pr: "PR-UI 5" },
  search: { title: "시맨틱 코드 검색", pr: "PR-UI 5" },
  terminal: { title: "터미널", pr: "PR-UI 5" },
  ai: { title: "AI 패널", pr: "PR-UI 5" },
  settings: { title: "설정", pr: "PR-UI 6" },
};

function Placeholder({ view }: { view: keyof typeof PLACEHOLDER_META }) {
  const meta = PLACEHOLDER_META[view];
  return (
    <>
      <Toolbar title={meta.title} sub={meta.sub} />
      <div className="scroll">
        <div className="page fade-in">
          <div className="empty-hint">
            '{meta.title}' 화면은 {meta.pr} 에서 채워집니다.
          </div>
        </div>
      </div>
    </>
  );
}

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
        {projectId == null ? (
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
        ) : (
          <Placeholder view={view} />
        )}
      </main>
    </div>
  );
}

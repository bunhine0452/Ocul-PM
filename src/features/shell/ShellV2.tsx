import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { useTheme } from "@/lib/theme";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
// v2 U6 (docs/20260706_v2/03-performance-spec.md §2) — 핵심 루프 4화면
// (Today/일지/diff/플래너)만 eager. 나머지는 화면별 청크로 분할해 프로젝트
// 첫 오픈 비용에서 뺀다 — 특히 터미널(xterm)·AI/문서/토의/회고(markdown)·
// 설정(1400줄)·검색. 코드 맵(React Flow+dagre)은 이전부터 lazy.
const RetroScreenV2 = lazy(() =>
  import("@/features/retro/RetroScreenV2").then((m) => ({ default: m.RetroScreenV2 })),
);
const SearchScreenV2 = lazy(() =>
  import("@/features/search/SearchScreenV2").then((m) => ({ default: m.SearchScreenV2 })),
);
const TerminalScreenV2 = lazy(() =>
  import("@/features/terminal/TerminalScreenV2").then((m) => ({ default: m.TerminalScreenV2 })),
);
const AiPanelScreenV2 = lazy(() =>
  import("@/features/chat/AiPanelScreenV2").then((m) => ({ default: m.AiPanelScreenV2 })),
);
const DocsScreenV2 = lazy(() =>
  import("@/features/docs/DocsScreenV2").then((m) => ({ default: m.DocsScreenV2 })),
);
const DiscussionScreenV2 = lazy(() =>
  import("@/features/discussion/DiscussionScreenV2").then((m) => ({
    default: m.DiscussionScreenV2,
  })),
);
const GraphScreenV2 = lazy(() =>
  import("@/features/graph/GraphScreenV2").then((m) => ({ default: m.GraphScreenV2 })),
);
const SettingsPanel = lazy(() =>
  import("@/features/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { commands, type JournalEntrySummary } from "@/lib/bindings";

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
  const { state, setUiV2View, setState, setProject } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const view = state.uiV2View;
  const isDark = resolvedTheme === "dark";

  // Sidebar collapse + hover-reveal (Dogfooding 2026-06-07). `collapsed` is
  // persisted; `hovering` is ephemeral — set by the left-edge hover zone and
  // cleared when the cursor leaves the floating sidebar.
  const collapsed = state.sidebarCollapsed;
  const [hovering, setHovering] = useState(false);
  const toggleSidebar = () => {
    setHovering(false);
    setState((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  };

  // ⌘P 프로젝트 전환 (v2 U1): 사이드바가 접혀 있으면 팝오버가 화면 밖에
  // 열리므로, 이벤트 수신 시 hover-reveal 로 먼저 띄운다.
  useEffect(() => {
    if (!collapsed) return;
    const reveal = () => setHovering(true);
    window.addEventListener(NAV_BUS.openProjectSwitcher, reveal);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, reveal);
  }, [collapsed]);

  // One-shot focus handoff: Today's MiniEntry → 작업 일지 ring-highlight. Kept
  // as shell-local ephemeral state (focus is not persisted; it's a single
  // event, mirroring the diffActivePath one-shot handoff in DiffScreenV2).
  const [journalFocus, setJournalFocus] = useState<string | null>(null);

  // Planner 📓 → open a specific journal entry's detail view directly. Distinct
  // from `journalFocus` (timeline ring-highlight): this resolves the entry by
  // path even when it's older than the loaded day window, so completed plans
  // whose work is weeks old still navigate. Cleared once the journal consumes it.
  const [journalOpenEntry, setJournalOpenEntry] = useState<string | null>(null);
  const clearJournalOpenEntry = useCallback(() => setJournalOpenEntry(null), []);

  // When a journal entry is opened from another screen (e.g. the Planner's 일지
  // link), remember where to send the detail view's "back" button so the user
  // returns to that origin screen instead of the journal timeline.
  const [journalReturnView, setJournalReturnView] = useState<UiV2View | null>(null);

  // v2 U7 — 팔레트 엔티티 점프. 플래너/토의/문서 화면은 영속 필드
  // (plannerPlanId 등)를 mount 시에만 읽으므로, 이미 그 화면에 있어도 점프가
  // 반영되도록 nonce 로 remount 를 강제한다 (화면은 mount 시 재조회).
  const [jumpNonce, setJumpNonce] = useState(0);
  useEffect(() => {
    const onOpenEntity = (e: Event) => {
      const detail = (e as CustomEvent<OpenEntityDetail>).detail;
      if (!detail?.kind || !detail?.id) return;
      if (detail.kind === "journal") {
        setJournalReturnView(null);
        setJournalOpenEntry(detail.id);
        setUiV2View("journal");
      } else if (detail.kind === "plan" || detail.kind === "plan_item") {
        const planId = detail.id.split("#")[0];
        setState((prev) => ({ ...prev, plannerPlanId: planId }));
        setJumpNonce((n) => n + 1);
        setUiV2View("planner");
      } else if (detail.kind === "discussion") {
        setState((prev) => ({ ...prev, discussionActiveId: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("discussion");
      } else if (detail.kind === "doc") {
        setState((prev) => ({ ...prev, docsActivePath: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("docs");
      }
    };
    window.addEventListener(NAV_BUS.openEntity, onOpenEntity);
    return () => window.removeEventListener(NAV_BUS.openEntity, onOpenEntity);
  }, [setState, setUiV2View]);

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the native
  // traffic lights float over the top-left. With the legacy TitleBar gone in
  // ui_v2, the sidebar must reserve a top strip so the brand clears them.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const projectId = state.currentProjectId;
  const workday = state.workdayKey ?? state.oculpmStatus?.current_workday ?? null;
  const oculpmReady = state.oculpmStatus?.initialized === true;

  // Inline project quick-switch (Dogfooding 2026-06-14c): list projects for the
  // sidebar popover so the user can jump between projects in place, without
  // returning to the main screen. Refetched when the active project changes
  // (so a rename/add elsewhere stays roughly fresh).
  const [projects, setProjects] = useState<{ id: number; name: string; root_path: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void commands.listProjects().then((res) => {
      if (alive && res.status === "ok") {
        setProjects(res.data.map((p) => ({ id: p.id, name: p.name, root_path: p.root_path })));
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const switchProject = (id: number) => {
    const p = projects.find((x) => x.id === id);
    if (p && p.id !== projectId) setProject(p.id, p.name, p.root_path);
  };
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

  const appClass =
    "app" +
    (isMac ? " is-mac" : "") +
    (collapsed ? " sidebar-collapsed" : "") +
    (collapsed && hovering ? " sidebar-hover" : "");

  return (
    <div className={appClass} style={{ height: "100%" }}>
      {collapsed ? (
        // Left-edge hover zone — only present when collapsed; entering it floats
        // the sidebar in as an overlay. Cleared on the sidebar's mouseleave.
        <div
          className="side-hover-zone"
          onMouseEnter={() => setHovering(true)}
          aria-hidden="true"
        />
      ) : null}
      <Sidebar
        view={view}
        onNavigate={setUiV2View}
        projectName={projectName}
        projectPath={projectRoot}
        onOpenProjectSwitcher={onOpenProjectSwitcher}
        projects={projects}
        currentProjectId={projectId}
        onSwitchProject={switchProject}
        isDark={isDark}
        onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
        macTopInset={isMac ? 22 : 0}
        onToggleCollapse={toggleSidebar}
        collapsed={collapsed}
        onMouseLeave={collapsed ? () => setHovering(false) : undefined}
      />
      <main className="content">
        {/* v2 U6 — lazy 화면 공용 fallback: 툴바 자리 + 콘텐츠 스켈레톤.
            스피너 대신 콘텐츠 형태를 유지해 화면 전환 점프를 줄인다. */}
        <Suspense
          fallback={
            <>
              <div className="toolbar" aria-hidden="true">
                <Skeleton width={160} height={18} />
              </div>
              <div className="scroll">
                <div className="page">
                  <SkeletonList rows={4} height={76} />
                </div>
              </div>
            </>
          }
        >
        {view === "settings" ? (
          // Unified settings (dogfooding 2026-06-15): the in-project ⌘, screen now
          // renders the SAME comprehensive SettingsPanel as the project-picker, so
          // both entry points are identical. Per-project rows read the active
          // project from WorkspaceContext and self-disable when none is selected.
          <>
            <Toolbar title="설정" sub="모든 데이터는 이 기기에만 저장됩니다" />
            <div className="scroll">
              <div className="page fade-in">
                <SettingsPanel embedded />
              </div>
            </div>
          </>
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
            projectRoot={projectRoot}
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
            openEntryPath={journalOpenEntry}
            onOpenEntryConsumed={clearJournalOpenEntry}
            onReturnToOrigin={
              journalReturnView
                ? () => {
                    const target = journalReturnView;
                    setJournalReturnView(null);
                    setUiV2View(target);
                  }
                : undefined
            }
          />
        ) : view === "diff" ? (
          <DiffScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            branch={null}
            onOpenEntry={(path) => {
              setJournalFocus(path);
              setUiV2View("journal");
            }}
          />
        ) : view === "planner" ? (
          <PlannerScreenV2
            key={`planner-${jumpNonce}`}
            projectId={projectId}
            onNavigate={setUiV2View}
            onOpenJournal={(path) => {
              setJournalReturnView("planner");
              setJournalOpenEntry(path);
              setUiV2View("journal");
            }}
          />
        ) : view === "retro" ? (
          <RetroScreenV2 projectId={projectId} />
        ) : view === "search" ? (
          <SearchScreenV2 projectId={projectId} />
        ) : view === "terminal" ? (
          <TerminalScreenV2 projectRoot={projectRoot} />
        ) : view === "ai" ? (
          <AiPanelScreenV2 projectId={projectId} />
        ) : view === "docs" ? (
          <DocsScreenV2 key={`docs-${jumpNonce}`} projectId={projectId} />
        ) : view === "discussion" ? (
          <DiscussionScreenV2
            key={`discussion-${jumpNonce}`}
            projectId={projectId}
            onNavigate={setUiV2View}
          />
        ) : view === "graph" ? (
          <GraphScreenV2 projectId={projectId} projectRoot={projectRoot} />
        ) : null}
        </Suspense>
      </main>
    </div>
  );
}

import { Suspense, useEffect, useState } from "react";
import { createUnlistenBag, safeUnlistenPromise } from "@/lib/unlisten";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { EmptyState } from "@/components/EmptyState";
import { useProjectRuntime, useUiPrefs, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_BUS } from "@/lib/navRegistry";
import { useTheme } from "@/lib/theme";
import { useT } from "@/i18n";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { TerminalAway } from "@/features/terminal/TerminalAway";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
// 지연 청크로 가는 나머지 화면들 — 목록과 그 이유는 `./screens` 가 소유한다.
import {
  AiPanelScreenV2,
  BranchScreenV2,
  ClaudeCodeScreenV2,
  CodeScreenV2,
  CodexScreenV2,
  DiscussionScreenV2,
  DocsScreenV2,
  GraphScreenV2,
  RetroScreenV2,
  SearchScreenV2,
  SessionsScreenV2,
  SettingsPanel,
  SkillsScreenV2,
  TerminalDock,
  TerminalScreenV2,
} from "./screens";
import { KNOWN_VIEWS, useShellNav } from "./useShellNav";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { commands, events, type JournalEntrySummary } from "@/lib/bindings";

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
// the shell only owns the sidebar + the screen router. `lib/navRegistry.ts` is
// the single source for the screen list — 16 as of 2026-09-04 (the comment here
// said 8, a number the router outgrew long ago; count it there, not here).
//
// 셸이 소유하지 **않는** 두 결은 옆 파일에 있다 (2026-09-07, {#big-files-watch}):
// 지연 청크 목록은 `./screens`, 화면 밖에서 온 이동 요청과 한 번짜리 핸드오프는
// `./useShellNav`.

interface ShellV2Props {
  projectName: string | null;
  projectRoot: string | null;
  /** 시작 탭을 연다 (프로젝트 관리·추가·제거는 전부 시작 화면에 있다). */
  onOpenProjectSwitcher: () => void;
  /** 다른 프로젝트를 이 창의 탭으로 연다 (이미 열려 있으면 그 탭 활성화). */
  onOpenProject: (projectId: number) => void;
  /** 트레이 딥링크가 URL 로 실어 온 목적 화면 — mount 시 1회 적용. */
  initialView?: string | null;
  /** 트레이 딥링크가 URL 로 실어 온 `.oculpm` 상대 일지 경로. */
  initialEntryPath?: string | null;
  /**
   * 이 탭이 화면에 보이는가. 비활성 탭도 마운트된 채라(크롬식 탭), 창 전역
   * CustomEvent(`NAV_BUS`)는 활성 탭만 들어야 한다 — 아니면 팔레트에서 연
   * 일지가 숨은 탭에서도 열린다.
   */
  active?: boolean;
}

export default function ShellV2({
  projectName,
  projectRoot,
  onOpenProjectSwitcher,
  onOpenProject,
  initialView = null,
  initialEntryPath = null,
  active = true,
}: ShellV2Props) {
  const { t } = useT();
  // 조각만 구독한다 (v2.42.0 `{#workspace-full-consumers}`). 이 컴포넌트는
  // **16화면 라우터**다 — 합친 겉면 `useWorkspace()` 를 쓰던 때는 터미널 탭을
  // 하나 고를 때마다 라우터 전체가 다시 그려졌다. 셸이 읽는 것은 UI 취향
  // (화면·도크)과 런타임(프로젝트·workday·분리 창·사이드바)뿐이고, 터미널
  // **세션 목록**은 한 글자도 읽지 않는다.
  const { prefs, setPrefs, setUiV2View } = useUiPrefs();
  const runtime = useProjectRuntime();
  const { setTerminalDetached, setSidebarCollapsed } = runtime;
  const { resolvedTheme, setTheme } = useTheme();
  const view = prefs.uiV2View;
  const isDark = resolvedTheme === "dark";
  const projectId = runtime.currentProjectId;
  const workday = runtime.workdayKey ?? runtime.oculpmStatus?.current_workday ?? null;
  const oculpmReady = runtime.oculpmStatus?.initialized === true;

  /**
   * Claude Code 화면을 한 번이라도 열었는가.
   *
   * 열기 전에는 마운트하지 않고(어댑터 기동 비용), 한 번 열면 이 탭이 사는 동안
   * 계속 마운트해 둔다 — 돌던 턴이 화면을 옮겼다고 끊기면 안 된다. 라우터 아래의
   * keep-alive 블록에 그 이유를 자세히 적어 두었다.
   */
  const [claudeMounted, setClaudeMounted] = useState(view === "claudecode");
  const [codexMounted, setCodexMounted] = useState(view === "codex");
  useEffect(() => {
    if (view === "claudecode") setClaudeMounted(true);
    if (view === "codex") setCodexMounted(true);
  }, [view]);

  // 트레이 딥링크·팔레트 점프·「일지로 남기기」 처럼 **다른 화면이 쏜 이동 요청**과
  // 그 한 번짜리 핸드오프는 조각 훅이 소유한다 (`./useShellNav`).
  const {
    journalFocus,
    setJournalFocus,
    journalOpenEntry,
    setJournalOpenEntry,
    clearJournalOpenEntry,
    journalReturnView,
    setJournalReturnView,
    codeTarget,
    openInCode,
    clearCodeTarget,
    jumpNonce,
  } = useShellNav({
    active,
    view,
    projectId,
    setUiV2View,
    setPrefs,
    initialView,
    initialEntryPath,
  });

  // Sidebar collapse + hover-reveal (Dogfooding 2026-06-07). `collapsed` is
  // persisted; `hovering` is ephemeral — set by the left-edge hover zone and
  // cleared when the cursor leaves the floating sidebar.
  const collapsed = runtime.sidebarCollapsed;
  const [hovering, setHovering] = useState(false);
  const toggleSidebar = () => {
    setHovering(false);
    setSidebarCollapsed(!collapsed);
  };

  // ⌘P 프로젝트 전환 (v2 U1): 사이드바가 접혀 있으면 팝오버가 화면 밖에
  // 열리므로, 이벤트 수신 시 hover-reveal 로 먼저 띄운다.
  useEffect(() => {
    if (!collapsed || !active) return;
    const reveal = () => setHovering(true);
    window.addEventListener(NAV_BUS.openProjectSwitcher, reveal);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, reveal);
  }, [collapsed, active]);

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the native
  // traffic lights float over the top-left. With the legacy TitleBar gone in
  // ui_v2, the sidebar must reserve a top strip so the brand clears them.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

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

  // 다른 프로젝트가 어디든 열려 있는지 — 팝오버의 "열림" 표시.
  const [openWindows, setOpenWindows] = useState<number[]>([]);
  useEffect(() => {
    void commands.listOpenProjectIds().then((res) => {
      if (res.status === "ok") setOpenWindows(res.data);
    });
    const bag = createUnlistenBag();
    bag.add(events.projectWindowsChanged.listen(({ payload }) => setOpenWindows(payload.open)));
    return () => bag.dispose();
  }, []);

  // I3 — "프로젝트 전환"은 제자리 교체가 아니라 **그 프로젝트의 탭을 열거나
  // 활성화**하는 것이다. 이 탭의 프로젝트는 끝까지 바뀌지 않는다.
  const switchProject = (id: number) => {
    if (id !== projectId) onOpenProject(id);
  };

  // 분리 터미널 창이 이 프로젝트에 떠 있는가 — 창의 존재 여부가 진실이고
  // 백엔드가 알려 준다. 사용자가 그 창을 OS 버튼으로 닫아도 여기로 돌아온다.
  useEffect(() => {
    void commands.listTerminalWindows().then((res) => {
      if (res.status === "ok" && projectId != null) {
        setTerminalDetached(res.data.includes(projectId));
      }
    });
    const bag = createUnlistenBag();
    bag.add(
      events.terminalWindowsChanged.listen(({ payload }) => {
        if (projectId != null) setTerminalDetached(payload.open.includes(projectId));
      }),
    );
    return () => bag.dispose();
  }, [projectId, setTerminalDetached]);

  // v2.3.0 메뉴바 팝오버 딥링크 (docs/menubar/00-master-plan.md D5) — 트레이
  // 창이 tray_open_main 으로 쏜 TrayNavigate 를 받아 화면·프로젝트·일지로
  // 이동한다. 다른 프로젝트의 일지면 전환 후 open 핸드오프를 세팅 — 저널
  // 화면이 mount 후 경로로 해소하므로 전환 타이밍과 무관하게 동작한다.
  //
  // 나머지 이동 요청은 `useShellNav` 로 나갔는데 이 구독만 남았다: 새 파일이
  // `events` 를 직접 부르면 `lint:bindings` 가 막고, 이 이벤트를 접는 `@/api/*`
  // 래퍼가 아직 없다 ({#big-files-watch} 의 이월).
  useEffect(() => {
    const un = events.trayNavigate.listen(({ payload }) => {
      // 백엔드가 대상 창을 지정해 쏘지만(T5), 라벨이 어긋난 페이로드가 남의
      // 일지로 창을 끌고 가지 못하도록 여기서도 한 번 더 확인한다.
      if (payload.project_id != null && payload.project_id !== projectId) return;
      if (payload.entry_path) {
        setJournalReturnView(null);
        setJournalOpenEntry(payload.entry_path);
        setUiV2View("journal");
        return;
      }
      setUiV2View(
        KNOWN_VIEWS.includes(payload.view) ? (payload.view as UiV2View) : "today",
      );
    });
    return () => {
      safeUnlistenPromise(un);
    };
  }, [projectId, setUiV2View, setJournalOpenEntry, setJournalReturnView]);

  // 도크 소유권 (2026-08-15): 같은 PTY 에 xterm 두 개가 붙으면 서로의 fit() 을
  // 되돌려 화면이 떨린다. 그래서 터미널을 **그리는** 면은 언제나 하나다 —
  // 분리 창 > 터미널 화면 > 도크 순으로 양보한다.
  //
  // 도크 자체는 분리 중에도 열려 있다: 자리표시자가 "어디로 갔는지 + 되돌리는
  // 길"을 들고 있어야 하기 때문이다 (TerminalAway).
  const detached = runtime.terminalDetached;
  const dockVisible = projectId != null && prefs.terminalDockOpen && view !== "terminal";

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
    setPrefs(() => ({ diffActivePath: entry.relative_path }));
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
        openWindows={openWindows}
        isDark={isDark}
        onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
        macTopInset={0}
        terminalDockOpen={prefs.terminalDockOpen}
        onToggleTerminalDock={() =>
          setPrefs((prev) => ({ terminalDockOpen: !prev.terminalDockOpen }))
        }
        onToggleCollapse={toggleSidebar}
        collapsed={collapsed}
        onMouseLeave={collapsed ? () => setHovering(false) : undefined}
      />
      <main className="content">
        <div className={"content-body" + (dockVisible ? ` with-dock dock-${prefs.terminalDockPos}` : "")}>
        {dockVisible && projectId != null && prefs.terminalDockPos === "left" ? (
          <Suspense fallback={<div className="term-dock pos-left" style={{ width: prefs.terminalDockWidth }} />}>
            <TerminalDock projectId={projectId} projectRoot={projectRoot} />
          </Suspense>
        ) : null}
        <div className="content-main">
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
        {/* 화면 단위 렌더 경계 (2026-09-04).
            경계가 탭 층(`TabbedWindow`)에만 있어서, 화면 16개 중 하나가 렌더
            중 throw 하면 **프로젝트 탭 전체**가 대체 UI 로 바뀌었다 — 사이드바도
            탈출로도 함께 사라져 탭을 닫는 것 말고 길이 없었다. 여기서 잡으면
            사이드바는 살아 있고 다른 화면으로 걸어 나갈 수 있다.

            `key={view}` — 경계는 화면을 바꿔도 스스로 리셋되지 않는다. 키가
            없으면 한 번 깨진 뒤 다른 화면에 갔다 돌아와도 계속 깨진 채로
            보인다 (모든 갈래가 서로 다른 컴포넌트 타입이라 어차피 재마운트가
            일어나므로, 키를 붙여도 새로 잃는 상태는 없다). */}
        <ErrorBoundary key={view} label={`screen:${view}`}>
        {view === "settings" ? (
          // Unified settings (dogfooding 2026-06-15): the in-project ⌘, screen now
          // renders the SAME comprehensive SettingsPanel as the project-picker, so
          // both entry points are identical. Per-project rows read the active
          // project from WorkspaceContext and self-disable when none is selected.
          <>
            <Toolbar title={t("shell.settings.title")} sub={t("shell.settings.sub")} />
            <div className="scroll">
              <div className="page fade-in">
                {/* 오버레이 진입점과 같은 경계 — 설정 탭 하나의 예외가 셸
                    전체를 언마운트하지 못하게 한다 (SettingsOverlay 참고). */}
                <ErrorBoundary label="settings">
                  <SettingsPanel embedded />
                </ErrorBoundary>
              </div>
            </div>
          </>
        ) : projectId == null ? (
          <>
            <Toolbar title={view === "today" ? t("nav.today") : t("nav.journal")} />
            <div className="scroll">
              <div className="page fade-in">
                <EmptyState>{t("shell.selectProjectFirst")}</EmptyState>
              </div>
            </div>
          </>
        ) : view === "journal" ? (
          <JournalScreenV2
            active={active}
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
          <RetroScreenV2 projectId={projectId} onNavigate={setUiV2View} />
        ) : view === "search" ? (
          <SearchScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            onOpenInCode={openInCode}
          />
        ) : view === "code" ? (
          <CodeScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            openTarget={codeTarget}
            onOpenTargetConsumed={clearCodeTarget}
          />
        ) : view === "terminal" ? (
          // 터미널이 분리 창에 나가 있으면 여기서 또 그리지 않는다 — 같은 PTY
          // 를 두 뷰가 잡으면 리사이즈가 서로를 되돌린다. 되돌리는 길만 남긴다.
          detached ? (
            <>
              <Toolbar title={t("term.title")} sub={t("term.dock.awayTitle")} />
              <div className="scroll">
                <div className="page fade-in">
                  <TerminalAway projectId={projectId} />
                </div>
              </div>
            </>
          ) : (
            <TerminalScreenV2 projectRoot={projectRoot} />
          )
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
          <GraphScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            onOpenInCode={openInCode}
          />
        ) : view === "skills" ? (
          <SkillsScreenV2 projectId={projectId} active={active} />
        ) : view === "sessions" ? (
          <SessionsScreenV2 projectId={projectId} />
        ) : view === "branch" ? (
          <BranchScreenV2
            projectId={projectId}
            active={active}
            onOpenJournal={(path) => {
              setJournalReturnView("branch");
              setJournalOpenEntry(path);
              setUiV2View("journal");
            }}
            onOpenFile={(path) => openInCode(path, null)}
          />
        ) : (
          // 사슬의 **마지막 갈래가 Today** 다 (2026-09-06). 예전엔 `null` 이라,
          // `view` 가 어떤 갈래에도 안 맞으면 툴바도 콘텐츠도 없는 빈 본문이
          // 남았다 — 화면 id 를 하나 없애는 순간 그 화면에 머물던 사용자가
          // 곧장 그 상태였다. `migrateUiV2View` 가 영속값을 이미 거르지만
          // 런타임 `setUiV2View` 는 그 문을 지나지 않으므로 여기도 막는다.
          // (Today 갈래를 위로 다시 올리지 말 것 — 폴백과 한 몸이다.)
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
        )}
        </ErrorBoundary>

        {/* Claude Code 만 **언마운트하지 않는다** (2026-08-16).
            다른 화면으로 옮기면 화면이 헐리면서 돌던 턴의 스트림이 끊기고,
            돌아올 때 `session/load` 로 디스크에서 다시 읽으므로 아직 안 끝난
            답이 통째로 사라졌다 — 대화에는 "[Request interrupted by user]" 만
            남았다. 다른 화면들은 상태가 디스크에 있어 다시 읽으면 그만이지만
            여기는 **지금 벌어지는 일**이라 다시 읽을 원본이 없다.

            처음 들어가기 전에는 마운트하지 않는다 — 안 쓰는 사용자에게 어댑터
            기동(`acp_start`) 비용을 지우지 않는다. `display:contents` 라 화면이
            직접 그린 것과 레이아웃이 같고, 숨길 때의 `none` 은 ⌘W·ESC 사슬이
            "안 보인다"를 판정하는 잣대와도 맞물린다. */}
        {claudeMounted && projectId != null ? (
          <div
            className="screen-keepalive"
            style={{ display: view === "claudecode" ? "contents" : "none" }}
          >
            {/* 살려 두는 화면이라 위 경계 밖이다 (`key={view}` 가 닿으면
                화면을 바꿀 때마다 재마운트되어 돌던 턴이 끊긴다). 자기 경계를
                따로 둔다 — 키 없이. */}
            <ErrorBoundary label="screen:claudecode">
              <ClaudeCodeScreenV2 projectId={projectId} />
            </ErrorBoundary>
          </div>
        ) : null}
        {codexMounted && projectId != null ? (
          <div
            className="screen-keepalive"
            style={{ display: view === "codex" ? "contents" : "none" }}
          >
            <ErrorBoundary label="screen:codex">
              <CodexScreenV2 projectId={projectId} />
            </ErrorBoundary>
          </div>
        ) : null}
        </Suspense>
        </div>
        {dockVisible && projectId != null && prefs.terminalDockPos !== "left" ? (
          // 아래·오른쪽은 둘 다 콘텐츠 **뒤**에 온다 — 방향은 CSS 가 정한다
          // (dock-bottom = column, dock-right = row). DOM 순서가 화면 순서와
          // 같아야 탭 이동도 눈에 보이는 차례대로 간다.
          <Suspense
            fallback={
              <div
                className={"term-dock pos-" + prefs.terminalDockPos}
                style={
                  prefs.terminalDockPos === "bottom"
                    ? { height: prefs.terminalDockHeight }
                    : { width: prefs.terminalDockWidth }
                }
              />
            }
          >
            <TerminalDock projectId={projectId} projectRoot={projectRoot} />
          </Suspense>
        ) : null}
        </div>
      </main>
    </div>
  );
}

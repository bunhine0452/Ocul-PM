import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { holdManualEntryRequest, onManualEntryRequest } from "@/lib/journalCompose";
import { onOpenSettingsRequest } from "@/lib/settingsNav";
import { consumeEntryJump, onEntryJump } from "@/lib/entryJump";
import { holdAgentContextIntent, onAgentContextRequest } from "@/lib/agentContextNav";
import { createUnlistenBag, safeUnlistenPromise } from "@/lib/unlisten";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useProjectRuntime, useUiPrefs, UI_V2_VIEWS, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { useTheme } from "@/lib/theme";
import { useT } from "@/i18n";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { TerminalAway } from "@/features/terminal/TerminalAway";
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
const ClaudeCodeScreenV2 = lazy(() =>
  import("@/features/chat/ClaudeCodeScreenV2").then((m) => ({ default: m.ClaudeCodeScreenV2 })),
);
const CodexScreenV2 = lazy(() =>
  import("@/features/chat/CodexScreenV2").then((m) => ({ default: m.CodexScreenV2 })),
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
const SkillsScreenV2 = lazy(() =>
  import("@/features/skills/SkillsScreenV2").then((m) => ({ default: m.SkillsScreenV2 })),
);
const SettingsPanel = lazy(() =>
  import("@/features/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
// 코드 화면 (docs/code-editor/00-master-plan.md) — CodeMirror 를 통째로 실은
// 청크라 lazy 가 필수다. 안 여는 사용자에게 에디터 비용을 지우지 않는다.
const CodeScreenV2 = lazy(() =>
  import("@/features/code/CodeScreenV2").then((m) => ({ default: m.CodeScreenV2 })),
);
// 세션 화면 (2026-09-04) — 협업하는 프로젝트에서만 여는 곳이라 지연 청크다.
const SessionsScreenV2 = lazy(() =>
  import("@/features/sessions/SessionsScreenV2").then((m) => ({ default: m.SessionsScreenV2 })),
);
// 브랜치의 이야기 (v3-surface {#branch-story-view}) — 다른 축으로 다시 읽는
// 곳이라 코어 루프와 달리 지연 청크다.
const BranchScreenV2 = lazy(() =>
  import("@/features/branch/BranchScreenV2").then((m) => ({ default: m.BranchScreenV2 })),
);
// 터미널 도크 (2026-08-15) — 열어야 청크를 받는다. 안 여는 사용자에게 xterm
// 비용을 지우지 않는 것은 터미널 화면과 같은 원칙이다.
const TerminalDock = lazy(() =>
  import("@/features/terminal/TerminalDock").then((m) => ({ default: m.TerminalDock })),
);
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

/**
 * 트레이 딥링크·URL 이 실어 오는 화면 이름의 허용 목록.
 *
 * 손으로 적은 두 번째 사본이었다 (2026-09-06). 이제 영속값을 거르는 목록과
 * **같은 배열**(`UI_V2_VIEWS`)을 쓴다 — 화면을 하나 없앨 때 한 곳만 고치면
 * 딥링크와 저장된 값이 함께 따라온다.
 */
const KNOWN_VIEWS: readonly string[] = UI_V2_VIEWS;

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

  // 터미널 「일지로 남기기」·팔레트 「수동 일지」 는 일지 화면이 마운트돼 있을 때만
  // 들렸다 — 다른 화면(터미널 ⌘0, 도크 위)에서 누르면 무반응처럼 보이고 일지
  // 화면에 가야 뒤늦게 모달이 떴다 (2026-08-30 감사). 여기서 요청을 붙들어 두고
  // 일지 화면으로 옮긴다; 일지 화면이 이미 떠 있으면 그쪽 구독이 먼저 소비한다.
  // 비활성 탭은 아예 구독하지 않는다 (`active`) — 크롬식 탭에선 숨은 탭도
  // 마운트된 채라, 창 전역 슬롯을 그대로 들으면 A 탭에서 누른 「일지로
  // 남기기」가 B 탭까지 일지 화면으로 옮기고 B 프로젝트에 A 의 내용을 적는다.
  // 아래 `NAV_BUS.openEntity` 가 이미 같은 이유로 `active` 를 본다.
  useEffect(() => {
    if (!active) return;
    return onManualEntryRequest((seed) => {
      if (view === "journal") return;
      holdManualEntryRequest(seed);
      setUiV2View("journal");
    });
  }, [active, view, setUiV2View]);

  // 설정 딥링크(`openSettings(tab)`) — 안내 문구의 "설정 → 어디" 를 버튼으로
  // 바꾸는 쪽 절반. 패널이 탭을 고르고, 셸은 화면만 옮긴다.
  // 활성 탭만 — 게이트가 없으면 `openSettings(tab)` 한 번이 **모든** 탭을 설정
  // 화면으로 옮기고, `uiV2View` 는 프로젝트별로 영속되므로 나중에 B 탭에 돌아온
  // 사용자는 떠났던 화면 대신 설정을 만난다.
  useEffect(() => {
    if (!active) return;
    return onOpenSettingsRequest(() => setUiV2View("settings"));
  }, [active, setUiV2View]);

  // AD-4 — 일지·diff·터미널·팔레트에서 온 "규칙/스킬로" 요청. 화면이 이미 떠
  // 있으면 그쪽 구독이 먼저 소비하고, 아니면 여기서 붙들어 두고 옮긴다.
  useEffect(() => {
    if (!active) return;
    return onAgentContextRequest((intent) => {
      if (view === "skills") return;
      holdAgentContextIntent(intent);
      setUiV2View("skills");
    });
  }, [active, view, setUiV2View]);

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

  // One-shot focus handoff: Today's MiniEntry → 작업 일지 ring-highlight. Kept
  // as shell-local ephemeral state (focus is not persisted; it's a single
  // event, mirroring the diffActivePath one-shot handoff in DiffScreenV2).
  const [journalFocus, setJournalFocus] = useState<string | null>(null);

  // 검색·코드맵 → 코드 화면 열기 목표 (one-shot, journalFocus 와 같은 패턴).
  // nonce 로 같은 파일·같은 라인의 연속 점프도 구분한다.
  const [codeTarget, setCodeTarget] = useState<
    { path: string; line: number | null; nonce: number } | null
  >(null);
  const openInCode = useCallback(
    (path: string, line: number | null) => {
      setCodeTarget((prev) => ({ path, line, nonce: (prev?.nonce ?? 0) + 1 }));
      setUiV2View("code");
    },
    [setUiV2View],
  );
  const clearCodeTarget = useCallback(() => setCodeTarget(null), []);

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
    if (!active) return;
    const onOpenEntity = (e: Event) => {
      const detail = (e as CustomEvent<OpenEntityDetail>).detail;
      if (!detail?.kind || !detail?.id) return;
      if (detail.kind === "journal") {
        setJournalReturnView(null);
        setJournalOpenEntry(detail.id);
        setUiV2View("journal");
      } else if (detail.kind === "plan" || detail.kind === "plan_item") {
        const planId = detail.id.split("#")[0];
        setPrefs(() => ({ plannerPlanId: planId }));
        setJumpNonce((n) => n + 1);
        setUiV2View("planner");
      } else if (detail.kind === "discussion") {
        setPrefs(() => ({ discussionActiveId: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("discussion");
      } else if (detail.kind === "doc") {
        setPrefs(() => ({ docsActivePath: detail.id }));
        setJumpNonce((n) => n + 1);
        setUiV2View("docs");
      } else if (detail.kind === "code") {
        // 워크스페이스 심볼(⌘K) — 코드 화면의 기존 열기 핸드오프를 그대로 탄다.
        // LSP 는 0-based, jumpLine 은 1-based.
        openInCode(detail.id, detail.line == null ? null : detail.line + 1);
      }
    };
    window.addEventListener(NAV_BUS.openEntity, onOpenEntity);
    return () => window.removeEventListener(NAV_BUS.openEntity, onOpenEntity);
  }, [setPrefs, setUiV2View, openInCode, active]);

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the native
  // traffic lights float over the top-left. With the legacy TitleBar gone in
  // ui_v2, the sidebar must reserve a top strip so the brand clears them.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const projectId = runtime.currentProjectId;
  const workday = runtime.workdayKey ?? runtime.oculpmStatus?.current_workday ?? null;
  const oculpmReady = runtime.oculpmStatus?.initialized === true;

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

  // 도크 소유권 (2026-08-15): 같은 PTY 에 xterm 두 개가 붙으면 서로의 fit() 을
  // 되돌려 화면이 떨린다. 그래서 터미널을 **그리는** 면은 언제나 하나다 —
  // 분리 창 > 터미널 화면 > 도크 순으로 양보한다.
  //
  // 도크 자체는 분리 중에도 열려 있다: 자리표시자가 "어디로 갔는지 + 되돌리는
  // 길"을 들고 있어야 하기 때문이다 (TerminalAway).
  const detached = runtime.terminalDetached;
  const dockVisible = projectId != null && prefs.terminalDockOpen && view !== "terminal";

  // 트레이 딥링크로 갓 열린 창 — URL 이 실어 온 목적지를 mount 시 1회 적용한다
  // (새 창의 프런트는 아직 리스너를 달기 전이라 emit 을 받을 수 없다).
  useEffect(() => {
    if (!active) return;
    if (initialEntryPath) {
      setJournalReturnView(null);
      setJournalOpenEntry(initialEntryPath);
      setUiV2View("journal");
      return;
    }
    if (initialView && KNOWN_VIEWS.includes(initialView)) {
      setUiV2View(initialView as UiV2View);
    }
    // 최초 1회 — 이후 사용자의 화면 이동을 되돌리면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 메인 화면 "오늘의 흐름" → 그 일지 항목 (`lib/entryJump`).
  //
  // `active` 로 막지 않는다 — 시작 탭이 승격하거나 숨은 탭이 활성화되는 것은
  // 이 effect 가 도는 **뒤**라, 활성 여부로 걸면 정작 목적지 탭이 요청을 흘린다.
  // 대신 프로젝트 id 로 거른다: 한 창의 모든 탭이 같은 버스를 듣기 때문이다.
  useEffect(() => {
    if (projectId == null) return;
    const open = (path: string) => {
      setJournalReturnView(null);
      setJournalOpenEntry(path);
      setUiV2View("journal");
    };
    const pending = consumeEntryJump(projectId);
    if (pending) open(pending);
    return onEntryJump(projectId, open);
  }, [projectId, setUiV2View]);

  // v2.3.0 메뉴바 팝오버 딥링크 (docs/menubar/00-master-plan.md D5) — 트레이
  // 창이 tray_open_main 으로 쏜 TrayNavigate 를 받아 화면·프로젝트·일지로
  // 이동한다. 다른 프로젝트의 일지면 전환 후 open 핸드오프를 세팅 — 저널
  // 화면이 mount 후 경로로 해소하므로 전환 타이밍과 무관하게 동작한다.
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
  }, [projectId, setUiV2View]);
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
                <div className="empty-hint">{t("shell.selectProjectFirst")}</div>
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

/**
 * 앱 창 — 크롬식 탭 (01b-chrome-tabs.md §3).
 *
 * 창 하나가 탭 여러 개를 물고, 활성 탭만 보인다. 탭은 두 종류다.
 *  - **시작 탭** — 프로젝트 메인 화면. 여기서 프로젝트를 고르면 제자리 승격.
 *  - **프로젝트 탭** — 그 프로젝트의 전체 셸.
 *
 * 한 번이라도 연 탭은 언마운트하지 않는다 — Chrome 처럼 백그라운드에서
 * watcher·PTY·AI 응답이 계속 돈다. 탭 집합의 SSOT 는 백엔드 레지스트리다
 * (전역 유일성·PTY 정리·떼어내기를 창을 가로질러 심판해야 하므로).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, events, type Project, type TabInfo } from "@/lib/bindings";

import { BootSplash } from "@/components/BootSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { EmbeddingModelBanner } from "@/components/EmbeddingModelBanner";
import { TabStrip, type IncomingTab, type WindowChoice } from "@/features/shell/TabStrip";
import ProjectTab from "@/windows/ProjectTab";
import StartTab from "@/windows/StartTab";

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";
import { safeUnlisten } from "@/lib/unlisten";
import { runCloseIntent } from "@/lib/closeIntent";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";

import "@/App.css";
// 탭 스트립·창 셸 CSS — **모든** 창에 필요하므로 ShellV2 의 lazy 청크가 아니라
// 여기서 직접 가져온다 (styles/tabs.css 상단 주석 참고).
import "@/styles/tabs.css";

export interface TabbedWindowProps {
  windowLabel: string;
  initialView?: string | null;
  initialEntryPath?: string | null;
}

export default function TabbedWindow({
  windowLabel,
  initialView = null,
  initialEntryPath = null,
}: TabbedWindowProps) {
  const { t } = useT();
  const { settings } = useSettings();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openProjects, setOpenProjects] = useState<number[]>([]);
  /** 세션이 도는 프로젝트 — 탭에 활동 점을 찍는다. */
  const [busyProjects, setBusyProjects] = useState<Set<number>>(new Set());
  /** 탭이 한 번이라도 활성이었나 — 처음 열릴 때까지 마운트를 미룬다. */
  const [everActive, setEverActive] = useState<Set<number>>(new Set());
  /**
   * 트레이 딥링크는 **창에 한 번** 배달된다. 탭마다 넘기면, 나중에 이 창에서
   * 다른 프로젝트를 열었을 때 그 탭도 같은 목적지로 점프해 버린다 (URL 은
   * 창 수명 내내 그대로라 자연히 재사용되는 함정).
   */
  const [deepLink, setDeepLink] = useState<{ view: string | null; entry: string | null } | null>(
    initialView || initialEntryPath ? { view: initialView, entry: initialEntryPath } : null,
  );

  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  useEffect(() => {
    installConsoleBridge();
    oculpmLog.flow("App window mounted", { windowLabel });
  }, [windowLabel]);

  // 탭 구성 — 마운트 시 1회 조회하고 이후는 이벤트로 미러링한다. 이벤트가
  // 이름까지 실어 오므로 후속 조회가 필요 없다.
  const refreshTabs = useCallback(async () => {
    const res = await commands.getWindowTabs(windowLabel);
    if (res.status !== "ok") return;
    setTabs(res.data.tabs);
    setActiveId(res.data.active);
  }, [windowLabel]);

  useEffect(() => {
    void refreshTabs();
    let off: (() => void) | undefined;
    void events.windowTabsChanged
      .listen(({ payload }) => {
        // 이벤트는 창을 지정해 오지만, 라벨이 어긋난 페이로드가 남의 탭 구성을
        // 이 창에 밀어넣지 못하게 한 번 더 확인한다.
        if (payload.window !== windowLabel) return;
        setTabs(payload.tabs);
        setActiveId(payload.active);
      })
      .then((fn) => {
        off = fn;
      });
    return () => {
      if (off) safeUnlisten(off);
    };
  }, [windowLabel, refreshTabs]);

  /**
   * 탭 닫기는 **조용히 실패하면 안 된다** (2026-08-29).
   *
   * 이 자리만 이웃(`onDetach`·`onOpenProject`)과 달리 결과 봉투를 버리고 있었다.
   * 그런데 닫기가 실패하는 모양은 하필 "탭은 사라졌는데 창이 남는다" 라서,
   * 화면에는 아무 말도 없이 **닫기 버튼이 안 먹는 것처럼** 보인다.
   */
  const closeTab = useCallback(
    (id: number) => {
      void commands.closeTab(id).then((r) => {
        if (r.status === "error") toast.destructive(t("project.closeTabFailed", { error: r.error }));
      });
    },
    [t],
  );

  /**
   * ⌘W — **안쪽부터** 닫는다.
   *
   * Rust 는 더 이상 직접 닫지 않고 이 이벤트만 보낸다. 화면 안에 또 닫을 것이
   * 있을 수 있어서다(Claude Code 의 세션 탭). 아무도 안 받으면 그때 탭을 닫고,
   * 마지막 탭이면 `close_tab` 이 빈 창을 스스로 닫는다 (Chrome 과 같다).
   */
  useEffect(() => {
    let off: (() => void) | undefined;
    void events.closeIntent
      .listen(({ payload }) => {
        if (payload.window !== windowLabel) return;
        if (runCloseIntent()) return;
        if (payload.tab != null) closeTab(payload.tab);
      })
      .then((fn) => {
        off = fn;
      });
    return () => {
      if (off) safeUnlisten(off);
    };
  }, [windowLabel, closeTab]);

  // 어디든 열려 있는 프로젝트 — 시작 탭의 "열림" 배지 + `+` 팝오버 필터.
  useEffect(() => {
    void commands.listOpenProjectIds().then((res) => {
      if (res.status === "ok") setOpenProjects(res.data);
    });
    let off: (() => void) | undefined;
    void events.projectWindowsChanged
      .listen(({ payload }) => setOpenProjects(payload.open))
      .then((fn) => {
        off = fn;
      });
    return () => {
      if (off) safeUnlisten(off);
    };
  }, []);

  // 세션 활동 점 — 백그라운드 탭에서 에이전트가 돌고 있다는 유일한 신호다
  // (탭이 숨어 있으면 화면으로는 알 수 없다).
  useEffect(() => {
    const offs: Array<() => void> = [];
    const mark = (projectId: number, on: boolean) =>
      setBusyProjects((prev) => {
        if (prev.has(projectId) === on) return prev;
        const next = new Set(prev);
        if (on) next.add(projectId);
        else next.delete(projectId);
        return next;
      });
    void events.oculpmSessionStarted
      .listen(({ payload }) => mark(payload.project_id, true))
      .then((fn) => offs.push(fn));
    void events.oculpmSessionEnded
      .listen(({ payload }) => mark(payload.project_id, false))
      .then((fn) => offs.push(fn));
    return () => offs.forEach(safeUnlisten);
  }, []);

  // 창 제목 = 활성 탭 이름 (macOS 창 전환기·Mission Control 구분용).
  useEffect(() => {
    const active = tabs.find((tb) => tb.tab_id === activeId);
    document.title = active?.name || "Ocul-PM";
  }, [tabs, activeId]);

  useEffect(() => {
    if (activeId == null) return;
    setEverActive((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
  }, [activeId]);

  useEffect(() => {
    void commands.listProjects().then((res) => {
      if (res.status === "ok") setProjects(res.data);
    });
  }, [tabs.length, openProjects.length]);

  const fail = useCallback(
    (error: string) => toast.destructive(t("project.openWindowFailed", { error })),
    [t],
  );

  const activate = useCallback((tabId: number) => {
    // 낙관적 전환 — 이벤트 왕복을 기다리면 탭 클릭이 굼떠 보인다.
    setActiveId(tabId);
    void commands.activateTab(tabId);
  }, []);

  const newTab = useCallback(() => {
    void commands.newStartTab(windowLabel).then((r) => {
      if (r.status === "error") fail(r.error);
    });
  }, [windowLabel, fail]);

  // 탭 순환 — ⌘번호는 화면 전환이 이미 쓰고 있으므로(⌘1~⌘0) 탭은 브라우저의
  // 다른 관습을 쓴다: ⌃Tab / ⌃⇧Tab, ⌘⌥←→.
  //
  // ⌘T(새 탭)·⌘W(탭 닫기)·⇧⌘W(창 닫기)는 **앱 메뉴가 소유**한다 (src-tauri/
  // src/menu.rs). macOS 는 메뉴 액셀러레이터를 웹뷰보다 먼저 소비하므로 여기서
  // 또 처리하면 탭이 두 개 열린다.
  const tabsRef = useRef<TabInfo[]>(tabs);
  const activeRef = useRef<number | null>(activeId);
  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = activeId;
  }, [tabs, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let step = 0;
      if (e.ctrlKey && e.key === "Tab") step = e.shiftKey ? -1 : 1;
      else if (e.metaKey && e.altKey && e.key === "ArrowRight") step = 1;
      else if (e.metaKey && e.altKey && e.key === "ArrowLeft") step = -1;
      if (step === 0) return;

      const list = tabsRef.current;
      if (list.length < 2) return;
      e.preventDefault();
      const i = list.findIndex((tb) => tb.tab_id === activeRef.current);
      const next = list[((i < 0 ? 0 : i) + step + list.length) % list.length];
      activate(next.tab_id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activate, newTab]);

  // ── 창 간 탭 드래그 (다시 붙이기) ──────────────────────────────────────
  //
  // 이 창은 두 역할을 **동시에** 한다: 탭을 내보내는 쪽(hover/drop 을 백엔드에
  // 물어본다)이자 받는 쪽(`TabDragOver` 를 듣고 캐럿을 그린다). 창 하나에 두
  // 배선이 다 필요한 이유는 어느 창이 어느 역할일지 미리 알 수 없어서다.

  /** 받는 쪽 — 끌려온 커서의 창 안쪽 x (CSS px). null = 지금은 없다. */
  const [incomingX, setIncomingX] = useState<number | null>(null);
  /**
   * 끌려오는 탭의 겉모습. 백엔드는 스트립에 **처음 들어선** 프레임에만 실어
   * 보내므로(매 move 마다 DB 를 때리지 않으려고) 받은 것을 `TabDragLeave` 까지
   * 들고 있는다.
   */
  const [incoming, setIncoming] = useState<IncomingTab | null>(null);
  /** 내보내는 쪽 — 지금 겨누는 다른 창이 있다 (스트립을 흐리게 그린다). */
  const [handingOff, setHandingOff] = useState(false);
  /**
   * 웹뷰 줌. 화면·창 기하는 **논리 px**, `getBoundingClientRect` 는 **CSS px** 라
   * 둘을 오갈 때 이 값으로 곱하고 나눈다. 줌은 앱 전역 설정(SQLite)이라 두 창이
   * 늘 같은 값을 본다 — 그래서 보내는 쪽이 잰 스트립 높이를 받는 쪽에 그대로
   * 쓸 수 있다.
   */
  const zoom = Math.min(1.6, Math.max(0.7, settings.uiScale || 1));

  useEffect(() => {
    const offs: Array<() => void> = [];
    void events.tabDragOver
      .listen(({ payload }) => {
        if (payload.window !== windowLabel) return;
        // `f64` 는 바인딩에서 nullable 로 나온다 (NaN 표현 때문) — 방어한다.
        setIncomingX(payload.x == null ? null : payload.x / zoom);
        if (payload.preview) {
          const p = payload.preview;
          setIncoming({
            name: p.name,
            icon: p.icon,
            color: p.color,
            isStart: p.is_start,
          });
        }
      })
      .then((fn) => offs.push(fn));
    void events.tabDragLeave
      .listen(({ payload }) => {
        if (payload.window !== windowLabel) return;
        setIncomingX(null);
        setIncoming(null);
      })
      .then((fn) => offs.push(fn));
    return () => offs.forEach(safeUnlisten);
  }, [windowLabel, zoom]);

  /**
   * 겨누기 질의는 **한 번에 하나만** 띄운다. 포인터는 초당 수십 번 움직이는데
   * 그때마다 IPC 를 걸면 왕복이 밀려 캐럿이 커서를 못 따라온다 — 답이 온 뒤
   * 다음 것을 보내면 항상 최신 위치 한 건만 흐른다.
   */
  const hoverBusy = useRef(false);
  // 콜백은 리스너 재등록을 피하려고 줌을 ref 로 읽는다 (값은 매 렌더 최신).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const askDropTarget = useCallback((tabId: number, stripHeight: number) => {
    if (hoverBusy.current) return;
    hoverBusy.current = true;
    void commands
      .tabDragOver(tabId, stripHeight * zoomRef.current)
      .then((r) => setHandingOff(r.status === "ok" && r.data != null))
      .catch(() => setHandingOff(false))
      .finally(() => {
        hoverBusy.current = false;
      });
  }, []);

  const endDrag = useCallback(() => {
    setHandingOff(false);
    void commands.tabDragEnd();
  }, []);

  const dropOnOtherWindow = useCallback(async (tabId: number) => {
    setHandingOff(false);
    const res = await commands.attachTab(tabId);
    return res.status === "ok" && res.data;
  }, []);

  /**
   * 탭 메뉴가 그릴 **다른 창** 목록.
   *
   * 열 때마다 새로 읽는다 — 다른 창이 새로 뜨는 것은 이 창에 이벤트로 오지
   * 않는다 (`WindowTabsChanged` 는 창별로만 배달되고, 시작 탭만 있는 창은
   * 열린 프로젝트 집합도 안 바꾼다). 이벤트를 늘리는 대신 메뉴가 열리는
   * 그 한 번만 물어보는 쪽이 싸고 항상 옳다.
   */
  const [windowChoices, setWindowChoices] = useState<WindowChoice[]>([]);
  const refreshWindows = useCallback(async () => {
    const res = await commands.listAppWindows();
    if (res.status !== "ok") return;
    const byId = new Map(projects.map((p) => [p.id, p.name]));
    setWindowChoices(
      res.data
        .filter((w) => w.label !== windowLabel)
        .map((w) => ({
          label: w.label,
          // 스트립과 **같은** 이름 규칙 — 시작 탭만 있는 창은 "새 탭" 이다.
          name:
            w.active_project_id == null
              ? t("tabs.startTab")
              : (byId.get(w.active_project_id) ?? `#${w.active_project_id}`),
          tabCount: w.tab_count,
        })),
    );
  }, [windowLabel, projects, t]);

  const closedProjects = useMemo(() => {
    const open = new Set(openProjects);
    return projects.filter((p) => !open.has(p.id));
  }, [projects, openProjects]);

  return (
    <div className="winroot">
      {/* 부트 스플래시 — 창당 1회, 첫 페인트를 브랜드 모션으로 덮는다. */}
      <BootSplash />
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        isMac={isMac}
        busyProjects={busyProjects}
        closedProjects={closedProjects}
        onActivate={activate}
        onClose={closeTab}
        onNewTab={newTab}
        onReorder={(order) => {
          setTabs((prev) => {
            const byId = new Map(prev.map((tb) => [tb.tab_id, tb]));
            return order.map((id) => byId.get(id)).filter((tb): tb is TabInfo => tb != null);
          });
          void commands.reorderTabs(windowLabel, order);
        }}
        onDetach={(id, x, y) => {
          // 앵커는 스트립이 CSS px 로 준다 — 창 기하는 논리 px 이므로 줌을 곱해
          // 넘긴다 (`onDragHover` 의 스트립 높이와 같은 규약).
          void commands
            .detachTab(id, x == null ? null : x * zoom, y == null ? null : y * zoom)
            .then((r) => {
              if (r.status === "error") fail(r.error);
            });
        }}
        onOpenProject={(id) => {
          void commands.openProjectTab(id, windowLabel).then((r) => {
            if (r.status === "error") fail(r.error);
          });
        }}
        incomingX={incomingX}
        incoming={incoming}
        onIncomingIndex={(index) => void commands.tabDropHint(windowLabel, index)}
        onDragHover={askDropTarget}
        onDragDrop={dropOnOtherWindow}
        onDragCleanup={endDrag}
        handingOff={handingOff}
        windowChoices={windowChoices}
        onMenuOpen={() => void refreshWindows()}
        onMoveToWindow={(id, target) => {
          void commands.moveTabToWindow(id, target).then((r) => {
            if (r.status === "error") fail(r.error);
          });
        }}
      />

      <div className="tabpanes">
        {tabs.map((tb) => {
          const active = tb.tab_id === activeId;
          // 한 번도 열린 적 없는 탭은 아직 마운트하지 않는다 — 창을 열자마자
          // N개 프로젝트의 init·watcher·자동색인이 동시에 터지지 않게.
          if (!active && !everActive.has(tb.tab_id)) return null;
          return (
            <div
              key={tb.tab_id}
              className="tabpane"
              role="tabpanel"
              id={`tabpanel-t${tb.tab_id}`}
              aria-labelledby={`tab-t${tb.tab_id}`}
              hidden={!active}
            >
              {/* 탭 하나의 예외가 **창 전체**를 언마운트하지 못하게 막는
                  바깥 경계. React 는 경계가 없으면 루트까지 언마운트하므로,
                  경계가 없던 시절엔 한 화면의 버그가 탭 스트립까지 지워
                  재시작 말고는 길이 없었다 (터미널 2026-07-31 · 시작 탭 설정
                  2026-08-16). 여기서 잡히면 다른 탭과 탭 스트립은 멀쩡하다. */}
              <ErrorBoundary label={tb.project_id == null ? "start-tab" : "project-tab"}>
                {tb.project_id == null ? (
                  <StartTab tabId={tb.tab_id} active={active} openProjects={openProjects} />
                ) : (
                  <WorkspaceProvider projectId={tb.project_id}>
                    <ProjectTab
                      projectId={tb.project_id}
                      windowLabel={windowLabel}
                      active={active}
                      projects={projects}
                      initialView={active ? (deepLink?.view ?? null) : null}
                      initialEntryPath={active ? (deepLink?.entry ?? null) : null}
                      onDeepLinkConsumed={() => setDeepLink(null)}
                    />
                  </WorkspaceProvider>
                )}
              </ErrorBoundary>
            </div>
          );
        })}
      </div>

      {/* 창당 하나면 되는 것들 — 탭 루프 밖. */}
      <UpdateBanner />
      <EmbeddingModelBanner />
    </div>
  );
}

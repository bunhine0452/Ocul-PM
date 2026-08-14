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
import { UpdateBanner } from "@/components/UpdateBanner";
import { EmbeddingModelBanner } from "@/components/EmbeddingModelBanner";
import { TabStrip } from "@/features/shell/TabStrip";
import ProjectTab from "@/windows/ProjectTab";
import StartTab from "@/windows/StartTab";

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
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
        if (payload.tab != null) void commands.closeTab(payload.tab);
      })
      .then((fn) => {
        off = fn;
      });
    return () => {
      if (off) safeUnlisten(off);
    };
  }, [windowLabel]);

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
        onClose={(id) => void commands.closeTab(id)}
        onNewTab={newTab}
        onReorder={(order) => {
          setTabs((prev) => {
            const byId = new Map(prev.map((tb) => [tb.tab_id, tb]));
            return order.map((id) => byId.get(id)).filter((tb): tb is TabInfo => tb != null);
          });
          void commands.reorderTabs(windowLabel, order);
        }}
        onDetach={(id, x, y) => {
          void commands.detachTab(id, x, y).then((r) => {
            if (r.status === "error") fail(r.error);
          });
        }}
        onOpenProject={(id) => {
          void commands.openProjectTab(id, windowLabel).then((r) => {
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

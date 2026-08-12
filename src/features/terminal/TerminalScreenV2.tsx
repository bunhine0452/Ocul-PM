import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  SquareTerminal,
  Bot,
  Plus,
  X,
  Search,
  Columns2,
  Rows2,
} from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
// 모듈 t() 는 `formatMatchCount`(순수·테스트 대상) 용, useT() 는 컴포넌트 용.
import { t, useT } from "@/i18n";
import { useSettings } from "@/contexts/SettingsContext";
import { useWorkspace, type TerminalTab } from "@/contexts/WorkspaceContext";
import {
  leaf,
  collectSids,
  firstSid,
  splitPane,
  removePane,
  setRatio,
  siblingSid,
  clampRatio,
  type PaneNode,
  type PaneDir,
} from "@/lib/termPanes";
import { TerminalInstance, type TerminalHandles, type ShellState } from "./TerminalInstance";
import { readSearchDecorations } from "./termTheme";
import { canAutoRename, shellTitleToTabLabel } from "./tabTitle";
import { summarizeShell } from "./shellStatus";
import { useAgentRuns } from "./useAgentRuns";
import { consumePendingDispatch, hasPendingDispatch, peekPendingDispatch } from "./dispatchBus";

// 터미널 화면 — 2026-07-20 대규모 개편 (iTerm2/cmux/Warp 참조).
//  - 세션 지속: PTY 는 화면을 떠나도 살아있고(백엔드 스크롤백 리플레이),
//    탭/페인을 닫을 때만 kill 한다.
//  - 분할 페인: 탭마다 이진 트리 레이아웃(@/lib/termPanes) — ⌘D 가로,
//    ⇧⌘D 세로, 드래그 리사이즈(로컬 오버레이 + pointerup 커밋), 포커스 링.
//  - 탭: 더블클릭 리네임, 호버 닫기, ⌘T/⌘W.
//  - 검색 오버레이(⌘F, addon-search), 글자 크기(⌘+/⌘-/⌘0, 영속),
//    하단 상태바(탭·페인·단축키 힌트·글자크기·.oculpm 감시).

const FONT_MIN = 9;
const FONT_MAX = 22;
const FONT_DEFAULT = 13;

/**
 * PTY 세션 id. 창 소유권을 id 에 새긴다 (멀티 창 T4) — 창을 닫을 때 백엔드가
 * `p<projectId>-` 접두사로 **자기 창의 세션만** 골라 죽여 좀비 셸을 막고, 두
 * 창이 같은 8자 난수를 뽑아 한쪽 입력이 남의 셸로 가는 사고도 구조적으로
 * 불가능해진다. 접두사 규격은 `src-tauri/src/commands/window.rs::pty_prefix_for`
 * 와 짝이다 — 한쪽만 바꾸면 정리가 조용히 실패한다.
 */
function newId(projectId: number | null): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return projectId == null ? rand : `p${projectId}-${rand}`;
}

/**
 * 검색 카운터 표시 — "3/17". 검색어가 없으면 빈 문자열, 일치가 없으면 안내,
 * 결과가 하이라이트 한계를 넘어 활성 인덱스를 못 셀 땐(-1) 총 개수만 보여준다.
 */
export function formatMatchCount(
  query: string,
  matches: { index: number; count: number } | null,
): string {
  if (!query) return "";
  if (!matches) return "";
  if (matches.count === 0) return t("term.matchNone");
  if (matches.index < 0) return t("term.matchCount", { n: matches.count });
  return `${matches.index + 1}/${matches.count}`;
}

function panesOfTab(tab: TerminalTab): PaneNode {
  return tab.panes ?? leaf(tab.id);
}

function focusOfTab(tab: TerminalTab): string {
  const panes = panesOfTab(tab);
  const sids = collectSids(panes);
  return tab.focusSid && sids.includes(tab.focusSid) ? tab.focusSid : firstSid(panes);
}

interface TerminalScreenV2Props {
  projectRoot: string | null;
}

export function TerminalScreenV2({ projectRoot }: TerminalScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { settings } = useSettings();
  const { terminalTabs, terminalActiveId } = state;
  const fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, state.terminalFontSize || FONT_DEFAULT));

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 검색 결과 카운터 "3/17" — SearchAddon.onDidChangeResults 가 채운다.
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  // 드래그 중 비율은 로컬 오버레이로만 그리고 pointerup 에 컨텍스트로 커밋
  // (드래그 매 프레임 전역 상태를 흔들지 않기 위해).
  const [drag, setDrag] = useState<{ tabId: string; path: string; ratio: number } | null>(null);

  // sid → xterm 핸들 (검색/포커스 제어). onReady 로 채워진다.
  const regRef = useRef(new Map<string, TerminalHandles>());

  // sid → 셸 통합 상태(OSC 133). 통합이 설치되지 않은 세션은 여기 안 들어온다.
  const [shellStates, setShellStates] = useState<Record<string, ShellState>>({});

  // IN2 — 플래너 디스패치 프리필: 대기 중 명령을 활성 페인 PTY 에 써 둔다
  // (개행 없음 — 실행은 사용자가 Enter 로). 마운트 1회 루프 + sid 는 ref 로
  // 최신을 읽는다 — 종전엔 deps 재실행(탭 생성·라벨 갱신)이 재시도 체인을
  // 취소한 뒤 이미 consume 된 상태라 프리필이 조용히 증발했다. consume 은
  // 쓰기 **성공 후에만**.
  const dispatchSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasPendingDispatch()) return;
    let disposed = false;
    let tries = 0;
    const tick = () => {
      if (disposed || !hasPendingDispatch()) return;
      const sid = dispatchSidRef.current;
      const cmd = peekPendingDispatch();
      if (!sid || !cmd) {
        if (tries++ < 50) setTimeout(tick, 300);
        return;
      }
      void commands
        .writeToPty(sid, cmd)
        .then((r) => {
          if (r.status === "ok") consumePendingDispatch();
          else if (tries++ < 50) setTimeout(tick, 300);
        })
        .catch(() => {
          if (tries++ < 50) setTimeout(tick, 300);
        });
    };
    tick();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 명령 경계에서 코딩 에이전트 실행을 추적 → 세션 신호 + 일지 제안.
  // 셸 통합이 꺼져 있으면 shellStates 가 비어 있어 자동으로 no-op 이다.
  useAgentRuns(shellStates, state.currentProjectId);

  const activeTab = terminalTabs.find((tab) => tab.id === terminalActiveId) ?? null;
  const paneCount = activeTab ? collectSids(panesOfTab(activeTab)).length : 0;
  dispatchSidRef.current = activeTab ? focusOfTab(activeTab) : null;

  // Ensure at least one tab exists.
  useEffect(() => {
    if (terminalTabs.length === 0) {
      const id = newId(state.currentProjectId);
      const tab: TerminalTab = { id, label: "zsh", shell: "zsh", cwd: projectRoot ?? "" };
      setState((prev) => ({ ...prev, terminalTabs: [tab], terminalActiveId: id }));
    } else if (terminalActiveId == null || !terminalTabs.some((tab) => tab.id === terminalActiveId)) {
      setState((prev) => ({ ...prev, terminalActiveId: terminalTabs[0].id }));
    }
  }, [terminalTabs, terminalActiveId, projectRoot, state.currentProjectId, setState]);

  // 닫힌 세션의 핸들 정리.
  useEffect(() => {
    const alive = new Set(terminalTabs.flatMap((tab) => collectSids(panesOfTab(tab))));
    for (const sid of regRef.current.keys()) {
      if (!alive.has(sid)) regRef.current.delete(sid);
    }
    // 셸 상태도 같이 회수 — 안 그러면 탭을 여닫을 때마다 맵이 무한정 자란다.
    setShellStates((prev) => {
      const stale = Object.keys(prev).filter((sid) => !alive.has(sid));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const sid of stale) delete next[sid];
      return next;
    });
  }, [terminalTabs]);

  const patchTab = (id: string, fn: (tab: TerminalTab) => TerminalTab) =>
    setState((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) => (tab.id === id ? fn(tab) : tab)),
    }));

  const addTab = () => {
    const id = newId(state.currentProjectId);
    const n = terminalTabs.length + 1;
    const tab: TerminalTab = { id, label: `zsh ${n}`, shell: "zsh", cwd: projectRoot ?? "" };
    setState((prev) => ({
      ...prev,
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: id,
    }));
  };

  const closeTab = (id: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === id);
    if (tab) for (const sid of collectSids(panesOfTab(tab))) void commands.killPtySession(sid);
    setState((prev) => {
      const remaining = prev.terminalTabs.filter((tab) => tab.id !== id);
      const nextActive =
        prev.terminalActiveId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : prev.terminalActiveId;
      return { ...prev, terminalTabs: remaining, terminalActiveId: nextActive };
    });
  };

  const selectTab = (id: string) => setState((prev) => ({ ...prev, terminalActiveId: id }));

  const commitRename = () => {
    if (!renaming) return;
    const label = renaming.draft.trim();
    if (label) patchTab(renaming.id, (tab) => ({ ...tab, label }));
    setRenaming(null);
  };

  const splitFocused = (dir: PaneDir) => {
    if (!activeTab) return;
    const sid = focusOfTab(activeTab);
    const newSid = newId(state.currentProjectId);
    patchTab(activeTab.id, (tab) => ({
      ...tab,
      panes: splitPane(panesOfTab(tab), sid, dir, newSid),
      focusSid: newSid,
    }));
  };

  // ⌘W — 분할 중이면 포커스 페인만, 마지막 페인이면 탭을 닫는다.
  const closeFocusedPane = () => {
    if (!activeTab) return;
    const panes = panesOfTab(activeTab);
    const sid = focusOfTab(activeTab);
    if (panes.type === "leaf") {
      closeTab(activeTab.id);
      return;
    }
    const nextFocus = siblingSid(panes, sid);
    void commands.killPtySession(sid);
    patchTab(activeTab.id, (tab) => {
      const next = removePane(panesOfTab(tab), sid);
      return { ...tab, panes: next ?? leaf(tab.id), focusSid: nextFocus ?? undefined };
    });
  };

  const closePane = (sid: string) => {
    if (!activeTab) return;
    const panes = panesOfTab(activeTab);
    if (panes.type === "leaf") {
      closeTab(activeTab.id);
      return;
    }
    const nextFocus = siblingSid(panes, sid);
    void commands.killPtySession(sid);
    patchTab(activeTab.id, (tab) => {
      const next = removePane(panesOfTab(tab), sid);
      return { ...tab, panes: next ?? leaf(tab.id), focusSid: nextFocus ?? undefined };
    });
  };

  const focusPane = (tabId: string, sid: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.focusSid === sid) return;
    patchTab(tabId, (tab) => ({ ...tab, focusSid: sid }));
  };

  const fontDelta = (d: number) =>
    setState((prev) => ({
      ...prev,
      terminalFontSize: Math.min(
        FONT_MAX,
        Math.max(FONT_MIN, (prev.terminalFontSize || FONT_DEFAULT) + d),
      ),
    }));
  const fontReset = () => setState((prev) => ({ ...prev, terminalFontSize: FONT_DEFAULT }));

  const focusedHandles = () =>
    activeTab ? regRef.current.get(focusOfTab(activeTab)) : undefined;

  /** 셸이 알려온 제목으로 탭 이름을 갱신 — 사용자가 직접 지은 이름은 보존. */
  const applyShellTitle = (tabId: string, title: string) => {
    const label = shellTitleToTabLabel(title);
    if (!label) return;
    setState((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) =>
        tab.id === tabId && canAutoRename(tab.label) && tab.label !== label
          ? { ...tab, label }
          : tab,
      ),
    }));
  };

  const openSearch = () => setSearchOpen(true);
  const closeSearch = () => {
    setSearchOpen(false);
    setMatches(null);
    focusedHandles()?.search.clearDecorations();
    focusedHandles()?.term.focus();
  };
  // 하이라이트 색은 테마 토큰에서 매번 새로 읽는다 (테마 전환 즉시 반영).
  const searchOptions = () => ({ decorations: readSearchDecorations() });
  const runSearch = (dirn: "next" | "prev") => {
    const h = focusedHandles();
    if (!h || !query) return;
    if (dirn === "next") h.search.findNext(query, searchOptions());
    else h.search.findPrevious(query, searchOptions());
  };

  /** ⌘K — 스크롤백을 비우고 현재 줄만 남긴다 (Terminal.app 과 동일). */
  const clearScreen = () => {
    const h = focusedHandles();
    if (!h) return;
    h.term.clear();
    h.term.focus();
  };

  // 화면-로컬 단축키 — 핸들러는 ref 로 항상 최신을 읽고 리스너는 1회 등록.
  const actionsRef = useRef({
    addTab,
    closeFocusedPane,
    splitFocused,
    openSearch,
    closeSearch,
    clearScreen,
    fontDelta,
    fontReset,
    searchOpen,
  });
  actionsRef.current = {
    addTab,
    closeFocusedPane,
    splitFocused,
    openSearch,
    closeSearch,
    clearScreen,
    fontDelta,
    fontReset,
    searchOpen,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "t" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          a.addTab();
        } else if (k === "w" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          a.closeFocusedPane();
        } else if (k === "d") {
          e.preventDefault();
          e.stopPropagation();
          a.splitFocused(e.shiftKey ? "col" : "row");
        } else if (k === "f" && !e.shiftKey) {
          e.preventDefault();
          a.openSearch();
        } else if (k === "l" && !e.shiftKey) {
          // ⌘K 는 전역 커맨드 팔레트가 선점하므로(useGlobalShortcuts) ⌘L 을 쓴다.
          // 셸 자체의 Ctrl+L 은 그대로 PTY 로 흘러가 함께 동작한다.
          e.preventDefault();
          e.stopPropagation();
          a.clearScreen();
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          a.fontDelta(1);
        } else if (e.key === "-") {
          e.preventDefault();
          a.fontDelta(-1);
        } else if (e.shiftKey && (e.key === "0" || e.key === ")")) {
          // ⌘0 은 전역 화면 이동(navRegistry 10번째)이 함께 잡아가 눌렀을 때
          // 글자 크기 초기화 + 화면 전환이 동시에 일어났다 → ⇧⌘0 으로 옮긴다.
          e.preventDefault();
          e.stopPropagation();
          a.fontReset();
        }
      } else if (e.key === "Escape" && a.searchOpen) {
        a.closeSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
    path: string,
    dir: PaneDir,
  ) => {
    e.preventDefault();
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const calc = (ev: PointerEvent) =>
      clampRatio(
        dir === "row"
          ? (ev.clientX - rect.left) / Math.max(1, rect.width)
          : (ev.clientY - rect.top) / Math.max(1, rect.height),
      );
    const move = (ev: PointerEvent) => setDrag({ tabId, path, ratio: calc(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const ratio = calc(ev);
      patchTab(tabId, (tab) => ({ ...tab, panes: setRatio(panesOfTab(tab), path, ratio) }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 출력 안의 `src/foo.ts:42` ⌘클릭 → 외부 편집기. 경로는 터미널이 뱉은
  // 신뢰할 수 없는 문자열이므로 백엔드가 secure_join 으로 루트 안쪽인지 다시
  // 판정한다 — 거절당하면 조용히 넘기지 말고 이유를 보여준다.
  const openFileRef = useCallback(
    async (path: string, line: number | null) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(
        projectRoot,
        path,
        settings.externalEditorCommand,
        line,
      );
      if (res.status === "error") toast.destructive(t("term.openEditorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // 포커스된 페인의 셸 통합 상태 — 상태바/툴바 문구가 여기서 나온다.
  const focusedShell = activeTab ? shellStates[focusOfTab(activeTab)] : undefined;
  const shellSummary = focusedShell ? summarizeShell(focusedShell) : null;
  // 2026-07-30 정직성 수정: 예전 문구는 "에이전트 실행을 감지해 자동으로 일지를
  // 작성합니다" 였는데, PTY 쪽에 감지 코드가 한 줄도 없었고 자동 일지 초안도
  // 기본 꺼짐이었다. 이제 실제로 켜져 있을 때만 그렇게 말한다.
  const toolbarSub = focusedShell?.active ? t("term.shellOn") : t("term.shellOff");

  // 감사 fix (2026-07-16): 실제 워처 상태(oculpmStatus.watcher_state) 그대로.
  const watcher = state.oculpmStatus?.watcher_state ?? null;
  const watchLabel =
    watcher === "running"
      ? t("term.watchRunning")
      : watcher === "error"
        ? t("term.watchError")
        : t("term.watchOff");
  const watchColor =
    watcher === "running" ? "#57c98a" : watcher === "error" ? "var(--t-bug)" : "var(--text-3)";

  const renderPane = (tab: TerminalTab, node: PaneNode, path: string): React.ReactNode => {
    const isActiveTab = tab.id === terminalActiveId;
    if (node.type === "leaf") {
      const focusSid = focusOfTab(tab);
      const count = collectSids(panesOfTab(tab)).length;
      const focused = count > 1 && node.sid === focusSid;
      return (
        <div className={"term-pane" + (focused ? " focused" : "")}>
          <TerminalInstance
            sessionId={node.sid}
            cwd={tab.cwd || projectRoot || ""}
            visible={isActiveTab}
            fontSize={fontSize}
            persistent
            autoFocus={node.sid === focusSid}
            onReady={(h) => {
              regRef.current.set(node.sid, h);
              // 결과 수는 포커스된 페인의 것만 표시한다 (검색은 항상 포커스 페인 대상).
              h.search.onDidChangeResults((e) => {
                if (regRef.current.get(node.sid) !== h) return;
                setMatches({ index: e.resultIndex, count: e.resultCount });
              });
            }}
            onFocusIn={() => focusPane(tab.id, node.sid)}
            onTitleChange={(title) => applyShellTitle(tab.id, title)}
            onShellState={(shell) =>
              setShellStates((prev) => (prev[node.sid] === shell ? prev : { ...prev, [node.sid]: shell }))
            }
            onOpenFileRef={projectRoot ? openFileRef : undefined}
          />
          {count > 1 ? (
            <button
              type="button"
              className="pane-close"
              onClick={() => closePane(node.sid)}
              aria-label={t("term.closePane")}
              title={t("term.closePaneHint")}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      );
    }
    const ratio =
      drag && drag.tabId === tab.id && drag.path === path ? drag.ratio : node.ratio;
    return (
      <div className={"term-split " + node.dir}>
        <div className="term-cell" style={{ flexGrow: ratio }}>
          {renderPane(tab, node.a, path + "a")}
        </div>
        <div
          className={"term-divider " + node.dir}
          onPointerDown={(e) => startDrag(e, tab.id, path, node.dir)}
          role="separator"
          aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
        />
        <div className="term-cell" style={{ flexGrow: 1 - ratio }}>
          {renderPane(tab, node.b, path + "b")}
        </div>
      </div>
    );
  };

  return (
    <>
      <Toolbar title={t("term.title")} sub={toolbarSub}>
        <button
          className="btn icon"
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
          title={t("term.searchScrollbackHint")}
          aria-label={t("term.searchScrollback")}
        >
          <Search size={15} />
        </button>
        <button
          className="btn icon"
          onClick={() => splitFocused("row")}
          title={t("term.splitRowHint")}
          aria-label={t("term.splitRow")}
        >
          <Columns2 size={15} />
        </button>
        <button
          className="btn icon"
          onClick={() => splitFocused("col")}
          title={t("term.splitColHint")}
          aria-label={t("term.splitCol")}
        >
          <Rows2 size={15} />
        </button>
        <button className="btn" onClick={addTab}>
          <Plus size={15} /> {t("term.newSession")}
        </button>
      </Toolbar>

      <div className="term-wrap">
        <div className="term-tabs" role="tablist" aria-label={t("term.tablist")}>
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className={"term-tab" + (tab.id === terminalActiveId ? " active" : "")}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => setRenaming({ id: tab.id, draft: tab.label })}
              role="tab"
              aria-selected={tab.id === terminalActiveId}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectTab(tab.id);
              }}
              title={t("term.renameHint")}
            >
              {tab.label.includes("claude") || tab.label.includes("cursor") ? (
                <Bot size={14} />
              ) : (
                <SquareTerminal size={14} />
              )}
              {renaming?.id === tab.id ? (
                <input
                  className="term-tab-rename"
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ id: tab.id, draft: e.target.value })}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenaming(null);
                    e.stopPropagation();
                  }}
                  aria-label={t("term.renameLabel")}
                />
              ) : (
                <span className="term-tab-label">{tab.label}</span>
              )}
              <span
                className="term-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={t("term.closeTab", { label: tab.label })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }
                }}
              >
                <X size={12} />
              </span>
            </div>
          ))}
          <button
            type="button"
            className="term-tab-add"
            onClick={addTab}
            aria-label={t("term.newSessionHint")}
            title={t("term.newSessionHint")}
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="term-body">
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className="term-canvas"
              style={{ display: tab.id === terminalActiveId ? "flex" : "none" }}
            >
              {renderPane(tab, panesOfTab(tab), "")}
            </div>
          ))}
          {searchOpen ? (
            <div className="term-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  const h = focusedHandles();
                  if (!h) return;
                  if (next) h.search.findNext(next, { incremental: true, ...searchOptions() });
                  else {
                    h.search.clearDecorations();
                    setMatches(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
                  else if (e.key === "Escape") closeSearch();
                }}
                placeholder={t("term.searchPlaceholder")}
                aria-label={t("term.searchLabel")}
              />
              <span
                className={"ts-count" + (query && matches?.count === 0 ? " empty" : "")}
                aria-live="polite"
              >
                {formatMatchCount(query, matches)}
              </span>
              <button
                type="button"
                className="ts-btn"
                onClick={() => runSearch("prev")}
                title={t("term.prevMatch")}
              >
                ↑
              </button>
              <button
                type="button"
                className="ts-btn"
                onClick={() => runSearch("next")}
                title={t("term.nextMatch")}
              >
                ↓
              </button>
              <button
                type="button"
                className="ts-btn"
                onClick={closeSearch}
                aria-label={t("term.closeSearch")}
                title={t("term.closeSearchHint")}
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="term-status">
          <span className="ts-seg">
            <SquareTerminal size={12} />
            {activeTab?.label ?? "—"}
            {paneCount > 1 ? ` · ${t("term.paneCount", { n: paneCount })}` : ""}
          </span>
          {shellSummary ? (
            <span className="ts-seg" title={focusedShell?.cwd ?? undefined} aria-live="polite">
              <span className={"ts-dot tone-" + shellSummary.tone} />
              {shellSummary.text}
            </span>
          ) : null}
          <span className="ts-hint">{t("term.shortcuts")}</span>
          <span style={{ flex: 1 }} />
          <span className="ts-seg">
            <button
              type="button"
              className="ts-btn"
              onClick={() => fontDelta(-1)}
              aria-label={t("term.fontSmaller")}
            >
              A−
            </button>
            <span className="ts-font">{fontSize}px</span>
            <button
              type="button"
              className="ts-btn"
              onClick={() => fontDelta(1)}
              aria-label={t("term.fontLarger")}
            >
              A+
            </button>
          </span>
          <span className="ts-seg">
            <span className="ts-dot" style={{ background: watchColor }} />
            {watchLabel}
          </span>
        </div>
      </div>
    </>
  );
}

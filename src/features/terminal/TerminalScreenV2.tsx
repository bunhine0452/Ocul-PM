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
import { consumePendingDispatch, hasPendingDispatch } from "./dispatchBus";

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

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
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
  if (matches.count === 0) return "일치 없음";
  if (matches.index < 0) return `${matches.count}건`;
  return `${matches.index + 1}/${matches.count}`;
}

function panesOfTab(t: TerminalTab): PaneNode {
  return t.panes ?? leaf(t.id);
}

function focusOfTab(t: TerminalTab): string {
  const panes = panesOfTab(t);
  const sids = collectSids(panes);
  return t.focusSid && sids.includes(t.focusSid) ? t.focusSid : firstSid(panes);
}

interface TerminalScreenV2Props {
  projectRoot: string | null;
}

export function TerminalScreenV2({ projectRoot }: TerminalScreenV2Props) {
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
  // (개행 없음 — 실행은 사용자가 Enter 로). 세션 기동 전이면 잠깐 재시도.
  useEffect(() => {
    if (!hasPendingDispatch()) return;
    const tab = terminalTabs.find((tb) => tb.id === terminalActiveId) ?? terminalTabs[0];
    if (!tab) return;
    const sid = focusOfTab(tab);
    const cmd = consumePendingDispatch();
    if (!cmd) return;
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      void commands
        .writeToPty(sid, cmd)
        .then((r) => {
          if (r.status !== "ok" && tries++ < 10) setTimeout(attempt, 300);
        })
        .catch(() => {
          if (tries++ < 10) setTimeout(attempt, 300);
        });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [terminalTabs, terminalActiveId]);

  // 명령 경계에서 코딩 에이전트 실행을 추적 → 세션 신호 + 일지 제안.
  // 셸 통합이 꺼져 있으면 shellStates 가 비어 있어 자동으로 no-op 이다.
  useAgentRuns(shellStates, state.currentProjectId);

  const activeTab = terminalTabs.find((t) => t.id === terminalActiveId) ?? null;
  const paneCount = activeTab ? collectSids(panesOfTab(activeTab)).length : 0;

  // Ensure at least one tab exists.
  useEffect(() => {
    if (terminalTabs.length === 0) {
      const id = newId();
      const tab: TerminalTab = { id, label: "zsh", shell: "zsh", cwd: projectRoot ?? "" };
      setState((prev) => ({ ...prev, terminalTabs: [tab], terminalActiveId: id }));
    } else if (terminalActiveId == null || !terminalTabs.some((t) => t.id === terminalActiveId)) {
      setState((prev) => ({ ...prev, terminalActiveId: terminalTabs[0].id }));
    }
  }, [terminalTabs, terminalActiveId, projectRoot, setState]);

  // 닫힌 세션의 핸들 정리.
  useEffect(() => {
    const alive = new Set(terminalTabs.flatMap((t) => collectSids(panesOfTab(t))));
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

  const patchTab = (id: string, fn: (t: TerminalTab) => TerminalTab) =>
    setState((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((t) => (t.id === id ? fn(t) : t)),
    }));

  const addTab = () => {
    const id = newId();
    const n = terminalTabs.length + 1;
    const tab: TerminalTab = { id, label: `zsh ${n}`, shell: "zsh", cwd: projectRoot ?? "" };
    setState((prev) => ({
      ...prev,
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: id,
    }));
  };

  const closeTab = (id: string) => {
    const tab = terminalTabs.find((t) => t.id === id);
    if (tab) for (const sid of collectSids(panesOfTab(tab))) void commands.killPtySession(sid);
    setState((prev) => {
      const remaining = prev.terminalTabs.filter((t) => t.id !== id);
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
    if (label) patchTab(renaming.id, (t) => ({ ...t, label }));
    setRenaming(null);
  };

  const splitFocused = (dir: PaneDir) => {
    if (!activeTab) return;
    const sid = focusOfTab(activeTab);
    const newSid = newId();
    patchTab(activeTab.id, (t) => ({
      ...t,
      panes: splitPane(panesOfTab(t), sid, dir, newSid),
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
    patchTab(activeTab.id, (t) => {
      const next = removePane(panesOfTab(t), sid);
      return { ...t, panes: next ?? leaf(t.id), focusSid: nextFocus ?? undefined };
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
    patchTab(activeTab.id, (t) => {
      const next = removePane(panesOfTab(t), sid);
      return { ...t, panes: next ?? leaf(t.id), focusSid: nextFocus ?? undefined };
    });
  };

  const focusPane = (tabId: string, sid: string) => {
    const tab = terminalTabs.find((t) => t.id === tabId);
    if (!tab || tab.focusSid === sid) return;
    patchTab(tabId, (t) => ({ ...t, focusSid: sid }));
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
      terminalTabs: prev.terminalTabs.map((t) =>
        t.id === tabId && canAutoRename(t.label) && t.label !== label ? { ...t, label } : t,
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
      patchTab(tabId, (t) => ({ ...t, panes: setRatio(panesOfTab(t), path, ratio) }));
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
      if (res.status === "error") toast.destructive(`에디터 열기 실패: ${res.error}`);
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // 포커스된 페인의 셸 통합 상태 — 상태바/툴바 문구가 여기서 나온다.
  const focusedShell = activeTab ? shellStates[focusOfTab(activeTab)] : undefined;
  const shellSummary = focusedShell ? summarizeShell(focusedShell) : null;
  // 2026-07-30 정직성 수정: 예전 문구는 "에이전트 실행을 감지해 자동으로 일지를
  // 작성합니다" 였는데, PTY 쪽에 감지 코드가 한 줄도 없었고 자동 일지 초안도
  // 기본 꺼짐이었다. 이제 실제로 켜져 있을 때만 그렇게 말한다.
  const toolbarSub = focusedShell?.active
    ? "셸 통합 켜짐 — 명령 경계·종료코드·작업 디렉터리를 인식합니다"
    : "설정 → 터미널에서 셸 통합을 켜면 명령 경계와 종료코드를 인식합니다";

  // 감사 fix (2026-07-16): 실제 워처 상태(oculpmStatus.watcher_state) 그대로.
  const watcher = state.oculpmStatus?.watcher_state ?? null;
  const watchLabel =
    watcher === "running" ? ".oculpm 감시중" : watcher === "error" ? "감시 오류" : "감시 꺼짐";
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
              aria-label="페인 닫기"
              title="페인 닫기 (⌘W)"
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
      <Toolbar title="터미널" sub={toolbarSub}>
        <button
          className="btn icon"
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
          title="스크롤백 검색 (⌘F)"
          aria-label="스크롤백 검색"
        >
          <Search size={15} />
        </button>
        <button className="btn icon" onClick={() => splitFocused("row")} title="가로 분할 (⌘D)" aria-label="가로 분할">
          <Columns2 size={15} />
        </button>
        <button className="btn icon" onClick={() => splitFocused("col")} title="세로 분할 (⇧⌘D)" aria-label="세로 분할">
          <Rows2 size={15} />
        </button>
        <button className="btn" onClick={addTab}>
          <Plus size={15} /> 새 세션
        </button>
      </Toolbar>

      <div className="term-wrap">
        <div className="term-tabs" role="tablist" aria-label="터미널 세션 탭">
          {terminalTabs.map((t) => (
            <div
              key={t.id}
              className={"term-tab" + (t.id === terminalActiveId ? " active" : "")}
              onClick={() => selectTab(t.id)}
              onDoubleClick={() => setRenaming({ id: t.id, draft: t.label })}
              role="tab"
              aria-selected={t.id === terminalActiveId}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectTab(t.id);
              }}
              title="더블클릭으로 이름 변경"
            >
              {t.label.includes("claude") || t.label.includes("cursor") ? (
                <Bot size={14} />
              ) : (
                <SquareTerminal size={14} />
              )}
              {renaming?.id === t.id ? (
                <input
                  className="term-tab-rename"
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenaming(null);
                    e.stopPropagation();
                  }}
                  aria-label="탭 이름 변경"
                />
              ) : (
                <span className="term-tab-label">{t.label}</span>
              )}
              <span
                className="term-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={`${t.label} 닫기`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeTab(t.id);
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
            aria-label="새 세션 (⌘T)"
            title="새 세션 (⌘T)"
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
                placeholder="스크롤백 검색…"
                aria-label="터미널 검색"
              />
              <span
                className={"ts-count" + (query && matches?.count === 0 ? " empty" : "")}
                aria-live="polite"
              >
                {formatMatchCount(query, matches)}
              </span>
              <button type="button" className="ts-btn" onClick={() => runSearch("prev")} title="이전 (⇧Enter)">
                ↑
              </button>
              <button type="button" className="ts-btn" onClick={() => runSearch("next")} title="다음 (Enter)">
                ↓
              </button>
              <button type="button" className="ts-btn" onClick={closeSearch} aria-label="검색 닫기" title="닫기 (Esc)">
                <X size={12} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="term-status">
          <span className="ts-seg">
            <SquareTerminal size={12} />
            {activeTab?.label ?? "—"}
            {paneCount > 1 ? ` · 페인 ${paneCount}` : ""}
          </span>
          {shellSummary ? (
            <span className="ts-seg" title={focusedShell?.cwd ?? undefined} aria-live="polite">
              <span className={"ts-dot tone-" + shellSummary.tone} />
              {shellSummary.text}
            </span>
          ) : null}
          <span className="ts-hint">⌘T 새 탭 · ⌘D 분할 · ⇧⌘D 아래 분할 · ⌘F 검색 · ⌘L 지우기 · ⌘W 닫기</span>
          <span style={{ flex: 1 }} />
          <span className="ts-seg">
            <button type="button" className="ts-btn" onClick={() => fontDelta(-1)} aria-label="글자 작게 (⌘-)">
              A−
            </button>
            <span className="ts-font">{fontSize}px</span>
            <button type="button" className="ts-btn" onClick={() => fontDelta(1)} aria-label="글자 크게 (⌘+)">
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

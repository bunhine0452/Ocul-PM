import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  TERM_FONT_MIN as FONT_MIN,
  TERM_FONT_MAX as FONT_MAX,
  TERM_FONT_DEFAULT as FONT_DEFAULT,
  clampTermFont as clampFont,
} from "./fontSize";

// 터미널 본체 — 2026-07-20 대규모 개편 (iTerm2/cmux/Warp 참조).
//  - 세션 지속: PTY 는 화면을 떠나도 살아있고(백엔드 스크롤백 리플레이),
//    탭/페인을 닫을 때만 kill 한다.
//  - 분할 페인: 탭마다 이진 트리 레이아웃(@/lib/termPanes) — ⌘D 가로,
//    ⇧⌘D 세로, 드래그 리사이즈(로컬 오버레이 + pointerup 커밋), 포커스 링.
//  - 탭: 더블클릭 리네임, 호버 닫기, ⌘T/⌘W.
//  - 검색 오버레이(⌘F, addon-search), 글자 크기(⌘+/⌘-/⇧⌘0, 영속),
//    하단 상태바(탭·페인·단축키 힌트·글자크기·.oculpm 감시).
//
// 2026-08-15 — **여러 면이 함께 쓰는 컴포넌트로 분리**했다 (예전엔 터미널
// 화면 파일 안에 붙어 있었다). 지금 이걸 그리는 곳은 셋이다:
//   ① 터미널 화면 (TerminalScreenV2)  ② 도크 (TerminalDock)  ③ 분리 창.
// 세션 목록은 셋이 **공유**한다 (WorkspaceContext.terminalTabs). 같은 PTY 에
// xterm 두 개가 동시에 붙으면 fit/resize 가 서로를 되돌려 화면이 떨리므로,
// **한 번에 하나만 마운트**해야 한다 — 그 심판은 ShellV2 가 본다.

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

export interface TerminalSurfaceProps {
  projectRoot: string | null;
  /**
   * 좁은 자리(도크)용 — 상태바에서 단축키 힌트를 빼고 여백을 줄인다.
   * 기능은 동일하다.
   */
  compact?: boolean;
  /**
   * 단축키(⌘F·⌘D·⌘L·⌘±)를 언제 들을지.
   *  - `always`: 이 면이 화면 전체를 차지한다 (터미널 화면·분리 창).
   *  - `focused`: 포커스가 이 면 안에 있을 때만. 도크는 다른 화면 위에 얹혀
   *    있으므로 이걸 써야 한다 — 아니면 일지를 읽다 누른 ⌘F 가 터미널
   *    스크롤백 검색을 연다.
   */
  keyboardScope?: "always" | "focused";
  /** 탭 줄 오른쪽 끝에 덧붙이는 버튼들 (도크의 자리 바꾸기·분리·닫기). */
  headerActions?: React.ReactNode;
  /** 포커스된 페인의 셸 통합이 켜져 있는지 — 화면 툴바 부제에 쓴다. */
  onShellActiveChange?: (active: boolean) => void;
}

export function TerminalSurface({
  projectRoot,
  compact = false,
  keyboardScope = "always",
  headerActions,
  onShellActiveChange,
}: TerminalSurfaceProps) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { settings, set: setSetting } = useSettings();
  const { terminalTabs, terminalActiveId } = state;
  // 앱 전역 설정에서 읽는다 (2026-08-15) — 설정 화면·상태바·⌘± 가 한 값을
  // 공유하고, 창을 여러 개 띄워도 SQLite 라 전부 같은 크기가 된다.
  const fontSize = clampFont(settings.terminalFontSize || FONT_DEFAULT);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 검색 결과 카운터 "3/17" — SearchAddon.onDidChangeResults 가 채운다.
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  // 드래그 중 비율은 로컬 오버레이로만 그리고 pointerup 에 컨텍스트로 커밋
  // (드래그 매 프레임 전역 상태를 흔들지 않기 위해).
  const [drag, setDrag] = useState<{ tabId: string; path: string; ratio: number } | null>(null);
  // 글자 크기 px 직접 입력 — 타이핑 중 초안(null = 편집 중 아님).
  const [fontDraft, setFontDraft] = useState<string | null>(null);

  // 단축키 스코프 판정용 — 이 면의 루트.
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  const setFont = (px: number) => void setSetting("terminalFontSize", clampFont(px));
  // 델타는 화면에 보이는 값 기준이다 — 설정이 범위 밖 값을 들고 있어도
  // (수동 편집·과거 값) ⌘+ 한 번이 눈에 보이는 크기에서 한 칸 움직인다.
  const fontDelta = (d: number) => setFont(fontSize + d);
  const fontReset = () => setFont(FONT_DEFAULT);

  /** px 입력 커밋 — 빈 값·범위 밖은 현재 값으로 되돌린다. */
  const commitFontDraft = () => {
    if (fontDraft === null) return;
    const parsed = Number.parseInt(fontDraft, 10);
    if (Number.isFinite(parsed)) setFont(parsed);
    setFontDraft(null);
  };

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

  /** ⌘L — 스크롤백을 비우고 현재 줄만 남긴다 (Terminal.app 의 ⌘K 자리). */
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
    keyboardScope,
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
    keyboardScope,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      // 도크는 다른 화면 **위에 얹혀** 있다 — 포커스가 터미널 안에 없는데도
      // ⌘F 를 가로채면 일지를 읽던 사용자가 스크롤백 검색을 만나게 된다.
      if (a.keyboardScope === "focused") {
        const root = rootRef.current;
        if (!root || !root.contains(document.activeElement)) return;
      }
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
  const shellActive = focusedShell?.active === true;
  useEffect(() => {
    onShellActiveChange?.(shellActive);
  }, [shellActive, onShellActiveChange]);

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
    <div className={"term-wrap" + (compact ? " compact" : "")} ref={rootRef}>
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

        {/* 도구 묶음 — 예전엔 화면 툴바에만 있어서 도크에서는 쓸 수 없었다.
            탭 줄로 옮기니 세 면(화면·도크·분리 창)이 같은 조작을 갖는다. */}
        <span className="term-tabs-spacer" />
        <div className="term-tools">
          <button
            type="button"
            className="term-tool"
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            title={t("term.searchScrollbackHint")}
            aria-label={t("term.searchScrollback")}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => splitFocused("row")}
            title={t("term.splitRowHint")}
            aria-label={t("term.splitRow")}
          >
            <Columns2 size={14} />
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => splitFocused("col")}
            title={t("term.splitColHint")}
            aria-label={t("term.splitCol")}
          >
            <Rows2 size={14} />
          </button>
          {headerActions}
        </div>
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
        {/* 좁은 도크에서는 단축키 힌트가 다른 정보를 밀어낸다 — 넓을 때만. */}
        {compact ? null : <span className="ts-hint">{t("term.shortcuts")}</span>}
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
          <span className="ts-font">
            <input
              type="number"
              className="ts-font-input"
              min={FONT_MIN}
              max={FONT_MAX}
              step={1}
              value={fontDraft ?? String(fontSize)}
              aria-label={t("term.fontSizeInput")}
              title={t("term.fontSizeHint", { min: FONT_MIN, max: FONT_MAX })}
              onChange={(e) => {
                const raw = e.target.value;
                setFontDraft(raw);
                // 범위 안 값만 즉시 반영 — "1"(→18 을 치는 중)이 9 로 튀지 않게
                // 클램프 없이 통과시킨다. 범위 밖·빈 값은 blur 에서 정리.
                const parsed = Number.parseInt(raw, 10);
                if (parsed >= FONT_MIN && parsed <= FONT_MAX) setFont(parsed);
              }}
              onBlur={commitFontDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFontDraft();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFontDraft(null);
                  e.currentTarget.blur();
                }
              }}
            />
            px
          </span>
          <button
            type="button"
            className="ts-btn"
            onClick={() => fontDelta(1)}
            aria-label={t("term.fontLarger")}
          >
            A+
          </button>
        </span>
        {compact ? null : (
          <span className="ts-seg">
            <span className="ts-dot" style={{ background: watchColor }} />
            {watchLabel}
          </span>
        )}
      </div>
    </div>
  );
}

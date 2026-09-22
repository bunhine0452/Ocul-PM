import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { requestManualEntry } from "@/lib/journalCompose";
import { useT } from "@/i18n";
import { useSettings } from "@/contexts/SettingsContext";
import { useSaveSetting } from "@/features/settings/saveSetting";
import { reportFailure, reportRejection } from "@/lib/reportFailure";
import { useTerminalFont } from "./useTerminalFont";
import { useProjectRuntime, useTerminalSessions, type TerminalTab } from "@/contexts/WorkspaceContext";
import {
  leaf,
  collectSids,
  splitPane,
  removePane,
  siblingSid,
  type PaneNode,
  type PaneDir,
} from "@/lib/termPanes";
import { sessionColorStyle } from "@/lib/sessionColors";
import { useSessionColorMenu } from "./useSessionColorMenu";
import { TerminalInstance } from "./TerminalInstance";
import { canAutoRename, shellTitleToTabLabel } from "./tabTitle";
import { deriveIntegrationStatus, summarizeShell, type IntegrationStatus } from "./shellStatus";
import { useAgentRuns } from "./useAgentRuns";
import { foregroundCommands } from "@/windows/useTabRunningWork";
import { useConfirm } from "@/hooks/useConfirm";
import { runningWorkItems } from "@/lib/closeIntent";
import { focusOfTab, panesOfTab } from "./activePane";
import { clampTermDensity, termLineHeight, termPanePad } from "./density";
import { TerminalRail } from "./TerminalRail";
import { TerminalPaneHead } from "./TerminalPaneHead";
import { TerminalHeadBar } from "./TerminalHeadBar";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { PIP_COUNT } from "./TerminalPaneHead";
import { blockTone } from "./commandBlocks";
import { TerminalBlockMenu } from "./TerminalBlockMenu";
import { TerminalFileMenu } from "./TerminalFileMenu";
import type { BlockActivation } from "./TerminalInstanceImpl";
import type { FileRefHit } from "./fileRefLinks";
import { formatCwdCrumb } from "./railModel";
// 2026-09-15 분할 — 책임별로 갈라 나간 훅·하위 컴포넌트 (terminalSurface/).
import { newId } from "./terminalSurface/sessionId";
import { useDispatchPrefill } from "./terminalSurface/useDispatchPrefill";
import { useSessionMove } from "./terminalSurface/useSessionMove";
import { useTerminalSearch } from "./terminalSurface/useTerminalSearch";
import { TerminalSearchBar } from "./terminalSurface/TerminalSearchBar";
import { useTerminalKeys } from "./terminalSurface/useTerminalKeys";
import { useSplitDrag } from "./terminalSurface/useSplitDrag";
import { usePaneStates } from "./terminalSurface/usePaneStates";
import { TerminalGhost } from "./terminalSurface/TerminalGhost";

// 터미널 본체 — 2026-07-20 대규모 개편 (iTerm2/cmux/Warp 참조).
//  - 세션 지속: PTY 는 화면을 떠나도 살아있고(백엔드 스크롤백 리플레이),
//    탭/페인을 닫을 때만 kill 한다.
//  - 분할 페인: 탭마다 이진 트리 레이아웃(@/lib/termPanes) — ⌘D 가로,
//    ⇧⌘D 세로, 드래그 리사이즈(로컬 오버레이 + pointerup 커밋), 포커스 링.
//  - 탭: 더블클릭 리네임, 호버 닫기, ⌘T/⌘W.
//  - 검색 오버레이(⌘F, addon-search), 글자 크기(⌘+/⌘-/⇧⌘0, 영속),
//    하단 상태바(탭·페인·단축키 힌트·글자크기·.oculpm 감시).
//
// 2026-08-28 — **시각 정체성 라운드**. 가로 탭 줄을 세로 세션 레일로 바꾸고
// (→ TerminalRail), 밀도 프리셋·앰비언트 페인 테두리·비활성 페인 디밍·라이브
// 경과 시간을 넣었다. 에이전트를 서너 개 띄워 놓고 몇 시간을 보는 화면이라
// "지금 어디에 타이핑되는가 · 무엇이 돌고 있는가"를 곁눈질로 알 수 있어야 한다.
//
// 2026-08-15 — **여러 면이 함께 쓰는 컴포넌트로 분리**했다 (예전엔 터미널
// 화면 파일 안에 붙어 있었다). 지금 이걸 그리는 곳은 셋이다:
//   ① 터미널 화면 (TerminalScreenV2)  ② 도크 (TerminalDock)  ③ 분리 창.
// 세션 목록은 셋이 **공유**한다 (WorkspaceContext.terminalTabs). 같은 PTY 에
// xterm 두 개가 동시에 붙으면 fit/resize 가 서로를 되돌려 화면이 떨리므로,
// **한 번에 하나만 마운트**해야 한다 — 그 심판은 ShellV2 가 본다.
//
// 2026-09-15 — **1,445줄을 책임별로 분할**했다 (파일 크기 래칫). 공개 경로·props·
// DOM·동작은 그대로고, 세션 옮기기 드래그·단축키·검색·분할 드래그·디스패치
// 펌프가 `terminalSurface/` 의 훅과 하위 컴포넌트로 나갔다. 이펙트 순서는
// 원본과 같다 — 훅은 원래 이펙트가 있던 자리에서 부른다.

// `formatMatchCount` 는 검색 표시부와 함께 옮겨 갔다 — 공개 경로는 여기다.
export { formatMatchCount } from "./terminalSurface/TerminalSearchBar";

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
  /** 포커스된 페인의 셸 통합 상태 세 갈래 — 툴바 부제가 쓴다 (shellStatus.ts). */
  onShellStatusChange?: (status: IntegrationStatus) => void;
  /**
   * 탭 줄의 빈 자리를 **창 드래그 영역**으로 쓴다 (분리 터미널 창 전용).
   *
   * 그 창은 `titleBarStyle: Overlay` 라 잡을 타이틀바가 없고, 탭 스트립도
   * 툴바도 없어 탭 줄이 유일한 상단 크롬이다 — 여기에 리전을 안 주면 창을
   * **아예 옮길 수 없다**. 도크·터미널 화면에서는 켜면 안 된다: 그쪽 탭 줄을
   * 끌면 앱 창 전체가 따라 움직인다.
   */
  dragRegion?: boolean;
  /**
   * ⌘T 를 **포커스와 무관하게** 이 면이 가져간다 (분리 터미널 창 전용).
   *
   * 앱 창에서는 포커스가 터미널 안에 있을 때만 가져간다 — 배경 프로젝트 탭도
   * 마운트된 채라(크롬식 탭) 포커스 말고는 "지금 보고 있는 터미널" 을 가릴
   * 방법이 없다. 분리 창에는 다른 탭이 아예 없으므로 그 조건이 필요 없고,
   * 오히려 포커스가 크롬 버튼에 가 있으면 ⌘T 가 통째로 씹힌다.
   */
  ownsNewTab?: boolean;
}

export function TerminalSurface({
  projectRoot,
  compact = false,
  keyboardScope = "always",
  headerActions,
  onShellStatusChange,
  dragRegion = false,
  ownsNewTab = false,
}: TerminalSurfaceProps) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  // Phase 4 #workspace-split — 세션 조각과 런타임 조각만 구독한다. 검색어·
  // 플래너 접힘 같은 취향이 바뀌어도 터미널은 다시 그려지지 않는다.
  const { terminalTabs, terminalActiveId, setSessions } = useTerminalSessions();
  const runtime = useProjectRuntime();
  const { settings } = useSettings();
  const setSetting = useSaveSetting();
  // 글자 크기는 전용 훅이 소유한다 (`useTerminalFont`) — 값·초안·클램프·커밋이
  // 한 덩어리라 흩어 두면 세 자리를 따로 고치게 된다.
  const { fontSize, fontDraft, setFontDraft, setFont, fontDelta, fontReset, commitFontDraft } =
    useTerminalFont();
  // 밀도도 같은 이유로 앱 전역 설정이다 — 도크·터미널 화면·분리 창이 같은
  // 값을 봐야 창을 옮길 때 줄 간격이 튀지 않는다.
  const density = clampTermDensity(settings.terminalDensity);
  const lineHeight = termLineHeight(density);
  const railCollapsed = settings.terminalRailCollapsed;

  // 확대된 페인 (2026-09-11). sid 는 탭을 가로질러 유일하므로 탭별로 들 필요가
  // 없다 — 그 sid 가 지금 탭에 없으면 그냥 아무 효과도 없다. 다른 페인은
  // **숨길 뿐 언마운트하지 않는다**: 셸은 계속 돌고, 돌아오면 그 자리 그대로다.
  const [zoomSid, setZoomSid] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);

  // 페인별 상태 맵·xterm 핸들 레지스트리·다시 시작 (→ terminalSurface/usePaneStates).
  // 닫힌 세션의 회수는 아래 탭 생명주기 이펙트 옆에 있다.
  const {
    regRef,
    shellStates,
    setShellStates,
    paneSignals,
    setPaneSignals,
    blockPips,
    setBlockPips,
    ended,
    setEnded,
    restartNonce,
    setRestartNonce,
    restartPane,
  } = usePaneStates();
  // 거터 캡슐을 눌러 연 블록 액션 팝오버. 한 번에 하나만 뜬다.
  const [blockMenu, setBlockMenu] = useState<BlockActivation | null>(null);

  // IN2 — 디스패치 프리필 펌프 (→ terminalSurface/useDispatchPrefill). 활성 페인
  // sid 는 아래에서 매 렌더 ref 에 써 넣는다.
  const dispatchSidRef = useDispatchPrefill(runtime.currentProjectId);

  // 명령 경계에서 코딩 에이전트 실행을 추적 → 세션 신호 + 일지 제안.
  // 셸 통합이 꺼져 있으면 shellStates 가 비어 있어 자동으로 no-op 이다.
  const { finished: finishedRuns, dismiss: dismissFinishedRun } = useAgentRuns(
    shellStates,
    runtime.currentProjectId,
  );

  const activeTab = terminalTabs.find((tab) => tab.id === terminalActiveId) ?? null;
  dispatchSidRef.current = activeTab ? focusOfTab(activeTab) : null;

  // Ensure at least one tab exists.
  useEffect(() => {
    if (terminalTabs.length === 0) {
      const id = newId(runtime.currentProjectId);
      const tab: TerminalTab = { id, label: "zsh", shell: "zsh", cwd: projectRoot ?? "" };
      setSessions(() => ({ terminalTabs: [tab], terminalActiveId: id }));
    } else if (terminalActiveId == null || !terminalTabs.some((tab) => tab.id === terminalActiveId)) {
      setSessions((prev) => ({ ...prev, terminalActiveId: terminalTabs[0].id }));
    }
  }, [terminalTabs, terminalActiveId, projectRoot, runtime.currentProjectId, setSessions]);

  // 닫힌 세션의 핸들 정리.
  useEffect(() => {
    const alive = new Set(terminalTabs.flatMap((tab) => collectSids(panesOfTab(tab))));
    for (const sid of regRef.current.keys()) {
      if (!alive.has(sid)) regRef.current.delete(sid);
    }
    // 셸 상태도 같이 회수 — 안 그러면 탭을 여닫을 때마다 맵이 무한정 자란다.
    const reap = <T,>(prev: Record<string, T>): Record<string, T> => {
      const stale = Object.keys(prev).filter((sid) => !alive.has(sid));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const sid of stale) delete next[sid];
      return next;
    };
    setShellStates(reap);
    setPaneSignals(reap);
    setEnded(reap);
    setRestartNonce(reap);
    // setter·ref 는 usePaneStates 가 돌려준 안정된 identity 다 — 재실행은 여전히
    // terminalTabs 가 바뀔 때뿐이다 (exhaustive-deps 게이트).
  }, [terminalTabs, regRef, setShellStates, setPaneSignals, setEnded, setRestartNonce]);

  const patchTab = (id: string, fn: (tab: TerminalTab) => TerminalTab) =>
    setSessions((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) => (tab.id === id ? fn(tab) : tab)),
    }));

  // 세션 색 메뉴 — 상태·배선은 전용 훅이 소유한다 (이 파일은 이미 한계 초과).
  const colorMenu = useSessionColorMenu(terminalTabs, patchTab);

  const addTab = () => {
    const id = newId(runtime.currentProjectId);
    const n = terminalTabs.length + 1;
    const tab: TerminalTab = { id, label: `zsh ${n}`, shell: "zsh", cwd: projectRoot ?? "" };
    setSessions((prev) => ({
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: id,
    }));
  };

  /**
   * PTY 를 죽이기 전에 **돌고 있는 일**을 확인한다 (2026-09-04).
   *
   * 같은 ⌘W 가 **탭** 층에 닿으면 `runTabCloseGuard` 가 페인마다 실행 중 명령을
   * 물어 확인창을 띄우는데(TabbedWindow), **페인** 층에서는 아무것도 묻지 않고
   * 곧장 `kill_pty_session` 을 쐈다 — 돌던 에이전트의 턴이 확인 없이 사라지고
   * 되돌릴 길이 없었다. 판정은 그 문지기와 **같은 함수**(`foregroundCommands`)를
   * 쓴다: 프롬프트에 멈춘 셸은 세지 않으므로 평소의 ⌘W 는 그대로 즉시 닫힌다.
   * 반환값은 "닫아도 되는가" — false 면 부르는 쪽이 상태를 건드리지 않는다.
   */
  const killPanes = async (sids: string[]): Promise<boolean> => {
    const running = await foregroundCommands(sids);
    if (running.length > 0) {
      const ok = await confirm({
        title: t("close.guard.title"),
        message: t("close.guard.detailPane"),
        items: runningWorkItems(running, 0, t),
        confirmLabel: t("close.guard.confirm"),
        danger: true,
      });
      if (!ok) return false;
    }
    // 여기가 조용히 실패하면 화면에서는 탭이 사라졌는데 뒤에서 프로세스가
    // 계속 돈다 — 사용자가 알 길이 전혀 없는 결말이다 ({#floating-promises}).
    for (const sid of sids) reportFailure("kill_pty_session", commands.killPtySession(sid), "term.killFailed");
    return true;
  };

  const closeTab = async (id: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === id);
    if (tab && !(await killPanes(collectSids(panesOfTab(tab))))) return;
    setSessions((prev) => {
      const remaining = prev.terminalTabs.filter((tab) => tab.id !== id);
      const nextActive =
        prev.terminalActiveId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : prev.terminalActiveId;
      return { terminalTabs: remaining, terminalActiveId: nextActive };
    });
  };

  const selectTab = (id: string) => setSessions((prev) => ({ ...prev, terminalActiveId: id }));

  const commitRename = () => {
    if (!renaming) return;
    const label = renaming.draft.trim();
    if (label) patchTab(renaming.id, (tab) => ({ ...tab, label }));
    setRenaming(null);
  };

  const splitFocused = (dir: PaneDir) => {
    if (!activeTab) return;
    const sid = focusOfTab(activeTab);
    const newSid = newId(runtime.currentProjectId);
    patchTab(activeTab.id, (tab) => ({
      ...tab,
      panes: splitPane(panesOfTab(tab), sid, dir, newSid),
      focusSid: newSid,
    }));
  };

  const closePane = async (sid: string) => {
    if (!activeTab) return;
    const panes = panesOfTab(activeTab);
    if (panes.type === "leaf") {
      reportRejection(closeTab(activeTab.id), "term.closeFailed");
      return;
    }
    const nextFocus = siblingSid(panes, sid);
    if (!(await killPanes([sid]))) return;
    patchTab(activeTab.id, (tab) => {
      const next = removePane(panesOfTab(tab), sid);
      return { ...tab, panes: next ?? leaf(tab.id), focusSid: nextFocus ?? undefined };
    });
  };

  // ⌘W — 분할 중이면 포커스 페인만, 마지막 페인이면 탭을 닫는다. 예전에는 이
  // 갈래가 `closePane` 을 통째로 베껴 두 곳이 따로 낡을 수 있었다.
  const closeFocusedPane = () => {
    if (!activeTab) return;
    reportRejection(closePane(focusOfTab(activeTab)), "term.closeFailed");
  };

  const focusPane = (tabId: string, sid: string) => {
    const tab = terminalTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.focusSid === sid) return;
    patchTab(tabId, (tab) => ({ ...tab, focusSid: sid }));
  };

  // ── 세션 옮기기 드래그 ────────────────────────────────────────────────────
  //
  // 배선·기하·고스트는 전용 훅이 쥔다 (→ terminalSurface/useSessionMove). 여기서는
  // 돌려받은 ref 를 레일·카드·페인·고스트 요소에 달고 포인터 핸들러를 넘긴다.
  const {
    moving,
    railElRef,
    cardElsRef,
    bodyElRef,
    paneElsRef,
    ghostElRef,
    snapGhost,
    beginMove,
    onMovePointer,
    endMovePointer,
    cancelMove,
    selectFromRail,
    dropPreview,
    ghostLabel,
  } = useSessionMove({
    terminalTabs,
    setSessions,
    projectId: runtime.currentProjectId,
    selectTab,
    t,
  });

  const focusedHandles = () => (activeTab ? regRef.current.get(focusOfTab(activeTab)) : undefined);

  /** 셸이 알려온 제목으로 탭 이름을 갱신 — 사용자가 직접 지은 이름은 보존. */
  const applyShellTitle = (tabId: string, title: string) => {
    const label = shellTitleToTabLabel(title);
    if (!label) return;
    setSessions((prev) => ({
      ...prev,
      terminalTabs: prev.terminalTabs.map((tab) =>
        tab.id === tabId && canAutoRename(tab.label) && tab.label !== label
          ? { ...tab, label }
          : tab,
      ),
    }));
  };

  // 검색 오버레이 상태·조작 (→ terminalSurface/useTerminalSearch).
  const { searchOpen, query, setQuery, matches, setMatches, openSearch, closeSearch, searchOptions, runSearch } =
    useTerminalSearch(focusedHandles);

  /**
   * ⌘↑/⌘↓ — 명령 블록 사이를 건너뛴다. 300줄 뱉은 빌드 로그에서 다음
   * 프롬프트까지 스크롤바를 끌지 않아도 된다.
   *
   * 셸 통합이 없으면 블록이 하나도 없다 — 조용히 아무 일도 안 하는 대신
   * **왜 안 되는지** 말한다 (기능이 고장 난 것처럼 보이지 않게).
   */
  const gotoBlock = (dir: "prev" | "next") => {
    const h = focusedHandles();
    if (!h) return;
    const target = h.blocks.goto(dir);
    if (!target && h.blocks.list().length === 0) toast.info(t("term.block.none"));
  };

  /** ⇧⌘↩ — 포커스된 페인만 크게. 분할이 하나뿐이면 뜻이 없다. */
  const toggleZoom = () => {
    if (!activeTab) return;
    if (collectSids(panesOfTab(activeTab)).length < 2) return;
    const sid = focusOfTab(activeTab);
    setZoomSid((prev) => (prev === sid ? null : sid));
    regRef.current.get(sid)?.term.focus();
  };

  /** ⌘L — 스크롤백을 비우고 현재 줄만 남긴다 (Terminal.app 의 ⌘K 자리). */
  const clearScreen = () => {
    const h = focusedHandles();
    if (!h) return;
    h.term.clear();
    h.term.focus();
  };

  // 화면-로컬 단축키 — 핸들러는 ref 로 항상 최신을 읽고 리스너는 1회 등록.
  // 같은 목록이 두 벌이었다: 한쪽에만 항목을 더하면 초기값과 갱신값이 조용히
  // 갈라진다. 한 벌로 만들고 초기값·갱신값이 그것을 함께 본다.
  const actions = {
    addTab, closeFocusedPane, splitFocused, openSearch, closeSearch, clearScreen,
    gotoBlock, fontDelta, fontReset, toggleZoom, searchOpen, keyboardScope, ownsNewTab,
  };
  // ⌘W/⌘T 인텐트 사슬 + 화면-로컬 keydown (→ terminalSurface/useTerminalKeys).
  // 돌려받는 rootRef 는 단축키 스코프 판정의 기준 — 루트 <div> 에 단다.
  const rootRef = useTerminalKeys(actions);

  // 분할 손잡이 드래그 — 비율 오버레이 + pointerup 커밋 (→ terminalSurface/useSplitDrag).
  const { drag, startDrag } = useSplitDrag(patchTab);

  // 출력 안의 `src/foo.ts:42` ⌘클릭 → 무엇으로 열지 고르는 팝오버
  // (`TerminalFileMenu`). 경로 검증은 여는 순간 백엔드가 한다.
  const [fileMenu, setFileMenu] = useState<FileRefHit | null>(null);

  // 포커스된 페인의 셸 통합 상태 — 상태바의 cwd 와 툴바 부제가 여기서 나온다.
  // 페인별 "지금 무슨 일" 문구·시계는 `TerminalPaneHead` 가 스스로 만든다.
  const focusedShell = activeTab ? shellStates[focusOfTab(activeTab)] : undefined;
  // 설치 여부는 화면(TerminalScreenV2)이 안다 — 여기서는 페인이 말하는 것만 올린다.
  const shellStatus = deriveIntegrationStatus(focusedShell, null);
  useEffect(() => {
    onShellStatusChange?.(shellStatus);
  }, [shellStatus, onShellStatusChange]);

  // 감사 fix (2026-07-16): 실제 워처 상태(oculpmStatus.watcher_state) 그대로.
  const watcher = runtime.oculpmStatus?.watcher_state ?? null;
  const watchLabel =
    watcher === "running"
      ? t("term.watchRunning")
      : watcher === "error"
        ? t("term.watchError")
        : t("term.watchOff");
  const watchColor =
    watcher === "running" ? "#57c98a" : watcher === "error" ? "var(--t-bug)" : "var(--text-3)";

  // 끝난 실행은 sid 로 오고 레일은 탭 단위로 그린다 — 여기서 옮긴다.
  // 탭 수가 한 자리라 매 렌더 다시 만드는 비용은 무시할 만하다.
  const finishedByTab: Record<string, { agentLabel: string; duration: string } | undefined> = {};
  for (const tab of terminalTabs) {
    const run = finishedRuns[focusOfTab(tab)];
    if (run) finishedByTab[tab.id] = run;
  }

  const renderPane = (tab: TerminalTab, node: PaneNode, path: string): React.ReactNode => {
    const isActiveTab = tab.id === terminalActiveId;
    if (node.type === "leaf") {
      const focusSid = focusOfTab(tab);
      const count = collectSids(panesOfTab(tab)).length;
      const focused = count > 1 && node.sid === focusSid;
      // 앰비언트 상태 테두리 — 페인이 스스로 무슨 상태인지 말한다. 셸 통합이
      // 없으면 "off" 라 아무 색도 입지 않는다 (모르는 걸 초록으로 칠하지 않는다).
      const shell = shellStates[node.sid];
      const tone = (shell ? summarizeShell(shell)?.tone : null) ?? "off";
      const dropping = moving?.pane?.sid === node.sid;
      // 지금 손에 들려 있는 페인 — 제자리에 남은 것은 자국일 뿐이라는 표시.
      const lifted = moving?.moved === true && moving.kind === "pane" && moving.sid === node.sid;
      const zoomed = count > 1 && zoomSid === node.sid;
      return (
        <div
          // 드롭 판정은 페인의 실제 화면 상자로 한다 — 트리를 따라 계산하면
          // 여백·분할 손잡이 폭만큼 어긋나 "가장자리를 겨눴는데 안 잡힌다".
          ref={(el) => {
            if (el) paneElsRef.current.set(node.sid, el);
            else paneElsRef.current.delete(node.sid);
          }}
          className={
            "term-pane" +
            (focused ? " focused" : "") +
            (count > 1 && !focused ? " dim" : "") +
            (lifted ? " lifted" : "") +
            (dropping ? " dropping" : "") +
            (zoomed ? " zoomed" : "")
          }
          data-tone={tone}
          data-sid={node.sid}
          style={sessionColorStyle(tab.color)}
        >
          {/* 머리띠 — 고정 높이라 내용이 바뀌어도 캔버스가 움직이지 않는다
              (TerminalPaneHead 주석). 판정과 1초 시계는 그 안에 갇혀 있다. */}
          <TerminalPaneHead
            label={tab.label}
            projectRoot={projectRoot}
            shell={shell}
            signal={paneSignals[node.sid]}
            multi={count > 1}
            zoomed={zoomed}
            onZoom={() => {
              setZoomSid((prev) => (prev === node.sid ? null : node.sid));
              focusPane(tab.id, node.sid);
            }}
            onClose={() => closePane(node.sid)}
            pips={blockPips[node.sid]}
            onPip={(id) => {
              const h = regRef.current.get(node.sid);
              const block = h?.blocks.list().find((b) => b.id === id);
              if (!h || !block) return;
              h.term.scrollToLine(block.line);
              h.term.focus();
            }}
            grip={{
              onPointerDown: beginMove("pane", tab.id, node.sid),
              onPointerMove: onMovePointer,
              onPointerUp: endMovePointer,
              onPointerCancel: cancelMove,
            }}
          />
          <div className="term-pane-body">
          <TerminalInstance
            // 다시 시작 = 제자리 재마운트. sid 는 그대로다 (→ restartPane).
            key={`${node.sid}:${restartNonce[node.sid] ?? 0}`}
            sessionId={node.sid}
            cwd={tab.cwd || projectRoot || ""}
            visible={isActiveTab}
            fontSize={fontSize}
            lineHeight={lineHeight}
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
            onShellState={(shell) => {
              setShellStates((prev) =>
                prev[node.sid] === shell ? prev : { ...prev, [node.sid]: shell },
              );
              const blocks = regRef.current.get(node.sid)?.blocks.list() ?? [];
              const pips = blocks
                .slice(-PIP_COUNT)
                .map((b) => ({ id: b.id, tone: blockTone(b), command: b.command }));
              setBlockPips((prev) => ({ ...prev, [node.sid]: pips }));
            }}
            onSignal={(signal) =>
              setPaneSignals((prev) =>
                prev[node.sid] === signal ? prev : { ...prev, [node.sid]: signal },
              )
            }
            onBlockActivate={setBlockMenu}
            onExit={() =>
              setEnded((prev) => (prev[node.sid] ? prev : { ...prev, [node.sid]: true }))
            }
            onFileRef={projectRoot ? setFileMenu : undefined}
          />
          {/* 끝난 셸 — 출력은 그대로 둔다 (읽고 복사할 수 있어야 한다). 아래에
              사실과 손잡이만 얹는다. */}
          {ended[node.sid] ? (
            <div className="term-ended" role="status">
              <span>{t("term.ended.title")}</span>
              <button
                type="button"
                className="ts-btn"
                onClick={() => restartPane(node.sid)}
                title={t("term.ended.restartHint")}
              >
                {t("term.ended.restart")}
              </button>
            </div>
          ) : null}
          </div>
        </div>
      );
    }
    const ratio = drag && drag.tabId === tab.id && drag.path === path ? drag.ratio : node.ratio;
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
    <div
      className={"term-wrap" + (compact ? " compact" : "") + (moving?.moved ? " is-moving" : "")}
      ref={rootRef}
      style={{ "--term-pane-pad": `${termPanePad(density)}px` } as React.CSSProperties}
    >
      <TerminalHeadBar
        railCollapsed={railCollapsed}
        onToggleRail={() => setSetting("terminalRailCollapsed", !railCollapsed)}
        activeTab={activeTab}
        onSearch={() => (searchOpen ? closeSearch() : openSearch())}
        onSplit={splitFocused}
        zoomed={
          zoomSid !== null &&
          activeTab !== null &&
          collectSids(panesOfTab(activeTab)).length > 1 &&
          collectSids(panesOfTab(activeTab)).includes(zoomSid)
        }
        onUnzoom={() => setZoomSid(null)}
        dragRegion={dragRegion}
      >
        {headerActions}
      </TerminalHeadBar>

      <div className="term-main">
        <TerminalRail
          tabs={terminalTabs}
          shellStates={shellStates}
          paneSignals={paneSignals}
          finished={finishedByTab}
          onJournalFromRun={(id) => {
            requestManualEntry();
            const tab = terminalTabs.find((candidate) => candidate.id === id);
            if (tab) dismissFinishedRun(focusOfTab(tab));
          }}
          onDismissFinished={(id) => {
            const tab = terminalTabs.find((candidate) => candidate.id === id);
            if (tab) dismissFinishedRun(focusOfTab(tab));
          }}
          activeId={terminalActiveId}
          collapsed={railCollapsed}
          renaming={renaming}
          onSelect={selectFromRail}
          onClose={closeTab}
          onAdd={addTab}
          drag={{
            movingId: moving?.moved ? (moving.kind === "tab" ? moving.tabId : null) : null,
            caretTop: moving?.moved ? (moving.rail?.top ?? null) : null,
            registerRail: (el) => {
              railElRef.current = el;
            },
            registerCard: (id, el) => {
              if (el) cardElsRef.current.set(id, el);
              else cardElsRef.current.delete(id);
            },
            onPointerDown: (id, e) => beginMove("tab", id)(e),
            onPointerMove: onMovePointer,
            onPointerUp: endMovePointer,
            onPointerCancel: cancelMove,
          }}
          onRenameStart={(id, label) => setRenaming({ id, draft: label })}
          onRenameChange={(draft) => setRenaming((prev) => (prev ? { ...prev, draft } : prev))}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRenaming(null)}
          onCardMenu={colorMenu.open}
        />
        {colorMenu.node}

        <div className="term-body" ref={bodyElRef}>
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              // 확대 중이면 그 페인을 품지 않은 칸을 CSS 로 숨긴다 (:has). 트리를
              // 다시 그리지 않으니 나머지 xterm 은 그 자리에서 계속 산다.
              className={
                "term-canvas" +
                (zoomSid && collectSids(panesOfTab(tab)).length > 1 && collectSids(panesOfTab(tab)).includes(zoomSid)
                  ? " zooming"
                  : "")
              }
              style={{ display: tab.id === terminalActiveId ? "flex" : "none" }}
            >
              {renderPane(tab, panesOfTab(tab), "")}
            </div>
          ))}
          {/* 놓으면 차지할 자리. 페인의 `::before`(상태 띠 z=4)·`::after`(포커스 링
            z=3)·`.pane-close`(z=5) 위에 와야 하므로 z-index 6 이다. */}
          {dropPreview && moving?.pane ? (
            // key 를 겨눈 자리로 준다 — 자리가 바뀌면 요소가 새로 태어나면서
            // 등장 애니메이션이 다시 돈다. 위치에 transition 을 거는 것과는
            // 다르다: 상자는 여전히 **즉시** 그 자리에 있고, 제자리에서 부풀 뿐이라
            // 화면을 가로질러 미끄러지는 자취가 남지 않는다.
            <div
              key={`${moving.pane.sid}:${moving.pane.edge}`}
              className="term-drop"
              style={dropPreview}
              aria-hidden="true"
            />
          ) : null}
          {searchOpen ? (
            <TerminalSearchBar
              query={query}
              setQuery={setQuery}
              matches={matches}
              setMatches={setMatches}
              focusedHandles={focusedHandles}
              searchOptions={searchOptions}
              runSearch={runSearch}
              closeSearch={closeSearch}
            />
          ) : null}
        </div>
      </div>

      {fileMenu && projectRoot ? (
        <TerminalFileMenu
          hit={fileMenu}
          projectRoot={projectRoot}
          externalEditorCommand={settings.externalEditorCommand}
          onClose={() => setFileMenu(null)}
        />
      ) : null}

      {blockMenu ? (
        <TerminalBlockMenu
          activation={blockMenu}
          projectId={runtime.currentProjectId}
          onClose={() => setBlockMenu(null)}
          onFill={(command) => {
            const sid = activeTab ? focusOfTab(activeTab) : null;
            if (!sid) return;
            // 개행 없이 그대로 쓴다 — 실행은 사람이 Enter 로 (디스패치 프리필과
            // 같은 규약). `writeDispatchTo` 는 안 쓴다: 저쪽은 전경 프로세스를
            // 보고 에이전트면 프롬프트로 붙여넣는 다른 계약이다.
            void commands.writeToPty(sid, command).then((res) => {
              if (res.status === "error") toast.destructive(res.error);
            });
          }}
        />
      ) : null}

      <TerminalStatusBar
        compact={compact}
        crumb={formatCwdCrumb(focusedShell?.cwd ?? null, projectRoot) || activeTab?.label || "—"}
        crumbTitle={focusedShell?.cwd ?? undefined}
        density={density}
        onDensity={(d) => setSetting("terminalDensity", clampTermDensity(d))}
        fontSize={fontSize}
        fontDraft={fontDraft}
        setFontDraft={setFontDraft}
        setFont={setFont}
        fontDelta={fontDelta}
        commitFontDraft={commitFontDraft}
        watchColor={watchColor}
        watchLabel={watchLabel}
      />
      {/* 손에 들린 것 (→ terminalSurface/TerminalGhost). */}
      {ghostLabel == null ? null : (
        <TerminalGhost label={ghostLabel} ghostElRef={ghostElRef} snapGhost={snapGhost} />
      )}
      {/* 「돌고 있는데 정말 닫나요」 — ⌘W·페인 ×·레일 × 가 같은 창을 쓴다. */}
      {confirmDialog}
    </div>
  );
}

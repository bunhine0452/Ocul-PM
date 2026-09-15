import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
// 코드 화면 (13번째 ui_v2 화면) — 프로젝트 파일을 앱 안에서 열어 보고 고친다
// (docs/code-editor/00-master-plan.md · .oculpm/planner/ide-completion.md).
// 좌: 필터·조작 가능한 파일 트리 / 우: 탭 바 + 편집 창 (1개 또는 좌우 2분할).
//
// 이 파일이 소유하는 것: **트리**(지연 로딩 캐시·필터·펼침)와 **탭 목록**(어떤
// 파일이 어느 창에 열렸는가), 그리고 **파일 조작**(만들기·이름 바꾸기·삭제·이동).
// 편집 자체 — 버퍼·저장·충돌·커서·LSP — 는 창 하나가 통째로 가져간다(CodePane).
//
// 조작이 여기 있는 이유: 파일이 없어지거나 이름이 바뀌면 **탭과 버퍼가 따라
// 움직여야** 하는데, 그 둘을 다 보는 자리가 여기뿐이다.
//
// 훅·하위 컴포넌트는 `codeScreen/` 에 책임별로 갈라 두었다 (optimization-round-2
// {#split-codescreen}): 트리(`useCodeTree`·`useTreeInteraction`·`CodeSidebar`)·
// 탭(`useCodeTabs`·`useClosedTabs`)·심볼/진단 피드·단축키·패널 높이·다이얼로그 둘.
// 순수 이동이며 동작 변경은 없다 — 상태·effect 순서·DOM 은 그대로다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CodeQuickOpen } from "./CodeQuickOpen";
import { flattenFiles } from "./quickOpenModel";
import { useGitMarks } from "./gitDecor";
import { groupByFile } from "./problemsModel";
import { isProsePath } from "./codeLang";
import { CodeToolbar } from "./CodeToolbar";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { t, useT } from "@/i18n";

import { useCodeImport } from "./useCodeImport";
import { useTreeDrag } from "./useTreeDrag";
import { useFileOps } from "./useFileOps";
import { actionTargets, type Marks } from "./treeSelection";
import type { TreeHit } from "./importTarget";
import { CodePane, CodeEmptyState } from "./CodePane";
import { CodeContextMenu, type CodeMenuItem } from "./CodeContextMenu";
import { CodeGoto } from "./CodeGoto";
import { countLines } from "./gotoModel";
import { CodeDebugPanel } from "./CodeDebugPanel";
import { useDebug } from "./useDebug";
import { adapterLanguageFor, defaultProgramFor } from "./debugConfig";
import { CodeReferences, type ReferencesQuery } from "./CodeReferences";
import { CodeProblems } from "./CodeProblems";
import { useProblems } from "./problemsStore";
import { useTreeWatch } from "./useTreeWatch";
import {
  activateTab,
  closeTab,
  focusPane,
  focusedPath,
  moveTabToOtherPane,
  openFile,
  pinTab,
  splitEditor,
  unsplitEditor,
} from "./codeTabs";
import { baseName } from "./fileOps";
import { bufferKey, getBuffer } from "./codeBuffers";
import { useCodeTabs } from "./codeScreen/useCodeTabs";
import { useDocumentSymbols } from "./codeScreen/useDocumentSymbols";
import { useProblemsFeed } from "./codeScreen/useProblemsFeed";
import { useCodeTree } from "./codeScreen/useCodeTree";
import { useClosedTabs } from "./codeScreen/useClosedTabs";
import { useCodeScreenKeys } from "./codeScreen/useCodeScreenKeys";
import { useTreeInteraction } from "./codeScreen/useTreeInteraction";
import { usePanelResize } from "./codeScreen/usePanelResize";
import { CodeSidebar } from "./codeScreen/CodeSidebar";
import { DebugLaunchDialog, type LaunchForm } from "./codeScreen/DebugLaunchDialog";
import { DeleteConfirmDialog } from "./codeScreen/DeleteConfirmDialog";
import "./code.css";
import "./code-frame.css";

/** 다른 화면(검색·코드맵)에서 넘어온 열기 목표 — one-shot 핸드오프. */
export interface CodeOpenTarget {
  path: string;
  /** 1-based. null 이면 파일만 연다. */
  line: number | null;
  /** 같은 파일·같은 라인의 연속 점프도 effect 가 다시 돌도록 하는 구분자. */
  nonce: number;
}

interface CodeScreenV2Props {
  projectId: number;
  projectRoot: string | null;
  openTarget: CodeOpenTarget | null;
  onOpenTargetConsumed: () => void;
}

export function CodeScreenV2({
  projectId,
  projectRoot,
  openTarget,
  onOpenTargetConsumed,
}: CodeScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  const { settings } = useSettings();

  // ── 전역 검색 (#project-search) ─────────────────────────────────────────
  // 사이드바 자리를 파일 트리와 나눠 쓴다 (VS Code 의 액티비티 바 전환처럼).
  // 모드는 휘발 — 재시작 후 검색 패널이 빈 채로 살아나는 것보다 트리가 낫다.
  const [sidebarMode, setSidebarMode] = useState<"files" | "search">("files");
  const [searchFocusSeq, setSearchFocusSeq] = useState(0);
  const openSearch = useCallback(() => {
    setState((prev) => (prev.codeSidebarHidden ? { ...prev, codeSidebarHidden: false } : prev));
    setSidebarMode("search");
    setSearchFocusSeq((n) => n + 1);
  }, [setState]);

  // ── Phase 2 — 아웃라인 · 참조 ───────────────────────────────────────────
  //
  // 둘 다 **화면**이 소유한다. 아웃라인은 사이드바(트리 아래)에, 참조는 편집
  // 영역 아래 전체 폭에 앉으므로 창(pane) 바깥이어야 하고, 분할 중에도 하나씩만
  // 떠야 한다.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  // 이동 위젯(⇧⌘O · ⌃G)이 열릴 때 읽어야 하는 값 — keydown 클로저는 렌더보다
  // 오래 산다.
  const cursorLineRef = useRef(cursorLine);
  cursorLineRef.current = cursorLine;
  const [references, setReferences] = useState<ReferencesQuery | null>(null);
  // 문제 패널 — 참조와 **같은 자리**를 쓴다. 열면 서로를 닫는다 (숨은 패널이
  // 남으면 "아까 그건 어디 갔지" 가 된다).
  const [problemsOpen, setProblemsOpen] = useState(false);
  const problems = useProblems(projectId);
  // git 상태 장식 — 저장·워처·파일 조작 뒤에 다시 읽는다 (`gitDecor` 가 디바운스).
  const gitDecor = useGitMarks(projectId);
  const refreshGitMarks = gitDecor.refresh;
  // 디버그 — 참조 패널과 같은 자리를 쓴다 (둘이 동시에 뜨면 편집 영역이 없어진다).
  const [debugOpen, setDebugOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const debug = useDebug(projectId);
  // 실행 구성 — 영속하지 않는다. v1 은 "이번에 무엇을 띄울지" 만 묻고, 다음
  // 실행에는 다시 그럴듯한 기본값을 채워 준다 (구성 파일은 Phase 3 밖).
  const [launchForm, setLaunchForm] = useState<LaunchForm>({
    language: "rust",
    program: "",
    args: "",
    stopOnEntry: false,
  });
  /**
   * 파일 안에서 이동 (#p3-goto). 열려 있는 동안만 값이 있고, 그 안에 **열던
   * 순간**의 커서 줄과 줄 수를 담는다 — Esc 되돌리기와 줄 번호 상한은 그때의
   * 문서를 기준으로 해야 한다.
   */
  const [gotoState, setGotoState] = useState<{
    lineMode: boolean;
    originLine: number;
    lineCount: number;
  } | null>(null);

  // ── 탭 ──────────────────────────────────────────────────────────────────
  const {
    tabs,
    setTabs,
    tabsRef,
    dirtyPaths,
    jump,
    paneRefs,
    selected,
    openPaths,
    refreshDirtyPaths,
    openPath,
    jumpInFocusedPane,
    openPathsRecent,
    pinPath,
  } = useCodeTabs({
    projectId,
    persistedTabs: state.codeTabs,
    previewTabs: settings.codePreviewTabs,
    setState,
  });

  // 아웃라인은 **접혀 있으면 묻지 않는다** — rust-analyzer 에 파일을 열 때마다
  // documentSymbol 을 던지는 것은 안 보는 패널을 위한 비용이다. 이동 위젯과
  // 스티키 스크롤도 같은 목록을 쓰므로(새 커맨드 없음) 그때는 접혀 있어도
  // 묻는다 — 스티키는 켜 두면 늘 보이는 물건이라 그 비용이 값을 한다.
  // 2026-09-11: 브레드크럼이 커서가 든 심볼을 늘 보여 주므로 파일이 열려 있으면
  // 항상 묻는다. 서버가 없는 파일은 빈 답이 즉시 온다 (비용은 열 때 한 번 +
  // 저장·포맷 때).
  const symbolsWanted = outlineOpen || gotoState != null || settings.codeStickyScroll || selected != null;
  const { symbols, symbolsLoading, setSymbolEpoch } = useDocumentSymbols({
    projectId,
    selected,
    wanted: symbolsWanted,
  });

  /**
   * 창이 버퍼를 건드렸다.
   *
   * **반드시 안정된 신원이어야 한다.** 인라인 화살표로 넘기면 매 렌더마다 새
   * 함수가 되고, 그것에 매달린 `CodePane.loadFile` 이 재생성되면서 그 effect 가
   * 파일을 디스크에서 다시 읽는다 — 미저장 편집이 조용히 사라진다.
   */
  const handleBuffersChanged = useCallback(() => {
    refreshDirtyPaths();
    // 저장·포맷으로 본문이 바뀌면 구조도 바뀐다. 아웃라인이 접혀 있으면
    // effect 가 조회를 건너뛰므로 여기서 조건을 따지지 않는다.
    setSymbolEpoch((n) => n + 1);
    refreshGitMarks();
  }, [refreshDirtyPaths, refreshGitMarks, setSymbolEpoch]);

  // 워크스페이스 진단 모으기 (#p5-problems).
  useProblemsFeed(projectId);

  /** 패널 자리는 하나다 — 여는 쪽이 상대를 닫는다. */
  const openProblems = useCallback(() => {
    setReferences(null);
    setProblemsOpen(true);
  }, []);

  // ── 트리 ────────────────────────────────────────────────────────────────
  const {
    tree,
    treeStatus,
    treeError,
    dirCache,
    loadingDirs,
    expanded,
    setExpanded,
    filter,
    setFilter,
    loadDir,
    refreshTree,
    loadTree,
    filtering,
    childrenOf,
    expandedForRender,
    revealDir,
    treeOrder,
  } = useCodeTree({ projectId, tabsRef, setTabs, selected, refreshDirtyPaths });

  // ── ⌘P 빠른 열기 · ⌥Z 줄바꿈 · ⌘B 사이드바 (2026-09-11 IDE 라운드) ──
  const [quickOpen, setQuickOpen] = useState(false);
  const wordWrapMode = state.codeWordWrap ?? "auto";
  const wordWrapFor = useCallback(
    (path: string | null) =>
      wordWrapMode === "auto" ? (path != null && isProsePath(path)) : wordWrapMode === "on",
    [wordWrapMode],
  );
  const toggleWordWrap = useCallback(() => {
    const now = wordWrapFor(focusedPath(tabsRef.current));
    setState((prev) => ({ ...prev, codeWordWrap: now ? "off" : "on" }));
  }, [wordWrapFor, setState, tabsRef]);
  const sidebarHidden = state.codeSidebarHidden === true;
  const toggleSidebar = useCallback(() => {
    setState((prev) => ({ ...prev, codeSidebarHidden: !prev.codeSidebarHidden }));
  }, [setState]);
  const problemMarks = useMemo(() => {
    const out = new Map<string, "error" | "warning">();
    for (const file of groupByFile(problems)) {
      if (file.counts.error > 0) out.set(file.path, "error");
      else if (file.counts.warning > 0) out.set(file.path, "warning");
    }
    return out;
  }, [problems]);
  const quickOpenFiles = useMemo(() => (tree ? flattenFiles(tree.nodes) : []), [tree]);
  const quickOpenFilesRef = useRef(quickOpenFiles);
  quickOpenFilesRef.current = quickOpenFiles;

  /**
   * 파일 안 이동을 연다. `lineMode` 면 `:` 를 채워 (⌃G) 연다.
   *
   * 이미 열려 있으면 아무것도 하지 않는다 — 위젯 안에서 `:` 한 글자로 모드를
   * 바꿀 수 있어서, 다시 여는 것은 방금 친 질의만 지운다.
   */
  const openGoto = useCallback(
    (lineMode: boolean) => {
      const path = focusedPath(tabsRef.current);
      if (!path) return;
      const text = getBuffer(bufferKey(projectId, path))?.text;
      setGotoState((prev) =>
        prev
          ? prev
          : {
              lineMode,
              originLine: cursorLineRef.current,
              // 버퍼가 아직 없으면(로드 중) 0 — 상한을 모른다는 뜻이다.
              lineCount: text == null ? 0 : countLines(text),
            },
      );
    },
    [projectId, tabsRef],
  );

  // 다른 화면(검색·코드맵)에서 온 열기 목표.
  useEffect(() => {
    if (!openTarget) return;
    openPath(openTarget.path, openTarget.line);
    onOpenTargetConsumed();
  }, [openTarget, onOpenTargetConsumed, openPath]);

  // ── 탭 키보드 UX (#tab-keys) ────────────────────────────────────────────
  //
  // 가시성 앵커. 프로젝트 탭은 배경에서도 마운트된 채라(Chrome 식) 이 화면이
  // 창에 여럿 살아 있을 수 있다 — 레이아웃 상자가 있는 쪽만 입력을 받는다
  // (AcpConversation 의 ⌘W 처리와 같은 잣대).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isVisible = useCallback(() => (rootRef.current?.getClientRects().length ?? 0) > 0, []);

  const { closedStackRef, closeTabTracked, closeOthersTracked, reopenClosedTab } = useClosedTabs({
    projectId,
    tabsRef,
    setTabs,
    openPath,
    isVisible,
  });

  // ── 파일 조작 ───────────────────────────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number; items: CodeMenuItem[] } | null>(null);

  /** 조작 후 갈아끼울 트리 자리들. 지연 캐시는 해당 폴더만, 전량 트리는 조용히. */
  const reloadAfterOp = useCallback(
    (...dirs: string[]) => {
      for (const dir of new Set(dirs)) loadDir(dir, true);
      refreshTree(true);
    },
    [loadDir, refreshTree],
  );

  // 밖에서 벌어진 변화도 같은 자리로 갚는다 — ⟳ 를 누르지 않아도.
  //
  // 위 `reloadAfterOp` 는 **앱 안에서 한 조작**만 갚는다. 그런데 이 앱에서
  // 파일을 만들고 지우는 것은 대개 밖에 있는 에이전트다. 그쪽 변화는 워처가
  // 알려 주므로, 열린 파일 본문이 이미 스스로 최신화되듯(CodePane) 트리도 같이
  // 간다. 캐시는 매 렌더 바뀌니 ref 로 넘긴다 — 폴더 하나 펼칠 때마다 구독을
  // 다시 걸 이유는 없다.
  const dirCacheRef = useRef(dirCache);
  dirCacheRef.current = dirCache;
  useTreeWatch({
    projectId,
    cachedDirs: () => dirCacheRef.current,
    onStale: (dirs) => {
      reloadAfterOp(...dirs);
      refreshGitMarks();
    },
  });

  /**
   * 트리 다중 선택 — 열려 있는 파일(`selected`)과는 **다른 것**이다.
   *
   * `selected` 는 "지금 보고 있는 파일" 이고 탭에서 온다. 이쪽은 "지금 손대려고
   * 뽑아 둔 것들" 이라 여러 개일 수 있고 폴더도 들어간다. 둘을 한 상태로 합치면
   * 파일 열 개를 뽑아 둔 채로는 어느 것을 편집 중인지 말할 수 없게 된다.
   */
  const [marks, setMarks] = useState<Marks>(() => new Map());
  /** ⇧ 범위의 시작점. 마지막으로 **직접** 누른 행이다. */
  const [markAnchor, setMarkAnchor] = useState<string | null>(null);
  const clearMarks = useCallback(() => {
    setMarks(new Map());
    setMarkAnchor(null);
  }, []);

  const ops = useFileOps({
    projectId,
    rootName: projectRoot ? baseName(projectRoot) : "",
    tabsRef,
    setTabs,
    setExpanded,
    refreshDirtyPaths,
    reloadAfterOp,
    loadDir,
    openPath,
    clearMarks,
  });
  const { draft, startCreate, startRename, askDelete, pendingDelete, deleting } = ops;

  /**
   * 트리가 지금 서 있는 자리 — 키보드 포커스이자, 커서가 없는 ⌘X/⌘V 의 기준이다.
   *
   * 폴더는 눌러도 "선택"이 되지 않고 펼쳐지기만 한다(탭이 열리는 것은 파일뿐).
   * 그래서 `assets/` 를 누르고 ⌘V 를 치면 열려 있던 파일의 폴더로 들어가 버린다 —
   * 눌러 둔 곳이 아니라. 그 어긋남을 여기서 메우고, 화살표 이동도 같은 값을
   * 옮긴다 (손과 키보드가 서로 다른 '지금 자리'를 갖지 않게).
   */
  const [treeFocus, setTreeFocus] = useState<TreeHit | null>(null);

  // Finder → 트리 파일 들여오기 (드래그 드롭 · ⌘V). 가져온 자리를 펼쳐 두는
  // 것까지가 한 동작이다 — 어디에 들어갔는지 눈으로 확인되지 않으면 반쪽이다.
  const handleImported = useCallback(
    (destDir: string) => {
      if (destDir) setExpanded((prev) => (prev.has(destDir) ? prev : new Set(prev).add(destDir)));
      reloadAfterOp(destDir);
    },
    [reloadAfterOp, setExpanded],
  );
  const { dropDir, pasteFiles } = useCodeImport({
    projectId,
    isVisible,
    // 트리에서 누른 자리가 우선, 없으면 보고 있는 파일의 폴더.
    selected: treeFocus ?? (selected ? { path: selected, isDir: false } : null),
    rootName: projectRoot ? baseName(projectRoot) : "",
    onImported: handleImported,
  });

  /** 이 행에 건 조작이 실제로 데려가는 것들 — 뽑아 둔 것 안에서 잡았으면 전부. */
  const targetsFor = useCallback(
    (path: string, isDir: boolean) => actionTargets(marks, path, isDir),
    [marks],
  );
  /** 같은 것을 경로만으로 (드래그는 폴더 여부를 백엔드에게 묻는다). */
  const dragPayload = useCallback(
    (path: string) => targetsFor(path, marks.get(path) ?? false).map((m) => m.path),
    [targetsFor, marks],
  );

  const treeIsEmpty = (childrenOf("") ?? []).length === 0 && !loadingDirs.has("") && !draft;

  /** 트리 행과의 상호작용 — 클릭·키보드 표면·로빙 tabindex·우클릭 메뉴. */
  const { clickRow, treeFocusPath, cut, cutFrom, pasteHere, onTreeKeyDown, openTreeMenu } =
    useTreeInteraction({
      treeOrder,
      expandedForRender,
      treeFocus,
      setTreeFocus,
      setExpanded,
      loadDir,
      setMarks,
      markAnchor,
      setMarkAnchor,
      clearMarks,
      targetsFor,
      openPath,
      startCreate,
      startRename,
      askDelete,
      moveInto: ops.moveInto,
      pasteFiles,
      selected,
      tabsRef,
      setMenu,
    });

  // 화면 단축키 — 이 화면이 보일 때만 (목록은 `useCodeScreenKeys` 머리말에).
  useCodeScreenKeys({
    isVisible,
    tabsRef,
    setTabs,
    quickOpenFilesRef,
    setQuickOpen,
    openGoto,
    toggleWordWrap,
    toggleSidebar,
    reopenClosedTab,
    openSearch,
    pasteHere,
    cutFrom,
    startCreate,
  });

  /** 트리 안 드래그 이동 — 놓는 순간 이름 바꾸기(=이동)로 합류한다. */
  const treeDrag = useTreeDrag({
    onMove: (from, toDir) => ops.moveInto(dragPayload(from), toDir),
    payloadOf: dragPayload,
    onSpringOpen: (dir) => {
      setExpanded((prev) => (prev.has(dir) ? prev : new Set(prev).add(dir)));
      loadDir(dir);
    },
    isExpanded: (dir) => expandedForRender.has(dir),
  });

  const isSplit = tabs.panes.length > 1;
  const focusedDirty = selected != null && dirtyPaths.has(selected);

  // ── 트리 사이드바 좌/우 (#sidebar-side) ────────────────────────────────
  // 알 수 없는 영속값은 왼쪽으로 — 렌더는 "right" 하나만 특별 취급한다.
  const sidebarOnRight = state.codeSidebarSide === "right";
  const toggleSidebarSide = useCallback(() => {
    setState((prev) => ({
      ...prev,
      codeSidebarSide: prev.codeSidebarSide === "right" ? "left" : "right",
    }));
  }, [setState]);

  // ── 하단 패널 높이 (#panel-resize) ─────────────────────────────────────
  const {
    panelHeight,
    clampPanelHeight,
    persistPanelHeight,
    onResizerPointerDown,
    onResizerPointerMove,
    onResizerPointerUp,
  } = usePanelResize({ persistedPanelHeight: state.codePanelHeight, setState });

  // 트리 사이드바 — 좌/우 어느 쪽이든 **DOM 순서를 화면 순서와 같게** 두 자리
  // 중 한 곳에 렌더한다 (터미널 도크와 같은 원칙: row-reverse 로 뒤집으면
  // Tab 이동이 눈에 보이는 차례와 어긋난다).
  // 검색 모드에서는 같은 자리를 검색 패널이 통째로 가져간다.
  const sidebarEl = (
    <CodeSidebar
      projectId={projectId}
      sidebarOnRight={sidebarOnRight}
      sidebarMode={sidebarMode}
      onCloseSearch={() => setSidebarMode("files")}
      searchOpts={state.codeSearchOpts}
      onSearchOptsChange={(next) => setState((prev) => ({ ...prev, codeSearchOpts: next }))}
      searchFocusSeq={searchFocusSeq}
      dirtyPaths={dirtyPaths}
      openPath={openPath}
      filter={filter}
      onFilterChange={setFilter}
      onOpenSearch={openSearch}
      onNewFile={() => startCreate("", false)}
      onNewFolder={() => startCreate("", true)}
      onToggleSide={toggleSidebarSide}
      rootName={state.currentProjectName || (projectRoot ? baseName(projectRoot) : "")}
      canCollapse={expanded.size > 0 && !filtering}
      onCollapseAll={() => setExpanded(new Set())}
      truncated={tree?.truncated === true}
      treeIsEmpty={treeIsEmpty}
      filtering={filtering}
      childrenOf={childrenOf}
      loadingDirs={loadingDirs}
      selected={selected}
      expandedForRender={expandedForRender}
      openPaths={openPaths}
      gitMarks={gitDecor.marks}
      problemMarks={problemMarks}
      draft={draft}
      marks={marks}
      treeFocusPath={treeFocusPath}
      cut={cut}
      onTreeKeyDown={onTreeKeyDown}
      onClickRow={clickRow}
      // 더블클릭은 고정 — 첫 클릭이 이미 열었으므로 승격만 하면 된다.
      onPin={(path) => pinPath(tabsRef.current.focused, path)}
      onDraftSubmit={ops.submitDraft}
      onDraftCancel={ops.cancelDraft}
      onContextMenu={openTreeMenu}
      treeDrag={treeDrag}
      dropDir={dropDir}
      symbols={symbols}
      symbolsLoading={symbolsLoading}
      outlineOpen={outlineOpen}
      cursorLine={cursorLine}
      onToggleOutline={() => setOutlineOpen((v) => !v)}
    />
  );

  return (
    <>
      <CodeToolbar
        selected={selected}
        focusedDirty={focusedDirty}
        canOpenExternal={projectRoot != null}
        sidebarHidden={sidebarHidden}
        debugOpen={debugOpen}
        onToggleSidebar={toggleSidebar}
        onOpenExternal={() => paneRefs[tabs.focused]?.current?.openExternal()}
        onToggleDebug={() => setDebugOpen((v) => !v)}
        onRun={() => {
          // 지금 파일에서 그럴듯한 첫 값을 채운다 — 대개 그대로 눌러서 되고,
          // 아니면 고치면 된다 (자동 빌드는 하지 않기로 했다).
          const language = adapterLanguageFor(selected) ?? launchForm.language;
          setLaunchForm((prev) => ({
            ...prev,
            language,
            program: prev.program || defaultProgramFor(language, selected, state.currentProjectName),
          }));
          setLaunchOpen(true);
        }}
        onFormat={() => paneRefs[tabs.focused]?.current?.format()}
        onSave={() => paneRefs[tabs.focused]?.current?.save()}
        onRefresh={loadTree}
      />

      {treeStatus === "loading" ? (
        <div className="scroll" ref={rootRef}>
          <div className="page">
            <SkeletonList rows={8} height={22} gap={6} />
          </div>
        </div>
      ) : treeStatus === "error" ? (
        <div className="scroll" ref={rootRef}>
          <div className="page fade-in">
            <EmptyState>{t("code.listFailed")}<br />{treeError}</EmptyState>
          </div>
        </div>
      ) : (
        <div className="code-body" ref={rootRef}>
          {sidebarOnRight || sidebarHidden ? null : sidebarEl}

          <div className="code-editors">
            <div className={"code-main" + (isSplit ? " split" : "")}>
            {tabs.panes.map((pane, index) => (
              <CodePane
                key={index}
                ref={paneRefs[index]}
                projectId={projectId}
                projectRoot={projectRoot}
                paneIndex={index}
                tabs={pane.tabs}
                activePath={pane.active}
                isFocused={tabs.focused === index}
                isSplit={isSplit}
                // 백엔드는 (프로젝트, 파일) 로 문서를 하나만 연다 — 같은 파일이
                // 양쪽에 열리면 오른쪽 창은 서버를 붙이지 않는다 (CodePane 주석).
                lspEnabled={index === 0 || pane.active !== tabs.panes[0].active}
                jump={
                  jump && jump.pane === index
                    ? {
                        line: jump.line,
                        ch: jump.ch,
                        len: jump.len,
                        focus: jump.focus,
                        nonce: jump.nonce,
                      }
                    : null
                }
                dirtyPaths={dirtyPaths}
                // 설정을 끄면 그 자리에서 기울임·"고정" 메뉴가 사라진다 — 남아
                // 있던 미리보기 값은 닫히거나 고정될 때 알아서 비워진다.
                previewPath={settings.codePreviewTabs ? pane.preview : null}
                onPinTab={(path) => pinPath(index, path)}
                onFocus={() => setTabs((prev) => focusPane(prev, index))}
                onActivate={(path) => setTabs((prev) => activateTab(prev, index, path))}
                onClose={(path) => closeTabTracked(index, path)}
                onCloseOthers={(path) => closeOthersTracked(index, path)}
                onReopenClosed={reopenClosedTab}
                canReopen={closedStackRef.current.length > 0}
                onSplit={() => setTabs(splitEditor)}
                onUnsplit={() => setTabs(unsplitEditor)}
                onMoveToOtherPane={(path) => setTabs((prev) => moveTabToOtherPane(prev, index, path))}
                // 드롭으로 옮긴 탭도 고정이다 — 창을 옮긴 것은 "계속 볼 것" 이라는
                // 신호이고, moveTabToOtherPane 과 같은 판정이어야 한다.
                onDropTab={(fromPane, path) =>
                  setTabs((prev) =>
                    fromPane === index
                      ? prev
                      : closeTab(pinTab(openFile(prev, path, index), index, path), fromPane, path),
                  )
                }
                onBuffersChanged={handleBuffersChanged}
                onOpenPath={(path, line) => openPath(path, line, index)}
                onReferences={(query) => {
                  setProblemsOpen(false);
                  setReferences(query);
                }}
                onCursorLine={setCursorLine}
                // 스티키는 아웃라인과 **같은 값**을 쓴다. 꺼져 있으면 안 내려보낸다.
                // 브레드크럼이 늘 쓰고, 스티키는 CodeEditor 가 설정으로 켜고 끈다.
                stickySymbols={symbols}
                onGoToSymbol={() => openGoto(false)}
                onGoToLine={() => openGoto(true)}
                wordWrap={wordWrapFor(pane.active)}
                onToggleWordWrap={toggleWordWrap}
                gitMarks={gitDecor.marks}
                problemMarks={problemMarks}
                onOpenProblems={openProblems}
                breakpointsFor={debug.breakpointsFor}
                unverifiedFor={debug.unverifiedFor}
                onToggleBreakpoint={debug.toggleBreakpoint}
                onRevealDir={revealDir}
              />
            ))}
              {tabs.panes.length === 0 ? <CodeEmptyState /> : null}
            </div>
            {/* 참조와 디버그는 같은 자리를 쓴다 — 둘 다 띄우면 편집 영역이
                남지 않는다. 디버그가 이긴다 (멈춰 있는 동안이 더 급하다). */}
            {debugOpen || problemsOpen || references ? (
              <div
                className="code-panel-resizer"
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("code.panel.resize")}
                tabIndex={0}
                onPointerDown={onResizerPointerDown}
                onPointerMove={onResizerPointerMove}
                onPointerUp={onResizerPointerUp}
                onKeyDown={(e) => {
                  // 키보드로도 조절된다 — 드래그만 있으면 separator 는 장식이다.
                  if (e.key === "ArrowUp") persistPanelHeight(clampPanelHeight(panelHeight + 24));
                  else if (e.key === "ArrowDown")
                    persistPanelHeight(clampPanelHeight(panelHeight - 24));
                }}
              />
            ) : null}
            {debugOpen ? (
              <div className="code-panel-slot" style={{ height: panelHeight }}>
                <CodeDebugPanel
                  session={debug.session}
                  frames={debug.frames}
                  selectedFrameId={debug.selectedFrameId}
                  scopeRoots={debug.scopeRoots}
                  output={debug.output}
                  onSelectFrame={debug.selectFrame}
                  onControl={debug.control}
                  onStop={debug.stop}
                  onClose={() => setDebugOpen(false)}
                  onClearOutput={debug.clearOutput}
                  onOpenFrame={(path, line) => openPath(path, line)}
                  loadVariables={debug.variables}
                />
              </div>
            ) : problemsOpen ? (
              <div className="code-panel-slot" style={{ height: panelHeight }}>
                <CodeProblems
                  problems={problems}
                  onClose={() => setProblemsOpen(false)}
                  // 코드 이동이므로 **고정 탭**으로 연다 (미리보기 표와 같은 판정).
                  onOpen={(path, line, character) =>
                    openPath(path, line, undefined, { ch: character })
                  }
                />
              </div>
            ) : references ? (
              <div className="code-panel-slot" style={{ height: panelHeight }}>
                <CodeReferences
                  query={references}
                  onClose={() => setReferences(null)}
                  onOpen={(path, line) => openPath(path, line + 1)}
                />
              </div>
            ) : null}
          </div>

          {sidebarOnRight && !sidebarHidden ? sidebarEl : null}

          {/* 파일 안 이동 — `.code-body` 안에 둔다. 오버레이는 position:fixed 라
              자리를 차지하지 않고, 여기 있어야 화면 스코프의 --code-* 토큰
              (심볼 종류 점)이 산다. */}
          {quickOpen ? (
            <CodeQuickOpen
              files={quickOpenFiles}
              truncated={tree?.truncated === true}
              openPaths={openPathsRecent}
              dirtyPaths={dirtyPaths}
              onOpen={(path) => {
                openPath(path, null);
                pinPath(tabsRef.current.focused, path);
              }}
              onClose={() => setQuickOpen(false)}
            />
          ) : null}
          {gotoState ? (
            <CodeGoto
              symbols={symbols}
              symbolsLoading={symbolsLoading}
              lineCount={gotoState.lineCount}
              originLine={gotoState.originLine}
              lineMode={gotoState.lineMode}
              onJump={jumpInFocusedPane}
              onClose={() => setGotoState(null)}
            />
          ) : null}
        </div>
      )}

      {menu ? (
        <CodeContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          label={t("code.treeAria")}
          onClose={() => setMenu(null)}
        />
      ) : null}

      <DebugLaunchDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        form={launchForm}
        setForm={setLaunchForm}
        start={debug.start}
        onStarted={() => {
          setLaunchOpen(false);
          setDebugOpen(true);
        }}
      />

      <DeleteConfirmDialog
        pendingDelete={pendingDelete}
        deleting={deleting}
        dirtyPaths={dirtyPaths}
        onCancel={() => ops.setPendingDelete(null)}
        onConfirm={ops.confirmDelete}
      />
    </>
  );
}

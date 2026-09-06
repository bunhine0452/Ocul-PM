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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import {
  RefreshCw,
  Save,
  ExternalLink,
  Search,
  FilePlus,
  FolderPlus,
  AlignLeft,
  Bug,
  Play,
  PanelLeft,
  PanelRight,
  TextSearch,
} from "@/components/Icons";
import { commands, events, type CodeTree as CodeTreeData, type LspSymbol } from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { registerCloseHandler } from "@/lib/closeIntent";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { AppDialog } from "@/components/ui/AppDialog";

import { CodeTree } from "./CodeTree";
import { useCodeImport } from "./useCodeImport";
import { treeMenuItems } from "./treeMenu";
import { useTreeDrag } from "./useTreeDrag";
import { useFileOps } from "./useFileOps";
import { useTreeKeys } from "./useTreeKeys";
import {
  actionTargets,
  clickIntent,
  marksOf,
  rangeBetween,
  toggleMark,
  visibleEntries,
  type Marks,
} from "./treeSelection";
import type { TreeHit } from "./importTarget";
import { CodePane, CodeEmptyState, type CodePaneHandle } from "./CodePane";
import { CodeContextMenu, type CodeMenuItem } from "./CodeContextMenu";
import { CodeOutline } from "./CodeOutline";
import { CodeGoto } from "./CodeGoto";
import { countLines } from "./gotoModel";
import { CodeDebugPanel } from "./CodeDebugPanel";
import { useDebug } from "./useDebug";
import { adapterLanguageFor, defaultProgramFor, toLaunchRequest } from "./debugConfig";
import { CodeReferences, type ReferencesQuery } from "./CodeReferences";
import { CodeProblems } from "./CodeProblems";
import { problemsStore, useProblems } from "./problemsStore";
import { CodeSearchPanel } from "./CodeSearchPanel";
import {
  ancestorDirs,
  collectDirs,
  collectFiles,
  filterTree,
  flattenToDirMap,
  type DirMap,
} from "./treeUtils";
import { useTreeWatch } from "./useTreeWatch";
import {
  activateTab,
  allOpenPaths,
  closeOpenPath,
  closeOthers,
  closeTab,
  cycleTab,
  focusPane,
  focusedPath,
  moveTabToOtherPane,
  openFile,
  pinTab,
  sanitizeTabs,
  splitEditor,
  unsplitEditor,
  type CodeTabsState,
} from "./codeTabs";
import {
  baseName,
  parentDir,
} from "./fileOps";
import {
  bufferKey,
  getBuffer,
  listDirtyPaths,
} from "./codeBuffers";
import "./code.css";

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

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
};
const HINT: React.CSSProperties = {
  margin: "6px 0 12px",
  fontSize: 12,
  color: "var(--text-3)",
  lineHeight: 1.6,
};

/** ⇧⌘T 로 되살릴 수 있는 "닫은 탭" 기억의 상한 — 무한히 쌓을 이유가 없다. */
const CLOSED_STACK_MAX = 20;

export function CodeScreenV2({
  projectId,
  projectRoot,
  openTarget,
  onOpenTargetConsumed,
}: CodeScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  const { settings } = useSettings();

  // 트리 소스가 둘이다.
  //   · `dirCache` — 평소 탐색. `code_dir` 로 **펼친 폴더 한 단계씩** 읽고,
  //     무시된 항목까지 보여준다(흐리게). 한 번에 다 걷지 않는 이유는 무시를 끄면
  //     이 저장소만 해도 114,419 파일이라 어떤 상한에도 걸리기 때문.
  //   · `tree` — 필터 전용. 안 읽은 가지의 매치는 지연 로딩으로 찾을 수 없어서,
  //     gitignore 를 존중하는 전량 걸음을 그대로 남겨 검색에 쓴다.
  const [tree, setTree] = useState<CodeTreeData | null>(null);
  const [treeStatus, setTreeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [treeError, setTreeError] = useState<string | null>(null);
  const [dirCache, setDirCache] = useState<DirMap>(() => new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  // ── 탭 ──────────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<CodeTabsState>(() => sanitizeTabs(state.codeTabs));
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  // 여는 순간에 읽어야 하는 값들 — 콜백은 렌더보다 늦게 돌고, 여기서 낡은
  // 값을 쓰면 미저장 탭이 교체된다.
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;
  const previewTabsRef = useRef(true);
  previewTabsRef.current = settings.codePreviewTabs;
  // 창별 줄 점프 지시 — nonce 로 같은 줄의 연속 점프도 다시 발화시킨다.
  // ch/len (UTF-16) 이 있으면 그 범위를 선택한다 (전역 검색의 매치 표시).
  const [jump, setJump] = useState<{
    pane: number;
    line: number;
    ch?: number;
    len?: number;
    /** false 면 에디터가 포커스를 가져가지 않는다 (⇧⌘O 의 미리 점프). */
    focus?: boolean;
    nonce: number;
  } | null>(null);
  const jumpSeq = useRef(0);
  const paneRefs = [useRef<CodePaneHandle>(null), useRef<CodePaneHandle>(null)];

  const selected = focusedPath(tabs);
  const openPaths = useMemo(() => new Set(allOpenPaths(tabs)), [tabs]);

  // ── 전역 검색 (#project-search) ─────────────────────────────────────────
  // 사이드바 자리를 파일 트리와 나눠 쓴다 (VS Code 의 액티비티 바 전환처럼).
  // 모드는 휘발 — 재시작 후 검색 패널이 빈 채로 살아나는 것보다 트리가 낫다.
  const [sidebarMode, setSidebarMode] = useState<"files" | "search">("files");
  const [searchFocusSeq, setSearchFocusSeq] = useState(0);
  const openSearch = useCallback(() => {
    setSidebarMode("search");
    setSearchFocusSeq((n) => n + 1);
  }, []);

  // ── Phase 2 — 아웃라인 · 참조 ───────────────────────────────────────────
  //
  // 둘 다 **화면**이 소유한다. 아웃라인은 사이드바(트리 아래)에, 참조는 편집
  // 영역 아래 전체 폭에 앉으므로 창(pane) 바깥이어야 하고, 분할 중에도 하나씩만
  // 떠야 한다.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [symbols, setSymbols] = useState<LspSymbol[] | null>(null);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
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
  // 디버그 — 참조 패널과 같은 자리를 쓴다 (둘이 동시에 뜨면 편집 영역이 없어진다).
  const [debugOpen, setDebugOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const debug = useDebug(projectId);
  // 실행 구성 — 영속하지 않는다. v1 은 "이번에 무엇을 띄울지" 만 묻고, 다음
  // 실행에는 다시 그럴듯한 기본값을 채워 준다 (구성 파일은 Phase 3 밖).
  const [launchForm, setLaunchForm] = useState({
    language: "rust",
    program: "",
    args: "",
    stopOnEntry: false,
  });
  const [starting, setStarting] = useState(false);
  /** 저장·포맷 뒤 아웃라인을 다시 묻게 하는 신호. */
  const [symbolEpoch, setSymbolEpoch] = useState(0);
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

  // 탭 상태는 영속된다 (#tabs-persist). `codeTabs` 는 여기서만 쓰기 때문에
  // 되읽기 루프가 없다 — 초기값으로 한 번 읽고, 이후로는 이쪽이 진실이다.
  useEffect(() => {
    setState((prev) =>
      prev.codeTabs === tabs
        ? prev
        : { ...prev, codeTabs: tabs, codeActivePath: focusedPath(tabs) },
    );
  }, [tabs, setState]);

  const refreshDirtyPaths = useCallback(() => {
    setDirtyPaths(listDirtyPaths(projectId));
  }, [projectId]);

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
  }, [refreshDirtyPaths]);

  // 아웃라인은 **접혀 있으면 묻지 않는다** — rust-analyzer 에 파일을 열 때마다
  // documentSymbol 을 던지는 것은 안 보는 패널을 위한 비용이다. 이동 위젯과
  // 스티키 스크롤도 같은 목록을 쓰므로(새 커맨드 없음) 그때는 접혀 있어도
  // 묻는다 — 스티키는 켜 두면 늘 보이는 물건이라 그 비용이 값을 한다.
  const symbolsWanted = outlineOpen || gotoState != null || settings.codeStickyScroll;
  useEffect(() => {
    if (!symbolsWanted || !selected) {
      setSymbols(null);
      return;
    }
    let cancelled = false;
    setSymbolsLoading(true);
    void commands.lspDocumentSymbols(projectId, selected).then((res) => {
      if (cancelled) return;
      setSymbolsLoading(false);
      setSymbols(res.status === "ok" ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [symbolsWanted, selected, projectId, symbolEpoch]);

  /**
   * 워크스페이스 진단 모으기 (#p5-problems).
   *
   * 구독은 **창 최상위가 아니라 이 화면**이 한다 — 코드 화면을 한 번도 안 연
   * 창이 진단을 메모리에 쌓을 이유가 없다. 순서가 중요하다: 리스너를 먼저 걸고
   * 스냅샷을 부른다. 반대로 하면 그 사이에 온 갱신이 통째로 빈다.
   */
  useEffect(() => {
    const offs: Array<() => void> = [];
    let active = true;
    const keep = (off: () => void) => (active ? offs.push(off) : safeUnlisten(off));
    try {
      void events.lspDiagnosticsPublished
        .listen((e) => {
          if (e.payload.project_id !== projectId) return;
          problemsStore.applyPublished(e.payload);
        })
        .then(keep)
        .catch(() => {});
    } catch {
      /* jsdom / 비-Tauri — 라이브 갱신만 없다 */
    }
    void commands.lspDiagnosticsSnapshot(projectId).then((res) => {
      if (!active || res.status !== "ok" || !Array.isArray(res.data)) return;
      problemsStore.seed(projectId, res.data);
    });
    return () => {
      active = false;
      for (const off of offs) safeUnlisten(off);
      // 프로젝트를 바꾸면 비운다 — 안 하면 남의 프로젝트 진단이 섞인다.
      problemsStore.clearProject(projectId);
    };
  }, [projectId]);

  /** 패널 자리는 하나다 — 여는 쪽이 상대를 닫는다. */
  const openProblems = useCallback(() => {
    setReferences(null);
    setProblemsOpen(true);
  }, []);

  // ── 트리 ────────────────────────────────────────────────────────────────
  /** 디렉터리 한 단계를 읽어 캐시에 넣는다. 이미 읽었거나 읽는 중이면 무시. */
  const loadDir = useCallback(
    (dirPath: string, force = false) => {
      if (!force) {
        let already = false;
        setDirCache((prev) => {
          already = prev.has(dirPath);
          return prev;
        });
        if (already) return;
      }
      setLoadingDirs((prev) => {
        if (prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      void commands.codeDir(projectId, dirPath).then((res) => {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        if (res.status === "ok") {
          setDirCache((prev) => new Map(prev).set(dirPath, res.data.entries));
          if (res.data.truncated) toast.warning(t("code.tree.dirTruncated", { dir: dirPath || "/" }));
        } else {
          // 조용히 빈 폴더로 보이게 두지 않는다 — 읽기 실패는 말한다.
          toast.destructive(t("code.tree.dirFailed", { error: tError(res.error) }));
          setDirCache((prev) => new Map(prev).set(dirPath, []));
        }
      });
    },
    [projectId],
  );

  /**
   * 전량 트리(필터용)를 다시 읽는다.
   *
   * `silent` 는 파일 조작 뒤에 쓴다 — 파일 하나 만들 때마다 트리 전체가
   * "불러오는 중" 으로 깜빡이면 안 되지만, 방금 만든 파일이 필터에 안 걸리는
   * 것도 안 된다. 그래서 상태는 안 건드리고 결과만 갈아끼운다.
   */
  const refreshTree = useCallback(
    (silent = false) => {
      if (!silent) {
        setTreeStatus("loading");
        setTreeError(null);
      }
      void commands.codeTree(projectId).then((res) => {
        if (res.status === "ok") {
          setTree(res.data);
          setTreeStatus("ready");
        } else if (!silent) {
          setTreeError(tError(res.error));
          setTreeStatus("error");
        }
      });
    },
    [projectId],
  );

  const loadTree = useCallback(() => {
    // 새로고침은 지연 캐시도 버린다 — 안 그러면 디스크가 바뀌어도 이미 펼친
    // 가지는 옛 목록을 계속 보여준다.
    setDirCache(new Map());
    loadDir("", true);
    refreshTree(false);
  }, [loadDir, refreshTree]);

  useEffect(() => {
    loadTree();
    refreshDirtyPaths();
  }, [loadTree, refreshDirtyPaths]);

  const fileSet = useMemo(() => new Set(collectFiles(tree?.nodes ?? [])), [tree]);

  // 되살린 탭 중 **디스크에 없는 것**을 한 번 걷어낸다.
  //
  // 트리에 없다고 곧 없는 파일은 아니다 — 지연 트리는 무시된 파일도 보여주고
  // 그것도 열 수 있다. 그래서 트리에 없는 것만 실제로 읽어 보고 판정한다
  // (대개 0~2건이라 비용이 없다).
  const prunedRef = useRef(false);
  useEffect(() => {
    if (treeStatus !== "ready" || prunedRef.current) return;
    prunedRef.current = true;
    const suspects = allOpenPaths(tabsRef.current).filter((p) => !fileSet.has(p));
    if (suspects.length === 0) return;
    void (async () => {
      for (const path of suspects) {
        const res = await commands.codeRead(projectId, path);
        if (res.status === "error") setTabs((prev) => closeOpenPath(prev, path, false));
      }
    })();
  }, [treeStatus, fileSet, projectId]);

  // 활성 파일의 조상 폴더는 펼쳐 두고 읽어 둔다 — 검색·코드맵에서 건너온
  // 파일은 그 가지가 아직 안 읽혔을 수 있고, 펼치기만 하면 "읽는 중" 에서 멈춘다.
  useEffect(() => {
    if (!selected) return;
    const ancestors = ancestorDirs(selected);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      if (ancestors.every((d) => prev.has(d))) return prev;
      const next = new Set(prev);
      for (const dir of ancestors) next.add(dir);
      return next;
    });
    for (const dir of ancestors) loadDir(dir);
  }, [selected, loadDir]);

  // ── 열기 ────────────────────────────────────────────────────────────────
  //
  // `preview` 를 켜는 입구는 **트리 단일 클릭 하나뿐**이다 (VS Code 기본과 같다).
  // 팔레트·전역 검색·코드 이동·일지는 전부 고정으로 연다 — 거기는 "훑어본다" 가
  // 아니라 "이걸 하려고 왔다" 는 신호다.
  const openPath = useCallback(
    (
      path: string,
      line: number | null,
      pane?: number,
      sel?: { ch?: number; len?: number; preview?: boolean },
    ) => {
      // 갱신 함수 안에서 setJump 를 부르지 않는다 — StrictMode 는 갱신 함수를 두 번
      // 부르므로 그 안의 부수효과는 두 번 난다. 대신 다음 상태를 밖에서 계산하고,
      // `tabsRef` 를 즉시 앞당겨 같은 틱의 연속 호출도 앞의 결과 위에서 쌓이게 한다.
      const next = openFile(tabsRef.current, path, pane, {
        preview: sel?.preview === true && previewTabsRef.current,
        dirtyPaths: dirtyPathsRef.current,
      });
      tabsRef.current = next;
      setTabs(next);
      if (line != null) {
        jumpSeq.current += 1;
        setJump({ pane: next.focused, line, ch: sel?.ch, len: sel?.len, nonce: jumpSeq.current });
      }
    },
    [],
  );

  /**
   * 지금 보고 있는 파일 안에서만 뛴다 (파일 안 이동의 미리 점프·확정).
   *
   * `openPath` 를 쓰지 않는 이유: 같은 파일이라도 `openFile` 은 매번 새 탭
   * 상태를 만들고, 그 값이 그대로 워크스페이스에 저장된다 — 화살표를 누를
   * 때마다 탭 목록을 다시 쓰게 된다.
   */
  const jumpInFocusedPane = useCallback((line: number, ch?: number, focus = true) => {
    jumpSeq.current += 1;
    setJump({ pane: tabsRef.current.focused, line, ch, focus, nonce: jumpSeq.current });
  }, []);

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
    [projectId],
  );

  /** 미리보기 탭을 보통 탭으로 — 더블클릭·첫 편집·컨텍스트 메뉴가 부른다. */
  const pinPath = useCallback((pane: number, path: string) => {
    setTabs((prev) => {
      const next = pinTab(prev, pane, path);
      tabsRef.current = next;
      return next;
    });
  }, []);

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

  /** UI 로 닫은 탭의 최근 순 목록 — ⇧⌘T 가 하나씩 되살린다. 삭제·외부 소실로
   *  닫힌 것은 넣지 않는다 (되살릴 파일이 없다). */
  const closedStackRef = useRef<string[]>([]);
  const rememberClosed = useCallback((...paths: string[]) => {
    const stack = closedStackRef.current.filter((p) => !paths.includes(p));
    stack.push(...paths);
    closedStackRef.current = stack.slice(-CLOSED_STACK_MAX);
  }, []);

  const closeTabTracked = useCallback(
    (pane: number, path: string) => {
      rememberClosed(path);
      setTabs((prev) => closeTab(prev, pane, path));
    },
    [rememberClosed],
  );

  const closeOthersTracked = useCallback(
    (pane: number, path: string) => {
      const others = tabsRef.current.panes[pane]?.tabs.filter((p) => p !== path) ?? [];
      if (others.length > 0) rememberClosed(...others);
      setTabs((prev) => closeOthers(prev, pane, path));
    },
    [rememberClosed],
  );

  const reopenClosedTab = useCallback(() => {
    const open = new Set(allOpenPaths(tabsRef.current));
    let path: string | undefined;
    while ((path = closedStackRef.current.pop()) !== undefined) {
      if (!open.has(path)) break;
    }
    if (path === undefined) return;
    const target = path;
    // 닫은 사이 디스크에서 사라졌을 수 있다 — 깨진 탭을 열어 두는 대신 말한다.
    void commands.codeRead(projectId, target).then((res) => {
      if (res.status === "error") {
        toast.warning(t("code.fileGone", { path: target }));
        return;
      }
      openPath(target, null);
    });
  }, [projectId, openPath]);

  // ⌘W — 코드 탭을 **먼저** 닫는다.
  //
  // macOS 는 메뉴 액셀러레이터가 웹뷰 keydown 보다 먼저 ⌘W 를 소비하므로,
  // 여기는 keydown 이 아니라 "안쪽부터 닫기" 사슬(lib/closeIntent)로 온다.
  // 열린 탭이 없으면 받지 않는다 — 그때의 ⌘W 는 프로젝트 탭을 닫는 것이 맞다.
  useEffect(
    () =>
      registerCloseHandler(() => {
        if (!isVisible()) return false;
        const path = focusedPath(tabsRef.current);
        if (path == null) return false;
        rememberClosed(path);
        setTabs((prev) => closeTab(prev, prev.focused, path));
        return true;
      }),
    [isVisible, rememberClosed],
  );

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
    onStale: (dirs) => reloadAfterOp(...dirs),
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
    [reloadAfterOp],
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



  // ── 트리 파생값 ────────────────────────────────────────────────────────
  const filtering = filter.trim().length > 0;

  const filteredNodes = useMemo(() => {
    if (!tree || !filtering) return [];
    return filterTree(tree.nodes, filter);
  }, [tree, filter, filtering]);

  // 필터 중에는 전량 트리를 지연 캐시와 **같은 모양**으로 펴서 넣는다 — 렌더러가
  // 하나로 유지되고, "미로드(undefined)" 와 "빈 폴더([])" 의 구별도 그대로 산다.
  const filteredMap = useMemo(
    () => (filtering ? flattenToDirMap(filteredNodes) : null),
    [filtering, filteredNodes],
  );

  const childrenOf = useCallback(
    (dirPath: string) => (filteredMap ?? dirCache).get(dirPath),
    [filteredMap, dirCache],
  );

  const treeIsEmpty = (childrenOf("") ?? []).length === 0 && !loadingDirs.has("") && !draft;

  // 필터 중엔 매치가 보이도록 전부 펼친다 (사용자 펼침 상태는 건드리지 않음).
  const expandedForRender = useMemo(() => {
    if (!filtering) return expanded;
    return new Set(collectDirs(filteredNodes));
  }, [filtering, expanded, filteredNodes]);

  /**
   * 브레드크럼의 폴더 조각 → 트리에서 그 자리를 펼쳐 보여 준다.
   * 필터 중이면 필터를 걷는다 — 필터된 트리에는 그 폴더가 없을 수 있다.
   */
  const revealDir = useCallback(
    (dir: string) => {
      setFilter("");
      const dirs = [...ancestorDirs(dir + "/x"), dir];
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const d of dirs) next.add(d);
        return next;
      });
      for (const d of dirs) loadDir(d);
    },
    [loadDir],
  );

  const toggleDir = useCallback(
    (path: string) => {
      setTreeFocus({ path, isDir: true });
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else {
          next.add(path);
          loadDir(path);
        }
        return next;
      });
    },
    [loadDir],
  );

  /** 지금 트리에 보이는 순서 — ⇧ 범위 선택과 화살표 이동의 기준. */
  const treeOrder = useMemo(
    () => visibleEntries(childrenOf, expandedForRender),
    [childrenOf, expandedForRender],
  );

  /**
   * 트리 행을 눌렀다. 평범한 클릭은 예전 그대로다 — 하나만 뽑고, 파일이면 열고
   * 폴더면 펼친다. ⌘·⇧ 는 **고르기만** 한다 (열면 뽑아 둔 것이 곧바로 흩어진다).
   */
  const clickRow = useCallback(
    (path: string, isDir: boolean, e: React.MouseEvent) => {
      const intent = clickIntent(e);
      if (intent === "toggle") {
        setMarks((prev) => toggleMark(prev, { path, isDir }));
        setMarkAnchor(path);
        return;
      }
      if (intent === "range") {
        setMarks(marksOf(rangeBetween(treeOrder, markAnchor, path)));
        return;
      }
      setMarks(marksOf([{ path, isDir }]));
      setMarkAnchor(path);
      setTreeFocus({ path, isDir });
      if (isDir) toggleDir(path);
      else openPath(path, null, undefined, { preview: true });
    },
    [markAnchor, treeOrder, toggleDir, openPath],
  );

  /**
   * 트리가 Tab 으로 들어오는 자리. 서 있던 행이 사라졌으면(옮김·삭제·필터)
   * 첫 행으로 돌아간다 — 없는 경로가 주인이면 트리에 **아예 들어갈 수 없다**.
   */
  const treeFocusPath =
    treeFocus && treeOrder.some((x) => x.path === treeFocus.path)
      ? treeFocus.path
      : (treeOrder[0]?.path ?? null);

  /** 트리의 키보드 표면 — 화살표 이동과 ⌘X/⌘V. 둘 다 `treeFocus` 를 공유한다. */
  const { cut, cutFrom, pasteInto, pasteHere, onKeyDown: onTreeKeyDown } = useTreeKeys({
    order: treeOrder,
    focus: treeFocus,
    setFocus: setTreeFocus,
    isExpanded: (dir) => expandedForRender.has(dir),
    setMarks,
    markAnchor,
    setMarkAnchor,
    clearMarks,
    targetsFor,
    toggleDir,
    openPath,
    startRename,
    askDelete,
    moveInto: ops.moveInto,
    pasteFiles,
    selectedPath: selected,
  });

  const openTreeMenu = useCallback(
    (e: React.MouseEvent, entry: { path: string; isDir: boolean } | null) => {
      const items = treeMenuItems(entry, {
        startCreate,
        startRename,
        // 뽑아 둔 것 안에서 우클릭했으면 그 전부가 대상이다 — 메뉴가 하나만
        // 지우면 방금 열 개를 고른 손이 무엇을 눌러야 할지 알 수 없다.
        askDelete: (path, isDir) => askDelete(targetsFor(path, isDir)),
        cut: (path, isDir) => cutFrom({ path, isDir }),
        // 잘라 둔 것이 없으면 항목을 아예 그리지 않는다 — 회색으로 놔두면
        // 왜 못 누르는지 알 수 없다.
        paste: cut.size > 0 ? () => pasteInto(entry) : undefined,
        openBeside: (path) =>
          openPath(path, null, tabsRef.current.panes.length > 1 ? 1 : 0),
      });
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [startCreate, startRename, askDelete, targetsFor, cut.size, cutFrom, pasteInto, openPath],
  );

  // 화면 단축키 — 이 화면이 보일 때만.
  //   ⌃Tab / ⌃⇧Tab · ⇧⌘] / ⇧⌘[ : 탭 순환 (브라우저·VS Code 관례 양쪽)
  //   ⇧⌘T : 닫은 탭 다시 열기
  //   ⇧⌘F : 전역 검색 (사이드바를 검색 패널로 전환 + 입력 포커스)
  //   ⌘N : 새 파일 (보고 있던 파일의 폴더에)
  //   ⇧⌘O / ⌃G : 파일 안에서 심볼·줄로 이동
  // ⌘W 는 여기 없다 — macOS 는 메뉴 액셀러레이터가 keydown 보다 먼저 먹으므로
  // 위의 closeIntent 사슬이 받는다. keydown 에도 달면 두 번 닫힌다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isVisible()) return;
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        setTabs((prev) => cycleTab(prev, e.shiftKey ? -1 : 1));
        return;
      }
      // ⌃G — CM6 기본 키맵에 없는 조합이라 여기서 처음 잡힌다 (emacs 키맵을
      // 쓰지 않는다). ⌘ 조합보다 먼저 봐야 아래 metaKey 게이트에 안 걸린다.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        openGoto(true);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // 괄호 키는 `key` 가 아니라 `code` 로 본다 — ⇧ 조합·비영어 자판에서
      // `key` 값이 갈라진다.
      if (e.shiftKey && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        setTabs((prev) => cycleTab(prev, e.code === "BracketRight" ? 1 : -1));
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        reopenClosedTab();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openGoto(false);
        return;
      }
      // 에디터·입력칸의 ⌘X/⌘V 는 글자 잘라내기·붙여넣기다 — 가로채면 타이핑이 망가진다.
      const editing = (e.target as HTMLElement | null)?.closest?.(
        ".cm-editor, input, textarea, [contenteditable='true']",
      );
      if (!e.shiftKey && e.key.toLowerCase() === "v") {
        if (editing) return;
        pasteHere();
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "x") {
        if (editing) return;
        e.preventDefault();
        cutFrom(null);
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const current = focusedPath(tabsRef.current);
        startCreate(current != null ? parentDir(current) : "", false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, reopenClosedTab, startCreate, openSearch, pasteHere, cutFrom, openGoto]);

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
  // 드래그 중에는 로컬 값으로만 그리고, 놓는 순간 영속한다 — 매 이동마다
  // 컨텍스트를 통과시키면 창 전체가 60fps 로 리렌더된다.
  const persistedPanelHeight = state.codePanelHeight;
  const [livePanelHeight, setLivePanelHeight] = useState<number | null>(null);
  const panelHeight = livePanelHeight ?? persistedPanelHeight;
  const panelDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const clampPanelHeight = (h: number) => Math.min(560, Math.max(140, Math.round(h)));

  const persistPanelHeight = useCallback(
    (h: number) => {
      setLivePanelHeight(null);
      setState((prev) =>
        prev.codePanelHeight === h ? prev : { ...prev, codePanelHeight: h },
      );
    },
    [setState],
  );

  const onResizerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      panelDragRef.current = { startY: e.clientY, startH: panelHeight };
    },
    [panelHeight],
  );
  const onResizerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    // 위로 끌면 커진다 (패널은 아래에 붙어 있다).
    setLivePanelHeight(clampPanelHeight(drag.startH + (drag.startY - e.clientY)));
  }, []);
  const onResizerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = panelDragRef.current;
      if (!drag) return;
      panelDragRef.current = null;
      persistPanelHeight(clampPanelHeight(drag.startH + (drag.startY - e.clientY)));
    },
    [persistPanelHeight],
  );

  // 트리 사이드바 — 좌/우 어느 쪽이든 **DOM 순서를 화면 순서와 같게** 두 자리
  // 중 한 곳에 렌더한다 (터미널 도크와 같은 원칙: row-reverse 로 뒤집으면
  // Tab 이동이 눈에 보이는 차례와 어긋난다).
  // 검색 모드에서는 같은 자리를 검색 패널이 통째로 가져간다.
  const sidebarEl = (
    <aside className={"code-sidebar" + (sidebarOnRight ? " on-right" : "")}>
      {sidebarMode === "search" ? (
        <CodeSearchPanel
          projectId={projectId}
          opts={state.codeSearchOpts}
          onOptsChange={(next) => setState((prev) => ({ ...prev, codeSearchOpts: next }))}
          dirtyPaths={dirtyPaths}
          onOpenHit={(path, line, ch, len) => openPath(path, line, undefined, { ch, len })}
          onClose={() => setSidebarMode("files")}
          focusSeq={searchFocusSeq}
        />
      ) : (
        <>
      <div className="code-sidebar-head">
        <div className="code-filter">
          <Search size={13} className="code-filter-ico" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("code.filter")}
            aria-label={t("code.filter")}
            spellCheck={false}
          />
          {filter ? (
            <button
              type="button"
              className="code-filter-clear"
              onClick={() => setFilter("")}
              aria-label={t("code.filter.clear")}
              title={t("code.filter.clear")}
            >
              ×
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={openSearch}
          title={t("code.search.open")}
          aria-label={t("code.search.open")}
        >
          <TextSearch size={14} />
        </button>
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={() => startCreate("", false)}
          title={t("code.ops.newFile")}
          aria-label={t("code.ops.newFile")}
        >
          <FilePlus size={14} />
        </button>
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={() => startCreate("", true)}
          title={t("code.ops.newFolder")}
          aria-label={t("code.ops.newFolder")}
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={toggleSidebarSide}
          title={t(sidebarOnRight ? "code.sidebar.toLeft" : "code.sidebar.toRight")}
          aria-label={t(sidebarOnRight ? "code.sidebar.toLeft" : "code.sidebar.toRight")}
        >
          {sidebarOnRight ? <PanelLeft size={14} /> : <PanelRight size={14} />}
        </button>
      </div>
      {tree?.truncated ? <div className="code-truncated">{t("code.truncated")}</div> : null}
      {treeIsEmpty ? (
        <div className="code-tree-empty">
          {filtering ? t("code.noMatch") : t("code.tree.empty")}
        </div>
      ) : (
        <CodeTree
          childrenOf={childrenOf}
          loadingDirs={loadingDirs}
          selected={selected}
          expanded={expandedForRender}
          dirtyPaths={dirtyPaths}
          openPaths={openPaths}
          draft={draft}
          marks={marks}
          // 트리 안에서 tabindex 를 가진 자리는 언제나 하나여야 한다.
          focusPath={treeFocusPath}
          cutPaths={cut}
          onKeyDown={onTreeKeyDown}
          onClickRow={clickRow}
          // 더블클릭은 고정 — 첫 클릭이 이미 열었으므로 승격만 하면 된다.
          onPin={(path) => pinPath(tabsRef.current.focused, path)}
          onDraftSubmit={ops.submitDraft}
          onDraftCancel={ops.cancelDraft}
          onContextMenu={openTreeMenu}
          rowDrag={treeDrag.rowDrag}
          draggingPaths={treeDrag.draggingPaths}
          // Finder 드롭과 트리 안 이동이 같은 자리를 밝힌다 — 둘이 동시에
          // 일어날 수는 없다.
          dropDir={dropDir ?? treeDrag.dropDir}
        />
      )}
      {treeDrag.ghost}
      <CodeOutline
        symbols={symbols}
        loading={symbolsLoading}
        open={outlineOpen}
        cursorLine={cursorLine}
        onToggleOpen={() => setOutlineOpen((v) => !v)}
        onJump={(line) => selected && openPath(selected, line + 1)}
      />
        </>
      )}
    </aside>
  );

  return (
    <>
      <Toolbar title={t("nav.code")} sub={selected ? selected + (focusedDirty ? " ●" : "") : undefined}>
        {selected && projectRoot ? (
          <button
            type="button"
            className="code-tool-btn"
            onClick={() => paneRefs[tabs.focused]?.current?.openExternal()}
            title={t("code.openExternal")}
            aria-label={t("code.openExternal")}
          >
            <ExternalLink size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className={"code-tool-btn" + (debugOpen ? " on" : "")}
          onClick={() => setDebugOpen((v) => !v)}
          title={t("code.debug.open")}
          aria-label={t("code.debug.open")}
        >
          <Bug size={15} />
        </button>
        <button
          type="button"
          className="code-tool-btn"
          onClick={() => {
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
          title={t("code.debug.run")}
          aria-label={t("code.debug.run")}
        >
          <Play size={15} />
        </button>
        {selected ? (
          <button
            type="button"
            className="code-tool-btn"
            onClick={() => paneRefs[tabs.focused]?.current?.format()}
            title={t("code.format") + " (⇧⌥F)"}
            aria-label={t("code.format")}
          >
            <AlignLeft size={15} />
          </button>
        ) : null}
        {selected ? (
          <button
            type="button"
            className={"code-tool-btn code-save-btn" + (focusedDirty ? " on" : "")}
            onClick={() => paneRefs[tabs.focused]?.current?.save()}
            disabled={!focusedDirty}
            title={t("code.save") + " (⌘S)"}
            aria-label={t("code.save")}
          >
            <Save size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="code-tool-btn"
          onClick={loadTree}
          title={t("code.refresh")}
          aria-label={t("code.refresh")}
        >
          <RefreshCw size={15} />
        </button>
      </Toolbar>

      {treeStatus === "loading" ? (
        <div className="scroll" ref={rootRef}>
          <div className="page">
            <SkeletonList rows={8} height={22} gap={6} />
          </div>
        </div>
      ) : treeStatus === "error" ? (
        <div className="scroll" ref={rootRef}>
          <div className="page">
            <EmptyState>{t("code.listFailed")}<br />{treeError}</EmptyState>
          </div>
        </div>
      ) : (
        <div className="code-body" ref={rootRef}>
          {sidebarOnRight ? null : sidebarEl}

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
                // 스티키는 아웃라인과 **같은 값**을 쓴다. 설정이 꺼져 있으면
                // 굳이 내려보내지 않는다 (확장 자체가 안 붙어 있다).
                stickySymbols={settings.codeStickyScroll ? symbols : null}
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

          {sidebarOnRight ? sidebarEl : null}

          {/* 파일 안 이동 — `.code-body` 안에 둔다. 오버레이는 position:fixed 라
              자리를 차지하지 않고, 여기 있어야 화면 스코프의 --code-* 토큰
              (심볼 종류 점)이 산다. */}
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

      <AppDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        label={t("code.debug.startTitle")}
        width={460}
      >
        <form
          style={{ padding: "18px 20px 16px" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (starting || !launchForm.program.trim()) return;
            setStarting(true);
            void debug.start(toLaunchRequest(launchForm)).then((error) => {
              setStarting(false);
              if (error) {
                toast.destructive(t("code.debug.startFailed", { error: tError(error) }));
                return;
              }
              setLaunchOpen(false);
              setDebugOpen(true);
            });
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>
            {t("code.debug.startTitle")}
          </h2>
          <label style={LABEL} htmlFor="dap-language">{t("code.debug.language")}</label>
          <select
            id="dap-language"
            className="input"
            value={launchForm.language}
            onChange={(e) => setLaunchForm((p) => ({ ...p, language: e.target.value }))}
            style={{ width: "100%", marginBottom: 12 }}
          >
            <option value="rust">rust</option>
            <option value="python">python</option>
            <option value="go">go</option>
          </select>

          <label style={LABEL} htmlFor="dap-program">{t("code.debug.program")}</label>
          <input
            id="dap-program"
            className="input"
            value={launchForm.program}
            onChange={(e) => setLaunchForm((p) => ({ ...p, program: e.target.value }))}
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "var(--mono)" }}
          />
          <p style={HINT}>{t("code.debug.programHint")}</p>

          <label style={LABEL} htmlFor="dap-args">{t("code.debug.args")}</label>
          <input
            id="dap-args"
            className="input"
            value={launchForm.args}
            onChange={(e) => setLaunchForm((p) => ({ ...p, args: e.target.value }))}
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "var(--mono)", marginBottom: 12 }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={launchForm.stopOnEntry}
              onChange={(e) => setLaunchForm((p) => ({ ...p, stopOnEntry: e.target.checked }))}
            />
            {t("code.debug.stopOnEntry")}
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="btn sm" onClick={() => setLaunchOpen(false)} disabled={starting}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn sm primary" disabled={starting || !launchForm.program.trim()}>
              {t("code.debug.start")}
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={pendingDelete != null}
        onClose={() => ops.setPendingDelete(null)}
        label={t("code.ops.deleteTitle")}
        width={440}
      >
        <div style={{ padding: "18px 20px 16px" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>
            {t("code.ops.deleteTitle")}
          </h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {/* 하나면 그 이름을 부른다 — 여럿이면 이름 열 개를 늘어놓는 대신
                개수로 말하고, 무엇이 걸렸는지는 아래 탭 목록이 보여 준다. */}
            {pendingDelete && pendingDelete.targets.length > 1
              ? t("code.ops.deleteManyAsk", { count: pendingDelete.targets.length })
              : t(
                  pendingDelete?.targets[0]?.isDir
                    ? "code.ops.deleteFolderAsk"
                    : "code.ops.deleteFileAsk",
                  { name: pendingDelete ? baseName(pendingDelete.targets[0]?.path ?? "") : "" },
                )}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
            {t("code.ops.deleteTrashNote")}
          </p>
          {/* 열려 있던 탭·미저장 편집은 **누르기 전에** 말한다. */}
          {pendingDelete && pendingDelete.openTabs.length > 0 ? (
            <div className="code-delete-open" role="note">
              <strong>{t("code.ops.deleteOpenTabs", { count: pendingDelete.openTabs.length })}</strong>
              <ul>
                {pendingDelete.openTabs.map((p) => (
                  <li key={p} className={dirtyPaths.has(p) ? "dirty" : undefined}>
                    {p}
                    {dirtyPaths.has(p) ? ` — ${t("code.dirty")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => ops.setPendingDelete(null)}
              disabled={deleting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn sm code-conflict-overwrite"
              onClick={ops.confirmDelete}
              disabled={deleting}
            >
              {deleting ? t("code.ops.deleting") : t("code.ops.delete")}
            </button>
          </div>
        </div>
      </AppDialog>
    </>
  );
}


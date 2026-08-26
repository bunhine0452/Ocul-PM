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
  Sparkles,
  Bug,
  Play,
  PanelLeft,
  PanelRight,
  TextSearch,
} from "@/components/Icons";
import { commands, type CodeTree as CodeTreeData, type LspSymbol } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { registerCloseHandler } from "@/lib/closeIntent";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { AppDialog } from "@/components/ui/AppDialog";

import { CodeTree, type TreeDraft } from "./CodeTree";
import { useCodeImport } from "./useCodeImport";
import type { TreeHit } from "./importTarget";
import { CodePane, CodeEmptyState, type CodePaneHandle } from "./CodePane";
import { CodeContextMenu, type CodeMenuItem } from "./CodeContextMenu";
import { CodeOutline } from "./CodeOutline";
import { CodeDebugPanel } from "./CodeDebugPanel";
import { useDebug } from "./useDebug";
import { adapterLanguageFor, defaultProgramFor, toLaunchRequest } from "./debugConfig";
import { CodeReferences, type ReferencesQuery } from "./CodeReferences";
import { CodeSearchPanel } from "./CodeSearchPanel";
import {
  ancestorDirs,
  collectDirs,
  collectFiles,
  filterTree,
  flattenToDirMap,
  type DirMap,
} from "./treeUtils";
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
  openPathsUnder,
  renameOpenPath,
  sanitizeTabs,
  splitEditor,
  unsplitEditor,
  type CodeTabsState,
} from "./codeTabs";
import {
  baseName,
  joinPath,
  moveTarget,
  parentDir,
  renameTarget,
  validateName,
} from "./fileOps";
import { dropBuffersUnder, listDirtyPaths, renameBufferPath } from "./codeBuffers";
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

/** 삭제 확인에 걸린 대상. 열려 있던 탭·미저장 목록을 같이 들고 있다. */
interface PendingDelete {
  path: string;
  isDir: boolean;
  openTabs: string[];
}

export function CodeScreenV2({
  projectId,
  projectRoot,
  openTarget,
  onOpenTargetConsumed,
}: CodeScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();

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
  // 창별 줄 점프 지시 — nonce 로 같은 줄의 연속 점프도 다시 발화시킨다.
  // ch/len (UTF-16) 이 있으면 그 범위를 선택한다 (전역 검색의 매치 표시).
  const [jump, setJump] = useState<{
    pane: number;
    line: number;
    ch?: number;
    len?: number;
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
  const [references, setReferences] = useState<ReferencesQuery | null>(null);
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
  // documentSymbol 을 던지는 것은 안 보는 패널을 위한 비용이다.
  useEffect(() => {
    if (!outlineOpen || !selected) {
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
  }, [outlineOpen, selected, projectId, symbolEpoch]);

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
  const openPath = useCallback(
    (path: string, line: number | null, pane?: number, sel?: { ch: number; len: number }) => {
      // 갱신 함수 안에서 setJump 를 부르지 않는다 — StrictMode 는 갱신 함수를 두 번
      // 부르므로 그 안의 부수효과는 두 번 난다. 대신 다음 상태를 밖에서 계산하고,
      // `tabsRef` 를 즉시 앞당겨 같은 틱의 연속 호출도 앞의 결과 위에서 쌓이게 한다.
      const next = openFile(tabsRef.current, path, pane);
      tabsRef.current = next;
      setTabs(next);
      if (line != null) {
        jumpSeq.current += 1;
        setJump({ pane: next.focused, line, ch: sel?.ch, len: sel?.len, nonce: jumpSeq.current });
      }
    },
    [],
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
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: CodeMenuItem[] } | null>(null);

  /** 조작 후 갈아끼울 트리 자리들. 지연 캐시는 해당 폴더만, 전량 트리는 조용히. */
  const reloadAfterOp = useCallback(
    (...dirs: string[]) => {
      for (const dir of new Set(dirs)) loadDir(dir, true);
      refreshTree(true);
    },
    [loadDir, refreshTree],
  );

  const startCreate = useCallback(
    (parent: string, isDir: boolean) => {
      // 만들 자리가 안 보이면 이름을 넣을 곳도 없다 — 먼저 펼치고 읽는다.
      if (parent) {
        setExpanded((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
        loadDir(parent);
      }
      setDraft({ kind: "create", parent, isDir });
    },
    [loadDir],
  );

  /**
   * 트리에서 마지막으로 손댄 자리 — 커서가 없는 ⌘V 의 기준이다.
   *
   * 폴더는 눌러도 "선택"이 되지 않고 펼쳐지기만 한다(탭이 열리는 것은 파일뿐).
   * 그래서 `assets/` 를 누르고 ⌘V 를 치면 열려 있던 파일의 폴더로 들어가 버린다 —
   * 눌러 둔 곳이 아니라. 그 어긋남만 여기서 메운다.
   */
  const [treeAnchor, setTreeAnchor] = useState<TreeHit | null>(null);

  const startRename = useCallback((path: string, isDir: boolean) => {
    setDraft({ kind: "rename", path, isDir, initial: baseName(path) });
  }, []);

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
    selected: treeAnchor ?? (selected ? { path: selected, isDir: false } : null),
    rootName: projectRoot ? baseName(projectRoot) : "",
    onImported: handleImported,
  });

  // 화면 단축키 — 이 화면이 보일 때만.
  //   ⌃Tab / ⌃⇧Tab · ⇧⌘] / ⇧⌘[ : 탭 순환 (브라우저·VS Code 관례 양쪽)
  //   ⇧⌘T : 닫은 탭 다시 열기
  //   ⇧⌘F : 전역 검색 (사이드바를 검색 패널로 전환 + 입력 포커스)
  //   ⌘N : 새 파일 (보고 있던 파일의 폴더에)
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
      if (!e.shiftKey && e.key.toLowerCase() === "v") {
        // 에디터·입력칸의 ⌘V 는 글자 붙여넣기다 — 가로채면 타이핑이 망가진다.
        const el = e.target as HTMLElement | null;
        if (el?.closest?.(".cm-editor, input, textarea, [contenteditable='true']")) return;
        pasteFiles();
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
  }, [isVisible, reopenClosedTab, startCreate, openSearch, pasteFiles]);

  /** 이름 바꾸기·이동의 공통 뒤처리 — 탭·버퍼·펼침 상태가 새 경로를 따라간다. */
  const applyRenamed = useCallback(
    (from: string, to: string, isDir: boolean) => {
      renameBufferPath(projectId, from, to, isDir);
      setTabs((prev) => renameOpenPath(prev, from, to, isDir));
      if (isDir) {
        setExpanded((prev) => {
          const next = new Set<string>();
          for (const dir of prev) {
            if (dir === from) next.add(to);
            else if (dir.startsWith(from + "/")) next.add(to + dir.slice(from.length));
            else next.add(dir);
          }
          return next;
        });
      }
      refreshDirtyPaths();
      reloadAfterOp(parentDir(from), parentDir(to));
    },
    [projectId, refreshDirtyPaths, reloadAfterOp],
  );

  /** 이름 바꾸기·이동을 실행한다. 옮긴 것이 폴더였는지는 **백엔드가 알려 준다** —
   *  트리 캐시가 낡았을 수 있어 프런트의 판단을 믿지 않는다. */
  const runRename = useCallback(
    (from: string, to: string) => {
      if (to === from) return;
      void commands.codeRename(projectId, from, to).then((res) => {
        if (res.status === "error") {
          toast.destructive(t("code.ops.renameFailed", { error: tError(res.error) }));
          return;
        }
        applyRenamed(from, res.data.relative_path, res.data.is_dir);
      });
    },
    [projectId, applyRenamed],
  );

  const submitDraft = useCallback(
    (name: string) => {
      const current = draft;
      setDraft(null);
      if (!current) return;
      const problem = validateName(name);
      if (problem) {
        toast.destructive(t(`code.ops.name.${problem}`));
        return;
      }
      if (current.kind === "rename") {
        runRename(current.path, renameTarget(current.path, name));
        return;
      }
      const target = joinPath(current.parent, name.trim());
      const call = current.isDir
        ? commands.codeMkdir(projectId, target)
        : commands.codeCreate(projectId, target);
      void call.then((res) => {
        if (res.status === "error") {
          toast.destructive(t("code.ops.createFailed", { error: tError(res.error) }));
          return;
        }
        const created = res.data.relative_path;
        // `a/b/c.ts` 처럼 중간 폴더가 같이 생겼을 수 있다 — 만든 자리와 그
        // 직속 부모를 둘 다 다시 읽는다.
        reloadAfterOp(current.parent, parentDir(created));
        if (res.data.is_dir) {
          setExpanded((prev) => new Set(prev).add(created));
          loadDir(created, true);
        } else {
          openPath(created, null);
        }
      });
    },
    [draft, projectId, runRename, reloadAfterOp, loadDir, openPath],
  );

  const askDelete = useCallback((path: string, isDir: boolean) => {
    setPendingDelete({
      path,
      isDir,
      openTabs: openPathsUnder(tabsRef.current, path, isDir),
    });
  }, []);

  const confirmDelete = useCallback(() => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    void commands.codeDelete(projectId, target.path).then((res) => {
      setDeleting(false);
      setPendingDelete(null);
      if (res.status === "error") {
        toast.destructive(t("code.ops.deleteFailed", { error: tError(res.error) }));
        return;
      }
      // 탭·버퍼를 같이 정리한다. 미저장 편집이 있었다면 **무엇이 사라졌는지**
      // 말한다 — 확인 창에서 이미 경고했더라도 결과는 다시 알린다.
      const lost = dropBuffersUnder(projectId, target.path, target.isDir);
      setTabs((prev) => closeOpenPath(prev, target.path, target.isDir));
      refreshDirtyPaths();
      if (target.isDir) {
        setExpanded((prev) => {
          const next = new Set<string>();
          for (const dir of prev) {
            if (dir !== target.path && !dir.startsWith(target.path + "/")) next.add(dir);
          }
          return next;
        });
      }
      reloadAfterOp(parentDir(target.path));
      toast.info(
        lost.length > 0
          ? t("code.ops.deletedWithUnsaved", { name: baseName(target.path), count: lost.length })
          : t("code.ops.deleted", { name: baseName(target.path) }),
      );
    });
  }, [pendingDelete, deleting, projectId, refreshDirtyPaths, reloadAfterOp]);

  const handleMove = useCallback(
    (from: string, toDir: string) => {
      const result = moveTarget(from, toDir);
      if (!result.ok) {
        // 같은 폴더로의 드롭은 아무 말 없이 넘긴다 (실수가 아니라 취소에 가깝다).
        if (result.reason === "intoSelf") toast.warning(t("code.ops.moveIntoSelf"));
        return;
      }
      runRename(from, result.to);
    },
    [runRename],
  );

  const openTreeMenu = useCallback(
    (e: React.MouseEvent, entry: { path: string; isDir: boolean } | null) => {
      const parent = entry ? (entry.isDir ? entry.path : parentDir(entry.path)) : "";
      const items: CodeMenuItem[] = [
        { label: t("code.ops.newFile"), onSelect: () => startCreate(parent, false) },
        { label: t("code.ops.newFolder"), onSelect: () => startCreate(parent, true) },
      ];
      if (entry) {
        items.push(
          {
            label: t("code.ops.rename"),
            onSelect: () => startRename(entry.path, entry.isDir),
            separatorBefore: true,
          },
          {
            label: t("code.ops.delete"),
            onSelect: () => askDelete(entry.path, entry.isDir),
            danger: true,
          },
        );
        if (!entry.isDir) {
          items.push({
            label: t("code.tabs.openBeside"),
            onSelect: () => openPath(entry.path, null, tabsRef.current.panes.length > 1 ? 1 : 0),
            separatorBefore: true,
          });
        }
      }
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [startCreate, startRename, askDelete, openPath],
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
      setTreeAnchor({ path, isDir: true });
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
          onToggle={toggleDir}
          onSelect={(path) => {
            setTreeAnchor({ path, isDir: false });
            openPath(path, null);
          }}
          onDraftSubmit={submitDraft}
          onDraftCancel={() => setDraft(null)}
          onContextMenu={openTreeMenu}
          onMove={handleMove}
          dropDir={dropDir}
        />
      )}
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
            <Sparkles size={15} />
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
            <div className="empty-hint">{t("code.loading")}</div>
          </div>
        </div>
      ) : treeStatus === "error" ? (
        <div className="scroll" ref={rootRef}>
          <div className="page">
            <div className="empty-hint">
              {t("code.listFailed")}
              <br />
              {treeError}
            </div>
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
                    ? { line: jump.line, ch: jump.ch, len: jump.len, nonce: jump.nonce }
                    : null
                }
                dirtyPaths={dirtyPaths}
                onFocus={() => setTabs((prev) => focusPane(prev, index))}
                onActivate={(path) => setTabs((prev) => activateTab(prev, index, path))}
                onClose={(path) => closeTabTracked(index, path)}
                onCloseOthers={(path) => closeOthersTracked(index, path)}
                onReopenClosed={reopenClosedTab}
                canReopen={closedStackRef.current.length > 0}
                onSplit={() => setTabs(splitEditor)}
                onUnsplit={() => setTabs(unsplitEditor)}
                onMoveToOtherPane={(path) => setTabs((prev) => moveTabToOtherPane(prev, index, path))}
                onDropTab={(fromPane, path) =>
                  setTabs((prev) =>
                    fromPane === index
                      ? prev
                      : closeTab(openFile(prev, path, index), fromPane, path),
                  )
                }
                onBuffersChanged={handleBuffersChanged}
                onOpenPath={(path, line) => openPath(path, line, index)}
                onReferences={setReferences}
                onCursorLine={setCursorLine}
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
            {debugOpen || references ? (
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
        onClose={() => setPendingDelete(null)}
        label={t("code.ops.deleteTitle")}
        width={440}
      >
        <div style={{ padding: "18px 20px 16px" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>
            {t("code.ops.deleteTitle")}
          </h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {t(pendingDelete?.isDir ? "code.ops.deleteFolderAsk" : "code.ops.deleteFileAsk", {
              name: pendingDelete ? baseName(pendingDelete.path) : "",
            })}
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
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn sm code-conflict-overwrite"
              onClick={confirmDelete}
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


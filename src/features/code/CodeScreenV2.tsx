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
  FileCode,
  ExternalLink,
  Search,
  FilePlus,
  FolderPlus,
  Sparkles,
} from "@/components/Icons";
import { commands, type CodeTree as CodeTreeData, type LspSymbol } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { AppDialog } from "@/components/ui/AppDialog";

import { CodeTree, type TreeDraft } from "./CodeTree";
import { CodePane, type CodePaneHandle } from "./CodePane";
import { CodeContextMenu, type CodeMenuItem } from "./CodeContextMenu";
import { CodeOutline } from "./CodeOutline";
import { CodeReferences, type ReferencesQuery } from "./CodeReferences";
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
  const [jump, setJump] = useState<{ pane: number; line: number; nonce: number } | null>(null);
  const jumpSeq = useRef(0);
  const paneRefs = [useRef<CodePaneHandle>(null), useRef<CodePaneHandle>(null)];

  const selected = focusedPath(tabs);
  const openPaths = useMemo(() => new Set(allOpenPaths(tabs)), [tabs]);

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
  const openPath = useCallback((path: string, line: number | null, pane?: number) => {
    // 갱신 함수 안에서 setJump 를 부르지 않는다 — StrictMode 는 갱신 함수를 두 번
    // 부르므로 그 안의 부수효과는 두 번 난다. 대신 다음 상태를 밖에서 계산하고,
    // `tabsRef` 를 즉시 앞당겨 같은 틱의 연속 호출도 앞의 결과 위에서 쌓이게 한다.
    const next = openFile(tabsRef.current, path, pane);
    tabsRef.current = next;
    setTabs(next);
    if (line != null) {
      jumpSeq.current += 1;
      setJump({ pane: next.focused, line, nonce: jumpSeq.current });
    }
  }, []);

  // 다른 화면(검색·코드맵)에서 온 열기 목표.
  useEffect(() => {
    if (!openTarget) return;
    openPath(openTarget.path, openTarget.line);
    onOpenTargetConsumed();
  }, [openTarget, onOpenTargetConsumed, openPath]);

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

  const startRename = useCallback((path: string, isDir: boolean) => {
    setDraft({ kind: "rename", path, isDir, initial: baseName(path) });
  }, []);

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

  const toggleDir = useCallback(
    (path: string) => {
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
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">{t("code.loading")}</div>
          </div>
        </div>
      ) : treeStatus === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {t("code.listFailed")}
              <br />
              {treeError}
            </div>
          </div>
        </div>
      ) : (
        <div className="code-body">
          <aside className="code-sidebar">
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
              </div>
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
                onSelect={(path) => openPath(path, null)}
                onDraftSubmit={submitDraft}
                onDraftCancel={() => setDraft(null)}
                onContextMenu={openTreeMenu}
                onMove={handleMove}
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
          </aside>

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
                jump={jump && jump.pane === index ? { line: jump.line, nonce: jump.nonce } : null}
                dirtyPaths={dirtyPaths}
                onFocus={() => setTabs((prev) => focusPane(prev, index))}
                onActivate={(path) => setTabs((prev) => activateTab(prev, index, path))}
                onClose={(path) => setTabs((prev) => closeTab(prev, index, path))}
                onCloseOthers={(path) => setTabs((prev) => closeOthers(prev, index, path))}
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
              />
            ))}
              {tabs.panes.length === 0 ? <CodeNoTabs /> : null}
            </div>
            {references ? (
              <CodeReferences
                query={references}
                onClose={() => setReferences(null)}
                onOpen={(path, line) => openPath(path, line + 1)}
              />
            ) : null}
          </div>
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

/** 모든 탭을 닫았을 때 — 창 자체가 사라지지 않도록 자리를 지킨다. */
function CodeNoTabs() {
  useT();
  return (
    <div className="code-center-hint code-empty">
      <FileCode size={32} strokeWidth={1.5} className="code-empty-ico" />
      <div className="code-empty-title">{t("code.empty.title")}</div>
      <p className="code-empty-desc">{t("code.empty.desc")}</p>
    </div>
  );
}

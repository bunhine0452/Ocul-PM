// 파일 트리 — 지연 캐시(`dirCache`)와 필터 전용 전량 트리(`tree`), 펼침·필터,
// 그리고 둘을 한 모양으로 펴 주는 파생값(`childrenOf` · `expandedForRender` · `treeOrder`).
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands, type CodeTree as CodeTreeData } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";

import { allOpenPaths, closeOpenPath, type CodeTabsState } from "../codeTabs";
import { visibleEntries } from "../treeSelection";
import {
  ancestorDirs,
  collectDirs,
  collectFiles,
  filterTree,
  flattenToDirMap,
  type DirMap,
} from "../treeUtils";

interface UseCodeTreeArgs {
  projectId: number;
  tabsRef: { current: CodeTabsState };
  setTabs: React.Dispatch<React.SetStateAction<CodeTabsState>>;
  /** 지금 보고 있는 파일 — 조상 폴더를 펼쳐 두고 읽어 둔다. */
  selected: string | null;
  refreshDirtyPaths: () => void;
}

export function useCodeTree({ projectId, tabsRef, setTabs, selected, refreshDirtyPaths }: UseCodeTreeArgs) {
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
    // `tabsRef`·`setTabs` 는 정체가 고정된 ref·setter — 적혀 있어도 재실행 조건은 그대로다.
  }, [treeStatus, fileSet, projectId, tabsRef, setTabs]);

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

  /** 지금 트리에 보이는 순서 — ⇧ 범위 선택과 화살표 이동의 기준. */
  const treeOrder = useMemo(
    () => visibleEntries(childrenOf, expandedForRender),
    [childrenOf, expandedForRender],
  );

  return {
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
  };
}

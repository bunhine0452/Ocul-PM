// 트리 행과의 상호작용 — 클릭(열기·펼치기·⌘/⇧ 고르기), 키보드 표면(`useTreeKeys`),
// 로빙 tabindex 의 주인(`treeFocusPath`), 우클릭 메뉴.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useCallback } from "react";

import type { CodeMenuItem } from "../CodeContextMenu";
import type { CodeTabsState } from "../codeTabs";
import type { TreeHit } from "../importTarget";
import { treeMenuItems } from "../treeMenu";
import {
  clickIntent,
  marksOf,
  rangeBetween,
  toggleMark,
  type Marks,
  type TreeMark,
} from "../treeSelection";
import { useTreeKeys } from "../useTreeKeys";

interface UseTreeInteractionArgs {
  /** 지금 트리에 보이는 순서 — ⇧ 범위 선택과 화살표 이동의 기준. */
  treeOrder: readonly TreeMark[];
  expandedForRender: Set<string>;
  treeFocus: TreeHit | null;
  setTreeFocus: (hit: TreeHit) => void;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadDir: (dirPath: string, force?: boolean) => void;
  setMarks: React.Dispatch<React.SetStateAction<Marks>>;
  markAnchor: string | null;
  setMarkAnchor: (path: string) => void;
  clearMarks: () => void;
  targetsFor: (path: string, isDir: boolean) => TreeMark[];
  openPath: (path: string, line: number | null, pane?: number, sel?: { preview?: boolean }) => void;
  startCreate: (parent: string, isDir: boolean) => void;
  startRename: (path: string, isDir: boolean) => void;
  askDelete: (targets: TreeMark[]) => void;
  moveInto: (froms: readonly string[], toDir: string) => void;
  pasteFiles: () => void;
  /** 지금 보고 있는 파일. */
  selected: string | null;
  tabsRef: { current: CodeTabsState };
  setMenu: (menu: { x: number; y: number; items: CodeMenuItem[] } | null) => void;
}

export function useTreeInteraction({
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
  moveInto,
  pasteFiles,
  selected,
  tabsRef,
  setMenu,
}: UseTreeInteractionArgs) {
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
    [loadDir, setExpanded, setTreeFocus],
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
    [markAnchor, treeOrder, toggleDir, openPath, setMarks, setMarkAnchor, setTreeFocus],
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
    moveInto,
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
    [startCreate, startRename, askDelete, targetsFor, cut.size, cutFrom, pasteInto, openPath, tabsRef, setMenu],
  );

  return { clickRow, treeFocusPath, cut, cutFrom, pasteHere, onTreeKeyDown, openTreeMenu };
}

/**
 * 트리의 **키보드 표면** — 화살표 이동과 ⌘X/⌘V.
 *
 * 둘을 한 훅에 두는 이유는 같은 것을 공유하기 때문이다: "트리가 지금 서 있는
 * 자리"(`focus`). 화살표가 그 자리를 옮기고, ⌘X 가 그 자리를 잘라내고, ⌘V 가
 * 그 자리로 넣는다. 자리를 둘로 나누면 손과 키보드가 서로 다른 '지금' 을 갖는다.
 *
 * 키의 뜻풀이는 `treeKeys.ts`(순수)가, 무엇이 딸려 오는지는
 * `treeSelection.ts`(순수)가 한다. 여기는 그 답을 실행만 한다.
 */
import { useCallback, useState } from "react";

import { toast } from "@/lib/toast";
import { t } from "@/i18n";

import { importDestDir, type TreeHit } from "./importTarget";
import { treeKeyAction } from "./treeKeys";
import { marksOf, rangeBetween, toggleMark, type Marks, type TreeMark } from "./treeSelection";
import { TREE_PATH_ATTR } from "./treeDom";

export interface UseTreeKeysArgs {
  /** 지금 보이는 행들, 위에서 아래 순서로. */
  order: readonly TreeMark[];
  /** 트리가 서 있는 자리 (키보드 포커스 = ⌘X/⌘V 의 기준). */
  focus: TreeHit | null;
  setFocus: (hit: TreeHit) => void;
  isExpanded: (dir: string) => boolean;
  setMarks: React.Dispatch<React.SetStateAction<Marks>>;
  markAnchor: string | null;
  setMarkAnchor: (path: string) => void;
  clearMarks: () => void;
  /** 이 행에 건 조작이 실제로 데려가는 것들 (뽑아 둔 것 안이면 전부). */
  targetsFor: (path: string, isDir: boolean) => TreeMark[];
  toggleDir: (path: string) => void;
  openPath: (path: string, line: number | null) => void;
  startRename: (path: string, isDir: boolean) => void;
  askDelete: (targets: TreeMark[]) => void;
  moveInto: (froms: readonly string[], toDir: string) => void;
  /** 앱 **밖**(Finder) 클립보드 들여오기 — 잘라 둔 것이 없을 때의 ⌘V. */
  pasteFiles: () => void;
  /** 지금 보고 있는 파일 — 트리에 선 자리가 없을 때 ⌘V 가 기댈 마지막 단서. */
  selectedPath: string | null;
}

export function useTreeKeys(args: UseTreeKeysArgs) {
  const {
    order,
    focus,
    setFocus,
    isExpanded,
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
    selectedPath,
  } = args;

  /** ⌘X 로 잘라 둔 것들. ⌘V 까지 디스크에는 아무 일도 일어나지 않는다. */
  const [cut, setCut] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * ⌘X — 잘라 둔다.
   *
   * 깊은 트리에서는 드래그보다 이쪽이 늘 빠르다: 스크롤을 두 번 해야 보이는
   * 폴더로는 손이 닿지 않는다. 잘린 행은 사라지지 않고 흐려진다 — "아직 아무
   * 일도 없다" 가 보여야 ⌘V 를 안 눌러도 안전하다는 것을 안다.
   *
   * `at` 은 우클릭한 행. 없으면 트리가 서 있는 자리를 쓴다.
   */
  const cutFrom = useCallback(
    (at: TreeHit | null) => {
      const base = at ?? focus;
      if (!base) return;
      const paths = targetsFor(base.path, base.isDir).map((m) => m.path);
      if (paths.length === 0) return;
      setCut(new Set(paths));
      toast.info(t("code.ops.cutMarked", { count: paths.length }));
    },
    [focus, targetsFor],
  );

  /** 잘라 둔 것을 이 자리로 옮긴다. 파일 위면 그 파일의 폴더로 접힌다. */
  const pasteInto = useCallback(
    (at: TreeHit | null) => {
      if (cut.size === 0) return;
      const fallback: TreeHit | null = selectedPath
        ? { path: selectedPath, isDir: false }
        : null;
      moveInto([...cut], importDestDir(at ?? focus, fallback));
      setCut(new Set());
    },
    [cut, focus, selectedPath, moveInto],
  );

  /**
   * ⌘V — 잘라 둔 것이 있으면 **옮기고**, 없으면 Finder 클립보드를 들여온다.
   *
   * 두 갈래가 한 키를 나눠 쓰는 이유는 사용자에게는 같은 동작이기 때문이다:
   * "여기에 넣어라". 어디서 왔는지는 앱이 알아서 가른다.
   */
  const pasteHere = useCallback(() => {
    if (cut.size === 0) pasteFiles();
    else pasteInto(null);
  }, [cut.size, pasteFiles, pasteInto]);

  /**
   * 트리 위의 키 입력 — 화살표·⏎·Space·F2·⌫·Esc.
   *
   * 포커스는 상태와 **DOM 양쪽**을 옮긴다: 상태는 로빙 tabindex 의 주인을
   * 정하고, 실제 포커스는 그 행에 직접 준다 (키를 받은 자리가 이미 트리 안이라
   * 훔치는 것이 아니다).
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const action = treeKeyAction(e, { order, focus: focus?.path ?? null, isExpanded });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      switch (action.kind) {
        case "clear":
          clearMarks();
          setCut(new Set());
          return;
        case "move": {
          const isDir = order.find((x) => x.path === action.path)?.isDir ?? false;
          setFocus({ path: action.path, isDir });
          if (action.extend) {
            setMarks(marksOf(rangeBetween(order, markAnchor ?? focus?.path ?? null, action.path)));
          } else {
            setMarks(marksOf([{ path: action.path, isDir }]));
            setMarkAnchor(action.path);
          }
          e.currentTarget
            .querySelector<HTMLElement>(`[${TREE_PATH_ATTR}="${CSS.escape(action.path)}"]`)
            ?.focus();
          return;
        }
        case "expand":
        case "collapse":
          toggleDir(action.path);
          return;
        case "mark":
          setMarks((prev) => toggleMark(prev, { path: action.path, isDir: action.isDir }));
          setMarkAnchor(action.path);
          return;
        case "activate":
          if (action.isDir) toggleDir(action.path);
          else openPath(action.path, null);
          return;
        case "rename":
          startRename(action.path, action.isDir);
          return;
        case "delete":
          askDelete(targetsFor(action.path, action.isDir));
      }
    },
    [
      order,
      focus,
      isExpanded,
      markAnchor,
      setFocus,
      setMarks,
      setMarkAnchor,
      clearMarks,
      toggleDir,
      openPath,
      startRename,
      askDelete,
      targetsFor,
    ],
  );

  return { cut, cutFrom, pasteInto, pasteHere, onKeyDown };
}

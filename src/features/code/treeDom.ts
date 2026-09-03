// 좌표 → 트리 행. **DOM 을 아는 유일한 자리**다.
//
// 어느 폴더로 가는가(제품 규칙)는 `importTarget`, 그리기는 `CodeTree`, 몸짓은
// `useTreeDrag` 가 맡는다. 좌표로 행을 되찾는 일만 여기 모아 둔 이유는 두
// 소비자가 있기 때문이다: OS 드롭(Tauri 가 웹뷰의 dragover 를 가로채므로
// `elementFromPoint` 말고는 길이 없다)과 트리 안 포인터 드래그.
import type { TreeHit } from "./importTarget";

/** 트리 행에 심는 표식 — 좌표로 행을 되찾는 유일한 통로다. */
export const TREE_PATH_ATTR = "data-tree-path";
export const TREE_DIR_ATTR = "data-tree-dir";

/** 좌표 아래의 트리 행. 트리 밖이면 null, 트리 배경이면 루트(`""`). */
export function hitAt(x: number, y: number): TreeHit | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const row = el.closest(`[${TREE_PATH_ATTR}]`);
  if (row) {
    return {
      path: row.getAttribute(TREE_PATH_ATTR) ?? "",
      isDir: row.getAttribute(TREE_DIR_ATTR) === "1",
    };
  }
  // 행 사이 여백·빈 트리 — 트리 안이기만 하면 루트로 받는다.
  return el.closest(".code-tree") ? { path: "", isDir: true } : null;
}

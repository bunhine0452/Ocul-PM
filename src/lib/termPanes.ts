// 터미널 분할 페인 트리 (2026-07-20 터미널 개편) — 순수 함수 모듈.
//
// iTerm2/cmux 식 분할: 탭 하나가 이진 트리 레이아웃을 가진다. leaf 는 PTY
// 세션(sid) 하나, split 은 가로(row)/세로(col) 2분할 + 비율. 모든 변형은
// 불변(immutable) — 변경 없으면 같은 참조를 돌려줘 React 재렌더를 아낀다.
// WorkspaceContext 의 TerminalTab.panes 로 영속된다.

export type PaneDir = "row" | "col";

export type PaneNode =
  | { type: "leaf"; sid: string }
  | { type: "split"; dir: PaneDir; ratio: number; a: PaneNode; b: PaneNode };

export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;

export function leaf(sid: string): PaneNode {
  return { type: "leaf", sid };
}

export function collectSids(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.sid];
  return [...collectSids(node.a), ...collectSids(node.b)];
}

export function firstSid(node: PaneNode): string {
  return node.type === "leaf" ? node.sid : firstSid(node.a);
}

export function clampRatio(r: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));
}

/**
 * target leaf 를 split(기존 leaf, `incoming`) 로 치환한다. target 이 없으면
 * 원본 그대로 (참조까지 동일 — 재렌더를 아낀다).
 *
 * `incoming` 이 **서브트리**여도 된다: 분할이 있는 터미널 탭을 통째로 다른 탭의
 * 페인에 끌어다 붙일 때 그 탭의 트리가 그대로 들어온다 (2026-08-28 드래그 분할).
 * `before` 면 끌려온 쪽이 위/왼쪽에 놓인다 — 사용자가 겨눈 가장자리가 곧
 * 새 페인이 앉을 자리이므로, 이 방향을 못 정하면 왼쪽에 놓으려던 것이 늘
 * 오른쪽에 붙는다.
 */
export function splitPaneWith(
  node: PaneNode,
  target: string,
  dir: PaneDir,
  incoming: PaneNode,
  before = false,
): PaneNode {
  if (node.type === "leaf") {
    if (node.sid !== target) return node;
    return before
      ? { type: "split", dir, ratio: 0.5, a: incoming, b: node }
      : { type: "split", dir, ratio: 0.5, a: node, b: incoming };
  }
  const a = splitPaneWith(node.a, target, dir, incoming, before);
  if (a !== node.a) return { ...node, a };
  const b = splitPaneWith(node.b, target, dir, incoming, before);
  if (b !== node.b) return { ...node, b };
  return node;
}

/** target leaf 를 split(기존 leaf, 새 leaf) 로 치환. target 이 없으면 원본 그대로. */
export function splitPane(
  node: PaneNode,
  target: string,
  dir: PaneDir,
  newSid: string,
): PaneNode {
  return splitPaneWith(node, target, dir, leaf(newSid));
}

/** target leaf 를 제거 — 형제 서브트리가 그 자리를 차지한다. 루트까지 비면 null. */
export function removePane(node: PaneNode, target: string): PaneNode | null {
  if (node.type === "leaf") return node.sid === target ? null : node;
  const a = removePane(node.a, target);
  if (a === null) return node.b;
  if (a !== node.a) return { ...node, a };
  const b = removePane(node.b, target);
  if (b === null) return node.a;
  if (b !== node.b) return { ...node, b };
  return node;
}

/**
 * split 노드의 비율 갱신. `path` 는 루트에서의 경로 — "" 는 루트,
 * "a"/"ba" 처럼 a/b 를 이어붙인 문자열로 중첩 split 을 지정한다.
 */
export function setRatio(node: PaneNode, path: string, ratio: number): PaneNode {
  if (node.type !== "split") return node;
  if (path === "") return { ...node, ratio: clampRatio(ratio) };
  const head = path[0];
  const rest = path.slice(1);
  if (head === "a") {
    const a = setRatio(node.a, rest, ratio);
    return a === node.a ? node : { ...node, a };
  }
  if (head === "b") {
    const b = setRatio(node.b, rest, ratio);
    return b === node.b ? node : { ...node, b };
  }
  return node;
}

/** target 을 닫았을 때 포커스를 넘길 형제 쪽 첫 leaf sid (단일 leaf 트리면 null). */
export function siblingSid(node: PaneNode, target: string): string | null {
  if (node.type === "leaf") return null;
  const aSids = collectSids(node.a);
  if (aSids.includes(target)) {
    return aSids.length === 1 ? firstSid(node.b) : siblingSid(node.a, target);
  }
  const bSids = collectSids(node.b);
  if (bSids.includes(target)) {
    return bSids.length === 1 ? firstSid(node.a) : siblingSid(node.b, target);
  }
  return null;
}

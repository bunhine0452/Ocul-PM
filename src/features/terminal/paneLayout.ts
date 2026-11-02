/**
 * 터미널 칸 나누기 (11-02, Orca 「split panes」 그대로) — 칸은 이진 트리다.
 *
 * Orca 의 `PaneManager` 는 칸을 둘로 쪼갤 때마다 그 칸을 `pane-split`(row 또는 column) 으로
 * 감싸고 두 자식 사이에 경계를 넣는다. 칸을 닫으면 짝을 부모 자리로 올린다(`promoteSibling`).
 * 크기는 두 자식의 비율 하나, 「고르게」는 같은 방향으로 이어진 잎 수로 나눈다
 * (`getEqualizeWeight`). 여기는 그 트리를 DOM 대신 값으로 들고, 잎은 터미널 세션 id 다.
 * 순수 함수만 — 화면(`PaneTree.tsx`)이 그린다.
 */

/** `row` = 왼쪽 | 오른쪽(⌘D), `col` = 위 / 아래(⇧⌘D). */
export type PaneDir = "row" | "col";

export type PaneNode =
  | { kind: "leaf"; id: number }
  | { kind: "split"; dir: PaneDir; ratio: number; a: PaneNode; b: PaneNode };

/** 경계를 끌어도 한쪽이 이보다 작아지지 않는다(비율). 화면이 px 하한을 따로 건다. */
const MIN_RATIO = 0.1;

export const leaf = (id: number): PaneNode => ({ kind: "leaf", id });

/** 잎을 왼쪽 → 오른쪽, 위 → 아래 순서로. */
export function leaves(node: PaneNode | null): number[] {
  if (!node) return [];
  return node.kind === "leaf" ? [node.id] : [...leaves(node.a), ...leaves(node.b)];
}

export function hasLeaf(node: PaneNode | null, id: number): boolean {
  return leaves(node).includes(id);
}

/** `target` 칸을 둘로 — 원래 것은 왼쪽(위), 새 것은 오른쪽(아래). */
export function splitLeaf(node: PaneNode, target: number, id: number, dir: PaneDir): PaneNode {
  if (node.kind === "leaf") {
    return node.id === target ? { kind: "split", dir, ratio: 0.5, a: node, b: leaf(id) } : node;
  }
  return { ...node, a: splitLeaf(node.a, target, id, dir), b: splitLeaf(node.b, target, id, dir) };
}

/** 칸 하나를 뺀다 — 짝이 부모 자리로 올라간다. 마지막 칸이면 `null`. */
export function removeLeaf(node: PaneNode | null, id: number): PaneNode | null {
  if (!node) return null;
  if (node.kind === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** 칸에 보이는 세션을 바꾼다(탭에서 안 보이던 세션을 고를 때). */
export function replaceLeaf(node: PaneNode, from: number, to: number): PaneNode {
  if (node.kind === "leaf") return node.id === from ? leaf(to) : node;
  return { ...node, a: replaceLeaf(node.a, from, to), b: replaceLeaf(node.b, from, to) };
}

/** 살아 있는 세션만 남긴다(닫힌 세션의 칸을 접는다). */
export function prune(node: PaneNode | null, keep: ReadonlySet<number>): PaneNode | null {
  let out = node;
  for (const id of leaves(node)) if (!keep.has(id)) out = removeLeaf(out, id);
  return out;
}

/** 경로("a"/"b" 의 줄)로 가리킨 나눔의 비율을 바꾼다. 양끝은 MIN_RATIO 로 막는다. */
export function setRatio(node: PaneNode, path: string, ratio: number): PaneNode {
  if (node.kind === "leaf") return node;
  if (path === "") {
    const r = Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
    return r === node.ratio ? node : { ...node, ratio: r };
  }
  const side = path[0] === "a" ? "a" : "b";
  return { ...node, [side]: setRatio(node[side], path.slice(1), ratio) };
}

/** 같은 방향으로 이어진 잎 수 — 「고르게」의 무게(Orca `getEqualizeWeight`). */
function weight(node: PaneNode, dir: PaneDir): number {
  if (node.kind === "leaf" || node.dir !== dir) return 1;
  return weight(node.a, dir) + weight(node.b, dir);
}

/** 모든 칸을 고르게 — 오른쪽으로 세 번 나눈 줄은 넷이 4분의 1씩. */
export function equalize(node: PaneNode): PaneNode {
  if (node.kind === "leaf") return node;
  const wa = weight(node.a, node.dir);
  const wb = weight(node.b, node.dir);
  return { ...node, ratio: wa / (wa + wb), a: equalize(node.a), b: equalize(node.b) };
}

/** 화면이 들고 있는 것 — 칸 트리와 그중 고른 칸(입력이 가는 곳). */
export interface PaneView {
  layout: PaneNode | null;
  active: number | null;
}

/**
 * 세션을 화면에 — 이미 칸에 있으면 그 칸을 고르고, 아니면 **고른 칸**에 갈아 끼운다(탭 · 「다음」 실행).
 * 갈려 나간 세션은 탭에 남아 계속 돈다.
 */
export function show(v: PaneView, id: number): PaneView {
  if (hasLeaf(v.layout, id)) return v.active === id ? v : { ...v, active: id };
  if (v.layout && v.active != null && hasLeaf(v.layout, v.active)) {
    return { layout: replaceLeaf(v.layout, v.active, id), active: id };
  }
  return { layout: leaf(id), active: id };
}

/** 세션 목록이 바뀐 뒤 — 닫힌 세션의 칸을 접고, 고른 칸이 사라졌으면 남은 첫 칸을, 칸이 없으면 마지막 세션을. */
export function syncView(v: PaneView, alive: readonly number[]): PaneView {
  const layout = prune(v.layout, new Set(alive));
  if (!layout) {
    const last = alive[alive.length - 1];
    return last == null ? { layout: null, active: null } : { layout: leaf(last), active: last };
  }
  const active = v.active != null && hasLeaf(layout, v.active) ? v.active : leaves(layout)[0];
  return layout === v.layout && active === v.active ? v : { layout, active };
}

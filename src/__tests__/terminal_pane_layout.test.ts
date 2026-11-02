// 터미널 칸 트리 (11-02, Orca split panes) — 나누기 · 빼기 · 고르게 · 화면 동기의 순수 규칙.
import { describe, expect, it } from "vitest";

import {
  equalize,
  leaf,
  leaves,
  removeLeaf,
  setRatio,
  show,
  splitLeaf,
  syncView,
  type PaneNode,
} from "@/features/terminal/paneLayout";

describe("칸 트리", () => {
  it("나누면 원래 칸이 왼쪽(위), 새 칸이 오른쪽(아래) — 순서는 읽는 차례", () => {
    let n: PaneNode = leaf(1);
    n = splitLeaf(n, 1, 2, "row");
    n = splitLeaf(n, 1, 3, "col");
    expect(leaves(n)).toEqual([1, 3, 2]);
  });

  it("칸을 빼면 짝이 부모 자리로 올라가고, 마지막 칸이면 비운다 (Orca promoteSibling)", () => {
    const n = splitLeaf(splitLeaf(leaf(1), 1, 2, "row"), 2, 3, "col");
    const out = removeLeaf(n, 2);
    expect(out).toEqual({ kind: "split", dir: "row", ratio: 0.5, a: leaf(1), b: leaf(3) });
    expect(removeLeaf(removeLeaf(out, 1), 3)).toBeNull();
  });

  it("고르게 — 같은 방향으로 이어진 칸 수로 나눈다 (오른쪽으로 셋이면 3분의 1씩)", () => {
    const n = equalize(splitLeaf(splitLeaf(leaf(1), 1, 2, "row"), 2, 3, "row"));
    if (n.kind !== "split" || n.b.kind !== "split") throw new Error("shape");
    expect(n.ratio).toBeCloseTo(1 / 3);
    expect(n.b.ratio).toBeCloseTo(1 / 2);
  });

  it("비율은 경로로 가리키고 양끝에서 막힌다", () => {
    const n = splitLeaf(splitLeaf(leaf(1), 1, 2, "row"), 2, 3, "col");
    const m = setRatio(n, "b", 0.99);
    if (m.kind !== "split" || m.b.kind !== "split") throw new Error("shape");
    expect(m.b.ratio).toBe(0.9);
    expect(m.ratio).toBe(0.5);
  });
});

describe("화면 동기", () => {
  it("칸에 없는 세션은 고른 칸에 갈아 끼우고, 있는 세션이면 그 칸을 고른다", () => {
    const v = { layout: splitLeaf(leaf(1), 1, 2, "row"), active: 2 };
    expect(show(v, 3)).toEqual({ layout: splitLeaf(leaf(1), 1, 3, "row"), active: 3 });
    expect(show(v, 1)).toEqual({ ...v, active: 1 });
  });

  it("닫힌 세션의 칸을 접고, 고른 칸이 사라지면 남은 첫 칸을, 다 사라지면 마지막 세션을", () => {
    const v = { layout: splitLeaf(leaf(1), 1, 2, "row"), active: 2 };
    expect(syncView(v, [1, 3])).toEqual({ layout: leaf(1), active: 1 });
    expect(syncView(v, [3, 4])).toEqual({ layout: leaf(4), active: 4 });
    expect(syncView(v, [])).toEqual({ layout: null, active: null });
    expect(syncView(v, [1, 2, 5])).toBe(v);
  });
});

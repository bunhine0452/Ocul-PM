// 칸 사이 이동 (11-02, ⌥⌘ + 방향키) — 트리 형제가 아니라 화면의 자리로 고른다.
import { describe, expect, it } from "vitest";

import { neighborOf, type PaneRect } from "@/features/terminal/paneNav";

// ┌───┬───┐
// │ 1 │ 2 │
// │   ├─┬─┤
// │   │3│4│
// └───┴─┴─┘
const rects: PaneRect[] = [
  { id: 1, x: 0, y: 0, w: 500, h: 600 },
  { id: 2, x: 501, y: 0, w: 500, h: 300 },
  { id: 3, x: 501, y: 301, w: 250, h: 299 },
  { id: 4, x: 752, y: 301, w: 249, h: 299 },
];

describe("칸 사이 이동", () => {
  it("방향의 가장 가까운 칸 — 겹치는 칸이 먼저, 같으면 중심이 가까운 칸", () => {
    expect(neighborOf(rects, 1, "right")).toBe(2);
    expect(neighborOf(rects, 4, "left")).toBe(3);
    expect(neighborOf(rects, 3, "left")).toBe(1);
    expect(neighborOf(rects, 4, "up")).toBe(2);
    expect(neighborOf(rects, 2, "down")).toBe(3);
  });

  it("그 방향에 칸이 없으면 그대로", () => {
    expect(neighborOf(rects, 1, "left")).toBeNull();
    expect(neighborOf(rects, 2, "up")).toBeNull();
    expect(neighborOf(rects, 9, "up")).toBeNull();
  });
});

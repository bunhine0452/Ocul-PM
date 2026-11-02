/**
 * 칸 사이 이동 (11-02, ⌥⌘ + 방향키 — iTerm 과 같은 키) — 화면에 보이는 칸의 자리로 고른다.
 *
 * 트리 모양으로 고르면 「오른쪽 칸」 이 트리의 형제가 아닐 때(오른쪽을 아래로 또 나눈 경우) 엉뚱한 칸으로
 * 간다. 그래서 칸의 실제 사각형을 본다: 그 방향 가장자리 너머에 있고, 직각 방향으로 겹치는 칸 중 가장 가까운
 * 것. 겹치는 칸이 없으면 그 방향의 가장 가까운 칸. 순수 함수 — 사각형은 화면이 잰다.
 */

export type PaneMove = "left" | "right" | "up" | "down";

export interface PaneRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 경계선 · 반올림 오차. */
const SLACK = 4;

export function neighborOf(rects: readonly PaneRect[], from: number, dir: PaneMove): number | null {
  const s = rects.find((r) => r.id === from);
  if (!s) return null;
  const horizontal = dir === "left" || dir === "right";
  const beyond = (c: PaneRect) => {
    switch (dir) {
      case "right":
        return c.x >= s.x + s.w - SLACK;
      case "left":
        return c.x + c.w <= s.x + SLACK;
      case "down":
        return c.y >= s.y + s.h - SLACK;
      case "up":
        return c.y + c.h <= s.y + SLACK;
    }
  };
  const overlap = (c: PaneRect) =>
    horizontal
      ? Math.min(s.y + s.h, c.y + c.h) - Math.max(s.y, c.y)
      : Math.min(s.x + s.w, c.x + c.w) - Math.max(s.x, c.x);
  const gap = (c: PaneRect) => {
    switch (dir) {
      case "right":
        return c.x - (s.x + s.w);
      case "left":
        return s.x - (c.x + c.w);
      case "down":
        return c.y - (s.y + s.h);
      case "up":
        return s.y - (c.y + c.h);
    }
  };
  // 겹치는 칸이 우선 — 그중 가까운 것, 같으면 직각 방향 중심이 가까운 것.
  const centre = (c: PaneRect) => (horizontal ? Math.abs(c.y + c.h / 2 - (s.y + s.h / 2)) : Math.abs(c.x + c.w / 2 - (s.x + s.w / 2)));
  const cands = rects.filter((c) => c.id !== from && beyond(c));
  if (cands.length === 0) return null;
  const facing = cands.filter((c) => overlap(c) > SLACK);
  const pool = facing.length > 0 ? facing : cands;
  pool.sort((a, b) => gap(a) - gap(b) || centre(a) - centre(b));
  return pool[0].id;
}

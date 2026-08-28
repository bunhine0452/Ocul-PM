/**
 * 터미널 드래그-분할의 순수 계산 (2026-08-28).
 *
 * 탭이나 페인을 끌어서 **어느 페인의 어느 가장자리**에 놓을지 판정하고, 놓기
 * 전에 보여 줄 미리보기 상자를 만든다. DOM·포인터 이벤트를 모르는 순수 함수라
 * 경계(모서리·정확히 절반·바깥)를 단위 테스트로 못 박을 수 있다 — 드래그는
 * 손으로 재현하기 가장 번거로운 조작이라 여기서 잡지 못하면 아무 데서도 못 잡는다.
 *
 * VS Code·iTerm2 와 같은 관습을 따른다: 가장자리 띠에 들어가면 그쪽으로 분할,
 * 가운데는 아무 일도 하지 않는다(= 취소).
 */
import type { PaneDir } from "@/lib/termPanes";

export type DropEdge = "left" | "right" | "top" | "bottom" | "center";

/** 페인의 화면 상자 — `DOMRect` 중 필요한 네 값만 (테스트에서 만들기 쉽게). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 가장자리 띠의 두께 (페인 크기 대비).
 *
 * 0.5 면 가운데가 사라져 취소할 자리가 없어지고, 0.15 쯤이면 좁은 도크에서
 * 겨냥이 불가능해진다. 0.3 은 "가장자리를 노리면 반드시 잡히고, 한가운데는
 * 확실히 취소" 가 둘 다 성립하는 지점이다.
 */
export const EDGE_BAND = 0.3;

/**
 * 상자 안 좌표가 가리키는 가장자리. 바깥이면 `center`(= 놓을 자리 없음).
 *
 * 네 변까지의 거리 중 **가장 가까운 쪽**을 고른다 — 사분면으로 나누면 모서리
 * 근처에서 위/왼쪽 판정이 45° 선을 따라 요동치는데, 거리 기준은 그 선 위에서만
 * 갈리므로 손이 흔들려도 결과가 안 튄다.
 */
export function dropEdge(box: Box, x: number, y: number): DropEdge {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const fx = (x - box.left) / w;
  const fy = (y - box.top) / h;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return "center";

  const distances: Array<[DropEdge, number]> = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  let best: DropEdge = "center";
  let min = Number.POSITIVE_INFINITY;
  for (const [edge, d] of distances) {
    if (d < min) {
      min = d;
      best = edge;
    }
  }
  return min <= EDGE_BAND ? best : "center";
}

/** 가장자리를 분할 방향으로 — `before` 면 끌려온 쪽이 왼쪽/위에 앉는다. */
export function edgeToSplit(edge: DropEdge): { dir: PaneDir; before: boolean } | null {
  switch (edge) {
    case "left":
      return { dir: "row", before: true };
    case "right":
      return { dir: "row", before: false };
    case "top":
      return { dir: "col", before: true };
    case "bottom":
      return { dir: "col", before: false };
    default:
      return null;
  }
}

/**
 * 놓기 전에 그려 줄 상자 — 그 자리에 놓으면 **차지할 넓이**를 그대로 보여준다.
 * 가운데(취소)는 `null` 이라 아무것도 그리지 않는다: 취소를 반쪽짜리 하이라이트로
 * 그리면 놓아도 된다는 뜻으로 읽힌다.
 */
export function previewBox(box: Box, edge: DropEdge): Box | null {
  const half = { w: box.width / 2, h: box.height / 2 };
  switch (edge) {
    case "left":
      return { left: box.left, top: box.top, width: half.w, height: box.height };
    case "right":
      return { left: box.left + half.w, top: box.top, width: half.w, height: box.height };
    case "top":
      return { left: box.left, top: box.top, width: box.width, height: half.h };
    case "bottom":
      return { left: box.left, top: box.top + half.h, width: box.width, height: half.h };
    default:
      return null;
  }
}

/** 상자 안에 점이 있는가 — 탭 줄·페인 히트테스트 공용. */
export function contains(box: Box, x: number, y: number): boolean {
  return (
    x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
  );
}

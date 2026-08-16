// 플로팅 엣지 기하 — 순수 함수 (그래프 리디자인 2026-08-16).
//
// 기존 엣지는 모든 노드의 왼쪽(입)/오른쪽(출) 고정 핸들에 붙어서, 대상이
// 소스보다 왼쪽에 있으면 화면을 크게 돌아 나가는 곡선(헤어볼의 주범)이 됐다.
// 플로팅 엣지는 두 노드 중심을 잇는 선이 각 사각형 경계와 만나는 점을 그때그때
// 계산해 최단 방향으로 붙는다. React Flow 공식 floating-edges 레시피의 기하를
// 프레임워크 타입 없이 순수 함수로 옮긴 것 — 단위 테스트 대상.

export interface NodeRect {
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}

/** 엣지가 노드의 어느 변에서 나가는지 — Position enum 은 컴포넌트 쪽에서 매핑. */
export type Side = "left" | "right" | "top" | "bottom";

export interface EdgeGeom {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourceSide: Side;
  targetSide: Side;
}

function centerOf(r: NodeRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** `node` 사각형 경계에서 `other` 중심을 향하는 선이 만나는 점.
 *  겹치거나 중심이 일치해도 NaN 없이 노드 중심을 돌려준다. */
export function rectIntersection(
  node: NodeRect,
  other: NodeRect,
): { x: number; y: number } {
  const w = node.w / 2;
  const h = node.h / 2;
  const x2 = node.x + w;
  const y2 = node.y + h;
  const c = centerOf(other);
  const xx1 = (c.x - x2) / (2 * w) - (c.y - y2) / (2 * h);
  const yy1 = (c.x - x2) / (2 * w) + (c.y - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

/** 교차점이 노드의 어느 변 위인지. 베지어 제어점 방향을 정한다. */
export function sideOf(node: NodeRect, p: { x: number; y: number }): Side {
  const nx = Math.round(node.x);
  const ny = Math.round(node.y);
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  if (px <= nx + 1) return "left";
  if (px >= nx + node.w - 1) return "right";
  if (py <= ny + 1) return "top";
  if (py >= ny + node.h - 1) return "bottom";
  return "top";
}

/** 소스→타깃 플로팅 엣지의 시작/끝 좌표 + 변. */
export function floatingEdgeGeom(source: NodeRect, target: NodeRect): EdgeGeom {
  const s = rectIntersection(source, target);
  const t = rectIntersection(target, source);
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourceSide: sideOf(source, s),
    targetSide: sideOf(target, t),
  };
}

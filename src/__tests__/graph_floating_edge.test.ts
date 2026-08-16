import { describe, it, expect } from "vitest";
import {
  rectIntersection,
  sideOf,
  floatingEdgeGeom,
  type NodeRect,
} from "@/features/graph/floatingEdgeMath";

// Code map floating-edge geometry (2026-08-16 redesign). The edge attaches at
// the intersection of the center-to-center line with each node's border, so
// backward dependencies no longer loop around the whole canvas.

const rect = (x: number, y: number, w: number, h: number): NodeRect => ({ x, y, w, h });

describe("floatingEdgeMath — rectIntersection", () => {
  it("horizontal neighbours meet at the facing border midpoints", () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(300, 0, 100, 50);
    // a → b exits a's RIGHT border at its vertical center.
    expect(rectIntersection(a, b)).toEqual({ x: 100, y: 25 });
    // b → a exits b's LEFT border.
    expect(rectIntersection(b, a)).toEqual({ x: 300, y: 25 });
  });

  it("vertical neighbours meet at top/bottom borders", () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(0, 300, 100, 50);
    expect(rectIntersection(a, b)).toEqual({ x: 50, y: 50 }); // bottom of a
    expect(rectIntersection(b, a)).toEqual({ x: 50, y: 300 }); // top of b
  });

  it("degenerate overlap (same center) stays finite instead of NaN", () => {
    const a = rect(0, 0, 100, 50);
    const p = rectIntersection(a, a);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("diagonal target yields a point on or inside the source bounds", () => {
    const EPS = 1e-6; // 다이아몬드 근사 계산의 부동소수점 오차 허용
    const a = rect(0, 0, 120, 60);
    const b = rect(400, 300, 120, 60);
    const p = rectIntersection(a, b);
    expect(p.x).toBeGreaterThanOrEqual(-EPS);
    expect(p.x).toBeLessThanOrEqual(120 + EPS);
    expect(p.y).toBeGreaterThanOrEqual(-EPS);
    expect(p.y).toBeLessThanOrEqual(60 + EPS);
  });
});

describe("floatingEdgeMath — sideOf", () => {
  const a = rect(0, 0, 100, 50);
  it("classifies border points into sides", () => {
    expect(sideOf(a, { x: 100, y: 25 })).toBe("right");
    expect(sideOf(a, { x: 0, y: 25 })).toBe("left");
    expect(sideOf(a, { x: 50, y: 0 })).toBe("top");
    expect(sideOf(a, { x: 50, y: 50 })).toBe("bottom");
  });
});

describe("floatingEdgeMath — floatingEdgeGeom", () => {
  it("left-to-right pair: source exits right, target enters left", () => {
    const g = floatingEdgeGeom(rect(0, 0, 100, 50), rect(300, 0, 100, 50));
    expect(g.sourceSide).toBe("right");
    expect(g.targetSide).toBe("left");
    expect(g.sx).toBe(100);
    expect(g.tx).toBe(300);
  });

  it("backward dependency (target LEFT of source) attaches directly — no loop-around", () => {
    const g = floatingEdgeGeom(rect(300, 0, 100, 50), rect(0, 0, 100, 50));
    expect(g.sourceSide).toBe("left");
    expect(g.targetSide).toBe("right");
  });

  it("stacked pair connects through top/bottom, not the fixed left/right handles", () => {
    const g = floatingEdgeGeom(rect(0, 0, 100, 50), rect(0, 300, 100, 50));
    expect(g.sourceSide).toBe("bottom");
    expect(g.targetSide).toBe("top");
  });
});

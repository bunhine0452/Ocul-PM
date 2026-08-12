/**
 * 프로젝트 겉모습 — 아이콘·색 해석.
 *
 * 핵심 계약은 **결정성**이다. 고르지 않은 프로젝트도 색을 받는데, 그 값이
 * 실행마다 달라지면 "색으로 프로젝트를 구별한다" 는 목적 자체가 무너진다.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  resolveProjectColor,
  resolveProjectIcon,
} from "@/features/onboarding/home/projectAppearance";

describe("기본 제공 목록", () => {
  it("아이콘 10종 · 색 8종이고 id 가 유일하다", () => {
    expect(PROJECT_ICONS).toHaveLength(10);
    expect(PROJECT_COLORS).toHaveLength(8);
    expect(new Set(PROJECT_ICONS.map((i) => i.id)).size).toBe(PROJECT_ICONS.length);
    expect(new Set(PROJECT_COLORS).size).toBe(PROJECT_COLORS.length);
  });
});

describe("아이콘 그리기", () => {
  /**
   * 직접 그린 선화라 `d` 오타 하나면 **아무 것도 안 그려진 빈 사각형**이 된다
   * — 타입도 렌더도 통과하고 화면에서만 사라지는 종류의 실수다.
   */
  it("열 개 전부 실제 도형을 그린다", () => {
    for (const spec of PROJECT_ICONS) {
      const { container, unmount } = render(React.createElement(spec.Icon));
      const svg = container.querySelector("svg");
      expect(svg, spec.id).toBeTruthy();
      const shapes = svg!.querySelectorAll("path, circle, polyline, rect");
      expect(shapes.length, `${spec.id} 가 비어 있다`).toBeGreaterThan(0);
      for (const el of Array.from(shapes)) {
        if (el.tagName === "path") {
          expect((el.getAttribute("d") ?? "").length, `${spec.id} 의 빈 path`).toBeGreaterThan(4);
        }
      }
      unmount();
    }
  });

  it("색은 currentColor 로 상속된다 (프로젝트 색이 입혀지는 근거)", () => {
    const { container } = render(React.createElement(PROJECT_ICONS[0].Icon));
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
  });
});

describe("색 해석", () => {
  it("고른 값이 있으면 그대로 쓴다", () => {
    expect(resolveProjectColor("ai-pm", "rose")).toBe("rose");
    expect(resolveProjectColor("ai-pm", "slate")).toBe("slate");
  });

  it("안 골랐으면 이름에서 유도하고, 같은 이름은 언제나 같은 색", () => {
    const a = resolveProjectColor("ai-pm", null);
    expect(PROJECT_COLORS).toContain(a);
    expect(resolveProjectColor("ai-pm", null)).toBe(a);
    expect(resolveProjectColor("ai-pm", undefined)).toBe(a);
  });

  /** 아무 것도 안 고른 프로젝트가 전부 회색이면 "색으로 구별" 이 사라진다. */
  it("유도 기본값은 중성색(slate)을 쓰지 않는다", () => {
    const names = ["a", "b", "c", "ai-pm", "saju", "landing", "project01", "docs"];
    for (const n of names) expect(resolveProjectColor(n, null)).not.toBe("slate");
  });

  it("알 수 없는 값은 저장된 적 없는 것으로 보고 유도한다", () => {
    expect(resolveProjectColor("ai-pm", "chartreuse")).toBe(resolveProjectColor("ai-pm", null));
    expect(resolveProjectColor("ai-pm", "")).toBe(resolveProjectColor("ai-pm", null));
  });

  it("이름이 다르면 색이 갈린다 (전부 같은 색으로 뭉치지 않는다)", () => {
    const names = ["ai-pm", "saju", "landing", "project01", "docs-site", "file_converter"];
    expect(new Set(names.map((n) => resolveProjectColor(n, null))).size).toBeGreaterThan(1);
  });
});

describe("아이콘 해석", () => {
  it("고른 값이 있으면 그 아이콘", () => {
    expect(resolveProjectIcon("ai-pm", "donut").id).toBe("donut");
  });

  it("안 골랐으면 결정적으로 유도한다", () => {
    const a = resolveProjectIcon("ai-pm", null);
    expect(PROJECT_ICONS.map((i) => i.id)).toContain(a.id);
    expect(resolveProjectIcon("ai-pm", null).id).toBe(a.id);
  });

  it("없는 id 는 유도로 떨어진다 (빈 아이콘을 그리지 않는다)", () => {
    const fallback = resolveProjectIcon("ai-pm", "does-not-exist");
    expect(fallback.id).toBe(resolveProjectIcon("ai-pm", null).id);
    // lucide 재수출은 forwardRef 객체라 typeof 가 "function" 이 아니다 —
    // "렌더 가능한 무언가" 만 확인한다.
    expect(fallback.Icon).toBeTruthy();
  });
});

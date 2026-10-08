import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isAppInactive, syncIdleMotion } from "@/lib/idleMotion";

// 2026-10-08 검토 — 입력 없는 설치본의 유휴 CPU. 창을 보고 있지 않으면 `<html>` 에
// 속성을 달고, 전역 CSS 가 그 아래의 무한 반복 애니메이션을 일시정지한다.

describe("idle motion pause", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-app-inactive");
  });

  it("marks the root while the window has no focus and clears it on return", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    syncIdleMotion(document);
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(true);

    focus.mockReturnValue(true);
    syncIdleMotion(document);
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(false);
  });

  it("treats a hidden page as inactive even with focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(isAppInactive(document)).toBe(true);
  });

  it("ships the pausing rule in a stylesheet every window loads", () => {
    const css = readFileSync(resolve(__dirname, "../styles/primitives.css"), "utf8");
    expect(css).toMatch(/:root\[data-app-inactive\] \*[\s\S]*animation-play-state: paused !important/);
    const app = readFileSync(resolve(__dirname, "../App.css"), "utf8");
    expect(app).toContain('@import "./styles/primitives.css";');
  });
});

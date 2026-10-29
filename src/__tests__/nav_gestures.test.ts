// 윗줄까지 가지 않고 화면 오가기 (ocul-next #nav-cycle) — ⌃Tab 순환과 두 손가락 쓸기 판정.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { nextScreen, SWIPE_PX, SwipeTracker, useScreenCycle, type WheelSample } from "@/hooks/useNavGestures";

const sample = (dx: number, now: number, over: Partial<WheelSample> = {}): WheelSample => ({
  dx,
  dy: 0,
  pinch: false,
  sideways: false,
  now,
  ...over,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("⌃Tab 화면 순환", () => {
  it("다섯 화면을 돌고 끝에서 처음으로, 설정에서는 첫 · 끝 화면으로", () => {
    expect(nextScreen("today", 1)).toBe("journal");
    expect(nextScreen("terminal", 1)).toBe("today");
    expect(nextScreen("today", -1)).toBe("terminal");
    expect(nextScreen("settings", 1)).toBe("today");
    expect(nextScreen("settings", -1)).toBe("terminal");
  });

  it("⌃Tab 은 다음, ⌃⇧Tab 은 앞 — ⌘Tab · 모달 위에서는 손대지 않는다", () => {
    const setView = vi.fn();
    renderHook(() => useScreenCycle("planner", setView));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(setView.mock.calls).toEqual([["diff"], ["journal"]]);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
    expect(setView).toHaveBeenCalledTimes(2);
  });
});

describe("두 손가락 쓸기", () => {
  it("가로로 모인 만큼 넘기면 한 번 — 손가락이 오른쪽이면 뒤로, 왼쪽이면 앞으로", () => {
    const tr = new SwipeTracker();
    const out = [-40, -40, -40, -40].map((dx, i) => tr.feed(sample(dx, i * 16)));
    expect(out).toEqual([null, null, null, "back"]);
    // 관성 바퀴는 그칠 때까지 무시 — 한 번 쓸어 두 화면을 넘지 않는다.
    expect(tr.feed(sample(-80, 100))).toBeNull();
    expect(tr.feed(sample(-80, 300))).toBeNull();
    // 쉬었다가 새 몸짓.
    expect(tr.feed(sample(SWIPE_PX + 1, 2000))).toBe("forward");
  });

  it("세로 굴림 · 핀치 · 가로로 굴릴 칸 위 · 띄엄띄엄 온 사건은 넘기지 않는다", () => {
    const tr = new SwipeTracker();
    expect(tr.feed(sample(-200, 0, { dy: 180 }))).toBeNull();
    expect(tr.feed(sample(-200, 1000, { pinch: true }))).toBeNull();
    expect(tr.feed(sample(-200, 2000, { sideways: true }))).toBeNull();
    expect(tr.feed(sample(-100, 3000))).toBeNull();
    expect(tr.feed(sample(-100, 3500))).toBeNull(); // 사이가 벌어져 새로 셈
  });
});

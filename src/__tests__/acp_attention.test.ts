import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 감사 라운드 2026-09-11 C3 — 에이전트 주의 신호는 **창이 뒤에 있을 때만**
// 백엔드로 간다. 앞에 있으면 화면이 이미 말하고 있으므로 조용하다.

const calls = vi.hoisted(() => ({ list: [] as unknown[][] }));
vi.mock("@/api/window", () => ({
  windowApi: {
    notifyAgentAttention: (...args: unknown[]) => {
      calls.list.push(args);
      return Promise.resolve(null);
    },
  },
}));

import { notifyIfBehind, windowIsBehind } from "@/features/chat/attention";

let focused = true;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  calls.list = [];
  focused = true;
  visibility = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => vi.restoreAllMocks());

describe("agent attention", () => {
  it("stays quiet while the window is in front", () => {
    expect(windowIsBehind()).toBe(false);
    notifyIfBehind("permission", "ai-pm", "Edit src/x.ts");
    expect(calls.list).toEqual([]);
  });

  it("asks the backend when the window lost focus, trimming the detail", () => {
    focused = false;
    notifyIfBehind("done", "ai-pm", "x".repeat(500));
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0][0]).toBe("done");
    expect(calls.list[0][1]).toBe("ai-pm");
    expect((calls.list[0][2] as string).length).toBe(200);
  });

  it("hidden counts as behind even if focus is reported", () => {
    visibility = "hidden";
    expect(windowIsBehind()).toBe(true);
  });
});

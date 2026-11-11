// TermSessionsChanged refetch coalescing (2026-11-11, Windows perf) — every list read makes the backend
// measure "busy" (a process snapshot on Windows). A burst of change events (status signals, open/close,
// several windows) used to refetch once per event per hook; now one refetch per window of events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  changed: new Set<() => void>(),
  list: vi.fn(async () => []),
  overview: vi.fn(async () => []),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: h.list,
    overview: h.overview,
    onSessionsChanged: (cb: () => void) => {
      h.changed.add(cb);
      return Promise.resolve(() => void h.changed.delete(cb));
    },
  },
}));

import { REFETCH_COALESCE_MS, coalesce, useTermOverview, useWindowTerms } from "@/features/terminal/status";

beforeEach(() => {
  vi.useFakeTimers();
  h.list.mockClear();
  h.overview.mockClear();
  h.changed.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

const fire = (n: number) => {
  for (let i = 0; i < n; i++) for (const cb of h.changed) cb();
};

describe("terminal list refetch", () => {
  it("a burst of change events refetches once per hook, after the window", async () => {
    const a = renderHook(() => useWindowTerms());
    const b = renderHook(() => useTermOverview());
    await act(async () => {});
    expect(h.list).toHaveBeenCalledTimes(1); // first load is immediate
    expect(h.overview).toHaveBeenCalledTimes(1);

    await act(async () => fire(20));
    expect(h.list).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(REFETCH_COALESCE_MS));
    expect(h.list).toHaveBeenCalledTimes(2); // was 21
    expect(h.overview).toHaveBeenCalledTimes(2);

    a.unmount();
    b.unmount();
  });

  it("a steady stream still refetches every window — never starved", () => {
    const fn = vi.fn();
    const c = coalesce(fn, 100);
    for (let t = 0; t < 1000; t += 10) {
      c.call();
      vi.advanceTimersByTime(10);
    }
    expect(fn).toHaveBeenCalledTimes(10);
  });

  it("unmount drops a pending refetch", async () => {
    const a = renderHook(() => useWindowTerms());
    await act(async () => {});
    fire(1);
    a.unmount();
    vi.advanceTimersByTime(REFETCH_COALESCE_MS * 2);
    expect(h.list).toHaveBeenCalledTimes(1);
  });
});

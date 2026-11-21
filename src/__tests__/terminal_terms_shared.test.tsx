// 세션 목록은 창에 하나 (11-22) — 훅이 몇이든 사건 한 묶음에 한 번 읽고, 달라진 것이 없으면 다시 그리지 않는다.
//
// `TermSessionsChanged` 는 어느 창의 어느 세션이든 상태 · 제목 · 끝이 바뀔 때마다 모든 창에 온다. 프로젝트 창
// 하나에는 이 창의 목록을 읽는 훅이 셋이다(셸의 터미널 점 · 셸의 오늘 배지 · 오늘 화면). 예전엔 사건 묶음마다
// 셋이 저마다 `term_list` 를 부르고(읽을 때마다 백엔드가 「도는 중」 을 잰다 — Windows 는 프로세스 스냅숏),
// 답이 앞과 같아도 새 배열이라 셸과 지금 화면이 통째로 다시 그려졌다. 세션 40개가 도는 날에는 다른 창의
// 세션이 낸 사건만으로 읽던 화면이 150ms 마다 다시 섰다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const h = vi.hoisted(() => ({
  changed: new Set<() => void>(),
  sessions: [] as unknown[],
  fail: false,
  list: vi.fn(),
  overview: vi.fn(),
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

import { REFETCH_COALESCE_MS, useTermOverview, useWindowTerms, useWindowTermsState } from "@/features/terminal/status";

function session(id: number, over: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: "2026-11-22T09:00:00+09:00",
    alive: true,
    exit_code: null,
    status: { state: "working", kind: null, msg: null, since: "2026-11-22T09:00:00+09:00", app: "claude" },
    busy: true,
    unseen: false,
    title: `task ${id}`,
    ...over,
  };
}

/** IPC 는 부를 때마다 새 배열 · 새 객체를 준다 — 내용이 같아도 참조는 다르다. */
const fresh = () => (h.sessions as TermInfo[]).map((s) => ({ ...s, status: s.status ? { ...s.status } : null }));

beforeEach(() => {
  vi.useFakeTimers();
  h.changed.clear();
  h.fail = false;
  h.sessions = Array.from({ length: 40 }, (_, i) => session(i + 1));
  h.list.mockReset().mockImplementation(async () => {
    if (h.fail) throw new Error("boom");
    return fresh();
  });
  h.overview.mockReset().mockImplementation(async () => fresh());
});
afterEach(() => {
  vi.useRealTimers();
});

/** 사건 한 묶음 — 몰려 온 사건이 한 번의 다시 읽기로 접힌 뒤까지. */
async function burst(n = 5) {
  await act(async () => {
    for (let i = 0; i < n; i++) for (const cb of [...h.changed]) cb();
  });
  await act(async () => void vi.advanceTimersByTime(REFETCH_COALESCE_MS));
  await act(async () => {});
}

/** 프로젝트 창 하나의 훅 — 이 창의 목록 셋(셸 점 · 셸 배지 · 오늘 화면)과 모든 창의 수 하나(프로젝트 목록). */
function mountWindow() {
  const renders = { list: 0, overview: 0 };
  const lists = [0, 1, 2].map(() =>
    renderHook(() => {
      renders.list += 1;
      return useWindowTerms();
    }),
  );
  const overview = renderHook(() => {
    renders.overview += 1;
    return useTermOverview();
  });
  return { renders, lists, overview, unmount: () => [...lists, overview].forEach((x) => x.unmount()) };
}

describe("this window's session list — one reader per window", () => {
  it("reads once on mount and once per burst of events, however many hooks listen", async () => {
    const w = mountWindow();
    await act(async () => {});
    expect(h.list).toHaveBeenCalledTimes(1); // 셋이 저마다 읽던 때는 3
    for (const l of w.lists) expect(l.result.current).toHaveLength(40);

    for (let i = 0; i < 10; i++) await burst();
    expect(h.list).toHaveBeenCalledTimes(11); // 1 + 묶음 10 — 예전엔 3 + 30
    expect(h.overview).toHaveBeenCalledTimes(11);
    w.unmount();
  });

  it("does not re-render when nothing changed — the list keeps its identity", async () => {
    const w = mountWindow();
    await act(async () => {});
    const before = w.lists.map((l) => l.result.current);
    // 같은 값으로의 첫 갱신에 React 는 그 컴포넌트를 한 번 더 불러 보고 접는다(자식은 그리지 않는다) — 그 한 번은
    // 재지 않는다. 그 뒤로는 부르지도 않는다.
    await burst();
    const base = { ...w.renders };

    for (let i = 0; i < 10; i++) await burst();
    // 다른 창의 세션이 낸 사건 · 같은 상태를 다시 알린 사건 — 이 창이 볼 것은 그대로다.
    expect(w.renders.list - base.list).toBe(0); // 예전엔 30 (훅 셋 × 묶음 10)
    expect(w.renders.overview - base.overview).toBe(0); // 예전엔 10
    w.lists.forEach((l, i) => expect(l.result.current).toBe(before[i]));
    w.unmount();
  });

  it("re-renders each hook once with the new list when a session starts waiting on me", async () => {
    const w = mountWindow();
    await act(async () => {});
    const base = w.renders.list;
    h.sessions = (h.sessions as TermInfo[]).map((s) =>
      s.id === 7 ? { ...s, status: { ...s.status!, state: "blocked", kind: "permission", msg: "approve Write" } } : s,
    );
    await burst();
    expect(w.renders.list - base).toBe(3);
    for (const l of w.lists) expect(l.result.current.find((s) => s.id === 7)?.status?.state).toBe("blocked");
    w.unmount();
  });

  it("an event that lands during a slow read still gets its own read, and the late answer never overwrites it", async () => {
    let release: (v: TermInfo[]) => void = () => {};
    const w = mountWindow();
    await act(async () => {});
    // 느린 읽기(프로세스 스냅숏) — 답이 오기 전에 세션이 끝난다.
    h.list.mockImplementationOnce(() => new Promise<TermInfo[]>((r) => (release = r)));
    const stale = fresh();
    await act(async () => {
      for (const cb of [...h.changed]) cb();
      vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    });
    h.sessions = (h.sessions as TermInfo[]).filter((s) => s.id !== 40);
    await act(async () => {
      for (const cb of [...h.changed]) cb();
      vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    });
    await act(async () => {});
    for (const l of w.lists) expect(l.result.current).toHaveLength(39);
    // 먼저 보낸 느린 읽기가 뒤늦게 답해도 새 목록을 덮지 않는다.
    await act(async () => release(stale));
    for (const l of w.lists) expect(l.result.current).toHaveLength(39);
    w.unmount();
  });

  it("keeps the last list and says failed when a read fails, then reads again on the next event", async () => {
    const a = renderHook(() => useWindowTermsState());
    await act(async () => {});
    expect(a.result.current.state).toBe("ready");
    h.fail = true;
    await burst();
    expect(a.result.current).toMatchObject({ state: "failed" });
    expect(a.result.current.list).toHaveLength(40);
    h.fail = false;
    await burst();
    expect(a.result.current.state).toBe("ready");
    a.unmount();
  });

  it("a hook enabled later (Send to Claude) stays loading until a fresh answer arrives", async () => {
    const shell = renderHook(() => useWindowTerms());
    await act(async () => {});
    const calls = h.list.mock.calls.length;
    const dialog = renderHook(({ on }: { on: boolean }) => useWindowTermsState(on), { initialProps: { on: false } });
    expect(dialog.result.current).toEqual({ list: [], state: "loading" });
    dialog.rerender({ on: true });
    expect(dialog.result.current.state).toBe("loading");
    await act(async () => {});
    // 빈 셸의 「도는 중」 은 사건 없이 바뀐다 — 켤 때 새로 읽는다.
    expect(h.list.mock.calls.length).toBe(calls + 1);
    expect(dialog.result.current.state).toBe("ready");
    expect(dialog.result.current.list).toHaveLength(40);
    dialog.rerender({ on: false });
    expect(dialog.result.current).toEqual({ list: [], state: "loading" });
    shell.unmount();
    dialog.unmount();
  });

  it("stops listening when no hook is left", async () => {
    const w = mountWindow();
    await act(async () => {});
    w.unmount();
    await act(async () => {});
    expect(h.changed.size).toBe(0);
    const calls = h.list.mock.calls.length;
    vi.advanceTimersByTime(REFETCH_COALESCE_MS * 2);
    expect(h.list.mock.calls.length).toBe(calls);
  });
});

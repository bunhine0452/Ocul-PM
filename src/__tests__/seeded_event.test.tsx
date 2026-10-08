import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import type { Session } from "@/lib/bindings";

// review-2026-10-09 {#seeded-event} — 「이벤트로만 세우는 상태」 의 회귀 테스트.
// 이벤트는 진짜로 배달되고(`tauriBus`), 붙기 전에 보낸 것은 버려진다. 예전 코드는
// 아래 첫 테스트에서 「세션 없음」 으로 남는다.

const query = vi.hoisted(() => ({
  resolve: null as null | ((s: unknown) => void),
  calls: [] as number[],
}));

vi.mock("@/lib/bindings", async () => ({
  events: (await import("./helpers/fakeTauriEvents")).tauriBus.events,
  commands: new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "oculpmCurrentSession"
          ? (projectId: number) => {
              query.calls.push(projectId);
              return new Promise((resolve) => {
                query.resolve = (s) => resolve({ status: "ok", data: s });
              });
            }
          : () => Promise.resolve({ status: "ok", data: null }),
    },
  ),
}));

import { tauriBus } from "./helpers/fakeTauriEvents";
import { useCurrentSession } from "@/contexts/useCurrentSession";
import { useSeededEvent } from "@/hooks/useSeededEvent";

const session = (id: string) => ({ id }) as unknown as Session;

beforeEach(() => {
  tauriBus.reset();
  query.resolve = null;
  query.calls = [];
});
afterEach(cleanup);

describe("현재 세션 — 열 때 묻고 이벤트로 바꾼다", () => {
  it("창이 생기기 전에 시작된 세션도 보인다", async () => {
    // 다른 창(또는 앱 기동 직후)에서 이미 시작됐다 — 이 창은 그 이벤트를 못 받는다.
    tauriBus.emit("oculpmSessionStarted", { project_id: 1, session: session("s-early") });
    expect(tauriBus.dropped).toHaveLength(1);

    const set = vi.fn();
    renderHook(() => useCurrentSession(1, true, set));
    await waitFor(() => expect(query.resolve).not.toBeNull());
    query.resolve!(session("s-early"));
    await waitFor(() => expect(set).toHaveBeenCalledWith(session("s-early")));
  });

  it("묻는 사이 온 종료 이벤트가 낡은 답을 이긴다", async () => {
    const set = vi.fn();
    renderHook(() => useCurrentSession(1, true, set));
    // 물음은 구독이 붙은 **뒤에** 나간다.
    await waitFor(() => expect(query.resolve).not.toBeNull());
    expect(tauriBus.listenerCount("oculpmSessionEnded")).toBe(1);

    tauriBus.emit("oculpmSessionEnded", { project_id: 1, session_id: "s1" });
    query.resolve!(session("s1")); // 끝나기 전에 만든 답
    await new Promise((r) => setTimeout(r, 0));
    expect(set.mock.calls[set.mock.calls.length - 1]).toEqual([null]);
  });

  it("추적 전 프로젝트는 묻지 않는다 — 구독만 한다", async () => {
    const set = vi.fn();
    renderHook(() => useCurrentSession(1, false, set));
    await waitFor(() => expect(tauriBus.listenerCount("oculpmSessionStarted")).toBe(1));
    expect(query.calls).toEqual([]);
    tauriBus.emit("oculpmSessionStarted", { project_id: 1, session: session("s2") });
    expect(set).toHaveBeenCalledWith(session("s2"));
  });
});

describe("useSeededEvent — 키 단위로 낡은 답만 버린다 (탭 바쁜 점)", () => {
  it("묻는 사이 이벤트가 온 프로젝트만 건너뛴다", async () => {
    let answer: (v: Set<number>) => void = () => {};
    const busy = new Map<number, boolean>();
    renderHook(() =>
      useSeededEvent<Set<number>>(
        {
          seed: () => new Promise((r) => (answer = r)),
          subscribe: (touch) => [
            tauriBus.events.oculpmSessionEnded.listen(({ payload }) => {
              const p = payload as { project_id: number };
              touch(p.project_id);
              busy.set(p.project_id, false);
            }),
          ],
          onSeed: (seeded, touched) => {
            for (const id of [1, 2]) if (!touched(id)) busy.set(id, seeded.has(id));
          },
        },
        [],
      ),
    );
    await waitFor(() => expect(tauriBus.listenerCount("oculpmSessionEnded")).toBe(1));
    tauriBus.emit("oculpmSessionEnded", { project_id: 1 });
    answer(new Set([1, 2])); // 1 은 그 사이 끝났다 — 이 답에서 1 은 낡았다
    await new Promise((r) => setTimeout(r, 0));
    expect(busy.get(1)).toBe(false);
    expect(busy.get(2)).toBe(true);
  });
});

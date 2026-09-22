// `@tauri-apps/api/event` 셤의 웹뷰 경로 — 해제 순서 (2026-09-22, bug-hunt C1·C2).
//
// 가짜 `__TAURI_INTERNALS__` 로 Tauri 의 콜백 표(core.js)와 event 플러그인의
// IPC 를 흉내 낸다. 검증 대상은 두 가지다:
//
//  1. 해제 뒤 **뒤늦게 도착하는 eval** (`runCallback(handlerId, …)`) 이 경고를
//     내지도, 핸들러를 부르지도 않는다 — 로그의 `Couldn't find callback id`.
//  2. listen 응답 직후 해제해도 Rust `plugin:event|unlisten` 이 **항상** 나간다 —
//     원본은 `listeners[eventId].handlerId` 에서 던져 Rust 해제를 건너뛰었다.
//
// 마지막 describe 는 **원본** `@tauri-apps/api/event` 의 동작을 그대로 못 박는다.
// 이 셤이 우회하는 상류 결함이 고쳐지면 그 테스트가 먼저 붉어진다 — 그때 셤의
// 웹뷰 경로를 걷어내면 된다.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// setup.ts 의 전역 no-op 목을 이 파일에서만 걷는다 — 셤이 원본 위에 서는지가
// 검증 대상이고, 원본은 가짜 `__TAURI_INTERNALS__` 위에서 그대로 돈다.
vi.unmock("@tauri-apps/api/event");

type Callback = (data: unknown) => void;

/** core.js 의 콜백 표 + event 플러그인 커맨드를 흉내 낸 내부 객체. */
function fakeInternals() {
  const callbacks = new Map<number, Callback>();
  let nextCallbackId = 100;
  let nextEventId = 1;
  /** Rust 쪽 리스너 표 — `emit` 이 여기 있는 id 로만 eval 을 쏜다. */
  const rust = new Map<number, { event: string; handler: number }>();
  /** Rust `unlisten` 응답을 손으로 풀어 주기 위한 자리. */
  const pendingUnlisten: Array<() => void> = [];

  const internals = {
    transformCallback(cb: Callback, once = false) {
      const id = nextCallbackId++;
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        cb(data);
      });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    runCallback(id: number, data: unknown) {
      const cb = callbacks.get(id);
      if (cb) cb(data);
      else console.warn(`[TAURI] Couldn't find callback id ${id}.`);
    },
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "plugin:event|listen") {
        const id = nextEventId++;
        rust.set(id, { event: args.event as string, handler: args.handler as number });
        return id;
      }
      if (cmd === "plugin:event|unlisten") {
        rust.delete(args.eventId as number);
        await new Promise<void>((resolve) => pendingUnlisten.push(resolve));
        return null;
      }
      throw new Error(`unexpected command ${cmd}`);
    }),
  };

  return {
    internals,
    callbacks,
    rust,
    /** Rust 가 이 이벤트를 방출했다 — 리스너 표에 있는 id 마다 eval 한 번. */
    emit(event: string, payload: unknown) {
      for (const [eventId, l] of rust) {
        if (l.event !== event) continue;
        internals.runCallback(l.handler, { event, id: eventId, payload });
      }
    },
    /** 콜백 표에 남아 있는 id 로 곧장 eval — "해제 전에 큐에 실려 있던" 이벤트. */
    lateEval(handler: number, payload: unknown) {
      internals.runCallback(handler, { event: "late", id: 0, payload });
    },
    settleUnlisten() {
      for (const r of pendingUnlisten.splice(0)) r();
    },
  };
}

type Fake = ReturnType<typeof fakeInternals>;

async function loadShim(fake: Fake) {
  vi.resetModules();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: fake.internals,
  });
  return import("@/lib/transport/event");
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("transport/event — 웹뷰 listen/unlisten", () => {
  test("살아 있는 동안은 원본처럼 핸들러가 페이로드를 받는다", async () => {
    const fake = fakeInternals();
    const { listen } = await loadShim(fake);
    const seen: unknown[] = [];
    await listen("pty-data-1", (e) => seen.push(e.payload));

    fake.emit("pty-data-1", { seq: 1 });
    fake.emit("pty-data-1", { seq: 2 });

    expect(seen).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("해제 뒤 늦게 도착한 eval 은 경고도 핸들러 호출도 없이 버려진다 (C1)", async () => {
    const fake = fakeInternals();
    const { listen, UNREGISTER_GRACE_MS } = await loadShim(fake);
    const handler = vi.fn();
    const off = await listen("pty-data-1", handler);
    const [{ handler: handlerId }] = [...fake.rust.values()];

    // 페인 정리 — JS 콜백을 지우는 대신 죽은 표시만 남기고 Rust 에 해제를 보낸다.
    const done = (off as unknown as () => Promise<void>)();

    // Rust 가 해제를 처리하기 전 / 웹뷰 큐에 이미 실려 있던 청크 6개.
    for (let i = 0; i < 6; i++) fake.lateEval(handlerId, { seq: 10 + i });

    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    // 콜백은 아직 표에 있다 — 그래야 늦은 eval 이 경고 대신 가드를 만난다.
    expect(fake.callbacks.has(handlerId)).toBe(true);

    fake.settleUnlisten();
    await done;
    expect(fake.rust.size).toBe(0);
    expect(fake.callbacks.has(handlerId)).toBe(true);

    // 여유가 지나면 콜백도 지운다 — 표가 새지 않는다.
    await vi.advanceTimersByTimeAsync(UNREGISTER_GRACE_MS);
    expect(fake.callbacks.has(handlerId)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  test("listen 응답 직후 해제해도 Rust 해제가 나간다 — 던질 곳이 없다 (C2)", async () => {
    const fake = fakeInternals();
    const { listen } = await loadShim(fake);
    const off = await listen("themes-changed", () => {});

    // 원본은 여기서 `listeners[eventId].handlerId` (아직 정의 전) 로 TypeError.
    const done = (off as unknown as () => Promise<void>)();
    fake.settleUnlisten();
    await expect(done).resolves.toBeUndefined();

    const unlistens = fake.internals.invoke.mock.calls.filter(
      ([cmd]) => cmd === "plugin:event|unlisten",
    );
    expect(unlistens).toHaveLength(1);
    expect(unlistens[0][1]).toEqual({ event: "themes-changed", eventId: 1 });
    expect(fake.rust.size).toBe(0);
  });

  test("해제는 멱등이다 — 두 번 불러도 Rust 에는 한 번만 간다", async () => {
    const fake = fakeInternals();
    const { listen } = await loadShim(fake);
    const off = (await listen("x", () => {})) as unknown as () => Promise<void>;

    const a = off();
    const b = off();
    expect(b).toBe(a);
    fake.settleUnlisten();
    await a;

    expect(
      fake.internals.invoke.mock.calls.filter(([cmd]) => cmd === "plugin:event|unlisten"),
    ).toHaveLength(1);
  });

  test("Rust 해제가 실패해도 (웹뷰 종료 중) 해제 프라미스는 조용히 끝난다", async () => {
    const fake = fakeInternals();
    const { listen, UNREGISTER_GRACE_MS } = await loadShim(fake);
    const off = (await listen("x", () => {})) as unknown as () => Promise<void>;
    fake.internals.invoke.mockRejectedValueOnce(new Error("webview gone"));

    await expect(off()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(UNREGISTER_GRACE_MS);
    expect(fake.callbacks.size).toBe(0);
  });

  test("문자열 target 은 AnyLabel 로, 없으면 Any 로 넘긴다 (원본과 같다)", async () => {
    const fake = fakeInternals();
    const { listen } = await loadShim(fake);
    await listen("a", () => {});
    await listen("b", () => {}, { target: "main" });
    await listen("c", () => {}, { target: { kind: "Webview", label: "w" } });

    const listens = fake.internals.invoke.mock.calls
      .filter(([cmd]) => cmd === "plugin:event|listen")
      .map(([, args]) => (args as { target: unknown }).target);
    expect(listens).toEqual([
      { kind: "Any" },
      { kind: "AnyLabel", label: "main" },
      { kind: "Webview", label: "w" },
    ]);
  });

  test("once 는 첫 이벤트만 전하고 스스로 해제한다", async () => {
    const fake = fakeInternals();
    const { once } = await loadShim(fake);
    const handler = vi.fn();
    await once("boot", handler);

    fake.emit("boot", 1);
    fake.emit("boot", 2);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ payload: 1 });
    expect(warn).not.toHaveBeenCalled();
    fake.settleUnlisten();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.rust.size).toBe(0);
  });
});

// ─── 상류(@tauri-apps/api/event 원본)의 결함을 그대로 못 박는다 ──────────────
//
// 셤이 존재하는 이유다. Tauri 가 `_unlisten` 의 순서를 바꾸면 (Rust 먼저, 또는
// `listeners[eventId]` 가드) 여기가 붉어지고, 그때 셤의 웹뷰 경로를 걷어내면 된다.
describe("원본 @tauri-apps/api/event 의 해제 순서 (참조)", () => {
  /** event 플러그인 init 스크립트가 만드는 리스너 표 + `unregisterListener`. */
  function eventPluginInternals(internals: Fake["internals"]) {
    const listeners: Record<string, Record<number, { handlerId: number }>> = {};
    return {
      listeners,
      /** Rust `listen_js` 가 eval 로 심는 항목 — 응답보다 **늦게** 돌 수 있다. */
      define(event: string, eventId: number, handlerId: number) {
        (listeners[event] ??= {})[eventId] = { handlerId };
      },
      plugin: {
        // tauri-2.11.2/src/event/mod.rs `unlisten_js_script` 그대로.
        unregisterListener(event: string, eventId: number) {
          const table = listeners[event];
          if (table) internals.unregisterCallback(table[eventId].handlerId);
        },
      },
    };
  }

  test("JS 콜백을 먼저 지우므로 해제 직후 도착한 eval 이 경고를 낸다", async () => {
    const fake = fakeInternals();
    const plugin = eventPluginInternals(fake.internals);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: fake.internals,
    });
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      configurable: true,
      value: plugin.plugin,
    });
    const real = await vi.importActual<typeof import("@tauri-apps/api/event")>(
      "@tauri-apps/api/event",
    );

    const off = await real.listen("pty-data-1", () => {});
    const [[eventId, { handler: handlerId }]] = [...fake.rust.entries()];
    plugin.define("pty-data-1", eventId, handlerId);

    void off();
    fake.lateEval(handlerId, { seq: 1 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/Couldn't find callback id/);
    fake.settleUnlisten();
    delete (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
      .__TAURI_EVENT_PLUGIN_INTERNALS__;
  });

  test("listen 스크립트가 돌기 전에 해제하면 TypeError 로 Rust 해제를 건너뛴다", async () => {
    const fake = fakeInternals();
    const plugin = eventPluginInternals(fake.internals);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: fake.internals,
    });
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      configurable: true,
      value: plugin.plugin,
    });
    const real = await vi.importActual<typeof import("@tauri-apps/api/event")>(
      "@tauri-apps/api/event",
    );

    // 같은 이벤트의 **다른** 리스너가 표를 이미 만들어 둔 상태 (두 번째 창·
    // StrictMode 의 두 번째 mount) — 이때만 `listeners[event]` 가 truthy 다.
    plugin.define("themes-changed", 999, 1);
    const off = await real.listen("themes-changed", () => {});

    await expect((off as unknown as () => Promise<void>)()).rejects.toThrow(TypeError);
    expect(
      fake.internals.invoke.mock.calls.filter(([cmd]) => cmd === "plugin:event|unlisten"),
    ).toHaveLength(0);
    // Rust 리스너와 JS 콜백이 둘 다 남는다 — 죽은 컴포넌트의 핸들러가 계속 돈다.
    expect(fake.rust.size).toBe(1);
    expect(fake.callbacks.size).toBe(1);
    delete (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
      .__TAURI_EVENT_PLUGIN_INTERNALS__;
  });
});

// Tauri 이벤트 흉내 — 리스너를 실제로 등록하고 `emit` 으로 배달한다
// (review-2026-10-09 {#fake-tauri-events}).
//
// `setup.ts` 의 전역 목은 `listen` 을 아무것도 안 하는 함수로 바꾼다. 그 아래서는
// 3,294개 테스트가 초록이어도 이벤트 순서 버그가 원리적으로 안 보였다 — 3.10.0 의
// 「신뢰하고 켜기」 칩은 즉시 온 이벤트가 구독보다 먼저 지나가서 안 떴다.
//
// 이 버스는 실제 Tauri 처럼 `listen` 이 **비동기로** 붙는다. 붙기 전에 `emit` 한
// 이벤트는 **버려지고** `dropped` 에 남는다 — 「붙기 전에 지나간 이벤트」 를 재현한다.
//
// 쓰는 법 (테스트 파일):
//   vi.mock("@/lib/bindings", async () => ({
//     events: (await import("./helpers/fakeTauriEvents")).tauriBus.events,
//     commands: …,
//   }));
//   import { tauriBus } from "./helpers/fakeTauriEvents";
//   beforeEach(() => tauriBus.reset());
//   tauriBus.emit("oculpmSessionStarted", { … });

type Handler = (event: { payload: unknown }) => void;

function createBus() {
  const listeners = new Map<string, Set<Handler>>();
  const dropped: Array<{ name: string; payload: unknown }> = [];

  const channel = (name: string) => ({
    listen: (handler: Handler): Promise<() => void> =>
      // 한 틱 뒤에 붙는다 — `await listen(...)` 이 풀리기 전엔 이벤트를 못 받는다.
      Promise.resolve().then(() => {
        let set = listeners.get(name);
        if (!set) listeners.set(name, (set = new Set()));
        set.add(handler);
        return () => {
          set.delete(handler);
        };
      }),
  });

  const events = new Proxy({} as Record<string, ReturnType<typeof channel>>, {
    get: (_target, prop) => channel(String(prop)),
  });

  return {
    /** `@/lib/bindings` 의 `events` 자리에 넣는다. 이름은 바인딩의 키 그대로. */
    events,
    /** 지금 붙어 있는 리스너에게 배달한다. 아무도 없으면 버려진다. */
    emit(name: string, payload: unknown) {
      const set = listeners.get(name);
      if (!set || set.size === 0) {
        dropped.push({ name, payload });
        return;
      }
      for (const handler of [...set]) handler({ payload });
    },
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
    /** 붙기 전에 보내져 버려진 이벤트. */
    dropped,
    reset() {
      listeners.clear();
      dropped.length = 0;
    },
  };
}

export const tauriBus = createBus();

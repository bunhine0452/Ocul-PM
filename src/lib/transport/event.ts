// `@tauri-apps/api/event` 치환 셤 (#mb2-shim ↔ 백엔드 #mb2-sse).
//
// bindings.ts 의 makeEvent 가 쓰는 listen/once/emit 만 갈아끼운다.
// 브라우저에서 listen 은 SSE 구독이고, emit 은 폰→앱 방향이 없어 no-op 경고다.

import * as real from "@tauri-apps/api/event";

import { isTauri } from "./http";
import { sseListen } from "./sse";

export * from "@tauri-apps/api/event";

type ListenFn = typeof real.listen;
type OnceFn = typeof real.once;

const browserListen: ListenFn = (event, handler, _options?) => {
  const off = sseListen(event as string, (e) => {
    handler({ event: e.event, id: e.id, payload: e.payload as never });
  });
  return Promise.resolve(off);
};

const browserOnce: OnceFn = (event, handler, _options?) => {
  let done = false;
  const p = Promise.resolve(
    sseListen(event as string, (e) => {
      if (done) return;
      done = true;
      void p.then((off) => off());
      handler({ event: e.event, id: e.id, payload: e.payload as never });
    }),
  );
  return p;
};

export const listen: ListenFn = isTauri() ? real.listen : browserListen;
export const once: OnceFn = isTauri() ? real.once : browserOnce;

export const emit: typeof real.emit = isTauri()
  ? real.emit
  : async () => {
      console.warn("[transport] emit is a no-op in the browser");
    };

export const emitTo: typeof real.emitTo = isTauri()
  ? real.emitTo
  : async () => {
      console.warn("[transport] emitTo is a no-op in the browser");
    };

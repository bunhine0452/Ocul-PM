// `@tauri-apps/api/event` 치환 셤 (#mb2-shim ↔ 백엔드 #mb2-sse).
//
// bindings.ts 의 makeEvent 가 쓰는 listen/once/emit 만 갈아끼운다.
// 브라우저에서 listen 은 SSE 구독이고, emit 은 폰→앱 방향이 없어 no-op 경고다.
//
// 웹뷰에서도 원본을 그대로 쓰지 않는다 (2026-09-22, `bug-hunt` C1·C2). 원본
// `_unlisten` 은 이렇게 생겼다:
//
//     window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId)  // ① JS 콜백을 지금 지운다
//     await invoke('plugin:event|unlisten', { event, eventId })                    // ② Rust 는 나중에 안다
//
// 두 결함이 이 순서에서 나온다.
//
//  - **`[TAURI] Couldn't find callback id N` (같은 id 가 1~6번, 1ms 간격).**
//    Rust 는 `emit` 을 `webview.eval("runCallback(handlerId, …)")` 로 나른다.
//    ①과 ② 사이, 그리고 ① 이전에 이미 웹뷰 큐에 실려 있던 eval 은 전부 콜백이
//    없는 id 를 두드린다 — 한 번의 해제마다 그 순간 밀려 있던 이벤트 수만큼
//    경고가 난다. 터미널 페인을 닫는 순간이 대표적이다: 페인 정리(xterm·WebGL
//    dispose)가 JS 스레드를 쥔 동안 Claude Code 의 TUI 가 뿜은 `pty-data-*`
//    청크가 몇 개씩 쌓이고, 정리가 콜백을 지운 뒤에야 실행된다. 그래서 로그에서
//    이 경고는 언제나 `claude hook event … SessionEnd` 직전(0.7~2s)에 찍혔다.
//  - **`undefined is not an object (evaluating 'listeners[eventId].handlerId')`.**
//    Rust 의 `listen_js` 는 `listeners[event][eventId] = {handlerId}` 를 만드는
//    스크립트를 **eval 로 큐에 넣고** 응답을 돌려준다. 응답을 받은 직후 해제하면
//    (StrictMode 의 mount→cleanup, 빠른 언마운트) 그 스크립트가 아직 안 돌아
//    ①이 TypeError 로 던지고 — `_unlisten` 이 async 라 rejected promise 가 된다.
//    더 나쁜 것은 ②가 **영영 실행되지 않아** Rust 리스너와 JS 콜백이 둘 다 남는
//    것이다 (죽은 컴포넌트의 핸들러가 계속 돈다).
//
// 그래서 웹뷰 경로는 여기서 다시 짠다: 핸들러 앞에 `dead` 가드를 두고, 해제는
// **Rust 부터** 끊은 뒤 콜백을 한참 뒤에 지운다. 큐에 남아 있던 eval 은 살아
// 있는 콜백을 만나 가드에서 조용히 버려지고, `listeners[eventId]` 는 만지지
// 않으니 던질 것도 없다. 해제는 멱등이다 (두 번 불러도 한 번 끊는다).
//
// vite alias 가 앱의 모든 `@tauri-apps/api/event` 임포트를 이 파일로 돌리므로
// (bindings.ts · TerminalInstanceImpl · api/* 전부) 호출부는 그대로다. 단
// `@tauri-apps/api/webview` 가 내부적으로 쓰는 `./event.js` 는 alias 밖이라
// `onDragDropEvent` 의 해제는 여전히 원본이다.

import * as real from "@tauri-apps/api/event";
import { invoke, transformCallback } from "@tauri-apps/api/core";

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

// ─── 웹뷰 경로 ────────────────────────────────────────────────────────────────

/**
 * Rust 가 해제를 확인한 뒤 JS 콜백을 지우기까지의 여유. 그 사이에 도착하는
 * 것은 해제 **전에** 이미 eval 큐에 실려 있던 이벤트뿐이고 (Rust 는 확인 뒤로는
 * 이 id 로 보내지 않는다), 가드가 버린다. 넉넉한 이유는 비용이 없기 때문이다 —
 * 클로저 하나가 몇 초 더 산다.
 */
export const UNREGISTER_GRACE_MS = 2_000;

interface TauriInternals {
  unregisterCallback(id: number): void;
}

const internals = (): TauriInternals | undefined =>
  (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;

/** 원본 `listen` 과 같은 target 정규화 (문자열 = AnyLabel). */
const targetOf = (options?: real.Options) =>
  typeof options?.target === "string"
    ? { kind: "AnyLabel", label: options.target }
    : (options?.target ?? { kind: "Any" });

const tauriListen: ListenFn = async (event, handler, options) => {
  let dead = false;
  const handlerId = transformCallback<real.Event<never>>((e) => {
    if (!dead) handler(e);
  });
  const eventId = await invoke<number>("plugin:event|listen", {
    event,
    target: targetOf(options),
    handler: handlerId,
  });

  let unlistening: Promise<void> | null = null;
  const unlisten = () => {
    if (unlistening) return unlistening;
    dead = true;
    unlistening = (async () => {
      try {
        await invoke("plugin:event|unlisten", { event, eventId });
      } catch {
        // 웹뷰가 내려가는 중이거나 이미 없는 리스너 — 뗄 것이 없다.
      }
      setTimeout(() => {
        try {
          internals()?.unregisterCallback(handlerId);
        } catch {
          // 페이지가 리로드돼 internals 가 바뀌었다 — 옛 콜백 표도 함께 사라졌다.
        }
      }, UNREGISTER_GRACE_MS);
    })();
    return unlistening;
  };
  // 원본과 같은 시그니처(`UnlistenFn = () => void`)를 지킨다. 프라미스를 돌려주는
  // 것은 원본도 같고 (`safeUnlisten` 이 그걸 전제로 한다), 여기서는 삼켜 둔다.
  return unlisten as unknown as real.UnlistenFn;
};

const tauriOnce: OnceFn = (event, handler, options) => {
  let fired = false;
  const pending: Promise<real.UnlistenFn> = tauriListen(
    event,
    (e) => {
      if (fired) return;
      fired = true;
      void pending.then((off) => off());
      handler(e as never);
    },
    options,
  );
  return pending;
};

export const listen: ListenFn = isTauri() ? tauriListen : browserListen;
export const once: OnceFn = isTauri() ? tauriOnce : browserOnce;

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

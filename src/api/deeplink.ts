/**
 * `oculpm://` 딥링크 구독 래퍼 (Osaurus 라운드 Phase 6).
 *
 * `bindings` 값을 직접 쓰는 자리는 `api/*` 한 곳뿐이다 (`lint:bindings`).
 * 이벤트도 예외가 아니다 — 구독 해제까지 여기서 한 모양으로 접는다.
 */

import { events, type DeepLink } from "@/lib/bindings";

export type { DeepLink };

/** 딥링크가 오면 부른다. 반환값을 부르면 구독을 끊는다. */
export function onDeepLink(cb: (link: DeepLink) => void): () => void {
  const pending = events.deepLinkReceived.listen((e) => cb(e.payload));
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

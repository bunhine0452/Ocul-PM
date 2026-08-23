import { useEffect, useRef } from "react";

/**
 * 창으로 돌아왔을 때 한 번 다시 읽는다 — 워처 이벤트를 놓쳤을 때의 그물.
 *
 * 워처가 살아 있어도 신선도가 100% 보장되지는 않는다: 앱이 꺼져 있던 동안의
 * 변경, fs 이벤트를 흘리는 네트워크/동기화 볼륨, 워처가 멈춘 상태 등에서는
 * 이벤트가 아예 오지 않는다. 사용자는 보통 다른 앱(터미널·에디터)에서
 * 에이전트를 돌리다 창으로 돌아오므로, 그 복귀 순간이 가장 값싼 재확인
 * 지점이다.
 *
 * 스로틀을 두는 이유 — macOS 는 창 사이를 오갈 때 focus 를 연달아 쏘고,
 * `visibilitychange` 까지 겹치면 한 번의 복귀가 두세 번의 재조회가 된다.
 */
const WAKE_THROTTLE_MS = 10_000;

export function useRefetchOnWake(onWake: () => void, enabled = true): void {
  const lastWakeAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    function maybeRefetch() {
      // visibilitychange 는 숨겨질 때도 발화한다 — 돌아온 경우만 센다.
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastWakeAt.current < WAKE_THROTTLE_MS) return;
      lastWakeAt.current = now;
      onWake();
    }
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
    };
  }, [onWake, enabled]);
}

import { useEffect, useSyncExternalStore } from "react";

// 공유 시계 (완성도 라운드 Phase 3, 2026-08-30).
//
// 1초마다 다시 그려야 하는 자리 — 터미널 레일·세션 배지·상태바, Today 활동
// 시간, Claude Code 의 "생각 중" 과 단계 경과, 회고 생성 경과 — 가 각자
// `setInterval(…, 1000)` 을 들고 있었다. 트레이스 행은 도는 단계마다 하나라
// 긴 대화 하나가 타이머 수십 개였고, 서로 어긋난 위상 때문에 초당 여러 번
// 깨어났다. 여기 하나의 인터벌이 **구독자가 하나라도 켜져 있을 때만** 돈다.
//
// 스냅샷은 숫자(`Date.now()`)라 `useSyncExternalStore` 의 동일성 요건을 그냥
// 만족한다. 꺼진(`enabled=false`) 구독자는 구독하지 않아 틱마다 다시 그리지
// 않는다 — 값은 마지막 틱이지만 어차피 읽지 않는다.

type Listener = () => void;

function makeClock(intervalMs: number) {
  const listeners = new Set<Listener>();
  let now = Date.now();
  let timer: number | null = null;
  let active = 0;

  const tick = () => {
    now = Date.now();
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const noop = () => () => {};
  const snapshot = () => now;

  return function useTick(enabled: boolean): number {
    useEffect(() => {
      if (!enabled) return;
      active += 1;
      if (active === 1) {
        now = Date.now();
        timer = window.setInterval(tick, intervalMs);
      } else {
        // 새로 켜진 구독자가 낡은 스냅샷을 한 틱 동안 보지 않게.
        tick();
      }
      return () => {
        active -= 1;
        if (active === 0 && timer != null) {
          window.clearInterval(timer);
          timer = null;
        }
      };
    }, [enabled]);
    return useSyncExternalStore(enabled ? subscribe : noop, snapshot, snapshot);
  };
}

/** 1초 시계 — `enabled` 인 동안만 틱을 받는다. 반환값은 `Date.now()`. */
export const useSecondTick = makeClock(1000);

/** 1분 시계 — "N분 전" 같은 상대 시각이 세션 내내 얼어붙지 않게. */
export const useMinuteTick = makeClock(60_000);

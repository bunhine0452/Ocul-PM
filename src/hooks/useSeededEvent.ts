// 「이벤트로만 세우는 상태」 를 구조로 막는 훅 (review-2026-10-09 {#seeded-event}).
//
// 3.10.0 의 「신뢰하고 켜기」 칩 회귀는 우연이 아니라 유형이었다: 백엔드가 즉시 보낸
// 이벤트가 화면의 구독(`listen` 은 비동기)보다 먼저 지나갔다. 반대 모양도 같은 유형이다 —
// 먼저 묻고 나중에 구독하면, 답이 돌아오기 전에 지나간 이벤트를 잃거나 낡은 답이 새
// 이벤트를 덮는다.
//
// 이 훅의 순서는 하나다:
//   1. 구독을 붙인다.
//   2. **붙은 뒤에** 지금 값을 묻는다 — 붙기 전에 지나간 이벤트는 이 답이 덮는다.
//   3. 묻는 사이 이벤트가 이미 새 값을 세운 자리는 답을 버린다 (`touched`).
// 이벤트는 변화분, 물음은 시작 값이다. 터미널 화면의 「구독 → 스냅샷 + 순번」 과 같은 모양.

import { useEffect, type DependencyList } from "react";

import { createUnlistenBag, type MaybeAsyncUnlisten } from "@/lib/unlisten";

/** 이벤트를 반영했다고 알린다. 키가 없으면 「전부」 — 그 뒤 도착한 답은 통째로 낡았다. */
export type Touch = (key?: string | number) => void;

export interface SeededEvent<S> {
  /** 지금 값을 묻는다. `null` 이면 묻지 않고 구독만 한다 (물을 대상이 아직 없다). */
  seed: (() => Promise<S>) | null;
  /** 구독을 붙인다. 이벤트를 상태에 반영할 때마다 `touch(key?)` 를 부를 것. */
  subscribe: (touch: Touch) => Array<Promise<MaybeAsyncUnlisten>>;
  /** 물음의 답. `touched(key)` 가 참인 자리는 묻는 사이 이벤트가 새 값을 세웠다 — 건너뛸 것. */
  onSeed: (value: S, touched: (key?: string | number) => boolean) => void;
}

export function useSeededEvent<S>(spec: SeededEvent<S>, deps: DependencyList): void {
  useEffect(() => {
    const { seed, subscribe, onSeed } = spec;
    let alive = true;
    let touchedAll = false;
    const touchedKeys = new Set<string | number>();
    const touch: Touch = (key) => {
      if (key === undefined) touchedAll = true;
      else touchedKeys.add(key);
    };
    const pending = subscribe(touch);
    const bag = createUnlistenBag();
    pending.forEach((p) => bag.add(p));
    void Promise.allSettled(pending)
      .then(() => {
        if (!alive || !seed) return;
        // 여기까지 반영된 이벤트는 지금 묻는 답보다 오래됐다 — 표식을 비우고 묻는다.
        touchedAll = false;
        touchedKeys.clear();
        return seed().then((value) => {
          if (!alive) return;
          onSeed(value, (key) => touchedAll || (key !== undefined && touchedKeys.has(key)));
        });
      })
      .catch(() => {
        /* 물음 실패 — 이벤트가 오면 그것으로 선다 (예전 동작과 같다) */
      });
    return () => {
      alive = false;
      bag.dispose();
    };
    // 호출부가 넘긴 deps 가 이 이펙트의 deps 다 — `spec` 은 매 렌더 새로 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

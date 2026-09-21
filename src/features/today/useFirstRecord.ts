import { useCallback, useEffect, useState } from "react";

import { hooksApi } from "@/api/claudeSurface";
import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";
import type { FirstRecordLedger } from "@/lib/bindings";
import { safeUnlisten, type MaybeAsyncUnlisten } from "@/lib/unlisten";

/**
 * 첫 기록 원장의 자료 한 벌 (플랜 `first-record-loop` {#p1-card}).
 *
 * 원장이 바뀌는 신호는 셋이다 — 일지가 생기거나 바뀜(워처 이벤트), 작업
 * 세션이 열리거나 닫힘(훅 인박스 소비의 산물), A2A 원장 변경(agent_register).
 * 그런데 **마커 파일**(`.session-live-*`)은 훅이 직접 찍고 워처는 그 폴더에
 * 이벤트를 내지 않는다 — 「실행 중」이 되는 순간을 이벤트만으로는 못 본다.
 * 그래서 카드가 살아 있는 동안 분 단위 틱 하나를 둔다. IPC 한 번/분이고,
 * 카드는 첫 기록을 확인할 때까지만 산다.
 */
const TICK_MS = 60_000;
/** 원장 창 — 카드는 첫 기록을 확인할 때까지 살아 있으므로 넉넉히. */
const WINDOW_DAYS = 30;

export interface FirstRecordState {
  ledger: FirstRecordLedger | null;
  /** 한 번이라도 읽었는가 — 읽기 전에 「준비」를 그리면 그건 추측이다. */
  loaded: boolean;
  error: string | null;
  refresh: () => void;
}

export function useFirstRecord(projectId: number, enabled: boolean): FirstRecordState {
  const [ledger, setLedger] = useState<FirstRecordLedger | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLedger(null);
      setLoaded(false);
      setError(null);
      return;
    }
    let alive = true;
    // `Promise.resolve().then(...)` — 래퍼가 동기적으로 던져도(바인딩이 없는
    // 테스트 환경) 이펙트가 아니라 거부로 접힌다. 카드 하나가 Today 를 무너뜨리면 안 된다.
    void Promise.resolve()
      .then(() => hooksApi.firstRecordLedger(projectId, WINDOW_DAYS))
      .then((next) => {
        if (!alive) return;
        setLedger(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 못 읽은 것은 모름이다 — 빈 원장(준비 상태)으로 접지 않는다.
        setLedger(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId, enabled, tick]);

  useJournalEvents(projectId, enabled, refresh);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const offs: MaybeAsyncUnlisten[] = [];
    const keep = (p: Promise<() => void>) => {
      void p
        .then((off) => {
          if (alive) offs.push(off);
          else safeUnlisten(off);
        })
        .catch(() => {});
    };
    const onProject = (payload: { project_id: number }) => {
      if (payload.project_id === projectId) refresh();
    };
    try {
      keep(oculpmApi.onSessionStarted(onProject));
      keep(oculpmApi.onSessionEnded(onProject));
      keep(oculpmApi.onA2aChanged(onProject));
    } catch {
      /* event channel unavailable (tests) — 분 단위 틱이 그 자리를 메운다 */
    }
    const timer = window.setInterval(refresh, TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
      offs.forEach(safeUnlisten);
    };
  }, [projectId, enabled, refresh]);

  return { ledger, loaded, error, refresh };
}

import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "./useOculpmLive";

/**
 * 오늘 일지 건수 — 사이드바 「일지」 행의 조용한 수 (시안 A). 워처 이벤트로 따라간다.
 * 못 읽으면 `null` = 배지 없음 (0 과 다르다).
 */
export function useTodayCount(projectId: number | null, workday: string | null, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useJournalEvents(projectId, enabled, () => setTick((n) => n + 1));
  useEffect(() => {
    if (projectId == null || !workday || !enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => oculpmApi.listJournalEntries(projectId, workday))
      .then((list) => {
        if (!cancelled) setCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workday, enabled, tick]);
  return count;
}

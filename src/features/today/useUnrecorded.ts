import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";

/**
 * 오늘 「에이전트가 고치고 적지 않은 파일」의 고유 수 — 오늘 화면 머리글의 숫자 셋 중 하나.
 * 판정은 `compare_workday` 그대로(HonestyAudit 와 같은 함수). 못 읽으면 `null` = 모름.
 */
export function useUnrecordedCount(projectId: number, workday: string | null, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useJournalEvents(projectId, enabled, () => setTick((n) => n + 1));
  useEffect(() => {
    if (!enabled || !workday) {
      setCount(null);
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => oculpmApi.compareWorkday(projectId, workday))
      .then((cmp) => {
        if (cancelled) return;
        setCount(new Set(cmp.sessions.flatMap((s) => s.unrecorded)).size);
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

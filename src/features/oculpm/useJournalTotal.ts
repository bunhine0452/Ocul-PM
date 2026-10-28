import { useCallback, useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "./useOculpmLive";

/**
 * 프로젝트 일지 **전체 건수** — 툴바 「N건 · 전체 M건 중」 의 M.
 *
 * 목록이 14일 창이든 필터·검색 결과든 이 수는 변하지 않는다 (좁힌 결과가 전체의 얼마인지를
 * 말하려면 분모가 고정이어야 한다). 한 건만 달라고 하고 `total` 만 읽는다. 못 읽으면 `null`.
 */
export function useJournalTotal(projectId: number | null, enabled: boolean): number | null {
  const [total, setTotal] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useJournalEvents(projectId, enabled, refresh);

  useEffect(() => {
    if (projectId == null || !enabled) {
      setTotal(null);
      return;
    }
    let cancelled = false;
    void oculpmApi
      .listJournalEntriesPage(projectId, undefined, undefined, 1)
      .then((page) => {
        if (!cancelled) setTotal(page.total);
      })
      .catch(() => {
        if (!cancelled) setTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, tick]);

  return total;
}

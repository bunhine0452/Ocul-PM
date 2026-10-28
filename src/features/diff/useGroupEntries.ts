import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import type { ChangeGroup, JournalEntrySummary } from "@/lib/bindings";
import { normalizeJournalRef } from "@/features/oculpm/useJournalPlanLinks";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";

/**
 * 변경 묶음의 일지들을 **요약 행**으로 푼다 — 묶음(`ChangeGroup`)에는 증거 등급이 없고 요약에는 있다.
 * 날짜별로 한 번에 묻는다 (`workdayEntries`, 최대 62일) — 일지가 몇이든 호출은 하나다.
 * 못 읽으면 빈 지도: 증거 표시가 빠질 뿐 목록은 그대로 선다.
 */
export function useGroupEntries(
  projectId: number,
  groups: readonly ChangeGroup[] | null,
): ReadonlyMap<string, JournalEntrySummary> {
  const [entries, setEntries] = useState<ReadonlyMap<string, JournalEntrySummary>>(() => new Map());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  // 에이전트가 일지를 고치면(검증 칸 보강) 증거 등급이 바뀐다.
  useJournalEvents(projectId, groups != null, refresh);

  const workdaysKey = useMemo(() => {
    const days = new Set<string>();
    for (const g of groups ?? []) {
      if (g.entry_path == null) continue;
      const day = normalizeJournalRef(g.entry_path).split("/")[0];
      if (/^\d{8}$/.test(day)) days.add(day);
    }
    return [...days].sort().reverse().join(",");
  }, [groups]);

  useEffect(() => {
    if (!workdaysKey) {
      setEntries(new Map());
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => oculpmApi.workdayEntries(projectId, workdaysKey.split(",")))
      .then((rows) => {
        if (!cancelled) setEntries(new Map(rows.map((e) => [e.relative_path, e])));
      })
      .catch(() => {
        if (!cancelled) setEntries(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workdaysKey, tick]);

  return entries;
}

import { useCallback, useEffect, useState } from "react";

import { planApi } from "@/api/plan";
import type { JournalPlanLink } from "@/lib/bindings";
import { useOculpmDataEvents } from "./useOculpmLive";

/** plan-log 의 `journal_ref` 는 표기가 섞여 있다 (`.oculpm/journal/…` · `journal/…` · 맨 상대경로). */
export function normalizeJournalRef(raw: string): string {
  let s = raw.trim().replace(/\\/g, "/");
  for (const prefix of ["./", ".oculpm/", "journal/"]) {
    if (s.startsWith(prefix)) s = s.slice(prefix.length);
  }
  return s;
}

/**
 * 일지 → 계획 항목 연결 — 일지 상세의 「연결된 계획」. `relative_path`(저널 기준) → 링크들.
 * 계획은 읽을 때마다 파일에서 다시 투영되므로 플래너 변경 이벤트에 맞춰 다시 읽는다.
 * 못 읽으면 빈 지도 — 연결 표시는 곁다리라 일지 열람을 막지 않는다.
 */
export function useJournalPlanLinks(
  projectId: number | null,
  enabled: boolean,
): ReadonlyMap<string, JournalPlanLink[]> {
  const [links, setLinks] = useState<ReadonlyMap<string, JournalPlanLink[]>>(() => new Map());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useOculpmDataEvents("planner", projectId, enabled, refresh);

  useEffect(() => {
    if (projectId == null || !enabled) {
      setLinks(new Map());
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => planApi.journalLinks(projectId))
      .then((rows) => {
        if (cancelled) return;
        const byPath = new Map<string, JournalPlanLink[]>();
        for (const r of rows) {
          const key = normalizeJournalRef(r.journal_ref);
          const arr = byPath.get(key);
          if (arr) arr.push(r);
          else byPath.set(key, [r]);
        }
        setLinks(byPath);
      })
      .catch(() => {
        if (!cancelled) setLinks(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, tick]);

  return links;
}

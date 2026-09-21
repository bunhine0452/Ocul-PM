import { useCallback, useEffect, useState } from "react";

import { hooksApi } from "@/api/claudeSurface";
import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents, useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import type { ResumeDigest } from "@/lib/bindings";
import { safeUnlisten, type MaybeAsyncUnlisten } from "@/lib/unlisten";

/**
 * 이어하기 자료 한 벌 (플랜 `first-record-loop` Phase 2).
 *
 * 바뀌는 신호는 셋 — 일지가 생기거나 바뀜, 계획 파일이 바뀜, 작업 세션이
 * 열림(훅이 전달 원장을 적는 순간과 같은 SessionStart 의 산물). 전달 원장
 * 파일 자체는 워처 이벤트가 없어 세션 이벤트가 그 대리다.
 */
export interface ResumeState {
  digest: ResumeDigest | null;
  loaded: boolean;
  error: string | null;
  refresh: () => void;
}

export function useResumeDigest(projectId: number, enabled: boolean): ResumeState {
  const [digest, setDigest] = useState<ResumeDigest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setDigest(null);
      setLoaded(false);
      setError(null);
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => hooksApi.resumeDigest(projectId))
      .then((next) => {
        if (!alive) return;
        setDigest(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setDigest(null);
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
  useOculpmDataEvents("planner", projectId, enabled, refresh);

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
    } catch {
      /* event channel unavailable (tests) */
    }
    return () => {
      alive = false;
      offs.forEach(safeUnlisten);
    };
  }, [projectId, enabled, refresh]);

  return { digest, loaded, error, refresh };
}

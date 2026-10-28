import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { JournalEntrySummary } from "@/lib/bindings";
import { groupByWorkday, type JournalDay } from "./useJournalDays";
import { useJournalEvents } from "./useOculpmLive";

/** 검색 한 번에 받는 히트 상한 — 백엔드 `MAX_SEARCH_LIMIT` 과 같다. */
export const SEARCH_LIMIT = 200;
/** 한 번에 요약으로 풀 수 있는 날짜 수 — `oculpm_workday_brief` 의 상한(62). */
const MAX_DAYS = 62;

interface JournalSearchState {
  days: JournalDay[] | null;
  loading: boolean;
  error: string | null;
  /** 상한을 걸기 전 매치 건수. */
  total: number | null;
  /** 지금 목록에 실린 건수. */
  loaded: number | null;
  refresh: () => void;
}

/**
 * 일지 검색 — 제목·파일 경로·태그·슬러그·본문 (`oculpm_search_journal`, MCP `journal_search` 와
 * 같은 캐시 조회·랭킹이다). 히트는 경로와 발췌뿐이라 **요약 행으로 한 번 더 푼다**: 증거 등급·
 * 에이전트·시각은 요약에만 있다. 목록은 관련도순이 아니라 날짜 묶음(최신 먼저)으로 그린다.
 *
 * `query` 가 비면 아무것도 묻지 않는다 (`days: null`) — 그때는 호출자가 평소 목록을 쓴다.
 * `types` 는 모듈 상수가 아니어도 되지만 내용이 같으면 같은 질의로 본다.
 */
export function useJournalSearch(
  projectId: number | null,
  todayKey: string | null,
  enabled: boolean,
  query: string,
  types: readonly string[],
): JournalSearchState {
  const [days, setDays] = useState<JournalDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; loaded: number } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const q = query.trim();
  const active = enabled && projectId != null && !!todayKey && q !== "";
  useJournalEvents(projectId, active, refresh);

  const typesKey = useMemo(() => types.join(","), [types]);

  useEffect(() => {
    if (!active || projectId == null || !todayKey) {
      setDays(null);
      setCounts(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const page = await oculpmApi.searchJournal(
          projectId,
          q,
          typesKey ? { types: typesKey.split(",") } : undefined,
          SEARCH_LIMIT,
        );
        // 날짜는 히트 순서(관련도) 그대로 모아 62일까지 — 넘치는 날짜의 히트는 못 푼다.
        const workdays = [...new Set(page.hits.map((h) => h.workday))].slice(0, MAX_DAYS);
        const summaries = workdays.length ? await oculpmApi.workdayEntries(projectId, workdays) : [];
        if (cancelled) return;
        const byPath = new Map<string, JournalEntrySummary>(summaries.map((e) => [e.relative_path, e]));
        const entries = page.hits.flatMap((h) => {
          const e = byPath.get(h.relative_path);
          return e ? [e] : [];
        });
        setDays(groupByWorkday(entries, todayKey));
        setCounts({ total: page.total, loaded: entries.length });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof OculpmApiError ? e.message : String(e));
        setDays(null);
        setCounts(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, projectId, todayKey, q, typesKey, tick]);

  return {
    days,
    loading,
    error,
    total: counts?.total ?? null,
    loaded: counts?.loaded ?? null,
    refresh,
  };
}

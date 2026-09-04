import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { commands, type EntryFilters, type JournalEntrySummary } from "@/lib/bindings";
import { useJournalEvents } from "./useOculpmLive";
import { t } from "@/i18n";
import { shiftWorkday } from "@/lib/workday";
import { tError } from "@/i18n/errors";

// Final UI Update (ui_v2) — fetch journal entries and group them by day for the
// timeline. F3 (2026-06-22): two modes. The default windowed load (last N
// workdays, fast) for an empty toolbar, and an **all-period** backend query
// (`list_journal_entries(workday=null, filters)`) when any filter/search is
// active or the user asks for older entries — removing the 14-day ceiling so
// search + filters reach the full history. The backend `EntryFilters` path was
// already complete; this finally drives it.

export interface JournalDay {
  /** YYYYMMDD */
  workday: string;
  /** "오늘 · 2026-05-31" style label. */
  label: string;
  entries: JournalEntrySummary[];
}

const DEFAULT_DAYS = 14;

/**
 * 전체 기간 조회 한 쪽의 크기 (`{#journal-timeline-limit}`).
 *
 * 예전엔 상한이 아예 없었다. 검색창 한 글자 또는 범위 칩 한 번이면 14일 창이
 * 사라지고 전 이력(이 저장소 기준 537건)이 통째로 넘어와, 가상화 라이브러리가
 * 없는 타임라인이 그만큼의 카드를 마운트했다.
 */
export const JOURNAL_PAGE_SIZE = 200;


/** Human label: 오늘 / 어제 / N일 전 prefix + ISO date. */
function dayLabel(workday: string, todayKey: string): string {
  const iso = `${workday.slice(0, 4)}-${workday.slice(4, 6)}-${workday.slice(6, 8)}`;
  if (workday === todayKey) return `${t("journal.day.today")} · ${iso}`;
  if (workday === shiftWorkday(todayKey, -1)) return `${t("journal.day.yesterday")} · ${iso}`;
  return iso;
}

/** Group a flat entry list (all-period query result) by workday, newest day
 *  first, newest entry first within a day. */
function groupByWorkday(list: JournalEntrySummary[], todayKey: string): JournalDay[] {
  const byDay = new Map<string, JournalEntrySummary[]>();
  for (const e of list) {
    const arr = byDay.get(e.workday);
    if (arr) arr.push(e);
    else byDay.set(e.workday, [e]);
  }
  return [...byDay.entries()]
    .map(([wd, entries]) => ({
      workday: wd,
      label: dayLabel(wd, todayKey),
      entries: entries.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
    .sort((a, b) => b.workday.localeCompare(a.workday));
}

export interface UseJournalDaysOptions {
  /** Server-side filters (only used in all-period mode). */
  filters?: EntryFilters | null;
  /** Run a single all-period query (filters applied server-side) instead of
   *  the windowed last-N-days load. Removes the 14-day ceiling (F3). */
  allPeriod?: boolean;
  dayCount?: number;
  /** 전체 기간 조회 한 쪽의 크기. 「더 보기」 한 번에 이만큼 늘어난다. */
  pageSize?: number;
}

interface UseJournalDaysResult {
  days: JournalDay[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** 조건에 맞는 **전체** 건수. 윈도우 모드(상한 없음)에서는 `null`. */
  total: number | null;
  /** 지금 화면에 실린 건수 (전체 기간 모드에서만). */
  loaded: number | null;
  /**
   * 아직 못 받은 것이 남아 있고, 한 쪽 더 달라고 하면 실제로 더 온다.
   *
   * `loaded >= limit` 을 함께 보는 이유: 백엔드가 상한을 자체적으로 조인다.
   * 그 지점을 넘으면 버튼을 눌러도 목록이 안 자라므로, 죽은 버튼을 그리는
   * 대신 숨기고 「N건 중 M건」만 남긴다.
   */
  canLoadMore: boolean;
  /** 한 쪽 더. */
  loadMore: () => void;
}

/**
 * Load + group journal entries for the timeline. Windowed (last `dayCount`
 * workdays, newest first) by default; switches to a single all-period query
 * when `allPeriod` is set. Returns null until the first fetch resolves.
 */
export function useJournalDays(
  projectId: number | null,
  todayKey: string | null,
  enabled: boolean,
  options: UseJournalDaysOptions = {},
): UseJournalDaysResult {
  const {
    filters = null,
    allPeriod = false,
    dayCount = DEFAULT_DAYS,
    pageSize = JOURNAL_PAGE_SIZE,
  } = options;
  const [days, setDays] = useState<JournalDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<{ entries: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Live refresh when the watcher indexes a journal change for this project.
  useJournalEvents(projectId, enabled, refresh);

  const keys = useMemo(() => {
    if (!todayKey) return [];
    return Array.from({ length: dayCount }, (_, i) => shiftWorkday(todayKey, -i));
  }, [todayKey, dayCount]);

  // Stable dependency for the filters object (recreated each render upstream).
  const filtersKey = allPeriod && filters ? JSON.stringify(filters) : "";

  // 조건이 바뀌면 상한은 **처음으로 돌아간다.** 렌더 중에 유도하는 이유는
  // effect 로 되돌리면 한 프레임 동안 지난 검색에서 늘려 둔 상한이 그대로
  // 실려, 새 검색이 곧장 전 이력을 끌어오기 때문이다.
  const queryKey = `${projectId}|${todayKey}|${allPeriod}|${filtersKey}`;
  const [raised, setRaised] = useState<{ key: string; limit: number } | null>(null);
  const limit = raised?.key === queryKey ? raised.limit : pageSize;
  const loadMore = useCallback(
    () => setRaised({ key: queryKey, limit: limit + pageSize }),
    [queryKey, limit, pageSize],
  );

  useEffect(() => {
    if (!enabled || projectId == null || !todayKey) {
      setDays(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        let grouped: JournalDay[];
        if (allPeriod) {
          // 전체 기간 질의 — 백엔드가 `filters` 를 적용하고 **상한도 건다**.
          const result = await oculpmApi.listJournalEntriesPage(
            projectId,
            undefined,
            filters ?? undefined,
            limit,
          );
          if (cancelled) return;
          grouped = groupByWorkday(result.entries, todayKey);
          setPage({ entries: result.entries.length, total: result.total });
        } else {
          // v2 U12 — 워크데이당 1콜(×14) 대신 단일 workday brief 로.
          const res = await commands.oculpmWorkdayBrief(projectId, keys, null);
          if (cancelled) return;
          if (res.status !== "ok") throw new Error(tError(res.error));
          const byKey = new Map<string, JournalEntrySummary[]>(
            res.data.days.map((b) => [b.workday, b.entries]),
          );
          grouped = keys
            .map((wd) => ({
              workday: wd,
              label: dayLabel(wd, todayKey),
              entries: (byKey.get(wd) ?? [])
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at)),
            }))
            .filter((d) => d.entries.length > 0);
          // 윈도우 모드는 14일 창이 곧 상한이라 "몇 건 중 몇 건"이 없다.
          setPage(null);
        }
        setDays(grouped);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof OculpmApiError ? e.message : String(e));
        setDays(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, todayKey, enabled, keys, allPeriod, filtersKey, limit, tick]);

  return {
    days,
    loading,
    error,
    refresh,
    total: page?.total ?? null,
    loaded: page?.entries ?? null,
    canLoadMore: page != null && page.entries < page.total && page.entries >= limit,
    loadMore,
  };
}

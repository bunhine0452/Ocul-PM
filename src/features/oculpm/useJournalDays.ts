import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { commands, type EntryFilters, type JournalEntrySummary } from "@/lib/bindings";
import { useJournalEvents } from "./useJournalEvents";
import { t } from "@/i18n";

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

function shiftWorkday(workday: string, delta: number): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear().toString().padStart(4, "0");
  const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getDate().toString().padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

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
}

interface UseJournalDaysResult {
  days: JournalDay[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
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
  const { filters = null, allPeriod = false, dayCount = DEFAULT_DAYS } = options;
  const [days, setDays] = useState<JournalDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          // Single full-history query; the backend applies `filters`.
          const list = await oculpmApi.listJournalEntries(
            projectId,
            undefined,
            filters ?? undefined,
          );
          if (cancelled) return;
          grouped = groupByWorkday(list, todayKey);
        } else {
          // v2 U12 — 워크데이당 1콜(×14) 대신 단일 workday brief 로.
          const res = await commands.oculpmWorkdayBrief(projectId, keys, null);
          if (cancelled) return;
          if (res.status !== "ok") throw new Error(res.error);
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
  }, [projectId, todayKey, enabled, keys, allPeriod, filtersKey, tick]);

  return { days, loading, error, refresh };
}

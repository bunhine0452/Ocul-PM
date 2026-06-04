import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { JournalEntrySummary } from "@/lib/bindings";
import { useJournalEvents } from "./useJournalEvents";

// Final UI Update (ui_v2) — fetch journal entries for the last N workdays and
// group them by day for the timeline. Frontend aggregation over the existing
// oculpm_list_journal_entries (Decision F, §0.8) — no new backend command.

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
  if (workday === todayKey) return `오늘 · ${iso}`;
  if (workday === shiftWorkday(todayKey, -1)) return `어제 · ${iso}`;
  return iso;
}

interface UseJournalDaysResult {
  days: JournalDay[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Load + group the last `dayCount` workdays of journal entries (only days that
 * have at least one entry are returned, newest first). Returns null until the
 * first fetch resolves.
 */
export function useJournalDays(
  projectId: number | null,
  todayKey: string | null,
  enabled: boolean,
  dayCount: number = DEFAULT_DAYS,
): UseJournalDaysResult {
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
        const lists = await Promise.all(
          keys.map((wd) => oculpmApi.listJournalEntries(projectId, wd)),
        );
        if (cancelled) return;
        const grouped: JournalDay[] = keys
          .map((wd, i) => ({
            workday: wd,
            label: dayLabel(wd, todayKey),
            entries: (lists[i] ?? [])
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at)),
          }))
          .filter((d) => d.entries.length > 0);
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
  }, [projectId, todayKey, enabled, keys, tick]);

  return { days, loading, error, refresh };
}

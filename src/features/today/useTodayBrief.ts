import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { EntryType, JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — Today 6-block dashboard data.
//
// Decision (PR-UI 2, §0.8): NO new backend command. The mockup's
// get_today_brief / get_today_highlights are computed on the FRONTEND from the
// existing `oculpm_list_journal_entries` summaries. The only field the summary
// lacks is per-file line counts (+/-), so the 4 highlighted/featured entries
// hydrate `getJournalEntry` to sum `files_touched[].bytes_added/removed`.
// Anything beyond a handful of entries/day keeps the brief light.

export interface AgentContribution {
  id: string;
  count: number;
}

export interface WeekBar {
  /** YYYYMMDD */
  workday: string;
  /** Short weekday label, e.g. "월". */
  label: string;
  count: number;
  isToday: boolean;
}

export interface TodayBrief {
  /** All of today's entries, newest first (as returned by the backend). */
  today: JournalEntrySummary[];
  /** Yesterday's `done` entries, newest first. */
  yesterdayDone: JournalEntrySummary[];
  changedToday: number;
  filesTouched: number;
  /** Σ bytes_added across today's entries (proxy for "lines added"). */
  bytesAdded: number;
  bytesRemoved: number;
  /** Count of today's `error` (에러 사이클) entries. */
  errorCycles: number;
  agents: AgentContribution[];
  /** 7-day rolling change counts, oldest → newest (today last). */
  week: WeekBar[];
  /** Top-3 highlight entries (error first, then most files touched). */
  highlights: JournalEntrySummary[];
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** Shift a YYYYMMDD key by `delta` calendar days (local time). */
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

function weekdayLabel(workday: string): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  return WEEKDAY_LABELS[new Date(y, m, d).getDay()] ?? "";
}

/** Highlight ranking: error cycles first, then most files touched. */
function rankHighlights(entries: JournalEntrySummary[]): JournalEntrySummary[] {
  return [...entries]
    .sort((a, b) => {
      const ae = a.type === ("error" satisfies EntryType) ? 1 : 0;
      const be = b.type === ("error" satisfies EntryType) ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.files_count - a.files_count;
    })
    .slice(0, 3);
}

interface UseTodayBriefResult {
  brief: TodayBrief | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Build the Today brief for `workday` (the current workday key). Returns null
 * until the first fetch resolves. Re-runs on `refreshTick` change.
 */
export function useTodayBrief(
  projectId: number | null,
  workday: string | null,
  enabled: boolean,
): UseTodayBriefResult {
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The 7 workday keys we chart, oldest → newest.
  const weekKeys = useMemo(() => {
    if (!workday) return [];
    return Array.from({ length: 7 }, (_, i) => shiftWorkday(workday, i - 6));
  }, [workday]);

  useEffect(() => {
    if (!enabled || projectId == null || !workday) {
      setBrief(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // One list call per charted workday (7) + yesterday is already in the
        // set (weekKeys[5]). Today is weekKeys[6].
        const lists = await Promise.all(
          weekKeys.map((wd) => oculpmApi.listJournalEntries(projectId, wd)),
        );
        if (cancelled) return;
        const byKey = new Map<string, JournalEntrySummary[]>();
        weekKeys.forEach((wd, i) => byKey.set(wd, lists[i] ?? []));

        const today = byKey.get(workday) ?? [];
        const yesterdayKey = shiftWorkday(workday, -1);
        const yesterdayDone = (byKey.get(yesterdayKey) ?? []).filter(
          (e) => e.status === "done",
        );

        const week: WeekBar[] = weekKeys.map((wd) => ({
          workday: wd,
          label: weekdayLabel(wd),
          count: (byKey.get(wd) ?? []).length,
          isToday: wd === workday,
        }));

        const agentCounts = new Map<string, number>();
        for (const e of today) {
          agentCounts.set(e.agent_id, (agentCounts.get(e.agent_id) ?? 0) + 1);
        }
        const agents: AgentContribution[] = [...agentCounts.entries()]
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count);

        const filesTouched = today.reduce((s, e) => s + e.files_count, 0);
        const errorCycles = today.filter((e) => e.type === "error").length;
        const highlights = rankHighlights(today);

        // Hydrate today's entries for line counts. The summary has no +/-, so
        // sum files_touched bytes from the full entry. Bounded by today's
        // entry count (a handful per day).
        let bytesAdded = 0;
        let bytesRemoved = 0;
        const full = await Promise.all(
          today.map((e) =>
            oculpmApi.getJournalEntry(projectId, e.relative_path).catch(() => null),
          ),
        );
        if (cancelled) return;
        for (const entry of full) {
          if (!entry) continue;
          for (const f of entry.frontmatter.files_touched) {
            bytesAdded += f.bytes_added ?? 0;
            bytesRemoved += f.bytes_removed ?? 0;
          }
        }

        setBrief({
          today,
          yesterdayDone: yesterdayDone.slice(0, 3),
          changedToday: today.length,
          filesTouched,
          bytesAdded,
          bytesRemoved,
          errorCycles,
          agents,
          week,
          highlights,
        });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof OculpmApiError ? e.message : String(e);
        setError(msg);
        setBrief(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday, enabled, weekKeys, tick]);

  return { brief, loading, error, refresh };
}

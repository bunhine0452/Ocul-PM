import { useCallback, useEffect, useState } from "react";
import { oculpmApi } from "@/api/oculpm";
import { commands, type GitCommit } from "@/lib/bindings";
import { useJournalEvents } from "@/features/oculpm/useJournalEvents";

// Today monitoring extras — surfaces data the backend already exposes but Today
// didn't show: active work time (sessions) + git status / today's commits.
// Separate from useTodayBrief so the journal-driven brief stays untouched.
// (Goal progress was dropped 2026-06-15 per dogfooding feedback.)

export interface TodayMonitor {
  /** Σ active_window_ms across today's sessions. */
  activeMs: number;
  sessionCount: number;

  isGitRepo: boolean;
  branch: string | null;
  uncommitted: number;
  commitsToday: number;
  latestCommit: GitCommit | null;

  /** Total journal entries recorded for this project (summed over the overview
   *  heatmap window). Covers the project's lifetime in practice. */
  totalEntries: number;
}

/** Local-midnight unix seconds — the boundary for "오늘 커밋". */
function startOfTodaySeconds(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function useTodayMonitor(
  projectId: number,
  workday: string | null,
  enabled: boolean,
) {
  const [monitor, setMonitor] = useState<TodayMonitor | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    // Defensive: a failed read degrades the row to "—" placeholders rather than
    // escaping as an unhandled rejection (refresh is called via `void`).
    try {
      const [sessions, headRes, logRes, statsRes] = await Promise.all([
        oculpmApi.listSessions(projectId, workday ?? undefined).catch(() => []),
        commands.gitHeadStatusBrief(projectId),
        commands.gitLog(projectId, 50),
        // 365-day window is the clamp ceiling — sums to the project's lifetime
        // entry total for any project younger than a year.
        commands.oculpmOverviewStats(projectId, 365),
      ]);

      const activeMs = sessions.reduce((s, x) => s + (x.active_window_ms ?? 0), 0);
      const head = headRes.status === "ok" ? headRes.data : null;
      const commits = logRes.status === "ok" ? logRes.data : [];
      const totalEntries =
        statsRes.status === "ok"
          ? statsRes.data.heatmap_cells.reduce((s, c) => s + c.entry_count, 0)
          : 0;
      const since = startOfTodaySeconds();

      setMonitor({
        activeMs,
        sessionCount: sessions.length,
        isGitRepo: head?.is_git_repo ?? false,
        branch: head?.head_branch ?? null,
        uncommitted: head?.uncommitted ?? 0,
        commitsToday: commits.filter((c) => c.timestamp >= since).length,
        latestCommit: commits[0] ?? null,
        totalEntries,
      });
    } catch {
      setMonitor(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, workday, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // New journal activity usually means new sessions / commits — refresh.
  useJournalEvents(projectId, enabled, refresh);

  return { monitor, loading, refresh };
}

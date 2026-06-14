import { useCallback, useEffect, useState } from "react";
import { oculpmApi } from "@/api/oculpm";
import { commands, type GitCommit } from "@/lib/bindings";
import { useJournalEvents } from "@/features/oculpm/useJournalEvents";

// Code-search round (2026-06-15) — Today monitoring extras. Surfaces data the
// backend already exposes but Today didn't show: active work time (sessions),
// git status / today's commits, and goal progress. Separate from useTodayBrief
// so the journal-driven brief stays untouched; this hook owns the session +
// git + planner reads and refreshes on the same journal events.

export interface TodayMonitor {
  /** Σ active_window_ms across today's sessions. */
  activeMs: number;
  sessionCount: number;

  isGitRepo: boolean;
  branch: string | null;
  uncommitted: number;
  commitsToday: number;
  latestCommit: GitCommit | null;

  /** Average goal progress, 0–100 (avg_progress is 0–1 on the wire). */
  goalPct: number;
  goalInProgress: number;
  goalOpen: number;
  goalDueToday: number;
  goalOverdue: number;
  goalTotal: number;
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
        commands.dashboardStats(projectId),
      ]);

      const activeMs = sessions.reduce((s, x) => s + (x.active_window_ms ?? 0), 0);
      const head = headRes.status === "ok" ? headRes.data : null;
      const commits = logRes.status === "ok" ? logRes.data : [];
      const since = startOfTodaySeconds();
      const stats = statsRes.status === "ok" ? statsRes.data : null;

      setMonitor({
        activeMs,
        sessionCount: sessions.length,
        isGitRepo: head?.is_git_repo ?? false,
        branch: head?.head_branch ?? null,
        uncommitted: head?.uncommitted ?? 0,
        commitsToday: commits.filter((c) => c.timestamp >= since).length,
        latestCommit: commits[0] ?? null,
        goalPct: Math.round((stats?.avg_progress ?? 0) * 100),
        goalInProgress: stats?.in_progress ?? 0,
        goalOpen: stats?.open ?? 0,
        goalDueToday: stats?.due_today ?? 0,
        goalOverdue: stats?.overdue ?? 0,
        goalTotal: stats?.total ?? 0,
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

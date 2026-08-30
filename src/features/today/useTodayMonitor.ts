import { useCallback, useEffect, useMemo, useState } from "react";
import { safeUnlisten } from "@/lib/unlisten";
import { oculpmApi } from "@/api/oculpm";
import { commands, events, type GitCommit } from "@/lib/bindings";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";

// Today monitoring extras — surfaces data the backend already exposes but Today
// didn't show: active work time (sessions) + git status / today's commits.
// Separate from useTodayBrief so the journal-driven brief stays untouched.
// (Goal progress was dropped 2026-06-15 per dogfooding feedback.)

export interface TodayMonitor {
  /** Σ active_window_ms across today's *ended* sessions. The open session's
   *  window isn't stamped until it finalizes (backend computes it on end), so
   *  its live time is carried by `openSince` and added in the UI. */
  activeMs: number;
  sessionCount: number;
  /** Epoch ms when the currently-open session started (ended_at == null), or
   *  null when no session is live. Lets the UI tick 활동시간 in real time. */
  openSince: number | null;

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
  /** v2 U12 — 총 일지 수는 workday brief 가 스칼라로 내려준다 (365일 히트맵
   *  전체를 받아 프런트에서 합산하던 IPC 제거). brief 도착 전엔 null → "—". */
  totalEntriesFromBrief: number | null = null,
) {
  const [monitor, setMonitor] = useState<TodayMonitor | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    // Defensive: a failed read degrades the row to "—" placeholders rather than
    // escaping as an unhandled rejection (refresh is called via `void`).
    try {
      const [sessions, headRes, logRes] = await Promise.all([
        oculpmApi.listSessions(projectId, workday ?? undefined).catch(() => []),
        commands.gitHeadStatusBrief(projectId),
        commands.gitLog(projectId, 50),
      ]);

      // The open session (ended_at == null) carries active_window_ms == 0 until
      // it finalizes, so sum only ended sessions here and let the UI add the
      // open session's live elapsed time from `openSince`.
      let activeMs = 0;
      let openSince: number | null = null;
      for (const x of sessions) {
        if (x.ended_at == null) {
          const t = Date.parse(x.started_at);
          if (!Number.isNaN(t)) {
            openSince = openSince == null ? t : Math.min(openSince, t);
          }
        } else {
          activeMs += x.active_window_ms ?? 0;
        }
      }
      const head = headRes.status === "ok" ? headRes.data : null;
      const commits = logRes.status === "ok" ? logRes.data : [];
      const since = startOfTodaySeconds();

      setMonitor({
        activeMs,
        sessionCount: sessions.length,
        openSince,
        isGitRepo: head?.is_git_repo ?? false,
        branch: head?.head_branch ?? null,
        uncommitted: head?.uncommitted ?? 0,
        commitsToday: commits.filter((c) => c.timestamp >= since).length,
        latestCommit: commits[0] ?? null,
        // brief 의 값은 아래에서 합성한다 — 여기 넣으면 brief 가 도착할 때마다
        // refresh 의 identity 가 바뀌어 git 조회가 두 번 돌았다.
        totalEntries: 0,
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

  // Session start/end shifts 활동시간 but doesn't always coincide with a journal
  // event (e.g. an inactivity-timeout end) — subscribe so the row refetches the
  // settled active_window_ms then too, and flips the live counter on/off.
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const offs: Array<() => void> = [];
    const sub = (ev: {
      listen: (
        cb: (e: { payload: { project_id: number } }) => void,
      ) => Promise<() => void>;
    }) => {
      try {
        void ev
          .listen((e) => {
            if (e.payload.project_id === projectId) void refresh();
          })
          .then((off) => {
            if (active) offs.push(off);
            else safeUnlisten(off);
          })
          .catch(() => {});
      } catch {
        /* event channel unavailable */
      }
    };
    sub(events.oculpmSessionStarted);
    sub(events.oculpmSessionEnded);
    return () => {
      active = false;
      offs.forEach(safeUnlisten);
    };
  }, [projectId, enabled, refresh]);

  // brief 의 일지 수를 렌더 시점에 합성한다 — refresh 의 deps 에서 빼내 brief
  // 도착이 git 재조회(마운트마다 프로세스 ~15개)를 두 번 돌리지 않게 (2026-08-30).
  const merged = useMemo(
    () => (monitor ? { ...monitor, totalEntries: totalEntriesFromBrief ?? 0 } : null),
    [monitor, totalEntriesFromBrief],
  );
  return { monitor: merged, loading, refresh };
}

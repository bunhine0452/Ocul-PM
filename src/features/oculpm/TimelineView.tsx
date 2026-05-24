/**
 * TimelineView — the main Today body when ocul-pm has journal entries.
 *
 * Responsibilities:
 *   1. Fetch `listJournalEntries(workday)` + `listSessions(workday)` on
 *      mount and re-fetch when workday or projectId changes.
 *   2. Group entries by `session_id`, joined with the session list.
 *      Orphan entries (no matching session) land in a synthetic "Manual"
 *      bucket so manual entries always render.
 *   3. Subscribe to `events.oculpmJournalPathChanged` /
 *      `events.oculpmJournalAdded` / `oculpmJournalUpdated` and invalidate
 *      the entry list (cheap: re-fetch the whole list).
 *   4. Refetch on document visibility change ("focus back" path).
 *   5. Track `selectedEntryPath` and handle j/k/space/enter keys —
 *      navigation skips collapsed sessions implicitly because we render a
 *      flat list of visible entries.
 *   6. Render `JournalEntryDetail` on the right (lg+ only) for the
 *      currently selected entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { events, type JournalEntrySummary, type Session } from "@/lib/bindings";
import { Loader2, AlertTriangle } from "@/components/Icons";
import { SessionCard, type SessionWithSynthetic } from "./SessionCard";
import { JournalEntryDetail } from "./JournalEntryDetail";

interface TimelineViewProps {
  projectId: number;
  projectRoot: string | null;
  workday: string;
}

const SYNTHETIC_MANUAL_ID = "__synthetic_manual__";

export function TimelineView({ projectId, projectRoot, workday }: TimelineViewProps) {
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);

  // ── fetch ──────────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [es, ss] = await Promise.all([
        oculpmApi.listJournalEntries(projectId, workday),
        oculpmApi.listSessions(projectId, workday),
      ]);
      setEntries(es);
      setSessions(ss);
    } catch (e) {
      const msg =
        e instanceof OculpmApiError
          ? `${e.command} 실패: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId, workday]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // ── event-driven invalidation ──────────────────────────────────────────
  useEffect(() => {
    const offs: Array<() => void> = [];
    const isOurs = (pid: number) => pid === projectId;
    const debouncedRefetch = debounce(() => void refetch(), 200);

    void events.oculpmJournalPathChanged.listen((e) => {
      if (isOurs(e.payload.project_id)) debouncedRefetch();
    }).then((off) => offs.push(off));

    void events.oculpmJournalAdded.listen((e) => {
      if (isOurs(e.payload.project_id)) debouncedRefetch();
    }).then((off) => offs.push(off));

    void events.oculpmJournalUpdated.listen((e) => {
      if (isOurs(e.payload.project_id)) debouncedRefetch();
    }).then((off) => offs.push(off));

    return () => {
      offs.forEach((off) => off());
      debouncedRefetch.cancel();
    };
  }, [projectId, refetch]);

  // ── visibility-based refetch ───────────────────────────────────────────
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  // ── grouped sessions (real + synthetic Manual bucket) ──────────────────
  const groups = useMemo<
    Array<{ session: SessionWithSynthetic; entries: JournalEntrySummary[] }>
  >(() => {
    if (entries == null) return [];
    const bySessionId = new Map<string, JournalEntrySummary[]>();
    for (const e of entries) {
      const arr = bySessionId.get(e.session_id) ?? [];
      arr.push(e);
      bySessionId.set(e.session_id, arr);
    }

    const sessionIds = new Set(sessions.map((s) => s.id));
    const out: Array<{
      session: SessionWithSynthetic;
      entries: JournalEntrySummary[];
    }> = [...sessions]
      // newest session first
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((s) => ({
        session: { kind: "real" as const, session: s },
        entries: (bySessionId.get(s.id) ?? []).slice().sort(byCreatedAtDesc),
      }));

    // Orphan entries — any entry whose session_id isn't in `sessions`
    const orphans: JournalEntrySummary[] = [];
    for (const [sid, es] of bySessionId) {
      if (!sessionIds.has(sid)) orphans.push(...es);
    }
    orphans.sort(byCreatedAtDesc);
    if (orphans.length > 0) {
      out.push({
        session: {
          kind: "synthetic",
          id: SYNTHETIC_MANUAL_ID,
          label: "Manual",
        },
        entries: orphans,
      });
    }
    return out;
  }, [entries, sessions]);

  // Flat visible-order list for j/k navigation.
  const flatEntries = useMemo(
    () => groups.flatMap((g) => g.entries),
    [groups]
  );

  // ── verify toggle (optimistic) ─────────────────────────────────────────
  const handleToggleVerified = useCallback(
    async (relativePath: string) => {
      // Optimistic update — flip the local flag immediately so the UI feels
      // snappy; on error we re-fetch to resync.
      setEntries((prev) => {
        if (prev == null) return prev;
        return prev.map((e) =>
          e.relative_path === relativePath
            ? { ...e, verified_by_user: !e.verified_by_user }
            : e
        );
      });
      const target = (entries ?? []).find(
        (e) => e.relative_path === relativePath
      );
      try {
        await oculpmApi.setJournalVerified(
          projectId,
          relativePath,
          !(target?.verified_by_user ?? false)
        );
      } catch (e) {
        console.warn("[TimelineView] verify toggle failed:", e);
        // Resync from server on failure.
        void refetch();
      }
    },
    [entries, projectId, refetch]
  );

  // ── keyboard nav ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when the user is typing inside an input/textarea.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (flatEntries.length === 0) return;

      const idx = selectedEntryPath
        ? flatEntries.findIndex((x) => x.relative_path === selectedEntryPath)
        : -1;

      if (e.key === "j") {
        e.preventDefault();
        const next = flatEntries[Math.min(flatEntries.length - 1, idx + 1)];
        if (next) setSelectedEntryPath(next.relative_path);
      } else if (e.key === "k") {
        e.preventDefault();
        const prev = flatEntries[Math.max(0, idx - 1)];
        if (prev) setSelectedEntryPath(prev.relative_path);
      } else if (e.key === " " && idx >= 0) {
        e.preventDefault();
        const current = flatEntries[idx];
        if (current) void handleToggleVerified(current.relative_path);
      } else if (e.key === "Escape" && idx >= 0) {
        e.preventDefault();
        setSelectedEntryPath(null);
      }
      // Enter → "focus DetailPane" — DetailPane is a stub in PR6, so
      // selecting is enough. PR7 will move focus into the markdown viewer.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatEntries, selectedEntryPath, handleToggleVerified]);

  // Auto-select first entry on mount/refresh if nothing selected.
  useEffect(() => {
    if (selectedEntryPath == null && flatEntries.length > 0) {
      setSelectedEntryPath(flatEntries[0].relative_path);
    }
    // If the selected entry was deleted, fall back to first.
    if (
      selectedEntryPath != null &&
      !flatEntries.some((e) => e.relative_path === selectedEntryPath)
    ) {
      setSelectedEntryPath(flatEntries[0]?.relative_path ?? null);
    }
  }, [flatEntries, selectedEntryPath]);

  // ── render ─────────────────────────────────────────────────────────────
  const selectedEntry =
    selectedEntryPath
      ? flatEntries.find((e) => e.relative_path === selectedEntryPath) ?? null
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
      {/* Left: timeline */}
      <div className="space-y-3">
        {loading && entries == null && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {groups.length > 0 &&
          groups.map((g, i) => (
            <SessionCard
              key={
                g.session.kind === "real" ? g.session.session.id : g.session.id
              }
              projectId={projectId}
              session={g.session}
              entries={g.entries}
              defaultExpanded={i === 0}
              selectedEntryPath={selectedEntryPath}
              onSelectEntry={setSelectedEntryPath}
              onToggleVerified={handleToggleVerified}
            />
          ))}
      </div>

      {/* Right: JournalEntryDetail (W3-PR7) */}
      <aside className="hidden lg:block">
        <JournalEntryDetail
          projectId={projectId}
          projectRoot={projectRoot}
          summary={selectedEntry}
          onToggleVerified={handleToggleVerified}
        />
      </aside>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function byCreatedAtDesc(a: JournalEntrySummary, b: JournalEntrySummary): number {
  return b.created_at.localeCompare(a.created_at);
}

/** Trailing-edge debounce with cancel. */
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: number | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (t) window.clearTimeout(t);
    t = null;
  };
  return wrapped;
}

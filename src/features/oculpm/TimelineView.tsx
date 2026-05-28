/**
 * TimelineView — the main Today body when ocul-pm has journal entries.
 *
 * Lite-W6 PR3: the "session" abstraction was retired from the UI. This view
 * now renders a flat reverse-chronological list of journal entries for the
 * requested workday. Session boundary inference moved out of the app — the
 * external LLM is trusted (per AGENTS.md prompts) to file entries directly.
 *
 * Responsibilities:
 *   1. Fetch `listJournalEntries(workday)` on mount and re-fetch when
 *      workday or projectId changes.
 *   2. Subscribe to `events.oculpmJournalPathChanged` /
 *      `events.oculpmJournalAdded` / `oculpmJournalUpdated` and invalidate
 *      the entry list (cheap: re-fetch the whole list).
 *   3. Refetch on document visibility change ("focus back" path).
 *   4. Track `selectedEntryPath` and handle j/k/space/enter keys.
 *   5. Render `JournalEntryDetail` on the right (lg+ only) for the
 *      currently selected entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import {
  events,
  type EntryFilters,
  type JournalEntry,
  type JournalEntrySummary,
} from "@/lib/bindings";
import { Loader2, AlertTriangle } from "@/components/Icons";
import { JournalEntryCard } from "./JournalEntryCard";
import { JournalEntryDetail } from "./JournalEntryDetail";

interface TimelineViewProps {
  projectId: number;
  projectRoot: string | null;
  workday: string;
  /** W3-PR8: backend `EntryFilters` DTO. Defaults to no constraint when
   *  omitted (legacy callers / first render). The parent (TodayScreen) owns
   *  the UI-level `CategoryFilter` state and persistence. */
  filters?: EntryFilters | null;
}

export function TimelineView({
  projectId,
  projectRoot,
  workday,
  filters,
}: TimelineViewProps) {
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);

  // Serialise filters so the useCallback identity only changes when the
  // backend-meaningful content actually changes (the parent may rebuild the
  // object on unrelated state updates).
  const filtersKey = useMemo(
    () => (filters ? JSON.stringify(filters) : ""),
    [filters],
  );

  // ── fetch ──────────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const es = await oculpmApi.listJournalEntries(
        projectId,
        workday,
        filters ?? undefined,
      );
      setEntries(es);
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
    // `filters` itself is intentionally excluded — `filtersKey` is the
    // stable identity. Including the object would re-create `refetch` on
    // every parent render even when filters are deeply equal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workday, filtersKey]);

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
      if (!isOurs(e.payload.project_id)) return;
      void import("@/lib/oculpmLog").then(({ oculpmLog }) =>
        oculpmLog.flow("step 4 — TimelineView received JournalAdded; refetch scheduled", {
          path: e.payload.summary.relative_path,
          title: e.payload.summary.title,
        }),
      );
      debouncedRefetch();
    }).then((off) => offs.push(off));

    void events.oculpmJournalUpdated.listen((e) => {
      if (!isOurs(e.payload.project_id)) return;
      void import("@/lib/oculpmLog").then(({ oculpmLog }) =>
        oculpmLog.flow("step 4 — TimelineView received JournalUpdated; refetch scheduled", {
          path: e.payload.summary.relative_path,
        }),
      );
      debouncedRefetch();
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

  // Reverse-chronological flat list.
  const flatEntries = useMemo(
    () => (entries ?? []).slice().sort(byCreatedAtDesc),
    [entries],
  );

  // ── meta update (difficulty/status from DetailHeader) ──────────────────
  // Detail does the round-trip + cache upsert; we just splice the hydrated
  // summary into the list so cards re-render without a refetch.
  const handleMetaUpdated = useCallback((hydrated: JournalEntry) => {
    setEntries((prev) => {
      if (prev == null) return prev;
      return prev.map((e) =>
        e.relative_path === hydrated.relative_path
          ? {
              ...e,
              status: hydrated.frontmatter.status,
              difficulty: hydrated.frontmatter.difficulty,
              updated_at: hydrated.frontmatter.updated_at,
            }
          : e,
      );
    });
  }, []);

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
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_26rem] gap-4 items-start">
      {/* Left: flat entry list */}
      <div className="space-y-2">
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

        {flatEntries.map((entry) => (
          <JournalEntryCard
            key={entry.relative_path}
            entry={entry}
            selected={selectedEntryPath === entry.relative_path}
            onSelect={() => setSelectedEntryPath(entry.relative_path)}
            onToggleVerified={() => void handleToggleVerified(entry.relative_path)}
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
          onMetaUpdated={handleMetaUpdated}
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

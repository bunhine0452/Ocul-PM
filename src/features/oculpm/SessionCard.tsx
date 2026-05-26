/**
 * SessionCard — collapsible card grouping one session's journal entries.
 *
 * Header line:  `Session 20260524-003 · 09:13 → 11:47 · 47 files · 12 unique · claude-code`
 *               or `Session … · 09:13 → 진행 중` with a pulse dot.
 *
 * Empty body (closed session, no entries): a one-line "no narrative for this
 * session" hint + a disabled "⚖ index 비교" button (the same DiffVsNarrative
 * stub as EmptyTodayV3 — W4 wires the real comparison).
 *
 * Expand state is persisted per (project, session) in localStorage so
 * scroll position survives ⌘1/⌘2 round-trips.
 *
 * Agent label guess: phase doc §8 decision #4 — most-common `agent_id`
 * across the session's entries, suppressed when no clear majority.
 */

import { useCallback, useState } from "react";
import type { JournalEntrySummary, Session } from "@/lib/bindings";
import { ChevronDown, ChevronRight, GitBranch, MessageCircle } from "@/components/Icons";
import { JournalEntryCard } from "./JournalEntryCard";
import { DiffVsNarrative } from "./DiffVsNarrative";

interface SessionCardProps {
  projectId: number;
  session: SessionWithSynthetic;
  entries: JournalEntrySummary[];
  defaultExpanded: boolean;
  selectedEntryPath: string | null;
  onSelectEntry: (relativePath: string) => void;
  onToggleVerified: (relativePath: string) => void;
}

/**
 * Either a real `Session` or a synthetic placeholder we generate for
 * orphan entries (e.g. manual entries written outside an active session).
 */
export type SessionWithSynthetic =
  | { kind: "real"; session: Session }
  | { kind: "synthetic"; id: string; label: string };

export function SessionCard({
  projectId,
  session,
  entries,
  defaultExpanded,
  selectedEntryPath,
  onSelectEntry,
  onToggleVerified,
}: SessionCardProps) {
  const id = session.kind === "real" ? session.session.id : session.id;
  const storageKey = `oculpm.session.expanded.${projectId}.${id}`;
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored == null) return defaultExpanded;
      return stored === "1";
    } catch {
      return defaultExpanded;
    }
  });

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, [storageKey]);

  const agentGuess =
    session.kind === "real"
      ? session.session.agent_label_guess ?? guessAgentFromEntries(entries)
      : "manual";

  // W4 dogfooding finding (2026-05-25) — DiffVsNarrative was a modal; replaced
  // with an inline expandable panel docked at the bottom of this card. The
  // header ⚖ button and the empty-entries placeholder share one open state.
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = useCallback(() => setCompareOpen((v) => !v), []);

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-label={`Session ${id}`}
    >
      <SessionHeader
        session={session}
        agentGuess={agentGuess}
        entryCount={entries.length}
        expanded={expanded}
        compareOpen={compareOpen}
        onToggle={toggleExpanded}
        onCompareLayers={toggleCompare}
      />

      {expanded && (
        <div className="border-t border-border p-3 space-y-2">
          {entries.length === 0 ? (
            <EmptyEntriesPlaceholder
              ongoing={isOngoing(session)}
              onCompareLayers={toggleCompare}
            />
          ) : (
            entries.map((entry) => (
              <JournalEntryCard
                key={entry.relative_path}
                entry={entry}
                selected={selectedEntryPath === entry.relative_path}
                onSelect={() => onSelectEntry(entry.relative_path)}
                onToggleVerified={() => onToggleVerified(entry.relative_path)}
              />
            ))
          )}
          {compareOpen && (
            <div className="pt-2">
              <DiffVsNarrative
                projectId={projectId}
                sessionId={id}
                onClose={() => setCompareOpen(false)}
                variant="compact"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────

function SessionHeader({
  session,
  agentGuess,
  entryCount,
  expanded,
  compareOpen,
  onToggle,
  onCompareLayers,
}: {
  session: SessionWithSynthetic;
  agentGuess: string | null;
  entryCount: number;
  expanded: boolean;
  compareOpen: boolean;
  onToggle: () => void;
  onCompareLayers: () => void;
}) {
  if (session.kind === "synthetic") {
    return (
      <div className="w-full flex items-center gap-3 hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left px-4 py-3 flex items-center gap-3 cursor-pointer"
          aria-expanded={expanded}
          aria-label={`${session.label} 세션, ${entryCount} entries`}
        >
          <ChevronIcon expanded={expanded} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{session.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              세션 없이 작성된 entries · {entryCount}개
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            manual
          </span>
        </button>
      </div>
    );
  }

  const s = session.session;
  const start = formatTime(s.started_at);
  const end = s.ended_at ? formatTime(s.ended_at) : null;
  const ongoing = s.ended_at == null;

  return (
    <div className="w-full flex items-stretch hover:bg-muted/30 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="flex-1 text-left px-4 py-3 flex items-center gap-3 cursor-pointer"
        aria-expanded={expanded}
        aria-label={`Session ${s.id}, ${entryCount} entries`}
      >
        <ChevronIcon expanded={expanded} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="font-mono text-xs text-muted-foreground">
              Session {s.id}
            </span>
            {ongoing && <OngoingDot />}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="tabular-nums">
              {start} {end ? `→ ${end}` : "→ 진행 중"}
            </span>
            <span>·</span>
            <span className="tabular-nums">{s.file_event_count} files</span>
            <span>·</span>
            <span className="tabular-nums">{s.files_unique} unique</span>
            {agentGuess && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" />
                  {agentGuess}
                </span>
              </>
            )}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {entryCount} entries
        </span>
      </button>
      <button
        type="button"
        onClick={onCompareLayers}
        title="index ↔ journal 비교 (W4-PR6, 인라인 패널)"
        aria-label={`Session ${s.id} index 비교 ${compareOpen ? "닫기" : "열기"}`}
        aria-pressed={compareOpen}
        className={`px-3 transition-colors ${
          compareOpen
            ? "text-foreground bg-muted/60"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        }`}
      >
        <GitBranch className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
  ) : (
    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
  );
}

function OngoingDot() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
      aria-label="진행 중"
    >
      <span className="relative inline-flex w-1.5 h-1.5">
        <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-75 animate-ping" />
        <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
      </span>
      진행 중
    </span>
  );
}

function EmptyEntriesPlaceholder({
  ongoing,
  onCompareLayers,
}: {
  ongoing: boolean;
  onCompareLayers: () => void;
}) {
  return (
    <div className="text-xs text-muted-foreground px-3 py-3 rounded-lg border border-dashed border-border flex items-center justify-between gap-3">
      <span>
        {ongoing
          ? "이 세션에 아직 narrative 가 없습니다."
          : "이 세션에 narrative 없음."}
      </span>
      <button
        type="button"
        onClick={onCompareLayers}
        title="index ↔ journal 비교"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-muted/40"
      >
        <GitBranch className="w-3 h-3" />
        ⚖ index 비교
      </button>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function isOngoing(s: SessionWithSynthetic): boolean {
  return s.kind === "real" && s.session.ended_at == null;
}

function formatTime(rfc3339: string): string {
  const m = rfc3339.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : rfc3339;
}

/** Phase §8 decision #4: pick agent_id mode iff it's the clear majority. */
function guessAgentFromEntries(entries: JournalEntrySummary[]): string | null {
  if (entries.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.agent_id, (counts.get(e.agent_id) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, c] of counts) {
    if (c > bestCount) {
      bestId = id;
      bestCount = c;
    }
  }
  if (bestId && bestCount / entries.length >= 0.5) return bestId;
  return null;
}

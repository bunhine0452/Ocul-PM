/**
 * JournalEntryCard — a single journal entry row in TimelineView.
 *
 * Visual model:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ [bug] [medium] [done]  09:25 · 3 files · ⚠ 미검증     [✓ ▣]      │
 *   │ Changelog Export 파라미터 불일치                                  │
 *   │ #changelog #sqlite                                               │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Interactions handled here:
 *  - click → onSelect(relative_path)
 *  - hover → reveal verify toggle (the toggle stays visible when selected)
 *  - verify toggle click → onToggleVerified (optimistic UI in parent)
 *
 * Keyboard nav (j/k/space) lives in TimelineView so it operates on the
 * flat entry list; this card only renders the visual `selected` state.
 *
 * Tokens: phase §3.4 (type colors, difficulty opacity, status icon).
 */

import type { Difficulty, EntryStatus, EntryType, JournalEntrySummary } from "@/lib/bindings";
import { Check, AlertTriangle } from "@/components/Icons";

interface JournalEntryCardProps {
  entry: JournalEntrySummary;
  selected: boolean;
  onSelect: () => void;
  onToggleVerified: () => void;
}

export function JournalEntryCard({
  entry,
  selected,
  onSelect,
  onToggleVerified,
}: JournalEntryCardProps) {
  const created = parseEntryTime(entry.created_at);
  const unfinished =
    entry.checkbox === false || entry.status !== "done";

  return (
    <button
      type="button"
      onClick={onSelect}
      data-selected={selected || undefined}
      className={`group/entry w-full text-left rounded-xl border px-3.5 py-2.5 transition-colors cursor-pointer
        ${selected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/40"
        }`}
      aria-label={`${entry.title} — ${entry.type}, ${entry.status}`}
      aria-current={selected ? "true" : undefined}
    >
      {/* Row 1: badges + meta + verify toggle */}
      <div className="flex items-center gap-2 text-[11px]">
        <TypeBadge type={entry.type} />
        {entry.difficulty && <DifficultyBadge difficulty={entry.difficulty} />}
        <StatusBadge status={entry.status} checkbox={entry.checkbox} />
        <span className="text-muted-foreground tabular-nums shrink-0">
          {created}
        </span>
        <span className="text-muted-foreground shrink-0">·</span>
        <span className="text-muted-foreground tabular-nums shrink-0">
          {entry.files_count} files
        </span>
        {!entry.verified_by_user && (
          <span
            className="ml-auto inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0"
            title="아직 사용자가 검증하지 않음"
          >
            <AlertTriangle className="w-3 h-3" />
            <span className="hidden sm:inline">미검증</span>
          </span>
        )}
        <VerifyToggle
          verified={entry.verified_by_user}
          selected={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVerified();
          }}
        />
      </div>

      {/* Row 2: title */}
      <h3
        className={`mt-1.5 text-sm leading-snug font-medium truncate
          ${unfinished ? "" : "text-foreground"}
          ${entry.status === "abandoned" ? "line-through text-muted-foreground" : ""}
        `}
      >
        {entry.title || entry.slug}
      </h3>

      {/* Row 3: tags (only when present) */}
      {entry.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {entry.tags.slice(0, 8).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 font-mono"
            >
              #{tag}
            </span>
          ))}
          {entry.tags.length > 8 && (
            <span className="text-muted-foreground tabular-nums">
              +{entry.tags.length - 8}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: EntryType }) {
  const cls = TYPE_COLOR[type];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[10px] ${cls}`}
    >
      {type}
    </span>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const opacity = DIFFICULTY_OPACITY[difficulty];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium uppercase tracking-wider text-[10px] bg-foreground/10 text-foreground ${opacity}`}
      title={`difficulty: ${difficulty}`}
    >
      {difficulty}
    </span>
  );
}

function StatusBadge({
  status,
  checkbox,
}: {
  status: EntryStatus;
  checkbox: boolean | null;
}) {
  // checkbox overrides display if explicitly set in body first line.
  const displayDone = status === "done" || checkbox === true;
  const label = STATUS_LABEL[status];
  if (displayDone && status === "done") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium text-[10px]"
        title="status: done"
      >
        <Check className="w-2.5 h-2.5" />
        done
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        in_progress
      </span>
    );
  }
  if (status === "abandoned") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-muted text-muted-foreground line-through font-medium text-[10px]">
        abandoned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-muted text-muted-foreground font-medium text-[10px]">
      {label}
    </span>
  );
}

function VerifyToggle({
  verified,
  selected,
  onClick,
}: {
  verified: boolean;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const visibility = verified || selected
    ? "opacity-100"
    : "opacity-0 group-hover/entry:opacity-100";
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={verified ? "검증됨 — 클릭해서 해제" : "미검증 — 클릭해서 검증"}
      onClick={onClick}
      className={`ml-1 inline-flex items-center justify-center w-5 h-5 rounded transition-opacity ${visibility} ${
        verified
          ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      title={`space: ${verified ? "미검증으로 되돌리기" : "검증됨으로 표시"}`}
    >
      <Check className="w-3 h-3" />
    </span>
  );
}

// ─── Tokens (phase §3.4) ─────────────────────────────────────────────────

const TYPE_COLOR: Record<EntryType, string> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  feature:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  error:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  refactor: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  chore: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300",
};

const DIFFICULTY_OPACITY: Record<Difficulty, string> = {
  superhigh: "opacity-100",
  high: "opacity-90",
  medium: "opacity-80",
  low: "opacity-60",
  verylow: "opacity-40",
};

const STATUS_LABEL: Record<EntryStatus, string> = {
  planned: "planned",
  in_progress: "in_progress",
  done: "done",
  abandoned: "abandoned",
};

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Pull the HH:MM out of an RFC3339 `created_at` if possible, otherwise
 * fall back to the original string. Avoids `Date` timezone surprises by
 * using the frontmatter's textual offset directly.
 */
function parseEntryTime(rfc3339: string): string {
  // matches "T09:25:13" anywhere
  const m = rfc3339.match(/T(\d{2}):(\d{2})/);
  if (!m) return rfc3339;
  return `${m[1]}:${m[2]}`;
}

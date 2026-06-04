/**
 * CategoryFilterBar — the filter strip above TimelineView.
 *
 * Layout (PR8 §3 mockup):
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ [전체] [bug] [feature] [error] [refactor] [chore]               │
 *   │ □ 미검증만  □ mismatch (W4)  □ 미완료만        🔍 [검색      ]  │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Source-of-truth rule (mirrors JournalEntryDetail's verify pattern):
 *  - The full `CategoryFilter` lives in the parent (TodayScreen). This
 *    component never owns it; it only renders + emits onChange.
 *  - One exception: the search `<input>` is a controlled local `string`
 *    so users see every keystroke immediately, but the debounced value
 *    (200ms) is what bubbles up through onChange. This keeps the parent
 *    from re-triggering a backend fetch on every keystroke.
 *
 * The mismatch toggle stays disabled with a W4 tooltip — the field
 * is in the filter shape so the wire-up is one boolean flip later.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, X } from "@/components/Icons";
import { commands, type EntryType } from "@/lib/bindings";
import {
  ALL_ENTRY_TYPES,
  KNOWN_AGENT_IDS,
  type CategoryFilter,
  isFilterEmpty,
} from "./filters";

interface CategoryFilterBarProps {
  projectId: number;
  filter: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
  /** Optional: shown as a tiny stat next to "전체" so users can see if the
   * filter is actively trimming results. -1 = caller doesn't know yet. */
  matchedCount?: number;
  totalCount?: number;
}

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  "gemini-cli": "Gemini CLI",
  "agents-md": "AGENTS.md",
  manual: "수동",
  migrated: "마이그레이션",
};
function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id;
}

const SEARCH_DEBOUNCE_MS = 200;

export function CategoryFilterBar({
  projectId,
  filter,
  onChange,
  matchedCount,
  totalCount,
}: CategoryFilterBarProps) {
  // W5-PR6 — observed agent ids for the dropdown (fetched once per project).
  const [observedAgents, setObservedAgents] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void commands.oculpmObservedAgentIds(projectId).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") setObservedAgents(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const allAgentOptions = useMemo(() => {
    const set = new Set<string>(KNOWN_AGENT_IDS);
    for (const a of observedAgents) set.add(a);
    return Array.from(set);
  }, [observedAgents]);

  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!agentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!agentMenuRef.current) return;
      if (!agentMenuRef.current.contains(e.target as Node))
        setAgentMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentMenuOpen]);

  const toggleAgent = (id: string) => {
    const next = new Set(filter.agents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filter, agents: next });
  };
  const clearAgents = () =>
    onChange({ ...filter, agents: new Set<string>() });
  const selectAllAgents = () =>
    onChange({ ...filter, agents: new Set<string>(allAgentOptions) });
  // ── Search input: local-immediate, debounced-to-parent ──────────────────
  const [searchInput, setSearchInput] = useState(filter.search);
  const lastEmittedSearch = useRef(filter.search);
  // Keep local input in sync if the parent resets the filter (e.g., project
  // switch loaded a different persisted filter).
  useEffect(() => {
    if (filter.search !== lastEmittedSearch.current) {
      setSearchInput(filter.search);
      lastEmittedSearch.current = filter.search;
    }
  }, [filter.search]);

  useEffect(() => {
    if (searchInput === filter.search) return;
    const t = window.setTimeout(() => {
      lastEmittedSearch.current = searchInput;
      onChange({ ...filter, search: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput, filter, onChange]);

  // ── Type chip handlers ───────────────────────────────────────────────────
  const toggleType = (t: EntryType) => {
    const next = new Set(filter.types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...filter, types: next });
  };
  const clearTypes = () => {
    if (filter.types.size === 0) return;
    onChange({ ...filter, types: new Set() });
  };

  // ── Toggle handlers ──────────────────────────────────────────────────────
  const setVerifiedOnly = (v: boolean) =>
    onChange({ ...filter, verifiedOnly: v });
  const setUnfinishedOnly = (v: boolean) =>
    onChange({ ...filter, unfinishedOnly: v });

  const allTypesActive = filter.types.size === 0;
  const empty = isFilterEmpty(filter);
  const hasCounts =
    typeof matchedCount === "number" && typeof totalCount === "number";

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-3 space-y-2.5">
      {/* Row 1: type chips + total/matched indicator */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:thin]">
        <Chip
          label="전체"
          active={allTypesActive}
          onClick={clearTypes}
          tone="neutral"
        />
        <span className="mx-1 text-border select-none">·</span>
        {ALL_ENTRY_TYPES.map((t) => (
          <Chip
            key={t}
            label={TYPE_LABEL[t]}
            active={filter.types.has(t)}
            onClick={() => toggleType(t)}
            tone={t}
          />
        ))}
        {hasCounts && (
          <span className="ml-auto pl-3 text-[11px] text-muted-foreground tabular-nums shrink-0">
            {empty
              ? `${totalCount} entries`
              : `${matchedCount} / ${totalCount} matched`}
          </span>
        )}
      </div>

      {/* Row 2: boolean toggles + agent dropdown + search */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ToggleField
          label="검증됨만"
          checked={filter.verifiedOnly}
          onChange={setVerifiedOnly}
        />
        <ToggleField
          label="미완료만"
          checked={filter.unfinishedOnly}
          onChange={setUnfinishedOnly}
        />

        {/* W5-PR6 — agent dropdown */}
        <div className="relative" ref={agentMenuRef}>
          <button
            type="button"
            onClick={() => setAgentMenuOpen((v) => !v)}
            aria-expanded={agentMenuOpen}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors cursor-pointer ${filter.agents.size > 0 ? "bg-primary/10 text-primary border-primary/40" : ""}`}
            title="에이전트별 필터"
          >
            에이전트
            {filter.agents.size > 0 && (
              <span className="tabular-nums opacity-80">({filter.agents.size})</span>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          {agentMenuOpen && (
            <div className="absolute z-50 mt-1 left-0 min-w-[220px] bg-card border border-border rounded-lg shadow-lg p-2 space-y-1">
              <ul className="max-h-60 overflow-y-auto scrollbar-thin">
                {allAgentOptions.map((id) => (
                  <li key={id}>
                    <label className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted rounded cursor-pointer">
                      <Checkbox
                        checked={filter.agents.has(id)}
                        onCheckedChange={() => toggleAgent(id)}
                      />
                      <span>{agentLabel(id)}</span>
                      {observedAgents.includes(id) && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          observed
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-1 border-t border-border pt-1 mt-1">
                <button
                  type="button"
                  onClick={selectAllAgents}
                  className="text-[11px] px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  전부 선택
                </button>
                <button
                  type="button"
                  onClick={clearAgents}
                  disabled={filter.agents.size === 0}
                  className="text-[11px] px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-40"
                >
                  초기화
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto relative w-full sm:w-64 shrink-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="제목 · 본문 · 태그 검색"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-7 pr-7 h-8 text-xs"
            aria-label="entries 검색"
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors cursor-pointer"
              aria-label="검색 지우기"
              title="검색 지우기"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Chip (raw button — ui/ dir has no ToggleGroup) ──────────────────────

function Chip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone: "neutral" | EntryType;
}) {
  const activeCls =
    tone === "neutral" ? NEUTRAL_ACTIVE : TYPE_CHIP_ACTIVE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors cursor-pointer
        ${active
          ? activeCls
          : "border-border bg-background text-muted-foreground hover:bg-muted"
        }`}
    >
      {label}
    </button>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled,
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <label
      className={`group/field inline-flex items-center gap-1.5 text-xs cursor-pointer select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
      title={tooltip}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className="text-muted-foreground group-hover/field:text-foreground transition-colors">
        {label}
      </span>
    </label>
  );
}

// ─── Tokens ──────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<EntryType, string> = {
  bug: "bug",
  feature: "feature",
  error: "error",
  refactor: "refactor",
  chore: "chore",
};

const NEUTRAL_ACTIVE =
  "border-foreground/30 bg-foreground/10 text-foreground ring-1 ring-foreground/20";

const TYPE_CHIP_ACTIVE: Record<EntryType, string> = {
  bug: "border-red-400/40 bg-red-100 text-red-800 ring-1 ring-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800/50 dark:ring-red-900/40",
  feature:
    "border-green-400/40 bg-green-100 text-green-800 ring-1 ring-green-300 dark:bg-green-950/60 dark:text-green-200 dark:border-green-800/50 dark:ring-green-900/40",
  error:
    "border-amber-400/40 bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/50 dark:ring-amber-900/40",
  refactor:
    "border-blue-400/40 bg-blue-100 text-blue-800 ring-1 ring-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800/50 dark:ring-blue-900/40",
  chore:
    "border-zinc-400/40 bg-zinc-100 text-zinc-800 ring-1 ring-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-200 dark:border-zinc-700/50 dark:ring-zinc-700/40",
};

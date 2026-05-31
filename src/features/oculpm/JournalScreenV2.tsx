import { useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { SearchIcon, TriangleAlert, X } from "@/components/Icons";
import { useWorkspace, type JournalFilter } from "@/contexts/WorkspaceContext";
import type { EntryType, JournalEntrySummary } from "@/lib/bindings";
import { useJournalDays } from "./useJournalDays";
import { JournalCardV2 } from "./JournalCardV2";
import { TRIGGER_META } from "./triggerMeta";

// Final UI Update (ui_v2) — 작업 일지 timeline (02-screen-specs §2). Frontend
// aggregation over oculpm_list_journal_entries (Decision F). scope-chip 6 filters
// persist via WorkspaceContext.journalFilter; ⌘F focuses an in-page search;
// route.params.focus (from Today's MiniEntry) ring-highlights an entry.

// scope-chip → backend EntryType. Note the JournalFilter union uses "bugfix"
// while EntryType uses "bug" (the backend never renamed it) — map here.
const FILTER_TO_TYPE: Record<Exclude<JournalFilter, "all">, EntryType> = {
  feature: "feature",
  bugfix: "bug",
  refactor: "refactor",
  error: "error",
  chore: "chore",
};

const CHIPS: { id: JournalFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "feature", label: "기능" },
  { id: "bugfix", label: "버그" },
  { id: "refactor", label: "리팩토링" },
  { id: "error", label: "에러" },
  { id: "chore", label: "잡일" },
];

interface JournalScreenV2Props {
  projectId: number;
  /** Current workday key (YYYYMMDD). */
  todayKey: string | null;
  oculpmReady: boolean;
  /** Open the 변경 diff 화면 for a specific entry (PR-UI 4 consumes the path). */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  /** One-shot: relative_path of an entry to ring-highlight (from Today). */
  focusPath: string | null;
  /** Called once the focus has been applied so the parent can clear it. */
  onFocusConsumed: () => void;
}

export function JournalScreenV2({
  projectId,
  todayKey,
  oculpmReady,
  onOpenDiff,
  focusPath,
  onFocusConsumed,
}: JournalScreenV2Props) {
  const { state, setState } = useWorkspace();
  const filter = state.journalFilter;
  const { days, loading, error, refresh } = useJournalDays(projectId, todayKey, oculpmReady);

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const setFilter = (next: JournalFilter) =>
    setState((prev) => ({ ...prev, journalFilter: next }));

  // ⌘F → focus the in-page search box (screen-local, stop propagation so the
  // global handler doesn't also act). j/k handled by the OS for now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Apply the one-shot focus once the matching entry is in the list.
  useEffect(() => {
    if (!focusPath || !days) return;
    const exists = days.some((d) => d.entries.some((e) => e.relative_path === focusPath));
    if (exists) {
      // Clear on the next tick so JournalCardV2 sees focused=true for one render.
      const t = window.setTimeout(onFocusConsumed, 1700);
      return () => window.clearTimeout(t);
    }
  }, [focusPath, days, onFocusConsumed]);

  const total = useMemo(
    () => (days ?? []).reduce((s, d) => s + d.entries.length, 0),
    [days],
  );

  // Apply scope-chip + in-page search (title + tags + slug substring).
  const filteredDays = useMemo(() => {
    if (!days) return null;
    const q = search.trim().toLowerCase();
    const typeWanted = filter === "all" ? null : FILTER_TO_TYPE[filter];
    return days
      .map((d) => ({
        ...d,
        entries: d.entries.filter((e) => {
          if (typeWanted && e.type !== typeWanted) return false;
          if (q) {
            const hay = `${e.title} ${e.slug} ${e.tags.join(" ")}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        }),
      }))
      .filter((d) => d.entries.length > 0);
  }, [days, filter, search]);

  return (
    <>
      <Toolbar title="작업 일지" sub={`${total}건의 자동 기록`}>
        <div className="search-box" style={{ minWidth: 180 }}>
          <SearchIcon size={15} color="var(--text-3)" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="일지 검색 (⌘F)"
            aria-label="일지 검색"
          />
          {search ? (
            <button
              type="button"
              className="iconbtn"
              style={{ width: 22, height: 22 }}
              onClick={() => setSearch("")}
              aria-label="검색어 지우기"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"scope-chip" + (filter === c.id ? " on" : "")}
              style={{ height: 28 }}
              onClick={() => setFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 820 }}>
          {error ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> 일지를 불러오지 못했어요
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={refresh}>
                다시 시도
              </button>
            </div>
          ) : null}

          {loading && days == null ? (
            <div className="empty-hint">불러오는 중…</div>
          ) : !oculpmReady ? (
            <div className="empty-hint">ocul-pm이 활성화되면 일지가 여기에 표시됩니다.</div>
          ) : filteredDays && filteredDays.length > 0 ? (
            filteredDays.map((day) => (
              <div key={day.workday}>
                <div className="day-label">{day.label}</div>
                <div className="tl">
                  {day.entries.map((e) => (
                    <div className="tl-node" key={e.relative_path}>
                      <span className="tl-dot">
                        <TriggerMeticon type={e.type} />
                      </span>
                      <JournalCardV2
                        entry={e}
                        focused={focusPath === e.relative_path}
                        onOpenDiff={onOpenDiff}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : total > 0 ? (
            <div className="empty-hint">
              {search || filter !== "all"
                ? "조건에 맞는 일지가 없어요."
                : "표시할 일지가 없어요."}
            </div>
          ) : (
            <div className="empty-hint">
              아직 일지가 없어요. AI 에이전트에게 작업을 요청하면 Ocul-PM이 자동으로 기록합니다.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** The trigger-colored dot icon inside a timeline node. */
function TriggerMeticon({ type }: { type: EntryType }) {
  const m = TRIGGER_META[type] ?? TRIGGER_META.chore;
  const Icon = m.icon;
  return <Icon size={11} strokeWidth={2.2} color={`var(--t-${m.cssVar})`} />;
}
